(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const money = n => '¥' + Number(n).toLocaleString('zh-CN');
  const balls = digits =>
    `<div class="ball-row latest-balls">${digits.map(d => `<span class="ball front">${d}</span>`).join('')}</div>`;
  const POS = ['百位', '十位', '个位'];
  const TITLES = { trend: '走势解读', hot_cold: '冷热研判', structure: '结构分析', basis: '推荐依据', risk: '风险提示' };

  function render(data) {
    const latest = data.latest;
    $('pl3-latest').innerHTML = `<div class="match-meta">第 ${safe(latest.issue)} 期 · ${safe(latest.date)} · 和值 ${latest.digits.reduce((a, b) => a + b, 0)}</div>${balls(latest.digits)}`;

    const dt = data.detail;
    $('pl3-detail').innerHTML = dt
      ? `<div class="issue-meta">
           <div class="metric"><small>和值</small><strong>${safe(dt.sum)}</strong></div>
           <div class="metric"><small>跨度</small><strong>${safe(dt.span)}</strong></div>
           ${dt.form ? `<div class="metric"><small>形态</small><strong>${safe(dt.form)}</strong></div>` : ''}
           <div class="metric"><small>奇偶</small><strong>${safe(dt.odd_count)} 奇 · ${latest.digits.length - dt.odd_count} 偶</strong></div>
           ${dt.trycode ? `<div class="metric"><small>试机号</small><strong>${dt.trycode.join(' ')}</strong></div>` : ''}
           ${dt.sales ? `<div class="metric"><small>本期销售额</small><strong>${money(dt.sales)}</strong></div>` : ''}
           ${dt.direct_count ? `<div class="metric"><small>直选</small><strong>${safe(dt.direct_count)} 注 · ${money(dt.direct_prize || 1040)}</strong></div>` : ''}
           ${dt.group3_count ? `<div class="metric"><small>组三</small><strong>${safe(dt.group3_count)} 注 · ${money(dt.group3_prize || 346)}</strong></div>` : ''}
           ${dt.group6_count ? `<div class="metric"><small>组六</small><strong>${safe(dt.group6_count)} 注 · ${money(dt.group6_prize || 173)}</strong></div>` : ''}
         </div>`
      : '<p class="hint">开奖详情暂缺。</p>';

    const an = data.analysis;
    $('pl3-analysis').innerHTML = an
      ? `<div class="match-meta">目标第 ${safe(an.target_issue)} 期 · ${safe(an.target_date)} 开奖 · 统计引擎（全部结论可溯源到历史数据）</div>` +
        Object.keys(TITLES).filter(k => an.sections[k]).map(k =>
          `<div class="ai-section"><strong>${TITLES[k]}</strong><span>${safe(an.sections[k])}</span></div>`).join('')
      : '<p class="hint">综合分析生成中，请稍后再看。</p>';

    const plans = data.plans;
    $('pl3-single').innerHTML = plans && plans.single
      ? `<div class="match-meta">目标第 ${safe(plans.target_issue)} 期 · ${safe(plans.target_date)} · 均衡评分最高的一注直选（已锁定）</div>${balls(plans.single.digits)}` +
        `<div class="match-meta">评分依据：${plans.single.basis.map(b => `${POS[b.position]} ${b.digit}（频次${b.freq100}/遗漏${b.omission}/分${b.score}）`).join('、')}</div>`
      : '<p class="hint">唯一推荐生成中。</p>';
    $('pl3-combo').innerHTML = plans && plans.combo
      ? `<div class="match-meta">直选复式（各位高分数字池）· 共 ${safe(plans.combo.bets)} 注 · ¥${safe(plans.combo.cost_yuan)}</div>` +
        plans.combo.pools.map((pool, i) => `<div class="match-meta">${POS[i]}：${pool.join('、')}</div>`).join('') +
        (plans.combo.group_play ? `<div class="match-meta">组选参考：${safe(plans.combo.group_play.type)} ${plans.combo.group_play.digits.join(' ')}</div>` : '')
      : '<p class="hint">组合推荐生成中。</p>';

    const rec = data.recommendations;
    $('pl3-picks').innerHTML = rec
      ? `<div class="match-meta">目标第 ${safe(rec.target_issue)} 期 · ${safe(rec.target_date)} 开奖</div>` +
        rec.picks.map(pk => `<div class="match-meta"><strong>${safe(pk.strategy)}</strong></div>${balls(pk.digits)}`).join('')
      : '<p class="hint">本期推荐生成中，请稍后再看。</p>';

    const rv = data.review;
    $('pl3-review').innerHTML = rv
      ? `<div class="match-meta">第 ${safe(rv.issue)} 期实际开奖 ${rv.actual.digits.join(' ')}，当期锁定推荐的命中情况：</div>` +
        rv.results.map(r => `<div class="match-meta"><strong>${safe(r.strategy)}</strong>（${r.digits.join(' ')}）：同位命中 ${r.position_hits}/${r.digits.length}${r.direct_hit ? ' · 直选全中 ✔' : ''}${r.group_hit ? ' · 组选命中 ✔' : ''}</div>`).join('')
      : '<p class="hint">暂无可复盘的上期推荐（推荐自本期起锁定，下一期开奖后生成复盘）。</p>';

    const s = data.stats;
    if (s) {
      const table = (title, freqArr, omitArr) =>
        `<div class="match-meta"><strong>${title}</strong>（号码:频次/遗漏）</div>` +
        freqArr.map((perPos, pos) =>
          `<div class="match-meta">${POS[pos]}：${perPos.map((v, d) => `${d}:${v}/${omitArr[pos][d]}`).join(' · ')}</div>`).join('');
      $('pl3-stats').innerHTML =
        `<div class="match-meta">数据库共 ${safe(s.total_draws)} 期（2004 年至今）· 近100期最常见和值 ${safe(s.common_sum_100)}</div>` +
        POS.map((name, pos) =>
          `<div class="match-meta">$排列三：🔥 热号 <span class="plan-chip">${s.hot[pos]}</span>（近100期 ${s.frequency_100.per_position[pos][s.hot[pos]]} 次） · ❄️ 冷号 <span class="plan-chip">${s.cold[pos]}</span>（遗漏 ${s.omission.per_position[pos][s.cold[pos]]} 期）</div>`).join('') +
        table('各位 · 近100期频次/遗漏', s.frequency_100.per_position, s.omission.per_position) +
        table('各位 · 全历史频次/遗漏', s.frequency_all.per_position, s.omission.per_position) +
        `<div class="match-meta"><strong>近100期和值分布</strong>：${s.sum_hist_100.map((v, sum) => v ? `${sum}:${v}` : '').filter(Boolean).join(' · ')}</div>`;
    } else {
      $('pl3-stats').innerHTML = '<p class="hint">统计数据暂时不可用。</p>';
    }

    initHistory(data);
    const source = data.source || {};
    $('pl3-sources').innerHTML = source.url
      ? `<a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.name)}</a>`
      : '';
    $('pl3-content').hidden = false;
  }


  // ---- 历史开奖：默认收起 + 期号搜索 + 分页展开 + 点开看单期详情 ----
  const HIST_INIT = 10, HIST_PAGE = 50;
  function initHistory(data) {
    const all = data.draws || [];
    const box = $('pl3-history');
    if (!box) return;
    let shown = HIST_INIT, query = '', openIssue = null;
    const cache = new Map();
    box.innerHTML =
      '<div class="hist-tools">' +
        '<input class="hist-q" type="search" inputmode="numeric" placeholder="按期号搜索，如 26274" aria-label="按期号搜索">' +
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
        '<div><div class="match-name">' + dr.digits.join(' ') + '</div>' +
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
          const r = await fetch('/api/pl3?issue=' + encodeURIComponent(issue), { cache: 'no-store' });
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

    function digitForm(digits) {
      const counts = {};
      digits.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
      const sizes = Object.values(counts).sort((a, b) => b - a);
      if (digits.length === 3) return sizes[0] === 3 ? '豹子' : sizes[0] === 2 ? '组三' : '组六';
      return ({ '5': '五同', '4,1': '四同', '3,2': '三带二', '3,1,1': '三同', '2,2,1': '两对', '2,1,1,1': '一对', '1,1,1,1,1': '全不同' })[sizes.join(',')] || '其他';
    }
    function detailHtml(d, dr) {
      if (!dr) return '<p class="hint">详情暂不可用。</p>';
      const digits = dr.digits;
      const c = (d && d.computed) || {
        sum: digits.reduce((a, b) => a + b, 0),
        span: Math.max(...digits) - Math.min(...digits),
        form: digitForm(digits),
        odd_count: digits.filter(x => x % 2 === 1).length,
        big_count: digits.filter(x => x >= 5).length,
      };
      let html = '<div class="match-name">' + digits.join(' ') + '</div>' +
        '<div class="match-meta">和值 ' + c.sum + ' · 跨度 ' + c.span + ' · 形态 ' + safe(c.form) + ' · 奇偶 ' + c.odd_count + ':' + (digits.length - c.odd_count) + ' · 大小（≥5）' + c.big_count + ':' + (digits.length - c.big_count) + '</div>';

      if (d && d.recommendations) {
        html += '<div class="match-meta"><strong>本站当期锁定推荐复盘</strong></div>' + d.recommendations.map(r =>
          '<div class="match-meta"><strong>' + safe(r.strategy) + '</strong>：' + r.digits.join(' ') +
          ' → 同位命中 ' + r.position_hits + ' 位' + (r.direct_hit ? ' · 直选全中 ✔' : '') +
          (r.group_hit ? ' · 组选命中 ✔' : '') + '</div>').join('');
      }
      if (d && d.plans) {
        if (d.plans.single) html += '<div class="match-meta"><strong>当期唯一推荐</strong>：' + d.plans.single.digits.join(' ') + '</div>';
        if (d.plans.combo) html += '<div class="match-meta"><strong>当期组合推荐</strong>：各位池 ' + d.plans.combo.pools.map(p => p.join('/')).join(' · ') + '（' + safe(d.plans.combo.bets) + ' 注 · ' + safe(d.plans.combo.cost_yuan) + ' 元）</div>';
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
  load('/api/pl3')
    .catch(() => load('./data/pl3_history.json').then(raw => {
      const draws = [...raw.issues].reverse();
      return { latest: draws[0], draws, stats: null, recommendations: null, detail: null, plans: null, analysis: null, review: null, source: { name: '500彩票网排列三历史开奖', url: 'https://kaijiang.500.com/pls.shtml' } };
    }))
    .then(render)
    .catch(() => { $('pl3-error').hidden = false; });
})();
