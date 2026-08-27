// Finance → Cashflow board (Woody, 2026-08-27: "Bgppay" workbook drop).
// Monthly Budget vs Actual cashflow: receipts and payment lines are stored
// per month/basis; Total Receipts, Total Payments, the opening-balance
// chain, closing balances and the all-accounts total are COMPUTED on read,
// never stored — edit a cell and everything downstream moves. The
// opening-balance chain runs separately per basis from the OPEN line's
// first-month value. Seeded once from the 2026/27 forecast workbook
// (server/cashflow-seed.ts); after that the board's own data is the truth.
// Gate matches the rest of Finance: equity directors + admins.

import type { Express, NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { pool } from "./db";
import { requireEquityOrAdmin } from "./auth";
import { CASHFLOW_SEED } from "./cashflow-seed";
import { withSystemXero } from "./xero-system-session";
import { buildFinancials } from "./xero-financials";

// Second lock on top of the equity gate — the source workbook was itself
// password-protected, so the board keeps that behaviour (Woody, 2026-08-27:
// "Password"). Default matches the workbook; override with the
// CASHFLOW_PASSWORD env var on Railway.
function cashflowPassword(): string {
  return process.env.CASHFLOW_PASSWORD || "BGPPAY";
}
function keyMatches(supplied: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(cashflowPassword());
  return a.length === b.length && timingSafeEqual(a, b);
}
function requireCashflowKey(req: Request, res: Response, next: NextFunction) {
  const key = String(req.headers["x-cashflow-key"] || "");
  if (!keyMatches(key)) return res.status(401).json({ error: "password_required" });
  next();
}

// Light Xero snapshot for the cross-reference strip — cash at bank and the
// FY's monthly income/expenses, from the same builder as /api/xero/financials.
let xeroSnapCache: { at: number; data: any | null } | null = null;
async function xeroSnapshot(): Promise<any | null> {
  if (xeroSnapCache && Date.now() - xeroSnapCache.at < 15 * 60 * 1000) return xeroSnapCache.data;
  let data: any | null = null;
  try {
    const fin = await withSystemXero((session) => buildFinancials(session));
    if (fin && !fin.notConnected) {
      data = {
        asAt: fin.asAt,
        orgName: fin.orgName,
        cashTotal: fin.cashTotal ?? null,
        bankAccounts: fin.bankAccounts || [],
        monthly: fin.monthly || [],
        arByMonth: fin.arByMonth || {},
        apByMonth: fin.apByMonth || {},
        recurringBills: fin.recurring?.monthlyBills ?? null,
        costRunRate: fin.costs?.runRate ?? null,
      };
    }
  } catch (e: any) {
    console.warn("[cashflow] Xero snapshot failed:", e?.message);
  }
  xeroSnapCache = { at: Date.now(), data };
  return data;
}

// App-linked projection (Woody, 2026-08-27: "link the forecasting to the
// app — deals, invoices, costs"). Deal fees come from the CRM book with the
// same stage weights as the WIP forecast, bucketed by the deal's expected
// month (completed → exchanged → target date); COM deals that still have no
// Xero invoice count at full weight. Everything is read-only reference —
// the board's typed budget stays the plan of record.
const PROJ_WEIGHTS: Record<string, number> = { NEG: 0.5, SOL: 0.75, EXC: 0.9, COM: 1 };
async function buildDealProjection(): Promise<{ byMonth: Record<string, { weighted: number; count: number }>; undated: { weighted: number; count: number } }> {
  const { legacyToCode } = await import("../shared/deal-status");
  const { rows } = await pool.query(`
    SELECT d.status, d.fee::float AS fee,
           COALESCE(d.completed_at, d.exchanged_at, d.target_date) AS dt,
           inv.invoice_count AS ic
      FROM crm_deals d
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS invoice_count
          FROM xero_invoices xi
         WHERE xi.deal_id = d.id AND COALESCE(xi.status, '') <> 'ERROR'
      ) inv ON TRUE
     WHERE d.fee IS NOT NULL AND d.fee > 0
  `);
  const byMonth: Record<string, { weighted: number; count: number }> = {};
  const undated = { weighted: 0, count: 0 };
  const thisMonth = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
  for (const d of rows) {
    const code = legacyToCode(d.status);
    if (!code || !(code in PROJ_WEIGHTS)) continue;
    if (code === "COM" && d.ic > 0) continue; // invoiced — already in Xero AR/actuals
    const weighted = (Number(d.fee) || 0) * PROJ_WEIGHTS[code];
    if (!d.dt) { undated.weighted += weighted; undated.count++; continue; }
    const dt = new Date(d.dt);
    let key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    if (key < thisMonth) key = thisMonth; // slipped deals land in the current month
    (byMonth[key] ||= { weighted: 0, count: 0 }).weighted += weighted;
    byMonth[key].count++;
  }
  for (const k of Object.keys(byMonth)) byMonth[k].weighted = Math.round(byMonth[k].weighted);
  undated.weighted = Math.round(undated.weighted);
  return { byMonth, undated };
}

let ensured: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ensured) ensured = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cashflow_lines (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        key TEXT NOT NULL,
        label TEXT NOT NULL,
        section TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT now()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cashflow_cells (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        line_id VARCHAR NOT NULL REFERENCES cashflow_lines(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        basis TEXT NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        updated_at TIMESTAMP DEFAULT now(),
        UNIQUE (line_id, month, basis)
      )`);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM cashflow_lines`);
    if (rows[0].n === 0) {
      const idByKey = new Map<string, string>();
      for (const l of CASHFLOW_SEED.lines) {
        const r = await pool.query(
          `INSERT INTO cashflow_lines (key, label, section, sort) VALUES ($1,$2,$3,$4) RETURNING id`,
          [l.key, l.label, l.section, l.sort],
        );
        idByKey.set(l.key, r.rows[0].id);
      }
      for (const c of CASHFLOW_SEED.cells) {
        const lineId = idByKey.get(c.lineKey);
        if (!lineId) continue;
        await pool.query(
          `INSERT INTO cashflow_cells (line_id, month, basis, amount) VALUES ($1,$2,$3,$4)
           ON CONFLICT (line_id, month, basis) DO NOTHING`,
          [lineId, c.month, c.basis, c.amount],
        );
      }
      console.log(`[cashflow] Seeded ${CASHFLOW_SEED.lines.length} lines / ${CASHFLOW_SEED.cells.length} cells from the 2026/27 forecast workbook`);
    }
  })().catch((e) => { ensured = null; throw e; });
  return ensured;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function registerCashflowRoutes(app: Express): void {
  app.post("/api/cashflow/unlock", requireEquityOrAdmin, async (req: Request, res: Response) => {
    const supplied = String(req.body?.password || "");
    if (!keyMatches(supplied)) return res.status(401).json({ error: "wrong_password" });
    res.json({ ok: true });
  });

  app.get("/api/cashflow", requireEquityOrAdmin, requireCashflowKey, async (_req: Request, res: Response) => {
    try {
      await ensureTables();
      const lines = (await pool.query(
        `SELECT id, key, label, section, sort FROM cashflow_lines WHERE is_active ORDER BY sort, key`,
      )).rows;
      const cells = (await pool.query(
        `SELECT line_id, month, basis, amount::float8 AS amount FROM cashflow_cells`,
      )).rows;
      const monthSet = new Set<string>(CASHFLOW_SEED.months);
      for (const c of cells) monthSet.add(c.month);
      const xero = await xeroSnapshot();
      const deals = await buildDealProjection().catch((e) => {
        console.warn("[cashflow] deal projection failed:", e?.message);
        return null;
      });
      res.json({ lines, cells, months: [...monthSet].sort(), xero, deals });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.patch("/api/cashflow/cell", requireEquityOrAdmin, requireCashflowKey, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      const { lineId, month, basis, amount } = req.body || {};
      if (!lineId || !MONTH_RE.test(String(month)) || !["budget", "actual"].includes(basis)) {
        return res.status(400).json({ error: "lineId, month (YYYY-MM) and basis (budget|actual) required" });
      }
      if (amount === null || amount === "" || amount === undefined) {
        await pool.query(`DELETE FROM cashflow_cells WHERE line_id = $1 AND month = $2 AND basis = $3`, [lineId, month, basis]);
        return res.json({ ok: true, cleared: true });
      }
      const n = Number(amount);
      if (!Number.isFinite(n)) return res.status(400).json({ error: "amount must be a number" });
      await pool.query(
        `INSERT INTO cashflow_cells (line_id, month, basis, amount) VALUES ($1,$2,$3,$4)
         ON CONFLICT (line_id, month, basis) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()`,
        [lineId, month, basis, n],
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.post("/api/cashflow/line", requireEquityOrAdmin, requireCashflowKey, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      const { label, section } = req.body || {};
      if (!label || !["receipts", "payments"].includes(section)) {
        return res.status(400).json({ error: "label and section (receipts|payments) required" });
      }
      const { rows: mx } = await pool.query(
        `SELECT COALESCE(MAX(sort), 0) + 10 AS sort, COUNT(*)::int + 1 AS n FROM cashflow_lines WHERE section = $1`,
        [section],
      );
      const r = await pool.query(
        `INSERT INTO cashflow_lines (key, label, section, sort) VALUES ($1,$2,$3,$4) RETURNING id, key, label, section, sort`,
        [`${section === "receipts" ? "R" : "P"}${mx[0].n}`, String(label).trim(), section, mx[0].sort],
      );
      res.json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.delete("/api/cashflow/line/:id", requireEquityOrAdmin, requireCashflowKey, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      await pool.query(`UPDATE cashflow_lines SET is_active = false WHERE id = $1 AND key NOT IN ('OPEN','RESERVE')`, [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });
}
