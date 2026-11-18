// Finance → Fees & pipeline (Woody, 2026-11-17: "fold reporting and board
// report in to finance ... make it sync and to the point ... it defo double
// counts"). The money views that were on Reporting and Board Report, built
// once and the same way as the rest of Finance:
//   - The deal book: every live deal with a fee, by the one pipeline rule
//     (shared/finance-pipeline.ts: Negotiating and HOTs 50%, Solicitors
//     onwards 100%, a completed deal until its Xero invoice), by stage, team
//     (a deal on two teams counts half to each) and deal type, and the
//     largest deals. Withdrawn, archived and invoiced deals are never in it.
//   - Invoiced: Xero sales invoices dated in the financial year (1 May to 30
//     April), ex VAT. Deals never add to it, so nothing is counted twice.
//   - Fees by agent: what was invoiced this year and the weighted book, each
//     shared by the deal's fee split; BGP House's slice is shown on its own
//     line, never as an agent.
// Equity directors and admins only, like the rest of Finance. The cash flow
// projection reads its deals through loadBookDeals here, so the two books
// are one book.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireEquityOrAdmin } from "./auth";
import {
  PIPELINE_STAGES, PIPELINE_STAGE_LABELS, PIPELINE_RULE_TEXT, pipelineStage, pipelineWeighted, pipelineWeightPct,
  teamShares, financialYearStart, type PipelineStage,
} from "../shared/finance-pipeline";
import { legacyToCode, DEAL_STATUS_LABELS } from "../shared/deal-status";

export interface BookDeal {
  id: string;
  name: string;
  status: string | null;
  fee: number;
  dealType: string | null;
  team: string[] | null;
  // Expected date: completed, else exchanged, else target.
  dt: Date | null;
  invoiceCount: number;
}

// Every deal with a fee, with its count of Xero invoices (failed ones left
// out). The one query behind the cash flow projection and this board.
export async function loadBookDeals(): Promise<BookDeal[]> {
  const { rows } = await pool.query(`
    SELECT d.id, d.name, d.status, d.fee::float AS fee, d.deal_type AS "dealType", d.team,
           COALESCE(d.completed_at, d.exchanged_at, d.target_date) AS dt,
           inv.invoice_count AS "invoiceCount"
      FROM crm_deals d
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS invoice_count
          FROM xero_invoices xi
         WHERE xi.deal_id = d.id AND COALESCE(xi.status, '') <> 'ERROR'
      ) inv ON TRUE
     WHERE d.fee IS NOT NULL AND d.fee > 0
  `);
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name || "Unnamed deal",
    status: r.status,
    fee: Number(r.fee) || 0,
    dealType: r.dealType || null,
    team: Array.isArray(r.team) ? r.team : r.team ? [r.team] : null,
    dt: r.dt ? new Date(r.dt) : null,
    invoiceCount: Number(r.invoiceCount) || 0,
  }));
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// When a book deal is expected to land, as the cash flow projection reads
// it: no date = Unscheduled / TBC; a date already passed lands in the current
// month; after the year end = next year.
export function whenExpected(dt: Date | null, today: Date = new Date()): "this_year" | "no_date" | "after_year_end" {
  if (!dt || isNaN(dt.getTime())) return "no_date";
  const fyStart = financialYearStart(today);
  const lastMonth = monthKey(new Date(Date.UTC(fyStart.getUTCFullYear() + 1, 3, 1)));
  const key = monthKey(dt) < monthKey(today) ? monthKey(today) : monthKey(dt);
  return key > lastMonth ? "after_year_end" : "this_year";
}

interface Allocation { dealId: string; agentKey: string; agent: string; weight: number; house: boolean }

// Each deal's fee split as shares of the whole split (BGP House included,
// so its slice is set aside rather than handed to the agents). A deal with
// no split rows has no shares: its money is "no fee split".
function sharesByDeal(allocs: Allocation[]): Map<string, Array<{ agentKey: string; agent: string; share: number; house: boolean }>> {
  const byDeal = new Map<string, Allocation[]>();
  for (const a of allocs) (byDeal.get(a.dealId) || byDeal.set(a.dealId, []).get(a.dealId)!).push(a);
  const out = new Map<string, Array<{ agentKey: string; agent: string; share: number; house: boolean }>>();
  for (const [dealId, rows] of byDeal) {
    const total = rows.reduce((s, r) => s + Math.max(0, r.weight), 0);
    if (total <= 0) continue;
    out.set(dealId, rows.filter(r => r.weight > 0).map(r => ({ agentKey: r.agentKey, agent: r.agent, share: r.weight / total, house: r.house })));
  }
  return out;
}

