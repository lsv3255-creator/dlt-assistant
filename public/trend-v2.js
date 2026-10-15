/* =========================================================
   专业走势图 · 数据处理与渲染（trend-v2）
   - 数据唯一来源：./data/dlt_history.json（无模拟、无写死、无外部 API）
   - 结构：loadJSON() → calculate() → render()
   - 分析函数独立（calculateHot / calculateMissing /
     calculateOddEven / calculateBigSmall），便于阶段 13 综合评分复用
   - 原生 JS，无框架
   ========================================================= */
(function (root) {
  "use strict";

  var PERIODS = [50, 100, 300, 1000];
  var DEFAULT_PERIOD = 100;
  var FRONT_MIN = 1, FRONT_MAX = 35;
  var BACK_MIN = 1, BACK_MAX = 12;
  var BACK_BOUNDARY = 6; // 后区大小分界：01-06 小 / 07-12 大
  var FRONT_BOUNDARY = 18; // P1-3A：前区大小分界 01-17 小 / 18-35 大（L1 摘要用）

  // S1：组规则参数化（为双色球/3D/快乐8 扩展打基础；本轮仅大乐透）
  var GROUP_RULES = {
    front: { key: "front", label: "前区", min: 1, max: 35, count: 5, positional: false },
    back:  { key: "back",  label: "后区", min: 1, max: 12, count: 2, positional: false }
  };

  function pad2(n) { return String(n).padStart(2, "0"); }
  // P1-3B：本地 HTML 转义（trend 页自包含，不依赖其它页面脚本）
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function range(a, b) {
    var out = [];
    for (var i = a; i <= b; i++) out.push(i);
    return out;
  }

  function loadJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " @ " + path);
      return r.json();
    });
  }

  // S1：统一数据加载入口。返回 Promise<{ issues, meta }>
  //   issues: 按期号升序的 {issue, date, front[5], back[2]}
  //   meta:   { cover, issueRange, frontTotal, backTotal, sourceName, updatedAt }
  function loadData() {
    return loadJSON("./data/dlt_history.json").then(function (data) {
      var issues = data.issues || [];
      if (!issues.length) throw new Error("历史数据为空");
      var sorted = issues.slice().sort(function (a, b) {
        return a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0;
      });
      var srcName = { "500": "500彩票网" }[data.source] || (data.source || "公开数据源");
      return {
        issues: sorted,
        meta: {
          cover: sorted.length + " 期",
          issueRange: sorted[0].issue + " - " + sorted[sorted.length - 1].issue,
          frontTotal: (sorted.length * GROUP_RULES.front.count) + " 个号码",
          backTotal: (sorted.length * GROUP_RULES.back.count) + " 个号码",
          sourceName: srcName,
          updatedAt: data.updated_at || ""
        }
      };
    });
  }

  /* ================= 纯数据层（分析函数，独立可复用） ================= */

  // 取最近 n 期
  function sliceWindow(issues, n) {
    return issues.slice(Math.max(0, issues.length - n));
  }

  // 热度：{num, count, omit}，按 count 倒序；omit=当前连续未开出期数
  function calculateHot(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var freq = {}, last = {};
    w.forEach(function (it, idx) {
      it[kind].forEach(function (x) {
        freq[x] = (freq[x] || 0) + 1;
        last[x] = idx;
      });
    });
    var lastIdx = w.length - 1;
    var out = [];
    Object.keys(freq).forEach(function (k) {
      out.push({ num: parseInt(k, 10), count: freq[k], omit: lastIdx - (last[k] != null ? last[k] : lastIdx) });
    });
    out.sort(function (a, b) { return b.count - a.count; });
    return out;
  }

  // 遗漏分析：{num, cur, max, avg}；cur=当前遗漏，max=最大连续遗漏，avg=平均连续遗漏
  function calculateMissing(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var pool = kind === "front" ? range(FRONT_MIN, FRONT_MAX) : range(BACK_MIN, BACK_MAX);
    return pool.map(function (num) {
      var cur = 0;
      for (var i = w.length - 1; i >= 0; i--) {
        if (w[i][kind].indexOf(num) >= 0) break;
        cur++;
      }
      var run = 0, max = 0, totalRun = 0, runCount = 0;
      for (var j = 0; j < w.length; j++) {
        if (w[j][kind].indexOf(num) >= 0) {
          if (run > 0) { totalRun += run; runCount++; if (run > max) max = run; run = 0; }
        } else {
          run++;
        }
      }
      if (run > 0) { totalRun += run; runCount++; if (run > max) max = run; }
      return { num: num, cur: cur, max: max, avg: runCount ? Math.round((totalRun / runCount) * 10) / 10 : 0 };
    });
  }

  /* ================= S4：热冷矩阵（Heat Map）================= */

  // 计算色阶等级 0-5（基于实际频率相对期望频率的比例）
  // 期望频率 = windowSize / totalNums
  // ratio >= 1.5 → 极热(5); >= 1.2 → 热(4); >= 0.9 → 温(3); >= 0.7 → 常温(2); >= 0.5 → 冷(1); else → 极冷(0)
  function calcColorLevel(count, windowSize, totalNums) {
    var expected = windowSize / totalNums;
    var ratio = expected > 0 ? count / expected : 0;
    if (ratio >= 1.5) return 5;
    if (ratio >= 1.2) return 4;
    if (ratio >= 0.9) return 3;
    if (ratio >= 0.7) return 2;
    if (ratio >= 0.5) return 1;
    return 0;
  }

  // 构建热冷数据模型（纯函数）
  // 返回 { groupRule, period, issues, numbers: [{num, cells, totalAppear, freqRank, trend}] }
  function buildHeatMap(issues, period, groupRule) {
    var w = sliceWindow(issues, period);
    var key = groupRule.key;
    var hot = calculateHot(issues, period, key);
    var hotMap = {};
    hot.forEach(function (h) { hotMap[h.num] = h; });

    // 排名映射（按 count 倒序）
    var sorted = hot.slice().sort(function (a, b) { return b.count - a.count; });
    var rankMap = {};
    sorted.forEach(function (h, i) { rankMap[h.num] = i + 1; });

    // 上一周期热度（用于趋势判断，取当前期的 75% 作为基准）
    var prevPeriod = Math.max(50, Math.floor(period * 0.75));
    var prevHot = calculateHot(issues, prevPeriod, key);
    var prevMap = {};
    prevHot.forEach(function (h) { prevMap[h.num] = h.count; });

    var out = { groupRule: groupRule, period: period, issues: w, numbers: [] };
    for (var num = groupRule.min; num <= groupRule.max; num++) {
      var h = hotMap[num] || { count: 0, omit: period };
      var prev = prevMap[num] || 0;
      var trend = h.count > prev * 1.1 ? "up" :
                  h.count < prev * 0.9 ? "down" : "flat";

      // 构造每期的格子数据
      var cells = [];
      var totalAppear = 0;
      for (var i = 0; i < w.length; i++) {
        var appeared = w[i][key].indexOf(num) >= 0;
        if (appeared) totalAppear++;
        cells.push({ appeared: appeared });
      }

      out.numbers.push({
        num: num,
        cells: cells,
        totalAppear: totalAppear,
        currentOmit: h.omit,
        freqRank: rankMap[num] || 99,
        trend: trend
      });
    }
    return out;
  }

  // 渲染热冷矩阵到容器
  function renderHeatMap(container, data, opts) {
    if (!container) return;
    opts = opts || {};
    var rule = data.groupRule;
    var w = data.issues;
    var numCls = rule.key === "front" ? "front" : "back";
    var parts = ['<table class="hm-table" data-kind="' + rule.key + '"><thead><tr><th class="corner">' + rule.label + '</th>'];

    // 表头：期号（每5期显示后3位）
    for (var c = 0; c < w.length; c++) {
      var show = (c % 5 === 0) || (c === w.length - 1);
      var latest = c === w.length - 1;
      parts.push('<th class="hm-issue' + (latest ? " is-latest" : "") + '" title="第' + w[c].issue + '期 · ' + w[c].date + '">' + (show ? w[c].issue.slice(2) : "") + '</th>');
    }
    parts.push('<th class="hm-rank-h">排名</th></tr></thead><tbody>');

    // 数据行
    data.numbers.forEach(function (row) {
      var colorLevel = calcColorLevel(row.totalAppear, w.length, rule.max - rule.min + 1);
      var arrowHtml = row.trend === "up" ? '<span class="hm-arrow up">▲</span>' :
                      row.trend === "down" ? '<span class="hm-arrow down">▼</span>' : '';

      parts.push('<tr>');
      parts.push('<th class="num-cell ' + numCls + '">' + pad2(row.num) + '</th>');

      row.cells.forEach(function (cell, ci) {
        var latest = ci === w.length - 1;
        if (cell.appeared) {
          parts.push('<td class="hm-cell hm-lv' + colorLevel + (latest ? " is-latest" : "") + '"' +
            'data-issue="' + w[ci].issue + '" data-num="' + pad2(row.num) + '"' +
            'data-rank="' + row.freqRank + '"' +
            'data-trend="' + row.trend + '"' +
            'title="第' + w[ci].issue + '期 · 号码' + pad2(row.num) + ' · 频率排名 #' + row.freqRank + '">' +
            '<span class="hm-num">' + pad2(row.num) + '</span>' +
            '<span class="hm-rank">' + row.freqRank + '</span></td>');
        } else {
          // 未出现：使用极冷底色
          var missClass = rule.key === "front" ? "hm-miss-f" : "hm-miss-b";
          parts.push('<td class="hm-cell hm-lv0 ' + missClass + (latest ? " is-latest" : "") + '" ' +
            'data-issue="' + w[ci].issue + '" data-num="' + pad2(row.num) + '"' +
            'data-rank="' + row.freqRank + '"' +
            'data-trend="' + row.trend + '" ' +
            'title="第' + w[ci].issue + '期 · 号码' + pad2(row.num) + ' · 频率排名 #' + row.freqRank + '">-</td>');
        }
      });

      parts.push('<td class="hm-rank-c">' + row.freqRank + '</td></tr>');
    });

    parts.push("</tbody></table>");
    container.innerHTML = parts.join("");

    // 绑定 hover tooltip
    bindHeatMapTooltip(container);
  }

  // 渲染图例
  function renderHeatLegend(container, kind) {
    if (!container) return;
    var colors = kind === "front"
      ? ["hsl(10,85%,96%)", "hsl(48,50%,84%)", "hsl(38,60%,75%)", "hsl(28,75%,68%)", "hsl(18,80%,62%)", "hsl(10,85%,55%)"]
      : ["hsl(220,70%,96%)", "hsl(248,40%,86%)", "hsl(242,50%,76%)", "hsl(236,58%,68%)", "hsl(228,65%,60%)", "hsl(220,70%,52%)"];
    var labels = ["极冷", "冷", "温", "偏热", "热", "极热"];
    var parts = ['<div class="hm-legend">'];
    for (var i = 0; i < 6; i++) {
      parts.push('<span class="hm-swatch" style="background:' + colors[i] + '"></span>' +
        '<span class="hm-label">' + labels[i] + '</span>');
    }
    parts.push('</div>');
    container.innerHTML = parts.join("");
  }

  // 热冷矩阵 tooltip
  function bindHeatMapTooltip(container) {
    var tip = document.getElementById("hm-tooltip");
    if (!tip || !container) return;
    container.addEventListener("mouseover", function (e) {
      var cell = e.target.closest && e.target.closest("td[data-issue]");
      if (!cell) { tip.classList.remove("show"); return; }
      var issue = cell.getAttribute("data-issue");
      var num = cell.getAttribute("data-num");
      var rank = cell.getAttribute("data-rank");
      var trend = cell.getAttribute("data-trend");
      var arrow = trend === "up" ? "▲升温" : trend === "down" ? "▼降温" : "—持平";
      tip.innerHTML = '<div class="tt-title">第' + issue + '期 · 号码' + num + '</div>' +
        '<div class="tt-line">频率排名：<strong>#' + rank + '</strong> · ' + arrow + '</div>';
      tip.classList.add("show");
      var pad = 12;
      tip.style.left = (e.clientX + pad) + "px";
      tip.style.top = (e.clientY + pad) + "px";
    });
    container.addEventListener("mouseout", function () { tip.classList.remove("show"); });
    container.addEventListener("mousemove", function (e) {
      var pad = 12;
      document.getElementById("hm-tooltip").style.left = (e.clientX + pad) + "px";
      document.getElementById("hm-tooltip").style.top = (e.clientY + pad) + "px";
    });
  }


  // 奇偶占比（按号码个数统计），返回 {odd, even, total} 百分比
  function calculateOddEven(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var odd = 0, even = 0;
    w.forEach(function (it) {
      it[kind].forEach(function (x) { if (x % 2 === 1) odd++; else even++; });
    });
    var t = odd + even;
    return { odd: t ? Math.round((odd / t) * 1000) / 10 : 0, even: t ? Math.round((even / t) * 1000) / 10 : 0, total: t };
  }

  // 大小占比（按号码个数统计；boundary 为分界，x<=boundary 为小），返回 {small, big, total}
  function calculateBigSmall(issues, n, kind, boundary) {
    var w = sliceWindow(issues, n);
    var small = 0, big = 0;
    w.forEach(function (it) {
      it[kind].forEach(function (x) { if (x <= boundary) small++; else big++; });
    });
    var t = small + big;
    return { small: t ? Math.round((small / t) * 1000) / 10 : 0, big: t ? Math.round((big / t) * 1000) / 10 : 0, total: t };
  }

  // 轨迹矩阵：{labels, issues, matrix}
  function buildMatrices(issues) {
    var sorted = issues.slice().sort(function (a, b) {
      return a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0;
    });
    function mk(pmin, pmax, key) {
      var labels = range(pmin, pmax);
      var matrix = labels.map(function () { return new Array(sorted.length).fill(false); });
      sorted.forEach(function (it, ci) {
        it[key].forEach(function (x) { matrix[x - pmin][ci] = true; });
      });
      return { labels: labels, issues: sorted, matrix: matrix };
    }
    return { front: mk(FRONT_MIN, FRONT_MAX, "front"), back: mk(BACK_MIN, BACK_MAX, "back") };
  }

  /* ================= 渲染层 ================= */

  // S2：号码出现轨迹矩阵数据模型（纯函数）。
  // 输出契约：
  //   { groupRule, period, issues(窗口升序), numbers: [
  //       { number, cells: [{appeared}...], curOmit, count } ] }
  // 支持任意组（大乐透前区/后区；未来双色球/3D/快乐8 由 groupRule 驱动）。
  function buildOccurrenceMatrix(issues, period, groupRule) {
    var w = sliceWindow(issues, period);
    var key = groupRule.key;
    var out = { groupRule: groupRule, period: period, issues: w, numbers: [] };
    for (var num = groupRule.min; num <= groupRule.max; num++) {
      var cells = [];
      var count = 0;
      for (var i = 0; i < w.length; i++) {
        var appeared = w[i][key].indexOf(num) >= 0;
        if (appeared) count++;
        cells.push({ appeared: appeared });
      }
      var curOmit = 0;
      for (var j = w.length - 1; j >= 0; j--) {
        if (cells[j].appeared) break;
        curOmit++;
      }
      out.numbers.push({ number: num, cells: cells, curOmit: curOmit, count: count });
    }
    return out;
  }

  // 遗漏档位（仅服务 UI）：与轨迹空格 / 遗漏表共用同一阈值语义
  // 0 = 1-2 期, 1 = 3-5, 2 = 6-10, 3 = 11-20, 4 = 21+
  function missLevel(miss) {
    if (miss <= 2) return 0;
    if (miss <= 5) return 1;
    if (miss <= 10) return 2;
    if (miss <= 20) return 3;
    return 4;
  }

  // 热度档位（仅服务 UI）：按行内最大值归一化到 1-4（最大值恒为 4）
  function hotLevel(count, max) {
    if (!max) return 0;
    return Math.min(4, Math.max(1, Math.round((count / max) * 4)));
  }

  // 遗漏计算辅助（仅服务 UI）：返回每个号码在当前窗口内的当前遗漏期数
  // 输入 buildMatrices() 输出 matrix 对象，输出 [{ number, miss }]
  function calculateCellMissing(m, n) {
    var issues = m.issues;
    var start = Math.max(0, issues.length - (n || issues.length));
    return m.labels.map(function (num, r) {
      var miss = 0;
      for (var ci = issues.length - 1; ci >= start; ci--) {
        if (m.matrix[r][ci]) break;
        miss++;
      }
      return { number: num, miss: miss };
    });
  }

  // 轨迹渲染：命中格显示号码 + data 属性（供 hover tooltip/连线定位），表头带完整期号与日期
  // 趋势 2.0 第一阶段：号码文本 / 日期标识 / hover 提示 / SVG 连线（坐标基于固定 22px 格）
  function renderTrajectoryHTML(m, kind, n) {
    var issues = m.issues;
    var start = Math.max(0, issues.length - n);
    var cols = issues.slice(start);
    var hitClass = kind === "front" ? "hit-f" : "hit-b";
    var numCls = kind === "front" ? "f" : "b";
    // 每号当前遗漏（仅服务 UI）：空格输出 miss-lvN 分级 class，命中格保留 hit-f / hit-b
    var missMap = {};
    calculateCellMissing(m, n).forEach(function (it) { missMap[it.number] = it.miss; });
    var parts = ['<table class="trend-table" data-kind="' + kind + '"><thead><tr><th class="corner"></th>'];
    for (var c = 0; c < cols.length; c++) {
      var show = (c % 10 === 0) || (c === cols.length - 1);
      parts.push('<th class="issue-cell" title="第 ' + cols[c].issue + ' 期 · ' + cols[c].date + '">' +
        (show ? cols[c].issue.slice(2) : "") + "</th>");
    }
    parts.push("</tr></thead><tbody>");
    for (var r = 0; r < m.labels.length; r++) {
      var row = m.matrix[r];
      var rowMissLv = missLevel(missMap[m.labels[r]]);
      parts.push('<tr><th class="num-cell ' + numCls + '">' + pad2(m.labels[r]) + "</th>");
      for (var ci = 0; ci < cols.length; ci++) {
        if (row[start + ci]) {
          var miss = missMap[m.labels[r]];
          parts.push('<td class="cell ' + hitClass + '" data-issue="' + cols[ci].issue +
            '" data-date="' + cols[ci].date + '" data-num="' + pad2(m.labels[r]) +
            '" data-omit="' + miss + '" title="第 ' + cols[ci].issue + ' 期 · 号码 ' +
            pad2(m.labels[r]) + " · 遗漏 " + miss + " 期\">" + pad2(m.labels[r]) + "</td>");
        } else {
          parts.push('<td class="cell miss-lv' + rowMissLv + '"></td>');
        }
      }
      parts.push("</tr>");
    }
    parts.push("</tbody></table>");
    return parts.join("");
  }

  // hover 详情：命中格 → tooltip（期号/日期/号码/遗漏/该期全部号码）；fixed 跟随鼠标
  function bindTrendTooltip() {
    var tip = document.getElementById("trend-tooltip");
    if (!tip) return;
    document.addEventListener("mouseover", function (e) {
      var td = e.target && e.target.closest ? e.target.closest("td[data-issue]") : null;
      if (!td) { tip.hidden = true; return; }
      var issue = td.getAttribute("data-issue");
      var cur = null;
      var all = window.__trendIssues || [];
      for (var i = 0; i < all.length; i++) { if (all[i].issue === issue) { cur = all[i]; break; } }
      var kind = td.classList.contains("hit-f") ? "前区" : "后区";
      var num = td.getAttribute("data-num");
      var omit = td.getAttribute("data-omit");
      var date = td.getAttribute("data-date");
      var head = '<div class="tt-title">第 ' + issue + " 期 · " + date + "</div>";
      var line1 = '<div class="tt-line">' + kind + '号码 <strong>' + num + '</strong> · 当前遗漏 <strong>' + omit + " 期</strong></div>";
      var line2 = "";
      if (cur) {
        line2 = '<div class="tt-line">该期开奖：前区 ' + cur.front.map(pad2).join(" ") +
          " · 后区 " + cur.back.map(pad2).join(" ") + "</div>";
      }
      tip.innerHTML = head + line1 + line2;
      tip.hidden = false;
      var pad = 14;
      tip.style.left = (e.clientX + pad) + "px";
      tip.style.top = (e.clientY + pad) + "px";
    });
  }

  // S2：号码出现轨迹矩阵渲染（HTML 表格）。
  // 横轴=期号（表头，每 5 期显示后 3 位），纵轴=号码；
  // 命中格=号码 + 当前遗漏小字，未命中格=遗漏色阶行背景；
  // 最新一期列高亮（is-latest）；无任何跨点连线（Task 17.1 产品约束）。
  // data: buildOccurrenceMatrix() 输出；opts: { latest: bool }
  function renderOccurrenceMatrix(container, data, opts) {
    opts = opts || {};
    var rule = data.groupRule;
    var w = data.issues;
    var numCls = rule.key === "front" ? "f" : "b";
    var hitClass = rule.key === "front" ? "hit-f" : "hit-b";
    var parts = ['<table class="ocm-table" data-kind="' + rule.key + '"><thead><tr><th class="corner">' + rule.label + '</th>'];
    for (var c = 0; c < w.length; c++) {
      var show = (c % 5 === 0) || (c === w.length - 1);
      var latest = c === w.length - 1;
      parts.push('<th class="ocm-issue' + (latest ? " is-latest" : "") + '" title="第 ' + w[c].issue +
        " 期 · " + w[c].date + '">' + (show ? w[c].issue.slice(2) : "") + "</th>");
    }
    parts.push('<th class="ocm-cur">遗漏</th></tr></thead><tbody>');
    data.numbers.forEach(function (row) {
      parts.push('<tr><th class="num-cell ' + numCls + '">' + pad2(row.number) + "</th>");
      for (var ci = 0; ci < w.length; ci++) {
        var cell = row.cells[ci];
        var latest = ci === w.length - 1;
        if (cell.appeared) {
          parts.push('<td class="ocm-cell ' + hitClass + (latest ? " is-latest" : "") + '" data-issue="' +
            w[ci].issue + '" data-date="' + w[ci].date + '" data-num="' + pad2(row.number) +
            '" data-omit="' + row.curOmit + '" title="第 ' + w[ci].issue + " 期 · 号码 " +
            pad2(row.number) + " · 当前遗漏 " + row.curOmit + ' 期">' +
            '<span class="ocm-num">' + pad2(row.number) + "</span>" +
            '<span class="ocm-omit">' + row.curOmit + "</span></td>");
        } else {
          parts.push('<td class="ocm-cell miss-lv' + missLevel(row.curOmit) + (latest ? " is-latest" : "") + '"></td>');
        }
      }
      parts.push('<td class="ocm-cur-val' + (row.curOmit > 0 ? " omit" : "") + '">' + row.curOmit + "</td></tr>");
    });
    parts.push("</tbody></table>");
    container.innerHTML = parts.join("");
  }

  function renderHotTable(items, kind) {
    var numCls = kind === "front" ? "f" : "b";
    var maxCount = 0;
    items.forEach(function (it) { if (it.count > maxCount) maxCount = it.count; });
    var rows = ['<thead><tr><th>号码</th><th>出现次数</th><th>最近遗漏</th></tr></thead><tbody>'];
    items.forEach(function (it) {
      rows.push('<tr><td class="num ' + numCls + '">' + pad2(it.num) + "</td>" +
        '<td class="val-hot hot-lv' + hotLevel(it.count, maxCount) + '">' + it.count + "</td>" +
        '<td class="val-omit">' + it.omit + "</td></tr>");
    });
    rows.push("</tbody>");
    return rows.join("");
  }

  function renderMissingTable(items, kind) {
    var numCls = kind === "front" ? "f" : "b";
    var rows = ['<thead><tr><th>号码</th><th>当前遗漏</th><th>最大遗漏</th><th>平均遗漏</th></tr></thead><tbody>'];
    items.forEach(function (it) {
      rows.push('<tr><td class="num ' + numCls + '">' + pad2(it.num) + "</td>" +
        '<td class="val-omit miss-lv' + missLevel(it.cur) + '">' + it.cur + "</td>" +
        "<td>" + it.max + "</td><td>" + it.avg + "</td></tr>");
    });
    rows.push("</tbody>");
    return rows.join("");
  }

  /* ================= S3 遗漏趋势分析（新增，复用既有分析函数，不改 S2 矩阵） ================= */

  // 遗漏档案：复用 calculateMissing（cur/max/avg）+ calculateHot（appearCount），
  // 仅新增 lastAppearIssue / trend 计算，不复制遗漏逻辑。
  // 输出：{number, currentOmission, maxOmission, avgOmission, lastAppearIssue, appearCount, trend}
  function buildOmissionProfile(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var missing = calculateMissing(issues, n, kind); // [{num,cur,max,avg}]
    var hot = calculateHot(issues, n, kind);          // [{num,count,omit}]
    var countMap = {};
    hot.forEach(function (h) { countMap[h.num] = h.count; });
    // 最近出现期号：从窗口末尾向前扫描，记录每个号码首次（=最近）命中的期号
    var lastAppear = {};
    for (var i = w.length - 1; i >= 0; i--) {
      w[i][kind].forEach(function (x) {
        if (lastAppear[x] == null) lastAppear[x] = w[i].issue;
      });
    }
    return missing.map(function (m) {
      var cur = m.cur, avg = m.avg;
      var trend = (cur > avg * 1.15) ? "high" : (cur < avg * 0.85 ? "low" : "normal");
      return {
        number: m.num,
        currentOmission: cur,
        maxOmission: m.max,
        avgOmission: avg,
        lastAppearIssue: (lastAppear[m.num] != null) ? String(lastAppear[m.num]) : null,
        appearCount: countMap[m.num] || 0,
        trend: trend
      };
    });
  }

  // ① 当前遗漏排行（按 currentOmission 倒序；号码 | 当前遗漏 | 最大遗漏 | 最近出现 | 状态）
  function renderOmissionCurrent(profile, kind) {
    var numCls = kind === "front" ? "f" : "b";
    var rows = ['<thead><tr><th>号码</th><th>当前遗漏</th><th>最大遗漏</th><th>最近出现</th><th>状态</th></tr></thead><tbody>'];
    profile.sort(function (a, b) { return b.currentOmission - a.currentOmission; });
    profile.forEach(function (p) {
      var status = p.trend === "high" ? "遗漏偏高" : (p.trend === "low" ? "近期活跃" : "常态");
      var stCls = p.trend === "high" ? "st-high" : (p.trend === "low" ? "st-low" : "st-normal");
      rows.push('<tr><td class="num ' + numCls + '">' + pad2(p.number) + "</td>" +
        '<td class="val-omit miss-lv' + missLevel(p.currentOmission) + '">' + p.currentOmission + "</td>" +
        "<td>" + p.maxOmission + "</td>" +
        "<td>" + (p.lastAppearIssue || "—") + "</td>" +
        '<td class="' + stCls + '">' + status + "</td></tr>");
    });
    rows.push("</tbody>");
    document.getElementById(kind === "front" ? "omission-current-front" : "omission-current-back").innerHTML = rows.join("");
  }

  // ② 遗漏变化排名（按 当前−平均 偏差降序；横向条形，长度 ∝ |偏差|，不做连线/动画）
  function renderOmissionChange(profile, kind) {
    var sorted = profile.slice().sort(function (a, b) {
      return (b.currentOmission - b.avgOmission) - (a.currentOmission - a.avgOmission);
    });
    var maxDev = 1;
    sorted.forEach(function (p) {
      var dev = Math.abs(p.currentOmission - p.avgOmission);
      if (dev > maxDev) maxDev = dev;
    });
    var parts = ['<div class="bar-rank-list">'];
    sorted.forEach(function (p) {
      var dev = p.currentOmission - p.avgOmission;
      var pct = Math.max(6, Math.round(Math.abs(dev) / maxDev * 100));
      var dir = dev >= 0 ? "pos" : "neg";
      var sign = dev >= 0 ? "+" : "";
      parts.push('<div class="bar-rank-row">' +
        '<span class="br-num">' + pad2(p.number) + "</span>" +
        '<span class="br-track"><span class="br-fill ' + dir + '" style="width:' + pct + '%"></span></span>' +
        '<span class="br-val">当前 ' + p.currentOmission + ' · 平均 ' + p.avgOmission +
        ' · <strong>' + sign + dev + "</strong></span></div>");
    });
    parts.push("</div>");
    document.getElementById(kind === "front" ? "omission-change-front" : "omission-change-back").innerHTML = parts.join("");
  }

  // ③ 长期遗漏统计（最大遗漏 TOP5 + 平均遗漏 + 当前超均值号码）
  function renderOmissionLong(fp, bp) {
    function maxTop(list, kind) {
      var numCls = kind === "front" ? "f" : "b";
      var top = list.slice().sort(function (a, b) { return b.maxOmission - a.maxOmission; }).slice(0, 5);
      var rows = ['<thead><tr><th>号码</th><th>最大遗漏</th></tr></thead><tbody>'];
      top.forEach(function (p) {
        rows.push('<tr><td class="num ' + numCls + '">' + pad2(p.number) + "</td>" +
          '<td class="val-omit miss-lv' + missLevel(p.maxOmission) + '">' + p.maxOmission + "</td></tr>");
      });
      rows.push("</tbody>");
      return rows.join("");
    }
    document.getElementById("omission-maxtop-front").innerHTML = maxTop(fp, "front");
    document.getElementById("omission-maxtop-back").innerHTML = maxTop(bp, "back");

    function avgOf(list) { var s = 0; list.forEach(function (p) { s += p.avgOmission; }); return list.length ? Math.round(s / list.length * 10) / 10 : 0; }
    function overAvg(list) { return list.filter(function (p) { return p.currentOmission > p.avgOmission; }); }
    var fOver = overAvg(fp), bOver = overAvg(bp);
    var summary = '<div class="long-stats">' +
      '<div class="ls-item"><span class="ls-label">前区平均遗漏</span><span class="ls-value">' + avgOf(fp) + "</span></div>" +
      '<div class="ls-item"><span class="ls-label">后区平均遗漏</span><span class="ls-value">' + avgOf(bp) + "</span></div>" +
      '<div class="ls-item"><span class="ls-label">前区超均值号码</span><span class="ls-value">' + fOver.length + " 个</span>" +
        '<span class="ls-detail">' + (fOver.length ? fOver.map(function (p) { return pad2(p.number); }).join(" ") : "无") + "</span></div>" +
      '<div class="ls-item"><span class="ls-label">后区超均值号码</span><span class="ls-value">' + bOver.length + " 个</span>" +
        '<span class="ls-detail">' + (bOver.length ? bOver.map(function (p) { return pad2(p.number); }).join(" ") : "无") + "</span></div>" +
      "</div>";
    document.getElementById("omission-stats-summary").innerHTML = summary;
  }

  // S3 总渲染入口（在 draw() 中随 period 联动调用）
  function renderMissingAnalysis(issues, period) {
    var fp = buildOmissionProfile(issues, period, "front");
    var bp = buildOmissionProfile(issues, period, "back");
    renderOmissionCurrent(fp, "front");
    renderOmissionCurrent(bp, "back");
    renderOmissionChange(fp, "front");
    renderOmissionChange(bp, "back");
    renderOmissionLong(fp, bp);
  }

  // 奇偶/大小：当前档大条形 + 四档对比小条形
  function renderRatioBars(el, cur, labelCur, four) {
    var parts = [];
    parts.push('<div class="bar-row"><span class="bar-label">' + labelCur + "</span>" +
      '<span class="bar-track"><span class="bar-fill" style="width:' + cur.pct + '%"></span></span>' +
      '<span class="bar-val">' + cur.txt + "</span></div>");
    four.forEach(function (f) {
      parts.push('<div class="bar-row"><span class="bar-label">' + f.label + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="width:' + f.pct + '%;background:linear-gradient(90deg,#8b5cf6 0%,#6d28d9 100%)"></span></span>' +
        '<span class="bar-val">' + f.txt + "</span></div>");
    });
    el.innerHTML = parts.join("");
  }

  function showError(msg) {
    document.getElementById("error").hidden = false;
    document.getElementById("error-detail").textContent = "走势图数据暂时无法加载，请稍后重试。";
  }

  /* ================= P1-3A：mobile-first 分层（L1 摘要 / L2 紧凑矩阵+Focus / 触摸详情） ================= */
  // 以下全部为纯函数：只读 dlt_history.json（排序后 issues），确定性、无随机、无后端 API。

  // L1 趋势摘要：仅描述历史事实（近 N 期窗口），不做预测性文案。
  function computeL1Summary(issues, n) {
    var w = sliceWindow(issues, n);
    var pool = { front: range(FRONT_MIN, FRONT_MAX), back: range(BACK_MIN, BACK_MAX) };
    var s = { window: w.length };
    ["front", "back"].forEach(function (kind) {
      var nums = pool[kind];
      var freq = {};
      nums.forEach(function (x) { freq[x] = 0; });
      w.forEach(function (it) { it[kind].forEach(function (x) { if (freq[x] != null) freq[x]++; }); });
      // 热号 top5（按次数，次数相同按号码升序）
      var hot = nums.slice().sort(function (a, b) { return (freq[b] - freq[a]) || (a - b); }).slice(0, 5);
      // 当前遗漏较高（从最新往回）
      var omit = {};
      nums.forEach(function (x) {
        var m = 0;
        for (var i = w.length - 1; i >= 0; i--) { if (w[i][kind].indexOf(x) >= 0) break; m++; }
        omit[x] = m;
      });
      var cold = nums.slice().sort(function (a, b) { return (omit[b] - omit[a]) || (a - b); }).filter(function (x) { return omit[x] > 0; }).slice(0, 5);
      // 近期重复号（窗口内出现 >=2 次）
      var repeated = nums.filter(function (x) { return freq[x] >= 2; }).sort(function (a, b) { return freq[b] - freq[a]; });
      s[kind] = { hot: hot.map(function (x) { return [x, freq[x]]; }), cold: cold.map(function (x) { return [x, omit[x]]; }), repeated: repeated, freq: freq, omit: omit };
    });
    // 近 N 期连号（每期前区相邻差 1 的组数）
    var consecPeriods = 0, consecPairs = 0;
    w.forEach(function (it) {
      var f = it.front.slice().sort(function (a, b) { return a - b; });
      var p = 0;
      for (var i = 0; i < f.length - 1; i++) if (f[i + 1] - f[i] === 1) p++;
      if (p > 0) consecPeriods++;
      consecPairs += p;
    });
    // 奇偶/大小/和值/跨度/区间（前区）
    var oddCnt = 0, bigCnt = 0, sumTotal = 0, spanSum = 0, sumMin = Infinity, sumMax = -Infinity;
    var zone = [0, 0, 0]; // 01-11 / 12-23 / 24-35
    w.forEach(function (it) {
      var f = it.front.slice().sort(function (a, b) { return a - b; });
      oddCnt += f.filter(function (x) { return x % 2 === 1; }).length;
      bigCnt += f.filter(function (x) { return x >= FRONT_BOUNDARY; }).length;
      var sm = f.reduce(function (a, b) { return a + b; }, 0);
      sumTotal += sm; sumMin = Math.min(sumMin, sm); sumMax = Math.max(sumMax, sm);
      spanSum += f[f.length - 1] - f[0];
      f.forEach(function (x) { zone[x <= 11 ? 0 : (x <= 23 ? 1 : 2)]++; });
    });
    var frontCount = w.length * 5 || 1;
    s.consecutive = { periods: consecPeriods, pairs: consecPairs };
    // 前区结构字段并入 s.front（不覆盖 hot/cold/repeated/freq/omit）
    s.front.oddEven = [oddCnt, frontCount - oddCnt];
    s.front.bigSmall = [bigCnt, frontCount - bigCnt];
    s.front.sum = { avg: (sumTotal / w.length) || 0, min: sumMin === Infinity ? 0 : sumMin, max: sumMax === -Infinity ? 0 : sumMax };
    s.front.span = { avg: spanSum / (w.length || 1) };
    s.front.zone = zone;
    return s;
  }

  function renderL1Summary(container, issues, n) {
    var s = computeL1Summary(issues, n);
    function chip(nums, unit) {
      return nums.map(function (e) { return '<span class="l1-chip">' + pad2(e[0]) + '<i>' + e[1] + (unit || "") + "</i></span>"; }).join("");
    }
    var f = s.front || {};
    var zlabels = ["01–11", "12–23", "24–35"];
    var zoneTxt = zlabels.map(function (lz, i) { return lz + " " + (f.zone && f.zone[i] != null ? f.zone[i] : "—"); }).join(" · ");
    container.innerHTML =
      '<div class="l1-grid">' +
      '<div class="l1-item"><span class="l1-k">近期热号（前区）</span>' + chip((s.front && s.front.hot) || [], "次") + "</div>" +
      '<div class="l1-item"><span class="l1-k">当前遗漏较高（前区）</span>' + chip((s.front && s.front.cold) || [], "期") + "</div>" +
      '<div class="l1-item"><span class="l1-k">近期重复号（前区≥2）</span>' + ((s.front && s.front.repeated && s.front.repeated.length) ? chip(s.front.repeated.map(function (x) { return [x, (s.front.freq && s.front.freq[x]) || 0]; }), "次") : '<span class="l1-none">无</span>') + "</div>" +
      '<div class="l1-item"><span class="l1-k">近期连号</span><span class="l1-v">近 ' + s.window + ' 期中 ' + s.consecutive.periods + " 期出现连号，共 " + s.consecutive.pairs + " 对</span></div>" +
      '<div class="l1-item"><span class="l1-k">前区奇偶 / 大小</span><span class="l1-v">奇 ' + (f.oddEven && f.oddEven[0]) + " : 偶 " + (f.oddEven && f.oddEven[1]) + " ｜ 大 " + (f.bigSmall && f.bigSmall[0]) + " : 小 " + (f.bigSmall && f.bigSmall[1]) + "</span></div>" +
      '<div class="l1-item"><span class="l1-k">前区和值 / 跨度</span><span class="l1-v">和值均值 ' + (f.sum ? Math.round(f.sum.avg * 10) / 10 : "—") + "（" + (f.sum ? f.sum.min : "—") + "–" + (f.sum ? f.sum.max : "—") + "）｜ 跨度均值 " + (f.span ? Math.round(f.span.avg * 10) / 10 : "—") + "</span></div>" +
      '<div class="l1-item"><span class="l1-k">前区区间（' + zlabels.join("/") + '）</span><span class="l1-v">' + zoneTxt + '</span></div>' +
      '<p class="l1-note">以上均为近 ' + s.window + " 期历史事实描述，不构成预测。</p>" +
      "</div>";
  }

  // Focus 号码：单个号码在窗口内的可追溯统计（确定性）。
  function computeFocusStats(issues, num, kind, n) {
    var w = sliceWindow(issues, n);
    var gaps = [];
    var lastIdx = -1;
    for (var i = 0; i < w.length; i++) {
      if (w[i][kind].indexOf(num) >= 0) {
        if (lastIdx >= 0) gaps.push(i - lastIdx);
        lastIdx = i;
      }
    }
    // 当前遗漏（从最新往回）
    var curOmit = 0;
    for (var j = w.length - 1; j >= 0; j--) { if (w[j][kind].indexOf(num) >= 0) break; curOmit++; }
    var count = (lastIdx >= 0) ? (gaps.length + 1) : 0;
    var lastIssue = (lastIdx >= 0) ? w[lastIdx].issue : null;
    // 平均间隔 = 相邻两次出现间隔的均值（仅当出现次数 ≥2 时有意义）
    var maxGap = gaps.length ? Math.max.apply(null, gaps) : 0;
    var avgGap = (gaps.length) ? Math.round((gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) * 10) / 10 : 0;
    return { num: num, kind: kind, window: w.length, currentOmit: curOmit, recentCount: count, lastAppearIssue: lastIssue,
             maxOmission: maxGap, avgGap: avgGap, gapSequence: gaps };
  }

  // P1-3B：Focus 多选（每种前区/后区最多 3 个；共享 L2 两个视图 + L3 矩阵高亮）。
  // window.__focus[kind] = number[]（旧版单值 number 自动兼容为 [number]）。
  var FOCUS_MAX = 3;

  function normalizeFocus(arr) {
    if (arr == null) return [];
    if (!Array.isArray(arr)) arr = [arr];
    return arr.slice(0, FOCUS_MAX);
  }

  // P1-3B：focus 读写。优先 window.__focus；Node（module.exports）环境回落模块级 __focusStore。
  var __focusStore = { windowRef: null };
  function focusRoot() {
    if (typeof window !== "undefined") {
      if (!window.__focus) window.__focus = {};
      return window.__focus;
    }
    return __focusStore;
  }

  // 当前 kind 的 focus 号码数组（兼容旧版单值）
  function getFocusNumbers(kind) { return normalizeFocus(focusRoot()[kind]); }
  // 仅写 focus store（不做 DOM 刷新；测试/脚本环境用）
  function focusSet(kind, nums) {
    if (nums == null) nums = [];
    if (!Array.isArray(nums)) nums = [nums];
    var clean = normalizeFocus(nums);
    var root = focusRoot();
    if (clean.length) root[kind] = clean; else delete root[kind];
    return clean;
  }

  function renderFocusPanel(container, issues, kind, n) {
    var pool = kind === "front" ? range(FRONT_MIN, FRONT_MAX) : range(BACK_MIN, BACK_MAX);
    var state = normalizeFocus(focusRoot()[kind]);
    var chips = pool.map(function (x) {
      var active = state.indexOf(x) >= 0;
      return '<button class="focus-chip' + (active ? " active" : "") + '" data-focus-num="' + pad2(x) +
        '" aria-pressed="' + active + '" aria-label="' + (kind === "front" ? "前区" : "后区") + '号码 ' + pad2(x) + '">' + pad2(x) + "</button>";
    }).join("");
    var detailId = "focus-detail-" + kind;
    if (typeof document !== "undefined" && document.getElementById) document.getElementById(detailId); // 保留既有 DOM 节点引用语义；Node 环境跳过
    container.innerHTML =
      '<div class="focus-chips" role="tablist" aria-label="' + (kind === "front" ? "前区" : "后区") + '号码关注（最多同时 ' + FOCUS_MAX + " 个）" + '" data-focus-kind="' + kind + '">' +
      '<button class="focus-chip focus-clear" data-focus-clear="' + kind + '">清除关注</button>' +
      chips + "</div>" +
      '<p class="focus-hint" data-focus-kind="' + kind + '" hidden>最多同时关注 ' + FOCUS_MAX + " 个号码</p>" +
      '<div class="focus-detail" id="' + detailId + '" data-focus-detail="' + kind + '">' +
        (state.length ? "" : '<p class="focus-empty">点击上方号码查看其近 ' + n + " 期节奏（当前遗漏 / 出现次数 / 最大遗漏 / 间隔；最多同时 " + FOCUS_MAX + " 个）。</p>") +
      "</div>";
    if (state.length) renderFocusDetail(kind, state, issues, n);
    bindFocusChips(container, issues, n);
  }

  function bindFocusChips(container, issues, n) {
    var kind = (container.querySelector("[data-focus-clear]") || {}).getAttribute
      ? container.querySelector("[data-focus-clear]").getAttribute("data-focus-clear") : null;
    if (!kind) return;
    container.querySelectorAll(".focus-chip[data-focus-num]").forEach(function (b) {
      b.addEventListener("click", function () {
        toggleFocus(kind, parseInt(b.getAttribute("data-focus-num"), 10), issues, n);
      });
    });
    var clr = container.querySelector('.focus-clear[data-focus-clear="' + kind + '"]');
    if (clr) clr.addEventListener("click", function () { setFocus(kind, [], issues, n); });
    var hint = container.querySelector('.focus-hint[data-focus-kind="' + kind + '"]');
    if (hint) hint.addEventListener("click", function () { hint.hidden = true; });
  }

  function toggleFocus(kind, num, issues, n) {
    var arr = normalizeFocus(focusRoot()[kind]).slice();
    var i = arr.indexOf(num);
    var hint = (typeof document !== "undefined" && document.querySelector) ? document.querySelector('.focus-hint[data-focus-kind="' + kind + '"]') : null;
    if (i >= 0) {
      arr.splice(i, 1);
      if (hint) hint.hidden = true;
    } else if (arr.length >= FOCUS_MAX) {
      if (hint) hint.hidden = false;
      refreshFocus(kind, issues, n);
      return;
    } else {
      arr.push(num);
      if (hint) hint.hidden = true;
    }
    setFocus(kind, arr, issues, n);
  }

  function setFocus(kind, nums, issues, n) {
    if (nums == null) nums = [];
    if (!Array.isArray(nums)) nums = [nums];
    var clean = normalizeFocus(nums);
    var root = focusRoot();
    if (clean.length) root[kind] = clean; else delete root[kind];
    refreshFocus(kind, issues, n);
  }

  function refreshFocus(kind, issues, n) {
    if (typeof document === "undefined" || !document.querySelector) return;
    var panel = document.querySelector('[data-focus-panel="' + kind + '"]');
    if (panel) renderFocusPanel(panel, issues, kind, n);
  }

  // P1-3B：renderFocusDetail 支持多号（最多 3）。每个号码独立 focus-card + 独立 SVG 轨迹。
  // 轨迹语义（历史描述性）：X=时间(期序) Y=单号码出现 lane；仅连接真实 hit point；
  // 连线=两次出现之间时间间隔（gap）；gap 数字复用 computeFocusStats.gapSequence；
  // 不做任何跨号码连接；禁止预测性文案。
  var LANES = [
    { shape: "circle", dash: "", color: "#6d28d9" },
    { shape: "square", dash: "6 3", color: "#2563eb" },
    { shape: "triangle", dash: "2 3", color: "#0f9d58" }
  ];

  // 单号码轨迹数据模型（纯函数；hit 点 + gap 标注）。issues=已排序全量；n=窗口；num/kind。
  function buildTrajectory(issues, num, kind, n) {
    var w = sliceWindow(issues, n);
    var st = computeFocusStats(issues, num, kind, n);
    var hits = [];
    for (var i = 0; i < w.length; i++) {
      if (w[i][kind].indexOf(num) >= 0) hits.push({ idx: i, issue: w[i].issue, date: w[i].date });
    }
    return { num: num, kind: kind, window: w.length, hits: hits, stats: st, windowIssues: w };
  }

  // P1-3B：单号码 SVG lane HTML（纯字符串；marker shape/dash/color 随 laneIndex，多号比较不只靠颜色）。
  function buildTrajectoryLaneHTML(d, laneIndex, kind) {
    var L = LANES[laneIndex] || LANES[0];
    return '<div class="traj-lane" data-traj-lane="' + pad2(d.num) + '" data-traj-kind="' + kind + '">' +
      '<div class="traj-lane-h"><span class="traj-lane-num" style="color:' + L.color + '">' + pad2(d.num) +
      '</span><span class="traj-lane-meta">近 ' + d.window + ' 期 · 出现 ' + d.stats.recentCount +
      ' 次 · 当前遗漏 ' + d.stats.currentOmit + ' 期 · 最大遗漏 ' + d.stats.maxOmission +
      ' 期 · 平均间隔 ' + d.stats.avgGap + ' 期</span></div>' +
      buildTrajectorySVG(d, L, kind) +
      '<div class="traj-lane-gaps">出现间隔：' + (d.stats.gapSequence.length ? d.stats.gapSequence.join(" → ") : "（窗口内无相邻两次出现）") + "</div></div>";
  }

  function renderTrajectoryLane(container, laneIndex, issues, kind, n) {
    var num = getFocusNumbers(kind)[laneIndex];
    if (num == null) return;
    var d = buildTrajectory(issues, num, kind, n);
    var box = container.querySelector('[data-traj-lane="' + pad2(num) + '"]');
    if (!box) {
      var frag = document.createElement("div");
      frag.innerHTML = buildTrajectoryLaneHTML(d, laneIndex, kind);
      box = frag.firstElementChild || frag;
      container.appendChild(box);
    } else {
      box.innerHTML = buildTrajectoryLaneHTML(d, laneIndex, kind).replace(/^<div[^>]*>/, "").replace(/<\/div>$/, "");
    }
  }

  // 生成 SVG 字符串（原生 SVG；viewBox 固定比例；hit point 可 tap；仅连本号 hit）。
  function buildTrajectorySVG(d, L, kind) {
    var w = d.window;
    var padL = 8, padR = 8, padT = 18, padB = 22;
    var laneH = 46;
    var width = Math.max(320, Math.ceil((padL + padR + w * 14))); // 30 期≈ 30*14+16=436
    var height = padT + laneH + padB;
    var step = (width - padL - padR) / Math.max(1, w - 1);
    var yLane = padT + laneH / 2;
    // gap 区间：hit[i-1]→hit[i] 间隔 = d.stats.gapSequence[i-1]
    var parts = [];
    parts.push('<svg class="traj-svg" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMinYMid meet" role="img" ' +
      'aria-label="号码 ' + pad2(d.num) + ' 近 ' + w + ' 期出现轨迹：出现 ' + d.stats.recentCount + ' 次，当前遗漏 ' + d.stats.currentOmit + ' 期">' +
      '<title>号码 ' + pad2(d.num) + ' 近 ' + w + ' 期出现节奏（历史描述，非预测）</title>');
    // 轴线
    parts.push('<line x1="' + padL + '" y1="' + yLane + '" x2="' + (width - padR) + '" y2="' + yLane + '" class="traj-axis"/>');
    // x 轴刻度（每 5 期一个 label，避免 375px 下 30 个文字过密）
    for (var i = 0; i < w; i++) {
      var x = padL + i * step;
      var major = (i % 5 === 0) || (i === w - 1);
      parts.push('<line x1="' + x.toFixed(1) + '" y1="' + (yLane + 10) + '" x2="' + x.toFixed(1) + '" y2="' +
        (yLane + (major ? 16 : 13)) + '" class="traj-tick' + (major ? " major" : "") + '"/>');
      if (major) {
        parts.push('<text x="' + x.toFixed(1) + '" y="' + (height - 4) + '" class="traj-ticklabel" text-anchor="middle">' +
          d.windowIssues[i].issue.slice(2) + "</text>");
      }
    }
    // 连线：仅连接本号相邻 hit（gap 线段）
    for (var k = 0; k < d.hits.length - 1; k++) {
      var a = d.hits[k], b = d.hits[k + 1];
      var x1 = padL + a.idx * step, x2 = padL + b.idx * step;
      var gap = d.stats.gapSequence[k];
      parts.push('<line x1="' + x1.toFixed(1) + '" y1="' + yLane + '" x2="' + x2.toFixed(1) + '" y2="' + yLane +
        '" class="traj-seg" data-num="' + pad2(d.num) + '" data-gap="' + gap + '" stroke="' + L.color +
        '" stroke-width="2" stroke-dasharray="' + (L.dash || "none") + '"/>');
      // 间隔数字（两次 hit 中间）
      var gx = (x1 + x2) / 2;
      parts.push('<text x="' + gx.toFixed(1) + '" y="' + (yLane - 8) + '" class="traj-gap" text-anchor="middle">' + gap + "</text>");
    }
    // 当前遗漏段（最近 hit → 窗口末端）
    if (d.hits.length && d.stats.currentOmit > 0) {
      var lastHit = d.hits[d.hits.length - 1];
      var x1c = padL + lastHit.idx * step, x2c = width - padR;
      parts.push('<line x1="' + x1c.toFixed(1) + '" y1="' + yLane + '" x2="' + x2c.toFixed(1) + '" y2="' + yLane +
        '" class="traj-omit" data-num="' + pad2(d.num) + '" stroke="' + L.color + '" stroke-width="2" stroke-dasharray="2 4" opacity="0.55"/>');
      parts.push('<text x="' + ((x1c + x2c) / 2).toFixed(1) + '" y="' + (yLane - 8) + '" class="traj-omitlabel" text-anchor="middle">当前遗漏 ' + d.stats.currentOmit + "</text>");
    }
    // hit points（可 tap；marker shape 区分多号，不只靠颜色；data-hitordinal=该 hit 在出现序列中的序号）
    for (var h = 0; h < d.hits.length; h++) {
      var p = d.hits[h];
      var px = padL + p.idx * step;
      var label = "第 " + p.issue + " 期 · " + p.date;
      if (h > 0) label += " · 距上一次出现 " + d.stats.gapSequence[h - 1] + " 期";
      parts.push('<g class="traj-hit" data-num="' + pad2(d.num) + '" data-hitordinal="' + (h + 1) + '" data-issue="' + p.issue +
        '" data-kind="' + kind + '" tabindex="0" role="button" aria-label="' + label + '">' +
        '<circle cx="' + px.toFixed(1) + '" cy="' + yLane + '" r="11" class="traj-hit-halo" fill="' + L.color + '"></circle>' +
        trajMarker(px, yLane, L) +
        '</g>');
    }
    parts.push("</svg>");
    return parts.join("");
  }

  function trajMarker(x, y, L) {
    if (L.shape === "square") {
      return '<rect x="' + (x - 6).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" width="12" height="12" fill="' + L.color + '" stroke="#fff" stroke-width="1.5" rx="1"></rect>';
    }
    if (L.shape === "triangle") {
      return '<path d="M ' + x.toFixed(1) + ' ' + (y - 8).toFixed(1) + ' L ' + (x + 8).toFixed(1) + ' ' + (y + 7).toFixed(1) + ' L ' + (x - 8).toFixed(1) + ' ' + (y + 7).toFixed(1) + ' Z" fill="' + L.color + '" stroke="#fff" stroke-width="1.5"></path>';
    }
    return '<circle cx="' + x.toFixed(1) + '" cy="' + y + '" r="7" fill="' + L.color + '" stroke="#fff" stroke-width="1.5"></circle>';
  }

  // L2 轨迹视图：当前 focus 号码（≤3）独立 lane 纵向堆叠；空态提示。
  // 纯字符串输出（便于契约测试），tap 绑定经事件委托到 .traj-hit。
  function buildTrajectoryViewHTML(issues, kind, n) {
    var nums = getFocusNumbers(kind);
    if (!nums.length) {
      return '<div class="traj-empty" data-traj-empty="1">未关注号码。<br>点击上方号码（最多同时 ' + FOCUS_MAX +
        " 个）查看其历史出现节奏：hit 点=真实开出期，连线=两次出现之间的间隔，虚线段=当前遗漏。<br>仅为历史描述，不构成预测。</div>";
    }
    var head = '<div class="traj-legend"><span class="traj-lg"><i class="traj-marker m1"></i>lane 1</span>' +
      '<span class="traj-lg"><i class="traj-marker m2"></i>lane 2</span>' +
      '<span class="traj-lg"><i class="traj-marker m3"></i>lane 3</span>' +
      '<span class="traj-lg"><i class="traj-seg-sample"></i>出现间隔</span>' +
      '<span class="traj-lg"><i class="traj-omit-sample"></i>当前遗漏</span></div>';
    var lanes = nums.map(function (num, i) {
      return buildTrajectoryLaneHTML(buildTrajectory(issues, num, kind, n), i, kind);
    }).join("");
    return head + '<div class="traj-lanes" data-traj-lanes="' + kind + '">' + lanes + "</div>";
  }

  function renderTrajectoryView(container, issues, kind, n) {
    container.innerHTML = buildTrajectoryViewHTML(issues, kind, n);
    bindTrajectoryTap(container, kind, n);
  }

  // 轨迹 hit point 触摸的详情 sheet HTML（纯函数；复用 P1-3A detail sheet 结构，不建第二套 modal）。
  // allIssues = 缓存的 window.__trendIssues；gap = 该 hit 前一段间隔（命中序号 1 起，序号>1 才有前段）。
  function buildTrajectoryDetailSheet(kind, num, issue, hitOrdinal, allIssues, n) {
    var cur = null;
    (allIssues || []).forEach(function (it) { if (String(it.issue) === String(issue)) cur = it; });
    var st = computeFocusStats(allIssues || [], parseInt(num, 10), kind, n);
    var gapTxt = "—";
    if (hitOrdinal > 1 && st.gapSequence[hitOrdinal - 2] != null) gapTxt = st.gapSequence[hitOrdinal - 2] + " 期";
    return '<div class="tts-h">' + (kind === "front" ? "前区" : "后区") + " 号码 <strong>" + num + "</strong> · 第 " + issue +
      " 期（" + (cur ? cur.date : "") + "）</div>" +
      '<div class="tts-line">该期开奖：前区 ' + (cur ? cur.front.map(pad2).join(" ") : "—") + " ｜ 后区 " +
      (cur ? cur.back.map(pad2).join(" ") : "—") + "</div>" +
      '<div class="tts-line">距上一次出现 <strong>' + gapTxt + '</strong> · 当前遗漏 <strong>' + st.currentOmit + " 期</strong></div>" +
      '<button type="button" class="tts-close">关闭</button>';
  }

  // 轨迹 hit point 触摸：click 事件委托到容器 → 复用 P1-3A detail sheet（不建第二套 modal）。
  function bindTrajectoryTap(container, kind, n) {
    if (!container || container.__trajTapBound) return;
    container.__trajTapBound = true;
    container.addEventListener("click", function (e) {
      var t = e.target;
      var g = t && t.closest ? t.closest(".traj-hit") : null;
      if (!g) return;
      var num = g.getAttribute("data-num");
      var issue = g.getAttribute("data-issue");
      var ordinal = parseInt(g.getAttribute("data-hitordinal"), 10);
      var all = (typeof window !== "undefined" && window.__trendIssues) || [];
      var sheet = document.getElementById("trend-detail-sheet");
      if (!sheet) return;
      sheet.innerHTML = buildTrajectoryDetailSheet(kind, num, issue, ordinal, all, n);
      sheet.hidden = false;
      var close = sheet.querySelector(".tts-close");
      if (close) close.addEventListener("click", function () { sheet.hidden = true; sheet.innerHTML = ""; });
    });
  }

  // P1-3B：多号 focus-card 列表（每个号码一个卡片；共享 L2 视图；多号在矩阵中同时高亮）
  function renderFocusDetail(kind, nums, issues, n) {
    var arr = normalizeFocus(nums || []);
    var box = (typeof document !== "undefined" && document.getElementById) ? document.getElementById("focus-detail-" + kind) : null;
    if (!box) return;
    if (!arr.length) {
      box.innerHTML = '<p class="focus-empty">点击上方号码查看其近 ' + n + " 期节奏（当前遗漏 / 出现次数 / 最大遗漏 / 间隔；最多同时 " + FOCUS_MAX + " 个）。</p>";
      highlightMatrixFocus(kind, []);
      return;
    }
    var html = arr.map(function (num) {
      var st = computeFocusStats(issues, num, kind, n);
      var gaps = st.gapSequence.length ? st.gapSequence.join(" → ") + "（末次至今 " + st.currentOmit + " 期未出）" : "窗口内未再次出现";
      return '<div class="focus-card" data-focus-num="' + pad2(num) + '">' +
        '<div class="focus-card-h"><strong>' + pad2(num) + "</strong><span>" + (kind === "front" ? "前区" : "后区") + " · 近 " + st.window + " 期</span></div>" +
        '<div class="focus-metrics">' +
          '<span>当前遗漏 <b>' + st.currentOmit + "</b> 期</span>" +
          '<span>近 ' + st.window + " 期出现 <b>" + st.recentCount + "</b> 次</span>" +
          '<span>最大遗漏 <b>' + st.maxOmission + "</b> 期</span>" +
          '<span>平均间隔 <b>' + st.avgGap + "</b> 期</span>" +
          (st.lastAppearIssue ? '<span>最近出现第 <b>' + st.lastAppearIssue + "</b> 期</span>" : "") +
        "</div>" +
        '<div class="focus-gaps">出现间隔序列：' + esc(gaps) + "</div>" +
      "</div>";
    }).join("");
    box.innerHTML = html;
    highlightMatrixFocus(kind, arr);
  }

  // 多号 focus 在 L2 紧凑矩阵的行高亮（不降权）
  function highlightMatrixFocus(kind, nums) {
    if (typeof document === "undefined" || !document.querySelectorAll) return;
    var arr = normalizeFocus(nums || []).map(pad2);
    document.querySelectorAll('[data-matrix="' + kind + '"] .cmt-row').forEach(function (row) {
      var rn = String(row.getAttribute("data-num"));
      var isFocus = arr.indexOf(rn) >= 0;
      row.classList.toggle("cm-focus", isFocus);
      row.classList.toggle("cm-dim", arr.length > 0 && !isFocus);
    });
  }

  // L2 紧凑命中矩阵：号码为行、时间为横向；hit=实心圆+号、miss=弱化、最新期 marker、左侧号码 sticky、右侧当前遗漏数字。
  function buildCompactMatrix(issues, period, groupRule) {
    var w = sliceWindow(issues, period);
    var key = groupRule.key;
    var nums = [];
    for (var num = groupRule.min; num <= groupRule.max; num++) {
      var cells = [];
      for (var i = 0; i < w.length; i++) cells.push(w[i][key].indexOf(num) >= 0);
      var curOmit = 0;
      for (var j = w.length - 1; j >= 0; j--) { if (cells[j]) break; curOmit++; }
      nums.push({ number: num, cells: cells, curOmit: curOmit });
    }
    return { groupRule: groupRule, issues: w, numbers: nums };
  }

  function renderCompactMatrix(container, data, opts) {
    opts = opts || {};
    var w = data.issues;
    var kind = data.groupRule.key;
    var parts = ['<table class="cmt-table" data-matrix="' + kind + '" data-kind="' + kind + '"><thead><tr><th class="corner">' + (kind === "front" ? "前区" : "后区") + "</th>"];
    for (var c = 0; c < w.length; c++) {
      var show = (c % 5 === 0) || (c === w.length - 1);
      var latest = (c === w.length - 1);
      parts.push('<th class="cmt-issue' + (latest ? " is-latest" : "") + '" title="第 ' + w[c].issue + " 期 · " + w[c].date + '">' +
        (show ? w[c].issue.slice(2) : "") + "</th>");
    }
    parts.push('<th class="cmt-omit-h">遗漏</th></tr></thead><tbody>');
    data.numbers.forEach(function (row) {
      var focusArr = normalizeFocus(focusRoot()[kind]);
      var focus = focusArr.indexOf(row.number) >= 0;
      parts.push('<tr class="cmt-row" data-num="' + pad2(row.number) + '"><th class="cmt-num" data-num="' + pad2(row.number) + '">' +
        pad2(row.number) + "</th>");
      for (var ci = 0; ci < w.length; ci++) {
        var latest = (ci === w.length - 1);
        if (row.cells[ci]) {
          parts.push('<td class="cmt-cell cmt-hit' + (latest ? " is-latest" : "") + '" data-issue="' + w[ci].issue + '" data-date="' +
            w[ci].date + '" data-num="' + pad2(row.number) + '" data-omit="' + row.curOmit + '" data-kind="' + kind + '" title="第 ' +
            w[ci].issue + " 期 · 号码 " + pad2(row.number) + '"><span class="cmt-dot"></span><span class="cmt-n">' + pad2(row.number) + "</span></td>");
        } else {
          parts.push('<td class="cmt-cell cmt-miss' + (latest ? " is-latest" : "") + '"></td>');
        }
      }
      parts.push('<td class="cmt-omit-v' + (row.curOmit > 0 ? " omit" : "") + '">' + row.curOmit + "</td></tr>");
    });
    parts.push("</tbody></table>");
    container.innerHTML = parts.join("");
  }

  // 触摸详情：点击命中格 → 底部 sheet（非 hover 依赖）。PC hover 仍保留（bindTrendTooltip）。
  function bindCompactTap() {
    document.addEventListener("click", function (e) {
      var td = e.target && e.target.closest ? e.target.closest(".cmt-cell.cmt-hit[data-issue]") : null;
      var sheet = document.getElementById("trend-detail-sheet");
      if (!td) return;
      var all = window.__trendIssues || [];
      var cur = null;
      for (var i = 0; i < all.length; i++) if (String(all[i].issue) === td.getAttribute("data-issue")) { cur = all[i]; break; }
      var kind = td.getAttribute("data-kind") === "front" ? "前区" : "后区";
      if (sheet) {
        sheet.innerHTML =
          '<div class="tts-h">' + kind + " 号码 <strong>" + td.getAttribute("data-num") + "</strong> · 第 " + td.getAttribute("data-issue") +
          " 期（" + (cur ? cur.date : "") + "）</div>" +
          '<div class="tts-line">该期开奖：前区 ' + (cur ? cur.front.map(pad2).join(" ") : "—") + " ｜ 后区 " +
          (cur ? cur.back.map(pad2).join(" ") : "—") + "</div>" +
          '<div class="tts-line">当前遗漏 <strong>' + td.getAttribute("data-omit") + "</strong> 期 · 状态：命中</div>" +
          '<button type="button" class="tts-close">关闭</button>';
        sheet.hidden = false;
        var close = sheet.querySelector(".tts-close");
        if (close) close.addEventListener("click", function () { sheet.hidden = true; sheet.innerHTML = ""; });
      }
    });
  }

  /* ================= 页面启动：loadJSON → calculate → render ================= */
  function init() {
    // P1-3A：mobile-first。移动默认 30 期；桌面 ≥760 默认 300（L3 完整矩阵可 1000）。
    var mobile = (window.innerWidth || 0) < 760;
    var state = {
      l1: mobile ? 30 : 50,
      l2: mobile ? 30 : 50,
      l3: mobile ? 50 : 300,
      l2Tab: "front",
      l3Tab: "front",
      l3Open: false,
      l2View: "matrix" // P1-3B：L2 视图 [命中矩阵 | 轨迹]，默认命中矩阵
    };
    window.__focus = window.__focus || {};
    var matrix = null;
    var issues = [];
    var meta = { cover: "—", issueRange: "—", frontTotal: "—", backTotal: "—", sourceName: "—" };

    // 📊 数据概览（动态读 JSON；完整矩阵范围随 L3 窗口联动）
    function renderSummary() {
      document.getElementById("sum-range").textContent = "最近 " + state.l3 + " 期（完整矩阵）";
      document.getElementById("sum-cover").textContent = meta.cover;
      document.getElementById("sum-issue").textContent = meta.issueRange;
      document.getElementById("sum-front").textContent = meta.frontTotal;
      document.getElementById("sum-back").textContent = meta.backTotal;
      document.getElementById("sum-source").textContent = meta.sourceName;
    }

    function renderL1() {
      var el = document.getElementById("l1-summary");
      if (el) renderL1Summary(el, issues, state.l1);
    }
    function renderL2() {
      var show = state.l2Tab;
      // P1-3B：L2 视图 [命中矩阵 | 轨迹]。focus panel 两个视图共享。
      var fp = document.getElementById("focus-panel-" + show);
      if (fp) fp.hidden = false;
      var fp2 = document.getElementById("focus-panel-" + (show === "front" ? "back" : "front"));
      if (fp2) fp2.hidden = true;

      var isMatrix = (state.l2View === "matrix");
      var fM = document.getElementById("cb-matrix-front");
      var bM = document.getElementById("cb-matrix-back");
      var fT = document.getElementById("cb-trajectory-front");
      var bT = document.getElementById("cb-trajectory-back");
      // 命中矩阵容器
      if (fM) fM.hidden = !(isMatrix && show === "front");
      if (bM) bM.hidden = !(isMatrix && show === "back");
      // 轨迹容器
      if (fT) fT.hidden = !(!isMatrix && show === "front");
      if (bT) bT.hidden = !(!isMatrix && show === "back");

      // 渲染命中矩阵（仅当前 tab；两视图共享 focus）
      var target = (show === "front") ? fM : bM;
      if (target && isMatrix) {
        renderCompactMatrix(target, buildCompactMatrix(issues, state.l2, show === "front" ? GROUP_RULES.front : GROUP_RULES.back));
      }
      // 渲染轨迹视图（仅当前 tab）
      var trajTarget = (show === "front") ? fT : bT;
      if (trajTarget && !isMatrix) {
        renderTrajectoryView(trajTarget, issues, show, state.l2);
      }
      // focus 卡片（含多号统计 + 矩阵高亮，两视图共享）
      refreshFocus(show, issues, state.l2);
      syncL2ViewButtons(show);
    }
    function syncL2ViewButtons() {
      var sw = document.getElementById("l2-view-switch");
      if (!sw) return;
      sw.querySelectorAll("button").forEach(function (b) {
        var v = b.getAttribute("data-l2view");
        b.classList.toggle("active", v === state.l2View);
        b.setAttribute("aria-pressed", v === state.l2View ? "true" : "false");
      });
    }
    function renderL3() {
      var el = document.getElementById("l3-matrix");
      if (!el || !state.l3Open) return;
      var show = state.l3Tab;
      var rule = show === "front" ? GROUP_RULES.front : GROUP_RULES.back;
      el.innerHTML = '<h3 class="ocm-group">' + (show === "front" ? "前区（01–35）" : "后区（01–12）") + '</h3><div class="ocm-wrap"></div>';
      renderOccurrenceMatrix(el.querySelector(".ocm-wrap"), buildOccurrenceMatrix(issues, state.l3, rule), { latest: true });
    }
    function renderAdvanced() {
      if (!state.l3Open) return;
      document.getElementById("front-hot").innerHTML = renderHotTable(calculateHot(issues, state.l3, "front"), "front");
      document.getElementById("front-missing").innerHTML = renderMissingTable(calculateMissing(issues, state.l3, "front"), "front");
      document.getElementById("back-hot").innerHTML = renderHotTable(calculateHot(issues, state.l3, "back"), "back");
      var oeCur = calculateOddEven(issues, state.l3, "back");
      renderRatioBars(document.getElementById("back-odd-even"),
        { pct: oeCur.odd, txt: "奇数 " + oeCur.odd + "%" }, "当前(" + state.l3 + "期)奇占比",
        [30, 50, 100, 300].map(function (p) { var r = calculateOddEven(issues, p, "back"); return { label: p + "期", pct: r.odd, txt: "奇" + r.odd + "% 偶" + r.even + "%" }; }));
      var bsCur = calculateBigSmall(issues, state.l3, "back", BACK_BOUNDARY);
      renderRatioBars(document.getElementById("back-big-small"),
        { pct: bsCur.big, txt: "大 " + bsCur.big + "%" }, "当前(" + state.l3 + "期)大占比",
        [30, 50, 100, 300].map(function (p) { var r = calculateBigSmall(issues, p, "back", BACK_BOUNDARY); return { label: p + "期", pct: r.big, txt: "小 " + r.small + "% 大 " + r.big + "%" }; }));
      renderHeatMap(document.getElementById("hm-front"), buildHeatMap(issues, state.l3, GROUP_RULES.front), { latest: true });
      renderHeatLegend(document.getElementById("hm-legend-front"), "front");
      renderHeatMap(document.getElementById("hm-back"), buildHeatMap(issues, state.l3, GROUP_RULES.back), { latest: true });
      renderHeatLegend(document.getElementById("hm-legend-back"), "back");
      renderMissingAnalysis(issues, state.l3);
    }
    function renderAll() {
      window.__trendIssues = issues;
      renderSummary();
      renderL1();
      renderL2();
      renderL3();
      renderAdvanced();
    }

    wirePeriodSwitch(document.getElementById("l1-period-switch"), function (p) { state.l1 = p; renderL1(); });
    wirePeriodSwitch(document.getElementById("l2-period-switch"), function (p) { state.l2 = p; renderL2(); });
    wirePeriodSwitch(document.getElementById("l3-period-switch"), function (p) { state.l3 = p; renderL3(); renderAdvanced(); });
    wireTab(document.getElementById("cb-tabs"), function (t) { state.l2Tab = t; renderL2(); });
    wireTab(document.getElementById("l3-tabs"), function (t) { state.l3Tab = t; renderL3(); });
    // P1-3B：L2 视图切换 [命中矩阵 | 轨迹]
    var l2viewsw = document.getElementById("l2-view-switch");
    if (l2viewsw) {
      l2viewsw.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-l2view]");
        if (!btn) return;
        state.l2View = btn.getAttribute("data-l2view");
        renderL2();
      });
    }

    var l3det = document.getElementById("l3-details");
    if (l3det) l3det.addEventListener("toggle", function () {
      state.l3Open = l3det.open;
      if (l3det.open) { renderL3(); renderAdvanced(); }
    });

    document.querySelectorAll(".anchor-nav a").forEach(function (a) {
      a.addEventListener("click", function () {
        var id = this.getAttribute("href").slice(1);
        var target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    bindTrendTooltip();   // PC hover（保留）
    bindCompactTap();     // 触摸详情（click，非 hover 依赖）

    // S1：统一数据加载入口（loadData → 排序 + meta；交互不再重复 fetch）
    loadData().then(function (res) {
      issues = res.issues;
      meta = res.meta;
      matrix = buildMatrices(issues);
      renderAll();
    }).catch(function (err) {
      showError(String(err && err.message ? err.message : err));
    });
  }

  function wirePeriodSwitch(el, onPick) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      el.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      onPick(parseInt(btn.getAttribute("data-periods"), 10));
    });
  }
  function wireTab(el, onPick) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      el.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      onPick(btn.getAttribute("data-tab"));
    });
  }

  var api = {
    PERIODS: PERIODS,
    GROUP_RULES: GROUP_RULES,
    loadData: loadData,
    sliceWindow: sliceWindow,
    calculateHot: calculateHot,
    calculateMissing: calculateMissing,
    calculateOddEven: calculateOddEven,
    calculateBigSmall: calculateBigSmall,
    buildMatrices: buildMatrices,
    calculateCellMissing: calculateCellMissing,
    buildOmissionProfile: buildOmissionProfile,
    buildOccurrenceMatrix: buildOccurrenceMatrix,
    // P1-3A mobile-first
    computeL1Summary: computeL1Summary,
    renderL1Summary: renderL1Summary,
    buildCompactMatrix: buildCompactMatrix,
    renderCompactMatrix: renderCompactMatrix,
    computeFocusStats: computeFocusStats,
    renderFocusPanel: renderFocusPanel,
    setFocus: setFocus,
    refreshFocus: refreshFocus,
    renderFocusDetail: renderFocusDetail,
    highlightMatrixFocus: highlightMatrixFocus,
    getFocusNumbers: getFocusNumbers,
    focusSet: focusSet,
    toggleFocus: toggleFocus,
    bindCompactTap: bindCompactTap,
    // P1-3B：L2 轨迹视图（SVG，单号/多号 lane，复用 computeFocusStats，历史描述性）
    buildTrajectory: buildTrajectory,
    buildTrajectorySVG: buildTrajectorySVG,
    buildTrajectoryLaneHTML: buildTrajectoryLaneHTML,
    buildTrajectoryViewHTML: buildTrajectoryViewHTML,
    buildTrajectoryDetailSheet: buildTrajectoryDetailSheet,
    renderTrajectoryView: renderTrajectoryView,
    renderTrajectoryLane: renderTrajectoryLane,
    bindTrajectoryTap: bindTrajectoryTap,
    wirePeriodSwitch: wirePeriodSwitch,
    wireTab: wireTab,
    renderTrajectoryHTML: renderTrajectoryHTML,
    renderOccurrenceMatrix: renderOccurrenceMatrix,
    renderHotTable: renderHotTable,
    renderMissingTable: renderMissingTable,
    // S3 遗漏趋势
    renderOmissionCurrent: renderOmissionCurrent,
    renderOmissionChange: renderOmissionChange,
    renderOmissionLong: renderOmissionLong,
    renderMissingAnalysis: renderMissingAnalysis,
    // S4 热冷矩阵
    calcColorLevel: calcColorLevel,
    buildHeatMap: buildHeatMap,
    renderHeatMap: renderHeatMap,
    renderHeatLegend: renderHeatLegend,
    bindHeatMapTooltip: bindHeatMapTooltip,
    // tooltip
    bindTrendTooltip: bindTrendTooltip
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;             // Node 测试用
  } else {
    root.TrendV2API = api;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})(typeof self !== "undefined" ? self : this);
