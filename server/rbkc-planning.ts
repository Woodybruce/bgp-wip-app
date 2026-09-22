/**
 * RBKC (Royal Borough of Kensington & Chelsea) planning documents — the
 * REBUILT portal.
 *
 * After the November 2025 cyber attack RBKC retired its in-house
 * planning/searches/details.aspx site (the one the RBKC tier in
 * planning-docs.ts targets — now dead/403). It came back in 2026 as:
 *   • a SolidStart case-search SPA at www.rbkc.gov.uk/planningsearch, whose
 *     server function getCaseQuery returns case metadata as JSON, and
 *   • a standard Idox "Public Access" document publisher at
 *     planningsearch.rbkc.gov.uk, which is ref-addressed (not URL-addressed).
 *
 * The publisher exposes exactly what we need:
 *   1. GET /publisher/mvc/listDocuments?identifier=Planning&ref=<REF>
 *        → HTML wrapper; sets the JSESSIONID cookie the rest of the flow needs.
 *   2. GET /publisher/mvc/getDocumentList?identifier=Planning&ref=<REF>
 *        → JSON { data: [[date, type, description, path, omtViewerLink], …] }
 *   3. GET /publisher<path>  (with the JSESSIONID)
 *        → the actual PDF bytes.
 *
 * This module drives that flow, classifies each document with the shared
 * classifyDoc(), and downloads selected drawings. The whole session is pinned
 * to ONE transport (direct, else Webshare residential proxy) so the
 * JSESSIONID stays valid across the list + download calls — mixing egress IPs
 * mid-session invalidates it.
 *
 * Verified live against PP/20/01165 (the Plaza) and PP/26/00562 (Sloane
 * Square House) on 2026-09-21: 38 and 40 documents listed, drawings download
 * as real PDFs.
 */
import { webshareF, isProxyConfigured, isConnectionError } from "./proxy-fetch";
import { classifyDoc, type PlanningDoc } from "./planning-docs";

const PORTAL = "https://www.rbkc.gov.uk/planningsearch";
const PUBLISHER = "https://planningsearch.rbkc.gov.uk";
const IDENTIFIER = "Planning";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

// RBKC application references: PP/26/00562, CA/26/00563, LB/24/01234 etc.
const RBKC_REF_RE = /^[A-Z]{2,3}\/\d{2}\/\d{4,6}$/i;

export function looksLikeRbkcRef(s: string | null | undefined): boolean {
  return !!s && RBKC_REF_RE.test(s.trim());
}

type Transport = "direct" | "webshare";

interface RbkcSession {
  transport: Transport;
  cookie: string;
  ref: string;
  openedAt?: number;
}

/**
 * Pull an application reference out of any RBKC URL shape we see:
 *   • publisher: …/publisher/mvc/listDocuments?identifier=Planning&ref=PP%2F20%2F01165
 *   • case SPA:  https://www.rbkc.gov.uk/planningsearch/cases/PP/20/01165
 *   • legacy:    …/planning/searches/details.aspx?…&simple=PP/20/01165
 */
