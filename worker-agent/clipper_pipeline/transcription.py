"""Minimal extraction of native transcriber._run_faster_whisper_transcription.

Keeps raw word timestamps/schema v3. Excludes canonical native registry,
source paths, fixed language, brand correction, and WhisperX global patches.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import os
import time
from pathlib import Path
from .common import atomic_json

def configuration(language: str) -> dict:
    return {"implementation": "faster-whisper", "version": importlib.metadata.version("faster-whisper"), "model": os.getenv("CLIPPER_WHISPER_MODEL", "large-v3-turbo"), "modelRevision": os.getenv("CLIPPER_WHISPER_REVISION", "installed-local-v1"), "device": os.getenv("CLIPPER_WHISPER_DEVICE", "cuda"), "computeType": os.getenv("CLIPPER_WHISPER_COMPUTE", "float16"), "language": language, "beamSize": 5, "wordTimestamps": True, "schemaVersion": 3, "alignment": "faster-whisper-words"}

def fingerprint(source_sha: str, config: dict) -> str:
    normalized = {**config}
    if "model" in normalized:
        normalized["model"] = Path(normalized["model"]).name
    return hashlib.sha256(json.dumps({"sha256": source_sha, "config": normalized}, sort_keys=True).encode()).hexdigest()

def transcribe(source: Path, output: Path, source_id: str, source_sha: str, duration: float, language: str) -> dict:
    from faster_whisper import WhisperModel
    started = time.monotonic()
    config = configuration(language)
    model = WhisperModel(config["model"], device=config["device"], compute_type=config["computeType"], local_files_only=True)
    segments_iter, info = model.transcribe(str(source), language=None if language == "auto" else language, word_timestamps=True, beam_size=5, best_of=5, vad_filter=True, vad_parameters={"min_silence_duration_ms": 800})
    segments, words = [], []
    for seg in segments_iter:
        start, end = max(0, float(seg.start)), min(duration, float(seg.end))
        if end <= start or not seg.text.strip():
            continue
        timed = [{"word": w.word.strip(), "start": max(start, float(w.start)), "end": min(end, float(w.end))} for w in seg.words or [] if w.start is not None and w.end is not None and w.end > w.start and w.word.strip()]
        timed = [w for w in timed if w["end"] > w["start"]]
        segments.append({"id": len(segments), "start": start, "end": end, "text": seg.text.strip(), "words": timed})
        words.extend(timed)
    if not segments:
        raise ValueError("TRANSCRIPT_EMPTY")
    # Model path is local-only; artifact identity uses basename and pinned revision.
    public_config = {**config, "model": Path(config["model"]).name}
    result = {"schemaVersion": 3, "sourceAssetId": source_id, "sourceSha256": source_sha, "duration": duration, "language": info.language, "segments": segments, "words": words, "metadata": {**public_config, "fingerprint": fingerprint(source_sha, config), "processingSeconds": round(time.monotonic() - started, 3), "sourceDurationSeconds": duration}}
    atomic_json(output, result)
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ["source", "output", "source-id", "sha", "duration", "language"]:
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    transcribe(Path(args.source), Path(args.output), args.source_id, args.sha, float(args.duration), args.language)
