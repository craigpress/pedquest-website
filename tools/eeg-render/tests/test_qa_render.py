import tempfile
import unittest
from pathlib import Path
from eeg_render.render import render_image

class QaRenderTests(unittest.TestCase):
    def test_qa_preserves_primary_image_and_supplies_paired_pages(self):
        image = {'kind':'qeeg_panel','license':'synthetic-original', 'spec':{
            'seed': 211, 'duration_min':30, 'panels':['fft_L','fft_R']}}
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            original,_=render_image('test',image,root/'original')
            evidence=[]
            revised,_=render_image('test',image,root/'qa',qa_images=evidence)
            self.assertEqual(original.read_bytes(),revised.read_bytes())
            self.assertEqual(len(evidence),3)
            self.assertTrue(all(p.stat().st_size>1000 for p in evidence))

if __name__=='__main__': unittest.main()
