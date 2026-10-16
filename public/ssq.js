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

    initHistory(data);
    const source = data.source || {};
    $('ssq-sources').innerHTML = source.url
      ? `<a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.name)}</a>`
      : '';
    $('ssq-content').hidden = false;
  }


  // ---- 历史开奖：默认收起 + 期号搜索 + 分页展开 + 点开看单期详情 ----
  const HIST_INIT = 10, HIST_PAGE = 50;
  function initHistory(data) {
    const all = data.draws || [];
    const box = $('ssq-history');
    if (!box) return;
    let shown = HIST_INIT, query = '', openIssue = null;
    const cache = new Map();
    box.innerHTML =
      '<div class="hist-tools">' +
        '<input class="hist-q" type="search" inputmode="numeric" placeholder="按期号搜索，如 26118" aria-label="按期号搜索">' +
        '<button class="hist-btn hist-search" type="button">搜索</button>' +
        '<button class="hist-btn hist-clear" type="button" hidden>清除</button>' +
      '</div>' +
      '<div class="match-list hist-list"></div>' +
      '<div class="hist-tools">' +
        '<button class="hist-btn hist-more" type="button">展开历史</button>' +
        '<button class="hist-btn hist-collapse" type="button" hidden>收起</button>' +
        '<span class="hist-count hint"></span>' +
      '</div>';
    const listEl = box.querySelector('.hist-list');
    const qEl = box.querySelector('.hist-q');
    const moreBtn = box.querySelector('.hist-more');
    const collapseBtn = box.querySelector('.hist-collapse');
    const clearBtn = box.querySelector('.hist-clear');
    const countEl = box.querySelector('.hist-count');
    const filtered = () => query ? all.filter(dr => String(dr.issue).includes(query)) : all;
    function rowHtml(dr) {
      return '<article class="match-row hist-row" data-issue="' + safe(dr.issue) + '" role="button" tabindex="0" aria-expanded="false">' +
        '<div class="match-order">' + safe(String(dr.issue).slice(-3)) + '</div>' +
        '<div><div class="match-name">' + dr.red.map(pad).join(' ') + ' + ' + pad(dr.blue) + '</div>' +
        '<div class="match-meta">第 ' + safe(dr.issue) + ' 期 · ' + safe(dr.date) + ' · 点开看详情 ›</div></div></article>' +
        '<div class="hist-detail" data-detail="' + safe(dr.issue) + '" hidden></div>';
    }
    function drawList() {
      const rows = filtered();
      listEl.innerHTML = rows.slice(0, shown).map(rowHtml).join('') || '<p class="hint">没有找到对应期号，换个期号试试。</p>';
      countEl.textContent = '共 ' + rows.length + ' 期 · 已显示 ' + Math.min(shown, rows.length) + ' 期';
      moreBtn.hidden = shown >= rows.length;
      moreBtn.textContent = shown <= HIST_INIT ? '展开历史（更多）' : '加载更多';
      collapseBtn.hidden = !(shown > HIST_INIT || query);
      clearBtn.hidden = !query;
      if (openIssue) {
        const row = listEl.querySelector('.hist-row[data-issue="' + openIssue + '"]');
        const panel = listEl.querySelector('[data-detail="' + openIssue + '"]');
        if (row && panel) { row.setAttribute('aria-expanded', 'true'); panel.hidden = false; panel.innerHTML = detailHtml(cache.get(openIssue), byIssue(openIssue)); }
      }
    }
    const byIssue = issue => all.find(dr => String(dr.issue) === String(issue));
    async function toggle(issue) {
      if (openIssue === issue) { openIssue = null; drawList(); return; }
      openIssue = issue;
      drawList();
      if (!cache.has(issue)) {
        const panel = listEl.querySelector('[data-detail="' + issue + '"]');
        if (panel) panel.innerHTML = '<p class="hint">详情加载中…</p>';
        try {
          const r = await fetch('/api/ssq?issue=' + encodeURIComponent(issue), { cache: 'no-store' });
          if (!r.ok) throw new Error('bad');
          cache.set(issue, await r.json());
        } catch { cache.set(issue, null); }
        if (openIssue === issue) drawList();
      }
    }
    listEl.addEventListener('click', e => {
      const row = e.target.closest('.hist-row');
      if (row) toggle(row.dataset.issue);
    });
    listEl.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('hist-row')) {
        e.preventDefault(); toggle(e.target.dataset.issue);
      }
    });
    moreBtn.addEventListener('click', () => { shown += HIST_PAGE; drawList(); });
    collapseBtn.addEventListener('click', () => { shown = HIST_INIT; drawList(); });
    const doSearch = () => { query = qEl.value.trim(); shown = HIST_PAGE; drawList(); };
    box.querySelector('.hist-search').addEventListener('click', doSearch);
    qEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    clearBtn.addEventListener('click', () => { qEl.value = ''; query = ''; shown = HIST_INIT; drawList(); });

    function detailHtml(d, dr) {
      if (!dr) return '<p class="hint">详情暂不可用。</p>';
      const red = dr.red, blue = dr.blue;
      const c = (d && d.computed) || {
        sum_red: red.reduce((a, b) => a + b, 0),
        odd_red: red.filter(n => n % 2 === 1).length,
        big_red: red.filter(n => n >= 17).length,
        span_red: Math.max(...red) - Math.min(...red),
      };
      let html = balls(red, blue) +
        '<div class="match-meta">红球和值 ' + c.sum_red + ' · 跨度 ' + c.span_red + ' · 奇偶 ' + c.odd_red + ':' + (6 - c.odd_red) + ' · 大小（≥17）' + c.big_red + ':' + (6 - c.big_red) + '</div>';
      if (d && d.detail) {
        const t = d.detail;
        html += '<div class="issue-meta">' +
          '<div class="metric"><small>奖池滚存</small><strong>' + money(t.pool) + '</strong></div>' +
          '<div class="metric"><small>本期销售额</small><strong>' + money(t.sales) + '</strong></div>' +
          '<div class="metric"><small>一等奖</small><strong>' + safe(t.first_count) + ' 注 · ' + money(t.first_prize) + '</strong></div>' +
          '<div class="metric"><small>二等奖</small><strong>' + safe(t.second_count) + ' 注 · ' + money(t.second_prize) + '</strong></div></div>';
      } else {
        html += '<p class="hint">该期官方奖金详情暂缺（数据源未提供）。</p>';
      }
      if (d && d.recommendations) {
        html += '<div class="match-meta"><strong>本站当期锁定推荐复盘</strong></div>' + d.recommendations.map(r =>
          '<div class="match-meta"><strong>' + safe(r.strategy) + '</strong>：' + r.red.map(pad).join(' ') + ' + ' + pad(r.blue) +
          ' → 红球命中 ' + r.red_hits.length + ' 个 · 蓝球' + (r.blue_hit ? '命中 ✔' : '未中') + '</div>').join('');
      }
      if (d && d.plans) {
        if (d.plans.single) html += '<div class="match-meta"><strong>当期唯一推荐</strong>：' + d.plans.single.red.map(pad).join(' ') + ' + ' + pad(d.plans.single.blue) + '</div>';
        if (d.plans.combo) html += '<div class="match-meta"><strong>当期组合推荐</strong>：红 ' + d.plans.combo.red_pool.map(pad).join(' ') + ' · 蓝 ' + d.plans.combo.blue_pool.map(pad).join(' ') + '（' + safe(d.plans.combo.bets) + ' 注）</div>';
      }
      if (!d) html += '<p class="hint">（离线数据模式：仅展示号码与结构统计）</p>';
      return html;
    }

    drawList();
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
