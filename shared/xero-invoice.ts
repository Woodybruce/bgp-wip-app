// Xero invoices worked from the app (Woody, 20 November 2026, on draft
// INV-05587: "at this point need the ability to edit that draft or also see
// that draft in the app ... and also delete it if the deal gets deleted from
// the app ... does the api allow for approval and email from the app? ... so
// layla doesn't need to go on to Xero"; 24 November 2026, asked who may
// approve and send: "xero all admin"). What each Xero status allows, what
// deleting a transaction does to its invoices, and the checks on an edit.
// Server: server/xero-invoice-actions.ts. Screen: the invoice window on a
// transaction's Fees & invoicing pill (client/src/components/xero-invoice-window.tsx).

export const XERO_STATUS_WORDS: Record<string, string> = {
  DRAFT: "Draft in Xero",
  SUBMITTED: "Awaiting approval",
  AUTHORISED: "Approved",
  PAID: "Paid",
  VOIDED: "Voided",
  DELETED: "Deleted",
  ERROR: "Error",
};

export const xeroStatusOf = (status: string | null | undefined): string => String(status || "DRAFT").trim().toUpperCase() || "DRAFT";
export const xeroStatusWords = (status: string | null | undefined): string => {
  const s = xeroStatusOf(status);
  return XERO_STATUS_WORDS[s] || s.charAt(0) + s.slice(1).toLowerCase();
};

const isDraft = (s: string) => s === "DRAFT" || s === "SUBMITTED";

export interface InvoiceActionFacts {
  status: string | null | undefined;
  // Has Xero got it? A row whose create failed (status ERROR) has no Xero id.
  inXero: boolean;
  // An admin (users.is_admin or ADMIN_EMAILS): approves, emails and voids.
  admin: boolean;
  amountPaid?: number | null;
}

export interface InvoiceActions {
  pdf: boolean;
  // Any BGP person edits a draft and deletes one, as any BGP person makes one.
  edit: boolean;
  deleteDraft: boolean;
  // Admins only (Woody, 24 November 2026: "xero all admin").
  approve: boolean;
  email: boolean;
  void: boolean;
  // Take the row off the transaction: Xero no longer holds a live invoice for it.
  remove: boolean;
}

export function invoiceActions(f: InvoiceActionFacts): InvoiceActions {
  const s = xeroStatusOf(f.status);
  const paidSome = Number(f.amountPaid || 0) > 0;
  const live = f.inXero && s !== "ERROR";
  return {
    pdf: live && s !== "DELETED",
    edit: live && isDraft(s),
    deleteDraft: live && isDraft(s),
    approve: live && f.admin && isDraft(s),
    // Xero emails SUBMITTED, AUTHORISED or PAID invoices; BGP sends only what
    // an admin has approved (a paid one again as a copy).
    email: live && f.admin && (s === "AUTHORISED" || s === "PAID"),
    // Xero voids an approved invoice with no payment against it.
    void: live && f.admin && s === "AUTHORISED" && !paidSome,
    remove: !live || s === "DELETED" || s === "VOIDED",
  };
}

// ── Deleting a transaction ───────────────────────────────────────────────────

export interface InvoiceRowFacts { id: string; xeroInvoiceId: string | null; status: string | null; invoiceNumber: string | null }

export interface DealDeleteXeroPlan {
  // Approved or paid in Xero: the transaction is kept until it is voided (approved) or for good (paid).
  refuse: InvoiceRowFacts[];
  // Drafts: deleted in Xero (Status DELETED) before the transaction goes.
  drafts: InvoiceRowFacts[];
  // Nothing live in Xero: the rows go with the transaction.
  drop: InvoiceRowFacts[];
}

export function dealDeleteXeroPlan(rows: InvoiceRowFacts[]): DealDeleteXeroPlan {
  const plan: DealDeleteXeroPlan = { refuse: [], drafts: [], drop: [] };
  for (const r of rows) {
    const s = xeroStatusOf(r.status);
    if (!r.xeroInvoiceId || s === "ERROR" || s === "DELETED" || s === "VOIDED") plan.drop.push(r);
    else if (isDraft(s)) plan.drafts.push(r);
    // Approved, paid, or a status the app does not know: a person looks first.
    else plan.refuse.push(r);
  }
  return plan;
}

