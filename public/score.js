/* =========================================================
   综合评分分析 · 评分引擎（score）
   - 数据来源：优先 Cloudflare Pages Functions API（/api/issues?range=all，全历史 2910 期）；
               失败自动降级 ./data/dlt_history.json（1000 期快照，零外部依赖）
   - 权重配置化：SCORE_WEIGHTS（禁止硬编码权重）
   - 评分版本信息：SCORE_VERSION
   - 结构：loadIssues() → scoreAll() → render()
   - 自包含纯函数（不依赖其他 JS），node 可测
   ========================================================= */
(function (root) {
  "use strict";

  /* ===== 评分版本信息 ===== */
  var MODEL_TYPES = ["standard", "cold-hot", "expert"];  // 支持的多模型列表（先于 SCORE_VERSION 定义）
  var SCORE_VERSION = {
    scoreVersion: "v1.1",
    weightVersion: "default",
    generatedFrom: "1000期历史开奖数据",
    modelTypes: MODEL_TYPES
  };

  /* ===== 权重配置（配置化，禁止硬编码） =====
     多模型权重表：SCORE_MODELS[modelType]；各模型权重和 = 1.0
     standard  标准模型：均衡参考（默认）
     cold-hot  冷热模型：强化近期热度与冷热平衡
     expert    专家模型：强化组合结构（连号/和值/分布） */
  var SCORE_MODELS = {
    standard: {
      frequency: 0.25,   // 历史出现频率
      recentHot: 0.20,   // 近期热度（窗口内出现次数）
      missing: 0.15,     // 遗漏周期（当前/平均/最大）
      balance: 0.15,     // 冷热平衡（过热衰减 / 过冷补偿）
      oddEven: 0.10,     // 奇偶结构
      bigSmall: 0.10,    // 大小结构
      structure: 0.05    // 组合结构（连号 / 和值 / 分布）
    },
    "cold-hot": {
      frequency: 0.20,
      recentHot: 0.25,
      missing: 0.15,
      balance: 0.20,
      oddEven: 0.10,
      bigSmall: 0.05,
      structure: 0.05
    },
    expert: {
      frequency: 0.20,
      recentHot: 0.20,
      missing: 0.15,
      balance: 0.10,
      oddEven: 0.10,
      bigSmall: 0.10,
      structure: 0.15
    }
  };
  var SCORE_WEIGHTS = SCORE_MODELS.standard;   // 兼容导出（默认标准模型）

  var PERIODS = [50, 100, 300, 1000, "all"];  // "all" = 全部已加载数据（API 全历史 / 降级 JSON 全量）
  var DEFAULT_PERIOD = 100;
  var FRONT_MIN = 1, FRONT_MAX = 35;
  var BACK_MIN = 1, BACK_MAX = 12;
  var FRONT_BOUNDARY = 17; // 前区：01-17 小 / 18-35 大
  var BACK_BOUNDARY = 6;   // 后区：01-06 小 / 07-12 大
  var TOP_N = 10;

  function pad2(n) { return String(n).padStart(2, "0"); }
  function range(a, b) { var out = []; for (var i = a; i <= b; i++) out.push(i); return out; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }

  function loadJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " @ " + path);
      return r.json();
    });
  }

  /* 数据加载：API 优先（/api/issues?range=all 全历史）→ 失败自动降级 JSON 快照 */
  function loadIssues() {
    return fetch("./api/issues?range=all", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("API HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d || !Array.isArray(d.issues) || !d.issues.length) throw new Error("API 数据为空");
        return { issues: d.issues, source: "api" };
      })
      .catch(function (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[score] API 加载失败，降级 JSON：", err && err.message ? err.message : err);
        }
        return loadJSON("./data/dlt_history.json").then(function (d) {
          return { issues: d.issues || [], source: "json" };
        });
      });
  }

  /* 轨 B：从 /api/scores 读取缓存评分（仅固定窗口 50/100/300/1000；all 仍走轨 A）
     返回与 scoreAll 同构 [{num, total, tag, parts}]；失败 reject，由调用方回退轨 A */
  var CACHE_PERIODS = [50, 100, 300, 1000];
  function loadScoresFromAPI(period, kind, modelType) {
    var q = "period=" + encodeURIComponent(period) +
            "&kind=" + encodeURIComponent(kind) +
            "&model_type=" + encodeURIComponent(modelType);
    return fetch("./api/scores?" + q, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("API HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d || !Array.isArray(d.numbers) || !d.numbers.length) {
          throw new Error("API 缓存为空");
        }
        return d.numbers.map(function (n) {
          return { num: n.num, total: n.total, tag: n.tag, parts: n.parts || {} };
        });
      });
  }

  /* ================= 基础分析纯函数（与 trend-v2 同口径，自包含实现） ================= */

  function sliceWindow(issues, n) {
    if (n === "all") return issues.slice();
    return issues.slice(Math.max(0, issues.length - n));
  }

  // 热度：{num, count, omit} 按 count 倒序；omit=当前连续未开出期数
  function calculateHot(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var freq = {}, last = {};
    w.forEach(function (it, idx) {
      it[kind].forEach(function (x) { freq[x] = (freq[x] || 0) + 1; last[x] = idx; });
    });
    var lastIdx = w.length - 1;
    var out = [];
    Object.keys(freq).forEach(function (k) {
      out.push({ num: parseInt(k, 10), count: freq[k], omit: lastIdx - (last[k] != null ? last[k] : lastIdx) });
    });
    out.sort(function (a, b) { return b.count - a.count; });
    return out;
  }

  // 遗漏：{num, cur, max, avg}
  function calculateMissing(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var pool = kind === "front" ? range(FRONT_MIN, FRONT_MAX) : range(BACK_MIN, BACK_MAX);
    return pool.map(function (num) {
      var cur = 0;
      for (var i = w.length - 1; i >= 0; i--) { if (w[i][kind].indexOf(num) >= 0) break; cur++; }
      var run = 0, max = 0, totalRun = 0, runCount = 0;
      for (var j = 0; j < w.length; j++) {
        if (w[j][kind].indexOf(num) >= 0) {
          if (run > 0) { totalRun += run; runCount++; if (run > max) max = run; run = 0; }
        } else { run++; }
      }
      if (run > 0) { totalRun += run; runCount++; if (run > max) max = run; }
      return { num: num, cur: cur, max: max, avg: runCount ? round1(totalRun / runCount) : 0 };
    });
  }

  // 奇偶占比 {odd, even, total}
  function calculateOddEven(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var odd = 0, even = 0;
    w.forEach(function (it) { it[kind].forEach(function (x) { if (x % 2 === 1) odd++; else even++; }); });
    var t = odd + even;
    return { odd: t ? round1(odd / t * 100) : 50, even: t ? round1(even / t * 100) : 50, total: t };
  }

  // 大小占比 {small, big, total}
  function calculateBigSmall(issues, n, kind, boundary) {
    var w = sliceWindow(issues, n);
    var small = 0, big = 0;
    w.forEach(function (it) { it[kind].forEach(function (x) { if (x <= boundary) small++; else big++; }); });
    var t = small + big;
    return { small: t ? round1(small / t * 100) : 50, big: t ? round1(big / t * 100) : 50, total: t };
  }

  // 连号参与率：{num: 参与连号的期数占比*100}（前区相邻号码同开）
  function calculateConsec(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var nLen = w.length;
    var counts = {};
    w.forEach(function (it) {
      var s = it[kind].slice().sort(function (a, b) { return a - b; });
      s.forEach(function (x, i) {
        if ((i > 0 && s[i - 1] === x - 1) || (i < s.length - 1 && s[i + 1] === x + 1)) {
          counts[x] = (counts[x] || 0) + 1;
        }
      });
    });
    return counts;
  }

  /* ================= 评分引擎 ================= */

  // 遗漏周期分：倒 U 形回摆（0~2avg 升到 100，超长回落，避免追超长遗漏）
  function missScore(cur, avg) {
    if (avg <= 0) return 50;
    if (cur <= avg) return clamp(Math.round(cur / avg * 80), 0, 100);
    if (cur <= 2 * avg) return clamp(Math.round(80 + (cur - avg) / avg * 20), 0, 100);
    return clamp(Math.round(100 - (cur - 2 * avg) / avg * 30), 0, 100);
  }

  // 对单个号码评分：返回 {num, total, tag, parts:{...}}，parts 七项贡献分之和 = total
  function scoreNumber(num, ctx) {
    var w = ctx.window;
    var n = w.length;
    var hm = ctx.hotMap[num] || null;
    var count = hm ? hm.count : 0;
    var omit = ctx.missMap[num] ? ctx.missMap[num].cur : 0;
    var avg = ctx.missMap[num] ? ctx.missMap[num].avg : 0;
    var avgCount = n * 5 / (ctx.kind === "front" ? 35 : 12);
    var maxCount = ctx.maxCount;
    var oddPct = num % 2 === 1 ? ctx.oddPct : ctx.evenPct;          // 奇偶结构分
    var smallPct = num <= ctx.boundary ? ctx.smallPct : ctx.bigPct; // 大小结构分
    var consecCount = ctx.consecMap[num] || 0;

    // 各维度归一化（0-100）
    var sFrequency = clamp(Math.round(count / avgCount * 50), 0, 100);                 // 历史频率
    var sRecentHot = clamp(Math.round(maxCount ? count / maxCount * 100 : 50), 0, 100); // 近期热度
    var sMissing = missScore(omit, avg);                                               // 遗漏周期
    var sBalance = ctx.balanceMap[num];                                                // 冷热平衡（预计算）
    var sOddEven = clamp(Math.round(oddPct), 0, 100);                                  // 奇偶结构
    var sBigSmall = clamp(Math.round(smallPct), 0, 100);                               // 大小结构
    var sStructure = clamp(Math.round(n ? consecCount / n * 150 : 50), 0, 100);        // 组合结构

    // 加权贡献分（四舍五入，保证七项之和 = 总分）；权重取自当前模型 ctx.weights
    var W = ctx.weights;
    var parts = {
      frequency: Math.round(W.frequency * sFrequency),
      recentHot: Math.round(W.recentHot * sRecentHot),
      missing: Math.round(W.missing * sMissing),
      balance: Math.round(W.balance * sBalance),
      oddEven: Math.round(W.oddEven * sOddEven),
      bigSmall: Math.round(W.bigSmall * sBigSmall),
      structure: Math.round(W.structure * sStructure)
    };
    var total = parts.frequency + parts.recentHot + parts.missing + parts.balance +
                parts.oddEven + parts.bigSmall + parts.structure;
    return { num: num, total: total, tag: ctx.tagMap[num], parts: parts };
  }

  // 批量评分：kind = "front" | "back"，返回按 total 降序的数组；n = 数字窗口或 "all"；modelType = standard|cold-hot|expert
  function scoreAll(issues, n, kind, modelType) {
    if (n === "all") n = issues.length;   // "all" → 全量窗口（API 全历史 / 降级 JSON 全量）
    var weights = SCORE_MODELS[modelType] || SCORE_MODELS.standard;
    var w = sliceWindow(issues, n);
    var nLen = w.length;
    var pool = kind === "front" ? range(FRONT_MIN, FRONT_MAX) : range(BACK_MIN, BACK_MAX);
    var boundary = kind === "front" ? FRONT_BOUNDARY : BACK_BOUNDARY;

    var hot = calculateHot(issues, n, kind);
    var missMap = {};
    calculateMissing(issues, n, kind).forEach(function (m) { missMap[m.num] = m; });
    var hotMap = {}, hotOrder = [];
    hot.forEach(function (h) { hotMap[h.num] = h; hotOrder.push(h.num); });
    var oe = calculateOddEven(issues, n, kind);
    var bs = calculateBigSmall(issues, n, kind, boundary);
    var consecMap = calculateConsec(issues, n, kind);
    var maxCount = hot.length ? hot[0].count : 0;

    // 冷热平衡分：按窗口频率排名三分位基分 + 近期热度微调（过热衰减/过冷补偿）
    var rankMap = {};
    hotOrder.forEach(function (num, idx) { rankMap[num] = idx / Math.max(1, hotOrder.length - 1); });
    var balanceMap = {};
    pool.forEach(function (num) {
      var base = rankMap[num] != null
        ? (rankMap[num] < 1 / 3 ? 72 : rankMap[num] > 2 / 3 ? 42 : 60)
        : 50;
      var hotAdj = clamp(Math.round((hotMap[num] && maxCount ? hotMap[num].count / maxCount * 100 : 50) - 50) / 100 * 16, -8, 8);
      balanceMap[num] = clamp(Math.round(base + hotAdj), 20, 95);
    });

    // 冷热标签：按窗口频率排名三分位（🔥热号 / ⚖平衡 / ❄冷号）
    var tagMap = {};
    pool.forEach(function (num) {
      var r = rankMap[num];
      tagMap[num] = r == null ? "⚖平衡" : r < 1 / 3 ? "🔥热号" : r > 2 / 3 ? "❄冷号" : "⚖平衡";
    });

    var ctx = {
      window: w, kind: kind, boundary: boundary, weights: weights,
      hotMap: hotMap, missMap: missMap, consecMap: consecMap,
      maxCount: maxCount,
      oddPct: oe.odd, evenPct: oe.even, smallPct: bs.small, bigPct: bs.big,
      balanceMap: balanceMap, tagMap: tagMap
    };
    var out = pool.map(function (num) { return scoreNumber(num, ctx); });
    out.sort(function (a, b) { return b.total - a.total; });
    return out;
  }

  /* ================= 渲染层 ================= */

  var PART_LABELS = {
    frequency: "历史频率", recentHot: "近期热度", missing: "遗漏周期",
    balance: "冷热平衡", oddEven: "奇偶结构", bigSmall: "大小结构", structure: "组合结构"
  };

  function renderScoreList(container, items, kind) {
    var numCls = kind === "front" ? "f" : "b";
    var rankCls = kind === "front" ? "front" : "back";
    var top = items.slice(0, TOP_N);
    var html = top.map(function (it, i) {
      var p = it.parts;
      var partsHtml = Object.keys(PART_LABELS).map(function (k) {
        return '<span class="part"><span class="part-lbl">' + PART_LABELS[k] +
          '</span><span class="part-val ' + (p[k] >= 0 ? "plus" : "") + '">' +
          (p[k] >= 0 ? "+" : "") + p[k] + "</span></span>";
      }).join("");
      return '<div class="score-card" data-num="' + it.num + '">' +
        '<div class="score-card-head">' +
        '<span class="rank">' + (i + 1) + "</span>" +
        '<span class="ball ' + numCls + '">' + pad2(it.num) + "</span>" +
        '<span class="score-total">' + it.total + "</span>" +
        '<span class="tag ' + tagCls(it.tag) + '">' + it.tag + "</span>" +
        '<span class="expand-hint">详情 ▾</span></div>' +
        '<div class="score-parts hidden">' + partsHtml + "</div></div>";
    }).join("");
    container.innerHTML = html;
    container.querySelectorAll(".score-card").forEach(function (card) {
      card.addEventListener("click", function () {
        card.querySelector(".score-parts").classList.toggle("hidden");
        card.querySelector(".expand-hint").textContent =
          card.querySelector(".score-parts").classList.contains("hidden") ? "详情 ▾" : "收起 ▴";
      });
    });
  }

  function tagCls(tag) {
    if (tag.indexOf("🔥") >= 0) return "hot";
    if (tag.indexOf("❄") >= 0) return "cold";
    return "mid";
  }

  function showError(msg) {
    document.getElementById("error").hidden = false;
    document.getElementById("error-detail").textContent = "数据暂时无法加载，请稍后重试。";
  }

  /* ================= 页面启动：loadJSON → scoreAll → render ================= */
  function init() {
    var period = DEFAULT_PERIOD;
    var modelType = "standard";

    var drawSeq = 0;
    function draw(issues) {
      var seq = ++drawSeq;
      function renderFront(items) { renderScoreList(document.getElementById("front-scores"), items, "front"); }
      function renderBack(items) { renderScoreList(document.getElementById("back-scores"), items, "back"); }

      // period = all 保持轨 A（/api/issues 全历史 + 前端即时计算）
      // 固定窗口（50/100/300/1000）优先轨 B 缓存 /api/scores，失败回退轨 A scoreAll
      if (CACHE_PERIODS.indexOf(period) < 0) {
        renderFront(scoreAll(issues, period, "front", modelType));
        renderBack(scoreAll(issues, period, "back", modelType));
        return;
      }
      loadScoresFromAPI(period, "front", modelType)
        .catch(function () { return scoreAll(issues, period, "front", modelType); })
        .then(function (items) { if (seq === drawSeq) renderFront(items); });
      loadScoresFromAPI(period, "back", modelType)
        .catch(function () { return scoreAll(issues, period, "back", modelType); })
        .then(function (items) { if (seq === drawSeq) renderBack(items); });
    }

    document.getElementById("period-switch").addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var raw = btn.getAttribute("data-periods");
      period = raw === "all" ? "all" : parseInt(raw, 10);
      this.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      draw(this._issues);
    });

    // 评分模型切换（standard / cold-hot / expert）
    var modelSwitch = document.getElementById("model-switch");
    if (modelSwitch) {
      modelSwitch.addEventListener("click", function (e) {
        var btn = e.target.closest("button");
        if (!btn) return;
        modelType = btn.getAttribute("data-model") || "standard";
        this.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b === btn); });
        draw(this._issues);
      });
    }

    loadIssues().then(function (res) {
      var issues = res.issues || [];
      if (!issues.length) throw new Error("历史数据为空");
      document.getElementById("period-switch")._issues = issues;
      draw(issues);
    }).catch(function (err) {
      showError(String(err && err.message ? err.message : err));
    });
  }

  var api = {
    SCORE_VERSION: SCORE_VERSION,
    SCORE_WEIGHTS: SCORE_WEIGHTS,
    SCORE_MODELS: SCORE_MODELS,
    MODEL_TYPES: MODEL_TYPES,
    PERIODS: PERIODS,
    sliceWindow: sliceWindow,
    calculateHot: calculateHot,
    calculateMissing: calculateMissing,
    calculateOddEven: calculateOddEven,
    calculateBigSmall: calculateBigSmall,
    calculateConsec: calculateConsec,
    scoreAll: scoreAll,
    loadIssues: loadIssues,
    loadScoresFromAPI: loadScoresFromAPI
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;             // Node 测试用
  } else {
    root.ScoreAPI = api;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})(typeof self !== "undefined" ? self : this);
