"""Explicit isolated Phase D fault injection. Never imported by deployed workers."""
import os
import sys
import time
import subprocess
from pathlib import Path
from urllib.parse import urlparse

if os.getenv('PHASE_D_PROCESS_TEST') == '1':
    import re
    origin = urlparse(os.getenv('SAAS_BASE_URL', ''))
    if not (os.getenv('STABILIZATION_RUN_ID') and os.getenv('DATABASE_URL') == os.getenv('TEST_DATABASE_URL') and re.fullmatch(r'/phase_[de]_[0-9]+_[a-f0-9]+', urlparse(os.getenv('DATABASE_URL', '')).path) and origin.scheme == 'http' and origin.hostname == '127.0.0.1' and origin.port not in (None, 3200) and os.getenv('SAAS_BASE_URL') == os.getenv('SAAS_TEST_BASE_URL') and os.getenv('CLIP_ANALYZER_PROVIDER') == 'fake' and not os.getenv('WAVESPEED_API_KEY') and not os.getenv('OPENAI_API_KEY')):
        raise RuntimeError('Owned isolated Phase D configuration required')
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from clipper_executor import Callbacks
    from clipper_pipeline import variation_rendering
    from clipper_pipeline.common import atomic_json
    original_progress, original_post = Callbacks.progress, Callbacks.post
    original_run = variation_rendering.run_child
    active = {}

    def pause(callbacks, **facts):
        atomic_json(callbacks.work / 'phase-d-paused.json', {'stage': os.getenv('PHASE_D_PAUSE_STAGE'), **facts})
        while True:
            callbacks.check()
            time.sleep(.1)

    def progress(self, percent, stage, message):
        active['callbacks'] = self
        result = original_progress(self, percent, stage, message)
        if os.getenv('PHASE_D_PAUSE_STAGE') == stage:
            pause(self)
        return result

    def post(self, action, data):
        if os.getenv('PHASE_D_PAUSE_STAGE') == 'UPLOAD_FINALIZE' and action == 'outputs/finalize' and (self.work / 'outputs' / 'clip_001.json').exists():
            pause(self, realClipPutCompleted=True)
        return original_post(self, action, data)

    def run(args, cwd, check, timeout=3600):
        if os.getenv('PHASE_D_PAUSE_STAGE') != 'DURING_FFMPEG':
            return original_run(args, cwd, check, timeout)
        # Start the actual encoder paced at source frame rate, then pause the
        # parent with a live FFmpeg child. taskkill /T interrupts both processes.
        paced = [args[0], '-re', *args[1:]]
        with (cwd / 'child.log').open('ab') as output:
            process = subprocess.Popen(paced, cwd=cwd, stdout=output, stderr=output)
            try:
                time.sleep(.3)
                if process.poll() is not None:
                    raise RuntimeError('FFmpeg did not remain running')
                pause(active['callbacks'], realFfmpegChildRunning=True, childPid=process.pid)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)

    Callbacks.progress, Callbacks.post = progress, post
    variation_rendering.run_child = run
