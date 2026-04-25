import crypto from "crypto";
import { pool } from "../db";

// Postgres-backed cache for planning-document PDFs. Keyed by SHA256 of the
// source URL, body stored as bytea. PDFs barely change once the LPA has
// published a decision, so a 30-day TTL is plenty.
//
// Why DB-backed (not in-memory): Railway containers restart on every deploy,
// and the same Westminster PDF tends to be opened by multiple users
// investigating the same property. Persisting across restarts means the
// second user pays zero ScraperAPI cost.

const DEFAULT_TTL_DAYS = 30;
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB — anything larger is suspect

let bootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (bootstrapped) return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS planning_pdf_cache (
          url_hash text PRIMARY KEY,
          url text NOT NULL,
          pdf_bytes bytea NOT NULL,
          content_length integer NOT NULL,
          fetched_at timestamptz NOT NULL DEFAULT NOW(),
          expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS planning_pdf_cache_expires_idx ON planning_pdf_cache (expires_at)`);
      bootstrapped = true;
    } catch (err: any) {
      console.warn("[pdf-cache] bootstrap failed:", err?.message);
    }
  })();
  return bootstrapPromise;
}

function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

export async function getCachedPdf(url: string): Promise<Buffer | null> {
  await ensureTable();
  try {
    const r = await pool.query(
      `SELECT pdf_bytes FROM planning_pdf_cache WHERE url_hash = $1 AND expires_at > NOW() LIMIT 1`,
      [hashUrl(url)]
    );
    if (r.rows.length === 0) return null;
    const buf = r.rows[0].pdf_bytes as Buffer;
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  } catch (err: any) {
    if (!/does not exist/i.test(err?.message || "")) {
      console.warn("[pdf-cache] read failed:", err?.message);
    }
    return null;
  }
}

export async function setCachedPdf(url: string, buf: Buffer, ttlDays = DEFAULT_TTL_DAYS): Promise<void> {
  if (!buf || buf.length === 0) return;
  if (buf.length > MAX_PDF_BYTES) {
    console.warn(`[pdf-cache] skip cache, oversize (${buf.length}B): ${url}`);
    return;
  }
  await ensureTable();
  try {
    const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO planning_pdf_cache (url_hash, url, pdf_bytes, content_length, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (url_hash) DO UPDATE
         SET pdf_bytes = EXCLUDED.pdf_bytes,
             content_length = EXCLUDED.content_length,
             fetched_at = NOW(),
             expires_at = EXCLUDED.expires_at`,
      [hashUrl(url), url, buf, buf.length, expires]
    );
  } catch (err: any) {
    console.warn("[pdf-cache] write failed:", err?.message);
  }
}

// Daily purge — keeps the table from accumulating expired blobs.
let purgeTimer: NodeJS.Timeout | null = null;
export function startPdfCachePurge() {
  if (purgeTimer) return;
  const purge = async () => {
    try {
      const r = await pool.query(`DELETE FROM planning_pdf_cache WHERE expires_at < NOW()`);
      if (r.rowCount && r.rowCount > 0) {
        console.log(`[pdf-cache] purged ${r.rowCount} expired entries`);
      }
    } catch (err: any) {
      if (!/does not exist/i.test(err?.message || "")) {
        console.warn("[pdf-cache] purge error:", err?.message);
      }
    }
  };
  setTimeout(purge, 5 * 60 * 1000);
  purgeTimer = setInterval(purge, 24 * 60 * 60 * 1000);
}