async function loadAllocations(feeByDeal: Map<string, number>): Promise<Allocation[]> {
  const { rows } = await pool.query(`
    SELECT dfa.deal_id AS "dealId", dfa.agent_user_id AS "agentUserId", dfa.agent_name AS "agentName",
           dfa.percentage::float AS percentage, dfa.fixed_amount::float AS "fixedAmount",
           COALESCE(dfa.is_bgp_house, false) AS house, u.name AS "userName"
      FROM deal_fee_allocations dfa
      LEFT JOIN users u ON u.id = dfa.agent_user_id
  `);
  return rows.map((r: any) => {
    const name = String(r.userName || r.agentName || "").trim();
    const house = !!r.house || /\bbgp house\b/i.test(String(r.agentName || ""));
    const fee = feeByDeal.get(r.dealId) || 0;
    const weight = r.fixedAmount != null && Number(r.fixedAmount) !== 0
      ? Number(r.fixedAmount)
      : fee * (Number(r.percentage) || 0) / 100;
    return {
      dealId: r.dealId,
      agentKey: r.agentUserId ? `u:${r.agentUserId}` : `n:${name.toLowerCase()}`,
      agent: name || "Unnamed agent",
      weight,
      house,
    };
  });
}

export interface FinanceBoard {
  fyStart: string;
  fyLabel: string;
  generatedAt: string;
  rule: string;
  book: {
    fee: number;
    weighted: number;
    count: number;
    // Where the weighted book lands: this year by month, no date, after 30 April.
    thisYear: number;
    noDate: { weighted: number; count: number };
    afterYearEnd: { weighted: number; count: number };
    byStage: Array<{ code: PipelineStage; label: string; weightPct: number; fee: number; weighted: number; count: number;
      deals: Array<{ id: string; name: string; fee: number; weighted: number }> }>;
    byTeam: Array<{ name: string; fee: number; weighted: number; deals: number }>;
    byType: Array<{ name: string; fee: number; weighted: number; deals: number }>;
    top: Array<{ id: string; name: string; stage: PipelineStage; stageLabel: string; fee: number; weighted: number; team: string; dealType: string; expected: string | null }>;
  };
  // Null when Xero cannot be read.
  invoiced: null | {
    total: number;
    count: number;
    byMonth: Array<{ month: string; total: number }>;
    house: number;
    notLinked: { total: number; count: number };
    noSplit: { total: number; count: number };
  };
  agents: Array<{ agent: string; invoiced: number; book: number }>;
  // For the Excel: every book deal.
  deals: Array<{ id: string; name: string; stage: PipelineStage; stageLabel: string; status: string; fee: number; weightPct: number; weighted: number; team: string; dealType: string; expected: string | null; when: string }>;
}

const round = (n: number) => Math.round(n);

