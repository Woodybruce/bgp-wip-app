// ─────────────────────────────────────────────────────────────────────────
// Signature → CRM people completion (Delivery 4, Task 3).
//
// Signature extraction fills email_signatures, but nothing completes the
// deduplicated CRM person from it — the data stops at a display cache. This
// module fills MISSING fields on existing crm_contacts rows from the
// freshest cached signature for the same email address:
//   role / phone / phone_mobile / linkedin_url — filled only when blank.
//     Filling a blank never overwrites anyone, manual or automatic.
//   name — replaced only when the current name is the deterministic
//     local-part placeholder an auto-creator generated AND enrichment_source
//     marks an automatic creation. A human-set name, or any name on a
//     manually created contact, is never touched.
// Creates nothing. No people from marketing recipients, generic mailboxes,
// or company-name mentions — matching is by exact lower(email) only.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import type { Querier } from "./account-resolver";

export interface CrmContactRow {
  id: string;
  name: string | null;
  role: string | null;
  phone: string | null;
  phone_mobile: string | null;
  linkedin_url: string | null;
  email: string | null;
  enrichment_source: string | null;
}

export interface SignatureRow {
  email: string;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  linkedin: string | null;
}

export type ContactFill = Partial<Pick<CrmContactRow, "name" | "role" | "phone" | "phone_mobile" | "linkedin_url">>;

// Same shared-mailbox guard as promote-sender (routes.ts): a signature on a
// generic mailbox fills nothing.
const GENERIC_LOCAL_PART = /^(info|contact|hello|enquiries|enquiry|office|admin|team|sales|support|property|properties|acquisitions|lettings|leasing|reception|marketing|accounts|careers|jobs|noreply|no-reply)$/i;

export function isGenericMailbox(email: string | null | undefined): boolean {
  const local = (email || "").split("@")[0] || "";
  return GENERIC_LOCAL_PART.test(local);
}

// LinkedIn normalised the same way as promote-sender; anything that fails
// the parse is dropped, not stored.
export function normalizeLinkedIn(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^([a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname) || !/^https?:$/.test(url.protocol)) return null;
    const profile = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    return profile ? `linkedin.com/in/${profile[1].toLowerCase()}` : null;
  } catch { return null; }
}

// enrichment_source values that mark an automatic (machine) creation. NULL
// or anything else means a human made this row and it is never renamed.
const AUTO_SOURCES = new Set(["promoted-from-email", "chatbgp_email", "rocketreach", "apollo"]);
export function isAutoCreated(enrichmentSource: string | null | undefined): boolean {
  return !!enrichmentSource && AUTO_SOURCES.has(enrichmentSource);
}

// The deterministic placeholder shapes the auto-creators generate from an
// email local-part ("nick.smith@" → "Nick Smith"):
//   routes.ts promote-sender / email-processor CC auto-create — no digit strip
//   contacts-discovery guessNameFromEmail — strips digits
export function placeholderNamesFor(email: string | null | undefined): string[] {
  const local = (email || "").split("@")[0] || "";
  if (!local) return [];
  const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());
  const plain = titleCase(local.replace(/[._-]+/g, " "));
  const digitsStripped = local.replace(/\d+/g, "").replace(/[._-]+/g, " ").trim();
  const guessed = digitsStripped
    ? digitsStripped.split(/\s+/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ")
    : "";
  return [...new Set([plain, guessed].filter(Boolean))];
}

const blank = (v: string | null | undefined) => !v || !v.trim();
const nameKey = (v: string | null | undefined) => (v || "").trim().replace(/\s+/g, " ").toLowerCase();

// Pure decision: which fields to fill on this CRM contact from this
// signature. Only blanks are ever filled.
export function decideContactFill(contact: CrmContactRow, signature: SignatureRow): ContactFill {
  const email = (contact.email || signature.email || "").toLowerCase();
  if (isGenericMailbox(email)) return {};
  const fill: ContactFill = {};
  if (blank(contact.role) && !blank(signature.title)) fill.role = signature.title!.trim();
  if (blank(contact.phone) && !blank(signature.phone)) fill.phone = signature.phone!.trim();
  if (blank(contact.phone_mobile) && !blank(signature.mobile)) fill.phone_mobile = signature.mobile!.trim();
  if (blank(contact.linkedin_url)) {
    const linkedin = normalizeLinkedIn(signature.linkedin);
    if (linkedin) fill.linkedin_url = linkedin;
  }
  if (!blank(signature.full_name) && isAutoCreated(contact.enrichment_source)) {
    const placeholders = placeholderNamesFor(email).map(nameKey);
    if (placeholders.includes(nameKey(contact.name)) && nameKey(signature.full_name) !== nameKey(contact.name)) {
      fill.name = signature.full_name!.trim();
    }
  }
  return fill;
}

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

