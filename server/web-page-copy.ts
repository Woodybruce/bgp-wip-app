// PDF copies of the web pages BGP's AML checks rely on (Woody, 21 November
// 2026: KYC4U keep a copy of every web source in their pack, "yes lets do 1
// to 4"). A link can change or go; the copy is what the page said when BGP
// read it. Each copy is filed on the party's KYC record (doc_type
// web_source, the company that signs when the deal names one), once per page
// per party, so the AML file and KYC4U's pack carry it. One copy is taken at
// a time; KYC_WEB_COPIES=off stops them.
import crypto from "crypto";
import { pool } from "./db";

export const WEB_COPIES_PER_RUN = 8;

export interface WebPageToCopy { url: string; about: string }
export interface WebCopyOutcome { filed: Array<{ url: string; documentId: string }>; already: string[]; failed: Array<{ url: string; reason: string }>; skipped: string | null }

const text = (v: unknown, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The address as it is filed: no fragment, at most 600 characters; null when it is not a web address. */
export function copyAddress(url: string): string | null {
  try {
    const u = new URL(String(url || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    const s = u.toString();
    return s.length <= 600 ? s : null;
  } catch { return null; }
}

/** The file name a copy is stored as: "bbc.co.uk - Title of the page.pdf". */
export function copyFileName(finalUrl: string, title: string): string {
  let host = "page";
  try { host = new URL(finalUrl).hostname.replace(/^www\./, ""); } catch {}
  const clean = (title || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  return `${host}${clean ? ` - ${clean}` : ""}.pdf`;
}

let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}

/**
 * Takes a PDF copy of each page not already on the party's record and files
 * it. Never throws: a page that cannot be copied is listed with why.
 */
export async function fileWebCopies(input: {
  companyId: string; entityId: string | null; dealId: string | null;
  pages: WebPageToCopy[]; by: { id: string | null; name: string }; source: string;
}): Promise<WebCopyOutcome> {
  const out: WebCopyOutcome = { filed: [], already: [], failed: [], skipped: null };
  if (String(process.env.KYC_WEB_COPIES || "").toLowerCase() === "off") { out.skipped = "web page copies are switched off"; return out; }
  const seen = new Set<string>();
  const pages: WebPageToCopy[] = [];
  for (const p of input.pages) {
    const url = copyAddress(p.url);
    if (!url) { out.failed.push({ url: text(p.url), reason: "not a web address" }); continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    pages.push({ url, about: text(p.about, 400) });
  }
  if (!pages.length) return out;
  const onFile = (await pool.query(
    `SELECT notes FROM kyc_documents
      WHERE company_id = $1 AND trading_entity_id IS NOT DISTINCT FROM $2::varchar AND doc_type = 'web_source' AND deleted_at IS NULL`,
    [input.companyId, input.entityId]).catch(() => ({ rows: [] as any[] }))).rows.map((r: any) => String(r.notes || ""));
  const { renderPagePdf } = await import("./render-page");
  const { saveFile } = await import("./file-storage");
  for (const p of pages.slice(0, WEB_COPIES_PER_RUN)) {
    if (onFile.some(n => n.startsWith(`Copy of ${p.url} `) || n === `Copy of ${p.url}`)) { out.already.push(p.url); continue; }
    const taken = new Date();
    const stamp = `taken ${taken.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "long", timeStyle: "short" })} for BGP's AML checks`;
    const copy = await oneAtATime(() => renderPagePdf(p.url, { stamp })).catch((e: any) => ({ error: String(e?.message || e) }));
    if ("error" in copy) { out.failed.push({ url: p.url, reason: copy.error }); continue; }
    const name = copyFileName(copy.finalUrl, copy.title);
    const key = `kyc-web-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.pdf`;
    try {
      await saveFile(`chat-media/${key}`, copy.pdf, "application/pdf", name);
      const row = (await pool.query(
        `INSERT INTO kyc_documents (company_id, trading_entity_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
         VALUES ($1, $2, $3, 'web_source', $4, $5, $6, 'application/pdf', $7, $8) RETURNING id`,
        [input.companyId, input.entityId, input.dealId, `/api/chat-media/${key}`, name, copy.pdf.length,
          `Copy of ${p.url} ${stamp}${copy.finalUrl !== p.url ? ` (it opened at ${copy.finalUrl})` : ""}. ${input.source}${p.about ? `: ${p.about}` : ""}`.slice(0, 2000),
          input.by.id])).rows[0];
      out.filed.push({ url: p.url, documentId: String(row.id) });
      onFile.push(`Copy of ${p.url} `);
    } catch (e: any) {
      out.failed.push({ url: p.url, reason: "the copy could not be saved" });
      console.warn(`[web-page-copy] ${p.url}: ${e?.message}`);
    }
  }
  for (const p of pages.slice(WEB_COPIES_PER_RUN)) out.failed.push({ url: p.url, reason: `only ${WEB_COPIES_PER_RUN} pages are copied at a time` });
  if (out.filed.length) {
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'web_copies', $2, $3, $4, $5)`,
      [input.companyId, input.by.name, `${out.filed.length} web page${out.filed.length === 1 ? "" : "s"} copied to PDF and filed (${input.source})`, input.entityId ? "trading_entity" : null, input.entityId]).catch(() => {});
  }
  return out;
}

/** The pages a run of BGP's checks relied on: each web finding's source, the red flags first. */
export function precheckPagesToCopy(result: { web?: { lines?: Array<{ name: string; findings?: Array<{ kind: string; summary: string; url: string | null; unsureIdentity?: boolean }> }> } } | null): WebPageToCopy[] {
  const all: Array<WebPageToCopy & { unsure: boolean }> = [];
  for (const line of result?.web?.lines || []) {
    for (const f of line.findings || []) {
      if (!f.url) continue;
      all.push({ url: f.url, about: `${line.name}, ${f.kind === "public_role" ? "public role" : "adverse media"}: ${f.summary}`, unsure: !!f.unsureIdentity });
    }
  }
  return all.sort((a, b) => Number(a.unsure) - Number(b.unsure)).map(({ url, about }) => ({ url, about }));
}
