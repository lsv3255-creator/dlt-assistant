/** GET /api/ssq - shuangseqiu draws, statistics and locked picks from D1. */
interface Env { DB: D1Database; }
interface D1Database { prepare(sql: string): D1PreparedStatement; }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
interface DrawRow {
  issue: string; date: string;
  red1: number; red2: number; red3: number; red4: number; red5: number; red6: number;
  blue: number;
}
interface RecRow { target_issue: string; target_date: string; strategy: string; red: string; blue: number; }

const redsOf = (row: DrawRow) => [row.red1, row.red2, row.red3, row.red4, row.red5, row.red6];

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }): Promise<Response> => {
  try {
    // Single-issue detail (?issue=26118): draw + official announcement +
    // computed shape + that issue's locked recommendations/plans.
    const issueParam = new URL(request.url).searchParams.get("issue");
    if (issueParam) {
      const drawRow = await env.DB.prepare(
        "SELECT issue, date, red1, red2, red3, red4, red5, red6, blue FROM ssq_draws WHERE issue = ?",
      ).bind(issueParam).first<{ issue: string; date: string; red1: number; red2: number; red3: number; red4: number; red5: number; red6: number; blue: number }>();
      if (!drawRow) return json({ error: "未找到该期开奖" }, 404);
      const draw = {
        issue: drawRow.issue, date: drawRow.date,
        red: [drawRow.red1, drawRow.red2, drawRow.red3, drawRow.red4, drawRow.red5, drawRow.red6],
        blue: drawRow.blue,
      };
      let detail: unknown = null;
      try {
        const row = await env.DB.prepare(
          "SELECT payload FROM ssq_details WHERE issue = ?",
        ).bind(issueParam).first<{ payload: string }>();
        if (row) detail = JSON.parse(row.payload);
      } catch { /* details table may not exist */ }
      const computed = {
        sum_red: draw.red.reduce((a, b) => a + b, 0),
        odd_red: draw.red.filter(n => n % 2 === 1).length,
        big_red: draw.red.filter(n => n >= 17).length,
        span_red: Math.max(...draw.red) - Math.min(...draw.red),
      };
      let recommendations: unknown = null;
      try {
        const recs = await env.DB.prepare(
          "SELECT strategy, red, blue FROM ssq_recommendations WHERE target_issue = ? ORDER BY strategy",
        ).bind(issueParam).all<{ strategy: string; red: string; blue: number }>();
        if (recs.results.length) {
          recommendations = recs.results.map(r => {
            const reds = JSON.parse(r.red) as number[];
            return {
              strategy: r.strategy, red: reds, blue: r.blue,
              red_hits: reds.filter(n => draw.red.includes(n)),
              blue_hit: r.blue === draw.blue,
            };
          });
        }
      } catch { /* recommendations table may not exist */ }
      let plans: unknown = null;
      try {
        const planRows = await env.DB.prepare(
          "SELECT kind, payload FROM ssq_plans WHERE target_issue = ?",
        ).bind(issueParam).all<{ kind: string; payload: string }>();
        if (planRows.results.length) {
          plans = {
            single: JSON.parse(planRows.results.find(r => r.kind === "single")?.payload ?? "null"),
            combo: JSON.parse(planRows.results.find(r => r.kind === "combo")?.payload ?? "null"),
          };
        }
      } catch { /* plans table may not exist */ }
      return json({ issue: draw.issue, draw, detail, computed, recommendations, plans }, 200);
    }

    const { results } = await env.DB.prepare(
      "SELECT issue, date, red1, red2, red3, red4, red5, red6, blue FROM ssq_draws ORDER BY issue_num DESC LIMIT 4000",
    ).all<DrawRow>();
    if (!results.length) return json({ error: "暂无双色球数据" }, 404);
    const draws = results.map(row => ({
      issue: row.issue, date: row.date, red: redsOf(row), blue: row.blue,
    }));

    // Statistics mirror src/ssq/stats.py (last-100 frequency, omission).
    const freq100 = { red: new Array(34).fill(0), blue: new Array(17).fill(0) };
    draws.slice(0, 100).forEach(d => {
      d.red.forEach(n => { freq100.red[n] += 1; });
      freq100.blue[d.blue] += 1;
    });
    const omission = { red: new Array(34).fill(draws.length), blue: new Array(17).fill(draws.length) };
    draws.forEach((d, idx) => {
      d.red.forEach(n => { if (omission.red[n] === draws.length) omission.red[n] = idx; });
      if (omission.blue[d.blue] === draws.length) omission.blue[d.blue] = idx;
    });
    const top = (values: number[], count: number, offset: number) =>
      values.slice(offset).map((v, i) => [i + offset, v] as [number, number])
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, count).map(([n]) => n);
    const freq30 = { red: new Array(34).fill(0), blue: new Array(17).fill(0) };
    draws.slice(0, 30).forEach(d => {
      d.red.forEach(n => { freq30.red[n] += 1; });
      freq30.blue[d.blue] += 1;
    });
    const freqAll = { red: new Array(34).fill(0), blue: new Array(17).fill(0) };
    draws.forEach(d => {
      d.red.forEach(n => { freqAll.red[n] += 1; });
      freqAll.blue[d.blue] += 1;
    });
    // Distributions over the last 100 draws.
    const sumHist = new Array(19).fill(0); // buckets of 10: 20..199 -> idx
    const oddCounts = new Array(7).fill(0);
    draws.slice(0, 100).forEach(d => {
      const s = d.red.reduce((a, b) => a + b, 0);
      sumHist[Math.min(18, Math.floor(s / 10))] += 1;
      oddCounts[d.red.filter(n => n % 2 === 1).length] += 1;
    });
    const stats = {
      total_draws: draws.length,
      frequency_30: { red: freq30.red.slice(1), blue: freq30.blue.slice(1) },
      frequency_100: { red: freq100.red.slice(1), blue: freq100.blue.slice(1) },
      frequency_all: { red: freqAll.red.slice(1), blue: freqAll.blue.slice(1) },
      omission: { red: omission.red.slice(1), blue: omission.blue.slice(1) },
      hot: { red: top(freq100.red, 6, 1), blue: top(freq100.blue, 3, 1) },
      cold: { red: top(omission.red, 6, 1), blue: top(omission.blue, 3, 1) },
      sum_hist_100: sumHist,
      odd_counts_100: oddCounts,
    };

    let recommendations: { target_issue: string; target_date: string; picks: { strategy: string; red: number[]; blue: number }[] } | null = null;
    const recResult = await env.DB.prepare(
      "SELECT target_issue, target_date, strategy, red, blue FROM ssq_recommendations WHERE target_issue = (SELECT MAX(target_issue) FROM ssq_recommendations) ORDER BY strategy",
    ).all<RecRow>();
    if (recResult.results.length) {
      recommendations = {
        target_issue: recResult.results[0].target_issue,
        target_date: recResult.results[0].target_date,
        picks: recResult.results.map(r => ({
          strategy: r.strategy, red: JSON.parse(r.red) as number[], blue: r.blue,
        })),
      };
    }

    // Detail announcement for the latest draw (pool / prizes / sales).
    let detail: unknown = null;
    try {
      const row = await env.DB.prepare(
        "SELECT payload FROM ssq_details WHERE issue = ?",
      ).bind(draws[0].issue).first<{ payload: string }>();
      if (row) detail = JSON.parse(row.payload);
    } catch { /* table may not exist yet */ }

    // Locked plans (single + combo) and the comprehensive analysis.
    let plans: unknown = null;
    try {
      const planRows = await env.DB.prepare(
        "SELECT target_issue, target_date, kind, payload FROM ssq_plans WHERE target_issue = (SELECT MAX(target_issue) FROM ssq_plans)",
      ).all<{ target_issue: string; target_date: string; kind: string; payload: string }>();
      if (planRows.results.length) {
        plans = {
          target_issue: planRows.results[0].target_issue,
          target_date: planRows.results[0].target_date,
          single: JSON.parse(planRows.results.find(r => r.kind === "single")?.payload ?? "null"),
          combo: JSON.parse(planRows.results.find(r => r.kind === "combo")?.payload ?? "null"),
        };
      }
    } catch { /* table may not exist yet */ }
    let analysis: unknown = null;
    try {
      const row = await env.DB.prepare(
        "SELECT payload FROM ssq_analysis ORDER BY target_issue DESC LIMIT 1",
      ).first<{ payload: string }>();
      if (row) analysis = JSON.parse(row.payload);
    } catch { /* table may not exist yet */ }

    // Review: how the locked picks for the latest drawn issue performed,
    // enriched with the prize tier won, deterministic miss attribution
    // and next-issue improvement directions (statistics, not AI text).
    let review: unknown = null;
    try {
      const past = await env.DB.prepare(
        "SELECT strategy, red, blue FROM ssq_recommendations WHERE target_issue = ? ORDER BY strategy",
      ).bind(draws[0].issue).all<RecRow>();
      if (past.results.length) {
        const actual = draws[0];
        const hotCount = new Map<number, number>();
        for (const d of draws.slice(1, 11)) for (const n of d.red) hotCount.set(n, (hotCount.get(n) ?? 0) + 1);
        const hot = new Set([...hotCount.entries()].filter(([, c]) => c >= 3).map(([n]) => n));
        const actualSum = actual.red.reduce((a, b) => a + b, 0);
        const actualHot = actual.red.filter(n => hot.has(n)).length;
        const actualOdd = actual.red.filter(n => n % 2 === 1).length;
        const det = detail as { first_prize?: number; second_prize?: number } | null;
        const internals: { sumDelta: number; hotGap: number; blueDiff: number }[] = [];
        const results = past.results.map(r => {
          const red = JSON.parse(r.red) as number[];
          const redHits = red.filter(n => actual.red.includes(n));
          const blueHit = r.blue === actual.blue;
          const rc = redHits.length;
          let prize: { tier: string | null; amount: number } = { tier: null, amount: 0 };
          if (rc === 6 && blueHit) prize = { tier: "一等奖", amount: det?.first_prize ?? 0 };
          else if (rc === 6) prize = { tier: "二等奖", amount: det?.second_prize ?? 0 };
          else if (rc === 5 && blueHit) prize = { tier: "三等奖", amount: 3000 };
          else if (rc === 5 || (rc === 4 && blueHit)) prize = { tier: "四等奖", amount: 200 };
          else if (rc === 4 || (rc === 3 && blueHit)) prize = { tier: "五等奖", amount: 10 };
          else if (blueHit) prize = { tier: "六等奖", amount: 5 };
          const pickSum = red.reduce((a, b) => a + b, 0);
          const sumDelta = pickSum - actualSum;
          const pickHot = red.filter(n => hot.has(n)).length;
          const hotGap = actualHot - pickHot;
          const blueDiff = r.blue - actual.blue;
          internals.push({ sumDelta, hotGap, blueDiff });
          const notes: string[] = [];
          if (rc >= 4) notes.push(`红球命中 ${rc} 个，结构接近开奖`);
          if (Math.abs(sumDelta) >= 15) notes.push(`和值偏${sumDelta > 0 ? "高" : "低"} ${Math.abs(sumDelta)} 点（${pickSum} vs 开奖 ${actualSum}）`);
          const oddPick = red.filter(n => n % 2 === 1).length;
          if (Math.abs(oddPick - actualOdd) >= 2) notes.push(`奇偶结构错位（推荐 ${oddPick} 奇 vs 开奖 ${actualOdd} 奇）`);
          if (hotGap >= 2) notes.push(`开奖红球 ${actualHot} 个为近10期热号，推荐仅含 ${pickHot} 个，冷热取向错位`);
          if (!blueHit && Math.abs(blueDiff) === 1) notes.push("蓝球差 1 个邻号");
          return {
            strategy: r.strategy,
            red, blue: r.blue,
            red_hits: redHits,
            blue_hit: blueHit,
            prize,
            notes: notes.slice(0, 3),
          };
        });
        const improvement: string[] = [];
        if (internals.every(i => i.sumDelta <= -15)) improvement.push("三组推荐和值均低于开奖 15 点以上，下期和值中枢上移");
        if (internals.every(i => i.sumDelta >= 15)) improvement.push("三组推荐和值均高于开奖 15 点以上，下期和值中枢下移");
        if (internals.every(i => i.hotGap >= 2)) improvement.push("下期提高近10期热号在红球中的配比");
        if (internals.every(i => i.blueDiff !== 0) && new Set(internals.map(i => Math.sign(i.blueDiff))).size === 1)
          improvement.push(`蓝球候选整体偏${internals[0].blueDiff > 0 ? "大" : "小"}，下期向开奖蓝球 ${actual.blue} 一侧扩展范围`);
        if (!improvement.length) improvement.push("本期偏差未见系统性模式，下期维持现有策略参数");
        review = { issue: actual.issue, actual, results, improvement: improvement.slice(0, 3) };
      }
    } catch { /* ignore */ }

    return json({
      latest: draws[0],
      draws: draws.slice(0, 100),
      stats,
      recommendations,
      detail,
      plans,
      analysis,
      review,
      source: {
        name: "500彩票网双色球历史开奖（与官方同步，全量历史存入本站数据库）",
        url: "https://datachart.500.com/ssq/history/newinc/history.php",
      },
    }, 200);
  } catch {
    return json({ error: "双色球数据暂时不可用" }, 503);
  }
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
