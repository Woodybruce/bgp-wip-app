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
    const [record, docs] = await Promise.all([trustStructureFor(companyId), trustDocumentsHeld(companyId)]);
    res.json({
      companyId, name: company.name, trust: String(company.aml_subject_type || "").toLowerCase() === "trust",
      record, documents: docs, gaps: trustStructureGaps(record?.structure || null, docs),
    });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Could not read the trust's structure." });
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

export default router;
