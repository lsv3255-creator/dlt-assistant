/** GET /api/pl3 - fucai 3D draws, per-position statistics and locked picks from D1. */
interface Env { DB: D1Database; }
interface D1Database { prepare(sql: string): D1PreparedStatement; }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
interface DrawRow { issue: string; date: string; d1: number; d2: number; d3: number; }
interface RecRow { target_issue: string; target_date: string; strategy: string; digits: string; }

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }): Promise<Response> => {
  try {
    // Single-issue detail (?issue=...): draw + computed shape + that
    // issue's locked recommendations/plans.
    const issueParam = new URL(request.url).searchParams.get("issue");
    if (issueParam) {
      const drawRow = await env.DB.prepare(
        "SELECT issue, date, d1, d2, d3 FROM pl3_draws WHERE issue = ?",
      ).bind(issueParam).first<DrawRow>();
      if (!drawRow) return json({ error: "未找到该期开奖" }, 404);
      const draw = { issue: drawRow.issue, date: drawRow.date, digits: [drawRow.d1, drawRow.d2, drawRow.d3] };
      const digits = draw.digits;
      const counts = new Map<number, number>();
      digits.forEach(d => counts.set(d, (counts.get(d) ?? 0) + 1));
      const sizes = [...counts.values()].sort((a, b) => b - a);
      const form = digits.length === 3
        ? (sizes[0] === 3 ? "豹子" : sizes[0] === 2 ? "组三" : "组六")
        : (({ "5": "五同", "4,1": "四同", "3,2": "三带二", "3,1,1": "三同", "2,2,1": "两对", "2,1,1,1": "一对", "1,1,1,1,1": "全不同" } as Record<string, string>)[sizes.join(",")] ?? "其他");
      const computed = {
        sum: digits.reduce((a, b) => a + b, 0),
        span: Math.max(...digits) - Math.min(...digits),
        form,
        odd_count: digits.filter(d => d % 2 === 1).length,
        big_count: digits.filter(d => d >= 5).length,
      };

      const detail: unknown = null;
      let recommendations: unknown = null;
      try {
        const recs = await env.DB.prepare(
          "SELECT strategy, digits FROM pl3_recommendations WHERE target_issue = ? ORDER BY strategy",
        ).bind(issueParam).all<{ strategy: string; digits: string }>();
        if (recs.results.length) {
          recommendations = recs.results.map(r => {
            const rec = r.digits.split(",").map(Number);
            return {
              strategy: r.strategy, digits: rec,
              position_hits: rec.filter((d, i) => d === digits[i]).length,
              direct_hit: rec.every((d, i) => d === digits[i]),
              group_hit: digits.length === 3
                ? [...rec].sort((a, b) => a - b).join(",") === [...digits].sort((a, b) => a - b).join(",")
                : null,
            };
          });
        }
      } catch { /* recommendations table may not exist */ }
      let plans: unknown = null;
      try {
        const planRows = await env.DB.prepare(
          "SELECT kind, payload FROM pl3_plans WHERE target_issue = ?",
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
      "SELECT issue, date, d1, d2, d3 FROM pl3_draws ORDER BY issue_num DESC LIMIT 9000",
    ).all<DrawRow>();
    if (!results.length) return json({ error: "暂无排列三数据" }, 404);
    const draws = results.map(row => ({
      issue: row.issue, date: row.date, digits: [row.d1, row.d2, row.d3],
    }));

    // Per-position statistics mirror src/pl3/stats.py.
    const freq100 = [new Array(10).fill(0), new Array(10).fill(0), new Array(10).fill(0)];
    draws.slice(0, 100).forEach(d => d.digits.forEach((digit, pos) => { freq100[pos][digit] += 1; }));
    const omission = [new Array(10).fill(draws.length), new Array(10).fill(draws.length), new Array(10).fill(draws.length)];
    draws.forEach((d, idx) => d.digits.forEach((digit, pos) => {
      if (omission[pos][digit] === draws.length) omission[pos][digit] = idx;
    }));
    const argmax = (values: number[]) => values.indexOf(Math.max(...values));
    const sumDist = new Array(28).fill(0);
    draws.slice(0, 100).forEach(d => { sumDist[d.digits[0] + d.digits[1] + d.digits[2]] += 1; });
    const freq30 = Array.from({ length: 3 }, () => new Array(10).fill(0));
    draws.slice(0, 30).forEach(d => d.digits.forEach((digit, pos) => { freq30[pos][digit] += 1; }));
    const freqAll = Array.from({ length: 3 }, () => new Array(10).fill(0));
    draws.forEach(d => d.digits.forEach((digit, pos) => { freqAll[pos][digit] += 1; }));
    const sumHist = new Array(28).fill(0);
    draws.slice(0, 100).forEach(d => { sumHist[d.digits.reduce((a, b) => a + b, 0)] += 1; });
    const stats = {
      total_draws: draws.length,
      frequency_30: { per_position: freq30 },
      frequency_all: { per_position: freqAll },
      sum_hist_100: sumHist,
      frequency_100: { per_position: freq100 },
      omission: { per_position: omission },
      hot: freq100.map(argmax),
      cold: omission.map(argmax),
      common_sum_100: argmax(sumDist),
    };

    let recommendations: { target_issue: string; target_date: string; picks: { strategy: string; digits: number[] }[] } | null = null;
    const recResult = await env.DB.prepare(
      "SELECT target_issue, target_date, strategy, digits FROM pl3_recommendations WHERE target_issue = (SELECT MAX(target_issue) FROM pl3_recommendations) ORDER BY strategy",
    ).all<RecRow>();
    if (recResult.results.length) {
      recommendations = {
        target_issue: recResult.results[0].target_issue,
        target_date: recResult.results[0].target_date,
        picks: recResult.results.map(r => ({
          strategy: r.strategy, digits: JSON.parse(r.digits) as number[],
        })),
      };
    }

    // Draw detail: computed shape (+ trycode for fc3d from its table).
    const latestDigits = draws[0].digits;
    const detail: Record<string, unknown> = {
      sum: latestDigits.reduce((a, b) => a + b, 0),
      span: Math.max(...latestDigits) - Math.min(...latestDigits),
      form: latestDigits.length === 3
        ? (new Set(latestDigits).size === 1 ? "豹子" : new Set(latestDigits).size === 2 ? "组三" : "组六")
        : null,
      odd_count: latestDigits.filter(d => d % 2 === 1).length,
    };
    try {
      const row = await env.DB.prepare(
        "SELECT payload FROM pl3_details WHERE issue = ?",
      ).bind(draws[0].issue).first<{ payload: string }>();
      if (row) Object.assign(detail, JSON.parse(row.payload) as Record<string, unknown>);
    } catch { /* table may not exist yet */ }
    let plans: unknown = null;
    try {
      const planRows = await env.DB.prepare(
        "SELECT target_issue, target_date, kind, payload FROM pl3_plans WHERE target_issue = (SELECT MAX(target_issue) FROM pl3_plans)",
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
        "SELECT payload FROM pl3_analysis ORDER BY target_issue DESC LIMIT 1",
      ).first<{ payload: string }>();
      if (row) analysis = JSON.parse(row.payload);
    } catch { /* table may not exist yet */ }
    let review: unknown = null;
    try {
      const past = await env.DB.prepare(
        "SELECT strategy, digits FROM pl3_recommendations WHERE target_issue = ? ORDER BY strategy",
      ).bind(draws[0].issue).all<RecRow>();
      if (past.results.length) {
        review = {
          issue: draws[0].issue,
          actual: draws[0],
          results: past.results.map(r => {
            const digits = JSON.parse(r.digits) as number[];
            return {
              strategy: r.strategy,
              digits,
              position_hits: digits.filter((d, i) => d === draws[0].digits[i]).length,
              direct_hit: digits.join() === draws[0].digits.join(),
              group_hit: digits.length === 3
                ? [...digits].sort().join() === [...draws[0].digits].sort().join()
                : false,
            };
          }),
        };
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
        name: "500彩票网排列三历史开奖（与官方同步，全量历史存入本站数据库）",
        url: "https://kaijiang.500.com/pls.shtml",
      },
    }, 200);
  } catch {
    return json({ error: "排列三数据暂时不可用" }, 503);
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
