// Xero invoices worked from the app, so accounts need not open Xero (Woody,
// 20 November 2026, on draft INV-05587: "at this point need the ability to
// edit that draft or also see that draft in the app ... and also delete it if
// the deal gets deleted from the app ... does the api allow for approval and
// email from the app? ... so layla doesn't need to go on to Xero"; 24 November
// 2026, asked who may approve and send: "xero all admin").
//
// Reading (the invoice in full, its PDF) and changing or deleting a draft are
// for any BGP person, as making a draft is. Approving, emailing and voiding are
// for admins. Writes go through the person's own Xero connection, so Xero
// records who did it and the email goes out in their name; reads fall back to
// the firm's connection. Rules: shared/xero-invoice.ts.
import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth, ADMIN_EMAILS } from "./auth";
import { db, pool } from "./db";
import { xeroInvoices } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SALES_ACCOUNT_CODE, salesAccountCode, xeroApi, xeroFetch, xeroNetAmount } from "./xero";
import {
  dealDeleteRefusal, dealDeleteXeroPlan, emailRecipients, emailRecipientWords, invoiceActions, invoiceEditInput, invoiceViewFrom,
  plausibleEmail, xeroDay, xeroEditPayload, xeroErrorWords, xeroStatusOf, xeroStatusWords, type InvoiceRowFacts,
} from "@shared/xero-invoice";

type Row = typeof xeroInvoices.$inferSelect;
interface Caller { id: string; name: string; admin: boolean }

const text = (v: unknown) => (v == null ? "" : String(v).trim());

