// ── Xero invoice → deal status (Woody, 2026-10-28: "update deal statuses
// to Invoiced once the invoice has been issued to the client from Xero") ──
// One routine behind three doors. The hourly job (and Refresh Xero on the
// WIP) refreshes every open invoice the app knows about and moves its deal
// to Invoiced when Xero says AUTHORISED (approved and sent) or PAID; the
// Xero webhook does the same for one invoice the moment it changes; and
// invoices raised directly in Xero are matched to deals — by the Ref # in
// the reference or line, by the reference naming the deal, or by contact
// + fee — so they count too. Promotion goes through the deal write door
// (status INV + invoiced_at), with a deal_audit_log row and the tracker
// mirror, and never revives a withdrawn or archived deal.
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { xeroInvoices, crmDeals } from "@shared/schema";
import { isInvoicedStatus, legacyToCode } from "@shared/deal-status";
import { xeroApiWithFallback, xeroNetAmount } from "./xero";
import { updateDeal } from "./letting-service";
import { mirrorFromDeal } from "./lease-status-mirror";

export const XERO_INVOICED_STATUSES = ["AUTHORISED", "PAID"];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const is429 = (e: any) => /\b429\b/.test(String(e?.message || ""));
const norm = (s: unknown) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").replace(/\blimited\b/g, "ltd").replace(/\bplc\b/g, "").replace(/\s+/g, " ").trim();

async function xeroGet(session: any, path: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await xeroApiWithFallback(session, path);
    } catch (e: any) {
      if (!is429(e) || attempt >= 3) throw e;
      await sleep([3000, 8000, 15000][attempt]);
    }
  }
}

/** Deal → Invoiced once Xero has approved/sent or been paid for its invoice. */
export async function promoteDealToInvoiced(dealId: string, xeroStatus: string, invoiceNumber?: string | null): Promise<boolean> {
  if (!XERO_INVOICED_STATUSES.includes(String(xeroStatus || "").toUpperCase())) return false;
  try {
    const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, dealId)).limit(1);
    if (!deal || isInvoicedStatus(deal.status)) return false;
    const code = legacyToCode(deal.status);
    if (code === "WIT" || code === "ARCH") return false;
    const before = deal.status || null;
    await updateDeal(dealId, { status: "INV", invoicedAt: new Date().toISOString() }, { userId: null, source: "xero" });
    await pool.query(
      `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by) VALUES ($1, 'status', $2, 'INV', $3, NULL)`,
      [dealId, before, `Xero invoice ${invoiceNumber || ""} ${String(xeroStatus).toUpperCase()}`.replace(/\s+/g, " ").trim()],
    ).catch((e: any) => console.warn(`[xero-invoices] audit row failed for ${dealId}:`, e?.message));
    await mirrorFromDeal(dealId, "INV", { pool, reason: "xero-invoiced", actorUserId: null }).catch((e: any) => console.warn(`[xero-invoices] tracker mirror failed for ${dealId}:`, e?.message));
    console.log(`[xero-invoices] Deal ${dealId} → INV (Xero ${invoiceNumber || dealId} ${xeroStatus})`);
    return true;
  } catch (e: any) {
    console.error(`[xero-invoices] promote failed for ${dealId}:`, e?.message);
    return false;
  }
}

/** Write what Xero says about one invoice onto our row, then promote its deal. */
export async function applyXeroInvoice(row: typeof xeroInvoices.$inferSelect, xeroInvoice: any): Promise<boolean> {
  const firstLine = xeroInvoice.LineItems?.[0];
  await db.update(xeroInvoices).set({
    status: xeroInvoice.Status,
    totalAmount: xeroInvoice.Total,
    lineAmount: xeroNetAmount(xeroInvoice, row.lineAmount),
    invoiceNumber: xeroInvoice.InvoiceNumber,
    reference: xeroInvoice.Reference ?? row.reference,
    dueDate: xeroInvoice.DueDate ? String(xeroInvoice.DueDate).slice(0, 10) : row.dueDate,
    contactName: xeroInvoice.Contact?.Name ?? row.contactName,
    lineDescription: firstLine?.Description ?? row.lineDescription,
    syncedAt: new Date(),
    updatedAt: new Date(),
  } as any).where(eq(xeroInvoices.id, row.id));
  return row.dealId ? promoteDealToInvoiced(row.dealId, xeroInvoice.Status, xeroInvoice.InvoiceNumber) : false;
}

