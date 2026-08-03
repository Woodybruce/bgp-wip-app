// ─────────────────────────────────────────────────────────────────────────
// Portfolios — bundle several Property Pathway runs into one reviewable
// opportunity (Nick & Jonny's "run a portfolio, combine the outputs" ask).
//
// A portfolio is a named list of pathway runs. Each link carries an
// `enabled` flag so a run can be toggled in/out of the combined outputs
// without unlinking it. Three combined outputs read from the enabled runs:
//   • summary table  — headline metrics per asset + portfolio totals (here)
//   • portfolio Excel — one tab per asset + a Portfolio rollup tab
//   • portfolio Why Buy — portfolio cover + a section per asset
// (the two document generators live in portfolio-outputs.ts and are wired
//  to the buttons on the portfolio page.)
//
// Table creation is done at runtime (CREATE TABLE IF NOT EXISTS) so this
// ships without a manual migration step, matching the pattern used by the
// other late-added tables in this codebase.
// ─────────────────────────────────────────────────────────────────────────

import type { Express, Request, Response } from "express";
import { db, pool } from "./db";
import { portfolios, portfolioRuns, propertyPathwayRuns } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "./auth";

let _ensured = false;
async function ensureTables(): Promise<void> {
  if (_ensured) return;
  await pool.query(`
    -- portfolio_runs carries a hard FK onto property_pathway_runs, which is
    -- only created by drizzle migrations — on a database that never ran them
    -- (fresh deploy, local fixture) every /api/portfolios call 500'd with
    -- 'relation "property_pathway_runs" does not exist'. Bootstrap it here
    -- too (matches shared/schema.ts propertyPathwayRuns) so the page
    -- self-heals like the rest of the app's ensure-table blocks.
    CREATE TABLE IF NOT EXISTS property_pathway_runs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id varchar,
      address text NOT NULL,
      postcode text,
      formatted_address text,
      uprn text,
      lat double precision,
      lng double precision,
      current_stage integer NOT NULL DEFAULT 1,
      stage_status jsonb NOT NULL DEFAULT '{}'::jsonb,
      stage_results jsonb NOT NULL DEFAULT '{}'::jsonb,
      sharepoint_folder_path text,
      sharepoint_folder_url text,
      model_run_id varchar,
      why_buy_document_url text,
      started_by varchar,
      started_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now(),
      completed_at timestamp
    );
    CREATE TABLE IF NOT EXISTS portfolios (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      notes text,
      created_by varchar,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS portfolio_runs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      portfolio_id varchar NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      run_id varchar NOT NULL REFERENCES property_pathway_runs(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      added_at timestamp DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_runs_unique ON portfolio_runs (portfolio_id, run_id);
  `);
  _ensured = true;
}

// ─── Per-run headline extraction ─────────────────────────────────────────
// Pulls the few numbers that matter for a portfolio "first look" out of the
// run's Stage 6 business plan (and Stage 1 tenancy where useful). Defensive
// — every field is optional because a run may be mid-pathway.
export interface RunHeadline {
  runId: string;
  address: string;
  postcode: string | null;
  currentStage: number;
  whyBuyUrl: string | null;
  strategy: string | null;
  targetPurchasePrice: number | null;
  targetNIY: number | null;          // decimal, e.g. 0.0525
  exitPrice: number | null;
  exitYield: number | null;
  targetIRR: number | null;          // decimal
  targetMOIC: number | null;
  holdPeriodYrs: number | null;
  rentPA: number | null;             // current passing rent, derived if absent
  keyRisks: string[];
}

