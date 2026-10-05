import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker_agent import Config, ConfigError, load_dotenv, run_cli


ROOT = Path(__file__).resolve().parents[1]
TOKEN = "wk_11111111-1111-4111-8111-111111111111." + "x" * 43
OVERRIDE = "wk_22222222-2222-4222-8222-222222222222." + "y" * 43
KEY = "synthetic-wavespeed-secret"
ENV = {"SAAS_BASE_URL": "http://127.0.0.1:3200", "WORKER_TOKEN": TOKEN, "WAVESPEED_API_KEY": KEY}


class EnvironmentTests(unittest.TestCase):
    def check_precedence(self, initial, expected):
        with tempfile.TemporaryDirectory() as folder:
            env_file = Path(folder) / ".env"
            env_file.write_text("\n".join(f"{key}={value}" for key, value in ENV.items()), encoding="utf-8")
            with patch.dict(os.environ, initial, clear=True):
                load_dotenv(env_file)
                self.assertEqual(os.environ["WORKER_TOKEN"], expected)
                self.assertEqual(Config.from_env().token, expected)

    def test_missing_variable_uses_dotenv(self):
        self.check_precedence({}, TOKEN)

    def test_empty_variable_uses_dotenv(self):
        self.check_precedence({"WORKER_TOKEN": "", "SAAS_BASE_URL": ""}, TOKEN)

    def test_whitespace_variable_uses_dotenv(self):
        self.check_precedence({"WORKER_TOKEN": " \t\n ", "SAAS_BASE_URL": " \t"}, TOKEN)

    def test_nonempty_override_is_preserved(self):
        self.check_precedence({"WORKER_TOKEN": OVERRIDE}, OVERRIDE)

    def test_bom_comments_and_invalid_keys_are_safe_and_quiet(self):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text(f"WORKER_TOKEN={TOKEN}\n# comment\n\nWAVESPEED_API_KEY = {KEY}\nnot a setting\nBAD KEY=ignored\n=ignored\n", encoding="utf-8-sig")
            with patch.dict(os.environ, {"WAVESPEED_API_KEY": " \t"}, clear=True), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                load_dotenv(path)
                self.assertEqual(os.environ["WORKER_TOKEN"], TOKEN)
                self.assertEqual(os.environ["WAVESPEED_API_KEY"], KEY)
                self.assertNotIn("BAD KEY", os.environ)
        self.assertEqual(output.getvalue(), "")

    def test_invalid_nonempty_token_is_not_silently_replaced(self):
        for invalid in ["stale-token", "wk_bad.invalid", TOKEN + "!", " " + TOKEN, ""]:
            with self.subTest(case=bool(invalid)), patch.dict(os.environ, {**ENV, "WORKER_TOKEN": invalid}, clear=True):
                with self.assertRaises(ConfigError) as caught:
                    Config.from_env()
                self.assertEqual(str(caught.exception), "WORKER_TOKEN is missing or invalid")
                self.assertNotIn(TOKEN, str(caught.exception))
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {**ENV, "WORKER_TOKEN": "invalid-stale-override"}, clear=True):
            path = Path(folder) / ".env"
            path.write_text("WORKER_TOKEN=" + TOKEN, encoding="utf-8")
            load_dotenv(path)
            with self.assertRaises(ConfigError):
                Config.from_env()

    def test_configuration_failures_identify_key_without_value_or_traceback(self):
        cases = [("WORKER_TOKEN", KEY), ("SAAS_BASE_URL", "https://[" + KEY),
                 ("WORKER_MAX_CONCURRENCY", KEY), ("WORKER_MAX_CONCURRENCY", "17"),
                 ("WORKER_POLL_SECONDS", KEY), ("WORKER_POLL_SECONDS", "nan"),
                 ("WORKER_HEARTBEAT_SECONDS", "inf")]
        with tempfile.TemporaryDirectory() as folder:
            absent = str(Path(folder) / "absent.env")
            for key, value in cases:
                output = io.StringIO()
                with self.subTest(key=key), patch.dict(os.environ, {**ENV, key: value}, clear=True), patch("sys.argv", ["worker_agent.py", "--env", absent]), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                    self.assertEqual(run_cli(), 1)
                raw = output.getvalue()
                record = json.loads(raw)
                self.assertEqual(record["event"], "agent_configuration_error")
                self.assertEqual(record["configKey"], key)
                self.assertNotIn(TOKEN, raw)
                self.assertNotIn(KEY, raw)
                self.assertNotIn("Traceback", raw)

    def test_unwritable_work_directory_has_safe_key_specific_error(self):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {**ENV, "WORKER_WORK_DIR": folder}, clear=True), patch("sys.argv", ["worker_agent.py", "--env", str(Path(folder) / "absent.env")]), patch("worker_agent.Path.mkdir", side_effect=OSError(KEY)), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.assertEqual(run_cli(), 1)
        record = json.loads(output.getvalue())
        self.assertEqual(record["configKey"], "WORKER_WORK_DIR")
        self.assertNotIn(KEY, output.getvalue())

    def test_invalid_utf8_file_has_safe_configuration_error(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_bytes(b"WORKER_TOKEN=\xff")
            with self.assertRaises(ConfigError) as caught:
                load_dotenv(path)
            self.assertEqual(str(caught.exception), "ENV_FILE cannot be read as UTF-8")

    def test_invalid_dotenv_value_has_safe_key_specific_error(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            path = Path(folder) / ".env"
            path.write_text("WORKER_TOKEN=\0" + KEY, encoding="utf-8")
            with self.assertRaises(ConfigError) as caught:
                load_dotenv(path)
            self.assertEqual(str(caught.exception), "WORKER_TOKEN contains an invalid environment value")
            self.assertNotIn(KEY, str(caught.exception))

    def test_fresh_child_configuration_loads_dotenv_without_process_token(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text("\n".join(f"{key}={value}" for key, value in ENV.items()), encoding="utf-8-sig")
            child_env = {key: value for key, value in os.environ.items() if key not in ENV}
            script = f"import sys; sys.path.insert(0, {str(ROOT)!r}); from pathlib import Path; from worker_agent import load_dotenv, Config; load_dotenv(Path('.env')); assert Config.from_env().token; print('dotenv_config_ok')"
            result = subprocess.run([sys.executable, "-c", script], cwd=folder, env=child_env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), "dotenv_config_ok")
            self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
