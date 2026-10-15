"""Independent, issue-frozen compound recommendation and optional real AI selection.
Never writes the single-ticket recommendation or its publication store.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
VERSION = 'dlt-compound-v1'


def fingerprint(p):
    identity = {'issue': str(p['target_issue']), 'front': sorted(p['front']), 'back': sorted(p['back'])}
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def build(recs, issues):
    primaries = [p for p in recs if p.get('is_primary') is True]
    if len(primaries) != 1:
        raise ValueError('exactly one primary required')
    p = primaries[0]
    target = str(p['target_issue'])
    history = sorted((h for h in issues if str(h['issue']) < target), key=lambda h: str(h['issue']))[-50:]
    if not history or str(max(issues, key=lambda h: str(h['issue']))['issue']) >= target:
        raise ValueError('target is not a future issue')
    ranks, evidence = {}, {}
    for zone, limit, size in [('front', 35, 5), ('back', 12, 2)]:
        base = p[zone]
        if len(base) != size or len(set(base)) != size or any(type(n) is not int or not 1 <= n <= limit for n in base):
            raise ValueError('illegal primary')
        freq = Counter(n for h in history for n in h[zone])
        ranks[zone] = sorted(range(1, limit + 1), key=lambda n: (-freq[n], n))
        evidence[zone] = {str(n): freq[n] for n in ranks[zone]}
    candidates = []
    for fc, bc in [(8, 4), (10, 3)]:
        zones = {}
        for zone, count in [('front', fc), ('back', bc)]:
            base = list(p[zone])
            zones[zone] = sorted(base + [n for n in ranks[zone] if n not in base][:count - len(base)])
        tickets = math.comb(fc, 5) * math.comb(bc, 2)
        candidates.append({'format': f'{fc}+{bc}', **zones, 'tickets': tickets,
                           'basic_yuan': tickets * 2, 'additional_yuan': tickets * 3})
    return {'schema_version': 1, 'game_id': 'dlt', 'algorithm_version': VERSION,
            'target_issue': target, 'primary_fingerprint': fingerprint(p), 'primary': {'front': sorted(p['front']), 'back': sorted(p['back'])},
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'history_cutoff': history[-1]['issue'], 'window': len(history),
            'evidence': evidence, 'candidates': candidates, 'selected_format': '8+4',
            'ai': {'status': 'not_configured'}, 'frozen': True}


def select_with_ai(payload):
    """Model selects only a legal precomputed candidate and cites existing evidence IDs."""
    key, url, model = (os.getenv(k, '') for k in ['DLT_AI_API_KEY', 'DLT_AI_BASE_URL', 'DLT_AI_MODEL'])
    if not all((key, url, model)):
        return payload
    if not url.startswith('https://'):
        raise ValueError('AI endpoint must use HTTPS')
    facts = {k: payload[k] for k in ['target_issue', 'window', 'history_cutoff', 'evidence', 'candidates']}
    response = requests.post(url.rstrip('/') + '/chat/completions', headers={'Authorization': 'Bearer ' + key},
        json={'model': model, 'temperature': 0, 'response_format': {'type': 'json_object'}, 'messages': [
            {'role': 'system', 'content': '你是彩票组合分析助手。仅依据给定事实选择一组复式，不预测中奖。返回JSON：selected_format（8+4或10+3）、factor_refs（2至6个引用，如front:12或back:3）。引用必须在所选候选号码内。不返回概率或宣传文案。'},
            {'role': 'user', 'content': json.dumps(facts, ensure_ascii=False)}]}, timeout=35)
    response.raise_for_status()
    raw = json.loads(response.json()['choices'][0]['message']['content'])
    chosen = next((c for c in payload['candidates'] if c['format'] == raw.get('selected_format')), None)
    refs = raw.get('factor_refs')
    if chosen is None or not isinstance(refs, list) or not 2 <= len(refs) <= 6 or len(set(refs)) != len(refs):
        raise ValueError('invalid AI selection')
    for ref in refs:
        if not isinstance(ref, str) or ':' not in ref:
            raise ValueError('invalid factor ref')
        zone, number = ref.split(':', 1)
        if zone not in ('front', 'back') or number not in payload['evidence'][zone] or int(number) not in chosen[zone]:
            raise ValueError('AI citation not grounded')
    payload['selected_format'] = chosen['format']
    payload['ai'] = {'status': 'completed', 'model': model, 'factor_refs': refs,
                     'role': 'candidate_selection_and_evidence_review'}
    return payload


def run():
    out = ROOT / 'public/data/compound_recommendation.json'
    archive = ROOT / 'public/data/compound_archive.json'
    recs = json.loads((ROOT / 'public/data/recommendations.json').read_text())
    issues = json.loads((ROOT / 'public/data/dlt_history.json').read_text())['issues']
    payload = build(recs, issues)
    records = json.loads(archive.read_text()) if archive.exists() else {'schema_version': 1, 'items': []}
    previous = next((p for p in records['items'] if p['target_issue'] == payload['target_issue']), None)
    if previous:
        if previous['primary_fingerprint'] != payload['primary_fingerprint']:
            raise ValueError('frozen compound primary identity mismatch')
        payload = previous
    else:
        try:
            payload = select_with_ai(payload)
        except Exception:
            # Never print provider body, URL or credentials to CI logs.
            payload['ai'] = {'status': 'unavailable'}
        records['items'].append(payload)
        atomic_write(archive, records)
    atomic_write(out, payload)
    print('compound:', payload['target_issue'], payload['selected_format'], payload['ai']['status'])


def atomic_write(path, data):
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


if __name__ == '__main__':
    run()
