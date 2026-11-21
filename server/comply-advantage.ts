// ─────────────────────────────────────────────────────────────────────────
// ComplyAdvantage Mesh (rebuilt 2026-11-18; Woody: "need to get the API for
// comply back up and running").
//
// Sign-in: Mesh API credentials, an access key and a secret made in Mesh
// under Settings > Access Management > API Credentials, exchanged at
// POST /v3/token (Mesh's recommended sign-in). The older username, password
// and realm (POST /v2/token) still work when no API credentials are set, but
// that login locks the account after repeated failures, so any refused
// sign-in pauses every sign-in for a while.
//
// Screening: POST /v2/workflows/sync/create-and-screen, Mesh's own screen.
// Each screen is a customer record in Mesh, with ongoing monitoring off (the
// app screens again when it needs to) and a case in Mesh for every hit. One
// record per name per day: the same name screened again the same day reads
// the first screen's answer. A hit's matched profiles are read from its
// alerts. Until 18 November 2026 this file posted to /v2/searches, an old
// ComplyAdvantage address that Mesh does not have, so no screen ever ran.
//
// Env vars:
//   COMPLY_ADVANTAGE_ACCESS_KEY, COMPLY_ADVANTAGE_SECRET  (recommended)
//   COMPLY_ADVANTAGE_USERNAME, COMPLY_ADVANTAGE_PASSWORD, COMPLY_ADVANTAGE_REALM  (older login)
//   COMPLY_ADVANTAGE_SCREENING_CONFIG_ID  (optional: Settings > Screening
//     Configurations in Mesh; without it Mesh picks the configuration)
// ─────────────────────────────────────────────────────────────────────────
import crypto from "crypto";

const BASE_URL = "https://api.mesh.complyadvantage.com";
const REQUEST_TIMEOUT_MS = 25_000;
const SCREEN_CONCURRENCY = 4;
const MAX_ALERTS_READ = 2;
const RISKS_PAGE_SIZE = 50;

export interface MeshDeps {
  fetch: (url: string, init?: any) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; text(): Promise<string> }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  env: Record<string, string | undefined>;
}

const defaultDeps = (): MeshDeps => ({
  fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }) as any,
  now: Date.now,
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  env: process.env,
});

export type MeshCredentials =
  | { kind: "api"; accessKey: string; secret: string }
  | { kind: "legacy"; username: string; password: string; realm: string };

export function meshCredentials(env: Record<string, string | undefined> = process.env): MeshCredentials | null {
  const accessKey = env.COMPLY_ADVANTAGE_ACCESS_KEY?.trim();
  const secret = env.COMPLY_ADVANTAGE_SECRET?.trim();
  if (accessKey && secret) return { kind: "api", accessKey, secret };
  const username = env.COMPLY_ADVANTAGE_USERNAME?.trim();
  const password = env.COMPLY_ADVANTAGE_PASSWORD?.trim();
  const realm = env.COMPLY_ADVANTAGE_REALM?.trim();
  if (username && password && realm) return { kind: "legacy", username, password, realm };
  return null;
}

export function isComplyAdvantageConfigured(): boolean {
  return !!meshCredentials();
}

// ── State: the token and the two pauses ─────────────────────────────────────

let cachedToken: { value: string; expiresAt: number; key: string } | null = null;
let signInPause: { until: number; reason: string; key: string } | null = null;
let screenPause: { until: number; reason: string } | null = null;

// When Mesh refused a person's birth date or nationality (see screenOne), and
// Mesh's own words, which the connection check shows.
let meshRefusedDetailsAt = 0;
let meshRefusedDetailsWords = "";

export function resetComplyAdvantageState(): void {
  cachedToken = null;
  signInPause = null;
  screenPause = null;
  meshRefusedDetailsAt = 0;
  meshRefusedDetailsWords = "";
}

// Which credentials a token or a pause belongs to: new keys on Railway start
// afresh without waiting out a pause the old ones earned.
const credentialKey = (c: MeshCredentials): string => crypto.createHash("sha256")
  .update(c.kind === "api" ? `api|${c.accessKey}|${c.secret}` : `legacy|${c.username}|${c.realm}|${c.password}`)
  .digest("hex").slice(0, 16);

export type MeshErrorKind = "config" | "sign_in" | "permission" | "request" | "rate_limit" | "network" | "unfinished";

export class ComplyAdvantageError extends Error {
  constructor(message: string, public kind: MeshErrorKind) { super(message); }
}

