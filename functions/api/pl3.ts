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

export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  try {
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
    const stats = {
      total_draws: draws.length,
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

    return json({
      latest: draws[0],
      draws: draws.slice(0, 100),
      stats,
      recommendations,
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
