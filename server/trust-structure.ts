// A trust's structure, kept by BGP (Jack, 23 November 2026: "Remove KYC4u on
// trusts. We need you to build the trust structuring"). The rules are
// shared/trust-structure.ts; this stores one structure per trust record and
// says what its file still needs. BGP staff signed in as themselves only.

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import {
  TRUST_DEED_TOOL, checkTrustDeedRead, mergeDeedReading, trustDeedSystem, unreadDeed, type TrustDeedReading,
} from "@shared/trust-deed-read";
import {
  checkTrustStructure, trustRoleWords, trustStructureGaps,
  type TrustDocumentsHeld, type TrustGap, type TrustStructure, type TrustStructureRecord,
} from "@shared/trust-structure";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Kept as the KYC document types the client checks file them as (shared/kyc-request.ts). */
export const TRUST_DEED_DOC_TYPES = ["trust_deed"];
export const TRS_DOC_TYPES = ["trs_excerpt"];

/** The trust's stored structure, or null. A failed read is null. */
export async function trustStructureFor(companyId: string, db: Db = pool): Promise<TrustStructureRecord | null> {
  const r = (await db.query(`SELECT structure, updated_by_name, updated_at FROM kyc_trust_structures WHERE company_id = $1`, [companyId])
    .catch(() => ({ rows: [] as any[] }))).rows[0];
  if (!r) return null;
  const checked = checkTrustStructure(r.structure);
  if ("error" in checked) return null;
  return { structure: checked, updatedBy: r.updated_by_name || null, updatedAt: new Date(r.updated_at).toISOString() };
}

/** Whether the trust deed and HMRC's proof of registration are on the trust's KYC record. */
export async function trustDocumentsHeld(companyId: string, db: Db = pool): Promise<TrustDocumentsHeld> {
  const rows = (await db.query(
    `SELECT DISTINCT doc_type FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL AND doc_type = ANY($2::text[])`,
    [companyId, [...TRUST_DEED_DOC_TYPES, ...TRS_DOC_TYPES]]).catch(() => ({ rows: [] as any[] }))).rows;
  const types = new Set(rows.map((r: any) => String(r.doc_type)));
  return { deed: TRUST_DEED_DOC_TYPES.some(t => types.has(t)), trs: TRS_DOC_TYPES.some(t => types.has(t)) };
}

