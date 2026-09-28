import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from eeg_render import render as R
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

    def _qa_montages(self, spec):
        seen = []
        original = R.render_eeg_page
        def capture(page, *args, **kwargs):
            seen.append(page['montage']); return original(page, *args, **kwargs)
        with tempfile.TemporaryDirectory() as folder, patch.object(R, 'render_eeg_page', capture):
            render_image('test', {'kind': 'qeeg_panel', 'license': 'synthetic-original', 'spec': spec},
                         Path(folder), qa_images=[])
        return seen

    def test_qa_pages_default_to_longitudinal_bipolar(self):
        self.assertEqual(self._qa_montages({'seed': 211, 'duration_min': 30, 'panels': ['fft_L']}),
                         ['longitudinal_bipolar'] * 3)

    def test_qa_pages_honour_item_montage(self):
        spec = {'seed': 211, 'duration_min': 30, 'panels': ['fft_L'], 'spec_version': 3, 'montage': 'transverse'}
        self.assertEqual(self._qa_montages(spec), ['transverse_bipolar'] * 3)

if __name__=='__main__': unittest.main()
