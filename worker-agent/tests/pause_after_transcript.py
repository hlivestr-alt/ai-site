"""Controlled acceptance harness. Pauses after a real durable transcript.

Worker production modules have no acceptance pause controls.
"""
import threading
import worker_agent
from clipper_executor import Callbacks
original = Callbacks.publish
def publish(self, slot, path, mime):
    artifact_id = original(self, slot, path, mime)
    if slot == "transcript":
        worker_agent.log("acceptance_transcript_ready", jobId=self.claim["jobId"])
        while True:
            self.check()
            threading.Event().wait(0.2)
    return artifact_id
Callbacks.publish = publish
worker_agent.main()
