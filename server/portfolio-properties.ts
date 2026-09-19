// Property membership for portfolios.
//
// Portfolios (server/portfolios.ts) bundle Property Pathway RUNS for the
// combined outputs. This module adds the second membership axis Woody
// asked for: crm PROPERTIES, so the same portfolio (e.g. "CEG Portfolio")
// also groups rows on the Investment Tracker and gets a combined property
// view on its page. One portfolio entity, two kinds of members.
//
// Endpoints live under /api/portfolio-properties so the existing
// /api/portfolios handlers stay untouched. The link table is created here
// at runtime, matching the ensure-table pattern used across the codebase.
import { Router } from "express";
import { requireAuth } from "./auth";

const router = Router();

let dbPool: any = null;
async function getPool() {
  if (!dbPool) {
    const { pool } = await import("./db");
    dbPool = pool;
  }
  return dbPool;
}

let ensured = false;
async function ensureTables(pool: any) {
  if (ensured) return;
  // portfolios itself is bootstrapped by server/portfolios.ts; make sure it
  // exists before the FK below on a fresh database.
  const { ensurePathwayTables } = await import("./portfolios");
  await ensurePathwayTables();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_properties (
      portfolio_id VARCHAR NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      property_id VARCHAR NOT NULL,
      added_at TIMESTAMP DEFAULT now(),
      PRIMARY KEY (portfolio_id, property_id)
    )`);
  ensured = true;
}

// Portfolios are BGP's internal instruction structure — never client-visible.
async function blockClients(req: any, res: any): Promise<boolean> {
  const { resolveCompanyScope } = await import("./company-scope");
  const scope = await resolveCompanyScope(req);
  if (scope) {
    res.status(403).json({ message: "Not available for client accounts" });
    return true;
  }
  return false;
}

// Every portfolio with its member property ids (possibly empty — a
// portfolio born on the pathway side still shows up so the tracker can
// add properties to it). Feeds the Investment Tracker grouping.
router.get("/api/portfolio-properties", requireAuth, async (req, res) => {
  try {
    if (await blockClients(req, res)) return;
    const pool = await getPool();
    await ensureTables(pool);
    const q = await pool.query(`
      SELECT p.id, p.name,
             COALESCE(json_agg(pp.property_id) FILTER (WHERE pp.property_id IS NOT NULL), '[]'::json) AS "propertyIds"
        FROM portfolios p
        LEFT JOIN portfolio_properties pp ON pp.portfolio_id = p.id
       GROUP BY p.id
       ORDER BY p.name`);
    res.json(q.rows);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to list portfolios" });
  }
});

// Create a portfolio (optionally) and attach properties in one call —
// the tracker's "Group into portfolio" action. Pass portfolioId to add
// to an existing portfolio instead.
router.post("/api/portfolio-properties", requireAuth, async (req: any, res) => {
  try {
    if (await blockClients(req, res)) return;
    const pool = await getPool();
    await ensureTables(pool);
    const propertyIds: string[] = Array.isArray(req.body?.propertyIds)
      ? [...new Set(req.body.propertyIds.filter(Boolean).map((p: any) => String(p)))] as string[]
      : [];
    let portfolioId: string | null = req.body?.portfolioId || null;
    let name: string | null = req.body?.name ? String(req.body.name).trim() : null;
    if (!portfolioId) {
      if (!name) return res.status(400).json({ message: "name or portfolioId required" });
      const ins = await pool.query(
        `INSERT INTO portfolios (name, created_by) VALUES ($1, $2) RETURNING id, name`,
        [name, req.session?.userId || null],
      );
      portfolioId = ins.rows[0].id;
      name = ins.rows[0].name;
    } else {
      const chk = await pool.query(`SELECT name FROM portfolios WHERE id = $1`, [portfolioId]);
      if (!chk.rows[0]) return res.status(404).json({ message: "Portfolio not found" });
      name = chk.rows[0].name;
    }
    for (const pid of propertyIds) {
      await pool.query(
        `INSERT INTO portfolio_properties (portfolio_id, property_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [portfolioId, pid],
      );
    }
    res.status(201).json({ id: portfolioId, name, propertyCount: propertyIds.length });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to save portfolio properties" });
  }
});

// Member properties for one portfolio, enriched with their investment
// tracker position + letting/pathway counts, plus aggregates — powers the
// Properties section on the portfolio page.
router.get("/api/portfolio-properties/:portfolioId", requireAuth, async (req, res) => {
  try {
    if (await blockClients(req, res)) return;
    const pool = await getPool();
    await ensureTables(pool);
    const props = await pool.query(
      `SELECT cp.id, cp.name, cp.postcode,
              it.id AS "trackerId", it.status AS "trackerStatus", it.board_type AS "boardType",
              it.guide_price AS "guidePrice", it.niy, it.sqft, it.current_rent AS "currentRent",
              it.tenure, it.asset_type AS "assetType",
              (SELECT COUNT(*) FROM available_units au WHERE au.property_id = cp.id) AS "lettingUnits",
              (SELECT COUNT(*) FROM property_pathway_runs pr WHERE pr.property_id = cp.id) AS "pathwayRuns"
         FROM portfolio_properties pp
         JOIN crm_properties cp ON cp.id = pp.property_id
         LEFT JOIN investment_tracker it ON it.property_id = cp.id
        WHERE pp.portfolio_id = $1
        ORDER BY cp.name`,
      [req.params.portfolioId],
    );
    const rows = props.rows;
    const sum = (k: string) => rows.reduce((a: number, r: any) => a + (Number(r[k]) || 0), 0);
    const totalGuidePrice = sum("guidePrice");
    const totalRent = sum("currentRent");
    res.json({
      properties: rows,
      aggregates: {
        propertyCount: rows.length,
        totalGuidePrice,
        totalSqft: sum("sqft"),
        totalRent,
        blendedNiy: totalGuidePrice > 0 && totalRent > 0 ? (totalRent / totalGuidePrice) * 100 : null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to load portfolio properties" });
  }
});

router.delete("/api/portfolio-properties/:portfolioId/:propertyId", requireAuth, async (req, res) => {
  try {
    if (await blockClients(req, res)) return;
    const pool = await getPool();
    await ensureTables(pool);
    await pool.query(
      `DELETE FROM portfolio_properties WHERE portfolio_id = $1 AND property_id = $2`,
      [req.params.portfolioId, req.params.propertyId],
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to remove property" });
  }
});

export default router;
