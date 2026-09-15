// Pipnet requirements for a brand — cached lookup the brand profile uses to
// surface "what space is X looking for" directly on the page. Separate
// endpoint (rather than baked into /api/brand/:id/profile) because the
// Pipnet HTML scrape can be slow + flaky and we don't want it blocking
// the rest of the brand profile load.
//
// Persisted cache bound to the confirmed brand identity. Refresh explicitly with ?refresh=1.
//
// Endpoint:
//   GET /api/brand/:companyId/pipnet-requirements[?refresh=1]
//   → { rows: Array<{ client, location, size, agent, date, ... }>, fetched_at, cached }
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { getBrandIdentity } from "./brand-identity";
import { resolveCompanyScope, isClientVisibleBrand } from "./company-scope";
import { searchPipnetRequirements } from "./pipnet";

const router = Router();

router.get("/api/brand/:companyId/pipnet-requirements", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";

    const scope = await resolveCompanyScope(req as any);
    if (scope && scope !== companyId && !await isClientVisibleBrand(companyId, scope)) return res.status(403).json({ error: "Not available for this account" });
    const companyRow = await pool.query(
      `SELECT * FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    if (!companyRow.rowCount) return res.status(404).json({ error: "Company not found" });
    const brandName = companyRow.rows[0].name;

    const identity = getBrandIdentity(companyRow.rows[0]);
    const key = `brand-pipnet:${companyId}`;
    const saved = (await pool.query("SELECT value FROM system_settings WHERE key = $1", [key])).rows[0]?.value;
    if (!refresh) return res.json(saved?.fingerprint === identity.fingerprint
      ? { ...saved, cached: true } : { rows: [], fetched_at: null, cached: true, status: "pending" });
    if (identity.status !== "verified") return res.status(409).json({ error: identity.reason, rows: [], status: "needs_review" });

    let rows: Record<string, string>[] = [];
    try {
      // Pipnet's free-text client filter is fuzzy — pulls anything containing
      // the search string; exact confirmed aliases are checked below.
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
    // brand: exact confirmed names after stripping legal suffixes.
    const normaliseName = (s: string): string => s
      .toLowerCase()
      .replace(/[.,&]/g, "")
      .replace(/\b(ltd|limited|group|holdings|plc|inc|llc|llp|uk|the)\b\.?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const approvedNames = new Set(identity.aliases.map(normaliseName));
    const tightlyMatched = normalised.filter(row => row.client && approvedNames.has(normaliseName(row.client)));

    const droppedAsFuzzy = normalised.length - tightlyMatched.length;
    if (droppedAsFuzzy > 0) {
      console.log(`[pipnet-requirements] "${brandName}": kept ${tightlyMatched.length}/${normalised.length} (dropped ${droppedAsFuzzy} fuzzy matches)`);
    }

    const payload = { rows: tightlyMatched.slice(0, 25), fetched_at: new Date().toISOString(), dropped_fuzzy: droppedAsFuzzy };
    const current = (await pool.query("SELECT * FROM crm_companies WHERE id = $1", [companyId])).rows[0];
    if (getBrandIdentity(current).fingerprint !== identity.fingerprint) return res.status(409).json({ error: "The brand identity changed. Refresh against its current website." });
    await pool.query("INSERT INTO system_settings(key,value) VALUES ($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [key, JSON.stringify({ ...payload, fingerprint: identity.fingerprint })]);
    res.json({ ...payload, cached: false });
  } catch (err: any) {
    console.error("[pipnet-requirements] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
