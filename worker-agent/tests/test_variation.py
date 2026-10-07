import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from clipper_pipeline.common import PipelineError
from clipper_pipeline.variation_rendering import validate_settings, subtitle_file, render_variation, GRADES
from worker_agent import safe_error_code

SETTINGS = {'name':'','textStyle':'current','hookType':'text','subtitleEnabled':True,'subtitlePosition':'bottom','subtitleY':.84,'subtitleSize':'small','subtitleFont':'sans','fontColor':'#ffffff','highlightColor':'#ffd43b','highlightEnabled':True,'phraseCaptions':False,'colorGrade':'original','mirror':False,'letterboxEnabled':False,'topBar':.2,'bottomBar':.2,'topHookEnabled':False,'hookFont':'sans','hookColor':'#ffffff','hookSize':72,'hookX':.5,'hookY':.5}
CLIP = {'start':10,'end':20,'duration':10,'hook':'A {safe} \\hook','reason':'fixture','score':90,'tags':[]}

class VariationTests(unittest.TestCase):
    def test_rejects_untrusted_filter_paths_and_coerced_choices(self):
        for key,value in [('filter','hflip'),('path','C:/private'),('subtitleFont',['sans']),('mirror',1),('hookSize',True),('subtitleY',float('nan')),('topBar',.5),('fontColor','#fff'),('name','x'*81)]:
            with self.subTest(key=key), self.assertRaises(PipelineError):
                validate_settings({**SETTINGS,key:value})

    def test_top_hook_requires_valid_text_and_bar(self):
        with self.assertRaises(PipelineError):
            validate_settings({**SETTINGS,'topHookEnabled':True})
        self.assertTrue(validate_settings({**SETTINGS,'letterboxEnabled':True,'topHookEnabled':True})['topHookEnabled'])

    def test_word_highlighting_uses_frozen_word_intervals_and_clip_offset(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'clip.ass'
            subtitle_file(p,{'words':[{'word':'First','start':11,'end':12},{'word':'second','start':12.5,'end':13}]},CLIP,SETTINGS)
            text=p.read_text(encoding='utf8')
            self.assertIn('0:00:01.00,0:00:02.00',text)
            self.assertIn('0:00:02.50,0:00:03.00',text)
            self.assertIn(r'\pos(360,1075)',text)
            self.assertNotIn('{safe}',text)
            self.assertNotIn(r'\hook',text)

    def test_phrase_mode_has_no_estimated_word_highlight(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'clip.ass'
            subtitle_file(p,{'segments':[{'text':'Existing phrase','start':10,'end':15}]},CLIP,{**SETTINGS,'phraseCaptions':True,'hookType':'none'})
            text=p.read_text(encoding='utf8')
            self.assertIn('Existing phrase',text)
            self.assertNotIn(r'{\c',text)

    def test_disabled_captions_and_hook_emit_no_text_events(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'clip.ass'
            subtitle_file(p,{'words':[]},CLIP,{**SETTINGS,'subtitleEnabled':False,'hookType':'none'})
            self.assertNotIn('Dialogue:',p.read_text(encoding='utf8'))

    def test_native_named_grade_and_flip_build_only_allowlisted_filters(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source.mp4';out=root/'clip_001.mp4';seen=[]
            def child(args,cwd,check,timeout):
                seen.extend(args);Path(args[-1]).write_bytes(b'fixture-media');check()
            with patch('clipper_pipeline.variation_rendering.run_child',side_effect=child),patch('clipper_pipeline.variation_rendering.probe',return_value={'width':720,'height':1280,'codec':'h264','hasAudio':True,'durationSeconds':10}):
                render_variation(source,out,CLIP,{'segments':[]},{**SETTINGS,'mirror':True,'colorGrade':'warm','letterboxEnabled':True},lambda:None,100000)
            filters=seen[seen.index('-vf')+1]
            self.assertIn('hflip',filters);self.assertIn(GRADES['warm'],filters);self.assertIn('drawbox=',filters);self.assertIn('ass=clip_001.ass',filters)
            self.assertEqual(seen[seen.index('-ss')+1],'10.000000');self.assertEqual(seen[seen.index('-t')+1],'10.000000');self.assertTrue(out.exists())

    def test_invalid_media_does_not_replace_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);out=root/'clip.mp4';out.write_bytes(b'previous')
            def child(args,*a,**kw):Path(args[-1]).write_bytes(b'broken')
            with patch('clipper_pipeline.variation_rendering.run_child',side_effect=child),patch('clipper_pipeline.variation_rendering.probe',return_value={'width':10,'height':20,'codec':'h264','hasAudio':True,'durationSeconds':10}),self.assertRaises(PipelineError):
                render_variation(root/'source',out,CLIP,{'segments':[]},SETTINGS,lambda:None,100000)
            self.assertEqual(out.read_bytes(),b'previous')

    def test_variation_failure_has_safe_known_code(self):
        self.assertEqual(safe_error_code(PipelineError('VARIATION_INPUT_INVALID')),'VARIATION_INPUT_INVALID')

if __name__ == '__main__':unittest.main()