const invoiceName = (r: Pick<InvoiceRowFacts, "invoiceNumber">) => r.invoiceNumber ? `Invoice ${r.invoiceNumber}` : "An invoice";

/** Why a transaction with a live invoice is kept; `count` is how many transactions were asked about. */
export function dealDeleteRefusal(refuse: InvoiceRowFacts[], count = 1): string | null {
  if (!refuse.length) return null;
  const r = refuse[0];
  const s = xeroStatusOf(r.status);
  const what = s === "PAID"
    ? `${invoiceName(r)} is paid in Xero, so the transaction is kept.`
    : s === "AUTHORISED"
      ? `${invoiceName(r)} is approved in Xero. An admin can void it under Fees & invoicing; then the transaction can be deleted.`
      : `${invoiceName(r)} is ${xeroStatusWords(s).toLowerCase()} in Xero. Check it in Xero before deleting the transaction.`;
  const more = refuse.length > 1 ? ` (${refuse.length - 1} more invoice${refuse.length > 2 ? "s" : ""} too.)` : "";
  return count > 1 ? `One of these transactions: ${what}${more}` : `${what}${more}`;
}

// ── Editing a draft ──────────────────────────────────────────────────────────

export interface InvoiceLineInput {
  lineItemId: string | null;
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string | null;
  taxType: string | null;
}

export interface InvoiceEdit {
  lines: InvoiceLineInput[];
  date: string | null;
  dueDate: string | null;
  reference: string | null;
  contactId: string | null;
}

export const INVOICE_MAX_LINES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function realDay(value: unknown): string | null | false {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : false;
}

const money = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/**
 * What a person sends to change a draft, checked. Lines replace the invoice's
 * lines (Xero deletes a line not sent), so every line is sent; a line keeps its
 * account code and tax type when it carries its Xero line id. The contact is
 * sent by its Xero id only: sending a contact's name or details would change
 * the contact itself in Xero.
 */
export function invoiceEditInput(body: any): { ok: true; edit: InvoiceEdit } | { ok: false; message: string } {
  const raw = Array.isArray(body?.lines) ? body.lines
    // The older form: one line from a description, body and amount.
    : body && (body.description != null || body.amount != null)
      ? [{ description: [String(body.description || "").trim() || "Professional fees", String(body.body || "").trim()].filter(Boolean).join("\n\n"), quantity: 1, unitAmount: body.amount }]
      : null;
  if (!raw || !raw.length) return { ok: false, message: "An invoice needs at least one line." };
  if (raw.length > INVOICE_MAX_LINES) return { ok: false, message: `An invoice here takes up to ${INVOICE_MAX_LINES} lines.` };
  const lines: InvoiceLineInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i] || {};
    const n = raw.length > 1 ? ` on line ${i + 1}` : "";
    const description = String(l.description ?? "").replace(/\r\n/g, "\n").trim();
    if (!description) return { ok: false, message: `Add the words${n}.` };
    if (description.length > 4000) return { ok: false, message: `The words${n} are too long for Xero (4,000 characters).` };
    const quantity = l.quantity == null || l.quantity === "" ? 1 : Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return { ok: false, message: `Check the quantity${n}.` };
    const unitAmount = money(l.unitAmount);
    if (unitAmount == null || Math.abs(unitAmount) >= 1e10) return { ok: false, message: `Check the amount${n}.` };
    const accountCode = l.accountCode == null || l.accountCode === "" ? null : String(l.accountCode).trim();
    if (accountCode != null && !/^[A-Za-z0-9.\-]{1,10}$/.test(accountCode)) return { ok: false, message: `Check the account code${n}.` };
    const taxType = l.taxType == null || l.taxType === "" ? null : String(l.taxType).trim().toUpperCase();
    if (taxType != null && !/^[A-Z0-9_]{2,30}$/.test(taxType)) return { ok: false, message: `Check the tax type${n}.` };
    const lineItemId = l.lineItemId && UUID.test(String(l.lineItemId)) ? String(l.lineItemId) : null;
    lines.push({ lineItemId, description, quantity: Math.round(quantity * 10000) / 10000, unitAmount, accountCode, taxType });
  }
  const date = realDay(body?.date);
  if (date === false) return { ok: false, message: "Check the invoice date." };
  const dueDate = realDay(body?.dueDate);
  if (dueDate === false) return { ok: false, message: "Check the due date." };
  if (date && dueDate && dueDate < date) return { ok: false, message: "The due date is before the invoice date." };
  const reference = body?.reference == null ? null : String(body.reference).trim();
  if (reference != null && reference.length > 255) return { ok: false, message: "The reference is too long for Xero (255 characters)." };
  const contactId = body?.contactId == null || body.contactId === "" ? null : String(body.contactId);
  if (contactId != null && !UUID.test(contactId)) return { ok: false, message: "Pick the contact from Xero." };
  return { ok: true, edit: { lines, date, dueDate, reference, contactId } };
}

