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
    const normalised = rows.slice(0, 50).map((r) => ({
      client: r["Client"] || r["Company"] || r["Name"] || null,
      location: r["Location"] || r["Town"] || r["Area"] || null,
      size: r["Size"] || r["Sales Area"] || r["Sq Ft"] || r["Square Footage"] || r["Floor Area"] || null,
      agent: r["Agent"] || r["Agency"] || r["Acting Agent"] || null,
      contact: r["Contact"] || r["Contact Name"] || r["Agent Contact"] || null,
      date: r["Document Date"] || r["Date"] || r["Updated"] || r["Last Updated"] || null,
      status: r["Status"] || null,
      tenure: r["Tenure"] || null,
    }));

    // Pipnet's client filter is fuzzy substring — searching "Pret" returns
    // "Pret News Ltd" too. Filter the rows to ones that genuinely match the
    // brand: exact (after stripping Ltd/Limited/Group/Holdings/plc), OR the
    // brand name occupies the first word of the client name. Anything else
    // is dropped as a false match.
    const normaliseName = (s: string): string => s
      .toLowerCase()
      .replace(/[.,&]/g, "")
      .replace(/\b(ltd|limited|group|holdings|plc|inc|llc|llp|uk|the)\b\.?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const target = normaliseName(brandName);
    const targetTokens = target.split(" ").filter(Boolean);
    const tightlyMatched = normalised.filter((row) => {
      if (!row.client) return false;
      const c = normaliseName(row.client);
      if (!c) return false;
      if (c === target) return true;
      // Must contain ALL of the brand's tokens AND start with the first token.
      // Catches "Aesop UK Ltd" → "aesop" matches, but rejects "Pret News" when
      // brand is "Pret" because tokens of "pret" all match but "pret news"
      // starts with "pret" so... let's tighten further: client length must be
      // close to brand length.
      const startsWithFirst = c.split(" ")[0] === targetTokens[0];
      const lengthRatio = target.length / c.length;
      const allTokensPresent = targetTokens.every(t => c.includes(t));
      return startsWithFirst && allTokensPresent && lengthRatio >= 0.5;
    });

    const droppedAsFuzzy = normalised.length - tightlyMatched.length;
    if (droppedAsFuzzy > 0) {
      console.log(`[pipnet-requirements] "${brandName}": kept ${tightlyMatched.length}/${normalised.length} (dropped ${droppedAsFuzzy} fuzzy matches)`);
    }

    const payload = { rows: tightlyMatched.slice(0, 25), fetched_at: new Date().toISOString(), dropped_fuzzy: droppedAsFuzzy };
    cache.set(companyId, { value: payload, expiresAt: Date.now() + TTL_MS });
    res.json({ ...payload, cached: false });
  } catch (err: any) {
    console.error("[pipnet-requirements] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
