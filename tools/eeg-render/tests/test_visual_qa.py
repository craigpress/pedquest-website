import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from eeg_render.visual_qa import run_qa, validate_report, review_local

PASS = dict(verdict='pass', summary='No visual defect', coverage='15 seconds', limitations=[], findings=[], suggested_prompt='')

class Database:
    def __init__(self): self.row = None
    def request(self, path, method='GET', body=None, extra=None):
        if method == 'POST':
            if self.row: return []
            self.row = {**body, 'id':'record-1'}
            return [copy.deepcopy(self.row)]
        if method == 'PATCH':
            if 'status=eq.running' not in path or self.row['status']=='running':
                self.row.update(body)
                return [copy.deepcopy(self.row)] if extra else None
            return []
        return [copy.deepcopy(self.row)]

class VisualQaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.image = Path(self.tmp.name)/'image.png'
        self.image.write_bytes(b'fixture')
        self.db = Database()

    def runqa(self, context=None):
        return run_qa(self.db,'lab','job-1',[self.image],context or {})

    def test_retry_and_restart_never_repeat_provider(self):
        with patch('eeg_render.visual_qa.review_images', return_value=copy.deepcopy(PASS)) as provider:
            self.assertEqual(self.runqa()['verdict'],'pass')
            self.assertEqual(self.runqa()['verdict'],'pass')
            provider.assert_called_once()

    def test_reservation_precedes_provider_and_concurrent_attempt_is_flagged(self):
        def provider(*args):
            self.assertEqual(self.db.row['status'],'running')
            self.assertEqual(self.runqa()['verdict'],'needs_review')
            return copy.deepcopy(PASS)
        with patch('eeg_render.visual_qa.review_images', side_effect=provider) as call:
            self.assertEqual(self.runqa()['verdict'],'pass')
            call.assert_called_once()

    def test_changed_artifact_invalidates_persisted_pass(self):
        with patch('eeg_render.visual_qa.review_images', return_value=copy.deepcopy(PASS)) as provider:
            self.runqa(); self.image.write_bytes(b'changed')
            self.assertEqual(self.runqa()['verdict'],'needs_review')
            self.assertEqual(self.db.row['status'],'needs_review')
            provider.assert_called_once()

    def test_concurrent_invalidation_cannot_return_stale_pass(self):
        def provider(*args):
            self.image.write_bytes(b'changed during review')
            self.runqa()
            return copy.deepcopy(PASS)
        with patch('eeg_render.visual_qa.review_images', side_effect=provider):
            self.assertEqual(self.runqa()['verdict'],'needs_review')
            self.assertEqual(self.db.row['status'],'needs_review')

    def test_failure_is_persisted_without_provider_body(self):
        with patch('eeg_render.visual_qa.review_images', side_effect=ValueError('SECRET')) as provider:
            result=self.runqa(); self.runqa()
            self.assertEqual(result['verdict'],'needs_review')
            self.assertNotIn('SECRET',str(self.db.row))
            provider.assert_called_once()

    def test_missing_evidence_cannot_pass(self):
        with patch('eeg_render.visual_qa.review_images', return_value=copy.deepcopy(PASS)):
            self.assertEqual(self.runqa({'required_evidence_missing':['raw evidence missing']})['verdict'],'needs_review')

    def test_report_validation(self):
        with self.assertRaises(ValueError): validate_report({'verdict':'pass'})
        result=copy.deepcopy(PASS);result['limitations']=['unassessable polarity']
        self.assertEqual(validate_report(result)['verdict'],'needs_review')

    def test_cli_retry_reuses_persisted_attempt(self):
        with patch('eeg_render.visual_qa.review_images', return_value=copy.deepcopy(PASS)) as provider:
            review_local(self.image,{})
            self.assertEqual(review_local(self.image,{})['verdict'],'pass')
            provider.assert_called_once()

if __name__=='__main__': unittest.main()
