"""Bounded native-derived visual controls, rendered against the clean private source.

No user paths, filter expressions, subprocess shell, transcription or analyzer.
"""
from __future__ import annotations
import math
import os
from pathlib import Path
from .common import PipelineError, probe, run_child
from .rendering import ass_time

FONTS = {"sans": "Arial", "display": "Impact", "serif": "Georgia"}
GRADES = {"original": "", "warm": "colortemperature=temperature=7500", "cool": "colortemperature=temperature=5000", "vivid": "eq=saturation=1.3:contrast=1.05", "desaturated": "eq=saturation=0.65:contrast=1.02", "cinematic": "eq=saturation=0.85:contrast=1.15:brightness=-0.02"}
CHOICES = {"textStyle": {"current", "creator_bold_pop", "native_clean", "premium_skincare", "sales_karaoke", "urgency_stack"}, "hookType": {"none", "text"}, "subtitlePosition": {"top", "center", "bottom"}, "subtitleSize": {"compact", "small", "medium", "large"}, "subtitleFont": set(FONTS), "hookFont": set(FONTS), "colorGrade": set(GRADES)}
TOGGLES = {"subtitleEnabled", "highlightEnabled", "phraseCaptions", "mirror", "letterboxEnabled", "topHookEnabled"}
BOUNDS = {"subtitleY": (.08, .92), "topBar": (0, .4), "bottomBar": (0, .4), "hookSize": (24, 160), "hookX": (0, 1), "hookY": (0, 1)}
COLORS = {"fontColor", "highlightColor", "hookColor"}

