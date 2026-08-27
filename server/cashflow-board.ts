// Finance → Cashflow board (Woody, 2026-08-27: "Bgppay" workbook drop).
// Monthly Budget vs Actual cashflow: receipts and payment lines are stored
// per month/basis; Total Receipts, Total Payments, the opening-balance
// chain, closing balances and the all-accounts total are COMPUTED on read,
// never stored — edit a cell and everything downstream moves. The
// opening-balance chain runs separately per basis from the OPEN line's
// first-month value. Seeded once from the 2026/27 forecast workbook
// (server/cashflow-seed.ts); after that the board's own data is the truth.
// Gate matches the rest of Finance: equity directors + admins.

import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireEquityOrAdmin } from "./auth";
import { CASHFLOW_SEED } from "./cashflow-seed";

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
  app.get("/api/cashflow", requireEquityOrAdmin, async (_req: Request, res: Response) => {
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
      res.json({ lines, cells, months: [...monthSet].sort() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.patch("/api/cashflow/cell", requireEquityOrAdmin, async (req: Request, res: Response) => {
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

  app.post("/api/cashflow/line", requireEquityOrAdmin, async (req: Request, res: Response) => {
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

  app.delete("/api/cashflow/line/:id", requireEquityOrAdmin, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      await pool.query(`UPDATE cashflow_lines SET is_active = false WHERE id = $1 AND key NOT IN ('OPEN','RESERVE')`, [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });
}
