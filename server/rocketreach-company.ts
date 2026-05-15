// RocketReach company-level lookup. Companion to rocketreach-contacts.ts.
//
// Uses /v2/api/searchCompany (POST with a query body) — same pattern as the
// people search. Picks the best match by domain, falls back to name. Returns
// the firmographic record (description, industry, headcount, revenue band,
// funding, HQ, social URLs, tech stack). Cached per-brand in
// brand_rocketreach_data.
//
// Endpoints:
//   GET  /api/brand/:companyId/rocketreach-company        → cached payload
//   POST /api/brand/:companyId/rocketreach-company/refresh → re-fetch from RR
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

function rrAuthHeader(): Record<string, string> | null {
  const key = process.env.ROCKETREACH_API_KEY;
  if (!key) return null;
  return { "Api-Key": key };
}

function extractDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return String(raw).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
}

async function searchCompany(opts: { domain?: string | null; name?: string | null }): Promise<any | null> {
  const auth = rrAuthHeader();
  if (!auth) throw new Error("ROCKETREACH_API_KEY not configured");

  const query: Record<string, string[]> = {};
  if (opts.domain) query.domain = [opts.domain];
  if (opts.name) query.name = [opts.name];
  if (!query.domain && !query.name) return null;

  const body = { query, page_size: 5, start: 1 };

  const res = await fetch("https://api.rocketreach.co/v2/api/searchCompany", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[rocketreach-company] searchCompany ${res.status}:`, text.slice(0, 400));
    throw new Error(`RocketReach searchCompany ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  const list = (data?.companies || data?.results || data?.profiles || []) as any[];
  return list[0] || null;
}

router.get("/api/brand/:companyId/rocketreach-company", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const row = await pool.query(
      `SELECT payload, fetched_at FROM brand_rocketreach_data WHERE company_id = $1`,
      [companyId]
    );
    if (row.rowCount) {
      return res.json({
        configured: !!process.env.ROCKETREACH_API_KEY,
        payload: row.rows[0].payload,
        fetched_at: row.rows[0].fetched_at,
      });
    }
    res.json({ configured: !!process.env.ROCKETREACH_API_KEY, payload: null, fetched_at: null });
  } catch (err: any) {
    console.error("[rocketreach-company] GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/rocketreach-company/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!process.env.ROCKETREACH_API_KEY) {
      return res.status(503).json({ error: "ROCKETREACH_API_KEY not configured" });
    }
    const companyId = String(req.params.companyId);
    const companyRow = await pool.query(
      `SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    if (!companyRow.rowCount) return res.status(404).json({ error: "Company not found" });
    const company = companyRow.rows[0];
    const domain = extractDomain(company.domain_url || company.domain);

    let payload: any = null;
    if (domain) {
      payload = await searchCompany({ domain });
    }
    if (!payload && company.name) {
      payload = await searchCompany({ name: company.name });
    }

    if (!payload) {
      return res.json({ payload: null, fetched_at: new Date().toISOString(), note: "No match on RocketReach" });
    }

    await pool.query(
      `INSERT INTO brand_rocketreach_data (company_id, payload, fetched_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (company_id) DO UPDATE
         SET payload = EXCLUDED.payload, fetched_at = now()`,
      [companyId, JSON.stringify(payload)]
    );

    res.json({ payload, fetched_at: new Date().toISOString() });
  } catch (err: any) {
    console.error("[rocketreach-company] refresh error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
