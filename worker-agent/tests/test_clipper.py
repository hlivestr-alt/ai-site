import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from clipper_pipeline.analyzer import FakeTranscriptAnalyzer, OpenAITranscriptAnalyzer, configured_analyzer
from clipper_pipeline.common import PipelineError, atomic_json
from clipper_pipeline.selection import chunks, rank_candidates, validate_candidate
from clipper_pipeline.pipeline import ClipperPipeline
from clipper_pipeline.transcription import fingerprint
from clipper_pipeline.rendering import captions

SETTINGS = {"targetClipCount": 2, "minClipSeconds": 10, "maxClipSeconds": 30, "goal": "useful idea"}
TRANSCRIPT = {"schemaVersion": 3, "sourceAssetId": "fixture-source", "sourceSha256": "a" * 64, "duration": 40.0, "language": "en", "segments": [{"start": i, "end": i + 5, "text": "A useful idea for this fixture."} for i in range(0, 40, 5)], "words": []}

class SelectionTests(unittest.TestCase):
    def test_chunk_budgets_overlap_absolute_times_and_coverage(self):
        transcript = {**TRANSCRIPT, "duration": 400, "segments": [{"start": i, "end": i + 5, "text": "word " * 20} for i in range(0, 400, 5)]}
        windows = chunks(transcript, max_chars=1000, max_seconds=60, overlap_seconds=20)
        self.assertTrue(all(len(c["text"]) < 1000 and c["end"] - c["start"] <= 60 for c in windows))
        self.assertEqual({s["start"] for c in windows for s in c["segments"]}, set(range(0, 400, 5)))
        self.assertTrue(any(a["end"] > b["start"] for a, b in zip(windows, windows[1:])))
        self.assertGreater(windows[-1]["start"], 0)

    def candidate(self):
        return {"start": 0, "end": 12, "score": 90, "hook": "Useful idea", "reason": "A complete thought.", "tags": ["idea"]}

    def test_invalid_analyzer_fields_rejected_before_ffmpeg(self):
        for change in [{"start": -1}, {"end": 0}, {"end": 41}, {"score": 101}, {"score": float("nan")}, {"hook": "x" * 161}, {"reason": "x" * 501}, {"tags": ["x" * 41]}, {"start": True}, {"end": 5}]:
            self.assertIsNone(validate_candidate({**self.candidate(), **change}, 40, SETTINGS))

    def test_global_dedupe_and_ranking_do_not_fabricate(self):
        first = self.candidate()
        duplicate = {**first, "start": 1, "end": 13, "score": 80}
        second = {**first, "start": 20, "end": 32, "score": 95, "tags": ["reaction"]}
        chosen = rank_candidates([first, duplicate, second], TRANSCRIPT, {**SETTINGS, "targetClipCount": 10})
        self.assertEqual(len(chosen), 2)
        self.assertEqual(chosen[0]["start"], 20)

    def test_fake_provider_exercises_chunk_candidate_pipeline(self):
        c = chunks(TRANSCRIPT)[0]
        result = FakeTranscriptAnalyzer().analyze({"chunk": c, **SETTINGS})
        self.assertEqual(result["modelVersion"], "fake-transcript-v1")
        self.assertTrue(all(validate_candidate(v, 40, SETTINGS, c) for v in result["candidates"]))
        self.assertEqual(len(rank_candidates(result["candidates"], TRANSCRIPT, SETTINGS)), 2)

    def test_no_implicit_provider_fallback(self):
        with patch.dict("os.environ", {"CLIP_ANALYZER_PROVIDER": "", "ENABLE_FAKE_CLIP_ANALYZER": "1"}):
            with self.assertRaises(PipelineError):
                configured_analyzer("openai")

    def test_openai_responses_strict_schema_no_video(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, maximum): return json.dumps({"status": "completed", "model": "configured-model", "usage": {"input_tokens": 10, "output_tokens": 5}, "output": [{"type": "message", "content": [{"type": "output_text", "text": '{"candidates":[]}'}]}]}).encode()
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-only-secret", "OPENAI_CLIP_MODEL": "configured-model"}), patch("urllib.request.urlopen", return_value=Response()) as call:
            result = OpenAITranscriptAnalyzer().analyze({"chunk": {"text": "[0–12] An idea"}})
            data = json.loads(call.call_args.args[0].data)
            self.assertEqual(call.call_args.args[0].full_url, "https://api.openai.com/v1/responses")
            self.assertTrue(data["text"]["format"]["strict"])
            self.assertFalse(data["store"])
            self.assertNotIn("test-only-secret", json.dumps(data))
            self.assertEqual(result["usage"]["inputTokens"], 10)

    def test_caption_timing_is_relative_and_text_is_escaped(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "captions.ass"
            captions(path, {**TRANSCRIPT, "words": [{"start": 20, "end": 22, "word": "{\\bad} useful"}]}, 20, 30)
            text = path.read_text()
            self.assertIn("0:00:00.00,0:00:02.00", text)
            self.assertNotIn("{\\bad}", text)

class PipelineRecoveryTests(unittest.TestCase):
    def test_upload_failure_reuses_local_transcript_plan_and_render(self):
        class Callbacks:
            def __init__(self, work): self.work, self.counts, self.failed = work, {}, False
            def check(self): pass
            def progress(self, *args): pass
            def source_access(self): return {"url": "https://fixture.invalid/source", "sha256": "a" * 64}
            def source_verified(self, *args): pass
            def checkpoints(self): return {"inputHash": "input", "checkpoints": []}
            def publish(self, slot, path, mime):
                if slot == "clip_001" and not self.failed:
                    self.failed = True
                    raise PipelineError("OUTPUT_UPLOAD_FAILED", True)
                return slot + "-artifact"
            def record(self, stage): self.counts[stage] = self.counts.get(stage, 0) + 1
        config = {"model": "fixture", "schemaVersion": 3}
        transcript = {**TRANSCRIPT, "metadata": {"fingerprint": fingerprint("a" * 64, config)}}
        def fake_download(url, path, *args): path.write_bytes(b"source"); return "a" * 64
        def fake_transcription(args, cwd, check, timeout): atomic_json(Path(args[args.index("--output") + 1]), transcript)
        def fake_render(source, output, clip, *args): output.write_bytes(b"render"); return {"width": 720, "height": 1280, "durationSeconds": clip["end"] - clip["start"]}
        media = {"width": 720, "height": 1280, "durationSeconds": 40.0, "hasAudio": True}
        with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"CLIP_ANALYZER_PROVIDER": "fake", "ENABLE_FAKE_CLIP_ANALYZER": "1"}), patch("clipper_pipeline.pipeline.configuration", return_value=config), patch("clipper_pipeline.pipeline.download", side_effect=fake_download), patch("clipper_pipeline.pipeline.run_child", side_effect=fake_transcription), patch("clipper_pipeline.pipeline.render", side_effect=fake_render), patch("clipper_pipeline.pipeline.probe", side_effect=lambda p: media if p.name == "original.mp4" else {**media, "durationSeconds": 10}):
            cb = Callbacks(Path(folder))
            args = ({"sourceAssetId": "fixture-source", "byteSize": 6}, {"language": "en"}, {**SETTINGS, "provider": "fake", "policyVersion": "clip-selection-v1"}, {"captions": True, "policyVersion": "vertical-h264-v1"}, cb)
            with self.assertRaises(PipelineError): ClipperPipeline().run(*args)
            manifest = ClipperPipeline().run(*args)
            self.assertEqual(len(manifest["clips"]), 2)
            self.assertEqual(cb.counts, {"transcription": 1, "analyzer": 1, "render": 2})

if __name__ == "__main__": unittest.main()
