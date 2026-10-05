import hashlib
import http.client
import io
import os
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from clipper_pipeline.common import PipelineError
from clipper_pipeline.transfer import download, transfer_url, upload


URL = "https://storage.example.test/private/source.mp4?X-Amz-Signature=synthetic-signature&X-Amz-Credential=synthetic-credential"
DATA = b"synthetic source bytes" * 100
SHA = hashlib.sha256(DATA).hexdigest()
MAXIMUM = 8 * 1024 * 1024


class Response(io.BytesIO):
    def __init__(self, data=DATA, url=URL):
        super().__init__(data)
        self.url = url

    def geturl(self):
        return self.url


class TransferURLTests(unittest.TestCase):
    def test_signed_https_url_is_preserved(self):
        parsed = transfer_url(URL)
        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.geturl(), URL)

    def test_loopback_http_urls_are_accepted(self):
        for url in ["http://127.0.0.1:9000/source.mp4?signature=fixture", "http://localhost/source.mp4"]:
            with self.subTest(url=url):
                self.assertEqual(transfer_url(url).scheme, "http")

    def test_nonloopback_http_is_rejected(self):
        for url in ["http://storage.example.test/media", "http://127.0.0.2/media", "http://localhost.example.test/media", "http://[::1]/media"]:
            with self.subTest(url=url), self.assertRaises(PipelineError) as caught:
                transfer_url(url)
            self.assertEqual(caught.exception.code, "MEDIA_URL_INVALID")
            self.assertFalse(caught.exception.retriable)

    def test_malformed_and_unsupported_urls_fail_without_echoing_url(self):
        for url in ["", "media.mp4", "file:///private/media.mp4", "ftp://storage.example.test/media",
                    "https://", "https:///media", "https://[invalid/media", "https://host:bad/media",
                    "https://host:70000/media", "https://host:0/media", "https://user:secret@host/media",
                    "https://host/media#secret", "https://host/\nmedia", None]:
            with self.subTest(case=type(url).__name__), self.assertRaises(PipelineError) as caught:
                transfer_url(url)
            self.assertEqual(str(caught.exception), "MEDIA_URL_INVALID")


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "original.mp4"
        self.partial = self.path.with_suffix(".partial")

    def transfer(self, data=DATA, expected_bytes=len(DATA), expected_sha=SHA, check=lambda: None, url=URL):
        with patch("urllib.request.OpenerDirector.open", return_value=Response(data)):
            return download(url, self.path, expected_bytes, expected_sha, check, MAXIMUM)

    def assert_failure(self, code, retriable, **args):
        with self.assertRaises(PipelineError) as caught:
            self.transfer(**args)
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(caught.exception.retriable, retriable)
        self.assertFalse(self.path.exists())
        self.assertFalse(self.partial.exists())
        self.assertNotIn("synthetic-signature", str(caught.exception))

    def test_exact_size_and_correct_hash_atomically_publish_final(self):
        self.partial.write_bytes(b"previous interrupted attempt")
        self.assertEqual(self.transfer(), SHA)
        self.assertEqual(self.path.read_bytes(), DATA)
        self.assertFalse(self.partial.exists())

    def test_premature_eof_is_retriable_before_checksum_validation(self):
        self.assert_failure("SOURCE_DOWNLOAD_FAILED", True, data=DATA[:100], expected_sha="0" * 64)

    def test_reported_production_byte_counts_are_classified_as_truncation(self):
        self.assert_failure("SOURCE_DOWNLOAD_FAILED", True, data=b"x" * 207898, expected_bytes=6566047,
                            expected_sha="529f97bc272ad1e4c9159b9619b0f119d6fdfd8d2ea0afe11f1af7e1f484ba51")

    def test_oversized_response_is_permanent_size_mismatch(self):
        self.assert_failure("SOURCE_SIZE_MISMATCH", False, data=DATA + b"overflow")

    def test_exact_size_and_wrong_hash_is_permanent_checksum_mismatch(self):
        self.assert_failure("SOURCE_CHECKSUM_MISMATCH", False, expected_sha="0" * 64)

    def test_no_expected_hash_returns_computed_hash(self):
        self.assertEqual(self.transfer(expected_sha=None), SHA)
        self.assertEqual(self.path.read_bytes(), DATA)

    def test_verified_cached_final_is_reused_with_or_without_expected_hash(self):
        self.path.write_bytes(DATA)
        with patch("urllib.request.build_opener") as opener:
            for expected_sha in [SHA, None]:
                self.assertEqual(download(URL, self.path, len(DATA), expected_sha, lambda: None, MAXIMUM), SHA)
            opener.assert_not_called()

    def test_failed_replacement_preserves_existing_final_and_removes_partial(self):
        original = b"existing final must survive failure"
        self.path.write_bytes(original)
        with self.assertRaises(PipelineError):
            self.transfer(data=DATA[:100])
        self.assertEqual(self.path.read_bytes(), original)
        self.assertFalse(self.partial.exists())

    def test_failure_to_publish_is_retriable_and_preserves_existing_final(self):
        self.path.write_bytes(b"old final")
        with patch("clipper_pipeline.transfer.os.replace", side_effect=OSError(URL)), self.assertRaises(PipelineError) as caught:
            self.transfer()
        self.assertEqual(caught.exception.code, "SOURCE_DOWNLOAD_FAILED")
        self.assertTrue(caught.exception.retriable)
        self.assertEqual(self.path.read_bytes(), b"old final")
        self.assertFalse(self.partial.exists())

    def test_interrupted_read_is_retriable_and_removes_partial(self):
        response = Response()
        with patch.object(response, "read", side_effect=[DATA[:100], http.client.IncompleteRead(b"truncated", len(DATA))]), patch("urllib.request.OpenerDirector.open", return_value=response), self.assertRaises(PipelineError) as caught:
            download(URL, self.path, len(DATA), SHA, lambda: None, MAXIMUM)
        self.assertEqual(caught.exception.code, "SOURCE_DOWNLOAD_FAILED")
        self.assertTrue(caught.exception.retriable)
        self.assertFalse(self.path.exists())
        self.assertFalse(self.partial.exists())

    def test_cancelled_or_fenced_download_retains_pipeline_error(self):
        def fenced():
            raise PipelineError("LEASE_FENCED")
        self.assert_failure("LEASE_FENCED", False, check=fenced)

    def test_source_limit_fails_before_network(self):
        with patch("urllib.request.build_opener") as opener, self.assertRaises(PipelineError) as caught:
            download(URL, self.path, MAXIMUM + 1, None, lambda: None, MAXIMUM)
        self.assertEqual(caught.exception.code, "SOURCE_TOO_LARGE")
        opener.assert_not_called()

    def test_invalid_url_fails_before_network_for_download_and_upload(self):
        with patch("urllib.request.build_opener") as opener, patch("http.client.HTTPConnection") as connection:
            for operation in [lambda: download("http://foreign.test/source", self.path, len(DATA), SHA, lambda: None, MAXIMUM),
                              lambda: upload("http://foreign.test/output", self.path, "video/mp4", lambda: None)]:
                with self.assertRaises(PipelineError) as caught:
                    operation()
                self.assertEqual(caught.exception.code, "MEDIA_URL_INVALID")
            opener.assert_not_called()
            connection.assert_not_called()

    def test_unsafe_redirect_is_rejected_before_final_publication(self):
        with patch("urllib.request.OpenerDirector.open", return_value=Response(url="http://foreign.test/source")), self.assertRaises(PipelineError) as caught:
            download(URL, self.path, len(DATA), SHA, lambda: None, MAXIMUM)
        self.assertEqual(caught.exception.code, "MEDIA_URL_INVALID")
        self.assertFalse(self.path.exists())
        self.assertFalse(self.partial.exists())

    def test_media_opener_bypasses_proxies_without_changing_global_api_opener(self):
        proxy = "http://localhost:15236"
        original_opener = urllib.request._opener
        build_opener = urllib.request.build_opener
        with patch.dict(os.environ, {"HTTP_PROXY": proxy, "HTTPS_PROXY": proxy}), patch("urllib.request.getproxies", side_effect=AssertionError("media must not consult process proxies")), patch("urllib.request.build_opener", wraps=build_opener) as builder, patch("urllib.request.OpenerDirector.open", return_value=Response()) as opened, patch("urllib.request.urlopen", side_effect=AssertionError("media must use its direct opener")) as global_api:
            self.assertEqual(download(URL, self.path, len(DATA), SHA, lambda: None, MAXIMUM), SHA)
            self.assertIsInstance(builder.call_args.args[0], urllib.request.ProxyHandler)
            self.assertEqual(builder.call_args.args[0].proxies, {})
            opened.assert_called_once_with(URL, timeout=60)
            global_api.assert_not_called()
            self.assertEqual(os.environ["HTTPS_PROXY"], proxy)
            self.assertIs(urllib.request._opener, original_opener)


class LocalHTTPTransferTests(unittest.TestCase):
    def test_real_loopback_http_full_and_truncated_sources(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = DATA if self.path == "/full" else DATA[:100]
                self.send_response(200)
                self.send_header("Content-Length", str(len(DATA)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                base = f"http://127.0.0.1:{server.server_port}"
                path = Path(folder) / "original.mp4"
                self.assertEqual(download(base + "/full", path, len(DATA), SHA, lambda: None, MAXIMUM), SHA)
                failed = Path(folder) / "truncated.mp4"
                with self.assertRaises(PipelineError) as caught:
                    download(base + "/short", failed, len(DATA), SHA, lambda: None, MAXIMUM)
                self.assertEqual(caught.exception.code, "SOURCE_DOWNLOAD_FAILED")
                self.assertTrue(caught.exception.retriable)
                self.assertFalse(failed.exists())
                self.assertFalse(failed.with_suffix(".partial").exists())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
