// A party's KYC documents sent on to another agent for their own checks
// (Jack, 27 November 2026; rules and words in shared/aml-share.ts).
//
//   GET  /api/deals/:id/parties/:role/share-pack   what can be sent, who to, what was sent before
//   POST /api/deals/:id/parties/:role/share-pack   { toEmail, toName, firm, documentIds, note }
//   GET  /api/kyc-upload/pack/:token               the pack as a ZIP, for a fortnight
//
// BGP staff signed in as themselves (staffMe): the pack leaves BGP, so each
// one sent is recorded and the officers are copied on the email.
// It holds a cover sheet (how BGP holds each document, and that BGP is not
// agreeing reliance) and the documents ticked, never BGP's own working
// (SHARE_NEVER_TYPES): the server reads the documents again from the party's
// KYC record and takes only ids that are on it and may be sent. The email
// goes from the KYC mailbox with the files attached when they are small, and
// always with the download link. Each pack is a kyc_share_packs row and a
// line on the KYC history and the transaction's history.

import { Router, type Request, type Response } from "express";
import * as crypto from "crypto";
import { pool } from "./db";
import { saveFile, getFile } from "./file-storage";
import { DEAL_PARTY_LABEL, isDealPartyRole, type DealPartyRole } from "@shared/deal-parties";
import { amlFileDocWords, amlFileSafeName } from "@shared/aml-file";
import {
  SHARE_ATTACH_MAX_BYTES, SHARE_DATA_USE, SHARE_LINK_DAYS, SHARE_NOT_RELIANCE,
  shareCoverLines, shareOffered, sharePackInput, shareStatement, shareTicked, type ShareCover, type ShareDocFacts,
} from "@shared/aml-share";
import { amlSharePackEmail } from "@shared/kyc-request";

