"""Extracted native cut/probe and clip-relative caption timing concepts.

Uses CPU H.264 to avoid native global NVENC state, assets and brand overlays.
"""
from __future__ import annotations
import os
from pathlib import Path
from .common import PipelineError, probe, run_child

def ass_time(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    return f"{centiseconds // 360000}:{centiseconds // 6000 % 60:02d}:{centiseconds // 100 % 60:02d}.{centiseconds % 100:02d}"

def captions(path: Path, transcript: dict, start: float, end: float) -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,42,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,45,45,180,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    # Group actual timed words, at most six and 38 visible characters.
    words = [w for w in transcript.get("words", []) if w["end"] > start and w["start"] < end]
    if not words:
        words = [{"word": s["text"], "start": s["start"], "end": s["end"]} for s in transcript["segments"] if s["end"] > start and s["start"] < end]
    groups, group = [], []
    for word in words:
        if group and (len(group) >= 6 or len(" ".join(w["word"] for w in group)) + len(word["word"]) > 38):
            groups.append(group)
            group = []
        group.append(word)
    if group:
        groups.append(group)
    lines = []
    for group in groups:
        text = " ".join(w["word"] for w in group).replace("\\", "").replace("{", "").replace("}", "").replace("\n", " ").replace("\r", " ")
        a, b = max(0, group[0]["start"] - start), min(end - start, group[-1]["end"] - start)
        if b > a:
            lines.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Default,,0,0,0,,{text}")
    path.write_text(header + "\n".join(lines), encoding="utf-8")

def render(source: Path, output: Path, clip: dict, transcript: dict, enabled: bool, check, maximum: int) -> dict:
    duration = clip["end"] - clip["start"]
    filters = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30"
    if enabled:
        subtitle = output.with_suffix(".ass")
        captions(subtitle, transcript, clip["start"], clip["end"])
        # Relative, server-approved basename avoids Windows drive/path filter escaping.
        filters += f",ass={subtitle.name}"
    partial = output.with_suffix(".partial.mp4")
    run_child([os.getenv("FFMPEG_PATH", "ffmpeg"), "-nostdin", "-y", "-ss", f"{clip['start']:.6f}", "-i", str(source), "-t", f"{duration:.6f}", "-map", "0:v:0", "-map", "0:a:0", "-vf", filters, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-fs", str(maximum), str(partial)], output.parent, check, timeout=600)
    media = probe(partial)
    if media["width"] != 720 or media["height"] != 1280 or media["codec"] != "h264" or abs(media["durationSeconds"] - duration) > 0.3 or not 0 < partial.stat().st_size < maximum:
        raise PipelineError("RENDER_INVALID")
    os.replace(partial, output)
    return media
