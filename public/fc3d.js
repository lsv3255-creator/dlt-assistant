(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const balls = digits =>
    `<div class="ball-row latest-balls">${digits.map(d => `<span class="ball front">${d}</span>`).join('')}</div>`;
  const POS = ['百位', '十位', '个位'];
  const TITLES = { trend: '走势解读', hot_cold: '冷热研判', structure: '结构分析', basis: '推荐依据', risk: '风险提示' };

  function render(data) {
    const latest = data.latest;
    $('fc3d-latest').innerHTML = `<div class="match-meta">第 ${safe(latest.issue)} 期 · ${safe(latest.date)} · 和值 ${latest.digits.reduce((a, b) => a + b, 0)}</div>${balls(latest.digits)}`;

    const dt = data.detail;
    $('fc3d-detail').innerHTML = dt
      ? `<div class="issue-meta">
           <div class="metric"><small>和值</small><strong>${safe(dt.sum)}</strong></div>
           <div class="metric"><small>跨度</small><strong>${safe(dt.span)}</strong></div>
           ${dt.form ? `<div class="metric"><small>形态</small><strong>${safe(dt.form)}</strong></div>` : ''}
           <div class="metric"><small>奇偶</small><strong>${safe(dt.odd_count)} 奇 · ${latest.digits.length - dt.odd_count} 偶</strong></div>
           ${dt.trycode ? `<div class="metric"><small>试机号</small><strong>${dt.trycode.join(' ')}</strong></div>` : ''}
         </div>`
      : '<p class="hint">开奖详情暂缺。</p>';

    const an = data.analysis;
    $('fc3d-analysis').innerHTML = an
      ? `<div class="match-meta">目标第 ${safe(an.target_issue)} 期 · ${safe(an.target_date)} 开奖 · 统计引擎（全部结论可溯源到历史数据）</div>` +
        Object.keys(TITLES).filter(k => an.sections[k]).map(k =>
          `<div class="ai-section"><strong>${TITLES[k]}</strong><span>${safe(an.sections[k])}</span></div>`).join('')
      : '<p class="hint">综合分析生成中，请稍后再看。</p>';

    const plans = data.plans;
    $('fc3d-single').innerHTML = plans && plans.single
      ? `<div class="match-meta">目标第 ${safe(plans.target_issue)} 期 · ${safe(plans.target_date)} · 均衡评分最高的一注直选（已锁定）</div>${balls(plans.single.digits)}` +
        `<div class="match-meta">评分依据：${plans.single.basis.map(b => `${POS[b.position]} ${b.digit}（频次${b.freq100}/遗漏${b.omission}/分${b.score}）`).join('、')}</div>`
      : '<p class="hint">唯一推荐生成中。</p>';
    $('fc3d-combo').innerHTML = plans && plans.combo
      ? `<div class="match-meta">直选复式（各位高分数字池）· 共 ${safe(plans.combo.bets)} 注 · ¥${safe(plans.combo.cost_yuan)}</div>` +
        plans.combo.pools.map((pool, i) => `<div class="match-meta">${POS[i]}：${pool.join('、')}</div>`).join('') +
        (plans.combo.group_play ? `<div class="match-meta">组选参考：${safe(plans.combo.group_play.type)} ${plans.combo.group_play.digits.join(' ')}</div>` : '')
      : '<p class="hint">组合推荐生成中。</p>';

    const rec = data.recommendations;
    $('fc3d-picks').innerHTML = rec
      ? `<div class="match-meta">目标第 ${safe(rec.target_issue)} 期 · ${safe(rec.target_date)} 开奖</div>` +
        rec.picks.map(pk => `<div class="match-meta"><strong>${safe(pk.strategy)}</strong></div>${balls(pk.digits)}`).join('')
      : '<p class="hint">本期推荐生成中，请稍后再看。</p>';

    const rv = data.review;
    $('fc3d-review').innerHTML = rv
      ? `<div class="match-meta">第 ${safe(rv.issue)} 期实际开奖 ${rv.actual.digits.join(' ')}，当期锁定推荐的命中情况：</div>` +
        rv.results.map(r => `<div class="match-meta"><strong>${safe(r.strategy)}</strong>（${r.digits.join(' ')}）：同位命中 ${r.position_hits}/${r.digits.length}${r.direct_hit ? ' · 直选全中 ✔' : ''}${r.group_hit ? ' · 组选命中 ✔' : ''}</div>`).join('')
      : '<p class="hint">暂无可复盘的上期推荐（推荐自本期起锁定，下一期开奖后生成复盘）。</p>';

    const s = data.stats;
    if (s) {
      const table = (title, freqArr, omitArr) =>
        `<div class="match-meta"><strong>${title}</strong>（号码:频次/遗漏）</div>` +
        freqArr.map((perPos, pos) =>
          `<div class="match-meta">${POS[pos]}：${perPos.map((v, d) => `${d}:${v}/${omitArr[pos][d]}`).join(' · ')}</div>`).join('');
      $('fc3d-stats').innerHTML =
        `<div class="match-meta">数据库共 ${safe(s.total_draws)} 期（2004 年至今）· 近100期最常见和值 ${safe(s.common_sum_100)}</div>` +
        POS.map((name, pos) =>
          `<div class="match-meta">$福彩3D：🔥 热号 <span class="plan-chip">${s.hot[pos]}</span>（近100期 ${s.frequency_100.per_position[pos][s.hot[pos]]} 次） · ❄️ 冷号 <span class="plan-chip">${s.cold[pos]}</span>（遗漏 ${s.omission.per_position[pos][s.cold[pos]]} 期）</div>`).join('') +
        table('各位 · 近100期频次/遗漏', s.frequency_100.per_position, s.omission.per_position) +
        table('各位 · 全历史频次/遗漏', s.frequency_all.per_position, s.omission.per_position) +
        `<div class="match-meta"><strong>近100期和值分布</strong>：${s.sum_hist_100.map((v, sum) => v ? `${sum}:${v}` : '').filter(Boolean).join(' · ')}</div>`;
    } else {
      $('fc3d-stats').innerHTML = '<p class="hint">统计数据暂时不可用。</p>';
    }

    $('fc3d-history').innerHTML =
      `<div class="match-list">${data.draws.slice(0, 50).map(d =>
        `<article class="match-row"><div class="match-order">${safe(d.issue.slice(-3))}</div><div><div class="match-name">${d.digits.join(' ')}</div><div class="match-meta">第 ${safe(d.issue)} 期 · ${safe(d.date)} · 和值 ${d.digits.reduce((a, b) => a + b, 0)}</div></div></article>`).join('')}</div>`;
    const source = data.source || {};
    $('fc3d-sources').innerHTML = source.url
      ? `<a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.name)}</a>`
      : '';
    $('fc3d-content').hidden = false;
  }

  const load = url => fetch(url, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error('数据读取失败');
    return r.json();
  });
  load('/api/fc3d')
    .catch(() => load('./data/fc3d_history.json').then(raw => {
      const draws = [...raw.issues].reverse();
      return { latest: draws[0], draws, stats: null, recommendations: null, detail: null, plans: null, analysis: null, review: null, source: { name: '500彩票网福彩3D历史开奖', url: 'https://kaijiang.500.com/sd.shtml' } };
    }))
    .then(render)
    .catch(() => { $('fc3d-error').hidden = false; });
})();