export type SyncResult = { synced: number; promoted: number; total: number; errors: string[] };

/** Every open invoice the app knows about, refreshed from Xero in batches. */
export async function syncKnownInvoices(session: any | null): Promise<SyncResult> {
  const pending = await db.select().from(xeroInvoices).where(eq(xeroInvoices.sentToXero, true));
  const toSync = pending.filter(inv => inv.xeroInvoiceId && inv.status !== "PAID" && inv.status !== "VOIDED");
  let synced = 0, promoted = 0;
  const errors: string[] = [];
  const BATCH = 40;
  for (let i = 0; i < toSync.length; i += BATCH) {
    const slice = toSync.slice(i, i + BATCH);
    let byXeroId: Map<string, any> | null = null;
    try {
      const res = await xeroGet(session, `/Invoices?IDs=${slice.map(inv => inv.xeroInvoiceId).join(",")}`);
      byXeroId = new Map((res.Invoices || []).map((x: any) => [String(x.InvoiceID), x]));
    } catch (e: any) {
      if (/Not connected/i.test(String(e?.message))) throw e;
      console.warn(`[xero-invoices] batch fetch failed (${e?.message}); falling back to per-invoice`);
    }
    for (const inv of slice) {
      try {
        let xeroInvoice = byXeroId?.get(String(inv.xeroInvoiceId));
        if (!byXeroId) {
          await sleep(1100);
          xeroInvoice = (await xeroGet(session, `/Invoices/${inv.xeroInvoiceId}`)).Invoices?.[0];
        }
        if (!xeroInvoice) {
          if (byXeroId) errors.push(`Invoice ${inv.invoiceNumber || inv.id}: not found in Xero (deleted or wrong organisation)`);
          continue;
        }
        if (await applyXeroInvoice(inv, xeroInvoice)) promoted++;
        synced++;
      } catch (err: any) {
        errors.push(`Invoice ${inv.invoiceNumber || inv.id}: ${is429(err) ? "Xero rate limit (429) — wait a minute and sync again" : err.message}`);
      }
    }
  }
  if (errors.length) {
    const reasons = new Map<string, number>();
    for (const e of errors) { const r = e.replace(/^Invoice [^:]+:\s*/, ""); reasons.set(r, (reasons.get(r) || 0) + 1); }
    console.warn(`[xero-invoices] sync: ${synced} synced, ${errors.length} failed — ${[...reasons.entries()].map(([r, n]) => `${r} ×${n}`).join("; ")}`);
  }
  return { synced, promoted, total: toSync.length, errors };
}

type DealRow = { id: string; deal_ref: number | null; name: string | null; status: string | null; fee: number | null; xero_contact_name: string | null; parties: string[] };
// What accounts actually put in Xero (seen 2026-10-28): the Reference is
// the Sage job number (5334, 5373 …) — wip_entries.ref, the HEADER_NUMBER
// the WIP import links to a deal — not the app's Ref #. So that is the
// first match, with the WIP's own invoice number as a second key.
type WipHit = { dealId: string; parties: string[]; amounts: number[] };
type MatchCtx = { deals: DealRow[]; byWipRef: Map<string, WipHit[]>; byWipInvoice: Map<string, WipHit[]> };
const digits = (v: unknown) => String(v || "").replace(/\D+/g, "");

/** Which deal an invoice raised in Xero belongs to, or null. Ref # first,
 *  then a reference / line naming the deal, then contact + fee — each must
 *  point at exactly one deal. */
