/** GET /api/jingcai-archive - published jingcai picks with settlement state. */
interface Env { DB: D1Database; }
interface D1Database { prepare(sql: string): D1PreparedStatement; }
interface D1PreparedStatement { all<T = unknown>(): Promise<{ results: T[] }>; }
interface DayRow { sale_date: string; payload: string; }

export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  try {
    const rows = await env.DB.prepare(
      "SELECT sale_date, payload FROM jingcai_archive_days ORDER BY sale_date DESC LIMIT 14",
    ).all<DayRow>();
    const days = rows.results.map(r => JSON.parse(r.payload));
    return json({ days }, 200);
  } catch {
    // Table may not exist before the first archived run; an empty
    // history is a valid state for the page, not an error.
    return json({ days: [] }, 200);
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
