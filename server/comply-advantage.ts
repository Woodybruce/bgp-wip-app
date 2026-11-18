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

export function resetComplyAdvantageState(): void {
  cachedToken = null;
  signInPause = null;
  screenPause = null;
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

export function meshScreenBody(s: ScreenSubject, externalId: string, screeningConfigId?: string | null): Record<string, any> {
  const kind = subjectKind(s);
  const name = meshName(s, kind);
  const customer: Record<string, any> = { external_identifier: externalId };
  if (kind === "person") customer.person = { full_name: name };
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
  // Matched profiles left out because every date of birth on them is more
  // than a year from the subject's (the rule the free lists use).
  setAside?: number;
  customerId?: string | null;
}

const yearsIn = (values: unknown): number[] => (Array.isArray(values) ? values : [])
  .map((d: any) => /\b(1[89]\d\d|20\d\d)\b/.exec(String(d?.value ?? d ?? ""))?.[1]).filter(Boolean).map(Number);

const sourceName = (list: unknown): string | undefined => {
  const first = (Array.isArray(list) ? list : []).find((s: any) => typeof s?.name === "string" || typeof s?.title === "string");
  return first ? String(first.name || first.title).slice(0, 160) : undefined;
};

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
    const dobYears = yearsIn(profile.person?.dates_of_birth);
    if (kind === "person" && subject.birthYear && dobYears.length && dobYears.every(y => Math.abs(y - Number(subject.birthYear)) > 1)) {
      setAside++;
      continue;
    }
    const raw = Number(profile.match_score);
    const score = Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : undefined;
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
          kinds,
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

async function screenOne(subject: ScreenSubject, deps: MeshDeps): Promise<ScreeningResult> {
  const base = { name: subject.name, role: subject.role };
  const kind = subjectKind(subject);
  const configId = deps.env.COMPLY_ADVANTAGE_SCREENING_CONFIG_ID?.trim() || null;
  let externalId = meshExternalId(subject, kind, deps.now());
  let state: any = null;
  for (let attempt = 0; attempt < 2 && !state; attempt++) {
    const call = await meshCall("POST", "/v2/workflows/sync/create-and-screen?last_sync_step=ALERTING", meshScreenBody(subject, externalId, configId), deps);
    if (call.status === 200 || call.status === 201) { state = call.data; break; }
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
  const fallback = (): ScreeningMatch[] => (screen.kinds.length ? screen.kinds : ["warning"]).map(k => ({ name: subject.name, matchType: k }));
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
  configurations: Array<{ identifier: string; name: string; archived: boolean }>;
  screeningConfigId: string | null;
  screeningConfigFound: boolean | null;
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
    const readList = (call: CallResult) => (Array.isArray(call.data?.configurations) ? call.data.configurations : []).map((c: any) => ({
      identifier: String(c?.configuration_identifier || ""),
      name: String(c?.configuration?.name || c?.configuration?.description || "Unnamed"),
      archived: !!c?.configuration?.is_archived,
    })).filter((c: any) => c.identifier);
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
    return { ...base, ok: found !== false, configurations, screeningConfigFound: found, message: `Signed in with ${how}. ${live.length} screening configuration${live.length === 1 ? "" : "s"} (${live.map((c: any) => c.name).join(", ") || "none live"}); ${which}` };
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
