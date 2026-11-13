import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

let poolInstance: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      statement_timeout: 30000,
      query_timeout: 30000,
      allowExitOnIdle: false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      ssl: process.env.PGSSLMODE === "disable"
        ? false
        : process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });

    poolInstance.on('error', (err) => {
      console.error('[db] Pool error:', err.message);
    });

    // Postgres's just-in-time compiler is priced for long analytic queries.
    // On a page read it costs more than it saves: the brand profile's
    // competitor query spent about 4 s of every load compiling on live
    // (2026-11-13). Switched off for each connection as it opens; it only
    // changes speed, and if the server refuses the setting nothing changes.
    poolInstance.on('connect', (client) => {
      client.query("SET jit = off").catch(() => {});
    });
  }
  return poolInstance;
}

export const pool = getPool();
export const db = drizzle(pool, { schema });
