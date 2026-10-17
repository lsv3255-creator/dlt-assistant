/** GET /api/fc3d - fucai 3D draws, per-position statistics and locked picks from D1. */
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
        "SELECT issue, date, d1, d2, d3 FROM fc3d_draws WHERE issue = ?",
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

      let detail: unknown = null;
      try {
        const row = await env.DB.prepare(
          "SELECT payload FROM fc3d_details WHERE issue = ?",
        ).bind(issueParam).first<{ payload: string }>();
        if (row) detail = JSON.parse(row.payload);
      } catch { /* details table may not exist */ }
      let recommendations: unknown = null;
      try {
        const recs = await env.DB.prepare(
          "SELECT strategy, digits FROM fc3d_recommendations WHERE target_issue = ? ORDER BY strategy",
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
          "SELECT kind, payload FROM fc3d_plans WHERE target_issue = ?",
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
      "SELECT issue, date, d1, d2, d3 FROM fc3d_draws ORDER BY issue_num DESC LIMIT 9000",
    ).all<DrawRow>();
    if (!results.length) return json({ error: "暂无福彩3D数据" }, 404);
    const draws = results.map(row => ({
      issue: row.issue, date: row.date, digits: [row.d1, row.d2, row.d3],
    }));

    // Per-position statistics mirror src/fc3d/stats.py.
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
      "SELECT target_issue, target_date, strategy, digits FROM fc3d_recommendations WHERE target_issue = (SELECT MAX(target_issue) FROM fc3d_recommendations) ORDER BY strategy",
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
        "SELECT payload FROM fc3d_details WHERE issue = ?",
      ).bind(draws[0].issue).first<{ payload: string }>();
      if (row) Object.assign(detail, JSON.parse(row.payload) as Record<string, unknown>);
    } catch { /* table may not exist yet */ }
    let plans: unknown = null;
    try {
      const planRows = await env.DB.prepare(
        "SELECT target_issue, target_date, kind, payload FROM fc3d_plans WHERE target_issue = (SELECT MAX(target_issue) FROM fc3d_plans)",
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
        "SELECT payload FROM fc3d_analysis ORDER BY target_issue DESC LIMIT 1",
      ).first<{ payload: string }>();
      if (row) analysis = JSON.parse(row.payload);
    } catch { /* table may not exist yet */ }
    // Review enriched with prize tier, deterministic miss attribution
    // and next-issue improvement directions (statistics, not AI text).
    let review: unknown = null;
    try {
      const past = await env.DB.prepare(
        "SELECT strategy, digits FROM fc3d_recommendations WHERE target_issue = ? ORDER BY strategy",
      ).bind(draws[0].issue).all<RecRow>();
      if (past.results.length) {
        const actual = draws[0];
        const actualDigits = actual.digits;
        const actualSum = actualDigits.reduce((a, b) => a + b, 0);
        const form = new Set(actualDigits).size;
        const POS = ["百位", "十位", "个位"];
        const internals: { sumDelta: number; missed: number[]; groupOnly: boolean }[] = [];
        const results = past.results.map(r => {
          const digits = JSON.parse(r.digits) as number[];
          const positionHits = digits.filter((d, i) => d === actualDigits[i]).length;
          const directHit = digits.join() === actualDigits.join();
          const groupHit = digits.length === 3
            ? [...digits].sort().join() === [...actualDigits].sort().join()
            : false;
          let prize: { tier: string | null; amount: number } = { tier: null, amount: 0 };
          if (directHit) prize = { tier: "直选", amount: 1040 };
          else if (groupHit && form === 2) prize = { tier: "组三", amount: 346 };
          else if (groupHit && form === 3) prize = { tier: "组六", amount: 173 };
          const missed = digits.map((d, i) => (d === actualDigits[i] ? -1 : i)).filter(i => i >= 0);
          const sumDelta = digits.reduce((a, b) => a + b, 0) - actualSum;
          internals.push({ sumDelta, missed, groupOnly: groupHit && !directHit });
          const notes: string[] = [];
          if (groupHit && !directHit) notes.push("组选号码全对但位置错位，直选落空");
          if (missed.length === 1) notes.push(`仅差${POS[missed[0]]}一位即直选（荐 ${digits[missed[0]]} vs 开 ${actualDigits[missed[0]]}）`);
          const near = missed.filter(i => Math.abs(digits[i] - actualDigits[i]) === 1);
          if (near.length >= 2) notes.push(`${near.length} 位数字均为 ±1 擦过`);
          if (Math.abs(sumDelta) >= 4) notes.push(`和值偏${sumDelta > 0 ? "高" : "低"} ${Math.abs(sumDelta)} 点`);
          return {
            strategy: r.strategy,
            digits,
            position_hits: positionHits,
            direct_hit: directHit,
            group_hit: groupHit,
            prize,
            notes: notes.slice(0, 3),
          };
        });
        const improvement: string[] = [];
        const deadPositions = POS.filter((_, pos) => internals.every(i => i.missed.includes(pos)));
        if (deadPositions.length === actualDigits.length)
          improvement.push("各位数字三组全错，下期各位均扩大候选池");
        else
          for (const name of deadPositions) improvement.push(`${name}三组全错，下期该位扩大候选池`);
        if (internals.filter(i => i.groupOnly).length >= 2)
          improvement.push("组选命中而位置错位多发，下期增加位置轮换与组选覆盖");
        if (internals.every(i => i.sumDelta <= -4)) improvement.push("三组推荐和值均低于开奖，下期和值中枢上移");
        if (internals.every(i => i.sumDelta >= 4)) improvement.push("三组推荐和值均高于开奖，下期和值中枢下移");
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
        name: "500彩票网福彩3D历史开奖（与官方同步，全量历史存入本站数据库）",
        url: "https://kaijiang.500.com/sd.shtml",
      },
    }, 200);
  } catch {
    return json({ error: "福彩3D数据暂时不可用" }, 503);
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