export async function buildFinanceBoard(today: Date = new Date()): Promise<FinanceBoard> {
  const fyStart = financialYearStart(today);
  const deals = await loadBookDeals();
  const feeByDeal = new Map(deals.map(d => [d.id, d.fee]));
  const shares = sharesByDeal(await loadAllocations(feeByDeal));

  const stageAcc = new Map<PipelineStage, { fee: number; weighted: number; count: number; deals: Array<{ id: string; name: string; fee: number; weighted: number }> }>();
  const teamAcc = new Map<string, { fee: number; weighted: number; deals: number }>();
  const typeAcc = new Map<string, { fee: number; weighted: number; deals: number }>();
  const agentAcc = new Map<string, { agent: string; invoiced: number; book: number }>();
  const bookDeals: FinanceBoard["deals"] = [];
  let fee = 0, weighted = 0, thisYear = 0;
  const noDate = { weighted: 0, count: 0 };
  const afterYearEnd = { weighted: 0, count: 0 };

  for (const d of deals) {
    const stage = pipelineStage({ status: d.status, fee: d.fee, dealType: d.dealType, team: d.team, invoiceCount: d.invoiceCount });
    if (!stage) continue;
    const w = pipelineWeighted(d.fee, stage);
    fee += d.fee;
    weighted += w;
    const when = whenExpected(d.dt, today);
    if (when === "no_date") { noDate.weighted += w; noDate.count++; }
    else if (when === "after_year_end") { afterYearEnd.weighted += w; afterYearEnd.count++; }
    else thisYear += w;

    const s = stageAcc.get(stage) || { fee: 0, weighted: 0, count: 0, deals: [] };
    s.fee += d.fee; s.weighted += w; s.count++;
    s.deals.push({ id: d.id, name: d.name, fee: round(d.fee), weighted: round(w) });
    stageAcc.set(stage, s);

    for (const { team, share } of teamShares(d.team)) {
      const t = teamAcc.get(team) || { fee: 0, weighted: 0, deals: 0 };
      t.fee += d.fee * share; t.weighted += w * share; t.deals++;
      teamAcc.set(team, t);
    }
    const typeName = d.dealType || "No deal type";
    const ty = typeAcc.get(typeName) || { fee: 0, weighted: 0, deals: 0 };
    ty.fee += d.fee; ty.weighted += w; ty.deals++;
    typeAcc.set(typeName, ty);

    for (const sh of shares.get(d.id) || []) {
      if (sh.house) continue;
      const a = agentAcc.get(sh.agentKey) || { agent: sh.agent, invoiced: 0, book: 0 };
      a.book += w * sh.share;
      agentAcc.set(sh.agentKey, a);
    }

    const code = legacyToCode(d.status);
    bookDeals.push({
      id: d.id, name: d.name, stage, stageLabel: PIPELINE_STAGE_LABELS[stage],
      status: code ? DEAL_STATUS_LABELS[code] : String(d.status || ""),
      fee: round(d.fee), weightPct: pipelineWeightPct(stage), weighted: round(w),
      team: (d.team || []).join(", "), dealType: d.dealType || "",
      expected: d.dt && !isNaN(d.dt.getTime()) ? d.dt.toISOString().slice(0, 10) : null,
      when: when === "no_date" ? "No date" : when === "after_year_end" ? "After 30 April" : "This year",
    });
  }
  bookDeals.sort((a, b) => b.weighted - a.weighted || b.fee - a.fee);

  // Invoiced this year — Xero's own invoices, linked to deals where the app
  // raised them. A Xero failure leaves the invoiced half out, never the book.
  let invoiced: FinanceBoard["invoiced"] = null;
  try {
    const { buildFinancialsShared } = await import("./xero-financials");
    const fin = await buildFinancialsShared();
    const list: Array<{ xeroInvoiceId: string; date: string; subTotal: number }> | undefined = fin?.fyInvoices;
    if (Array.isArray(list)) {
      const ids = list.map(i => i.xeroInvoiceId).filter(Boolean);
      const linkRows = ids.length
        ? (await pool.query(`SELECT xero_invoice_id AS "xeroInvoiceId", deal_id AS "dealId" FROM xero_invoices WHERE xero_invoice_id = ANY($1)`, [ids])).rows
        : [];
      const dealByInvoice = new Map<string, string>(linkRows.map((r: any) => [r.xeroInvoiceId, r.dealId]));
      const byMonth = new Map<string, number>();
      const notLinked = { total: 0, count: 0 };
      const noSplit = { total: 0, count: 0 };
      let total = 0, house = 0;
      for (const inv of list) {
        const amount = Number(inv.subTotal) || 0;
        total += amount;
        const m = String(inv.date || "").slice(0, 7);
        if (m) byMonth.set(m, (byMonth.get(m) || 0) + amount);
        const dealId = dealByInvoice.get(inv.xeroInvoiceId);
        if (!dealId) { notLinked.total += amount; notLinked.count++; continue; }
        const dealShares = shares.get(dealId);
        if (!dealShares?.length) { noSplit.total += amount; noSplit.count++; continue; }
        for (const sh of dealShares) {
          if (sh.house) { house += amount * sh.share; continue; }
          const a = agentAcc.get(sh.agentKey) || { agent: sh.agent, invoiced: 0, book: 0 };
          a.invoiced += amount * sh.share;
          agentAcc.set(sh.agentKey, a);
        }
      }
      invoiced = {
        total: round(total),
        count: list.length,
        byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, t]) => ({ month, total: round(t) })),
        house: round(house),
        notLinked: { total: round(notLinked.total), count: notLinked.count },
        noSplit: { total: round(noSplit.total), count: noSplit.count },
      };
    }
  } catch (e: any) {
    console.warn("[finance-board] invoices unavailable:", e?.message);
  }

  const sortRows = (m: Map<string, { fee: number; weighted: number; deals: number }>) =>
    [...m.entries()]
      .map(([name, v]) => ({ name, fee: round(v.fee), weighted: round(v.weighted), deals: v.deals }))
      .sort((a, b) => b.weighted - a.weighted || b.fee - a.fee);

  return {
    fyStart: fyStart.toISOString().slice(0, 10),
    fyLabel: `FY ${fyStart.getUTCFullYear()}–${String(fyStart.getUTCFullYear() + 1).slice(2)}`,
    generatedAt: today.toISOString(),
    rule: PIPELINE_RULE_TEXT,
    book: {
      fee: round(fee),
      weighted: round(weighted),
      count: bookDeals.length,
      thisYear: round(thisYear),
      noDate: { weighted: round(noDate.weighted), count: noDate.count },
      afterYearEnd: { weighted: round(afterYearEnd.weighted), count: afterYearEnd.count },
      byStage: PIPELINE_STAGES.filter(c => stageAcc.has(c)).map(c => {
        const s = stageAcc.get(c)!;
        return {
          code: c, label: PIPELINE_STAGE_LABELS[c], weightPct: pipelineWeightPct(c),
          fee: round(s.fee), weighted: round(s.weighted), count: s.count,
          deals: s.deals.sort((a, b) => b.weighted - a.weighted || b.fee - a.fee),
        };
      }),
      byTeam: sortRows(teamAcc),
      byType: sortRows(typeAcc),
      top: bookDeals.slice(0, 10).map(d => ({
        id: d.id, name: d.name, stage: d.stage, stageLabel: d.stageLabel, fee: d.fee, weighted: d.weighted,
        team: d.team, dealType: d.dealType, expected: d.expected,
      })),
    },
    invoiced,
    agents: [...agentAcc.values()]
      .map(a => ({ agent: a.agent, invoiced: round(a.invoiced), book: round(a.book) }))
      .filter(a => a.invoiced > 0 || a.book > 0)
      .sort((a, b) => (b.invoiced + b.book) - (a.invoiced + a.book)),
    deals: bookDeals,
  };
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
}

