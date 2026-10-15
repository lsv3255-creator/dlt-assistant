/* Reads independent AI records. Never blocks the core homepage or changes numbers. */
(function () {
  'use strict';
  var ids=['ai-overview','ai-single','ai-compound','ai-review','ai-next'];
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function set(id,html){var el=document.getElementById(id);if(el)el.innerHTML=html;}
  function json(path){var controller=new AbortController();var timer=setTimeout(function(){controller.abort();},8000);return fetch('./data/'+path,{cache:'no-cache',signal:controller.signal}).then(function(r){if(!r.ok)throw Error('unavailable');return r.json();}).finally(function(){clearTimeout(timer);});}
  function sorted(a){return Array.isArray(a)?a.slice().sort(function(x,y){return x-y;}):[];}
  function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function ns(a,b){return a&&b&&same(sorted(a.front),sorted(b.front))&&same(sorted(a.back),sorted(b.back));}
  function readable(text){
    var labels={prior_analysis:'开奖前AI分析',reason_audit:'推荐理由依据',uncertainty:'不确定性说明',single_outcome:'单注结果',compound_outcome:'复式结果',structure_comparison:'开奖结构对比',original_statistical_basis:'历史统计依据',single_selection:'单注综合评分',single_structure:'单注结构',compound_structure:'复式结构',compound_budget:'复式注数与成本',candidate_comparison:'方案比较',history_window:'历史样本范围',selection_role:'AI分析说明',previous_review:'上期复盘','historical frequency':'历史频率',gap:'遗漏'};
    return text.replace(/prior_analysis|reason_audit|uncertainty|single_outcome|compound_outcome|structure_comparison|original_statistical_basis|single_selection|single_structure|compound_structure|compound_budget|candidate_comparison|history_window|selection_role|previous_review|historical frequency|\bgap\b/g,function(key){return labels[key];});
  }
  function section(record,key,title){
    var s=record.sections&&record.sections[key];
    if(!s||typeof s.text!=='string'||!Array.isArray(s.evidence_ids))throw Error('bad AI section');
    var facts=s.evidence_ids.map(function(id){if(typeof record.evidence[id]!=='string')throw Error('bad citation');return '<li>'+esc(readable(record.evidence[id]))+'</li>';}).join('');
    return '<h3>'+esc(title)+'</h3><p>'+esc(readable(s.text))+'</p><details open><summary>本段数据依据</summary><ul style="overflow-wrap:anywhere">'+facts+'</ul></details>';
  }
  function currency(v){return v==null?'待官方奖金详情核验':esc(Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2}))+' 元';}
  function payout(s,title){if(!s)return '<p>'+esc(title)+'：当期没有正式方案，无法进行历史对照。</p>';
    return '<h4>'+esc(title)+' · 投注测算</h4><p>展开 '+esc(s.tickets)+' 注；基本成本 '+currency(s.basic_cost_yuan)+'；税前基本奖金 '+currency(s.basic_payout_yuan)+'</p>'+
      '<p>命中分布（前区+后区）：'+Object.keys(s.matches).map(function(k){return esc(k)+'（'+esc(s.matches[k])+'注）';}).join('、')+'</p>'+
      '<p>中奖奖级：'+(s.prizes.length?s.prizes.map(function(p){return esc(p.tier)+' '+esc(p.tickets)+'注';}).join('、'):'未中奖')+'</p>'+
      '<details><summary>全部追加的假设结算</summary><p>成本 '+currency(s.all_additional_cost_yuan)+'；含基本奖金合计 '+currency(s.all_additional_payout_yuan)+'</p></details>';
  }
  Promise.all([json('ai_cycle.json'),json('recommendations.json'),json('compound_recommendation.json').catch(function(){return null;}),json('review.json'),json('dlt_history.json')]).then(function(data){
    var report=data[0],recs=data[1],compound=data[2],review=data[3],history=data[4].issues||[];
    if(report.schema_version!==1||report.game_id!=='dlt')throw Error('schema');
    var primaries=recs.filter(function(p){return p.is_primary===true;}),p=primaries.length===1?primaries[0]:null;
    var a=report.analysis,r=report.review;
    var latest=history.reduce(function(m,h){return String(h.issue)>m?String(h.issue):m;},'');
    try{
      var chosen=compound&&(compound.candidates||[]).find(function(c){return c.format===compound.selected_format;});
      if(!a||a.status!=='completed'||!p||a.issue!==String(p.target_issue)||a.issue<=latest||!ns(a.identity.single,p)||!chosen||String(compound.target_issue)!==a.issue||!ns(a.identity.compound,chosen)||a.identity.compound.format!==chosen.format)throw Error('stale analysis');
      set('ai-overview',section(a,'overview','本期 AI 综合判断')+section(a,'risk','风险与局限')+'<p class="hint">AI综合分析本期方案及其取舍；历史频率与评分不代表中奖概率，不保证中奖。</p>');
      set('ai-single',section(a,'single_reason','🤖 AI 单注推荐理由'));
      set('ai-compound',section(a,'compound_reason','🤖 AI 复式推荐理由'));
      var carried=a.previous_review?'<p>本期分析已参考第 '+esc(a.previous_review.issue)+' 期 AI 复盘。</p>':'<p>本期暂无可参考的上期 AI 复盘。</p>';
      set('ai-next',section(a,'next_focus','🔁 AI 下一期关注方向')+carried+'<p class="hint">本建议仅供下一期分析参考。</p>');
    }catch(e){['ai-overview','ai-single','ai-compound'].forEach(function(id){set(id,'<p class="hint">本期 AI 分析暂未更新，原有统计与推荐仍可查看。</p>');});set('ai-next','<p class="hint">本期 AI 下一期关注方向暂未更新。</p>');}
    try{
      var actual=history.find(function(h){return r&&String(h.issue)===r.issue;});
      if(!r||r.status!=='completed'||!review.authoritative||r.issue!==String(review.issue)||r.identity.snapshot_hash!==review.snapshot_hash||!ns(r.identity.single,review.recommendation)||!actual||!ns(r.identity.actual,actual))throw Error('stale review');
      set('ai-review','<h3>🤖 第 '+esc(r.issue)+' 期 AI 复盘</h3>'+(r.has_pre_draw_ai?'<p class="hint">对照当期开奖前 AI 分析与实际结果进行复盘。</p>':'<p class="hint">事后解读：当期没有开奖前 AI 分析，不代表 AI 当时作出过这些预测。</p>')+
        payout(r.settlement.single,'正式单注')+payout(r.settlement.compound,'复式方案')+section(r,'summary','AI 结果解读')+section(r,'reason_check','推荐依据核验')+
        section(r,'limitations','复盘局限')+section(r,'next_focus','下一期参考')+'<p class="hint">命中、奖级和奖金按大乐透规则测算。金额为税前假设投注结果，不代表客户真实投注或收益。</p>');
    }catch(e){set('ai-review','<p class="hint">本期 AI 复盘暂未更新，原有命中复盘仍可查看。</p>');}
  }).catch(function(){ids.forEach(function(id){set(id,'<p class="hint">AI 数据暂不可用，原有功能不受影响。</p>');});});
})();
