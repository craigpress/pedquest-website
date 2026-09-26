import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from matplotlib.axes import Axes
from eeg_render.qa_evidence import lab_evidence

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

if __name__=='__main__': unittest.main()