async function boardWorkbook(board: FinanceBoard): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "BGP Dashboard";
  wb.created = new Date(board.generatedAt);
  // BGP v19: Bordeaux headers, Cream banding.
  const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF6E0C25" } };
  const headerFont = { bold: true, color: { argb: "FFFFFFFF" } };
  const bandFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFCF8F4" } };
  const GBP = "£#,##0";
  const table = (name: string, columns: Array<{ header: string; key: string; width: number; money?: boolean }>, rows: any[], totals?: Record<string, any>) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; });
    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      for (const c of columns) if (c.money) row.getCell(c.key).numFmt = GBP;
      if (i % 2 === 1) row.eachCell(cell => { cell.fill = bandFill; });
    });
    if (totals) {
      const row = ws.addRow(totals);
      row.font = { bold: true };
      for (const c of columns) if (c.money) row.getCell(c.key).numFmt = GBP;
      row.eachCell(cell => { cell.border = { top: { style: "thin" } }; });
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };

  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ key: "label", width: 44 }, { key: "value", width: 22 }];
  const title = summary.addRow({ label: `BGP Finance — fees and pipeline, ${board.fyLabel}` });
  title.font = { bold: true, size: 14, color: { argb: "FF6E0C25" } };
  summary.addRow({ label: "Generated", value: new Date(board.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) });
  summary.addRow({});
  const lines: Array<[string, number | string, boolean?]> = [
    ["Invoiced this year (Xero, ex VAT)", board.invoiced ? board.invoiced.total : "Xero not available", true],
    ["Deal book at full fee", board.book.fee, true],
    ["Deal book weighted", board.book.weighted, true],
    ["  expected this year", board.book.thisYear, true],
    ["  no date yet", board.book.noDate.weighted, true],
    ["  after 30 April", board.book.afterYearEnd.weighted, true],
    ["Live deals in the book", board.book.count],
  ];
  for (const [label, value, money] of lines) {
    const row = summary.addRow({ label, value });
    if (money && typeof value === "number") row.getCell("value").numFmt = GBP;
  }
  summary.addRow({});
  summary.addRow({ label: `Weights: ${board.rule}. Invoiced deals are Xero income only. A deal on several teams is shared equally between them.` });

  const stageRows = board.book.byStage.map(s => ({ stage: s.label, deals: s.count, fee: s.fee, weight: `${s.weightPct}%`, weighted: s.weighted }));
  table("By stage", [
    { header: "Stage", key: "stage", width: 26 }, { header: "Deals", key: "deals", width: 10 },
    { header: "Fee", key: "fee", width: 16, money: true }, { header: "Weight", key: "weight", width: 10 },
    { header: "Weighted", key: "weighted", width: 16, money: true },
  ], stageRows, { stage: "Total", deals: board.book.count, fee: board.book.fee, weighted: board.book.weighted });
  table("By team", [
    { header: "Team", key: "name", width: 26 }, { header: "Deals", key: "deals", width: 10 },
    { header: "Fee (shared)", key: "fee", width: 16, money: true }, { header: "Weighted (shared)", key: "weighted", width: 18, money: true },
  ], board.book.byTeam, { name: "Total", fee: board.book.fee, weighted: board.book.weighted });
  table("By deal type", [
    { header: "Deal type", key: "name", width: 26 }, { header: "Deals", key: "deals", width: 10 },
    { header: "Fee", key: "fee", width: 16, money: true }, { header: "Weighted", key: "weighted", width: 16, money: true },
  ], board.book.byType, { name: "Total", deals: board.book.count, fee: board.book.fee, weighted: board.book.weighted });
  table("Deals", [
    { header: "Deal", key: "name", width: 40 }, { header: "Status", key: "status", width: 16 },
    { header: "Fee", key: "fee", width: 14, money: true }, { header: "Weight", key: "weightPct", width: 9 },
    { header: "Weighted", key: "weighted", width: 14, money: true }, { header: "Team", key: "team", width: 22 },
    { header: "Deal type", key: "dealType", width: 16 }, { header: "Expected", key: "expected", width: 12 },
    { header: "Lands", key: "when", width: 14 },
  ], board.deals.map(d => ({ ...d, weightPct: `${d.weightPct}%` })), { name: "Total", fee: board.book.fee, weighted: board.book.weighted });

  const agentRows: any[] = board.agents.map(a => ({ agent: a.agent, invoiced: a.invoiced, book: a.book }));
  if (board.invoiced) {
    agentRows.push({ agent: "BGP House (15% slice)", invoiced: board.invoiced.house });
    if (board.invoiced.noSplit.total) agentRows.push({ agent: "Deals with no fee split", invoiced: board.invoiced.noSplit.total });
    if (board.invoiced.notLinked.total) agentRows.push({ agent: "Invoices not linked to a deal", invoiced: board.invoiced.notLinked.total });
  }
  table("Fees by agent", [
    { header: "Agent", key: "agent", width: 32 },
    { header: "Invoiced this year", key: "invoiced", width: 18, money: true },
    { header: "Deal book (weighted)", key: "book", width: 20, money: true },
  ], agentRows, board.invoiced ? { agent: "Total invoiced", invoiced: board.invoiced.total } : undefined);
  if (board.invoiced) {
    table("Invoiced by month", [
      { header: "Month", key: "month", width: 16 }, { header: "Invoiced (ex VAT)", key: "total", width: 18, money: true },
    ], board.invoiced.byMonth.map(m => ({ month: monthLabel(m.month), total: m.total })), { month: "Total", total: board.invoiced.total });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function registerFinanceBoardRoutes(app: Express): void {
  app.get("/api/finance/board", requireEquityOrAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await buildFinanceBoard());
    } catch (e: any) {
      console.error("[finance-board] failed:", e?.message);
      res.status(500).json({ error: e?.message || "Could not build the board" });
    }
  });

  app.get("/api/finance/board.xlsx", requireEquityOrAdmin, async (_req: Request, res: Response) => {
    try {
      const board = await buildFinanceBoard();
      const buf = await boardWorkbook(board);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="BGP_Fees_and_pipeline_${board.generatedAt.slice(0, 10)}.xlsx"`);
      res.send(buf);
    } catch (e: any) {
      console.error("[finance-board] export failed:", e?.message);
      res.status(500).json({ error: e?.message || "Could not build the workbook" });
    }
  });
}
