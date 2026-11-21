// KYC4U's pack, loaded in one go into Add KYC4U result (Woody, 21 November
// 2026, on KYC4U's pack for a counterparty: "this is all the stuff KYC4U do.
// are we missing anything in the app?", then "yes lets do 1 to 4"). KYC4U
// send a zip: their AML Risk Assessment Report at the top, then a folder per
// subject ("1.0 HOTs", "2.0 <the company>", "3.0 Holding Cos/1.0 <company>",
// "4.0 UBOs/1.0 <person>"). Each file is filed on the party's KYC record
// under its folder's heading, and the report is read by rules (it is one
// fixed template, so no AI) to fill the result for the officer to check.
//
// Pure: server/kyc4u-result-pack.ts unpacks and reads the files.

export const KYC4U_PACK_MAX_FILES = 40;                    // files chosen at once
export const KYC4U_PACK_MAX_ENTRIES = 120;                 // files inside one zip
export const KYC4U_PACK_MAX_ZIP_BYTES = 100 * 1024 * 1024; // one zip
export const KYC4U_PACK_MAX_FILE_BYTES = 25 * 1024 * 1024; // one file, chosen or unpacked
export const KYC4U_PACK_MAX_TOTAL_BYTES = 250 * 1024 * 1024; // everything unpacked

// What a pack may hold: documents and pictures. Anything else is listed as
// not filed, with why.
const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv",
  msg: "application/vnd.ms-outlook", eml: "message/rfc822", txt: "text/plain",
};

export const fileExtension = (name: string): string => (/\.([a-z0-9]{1,5})$/i.exec(String(name || ""))?.[1] || "").toLowerCase();

/** The type a pack file is stored as, or null when a pack may not hold it. */
export function kyc4uPackMime(name: string): string | null {
  return FILE_TYPES[fileExtension(name)] || null;
}

/** Folder and file names inside a zip that are never documents. */
export function kyc4uPackJunk(path: string): boolean {
  return String(path || "").split("/").some(part => part === "__MACOSX" || part === ".DS_Store" || part === "Thumbs.db" || part === "desktop.ini" || part.startsWith("._") || part.startsWith("~$"));
}

export type Kyc4uPackKind = "report" | "hots" | "company" | "holding" | "owner" | "adviser" | "other";

export interface Kyc4uPackPlace {
  heading: string;           // where it is filed: "Holding companies · Kirkbi AS"
  kind: Kyc4uPackKind;
  subject: string | null;    // the company or person the folder is about
  docType: string;           // the kyc_documents type it is stored as
}

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
// "3.0 Holding Cos" → "Holding Cos"; "1.0 Thomas Kirk Kristiansen" → the name.
const unnumbered = (folder: string): string => text(folder).replace(/^\d+(\.\d+)*[.)]?\s+/, "").trim();

export function isKyc4uRiskReportName(name: string): boolean {
  return /aml\s*-?\s*risk\s*-?\s*assessment\s*-?\s*report|risk\s*assessment\s*report/i.test(String(name || "").replace(/[_-]+/g, " "));
}

/** The KYC4U reference in a name ("AMLRiskAssessmentReport-REQ112444.pdf" → "REQ112444"). */
export function kyc4uReferenceIn(name: string): string | null {
  const m = /\bREQ\s?-?\s?(\d{4,})\b/i.exec(String(name || ""));
  return m ? `REQ${m[1]}` : null;
}

