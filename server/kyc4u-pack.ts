// The pack an agent takes to KYC4U's portal (Jack, 20 November 2026: "if our
// app can prepare a downloadable document when they press KYC4U button that
// they can then manually put into the KYC4U portal, that would really help").
// One ZIP: 01 the request sheet (KYC4U's form, field by field in its order,
// with the note: the deal, the company that signs, red flags, BGP's checks,
// the trust checklist), 02 BGP's AML report on the party (when the request is
// on a deal: the AML file's own report), and the documents (the ones ticked on
// the request, else every document on the party's KYC record). Rules for the
// fields: shared/kyc4u-portal.ts. It reads only; making it is written on the
// party's KYC history.
import AdmZip from "adm-zip";
import path from "path";
import { pool } from "./db";
import { KYC4U_FORM_FIELDS } from "@shared/kyc4u-portal";
import { amlFileDocWords, amlFileSafeName } from "@shared/aml-file";
import { isDealPartyRole, type DealPartyRole } from "@shared/deal-parties";
import { amlFileDocBytes, gatherAmlFile, renderAmlReport, type AmlFileDoc } from "./aml-file";

const INK = "#1f1f1f";
const MUTED = "#6b6b6b";

/** The request sheet: KYC4U's form as a page to type from. */
export async function renderKyc4uSheet(input: {
  partyName: string; dealName: string | null; fields: Record<string, string>; documents: string[]; madeBy: string; madeAt: Date;
}): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 56, left: 50, right: 50 },
    info: { Title: `KYC4U request: ${input.partyName}`, Author: "Bruce Gillingham Pollard" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>(resolve => doc.on("end", () => resolve()));
  const width = doc.page.width - 100;
  doc.font("Helvetica-Bold").fontSize(17).fillColor(INK).text("Request for KYC4U", { width });
  doc.font("Helvetica").fontSize(11).fillColor(INK).text(input.partyName, { width });
  if (input.dealName) doc.fillColor(MUTED).fontSize(9.5).text(`Deal: ${input.dealName}`, { width });
  doc.moveDown(0.6);
  doc.fillColor(MUTED).fontSize(9).text(
    "Type these into KYC4U's Raise New Service Request form, field by field, and upload the files in this folder's documents. Then record on the deal that it was submitted, with KYC4U's reference.",
    { width });
  doc.moveDown(0.8);
  for (const f of KYC4U_FORM_FIELDS) {
    const value = (input.fields[f.key] || "").trim();
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(`${f.label}${f.required ? " *" : ""}`, { width });
    doc.font("Helvetica").fontSize(10).fillColor(value ? INK : MUTED).text(value || (f.required ? "Not filled: answer it on KYC4U's form" : "—"), { width });
    doc.moveDown(0.55);
  }
  if (input.documents.length) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Documents to upload", { width });
    doc.font("Helvetica").fontSize(9.5);
    for (const d of input.documents) doc.text(`• ${d}`, { width });
  }
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(8).fillColor(MUTED)
    .text(`Made by ${input.madeBy} on ${input.madeAt.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "long", timeStyle: "short" })}.`, { width });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

export async function buildKyc4uPack(draftId: string, me: { id: string; name: string }): Promise<{ zip: Buffer; fileName: string; included: number; missing: number } | null> {
  const draft = (await pool.query(
    `SELECT d.*, c.name AS company_name, deal.name AS deal_name
       FROM kyc4u_drafts d LEFT JOIN crm_companies c ON c.id = d.company_id LEFT JOIN crm_deals deal ON deal.id = d.deal_id
      WHERE d.id = $1`, [draftId])).rows[0];
  if (!draft) return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.fields || {})) if (typeof v === "string") fields[k] = v;
  const partyName = fields.partyName || draft.company_name || "the party";
  const top = amlFileSafeName(`KYC4U request - ${partyName}`);
  const zip = new AdmZip();

  // The documents: the ones ticked on the request, else every one on the party's KYC record.
  let docs: AmlFileDoc[] = [];
  let report: Buffer | null = null;
  const role = String(draft.role || "");
  if (draft.deal_id && isDealPartyRole(role)) {
    const data = await gatherAmlFile(String(draft.deal_id), [role as DealPartyRole], me).catch(() => null);
    const p = data?.parties[0];
    if (data && p) {
      docs = p.documents;
      report = await renderAmlReport({ ...data, parties: [p] }).catch(() => null);
    }
  }
  if (!docs.length) {
    docs = (await pool.query(
      `SELECT id::text AS id, doc_type AS type, file_name AS name, uploaded_at AS at, notes AS note, file_url AS url, mime_type AS mime, file_size AS size, true AS "onCompany"
         FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at DESC LIMIT 40`, [draft.company_id])).rows;
  }
  const ticked = Array.isArray(draft.doc_ids) ? draft.doc_ids.map(String) : [];
  if (ticked.length) docs = docs.filter(d => ticked.includes(String(d.id)));

  const names: string[] = [];
  let included = 0, missing = 0, total = 0, n = 0;
  for (const d of docs) {
    n += 1;
    const got = await amlFileDocBytes(d).catch(() => ({ missing: "could not be read" }) as const);
    if ("missing" in got) { missing += 1; names.push(`${d.name} (not included: ${got.missing}; download it from the deal)`); continue; }
    if (total + got.data.length > 150 * 1024 * 1024) { missing += 1; names.push(`${d.name} (not included: the pack would be too large; download it from the deal)`); continue; }
    const base = d.name.replace(/\.[A-Za-z0-9]{1,6}$/, "");
    const name = `${String(n).padStart(2, "0")} ${amlFileSafeName(`${amlFileDocWords(d.type)} - ${base}`)}${path.extname(d.name) || got.ext}`;
    zip.addFile(`${top}/documents/${name}`, got.data);
    names.push(`documents/${name}`);
    total += got.data.length;
    included += 1;
  }
  zip.addFile(`${top}/01 Request for KYC4U - ${amlFileSafeName(partyName)}.pdf`,
    await renderKyc4uSheet({ partyName, dealName: draft.deal_name || null, fields, documents: names, madeBy: me.name, madeAt: new Date() }));
  if (report) zip.addFile(`${top}/02 BGP AML report - ${amlFileSafeName(partyName)}.pdf`, report);

  await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'kyc4u_pack', $2, $3)`,
    [draft.company_id, me.name, `KYC4U pack downloaded${draft.deal_name ? ` for ${draft.deal_name}` : ""}: the request sheet${report ? ", BGP's AML report" : ""} and ${included} document${included === 1 ? "" : "s"}${missing ? ` (${missing} not included)` : ""}.`]).catch(() => {});
  return { zip: zip.toBuffer(), fileName: `${top}.zip`, included, missing };
}