const router = Router();
const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const LINK_BASE = (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "");
const packLink = (token: string) => `${LINK_BASE}/api/kyc-upload/pack/${token}`;
const VERIFF_URL = /^\/api\/veriff\/sessions\/([^/?#]+)\/report$/;

const AGENT_COLUMNS: Array<[string, string, string]> = [
  ["vendor_agent_id", "vendor_agent_contact_id", "Vendor's agent"],
  ["purchaser_agent_id", "purchaser_agent_contact_id", "Purchaser's agent"],
  ["leasing_agent_id", "leasing_agent_contact_id", "Landlord's agent"],
  ["acquisition_agent_id", "acquisition_agent_contact_id", "Tenant's agent"],
  ["joint_agent_id", "joint_agent_contact_id", "Joint agent"],
];

/** The agents the transaction records, as people a pack could go to. */
async function recipientsFor(dealId: string): Promise<Array<{ label: string; firm: string | null; name: string | null; email: string | null }>> {
  const d = (await pool.query(`SELECT ${AGENT_COLUMNS.flatMap(c => [c[0], c[1]]).join(", ")} FROM crm_deals WHERE id = $1`, [dealId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (!d) return [];
  const out: Array<{ label: string; firm: string | null; name: string | null; email: string | null }> = [];
  for (const [firmCol, contactCol, label] of AGENT_COLUMNS) {
    if (!d[firmCol] && !d[contactCol]) continue;
    const firm = d[firmCol] ? (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [d[firmCol]]).catch(() => ({ rows: [] as any[] }))).rows[0] : null;
    const person = d[contactCol] ? (await pool.query(`SELECT name, email FROM crm_contacts WHERE id = $1`, [d[contactCol]]).catch(() => ({ rows: [] as any[] }))).rows[0] : null;
    out.push({ label, firm: text(firm?.name) || null, name: text(person?.name) || null, email: text(person?.email).toLowerCase() || null });
  }
  return out;
}

// Any BGP person signed in as themselves (Jack, 27 November 2026: "everyone
// running deals should be able to press this button"); never a client login
// or staff viewing as one.
async function staffMe(req: Request): Promise<{ id: string; name: string } | { refusal: string; status: number }> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return { refusal: "Not signed in.", status: 401 };
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return { refusal: "BGP staff only, signed in as themselves.", status: 403 };
  const u = (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return { id: String(userId), name: text(u?.name) || text(u?.email) || "BGP" };
}

interface PackDoc { id: string; type: string; name: string; at: string | null; url: string | null; size: number | null; mime: string | null; facts: ShareDocFacts }

/** The party's documents that may be sent, with how BGP holds each. One identity check filed twice is listed once. */
async function packDocs(dealId: string, role: DealPartyRole, me: { id: string; name: string }) {
  const { gatherAmlFile } = await import("./aml-file");
  const data = await gatherAmlFile(dealId, [role], me);
  const party = data?.parties[0] || null;
  if (!data || !party) return null;
  const ids = party.documents.map(d => d.id);
  const readings = ids.length ? (await pool.query(
    `SELECT document_id, seen_original, uploaded_by_name, reading FROM kyc_document_readings WHERE document_id = ANY($1::varchar[])`, [ids]).catch(() => ({ rows: [] as any[] }))).rows : [];
  const byDoc = new Map<string, any>(readings.map((r: any) => [String(r.document_id), r]));
  const checks = new Set<string>();
  const docs: PackDoc[] = [];
  for (const d of party.documents) {
    if (!shareOffered(d.type)) continue;
    const check = (d.url || "").match(VERIFF_URL)?.[1] || null;
    if (check) { if (checks.has(check)) continue; checks.add(check); }
    const r = byDoc.get(d.id);
    const cert = r?.reading?.certified ? r.reading.certification : null;
    const certifiedBy = cert ? [text(cert.name), text(cert.profession), text(cert.firm)].filter(Boolean).join(", ") || null : null;
    docs.push({
      id: d.id, type: d.type, name: d.name, at: d.at, url: d.url, size: d.size, mime: d.mime,
      facts: { type: d.type, name: d.name, at: d.at, veriff: !!check, seenOriginal: !!r?.seen_original, uploadedBy: text(r?.uploaded_by_name) || null, certifiedBy },
    });
  }
  return { data, party, docs };
}

async function coverPdf(cover: ShareCover): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 56, left: 50, right: 50 }, info: { Title: `KYC documents: ${cover.partyName}`, Author: "Bruce Gillingham Pollard" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>(resolve => doc.on("end", () => resolve()));
  const width = doc.page.width - 100;
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#1a1a1a").text(`KYC documents: ${cover.partyName}`, { width });
  doc.font("Helvetica").fontSize(9.5).fillColor("#6b6b6b").text("Sent by Bruce Gillingham Pollard for another agent's own customer due diligence.", { width });
  for (const l of shareCoverLines(cover)) {
    if (l.head) { doc.moveDown(0.9); doc.font("Helvetica-Bold").fontSize(11).fillColor("#6E0C25").text(l.head, { width }); doc.moveDown(0.2); continue; }
    if (l.para) { doc.font("Helvetica").fontSize(9.5).fillColor("#1a1a1a").text(l.para, { width }); doc.moveDown(0.4); continue; }
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#1a1a1a").text(`${l.label}: `, { width, continued: true }).font("Helvetica").text(l.value || "");
    doc.moveDown(0.15);
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".heic": "image/heic", ".webp": "image/webp",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain",
};

router.get("/api/deals/:id/parties/:role/share-pack", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const role = text(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Which party?" });
    const got = await packDocs(String(req.params.id), role as DealPartyRole, me);
    if (!got) return res.status(404).json({ message: "The transaction has no such party." });
    const sent = (await pool.query(
      `SELECT to_email, to_name, firm, file_names, sent_by_name, sent_at, expires_at, downloads, attached FROM kyc_share_packs
        WHERE deal_id = $1 AND role = $2 ORDER BY sent_at DESC LIMIT 20`, [req.params.id, role]).catch(() => ({ rows: [] as any[] }))).rows;
    res.json({
      partyName: got.party.company?.name || got.party.brand.name,
      recipients: await recipientsFor(String(req.params.id)),
      documents: got.docs.map(d => ({ id: d.id, type: amlFileDocWords(d.type), name: d.name, at: d.at, size: d.size, statement: shareStatement(d.facts), ticked: shareTicked(d.facts) })),
      linkDays: SHARE_LINK_DAYS,
      sent: sent.map((r: any) => ({
        toEmail: r.to_email, toName: r.to_name, firm: r.firm, files: Array.isArray(r.file_names) ? r.file_names.length : 0, by: r.sent_by_name,
        at: r.sent_at, expiresAt: r.expires_at, downloads: Number(r.downloads || 0), attached: !!r.attached,
      })),
    });
  } catch (err: any) {
    console.error("[aml-share] could not be read:", err?.message);
    res.status(500).json({ message: "The documents could not be read." });
  }
});

router.post("/api/deals/:id/parties/:role/share-pack", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const role = text(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Which party?" });
    const input = sharePackInput(req.body);
    if (!input.ok) return res.status(400).json({ message: input.message });
    const dealId = String(req.params.id);
    const got = await packDocs(dealId, role as DealPartyRole, me);
    if (!got) return res.status(404).json({ message: "The transaction has no such party." });
    const wanted = got.docs.filter(d => input.documentIds.includes(d.id));
    if (!wanted.length) return res.status(400).json({ message: "None of those documents can be sent: read the list again." });

    const { amlFileDocBytes } = await import("./aml-file");
    const partyName = got.party.company?.name || got.party.brand.name;
    const files: Array<{ name: string; data: Buffer; doc: PackDoc }> = [];
    const left: string[] = [];
    let n = 1;
    for (const d of wanted) {
      const bytes = await amlFileDocBytes({ id: d.id, type: d.type, name: d.name, at: d.at, note: null, url: d.url, mime: d.mime, size: d.size, onCompany: false });
      if ("missing" in bytes) { left.push(`${d.name} (${bytes.missing})`); continue; }
      n += 1;
      const base = d.name.replace(/\.[A-Za-z0-9]{1,6}$/, "");
      const ext = bytes.ext || (d.name.match(/\.[A-Za-z0-9]{1,6}$/)?.[0] ?? "");
      files.push({ name: `${String(n).padStart(2, "0")} ${amlFileSafeName(`${amlFileDocWords(d.type)} - ${base}`, 90)}${ext}`, data: bytes.data, doc: d });
    }
    if (!files.length) return res.status(409).json({ message: `Nothing could be put in the pack: ${left.join("; ")}.` });

    const now = new Date();
    const cover = await coverPdf({
      partyName, partyRole: DEAL_PARTY_LABEL[role as DealPartyRole], companyNumber: got.party.company?.number || got.party.brand.number || null,
      transaction: got.data.deal.name, toName: input.toName, firm: input.firm, sentBy: me.name,
      sentOn: now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }),
      documents: files.map(f => ({ file: f.name, type: f.doc.type, statement: shareStatement(f.doc.facts) })), note: input.note,
    });
    const coverName = `01 Cover sheet - ${amlFileSafeName(partyName, 80)}.pdf`;
    const all = [{ name: coverName, data: cover }, ...files.map(f => ({ name: f.name, data: f.data }))];

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    const folder = amlFileSafeName(`KYC documents - ${partyName}`, 80);
    for (const f of all) zip.addFile(`${folder}/${f.name}`, f.data);
    const zipped = zip.toBuffer();
    const token = crypto.randomBytes(24).toString("hex");
    const key = `kyc-share/${token}.zip`;
    await saveFile(key, zipped, "application/zip", `${folder}.zip`);
    const expires = new Date(now.getTime() + SHARE_LINK_DAYS * 86400000);
    const total = all.reduce((s, f) => s + f.data.length, 0);
    const attach = total <= SHARE_ATTACH_MAX_BYTES;

    const { sendKycEmail, dealAgents } = await import("./aml-portal");
    const agents = await dealAgents(dealId).catch(() => []);
    const me2 = (await pool.query(`SELECT email FROM users WHERE id = $1`, [me.id]).catch(() => ({ rows: [] as any[] }))).rows[0];
    const sent = await sendKycEmail({
      to: [input.toEmail],
      cc: [...agents.map(a => String(a.email || "")), text(me2?.email)].filter(Boolean),
      files: attach ? all.map(f => ({ name: f.name, contentType: MIME[(f.name.match(/\.[A-Za-z0-9]+$/)?.[0] || "").toLowerCase()] || "application/octet-stream", contentBytes: f.data.toString("base64") })) : undefined,
      build: sentFrom => amlSharePackEmail({
        toName: input.toName, partyName, partyRoleWords: `the ${DEAL_PARTY_LABEL[role as DealPartyRole].toLowerCase()}`, place: got.data.deal.property || got.data.deal.name,
        senderName: me.name, sentFrom, files: all.map(f => f.name), attached: attach, link: packLink(token), expiresAt: expires, note: input.note,
        notReliance: SHARE_NOT_RELIANCE, dataUse: SHARE_DATA_USE,
      }),
    });
    if (!sent.ok) {
      await pool.query(`DELETE FROM file_storage WHERE storage_key = $1`, [key]).catch(() => {});
      return res.status(502).json({ message: `The email could not be sent: ${sent.error || "Microsoft refused it"}. Nothing was sent.` });
    }
    await pool.query(
      `INSERT INTO kyc_share_packs (token, deal_id, role, company_id, trading_entity_id, to_email, to_name, firm, document_ids, file_names, note, storage_key, attached, sent_by, sent_by_name, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16)`,
      [token, dealId, role, got.party.brand.id, got.party.company?.id || null, input.toEmail, input.toName, input.firm,
        JSON.stringify(files.map(f => f.doc.id)), JSON.stringify(all.map(f => f.name)), input.note, key, attach, me.id, me.name, expires]);
    const who = [input.toName, input.firm].filter(Boolean).join(", ") || input.toEmail;
    const words = `${files.length} document${files.length === 1 ? "" : "s"} sent to ${who} (${input.toEmail}) for their own checks, with a cover sheet: ${files.map(f => f.doc.name).join("; ")}.`;
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'kyc_documents_shared', $2, $3)`,
      [got.party.brand.id, me.name, `${words} Transaction: ${got.data.deal.name}.`.slice(0, 1900)]).catch(() => {});
    await pool.query(
      `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, 'aml_documents_shared', $2, $3, $4, $5, $6)`,
      [dealId, role, input.toEmail, `${partyName}: ${words}`.slice(0, 1900), me.id, me.name]).catch(() => {});
    res.json({ ok: true, files: all.length, attached: attach, from: sent.from, cc: sent.cc || [], expiresAt: expires.toISOString(), left });
  } catch (err: any) {
    console.error("[aml-share] not sent:", err?.message);
    if (!res.headersSent) res.status(500).json({ message: "The documents could not be sent." });
  }
});

// The pack itself: the token is the only key, and it stops working after a fortnight.
router.get("/api/kyc-upload/pack/:token", async (req: Request, res: Response) => {
  try {
    const token = text(req.params.token);
    if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).send("This link is not one of ours.");
    const row = (await pool.query(`SELECT id, storage_key, expires_at FROM kyc_share_packs WHERE token = $1`, [token])).rows[0];
    if (!row) return res.status(404).send("This link is not one of ours.");
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(410).send("This link has expired. Please ask Bruce Gillingham Pollard to send the documents again.");
    const file = await getFile(String(row.storage_key));
    if (!file) return res.status(410).send("These documents are no longer held here. Please ask Bruce Gillingham Pollard to send them again.");
    await pool.query(`UPDATE kyc_share_packs SET downloads = downloads + 1, last_download_at = now() WHERE id = $1`, [row.id]).catch(() => {});
    const name = (file.originalName || "KYC documents.zip").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    res.send(file.data);
  } catch (err: any) {
    console.error("[aml-share] pack not served:", err?.message);
    if (!res.headersSent) res.status(500).send("The documents could not be downloaded just now. Please try again.");
  }
});

export default router;
