// The register, as it stood when BGP read it (Jack, 27 November 2026: "Can you
// do that?"). MLR 2017 reg 28(9) asks a firm to keep its record of the
// beneficial owners; reg 30A asks it to collect an excerpt of the register of
// people with significant control (or of overseas entities) before a business
// relationship starts. Each run of BGP's checks keeps one, dated, as a PDF on
// the party's KYC record: once a London day per company.
import { pool } from "./db";
import { controlWords, type KycPrecheckResult } from "../shared/kyc-prechecks";

type Ch = NonNullable<KycPrecheckResult["companiesHouse"]>;

export const REGISTER_EXCERPT_DOC_TYPE = "ch_register_excerpt";

const londonDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const born = (dob: { month?: number | null; year?: number | null } | null | undefined): string =>
  dob?.year ? `born ${dob.month ? `${new Date(2000, dob.month - 1, 1).toLocaleDateString("en-GB", { month: "long" })} ` : ""}${dob.year}` : "";

/** The lines of the excerpt, as plain text: the PDF prints them, and a test reads them. */
export function registerExcerptLines(ch: Ch, readAt: Date): Array<{ head?: string; text?: string }> {
  const overseas = /^OE/i.test(ch.number);
  const out: Array<{ head?: string; text?: string }> = [];
  out.push({ head: "The company" });
  out.push({ text: `${ch.name} (${ch.number})` });
  out.push({ text: [ch.type ? `Type: ${ch.type.replace(/-/g, " ")}` : "", ch.status ? `Status: ${ch.status.replace(/-/g, " ")}` : "", ch.incorporatedOn ? `Incorporated: ${ch.incorporatedOn}` : ""].filter(Boolean).join(" · ") });
  if (ch.registeredOffice) out.push({ text: `Registered office: ${ch.registeredOffice}` });
  out.push({ head: overseas ? "Registered beneficial owners (Register of Overseas Entities)" : "People with significant control" });
  if (ch.listing) out.push({ text: `Exempt from keeping a register of people with significant control: ${ch.listing.company || ch.name} is listed.` });
  if (!ch.owners.length) out.push({ text: "None on the register." });
  for (const o of ch.owners) {
    out.push({ text: [
      o.name,
      o.kind === "individual" ? "an individual" : o.kind === "company" ? "a company" : String(o.kind).replace(/_/g, " "),
      o.registrationNumber ? `number ${o.registrationNumber}` : "", o.country || "", o.nationality || "", o.residence ? `resident in ${o.residence}` : "", born(o.dob),
      o.notifiedOn ? `notified ${o.notifiedOn}` : "",
    ].filter(Boolean).join(" · ") });
    const controls = [...new Set((o.controls || []).map(controlWords))];
    if (controls.length) out.push({ text: `    ${controls.join("; ")}` });
  }
  if (ch.statements.length) {
    out.push({ head: "Statements on the register" });
    for (const s of ch.statements) out.push({ text: `${s.words}${s.notifiedOn ? ` (${s.notifiedOn})` : ""}` });
  }
  out.push({ head: overseas ? "Managing officers" : "Officers" });
  if (!ch.officers.length) out.push({ text: "None listed." });
  for (const o of ch.officers) out.push({ text: [o.name, o.role, o.appointedOn ? `appointed ${o.appointedOn}` : "", o.nationality || "", born(o.dob)].filter(Boolean).join(" · ") });
  if (ch.chain.length) {
    out.push({ head: "Up the ownership chain" });
    for (const c of ch.chain) out.push({ text: `${c.name} (${c.number})${c.unread ? ": not read" : `: ${c.individuals} individual${c.individuals === 1 ? "" : "s"}, ${c.companies} compan${c.companies === 1 ? "y" : "ies"} on its register`}` });
    for (const p of ch.peopleUpChain || []) out.push({ text: `${p.name}, in ${p.foundAt}${born(p.dob) ? ` · ${born(p.dob)}` : ""}` });
  }
  out.push({ head: "Source" });
  out.push({ text: `Read from Companies House by ChatBGP on ${readAt.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "long", timeStyle: "short" })} (London time). https://find-and-update.company-information.service.gov.uk/company/${ch.number}` });
  return out;
}

export async function renderRegisterExcerpt(ch: Ch, readAt: Date): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 56, left: 50, right: 50 }, info: { Title: `Register excerpt: ${ch.name}`, Author: "Bruce Gillingham Pollard" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>(resolve => doc.on("end", () => resolve()));
  const width = doc.page.width - 100;
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#1a1a1a").text("Excerpt of the register at Companies House", { width });
  doc.font("Helvetica").fontSize(9.5).fillColor("#6b6b6b").text("Kept for BGP's customer due diligence record: who owned and controlled the company on the day it was read.", { width });
  for (const l of registerExcerptLines(ch, readAt)) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    if (l.head) { doc.moveDown(0.8); doc.font("Helvetica-Bold").fontSize(11).fillColor("#6E0C25").text(l.head, { width }); doc.moveDown(0.2); }
    else if (l.text) doc.font("Helvetica").fontSize(9.5).fillColor("#1a1a1a").text(l.text, { width });
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** Keep the excerpt on the party's KYC record: once a London day per company number. Never throws. */
export async function fileRegisterExcerpt(input: { companyId: string; entityId: string | null; dealId: string | null; ch: Ch; readAt?: Date }): Promise<string | null> {
  try {
    const readAt = input.readAt || new Date();
    const day = londonDay(readAt);
    const fileName = `kyc-ch-${input.companyId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}-register-${input.ch.number.replace(/[^a-zA-Z0-9]/g, "")}-${day}.pdf`;
    const url = `/api/chat-media/${fileName}`;
    const existing = (await pool.query(`SELECT id FROM kyc_documents WHERE company_id = $1 AND file_url = $2 AND deleted_at IS NULL LIMIT 1`, [input.companyId, url])).rows[0];
    if (existing) return String(existing.id);
    const data = await renderRegisterExcerpt(input.ch, readAt);
    const title = `Register excerpt - ${input.ch.name} - ${day}.pdf`;
    const { saveFile } = await import("./file-storage");
    await saveFile(`chat-media/${fileName}`, data, "application/pdf", title);
    const row = (await pool.query(
      `INSERT INTO kyc_documents (company_id, trading_entity_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'application/pdf', $8, NULL) RETURNING id`,
      [input.companyId, input.entityId, input.dealId, REGISTER_EXCERPT_DOC_TYPE, url, title, data.length,
        `The register of people with significant control and the officers of ${input.ch.name} (${input.ch.number}), as Companies House showed them on ${day}. Made by BGP's checks before asking.`])).rows[0];
    return String(row.id);
  } catch (e: any) {
    console.warn(`[kyc-register-excerpt] not filed: ${e?.message}`);
    return null;
  }
}