export interface XeroLineNow { LineItemID?: string; AccountCode?: string; TaxType?: string }

/** The body Xero takes to change a draft (POST /Invoices). */
export function xeroEditPayload(xeroInvoiceId: string, edit: InvoiceEdit, now: { lines: XeroLineNow[] }, defaults: { accountCode: string; taxType: string }): Record<string, any> {
  const byId = new Map(now.lines.filter(l => l.LineItemID).map(l => [String(l.LineItemID), l]));
  const payload: Record<string, any> = {
    InvoiceID: xeroInvoiceId,
    LineAmountTypes: "Exclusive",
    LineItems: edit.lines.map(l => {
      const was = l.lineItemId ? byId.get(l.lineItemId) : undefined;
      return {
        ...(was ? { LineItemID: l.lineItemId } : {}),
        Description: l.description,
        Quantity: l.quantity,
        UnitAmount: l.unitAmount,
        AccountCode: l.accountCode || was?.AccountCode || defaults.accountCode,
        TaxType: l.taxType || was?.TaxType || defaults.taxType,
      };
    }),
  };
  if (edit.date) payload.Date = edit.date;
  if (edit.dueDate) payload.DueDate = edit.dueDate;
  if (edit.reference != null) payload.Reference = edit.reference;
  if (edit.contactId) payload.Contact = { ContactID: edit.contactId };
  return payload;
}

// ── Reading Xero's answer ────────────────────────────────────────────────────

