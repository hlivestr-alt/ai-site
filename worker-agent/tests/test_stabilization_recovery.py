import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from clipper_executor import LeaseGuard
from clipper_pipeline.common import PipelineError, run_child


class StabilizationRecoveryTests(unittest.TestCase):
    def test_stopping_worker_requests_retry_and_does_not_cancel_customer_job(self):
        stopping = threading.Event()
        guard = LeaseGuard(None, "fixture", {}, (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat(), stopping)
        stopping.set()
        with self.assertRaises(PipelineError) as caught:
            guard.check()
        self.assertEqual(caught.exception.code, "WORKER_INTERRUPTED")
        self.assertTrue(caught.exception.retriable)

    def test_failed_or_terminated_child_is_retryable(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(PipelineError) as caught:
                run_child([sys.executable, "-c", "raise SystemExit(2)"], Path(root), lambda: None, timeout=5)
        self.assertEqual(caught.exception.code, "LOCAL_PROCESS_FAILED")
        self.assertTrue(caught.exception.retriable)

    def test_expired_lease_still_fences_a_stopping_worker(self):
        stopping = threading.Event(); stopping.set()
        guard = LeaseGuard(None, "fixture", {}, (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), stopping)
        with self.assertRaises(PipelineError) as caught:
            guard.check()
        self.assertEqual(caught.exception.code, "LEASE_FENCED")
