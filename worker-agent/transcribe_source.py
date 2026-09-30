"""Subprocess entry point; isolates model loading and cancellation per Job."""
import runpy
if __name__ == "__main__":
    runpy.run_module("clipper_pipeline.transcription", run_name="__main__")