/** A Xero date as yyyy-mm-dd: "2026-11-24T00:00:00" or the older "/Date(1763942400000+0000)/". */
export function xeroDay(value: unknown): string | null {
  if (value == null || value === "") return null;
  const s = String(value);
  const ms = /^\/Date\((-?\d+)/.exec(s);
  if (ms) {
    const d = new Date(Number(ms[1]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return DAY.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
}

export interface InvoiceLineView {
  lineItemId: string | null;
  description: string;
  quantity: number | null;
  unitAmount: number | null;
  accountCode: string | null;
  taxType: string | null;
  taxAmount: number | null;
  lineAmount: number | null;
}

export interface XeroInvoiceView {
  xeroInvoiceId: string;
  number: string | null;
  status: string;
  statusWords: string;
  contact: { id: string | null; name: string | null };
  date: string | null;
  dueDate: string | null;
  reference: string | null;
  currency: string | null;
  lines: InvoiceLineView[];
  subTotal: number | null;
  totalTax: number | null;
  total: number | null;
  amountDue: number | null;
  amountPaid: number | null;
  sentToContact: boolean;
  updatedAt: string | null;
}

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function invoiceViewFrom(inv: any): XeroInvoiceView {
  const status = xeroStatusOf(inv?.Status);
  return {
    xeroInvoiceId: String(inv?.InvoiceID || ""),
    number: inv?.InvoiceNumber ? String(inv.InvoiceNumber) : null,
    status,
    statusWords: xeroStatusWords(status),
    contact: { id: inv?.Contact?.ContactID ? String(inv.Contact.ContactID) : null, name: inv?.Contact?.Name ? String(inv.Contact.Name) : null },
    date: xeroDay(inv?.DateString ?? inv?.Date),
    dueDate: xeroDay(inv?.DueDateString ?? inv?.DueDate),
    reference: inv?.Reference ? String(inv.Reference) : null,
    currency: inv?.CurrencyCode ? String(inv.CurrencyCode) : null,
    lines: (Array.isArray(inv?.LineItems) ? inv.LineItems : []).map((l: any) => ({
      lineItemId: l?.LineItemID ? String(l.LineItemID) : null,
      description: String(l?.Description || ""),
      quantity: num(l?.Quantity),
      unitAmount: num(l?.UnitAmount),
      accountCode: l?.AccountCode ? String(l.AccountCode) : null,
      taxType: l?.TaxType ? String(l.TaxType) : null,
      taxAmount: num(l?.TaxAmount),
      lineAmount: num(l?.LineAmount),
    })),
    subTotal: num(inv?.SubTotal),
    totalTax: num(inv?.TotalTax),
    total: num(inv?.Total),
    amountDue: num(inv?.AmountDue),
    amountPaid: num(inv?.AmountPaid),
    sentToContact: inv?.SentToContact === true,
    updatedAt: xeroDay(inv?.UpdatedDateUTC),
  };
}

export interface EmailRecipients { primary: string | null; others: string[] }

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const plausibleEmail = (value: unknown): boolean => EMAIL.test(String(value || "").trim());

/** Who Xero emails an invoice to: the contact's own address and each contact person marked to receive emails. */
export function emailRecipients(contact: any): EmailRecipients {
  const primary = plausibleEmail(contact?.EmailAddress) ? String(contact.EmailAddress).trim() : null;
  const others = (Array.isArray(contact?.ContactPersons) ? contact.ContactPersons : [])
    .filter((p: any) => p?.IncludeInEmails === true && plausibleEmail(p?.EmailAddress))
    .map((p: any) => String(p.EmailAddress).trim())
    .filter((e: string) => e.toLowerCase() !== primary?.toLowerCase());
  return { primary, others: Array.from(new Set(others)) };
}

export function emailRecipientWords(r: EmailRecipients): string {
  if (!r.primary && !r.others.length) return "Xero has no email address for this contact.";
  const all = [r.primary, ...r.others].filter(Boolean) as string[];
  return `Xero emails it to ${all.join(", ")}.`;
}

/** Xero's own words for a refusal, from the error the API helper throws ("Xero API error: 400 - {...}"). */
export function xeroErrorWords(message: string | null | undefined): string {
  const text = String(message || "");
  const m = /^Xero API error: (\d{3}) - ([\s\S]*)$/.exec(text);
  if (!m) return text || "Xero did not answer.";
  const status = Number(m[1]);
  let body: any = null;
  try { body = JSON.parse(m[2]); } catch { /* not JSON */ }
  const found: string[] = [];
  const walk = (x: any) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (Array.isArray(x.ValidationErrors)) for (const v of x.ValidationErrors) if (v?.Message) found.push(String(v.Message));
    for (const k of Object.keys(x)) if (k !== "ValidationErrors") walk(x[k]);
  };
  walk(body);
  const unique = Array.from(new Set(found));
  if (unique.length) return `Xero says: ${unique.join(" ")}`;
  if (status === 401 || status === 403) return "Xero refused this for your Xero login. Ask whoever runs BGP's Xero to let your login approve and send invoices, then connect Xero again.";
  if (status === 404) return "Xero no longer has this invoice.";
  const plain = body?.Detail || body?.Message || body?.Title;
  return plain ? `Xero says: ${String(plain)}` : `Xero answered ${status}.`;
}
