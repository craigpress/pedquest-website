import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from matplotlib.axes import Axes
from eeg_render.qa_evidence import display_montage, lab_evidence
from eeg_render import montage as mt

class EvidenceTests(unittest.TestCase):
    def test_time_major_binary_is_plotted_frequency_by_time(self):
        order=['psd.left','psd.right','aeegLo.left','aeegLo.right','aeegHi.left','aeegHi.right',
               'sr.left','sr.right','adr.left','adr.right','totalPower.left','totalPower.right','asym','t']
        header=dict(format=1,filled=3,nT=3,nF=4,arrays=order,freqs=[0,1,2,3],engineVersion=3,aeegDerivation={})
        h=json.dumps(header).encode(); h+=b'\0'*(-len(h)%4)
        values={key:np.ones(12 if key.startswith('psd') else 3,dtype='<f4') for key in order}
        values['psd.left']=np.array([1,1,100,1, 1,1,100,1, 1,1,100,1],dtype='<f4')
        values['t']=np.array([0,1,2],dtype='<f4')
        raw=b'PQTR'+struct.pack('<I',len(h))+h+b''.join(values[key].tobytes() for key in order)
        plotted=[]; original=Axes.imshow
        def capture(ax, data, *args, **kwargs):
            plotted.append(np.asarray(data));return original(ax,data,*args,**kwargs)
        with tempfile.TemporaryDirectory() as folder:
            out=Path(folder); (out/'trends.bin').write_bytes(raw)
            meta=dict(trendSidecar=str(out/'trends.bin'),sampleRate=100,labels=['C3','C4'],coverage='fixture',
                      windows=[dict(t0=0,data=[[0]*100,[0]*100])])
            packet=out/'packet.json';packet.write_text(json.dumps(meta))
            with patch.object(Axes,'imshow',capture): images,_=lab_evidence(packet,out)
            self.assertEqual(plotted[0].shape,(4,3))
            np.testing.assert_array_equal(np.argmax(plotted[0],axis=0),[2,2,2])
            self.assertEqual(len(images),2)
            (out/'trends.bin').write_bytes(raw[:-4])
            with self.assertRaises(ValueError): lab_evidence(packet,out)

STANDARD = mt.STANDARD_19 + ['A1', 'A2', 'EKG']


def trend_bytes():
    order=['psd.left','psd.right','aeegLo.left','aeegLo.right','aeegHi.left','aeegHi.right',
           'sr.left','sr.right','adr.left','adr.right','totalPower.left','totalPower.right','asym','t']
    header=dict(format=1,filled=3,nT=3,nF=4,arrays=order,freqs=[0,1,2,3],engineVersion=3,aeegDerivation={})
    h=json.dumps(header).encode(); h+=b' '*(-len(h)%4)
    values={key:np.ones(12 if key.startswith('psd') else 3,dtype='<f4') for key in order}
    values['t']=np.array([0,1,2],dtype='<f4')
    return b'PQTR'+struct.pack('<I',len(h))+h+b''.join(values[key].tobytes() for key in order)


class MontageTests(unittest.TestCase):
    def test_default_is_longitudinal_bipolar_with_chain_breaks_and_aux(self):
        plan = display_montage(['EEG ' + e + '-Ref' for e in mt.STANDARD_19] + ['A1', 'A2', 'EKG'])
        labels = [label for label, _ in plan['rows']]
        self.assertEqual(plan['id'], 'longitudinal_bipolar')
        self.assertEqual(plan['source'], 'default')
        self.assertEqual(labels[:5], ['Fp1-F7', 'F7-T3', 'T3-T5', 'T5-O1', 'Fp2-F8'])
        self.assertEqual(len(labels), 18)
        self.assertEqual(plan['breaks'], [4, 8, 12, 16])
        self.assertEqual(plan['aux'], [('EKG', 21)])
        x = np.arange(22, dtype=float)[:, None] * np.ones((1, 5))
        np.testing.assert_array_equal(plan['rows'][0][1](x), x[0] - x[mt.STANDARD_19.index('F7')])

    def test_modern_names_map_to_classic_chain(self):
        modern = [{'T3': 'T7', 'T4': 'T8', 'T5': 'P7', 'T6': 'P8'}.get(e, e) for e in mt.STANDARD_19]
        self.assertEqual(display_montage(modern)['rows'][2][0], 'T3-T5')

    def test_job_spec_montage_is_honoured(self):
        plan = display_montage(STANDARD, 'transverse_bipolar')
        self.assertEqual((plan['id'], plan['source']), ('transverse_bipolar', 'job spec'))
        self.assertEqual(plan['rows'][0][0], 'F7-Fp1')
        self.assertEqual(plan['name'], 'Transverse bipolar (TB-18.3)')
        ear = display_montage(STANDARD, 'ipsilateral_ear')
        self.assertEqual([r[0] for r in ear['rows']][:2], ['Fp1-A1', 'F7-A1'])
        self.assertEqual(ear['aux'], [('EKG', 21)])

    def test_unsupported_spec_montage_falls_back_to_default(self):
        plan = display_montage(mt.STANDARD_19, 'ipsilateral_ear')   # no A1/A2 in the recording
        self.assertEqual(plan['id'], 'longitudinal_bipolar')
        self.assertIn('unsupported', plan['source'])

    def test_reduced_array_uses_neonatal_bipolar(self):
        plan = display_montage(mt.NEONATAL_9 + ['ECG'])
        self.assertEqual(plan['id'], 'neonatal_reduced')
        self.assertEqual([r[0] for r in plan['rows']][:2], ['Fp1-T3', 'T3-O1'])
        self.assertEqual(len(plan['rows']), 12)
        self.assertEqual(plan['aux'], [('ECG', 9)])

    def test_lab_evidence_records_display_montage(self):
        rng = np.random.default_rng(0)
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder); (out/'trends.bin').write_bytes(trend_bytes())
            data = (rng.standard_normal((len(STANDARD), 200)) * 20).tolist()
            meta = dict(trendSidecar=str(out/'trends.bin'), sampleRate=100, labels=STANDARD, coverage='fixture',
                        windows=[dict(t0=0, data=data)])
            packet = out/'packet.json'; packet.write_text(json.dumps(meta))
            images, context = lab_evidence(packet, out)
            self.assertEqual(len(images), 2)
            self.assertEqual(context['raw_montage']['id'], 'longitudinal_bipolar')
            self.assertEqual(context['raw_montage']['derivations'][0], 'Fp1-F7')
            self.assertEqual(context['raw_montage']['auxiliary'], ['EKG'])
            _, context = lab_evidence(packet, out, montage='average')
            self.assertEqual(context['raw_montage']['derivations'][0], 'Fp1-Avg')


if __name__=='__main__': unittest.main()
