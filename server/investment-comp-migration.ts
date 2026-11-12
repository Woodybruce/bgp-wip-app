// Historical comparables migration (Jack, 2026-11-12). Admin Preview →
// Apply → Undo, never at boot. The plan (investment-comp-migration-plan.ts)
// comes from the audit of every comparables request Jack made to ChatBGP.
//
// - Tracker evidence goes through Sold - Comp (markTrackerSoldComp): the row
//   leaves the live board, its deal is Withdrawn, the comp is matched to any
//   existing one (e.g. the RCA row for 80-85 Tottenham Court Road).
// - Everything else goes through the same evidence writer, find-first.
// - Yields stored as percentages (6.1 for 6.1%) are put in the same units as
//   the rest (0.061).
// - Every row written is logged in investment_comp_migration_log with its
//   earlier values, so Undo puts the batch back exactly. Nothing is deleted
//   except rows the batch itself created, and only on Undo.
import { pool } from "./db";
import { fileSaleEvidence, unlinkTrackerComp } from "./investment-sale-evidence";
import { PLAN_TRACKER, PLAN_ITEMS, PLAN_RENTALS, PLAN_EXCEPTIONS } from "./investment-comp-migration-plan";

type Line = { ref: string; property: string; outcome: string; compId?: string; status?: string; conflicts?: string[] };

