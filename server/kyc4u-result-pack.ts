// KYC4U's pack, unpacked and read for Add KYC4U result (Woody, 21 November
// 2026: "yes lets do 1 to 4"). The rules (where each file is filed, the
// report reader) are shared/kyc4u-result-pack.ts. Nothing here saves: the
// route in server/deal-party-aml.ts files what the officer confirms.
import {
  KYC4U_PACK_MAX_ENTRIES, KYC4U_PACK_MAX_FILE_BYTES, KYC4U_PACK_MAX_TOTAL_BYTES, KYC4U_PACK_MAX_ZIP_BYTES,
  fileExtension, isKyc4uRiskReportName, kyc4uPackJunk, kyc4uPackMime, kyc4uPackPlace, kyc4uReferenceIn,
  readKyc4uRiskReport, unwrapPackPaths, withKyc4uRiskTable, type Kyc4uPackPlace, type Kyc4uRiskReport,
} from "@shared/kyc4u-result-pack";

export interface PackFileIn { originalname: string; mimetype?: string; buffer: Buffer; size?: number }
export interface PackEntry { path: string; name: string; buffer: Buffer; mime: string; place: Kyc4uPackPlace }
export interface PackSkip { path: string; reason: string }

const MB = (n: number) => `${Math.round(n / (1024 * 1024))}MB`;

/** Every file chosen, with any zip opened: what can be filed, and what cannot and why. */
export async function unpackKyc4uFiles(files: PackFileIn[]): Promise<{ entries: PackEntry[]; skipped: PackSkip[] }> {
  const raw: Array<{ path: string; buffer: Buffer }> = [];
  const skipped: PackSkip[] = [];
  let total = 0;
  for (const f of files) {
    const name = String(f.originalname || "file").split(/[\\/]/).pop() || "file";
    if (fileExtension(name) === "zip") {
      if (f.buffer.length > KYC4U_PACK_MAX_ZIP_BYTES) { skipped.push({ path: name, reason: `the zip is over ${MB(KYC4U_PACK_MAX_ZIP_BYTES)}` }); continue; }
      let zipEntries: any[];
      try {
        const AdmZip = (await import("adm-zip")).default;
        zipEntries = new AdmZip(f.buffer).getEntries();
      } catch {
        skipped.push({ path: name, reason: "the zip could not be opened" });
        continue;
      }
      const inside: Array<{ path: string; entry: any }> = [];
      for (const e of zipEntries) {
        if (e.isDirectory) continue;
        const entryName = String(e.entryName || "").replace(/\\/g, "/");
        if (!entryName || kyc4uPackJunk(entryName)) continue;
        inside.push({ path: entryName, entry: e });
      }
      if (inside.length > KYC4U_PACK_MAX_ENTRIES) {
        skipped.push({ path: name, reason: `the zip holds ${inside.length} files; up to ${KYC4U_PACK_MAX_ENTRIES} can be read at once` });
        continue;
      }
      const paths = unwrapPackPaths(inside.map(i => i.path));
      for (let i = 0; i < inside.length; i++) {
        const path = paths[i] || inside[i].path;
        const declared = Number(inside[i].entry.header?.size || 0);
        if (declared > KYC4U_PACK_MAX_FILE_BYTES) { skipped.push({ path, reason: `over ${MB(KYC4U_PACK_MAX_FILE_BYTES)}` }); continue; }
        if (fileExtension(path) === "zip") { skipped.push({ path, reason: "a zip inside the zip: open it and add its files" }); continue; }
        if (!kyc4uPackMime(path)) { skipped.push({ path, reason: "not a document or picture" }); continue; }
        if (total + declared > KYC4U_PACK_MAX_TOTAL_BYTES) { skipped.push({ path, reason: `the pack unpacks to more than ${MB(KYC4U_PACK_MAX_TOTAL_BYTES)}` }); continue; }
        let data: Buffer;
        try { data = inside[i].entry.getData(); } catch { skipped.push({ path, reason: "could not be unpacked (it may be password protected)" }); continue; }
        if (data.length > KYC4U_PACK_MAX_FILE_BYTES) { skipped.push({ path, reason: `over ${MB(KYC4U_PACK_MAX_FILE_BYTES)}` }); continue; }
        total += data.length;
        raw.push({ path, buffer: data });
      }
      continue;
    }
    if (f.buffer.length > KYC4U_PACK_MAX_FILE_BYTES) { skipped.push({ path: name, reason: `over ${MB(KYC4U_PACK_MAX_FILE_BYTES)}` }); continue; }
    if (!kyc4uPackMime(name)) { skipped.push({ path: name, reason: "not a document or picture" }); continue; }
    total += f.buffer.length;
    raw.push({ path: name, buffer: f.buffer });
  }
  const entries = raw.map(r => {
    const name = r.path.split("/").pop() || r.path;
    return { path: r.path, name, buffer: r.buffer, mime: kyc4uPackMime(name) || "application/octet-stream", place: kyc4uPackPlace(r.path) };
  });
  return { entries, skipped };
}