function extractHeadline(run: typeof propertyPathwayRuns.$inferSelect): RunHeadline {
  const sr: any = run.stageResults || {};
  const plan: any = sr.stage6?.plan || sr.stage6 || {};
  const num = (v: any): number | null => (typeof v === "number" && isFinite(v) ? v : null);

  let rentPA = num(plan?.leasing?.currentRentPA) ?? null;
  // Derive from price × yield when the plan didn't carry an explicit rent.
  if (rentPA == null && num(plan?.targetPurchasePrice) != null && num(plan?.targetNIY) != null) {
    rentPA = Math.round(plan.targetPurchasePrice * plan.targetNIY);
  }

  return {
    runId: run.id,
    address: run.address,
    postcode: run.postcode,
    currentStage: run.currentStage,
    whyBuyUrl: run.whyBuyDocumentUrl || null,
    strategy: typeof plan?.strategy === "string" ? plan.strategy : null,
    targetPurchasePrice: num(plan?.targetPurchasePrice),
    targetNIY: num(plan?.targetNIY),
    exitPrice: num(plan?.exitPrice),
    exitYield: num(plan?.exitYield),
    targetIRR: num(plan?.targetIRR),
    targetMOIC: num(plan?.targetMOIC),
    holdPeriodYrs: num(plan?.holdPeriodYrs),
    rentPA,
    keyRisks: Array.isArray(plan?.risks) ? plan.risks.slice(0, 3) : [],
  };
}

// ─── Aggregate the enabled runs into portfolio totals ────────────────────
function aggregate(headlines: RunHeadline[]) {
  const sum = (pick: (h: RunHeadline) => number | null) =>
    headlines.reduce((acc, h) => acc + (pick(h) ?? 0), 0);

  const totalPrice = sum(h => h.targetPurchasePrice);
  const totalRent = sum(h => h.rentPA);
  const totalExit = sum(h => h.exitPrice);
  // Blended NIY = total rent / total price (not a naive average of yields,
  // which would over-weight small lots).
  const blendedNIY = totalPrice > 0 ? totalRent / totalPrice : null;
  const blendedExitYield = totalExit > 0 ? sum(h => (h.exitPrice ?? 0) * (h.exitYield ?? 0)) / totalExit : null;

  return {
    assetCount: headlines.length,
    totalPurchasePrice: totalPrice || null,
    totalRentPA: totalRent || null,
    totalExitPrice: totalExit || null,
    blendedNIY,
    blendedExitYield,
  };
}

export async function getPortfolioWithRuns(portfolioId: string) {
  await ensureTables();
  const [pf] = await db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).limit(1);
  if (!pf) return null;

  const links = await db
    .select()
    .from(portfolioRuns)
    .where(eq(portfolioRuns.portfolioId, portfolioId))
    .orderBy(portfolioRuns.sortOrder, portfolioRuns.addedAt);

  const runIds = links.map(l => l.runId);
  const runs = runIds.length
    ? await db.select().from(propertyPathwayRuns).where(inArray(propertyPathwayRuns.id, runIds))
    : [];
  const runById = new Map(runs.map(r => [r.id, r]));

  const items = links
    .map(l => {
      const run = runById.get(l.runId);
      if (!run) return null;
      return { ...extractHeadline(run), enabled: l.enabled, linkId: l.id };
    })
    .filter(Boolean) as (RunHeadline & { enabled: boolean; linkId: string })[];

  const enabled = items.filter(i => i.enabled);
  return { portfolio: pf, items, totals: aggregate(enabled) };
}

