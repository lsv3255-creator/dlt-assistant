/** GET /api/football-current - customer-safe current football snapshot from D1. */
interface Env { DB: D1Database; }
interface D1Database { prepare(sql: string): D1PreparedStatement; }
interface D1PreparedStatement { first<T = unknown>(): Promise<T | null>; }
interface SnapshotRow { public_payload: string; }

export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  try {
    const row = await env.DB.prepare(
      "SELECT public_payload FROM football_current_snapshot WHERE slot = 1",
    ).first<SnapshotRow>();
    if (!row) return json({ error: "暂无当前期足彩分析" }, 404);
    return json(JSON.parse(row.public_payload), 200);
  } catch {
    return json({ error: "足彩分析暂时不可用" }, 503);
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
