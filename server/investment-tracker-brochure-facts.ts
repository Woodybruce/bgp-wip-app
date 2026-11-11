// Investment Tracker columns from the brochure (Jack, 2026-11-11: "whilst
// it's sieving through emails and brochures it can surely fill in the
// column headings").
//
// Whenever the tracker opens a brochure PDF for an asset — one uploaded on
// the row, handed to ChatBGP, or found in the investment team's email — the
// same PDF is read for the facts the board shows and they are written into
// the asset's row.
//
// The rules:
//   · Blanks only. A value someone typed is never changed.
//   · Sale brochures only (a letting brochure's rent is not a guide price).
//   · The brochure must be for THIS asset: its own name / address has to
//     share a street number, postcode or distinctive word with the row.
//   · Nothing is guessed — a figure the brochure doesn't print stays blank,
//     and an unsure reading ("low" confidence) fills nothing.
//   · Each PDF is read once per asset; the reading and what it filled are
//     kept in system_settings (tracker_brochure_facts:<property>:<hash>).
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";

export interface BrochureFactsResult {
  /** Plain names of the columns filled, e.g. "price", "yield". */
  filled: string[];
  /** Why nothing was filled, when nothing was. */
  note?: string;
}

const GENERIC = new Set(["street", "road", "lane", "avenue", "place", "square", "house", "centre", "center", "shopping", "retail", "park", "unit", "units", "high", "the", "and", "london", "portfolio", "building", "estate", "investment", "freehold", "limited", "united", "kingdom", "north", "south", "east", "west", "upper", "lower", "great", "saint", "court", "quarter", "plaza", "tower"]);
const tokens = (s: string) => (s.toLowerCase().match(/[a-z]{4,}|\d+[a-z]?/g) || []).filter((w) => !GENERIC.has(w));

/** Does what the brochure says it is share anything distinctive with the row? */
function sameAsset(row: { asset_name: string; address: string | null; property_name: string | null }, x: { propertyName: string | null; addressLine: string | null; postcode: string | null }): boolean {
  const theirs = new Set(tokens([x.propertyName, x.addressLine].filter(Boolean).join(" ")));
  const ours = tokens([row.asset_name, row.address, row.property_name].filter(Boolean).join(" "));
  if (ours.some((w) => theirs.has(w))) return true;
  const pc = (x.postcode || "").replace(/\s+/g, "").toLowerCase();
  return pc.length >= 5 && [row.asset_name, row.address].filter(Boolean).join(" ").replace(/\s+/g, "").toLowerCase().includes(pc);
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const pct = (v: number | null) => (v == null ? null : v <= 1 ? Math.round(v * 10000) / 100 : Math.round(v * 100) / 100);

export async function fillTrackerFromBrochure(args: { propertyId: string; pdfBuffer: Buffer; label: string; dryRun?: boolean }): Promise<BrochureFactsResult> {
  const { rows } = await pool.query(
    `SELECT t.id, t.asset_name, t.address, t.tenure, t.guide_price, t.niy, t.sqft, t.wault_break, t.wault_expiry,
            t.current_rent, t.erv_pa, t.vendor, t.vendor_agent, t.board_type, p.name AS property_name
       FROM investment_tracker t LEFT JOIN crm_properties p ON p.id = t.property_id
      WHERE t.property_id = $1`,
    [args.propertyId],
  );
  if (!rows.length) return { filled: [], note: "not on the tracker" };
  const COLS = ["address", "tenure", "guide_price", "niy", "sqft", "wault_break", "wault_expiry", "current_rent", "erv_pa", "vendor", "vendor_agent"];
  if (!rows.some((r: any) => COLS.some((c) => blank(r[c])))) return { filled: [], note: "every column already has a value" };

  const hash = crypto.createHash("sha1").update(args.pdfBuffer).digest("hex");
  const key = `tracker_brochure_facts:${args.propertyId}:${hash}`;
  const { rows: seen } = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
  let x: any = seen[0]?.value?.read || null;
  if (!x) {
    const { extractBrochureFields } = await import("./brochure-vision");
    x = await extractBrochureFields({ pdfBuffer: args.pdfBuffer, maxPages: 8 });
    if (!x) return { filled: [], note: "the brochure couldn't be read" };
  }

  const filled: string[] = [];
  let note: string | undefined;
  const updates: Array<{ id: string; set: Record<string, unknown> }> = [];
  const isSale = x.type === "investment" || (x.type === "unknown" && x.askingPrice != null);
  if (!isSale) note = "not a sale brochure";
  else if (x.confidence === "low") note = "the brochure was too unclear to rely on";
  else {
    const niy = pct(x.netInitialYield);
    const agent = String(x.agent?.agencyName || "").trim();
    const read: Array<[string, string, unknown]> = [
      ["guide_price", "price", x.askingPrice != null && x.askingPrice >= 50_000 ? Math.round(x.askingPrice) : null],
      ["niy", "yield", niy != null && niy >= 1 && niy <= 25 ? niy : null],
      ["sqft", "size", x.totalAreaSqFt != null && x.totalAreaSqFt >= 100 ? Math.round(x.totalAreaSqFt) : null],
      ["tenure", "tenure", x.tenure],
      ["current_rent", "current rent", x.passingRentPa != null && x.passingRentPa > 0 ? Math.round(x.passingRentPa) : null],
      ["erv_pa", "ERV", x.ervPa != null && x.ervPa > 0 ? Math.round(x.ervPa) : null],
      ["wault_break", "WAULT to break", x.waultToBreak != null && x.waultToBreak > 0 && x.waultToBreak < 200 ? x.waultToBreak : null],
      ["wault_expiry", "WAULT to expiry", x.waultToExpiry != null && x.waultToExpiry > 0 && x.waultToExpiry < 200 ? x.waultToExpiry : null],
      ["vendor", "vendor", x.ownership?.vendorName],
      // BGP is never "the vendor's agent" column's answer on its own sale.
      ["vendor_agent", "vendor's agent", agent && !/bruce gillingham|\bbgp\b/i.test(agent) ? agent : null],
      ["address", "address", [x.addressLine, x.postcode && !String(x.addressLine || "").includes(x.postcode) ? x.postcode : null].filter(Boolean).join(", ") || null],
    ];
    for (const row of rows as any[]) {
      if (!sameAsset(row, x)) { note = `the brochure reads as "${x.propertyName || x.addressLine || "another property"}", not this asset`; continue; }
      const set: Record<string, unknown> = {};
      for (const [col, name, value] of read) {
        if (blank(value) || !blank(row[col])) continue;
        set[col] = value;
        if (!filled.includes(name)) filled.push(name);
      }
      if (Object.keys(set).length) updates.push({ id: row.id, set });
    }
    if (!filled.length && !note) note = "the brochure had nothing the row was missing";
  }

  if (args.dryRun) return { filled, note };
  for (const u of updates) {
    const cols = Object.keys(u.set);
    // Blanks only, checked again in the statement itself in case someone
    // typed a value while the brochure was being read.
    await pool.query(
      `UPDATE investment_tracker SET ${cols.map((c, i) => `${c} = CASE WHEN ${c} IS NULL OR ${c}::text = '' THEN $${i + 2} ELSE ${c} END`).join(", ")}, updated_at = now() WHERE id = $1`,
      [u.id, ...cols.map((c) => u.set[c])],
    );
  }
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify({ file: args.label, at: new Date().toISOString(), filled, note: note || null, wrote: updates, read: x })],
  );
  if (filled.length) console.log(`[tracker-brochure-facts] ${rows[0].asset_name}: filled ${filled.join(", ")} from ${args.label}`);
  return { filled, note };
}

