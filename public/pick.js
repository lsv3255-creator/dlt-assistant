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

  /* ================= 全彩种配置（球类=双池 / 数字类=定位） ================= */
  var GAMES = {
    dlt: { key: "dlt", name: "大乐透", type: "ball", aLabel: "前区", bLabel: "后区", aMin: 1, aMax: 35, aPick: 5, bMin: 1, bMax: 12, bPick: 2, exA: "12 16 19 29 33", exB: "07 09" },
    ssq: { key: "ssq", name: "双色球", type: "ball", aLabel: "红球", bLabel: "蓝球", aMin: 1, aMax: 33, aPick: 6, bMin: 1, bMax: 16, bPick: 1, exA: "05 12 19 26 30 33", exB: "09" },
    fc3d: { key: "fc3d", name: "福彩3D", type: "digit", positions: 3, posNames: ["百位", "十位", "个位"], ex: "8 2 3" },
    pl3: { key: "pl3", name: "排列三", type: "digit", positions: 3, posNames: ["百位", "十位", "个位"], ex: "8 2 3" },
    pl5: { key: "pl5", name: "排列五", type: "digit", positions: 5, posNames: ["万位", "千位", "百位", "十位", "个位"], ex: "3 6 1 9 5" }
  };
  var CFG = GAMES.dlt;
  function applyCfg() {
    FRONT_MIN = CFG.aMin; FRONT_MAX = CFG.aMax;
    BACK_MIN = CFG.bMin; BACK_MAX = CFG.bMax;
    FRONT_BOUNDARY = Math.floor(CFG.aMax / 2);
    BACK_BOUNDARY = Math.floor(CFG.bMax / 2);
    ZONES = [Math.ceil(CFG.aMax / 3), Math.ceil(2 * CFG.aMax / 3), CFG.aMax];
  }

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

  // 其他彩种数据：仓库历史 JSON（最近 1000 期）优先，/api 降级；统一规范为最新在前
  function loadGameIssues(key) {
    if (key === "dlt") return loadIssues().then(function (r) { return r.issues || []; });
    var cfg = GAMES[key];
    function fromRows(rows, keepOrder) {
      var list = keepOrder ? (rows || []).slice() : (rows || []).slice().reverse();
      if (cfg.type === "ball") {
        return list.map(function (r) {
          return { front: (r.red || []).slice().sort(function (a, b) { return a - b; }), back: [r.blue] };
        });
      }
      return list.map(function (r) { return { digits: (r.digits || []).slice() }; });
    }
    return loadJSON("./data/" + key + "_history.json")
      .then(function (d) { return fromRows(d.issues || [], false); })
      .catch(function () {
        return fetch("/api/" + key, { cache: "no-cache" })
          .then(function (r) { if (!r.ok) throw new Error("API HTTP " + r.status); return r.json(); })
          .then(function (d) { return fromRows(d.draws || [], true); });
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
        front: shuffle(range(FRONT_MIN, FRONT_MAX)).slice(0, CFG.aPick).sort(function (a, b) { return a - b; }),
        back: shuffle(range(BACK_MIN, BACK_MAX)).slice(0, CFG.bPick).sort(function (a, b) { return a - b; }),
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
        var f = shuffle(tierF.hot).slice(0, 2).concat(shuffle(tierF.mid).slice(0, 2), shuffle(tierF.cold).slice(0, CFG.aPick - 4));
        f = f.sort(function (a, b) { return a - b; });
        if (f.length === CFG.aPick && checkConstraints(f)) { front = f; break; }
      }
      if (!front) {
        // 超限退化为：热 2 + 全池随机补齐（尽力均衡）
        front = shuffle(tierF.hot).slice(0, 2);
        var rest = shuffle(range(FRONT_MIN, FRONT_MAX).filter(function (x) { return front.indexOf(x) < 0; })).slice(0, CFG.aPick - 2);
        front = front.concat(rest).sort(function (a, b) { return a - b; });
      }
      // 后区/蓝球：单球彩种取冷热混合池 1 个；双球彩种走奇偶 1:1 + 大小 1:1
      if (CFG.bPick === 1) {
        back = shuffle(tierB.hot.concat(tierB.mid, tierB.cold)).slice(0, 1);
      }
      for (var tb = 0; CFG.bPick > 1 && tb < SMART_RETRY; tb++) {
        var oddPool = shuffle(range(BACK_MIN, BACK_MAX).filter(function (x) { return x % 2 === 1; })).slice(0, 1);
        var evenPool = shuffle(range(BACK_MIN, BACK_MAX).filter(function (x) { return x % 2 === 0; })).slice(0, 1);
        var b = oddPool.concat(evenPool);
        var small = b.filter(function (x) { return x <= BACK_BOUNDARY; }).length;
        if (small === 1) { back = b.sort(function (a, b) { return a - b; }); break; }
      }
      if (!back) { back = shuffle(range(BACK_MIN, BACK_MAX)).slice(0, CFG.bPick).sort(function (a, b) { return a - b; }); }
      out.push({ front: front, back: back, mode: "smart", note: "按历史统计风格组合（冷热分层·奇偶·大小·区间均衡），非预测" });
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
    var needF = CFG.aPick - partialFront.length;
    var pickF = partialFront.slice();
    // 补全优先热池，再中池，再冷池
    var pool = shuffle(tierF.hot.concat(tierF.mid, tierF.cold)).filter(function (x) { return pickF.indexOf(x) < 0; });
    for (var i = 0; i < needF && pool.length; i++) {
      var cand = pool.shift();
      if (pickF.indexOf(cand) < 0) pickF.push(cand);
    }
    var needB = CFG.bPick - partialBack.length;
    var pickB = partialBack.slice();
    var bpool = shuffle(range(BACK_MIN, BACK_MAX)).filter(function (x) { return pickB.indexOf(x) < 0; });
    while (pickB.length < CFG.bPick && bpool.length) pickB.push(bpool.shift());
    return {
      front: pickF.slice(0, CFG.aPick).sort(function (a, b) { return a - b; }),
      back: pickB.slice(0, CFG.bPick).sort(function (a, b) { return a - b; }),
      mode: "complete",
      note: "按低遗漏热门池 + 均衡约束补全（接口预留）"
    };
  }


  /* ================= 数字类彩种（福彩3D/排列三/排列五）选号引擎 ================= */
  function digitForm(digits) {
    var counts = {};
    digits.forEach(function (d) { counts[d] = (counts[d] || 0) + 1; });
    var sizes = Object.keys(counts).map(function (k) { return counts[k]; }).sort(function (a, b) { return b - a; });
    if (digits.length === 3) return sizes[0] === 3 ? "豹子" : sizes[0] === 2 ? "组三" : "组六";
    var table = { "5": "五同", "4,1": "四同", "3,2": "三带二", "3,1,1": "三同", "2,2,1": "两对", "2,1,1,1": "一对", "1,1,1,1,1": "全不同" };
    return table[sizes.join(",")] || "其他";
  }

  // 各位冷热/遗漏（issues 最新在前）：[{digit,count,omit}...] 按 count 倒序
  function digitStats(issues) {
    var out = [];
    for (var pos = 0; pos < CFG.positions; pos++) {
      (function (p) {
        var freq = new Array(10).fill(0), last = new Array(10).fill(-1);
        issues.forEach(function (it, idx) {
          var d = it.digits[p];
          freq[d] += 1;
          if (last[d] === -1) last[d] = idx;
        });
        var arr = range(0, 9).map(function (d) {
          return { digit: d, count: freq[d], omit: last[d] === -1 ? issues.length : last[d] };
        });
        arr.sort(function (a, b) { return b.count - a.count; });
        out.push(arr);
      })(pos);
    }
    return out;
  }

  function digitRandom(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var digits = [];
      for (var p = 0; p < CFG.positions; p++) digits.push(Math.floor(Math.random() * 10));
      out.push({ digits: digits, mode: "random", note: "纯随机生成（各位独立均匀），与历史数据无关" });
    }
    return out;
  }

  // 智能风格：各位按冷热分层加权抽取（热 50% / 温 30% / 冷 20%）
  function digitSmart(n, issues) {
    var stats = digitStats(issues);
    var tiers = stats.map(function (arr) {
      return {
        hot: arr.slice(0, 3).map(function (x) { return x.digit; }),
        mid: arr.slice(3, 7).map(function (x) { return x.digit; }),
        cold: arr.slice(7).map(function (x) { return x.digit; })
      };
    });
    function pickFrom(tier) {
      var r = Math.random();
      var pool = r < 0.5 ? tier.hot : r < 0.8 ? tier.mid : tier.cold;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        digits: tiers.map(pickFrom),
        mode: "smart",
        note: "按各位历史冷热分层加权（热50%/温30%/冷20%），非预测"
      });
    }
    return out;
  }

  function digitAnalyze(digits, issues) {
    var stats = digitStats(issues);
    var per = digits.map(function (d, pos) {
      var arr = stats[pos];
      var idx = arr.findIndex(function (x) { return x.digit === d; });
      var rec = arr[idx];
      var tag = idx < 3 ? "🔥热号" : idx > 6 ? "❄冷号" : "⚖平衡";
      return { pos: pos, posName: CFG.posNames[pos], digit: d, count: rec.count, omit: rec.omit, tag: tag };
    });
    var direct = 0, group = 0;
    var sortedTarget = digits.slice().sort(function (a, b) { return a - b; }).join(",");
    var posHitsDist = new Array(CFG.positions + 1).fill(0);
    issues.forEach(function (it) {
      var hits = 0;
      for (var p = 0; p < CFG.positions; p++) if (it.digits[p] === digits[p]) hits++;
      posHitsDist[hits]++;
      if (hits === CFG.positions) direct++;
      if (CFG.positions === 3 && it.digits.slice().sort(function (a, b) { return a - b; }).join(",") === sortedTarget) group++;
    });
    return {
      digits: digits.slice(),
      per_position: per,
      combo: {
        sum: digits.reduce(function (a, b) { return a + b; }, 0),
        form: digitForm(digits),
        odd: digits.filter(function (d) { return d % 2 === 1; }).length,
        big: digits.filter(function (d) { return d >= 5; }).length
      },
      history_hits: { direct: direct, group: CFG.positions === 3 ? group : null, pos_dist: posHitsDist },
      generated_from: issues.length + "期历史开奖数据",
      disclaimer: "本报告为历史数据统计，不代表预测中奖"
    };
  }

  // 智能补全（数字类）：partials = [digit|null, ...]，空位按该位热池补
  function digitComplete(partials, issues) {
    var stats = digitStats(issues);
    var filled = partials.map(function (d, pos) {
      if (d !== null && d !== undefined) return d;
      var hot = stats[pos].slice(0, 3).map(function (x) { return x.digit; });
      return hot[Math.floor(Math.random() * hot.length)];
    });
    return { digits: filled, mode: "complete", note: "空位按该位历史热号池补全（非预测）" };
  }

  function parseDigitInput(text, positions) {
    var raw = (text || "").trim();
    var toks = raw.split(/[\s,，]+/).filter(function (t) { return t !== ""; });
    if (toks.length === 1 && toks[0].length === positions && /^\d+$/.test(toks[0])) toks = toks[0].split("");
    if (toks.length !== positions) throw new Error("请输入 " + positions + " 位数字（空格分隔或连写均可）");
    return toks.map(function (t) {
      if (!/^\d$/.test(t)) throw new Error("无效数字：" + t + "（每位只能是 0-9）");
      return Number(t);
    });
  }

  function parseDigitPartial(text, positions) {
    var raw = (text || "").trim();
    if (!raw) return new Array(positions).fill(null);
    var toks = raw.split(/[\s,，]+/).filter(function (t) { return t !== ""; });
    if (toks.length === 1 && toks[0].length === positions) toks = toks[0].split("");
    if (toks.length !== positions) throw new Error("请输入 " + positions + " 位（空位用 _ 表示，或整段留空）");
    return toks.map(function (t) {
      if (t === "_" || t === "x" || t === "X" || t === "*" || t === "-") return null;
      if (!/^\d$/.test(t)) throw new Error("无效输入：" + t + "（数字或 _ 占位）");
      return Number(t);
    });
  }

  function digitBallHtml(d, extra) {
    return '<span class="ball digit-ball"' + (extra || "") + ">" + d + "</span>";
  }

  function renderDigitMachine(container, picks) {
    container.innerHTML = picks.map(function (pk, i) {
      var balls = pk.digits.map(function (d) { return digitBallHtml(d); }).join("");
      return '<div class="pick-card">' +
        '<div class="pick-card-head"><span class="pick-idx">第' + (i + 1) + '注</span>' +
        '<span class="pick-mode">' + (pk.mode === "smart" ? "智能风格" : "普通随机") + "</span></div>" +
        '<div class="pick-balls">' + balls + "</div>" +
        '<p class="pick-note">' + pk.note + "</p></div>";
    }).join("");
  }

  function renderDigitReport(container, r, userDigits) {
    var per = r.per_position.map(function (it) {
      var isUser = userDigits && userDigits[it.pos] === it.digit;
      return '<div class="per-row"><span class="ball digit-ball"' + (isUser ? ' style="outline:2px solid var(--accent);outline-offset:1px"' : "") + ">" + it.digit + "</span>" +
        "<span>" + it.posName + "</span>" +
        "<span>出现 <strong>" + it.count + "</strong> 次</span>" +
        "<span>遗漏 <strong>" + it.omit + "</strong> 期</span>" +
        '<span class="tag ' + (it.tag.indexOf("🔥") >= 0 ? "hot" : it.tag.indexOf("❄") >= 0 ? "cold" : "mid") + '">' + it.tag + "</span></div>";
    }).join("");
    var c = r.combo, h = r.history_hits;
    var comboHtml =
      '<div class="combo-item">和值 ' + c.sum + "</div>" +
      '<div class="combo-item">形态 ' + c.form + "</div>" +
      '<div class="combo-item">奇偶 ' + c.odd + ":" + (r.digits.length - c.odd) + "</div>" +
      '<div class="combo-item">大小 ' + c.big + ":" + (r.digits.length - c.big) + "</div>" +
      '<div class="combo-item">历史直选全同 ' + h.direct + " 次</div>" +
      (h.group !== null ? '<div class="combo-item">历史组选全同 ' + h.group + " 次</div>" : "");
    container.innerHTML =
      '<div class="report-block"><h3>📋 各位历史表现</h3>' + per + "</div>" +
      '<div class="report-block"><h3>🧮 组合结构与历史命中</h3><div class="combo-grid">' + comboHtml + "</div></div>" +
      '<p class="pick-note">' + r.generated_from + " · " + r.disclaimer + "</p>";
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
        '<div class="pick-balls"><span class="grp-label">' + CFG.aLabel + '</span>' + f + '<span class="grp-label">' + CFG.bLabel + '</span>' + b + "</div>" +
        '<p class="pick-note">' + p.note + "</p></div>";
    }).join("");
  }

  function renderManualReport(container, r) {
    var per = r.per_number.map(function (it) {
      return '<div class="per-row"><span class="ball ' + (it.num <= CFG.aMax ? "f" : "b") + '">' + pad2(it.num) + "</span>" +
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
      var kind = it.num <= CFG.aMax ? "f" : "b";
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
      ' + 补全 ' + (CFG.aPick - partialF.length) + "+" + (CFG.bPick - partialB.length) + "）</h3>" +
      '<div class="pick-balls"><span class="grp-label">' + CFG.aLabel + '</span>' + fBalls +
      '<span class="grp-label">' + CFG.bLabel + '</span>' + bBalls + "</div>" +
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

  /* ================= 页面启动：选彩种 → 加载数据 → 绑定事件 ================= */
  function init() {
    var issues = [];
    var curKey = "dlt";
    try {
      var q = new URLSearchParams(location.search).get("game");
      if (q && GAMES[q]) curKey = q;
    } catch (e) { /* 忽略异常参数 */ }
    CFG = GAMES[curKey];

    function $(id) { return document.getElementById(id); }
    function setSource(text, ok) {
      var el = $("pick-source");
      el.textContent = text;
      el.classList.toggle("ok", !!ok);
    }
    function clearOutputs() {
      $("machine-results").innerHTML = "";
      $("manual-report").innerHTML = "";
      $("complete-report").innerHTML = "";
      $("manual-error").hidden = true;
      $("complete-error").hidden = true;
    }
    function refreshLabels() {
      document.querySelectorAll(".game-chip").forEach(function (ch) {
        ch.classList.toggle("active", ch.dataset.game === curKey);
      });
      if (CFG.type === "ball") {
        $("grp-back").style.display = "";
        $("grp-cback").style.display = "";
        $("lbl-front").textContent = CFG.aLabel + "（选 " + CFG.aPick + " 个，" + CFG.aMin + "-" + CFG.aMax + "）";
        $("lbl-back").textContent = CFG.bLabel + "（选 " + CFG.bPick + " 个，" + CFG.bMin + "-" + CFG.bMax + "）";
        $("inp-front").placeholder = "如 " + CFG.exA;
        $("inp-back").placeholder = "如 " + CFG.exB;
        $("lbl-cfront").textContent = CFG.aLabel + "已选（0-" + CFG.aPick + " 个，" + CFG.aMin + "-" + CFG.aMax + "）";
        $("lbl-cback").textContent = CFG.bLabel + "已选（0-" + CFG.bPick + " 个，" + CFG.bMin + "-" + CFG.bMax + "）";
        $("inp-complete-front").placeholder = "可选，如 " + CFG.exA.split(" ").slice(0, 2).join(" ");
        $("inp-complete-back").placeholder = "可选，如 " + CFG.exB.split(" ")[0];
        $("hint-machine").textContent = "普通：纯随机生成，与历史无关；智能：按冷热/奇偶/大小/区间风格组合，非预测";
        $("hint-complete").textContent = "已选部分号码（可留空）→ 自动补全完整 " + CFG.aPick + "+" + CFG.bPick + "，并展示每个号码的冷热/遗漏与组合结构（基于历史统计，非预测）";
      } else {
        $("grp-back").style.display = "none";
        $("grp-cback").style.display = "none";
        $("lbl-front").textContent = "号码（" + CFG.positions + " 位数字，空格分隔或连写）";
        $("inp-front").placeholder = "如 " + CFG.ex;
        $("lbl-cfront").textContent = "已选（空位用 _ 占位，或整段留空）";
        $("inp-complete-front").placeholder = "如 " + CFG.ex.split(" ").map(function (x, i) { return i === 1 ? "_" : x; }).join(" ");
        $("hint-machine").textContent = "普通：各位独立随机；智能：按各位历史冷热分层加权，非预测";
        $("hint-complete").textContent = "已选部分号码（空位用 _ 占位，可整段留空）→ 自动补全完整 " + CFG.positions + " 位直选，并展示各位数字的冷热与形态结构（基于历史统计，非预测）";
      }
    }
    function loadCurrent() {
      issues = [];
      setSource("数据加载中…", false);
      loadGameIssues(curKey).then(function (list) {
        issues = list || [];
        if (!issues.length) throw new Error("历史数据为空");
        setSource("数据来源：500彩票网 · " + CFG.name + " · 已收录 " + issues.length + " 期历史开奖", true);
      }).catch(function (err) {
        showError(String(err && err.message ? err.message : err));
      });
    }
    function setGame(key) {
      if (!GAMES[key]) return;
      curKey = key;
      CFG = GAMES[key];
      if (CFG.type === "ball") applyCfg();
      try { history.replaceState(null, "", "?game=" + key); } catch (e) { /* 本地文件模式忽略 */ }
      refreshLabels();
      clearOutputs();
      loadCurrent();
    }

    document.querySelectorAll(".game-chip").forEach(function (ch) {
      ch.addEventListener("click", function () { setGame(ch.dataset.game); });
    });

    function renderMachine(mode, n) {
      if (!issues.length) { showError("数据未就绪，请稍后重试"); return; }
      if (CFG.type === "ball") {
        var picks = mode === "smart" ? PickAPI.smartPick(n, issues, "all") : PickAPI.randomPick(n);
        renderMachineResults($("machine-results"), picks);
      } else {
        var dpicks = mode === "smart" ? digitSmart(n, issues) : digitRandom(n);
        renderDigitMachine($("machine-results"), dpicks);
      }
    }
    $("btn-random").addEventListener("click", function () { renderMachine("random", 1); });
    $("btn-random-5").addEventListener("click", function () { renderMachine("random", 5); });
    $("btn-smart").addEventListener("click", function () { renderMachine("smart", 1); });

    $("btn-analyze").addEventListener("click", function () {
      var errBox = $("manual-error");
      errBox.hidden = true;
      try {
        if (!issues.length) throw new Error("数据未就绪，请稍后重试");
        if (CFG.type === "ball") {
          var front = parseInput($("inp-front").value, FRONT_MIN, FRONT_MAX, CFG.aPick);
          var back = parseInput($("inp-back").value, BACK_MIN, BACK_MAX, CFG.bPick);
          var report = PickAPI.analyzePick(front, back, issues, "all");
          renderManualReport($("manual-report"), report);
        } else {
          var digits = parseDigitInput($("inp-front").value, CFG.positions);
          renderDigitReport($("manual-report"), digitAnalyze(digits, issues), null);
        }
      } catch (e) {
        errBox.textContent = e.message || String(e);
        errBox.hidden = false;
      }
    });

    $("btn-complete").addEventListener("click", function () {
      var errBox = $("complete-error");
      errBox.hidden = true;
      try {
        if (!issues.length) throw new Error("数据未就绪，请稍后重试");
        if (CFG.type === "ball") {
          var partialF = parsePartialInput($("inp-complete-front").value, FRONT_MIN, FRONT_MAX, CFG.aPick);
          var partialB = parsePartialInput($("inp-complete-back").value, BACK_MIN, BACK_MAX, CFG.bPick);
          var combo = PickAPI.completePick(partialF, partialB, issues, "all");
          renderCompleteReport($("complete-report"), combo, partialF, partialB, issues);
        } else {
          var partials = parseDigitPartial($("inp-complete-front").value, CFG.positions);
          var done = digitComplete(partials, issues);
          var userDigits = {};
          partials.forEach(function (d, i) { if (d !== null) userDigits[i] = d; });
          $("complete-report").innerHTML =
            '<div class="report-block"><h3>🎯 补全结果</h3><div class="pick-balls">' +
            done.digits.map(function (d, i) {
              return digitBallHtml(d, userDigits[i] !== undefined ? ' style="outline:2px solid var(--accent);outline-offset:1px" title="你已选"' : ' title="自动补全"');
            }).join("") + "</div>" +
            '<p class="pick-note">带紫色描边 = 你已选 · 其余为自动补全 · ' + done.note + "</p></div>";
          var rep2 = digitAnalyze(done.digits, issues);
          var holder = document.createElement("div");
          renderDigitReport(holder, rep2, userDigits);
          $("complete-report").appendChild(holder);
        }
      } catch (e) {
        errBox.textContent = e.message || String(e);
        errBox.hidden = false;
      }
    });

    setGame(curKey);
  }

  /* ================= 导出 API ================= */
  var api = {
    loadIssues: loadIssues,
    loadGameIssues: loadGameIssues,
    GAMES: GAMES,
    setCfg: function (key) { CFG = GAMES[key]; if (CFG.type === "ball") applyCfg(); return CFG; },
    digitStats: digitStats,
    digitRandom: digitRandom,
    digitSmart: digitSmart,
    digitAnalyze: digitAnalyze,
    digitComplete: digitComplete,
    parseDigitInput: parseDigitInput,
    parseDigitPartial: parseDigitPartial,
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
