"""Opt-in, isolated restart-test adapter; never loaded by the deployed worker.

Only transcription is substituted. Transfers, probes, rendering, signed uploads,
leases, checkpoints, completion, publication and billing use production code.
"""
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

if os.getenv('PHASE_A_PROCESS_TEST') == '1':
    qa_origin = urlparse(os.getenv('SAAS_BASE_URL', ''))
    qa_owned_phase_c = (
        bool(os.getenv('STABILIZATION_RUN_ID'))
        and os.getenv('DATABASE_URL') == os.getenv('TEST_DATABASE_URL')
        and urlparse(os.getenv('DATABASE_URL', '')).path.startswith(('/phase_c_', '/phase_d_'))
        and os.getenv('SAAS_BASE_URL') == os.getenv('SAAS_TEST_BASE_URL')
        and qa_origin.scheme == 'http' and qa_origin.hostname == '127.0.0.1'
        and qa_origin.port not in (None, 3200)
    )
    if (os.getenv('SAAS_BASE_URL') != 'http://127.0.0.1:3227' and not qa_owned_phase_c) or os.getenv('CLIP_ANALYZER_PROVIDER') != 'fake' or os.getenv('ENABLE_FAKE_CLIP_ANALYZER') != '1':
        raise RuntimeError('Isolated fake-provider configuration required')
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from clipper_executor import Callbacks
    from clipper_pipeline import pipeline
    from clipper_pipeline.common import atomic_json
    from clipper_pipeline.transcription import configuration, fingerprint

    original_progress = Callbacks.progress
    original_post = Callbacks.post
    original_run_child = pipeline.run_child

    def pause(callbacks):
        # No credentials, paths, URLs or diagnostic text are emitted.
        atomic_json(callbacks.work / 'phase-a-paused.json', {'stage': os.getenv('PHASE_A_PAUSE_STAGE')})
        while True:
            callbacks.check()
            time.sleep(0.1)

    def progress(self, percent, stage, message):
        result = original_progress(self, percent, stage, message)
        target = os.getenv('PHASE_A_PAUSE_STAGE')
        if target == stage and stage != 'UPLOADING_RESULTS':
            pause(self)
        return result

    def post(self, action, data):
        # Interrupt after a real clip PUT and before its finalize transaction.
        # This leaves an incomplete artifact, rather than only completed uploads.
        if os.getenv('PHASE_A_PAUSE_STAGE') == 'UPLOADING_RESULTS' and action == 'outputs/finalize':
            receipt = self.work / 'outputs' / 'clip_001.json'
            if receipt.exists():
                original_progress(self, 95, 'UPLOADING_RESULTS', 'Uploading results')
                pause(self)
        return original_post(self, action, data)

    def run_child(args, cwd, check, timeout=3600):
        if Path(args[1]).name != 'transcribe_source.py':
            return original_run_child(args, cwd, check, timeout)
        check()
        options = dict(zip(args[2::2], args[3::2]))
        duration = float(options['--duration'])
        config = configuration(options['--language'])
        segments = [{'id': i, 'start': float(i * 5), 'end': min(duration, float((i + 1) * 5)), 'text': 'This fixture explains a useful complete idea for a short video.', 'words': []} for i in range(int(duration // 5))]
        atomic_json(Path(options['--output']), {'schemaVersion': 3, 'sourceAssetId': options['--source-id'], 'sourceSha256': options['--sha'], 'duration': duration, 'language': 'en', 'segments': segments, 'words': [], 'metadata': {'fingerprint': fingerprint(options['--sha'], config), 'transcriber': 'isolated-phase-a-fixture'}})

    Callbacks.progress = progress
    Callbacks.post = post
    pipeline.run_child = run_child
