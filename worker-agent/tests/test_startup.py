import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

from worker_agent import Agent, Config, run_cli


ROOT = Path(__file__).resolve().parents[1]
TOKEN = "wk_11111111-1111-4111-8111-111111111111." + "x" * 43
KEY = "synthetic-startup-wavespeed-key"
MODEL = "openai/gpt-5.6-luna"


def settings(folder, base="http://127.0.0.1:3200"):
    return {"SAAS_BASE_URL": base, "WORKER_TOKEN": TOKEN, "WORKER_WORK_DIR": str(Path(folder) / "jobs"),
            "WORKER_POLL_SECONDS": "0.2", "WORKER_HEARTBEAT_SECONDS": "1",
            "CLIP_ANALYZER_PROVIDER": "wavespeed", "WAVESPEED_API_KEY": KEY,
            "WAVESPEED_LLM_BASE_URL": "https://llm.wavespeed.ai/v1", "WAVESPEED_CLIP_MODEL": MODEL}


class StartupTests(unittest.TestCase):
    def test_health_detects_tools_gpu_and_analyzer_without_api_or_model_load(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, settings(folder), clear=True), patch("subprocess.run", return_value=Mock(returncode=0)) as gpu, patch("importlib.util.find_spec", return_value=object()) as transcriber, patch("shutil.which", side_effect=lambda name: name), patch("urllib.request.urlopen", side_effect=AssertionError("health must not call APIs")), patch("clipper_pipeline.wavespeed_analyzer.urlopen", side_effect=AssertionError("health must not call WaveSpeed")):
            config = Config.from_env()
            config.work_dir.mkdir()
            client = Mock()
            client.post.return_value = {"status": "ACTIVE"}
            agent = Agent(config, client)
            self.assertEqual(agent.heartbeat(), {"status": "ACTIVE"})
            payload = client.post.call_args.args[1]
            health = payload["clipperHealth"]
            gpu.assert_called_once_with(["nvidia-smi", "-L"], capture_output=True, timeout=5)
            transcriber.assert_called_once_with("faster_whisper")
            self.assertEqual(payload["pipelineVersion"], "clipper-v1")
            self.assertEqual(payload["availableSlots"], 1)
            self.assertTrue(health["transcriberAvailable"])
            self.assertTrue(health["ffmpegAvailable"])
            self.assertTrue(health["gpuAvailable"])
            self.assertTrue(health["analyzerConfigured"])
            self.assertEqual(health["analyzerProvider"], "wavespeed")
            self.assertEqual(health["analyzerModel"], MODEL)
            self.assertGreater(health["freeDiskBytes"], 0)
            self.assertNotIn(TOKEN, json.dumps(payload))
            self.assertNotIn(KEY, json.dumps(payload))

    def test_missing_dependencies_report_unhealthy_without_blocking_worker(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {**settings(folder), "WAVESPEED_API_KEY": ""}, clear=True), patch("subprocess.run", side_effect=FileNotFoundError()), patch("importlib.util.find_spec", return_value=None), patch("shutil.which", return_value=None):
            config = Config.from_env()
            config.work_dir.mkdir()
            health = Agent(config, Mock()).clipper_health()
            for key in ["transcriberAvailable", "ffmpegAvailable", "gpuAvailable", "analyzerConfigured"]:
                self.assertFalse(health[key])

    def test_check_startup_loads_default_dotenv_without_claim_or_cleanup(self):
        with tempfile.TemporaryDirectory() as folder:
            values = settings(folder)
            Path(folder, ".env").write_text("\n".join(f"{key}={value}" for key, value in values.items()), encoding="utf-8-sig")
            client = Mock()
            client.post.return_value = {"status": "ACTIVE"}
            output = io.StringIO()
            with patch.dict(os.environ, {"WORKER_TOKEN": " \t"}, clear=True), patch("worker_agent.__file__", str(Path(folder) / "worker_agent.py")), patch("sys.argv", ["worker_agent.py", "--check-startup"]), patch("worker_agent.Client", return_value=client), patch("subprocess.run", return_value=Mock(returncode=0)), patch.object(Agent, "run") as run, patch.object(Agent, "cleanup_terminal_attempts") as cleanup, contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                self.assertEqual(run_cli(), 0)
                self.assertEqual(os.environ["WORKER_TOKEN"], TOKEN)
            client.post.assert_called_once()
            self.assertEqual(client.post.call_args.args[0], "/api/worker/heartbeat")
            self.assertEqual(client.post.call_args.args[1]["availableSlots"], 0)
            run.assert_not_called()
            cleanup.assert_not_called()
            self.assertNotIn(TOKEN, output.getvalue())
            self.assertNotIn(KEY, output.getvalue())
            self.assertEqual(json.loads(output.getvalue().splitlines()[-1])["event"], "agent_stopped")

    def test_normal_no_argument_startup_heartbeats_runs_and_stops_cleanly(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, ".env").write_text("\n".join(f"{key}={value}" for key, value in settings(folder).items()), encoding="utf-8")
            calls, agents = [], []

            class Client:
                def post(self, path, payload):
                    calls.append((path, payload))
                    if path == "/api/worker/heartbeat":
                        return {"status": "ACTIVE"}
                    if path == "/api/worker/claim":
                        agents[0].stop()
                        return {"claim": None}
                    raise AssertionError("startup must not execute Jobs")

            def make_agent(config):
                agent = Agent(config, Client())
                agents.append(agent)
                return agent

            output = io.StringIO()
            with patch.dict(os.environ, {}, clear=True), patch("worker_agent.__file__", str(Path(folder) / "worker_agent.py")), patch("sys.argv", ["worker_agent.py"]), patch("worker_agent.Agent", side_effect=make_agent), patch("subprocess.run", return_value=Mock(returncode=0)), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                self.assertEqual(run_cli(), 0)
            self.assertEqual([path for path, _ in calls], ["/api/worker/heartbeat", "/api/worker/claim"])
            self.assertTrue(agents[0].stopping.is_set())
            self.assertEqual(calls[0][1]["availableSlots"], 1)
            self.assertNotIn(TOKEN, output.getvalue())
            self.assertNotIn(KEY, output.getvalue())

    def test_fresh_child_entrypoint_authenticates_to_local_stub_and_exits(self):
        calls = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                authenticated = self.headers.get("Authorization") == "Bearer " + TOKEN
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append((self.path, authenticated, data))
                self.send_response(200 if authenticated and self.path == "/api/worker/heartbeat" else 403)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"ACTIVE"}')

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                values = settings(folder, f"http://127.0.0.1:{server.server_port}")
                env_file = Path(folder) / ".env"
                env_file.write_text("\n".join(f"{key}={value}" for key, value in values.items()), encoding="utf-8-sig")
                child_env = {key: value for key, value in os.environ.items() if key not in values}
                child_env["NO_PROXY"] = child_env["no_proxy"] = "127.0.0.1,localhost"
                result = subprocess.run([sys.executable, str(ROOT / "worker_agent.py"), "--env", str(env_file), "--check-startup"], cwd=ROOT, env=child_env, capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(result.stderr, "")
                self.assertNotIn(TOKEN, result.stdout)
                self.assertNotIn(KEY, result.stdout)
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][0], "/api/worker/heartbeat")
                self.assertTrue(calls[0][1])
                self.assertEqual(calls[0][2]["availableSlots"], 0)
                self.assertIn("agent_startup_check_passed", result.stdout)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