export async function isTrustRecord(companyId: string, db: Db = pool): Promise<boolean> {
  const r = (await db.query(`SELECT aml_subject_type FROM crm_companies WHERE id = $1`, [companyId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  return String(r?.aml_subject_type || "").trim().toLowerCase() === "trust";
}

/** What a trust's file still needs (the sign-off and the AML box read it). */
export async function trustGapsFor(companyId: string, db: Db = pool): Promise<TrustGap[]> {
  const [record, docs] = await Promise.all([trustStructureFor(companyId, db), trustDocumentsHeld(companyId, db)]);
  return trustStructureGaps(record?.structure || null, docs);
}

/** What the client checks for a trust need to know: the documents held and the trustees recorded. */
export async function trustAskFor(companyId: string, db: Db = pool): Promise<{ deed: boolean; trs: boolean; trsNotRequired: boolean; trustees: string[] }> {
  const [record, docs] = await Promise.all([trustStructureFor(companyId, db), trustDocumentsHeld(companyId, db)]);
  return {
    ...docs,
    trsNotRequired: record?.structure.trsStatus === "not_required",
    trustees: (record?.structure.people || []).filter(p => p.roles.includes("trustee") && !p.corporate).map(p => p.name),
  };
}

// ── A trust in the ownership (Woody, 25 November 2026) ──────────────────────
// The trust that holds a party, or a company above it, read from BGP's checks
// before asking, and the CRM trust record made for it so Jack's structure is
// kept there. Its request goes as a client file on that record (no transaction
// party), and the party's sign-off waits for its information.

export interface OwnershipTrustView {
  held: import("@shared/ownership-trust").OwnershipTrustHeld;
  trust: { id: string; name: string } | null;
  gaps: string[];
}

export async function ownershipTrustFor(partyId: string, entityId: string | null, db: Db = pool): Promise<OwnershipTrustView | null> {
  if (await isTrustRecord(partyId, db)) return null;
  const { latestPrecheck } = await import("./kyc-prechecks");
  const { ownershipTrustFrom, ownershipTrustGapWords } = await import("@shared/ownership-trust");
  const stored = await latestPrecheck(partyId, entityId).catch(() => null);
  const held = ownershipTrustFrom(stored?.result);
  if (!held) return null;
  const link = (await db.query(
    `SELECT t.trust_company_id, c.name FROM kyc_ownership_trusts t JOIN crm_companies c ON c.id = t.trust_company_id
      WHERE t.party_company_id = $1 AND COALESCE(t.entity_id, '') = COALESCE($2::varchar, '') AND c.merged_into_id IS NULL LIMIT 1`,
    [partyId, entityId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  const trust = link ? { id: String(link.trust_company_id), name: String(link.name) } : null;
  const gaps = trust ? (await trustGapsFor(trust.id, db)).map(g => g.words) : [];
  return { held, trust, gaps: ownershipTrustGapWords(held, !!trust, gaps) };
}

/** The ownership trust's gaps for the sign-off: none when there is no trust in the ownership. A failed read holds it. */
export async function ownershipTrustGapsFor(partyId: string, entityId: string | null, db: Db = pool): Promise<string[]> {
  try {
    return (await ownershipTrustFor(partyId, entityId, db))?.gaps || [];
  } catch {
    return ["the trust in the ownership could not be read"];
  }
}

async function dealPartyIds(dealId: string, role: string): Promise<{ partyId: string; entityId: string | null } | null> {
  if (!["landlord", "tenant", "vendor", "purchaser"].includes(role)) return null;
  const d = (await pool.query(`SELECT ${role}_id AS party, ${role}_trading_entity_id AS entity FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  return d?.party ? { partyId: String(d.party), entityId: d.entity ? String(d.entity) : null } : null;
}

async function staffMe(req: Request): Promise<{ id: string; name: string | null } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) || null } : null;
}

const STAFF_ONLY = "BGP staff only, signed in as themselves.";

/** What changed between two structures, in a few words, for the KYC history. */
export function structureChangeWords(before: TrustStructure | null, after: TrustStructure): string {
  if (!before) return `Trust structure recorded: ${after.people.length} ${after.people.length === 1 ? "person" : "people"}${after.people.length ? ` (${after.people.map(p => `${p.name}, ${trustRoleWords(p.roles)}`).join("; ")})` : ""}.`;
  const added = after.people.filter(p => !before.people.some(b => b.key === p.key));
  const removed = before.people.filter(b => !after.people.some(p => p.key === b.key));
  const bits: string[] = [];
  if (before.kind !== after.kind) bits.push(`kind ${before.kind} to ${after.kind}`);
  if (before.trsStatus !== after.trsStatus) bits.push(`registration ${before.trsStatus.replace(/_/g, " ")} to ${after.trsStatus.replace(/_/g, " ")}`);
  if (added.length) bits.push(`added ${added.map(p => `${p.name} (${trustRoleWords(p.roles)})`).join(", ")}`);
  if (removed.length) bits.push(`removed ${removed.map(p => p.name).join(", ")}`);
  if ((before.settlorWealth || "") !== (after.settlorWealth || "")) bits.push("source of the settlor's wealth");
  if ((before.beneficiaryClass || "") !== (after.beneficiaryClass || "")) bits.push("class of beneficiaries");
  return `Trust structure changed${bits.length ? `: ${bits.join("; ")}` : ""}.`;
}

// ── Reading the trust deed (Jack, 23 November 2026: "Yes build") ─────────────

const DEED_USAGE_KEY = "trust_deed_reader_usage";
const DEED_MAX_BYTES = 20 * 1024 * 1024;

export function trustDeedReaderDailyCap(): number {
  const raw = process.env.TRUST_DEED_READER_DAILY_CAP;
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 40;
}

type DeedPart =
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
  | { type: "text"; text: string };

async function deedText(buffer: Buffer, name: string): Promise<string | null> {
  const tmp = path.join(os.tmpdir(), `bgp_deed_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${path.extname(name).replace(/[^.a-z0-9]/gi, "").slice(0, 8)}`);
  try {
    fs.writeFileSync(tmp, buffer);
    const { extractTextFromFile } = await import("./utils/file-extractor");
    const text = String(await extractTextFromFile(tmp, name) || "").replace(/\s+/g, " ").trim();
    return text.length >= 40 ? text : null;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export interface DeedReaderDeps {
  hasKey?: () => boolean;
  claim?: () => Promise<boolean>;
  ask?: (system: string, parts: DeedPart[]) => Promise<{ input: unknown; model: string; usage?: unknown }>;
}

async function askDeedReader(system: string, parts: DeedPart[]) {
  const { getAnthropicClient, CHATBGP_MODEL } = await import("./utils/anthropic-client");
  const response = await getAnthropicClient(true).messages.create({
    model: CHATBGP_MODEL,
    max_tokens: 3000,
    system,
    tools: [TRUST_DEED_TOOL as any],
    tool_choice: { type: "tool", name: TRUST_DEED_TOOL.name },
    messages: [{ role: "user", content: [...parts, { type: "text", text: "Record what the deed says about the trust's structure." }] as any }],
  }, { timeout: 120_000, maxRetries: 1 });
  const block = response.content.find((b: any) => b.type === "tool_use") as any;
  return { input: (response.stop_reason as string) === "max_tokens" ? null : block?.input ?? null, model: response.model || CHATBGP_MODEL, usage: response.usage };
}

/** Reads a deed into a reading. Never throws: a deed that cannot be read says why. */
export async function readTrustDeed(file: { data: Buffer; name: string; mime: string | null }, partyName: string, deps: DeedReaderDeps = {}): Promise<TrustDeedReading> {
  try {
    const hasKey = deps.hasKey || (() => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY));
    if (!hasKey()) return unreadDeed("The reader is not switched on.");
    if (file.data.length > DEED_MAX_BYTES) return unreadDeed("The deed is too large to read (20MB at most).");
    const mime = String(file.mime || "").toLowerCase();
    const isPdf = mime === "application/pdf" || /\.pdf$/i.test(file.name) || file.data.subarray(0, 5).toString("latin1") === "%PDF-";
    let parts: DeedPart[];
    let text: string | null = null;
    if (isPdf) {
      text = await deedText(file.data, file.name);
      parts = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data.toString("base64") } }];
    } else if (mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) {
      const sharp = (await import("sharp")).default;
      const img = await sharp(file.data, { failOn: "none" }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      parts = [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") } }];
    } else {
      text = await deedText(file.data, file.name);
      if (!text) return unreadDeed("No text could be read from the file. Send the deed as a PDF.");
      parts = [{ type: "text", text: `<deed>\n${text.replace(/[<>]/g, " ").slice(0, 120_000)}\n</deed>` }];
    }
    const claim = deps.claim || (async () => (await import("./requirement-feeds")).claimDailyRead(DEED_USAGE_KEY, trustDeedReaderDailyCap()));
    if (!(await claim())) return unreadDeed("Today's allowance of deed reads is used up; try again tomorrow.");
    const reply = await (deps.ask || askDeedReader)(trustDeedSystem(partyName), parts);
    if (!deps.ask) import("./api-usage").then(m => m.logAiUsage({ provider: "anthropic", model: reply.model, feature: "trust-deed-reader", usage: reply.usage as any })).catch(() => {});
    if (!reply.input || typeof reply.input !== "object") return unreadDeed("The reader gave no answer; try again.");
    return checkTrustDeedRead(reply.input, text);
  } catch (e: any) {
    console.warn(`[trust-structure] deed not read: ${e?.message}`);
    return unreadDeed("The reader failed; try again later.");
  }
}

// ── The deed a client sent, read into a draft (23 November 2026) ────────────
//
// A deed filed through "Request trust structure" (or any client checks
// upload as the trust deed) is read once, and the reading kept against the
// document, so BGP opens the structure form on it. Nothing is saved to the
// structure: the form's Save is the only save.

const reading = new Map<string, Promise<TrustDeedReading>>();

export async function readDeedDocument(documentId: string, companyId: string, partyName: string, file?: { name: string; mime: string; buffer: Buffer } | null): Promise<TrustDeedReading> {
  const kept = (await pool.query(`SELECT reading FROM kyc_trust_deed_readings WHERE document_id = $1`, [documentId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (kept?.reading) return kept.reading as TrustDeedReading;
  const running = reading.get(documentId);
  if (running) return running;
  const job = (async () => {
    let data = file ? { data: file.buffer, name: file.name, mime: file.mime || null } : null;
    if (!data) {
      const doc = (await pool.query(`SELECT file_url, file_name, mime_type FROM kyc_documents WHERE id::text = $1 AND deleted_at IS NULL`, [documentId])).rows[0];
      if (!doc?.file_url) return unreadDeed("The deed is no longer on file.");
      const { getFile } = await import("./file-storage");
      const stored = await getFile(String(doc.file_url).replace(/^\/api\//, ""));
      if (!stored?.data?.length) return unreadDeed("The deed could not be found in the store.");
      data = { data: stored.data, name: doc.file_name || "trust deed", mime: doc.mime_type || stored.contentType || null };
    }
    const out = await readTrustDeed(data, partyName);
    await pool.query(
      `INSERT INTO kyc_trust_deed_readings (document_id, company_id, file_name, reading, read_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (document_id) DO UPDATE SET reading = EXCLUDED.reading, read_at = now()`,
      [documentId, companyId, data.name, JSON.stringify(out)]).catch(e => console.warn(`[trust-structure] deed reading not kept: ${e?.message}`));
    if (out.read) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'trust_deed_read', 'ChatBGP', $2)`,
        [companyId, `The trust deed sent by the client (${data.name}) was read into a draft structure: ${out.lines.length} values found in the deed, ${out.dropped.length} left out. Nothing saved until a person saves the structure.`]).catch(() => {});
    }
    return out;
  })().finally(() => reading.delete(documentId));
  reading.set(documentId, job);
  return job;
}

/** The deed a request brought in, read (the latest one); null when it brought none. */
export async function ensureRequestDeedRead(token: string, companyId: string, partyName: string): Promise<TrustDeedReading | null> {
  const docs = (await pool.query(
    `SELECT kyc_document_id FROM kyc_upload_files WHERE token = $1 AND doc_type = 'trust_deed' AND kyc_document_id IS NOT NULL ORDER BY uploaded_at DESC LIMIT 1`, [token])).rows;
  if (!docs.length) return null;
  return readDeedDocument(String(docs[0].kyc_document_id), companyId, partyName);
}

/** The latest read deed newer than the structure saved: the draft the form opens on. */
export async function deedDraftFor(companyId: string, record: TrustStructureRecord | null): Promise<{ documentId: string; fileName: string | null; readAt: string; reading: TrustDeedReading; proposal: TrustStructure } | null> {
  const r = (await pool.query(
    `SELECT r.document_id, r.file_name, r.reading, r.read_at FROM kyc_trust_deed_readings r
       JOIN kyc_documents d ON d.id::text = r.document_id AND d.deleted_at IS NULL
      WHERE r.company_id = $1 AND (r.reading->>'read')::boolean IS TRUE AND ($2::timestamptz IS NULL OR r.read_at > $2::timestamptz)
      ORDER BY r.read_at DESC LIMIT 1`, [companyId, record?.updatedAt || null]).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (!r) return null;
  const read = r.reading as TrustDeedReading;
  return { documentId: String(r.document_id), fileName: r.file_name || null, readAt: new Date(r.read_at).toISOString(), reading: read, proposal: mergeDeedReading(record?.structure || null, read) };
}

/** The latest "Request trust structure" for the trust: who it went to, and what has come in. */
export async function trustRequestFor(companyId: string): Promise<null | {
  token: string; ref: string; dealId: string; to: string | null; email: string | null; sentAt: string | null; sendError: string | null;
  finishedAt: string | null; remindersSent: number; docs: Array<{ key: string; title: string; done: boolean }>;
}> {
  const row = (await pool.query(
    `SELECT token, deal_id, contact_name, contact_email, request, completed_at, reminders_sent FROM kyc_upload_tokens
      WHERE company_id = $1 AND request->>'purpose' = 'trust_structure' AND revoked_at IS NULL AND is_test IS NOT TRUE
      ORDER BY created_at DESC LIMIT 1`, [companyId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (!row) return null;
  const { KYC_DOCS, isKycDocKey } = await import("@shared/kyc-request");
  const got = new Set((await pool.query(`SELECT DISTINCT doc_type FROM kyc_upload_files WHERE token = $1`, [row.token])).rows.map((r: any) => String(r.doc_type)));
  const request = row.request || {};
  return {
    token: row.token, ref: String(request.ref || ""), dealId: String(row.deal_id), to: row.contact_name || null, email: row.contact_email || null,
    sentAt: typeof request.sentAt === "string" ? request.sentAt : null, sendError: request.sendError || null,
    finishedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null, remindersSent: Number(row.reminders_sent || 0),
    docs: (Array.isArray(request.docs) ? request.docs : []).filter(isKycDocKey).map((key: any) => ({ key, title: KYC_DOCS[key as keyof typeof KYC_DOCS].title, done: got.has(key) })),
  };
}

const deedUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: DEED_MAX_BYTES, files: 1 } });

const router = Router();

// Read the trust deed into a proposed structure: a file sent (filed on the
// trust's KYC record as its deed), else the latest deed on file. Nothing is
// saved to the structure: the form's Save is the only save.
router.post("/api/trust-structure/:companyId/read-deed", async (req: Request, res: Response, next) => {
  if (!(await staffMe(req).catch(() => null))) return res.status(403).json({ message: STAFF_ONLY });
  next();
}, deedUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const me = (await staffMe(req))!;
    const companyId = String(req.params.companyId);
    const company = (await pool.query(`SELECT id, name, aml_subject_type FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
    if (!company) return res.status(404).json({ message: "Company not found." });
    if (String(company.aml_subject_type || "").toLowerCase() !== "trust") return res.status(409).json({ message: "Record it as a trust first." });
    let file: { data: Buffer; name: string; mime: string | null } | null = null;
    let filed = false;
    const sent = (req as any).file as { buffer: Buffer; originalname: string; mimetype: string } | undefined;
    if (sent?.buffer?.length) {
      file = { data: sent.buffer, name: sent.originalname || "trust deed", mime: sent.mimetype || null };
      const { saveFile } = await import("./file-storage");
      const safe = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${file.name.replace(/[^a-zA-Z0-9_.\-]/g, "_")}`;
      await saveFile(`chat-media/${safe}`, file.data, file.mime || "application/octet-stream", file.name);
      const dealId = text(req.body?.dealId) || null;
      await pool.query(
        `INSERT INTO kyc_documents (company_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
         VALUES ($1, $2, 'trust_deed', $3, $4, $5, $6, $7, $8)`,
        [companyId, dealId, `/api/chat-media/${safe}`, file.name, file.data.length, file.mime, "Trust deed, added by BGP to read the trust's structure", me.id]);
      filed = true;
    } else {
      const doc = (await pool.query(
        `SELECT file_url, file_name, mime_type FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL AND doc_type = ANY($2::text[]) ORDER BY uploaded_at DESC LIMIT 1`,
        [companyId, TRUST_DEED_DOC_TYPES])).rows[0];
      if (!doc?.file_url) return res.status(400).json({ message: "No trust deed is on file: choose the deed to read." });
      const { getFile } = await import("./file-storage");
      const stored = await getFile(String(doc.file_url).replace(/^\/api\//, ""));
      if (!stored?.data?.length) return res.status(404).json({ message: "The deed on file could not be found in the store: choose it again." });
      file = { data: stored.data, name: doc.file_name || "trust deed", mime: doc.mime_type || stored.contentType || null };
    }
    const reading = await readTrustDeed(file, company.name);
    if (reading.read) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'trust_deed_read', $2, $3)`,
        [companyId, me.name || me.id, `Trust deed read (${file.name}): ${reading.lines.length} values found in the deed, ${reading.dropped.length} left out. Nothing saved until a person saves the structure.`]).catch(() => {});
    }
    const current = await trustStructureFor(companyId);
    res.json({ reading, proposal: reading.read ? mergeDeedReading(current?.structure || null, reading) : null, filed, fileName: file.name });
  } catch (e: any) {
    console.error("[trust-structure] read-deed failed:", e?.message);
    res.status(500).json({ message: "The deed could not be read." });
  }
});

router.get("/api/trust-structure/:companyId", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const companyId = String(req.params.companyId);
    const company = (await pool.query(`SELECT id, name, aml_subject_type FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
    if (!company) return res.status(404).json({ message: "Company not found." });
    const [record, docs, request] = await Promise.all([trustStructureFor(companyId), trustDocumentsHeld(companyId), trustRequestFor(companyId)]);
    const draft = await deedDraftFor(companyId, record);
    // Which of the trust's documents are on its KYC record (the Upload documents box lists all five).
    const { TRUST_REQUEST_DOCS, KYC_DOCS } = await import("@shared/kyc-request");
    const heldTypes = new Set((await pool.query(
      `SELECT DISTINCT doc_type FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL`, [companyId]).catch(() => ({ rows: [] as any[] }))).rows.map((r: any) => String(r.doc_type)));
    const held = TRUST_REQUEST_DOCS.filter(k => heldTypes.has(KYC_DOCS[k].docType));
    // Who to ask: the transaction's person to ask for this party, then the trust's people with an email.
    let askFirst: { contactId: string | null; name: string; email: string | null; mobile: string | null } | null = null;
    const dealId = text(req.query.dealId);
    if (dealId) {
      const d = (await pool.query(
        `SELECT landlord_id, landlord_contact_id, tenant_id, tenant_contact_id, vendor_id, vendor_contact_id, purchaser_id, purchaser_contact_id FROM crm_deals WHERE id = $1`, [dealId]).catch(() => ({ rows: [] as any[] }))).rows[0];
      const role = d ? (["landlord", "tenant", "vendor", "purchaser"] as const).find(r => d[`${r}_id`] === companyId) : null;
      const cid = role ? d[`${role}_contact_id`] : null;
      const c = cid ? (await pool.query(`SELECT id, name, email, company_id, COALESCE(NULLIF(phone_mobile, ''), NULLIF(phone, '')) AS mobile FROM crm_contacts WHERE id = $1`, [cid])).rows[0] : null;
      if (c) askFirst = { contactId: c.company_id === companyId && c.email ? String(c.id) : null, name: c.name, email: c.email || null, mobile: c.mobile || null };
    }
    const contacts = (await pool.query(
      `SELECT id, name, email, COALESCE(NULLIF(phone_mobile, ''), NULLIF(phone, '')) AS mobile FROM crm_contacts
        WHERE company_id = $1 AND COALESCE(email, '') <> '' ORDER BY name LIMIT 60`, [companyId]).catch(() => ({ rows: [] as any[] }))).rows;
    res.json({
      companyId, name: company.name, trust: String(company.aml_subject_type || "").toLowerCase() === "trust",
      record, documents: docs, held, gaps: trustStructureGaps(record?.structure || null, docs), request, draft, askFirst,
      contacts: contacts.map((c: any) => ({ id: String(c.id), name: c.name, email: c.email, mobile: c.mobile || null })),
    });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Could not read the trust's structure." });
  }
});

// Request trust structure (Jack, 23 November 2026): email the trust's
// representative, or whoever BGP names, a link to upload the trust's
// documents. They are filed on the trust's KYC record; the deed is read into a
// draft; once everything asked for is in, the transaction's agents and the
// officers are emailed that it is ready for due diligence (server/aml-portal.ts).
router.post("/api/trust-structure/:companyId/request", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const { clientChecksOn, createClientCheck } = await import("./aml-portal");
    if (!clientChecksOn()) return res.status(410).json({ message: "The client checks are switched off, so nothing can be sent." });
    const companyId = String(req.params.companyId);
    if (!(await isTrustRecord(companyId))) return res.status(409).json({ message: "Record it as a trust first." });
    const dealId = text(req.body?.dealId);
    if (!dealId) return res.status(400).json({ message: "Open it from the transaction." });
    // A trust in the ownership is no party to the transaction: its request goes on its own record.
    const ownership = (await pool.query(`SELECT 1 FROM kyc_ownership_trusts WHERE trust_company_id = $1 LIMIT 1`, [companyId])).rows.length > 0;
    const name = text(req.body?.name).slice(0, 120);
    if (!name) return res.status(400).json({ message: "Enter the name of the person to ask." });
    const { TRUST_REQUEST_DOCS, isKycDocKey } = await import("@shared/kyc-request");
    const asked = Array.isArray(req.body?.docs) ? (req.body.docs as unknown[]).filter(isKycDocKey).filter(k => TRUST_REQUEST_DOCS.includes(k)) : TRUST_REQUEST_DOCS;
    if (!asked.length) return res.status(400).json({ message: "Ask for at least one document." });
    const u = (await pool.query(`SELECT email FROM users WHERE id = $1`, [me.id])).rows[0];
    const out = await createClientCheck(ownership ? null : dealId, {
      companyId, contactId: text(req.body?.contactId) || null, name, email: text(req.body?.email), mobile: text(req.body?.mobile) || null,
      kind: "company", needsIdCheck: false, docs: asked, note: text(req.body?.note).slice(0, 2000) || null,
    }, { id: me.id, name: me.name, email: u?.email || null }, { purpose: "trust_structure" });
    res.json(out);
  } catch (e: any) {
    res.status(e?.status || 500).json({ message: e?.message || "Could not send the request." });
  }
});

router.put("/api/trust-structure/:companyId", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const companyId = String(req.params.companyId);
    if (!(await isTrustRecord(companyId))) return res.status(409).json({ message: "Record it as a trust first: a structure is kept only for a trust or foundation." });
    const checked = checkTrustStructure(req.body?.structure);
    if ("error" in checked) return res.status(400).json({ message: checked.error });
    const before = await trustStructureFor(companyId);
    await pool.query(
      `INSERT INTO kyc_trust_structures (company_id, structure, updated_by, updated_by_name, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (company_id) DO UPDATE SET structure = EXCLUDED.structure, updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()`,
      [companyId, JSON.stringify(checked), me.id, me.name]);
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'trust_structure', $2, $3)`,
      [companyId, me.name || me.id, structureChangeWords(before?.structure || null, checked)]).catch(() => {});
    // The people recorded are screened on a fresh run of BGP's checks.
    const dealId = text(req.body?.dealId) || null;
    const { startPrecheck } = await import("./kyc-prechecks");
    void startPrecheck(companyId, { dealId, userId: me.id, force: true, entityId: null }).catch(() => {});
    const record = await trustStructureFor(companyId);
    const docs = await trustDocumentsHeld(companyId);
    res.json({ ok: true, record, documents: docs, gaps: trustStructureGaps(record?.structure || null, docs) });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Could not save the trust's structure." });
  }
});

// A trust in the ownership: what was found, and the trust record made for it.
router.get("/api/deals/:id/parties/:role/ownership-trust", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const ids = await dealPartyIds(String(req.params.id), String(req.params.role));
    if (!ids) return res.json({ view: null });
    res.json({ view: await ownershipTrustFor(ids.partyId, ids.entityId) });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Could not read the trust in the ownership." });
  }
});

router.post("/api/deals/:id/parties/:role/ownership-trust", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const ids = await dealPartyIds(String(req.params.id), String(req.params.role));
    if (!ids) return res.status(404).json({ message: "Set the party on the transaction first." });
    const view = await ownershipTrustFor(ids.partyId, ids.entityId);
    if (!view) return res.status(409).json({ message: "BGP's checks found no trust in this party's ownership. Run them again first." });
    if (view.trust) return res.json({ view });
    const { ownershipTrustDefaultName } = await import("@shared/ownership-trust");
    const name = (text(req.body?.name) || ownershipTrustDefaultName(view.held.heldAt)).slice(0, 160);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const made = (await client.query(
        `INSERT INTO crm_companies (id, name, company_type, aml_subject_type, description)
         VALUES (gen_random_uuid()::text, $1, 'Trust', 'trust', $2) RETURNING id`,
        [name, `Added by ${me.name || "BGP"} for the AML checks: the trust that holds ${view.held.heldAt}.`])).rows[0];
      await client.query(
        `INSERT INTO kyc_ownership_trusts (party_company_id, entity_id, trust_company_id, held_at, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [ids.partyId, ids.entityId, made.id, view.held.heldAt, me.id, me.name]);
      await client.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'ownership_trust', $2, $3)`,
        [ids.partyId, me.name || me.id, `Recorded the trust that holds ${view.held.heldAt} as ${name}, to keep its information.`]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.json({ view: await ownershipTrustFor(ids.partyId, ids.entityId) });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Could not record the trust." });
  }
});

export default router;
