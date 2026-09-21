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
export async function listRbkcDocuments(ref: string): Promise<{ docs: PlanningDoc[]; session: RbkcSession } | null> {
  const clean = ref.trim().toUpperCase();
  if (!looksLikeRbkcRef(clean)) return null;
  const session = await openSession(clean);
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
    if (!ct.includes("json")) return { docs: [], session };
    json = await res.json();
  } catch (err: any) {
    console.warn(`[rbkc-planning] getDocumentList failed for ${clean}: ${err?.message}`);
    return null;
  }

  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  const docs: PlanningDoc[] = rows.map((r) => {
    const date = String(r[0] || "").trim();
    const type = String(r[1] || "").replace(/\s+/g, " ").trim();
    const description = String(r[2] || "").replace(/\s+/g, " ").trim();
    const path = String(r[3] || "").trim();
    // Idox drawing numbers usually lead the description ("256-P-GA10-P3-…").
    const dnMatch = description.match(/^([0-9A-Z]+(?:[-_][0-9A-Z]+){1,6})/i);
    const drawingNumber = dnMatch ? dnMatch[1] : undefined;
    const { category, label } = classifyDoc(description, type, drawingNumber);
    // Publisher path is relative to /publisher; make it absolute.
    const url = path.startsWith("http") ? path : `${PUBLISHER}/publisher${path.startsWith("/") ? "" : "/"}${path}`;
    return { url, date, description, type, drawingNumber, category, label };
  }).filter((d) => d.url && /\.pdf(\?|$)/i.test(d.url));

  return { docs, session };
}

/** Download one document's PDF bytes on the session's transport. */
export async function downloadRbkcDocument(url: string, session: RbkcSession): Promise<Buffer | null> {
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
