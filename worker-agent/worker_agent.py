"""Outbound-only worker with separate fixture and headless Clipper executors."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
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
ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SECRET_KEYS = ("WORKER_TOKEN", "WAVESPEED_API_KEY", "OPENAI_API_KEY")
SAFE_PIPELINE_CODES = frozenset({
    "ANALYZER_CHUNK_LIMIT", "ANALYZER_INCOMPLETE", "ANALYZER_INVALID_CANDIDATES",
    "ANALYZER_INVALID_OUTPUT", "ANALYZER_MODEL_MISMATCH", "ANALYZER_MODEL_UNAVAILABLE",
    "ANALYZER_NOT_CONFIGURED", "ANALYZER_PROVIDER_MISMATCH", "ANALYZER_RATE_LIMIT",
    "ANALYZER_REFUSED", "ANALYZER_TIMEOUT", "ANALYZER_UNAVAILABLE", "CANCELLED",
    "FIXTURE_CAPABILITY_REQUIRED", "LEASE_FENCED", "LOCAL_PROCESS_FAILED",
    "MEDIA_URL_INVALID", "NO_VALID_MOMENTS", "OUTPUT_UPLOAD_FAILED", "PLAN_INVALID",
    "PROCESS_TIMEOUT", "RENDER_INVALID", "SOURCE_AUDIO_REQUIRED",
    "SOURCE_CHECKSUM_MISMATCH", "SOURCE_DOWNLOAD_FAILED", "SOURCE_INVALID",
    "SOURCE_SIZE_MISMATCH", "SOURCE_TOO_LARGE", "TRANSCRIPTION_MODEL_UNAVAILABLE",
    "TRANSCRIPT_EMPTY", "TRANSCRIPT_INVALID", "TRANSCRIPT_SEGMENT_TOO_LARGE",
    "WORKER_DISK_SPACE_LOW", "WORKER_INTERRUPTED", "VARIATION_INPUT_INVALID",
})


class ConfigError(ValueError):
    """Configuration errors contain a key and a fixed reason, never its value."""
    def __init__(self, key: str, reason: str):
        self.key = key
        super().__init__(f"{key} {reason}")


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError):
        raise ConfigError("ENV_FILE", "cannot be read as UTF-8") from None
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if ENV_KEY.fullmatch(key) and not os.environ.get(key, "").strip():
            try:
                os.environ[key] = value
            except (OSError, ValueError):
                raise ConfigError(key, "contains an invalid environment value") from None


def contains_secret(value: str) -> bool:
    return any(os.environ.get(key, "").strip() and os.environ[key] in value for key in SECRET_KEYS) or bool(
        re.search(r"wk_[0-9a-f-]{36}\.[A-Za-z0-9_-]{30,100}", value, re.I))


def safe_metadata(value: object, pattern: str) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(pattern, value) and not contains_secret(value) else None


def safe_error_code(error: Exception) -> str:
    from clipper_pipeline.common import PipelineError
    code = error.code if isinstance(error, PipelineError) else None
    return code if isinstance(code, str) and code in SAFE_PIPELINE_CODES and not contains_secret(code) else "CLIPPER_OPERATION_FAILED"


def log(event: str, **fields: object) -> None:
    payload = json.dumps({"event": event, **fields}, separators=(",", ":"))
    for key in SECRET_KEYS:
        secret = os.environ.get(key, "")
        if secret.strip():
            payload = payload.replace(json.dumps(secret)[1:-1], "[redacted]")
    payload = re.sub(r"wk_[0-9a-f-]{36}\.[A-Za-z0-9_-]{30,100}", "[redacted]", payload, flags=re.I)
    print(payload, flush=True)


def log_exception(event: str, error: Exception, *, job_id: str | None = None, code: str | None = None) -> None:
    # Traverse frames without formatting exception messages, source lines or locals.
    frame = error.__traceback__
    while frame and frame.tb_next:
        frame = frame.tb_next
    status = getattr(error, "status", getattr(error, "code", None))
    fields = {
        "exceptionType": safe_metadata(type(error).__name__, r"[A-Za-z_][A-Za-z0-9_]{0,127}"),
        "file": safe_metadata(Path(frame.tb_frame.f_code.co_filename).name, r"[A-Za-z0-9_.-]{1,128}") if frame else None,
        "line": frame.tb_lineno if frame else None,
        "function": safe_metadata(frame.tb_frame.f_code.co_name, r"(?:[A-Za-z_][A-Za-z0-9_]{0,127}|<(?:module|lambda|genexpr)>)") if frame else None,
        "httpStatus": status if type(status) is int and 100 <= status <= 599 else None,
        "code": safe_metadata(code, r"[A-Z][A-Z0-9_]{0,63}") if code else safe_error_code(error),
    }
    if job_id is not None:
        fields["jobId"] = job_id if UUID.fullmatch(job_id) else None
    if isinstance(error, NameError):
        fields["missingName"] = safe_metadata(error.name, r"[A-Za-z_][A-Za-z0-9_]{0,127}")
    log(event, **fields)


def numeric_env(key: str, default: str, convert):
    try:
        value = convert(os.environ.get(key, default))
        if not math.isfinite(value):
            raise ValueError()
        return value
    except (ValueError, OverflowError):
        raise ConfigError(key, "must be a finite number" if convert is float else "must be an integer") from None


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
        try:
            parsed = urllib.parse.urlparse(base)
            valid = bool(parsed.hostname) and parsed.port != 0 and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
            valid = valid and (parsed.scheme == "https" or parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"})
        except ValueError:
            valid = False
        if not valid:
            raise ConfigError("SAAS_BASE_URL", "requires a valid HTTPS URL, except for loopback development")
        token = os.environ.get("WORKER_TOKEN", "")
        if not re.fullmatch(r"wk_[0-9a-f-]{36}\.[A-Za-z0-9_-]{30,100}", token):
            raise ConfigError("WORKER_TOKEN", "is missing or invalid")
        maximum = numeric_env("WORKER_MAX_CONCURRENCY", "1", int)
        if maximum < 1 or maximum > 16:
            raise ConfigError("WORKER_MAX_CONCURRENCY", "must be 1–16")
        poll = max(0.2, numeric_env("WORKER_POLL_SECONDS", "2", float))
        heartbeat = max(1.0, numeric_env("WORKER_HEARTBEAT_SECONDS", "20", float))
        try:
            work_dir = Path(os.environ.get("WORKER_WORK_DIR", "./data/jobs")).resolve()
        except (OSError, ValueError):
            raise ConfigError("WORKER_WORK_DIR", "is invalid") from None
        return cls(base, token, maximum, poll, heartbeat, work_dir,
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

    def clipper_health(self) -> dict:
        import importlib.util
        import shutil
        from clipper_pipeline.analyzer import analyzer_health
        return {"transcriberAvailable": importlib.util.find_spec("faster_whisper") is not None,
            "ffmpegAvailable": bool(shutil.which(os.getenv("FFMPEG_PATH", "ffmpeg")) and shutil.which(os.getenv("FFPROBE_PATH", "ffprobe"))),
            "gpuAvailable": self.gpu_available,
            "freeDiskBytes": shutil.disk_usage(self.config.work_dir).free, "variationRenderAvailable": shutil.which(os.environ.get("FFMPEG_PATH", "ffmpeg")) is not None, **analyzer_health()}

    def heartbeat(self, *, available_slots: int | None = None) -> dict:
        result = self.client.post("/api/worker/heartbeat", {
            "agentVersion": self.config.agent_version, "pipelineVersion": "clipper-v1",
            "availableSlots": max(0, self.config.max_concurrency - len(self.active)) if available_slots is None else available_slots,
            "activeLeaseIds": [item["leaseId"] for item in self.active.values()],
            "clipperHealth": self.clipper_health()})
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
            if claim["type"] in {"CLIPPER", "CLIPPER_VARIATION"}:
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
            log_exception("job_error", exc, job_id=job_id)
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
                            log_exception("executor_error", exc)
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
                                log("agent_idle", active=len(self.active), reason=safe_metadata(response.get("reason", "none"), r"[A-Za-z_]{1,64}"))
                                self.last_idle_log = time.monotonic()
                            if once and not self.active:
                                break
                except Exception as exc:
                    log_exception("agent_request_error", exc)
                    if once and not self.active:
                        raise
                time.sleep(self.config.poll_seconds)
            # Graceful drain: finish current deterministic tasks, do not claim more.
            for future in list(self.active):
                future.result()


def main() -> int:
    parser = argparse.ArgumentParser(description="Outbound-only fixture and headless Clipper worker")
    parser.add_argument("--once", action="store_true", help="Process available Jobs, then exit")
    parser.add_argument("--check-startup", action="store_true", help="Validate local health and send one heartbeat with zero slots; never claim Jobs")
    parser.add_argument("--env", default=str(Path(__file__).resolve().with_name(".env")), help="Configuration file (default: beside worker_agent.py)")
    args = parser.parse_args()
    load_dotenv(Path(args.env))
    config = Config.from_env()
    try:
        config.work_dir.mkdir(parents=True, exist_ok=True)
    except (OSError, ValueError):
        raise ConfigError("WORKER_WORK_DIR", "cannot be created") from None
    agent = Agent(config)
    signal.signal(signal.SIGINT, agent.stop)
    signal.signal(signal.SIGTERM, agent.stop)
    log("agent_started", version=agent.config.agent_version, maxConcurrency=agent.config.max_concurrency,
        pipelineVersion="clipper-v1", clipperHealth=agent.clipper_health())
    if args.check_startup:
        result = agent.heartbeat(available_slots=0)
        if result.get("status") != "ACTIVE":
            raise ConfigError("WORKER_STATUS", "must be ACTIVE for normal startup")
        log("agent_startup_check_passed", heartbeat=True, availableSlots=0)
        log("agent_stopped")
        return 0
    agent.run(args.once)
    log("agent_stopped")
    return 0


def run_cli() -> int:
    try:
        return main()
    except ConfigError as error:
        log("agent_configuration_error", configKey=error.key, message=str(error))
        return 1
    except Exception as error:
        log_exception("agent_fatal", error)
        return 1


if __name__ == "__main__":
    sys.exit(run_cli())
