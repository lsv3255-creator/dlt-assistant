(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const time = value => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const labels = {3:'主胜',1:'平',0:'客胜'};

  function render(data) {
    $('issue-summary').innerHTML = `<div class="issue-meta"><div class="metric"><small>期号</small><strong>第${safe(data.issue)}期</strong></div><div class="metric"><small>停售时间</small><strong>${safe(time(data.sale_end))}</strong></div><div class="metric"><small>开奖日期</small><strong>${safe(data.draw_date)}</strong></div><div class="metric"><small>玩法</small><strong>14场 + 任选九</strong></div></div>`;
    const ai = data.ai || {};
    const sections = ai.sections || {};
    $('ai-summary').innerHTML = `<span class="ai-state">${ai.status === 'completed' ? 'AI 已完成本期分析' : 'AI 分析更新中'}</span><h3>${safe(ai.title || 'AI 综合分析')}</h3>${[['overview','综合研判'],['sfc_reason','14场取舍'],['r9_reason','任选九取舍'],['risk','风险说明']].map(([key,label]) => `<div class="ai-section"><strong>${label}</strong>${safe(sections[key] || '等待更新')}</div>`).join('')}`;
    $('sfc-summary').innerHTML = `<div class="plan-strip"><span class="plan-chip">${safe(data.plans.sfc14.lines)} 注</span><span class="plan-chip">基本金额 ${safe(data.plans.sfc14.cost_yuan)} 元</span></div>`;
    const dynText = row => {
      const dyn = row.dynamics;
      if (!dyn || !dyn.home || !dyn.away) return '';
      const f = form => `${form.w}胜${form.d}平${form.l}负 ${form.points}分`;
      let text = ` · 近10场 主 ${f(dyn.home.form_last10)} / 客 ${f(dyn.away.form_last10)}`;
      if (dyn.home.rest_days != null && dyn.away.rest_days != null) text += ` · 休息 主${dyn.home.rest_days}天/客${dyn.away.rest_days}天`;
      if (dyn.head_to_head) text += ` · 交锋 ${dyn.head_to_head.meetings}场 主${dyn.head_to_head.home_wins}胜${dyn.head_to_head.draws}平${dyn.head_to_head.away_wins}负`;
      return text;
    };
    $('match-list').innerHTML = data.matches.map(row => `<article class="match-row"><div class="match-order">${row.order}</div><div><div class="match-name">${safe(row.home)} vs ${safe(row.away)}</div><div class="match-meta">${safe(row.league)} · ${safe(time(row.kickoff))} · 综合相对概率 主${Math.round(row.probabilities['3']*100)}% / 平${Math.round(row.probabilities['1']*100)}% / 客${Math.round(row.probabilities['0']*100)}%${row.home_rank && row.away_rank ? ` · 排名 ${safe(row.home_rank)}/${safe(row.away_rank)}` : ''}${safe(dynText(row))}</div></div><div class="choices">${row.sfc_choices.map((choice,index)=>`<span class="choice${index?' secondary':''}" title="${labels[choice]}">${choice}</span>`).join('')}</div></article>`).join('');
    const r9 = new Set(data.plans.ren9.orders);
    $('r9-summary').innerHTML = `<div class="plan-strip"><span class="plan-chip">场次 ${data.plans.ren9.orders.join('、')}</span><span class="plan-chip">基本金额 ${safe(data.plans.ren9.cost_yuan)} 元</span></div><div class="match-list">${data.matches.filter(row=>r9.has(row.order)).map(row=>`<article class="match-row"><div class="match-order">${row.order}</div><div><div class="match-name">${safe(row.home)} vs ${safe(row.away)}</div><div class="match-meta">${safe(row.league)}</div></div><div class="choices"><span class="choice">${row.primary}</span></div></article>`).join('')}</div>`;
    if (data.review?.status === 'completed') $('football-review').textContent = sections.review || `14场覆盖命中 ${data.review.sfc_hits}/14，任选九命中 ${data.review.ren9_hits}/9。复盘只评价已冻结方案，不事后改号。`;
    $('football-sources').innerHTML = Object.values(data.sources || {}).map(source => `<a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.name)}</a>`).join('');
    $('football-content').hidden = false;
  }

  const load = url => fetch(url,{cache:'no-store'}).then(response => {
    if (!response.ok) throw new Error('数据读取失败');
    return response.json();
  });
  load('/api/football-current')
    .catch(() => load('./data/football/current.json'))
    .then(render)
    .catch(() => { $('football-error').hidden = false; });

  function renderReviews(payload) {
    const reviews = (payload && payload.reviews) || [];
    if (!reviews.length) return;
    const latest = reviews[0];
    const detail = latest.matches.map(m => `<div class="match-meta">${m.order}. ${safe(m.home)} vs ${safe(m.away)} · 赛果 ${safe(labels[m.result] || '—')} · 方案 ${m.sfc_choices.join('/')} ${m.sfc_hit ? '✅ 命中' : '❌ 未中'}</div>`).join('');
    const history = reviews.slice(1).map(r => `<div class="match-meta">第${safe(r.issue)}期 · 14场覆盖命中 ${r.sfc_hits}/14 · 任选九命中 ${r.ren9_hits}/9</div>`).join('');
    $('football-review').innerHTML = `<div>第${safe(latest.issue)}期已复盘：14场覆盖命中 <strong>${latest.sfc_hits}/14</strong>，任选九命中 <strong>${latest.ren9_hits}/9</strong>。复盘只评价已冻结方案，不事后改号。</div>${detail}${history}`;
  }
  load('./data/football/reviews.json').then(renderReviews).catch(() => {});
})();


