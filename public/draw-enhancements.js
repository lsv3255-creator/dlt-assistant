/* Additive homepage modules: never changes the primary, snapshot, storage or review. */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '—' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function json(path) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    return fetch(path, {cache: 'no-cache', signal: controller.signal}).then(function (r) {
      if (!r.ok) throw new Error('unavailable');
      return r.json();
    }).finally(function () { clearTimeout(timer); });
  }
  function money(n) { return n == null ? '待官方公布' : esc(Number(String(n).replace(/,/g, '')).toLocaleString('zh-CN', {maximumFractionDigits: 2})) + ' 元'; }
  function balls(ns, zone) { return ns.map(function (n) { return '<span class="ball '+zone+'">'+String(n).padStart(2,'0')+'</span>'; }).join(' '); }
  function same(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
  var detailsRoot = document.getElementById('draw-details-body');
  Promise.all([json('./data/dlt_history.json'), json('./data/draw_details.json')]).then(function (data) {
    var history = data[0].issues || [], rows = data[1].issues || [];
    var verified = rows.filter(function (r) {
      var h = history.find(function (x) { return String(x.issue) === String(r.issue); });
      return h && h.date === r.date && same(h.front,r.front) && same(h.back,r.back);
    }).sort(function (a,b) { return String(b.issue).localeCompare(String(a.issue)); });
    var latest = history.slice().sort(function (a,b) { return String(b.issue).localeCompare(String(a.issue)); })[0];
    var select = document.getElementById('draw-detail-issue');
    var ids = [String(latest.issue)].concat(verified.map(function (r) { return String(r.issue); })).filter(function (id,i,all) { return all.indexOf(id) === i; });
    select.innerHTML = ids.map(function (id) { return '<option value="'+esc(id)+'">第 '+esc(id)+' 期</option>'; }).join('');
    function render() {
      var r = verified.find(function (x) { return String(x.issue) === select.value; });
      if (!r) { detailsRoot.textContent = '本期开奖奖金详情待官方核验，开奖号码可在上方查看。'; return; }
      var body = '';
      Object.keys(r.prizes).forEach(function (level) {
        var tier = r.prizes[level];
        var variants = tier.basic ? [['基本',tier.basic],['追加',tier.additional]] : [['基本',tier]];
        variants.forEach(function (v) {
          if (!v[1]) return;
          body += '<tr><td>'+esc(level)+' · '+v[0]+'</td><td>'+esc(v[1].winners)+'</td><td>'+money(v[1].per_ticket_yuan)+'</td><td>'+money(v[1].total_yuan)+'</td></tr>';
        });
      });
      var source = '';
      try { var url = new URL(r.source_url); if (url.protocol === 'https:' && url.hostname === 'www.js-lottery.com') source = '<a href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">'+esc(r.source_name)+' · 原始公告</a>'; } catch(e) {}
      detailsRoot.innerHTML = '<p>'+esc(r.date)+' · 第 '+esc(r.issue)+' 期</p><div class="ball-row">'+balls(r.front,'front')+balls(r.back,'back')+'</div>'+
        '<p>全国销售额：<strong>'+money(r.sales_yuan)+'</strong><br>滚入下期奖池：<strong>'+money(r.jackpot_yuan)+'</strong><br>兑奖截止：'+esc(r.claim_deadline)+'</p>'+
        '<div style="overflow-x:auto"><table style="width:100%;min-width:480px;text-align:left"><thead><tr><th>奖级</th><th>中奖注数</th><th>每注奖金</th><th>奖金合计</th></tr></thead><tbody>'+body+'</tbody></table></div><p class="hint">追加行仅为追加部分奖金。'+source+'</p>';
    }
    select.onchange = render; render();
    document.getElementById('draw-detail-coverage').textContent = '已核验 '+verified.length+' 期开奖公告；仅展示与号码、日期一致的详情。历史缺期持续补录。';
  }).catch(function () { detailsRoot.textContent = '开奖详情暂不可用，请稍后重试。上方号码与其他功能不受影响。'; });

  var compoundRoot = document.getElementById('compound-body');
  Promise.all([json('./data/compound_recommendation.json'),json('./data/recommendations.json'),json('./data/dlt_history.json')]).then(function (data) {
    var c = data[0], primaries = data[1].filter(function (r) { return r.is_primary === true; });
    var p = primaries.length === 1 ? primaries[0] : null;
    var latest = data[2].issues.reduce(function (m,h) { return String(h.issue)>m ? String(h.issue) : m; },'');
    var chosen = (c.candidates || []).find(function (r) { return r.format === c.selected_format; });
    function valid(ns, size, max) { return Array.isArray(ns) && ns.length === size && new Set(ns).size === size && ns.every(function(n) { return Number.isInteger(n) && n>=1 && n<=max; }); }
    var counts = chosen ? chosen.format.split('+').map(Number) : [];
    var primaryMatches = p && c.primary && same(p.front.slice().sort(function(a,b){return a-b;}),c.primary.front) && same(p.back.slice().sort(function(a,b){return a-b;}),c.primary.back);
    if (!primaryMatches || !['8+4','10+3'].includes(c.selected_format) || c.game_id !== 'dlt' || c.schema_version !== 1 || String(c.target_issue)!==String(p.target_issue) || String(c.target_issue)<=latest || !chosen || !valid(chosen.front,counts[0],35) || !valid(chosen.back,counts[1],12) || !p.front.every(function(n){return chosen.front.includes(n);}) || !p.back.every(function(n){return chosen.back.includes(n);})) throw new Error('identity mismatch');
    function comb(n,k) { var v=1; for(var i=1;i<=k;i++) v=v*(n-i+1)/i; return Math.round(v); }
    var tickets=comb(counts[0],5)*comb(counts[1],2);
    if (chosen.tickets!==tickets || chosen.basic_yuan!==tickets*2 || chosen.additional_yuan!==tickets*3) throw new Error('cost mismatch');
    var ai = c.ai && c.ai.status === 'completed';
    var intro = ai ? 'AI 强力推荐 · 模型 '+esc(c.ai.model)+' 已完成复式方案选择与数据依据复核。' : '统计模型组合推荐 · AI 模型分析尚未接入，本期为可追溯的统计扩展方案。';
    var refs = ai ? c.ai.factor_refs : chosen.front.slice(0,3).map(function(n){return 'front:'+n;});
    var factors = refs.map(function(ref) { var parts=ref.split(':'), zone=parts[0], n=parts[1]; return '<li>'+ (zone==='front'?'前区':'后区')+' '+esc(n)+'：最近 '+esc(c.window)+' 期出现 '+esc(c.evidence[zone][n])+' 次。</li>'; }).join('');
    compoundRoot.innerHTML = '<p><strong>'+intro+'</strong></p><p>第 '+esc(c.target_issue)+' 期 · '+esc(chosen.format)+' 复式 · 本期已冻结</p>'+
      '<div class="ball-row" style="flex-wrap:wrap">'+balls(chosen.front,'front')+'</div><div class="ball-row" style="flex-wrap:wrap;margin-top:10px">'+balls(chosen.back,'back')+'</div>'+
      '<p><strong>'+tickets+' 注 · 基本投注 '+money(chosen.basic_yuan)+'</strong><br>如全部追加：'+money(chosen.additional_yuan)+'（含基本投注）</p>'+
      '<p>保留原正式单注全部号码，依据最近 '+esc(c.window)+' 期出现频率补足号码；同频按号码顺序处理。数据截止 '+esc(c.history_cutoff)+' 期。</p><ul>'+factors+'</ul>'+
      '<p class="hint">复式是一组多注组合，预算明显高于单注。AI 参与方案选择与依据分析，不保证中奖，评分与频率不代表中奖概率。</p>';
  }).catch(function () { compoundRoot.textContent = '本期组合推荐待发布或核验；原有正式单注推荐保持可用。'; });
})();