def validate_settings(settings: dict) -> dict:
    import re
    if not isinstance(settings, dict) or set(settings) != set(CHOICES) | TOGGLES | set(BOUNDS) | COLORS | {"name"}:
        raise PipelineError("VARIATION_INPUT_INVALID")
    if not isinstance(settings["name"], str) or len(settings["name"]) > 80 or any(ord(c) < 32 or ord(c) == 127 for c in settings["name"]):
        raise PipelineError("VARIATION_INPUT_INVALID")
    for key, values in CHOICES.items():
        if not isinstance(settings[key], str) or settings[key] not in values:
            raise PipelineError("VARIATION_INPUT_INVALID")
    for key in TOGGLES:
        if not isinstance(settings[key], bool):
            raise PipelineError("VARIATION_INPUT_INVALID")
    for key, (minimum, maximum) in BOUNDS.items():
        value = settings[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
            raise PipelineError("VARIATION_INPUT_INVALID")
    for key in COLORS:
        if not isinstance(settings[key], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", settings[key]):
            raise PipelineError("VARIATION_INPUT_INVALID")
    if int(settings["hookSize"]) != settings["hookSize"] or settings["topHookEnabled"] and (not settings["letterboxEnabled"] or settings["topBar"] < .05 or settings["hookType"] != "text"):
        raise PipelineError("VARIATION_INPUT_INVALID")
    return settings

def clean_text(value: str) -> str:
    return str(value).replace("\\", "").replace("{", "").replace("}", "").replace("\r", " ").replace("\n", " ")[:16000]

def ass_color(color: str) -> str:
    return "&H00" + color[5:7] + color[3:5] + color[1:3]

def subtitle_file(path: Path, transcript: dict, clip: dict, settings: dict) -> None:
    s = validate_settings(settings)
    start, end = float(clip["start"]), float(clip["end"])
    size = {"compact": 48, "small": 64, "medium": 80, "large": 96}[s["subtitleSize"]]
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{FONTS[s['subtitleFont']]},{size},{ass_color(s['fontColor'])},{ass_color(s['highlightColor'])},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,0,1
Style: Hook,{FONTS[s['hookFont']]},{round(s['hookSize']*2/3)},{ass_color(s['hookColor'])},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    if s["subtitleEnabled"]:
        words = transcript.get("words") or [{"word": v["text"], "start": v["start"], "end": v["end"]} for v in transcript.get("segments", [])]
        groups, group = [], []
        for word in words:
            if not isinstance(word, dict) or not isinstance(word.get("word"), str) or not all(isinstance(word.get(k), (int, float)) and not isinstance(word[k], bool) and math.isfinite(word[k]) for k in ("start", "end")) or word["end"] <= word["start"]:
                raise PipelineError("VARIATION_INPUT_INVALID")
            if word["end"] <= start or word["start"] >= end:
                continue
            if group and (len(group) >= 6 or sum(len(w["word"]) + 1 for w in group) + len(word["word"]) > 38):
                groups.append(group)
                group = []
            group.append(word)
        if group:
            groups.append(group)
        position = f"{{\\an5\\pos(360,{round(1280*s['subtitleY'])})}}"
        for group in groups:
            a, b = max(0, group[0]["start"]-start), min(end-start, group[-1]["end"]-start)
            if b <= a:
                continue
            if s["highlightEnabled"] and not s["phraseCaptions"] and transcript.get("words"):
                # Each span uses actual frozen word timings. Never estimate alignment.
                cuts = sorted({a, b, *[max(a, min(b, float(w[k])-start)) for w in group for k in ("start", "end")]})
                for left, right in zip(cuts, cuts[1:]):
                    if right <= left:
                        continue
                    moment = start + (left+right)/2
                    text = " ".join((f"{{\\c{ass_color(s['highlightColor'])}}}" if w["start"] <= moment < w["end"] else f"{{\\c{ass_color(s['fontColor'])}}}") + clean_text(w["word"]) for w in group)
                    lines.append(f"Dialogue: 0,{ass_time(left)},{ass_time(right)},Default,,0,0,0,,{position}{text}")
            else:
                text = clean_text(" ".join(w["word"] for w in group))
                lines.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Default,,0,0,0,,{position}{text}")
    if s["hookType"] == "text" and clip.get("hook"):
        if s["topHookEnabled"]:
            x, y, duration = round(720*s["hookX"]), round(1280*s["topBar"]*s["hookY"]), end-start
        else:
            x, y, duration = 360, 130, min(3, end-start)
        text = clean_text(clip["hook"])
        lines.append(f"Dialogue: 1,{ass_time(0)},{ass_time(duration)},Hook,,0,0,0,,{{\\an5\\pos({x},{y})}}{text}")
    path.write_text(header + "\n".join(lines), encoding="utf-8")

def render_variation(source: Path, output: Path, clip: dict, transcript: dict, settings: dict, check, maximum: int) -> dict:
    s = validate_settings(settings)
    duration = clip["end"]-clip["start"]
    if not math.isfinite(duration) or not 0 < duration <= 90:
        raise PipelineError("VARIATION_INPUT_INVALID")
    filters = ["scale=720:1280:force_original_aspect_ratio=increase", "crop=720:1280", "setsar=1", "fps=30"]
    if s["mirror"]:
        filters.append("hflip")
    if GRADES[s["colorGrade"]]:
        filters.append(GRADES[s["colorGrade"]])
    if s["letterboxEnabled"]:
        for y, height in ((0, round(1280*s["topBar"])), (round(1280*(1-s["bottomBar"])), round(1280*s["bottomBar"]))):
            if height:
                filters.append(f"drawbox=x=0:y={y}:w=iw:h={height}:color=black:t=fill")
    subtitle = output.with_suffix(".ass")
    subtitle_file(subtitle, transcript, clip, s)
    filters.append(f"ass={subtitle.name}")
    partial = output.with_suffix(".partial.mp4")
    run_child([os.getenv("FFMPEG_PATH", "ffmpeg"), "-nostdin", "-y", "-ss", f"{clip['start']:.6f}", "-i", str(source), "-t", f"{duration:.6f}", "-map", "0:v:0", "-map", "0:a:0", "-vf", ",".join(filters), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-fs", str(maximum), str(partial)], output.parent, check, timeout=600)
    media = probe(partial)
    if media["width"] != 720 or media["height"] != 1280 or media["codec"] != "h264" or not media["hasAudio"] or abs(media["durationSeconds"]-duration) > .3 or not 0 < partial.stat().st_size < maximum:
        raise PipelineError("RENDER_INVALID")
    os.replace(partial, output)
    return media
