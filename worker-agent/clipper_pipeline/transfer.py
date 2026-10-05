from __future__ import annotations
import hashlib
import http.client
import os
import urllib.parse
import urllib.request
from pathlib import Path
from .common import PipelineError


def transfer_url(url: str) -> urllib.parse.ParseResult:
    try:
        if not isinstance(url, str) or any(c.isspace() or ord(c) < 32 for c in url):
            raise ValueError()
        parsed = urllib.parse.urlparse(url)
        valid = bool(parsed.hostname) and parsed.port != 0 and not parsed.username and not parsed.password and not parsed.fragment
        valid = valid and (parsed.scheme == "https" or (
            parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        ))
    except ValueError:
        valid = False
    if not valid:
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

        checksum = digest.hexdigest()

        if not expected_sha or checksum == expected_sha:
            return checksum

    partial = path.with_suffix(".partial")
    digest = hashlib.sha256()
    count = 0

    # Signed private-storage transfers must not inherit machine/browser proxies.
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({})
    )

    try:
        with opener.open(url, timeout=60) as response, partial.open("wb") as file:
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

        # Premature EOF/network truncation is retriable.
        if count < expected_bytes:
            raise PipelineError("SOURCE_DOWNLOAD_FAILED", True)

        checksum = digest.hexdigest()

        # Only call it a checksum mismatch when we actually had an expected SHA
        # and received the expected number of bytes.
        if expected_sha and checksum != expected_sha:
            raise PipelineError("SOURCE_CHECKSUM_MISMATCH")

        os.replace(partial, path)
        return checksum

    except PipelineError:
        raise

    except Exception:
        raise PipelineError("SOURCE_DOWNLOAD_FAILED", True) from None
    finally:
        # Failed/cancelled attempts never publish partial bytes as the final file.
        try:
            partial.unlink(missing_ok=True)
        except OSError:
            pass

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
