import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from scripts import ai_cycle as m

BASE=Path(__file__).resolve().parent.parent
TEXT='本期依据真实数据比较组合结构与覆盖取舍，历史表现仍需持续复核，不能代表未来开奖结果。'


def fake_response(context):
    result={}
    for key in m.SECTIONS[context['kind']]:
        prefix='single_' if key=='single_reason' else 'compound_' if key=='compound_reason' else ''
        ref=next(x for x in context['evidence'] if x.startswith(prefix))
        result[key]={'text':TEXT,'evidence_ids':[ref]}
    m.validate_response(result,context)
    return {'status':'completed','model':'TEST-fixture','route':'openrouter/free','prompt_version':m.VERSION,
            'generated_at':'2026-01-01T00:00:00+00:00','input_hash':m.digest(context),'sections':result,**copy.deepcopy(context)}


def fixture_root(path):
    (path/'public/data').mkdir(parents=True)
    for name in ['dlt_history.json','recommendations.json','compound_recommendation.json','compound_archive.json','published_recommendations.json','draw_details.json','review.json']:
        (path/'public/data'/name).write_bytes((BASE/'public/data'/name).read_bytes())


class AICycleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);fixture_root(self.root)
        self.patch=patch.object(m,'ROOT',self.root);self.patch.start()
        self.h=m.read('dlt_history.json')['issues'];self.recs=m.read('recommendations.json');self.c=m.read('compound_recommendation.json')
    def tearDown(self):self.patch.stop();self.temp.cleanup()
    def context(self):return m.analysis_context(self.recs,self.h,self.c,None)

    def test_current_context_real_stats_and_identities(self):
        ctx=self.context();p=next(r for r in self.recs if r.get('is_primary'))
        self.assertEqual(ctx['identity']['single'],m.numbers(p));self.assertTrue(ctx['created_before_draw'])
        self.assertEqual(ctx['history_cutoff'],self.h[-1]['issue'])
        self.assertTrue(any(x.startswith('single_') for x in ctx['evidence']))
        self.assertIn(str(m.settlement_cost(ctx['identity']['compound'])['tickets']),ctx['evidence']['compound_budget'])

    def test_future_data_or_wrong_compound_rejected(self):
        with self.assertRaises(ValueError):m.analysis_context(self.recs,self.h+[{'issue':'99999'}],self.c,None)
        c=copy.deepcopy(self.c);c['primary_fingerprint']='bad'
        with self.assertRaises(ValueError):m.analysis_context(self.recs,self.h,c,None)

    def test_all_seven_tier_conditions(self):
        expected={(5,2):1,(5,1):2,(5,0):3,(4,2):3,(4,1):4,(4,0):5,(3,2):5,(3,1):6,(2,2):6,(3,0):7,(2,1):7,(1,2):7,(0,2):7}
        for f in range(6):
            for b in range(3):self.assertEqual(m.tier(f,b,'26118'),expected.get((f,b),0))
        with self.assertRaises(ValueError):m.tier(5,2,'26013')

    def test_prize_uses_verified_notice_not_fixed_legacy(self):
        actual=self.h[-1];notice=m.read('draw_details.json')['issues'][-1]
        settled=m.settlement(m.numbers(actual),actual,notice)
        self.assertEqual(settled['prizes'][0]['tier'],'一等奖')
        self.assertEqual(settled['basic_payout_yuan'],str(notice['prizes']['一等奖']['basic']['per_ticket_yuan']))
        bad=copy.deepcopy(notice);bad['date']='1900-01-01'
        self.assertIsNone(m.settlement(m.numbers(actual),actual,bad)['basic_payout_yuan'])

    def test_compound_expansion_counts_and_budget(self):
        actual=self.h[-1];chosen=self.c['candidates'][0]
        settled=m.settlement(chosen,actual,None)
        self.assertEqual(sum(settled['matches'].values()),336)
        self.assertEqual(settled['basic_cost_yuan'],672)
        self.assertEqual(settled['all_additional_cost_yuan'],1008)

    def test_absent_pre_draw_ai_explicit(self):
        ctx=m.review_context(self.h,m.read('published_recommendations.json')['items'],[],m.read('draw_details.json')['issues'],[])
        self.assertFalse(ctx['has_pre_draw_ai']);self.assertIn('事后解读',ctx['evidence']['prior_analysis'])
        self.assertIsNone(ctx['settlement']['compound'])

    def test_corrupt_snapshot_rejected(self):
        snapshots=m.read('published_recommendations.json')['items']
        for s in snapshots:s['snapshot_hash']='bad'
        with self.assertRaises(ValueError):m.review_context(self.h,snapshots,[],[],[])

    def test_output_validation_rejects_invention_and_promises(self):
        ctx=self.context();good=fake_response(ctx)['sections']
        for text in ['出现了999次，未来走势会继续上升。','这个组合能够保证中奖，请放心购买。']:
            raw=copy.deepcopy(good);raw['overview']['text']=text
            with self.assertRaises(ValueError):m.validate_response(raw,ctx)
        raw=copy.deepcopy(good);raw['risk']['text']='历史统计和模型分析不保证中奖，所有推荐仅供持续观察与复核。'
        m.validate_response(raw,ctx)
        raw=copy.deepcopy(good);raw['single_reason']['evidence_ids']=['does_not_exist']
        with self.assertRaises(ValueError):m.validate_response(raw,ctx)
        raw=copy.deepcopy(good);raw['single_reason']['evidence_ids']=['compound_budget']
        with self.assertRaises(ValueError):m.validate_response(raw,ctx)

    def test_run_is_cached_and_originals_unchanged(self):
        before={p.name:p.read_bytes() for p in (self.root/'public/data').glob('*.json')}
        calls=[]
        def fn(ctx):calls.append(ctx['kind']);return fake_response(ctx)
        a=m.run(fn);b=m.run(fn)
        self.assertEqual(calls,['review','analysis']);self.assertEqual(a['analysis'],b['analysis'])
        self.assertIsNotNone(a['analysis']['previous_review'])
        self.assertEqual(a['analysis']['previous_review']['issue'],a['review']['issue'])
        for name,data in before.items():self.assertEqual(data,(self.root/'public/data'/name).read_bytes())

    def test_failed_analysis_is_retried_not_frozen(self):
        def failed(ctx):raise RuntimeError('timeout')
        a=m.run(failed);self.assertEqual(a['statuses']['analysis'],'awaiting_review')
        self.assertIsNone(a['analysis'])
        b=m.run(fake_response);self.assertEqual(b['statuses']['analysis'],'completed')

    def test_chinese_quantities_and_unsupported_claims_rejected(self):
        ctx=self.context()
        for text in ['本注基本投入六百七十二元，扩大组合覆盖范围但无法证明预测能力。',
                     '本方案由于号码回归均衡，显示一定分析优势但不保证中奖。',
                     '本期号码无重合，说明结构分析存在局限，后续仅供参考。']:
            raw=copy.deepcopy(fake_response(ctx)['sections'])
            raw['overview']['text']=text
            with self.assertRaises(ValueError):m.validate_response(raw,ctx)

    def test_chinese_quantity_conversion(self):
        for text,expected in [('一',1),('零四',4),('一零',10),('六百七十二',672),('一千零八',1008),('五十',50),('两百',200)]:
            self.assertEqual(m.chinese_number(text),expected)

    def test_free_router_transient_bad_endpoint_is_retried(self):
        ctx=self.context();bad=Mock(ok=False,status_code=400);good=Mock(ok=True)
        good.json.return_value={'model':'actual/free-model:free','choices':[{'message':{'content':json.dumps(fake_response(ctx)['sections'])}}]}
        env={'DLT_AI_API_KEY':'TEST','DLT_AI_BASE_URL':'https://openrouter.ai/api/v1','DLT_AI_MODEL':'openrouter/free'}
        with patch.dict('os.environ',env),patch.object(m.requests,'post',side_effect=[bad,good]) as post,patch.object(m.time,'sleep'):
            self.assertEqual(m.request_analysis(ctx)['status'],'completed')
            self.assertEqual(post.call_count,2)

    def test_free_route_only(self):
        env={'DLT_AI_API_KEY':'TEST','DLT_AI_BASE_URL':'https://openrouter.ai/api/v1','DLT_AI_MODEL':'paid/model'}
        with patch.dict('os.environ',env),patch.object(m.requests,'post') as post:
            with self.assertRaises(RuntimeError):m.request_analysis(self.context())
            post.assert_not_called()

    def test_actual_model_retained_and_http_failure_is_sanitized(self):
        ctx=self.context();raw=fake_response(ctx)['sections'];response=Mock(ok=True)
        response.json.return_value={'model':'actual/free-model:free','choices':[{'message':{'content':json.dumps(raw)}}]}
        env={'DLT_AI_API_KEY':'TEST','DLT_AI_BASE_URL':'https://openrouter.ai/api/v1','DLT_AI_MODEL':'openrouter/free'}
        with patch.dict('os.environ',env),patch.object(m.requests,'post',return_value=response):
            result=m.request_analysis(ctx)
        self.assertEqual(result['model'],'actual/free-model:free')
        response.ok=False;response.status_code=401
        with patch.dict('os.environ',env),patch.object(m.requests,'post',return_value=response) as post:
            with self.assertRaisesRegex(RuntimeError,'^http_401$'):m.request_analysis(ctx)
            self.assertEqual(post.call_count,1)

    def test_draw_transition_reviews_actual_prior_reasons_and_carries_lesson(self):
        m.run(fake_response)
        issue=str(next(r for r in self.recs if r.get('is_primary'))['target_issue'])
        actual={'issue':issue,'date':'2026-10-17','front':[1,2,3,4,5],'back':[1,2]}
        h=self.h+[actual]
        ctx=m.review_context(h,m.read('published_recommendations.json')['items'],m.read('compound_archive.json')['items'],[],m.read('ai_cycle_archive.json')['analyses'])
        self.assertTrue(ctx['has_pre_draw_ai']);self.assertIsNotNone(ctx['prior_analysis_hash'])
        self.assertIn('prior_analysis',ctx['evidence']);self.assertIsNotNone(ctx['settlement']['compound'])
        previous=fake_response(ctx)
        new=copy.deepcopy(self.recs)
        for r in new:r['target_issue']=str(int(issue)+1)
        c=copy.deepcopy(self.c);c['target_issue']=str(int(issue)+1);c['primary_fingerprint']=m.fingerprint(next(r for r in new if r.get('is_primary')))
        following=m.analysis_context(new,h,c,previous)
        self.assertEqual(following['previous_review']['issue'],issue)
        self.assertIn(previous['sections']['next_focus']['text'],following['evidence']['previous_review'])

    def test_post_draw_analysis_is_not_misrepresented_as_prior_forecast(self):
        a=fake_response(self.context());issue=a['issue'];a['generated_at']='2026-10-18T00:00:00+00:00'
        actual={'issue':issue,'date':'2026-10-17','front':[1,2,3,4,5],'back':[1,2]}
        ctx=m.review_context(self.h+[actual],m.read('published_recommendations.json')['items'],[],[],[a])
        self.assertFalse(ctx['has_pre_draw_ai'])

    def test_corrupt_archive_is_not_reset(self):
        m.write('ai_cycle_archive.json',{'schema_version':99,'analyses':[],'reviews':[]})
        with self.assertRaises(ValueError):m.run(fake_response)
        self.assertEqual(m.read('ai_cycle_archive.json')['schema_version'],99)

if __name__=='__main__':unittest.main()