export function extractRbkcRef(url: string | null | undefined): string | null {
  if (!url) return null;
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch {}
  try {
    const q = new URL(url).searchParams.get("ref");
    if (q && looksLikeRbkcRef(q)) return q.trim().toUpperCase();
  } catch {}
  const m = decoded.match(/\b([A-Z]{2,3}\/\d{2}\/\d{4,6})\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Publisher listDocuments URL for a reference (what PlanIt's docs_url points at). */
export function rbkcDocsUrlFor(ref: string): string {
  return `${PUBLISHER}/publisher/mvc/listDocuments?identifier=${IDENTIFIER}&ref=${encodeURIComponent(ref.trim().toUpperCase())}`;
}

/**
 * The publisher's per-document paths (/publisher/docs/<hex>/Document-<hex>.pdf)
 * are SESSION TOKENS: every listing mints new hex keys, and a key only works
 * on the JSESSIONID that listed it. A stored copy is dead within minutes.
 *
 * So PlanningDoc.url for RBKC is a durable HANDLE instead — the real
 * listDocuments URL (opens the register if clicked raw) plus a `doc=` key
 * derived from the row's date|type|description(+ordinal). At download time we
 * relist under the ref, match the row, and fetch its current live path on
 * that same session. The Pathway stores these handles in stage results and
 * the browser proxy route resolves them any time later.
 */
function docKey(date: string, type: string, description: string, ordinal: number): string {
  return Buffer.from(`${date}|${type}|${description}|${ordinal}`, "utf8").toString("base64url");
}

function makeHandle(ref: string, key: string): string {
  return `${rbkcDocsUrlFor(ref)}&doc=${key}`;
}

function parseHandle(url: string): { ref: string; key: string } | null {
  try {
    const u = new URL(url);
    if (!/(?:^|\.)rbkc\.gov\.uk$/i.test(u.hostname)) return null;
    const ref = u.searchParams.get("ref");
    const key = u.searchParams.get("doc");
    if (!ref || !key || !looksLikeRbkcRef(ref)) return null;
    return { ref: ref.trim().toUpperCase(), key };
  } catch { return null; }
}

/** True for anything downloadPlanningPdf should hand to this module: a handle, or a raw live publisher path. */
export function isRbkcPublisherDocUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (parseHandle(url)) return true;
  try {
    const u = new URL(url);
    return /(?:^|\.)rbkc\.gov\.uk$/i.test(u.hostname) && /^\/publisher\/docs\//i.test(u.pathname);
  } catch { return false; }
}

// handle → current live publisher path (refreshed on every listing), and the
// warm session per reference. Live paths are only valid on the session in
// sessionByRef for that ref; both are dropped together when a session lapses.
const liveUrlByHandle = new Map<string, string>();
const sessionByRef = new Map<string, RbkcSession>();
const SESSION_TTL_MS = 20 * 60 * 1000;
const LIVE_URL_CAP = 5000;

function rememberSession(session: RbkcSession) {
  session.openedAt = Date.now();
  sessionByRef.set(session.ref, session);
}

async function sessionFor(ref: string): Promise<RbkcSession | null> {
  const cached = sessionByRef.get(ref);
  if (cached && Date.now() - (cached.openedAt || 0) < SESSION_TTL_MS) return cached;
  const fresh = await openSession(ref);
  if (fresh) rememberSession(fresh);
  return fresh;
}

function mergeSetCookie(existing: string, res: Response): string {
  const jar = new Map<string, string>();
  for (const pair of existing.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const raw = (res.headers as any)?.getSetCookie?.() as string[] | undefined;
  const list = raw && raw.length ? raw : (() => {
    const combined = res.headers.get("set-cookie") || "";
    return combined ? combined.split(/,(?=\s*[A-Za-z0-9_-]+=)/) : [];
  })();
  for (const c of list) {
    const first = c.split(";")[0].trim();
    const i = first.indexOf("=");
    if (i > 0) jar.set(first.slice(0, i), first.slice(i + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchOn(transport: Transport, url: string, init: RequestInit): Promise<Response> {
  if (transport === "webshare") return webshareF(url, init);
  return fetch(url, init);
}

/**
 * Open a document session for an application reference: hit the listDocuments
 * wrapper to obtain a JSESSIONID, trying a direct fetch first and falling back
 * to the residential proxy. Returns null if the ref can't be reached.
 */
async function openSession(ref: string): Promise<RbkcSession | null> {
  const wrapperUrl = `${PUBLISHER}/publisher/mvc/listDocuments?identifier=${IDENTIFIER}&ref=${encodeURIComponent(ref)}`;
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
  };
  const transports: Transport[] = isProxyConfigured() ? ["direct", "webshare"] : ["direct"];
  for (const transport of transports) {
    try {
      const res = await fetchOn(transport, wrapperUrl, { headers, redirect: "follow", signal: AbortSignal.timeout(transport === "direct" ? 12000 : 30000) });
      const cookie = mergeSetCookie("", res);
      if (res.ok && /JSESSIONID/i.test(cookie)) {
        return { transport, cookie, ref };
      }
    } catch (err: unknown) {
      if (!isConnectionError(err)) console.warn(`[rbkc-planning] session ${transport} error: ${(err as any)?.message}`);
    }
  }
  return null;
}

/**
 * List every document held against an RBKC application reference, classified.
 * The PlanningDoc.url is the fully-qualified publisher PDF URL.
 */
export async function listRbkcDocuments(ref: string, retried = false): Promise<{ docs: PlanningDoc[]; session: RbkcSession } | null> {
  const clean = ref.trim().toUpperCase();
  if (!looksLikeRbkcRef(clean)) return null;
  const session = await sessionFor(clean);
  if (!session) return null;

  const listUrl = `${PUBLISHER}/publisher/mvc/getDocumentList?identifier=${IDENTIFIER}&ref=${encodeURIComponent(clean)}`;
  let json: any;
  try {
    const res = await fetchOn(session.transport, listUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Language": "en-GB,en;q=0.9",
        Cookie: session.cookie,
        Referer: `${PUBLISHER}/publisher/mvc/listDocuments?identifier=${IDENTIFIER}&ref=${encodeURIComponent(clean)}`,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    session.cookie = mergeSetCookie(session.cookie, res);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      // Non-JSON here means the (cached) JSESSIONID has lapsed — reopen once.
      sessionByRef.delete(clean);
      if (!retried) return listRbkcDocuments(clean, true);
      return { docs: [], session };
    }
    json = await res.json();
  } catch (err: any) {
    console.warn(`[rbkc-planning] getDocumentList failed for ${clean}: ${err?.message}`);
    return null;
  }

  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  const ordinals = new Map<string, number>();
  const docs: PlanningDoc[] = [];
  if (liveUrlByHandle.size + rows.length > LIVE_URL_CAP) liveUrlByHandle.clear();
  for (const r of rows) {
    const date = String(r[0] || "").trim();
    const type = String(r[1] || "").replace(/\s+/g, " ").trim();
    const description = String(r[2] || "").replace(/\s+/g, " ").trim();
    const path = String(r[3] || "").trim();
    // Publisher path is relative to /publisher; make it absolute.
    const liveUrl = path.startsWith("http") ? path : `${PUBLISHER}/publisher${path.startsWith("/") ? "" : "/"}${path}`;
    if (!path || !/\.pdf(\?|$)/i.test(liveUrl)) continue;
    // Idox drawing numbers usually lead the description ("256-P-GA10-P3-…").
    const dnMatch = description.match(/^([0-9A-Z]+(?:[-_][0-9A-Z]+){1,6})/i);
    const drawingNumber = dnMatch ? dnMatch[1] : undefined;
    const { category, label } = classifyDoc(description, type, drawingNumber);
    const identity = `${date}|${type}|${description}`;
    const ordinal = ordinals.get(identity) || 0;
    ordinals.set(identity, ordinal + 1);
    const url = makeHandle(clean, docKey(date, type, description, ordinal));
    liveUrlByHandle.set(url, liveUrl);
    docs.push({ url, date, description, type, drawingNumber, category, label });
  }

  return { docs, session };
}

/**
 * Resolve a document handle to a live publisher path plus the session that
 * minted it, relisting when the handle is unknown to this process or its
 * session has lapsed. Raw live paths are passed through as-is (only valid on
 * the caller's session).
 */
async function resolveLive(url: string, session: RbkcSession | null, allowRelist: boolean): Promise<{ liveUrl: string; session: RbkcSession } | null> {
  const handle = parseHandle(url);
  if (!handle) return session ? { liveUrl: url, session } : null;
  const warm = sessionByRef.get(handle.ref);
  const cached = liveUrlByHandle.get(url);
  if (cached && warm && Date.now() - (warm.openedAt || 0) < SESSION_TTL_MS) return { liveUrl: cached, session: warm };
  if (!allowRelist) return null;
  sessionByRef.delete(handle.ref);
  const listed = await listRbkcDocuments(handle.ref);
  if (!listed) return null;
  const live = liveUrlByHandle.get(url);
  if (!live) {
    console.warn(`[rbkc-planning] document no longer listed on ${handle.ref}: ${url}`);
    return null;
  }
  return { liveUrl: live, session: listed.session };
}

/**
 * Download a document by its handle alone — the Pathway's stored stage
 * results and the browser proxy route only hold the URL. Returns null for a
 * raw live path this process didn't mint (those are session tokens; there is
 * no anonymous fallback — the publisher 404s cookieless requests).
 */
export async function downloadRbkcPublisherUrl(url: string): Promise<Buffer | null> {
  if (!parseHandle(url)) {
    console.warn(`[rbkc-planning] ${url} is a session-bound publisher path, not a document handle — cannot download`);
    return null;
  }
  const first = await resolveLive(url, null, true);
  if (!first) return null;
  const buf = await fetchPdf(first.liveUrl, first.session);
  if (buf) return buf;
  // The warm session may have lapsed server-side without our TTL noticing —
  // force a fresh listing once and retry.
  const handle = parseHandle(url)!;
  sessionByRef.delete(handle.ref);
  const second = await resolveLive(url, null, true);
  return second ? fetchPdf(second.liveUrl, second.session) : null;
}

/** Download one document's PDF bytes (handle or live path) on the session that listed it. */
export async function downloadRbkcDocument(url: string, session: RbkcSession): Promise<Buffer | null> {
  const resolved = await resolveLive(url, session, true);
  if (!resolved) return null;
  return fetchPdf(resolved.liveUrl, resolved.session);
}

async function fetchPdf(url: string, session: RbkcSession): Promise<Buffer | null> {
  try {
    const res = await fetchOn(session.transport, url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/pdf,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        Cookie: session.cookie,
        Referer: `${PUBLISHER}/publisher/mvc/listDocuments?identifier=${IDENTIFIER}&ref=${encodeURIComponent(session.ref)}`,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length >= 1024 && buf.subarray(0, 4).toString("latin1") === "%PDF") return buf;
    return null;
  } catch (err: any) {
    console.warn(`[rbkc-planning] download failed ${url}: ${err?.message}`);
    return null;
  }
}

export interface RbkcCaseSummary {
  reference: string;
  address?: string;
  description?: string;
  applicationType?: string;
  status?: string;
  decision?: string;
  dateReceived?: string;
  dateDecision?: string;
  conservationArea?: string;
  listedBuildingGrade?: string;
}

/**
 * Best-effort case metadata from the search SPA's getCaseQuery server
 * function. Used only to enrich the reply and label the bundle — the document
 * download does not depend on it, so a miss is non-fatal. The endpoint returns
 * either JSON or a seroval stream depending on request shape; we field-extract
 * safely from either (no eval of the remote payload).
 */
export async function getRbkcCaseSummary(ref: string): Promise<RbkcCaseSummary | null> {
  const clean = ref.trim().toUpperCase();
  if (!looksLikeRbkcRef(clean)) return null;
  const id = "src_data_getCaseQuery_ts--getCaseQuery_query";
  const name = "/app/src/data/getCaseQuery.ts?tsr-directive-use-server=";
  const url = `${PORTAL}/_server/?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&args=${encodeURIComponent(JSON.stringify([clean]))}`;
  const headers = {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "en-GB,en;q=0.9",
    Origin: "https://www.rbkc.gov.uk",
    Referer: `${PORTAL}/`,
    "X-Server-Id": `${id}#${name}`,
    "X-Server-Instance": "server-fn:0",
  };
  let text: string;
  try {
    const transport: Transport = isProxyConfigured() ? "webshare" : "direct";
    let res = await fetchOn("direct", url, { headers, signal: AbortSignal.timeout(12000) }).catch(() => null as any);
    if ((!res || !res.ok) && transport === "webshare") res = await fetchOn("webshare", url, { headers, signal: AbortSignal.timeout(30000) });
    if (!res || !res.ok) return { reference: clean };
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) {
      const j = await res.json();
      return j ? shapeSummary(clean, j) : { reference: clean };
    }
    text = await res.text();
  } catch {
    return { reference: clean };
  }
  // seroval stream — pull fields by name without evaluating it.
  const pick = (key: string): string | undefined => {
    const m = text.match(new RegExp(`${key}:"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? m[1].replace(/\\"/g, '"') : undefined;
  };
  return {
    reference: clean,
    address: pick("address"),
    description: pick("descriptionShort") || pick("descriptionFull"),
    applicationType: pick("applicationType"),
    status: pick("applicationStatus"),
    decision: pick("decisionName"),
    conservationArea: pick("conservationArea"),
    listedBuildingGrade: pick("listedBuildingGrade"),
  };
}

function shapeSummary(ref: string, j: any): RbkcCaseSummary {
  return {
    reference: ref,
    address: j.address,
    description: j.descriptionShort || j.descriptionFull,
    applicationType: j.applicationType,
    status: j.applicationStatus,
    decision: j.decisionName,
    dateReceived: j.dateReceived,
    dateDecision: j.dateDecision,
    conservationArea: j.conservationArea,
    listedBuildingGrade: j.listedBuildingGrade,
  };
}
