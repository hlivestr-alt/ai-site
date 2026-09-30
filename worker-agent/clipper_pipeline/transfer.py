from __future__ import annotations
import hashlib
import http.client
import os
import urllib.parse
import urllib.request
from pathlib import Path
from .common import PipelineError

def transfer_url(url: str):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}):
        raise PipelineError("MEDIA_URL_INVALID")
    return parsed

def download(url: str, path: Path, expected_bytes: int, expected_sha: str | None, check, maximum: int) -> str:
    transfer_url(url)
    if expected_bytes > maximum:
        raise PipelineError("SOURCE_TOO_LARGE")
    if path.is_file() and path.stat().st_size == expected_bytes:
        digest = hashlib.sha256()
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                check()
                digest.update(chunk)
        if expected_sha and digest.hexdigest() == expected_sha:
            return expected_sha
    partial = path.with_suffix(".partial")
    digest, count = hashlib.sha256(), 0
    try:
        with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as file:
            transfer_url(response.geturl())
            while True:
                check()
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > expected_bytes or count > maximum:
                    raise PipelineError("SOURCE_SIZE_MISMATCH")
                file.write(chunk)
                digest.update(chunk)
        checksum = digest.hexdigest()
        if count != expected_bytes or expected_sha and checksum != expected_sha:
            raise PipelineError("SOURCE_CHECKSUM_MISMATCH")
        os.replace(partial, path)
        return checksum
    except PipelineError:
        raise
    except Exception:
        raise PipelineError("SOURCE_DOWNLOAD_FAILED", True) from None

def upload(url: str, path: Path, mime: str, check) -> None:
    parsed = transfer_url(url)
    cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = cls(parsed.hostname, parsed.port, timeout=60)
    target = parsed.path + ("?" + parsed.query if parsed.query else "")
    try:
        check()
        connection.putrequest("PUT", target)
        connection.putheader("Content-Type", mime)
        connection.putheader("Content-Length", str(path.stat().st_size))
        connection.endheaders()
        with path.open("rb") as file:
            while True:
                check()
                chunk = file.read(1024 * 1024)
                if not chunk:
                    break
                connection.send(chunk)
        response = connection.getresponse()
        response.read(16384)
        if not 200 <= response.status < 300:
            raise PipelineError("OUTPUT_UPLOAD_FAILED", True)
    except PipelineError:
        raise
    except Exception:
        raise PipelineError("OUTPUT_UPLOAD_FAILED", True) from None
    finally:
        connection.close()
