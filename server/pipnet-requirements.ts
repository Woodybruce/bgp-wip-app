// Pipnet requirements for a brand — cached lookup the brand profile uses to
// surface "what space is X looking for" directly on the page. Separate
// endpoint (rather than baked into /api/brand/:id/profile) because the
// Pipnet HTML scrape can be slow + flaky and we don't want it blocking
// the rest of the brand profile load.
//
// Cache: 1 hour per brand. Re-run with ?refresh=1 to bypass.
//
// Endpoint:
//   GET /api/brand/:companyId/pipnet-requirements[?refresh=1]
//   → { rows: Array<{ client, location, size, agent, date, ... }>, fetched_at, cached }
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { searchPipnetRequirements } from "./pipnet";

const router = Router();

interface CachedRow {
  rows: any[];
  fetched_at: string;
}
const cache = new Map<string, { value: CachedRow; expiresAt: number }>();
const TTL_MS = 60 * 60_000; // 1h

router.get("/api/brand/:companyId/pipnet-requirements", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";

    const companyRow = await pool.query<{ name: string }>(
      `SELECT name FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    if (!companyRow.rowCount) return res.status(404).json({ error: "Company not found" });
    const brandName = companyRow.rows[0].name;

    if (!refresh) {
      const hit = cache.get(companyId);
      if (hit && Date.now() < hit.expiresAt) {
        return res.json({ ...hit.value, cached: true });
      }
    }

    let rows: Record<string, string>[] = [];
    try {
      // Pipnet's free-text client filter is fuzzy — pulls anything containing
      // the search string. Good enough as a first pass; we can tighten later.
      rows = await searchPipnetRequirements({ client: brandName });
    } catch (err: any) {
      console.warn(`[pipnet-requirements] ${brandName}: ${err?.message}`);
      // Fail soft — caller still gets an empty list, no 500.
      return res.json({ rows: [], fetched_at: new Date().toISOString(), cached: false, error: err?.message });
    }

    // Normalise the variable Pipnet field names into a stable shape.
    const normalised = rows.slice(0, 25).map((r) => ({
      client: r["Client"] || r["Company"] || r["Name"] || null,
      location: r["Location"] || r["Town"] || r["Area"] || null,
      size: r["Size"] || r["Sales Area"] || r["Sq Ft"] || r["Square Footage"] || r["Floor Area"] || null,
      agent: r["Agent"] || r["Agency"] || r["Acting Agent"] || null,
      contact: r["Contact"] || r["Contact Name"] || r["Agent Contact"] || null,
      date: r["Document Date"] || r["Date"] || r["Updated"] || r["Last Updated"] || null,
      status: r["Status"] || null,
      tenure: r["Tenure"] || null,
    }));

    const payload = { rows: normalised, fetched_at: new Date().toISOString() };
    cache.set(companyId, { value: payload, expiresAt: Date.now() + TTL_MS });
    res.json({ ...payload, cached: false });
  } catch (err: any) {
    console.error("[pipnet-requirements] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
