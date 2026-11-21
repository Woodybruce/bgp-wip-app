// The other side's solicitors, checked (Woody, 21 November 2026, "do 7").
// BGP's AML policy (Issue 2, counterparties): "Is the counter party
// represented by an agent and / or solicitor? ... Is there any negative media
// around the agent and / or solicitor? What is the size and reputation of the
// agent and / or law firm?" KYC4U's risk assessment asks the same.
//
// The register: the SRA's own data on every firm on its register (its data
// share, read once a day with BGP's key: shared/sra-register.ts, Woody's key
// of 21 November 2026). Without the key, or when the SRA's data cannot be
// read, a web search of the SRA register and the Law Society's Find a
// Solicitor, believed only from those sites. Then a web search for regulatory
// action or misconduct. Anything a search says without a source it actually
// read is dropped, as for BGP's checks before asking.
//
// Pure: server/solicitor-aml.ts runs the searches and stores each check.
import { checkWebAnswer, type WebFinding, type WebStatus } from "./kyc-prechecks";
import { sraChoice, sraRegisterPage, sraStatus, type SraChoice, type SraFirm, type SraHow, type SraLookup } from "./sra-register";

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
    /** Where the register line came from: the SRA's own data, or the web search (checks before 21 November 2026, or no key). */
    source?: "sra_data" | "web";
    /** The SRA's entry for the firm, as its data gave it. */
    sra?: SraFirm | null;
    /** When the app read the SRA's data. */
    readAt?: string;
    how?: SraHow | null;
    /** Other entries on the SRA's register that match the name, and the first few of them. */
    others?: number;
    alternatives?: SraChoice[];
    /** The person said none of this many entries was the firm. */
    declined?: number;
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

/**
 * The register line from the SRA's own data. A firm the lookup settled on is
 * "found" with its entry; none (or none of the matches, when the person said
 * so) is "not_found", which asks for a look on the SRA's register by hand.
 */
export function registerFromSra(lookup: SraLookup, readAt: string, opts: { declined?: boolean } = {}): SolicitorCheck["register"] {
  const others = lookup.candidates.length + lookup.more;
  const f = opts.declined ? null : lookup.firm;
  if (!f) {
    return {
      status: "not_found", firmName: null, sraNumber: null, authorisation: null, office: null, url: null, unsourced: 0,
      source: "sra_data", sra: null, readAt, how: null,
      others: opts.declined ? 0 : others,
      alternatives: opts.declined ? [] : lookup.candidates.slice(0, 5).map(c => sraChoice(c, lookup.query)),
      ...(opts.declined ? { declined: others + (lookup.firm ? 1 : 0) } : {}),
    };
  }
  const ho = f.headOffice;
  return {
    status: "found",
    firmName: f.name,
    sraNumber: f.sraNumber,
    authorisation: sraStatus(f).label,
    office: [ho?.town, ho?.postcode].filter(Boolean).join(" ") || null,
    url: sraRegisterPage(f.sraNumber),
    unsourced: 0,
    source: "sra_data", sra: f, readAt, how: lookup.how,
    others,
    alternatives: lookup.candidates.slice(0, 5).map(c => sraChoice(c, lookup.query)),
  };
}

const NOT_AUTHORISED = /closed|ceased|revoked|intervened|intervention|suspended|struck|not authorised|unauthorised/i;

const mediaWords = (c: SolicitorCheck) => !c.media.ran ? "the web search did not run"
  : c.media.findings.length ? `${c.media.findings.length} report${c.media.findings.length === 1 ? "" : "s"} of regulatory action or misconduct to read`
  : "no negative media found";

/** Where the firm stands, in a line, and whether it needs a look. */
export function solicitorCheckWords(c: SolicitorCheck): { tone: "ok" | "attention" | "info"; words: string } {
  const reg = c.register;
  if (reg.source === "sra_data") {
    const f = reg.sra || null;
    const st = f ? sraStatus(f) : null;
    const who = f ? `${f.name} (SRA ${f.sraNumber}${f.offices > 1 ? `, ${f.offices} offices` : ""})` : c.firm;
    const regWords = st ? st.line
      : reg.declined ? `none of the ${reg.declined} entr${reg.declined === 1 ? "y" : "ies"} on the SRA's register under that name is them: look them up on the SRA's register`
      : "not found on the SRA's register under that name: check its exact name, or look it up on the SRA's register";
    const attention = st?.tone === "attention" || c.media.findings.some(x => !x.unsureIdentity);
    const info = !attention && (!st || st.tone === "info" || !c.media.ran || c.media.findings.length > 0);
    return { tone: attention ? "attention" : info ? "info" : "ok", words: `${who}: ${regWords} · ${mediaWords(c)}` };
  }
  const regWords = reg.status === "found"
    ? `on the SRA register${reg.sraNumber ? ` (SRA ${reg.sraNumber}` : ""}${reg.authorisation ? `${reg.sraNumber ? ", " : " ("}${reg.authorisation.toLowerCase()}` : ""}${reg.sraNumber || reg.authorisation ? ")" : ""}`
    : reg.status === "not_found" ? "not found on the SRA register: check it is a firm of solicitors and its exact name"
    : reg.status === "not_run" ? "the SRA register could not be searched"
    : "the SRA register search was not conclusive: look it up on the SRA's site";
  const media = mediaWords(c);
  const attention = reg.status === "not_found" || (reg.status === "found" && NOT_AUTHORISED.test(reg.authorisation || "")) || c.media.findings.some(f => !f.unsureIdentity);
  const info = !attention && (reg.status !== "found" || !c.media.ran || c.media.findings.length > 0);
  return { tone: attention ? "attention" : info ? "info" : "ok", words: `${reg.firmName || c.firm}: ${regWords} · ${media}` };
}
