import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import {boundedSetting} from './operational-config';

const globalForDb = globalThis as unknown as { saasPool?: pg.Pool };

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
