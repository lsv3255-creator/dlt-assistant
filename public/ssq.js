(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const pad = n => String(n).padStart(2, '0');
  const balls = (red, blue) =>
    `<div class="ball-row latest-balls">${red.map(n => `<span class="ball front">${pad(n)}</span>`).join('')}<span class="ball back">${pad(blue)}</span></div>`;

  function render(data) {
    const latest = data.latest;
    $('ssq-latest').innerHTML = `<div class="match-meta">第 ${safe(latest.issue)} 期 · ${safe(latest.date)}</div>${balls(latest.red, latest.blue)}`;
    const rec = data.recommendations;
    $('ssq-picks').innerHTML = rec
      ? `<div class="match-meta">目标第 ${safe(rec.target_issue)} 期 · ${safe(rec.target_date)} 开奖</div>` +
        rec.picks.map(p => `<div class="match-meta"><strong>${safe(p.strategy)}</strong></div>${balls(p.red, p.blue)}`).join('')
      : '<p class="hint">本期推荐生成中，请稍后再看。</p>';
    const s = data.stats;
    if (s) {
      const chips = nums => nums.map(n => `<span class="plan-chip">${pad(n)}</span>`).join('');
      $('ssq-stats').innerHTML =
        `<div class="match-meta">数据库共 ${safe(s.total_draws)} 期（2003 年至今）</div>` +
        `<div class="match-meta">🔥 红球热号（近100期）：${chips(s.hot.red)} · 蓝球：${chips(s.hot.blue)}</div>` +
        `<div class="match-meta">❄️ 红球冷号（遗漏最久）：${chips(s.cold.red)} · 蓝球：${chips(s.cold.blue)}</div>` +
        `<div class="match-meta">遗漏前列：红球 ${s.cold.red.map(n => `${pad(n)}(${s.omission.red[n - 1]}期)`).join('、')}；蓝球 ${s.cold.blue.map(n => `${pad(n)}(${s.omission.blue[n - 1]}期)`).join('、')}</div>`;
    } else {
      $('ssq-stats').innerHTML = '<p class="hint">统计数据暂时不可用。</p>';
    }
    $('ssq-history').innerHTML =
      `<div class="match-list">${data.draws.slice(0, 50).map(d =>
        `<article class="match-row"><div class="match-order">${safe(d.issue.slice(-3))}</div><div><div class="match-name">${d.red.map(pad).join(' ')} + ${pad(d.blue)}</div><div class="match-meta">第 ${safe(d.issue)} 期 · ${safe(d.date)}</div></div></article>`).join('')}</div>`;
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
      return { latest: draws[0], draws, stats: null, recommendations: null, source: { name: '500彩票网双色球历史开奖', url: 'https://datachart.500.com/ssq/history/newinc/history.php' } };
    }))
    .then(render)
    .catch(() => { $('ssq-error').hidden = false; });
})();
