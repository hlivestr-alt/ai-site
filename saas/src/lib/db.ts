import "server-only";
import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const globalForDb = globalThis as unknown as { saasPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForDb.saasPool) {
    if (!process.env.DATABASE_URL) throw new Error("SaaS DATABASE_URL is not configured");
    globalForDb.saasPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  return globalForDb.saasPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
  return pool().query<T>(sql, values);
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export type DbClient = { query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<T>> };
