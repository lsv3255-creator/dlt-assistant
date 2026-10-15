(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const balls = digits =>
    `<div class="ball-row latest-balls">${digits.map(d => `<span class="ball front">${d}</span>`).join('')}</div>`;
  const POS = ['百位', '十位', '个位'];

  function render(data) {
    const latest = data.latest;
    $('pl3-latest').innerHTML = `<div class="match-meta">第 ${safe(latest.issue)} 期 · ${safe(latest.date)} · 和值 ${latest.digits.reduce((a, b) => a + b, 0)}</div>${balls(latest.digits)}`;
    const rec = data.recommendations;
    $('pl3-picks').innerHTML = rec
      ? `<div class="match-meta">目标第 ${safe(rec.target_issue)} 期 · ${safe(rec.target_date)} 开奖</div>` +
        rec.picks.map(p => `<div class="match-meta"><strong>${safe(p.strategy)}</strong></div>${balls(p.digits)}`).join('')
      : '<p class="hint">本期推荐生成中，请稍后再看。</p>';
    const s = data.stats;
    if (s) {
      $('pl3-stats').innerHTML =
        `<div class="match-meta">数据库共 ${safe(s.total_draws)} 期（2004 年至今）· 近100期最常见和值 ${safe(s.common_sum_100)}</div>` +
        POS.map((name, pos) =>
          `<div class="match-meta">${name}：🔥 热号 <span class="plan-chip">${s.hot[pos]}</span>（近100期 ${s.frequency_100.per_position[pos][s.hot[pos]]} 次） · ❄️ 冷号 <span class="plan-chip">${s.cold[pos]}</span>（已遗漏 ${s.omission.per_position[pos][s.cold[pos]]} 期）</div>`).join('');
    } else {
      $('pl3-stats').innerHTML = '<p class="hint">统计数据暂时不可用。</p>';
    }
    $('pl3-history').innerHTML =
      `<div class="match-list">${data.draws.slice(0, 50).map(d =>
        `<article class="match-row"><div class="match-order">${safe(d.issue.slice(-3))}</div><div><div class="match-name">${d.digits.join(' ')}</div><div class="match-meta">第 ${safe(d.issue)} 期 · ${safe(d.date)} · 和值 ${d.digits.reduce((a, b) => a + b, 0)}</div></div></article>`).join('')}</div>`;
    const source = data.source || {};
    $('pl3-sources').innerHTML = source.url
      ? `<a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.name)}</a>`
      : '';
    $('pl3-content').hidden = false;
  }

  const load = url => fetch(url, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error('数据读取失败');
    return r.json();
  });
  load('/api/pl3')
    .catch(() => load('./data/pl3_history.json').then(raw => {
      const draws = [...raw.issues].reverse();
      return { latest: draws[0], draws, stats: null, recommendations: null, source: { name: '500彩票网排列三历史开奖', url: 'https://kaijiang.500.com/pls.shtml' } };
    }))
    .then(render)
    .catch(() => { $('pl3-error').hidden = false; });
})();
