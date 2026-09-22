// Historical invoiced WIP (Sage era) — read-only billings history for the
// Finance page, seeded from Woody's Historical_Invoiced_WIP__BGP.xlsx
// (2026-08-27). FY2019–FY2026, fiscal year May–April, amounts net of VAT,
// credit notes negative. The dataset is static (Sage is retired; Xero owns
// everything after Apr 2026), so it's served straight from the JSON asset —
// no table, no migration.
//
// Dimensions: team (BGP team), agent (fee earner initials), client (the Sage
// Group column — the landlord client, e.g. Land Sec), company (the Tenant
// column — the occupier brand the deal was done with).
import fs from "fs";
import type { Express, Request, Response } from "express";
import { requireEquityOrAdmin } from "./auth";

interface HistRow { fy: number; fm: number; amt: number; team: string; agent: string; client: string; company: string }
type DimKey = "team" | "agent" | "client" | "company";

let _payload: any | null = null;

function loadRows(): { rows: HistRow[]; source: string; note: string } | null {
  for (const p of [`${process.cwd()}/dist/server/assets/historical-invoiced-wip.json`, `${process.cwd()}/server/assets/historical-invoiced-wip.json`]) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e: any) {
      console.warn("[historical-wip] failed reading", p, e?.message);
    }
  }
  return null;
}

// Pre-aggregate once: FY totals, monthly totals per FY, and per-dimension
// per-FY sums — the client only pivots and sorts.
function buildPayload(): any | null {
  if (_payload) return _payload;
  const data = loadRows();
  if (!data) return null;
  const fySet = new Set<number>();
  const fyTotals: Record<number, number> = {};
  const monthly: Record<number, number[]> = {};
  const dims: Record<DimKey, Map<string, Record<number, number>>> = {
    team: new Map(), agent: new Map(), client: new Map(), company: new Map(),
  };
  for (const r of data.rows) {
    fySet.add(r.fy);
    fyTotals[r.fy] = (fyTotals[r.fy] || 0) + r.amt;
    (monthly[r.fy] ||= Array(12).fill(0))[r.fm - 1] += r.amt;
    for (const key of ["team", "agent", "client", "company"] as DimKey[]) {
      const name = r[key];
      const totals = dims[key].get(name) || {};
      totals[r.fy] = (totals[r.fy] || 0) + r.amt;
      dims[key].set(name, totals);
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const fys = [...fySet].sort((a, b) => a - b);
  const out: any = {
    source: data.source, note: data.note, fys,
    fyTotals: Object.fromEntries(Object.entries(fyTotals).map(([k, v]) => [k, round(v)])),
    monthly: Object.fromEntries(Object.entries(monthly).map(([k, v]) => [k, v.map(round)])),
    dims: {} as Record<DimKey, Array<{ name: string; totals: Record<number, number> }>>,
  };
  for (const key of Object.keys(dims) as DimKey[]) {
    out.dims[key] = [...dims[key].entries()]
      .map(([name, totals]) => ({ name, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])) }))
      .sort((a, b) => (b.totals[fys[fys.length - 1]] || 0) - (a.totals[fys[fys.length - 1]] || 0));
  }
  _payload = out;
  return out;
}

export function registerHistoricalWipRoutes(app: Express) {
  app.get("/api/historical-wip", requireEquityOrAdmin, (_req: Request, res: Response) => {
    const payload = buildPayload();
    if (!payload) return res.status(503).json({ error: "Historical WIP dataset not found on this deployment" });
    res.json(payload);
  });
}
