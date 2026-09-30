from __future__ import annotations
import hashlib
import json
import math
import os
import subprocess
import time
from pathlib import Path

class PipelineError(Exception):
    def __init__(self, code: str, retriable: bool = False):
        super().__init__(code)
        self.code, self.retriable = code, retriable

def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".partial")
    temp.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, allow_nan=False), encoding="utf-8")
    os.replace(temp, path)

def run_child(args: list[str], cwd: Path, check, timeout: float = 3600) -> None:
    # Only terminate the subprocess created by this invocation.
    log_path = cwd / "child.log"
    with log_path.open("ab") as log:
        process = subprocess.Popen(args, cwd=cwd, stdout=log, stderr=log)
        started = time.monotonic()
        try:
            while process.poll() is None:
                check()
                if time.monotonic() - started > timeout:
                    raise PipelineError("PROCESS_TIMEOUT", True)
                time.sleep(0.2)
            if process.returncode:
                raise PipelineError("LOCAL_PROCESS_FAILED")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

def probe(path: Path) -> dict:
    try:
        result = subprocess.run([os.getenv("FFPROBE_PATH", "ffprobe"), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], capture_output=True, timeout=30, check=True)
        data = json.loads(result.stdout)
        streams = data.get("streams", [])
        video = next(s for s in streams if s.get("codec_type") == "video")
        duration = float(data["format"]["duration"])
        width, height = int(video["width"]), int(video["height"])
        if not math.isfinite(duration) or not 0 < duration < 86400 or not 0 < width <= 16384 or not 0 < height <= 16384:
            raise ValueError()
        return {"durationSeconds": duration, "width": width, "height": height, "codec": video.get("codec_name"), "hasAudio": any(s.get("codec_type") == "audio" for s in streams)}
    except Exception:
        raise PipelineError("SOURCE_INVALID") from None
