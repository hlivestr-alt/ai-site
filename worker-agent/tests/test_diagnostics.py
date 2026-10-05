import contextlib
import io
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from clipper_executor import ClipperExecutor
from clipper_pipeline.common import PipelineError
from worker_agent import ApiError, log, log_exception


JOB = "11111111-1111-4111-8111-111111111111"
TOKEN = "wk_" + JOB + "." + "x" * 43
KEY = "SYNTHETIC_PRIVATE_WAVESPEED_KEY"
SIGNED = "https://storage.example.test/private/media.mp4?X-Amz-Signature=private-signature"
PRIVATE = f"Authorization: Bearer {TOKEN}; {KEY}; {SIGNED}; private transcript and request body"


class DiagnosticsTests(unittest.TestCase):
    def capture(self, error):
        output = io.StringIO()
        with patch.dict(os.environ, {"WORKER_TOKEN": TOKEN, "WAVESPEED_API_KEY": KEY}), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            log_exception("test_exception", error, job_id=JOB)
        raw = output.getvalue()
        for forbidden in [TOKEN, KEY, SIGNED, "Authorization", "private-signature", "private transcript", "Traceback"]:
            self.assertNotIn(forbidden, raw)
        return json.loads(raw)

    def test_real_nameerror_logs_only_last_frame_metadata(self):
        try:
            missing_transfer_helper()  # Deliberate regression fixture.
        except NameError as error:
            record = self.capture(error)
        self.assertEqual(record["exceptionType"], "NameError")
        self.assertEqual(record["missingName"], "missing_transfer_helper")
        self.assertEqual(record["file"], "test_diagnostics.py")
        self.assertEqual(record["function"], "test_real_nameerror_logs_only_last_frame_metadata")
        self.assertGreater(record["line"], 0)
        self.assertEqual(record["jobId"], JOB)
        self.assertEqual(record["code"], "CLIPPER_OPERATION_FAILED")

    def test_exception_message_http_url_headers_and_body_are_not_logged(self):
        for error in [ValueError(PRIVATE), urllib.error.HTTPError(SIGNED, 503, PRIVATE, {"Authorization": TOKEN}, io.BytesIO(PRIVATE.encode())), ApiError(429)]:
            with self.subTest(exception=type(error).__name__):
                record = self.capture(error)
                self.assertEqual(record["httpStatus"], 503 if isinstance(error, urllib.error.HTTPError) else 429 if isinstance(error, ApiError) else None)
                self.assertNotIn("message", record)
                self.assertNotIn("headers", record)

    def test_untrusted_name_and_pipeline_code_cannot_leak_secrets(self):
        for name in [KEY, TOKEN, SIGNED, PRIVATE]:
            record = self.capture(NameError(PRIVATE, name=name))
            self.assertIsNone(record["missingName"])
        for code in [KEY, PRIVATE, SIGNED, "UNKNOWN_CUSTOMER_CONTENT"]:
            self.assertEqual(self.capture(PipelineError(code))["code"], "CLIPPER_OPERATION_FAILED")
        self.assertEqual(self.capture(PipelineError("SOURCE_DOWNLOAD_FAILED", True))["code"], "SOURCE_DOWNLOAD_FAILED")

    def test_invalid_http_status_is_omitted(self):
        for status in [PRIVATE, True, 0, -1, 600]:
            error = ValueError(PRIVATE)
            error.status = status
            self.assertIsNone(self.capture(error)["httpStatus"])

    def test_log_defensively_redacts_configured_credentials(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"WORKER_TOKEN": TOKEN, "WAVESPEED_API_KEY": KEY}), contextlib.redirect_stdout(output):
            log("test_redaction", values={"worker": TOKEN, "wavespeed": KEY})
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertNotIn(KEY, output.getvalue())
        json.loads(output.getvalue())


class ExecutorErrorTests(unittest.TestCase):
    def execute_failure(self, error):
        claim = {"jobId": JOB, "attemptId": "22222222-2222-4222-8222-222222222222",
                 "leaseId": "33333333-3333-4333-8333-333333333333", "fencingToken": "1",
                 "leaseExpiresAt": "2099-01-01T00:00:00Z", "requiredCapability": "CLIPPER_V1",
                 "inputSnapshot": {"analyzerProvider": "wavespeed", "analyzerModel": "openai/gpt-5.6-luna",
                                   "goal": "fixture", "targetClipCount": 1, "minClipSeconds": 10,
                                   "maxClipSeconds": 20, "analyzerPolicyVersion": "clip-selection-v1",
                                   "source": {}, "language": "en", "captions": True, "aspectRatio": "9:16",
                                   "renderPolicyVersion": "vertical-h264-v1"}}
        guard = SimpleNamespace(deadline=time.time() + 3600, fenced=threading.Event(), thread=Mock(), close=Mock())
        client = Mock()
        client.post.return_value = {"status": "FAILED"}
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"WORKER_TOKEN": TOKEN, "WAVESPEED_API_KEY": KEY}), patch("clipper_executor.LeaseGuard", return_value=guard), patch("clipper_pipeline.analyzer.configured_analyzer"), patch("clipper_executor.ClipperPipeline.run", side_effect=error), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            ClipperExecutor().execute(SimpleNamespace(client=client), claim, Path(folder))
            self.assertTrue((Path(folder) / "receipt.json").is_file())
        guard.close.assert_called_once()
        failures = [call.args[1] for call in client.post.call_args_list if call.args[0].endswith("/fail")]
        self.assertEqual(len(failures), 1)
        raw = output.getvalue() + json.dumps(failures)
        for forbidden in [TOKEN, KEY, SIGNED, "Authorization", "private-signature", "private transcript", "Traceback"]:
            self.assertNotIn(forbidden, raw)
        return failures[0], [json.loads(line) for line in output.getvalue().splitlines()]

    def test_unknown_local_exception_remains_retriable_with_console_only_details(self):
        failure, records = self.execute_failure(ValueError(PRIVATE))
        self.assertEqual(failure["errorCode"], "CLIPPER_OPERATION_FAILED")
        self.assertTrue(failure["retriable"])
        self.assertEqual(failure["message"], "CLIPPER OPERATION FAILED")
        self.assertNotIn("exceptionType", failure)
        self.assertNotIn("file", failure)
        self.assertEqual(records[0]["exceptionType"], "ValueError")

    def test_pipeline_error_code_and_retry_policy_are_preserved(self):
        for code, retriable in [("SOURCE_DOWNLOAD_FAILED", True), ("SOURCE_SIZE_MISMATCH", False), ("SOURCE_CHECKSUM_MISMATCH", False)]:
            with self.subTest(code=code):
                failure, _ = self.execute_failure(PipelineError(code, retriable))
                self.assertEqual(failure["errorCode"], code)
                self.assertEqual(failure["retriable"], retriable)

    def test_http_retry_policy_is_unchanged(self):
        for status in [401, 403, 429, 500, 502, 503, 504]:
            with self.subTest(status=status):
                failure, records = self.execute_failure(ApiError(status))
                self.assertEqual(failure["retriable"], status in {429, 500, 502, 503, 504})
                self.assertEqual(records[0]["httpStatus"], status)

    def test_unknown_pipeline_code_is_sanitized_in_customer_callback(self):
        failure, _ = self.execute_failure(PipelineError(PRIVATE, True))
        self.assertEqual(failure["errorCode"], "CLIPPER_OPERATION_FAILED")
        self.assertTrue(failure["retriable"])


if __name__ == "__main__":
    unittest.main()
