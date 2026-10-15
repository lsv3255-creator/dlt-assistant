/* =========================================================
   选号助手 · 选号引擎（pick）
   - 定位：非预测工具，仅历史统计娱乐参考
   - 数据来源：优先 /api/issues?range=all（全历史 2910 期）；失败降级 ./data/dlt_history.json
   - 功能：randomPick 普通机选 / smartPick 智能风格机选 /
           analyzePick 手动号码历史表现分析 / completePick 智能补全（接口预留）
   - 结构：loadIssues() → 选号纯函数 → render()
   - 自包含 IIFE（不依赖其他 JS），node 可测
   ========================================================= */
(function (root) {
  "use strict";

  var FRONT_MIN = 1, FRONT_MAX = 35;
  var BACK_MIN = 1, BACK_MAX = 12;
  var FRONT_BOUNDARY = 17;  // 前区 01-17 小 / 18-35 大
  var BACK_BOUNDARY = 6;    // 后区 01-06 小 / 07-12 大
  var ZONES = [12, 24, 35]; // 前区三区间上界：1-12 / 13-24 / 25-35
  var SMART_RETRY = 20;     // 智能机选约束重试上限

  function pad2(n) { return String(n).padStart(2, "0"); }
  function range(a, b) { var out = []; for (var i = a; i <= b; i++) out.push(i); return out; }
  function shuffle(arr) { var a = arr.slice(), i, j, t; for (i = a.length - 1; i > 0; i--) { j = Math.floor(Math.random() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ================= 数据加载（API 优先 → JSON 降级，与 score.js 同模式） ================= */
  function loadJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " @ " + path);
      return r.json();
    });
  }
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
          console.warn("[pick] API 加载失败，降级 JSON：", err && err.message ? err.message : err);
        }
        return loadJSON("./data/dlt_history.json").then(function (d) {
          return { issues: d.issues || [], source: "json" };
        });
      });
  }

  /* ================= 分析指标纯函数（与 score.js 同口径，自包含实现） ================= */
  function sliceWindow(issues, n) {
    if (n === "all") return issues.slice();
    return issues.slice(Math.max(0, issues.length - n));
  }

  // 热度 {num, count, omit} 按 count 倒序
  function calculateHot(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var freq = {}, last = {};
    w.forEach(function (it, idx) {
      it[kind].forEach(function (x) { freq[x] = (freq[x] || 0) + 1; last[x] = idx; });
    });
    var lastIdx = w.length - 1, out = [];
    Object.keys(freq).forEach(function (k) {
      out.push({ num: parseInt(k, 10), count: freq[k], omit: lastIdx - (last[k] != null ? last[k] : lastIdx) });
    });
    out.sort(function (a, b) { return b.count - a.count; });
    return out;
  }

  // 遗漏 {num, cur, max, avg}
  function calculateMissing(issues, n, kind) {
    var w = sliceWindow(issues, n);
    var pool = kind === "front" ? range(FRONT_MIN, FRONT_MAX) : range(BACK_MIN, BACK_MAX);
    return pool.map(function (num) {
      var cur = 0;
      for (var i = w.length - 1; i >= 0; i--) { if (w[i][kind].indexOf(num) >= 0) break; cur++; }
      return { num: num, cur: cur, max: 0, avg: 0 };
    });
  }

  // 三分位热冷池：{ hot: [nums], mid: [nums], cold: [nums] }
  function poolByTier(hotArr, pool) {
    var rank = {}, tier = { hot: [], mid: [], cold: [] };
    hotArr.forEach(function (h, idx) { rank[h.num] = idx / Math.max(1, hotArr.length - 1); });
    pool.forEach(function (num) {
      var r = rank[num];
      if (r == null) tier.cold.push(num);
      else if (r < 1 / 3) tier.hot.push(num);
      else if (r > 2 / 3) tier.cold.push(num);
      else tier.mid.push(num);
    });
    return tier;
  }

  /* ================= 组合生成 ================= */

  // 普通机选：纯随机 n 注 {front, back}
  function randomPick(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        front: shuffle(range(FRONT_MIN, FRONT_MAX)).slice(0, 5).sort(function (a, b) { return a - b; }),
        back: shuffle(range(BACK_MIN, BACK_MAX)).slice(0, 2).sort(function (a, b) { return a - b; }),
        mode: "random",
        note: "随机生成，与历史数据无关"
      });
    }
    return out;
  }

  // 约束校验：奇偶/大小/区间/连号
  function checkConstraints(front, kind) {
    var odd = front.filter(function (x) { return x % 2 === 1; }).length;
    if (odd < 2 || odd > 3) return false;                              // 前区奇偶 3:2 或 2:3
    var small = front.filter(function (x) { return x <= FRONT_BOUNDARY; }).length;
    if (small < 2 || small > 3) return false;                          // 大小 2:3 或 3:2
    var z = [0, 0, 0];
    front.forEach(function (x) { for (var i = 0; i < 3; i++) { if (x <= ZONES[i]) { z[i]++; break; } } });
    if (z[0] < 1 || z[1] < 1 || z[2] < 1) return false;                // 三区间各 ≥1
    var s = front.slice().sort(function (a, b) { return a - b; }), consec = 0;
    for (var i = 1; i < s.length; i++) { if (s[i] - s[i - 1] === 1) consec++; }
    return consec <= 1;                                                // 连号 ≤1 组
  }

  // 智能风格机选：约束分池 + 重试
  function smartPick(n, issues, window) {
    var w = sliceWindow(issues, window);
    var hotF = calculateHot(w, "all", "front");
    var tierF = poolByTier(hotF, range(FRONT_MIN, FRONT_MAX));
    var hotB = calculateHot(w, "all", "back");
    var tierB = poolByTier(hotB, range(BACK_MIN, BACK_MAX));
    var out = [];
    for (var i = 0; i < n; i++) {
      var front = null, back = null;
      for (var t = 0; t < SMART_RETRY; t++) {
        var f = shuffle(tierF.hot).slice(0, 2).concat(shuffle(tierF.mid).slice(0, 2), shuffle(tierF.cold).slice(0, 1));
        f = f.sort(function (a, b) { return a - b; });
        if (f.length === 5 && checkConstraints(f)) { front = f; break; }
      }
      if (!front) {
        // 超限退化为：热 2 + 全池随机补齐（尽力均衡）
        front = shuffle(tierF.hot).slice(0, 2);
        var rest = shuffle(range(FRONT_MIN, FRONT_MAX).filter(function (x) { return front.indexOf(x) < 0; })).slice(0, 3);
        front = front.concat(rest).sort(function (a, b) { return a - b; });
      }
      // 后区：奇偶 1:1 + 大小 1:1
      for (var tb = 0; tb < SMART_RETRY; tb++) {
        var oddPool = shuffle(range(BACK_MIN, BACK_MAX).filter(function (x) { return x % 2 === 1; })).slice(0, 1);
        var evenPool = shuffle(range(BACK_MIN, BACK_MAX).filter(function (x) { return x % 2 === 0; })).slice(0, 1);
        var b = oddPool.concat(evenPool);
        var small = b.filter(function (x) { return x <= BACK_BOUNDARY; }).length;
        if (small === 1) { back = b.sort(function (a, b) { return a - b; }); break; }
      }
      if (!back) { back = shuffle(range(BACK_MIN, BACK_MAX)).slice(0, 2).sort(function (a, b) { return a - b; }); }
      out.push({ front: front, back: back, mode: "smart", note: "按历史统计风格组合（冷热2:2:1·奇偶·大小·区间均衡），非预测" });
    }
    return out;
  }

  /* ================= 手动号码历史表现分析 ================= */
  function analyzePick(front, back, issues, window) {
    var w = sliceWindow(issues, window);
    var hotF = calculateHot(w, "all", "front");
    var hotB = calculateHot(w, "all", "back");
    var missF = calculateMissing(w, "all", "front");
    var missB = calculateMissing(w, "all", "back");
    var hmF = {}, hmB = {}, mmF = {}, mmB = {};
    hotF.forEach(function (h) { hmF[h.num] = h; });
    hotB.forEach(function (h) { hmB[h.num] = h; });
    missF.forEach(function (m) { mmF[m.num] = m; });
    missB.forEach(function (m) { mmB[m.num] = m; });

    function tagOf(rankIdx, len) {
      if (len <= 1) return "⚖平衡";
      var r = rankIdx / (len - 1);
      return r < 1 / 3 ? "🔥热号" : r > 2 / 3 ? "❄冷号" : "⚖平衡";
    }
    var per = [];
    front.forEach(function (num) {
      var idx = hotF.findIndex(function (h) { return h.num === num; });
      per.push({ num: num, count: hmF[num] ? hmF[num].count : 0, omit: hmF[num] ? hmF[num].omit : 0, tag: tagOf(idx, hotF.length) });
    });
    back.forEach(function (num) {
      var idx = hotB.findIndex(function (h) { return h.num === num; });
      per.push({ num: num, count: hmB[num] ? hmB[num].count : 0, omit: hmB[num] ? hmB[num].omit : 0, tag: tagOf(idx, hotB.length) });
    });

    // 组合维度
    var odd = front.filter(function (x) { return x % 2 === 1; }).length;
    var small = front.filter(function (x) { return x <= FRONT_BOUNDARY; }).length;
    var zones = [0, 0, 0];
    front.forEach(function (x) { for (var i = 0; i < 3; i++) { if (x <= ZONES[i]) { zones[i]++; break; } } });
    var sum = front.reduce(function (a, x) { return a + x; }, 0);
    var fs = front.slice().sort(function (a, b) { return a - b; }), consec = 0;
    for (var i = 1; i < fs.length; i++) { if (fs[i] - fs[i - 1] === 1) consec++; }

    return {
      front: front.slice().sort(function (a, b) { return a - b; }),
      back: back.slice().sort(function (a, b) { return a - b; }),
      per_number: per,
      combo: {
        odd_even: { odd: odd, even: front.length - odd },
        big_small: { big: front.length - small, small: small },
        zones: { z1: zones[0], z2: zones[1], z3: zones[2] },
        sum: sum,
        consec: consec
      },
      generated_from: w.length + "期历史开奖数据",
      disclaimer: "本报告为历史数据统计，不代表预测中奖"
    };
  }

  /* ================= 智能补全（接口预留：纯函数，UI 后续 Task） ================= */
  // partialFront: 用户已选前区（2-4 个）；partialBack: 用户已选后区（0-1 个）
  function completePick(partialFront, partialBack, issues, window) {
    var w = sliceWindow(issues, window);
    var hotF = calculateHot(w, "all", "front");
    var tierF = poolByTier(hotF, range(FRONT_MIN, FRONT_MAX));
    var needF = 5 - partialFront.length;
    var pickF = partialFront.slice();
    // 补全优先热池，再中池，再冷池
    var pool = shuffle(tierF.hot.concat(tierF.mid, tierF.cold)).filter(function (x) { return pickF.indexOf(x) < 0; });
    for (var i = 0; i < needF && pool.length; i++) {
      var cand = pool.shift();
      if (pickF.indexOf(cand) < 0) pickF.push(cand);
    }
    var needB = 2 - partialBack.length;
    var pickB = partialBack.slice();
    var bpool = shuffle(range(BACK_MIN, BACK_MAX)).filter(function (x) { return pickB.indexOf(x) < 0; });
    while (pickB.length < 2 && bpool.length) pickB.push(bpool.shift());
    return {
      front: pickF.slice(0, 5).sort(function (a, b) { return a - b; }),
      back: pickB.slice(0, 2).sort(function (a, b) { return a - b; }),
      mode: "complete",
      note: "按低遗漏热门池 + 均衡约束补全（接口预留）"
    };
  }

  /* ================= 渲染层 ================= */
  function ballHtml(num, kind) { return '<span class="ball ' + kind + '">' + pad2(num) + "</span>"; }

  function renderMachineResults(container, picks) {
    container.innerHTML = picks.map(function (p, i) {
      var f = p.front.map(function (x) { return ballHtml(x, "f"); }).join("");
      var b = p.back.map(function (x) { return ballHtml(x, "b"); }).join("");
      return '<div class="pick-card">' +
        '<div class="pick-card-head"><span class="pick-idx">第' + (i + 1) + '注</span>' +
        '<span class="pick-mode">' + (p.mode === "smart" ? "智能风格" : "普通随机") + "</span></div>" +
        '<div class="pick-balls"><span class="grp-label">前区</span>' + f + '<span class="grp-label">后区</span>' + b + "</div>" +
        '<p class="pick-note">' + p.note + "</p></div>";
    }).join("");
  }

  function renderManualReport(container, r) {
    var per = r.per_number.map(function (it) {
      return '<div class="per-row"><span class="ball ' + (it.num <= 35 ? "f" : "b") + '">' + pad2(it.num) + "</span>" +
        '<span>出现 <strong>' + it.count + '</strong> 次</span>' +
        '<span>遗漏 <strong>' + it.omit + '</strong> 期</span>' +
        '<span class="tag ' + (it.tag.indexOf("🔥") >= 0 ? "hot" : it.tag.indexOf("❄") >= 0 ? "cold" : "mid") + '">' + it.tag + "</span></div>";
    }).join("");
    var c = r.combo;
    var comboHtml =
      '<div class="combo-item">奇偶 ' + c.odd_even.odd + ':' + c.odd_even.even + "</div>" +
      '<div class="combo-item">大小 ' + c.big_small.big + ':' + c.big_small.small + "</div>" +
      '<div class="combo-item">区间 ' + c.zones.z1 + '/' + c.zones.z2 + '/' + c.zones.z3 + "</div>" +
      '<div class="combo-item">和值 ' + c.sum + "</div>" +
      '<div class="combo-item">连号组 ' + c.consec + "</div>";
    container.innerHTML =
      '<div class="report-block"><h3>📋 单号码历史表现</h3>' + per + "</div>" +
      '<div class="report-block"><h3>🧮 组合结构</h3><div class="combo-grid">' + comboHtml + "</div></div>" +
      '<p class="pick-note">' + r.generated_from + " · " + r.disclaimer + "</p>";
  }

  /* ================= 智能补全结果渲染（复用 analyzePick 详情，不改动现有推荐逻辑） ================= */
  function renderCompleteReport(container, combo, partialF, partialB, issues) {
    var r = analyzePick(combo.front, combo.back, issues, "all");
    var isUserF = {}, isUserB = {};
    partialF.forEach(function (x) { isUserF[x] = true; });
    partialB.forEach(function (x) { isUserB[x] = true; });

    function userBall(x, kind) {
      var isUser = kind === "f" ? isUserF[x] : isUserB[x];
      return '<span class="ball ' + kind + '" style="' + (isUser ? "outline:2px solid var(--accent);outline-offset:1px" : "") + '" title="' +
        (isUser ? "你已选" : "自动补全") + '">' + pad2(x) + "</span>";
    }
    var fBalls = combo.front.map(function (x) { return userBall(x, "f"); }).join("");
    var bBalls = combo.back.map(function (x) { return userBall(x, "b"); }).join("");

    var per = r.per_number.map(function (it) {
      var kind = it.num <= 35 ? "f" : "b";
      return '<div class="per-row"><span class="ball ' + kind + '">' + pad2(it.num) + "</span>" +
        '<span>出现 <strong>' + it.count + '</strong> 次</span>' +
        '<span>遗漏 <strong>' + it.omit + '</strong> 期</span>' +
        '<span class="tag ' + (it.tag.indexOf("🔥") >= 0 ? "hot" : it.tag.indexOf("❄") >= 0 ? "cold" : "mid") + '">' + it.tag + "</span></div>";
    }).join("");
    var c = r.combo;
    var comboHtml =
      '<div class="combo-item">奇偶 ' + c.odd_even.odd + ':' + c.odd_even.even + "</div>" +
      '<div class="combo-item">大小 ' + c.big_small.big + ':' + c.big_small.small + "</div>" +
      '<div class="combo-item">区间 ' + c.zones.z1 + '/' + c.zones.z2 + '/' + c.zones.z3 + "</div>" +
      '<div class="combo-item">和值 ' + c.sum + "</div>" +
      '<div class="combo-item">连号组 ' + c.consec + "</div>";

    container.innerHTML =
      '<div class="report-block"><h3>🎯 补全结果（已选 ' + (partialF.length + partialB.length) +
      ' + 补全 ' + (5 - partialF.length) + "+" + (2 - partialB.length) + "）</h3>" +
      '<div class="pick-balls"><span class="grp-label">前区</span>' + fBalls +
      '<span class="grp-label">后区</span>' + bBalls + "</div>" +
      '<p class="pick-note">带紫色描边 = 你已选 · 其余为自动补全</p></div>' +
      '<div class="report-block"><h3>📋 单号码历史表现（冷热 / 遗漏）</h3>' + per + "</div>" +
      '<div class="report-block"><h3>🧮 组合结构</h3><div class="combo-grid">' + comboHtml + "</div></div>" +
      '<p class="pick-note">' + r.generated_from + " · " + r.disclaimer + " · 补全按历史冷热池优先 + 结构均衡（非预测）</p>";
  }

  function showError(msg) {
    document.getElementById("error").hidden = false;
    document.getElementById("error-detail").textContent = "选号数据暂时无法加载，请稍后重试。";
  }

  function parseInput(text, min, max, count) {
    var nums = text.trim().split(/[\s,，]+/).map(Number).filter(function (x) { return !isNaN(x) && x >= min && x <= max; });
    var uniq = Array.from(new Set(nums));
    if (uniq.length !== count) throw new Error("请选择 " + count + " 个 " + min + "-" + max + " 的不重复号码");
    return uniq;
  }

  // 智能补全：解析部分输入（允许 0~maxCount 个；越界/重复自动过滤并校验）
  function parsePartialInput(text, min, max, maxCount) {
    var raw = (text || "").trim();
    if (!raw) return [];
    var nums = raw.split(/[\s,，]+/).map(Number).filter(function (x) {
      return !isNaN(x) && x >= min && x <= max;
    });
    var uniq = Array.from(new Set(nums));
    var invalid = raw.split(/[\s,，]+/).filter(function (s) {
      return s !== "" && (isNaN(Number(s)) || Number(s) < min || Number(s) > max);
    });
    if (invalid.length) {
      throw new Error("无效号码：" + invalid.join("、") + "（范围 " + min + "-" + max + "）");
    }
    if (uniq.length > maxCount) throw new Error("最多选择 " + maxCount + " 个 " + min + "-" + max + " 的不重复号码");
    return uniq;
  }

  /* ================= 页面启动：loadIssues → 绑定事件 ================= */
  function init() {
    var issues = [];
    loadIssues().then(function (res) {
      issues = res.issues || [];
      if (!issues.length) throw new Error("历史数据为空");
      document.getElementById("pick-source").textContent =
        "数据来源：500彩票网 · 已收录 " + issues.length + " 期历史开奖";
      document.getElementById("pick-source").classList.add("ok");
    }).catch(function (err) {
      showError(String(err && err.message ? err.message : err));
      return;
    });

    function renderMachine(mode, n) {
      var picks = mode === "smart" ? PickAPI.smartPick(n, issues, "all") : PickAPI.randomPick(n);
      renderMachineResults(document.getElementById("machine-results"), picks);
    }

    document.getElementById("btn-random").addEventListener("click", function () { renderMachine("random", 1); });
    document.getElementById("btn-random-5").addEventListener("click", function () { renderMachine("random", 5); });
    document.getElementById("btn-smart").addEventListener("click", function () { renderMachine("smart", 1); });

    document.getElementById("btn-analyze").addEventListener("click", function () {
      var errBox = document.getElementById("manual-error");
      errBox.hidden = true;
      try {
        var front = parseInput(document.getElementById("inp-front").value, FRONT_MIN, FRONT_MAX, 5);
        var back = parseInput(document.getElementById("inp-back").value, BACK_MIN, BACK_MAX, 2);
        if (!issues.length) throw new Error("数据未就绪，请稍后重试");
        var report = PickAPI.analyzePick(front, back, issues, "all");
        renderManualReport(document.getElementById("manual-report"), report);
      } catch (e) {
        errBox.textContent = e.message || String(e);
        errBox.hidden = false;
      }
    });

    // 智能补全：部分输入 → completePick 补全 → 冷热/遗漏/组合结构展示
    document.getElementById("btn-complete").addEventListener("click", function () {
      var errBox = document.getElementById("complete-error");
      errBox.hidden = true;
      try {
        if (!issues.length) throw new Error("数据未就绪，请稍后重试");
        var partialF = parsePartialInput(document.getElementById("inp-complete-front").value, FRONT_MIN, FRONT_MAX, 5);
        var partialB = parsePartialInput(document.getElementById("inp-complete-back").value, BACK_MIN, BACK_MAX, 2);
        var combo = PickAPI.completePick(partialF, partialB, issues, "all");
        renderCompleteReport(document.getElementById("complete-report"), combo, partialF, partialB, issues);
      } catch (e) {
        errBox.textContent = e.message || String(e);
        errBox.hidden = false;
      }
    });
  }

  /* ================= 导出 API ================= */
  var api = {
    loadIssues: loadIssues,
    sliceWindow: sliceWindow,
    calculateHot: calculateHot,
    calculateMissing: calculateMissing,
    randomPick: randomPick,
    smartPick: smartPick,
    analyzePick: analyzePick,
    completePick: completePick,
    parseInput: parseInput,
    parsePartialInput: parsePartialInput,
    renderCompleteReport: renderCompleteReport
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.PickAPI = api;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})(typeof self !== "undefined" ? self : this);
