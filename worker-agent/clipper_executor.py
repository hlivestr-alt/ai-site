from __future__ import annotations
import json
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path
from clipper_pipeline.common import PipelineError, atomic_json, sha_file
from clipper_pipeline.pipeline import ClipperPipeline
from clipper_pipeline.transfer import upload

class LeaseGuard:
    def __init__(self, client, job_id: str, identity: dict, expires: str):
        self.client, self.job_id, self.identity = client, job_id, identity
        self.deadline = datetime.fromisoformat(expires.replace("Z", "+00:00")).timestamp()
        self.closed, self.cancelled, self.fenced = threading.Event(), threading.Event(), threading.Event()
        self.thread = threading.Thread(target=self.renew, daemon=True)

    def renew(self):
        while not self.closed.wait(min(10, max(1, (self.deadline - time.time()) / 3))):
            try:
                result = self.client.post(f"/api/worker/jobs/{self.job_id}/renew", self.identity)
                self.deadline = datetime.fromisoformat(result["leaseExpiresAt"].replace("Z", "+00:00")).timestamp()
                if result.get("cancelRequested"):
                    self.cancelled.set()
            except Exception as error:
                if getattr(error, "status", 0) in {401, 403, 409} or time.time() >= self.deadline:
                    self.fenced.set()
                    return

    def check(self):
        if self.fenced.is_set() or time.time() >= self.deadline:
            raise PipelineError("LEASE_FENCED")
        if self.cancelled.is_set():
            raise PipelineError("CANCELLED")

    def close(self):
        self.closed.set()
        self.thread.join(timeout=25)

class Callbacks:
    def __init__(self, client, claim: dict, work: Path, guard: LeaseGuard):
        self.client, self.claim, self.work, self.guard = client, claim, work, guard
        self.identity = {k: claim[k] for k in ["attemptId", "leaseId", "fencingToken"]}
        self.sequence, self.cloud = 0, {}
        self.metrics = {"transcription": 0, "analyzer": 0, "render": 0}

    def check(self):
        self.guard.check()

    def post(self, action: str, data: dict):
        for attempt in range(3):
            self.check()
            try:
                return self.client.post(f"/api/worker/jobs/{self.claim['jobId']}/{action}", {**self.identity, **data})
            except Exception as error:
                if getattr(error, "status", 0) in {400, 401, 403, 404, 409, 413, 422} or attempt == 2:
                    raise
                time.sleep(0.5 * 2**attempt)

    def progress(self, percent: int, stage: str, message: str):
        self.sequence += 1
        result = self.post("progress", {"sequence": self.sequence, "percent": percent, "stage": stage, "message": message})
        if result.get("cancelRequested"):
            self.guard.cancelled.set()
            self.check()

    def source_access(self):
        return self.post("source/download", {"sourceAssetId": self.claim["inputSnapshot"]["source"]["sourceAssetId"]})

    def source_verified(self, checksum: str, media: dict):
        source = self.claim["inputSnapshot"]["source"]
        self.post("source/verify", {"sourceAssetId": source["sourceAssetId"], "sha256": checksum, "byteSize": source["byteSize"], **{k: media[k] for k in ["durationSeconds", "width", "height", "hasAudio"]}})

    def checkpoints(self):
        state = self.post("checkpoints", {})
        self.cloud = {c["slotName"]: c for c in state["checkpoints"]}
        return state

    def publish(self, slot: str, path: Path, mime: str) -> str:
        self.check()
        checksum = sha_file(path)
        existing = self.cloud.get(slot)
        if existing and existing.get("attemptId") == self.claim["attemptId"] and existing["sha256"] == checksum:
            return existing["artifactId"]
        receipt_path = self.work / "outputs" / (slot + ".json")
        try:
            receipt = json.loads(receipt_path.read_text())
        except (OSError, ValueError):
            receipt = None
        if receipt and receipt.get("sha256") == checksum:
            try:
                self.post("outputs/finalize", {"artifactId": receipt["artifactId"]})
                return receipt["artifactId"]
            except Exception as error:
                if getattr(error, "status", 0) != 409:
                    raise
        for attempt in range(3):
            self.check()
            allocation = self.post("outputs", {"slotName": slot, "mimeType": mime, "byteSize": path.stat().st_size, "sha256": checksum})
            atomic_json(receipt_path, {"artifactId": allocation["artifactId"], "sha256": checksum})
            try:
                upload(allocation["uploadUrl"], path, mime, self.check)
                self.post("outputs/finalize", {"artifactId": allocation["artifactId"]})
                return allocation["artifactId"]
            except PipelineError as error:
                if not error.retriable or attempt == 2:
                    raise
                time.sleep(0.5 * 2**attempt)
        raise PipelineError("OUTPUT_UPLOAD_FAILED", True)

    def record(self, stage: str):
        self.metrics[stage] += 1
        atomic_json(self.work / "logs" / "execution-counts.json", self.metrics)

class ClipperExecutor:
    def execute(self, agent, claim: dict, work: Path):
        identity = {k: claim[k] for k in ["attemptId", "leaseId", "fencingToken"]}
        guard = LeaseGuard(agent.client, claim["jobId"], identity, claim["leaseExpiresAt"])
        guard.thread.start()
        callbacks = Callbacks(agent.client, claim, work, guard)
        try:
            inputs = claim["inputSnapshot"]
            provider = inputs["analyzerProvider"]
            if provider == "fake" and claim.get("requiredCapability") != "CLIPPER_TEST_V1":
                raise PipelineError("FIXTURE_CAPABILITY_REQUIRED")
            from clipper_pipeline.analyzer import configured_analyzer
            configured_analyzer(provider, inputs.get("analyzerModel"))
            analyzer = {"provider": provider, "model": inputs.get("analyzerModel"), "goal": inputs["goal"], "targetClipCount": inputs["targetClipCount"], "minClipSeconds": inputs["minClipSeconds"], "maxClipSeconds": inputs["maxClipSeconds"], "product": inputs.get("product"), "policyVersion": inputs["analyzerPolicyVersion"]}
            manifest = ClipperPipeline().run(inputs["source"], {"language": inputs["language"]}, analyzer, {"captions": inputs["captions"], "aspectRatio": inputs["aspectRatio"], "policyVersion": inputs["renderPolicyVersion"]}, callbacks)
            callbacks.post("complete", manifest)
            atomic_json(work / "receipt.json", {"status": "SUCCEEDED", "jobId": claim["jobId"], "metrics": callbacks.metrics})
            for name in ["source", "transcript", "analysis", "render"]:
                target = (work / name).resolve()
                if not target.is_relative_to(work.resolve()):
                    raise ValueError("Cleanup escaped attempt")
                shutil.rmtree(target)
        except Exception as error:
            code = error.code if isinstance(error, PipelineError) else "CLIPPER_OPERATION_FAILED"
            retriable = error.retriable if isinstance(error, PipelineError) else getattr(error, "status", 0) in {0, 429, 500, 502, 503, 504}
            if code != "LEASE_FENCED" and not guard.fenced.is_set() and time.time() < guard.deadline:
                try:
                    result = agent.client.post(f"/api/worker/jobs/{claim['jobId']}/fail", {**identity, "errorCode": code, "retriable": retriable, "message": code.replace("_", " ")})
                    atomic_json(work / "receipt.json", {"status": result["status"], "jobId": claim["jobId"], "metrics": callbacks.metrics})
                except Exception:
                    pass
            from worker_agent import log
            log("clipper_error", jobId=claim["jobId"], code=code)
        finally:
            guard.close()
