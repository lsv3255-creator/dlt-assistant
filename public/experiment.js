// 实验推荐页面脚本（Phase 14 Step 4 + Phase 16 Step 4 展示层扩展）
// 数据来源：Worker API（/api/recommend/latest, /api/model/status）+ public/data/*.json 静态 fallback。
// 所有新数据 fetch 均独立、非阻断、失败仅影响对应区块，不导致整页无法加载。

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function ballRow(front, back) {
    const wrap = document.createElement("div");
    wrap.className = "ball-row";
    (front || []).forEach((n) => {
      const b = document.createElement("span");
      b.className = "ball front";
      b.textContent = n;
      wrap.appendChild(b);
    });
    (back || []).forEach((n) => {
      const b = document.createElement("span");
      b.className = "ball back";
      b.textContent = n;
      wrap.appendChild(b);
    });
    return wrap;
  }

  function strategyLabel(s) {
    return { v1: "v1 生产推荐器", v2: "v2 候选池", adaptive: "自适应优化" }[s] || s;
  }

  function renderRecommendations(data) {
    $("target-issue").textContent = data.issue || "—";
    const list = $("reco-list");
    list.innerHTML = "";
    const recs = data.recommendations || [];
    if (!recs.length) {
      list.innerHTML = "<p class='exp-meta'>暂无推荐数据。</p>";
      return;
    }
    ["v1", "v2", "adaptive"].forEach((strategy) => {
      const group = recs.filter((r) => r.strategy === strategy);
      if (!group.length) return;
      const block = document.createElement("div");
      block.className = "exp-strategy";
      const h = document.createElement("h3");
      h.textContent = strategyLabel(strategy);
      block.appendChild(h);
      group.forEach((r) => block.appendChild(ballRow(r.front, r.back)));
      list.appendChild(block);
    });
  }

  function renderStatus(status) {
    $("st-history").textContent = status.history_count != null ? status.history_count : "—";
    $("st-roi").textContent = status.roi !== "" && status.roi !== undefined && status.roi !== null
      ? (typeof status.roi === "number" ? status.roi + "%" : status.roi)
      : "—";
    $("st-win").textContent = status.win_rate !== "" && status.win_rate !== undefined && status.win_rate !== null
      ? (typeof status.win_rate === "number" ? (status.win_rate * 100).toFixed(1) + "%" : status.win_rate)
      : "—";
  }

  function renderAnalysis(data) {
    const a = data.analysis || {};
    const recs = data.recommendations || [];
    const adaptive = recs.find((r) => r.strategy === "adaptive") ||
      recs.find((r) => r.strategy === "v2");
    let zoneText = "—";
    if (adaptive && adaptive.front) {
      const f = adaptive.front;
      const zones = [0, 0, 0, 0, 0, 0, 0];
      f.forEach((n) => { zones[Math.min(6, Math.floor((n - 1) / 5))]++; });
      const odd = f.filter((n) => n % 2 === 1).length;
      zoneText = `前区区间分布 [1-5,6-10,11-15,16-20,21-25,26-30,31-35]=${zones.join(",")}；奇数 ${odd}/5。`;
    }
    $("an-structure").textContent = a.structure || "—";
    $("an-zone").textContent = zoneText;
    $("an-risk").textContent = a.risk || "—";
    $("an-feedback").textContent = a.feedback || "—";
  }

  function renderRanking(data) {
    const body = $("rank-body");
    if (!body || !data || !data.models) return;
    body.innerHTML = "";
    const labelMap = {
      v1: "v1 生产推荐器", v2: "v2 候选池",
      adaptive: "自适应优化", random: "随机基准",
    };
    (data.ranking || []).forEach((mv, i) => {
      const m = data.models[mv];
      if (!m) return;
      const beats = data.beats_random && data.beats_random[mv];
      const badge = mv === "random"
        ? '<span class="rank-badge rank-lose">基准</span>'
        : (beats
            ? '<span class="rank-badge rank-win">略优</span>'
            : '<span class="rank-badge rank-lose">否</span>');
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td>${labelMap[mv] || mv}</td>` +
        `<td>${m.total_predictions}</td>` +
        `<td>${(+m.avg_front_hit).toFixed(2)}</td>` +
        `<td>${(+m.avg_back_hit).toFixed(2)}</td>` +
        `<td>${(+m.hit3plus_rate * 100).toFixed(1)}%</td>` +
        `<td>¥${Math.round(+m.total_prize)}</td>` +
        `<td>${(+m.roi).toFixed(1)}%</td>` +
        `<td>${m.max_consecutive_miss}</td>` +
        `<td>${(+m.stability_score).toFixed(3)}</td>` +
        `<td><strong>${(+m.composite).toFixed(4)}</strong></td>` +
        `<td>${badge}</td>`;
      body.appendChild(tr);
    });
    const note = $("rank-note");
    if (note) {
      const w = data.weights || {};
      const wstr = Object.entries(w).map(([k, v]) => `${k}=${v}`).join(", ");
      note.textContent = `综合评分权重：${wstr}。ROI 仅展示，不参与排名。娱乐分析，非预测。`;
    }
  }

  // ---------- Phase 16 Step 4 展示层辅助 ----------

  function safeFetch(url) {
    return fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  function setNote(id, msg) {
    const e = $(id);
    if (e) e.innerHTML = `<p class="exp-meta">${msg}</p>`;
  }

  function makeTable(headers, rows, cls) {
    const t = document.createElement("table");
    t.className = cls || "rank-table";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    headers.forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    t.appendChild(thead);
    const tb = document.createElement("tbody");
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      r.forEach((c) => {
        const td = document.createElement("td");
        td.innerHTML = c == null ? "—" : String(c);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  const MODEL_LABEL = {
    v1: "v1 生产推荐器", v2: "v2 候选池",
    adaptive: "自适应优化", random: "随机基准",
  };
  const fmt = (x, d = 2) => (x == null ? "—" : (+x).toFixed(d));
  const pct = (x, d = 1) => (x == null ? "—" : (+x * 100).toFixed(d) + "%");

  function verdictTag(text, kind) {
    return `<span class="verdict ${kind}">${text}</span>`;
  }

  // ① 模型研究总览
  function renderModelOverview(ranking, diag) {
    const host = $("model-overview");
    if (!host) return;
    if (!ranking || !ranking.models) {
      setNote("model-overview", "模型研究数据暂未更新，请稍后查看。");
      return;
    }
    const distMap = (diag && diag.conclusion && diag.conclusion.distinguishable_from_random) || {};
    const headers = ["模型", "综合评分", "平均前区命中", "ROI", "最大连续空军", "3+命中率", "命中分布可区分随机", "相对随机基线"];
    const rows = (ranking.ranking || Object.keys(ranking.models)).map((mv) => {
      const m = ranking.models[mv];
      const dist = distMap[mv];
      const distBadge = dist == null
        ? "—"
        : (dist ? verdictTag("可区分", "stable") : verdictTag("不可区分", "neutral"));
      const beats = ranking.beats_random && ranking.beats_random[mv];
      const beatBadge = mv === "random"
        ? verdictTag("基准", "neutral")
        : (beats ? verdictTag("胜", "stable") : verdictTag("否", "neutral"));
      return [
        MODEL_LABEL[mv] || mv,
        fmt(m.composite, 4), fmt(m.avg_front_hit), fmt(m.roi, 1) + "%",
        m.max_consecutive_miss, pct(m.hit3plus_rate), distBadge, beatBadge,
      ];
    });
    host.innerHTML = "";
    host.appendChild(makeTable(headers, rows));
    const note = document.createElement("p");
    note.className = "exp-meta";
    note.innerHTML = "random 为实验基准，<strong>不代表真实预测模型</strong>。" +
      "「相对随机基线」一列基于综合评分的微小差异，而命中分布卡方检验显示各模型与 random 均不可区分，故未确认优于随机基线。娱乐分析，非预测。";
    host.appendChild(note);
  }

  // ② 模型诊断（命中分布可区分性 + 收益稳定性）
  function renderDiagnostics(diag, rs) {
    const host = $("model-diagnostics");
    if (host) {
      if (!diag || !diag.models) {
        setNote("model-diagnostics", "模型诊断数据暂未更新，请稍后查看。");
      } else {
        const headers = ["模型", "命中分布卡方", "可区分随机(0.05)", "特征余弦相似度", "前后段漂移"];
        const rows = Object.keys(diag.models).map((mv) => {
          const m = diag.models[mv];
          const chi = m.chi2 || {};
          const sim = m.feature_similarity_to_random || {};
          const drift = m.window_stability ? m.window_stability.drift : null;
          const distBadge = chi.distinguishable_from_random == null
            ? "—"
            : (chi.distinguishable_from_random ? verdictTag("可区分", "stable") : verdictTag("不可区分", "neutral"));
          return [
            MODEL_LABEL[mv] || mv, fmt(chi.chi2_vs_random, 3), distBadge,
            fmt(sim.cosine_similarity_to_random, 4), fmt(drift, 4),
          ];
        });
        host.innerHTML = "<h3>命中分布与随机基准的可区分性</h3>";
        host.appendChild(makeTable(headers, rows));
        const concl = diag.conclusion && diag.conclusion.summary
          ? diag.conclusion.summary
          : "所有模型命中分布与随机基准在 0.05 水平均不可区分。";
        const p = document.createElement("p");
        p.className = "exp-meta";
        p.textContent = concl;
        host.appendChild(p);
      }
    }
    const hostRs = $("reward-stability");
    if (hostRs) {
      if (!rs || !rs.models) {
        setNote("reward-stability", "收益稳定性数据暂未生成（请先运行 reward_stability 实验）。");
      } else {
        const headers = ["模型", "ROI", "最大连续空军", "平均中奖间隔", "滚动ROI波动(std)"];
        const rows = Object.keys(rs.models).map((mv) => {
          const m = rs.models[mv];
          return [
            MODEL_LABEL[mv] || mv, fmt(m.roi_total, 1) + "%", m.longest_consecutive_miss,
            fmt(m.avg_win_gap, 1), fmt(m.rolling_roi_std, 3),
          ];
        });
        hostRs.innerHTML = "<h3>收益稳定性（walk-forward 回放）</h3>";
        hostRs.appendChild(makeTable(headers, rows));
        const p = document.createElement("p");
        p.className = "exp-meta";
        p.textContent = "所有模型 ROI 均为负；最大连续空军达数百期。负期望游戏，娱乐分析，非预测。";
        hostRs.appendChild(p);
      }
    }
  }

  // ③ 娱乐价值评价
  function renderEntertainment(ent) {
    const host = $("entertainment");
    if (!host) return;
    if (!ent || !ent.models) {
      setNote("entertainment", "娱乐价值评价数据暂未生成（请先运行 entertainment_evaluation 实验）。");
      return;
    }
    const order = ["random", "adaptive", "v1", "v2"];
    const headers = ["模型", "UX 评分", "小奖频率(期率)", "最长连空军", "多样性(前区覆盖比)", "号码覆盖率(滚动20期)", "vs random ΔUX"];
    const rows = order.map((mv) => {
      const m = ent.models[mv];
      if (!m) return [MODEL_LABEL[mv] || mv, "—", "—", "—", "—", "—", "—"];
      const vsr = (ent.vs_random && ent.vs_random[mv]) || {};
      return [
        MODEL_LABEL[mv] || mv,
        fmt(m.ux.ux_score, 4),
        pct(m.small_win.real_small_win_period_rate),
        m.miss_streak.longest_miss_streak,
        fmt(m.diversity.front_space_ratio, 4),
        fmt(m.coverage.rolling20_front_coverage_mean, 4),
        m === ent.models.random ? "基准" : fmt(vsr.ux_delta_vs_random, 4),
      ];
    });
    host.innerHTML = "";
    host.appendChild(makeTable(headers, rows));
    // 诚实指出已知问题（数值来自数据，不编造）
    const ad = ent.models.adaptive, v1 = ent.models.v1, rd = ent.models.random;
    const caveats = [];
    if (ad && rd) {
      caveats.push(`<li><strong>adaptive 覆盖率问题</strong>：滚动20期前区覆盖率 ${fmt(ad.coverage.rolling20_front_coverage_mean, 4)}，远低于 random ${fmt(rd.coverage.rolling20_front_coverage_mean, 4)}——自适应倾向于窄覆盖号码空间。</li>`);
    }
    if (v1) {
      caveats.push(`<li><strong>v1 小奖频率与空军问题</strong>：真实小奖期率 ${pct(v1.small_win.real_small_win_period_rate)} 尚可，但最长连空军达 ${v1.miss_streak.longest_miss_streak} 期（抗空军分量 ${fmt(v1.ux.component_scores.anti_miss_streak, 3)}，明显低于 random=1.0）。</li>`);
    }
    if (caveats.length) {
      const ul = document.createElement("ul");
      ul.className = "flag-list";
      ul.innerHTML = caveats.join("");
      host.appendChild(ul);
    }
    const p = document.createElement("p");
    p.className = "exp-meta";
    p.textContent = "UX = 小奖频率0.35 / 抗空军0.25 / 多样性0.2 / 覆盖率0.2，以 random 为锚点（random=1.0）。各模型 UX 均未超过 random，差异可能仅为随机噪声。娱乐分析，非预测。";
    host.appendChild(p);
  }

  // ④ 反事实实验
  function renderCounterfactual(cf) {
    const host = $("counterfactual");
    if (!host) return;
    if (!cf) {
      setNote("counterfactual", "反事实实验数据暂未生成（请先运行 counterfactual 实验）。");
      return;
    }
    host.innerHTML = "";
    const blocks = [
      ["feature_ablation", "特征消融（移除某类特征后对比 baseline）"],
      ["strategy_removal", "策略移除（移除某条推荐策略后对比 baseline）"],
      ["ensemble_comparison", "集成对比（多数投票 / 全量并集 vs 单一最优）"],
    ];
    blocks.forEach(([key, title]) => {
      const b = cf[key];
      if (!b) return;
      const sec = document.createElement("div");
      sec.className = "exp-strategy";
      const h = document.createElement("h3");
      h.textContent = title;
      sec.appendChild(h);
      const base = b.baseline || {};
      const headers = ["变体", "ΔROI", "Δ3+命中率", "显著性(2σ)", "结论"];
      const rows = Object.keys(b.comparison || {}).map((vk) => {
        const c = b.comparison[vk];
        const sig = c.significant;
        const sigBadge = sig == null ? "—" : (sig ? verdictTag("显著", "warn") : verdictTag("不显著", "neutral"));
        const concl = (b.variants && b.variants[vk] && b.variants[vk].n_bets)
          ? `n=${(+b.variants[vk].n_bets).toLocaleString()} 注`
          : "";
        return [
          vk, fmt(c.delta_roi, 4), fmt(c.delta_hit3plus, 4), sigBadge, concl,
        ];
      });
      sec.appendChild(makeTable(headers, rows));
      if (b.interpretation) {
        const p = document.createElement("p");
        p.className = "exp-meta";
        p.textContent = b.interpretation;
        sec.appendChild(p);
      }
      host.appendChild(sec);
    });
    if (cf.overall_conclusion) {
      const p = document.createElement("p");
      p.className = "exp-meta";
      p.innerHTML = "<strong>综合：</strong>" + cf.overall_conclusion.replace(/。/g, "。 ");
      host.appendChild(p);
    }
  }

  // ⑤ Phase 16 Step 3 稳定性验证
  function renderStability(step3) {
    const host = $("stability");
    if (!host) return;
    if (!step3) {
      setNote("stability", "稳定性验证数据暂未更新，请稍后查看。");
      return;
    }
    host.innerHTML = "";
    const cfg = step3.config || {};

    // 聚合稳定性表
    const agg = step3.aggregate || {};
    const headers = ["变体", "组合通过率", "小奖频率不降率", "平均ΔUX", "覆盖率提升率", "稳定性结论"];
    const rows = (cfg.variants || ["coverage_boost", "diversity_boost", "miss_streak_breaker"]).map((vk) => {
      const a = agg[vk] || {};
      const stable = a.stability_verdict === "stable";
      const vBadge = vk === "coverage_boost"
        ? verdictTag("不稳定", "unstable")
        : (stable ? verdictTag("稳定", "stable") : verdictTag("不稳定", "unstable"));
      return [
        vk, pct(a.pass_rate), pct(a.small_win_not_down_rate),
        fmt(a.mean_ux_delta, 4), pct(a.coverage_up_rate), vBadge,
      ];
    });
    host.appendChild(makeTable(headers, rows));

    // coverage_boost 明确结论
    const sv = step3.stability_verdict || {};
    const cbStable = sv.coverage_boost_stable === true;
    const banner = document.createElement("div");
    banner.className = "big-statement";
    banner.innerHTML = cbStable
      ? `coverage_boost = <span class="verdict stable">稳定</span>`
      : `coverage_boost = <span class="verdict unstable">不稳定</span>（不接入实验展示策略）。`;
    host.appendChild(banner);

    // validity / caveat
    const vd = step3.validity || {};
    if (vd.caveat || vd.verdict) {
      const cb = document.createElement("div");
      cb.className = "caveat-box";
      cb.innerHTML = `<strong>数据有效性 / 注意：</strong>${(vd.verdict || "")} ${(vd.caveat || "")}` +
        (vd.canonical_profile_pollution_found ? `（曾发现 canonical 结构画像污染，已修复并验证不影响本结果：affects_step3_results=${vd.affects_step3_results}）` : "");
      host.appendChild(cb);
    }

    // 紧凑组合表（window × seed × coverage_boost）
    const combos = step3.combos || [];
    if (combos.length) {
      const h2 = document.createElement("h3");
      h2.textContent = "逐组合明细（coverage_boost vs baseline）";
      host.appendChild(h2);
      const cheaders = ["窗口", "种子", "ΔUX", "小奖频率不降", "通过"];
      const crows = combos.map((c) => {
        const cb = c.coverage_boost || {};
        return [
          c.window, c.seed, fmt(cb.ux_delta_vs_baseline, 4),
          cb.small_win_not_down ? "是" : "否",
          cb.passes ? verdictTag("通过", "stable") : verdictTag("未通过", "unstable"),
        ];
      });
      const wrap = document.createElement("div");
      wrap.className = "overview-table-wrap";
      wrap.appendChild(makeTable(cheaders, crows));
      host.appendChild(wrap);
    }
  }

  // ⑥ 为什么没有自动调权
  function renderWhyNoAutoTune(ranking, diag, cf, step3) {
    const host = $("why-no-autotune");
    if (!host) return;
    host.innerHTML = "";
    const ul = document.createElement("ul");
    ul.className = "flag-list";

    // Phase 15
    const distMap = (diag && diag.conclusion && diag.conclusion.distinguishable_from_random) || {};
    const anyDist = Object.values(distMap).some((v) => v === true);
    ul.innerHTML +=
      "<li><strong>Phase 15 — 模型综合表现未稳定超过 random</strong>：" +
      (anyDist ? "存在可区分模型" : "各模型命中分布卡方检验在 0.05 水平均不可区分（余弦相似度最高约 0.97，越接近 1 越像随机）") +
      "。</li>";
    if (ranking && ranking.models) {
      const rois = Object.keys(ranking.models)
        .map((mv) => `${MODEL_LABEL[mv] || mv} ${fmt(ranking.models[mv].roi, 1)}%`)
        .join("、");
      ul.innerHTML += `<li><strong>Phase 15 — ROI 全部为负</strong>：${rois}。</li>`;
    }
    ul.innerHTML += "<li><strong>Phase 15 — 特征消融未发现稳定、显著的特征贡献</strong>：仅 2 个变体出现 2σ 边缘下降，且在 7 变体多重比较下预期约 0.35 个假阳性，判定为「提示性、非确凿」。</li>";

    // Phase 16
    ul.innerHTML += "<li><strong>Phase 16 — 娱乐价值可独立评价</strong>：各模型 UX 均未超过 random（ΔUX 均 &lt; 0），差异可能仅为随机噪声。</li>";
    const sv = (step3 && step3.stability_verdict) || {};
    const cb = (step3 && step3.aggregate && step3.aggregate.coverage_boost) || {};
    ul.innerHTML +=
      "<li><strong>Phase 16 — coverage_boost 无法稳定复现</strong>：" +
      `单次（seed=42, 200 期）曾提升 UX，但多窗口(${((step3 && step3.config && step3.config.windows) || []).join("/")}期)×多种子后 pass_rate=${pct(cb.pass_rate)}、小奖频率不降率=${pct(cb.small_win_not_down_rate)}、平均ΔUX=${fmt(cb.mean_ux_delta, 4)}，未达到稳定阈值。</li>`;

    const li = document.createElement("li");
    li.innerHTML = "<strong>结论</strong>：当前<strong>没有统计证据</strong>支持自动修改生产评分权重。";
    ul.appendChild(li);
    host.appendChild(ul);

    const banner = document.createElement("div");
    banner.className = "big-statement";
    banner.innerHTML = "当前状态：<strong>未启用自动调权</strong>——生产评分权重保持人工设定，实验结果仅作透明展示，不构成预测有效性证据。";
    host.appendChild(banner);
  }

  async function fetchJSON(url, fallbackUrl) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (e) {
      /* ignore, try fallback */
    }
    if (fallbackUrl) {
      const r2 = await fetch(fallbackUrl, { cache: "no-store" });
      if (r2.ok) return await r2.json();
    }
    throw new Error("all sources failed");
  }

  async function loadResearch() {
    const ranking = await safeFetch("./data/model_ranking.json");
    const diag = await safeFetch("./data/phase15_model_diagnostics.json");
    const rs = await safeFetch("./data/phase15_reward_stability.json");
    const cf = await safeFetch("./data/phase15_counterfactual.json");
    const ent = await safeFetch("./data/phase16_entertainment.json");
    const step3 = await safeFetch("./data/phase16_step3_validation.json");
    renderModelOverview(ranking, diag);
    renderDiagnostics(diag, rs);
    renderEntertainment(ent);
    renderCounterfactual(cf);
    renderStability(step3);
    renderWhyNoAutoTune(ranking, diag, cf, step3);
  }

  async function load() {
    try {
      const [reco, status] = await Promise.all([
        fetchJSON("/api/recommend/latest", "./data/experimental_recommendation.json"),
        fetchJSON("/api/model/status", "./data/model_status.json"),
      ]);
      renderRecommendations(reco);
      renderStatus(status);
      renderAnalysis(reco);
      $("error").hidden = true;
      $("content").hidden = false;
    } catch (err) {
      $("error").hidden = false;
      $("content").hidden = true;
      const d = $("error-detail");
      if (d) d.textContent = "请稍后刷新页面重试。";
    }
    // 排行榜 + 研究展示：非阻断加载（缺失不影响主内容/其它区块）
    try {
      const ranking = await fetchJSON("./data/model_ranking.json");
      renderRanking(ranking);
    } catch (e) {
      const note = $("rank-note");
      if (note) note.textContent = "排行榜数据暂未更新，请稍后查看。";
    }
    loadResearch();
  }

  document.addEventListener("DOMContentLoaded", load);
})();
