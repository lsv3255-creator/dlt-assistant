(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const time = value => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const pct = value => `${Math.round(value * 100)}%`;

  function marketLine(label, market, handicap) {
    if (!market) return `<div class="match-meta">${label}：未开售</div>`;
    const probs = market.probabilities;
    const star = market.value_edge > 0.03 ? ' ⭐' : '';
    const model = market.margin_model ? ` · 净胜球模型 胜${pct(market.margin_model['3'])}/平${pct(market.margin_model['1'])}/负${pct(market.margin_model['0'])}` : '';
    return `<div class="match-meta">${label}${handicap ? `(${handicap > 0 ? '+' : ''}${handicap})` : ''} · 概率 胜${pct(probs['3'])}/平${pct(probs['1'])}/负${pct(probs['0'])}${model} · 奖金 ${safe(market.odds[market.pick])} · <strong>推荐 ${safe(market.pick_label)}${star}</strong></div>`;
  }

  function render(data) {
    const deadlines = data.matches.map(row => row.deadline).sort();
    $('jc-summary').innerHTML = `<div class="issue-meta"><div class="metric"><small>销售日</small><strong>${safe(data.sale_date)}</strong></div><div class="metric"><small>在售场次</small><strong>${data.matches.length} 场</strong></div><div class="metric"><small>最近停售</small><strong>${safe(time(deadlines[0]))}</strong></div><div class="metric"><small>玩法</small><strong>胜平负 + 让球胜平负</strong></div></div>`;
    $('jc-parlays').innerHTML = data.parlays && data.parlays.length
      ? data.parlays.map(p => `<div class="plan-strip"><span class="plan-chip">${safe(p.name)}</span>${p.picks.map(leg => `<span class="plan-chip">${safe(leg.code)} ${safe(leg.home)} vs ${safe(leg.away)} · ${safe(leg.pick_label)} @${safe(leg.odds)}</span>`).join('')}<span class="plan-chip">组合奖金 ${safe(p.combined_odds)}</span><span class="plan-chip">模型概率 ${pct(p.combined_probability)}</span></div>`).join('')
      : '<p class="hint">今日暂无达到置信度门槛的串关建议。</p>';
    const dynText = row => {
      const dyn = row.dynamics;
      if (!dyn || !dyn.home || !dyn.away) return '';
      const f = form => `${form.w}胜${form.d}平${form.l}负 ${form.points}分`;
      let text = ` · 近10场 主 ${f(dyn.home.form_last10)} / 客 ${f(dyn.away.form_last10)}`;
      if (dyn.home.rest_days != null && dyn.away.rest_days != null) text += ` · 休息 主${dyn.home.rest_days}天/客${dyn.away.rest_days}天`;
      if (dyn.head_to_head) text += ` · 交锋 ${dyn.head_to_head.meetings}场 主${dyn.head_to_head.home_wins}胜${dyn.head_to_head.draws}平${dyn.head_to_head.away_wins}负`;
      return text;
    };
    $('jc-match-list').innerHTML = data.matches.map(row => `<article class="match-row"><div class="match-order">${safe(row.code.replace(/^\D+/, ''))}</div><div><div class="match-name">${safe(row.code)} ${safe(row.home)} vs ${safe(row.away)}</div><div class="match-meta">${safe(row.league)} · 开赛 ${safe(time(row.kickoff))} · 停售 ${safe(time(row.deadline))}${row.home_rank && row.away_rank ? ` · 排名 ${safe(row.home_rank)}/${safe(row.away_rank)}` : ''}${safe(dynText(row))}</div>${marketLine('胜平负', row.spf)}${marketLine('让球胜平负', row.rq, row.handicap)}</div></article>`).join('');
    const source = data.source || {};
    $('jc-sources').innerHTML = source.url ? `<a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.name)}</a>` : '';
    $('jingcai-content').hidden = false;
  }

  const load = url => fetch(url,{cache:'no-store'}).then(response => {
    if (!response.ok) throw new Error('数据读取失败');
    return response.json();
  });
  load('/api/jingcai-current')
    .catch(() => load('./data/jingcai/current.json'))
    .then(render)
    .catch(() => { $('jingcai-error').hidden = false; });
})();
