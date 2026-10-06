import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import {boundedSetting} from './operational-config';

const globalForDb = globalThis as unknown as { saasPool?: pg.Pool; saasMediaFinalizing?: number };

export function pool(): pg.Pool {
  if (!globalForDb.saasPool) {
    if (!process.env.DATABASE_URL) throw new Error("SaaS DATABASE_URL is not configured");
    globalForDb.saasPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: boundedSetting('DB_POOL_MAX',10,1,50),connectionTimeoutMillis:5000,statement_timeout:boundedSetting('DB_STATEMENT_TIMEOUT_MS',15000,1000,120000),lock_timeout:boundedSetting('DB_LOCK_TIMEOUT_MS',5000,100,30000),idle_in_transaction_session_timeout:boundedSetting('DB_IDLE_TRANSACTION_TIMEOUT_MS',120000,1000,300000) });
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

// Session advisory lock serializes media sealing across processes without a
// long SQL transaction. An interrupted process releases it automatically.
export async function withMediaFinalizeLock<T>(identity: string, run: () => Promise<T>): Promise<T> {
  const { AppError } = await import("./core");
  pool(); // Validate configuration before opening the independent lock session.
  if ((globalForDb.saasMediaFinalizing || 0) >= 4) throw new AppError(503, "Media validation is busy. Retry shortly.");
  globalForDb.saasMediaFinalizing = (globalForDb.saasMediaFinalizing || 0) + 1;
  // The callback uses the normal pool for short transactions. A lock must not
  // occupy its last connection; DB_POOL_MAX=1 is a supported configuration.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    await client.connect();
    const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [identity]);
    if (!result.rows[0].locked) throw new AppError(409, "Media finalization is already in progress. Retry shortly.");
    return await run();
  } finally {
    // Disconnect releases the advisory lock even when the callback failed.
    await client.end().catch(() => undefined);
    globalForDb.saasMediaFinalizing!--;
  }
}