// BGP staff signed in as themselves, and whether an admin (requireAdmin's test).
async function caller(req: Request): Promise<Caller | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email, is_admin, is_active FROM users WHERE id = $1`, [userId])).rows[0];
  if (!u || u.is_active === false) return null;
  const email = text(u.email).toLowerCase();
  return { id: String(u.id), name: text(u.name) || email, admin: !!u.is_admin || ADMIN_EMAILS.has(email) };
}

async function rowOf(id: string): Promise<Row | null> {
  const [row] = await db.select().from(xeroInvoices).where(eq(xeroInvoices.id, id));
  return row || null;
}

// Reads try the person's own connection, then the firm's.
async function readXero<T>(session: any, run: (s: any) => Promise<T>): Promise<T> {
  if (session) {
    try { return await run(session); } catch (e: any) { if (!String(e?.message || "").includes("Not connected")) throw e; }
  }
  const { withSystemXero } = await import("./xero-system-session");
  const out = await withSystemXero(s => run(s));
  if (out === null) throw new Error("Not connected to Xero");
  return out as T;
}

async function fetchInvoice(session: any, xeroInvoiceId: string, own = false): Promise<any> {
  const get = (s: any) => xeroApi(s, `/Invoices/${encodeURIComponent(xeroInvoiceId)}`);
  const out = own ? await get(session) : await readXero(session, get);
  const inv = out?.Invoices?.[0];
  if (!inv) throw new Error("Xero API error: 404 - ");
  return inv;
}

// What Xero now says, onto the row the transaction lists (and, once approved
// or paid, the transaction to Invoiced: server/xero-invoice-sync.ts).
async function keep(row: Row, inv: any): Promise<void> {
  const { applyXeroInvoice } = await import("./xero-invoice-sync");
  await applyXeroInvoice(row, inv).catch((e: any) => console.warn(`[xero-invoice] row ${row.id} not refreshed:`, e?.message));
}

async function historyLine(dealId: string, field: string, oldValue: string | null, newValue: string, reason: string, me: Caller | null) {
  await pool.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [dealId, field, oldValue, newValue.slice(0, 2000), reason.slice(0, 2000), me?.id || null, me?.name || null],
  ).catch((e: any) => console.warn(`[xero-invoice] history line not written: ${e?.message}`));
}

// A note on the invoice's history in Xero (it shows there as System Generated).
async function xeroNote(session: any, xeroInvoiceId: string, details: string): Promise<void> {
  await xeroApi(session, `/Invoices/${encodeURIComponent(xeroInvoiceId)}/History`, {
    method: "PUT", body: JSON.stringify({ HistoryRecords: [{ Details: details.slice(0, 2500) }] }),
  }).catch((e: any) => console.warn("[xero-invoice] note not added in Xero:", e?.message));
}

const invName = (row: Pick<Row, "invoiceNumber">) => row.invoiceNumber ? `Invoice ${row.invoiceNumber}` : "The invoice";

function fail(res: Response, e: any, what: string) {
  const message = String(e?.message || "");
  if (message.includes("Not connected")) return res.status(401).json({ code: "XERO_CONNECT", message: "Connect Xero first: changes go through your own Xero login." });
  if (/rate-limiting/i.test(message)) return res.status(429).json({ message });
  console.error(`[xero-invoice] ${what}:`, message);
  return res.status(502).json({ message: xeroErrorWords(message) });
}

async function stopped(dealId: string): Promise<string | null> {
  const { stoppedDealIds } = await import("./aml-stop");
  if (!(await stoppedDealIds([dealId])).size) return null;
  const { AML_STOP_REFUSAL } = await import("@shared/aml-stop");
  return AML_STOP_REFUSAL;
}

// The last email sent from the app for this invoice (the history line keeps the row's id).
async function lastEmail(row: Row): Promise<{ at: string; by: string | null; to: string } | null> {
  const r = (await pool.query(
    `SELECT created_at, changed_by_name, new_value FROM deal_audit_log WHERE deal_id = $1 AND field = 'xero_invoice_emailed' AND old_value = $2 ORDER BY created_at DESC LIMIT 1`,
    [row.dealId, row.id]).catch(() => ({ rows: [] as any[] }))).rows[0];
  return r ? { at: new Date(r.created_at).toISOString(), by: r.changed_by_name || null, to: String(r.new_value || "") } : null;
}

const SENT_AGAIN_MINUTES = 10;

/**
 * Before a transaction is deleted (Woody, 20 November 2026: "also delete it if
 * the deal gets deleted from the app"): its draft invoices are deleted in Xero,
 * and an approved or paid one keeps the transaction (an admin voids an
 * approved one first; a paid one is kept for good). A draft Xero could not be
 * reached for keeps the transaction too, so no draft is left behind in Xero.
 * Called by the delete routes with the person's session, and by
 * storage.deleteCrmDeal for every other caller with the firm's.
 */
export async function xeroBeforeDealDelete(dealIds: string[], session: any | null, me: Caller | null = null): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!dealIds.length) return { ok: true };
  const rows = (await pool.query(
    `SELECT id, deal_id, xero_invoice_id, status, invoice_number FROM xero_invoices WHERE deal_id = ANY($1::varchar[])`, [dealIds])).rows;
  if (!rows.length) return { ok: true };
  const facts: Array<InvoiceRowFacts & { dealId: string }> = rows.map((r: any) => ({
    id: String(r.id), dealId: String(r.deal_id), xeroInvoiceId: r.xero_invoice_id || null, status: r.status || null, invoiceNumber: r.invoice_number || null,
  }));
  const plan = dealDeleteXeroPlan(facts);
  const refusal = dealDeleteRefusal(plan.refuse, dealIds.length);
  if (refusal) return { ok: false, code: "XERO_INVOICE_LIVE", message: refusal };
  for (const d of plan.drafts as Array<InvoiceRowFacts & { dealId: string }>) {
    try {
      await readXero(session, s => xeroApi(s, "/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [{ InvoiceID: d.xeroInvoiceId, Status: "DELETED" }] }) }));
      await pool.query(`UPDATE xero_invoices SET status = 'DELETED', updated_at = now() WHERE id = $1`, [d.id]);
      await historyLine(d.dealId, "xero_invoice_deleted", d.id, d.invoiceNumber || "draft", `Draft ${d.invoiceNumber || ""} deleted in Xero with the transaction`.replace(/\s+/g, " "), me);
    } catch (e: any) {
      // Deleted, voided or approved in Xero since the app last looked: what is it now?
      const now = await readXero(session, s => xeroApi(s, `/Invoices/${encodeURIComponent(String(d.xeroInvoiceId))}`)).then((o: any) => o?.Invoices?.[0]).catch(() => null);
      const s = now ? xeroStatusOf(now.Status) : null;
      if (s) await pool.query(`UPDATE xero_invoices SET status = $2, updated_at = now() WHERE id = $1`, [d.id, s]).catch(() => undefined);
      if (s === "DELETED" || s === "VOIDED") continue;
      if (s && s !== "DRAFT" && s !== "SUBMITTED") return { ok: false, code: "XERO_INVOICE_LIVE", message: dealDeleteRefusal([{ ...d, status: s }], dealIds.length) || "" };
      return {
        ok: false, code: "XERO_UNREACHABLE",
        message: `Draft ${d.invoiceNumber || "invoice"} could not be deleted in Xero (${xeroErrorWords(e?.message)}), so the transaction is kept. Try again, or delete the draft in Xero first.`,
      };
    }
  }
  return { ok: true };
}

export function setupXeroInvoiceRoutes(app: Express) {
  // The invoice as Xero holds it (refreshing the row the transaction lists), and what this person may do with it.
  app.get("/api/xero/invoices/:id/detail", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me) return res.status(403).json({ message: "BGP staff only." });
    const row = await rowOf(String(req.params.id));
    if (!row) return res.status(404).json({ message: "Invoice not found." });
    const base = { row: { id: row.id, dealId: row.dealId, status: row.status, invoiceNumber: row.invoiceNumber, errorMessage: row.errorMessage, xeroUrl: row.xeroUrl }, admin: me.admin };
    if (!row.xeroInvoiceId) return res.json({ ...base, view: null, actions: invoiceActions({ status: row.status, inXero: false, admin: me.admin }), emailed: null });
    try {
      const inv = await fetchInvoice(req.session, row.xeroInvoiceId);
      await keep(row, inv);
      const view = invoiceViewFrom(inv);
      res.json({ ...base, view, actions: invoiceActions({ status: view.status, inXero: true, admin: me.admin, amountPaid: view.amountPaid }), emailed: await lastEmail(row) });
    } catch (e: any) { fail(res, e, "read"); }
  });

  // The invoice as Xero prints it, for the pop-out viewer.
  app.get("/api/xero/invoices/:id/pdf", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me) return res.status(403).json({ message: "BGP staff only." });
    const row = await rowOf(String(req.params.id));
    if (!row?.xeroInvoiceId) return res.status(404).json({ message: "Xero has no copy of this invoice." });
    try {
      const pdf = await readXero(req.session, async s => {
        const r = await xeroFetch(s, `/Invoices/${encodeURIComponent(row.xeroInvoiceId!)}`, { headers: { Accept: "application/pdf" } });
        return Buffer.from(await r.arrayBuffer());
      });
      if (pdf.subarray(0, 4).toString("latin1") !== "%PDF") return res.status(502).json({ message: "Xero did not send a PDF of this invoice." });
      const name = `${(row.invoiceNumber || "invoice").replace(/[^A-Za-z0-9._-]/g, "")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${name}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(pdf);
    } catch (e: any) { fail(res, e, "pdf"); }
  });

  // Change a draft: every line, the dates, the reference, the contact (by its Xero id).
  app.put("/api/xero/invoices/:id", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me) return res.status(403).json({ message: "BGP staff only." });
    const row = await rowOf(String(req.params.id));
    if (!row) return res.status(404).json({ message: "Invoice not found." });
    if (!row.xeroInvoiceId) return res.status(400).json({ message: "This invoice never reached Xero." });
    const input = invoiceEditInput(req.body);
    if (!input.ok) return res.status(400).json({ message: input.message });
    try {
      const now = await fetchInvoice(req.session, row.xeroInvoiceId, true);
      const status = xeroStatusOf(now.Status);
      if (status !== "DRAFT" && status !== "SUBMITTED") {
        await keep(row, now);
        return res.status(409).json({ message: `${invName(row)} is ${xeroStatusWords(status).toLowerCase()} in Xero now, so it can't be changed here.` });
      }
      const payload = xeroEditPayload(row.xeroInvoiceId, input.edit, { lines: now.LineItems || [] }, { accountCode: SALES_ACCOUNT_CODE, taxType: "OUTPUT2" });
      payload.LineItems = payload.LineItems.map((l: any) => ({ ...l, AccountCode: salesAccountCode(l.AccountCode) }));
      const out = await xeroApi(req.session, "/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [payload] }) });
      const updated = out?.Invoices?.[0];
      if (!updated) return res.status(502).json({ message: "Xero did not send the changed invoice back." });
      await db.update(xeroInvoices).set({
        status: updated.Status,
        totalAmount: updated.Total,
        invoiceNumber: updated.InvoiceNumber,
        reference: updated.Reference ?? row.reference,
        dueDate: xeroDay(updated.DueDateString ?? updated.DueDate) ?? row.dueDate,
        contactName: updated.Contact?.Name ?? row.contactName,
        xeroContactId: updated.Contact?.ContactID ?? row.xeroContactId,
        lineDescription: updated.LineItems?.[0]?.Description ?? row.lineDescription,
        lineAmount: xeroNetAmount(updated, row.lineAmount),
        syncedAt: new Date(),
        updatedAt: new Date(),
      } as any).where(eq(xeroInvoices.id, row.id));
      await historyLine(row.dealId, "xero_invoice_edited", row.id, `${updated.InvoiceNumber || "draft"} · ${updated.Total ?? ""}`, `Draft ${updated.InvoiceNumber || ""} changed in Xero from the app`.replace(/\s+/g, " "), me);
      const view = invoiceViewFrom(updated);
      res.json({ ok: true, view, actions: invoiceActions({ status: view.status, inXero: true, admin: me.admin, amountPaid: view.amountPaid }) });
    } catch (e: any) { fail(res, e, "edit"); }
  });

  // Who Xero will email: the contact's own address and its contact persons marked to receive emails.
  app.get("/api/xero/invoices/:id/recipients", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me?.admin) return res.status(403).json({ message: "Only an admin sends invoices." });
    const row = await rowOf(String(req.params.id));
    if (!row?.xeroInvoiceId) return res.status(404).json({ message: "Invoice not found." });
    try {
      const inv = await fetchInvoice(req.session, row.xeroInvoiceId);
      const contactId = inv?.Contact?.ContactID;
      if (!contactId) return res.json({ contactName: null, recipients: { primary: null, others: [] }, words: "This invoice has no contact in Xero." });
      const c = (await readXero(req.session, s => xeroApi(s, `/Contacts/${encodeURIComponent(contactId)}`)))?.Contacts?.[0];
      const recipients = emailRecipients(c);
      res.json({ contactName: c?.Name || inv?.Contact?.Name || null, recipients, words: emailRecipientWords(recipients), emailed: await lastEmail(row) });
    } catch (e: any) { fail(res, e, "recipients"); }
  });

  // Email it to the client from Xero: Xero's default template, from messaging-service@post.xero.com, replies as BGP's Xero settings say.
  async function emailInvoice(req: Request, me: Caller, row: Row, inv: any): Promise<{ status: number; body: any }> {
    const status = xeroStatusOf(inv.Status);
    if (status !== "AUTHORISED" && status !== "PAID") return { status: 409, body: { message: `${invName(row)} is ${xeroStatusWords(status).toLowerCase()} in Xero: approve it first.` } };
    if (req.body?.again !== true) {
      const last = await lastEmail(row);
      if (last && Date.now() - Date.parse(last.at) < SENT_AGAIN_MINUTES * 60_000) {
        const mins = Math.max(1, Math.round((Date.now() - Date.parse(last.at)) / 60_000));
        return { status: 409, body: { code: "SENT_RECENTLY", message: `Emailed ${mins} minute${mins === 1 ? "" : "s"} ago${last.by ? ` by ${last.by}` : ""}. Send it again?`, emailed: last } };
      }
    }
    const contactId = inv?.Contact?.ContactID;
    if (!contactId) return { status: 409, body: { message: "This invoice has no contact in Xero." } };
    const contact = (await xeroApi(req.session, `/Contacts/${encodeURIComponent(contactId)}`))?.Contacts?.[0];
    let recipients = emailRecipients(contact);
    if (!recipients.primary && !recipients.others.length) {
      const given = text(req.body?.setEmail);
      if (!plausibleEmail(given)) {
        return { status: 409, body: { code: "NO_EMAIL", message: `Xero has no email address for ${contact?.Name || "this contact"}. Give the address the invoice goes to.` } };
      }
      // Only a blank address is filled: the contact persons go back as they were, so none is lost.
      await xeroApi(req.session, "/Contacts", {
        method: "POST",
        body: JSON.stringify({ Contacts: [{ ContactID: contactId, EmailAddress: given, ...(Array.isArray(contact?.ContactPersons) && contact.ContactPersons.length ? { ContactPersons: contact.ContactPersons } : {}) }] }),
      });
      recipients = { primary: given, others: [] };
    }
    const key = /^[A-Za-z0-9-]{8,64}$/.test(text(req.body?.key)) ? text(req.body.key) : randomUUID();
    await xeroFetch(req.session, `/Invoices/${encodeURIComponent(row.xeroInvoiceId!)}/Email`, { method: "POST", headers: { "Idempotency-Key": `email-${key}` } });
    if (status === "AUTHORISED") {
      // Marked as sent, so Xero's overdue reminders follow it.
      await xeroApi(req.session, "/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [{ InvoiceID: row.xeroInvoiceId, SentToContact: true }] }) })
        .catch((e: any) => console.warn("[xero-invoice] not marked as sent:", e?.message));
    }
    const to = [recipients.primary, ...recipients.others].filter(Boolean).join(", ");
    await historyLine(row.dealId, "xero_invoice_emailed", row.id, to, `${invName(row)} emailed from Xero to ${to}`, me);
    return { status: 200, body: { ok: true, to } };
  }

  app.post("/api/xero/invoices/:id/approve", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me?.admin) return res.status(403).json({ message: "Only an admin approves invoices." });
    const row = await rowOf(String(req.params.id));
    if (!row?.xeroInvoiceId) return res.status(404).json({ message: "Invoice not found." });
    const stop = await stopped(row.dealId);
    if (stop) return res.status(409).json({ code: "AML_STOPPED", message: stop });
    try {
      const now = await fetchInvoice(req.session, row.xeroInvoiceId, true);
      const status = xeroStatusOf(now.Status);
      if (status !== "DRAFT" && status !== "SUBMITTED") {
        await keep(row, now);
        return res.status(409).json({ message: `${invName(row)} is ${xeroStatusWords(status).toLowerCase()} in Xero already.` });
      }
      const out = await xeroApi(req.session, "/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [{ InvoiceID: row.xeroInvoiceId, Status: "AUTHORISED" }] }) });
      const approved = out?.Invoices?.[0];
      if (!approved) return res.status(502).json({ message: "Xero did not send the approved invoice back." });
      await keep(row, approved);
      await historyLine(row.dealId, "xero_invoice_approved", row.id, approved.InvoiceNumber || "", `${approved.InvoiceNumber ? `Invoice ${approved.InvoiceNumber}` : "Invoice"} approved in Xero from the app`, me);
      let email: any = null;
      if (req.body?.andEmail === true) {
        try { email = (await emailInvoice(req, me, { ...row, invoiceNumber: approved.InvoiceNumber || row.invoiceNumber }, approved)); }
        catch (e: any) { email = { status: 502, body: { message: xeroErrorWords(e?.message) } }; }
      }
      const view = invoiceViewFrom(approved);
      res.json({
        ok: true, view, actions: invoiceActions({ status: view.status, inXero: true, admin: me.admin, amountPaid: view.amountPaid }),
        ...(email ? { emailed: email.status === 200 ? email.body : null, emailRefused: email.status === 200 ? null : email.body } : {}),
      });
    } catch (e: any) { fail(res, e, "approve"); }
  });

  app.post("/api/xero/invoices/:id/email", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me?.admin) return res.status(403).json({ message: "Only an admin sends invoices." });
    const row = await rowOf(String(req.params.id));
    if (!row?.xeroInvoiceId) return res.status(404).json({ message: "Invoice not found." });
    const stop = await stopped(row.dealId);
    if (stop) return res.status(409).json({ code: "AML_STOPPED", message: stop });
    try {
      const inv = await fetchInvoice(req.session, row.xeroInvoiceId, true);
      await keep(row, inv);
      const out = await emailInvoice(req, me, row, inv);
      res.status(out.status).json(out.body);
    } catch (e: any) { fail(res, e, "email"); }
  });

  // Void an approved invoice with nothing paid against it.
  app.post("/api/xero/invoices/:id/void", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me?.admin) return res.status(403).json({ message: "Only an admin voids invoices." });
    const row = await rowOf(String(req.params.id));
    if (!row?.xeroInvoiceId) return res.status(404).json({ message: "Invoice not found." });
    try {
      const now = await fetchInvoice(req.session, row.xeroInvoiceId, true);
      const status = xeroStatusOf(now.Status);
      const paid = Number(now.AmountPaid || 0) + Number(now.AmountCredited || 0);
      if (status !== "AUTHORISED") return res.status(409).json({ message: `${invName(row)} is ${xeroStatusWords(status).toLowerCase()} in Xero: only an approved invoice is voided.` });
      if (paid > 0) return res.status(409).json({ message: `${invName(row)} has a payment or credit against it. Remove it in Xero first.` });
      const out = await xeroApi(req.session, "/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [{ InvoiceID: row.xeroInvoiceId, Status: "VOIDED" }] }) });
      const voided = out?.Invoices?.[0];
      if (voided) await keep(row, voided);
      const why = text(req.body?.reason).slice(0, 500);
      await xeroNote(req.session, row.xeroInvoiceId, `Voided from ChatBGP by ${me.name}${why ? `: ${why}` : ""}`);
      await historyLine(row.dealId, "xero_invoice_voided", row.id, row.invoiceNumber || "", `${invName(row)} voided in Xero from the app${why ? `: ${why}` : ""}`, me);
      res.json({ ok: true, status: voided ? xeroStatusOf(voided.Status) : "VOIDED" });
    } catch (e: any) { fail(res, e, "void"); }
  });

  // Delete a draft in Xero (any BGP person, as any BGP person makes one).
  app.post("/api/xero/invoices/:id/delete-draft", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me) return res.status(403).json({ message: "BGP staff only." });
    const row = await rowOf(String(req.params.id));
    if (!row?.xeroInvoiceId) return res.status(404).json({ message: "Invoice not found." });
    try {
      const now = await fetchInvoice(req.session, row.xeroInvoiceId, true);
      const status = xeroStatusOf(now.Status);
      if (status !== "DRAFT" && status !== "SUBMITTED") {
        await keep(row, now);
        return res.status(409).json({ message: `${invName(row)} is ${xeroStatusWords(status).toLowerCase()} in Xero, so it is not a draft to delete.` });
      }
      await xeroApi(req.session, "/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [{ InvoiceID: row.xeroInvoiceId, Status: "DELETED" }] }) });
      await db.update(xeroInvoices).set({ status: "DELETED", updatedAt: new Date() } as any).where(eq(xeroInvoices.id, row.id));
      await historyLine(row.dealId, "xero_invoice_deleted", row.id, row.invoiceNumber || "draft", `Draft ${row.invoiceNumber || ""} deleted in Xero from the app`.replace(/\s+/g, " "), me);
      res.json({ ok: true, status: "DELETED" });
    } catch (e: any) { fail(res, e, "delete draft"); }
  });

  // Take a row off the transaction: only one Xero holds nothing live for.
  app.delete("/api/xero/invoices/:id", requireAuth, async (req: Request, res: Response) => {
    const me = await caller(req);
    if (!me) return res.status(403).json({ message: "BGP staff only." });
    const row = await rowOf(String(req.params.id));
    if (!row) return res.json({ success: true });
    if (!invoiceActions({ status: row.status, inXero: !!row.xeroInvoiceId, admin: me.admin }).remove) {
      return res.status(409).json({ message: `${invName(row)} is ${xeroStatusWords(row.status).toLowerCase()} in Xero. Delete or void it first.` });
    }
    await db.delete(xeroInvoices).where(eq(xeroInvoices.id, row.id));
    res.json({ success: true });
  });
}