async function pdfText(buffer: Buffer): Promise<string> {
  const mod: any = await import("pdf-parse");
  const PDFParse = mod.PDFParse || mod.default;
  const parser = new PDFParse(new Uint8Array(buffer));
  try {
    const data = await parser.getText();
    return typeof data === "string" ? data : String(data?.text || "");
  } finally {
    await parser.destroy?.()?.catch?.(() => {});
  }
}

/**
 * KYC4U's "Risk Identified | Mitigation" table, read by position (21 November
 * 2026: three of six real reports use it). Plain text gives one column's lines
 * and then the other's with nothing between them, so each piece of text is put
 * in the column it sits under: left of the "Mitigation" heading is the risk,
 * from it rightwards the mitigation. The table runs from its heading down to
 * "Overall Conclusion", and on to the next page when the heading repeats there.
 */
export async function kyc4uRiskTable(buffer: Buffer): Promise<{ risk: string; mitigation: string } | null> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ ...(await (await import("./pdf-raster")).pdfjsAssetUrls()), data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false }).promise;
  const risk: string[] = [];
  const mitigation: string[] = [];
  const lines = (items: Array<{ s: string; x: number; y: number; w: number }>): string => {
    const rows: Array<{ y: number; parts: Array<{ s: string; x: number }> }> = [];
    for (const i of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find(r => Math.abs(r.y - i.y) < 2.5);
      if (row) row.parts.push(i); else rows.push({ y: i.y, parts: [i] });
    }
    return rows.map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join(" ")).join(" ");
  };
  let found = false;
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
      const page = await doc.getPage(p);
      const items: Array<{ s: string; x: number; y: number; w: number }> = (await page.getTextContent()).items
        .filter((i: any) => typeof i.str === "string" && i.str.trim())
        .map((i: any) => ({ s: String(i.str), x: Number(i.transform?.[4]) || 0, y: Number(i.transform?.[5]) || 0, w: Number(i.width) || 0 }));
      page.cleanup();
      const head = items.find(i => /^risk\s+identified$/i.test(i.s.trim()));
      const mit = head ? items.find(i => /^mitigation$/i.test(i.s.trim()) && Math.abs(i.y - head.y) < 3 && i.x > head.x) : undefined;
      if (!head || !mit) { if (found) break; continue; }
      found = true;
      const end = items.filter(i => i.y < head.y - 1 && /^(overall\s+conclusion|counterparty\s+details|©\s*\d{4}\s*kyc4u)/i.test(i.s.trim())).sort((a, b) => b.y - a.y)[0];
      const body = items.filter(i => i.y < head.y - 1 && (!end || i.y > end.y + 1));
      // The headings sit centred over their columns, and a cell's text starts at its column's left edge,
      // left of its heading: the columns divide halfway between the two headings' centres.
      const edge = ((head.x + head.w / 2) + (mit.x + mit.w / 2)) / 2;
      risk.push(lines(body.filter(i => i.x < edge)));
      mitigation.push(lines(body.filter(i => i.x >= edge)));
      if (end && !/^©/.test(end.s.trim())) break;
    }
  } finally {
    await doc.destroy().catch(() => {});
  }
  return found ? { risk: risk.join(" ").replace(/\s+/g, " ").trim(), mitigation: mitigation.join(" ").replace(/\s+/g, " ").trim() } : null;
}

/** KYC4U's risk report among the files: the one named as it, else a PDF whose text is one (the first three PDFs looked at). */
export async function readKyc4uPack(entries: PackEntry[]): Promise<{ report: Kyc4uRiskReport | null; reportPath: string | null; fileReference: string | null }> {
  const named = entries.filter(e => e.place.kind === "report" || isKyc4uRiskReportName(e.name));
  const others = entries.filter(e => !named.includes(e) && fileExtension(e.name) === "pdf" && e.path.split("/").length === 1).slice(0, 3);
  const fileReference = named.map(e => kyc4uReferenceIn(e.name)).find(Boolean) || null;
  for (const e of [...named, ...others]) {
    if (fileExtension(e.name) !== "pdf") continue;
    let report = await pdfText(e.buffer).then(readKyc4uRiskReport).catch(() => null);
    if (report?.assessmentTable) report = withKyc4uRiskTable(report, await kyc4uRiskTable(e.buffer).catch(() => null));
    if (report) {
      if (e.place.kind !== "report") e.place = { ...e.place, heading: "KYC4U's risk assessment", kind: "report", docType: "kyc4u_report" };
      return { report, reportPath: e.path, fileReference: report.jobId || kyc4uReferenceIn(e.name) || fileReference };
    }
  }
  return { report: null, reportPath: null, fileReference };
}