// ─── Catch-up for assets already on the board ────────────────────────────────
// Preview is free: it lists the assets with a brochure on file and blank
// columns. ?apply=1 reads each one's brochure (one AI reading per asset) in
// the background; GET shows how it is getting on.
type Catchup = { state: "running" | "done"; total: number; done: number; results: Array<{ asset: string; filled: string[]; note?: string }>; startedAt: number };
let catchup: Catchup | null = null;

async function candidates(): Promise<Array<{ property_id: string; asset_name: string; file_name: string; file_path: string }>> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (t.property_id) t.property_id, t.asset_name, f.file_name, f.file_path
       FROM investment_tracker t
       JOIN investment_marketing_files f ON f.tracker_id = t.id AND (f.mime_type = 'application/pdf' OR lower(f.file_name) LIKE '%.pdf')
      WHERE (t.guide_price IS NULL OR t.niy IS NULL OR t.sqft IS NULL OR COALESCE(t.vendor, '') = '' OR COALESCE(t.vendor_agent, '') = ''
             OR COALESCE(t.tenure, '') = '' OR t.current_rent IS NULL OR COALESCE(t.address, '') = '')
      ORDER BY t.property_id, (lower(f.file_name) LIKE '%brochure%') DESC, f.file_size DESC NULLS LAST`,
  );
  return rows;
}

export function registerTrackerBrochureFactsRoutes(app: Express): void {
  app.get("/api/admin/investment-tracker/brochure-facts", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    res.json(catchup || { state: "idle" });
  });
  app.post("/api/admin/investment-tracker/brochure-facts", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const list = await candidates();
      if (String(req.query.apply || "") !== "1") return res.json({ preview: true, assets: list.length, list: list.map((r) => ({ asset: r.asset_name, brochure: r.file_name })) });
      if (catchup?.state === "running") return res.json({ started: false, message: "already running", ...catchup });
      const job: Catchup = { state: "running", total: list.length, done: 0, results: [], startedAt: Date.now() };
      catchup = job;
      (async () => {
        const { getFile } = await import("./file-storage");
        for (const r of list) {
          try {
            const file = await getFile(r.file_path).catch(() => null);
            const out = file?.data ? await fillTrackerFromBrochure({ propertyId: r.property_id, pdfBuffer: file.data, label: r.file_name }) : { filled: [], note: "the file couldn't be opened" };
            job.results.push({ asset: r.asset_name, ...out });
          } catch (e: any) {
            job.results.push({ asset: r.asset_name, filled: [], note: e?.message || "failed" });
          }
          job.done++;
        }
        job.state = "done";
      })();
      return res.json({ started: true, total: list.length });
    } catch (e: any) {
      return res.status(500).json({ message: e?.message || "failed" });
    }
  });
}