export function registerPortfolioRoutes(app: Express) {
  // List all portfolios with a count of linked runs.
  app.get("/api/portfolios", requireAuth, async (_req: Request, res: Response) => {
    try {
      await ensureTables();
      const rows = await db.select().from(portfolios).orderBy(desc(portfolios.updatedAt));
      const counts = await pool.query<{ portfolio_id: string; n: string }>(
        `SELECT portfolio_id, COUNT(*)::text AS n FROM portfolio_runs GROUP BY portfolio_id`,
      );
      const countById = new Map(counts.rows.map(r => [r.portfolio_id, Number(r.n)]));
      res.json(rows.map(p => ({ ...p, runCount: countById.get(p.id) || 0 })));
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Create a portfolio. Optionally seed it with runIds in one shot.
  app.post("/api/portfolios", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      const { name, notes, runIds } = req.body || {};
      if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
      const userId = (req.session as any)?.userId || (req as any).tokenUserId || null;
      const [created] = await db.insert(portfolios).values({ name, notes: notes || null, createdBy: userId }).returning();
      if (Array.isArray(runIds) && runIds.length) {
        await db.insert(portfolioRuns).values(
          runIds.map((rid: string, i: number) => ({ portfolioId: created.id, runId: String(rid), sortOrder: i })),
        ).onConflictDoNothing();
      }
      res.json({ ok: true, portfolio: created });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Full portfolio detail — runs + headlines + totals.
  app.get("/api/portfolios/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await getPortfolioWithRuns(String(req.params.id));
      if (!data) return res.status(404).json({ error: "Portfolio not found" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Rename / re-note.
  app.patch("/api/portfolios/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      const { name, notes } = req.body || {};
      const set: any = { updatedAt: new Date() };
      if (typeof name === "string") set.name = name;
      if (typeof notes === "string") set.notes = notes;
      await db.update(portfolios).set(set).where(eq(portfolios.id, String(req.params.id)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.delete("/api/portfolios/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      await db.delete(portfolios).where(eq(portfolios.id, String(req.params.id)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Add a run to the portfolio.
  app.post("/api/portfolios/:id/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      const portfolioId = String(req.params.id);
      const runId = String(req.body?.runId || "");
      if (!runId) return res.status(400).json({ error: "runId required" });
      const existingCount = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM portfolio_runs WHERE portfolio_id = $1`, [portfolioId],
      );
      await db.insert(portfolioRuns)
        .values({ portfolioId, runId, sortOrder: Number(existingCount.rows[0]?.n || 0) })
        .onConflictDoNothing();
      await db.update(portfolios).set({ updatedAt: new Date() }).where(eq(portfolios.id, portfolioId));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Toggle a run in/out of the combined outputs (the on/off switch).
  app.patch("/api/portfolios/:id/runs/:runId", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      const enabled = !!req.body?.enabled;
      await db.update(portfolioRuns)
        .set({ enabled })
        .where(and(eq(portfolioRuns.portfolioId, String(req.params.id)), eq(portfolioRuns.runId, String(req.params.runId))));
      res.json({ ok: true, enabled });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Serve a generated portfolio output (Excel / PDF) from file_storage.
  app.get("/api/portfolios/files/:filename", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getFile } = await import("./file-storage");
      // Outputs are always stored under this prefix; take only the
      // basename from the request so a slash can't escape the prefix.
      const filename = String(req.params.filename).replace(/[^a-z0-9._-]/gi, "");
      const file = await getFile(`portfolio-outputs/${filename}`);
      if (!file) return res.status(404).json({ error: "File not found" });
      res.setHeader("Content-Type", file.contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${file.originalName || "portfolio"}"`);
      res.send(file.data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Combined document generators (Excel + Why Buy). These merge each
  // enabled run's existing per-property artifact into one portfolio file.
  // Implemented in portfolio-outputs.ts (next build) — for now they
  // return a clear in-progress response (200, not 404) so the buttons
  // give useful feedback rather than erroring. The summary-table view
  // above is fully live.
  app.post("/api/portfolios/:id/generate/:kind", requireAuth, async (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      const data = await getPortfolioWithRuns(String(req.params.id));
      if (!data) return res.status(404).json({ error: "Portfolio not found" });
      const enabled = data.items.filter(i => i.enabled);
      if (enabled.length === 0) return res.status(400).json({ error: "No assets enabled in this portfolio" });

      const mod = await import("./portfolio-outputs");
      if (kind === "excel") return res.json(await mod.generatePortfolioExcel(String(req.params.id)));
      if (kind === "why-buy") return res.json(await mod.generatePortfolioWhyBuy(String(req.params.id)));
      return res.status(400).json({ error: `Unknown output kind: ${kind}` });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Remove a run from the portfolio entirely.
  app.delete("/api/portfolios/:id/runs/:runId", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      await db.delete(portfolioRuns)
        .where(and(eq(portfolioRuns.portfolioId, String(req.params.id)), eq(portfolioRuns.runId, String(req.params.runId))));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });
}
