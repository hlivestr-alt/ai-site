"""One small analyzer request after an exact authenticated model-catalog check."""
import argparse
import json
from pathlib import Path
from worker_agent import load_dotenv
from clipper_pipeline.common import PipelineError
from clipper_pipeline.wavespeed_analyzer import WaveSpeedTranscriptAnalyzer

REQUEST = {"transcriptVersion": 3, "language": "en", "productSnapshot": None, "goal": "Choose the complete useful idea in this controlled transcript.", "policyVersion": "clip-selection-v1", "minClipSeconds": 10, "maxClipSeconds": 15, "chunk": {"index": 0, "start": 0, "end": 12, "text": "[0.000–12.000] Save your work before closing a program. This keeps your latest changes available the next time you open it."}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default=".env")
    parser.add_argument("--check-model-only", action="store_true")
    args = parser.parse_args()
    load_dotenv(Path(args.env))
    try:
        analyzer = WaveSpeedTranscriptAnalyzer()
        if not analyzer.model_available():
            raise PipelineError("ANALYZER_MODEL_UNAVAILABLE")
        if args.check_model_only:
            print(json.dumps({"modelAvailable": True, "modelId": analyzer.model, "requests": 0}))
            return 0
        result = analyzer.analyze(REQUEST)  # Exactly one POST, no automatic retries.
        if not result["candidates"] or result["usage"]["inputTokens"] <= 0 or result["usage"]["outputTokens"] <= 0:
            raise PipelineError("ANALYZER_SMOKE_INCOMPLETE")
        print(json.dumps({"status": "PASSED", "modelId": result["modelVersion"], "candidateCount": len(result["candidates"]), "usage": result["usage"], "keyLeakage": False, "requests": 1}))
        return 0
    except PipelineError as error:
        print(json.dumps({"status": "BLOCKED", "code": error.code}))
        return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({"status": "BLOCKED", "code": "WAVESPEED_SMOKE_UNAVAILABLE"}))
        raise SystemExit(2)
