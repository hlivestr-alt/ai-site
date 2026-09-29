import hashlib
import tempfile
import unittest
from pathlib import Path

from worker_agent import Agent, Config


JOB = "11111111-1111-4111-8111-111111111111"
ATTEMPT = "22222222-2222-4222-8222-222222222222"
LEASE = "33333333-3333-4333-8333-333333333333"


class FakeClient:
    def __init__(self, cancel=False):
        self.calls = []
        self.cancel = cancel

    def post(self, path, data):
        self.calls.append((path, data))
        if path.endswith("/renew"):
            return {"cancelRequested": self.cancel}
        if path.endswith("/progress"):
            return {"percent": data["percent"]}
        if path.endswith("/complete"):
            return {"status": "SUCCEEDED"}
        if path.endswith("/fail"):
            return {"status": "CANCELLED"}
        return {}


class AgentFixtureTests(unittest.TestCase):
    def make_agent(self, root, cancel=False):
        config = Config("http://127.0.0.1:3200", "wk_" + JOB + "." + "x" * 43,
                        1, 0.2, 20, Path(root).resolve(), "test")
        client = FakeClient(cancel)
        return Agent(config, client), client

    def claim(self):
        return {"jobId": JOB, "attemptId": ATTEMPT, "leaseId": LEASE,
                "fencingToken": "12", "type": "SYSTEM_TEST",
                "inputSnapshot": {"fixture": {"steps": 3, "delayMs": 20}}}

    def test_deterministic_result_and_isolated_attempt_directory(self):
        with tempfile.TemporaryDirectory() as root:
            agent, client = self.make_agent(root)
            agent.execute(self.claim())
            complete = [data for path, data in client.calls if path.endswith("/complete")]
            self.assertEqual(len(complete), 1)
            self.assertEqual(complete[0]["digest"], hashlib.sha256(f"SYSTEM_TEST:{JOB}:3".encode()).hexdigest())
            self.assertEqual([data["percent"] for path, data in client.calls if path.endswith("/progress")], [33, 66, 99])
            self.assertTrue((Path(root) / JOB / ATTEMPT / "receipt.json").is_file())
            with self.assertRaises(ValueError):
                agent.work_directory("../../other", ATTEMPT)

    def test_cooperative_cancellation_never_completes(self):
        with tempfile.TemporaryDirectory() as root:
            agent, client = self.make_agent(root, cancel=True)
            agent.execute(self.claim())
            self.assertEqual(len([1 for path, _ in client.calls if path.endswith("/fail")]), 1)
            self.assertEqual(len([1 for path, _ in client.calls if path.endswith("/complete")]), 0)


if __name__ == "__main__":
    unittest.main()