function matchDeal(inv: any, ctx: MatchCtx): { deal: DealRow; by: string } | { ambiguous: string } | null {
  const { deals } = ctx;
  // A WIP entry's link to a deal is itself a guess (the import matches
  // by name), so a job number only counts when the WIP entry also agrees
  // with the invoice on who is billed or on the amount. On 28 Oct the bare
  // number linked three Brent Cross invoices to Scuffers and Elephant Park
  // deals and marked Scuffers invoiced — Woody: "it hasn't been invoiced".
  const contactKey = norm(inv.Contact?.Name);
  const netAmt = Number(inv.SubTotal ?? inv.Total);
  const corroborated = (w: WipHit) =>
    (contactKey && w.parties.some(p => p.length >= 4 && (contactKey === p || contactKey.startsWith(p + " ") || p.startsWith(contactKey + " "))))
    || (Number.isFinite(netAmt) && netAmt > 0 && w.amounts.some(a => Math.abs(a - netAmt) <= 1));
  const dealsFor = (hits: WipHit[] | undefined) =>
    [...new Set((hits || []).filter(corroborated).map(h => h.dealId))].map(id => deals.find(d => d.id === id)).filter((d): d is DealRow => !!d);
  const refNum = digits(inv.Reference);
  if (refNum) {
    const hits = dealsFor(ctx.byWipRef.get(refNum));
    if (hits.length === 1) return { deal: hits[0], by: `Sage job ${refNum} on the WIP (same party / amount)` };
    if (hits.length > 1) return { ambiguous: `Sage job ${refNum} is on ${hits.length} deals` };
  }
  const invNo = digits(inv.InvoiceNumber);
  if (invNo) {
    const hits = dealsFor(ctx.byWipInvoice.get(invNo));
    if (hits.length === 1) return { deal: hits[0], by: `invoice ${inv.InvoiceNumber} on the WIP (same party / amount)` };
    if (hits.length > 1) return { ambiguous: `invoice ${inv.InvoiceNumber} is on ${hits.length} deals` };
  }
  const text = [inv.Reference, ...(inv.LineItems || []).map((l: any) => l.Description)].filter(Boolean).join(" \n ");
  const refs = new Set<number>();
  for (const m of text.matchAll(/(?:#|\bref\.?\s*#?|\bbgp[-\s]?)(\d{3,5})\b/gi)) refs.add(Number(m[1]));
  if (refs.size) {
    const hits = deals.filter(d => d.deal_ref != null && refs.has(d.deal_ref));
    if (hits.length === 1) return { deal: hits[0], by: `Ref #${hits[0].deal_ref}` };
    if (hits.length > 1) return { ambiguous: `refs ${[...refs].join(", ")}` };
  }
  const open = deals.filter(d => !isInvoicedStatus(d.status));
  const names = [inv.Reference, ...(inv.LineItems || []).map((l: any) => l.Description)].map(norm).filter(n => n.length >= 6);
  if (names.length) {
    const hits = open.filter(d => { const n = norm(d.name); return n.length >= 6 && names.some(x => x === n || x.startsWith(n + " ") || x.includes(` ${n} `) || x.endsWith(` ${n}`)); });
    if (hits.length === 1) return { deal: hits[0], by: "reference names the deal" };
    if (hits.length > 1) return { ambiguous: `reference matches ${hits.length} deals` };
  }
  // The Xero contact is one of the deal's parties (billing entity or
  // CRM company — "c/o …" suffixes allowed) and the net is the fee or half
  // of it (a 50/50 exchange / completion split).
  const contact = norm(inv.Contact?.Name);
  const net = Number(inv.SubTotal ?? inv.Total);
  if (contact && Number.isFinite(net) && net > 0) {
    const sameParty = (party: string) => party.length >= 4 && (contact === party || contact.startsWith(party + " "));
    const feeFits = (fee: number) => Math.abs(fee - net) <= 1 || Math.abs(fee - net * 2) <= 2;
    const hits = open.filter(d => d.fee != null && Number(d.fee) > 0 && feeFits(Number(d.fee)) && d.parties.some(sameParty));
    if (hits.length === 1) return { deal: hits[0], by: `contact ${inv.Contact?.Name} + fee` };
    if (hits.length > 1) return { ambiguous: `contact + fee matches ${hits.length} deals` };
  }
  return null;
}

async function linkInvoiceToDeal(inv: any, deal: DealRow, by: string): Promise<boolean> {
  await db.insert(xeroInvoices).values({
    dealId: deal.id,
    xeroInvoiceId: inv.InvoiceID,
    xeroContactId: inv.Contact?.ContactID || null,
    invoiceNumber: inv.InvoiceNumber || null,
    reference: inv.Reference || null,
    status: inv.Status || "AUTHORISED",
    totalAmount: inv.Total ?? null,
    lineAmount: xeroNetAmount(inv, null),
    currency: inv.CurrencyCode || "GBP",
    dueDate: inv.DueDate ? String(inv.DueDate).slice(0, 10) : null,
    contactName: inv.Contact?.Name || null,
    lineDescription: inv.LineItems?.[0]?.Description || null,
    sentToXero: true,
    xeroUrl: inv.InvoiceID ? `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${inv.InvoiceID}` : null,
    syncedAt: new Date(),
  } as any);
  console.log(`[xero-invoices] linked Xero ${inv.InvoiceNumber || inv.InvoiceID} to deal ${deal.deal_ref ? `#${deal.deal_ref} ` : ""}${deal.name || deal.id} (${by})`);
  return promoteDealToInvoiced(deal.id, inv.Status, inv.InvoiceNumber);
}

async function loadDeals(): Promise<MatchCtx> {
  const { rows: raw } = await pool.query(
    `SELECT d.id, d.deal_ref, d.name, d.status, d.fee, d.xero_contact_name,
            d.landlord_entity_name, d.tenant_entity_name, d.vendor_entity_name, d.purchaser_entity_name,
            l.name AS landlord_name, t.name AS tenant_name, v.name AS vendor_name, p.name AS purchaser_name
       FROM crm_deals d
       LEFT JOIN crm_companies l ON l.id = d.landlord_id
       LEFT JOIN crm_companies t ON t.id = d.tenant_id
       LEFT JOIN crm_companies v ON v.id = d.vendor_id
       LEFT JOIN crm_companies p ON p.id = d.purchaser_id
      WHERE COALESCE(d.status, '') NOT IN ('WIT', 'ARCH', 'Withdrawn', 'Archived')`);
  const rows: DealRow[] = raw.map((r: any) => ({
    id: r.id, deal_ref: r.deal_ref, name: r.name, status: r.status, fee: r.fee, xero_contact_name: r.xero_contact_name,
    parties: [...new Set([r.xero_contact_name, r.landlord_entity_name, r.tenant_entity_name, r.vendor_entity_name, r.purchaser_entity_name, r.landlord_name, r.tenant_name, r.vendor_name, r.purchaser_name].map(norm).filter(Boolean))],
  }));
  const { rows: wip } = await pool.query(
    `SELECT ref, invoice_no, deal_id, billing_entity, group_name, tenant, amt_invoice, amt_wip
       FROM wip_entries WHERE deal_id IS NOT NULL AND (ref IS NOT NULL OR invoice_no IS NOT NULL)`);
  const byWipRef = new Map<string, WipHit[]>(), byWipInvoice = new Map<string, WipHit[]>();
  for (const w of wip) {
    const hit: WipHit = {
      dealId: w.deal_id,
      parties: [w.billing_entity, w.group_name, w.tenant].map(norm).filter(Boolean),
      amounts: [w.amt_invoice, w.amt_wip].map(Number).filter(n => Number.isFinite(n) && n > 0),
    };
    const r = digits(w.ref); if (r) byWipRef.set(r, [...(byWipRef.get(r) || []), hit]);
    const n = digits(w.invoice_no); if (n) byWipInvoice.set(n, [...(byWipInvoice.get(n) || []), hit]);
  }
  return { deals: rows, byWipRef, byWipInvoice };
}

export type MatchResult = { checked: number; linked: number; promoted: number; unmatched: number; ambiguous: string[] };

/** Invoices approved or paid in Xero in the last `sinceDays` that the app
 *  has never seen: match each to a deal and link + promote it. */
export async function matchXeroInvoicesToDeals(session: any | null, sinceDays = 120): Promise<MatchResult> {
  const since = new Date(Date.now() - sinceDays * 86400000);
  const where = encodeURIComponent(`Type=="ACCREC" AND UpdatedDateUTC>=DateTime(${since.getUTCFullYear()},${since.getUTCMonth() + 1},${since.getUTCDate()})`);
  const known = new Set((await db.select({ id: xeroInvoices.xeroInvoiceId }).from(xeroInvoices)).map(r => String(r.id)));
  const ctx = await loadDeals();
  console.log(`[xero-invoices] matching against ${ctx.deals.length} deals (${ctx.byWipRef.size} Sage job numbers and ${ctx.byWipInvoice.size} invoice numbers on the WIP, ${ctx.deals.filter(d => d.parties.length).length} with a named party)`);
  const out: MatchResult = { checked: 0, linked: 0, promoted: 0, unmatched: 0, ambiguous: [] };
  for (let page = 1; page <= 10; page++) {
    const res = await xeroGet(session, `/Invoices?Statuses=AUTHORISED,PAID&where=${where}&order=UpdatedDateUTC%20DESC&page=${page}`);
    const list: any[] = res.Invoices || [];
    for (const inv of list) {
      if (!inv.InvoiceID || known.has(String(inv.InvoiceID))) continue;
      out.checked++;
      const m = matchDeal(inv, ctx);
      if (!m) {
        out.unmatched++;
        // Say what the matcher saw, so a run that links nothing can be
        // read from the log (first 40 per run).
        if (out.unmatched <= 40) console.log(`[xero-invoices] unmatched ${inv.InvoiceNumber || inv.InvoiceID} | ref: ${String(inv.Reference || "").slice(0, 80)} | contact: ${String(inv.Contact?.Name || "").slice(0, 50)} | net: ${inv.SubTotal ?? inv.Total} | line: ${String(inv.LineItems?.[0]?.Description || "").slice(0, 100).replace(/\s+/g, " ")}`);
        continue;
      }
      if ("ambiguous" in m) { out.ambiguous.push(`${inv.InvoiceNumber || inv.InvoiceID}: ${m.ambiguous}`); continue; }
      try {
        known.add(String(inv.InvoiceID));
        out.linked++;
        if (await linkInvoiceToDeal(inv, m.deal, m.by)) out.promoted++;
      } catch (e: any) {
        console.warn(`[xero-invoices] link failed for ${inv.InvoiceNumber || inv.InvoiceID}:`, e?.message);
      }
    }
    if (list.length < 100) break;
    await sleep(1100);
  }
  if (out.ambiguous.length) console.warn(`[xero-invoices] ${out.ambiguous.length} invoice(s) match more than one deal — link them by hand: ${out.ambiguous.slice(0, 10).join("; ")}`);
  return out;
}

/** The webhook's door: one invoice changed in Xero. */
export async function handleXeroInvoiceEvent(xeroInvoiceId: string): Promise<void> {
  const [row] = await db.select().from(xeroInvoices).where(eq(xeroInvoices.xeroInvoiceId, xeroInvoiceId)).limit(1);
  const inv = (await xeroGet(null, `/Invoices/${xeroInvoiceId}`)).Invoices?.[0];
  if (!inv) { console.log(`[xero-webhook] invoice ${xeroInvoiceId} not readable — ignored`); return; }
  if (row) {
    const promoted = await applyXeroInvoice(row, inv);
    console.log(`[xero-webhook] invoice ${inv.InvoiceNumber || xeroInvoiceId} → ${inv.Status}${promoted ? " (deal → INV)" : ""}`);
    return;
  }
  if (String(inv.Type) !== "ACCREC" || !XERO_INVOICED_STATUSES.includes(String(inv.Status))) return;
  const m = matchDeal(inv, await loadDeals());
  if (!m || "ambiguous" in m) { console.log(`[xero-webhook] invoice ${inv.InvoiceNumber || xeroInvoiceId} not matched to a deal${m && "ambiguous" in m ? ` (${m.ambiguous})` : ""}`); return; }
  await linkInvoiceToDeal(inv, m.deal, m.by);
}

/** The hourly door (and Refresh Xero when a session is passed). */
export async function runXeroInvoiceSync(session: any | null = null): Promise<{ sync: SyncResult; match: MatchResult | null }> {
  const sync = await syncKnownInvoices(session);
  let match: MatchResult | null = null;
  try {
    match = await matchXeroInvoicesToDeals(session);
  } catch (e: any) {
    console.warn("[xero-invoices] matching invoices raised in Xero failed:", e?.message);
  }
  if (sync.promoted || match?.promoted || match?.linked) console.log(`[xero-invoices] ${sync.synced} refreshed, ${sync.promoted} deals → INV; ${match?.linked ?? 0} invoices raised in Xero linked (${match?.promoted ?? 0} deals → INV), ${match?.unmatched ?? 0} unmatched`);
  return { sync, match };
}
