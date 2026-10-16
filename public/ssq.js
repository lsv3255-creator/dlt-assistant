(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const pad = n => String(n).padStart(2, '0');
  const money = n => '¥' + Number(n).toLocaleString('zh-CN');
  const balls = (red, blue) =>
    `<div class="ball-row latest-balls">${red.map(n => `<span class="ball front">${pad(n)}</span>`).join('')}<span class="ball back">${pad(blue)}</span></div>`;
  const TITLES = { trend: '走势解读', hot_cold: '冷热研判', structure: '结构分析', basis: '推荐依据', risk: '风险提示' };

  function render(data) {
    const latest = data.latest;
    $('ssq-latest').innerHTML = `<div class="match-meta">第 ${safe(latest.issue)} 期 · ${safe(latest.date)}</div>${balls(latest.red, latest.blue)}`;

    const d = data.detail;
    $('ssq-detail').innerHTML = d
      ? `<div class="issue-meta">
           <div class="metric"><small>奖池滚存</small><strong>${money(d.pool)}</strong></div>
           <div class="metric"><small>本期销售额</small><strong>${money(d.sales)}</strong></div>
           <div class="metric"><small>一等奖</small><strong>${safe(d.first_count)} 注 · ${money(d.first_prize)}</strong></div>
           <div class="metric"><small>二等奖</small><strong>${safe(d.second_count)} 注 · ${money(d.second_prize)}</strong></div>
         </div>`
      : '<p class="hint">本期详细公告数据暂缺（数据源未提供该期销售与奖级信息）。</p>';

    const an = data.analysis;
    $('ssq-analysis').innerHTML = an
      ? `<div class="match-meta">目标第 ${safe(an.target_issue)} 期 · ${safe(an.target_date)} 开奖 · 统计引擎（全部结论可溯源到历史数据）</div>` +
        Object.keys(TITLES).filter(k => an.sections[k]).map(k =>
          `<div class="ai-section"><strong>${TITLES[k]}</strong><span>${safe(an.sections[k])}</span></div>`).join('')
      : '<p class="hint">综合分析生成中，请稍后再看。</p>';

    const plans = data.plans;
    $('ssq-single').innerHTML = plans && plans.single
      ? `<div class="match-meta">目标第 ${safe(plans.target_issue)} 期 · ${safe(plans.target_date)} · 均衡评分最高的一注（已锁定）</div>${balls(plans.single.red, plans.single.blue)}` +
        `<div class="match-meta">评分依据（红球：近100期频次 / 当前遗漏 / 均衡分）：${plans.single.basis.map(b => `${pad(b.number)}(${b.freq100}/${b.omission}/${b.score})`).join('、')}</div>`
      : '<p class="hint">唯一推荐生成中。</p>';
    $('ssq-combo').innerHTML = plans && plans.combo
      ? `<div class="match-meta">红球池（均衡分前 8）+ 蓝球池（前 2）复式 · 共 ${safe(plans.combo.bets)} 注 · ${money(plans.combo.cost_yuan)}</div>${balls(plans.combo.red_pool, plans.combo.blue_pool[0])}` +
        `<div class="match-meta">蓝球池：${plans.combo.blue_pool.map(pad).join('、')}</div>`
      : '<p class="hint">组合推荐生成中。</p>';

    const rec = data.recommendations;
    $('ssq-picks').innerHTML = rec
      ? `<div class="match-meta">目标第 ${safe(rec.target_issue)} 期 · ${safe(rec.target_date)} 开奖</div>` +
        rec.picks.map(p => `<div class="match-meta"><strong>${safe(p.strategy)}</strong></div>${balls(p.red, p.blue)}`).join('')
      : '<p class="hint">本期推荐生成中，请稍后再看。</p>';

    const rv = data.review;
    $('ssq-review').innerHTML = rv
      ? `<div class="match-meta">第 ${safe(rv.issue)} 期实际开奖 ${rv.actual.red.map(pad).join(' ')} + ${pad(rv.actual.blue)}，当期锁定推荐的命中情况：</div>` +
        rv.results.map(r => `<div class="match-meta"><strong>${safe(r.strategy)}</strong>：红球命中 ${r.red_hits.length} 个${r.red_hits.length ? '（' + r.red_hits.map(pad).join('、') + '）' : ''} · 蓝球${r.blue_hit ? '命中 ✔' : '未中'}</div>`).join('')
      : '<p class="hint">暂无可复盘的上期推荐（推荐自本期起锁定，下一期开奖后生成复盘）。</p>';

    const s = data.stats;
    if (s) {
      const chips = nums => nums.map(n => `<span class="plan-chip">${pad(n)}</span>`).join('');
      const table = (title, freq, omit) =>
        `<div class="match-meta"><strong>${title}</strong></div><div class="match-meta">` +
        freq.map((v, i) => `${pad(i + 1)}:${v}/${omit[i]}`).join(' · ') + '</div>';
      const maxSum = Math.max(...s.sum_hist_100, 1);
      $('ssq-stats').innerHTML =
        `<div class="match-meta">数据库共 ${safe(s.total_draws)} 期（2003 年至今）· 格式为 号码:频次/遗漏期数</div>` +
        `<div class="match-meta">🔥 红球热号（近100期）：${chips(s.hot.red)} · 蓝球：${chips(s.hot.blue)}</div>` +
        `<div class="match-meta">❄️ 红球冷号（遗漏最久）：${chips(s.cold.red)} · 蓝球：${chips(s.cold.blue)}</div>` +
        table('红球 · 近100期频次/遗漏', s.frequency_100.red, s.omission.red) +
        table('红球 · 全历史频次/遗漏', s.frequency_all.red, s.omission.red) +
        table('蓝球 · 近100期频次/遗漏', s.frequency_100.blue, s.omission.blue) +
        `<div class="match-meta"><strong>近100期和值分布</strong>：${s.sum_hist_100.map((v, i) => v ? `${i * 10}-${i * 10 + 9}:${v}` : '').filter(Boolean).join(' · ')}</div>` +
        `<div class="match-meta"><strong>近100期红球奇数个数分布</strong>：${s.odd_counts_100.map((v, i) => `${i}奇:${v}`).join(' · ')}</div>`;
    } else {
      $('ssq-stats').innerHTML = '<p class="hint">统计数据暂时不可用。</p>';
    }

    $('ssq-history').innerHTML =
      `<div class="match-list">${data.draws.slice(0, 50).map(dr =>
        `<article class="match-row"><div class="match-order">${safe(dr.issue.slice(-3))}</div><div><div class="match-name">${dr.red.map(pad).join(' ')} + ${pad(dr.blue)}</div><div class="match-meta">第 ${safe(dr.issue)} 期 · ${safe(dr.date)}</div></div></article>`).join('')}</div>`;
    const source = data.source || {};
    $('ssq-sources').innerHTML = source.url
      ? `<a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.name)}</a>`
      : '';
    $('ssq-content').hidden = false;
  }

  const load = url => fetch(url, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error('数据读取失败');
    return r.json();
  });
  load('/api/ssq')
    .catch(() => load('./data/ssq_history.json').then(raw => {
      const draws = [...raw.issues].reverse();
      return { latest: draws[0], draws, stats: null, recommendations: null, detail: null, plans: null, analysis: null, review: null, source: { name: '500彩票网双色球历史开奖', url: 'https://datachart.500.com/ssq/history/newinc/history.php' } };
    }))
    .then(render)
    .catch(() => { $('ssq-error').hidden = false; });
})();
