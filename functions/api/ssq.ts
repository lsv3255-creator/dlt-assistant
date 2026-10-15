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

export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  try {
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
    const stats = {
      total_draws: draws.length,
      frequency_100: { red: freq100.red.slice(1), blue: freq100.blue.slice(1) },
      omission: { red: omission.red.slice(1), blue: omission.blue.slice(1) },
      hot: { red: top(freq100.red, 6, 1), blue: top(freq100.blue, 3, 1) },
      cold: { red: top(omission.red, 6, 1), blue: top(omission.blue, 3, 1) },
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

    return json({
      latest: draws[0],
      draws: draws.slice(0, 100),
      stats,
      recommendations,
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