// Mesh's own words from an error body, never more than a line.
export function meshProblemWords(text: string): string {
  let words = "";
  try {
    const body = JSON.parse(text);
    words = [body?.detail, body?.error_description, body?.message, body?.title, body?.error].find(v => typeof v === "string" && v.trim()) || "";
  } catch {
    words = /^\s*</.test(text) ? "" : text;
  }
  return words.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function readJson(res: { text(): Promise<string> }): Promise<any> {
  const text = await res.text().catch(() => "");
  try { return JSON.parse(text); } catch { return null; }
}

export async function getToken(deps: MeshDeps = defaultDeps()): Promise<string> {
  const creds = meshCredentials(deps.env);
  if (!creds) throw new ComplyAdvantageError("no ComplyAdvantage keys are set", "config");
  const key = credentialKey(creds);
  const now = deps.now();
  if (cachedToken && cachedToken.key === key && now < cachedToken.expiresAt) return cachedToken.value;
  if (signInPause && signInPause.key === key && now < signInPause.until) {
    throw new ComplyAdvantageError(`ComplyAdvantage sign-in paused after ${signInPause.reason}`, "sign_in");
  }
  const path = creds.kind === "api" ? "/v3/token" : "/v2/token";
  const body = creds.kind === "api"
    ? { access_key: creds.accessKey, secret: creds.secret }
    : { username: creds.username, password: creds.password, realm: creds.realm };
  let res;
  try {
    res = await deps.fetch(`${BASE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e: any) {
    throw new ComplyAdvantageError(`ComplyAdvantage did not answer the sign-in (${String(e?.message || e).slice(0, 120)})`, "network");
  }
  if (!res.ok) {
    const words = meshProblemWords(await res.text().catch(() => ""));
    const reason = `${res.status} on ${path}${words ? `: ${words}` : ""}`;
    // The older login's 429 is a lockout ("blocked after multiple consecutive
    // login attempts") that every retry keeps closed (seen live 2026-09-06);
    // API credentials' 429 is the ordinary rate limit. Bad keys pause too.
    if ([400, 401, 403, 429].includes(res.status)) {
      const minutes = res.status === 429 ? (creds.kind === "legacy" ? 60 : 5) : 15;
      signInPause = { until: now + minutes * 60_000, reason, key };
      console.error(`[ComplyAdvantage] Sign-in refused (${reason}); no sign-in for ${minutes} minutes. Check the ComplyAdvantage keys on Railway.`);
    }
    throw new ComplyAdvantageError(`ComplyAdvantage refused the sign-in (${reason})`, "sign_in");
  }
  const data = await readJson(res);
  const token = typeof data?.access_token === "string" ? data.access_token : "";
  if (!token) throw new ComplyAdvantageError("ComplyAdvantage's sign-in answer had no token", "sign_in");
  const expiresIn = Number(data?.expires_in) > 0 ? Number(data.expires_in) : 86_400;
  // Tokens last a day with no refresh: take a new one an hour early.
  cachedToken = { value: token, expiresAt: now + Math.max(60, expiresIn - 3600) * 1000, key };
  signInPause = null;
  return token;
}

// ── The subject ─────────────────────────────────────────────────────────────

export type MeshSubjectKind = "person" | "company";

export interface ScreenSubject {
  name: string;
  role?: string;
  kind?: MeshSubjectKind;
  birthYear?: number | null;
  // Since 19 November 2026 (Woody: "Tighten"): sent to Mesh with a person, so
  // its score can tell the person from someone else of the same name.
  birthMonth?: number | null;
  // ISO 3166 alpha-2 nationality, such as "GB".
  nationality?: string | null;
}

const CORPORATE_WORDS = /\b(limited|ltd|plc|llp|l\.l\.p|inc|incorporated|corp|corporation|gmbh|s\.?a\.?r\.?l|b\.?v|n\.?v|s\.?p\.?a|holdings?|group|trust|partnership|lp|fund|properties|estates|investments|capital|ventures|foundation)\b/i;
const PERSON_ROLES = /\b(officer|director|secretary|psc|owner|person|individual|contact|member|partner|beneficial)\b/i;

// A caller that says what the subject is decides; otherwise a corporate word
// in the name makes it a company, a person's role makes it a person, and
// anything else goes to Mesh as a customer of no stated type.
export function subjectKind(s: ScreenSubject): MeshSubjectKind | null {
  if (s.kind) return s.kind;
  if (/^company$/i.test(String(s.role || "")) || CORPORATE_WORDS.test(s.name)) return "company";
  if (PERSON_ROLES.test(String(s.role || ""))) return "person";
  return null;
}

const HONORIFIC = /^(mr|mrs|ms|miss|mx|dr|sir|dame|lord|lady|prof|professor|rev|revd)\.?\s+/i;

// The name as Mesh should read it: a register's "DOE, Jane" becomes
// "Jane Doe" and a leading Mr or Mrs is dropped for a person.
export function meshName(s: ScreenSubject, kind: MeshSubjectKind | null): string {
  let name = s.name.replace(/\s+/g, " ").trim();
  if (kind === "person") {
    const comma = /^([^,]+),\s*(.+)$/.exec(name);
    if (comma) name = `${comma[2]} ${comma[1]}`;
    name = name.replace(HONORIFIC, "");
  }
  return name.slice(0, 255);
}

const nameKey = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");

const londonDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date(ms)).replace(/-/g, "");

// One Mesh customer per name, kind and year of birth per London day. It is
// never a CRM id: the same director met on two deals is one screen.
export function meshExternalId(s: ScreenSubject, kind: MeshSubjectKind | null, nowMs: number): string {
  const hash = crypto.createHash("sha256").update(`${kind || "undefined"}|${nameKey(meshName(s, kind))}|${s.birthYear || ""}`).digest("hex").slice(0, 20);
  return `bgp-${kind ? kind[0] : "u"}-${hash}-${londonDay(nowMs)}`;
}

// Mesh's person record needs a last name: its schema (ol_Person in
// createCustomerAndScreenSync) requires last_name, and until 19 November 2026
// the app sent only full_name, the likeliest reason Mesh refused the date of
// birth sent with it (Woody: "comply advantage not picking up DOB"). The
// register writes a director "SURNAME, Forenames"; any other name is read as
// forenames and then a surname, a leading Mr or Mrs dropped.
export function meshNameParts(s: ScreenSubject): { first_name?: string; middle_name?: string; last_name: string } {
  const raw = s.name.replace(/\s+/g, " ").trim();
  const comma = /^([^,]+),\s*(.+)$/.exec(raw);
  const given = (comma ? comma[2] : raw).replace(HONORIFIC, "").split(" ").filter(Boolean);
  const last = comma ? comma[1].trim() : given.pop() || raw;
  const out: { first_name?: string; middle_name?: string; last_name: string } = { last_name: last.slice(0, 100) };
  if (given[0]) out.first_name = given[0].slice(0, 100);
  if (given.length > 1) out.middle_name = given.slice(1).join(" ").slice(0, 50);
  return out;
}

// A person's birth year (and month, when known) and nationality go with the
// name: Mesh's person takes date_of_birth as { day, month, year }, each
// nullable, and nationality as alpha-2 codes. `bare` leaves them out (Mesh
// refused them once: meshRefusedDetails).
export function meshPersonDetails(s: ScreenSubject): Record<string, any> {
  const out: Record<string, any> = {};
  const year = Number(s.birthYear);
  if (Number.isInteger(year) && year > 1900 && year <= new Date().getUTCFullYear()) {
    const month = Number(s.birthMonth);
    out.date_of_birth = { year, month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null, day: null };
  }
  if (s.nationality && /^[A-Z]{2}$/.test(s.nationality)) out.nationality = [s.nationality];
  return out;
}

export function meshScreenBody(s: ScreenSubject, externalId: string, screeningConfigId?: string | null, opts: { bare?: boolean } = {}): Record<string, any> {
  const kind = subjectKind(s);
  const name = meshName(s, kind);
  const customer: Record<string, any> = { external_identifier: externalId };
  if (kind === "person") customer.person = { full_name: name, ...meshNameParts(s), ...(opts.bare ? {} : meshPersonDetails(s)) };
  else if (kind === "company") customer.company = { legal_name: name };
  else customer.undefined = { name };
  const body: Record<string, any> = { customer, monitoring: { entity_screening: { enabled: false } } };
  if (screeningConfigId) body.configuration = { screening_configuration_identifier: screeningConfigId };
  return body;
}

// ── Reading Mesh's answer ───────────────────────────────────────────────────

export type MatchKind = "sanctions" | "pep" | "adverse_media" | "warning" | "fitness_probity";

// Mesh's AML types in the words the rest of the app reads.
export function amlKind(type: string): MatchKind | string {
  const t = String(type || "").toUpperCase();
  if (t.startsWith("SANCTION")) return "sanctions";
  if (t.startsWith("PEP")) return "pep";
  if (t.includes("ADVERSE")) return "adverse_media";
  if (t.startsWith("WARNING")) return "warning";
  if (t.includes("FITNESS")) return "fitness_probity";
  return t.toLowerCase();
}

const kindsOf = (types: unknown): string[] => [...new Set((Array.isArray(types) ? types : []).map(t => amlKind(String(t))).filter(Boolean))];

export interface MeshScreenRead {
  outcome: "clear" | "hits" | "unfinished";
  kinds: string[];
  alertIds: string[];
  customerId: string | null;
  reason: string | null;
}

export function readScreen(state: any): MeshScreenRead {
  const steps = state?.step_details || {};
  const customerId = steps["customer-creation"]?.step_output?.customer_identifier || null;
  const screening = steps["customer-screening"] || null;
  const status = String(screening?.status || "").toUpperCase();
  const output = screening?.step_output || {};
  const result = String(output.screening_result || "").toUpperCase();
  const alertIds = (Array.isArray(steps.alerting?.step_output?.alerts) ? steps.alerting.step_output.alerts : [])
    .map((a: any) => a?.identifier).filter((id: any) => typeof id === "string" && id);
  if (status === "COMPLETED" && result === "NO_PROFILES") return { outcome: "clear", kinds: [], alertIds, customerId, reason: null };
  if (status === "COMPLETED" && result === "HAS_PROFILES") return { outcome: "hits", kinds: kindsOf(output.aml_types), alertIds, customerId, reason: null };
  if (status === "SKIPPED") return { outcome: "unfinished", kinds: [], alertIds, customerId, reason: "Mesh skipped the screen: its risk model rated the customer prohibited" };
  return { outcome: "unfinished", kinds: [], alertIds, customerId, reason: `Mesh's screen did not finish (${status || String(state?.status || "no status")})` };
}

export interface ScreeningMatch {
  name: string;
  matchType: string; // "sanctions" | "pep" | "adverse_media" | "warning" | "fitness_probity"
  listName?: string;
  score?: number;
  details?: Record<string, unknown>;
}

export interface ScreeningResult {
  name: string;
  role?: string;
  // "error" = the screen did not run (provider down / misconfigured). It is
  // never reported as clear — a failed check is not a passed check.
  status: "clear" | "potential_match" | "strong_match" | "error";
  matches: ScreeningMatch[];
  riskLevel?: string;
  error?: string;
  errorKind?: MeshErrorKind;
  // Matched profiles left out because no date of birth on them can be the
  // subject's (profileDobAgrees).
  setAside?: number;
  customerId?: string | null;
}

// A profile's dates of birth as a year and, where it gives one, a month.
// Mesh writes them as "1960-01-01T00:00:00.000Z" (its own documentation's
// example); a first of January is read as the year alone, the usual stand-in
// when only the year is known.
export type ProfileDob = { year: number; month: number | null };
export function profileDobs(values: unknown): ProfileDob[] {
  const out: ProfileDob[] = [];
  for (const d of Array.isArray(values) ? values : []) {
    if (d && typeof d === "object" && !("value" in d) && Number.isInteger(Number((d as any).year))) {
      const month = Number((d as any).month);
      out.push({ year: Number((d as any).year), month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null });
      continue;
    }
    const text = String((d as any)?.value ?? d ?? "");
    const full = /\b(1[89]\d\d|20\d\d)-(\d{2})-(\d{2})/.exec(text);
    if (full) {
      const month = Number(full[2]);
      out.push({ year: Number(full[1]), month: month >= 1 && month <= 12 && !(month === 1 && Number(full[3]) === 1) ? month : null });
      continue;
    }
    const year = /\b(1[89]\d\d|20\d\d)\b/.exec(text);
    if (year) out.push({ year: Number(year[1]), month: null });
  }
  return out;
}

/**
 * Whether a date of birth on a profile can be the subject's: the same year and
 * month when both give a month (Companies House gives every director's and
 * owner's), otherwise within a year (the free sanctions lists' rule).
 */
export function profileDobAgrees(d: ProfileDob, subject: Pick<ScreenSubject, "birthYear" | "birthMonth">): boolean {
  const year = Number(subject.birthYear);
  const month = Number(subject.birthMonth);
  if (d.month && Number.isInteger(month) && month >= 1 && month <= 12) return d.year === year && d.month === month;
  return Math.abs(d.year - year) <= 1;
}

const sourceName = (list: unknown): string | undefined => {
  const first = (Array.isArray(list) ? list : []).find((s: any) => typeof s?.name === "string" || typeof s?.title === "string");
  return first ? String(first.name || first.title).slice(0, 160) : undefined;
};

// A profile's media items, as far as Mesh gives them: the title, the link
// and the date, for the deal's AML box to show (19 November 2026).
const mediaItems = (list: unknown): Array<{ title: string; url: string | null; date: string | null }> =>
  (Array.isArray(list) ? list : []).slice(0, 4).map((m: any) => ({
    title: String(m?.title || m?.name || m?.snippet || "").replace(/\s+/g, " ").trim().slice(0, 200),
    url: typeof m?.url === "string" ? m.url.slice(0, 500) : typeof m?.link === "string" ? m.link.slice(0, 500) : null,
    date: String(m?.date || m?.publication_date || m?.published_at || m?.publishedAt || "").slice(0, 20) || null,
  })).filter(m => m.title || m.url);

// A matched profile becomes one match per kind it carries, as the old
// search's hits did, so a profile that is both sanctioned and a PEP still
// reads as a PEP to the screens that look for one.
export function matchesFromRisks(risks: any[], subject: ScreenSubject, kind: MeshSubjectKind | null): { matches: ScreeningMatch[]; setAside: number } {
  const matches: ScreeningMatch[] = [];
  let setAside = 0;
  for (const risk of risks) {
    const profile = risk?.detail?.profile;
    if (!profile) continue;
    const indicators = profile.risk_indicators || {};
    const dobs = profileDobs(profile.person?.dates_of_birth);
    const dobYears = dobs.map(d => d.year);
    if (kind === "person" && subject.birthYear && dobs.length && dobs.every(d => !profileDobAgrees(d, subject))) {
      setAside++;
      continue;
    }
    // Mesh's screens show scores 0 to 100; a score given as a fraction is kept as it is.
    const raw = Number(profile.match_score);
    const score = Number.isFinite(raw) && raw >= 0 ? (raw <= 1 ? raw : raw <= 100 ? raw / 100 : undefined) : undefined;
    const birthYearAgrees = kind === "person" && subject.birthYear && dobs.length
      ? dobs.some(d => profileDobAgrees(d, subject)) : null;
    const kinds = kindsOf(indicators.aml_types);
    for (const k of kinds.length ? kinds : ["warning"]) {
      matches.push({
        name: String(profile.matching_name || subject.name).slice(0, 200),
        matchType: k,
        listName: k === "sanctions" ? sourceName(indicators.sanctions) : k === "pep" ? sourceName(indicators.peps)
          : k === "adverse_media" ? sourceName(indicators.media) : sourceName(indicators.lists),
        score,
        details: {
          profileId: profile.identifier || null,
          matchTypes: Array.isArray(profile.match_types) ? profile.match_types : [],
          decision: risk.decision || null,
          datesOfBirth: dobYears,
          birthYearAgrees,
          kinds,
          media: k === "adverse_media" ? mediaItems(indicators.media) : [],
        },
      });
    }
  }
  return { matches, setAside };
}

// ── Calls ───────────────────────────────────────────────────────────────────

const WORKFLOW_ID = /\/v2\/workflows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const ANY_UUID = /workflow[^0-9a-f]{0,40}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// The earlier workflow a 409 points to, when its body names one.
export function conflictWorkflowId(text: string): string | null {
  return WORKFLOW_ID.exec(text)?.[1] || ANY_UUID.exec(text)?.[1] || null;
}

const retryAfterMs = (res: { headers?: { get(name: string): string | null } }, fallback: number): number => {
  const v = res.headers?.get?.("retry-after");
  const seconds = v != null ? Number(v) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 30_000) : fallback;
};

interface CallResult { status: number; data: any; text: string }

// One authenticated call: a refused token is replaced once, a rate limit is
// waited out twice, and a server error or dropped connection is tried again
// once. Mesh's create-and-screen takes the same request again safely.
async function meshCall(method: "GET" | "POST", path: string, body: unknown, deps: MeshDeps): Promise<CallResult> {
  let token = await getToken(deps);
  let refreshed = false, limited = 0, retried = false;
  for (;;) {
    let res;
    try {
      res = await deps.fetch(`${BASE_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e: any) {
      if (!retried) { retried = true; await deps.sleep(1500); continue; }
      throw new ComplyAdvantageError(`ComplyAdvantage did not answer (${String(e?.message || e).slice(0, 120)})`, "network");
    }
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      cachedToken = null;
      token = await getToken(deps);
      continue;
    }
    if (res.status === 429 && limited < 2) {
      limited++;
      await deps.sleep(retryAfterMs(res, 2000 * limited));
      continue;
    }
    if (res.status >= 500 && !retried) { retried = true; await deps.sleep(1500); continue; }
    const text = await res.text().catch(() => "");
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data, text };
  }
}

const meshFailure = (call: CallResult, what: string): ComplyAdvantageError => {
  const words = meshProblemWords(call.text);
  const tail = `${call.status}${words ? `: ${words}` : ""}`;
  if (call.status === 401) return new ComplyAdvantageError(`ComplyAdvantage refused the sign-in (${tail})`, "sign_in");
  if (call.status === 403) return new ComplyAdvantageError(`ComplyAdvantage's login may not ${what} (${tail})`, "permission");
  if (call.status === 429) return new ComplyAdvantageError(`ComplyAdvantage asked us to slow down (${tail})`, "rate_limit");
  if (call.status === 404 || call.status === 405) return new ComplyAdvantageError(`ComplyAdvantage has no such address (${tail})`, "config");
  return new ComplyAdvantageError(`ComplyAdvantage refused to ${what} (${tail})`, "request");
};

async function readRisks(alertIds: string[], deps: MeshDeps): Promise<{ risks: any[]; complete: boolean }> {
  const risks: any[] = [];
  let complete = alertIds.length > 0 && alertIds.length <= MAX_ALERTS_READ;
  for (const id of alertIds.slice(0, MAX_ALERTS_READ)) {
    const call = await meshCall("GET", `/v2/alerts/${encodeURIComponent(id)}/risks?page_number=1&page_size=${RISKS_PAGE_SIZE}`, undefined, deps);
    if (call.status !== 200) throw meshFailure(call, "read a hit's matched profiles");
    const page = Array.isArray(call.data?.risks) ? call.data.risks.filter((r: any) => !r?.type || r.type === "ENTITY_SCREENING") : [];
    risks.push(...page);
    const total = Number(call.data?.total_count);
    if (call.data?.next || (Number.isFinite(total) && total > page.length)) complete = false;
  }
  return { risks, complete };
}

// When Mesh refused a person's birth date or nationality, the next day's
// screens send the bare name (kept in memory; a restart tries again).
export const meshRefusedDetailsRecently = (nowMs: number): boolean => meshRefusedDetailsAt > 0 && nowMs - meshRefusedDetailsAt < 86_400_000;
export function noteMeshRefusedDetails(nowMs: number, words = ""): void { meshRefusedDetailsAt = nowMs; meshRefusedDetailsWords = words; }
export function forgetMeshRefusedDetails(): void { meshRefusedDetailsAt = 0; meshRefusedDetailsWords = ""; }
/** The last refusal in this process, with Mesh's own words: the connection check shows it. */
export const meshRefusedDetails = (): { at: number; words: string } | null =>
  meshRefusedDetailsAt > 0 ? { at: meshRefusedDetailsAt, words: meshRefusedDetailsWords } : null;

async function screenOne(subject: ScreenSubject, deps: MeshDeps): Promise<ScreeningResult> {
  const base = { name: subject.name, role: subject.role };
  const kind = subjectKind(subject);
  const configId = deps.env.COMPLY_ADVANTAGE_SCREENING_CONFIG_ID?.trim() || null;
  let externalId = meshExternalId(subject, kind, deps.now());
  let state: any = null;
  // A person's birth date and nationality go with the name unless Mesh has
  // refused them in the last day: then, and on a refusal now, the bare name.
  let bare = kind !== "person" || Object.keys(meshPersonDetails(subject)).length === 0 || meshRefusedDetailsRecently(deps.now());
  for (let attempt = 0; attempt < 3 && !state; attempt++) {
    const call = await meshCall("POST", "/v2/workflows/sync/create-and-screen?last_sync_step=ALERTING", meshScreenBody(subject, externalId, configId, { bare }), deps);
    if (call.status === 200 || call.status === 201) { state = call.data; break; }
    if (!bare && (call.status === 400 || call.status === 422)) {
      const words = meshProblemWords(call.text);
      console.warn(`[ComplyAdvantage] Mesh refused a birth date or nationality (${call.status}${words ? `: ${words}` : ""}); screening on the name alone`);
      noteMeshRefusedDetails(deps.now(), words || `answered ${call.status}`);
      bare = true;
      continue;
    }
    if (call.status !== 409) throw meshFailure(call, "create and screen customers");
    // The name was screened already today (or is being screened now): read
    // that screen's answer, else screen it under a fresh record.
    const earlier = conflictWorkflowId(call.text);
    if (earlier) {
      const read = await meshCall("GET", `/v2/workflows/${earlier}`, undefined, deps);
      if (read.status === 200 && read.data?.step_details?.["customer-screening"]) { state = read.data; break; }
    }
    externalId = `${externalId}-${crypto.randomBytes(3).toString("hex")}`;
  }
  if (!state) throw new ComplyAdvantageError("ComplyAdvantage kept refusing a new record for this name (409)", "request");
  const screen = readScreen(state);
  if (screen.outcome === "unfinished") return { ...base, status: "error", matches: [], error: screen.reason || "Mesh's screen did not finish", errorKind: "unfinished", customerId: screen.customerId };
  if (screen.outcome === "clear") return { ...base, status: "clear", matches: [], customerId: screen.customerId };
  // The profiles behind a hit could not be read: kinds only, marked unread (nothing to judge them by).
  const fallback = (): ScreeningMatch[] => (screen.kinds.length ? screen.kinds : ["warning"]).map(k => ({ name: subject.name, matchType: k, details: { unread: true } }));
  try {
    const { risks, complete } = await readRisks(screen.alertIds, deps);
    const { matches, setAside } = matchesFromRisks(risks, subject, kind);
    if (matches.length) return { ...base, status: "potential_match", matches, setAside, customerId: screen.customerId };
    if (complete && setAside > 0) return { ...base, status: "clear", matches: [], setAside, customerId: screen.customerId };
  } catch (e: any) {
    console.warn(`[ComplyAdvantage] Matched profiles for a hit could not be read: ${e?.message}`);
  }
  return { ...base, status: "potential_match", matches: fallback(), customerId: screen.customerId };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/**
 * Screen names against ComplyAdvantage's sanctions, PEP, warning and adverse
 * media data. Never throws: a screen that could not run is an "error" line.
 */
export async function screenNames(names: ScreenSubject[], deps: MeshDeps = defaultDeps()): Promise<ScreeningResult[]> {
  if (!meshCredentials(deps.env)) return [];
  const subjects = names.filter(n => n && typeof n.name === "string" && n.name.trim());
  const failAll = (from: number, message: string, kind: MeshErrorKind, out: ScreeningResult[]) => {
    for (let j = from; j < subjects.length; j++) {
      if (!out[j]) out[j] = { name: subjects[j].name, role: subjects[j].role, status: "error", matches: [], error: message, errorKind: kind };
    }
  };
  const out: ScreeningResult[] = new Array(subjects.length);
  if (screenPause && deps.now() < screenPause.until) {
    failAll(0, `Screening paused: ${screenPause.reason}`, "config", out);
    return out;
  }
  try {
    await getToken(deps);
  } catch (e: any) {
    failAll(0, String(e?.message || "ComplyAdvantage sign-in failed"), e?.kind || "sign_in", out);
    return out;
  }
  const stop: { err: ComplyAdvantageError | null } = { err: null };
  await mapLimit(subjects, SCREEN_CONCURRENCY, async (subject, i) => {
    if (stop.err) return;
    try {
      out[i] = await screenOne(subject, deps);
    } catch (e: any) {
      const err = e instanceof ComplyAdvantageError ? e : new ComplyAdvantageError(String(e?.message || "request failed"), "request");
      out[i] = { name: subject.name, role: subject.role, status: "error", matches: [], error: err.message, errorKind: err.kind };
      // A refused sign-in, a login without the permission or an address Mesh
      // does not have will refuse every name: stop, and pause for a while.
      if (["sign_in", "permission", "config"].includes(err.kind) && !stop.err) {
        stop.err = err;
        if (err.kind !== "sign_in") screenPause = { until: deps.now() + 10 * 60_000, reason: err.message };
        console.error(`[ComplyAdvantage] Stopping this batch: ${err.message}`);
      }
    }
  });
  if (stop.err) failAll(0, stop.err.message, stop.err.kind, out);
  return out;
}

// ── Checking the connection (reads only: nothing is created in Mesh) ────────

export interface MeshCheck {
  ok: boolean;
  credentials: "api" | "legacy" | null;
  message: string;
  configurations: Array<{ identifier: string; name: string; archived: boolean; settings?: string }>;
  screeningConfigId: string | null;
  screeningConfigFound: boolean | null;
}

const FILTER_WORDS: Record<string, string> = {
  FILTER_ATTRIBUTE_YEAR_OF_BIRTH: "year of birth",
  FILTER_ATTRIBUTE_COUNTRY: "country",
  FILTER_ATTRIBUTE_LAST_ACTIVE_DATE: "last active date",
};

/**
 * What a screening configuration screens and how closely, in a line (Woody,
 * 18 November 2026, after setting one up in Mesh: "did 50 broad? that ok?
 * can you check"). Mesh lists two shapes: an older configuration sets a
 * fuzziness per collection, a newer one a match threshold (only hits scoring
 * at or above it come back, so a lower one returns more). Both are 0 to 1 in
 * the API and 0 to 100 on Mesh's own screens, which is how they are shown.
 */
export function describeMeshConfiguration(configuration: any): string {
  const cols: any[] = Array.isArray(configuration?.source_collections) ? configuration.source_collections : [];
  const scale = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n <= 1 ? n * 100 : n) : null;
  };
  const words = (t: unknown) => String(t || "").split(".")[0].replace(/^[a-z]_/, "").replace(/_/g, " ").trim();
  // A mismatch can carry a tolerance in whole years (ISO 8601, "P1Y" is plus or minus a year).
  const years = (iso: unknown): number | null => {
    const m = /^P(\d+)Y$/i.exec(String(iso ?? "").trim());
    return m ? Number(m[1]) : null;
  };
  const filterWords = (filters: unknown): string[] => (Array.isArray(filters) ? filters : []).map((f: any) => {
    const what = FILTER_WORDS[String(f?.key || "")] || String(f?.key || "").replace(/^FILTER_ATTRIBUTE_/, "").replace(/_/g, " ").toLowerCase();
    const within = f?.mismatch ? years(f.mismatch?.tolerance) : null;
    const how = f?.mismatch ? (within ? `mismatch over ${within} year${within === 1 ? "" : "s"}` : "mismatch")
      : f?.absent ? "missing" : f?.older_than ? `older than ${f.older_than?.threshold || "a set time"}` : "";
    return `${what} ${how}`.trim();
  }).filter(Boolean);
  const parts: string[] = [];
  for (const c of cols.slice(0, 12)) {
    const risks = [...new Set((Array.isArray(c?.risks) ? c.risks : []).map((r: any) => words(r?.taxonomy)).filter(Boolean))];
    const aml = Array.isArray(c?.aml_types) ? c.aml_types.slice(0, 4).map(String) : [];
    // What a collection screens is shown whether or not it has a name (Woody, 21 November 2026, after
    // splitting the collections: "can you check ive done it correctly?").
    const kinds = (risks.length ? risks : aml).slice(0, 10);
    const name = String(c?.name || "").trim();
    const label = name ? (kinds.length ? `${name} [${kinds.join(", ")}]` : name) : kinds.join(", ") || "a collection";
    const threshold = scale(c?.match_threshold);
    const fuzziness = scale(c?.fuzziness);
    const level = threshold !== null ? `match threshold ${threshold}` : fuzziness !== null ? `fuzziness ${fuzziness}%` : "";
    const extras = [
      ...filterWords(c?.exclusion_filters).map(w => `leaves out ${w}`),
      ...(Array.isArray(c?.options) && c.options.length ? [`options ${c.options.slice(0, 6).join(", ")}`] : []),
    ];
    parts.push(`${label}${level ? `: ${level}` : ""}${extras.length ? ` (${extras.join("; ")})` : ""}`);
  }
  if (Array.isArray(configuration?.configuration_options) && configuration.configuration_options.length) {
    parts.push(`options ${configuration.configuration_options.slice(0, 6).join(", ")}`);
  }
  if (Array.isArray(configuration?.country_filters) && configuration.country_filters.length) {
    parts.push(`countries ${configuration.country_filters.slice(0, 8).join(", ")}`);
  }
  if (configuration?.results_limit) parts.push(`up to ${configuration.results_limit} results`);
  return parts.join("; ");
}

export async function checkComplyAdvantage(deps: MeshDeps = defaultDeps()): Promise<MeshCheck> {
  const creds = meshCredentials(deps.env);
  const screeningConfigId = deps.env.COMPLY_ADVANTAGE_SCREENING_CONFIG_ID?.trim() || null;
  const base = { credentials: creds?.kind ?? null, configurations: [] as MeshCheck["configurations"], screeningConfigId, screeningConfigFound: null as boolean | null };
  if (!creds) return { ...base, ok: false, message: "No ComplyAdvantage keys are set: add COMPLY_ADVANTAGE_ACCESS_KEY and COMPLY_ADVANTAGE_SECRET (Mesh: Settings > Access Management > API Credentials)" };
  const how = creds.kind === "api" ? "API credentials" : "the older username and password";
  try {
    await getToken(deps);
  } catch (e: any) {
    return { ...base, ok: false, message: `Signing in with ${how} failed: ${e?.message || "unknown"}` };
  }
  try {
    // Mesh lists configurations at two addresses: /v2 and, for accounts on
    // its newer data pipeline, /v3. The first answered "none" on live on
    // 18 November 2026, so an empty or missing /v2 list reads /v3 as well.
    const readList = (call: CallResult) => (Array.isArray(call.data?.configurations) ? call.data.configurations : []).map((c: any) => {
      const settings = describeMeshConfiguration(c?.configuration);
      return {
        identifier: String(c?.configuration_identifier || ""),
        name: String(c?.configuration?.name || c?.configuration?.description || "Unnamed"),
        archived: !!c?.configuration?.is_archived,
        ...(settings ? { settings } : {}),
      };
    }).filter((c: any) => c.identifier);
    const v2 = await meshCall("GET", "/v2/entity-screening/configurations", undefined, deps);
    if (v2.status !== 200 && v2.status !== 404) {
      const err = meshFailure(v2, "read the screening configurations");
      return { ...base, ok: true, message: `Signed in with ${how}, but ${err.message}` };
    }
    let configurations: MeshCheck["configurations"] = v2.status === 200 ? readList(v2) : [];
    if (!configurations.length) {
      const v3 = await meshCall("GET", "/v3/entity-screening/configurations", undefined, deps);
      if (v3.status === 200) configurations = readList(v3);
    }
    if (!configurations.length) return { ...base, ok: true, screeningConfigFound: screeningConfigId ? false : null, message: `Signed in with ${how}. Mesh holds no screening configurations yet: make one in Mesh (Settings > Screening Configurations) before screening` };
    const live = configurations.filter((c: any) => !c.archived);
    const found = screeningConfigId ? configurations.some((c: any) => c.identifier === screeningConfigId) : null;
    const which = screeningConfigId
      ? (found ? "the screening configuration set on Railway is one of them" : "the screening configuration set on Railway is not one of them")
      : "none is named on Railway, so Mesh picks one";
    const named = live.map((c: any) => (c.settings ? `${c.name}: ${c.settings}` : c.name));
    // Whether Mesh took the dates of birth this process sent (Woody, 19
    // November 2026: "comply advantage not picking up DOB").
    const refusal = meshRefusedDetails();
    const refused = refusal
      ? ` Mesh refused a date of birth or nationality on ${new Date(refusal.at).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (${refusal.words}): screens for a day after that send the name alone; the app still sets namesakes aside on date of birth itself.`
      : "";
    return { ...base, ok: found !== false, configurations, screeningConfigFound: found, message: `Signed in with ${how}. ${live.length} screening configuration${live.length === 1 ? "" : "s"} (${named.join(" | ") || "none live"}); ${which}.${refused}` };
  } catch (e: any) {
    return { ...base, ok: true, message: `Signed in with ${how}, but the screening configurations could not be read: ${e?.message || "unknown"}` };
  }
}

/**
 * Ping for Settings → Integrations: signs in and reads the screening
 * configurations. Creates nothing in Mesh.
 */
export async function pingComplyAdvantage(): Promise<{ ok: boolean; status?: number; message: string }> {
  const check = await checkComplyAdvantage();
  return { ok: check.ok, message: check.message };
}