export interface SignatureSyncResult {
  matched: number;
  updated: number;
  fields: string[];
}

// Complete existing CRM people from the freshest cached signature for this
// email. The UPDATE re-checks every filled field is still blank (and the
// name still the same placeholder value) so a concurrent human edit between
// read and write always wins. Creates nothing; idempotent.
export async function applySignatureToCrmContact(
  email: string,
  deps: { pool?: Querier } = {},
): Promise<SignatureSyncResult> {
  const q = deps.pool ?? await defaultPool();
  const key = (email || "").trim().toLowerCase();
  const none: SignatureSyncResult = { matched: 0, updated: 0, fields: [] };
  if (!key || isGenericMailbox(key)) return none;

  const sig = (await q.query(
    `SELECT email, full_name, title, phone, mobile, linkedin
       FROM email_signatures
      WHERE lower(email) = $1
      ORDER BY enriched_at DESC NULLS LAST
      LIMIT 1`,
    [key],
  )).rows[0] as SignatureRow | undefined;
  if (!sig) return none;

  const contacts = (await q.query(
    `SELECT id, name, role, phone, phone_mobile, linkedin_url, email, enrichment_source
       FROM crm_contacts
      WHERE lower(email) = $1`,
    [key],
  )).rows as CrmContactRow[];

  let updated = 0;
  const filledFields = new Set<string>();
  for (const contact of contacts) {
    const fill = decideContactFill(contact, { ...sig, email: key });
    const keys = Object.keys(fill) as Array<keyof ContactFill>;
    if (keys.length === 0) continue;
    // Still-blank guards: a human edit between our read and this write wins.
    const sets: string[] = [];
    const guards: string[] = [];
    const params: unknown[] = [contact.id];
    for (const k of keys) {
      params.push(fill[k]);
      sets.push(`${k} = $${params.length}`);
      if (k === "name") {
        params.push(contact.name ?? "");
        guards.push(`name = $${params.length}`);
      } else {
        guards.push(`(${k} IS NULL OR btrim(${k}) = '')`);
      }
    }
    const result = await q.query(
      `UPDATE crm_contacts SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $1 AND ${guards.join(" AND ")}`,
      params,
    );
    if ((result.rowCount ?? 0) > 0) {
      updated++;
      for (const k of keys) filledFields.add(k);
    }
  }
  return { matched: contacts.length, updated, fields: Array.from(filledFields) };
}

// Batch over recently-enriched signature rows — used by the admin backfill
// route and safe to re-run (per-email apply is idempotent).
export async function syncSignaturesToCrmContacts(
  opts: { limit?: number } = {},
  deps: { pool?: Querier } = {},
): Promise<{ scanned: number; matched: number; updated: number }> {
  const q = deps.pool ?? await defaultPool();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);
  const { rows } = await q.query(
    `SELECT email FROM email_signatures
      WHERE enriched_at IS NOT NULL
      ORDER BY enriched_at DESC
      LIMIT $1`,
    [limit],
  );
  let matched = 0, updated = 0;
  for (const row of rows) {
    const r = await applySignatureToCrmContact(row.email, { pool: q });
    matched += r.matched;
    updated += r.updated;
  }
  return { scanned: rows.length, matched, updated };
}

const router = Router();

// Manual backfill of the existing signature cache — staff only (same guard
// as promote-sender).
router.post("/api/admin/sync-signature-contacts", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "Staff only." });
    const limit = typeof req.body?.limit === "number" ? req.body.limit : undefined;
    res.json(await syncSignaturesToCrmContacts({ limit }));
  } catch (e: any) {
    console.error("[/api/admin/sync-signature-contacts]", e?.message);
    res.status(500).json({ error: e?.message || "failed" });
  }
});

export default router;
