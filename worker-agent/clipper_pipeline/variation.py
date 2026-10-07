"""Render-only durable variation executor. Reuses sealed inputs, never analyzes."""
from __future__ import annotations
import json
import os
import shutil
from .common import PipelineError, atomic_json, probe, sha_file
from .pipeline import ClipperPipeline
from .transfer import download
from .variation_rendering import render_variation, validate_settings

class VariationPipeline:
    def run(self, inputs: dict, callbacks) -> dict:
        root, source_options, lineage = callbacks.work, inputs["source"], inputs["lineage"]
        settings = validate_settings(inputs["settings"])
        for name in ("source", "transcript", "analysis", "render", "outputs", "logs"):
            (root / name).mkdir(exist_ok=True)
        maximum = min(536870912, max(1048576, int(os.getenv("MAX_CLIPPER_OUTPUT_BYTES", "268435456"))))
        required = source_options["byteSize"]*2 + maximum + 1024**3
        if required > int(os.getenv("WORKER_MAX_LOCAL_JOB_BYTES", str(40*1024**3))) or shutil.disk_usage(root).free < required:
            raise PipelineError("WORKER_DISK_SPACE_LOW")
        callbacks.progress(5, "PREPARING_EDIT", "Preparing edit")
        access = callbacks.source_access()
        source = root / "source" / "original.mp4"
        checksum = download(access["url"], source, source_options["byteSize"], source_options["sha256"], callbacks.check, int(os.getenv("MAX_CLIPPER_SOURCE_BYTES", str(10*1024**3))))
        media = probe(source)
        callbacks.source_verified(checksum, media)
        reuse = callbacks.post("variation-inputs", {})["inputs"]
        support = {}
        for item in reuse:
            if item["slotName"] not in ("transcript", "clip-plan"):
                raise PipelineError("VARIATION_INPUT_INVALID")
            target = root / ("transcript" if item["slotName"] == "transcript" else "analysis") / (item["slotName"] + ".json")
            expected = lineage["transcriptSha256" if item["slotName"] == "transcript" else "planSha256"]
            if item["sha256"] != expected:
                raise PipelineError("VARIATION_INPUT_INVALID")
            download(item["url"], target, item["byteSize"], expected, callbacks.check, 67108864)
            support[item["slotName"]] = json.loads(target.read_text(encoding="utf-8"))
        transcript, original_plan, clip = support["transcript"], support["clip-plan"], lineage["clip"]
        fields = ("start", "end", "score", "hook", "reason", "tags")
        if transcript.get("sourceSha256") != checksum or original_plan.get("sourceSha256") != checksum or not any(all(c.get(k) == clip.get(k) for k in fields) for c in original_plan.get("clips", [])) or not 0 <= clip["start"] < clip["end"] <= media["durationSeconds"]+.05:
            raise PipelineError("VARIATION_INPUT_INVALID")
        state = callbacks.checkpoints()
        # A sealed per-job copy preserves existing Content FK/retention contracts.
        # Bytes and checksum are identical to the frozen original transcript.
        transcript_id = callbacks.publish("transcript", root / "transcript" / "transcript.json", "application/json")
        plan = {"schemaVersion":1, "sourceAssetId":source_options["sourceAssetId"], "sourceSha256":checksum, "inputHash":state["inputHash"], "transcriptArtifactId":transcript_id, "analyzerPolicyVersion":inputs["analyzerPolicyVersion"], "renderPolicyVersion":inputs["variationPolicyVersion"], "rootJobId":lineage["rootJobId"], "settings":settings, "settingsHash":inputs["settingsHash"], "reusedAnalysis":True, "transcriptionCalls":0, "analyzerCalls":0, "clips":[{k:clip[k] for k in fields}], "pipelineVersion":"clipper-variation-v1"}
        plan_path = root / "analysis" / "variation-plan.json"
        atomic_json(plan_path, plan)
        plan_id = callbacks.publish("clip-plan", plan_path, "application/json")
        callbacks.progress(30, "RENDERING_VARIATION", "Rendering variation")
        output = root / "render" / "clip_001.mp4"
        checkpoint = next((c for c in state["checkpoints"] if c["slotName"] == "clip_001"), None)
        rendered = None
        if checkpoint:
            ClipperPipeline.restore(checkpoint, output, callbacks)
            rendered = probe(output)
            if rendered["width"] != 720 or rendered["height"] != 1280 or abs(rendered["durationSeconds"]-clip["duration"]) > .3:
                raise PipelineError("RENDER_INVALID")
        if not rendered:
            rendered = render_variation(source, output, clip, transcript, settings, callbacks.check, maximum)
            callbacks.record("render")
        callbacks.progress(85, "UPLOADING_VARIATION", "Saving variation")
        artifact_id = callbacks.publish("clip_001", output, "video/mp4")
        callbacks.progress(99, "FINALIZING_VARIATION", "Finishing variation")
        result = {**{k:clip[k] for k in fields}, "artifactId":artifact_id, "duration":clip["duration"], "width":720, "height":1280, "sha256":sha_file(output)}
        return {"artifactIds":[transcript_id,plan_id,artifact_id], "transcriptArtifactId":transcript_id, "planArtifactId":plan_id, "clips":[result]}
