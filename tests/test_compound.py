import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from scripts import build_compound as m

ROOT = Path(__file__).resolve().parent.parent

class CompoundTests(unittest.TestCase):
    def setUp(self):
        self.recs = json.loads((ROOT / 'public/data/recommendations.json').read_text())
        self.history = json.loads((ROOT / 'public/data/dlt_history.json').read_text())['issues']

    def test_cost_inclusion_and_no_mutation(self):
        before = copy.deepcopy(self.recs)
        c = m.build(self.recs, self.history)
        p = next(r for r in self.recs if r.get('is_primary'))
        self.assertEqual(c['selected_format'], '8+4')
        for r in c['candidates']:
            for zone in ['front','back']:
                self.assertTrue(set(p[zone]) <= set(r[zone]))
            self.assertEqual(r['tickets'], math.comb(len(r['front']),5)*math.comb(len(r['back']),2))
            self.assertEqual(r['basic_yuan'], r['tickets']*2)
        self.assertEqual(c['candidates'][0]['tickets'],336)
        self.assertEqual(c['candidates'][1]['basic_yuan'],1512)
        self.assertEqual(self.recs,before)

    def test_bad_primary_and_closed_issue(self):
        for rs in [[], self.recs + [next(r for r in self.recs if r.get('is_primary'))]]:
            with self.assertRaises(ValueError): m.build(rs,self.history)
        p = next(r for r in self.recs if r.get('is_primary'))
        with self.assertRaises(ValueError): m.build(self.recs,self.history+[{'issue':p['target_issue'],'front':[1,2,3,4,5],'back':[1,2]}])

    def test_future_records_rejected(self):
        with self.assertRaises(ValueError): m.build(self.recs,self.history+[{'issue':'99999'}])

    def test_ai_chooses_only_legal_candidate_and_references(self):
        env={'DLT_AI_API_KEY':'test-only','DLT_AI_BASE_URL':'https://example.invalid/v1','DLT_AI_MODEL':'test-model'}
        c=m.build(self.recs,self.history)
        chosen=c['candidates'][1]
        refs=['front:'+str(n) for n in chosen['front'][:2]]
        response=Mock();response.json.return_value={'choices':[{'message':{'content':json.dumps({'selected_format':'10+3','factor_refs':refs})}}]}
        with patch.dict('os.environ',env), patch.object(m.requests,'post',return_value=response):
            out=m.select_with_ai(c)
        self.assertEqual(out['selected_format'],'10+3');self.assertEqual(out['ai']['status'],'completed')
        response.json.return_value={'choices':[{'message':{'content':'{"selected_format":"10+3","factor_refs":["front:99","back:99"]}'}}]}
        with patch.dict('os.environ',env), patch.object(m.requests,'post',return_value=response), self.assertRaises(ValueError):
            m.select_with_ai(m.build(self.recs,self.history))

    def test_missing_credentials_never_claims_ai(self):
        with patch.dict('os.environ',{},clear=True):
            c=m.select_with_ai(m.build(self.recs,self.history))
        self.assertEqual(c['ai']['status'],'not_configured')

    def test_freeze_and_primary_identity_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'public/data').mkdir(parents=True)
            (root/'public/data/recommendations.json').write_text(json.dumps(self.recs))
            (root/'public/data/dlt_history.json').write_text(json.dumps({'issues':self.history}))
            with patch.object(m,'ROOT',root), patch.dict('os.environ',{},clear=True):
                m.run();first=(root/'public/data/compound_recommendation.json').read_bytes();m.run()
                self.assertEqual(first,(root/'public/data/compound_recommendation.json').read_bytes())
                p=next(r for r in self.recs if r.get('is_primary'));p['front']=[1,2,3,4,5]
                (root/'public/data/recommendations.json').write_text(json.dumps(self.recs))
                with self.assertRaises(ValueError): m.run()
