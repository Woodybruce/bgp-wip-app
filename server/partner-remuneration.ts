// Equity partners remuneration board (Finance page) — Woody, 2026-08-28,
// from his Woody_.xlsx: per-director Gross Salary / Bonus / Cash Advances /
// Total for each fiscal year (May–April), plus a forward view where the
// year's projected profit (from the Finance cashflow forecast) is split
// EQUALLY between the four equity partners.
//
// Raw-SQL table (file_storage / cashflow_lines precedent — deliberately not
// in shared/schema.ts). FY2025 + FY2026 seeded from the workbook; FY2027
// starts at the £145k salaries ("Salaries £145k from 1st April 2026" note)
// with bonus/advances typed in as they're drawn.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireEquityOrAdmin } from "./auth";

export const EQUITY_PARTNERS = ["Woody", "Rupert", "Charlotte", "Jack"] as const;

// Woody_.xlsx (2026-08-28). FY keyed by end year: FY2025 = May 24–Apr 25.
const SEED: Array<{ fy: number; partner: string; salary: number; bonus: number; advances: number }> = [
  { fy: 2025, partner: "Woody", salary: 130000, bonus: 0, advances: 113712.71 },
  { fy: 2025, partner: "Rupert", salary: 130000, bonus: 69565.22, advances: 75434.78 },
  { fy: 2025, partner: "Charlotte", salary: 130000, bonus: 88781.29, advances: 10869.57 },
  { fy: 2025, partner: "Jack", salary: 130000, bonus: 50000, advances: 0 },
  { fy: 2026, partner: "Woody", salary: 131250, bonus: 0, advances: 153000 },
  { fy: 2026, partner: "Rupert", salary: 131250, bonus: 106434.78, advances: 46565.22 },
  { fy: 2026, partner: "Charlotte", salary: 131250, bonus: 136369.57, advances: 16630.43 },
  { fy: 2026, partner: "Jack", salary: 131250, bonus: 131467.99, advances: 0 },
  { fy: 2027, partner: "Woody", salary: 145000, bonus: 0, advances: 0 },
  { fy: 2027, partner: "Rupert", salary: 145000, bonus: 0, advances: 0 },
  { fy: 2027, partner: "Charlotte", salary: 145000, bonus: 0, advances: 0 },
  { fy: 2027, partner: "Jack", salary: 145000, bonus: 0, advances: 0 },
];

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (ensured) return ensured;
  ensured = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_remuneration (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        fy INTEGER NOT NULL,
        partner TEXT NOT NULL,
        salary NUMERIC(12,2) NOT NULL DEFAULT 0,
        bonus NUMERIC(12,2) NOT NULL DEFAULT 0,
        advances NUMERIC(12,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT now(),
        UNIQUE (fy, partner)
      )`);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM partner_remuneration`);
    if (rows[0].n === 0) {
      for (const s of SEED) {
        await pool.query(
          `INSERT INTO partner_remuneration (fy, partner, salary, bonus, advances)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fy, partner) DO NOTHING`,
          [s.fy, s.partner, s.salary, s.bonus, s.advances],
        );
      }
      console.log(`[remuneration] Seeded ${SEED.length} partner-year rows from Woody_.xlsx`);
    }
  })().catch((e) => { ensured = null; throw e; });
  return ensured;
}

export function registerPartnerRemunerationRoutes(app: Express) {
  app.get("/api/partner-remuneration", requireEquityOrAdmin, async (_req: Request, res: Response) => {
    try {
      await ensureTable();
      const { rows } = await pool.query(
        `SELECT fy, partner, salary::float8 AS salary, bonus::float8 AS bonus, advances::float8 AS advances
           FROM partner_remuneration ORDER BY fy, partner`,
      );
      res.json({ rows, partners: EQUITY_PARTNERS });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load remuneration" });
    }
  });

  app.patch("/api/partner-remuneration/cell", requireEquityOrAdmin, async (req: Request, res: Response) => {
    try {
      await ensureTable();
      const fy = Number(req.body?.fy);
      const partner = String(req.body?.partner || "");
      const field = String(req.body?.field || "");
      const value = Number(req.body?.value);
      if (!Number.isInteger(fy) || fy < 2020 || fy > 2040) return res.status(400).json({ error: "bad fy" });
      if (!(EQUITY_PARTNERS as readonly string[]).includes(partner)) return res.status(400).json({ error: "unknown partner" });
      if (!["salary", "bonus", "advances"].includes(field)) return res.status(400).json({ error: "bad field" });
      if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: "bad value" });
      await pool.query(
        `INSERT INTO partner_remuneration (fy, partner, ${field}) VALUES ($1,$2,$3)
         ON CONFLICT (fy, partner) DO UPDATE SET ${field} = $3, updated_at = now()`,
        [fy, partner, value],
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to save" });
    }
  });
}
