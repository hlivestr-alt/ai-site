from __future__ import annotations
import math
import re
from .common import PipelineError

def chunks(transcript: dict, max_chars: int = 16000, max_seconds: float = 300, overlap_seconds: float = 90) -> list[dict]:
    if max_chars < 64 or max_seconds <= overlap_seconds or overlap_seconds < 0:
        raise ValueError("Invalid chunk policy")
    segments = transcript["segments"]
    result, first = [], 0
    while first < len(segments):
        group, chars, end_index = [], 0, first
        while end_index < len(segments):
            seg = segments[end_index]
            line = f"[{seg['start']:.3f}–{seg['end']:.3f}] {seg['text']}"
            if len(line) > max_chars:
                raise PipelineError("TRANSCRIPT_SEGMENT_TOO_LARGE")
            if group and (chars + len(line) + 1 > max_chars or seg["end"] - group[0]["start"] > max_seconds):
                break
            group.append(seg)
            chars += len(line) + 1
            end_index += 1
        result.append({"index": len(result), "start": group[0]["start"], "end": group[-1]["end"], "segments": group, "text": "\n".join(f"[{s['start']:.3f}–{s['end']:.3f}] {s['text']}" for s in group)})
        if len(result) > 256:
            raise PipelineError("ANALYZER_CHUNK_LIMIT")
        if end_index == len(segments):
            break
        next_index = next((i for i in range(first + 1, end_index) if segments[i]["start"] >= group[-1]["end"] - overlap_seconds), end_index)
        first = max(first + 1, next_index)
    return result

def validate_candidate(value: object, duration: float, settings: dict, chunk: dict | None = None) -> dict | None:
    if not isinstance(value, dict) or set(value) != {"start", "end", "score", "hook", "reason", "tags"}:
        return None
    if any(isinstance(value[k], bool) or not isinstance(value[k], (int, float)) or not math.isfinite(value[k]) for k in ["start", "end", "score"]):
        return None
    start, end = value["start"], value["end"]
    if start < 0 or end <= start or end > duration or not settings["minClipSeconds"] <= end - start <= settings["maxClipSeconds"] or not 0 <= value["score"] <= 100:
        return None
    if chunk and (start < chunk["start"] or end > chunk["end"]):
        return None
    if not isinstance(value["hook"], str) or not 1 <= len(value["hook"]) <= 160 or not isinstance(value["reason"], str) or not 1 <= len(value["reason"]) <= 500:
        return None
    if not isinstance(value["tags"], list) or len(value["tags"]) > 8 or any(not isinstance(t, str) or not 1 <= len(t) <= 40 for t in value["tags"]):
        return None
    return {**value, "start": float(start), "end": float(end), "score": float(value["score"])}

def overlap(a: dict, b: dict) -> float:
    return max(0, min(a["end"], b["end"]) - max(a["start"], b["start"])) / min(a["end"] - a["start"], b["end"] - b["start"])

def rank_candidates(candidates: list[dict], transcript: dict, settings: dict) -> list[dict]:
    # Snap to actual speech boundaries only within 350ms; revalidate all bounds.
    boundaries = sorted({float(w[k]) for w in transcript.get("words", []) for k in ["start", "end"]})
    valid = []
    for candidate in candidates:
        c = validate_candidate(candidate, transcript["duration"], settings)
        if c is None:
            continue
        if boundaries:
            from bisect import bisect_left
            for k in ["start", "end"]:
                index = bisect_left(boundaries, c[k])
                options = boundaries[max(0, index - 1):index + 1]
                if options:
                    nearest = min(options, key=lambda v: abs(v - c[k]))
                    if abs(nearest - c[k]) <= 0.35:
                        proposed = {**c, k: nearest}
                        if validate_candidate(proposed, transcript["duration"], settings):
                            c = proposed
        valid.append(c)
    valid.sort(key=lambda c: (-c["score"], c["start"], c["end"]))
    unique = []
    for c in valid:
        if not any(overlap(c, p) > 0.5 for p in unique):
            unique.append(c)
    chosen = []
    goal_tokens = set(re.findall(r"\w+", settings["goal"].lower()))
    while unique and len(chosen) < settings["targetClipCount"]:
        def priority(c):
            tokens = set(re.findall(r"\w+", (c["hook"] + " " + c["reason"]).lower()))
            relevance = min(5, len(tokens & goal_tokens))
            repeated_tags = sum(bool(set(c["tags"]) & set(p["tags"])) for p in chosen)
            return c["score"] + relevance - repeated_tags * 3
        best = max(unique, key=lambda c: (priority(c), -c["start"]))
        chosen.append(best)
        unique.remove(best)
    return chosen
