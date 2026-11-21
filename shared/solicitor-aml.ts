// The other side's solicitors, checked (Woody, 21 November 2026, "do 7").
// BGP's AML policy (Issue 2, counterparties): "Is the counter party
// represented by an agent and / or solicitor? ... Is there any negative media
// around the agent and / or solicitor? What is the size and reputation of the
// agent and / or law firm?" KYC4U's risk assessment asks the same.
//
// Two searches with sources: the SRA register (and the Law Society's Find a
// Solicitor, which shows SRA numbers), read only from those sites; and the
// web for regulatory action or misconduct. Anything said without a source the
// search actually read is dropped, as for BGP's checks before asking. The
// SRA's own data API needs a key the app does not hold, so it is not used.
//
// Pure: server/solicitor-aml.ts runs the searches and stores each check.
import { checkWebAnswer, type WebFinding, type WebStatus } from "./kyc-prechecks";

export const SOLICITOR_REGISTER_SITES = ["sra.org.uk", "solicitors.lawsociety.org.uk"];

export type SolicitorRegisterStatus = "found" | "not_found" | "unsure" | "not_run";

export interface SolicitorCheck {
  firm: string;
  ranAt: string;
  register: {
    status: SolicitorRegisterStatus;
    firmName: string | null;
    sraNumber: string | null;
    authorisation: string | null;   // as the register words it ("Authorised", "Closed", "Intervened")
    office: string | null;
    url: string | null;
    unsourced: number;
  };
  media: { ran: boolean; status: WebStatus; findings: WebFinding[]; unsourced: number };
  errors: string[];
}

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch { return null; }
};
const onRegisterSite = (host: string | null) => !!host && SOLICITOR_REGISTER_SITES.some(s => host === s || host.endsWith(`.${s}`));

/** The firm's name as it is checked: plain, at most 120 characters; null when it is too short to search. */
export function solicitorFirmName(v: unknown): string | null {
  const t = clip(v, 120).replace(/[<>]/g, " ").trim();
  return t.replace(/[^A-Za-z0-9]/g, "").length >= 3 ? t : null;
}

/** The register search, kept only where its page is on the SRA's or the Law Society's site and among the pages read. */
export function checkRegisterAnswer(raw: unknown, citations: Array<{ url: string }>): SolicitorCheck["register"] {
  const r: any = raw && typeof raw === "object" ? raw : {};
  const cited = new Set(citations.map(c => hostOf(c?.url || "")).filter((h): h is string => !!h));
  const url = clip(r.url, 500);
  const host = hostOf(url);
  const sourced = onRegisterSite(host) && cited.has(host!);
  const said = r.found === "yes" ? "found" : r.found === "no" ? "not_found" : "unsure";
  if (said === "found" && !sourced) {
    return { status: "unsure", firmName: null, sraNumber: null, authorisation: null, office: null, url: null, unsourced: 1 };
  }
  const sra = clip(r.sraNumber, 20).replace(/[^0-9]/g, "");
  return {
    status: said === "found" ? "found" : said === "not_found" ? "not_found" : "unsure",
    firmName: sourced ? clip(r.firmName, 160) || null : null,
    sraNumber: sourced && sra.length >= 4 ? sra : null,
    authorisation: sourced ? clip(r.authorisation, 60) || null : null,
    office: sourced ? clip(r.office, 120) || null : null,
    url: sourced ? url : null,
    unsourced: 0,
  };
}

/** The web search for regulatory action or misconduct: only findings whose page was read. */
export function checkMediaAnswer(raw: unknown, citations: Array<{ url: string }>): Omit<SolicitorCheck["media"], "ran"> {
  const out = checkWebAnswer({ publicRole: { status: "none_found", findings: [] }, adverseMedia: (raw as any)?.adverseMedia ?? raw }, citations);
  return { status: out.adverseMedia, findings: out.findings.filter(f => f.kind === "adverse_media"), unsourced: out.unsourced };
}

const NOT_AUTHORISED = /closed|ceased|revoked|intervened|intervention|suspended|struck|not authorised|unauthorised/i;

/** Where the firm stands, in a line, and whether it needs a look. */
export function solicitorCheckWords(c: SolicitorCheck): { tone: "ok" | "attention" | "info"; words: string } {
  const reg = c.register;
  const regWords = reg.status === "found"
    ? `on the SRA register${reg.sraNumber ? ` (SRA ${reg.sraNumber}` : ""}${reg.authorisation ? `${reg.sraNumber ? ", " : " ("}${reg.authorisation.toLowerCase()}` : ""}${reg.sraNumber || reg.authorisation ? ")" : ""}`
    : reg.status === "not_found" ? "not found on the SRA register: check it is a firm of solicitors and its exact name"
    : reg.status === "not_run" ? "the SRA register could not be searched"
    : "the SRA register search was not conclusive: look it up on the SRA's site";
  const media = !c.media.ran ? "the web search did not run"
    : c.media.findings.length ? `${c.media.findings.length} report${c.media.findings.length === 1 ? "" : "s"} of regulatory action or misconduct to read`
    : "no negative media found";
  const attention = reg.status === "not_found" || (reg.status === "found" && NOT_AUTHORISED.test(reg.authorisation || "")) || c.media.findings.some(f => !f.unsureIdentity);
  const info = !attention && (reg.status !== "found" || !c.media.ran || c.media.findings.length > 0);
  return { tone: attention ? "attention" : info ? "info" : "ok", words: `${reg.firmName || c.firm}: ${regWords} · ${media}` };
}