async function log(batch: string, table: string, recordId: string, action: string, prior: any, trackerId?: string | null, note?: string | null) {
  await pool.query(
    `INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, tracker_id, note) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [batch, table, recordId, action, prior ? JSON.stringify(prior) : null, trackerId || null, note || null],
  );
}

export async function runCompMigration(opts: { apply: boolean; groups?: string[]; actorId?: string | null }) {
  const groups = new Set(["core", ...(opts.groups || [])]);
  const batch = opts.apply ? `comp-migration-${new Date().toISOString().replace(/[:.]/g, "-")}` : null;
  const lines: { tracker: Line[]; items: Line[]; rentals: Line[]; yieldFixes: Line[] } = { tracker: [], items: [], rentals: [], yieldFixes: [] };

  // 1. Yield units first, so matching compares like with like.
  const { rows: pct } = await pool.query(`SELECT id, property_name, cap_rate FROM investment_comps WHERE cap_rate > 1 AND cap_rate < 100`);
  for (const r of pct) {
    if (opts.apply) {
      await pool.query(`UPDATE investment_comps SET cap_rate = cap_rate / 100 WHERE id = $1 AND cap_rate > 1`, [r.id]);
      await log(batch!, "investment_comps", r.id, "updated", { cap_rate: r.cap_rate }, null, "yield stored as a percentage");
    }
    lines.yieldFixes.push({ ref: "yield units", property: r.property_name, compId: r.id, outcome: `${r.cap_rate} → ${Number(r.cap_rate) / 100}` });
  }

  // 2. Tracker evidence → Sold - Comp.
  const { markTrackerSoldComp } = await import("./investment-tracker-sold-comp");
  for (const t of PLAN_TRACKER) {
    const { rows: [row] } = await pool.query(
      `SELECT it.id, it.status, it.asset_name, it.notes, it.property_id, it.address, it.sqft,
              (SELECT comp_id FROM investment_comp_tracker_links WHERE tracker_id = it.id) AS linked
         FROM investment_tracker it WHERE it.id = $1`, [t.trackerId]);
    if (!row) { lines.tracker.push({ ref: t.trackerId, property: t.name, outcome: "tracker row not found — skipped" }); continue; }
    if (row.linked) { lines.tracker.push({ ref: t.trackerId, property: t.name, outcome: "already on Sold - Comp", compId: row.linked }); continue; }
    const body = { evidenceStatus: t.evidenceStatus, price: t.price, yieldPct: t.yieldPct, pricePsf: t.pricePsf, saleDate: t.saleDate, assetClass: t.assetClass };
    if (!opts.apply) {
      const r = await fileSaleEvidence({
        trackerId: t.trackerId, propertyId: row.property_id, propertyName: row.asset_name, address: row.address, assetClass: t.assetClass,
        evidenceStatus: t.evidenceStatus, price: t.price, yieldPct: t.yieldPct, pricePsf: t.pricePsf, sqft: row.sqft, saleDate: t.saleDate,
        source: "BGP Tracker", sourceDocument: t.sourceDocument, sourcePage: t.sourcePage,
      }, { dryRun: true });
      lines.tracker.push({ ref: t.trackerId, property: t.name, outcome: r.matchedBy ? `would update existing comp (${r.matchedBy} match) and leave the board` : "would create comp and leave the board", compId: r.matchedBy ? r.compId : undefined, status: r.status, conflicts: r.conflicts });
      continue;
    }
    const out = await markTrackerSoldComp(t.trackerId, body, opts.actorId || null, { requireFullPricing: false, batch, sourceDocument: t.sourceDocument, sourcePage: t.sourcePage });
    const b: any = out.body;
    if (out.status !== 200) { lines.tracker.push({ ref: t.trackerId, property: t.name, outcome: `not moved: ${b?.message}` }); continue; }
    await log(batch!, "investment_tracker", t.trackerId, "sold-comp", { status: row.status }, t.trackerId, `comp ${b.compId}`);
    lines.tracker.push({ ref: t.trackerId, property: t.name, outcome: b.matchedBy && b.matchedBy !== "tracker" ? `moved; merged into existing comp (${b.matchedBy} match)` : "moved; comp created", compId: b.compId, status: b.compStatus, conflicts: b.conflicts });
  }

  // 3. Evidence from the re-read sources.
  for (const it of PLAN_ITEMS) {
    if (!groups.has(it.group)) continue;
    const r = await fileSaleEvidence({
      propertyName: it.propertyName, address: it.address || null, assetClass: it.assetClass || null, transactionType: it.transactionType || null,
      evidenceStatus: it.evidenceStatus, price: it.price ?? null, yieldPct: it.yieldPct ?? null, pricePsf: it.pricePsf ?? null, sqft: it.sqft ?? null,
      saleDate: it.saleDate || null, buyer: it.buyer || null, seller: it.seller || null, source: "ChatBGP (migration)",
      sourceDocument: it.sourceDocument || null, sourcePage: it.sourcePage || null, comments: it.comments || null,
    }, { dryRun: !opts.apply });
    if (opts.apply && r.action !== "unchanged") await log(batch!, "investment_comps", r.compId, r.action, r.priorComp, null, it.ref);
    lines.items.push({
      ref: it.ref, property: it.propertyName, compId: r.compId === "(new)" ? undefined : r.compId, status: r.status, conflicts: r.conflicts,
      outcome: r.action === "created" ? (opts.apply ? "recovered (created)" : "would recover (create)")
        : r.action === "updated" ? `${opts.apply ? "updated" : "would update"} existing comp: ${Object.keys(r.changes || {}).join(", ")}` : "already correctly filed",
    });
  }

  // 4. Rental evidence → leasing comps (never Investment Comps).
  for (const rt of PLAN_RENTALS) {
    const { rows: [have] } = await pool.query(`SELECT id FROM crm_comps WHERE lower(name) = lower($1) AND COALESCE(completion_date, '') = COALESCE($2, '') LIMIT 1`, [rt.name, rt.completionDate || null]);
    if (have) { lines.rentals.push({ ref: "leasing comp", property: rt.name, compId: have.id, outcome: "already in leasing comps" }); continue; }
    if (opts.apply) {
      const { rows: [ins] } = await pool.query(
        `INSERT INTO crm_comps (id, name, address, use_class, area_sqft, rent_psf_nia, completion_date, source_evidence, comments)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'Brochure', $7) RETURNING id`,
        [rt.name, rt.address ? JSON.stringify({ formatted: rt.address }) : null, rt.useClass || null, rt.areaSqft != null ? String(rt.areaSqft) : null,
          rt.rentPsf != null ? String(rt.rentPsf) : null, rt.completionDate || null,
          [rt.comments, rt.sourceDocument ? `Source: ${rt.sourceDocument}${rt.sourcePage ? `, ${rt.sourcePage}` : ""}` : null].filter(Boolean).join("\n")],
      );
      await log(batch!, "crm_comps", ins.id, "created", null, null, "rental");
      lines.rentals.push({ ref: "leasing comp", property: rt.name, compId: ins.id, outcome: "recovered (created)" });
    } else lines.rentals.push({ ref: "leasing comp", property: rt.name, outcome: "would recover (create)" });
  }

  if (opts.apply) {
    const { linkInvestmentCompCompanies } = await import("./investment-comp-sync");
    await linkInvestmentCompCompanies().catch(() => null);
  }

  const count = (ls: Line[], re: RegExp) => ls.filter((l) => re.test(l.outcome)).length;
  const conflicts = [...lines.tracker, ...lines.items].filter((l) => l.conflicts?.length).map((l) => `${l.property}: ${l.conflicts!.join("; ")}`);
  return {
    batch,
    applied: opts.apply,
    groups: Array.from(groups),
    summary: {
      trackerRowsReviewed: lines.tracker.length,
      trackerRowsMoved: count(lines.tracker, /^(moved|would)/),
      mergedIntoExistingComps: count(lines.tracker, /existing comp/) + count(lines.items, /update/),
      itemsReviewed: lines.items.length,
      recovered: count(lines.items, /recover/),
      alreadyCorrectlyFiled: count(lines.items, /already correctly/) + count(lines.tracker, /already on Sold/),
      underOfferOrQuoting: [...lines.tracker, ...lines.items].filter((l) => l.status === "Under Offer" || l.status === "Quoting").length,
      rentalsRecovered: count(lines.rentals, /recover/),
      yieldUnitFixes: lines.yieldFixes.length,
      conflicts: conflicts.length,
    },
    conflicts,
    exceptions: PLAN_EXCEPTIONS,
    lines,
  };
}

/** After Apply: the moved rows are off the live board and out of BGP totals. */
export async function verifyCompMigration() {
  const ids = PLAN_TRACKER.map((t) => t.trackerId);
  const { rows } = await pool.query(
    `SELECT it.id, it.asset_name, it.status, d.status AS deal_status, d.fee,
            l.comp_id, c.status AS comp_status, c.subtype, c.transaction_type
       FROM investment_tracker it
       LEFT JOIN crm_deals d ON d.id = it.deal_id
       LEFT JOIN investment_comp_tracker_links l ON l.tracker_id = it.id
       LEFT JOIN investment_comps c ON c.id = l.comp_id
      WHERE it.id = ANY($1::text[])`, [ids]);
  const { rows: dupes } = await pool.query(
    `SELECT lower(regexp_replace(property_name, '[^a-zA-Z0-9]+', '', 'g')) AS k, price, COUNT(*)::int AS n
       FROM investment_comps WHERE price IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 50`);
  return {
    trackerRows: rows.map((r: any) => ({
      asset: r.asset_name, trackerStatus: r.status, dealStatus: r.deal_status, fee: r.fee, compId: r.comp_id, compStatus: r.comp_status, subtype: r.subtype,
      ok: !!r.comp_id && r.status === "WIT" && r.subtype === "Office London",
    })),
    possibleDuplicateComps: dupes,
  };
}

export async function undoCompMigration(batch: string, actorId: string | null) {
  const { rows } = await pool.query(`SELECT * FROM investment_comp_migration_log WHERE batch = $1 ORDER BY id DESC`, [batch]);
  if (!rows.length) return { batch, undone: 0, message: "No such batch" };
  const { updateTrackerAsset } = await import("./investment-tracker-service");
  let undone = 0;
  for (const r of rows) {
    const prior = r.prior ? (typeof r.prior === "string" ? JSON.parse(r.prior) : r.prior) : null;
    if (r.table_name === "investment_tracker") {
      const u = await unlinkTrackerComp(pool, r.record_id);
      await updateTrackerAsset(r.record_id, { status: u?.priorStatus || prior?.status || "REP" }, { id: actorId }).catch(() => {});
    } else if (r.action === "created") {
      await pool.query(`DELETE FROM ${r.table_name === "crm_comps" ? "crm_comps" : "investment_comps"} WHERE id = $1`, [r.record_id]);
    } else if (prior) {
      const cols = Object.keys(prior).filter((c) => c !== "id");
      if (cols.length) await pool.query(`UPDATE investment_comps SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`, [r.record_id, ...cols.map((c) => prior[c])]);
    }
    undone++;
  }
  await pool.query(`UPDATE investment_comp_migration_log SET note = COALESCE(note, '') || ' [undone]' WHERE batch = $1`, [batch]);
  return { batch, undone };
}
