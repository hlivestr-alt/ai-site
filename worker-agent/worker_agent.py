"""Outbound-only worker with separate fixture and headless Clipper executors."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def log(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":")), flush=True)


@dataclass(frozen=True)
class Config:
    base_url: str
    token: str
    max_concurrency: int
    poll_seconds: float
    heartbeat_seconds: float
    work_dir: Path
    agent_version: str

    @classmethod
    def from_env(cls) -> "Config":
        base = os.environ.get("SAAS_BASE_URL", "").rstrip("/")
        parsed = urllib.parse.urlparse(base)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}):
            raise ValueError("Worker requires HTTPS, except for loopback development")
        token = os.environ.get("WORKER_TOKEN", "")
        if not re.fullmatch(r"wk_[0-9a-f-]{36}\.[A-Za-z0-9_-]{30,100}", token):
            raise ValueError("WORKER_TOKEN is missing or invalid")
        maximum = int(os.environ.get("WORKER_MAX_CONCURRENCY", "1"))
        if maximum < 1 or maximum > 16:
            raise ValueError("WORKER_MAX_CONCURRENCY must be 1–16")
        return cls(base, token, maximum, max(0.2, float(os.environ.get("WORKER_POLL_SECONDS", "2"))),
                   max(1.0, float(os.environ.get("WORKER_HEARTBEAT_SECONDS", "20"))),
                   Path(os.environ.get("WORKER_WORK_DIR", "./data/jobs")).resolve(),
                   os.environ.get("WORKER_AGENT_VERSION", "phase5-worker-1")[:80])


class ApiError(Exception):
    def __init__(self, status: int):
        super().__init__(f"API status {status}")
        self.status = status


class Client:
    def __init__(self, config: Config):
        self.config = config

    def post(self, path: str, data: dict) -> dict:
        request = urllib.request.Request(self.config.base_url + path,
            data=json.dumps(data, separators=(",", ":")).encode("utf-8"), method="POST",
            headers={"Authorization": "Bearer " + self.config.token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            # Never include response bodies, headers, credentials, or signed URLs in logs.
            raise ApiError(exc.code) from None


class Agent:
    def __init__(self, config: Config, client: Client | None = None):
        self.config = config
        self.client = client or Client(config)
        self.stopping = threading.Event()
        self.active: dict[Future, dict] = {}
        self.last_heartbeat = 0.0
        self.last_idle_log = 0.0
        self.last_cleanup = 0.0
        import subprocess
        try:
            self.gpu_available = subprocess.run(["nvidia-smi", "-L"], capture_output=True, timeout=5).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            self.gpu_available = False

    def cleanup_terminal_attempts(self) -> None:
        import shutil
        retention = max(3600, int(os.getenv("WORKER_TERMINAL_RETENTION_SECONDS", "86400")))
        root = self.config.work_dir.resolve()
        for job in root.iterdir():
            if not job.is_dir() or not UUID.fullmatch(job.name) or job.is_symlink():
                continue
            for attempt in job.iterdir():
                if not attempt.is_dir() or not UUID.fullmatch(attempt.name) or attempt.is_symlink():
                    continue
                target = attempt.resolve()
                if not target.is_relative_to(root) or time.time() - target.stat().st_mtime < retention:
                    continue
                state = self.client.post(f"/api/worker/jobs/{job.name}/cleanup-state", {})
                if state.get("safeTerminal"):
                    shutil.rmtree(target)

    def stop(self, *_: object) -> None:
        self.stopping.set()

    def heartbeat(self) -> dict:
        import importlib.util
        import shutil
        result = self.client.post("/api/worker/heartbeat", {
            "agentVersion": self.config.agent_version, "pipelineVersion": "clipper-v1",
            "availableSlots": max(0, self.config.max_concurrency - len(self.active)),
            "activeLeaseIds": [item["leaseId"] for item in self.active.values()],
            "clipperHealth": {"transcriberAvailable": importlib.util.find_spec("faster_whisper") is not None,
                "ffmpegAvailable": bool(shutil.which(os.getenv("FFMPEG_PATH", "ffmpeg")) and shutil.which(os.getenv("FFPROBE_PATH", "ffprobe"))),
                "gpuAvailable": self.gpu_available,
                "freeDiskBytes": shutil.disk_usage(self.config.work_dir).free}})
        self.last_heartbeat = time.monotonic()
        return result

    def work_directory(self, job_id: str, attempt_id: str) -> Path:
        if not UUID.fullmatch(job_id) or not UUID.fullmatch(attempt_id):
            raise ValueError("Invalid Job identity")
        target = (self.config.work_dir / job_id / attempt_id).resolve()
        if not target.is_relative_to(self.config.work_dir):
            raise ValueError("Invalid working directory")
        target.mkdir(parents=True, exist_ok=True)
        return target

    def execute(self, claim: dict) -> None:
        job_id, attempt_id = claim["jobId"], claim["attemptId"]
        lease = {"attemptId": attempt_id, "leaseId": claim["leaseId"], "fencingToken": claim["fencingToken"]}
        try:
            work = self.work_directory(job_id, attempt_id)
            if claim["type"] == "CLIPPER":
                from clipper_executor import ClipperExecutor
                ClipperExecutor().execute(self, claim, work)
                return
            if claim["type"] != "SYSTEM_TEST":
                raise ValueError("Unsupported capability")
            fixture = claim["inputSnapshot"]["fixture"]
            steps, delay_ms = int(fixture["steps"]), int(fixture["delayMs"])
            if not 1 <= steps <= 20 or not 20 <= delay_ms <= 5000:
                raise ValueError("Invalid fixture")
            log("job_started", jobId=job_id, attemptId=attempt_id, steps=steps)
            (work / "receipt.json").write_text(json.dumps({"jobId": job_id, "attemptId": attempt_id, "status": "running"}), encoding="utf-8")
            for step in range(1, steps + 1):
                time.sleep(delay_ms / 1000)
                renewed = self.client.post(f"/api/worker/jobs/{job_id}/renew", lease)
                if renewed.get("cancelRequested"):
                    self.client.post(f"/api/worker/jobs/{job_id}/fail", {**lease, "errorCode": "CANCELLED", "retriable": False, "message": "Cancelled by customer"})
                    log("job_cancelled", jobId=job_id, attemptId=attempt_id)
                    return
                progress = self.client.post(f"/api/worker/jobs/{job_id}/progress", {**lease, "sequence": step,
                    "percent": min(99, step * 99 // steps), "stage": "STEP", "message": f"Step {step} of {steps}"})
                log("job_progress", jobId=job_id, attemptId=attempt_id, percent=progress["percent"])
            digest = hashlib.sha256(f"SYSTEM_TEST:{job_id}:{steps}".encode()).hexdigest()
            result = self.client.post(f"/api/worker/jobs/{job_id}/complete", {**lease, "digest": digest, "artifactIds": []})
            (work / "receipt.json").write_text(json.dumps({"jobId": job_id, "attemptId": attempt_id, "status": result["status"]}), encoding="utf-8")
            log("job_completed", jobId=job_id, attemptId=attempt_id, status=result["status"])
        except Exception as exc:
            log("job_error", jobId=job_id, attemptId=attempt_id, code=type(exc).__name__)
            try:
                self.client.post(f"/api/worker/jobs/{job_id}/fail", {**lease, "errorCode": "FIXTURE_ERROR", "retriable": True, "message": "Fixture worker interrupted"})
            except Exception:
                # A lost or fenced lease is reconciled by the dispatcher.
                pass

    def run(self, once: bool = False) -> None:
        self.config.work_dir.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=self.config.max_concurrency) as executor:
            while not self.stopping.is_set():
                for future in list(self.active):
                    if future.done():
                        try:
                            future.result()
                        except Exception as exc:
                            log("executor_error", code=type(exc).__name__)
                        del self.active[future]
                try:
                    if time.monotonic() - self.last_cleanup > 3600:
                        self.cleanup_terminal_attempts()
                        self.last_cleanup = time.monotonic()
                    if time.monotonic() - self.last_heartbeat >= self.config.heartbeat_seconds:
                        heartbeat = self.heartbeat()
                        if heartbeat.get("status") != "ACTIVE":
                            if once and not self.active:
                                break
                            time.sleep(self.config.poll_seconds)
                            continue
                    if len(self.active) < self.config.max_concurrency:
                        response = self.client.post("/api/worker/claim", {})
                        claim = response.get("claim")
                        if claim:
                            future = executor.submit(self.execute, claim)
                            self.active[future] = claim
                        else:
                            if time.monotonic() - self.last_idle_log >= 5:
                                log("agent_idle", active=len(self.active), reason=response.get("reason", "none"))
                                self.last_idle_log = time.monotonic()
                            if once and not self.active:
                                break
                except Exception as exc:
                    log("agent_request_error", code=type(exc).__name__)
                    if once and not self.active:
                        raise
                time.sleep(self.config.poll_seconds)
            # Graceful drain: finish current deterministic tasks, do not claim more.
            for future in list(self.active):
                future.result()


def main() -> int:
    parser = argparse.ArgumentParser(description="Outbound-only fixture and headless Clipper worker")
    parser.add_argument("--once", action="store_true", help="Process available Jobs, then exit")
    parser.add_argument("--env", default=".env", help="Configuration file")
    args = parser.parse_args()
    load_dotenv(Path(args.env))
    agent = Agent(Config.from_env())
    signal.signal(signal.SIGINT, agent.stop)
    signal.signal(signal.SIGTERM, agent.stop)
    log("agent_started", version=agent.config.agent_version, maxConcurrency=agent.config.max_concurrency)
    agent.run(args.once)
    log("agent_stopped")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        log("agent_fatal", code=type(error).__name__)
        sys.exit(1)
