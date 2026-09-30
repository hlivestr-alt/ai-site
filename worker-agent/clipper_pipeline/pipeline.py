from __future__ import annotations
import importlib.util
import json
import os
import shutil
import sys
import time
from pathlib import Path
from .analyzer import configured_analyzer
from .common import PipelineError, atomic_json, probe, run_child, sha_file
from .rendering import render
from .selection import chunks, rank_candidates, validate_candidate
from .transcription import configuration, fingerprint
from .transfer import download

class ClipperPipeline:
    def run(self, source_options: dict, transcript_options: dict, analyzer_options: dict, render_options: dict, callbacks) -> dict:
        root = callbacks.work
        for folder in ["source", "transcript", "analysis", "render", "outputs", "logs"]:
            (root / folder).mkdir(exist_ok=True)
        settings = {**analyzer_options, **render_options}
        maximum = min(536870912, max(1048576, int(os.getenv("MAX_CLIPPER_OUTPUT_BYTES", "268435456"))))
        source_maximum = min(100 * 1024**3, int(os.getenv("MAX_CLIPPER_SOURCE_BYTES", str(10 * 1024**3))))
        required = source_options["byteSize"] * 2 + maximum * settings["targetClipCount"] + 1024**3
        if required > int(os.getenv("WORKER_MAX_LOCAL_JOB_BYTES", str(40 * 1024**3))) or shutil.disk_usage(root).free < required:
            raise PipelineError("WORKER_DISK_SPACE_LOW")
        callbacks.progress(5, "DOWNLOADING_SOURCE", "Downloading source")
        access = callbacks.source_access()
        source = root / "source" / "original.mp4"
        checksum = download(access["url"], source, source_options["byteSize"], access.get("sha256"), callbacks.check, source_maximum)
        callbacks.progress(12, "VERIFYING_SOURCE", "Verifying source")
        media = probe(source)
        if not media["hasAudio"]:
            raise PipelineError("SOURCE_AUDIO_REQUIRED")
        callbacks.source_verified(checksum, media)
        atomic_json(root / "source" / "verified.json", {"sha256": checksum, "byteSize": source_options["byteSize"], **media})
        state = callbacks.checkpoints()
        expected_hash = state["inputHash"]
        checkpoints = {c["slotName"]: c for c in state["checkpoints"]}
        transcript_path = root / "transcript" / "transcript.json"
        callbacks.progress(20, "TRANSCRIBING", "Transcribing locally")
        if not importlib.util.find_spec("faster_whisper"):
            raise PipelineError("TRANSCRIPTION_MODEL_UNAVAILABLE")
        config = configuration(transcript_options["language"])
        expected_fingerprint = fingerprint(checksum, config)
        if "transcript" in checkpoints:
            self.restore(checkpoints["transcript"], transcript_path, callbacks)
        transcript = self.read_json(transcript_path)
        if not transcript or transcript.get("metadata", {}).get("fingerprint") != expected_fingerprint or transcript.get("sourceAssetId") != source_options["sourceAssetId"] or transcript.get("sourceSha256") != checksum:
            package_root = Path(__file__).resolve().parents[1]
            # Environment is private worker state; child imports only worker-owned modules.
            script = package_root / "transcribe_source.py"
            run_child([sys.executable, str(script), "--source", str(source), "--output", str(transcript_path), "--source-id", source_options["sourceAssetId"], "--sha", checksum, "--duration", str(media["durationSeconds"]), "--language", transcript_options["language"]], root / "transcript", callbacks.check, timeout=12 * 3600)
            transcript = self.read_json(transcript_path)
            if not transcript:
                raise PipelineError("TRANSCRIPT_INVALID")
            callbacks.record("transcription")
        transcript_id = callbacks.publish("transcript", transcript_path, "application/json")
        callbacks.progress(45, "ANALYZING_TRANSCRIPT", "Analyzing transcript")
        plan_path = root / "analysis" / "clip-plan.json"
        if "clip-plan" in checkpoints:
            self.restore(checkpoints["clip-plan"], plan_path, callbacks)
        plan = self.read_json(plan_path)
        if not plan or plan.get("inputHash") != expected_hash or plan.get("sourceSha256") != checksum or plan.get("transcriptFingerprint") != expected_fingerprint:
            analyzer = configured_analyzer(analyzer_options["provider"])
            candidates, models = [], set()
            usage = {"inputTokens": 0, "outputTokens": 0, "requestCount": 0}
            windows = chunks(transcript)
            if not windows:
                raise PipelineError("TRANSCRIPT_EMPTY")
            for window in windows:
                callbacks.check()
                chunk_path = root / "analysis" / f"chunk-{window['index']:04d}.json"
                # Per-chunk checkpoint avoids replaying successful analyzer requests after partial failure.
                chunk_key = fingerprint(expected_hash, {"transcript": expected_fingerprint, "chunk": window, "policy": analyzer_options["policyVersion"], "provider": analyzer_options["provider"], "model": os.getenv("OPENAI_CLIP_MODEL", "fake-transcript-v1")})
                cached = self.read_json(chunk_path)
                response = cached.get("response") if cached and cached.get("key") == chunk_key else None
                if response is None:
                    request = {"transcriptVersion": 3, "language": transcript["language"], "productSnapshot": analyzer_options.get("product"), "goal": settings["goal"], "policyVersion": analyzer_options["policyVersion"], "minClipSeconds": settings["minClipSeconds"], "maxClipSeconds": settings["maxClipSeconds"], "chunk": {k: window[k] for k in ["index", "start", "end", "text"]}}
                    for attempt in range(3):
                        callbacks.check()
                        try:
                            response = analyzer.analyze(request)
                            callbacks.record("analyzer")
                            break
                        except PipelineError as error:
                            if not error.retriable or attempt == 2:
                                raise
                            for _ in range(10 * 2**attempt):
                                callbacks.check()
                                time.sleep(0.2)
                    atomic_json(chunk_path, {"key": chunk_key, "response": response})
                valid = [c for c in (validate_candidate(v, transcript["duration"], settings, window) for v in response["candidates"]) if c]
                if response["candidates"] and not valid:
                    raise PipelineError("ANALYZER_INVALID_CANDIDATES")
                candidates.extend(valid)
                models.add(response["modelVersion"])
                for k in usage:
                    usage[k] += response["usage"].get(k, 0)
            callbacks.progress(57, "SELECTING_MOMENTS", "Selecting moments")
            selected = rank_candidates(candidates, transcript, settings)
            if not selected:
                raise PipelineError("NO_VALID_MOMENTS")
            plan = {"schemaVersion": 1, "sourceAssetId": source_options["sourceAssetId"], "sourceSha256": checksum, "inputHash": expected_hash, "transcriptFingerprint": expected_fingerprint, "transcriptArtifactId": transcript_id, "analyzerPolicyVersion": analyzer_options["policyVersion"], "renderPolicyVersion": render_options["policyVersion"], "analyzerModels": sorted(models), "analyzerProvider": analyzer_options["provider"], "usage": usage, "candidateCount": len(candidates), "requestedClipCount": settings["targetClipCount"], "clips": selected, "pipelineVersion": "clipper-v1"}
        plan["transcriptArtifactId"] = transcript_id
        atomic_json(plan_path, plan)
        plan_id = callbacks.publish("clip-plan", plan_path, "application/json")
        results, artifact_ids = [], [transcript_id, plan_id]
        for index, clip in enumerate(plan["clips"], 1):
            callbacks.check()
            if validate_candidate(clip, transcript["duration"], settings) is None:
                raise PipelineError("PLAN_INVALID")
            slot = f"clip_{index:03d}"
            output = root / "render" / (slot + ".mp4")
            callbacks.progress(60 + int(25 * (index - 1) / len(plan["clips"])), "RENDERING", f"Rendering clip {index} of {len(plan['clips'])}")
            if slot in checkpoints:
                self.restore(checkpoints[slot], output, callbacks)
            local_media = None
            if output.is_file():
                try:
                    local_media = probe(output)
                    if local_media["width"] != 720 or local_media["height"] != 1280 or abs(local_media["durationSeconds"] - (clip["end"] - clip["start"])) > 0.3:
                        local_media = None
                except PipelineError:
                    pass
            if not local_media:
                local_media = render(source, output, clip, transcript, settings["captions"], callbacks.check, maximum)
                callbacks.record("render")
            artifact_id = callbacks.publish(slot, output, "video/mp4")
            artifact_ids.append(artifact_id)
            results.append({**clip, "artifactId": artifact_id, "duration": clip["end"] - clip["start"], "width": local_media["width"], "height": local_media["height"], "sha256": sha_file(output)})
        callbacks.progress(95, "UPLOADING_RESULTS", "Uploading results verified")
        callbacks.progress(99, "FINALIZING", "Finalizing")
        return {"artifactIds": artifact_ids, "transcriptArtifactId": transcript_id, "planArtifactId": plan_id, "clips": results}

    @staticmethod
    def restore(checkpoint: dict, path: Path, callbacks) -> None:
        download(checkpoint["url"], path, checkpoint["byteSize"], checkpoint["sha256"], callbacks.check, 536870912)

    @staticmethod
    def read_json(path: Path):
        try:
            return json.loads(path.read_text(encoding="utf-8")) if path.stat().st_size <= 67108864 else None
        except (OSError, ValueError):
            return None