function docTypeFor(kind: Kyc4uPackKind, fileName: string): string {
  const name = fileName.replace(/\.[a-z0-9]{1,5}$/i, "");
  if (isKyc4uRiskReportName(name) || /kyc\s+verification\s+form/i.test(name)) return "kyc4u_report";
  if (kind === "hots" || /\b(heads?\s+of\s+terms|hot[\u2019']?s)\b/i.test(name)) return "heads_of_terms";
  // KYC4U's electronic checks on a person (seen in their packs, November 2026).
  if (/multi[\s-]*bureau|electronic\s+(id|identity)\s+(check|verification)/i.test(name)) return "electronic_id_check";
  if (/\bdocument\s+check\b|\bid\s+document\s+check\b/i.test(name)) return "id_check_report";
  if (/compliance\s+(alert|report)|aml\s+screen|screening|sanctions?\s+(check|report)|pep\s+check|\bclient\s+(aml\s+)?report\b|\baml\s+report\b/i.test(name)) return "screening_report";
  if (/credit\s*-?\s*safe|credit\s+report|experian|dun\s+(and|&)\s+bradstreet/i.test(name)) return "credit_report";
  if (/certificate\s+of\s+incorporation|incorporation\s+certificate/i.test(name)) return "company_cert";
  if (/confirmation\s+statement/i.test(name)) return "confirmation_statement";
  if (/annual\s+accounts|\baccounts\b|financial\s+statements/i.test(name)) return "company_accounts";
  if (/\bagent'?s?\s+(confirmation|on\s+company\s+background)|confirmation\s+on\s+request\s+type/i.test(name)) return "agent_confirmation";
  if (/\bfca\s+(regulation|register)|financial\s+conduct\s+authority/i.test(name)) return "regulator_register";
  if (/law\s+society|\bsra\b|solicitors?\s+regulation/i.test(name) || kind === "adviser") return "adviser_check";
  if (/structure\s+chart|group\s+structure|organogram/i.test(name)) return "structure_chart";
  if (/passport|driv(ing|er'?s)\s+licen[cs]e|national\s+id|identity\s+card|\bid\s+card\b/i.test(name)) return "passport";
  if (/proof\s+of\s+(address|residence)|utility|council\s+tax|bank\s+statement/i.test(name)) return "proof_of_address";
  if (/source\s+of\s+(funds|wealth)/i.test(name)) return "source_of_funds";
  if (/regist(er|ry|ration)|\bcvr\b|companies\s+house|business\s+registry|chamber\s+of\s+commerce|handelsregister|kbis|personal\s+appointments|find\s+and\s+update\s+company\s+information/i.test(name)) return "register_extract";
  if (kind === "owner" || /\bnews\b|\barticle\b|wikipedia|interview|the\s+guardian|\bindependent\b|press\s+release|\blaunch\b|investment\s+report/i.test(name)) return "public_source";
  return "other";
}

/**
 * Where a file in KYC4U's pack is filed. `path` is its place in the zip
 * (folders and name, "/" between), with any single folder the whole zip is
 * wrapped in already taken off.
 */
export function kyc4uPackPlace(path: string): Kyc4uPackPlace {
  const parts = String(path || "").split("/").map(p => p.trim()).filter(Boolean);
  const fileName = parts.pop() || "";
  const folders = parts.map(unnumbered).filter(Boolean);
  if (!folders.length) {
    if (isKyc4uRiskReportName(fileName)) return { heading: "KYC4U's risk assessment", kind: "report", subject: null, docType: "kyc4u_report" };
    // A loose file is filed by its name. KYC4U's email is their report; any other loose file is not
    // (KYC4U's older packs, from 2023, kept every document loose in one folder).
    const loose = docTypeFor("other", fileName);
    return { heading: "KYC4U's pack", kind: "other", subject: null, docType: loose === "other" && /\.(msg|eml)$/i.test(fileName) ? "kyc4u_report" : loose };
  }
  const top = folders[0];
  if (/^(hots?|heads?\s+of\s+terms)$/i.test(top)) return { heading: "Heads of terms", kind: "hots", subject: null, docType: docTypeFor("hots", fileName) };
  if (/^holding\s*(co'?s?|compan(y|ies))$|^parent\s+compan(y|ies)$|^group\s+compan(y|ies)$/i.test(top)) {
    const subject = folders[1] || null;
    return { heading: subject ? `Holding companies · ${subject}` : "Holding companies", kind: "holding", subject, docType: docTypeFor("holding", fileName) };
  }
  if (/^(advis[eo]rs?|solicitors?|lawyers?|legal\s+advis[eo]rs?)$/i.test(top)) {
    const subject = folders[1] || null;
    return { heading: subject ? `Advisers · ${subject}` : "Advisers", kind: "adviser", subject, docType: docTypeFor("adviser", fileName) };
  }
  if (/^(ubo'?s?|ultimate\s+beneficial\s+owners?|beneficial\s+owners?|owners|directors?|individuals?|people)$/i.test(top)) {
    const subject = folders[1] || null;
    return { heading: subject ? `Owners · ${subject}` : "Owners", kind: "owner", subject, docType: docTypeFor("owner", fileName) };
  }
  return { heading: folders.join(" · "), kind: "company", subject: top, docType: docTypeFor("company", fileName) };
}

/**
 * Takes off the folders a whole zip is wrapped in ("LEGO/1.0 HOTs/x.docx" →
 * "1.0 HOTs/x.docx"), while every file sits inside the same one and it is not
 * itself one of KYC4U's numbered folders. A pack downloaded from KYC4U's site
 * comes wrapped twice ("REQ113570  The Abigail Scheuer Trading Company
 * Limited/REQ113570/1.0 HOTs/…", seen 21 November 2026), so both are taken off.
 */
export function unwrapPackPaths(paths: string[]): string[] {
  let split = paths.map(p => String(p || "").split("/").filter(Boolean));
  while (split.length && split.every(s => s.length >= 2) && split.every(s => s[0] === split[0][0]) && !/^\d+(\.\d+)*\s/.test(split[0][0])) {
    split = split.map(s => s.slice(1));
  }
  return split.map(s => s.join("/"));
}

// ── KYC4U's AML Risk Assessment Report ───────────────────────────────────────

export interface Kyc4uRiskLine { factor: "client" | "geographic" | "other" | "pep"; label: string; value: string | null; details: string | null }
export interface Kyc4uLabelled { label: string; value: string | null }
export interface Kyc4uEntity { name: string; location: string | null; countryRisk: string | null; orgType: string | null; evidence: string[] }
export interface Kyc4uOwner { name: string; nationality: string | null; residence: string | null; idMethod: string | null; risk: string | null; pep: string | null; evidence: string[] }
export interface Kyc4uApproval { team: "kyc4u" | "fee_earner" | "nominated_officer"; label: string; approver: string | null; date: string | null }

export interface Kyc4uRiskReport {
  jobId: string | null;
  accountName: string | null;
  propertyAddress: string | null;
  jobType: string | null;
  agentName: string | null;
  workType: string | null;
  levelOfRisk: string | null;
  risks: Kyc4uRiskLine[];
  diligence: Kyc4uLabelled[];
  entities: Kyc4uEntity[];
  owners: Kyc4uOwner[];
  certified: Array<{ name: string; qualification: string | null; organisation: string | null }>;
  riskIdentified: string | null;
  mitigatingFactors: string | null;
  conclusion: string | null;
  /** The risks and their mitigation came as a two-column table, which plain text runs together: the server reads its columns by position. */
  assessmentTable?: boolean;
  counterparty: Kyc4uLabelled[];
  approvals: Kyc4uApproval[];
}

const FOOTER = [
  /^©\s*\d{4}\s*KYC4U\b.*$/i,
  /^Anti\s+Money\s+Laundering\s+Risk\s+Assessment\s+Report$/i,
  /^--\s*\d+\s+of\s+\d+\s*--$/,
  /^Page\s+\d+(\s+of\s+\d+)?$/i,
];

const HEADINGS = {
  job: /^Job\s+Details$/i,
  risk: /^Risk\s+Details$/i,
  diligence: /^Standard\s*\/\s*Enhanced\s+Due\s+Diligence$/i,
  structure: /^Details\s+of\s+Client\s+Structure,?\s+Ownership\s+And\s+Evidence$/i,
  owners: /^Details\s+of\s+Ultimate\s+Beneficial\s+Owners/i,
  certified: /^Details\s+of\s+Certified\s+Documents$/i,
  assessment: /^Detailed\s+Risk\s+Assessment$/i,
  counterparty: /^Counterparty\s+Details$/i,
  recommendation: /^Recommendation$/i,
} as const;
type Section = keyof typeof HEADINGS;

function sections(raw: string): Partial<Record<Section, string[]>> {
  const lines = String(raw || "").replace(/\r/g, "").split("\n").map(l => l.replace(/ /g, " ").replace(/[ ]+$/g, ""));
  const out: Partial<Record<Section, string[]>> = {};
  let current: Section | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t || FOOTER.some(re => re.test(t))) continue;
    const heading = (Object.keys(HEADINGS) as Section[]).find(k => HEADINGS[k].test(t));
    if (heading) { current = heading; out[heading] = out[heading] || []; continue; } // a heading repeated on the next page continues the section
    if (current) out[current]!.push(line);
  }
  return out;
}

const flat = (lines: string[] | undefined): string => (lines || []).join(" ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&").replace(/\s+/g, "\\s+");

/**
 * Values between known labels, in the template's order; a label not found is
 * skipped. Where a PDF's text wraps a long label round its value ("Geographic
 * Risk Low Indicators"), the label is found by its first words and the words
 * that wrapped are taken back out of the value.
 */
function labelled(body: string, labels: string[]): Map<string, string | null> {
  const found: Array<{ label: string; start: number; end: number; wrapped: string[] }> = [];
  let from = 0;
  for (const label of labels) {
    const words = label.split(/\s+/);
    let hit: { start: number; end: number; wrapped: string[] } | null = null;
    for (let n = words.length; n >= Math.max(2, Math.ceil(words.length * 0.5)) && !hit; n--) {
      const m = new RegExp(`${escapeRe(words.slice(0, n).join(" "))}(?![A-Za-z])`, "i").exec(body.slice(from));
      if (m) hit = { start: from + m.index, end: from + m.index + m[0].length, wrapped: words.slice(n) };
    }
    if (!hit) continue;
    found.push({ label, ...hit });
    from = hit.end;
  }
  const out = new Map<string, string | null>();
  for (const label of labels) out.set(label, null);
  found.forEach((f, i) => {
    let value = body.slice(f.end, i + 1 < found.length ? found[i + 1].start : body.length);
    for (const word of f.wrapped) {
      const re = new RegExp(`(^|\\s)${escapeRe(word)}(?=\\s|$)`, "gi");
      const all = Array.from(value.matchAll(re));
      const last = all[all.length - 1];
      if (last && last.index !== undefined) value = value.slice(0, last.index) + value.slice(last.index + last[0].length);
    }
    out.set(f.label, text(value) || null);
  });
  return out;
}

const cells = (line: string): string[] => line.split(/\t|\s{2,}/).map(text).filter(Boolean);

/** Table rows with their "- " evidence lines (wrapped lines joined to the bullet they belong to). */
function rowsWithEvidence(lines: string[] | undefined, minCells: number, header: RegExp): Array<{ cells: string[]; evidence: string[] }> {
  const rows: Array<{ cells: string[]; evidence: string[] }> = [];
  for (const line of lines || []) {
    const t = text(line);
    if (!t || header.test(t) || /^Details\s+of\s+Evidence$/i.test(t)) continue;
    const row = rows[rows.length - 1];
    if (/^[-•–]\s+/.test(t)) {
      if (row) row.evidence.push(t.replace(/^[-•–]\s+/, ""));
      continue;
    }
    const c = cells(line);
    if (c.length >= minCells) { rows.push({ cells: c, evidence: [] }); continue; }
    if (row && row.evidence.length) row.evidence[row.evidence.length - 1] = `${row.evidence[row.evidence.length - 1]} ${t}`;
  }
  return rows;
}

const dayFrom = (s: string | null | undefined): string | null => {
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1) return null;
  return d.toISOString().slice(0, 10);
};

const firstWord = (v: string | null): { value: string | null; details: string | null } => {
  const m = /^(Low|Medium|Moderate|Standard|High|Higher|Very\s+High|Enhanced|Simplified|N\/?A|None)\b\s*(.*)$/i.exec(text(v));
  if (!m) return { value: text(v) || null, details: null };
  return { value: text(m[1]), details: text(m[2]) || null };
};

const RISK_LABELS: Array<[Kyc4uRiskLine["factor"], string]> = [
  ["client", "Client Risk Indicators"],
  ["geographic", "Geographic Risk Indicators"],
  ["other", "Other Risk Indicators"],
  ["pep", "PEP Involved Risk Indicators"],
];
const DILIGENCE_LABELS = [
  "Structure Chart", "Authority To Instruct", "Adverse Media From Web Search", "Financial Statements", "Is This A Joint Agency?",
  "Are Documents Certified?", "Client Background", "Source Of Funds For Acquisitions", "Is A Trading Company?",
  "Non Trading Risk Indicator", "Non Trading Risk Description",
];
const COUNTERPARTY_LABELS = [
  "Name of Counterparty Agent", "Is the agent registered with HMRC?", "Does the agent have a compliance team?",
  "Is there any negative media around the agency?", "Name of counterparty solicitors",
  "What is the size and reputation of the solicitors?", "Is there any negative media around the solicitors?",
];
const APPROVAL_LABELS: Array<[Kyc4uApproval["team"], string]> = [
  ["kyc4u", "KYC4U Internal Approval"],
  ["fee_earner", "Fee Earner/Job Director Approval"],
  ["nominated_officer", "Nominated Officer Approval for higher Risk Clients"],
];

/**
 * KYC4U's "Detailed Risk Assessment", in the three layouts their reports use
 * (all seen in November 2026): RISK IDENTIFIED, MITIGATING FACTORS and
 * OVERALL CONCLUSION one under another; a "Risk Identified | Mitigation" table
 * then "Overall Conclusion", whose two columns plain text runs together (the
 * server splits them by position, then this keeps the two apart); or, on a
 * sanctions-only check, one paragraph with no headings, which is the
 * conclusion. A heading counts only on a line of its own, never inside a
 * sentence ("Considering the mitigating factors, ...").
 */
export function readKyc4uAssessment(lines: string[] | undefined): { riskIdentified: string | null; mitigatingFactors: string | null; conclusion: string | null; table: boolean } {
  // KYC4U's own text carries a written "\n" between points.
  const ls = (lines || []).map(l => text(String(l).replace(/\\n/g, " "))).filter(Boolean);
  const tableHead = (t: string) => /^risk\s+identified\s+mitigation$/i.test(t);
  const riskHead = (t: string) => /^risk\s+identified\b/i.test(t) && !tableHead(t);
  const mitigationHead = (t: string) => /^mitigating\s+factors\b/i.test(t);
  const conclusionHead = (t: string) => /^overall\s+conclusion\b/i.test(t);
  const join = (part: string[]) => text(part.join(" ")) || null;
  const after = (t: string, re: RegExp) => text(t.replace(re, ""));
  const table = ls.some(tableHead);
  const ci = ls.findIndex(conclusionHead);
  const conclusion = ci >= 0 ? join([after(ls[ci], /^overall\s+conclusion\b/i), ...ls.slice(ci + 1)]) : null;
  const body = ci >= 0 ? ls.slice(0, ci) : ls;
  if (table) {
    const both = join(body.filter(t => !tableHead(t)));
    return { riskIdentified: both ? `Risk and mitigation, as KYC4U's table gives them: ${both}` : null, mitigatingFactors: null, conclusion, table: true };
  }
  const ri = body.findIndex(riskHead);
  const mi = body.findIndex(mitigationHead);
  if (ri < 0 && mi < 0 && ci < 0) return { riskIdentified: null, mitigatingFactors: null, conclusion: join(ls), table: false };
  const riskIdentified = ri >= 0 ? join([after(body[ri], /^risk\s+identified\b/i), ...body.slice(ri + 1, mi > ri ? mi : body.length)]) : null;
  const mitigatingFactors = mi >= 0 ? join([after(body[mi], /^mitigating\s+factors\b/i), ...body.slice(mi + 1)]) : null;
  return { riskIdentified, mitigatingFactors, conclusion, table: false };
}

/** The table's two columns, read by position on the server: each cell's text in the right field. */
export function withKyc4uRiskTable(report: Kyc4uRiskReport, columns: { risk: string; mitigation: string } | null): Kyc4uRiskReport {
  if (!report.assessmentTable || !columns) return report;
  const clean = (v: string) => text(v.replace(/\\n/g, " ")) || null;
  const risk = clean(columns.risk), mitigation = clean(columns.mitigation);
  if (!risk && !mitigation) return report;
  return { ...report, riskIdentified: risk, mitigatingFactors: mitigation };
}

/** KYC4U's AML Risk Assessment Report, read from its text; null when the text is not one. */
export function readKyc4uRiskReport(raw: string): Kyc4uRiskReport | null {
  if (!/Risk\s+Assessment/i.test(raw) || !/KYC4U/i.test(raw)) return null;
  const s = sections(raw);
  if (!s.job && !s.risk && !s.recommendation) return null;

  const job = labelled(flat(s.job), ["Job ID", "Account Name", "Property Address", "Job Type", "Agent Name", "Work Type", "Level of Risk"]);
  const riskBody = flat(s.risk).replace(/^Risk\s+Factor\s+Risk\s+Value\s+Details\s+of\s+Risk\s*/i, "");
  const risk = labelled(riskBody, RISK_LABELS.map(([, l]) => l));
  const dil = labelled(flat(s.diligence), DILIGENCE_LABELS);
  const counter = labelled(flat(s.counterparty), COUNTERPARTY_LABELS);
  const assess = readKyc4uAssessment(s.assessment);
  const recBody = flat(s.recommendation).replace(/^Team\s+Approver\s+Date\s*/i, "");
  const rec = labelled(recBody, APPROVAL_LABELS.map(([, l]) => l));

  const jobIdText = job.get("Job ID");
  const jobId = kyc4uReferenceIn(jobIdText || "") || (jobIdText ? text(jobIdText).split(" ")[0] : null);

  return {
    jobId: jobId || null,
    accountName: job.get("Account Name") ?? null,
    propertyAddress: job.get("Property Address") ?? null,
    jobType: job.get("Job Type") ?? null,
    agentName: job.get("Agent Name") ?? null,
    workType: job.get("Work Type") ?? null,
    levelOfRisk: firstWord(job.get("Level of Risk") ?? null).value,
    risks: RISK_LABELS.map(([factor, label]) => ({ factor, label: label.replace(/\s+Indicators$/, ""), ...firstWord(risk.get(label) ?? null) })),
    diligence: DILIGENCE_LABELS.map(label => ({ label, value: dil.get(label) ?? null })),
    entities: rowsWithEvidence(s.structure, 3, /^Name\s+Location\s+Country\s+Risk\s+Org\s+Type$/i).map(r => ({
      name: r.cells[0], location: r.cells[1] || null, countryRisk: r.cells[2] || null, orgType: r.cells.slice(3).join(" ") || null, evidence: r.evidence,
    })),
    owners: rowsWithEvidence(s.owners, 4, /^Name\s+Nationality/i).map(r => ({
      name: r.cells[0], nationality: r.cells[1] || null, residence: r.cells[2] || null, idMethod: r.cells[3] || null,
      risk: r.cells[4] || null, pep: r.cells.slice(5).join(" ") || null, evidence: r.evidence,
    })),
    certified: rowsWithEvidence(s.certified, 2, /^Name\s+Qualification\s+Organi[sz]ation$/i).map(r => ({
      name: r.cells[0], qualification: r.cells[1] || null, organisation: r.cells.slice(2).join(" ") || null,
    })),
    riskIdentified: assess.riskIdentified,
    mitigatingFactors: assess.mitigatingFactors,
    conclusion: assess.conclusion,
    ...(assess.table ? { assessmentTable: true } : {}),
    counterparty: COUNTERPARTY_LABELS.map(label => ({ label, value: counter.get(label) ?? null })),
    approvals: APPROVAL_LABELS.map(([team, label]) => {
      const v = rec.get(label) ?? null;
      const date = dayFrom(v);
      const approver = text(String(v || "").replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, "")) || null;
      return { team, label, approver, date };
    }),
  };
}

const RISK_ORDER: Record<string, number> = { low: 0, simplified: 0, standard: 1, medium: 1, moderate: 1, high: 2, higher: 2, enhanced: 2, "very high": 3 };
/** KYC4U's level of risk, read as low, medium or high (null when not stated or not one of those). */
export function kyc4uRiskLevel(value: string | null | undefined): "low" | "medium" | "high" | null {
  const n = RISK_ORDER[text(value).toLowerCase()];
  return n === undefined ? null : n === 0 ? "low" : n === 1 ? "medium" : "high";
}

const shortDay = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
};

export interface Kyc4uResultPrefill {
  verdict: "approved" | null;     // only when KYC4U's own approval is dated in the report
  date: string | null;            // yyyy-mm-dd: KYC4U's approval, else the latest dated approval
  reference: string | null;
  note: string;
  highRisk: boolean;              // KYC4U rate it high risk: the approval lasts 1 year
  lines: string[];                // what was read, for the person to check
}

/** What the report fills on Add KYC4U result. The officer checks it and saves; nothing is saved by reading. */
export function kyc4uResultPrefill(report: Kyc4uRiskReport | null, fileReference: string | null = null): Kyc4uResultPrefill {
  if (!report) return { verdict: null, date: null, reference: fileReference, note: "", highRisk: false, lines: [] };
  const kyc4u = report.approvals.find(a => a.team === "kyc4u");
  const dated = report.approvals.filter(a => a.date).map(a => a.date!).sort();
  const date = kyc4u?.date || dated[dated.length - 1] || null;
  const level = kyc4uRiskLevel(report.levelOfRisk);
  const lines: string[] = [];
  if (report.jobId) lines.push(`KYC4U reference ${report.jobId}`);
  if (report.levelOfRisk) lines.push(`Level of risk: ${report.levelOfRisk}`);
  for (const r of report.risks) if (r.value) lines.push(`${r.label}: ${r.value}${r.details ? ` (${r.details})` : ""}`);
  for (const a of report.approvals) {
    if (a.date || a.approver) lines.push(`${a.label}: ${a.approver || "no approver named"}${a.date ? `, ${shortDay(a.date)}` : ", not dated"}`);
  }
  if (!kyc4u?.date) lines.push("KYC4U's own approval is not dated in the report, so the result is left for you to choose.");
  const note = [
    report.jobId ? `KYC4U's risk assessment ${report.jobId}` : "KYC4U's risk assessment",
    report.levelOfRisk ? `: ${report.levelOfRisk} risk.` : ".",
    report.conclusion ? ` ${report.conclusion}` : "",
  ].join("").replace(/\s+/g, " ").trim().slice(0, 1000);
  return {
    verdict: kyc4u?.date ? "approved" : null,
    date,
    reference: report.jobId || fileReference,
    note,
    highRisk: level === "high",
    lines,
  };
}

/** The reading kept on the result (the fields of its kyc4u_requests row), cut to what the screens and the AML file show. */
export function kyc4uAssessmentRecord(report: Kyc4uRiskReport): Record<string, unknown> {
  return {
    jobId: report.jobId, levelOfRisk: report.levelOfRisk, jobType: report.jobType, workType: report.workType,
    risks: report.risks, diligence: report.diligence.filter(d => d.value),
    entities: report.entities.slice(0, 12).map(e => ({ ...e, evidence: e.evidence.slice(0, 12) })),
    owners: report.owners.slice(0, 12).map(o => ({ ...o, evidence: o.evidence.slice(0, 12) })),
    certified: report.certified.slice(0, 12),
    riskIdentified: report.riskIdentified, mitigatingFactors: report.mitigatingFactors, conclusion: report.conclusion,
    counterparty: report.counterparty.filter(c => c.value), approvals: report.approvals,
  };
}
