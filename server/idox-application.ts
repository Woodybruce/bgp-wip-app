// One planning application on a council's Idox register (Lambeth, Westminster,
// Camden and the other councils on Idox Public Access), read the way a person
// reads it: the search page first for its session, then the search, the
// application's summary, its documents and the building's own planning
// history. ChatBGP could not do this for Lambeth on 24 November 2026 (it
// fetched the results page cold and got a 500), so it misread 14/01396/FUL
// (refused, appeal dismissed) as a live scheme.
//
// Read only, public registers, no key. One session per call, pinned to one
// route (direct, else the Webshare proxy), because Idox ties its search
// results and files to the session's cookie.
import { BROWSER_UA, parseResultsHtml, resolveIdoxCouncil } from "./idox-planning";
import { webshareF, isProxyConfigured, isConnectionError, type FetchLike } from "./proxy-fetch";
import { fetchWithChainRepair } from "./tls-chain-repair";
import { referenceYear } from "@shared/planning-address";

export type IdoxDocument = { date: string; type: string; description: string; url: string };
export type IdoxHistoryItem = { reference: string; description: string; status: string; year: number | null; url: string };
export type IdoxApplication = {
  council: string;
  reference: string;
  url: string;
  address: string;
  proposal: string;
  status: string;
  decision: string;
  received: string;
  decided: string;
  appealStatus: string;
  appealDecision: string;
  fields: Record<string, string>;
  documents: IdoxDocument[];
  history: IdoxHistoryItem[];
};

const decode = (s: string) => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\s+/g, " ").trim();

const refKey = (s: string) => s.toUpperCase().replace(/\s+/g, "");

class IdoxSession {
  private cookies = new Map<string, string>();
  private fetchFn: FetchLike | null = null;
  constructor(readonly host: string) {}

  private remember(res: Response) {
    const h = res.headers as any;
    const list: string[] = typeof h.getSetCookie === "function" ? h.getSetCookie() : (res.headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    for (const c of list) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  private headers(extra: Record<string, string> = {}) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    return { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8", "Accept-Language": "en-GB,en;q=0.9", ...(cookie ? { Cookie: cookie } : {}), ...extra };
  }

  async request(path: string, init: { method?: string; body?: string; contentType?: string; timeoutMs?: number } = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : `https://${this.host}${path}`;
    const req = (fn: FetchLike, timeout: number) => fn(url, {
      method: init.method || "GET",
      headers: this.headers(init.contentType ? { "Content-Type": init.contentType, Origin: `https://${this.host}`, Referer: `https://${this.host}/online-applications/search.do?action=simple` } : {}),
      body: init.body,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    if (!this.fetchFn) {
      const direct: FetchLike = (u, i) => fetchWithChainRepair(u, i as any);
      try {
        const res = await req(direct, isProxyConfigured() ? 10_000 : init.timeoutMs ?? 30_000);
        this.fetchFn = direct;
        this.remember(res);
        return res;
      } catch (err) {
        if (!isConnectionError(err) || !isProxyConfigured()) throw err;
        this.fetchFn = webshareF;
      }
    }
    const res = await req(this.fetchFn, init.timeoutMs ?? 30_000);
    this.remember(res);
    return res;
  }

  async html(path: string, init?: Parameters<IdoxSession["request"]>[1]): Promise<string> {
    const res = await this.request(path, init);
    if (!res.ok) throw new Error(`${this.host} answered ${res.status}`);
    return res.text();
  }
}

function summaryFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const k = decode(m[1]);
    if (k && !(k in out)) out[k] = decode(m[2]);
  }
  return out;
}

function documentsFrom(html: string, host: string): IdoxDocument[] {
  const table = html.match(/<table[^>]+id="Documents"[\s\S]*?<\/table>/i)?.[0] || "";
  const out: IdoxDocument[] = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const href = row[1].match(/href="([^"]*\/files\/[^"]+)"/i)?.[1];
    if (!href) continue;
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>|<td\s*\/>/gi)].map(c => decode(c[1] || ""));
    const date = cells.find(c => /^\d{1,2} [A-Za-z]{3} \d{4}$/.test(c)) || "";
    const di = cells.indexOf(date);
    const type = di >= 0 ? cells[di + 1] || "" : "";
    const description = di >= 0 ? cells[di + 2] || "" : "";
    const path = href.replace(/&amp;/g, "&");
    out.push({ date, type, description, url: path.startsWith("http") ? path : `https://${host}${path}` });
  }
  return out;
}

function propertyKeys(html: string): string[] {
  return [...new Set([...html.matchAll(/propertyDetails\.do\?[^"]*?keyVal=([A-Z0-9]+)/gi)].map(m => m[1]))];
}

function historyFrom(html: string, host: string): IdoxHistoryItem[] {
  const out: IdoxHistoryItem[] = [];
  for (const li of html.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
    const link = li[1].match(/<a[^>]+href="([^"]*applicationDetails\.do[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const meta = decode(li[1].replace(link[0], " "));
    const reference = meta.match(/Ref\.?\s*No:?\s*([A-Z0-9/\-]+)/i)?.[1] || "";
    if (!reference) continue;
    const status = meta.match(/Status:?\s*(.+)$/i)?.[1]?.trim() || "";
    const keyVal = link[1].match(/keyVal=([A-Z0-9]+)/i)?.[1];
    out.push({
      reference, description: decode(link[2]), status, year: referenceYear(reference),
      url: keyVal ? `https://${host}/online-applications/applicationDetails.do?activeTab=summary&keyVal=${keyVal}` : "",
    });
  }
  return out;
}

async function search(session: IdoxSession, term: string): Promise<{ html: string; url: string }> {
  const landing = await session.html("/online-applications/search.do?action=simple&searchType=Application");
  const csrf = landing.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
  if (!csrf) throw new Error(`${session.host}: no search form`);
  const body = new URLSearchParams({ _csrf: csrf, searchType: "Application", "searchCriteria.simpleSearchString": term, "searchCriteria.simpleSearch": "true" }).toString();
  const res = await session.request("/online-applications/simpleSearchResults.do?action=firstPage", { method: "POST", body, contentType: "application/x-www-form-urlencoded" });
  if (!res.ok) throw new Error(`${session.host} search answered ${res.status}`);
  return { html: await res.text(), url: res.url };
}

async function historyOf(session: IdoxSession, keys: string[]): Promise<IdoxHistoryItem[]> {
  const seen = new Set<string>();
  const out: IdoxHistoryItem[] = [];
  for (const key of keys.slice(0, 4)) {
    const html = await session.html(`/online-applications/propertyDetails.do?activeTab=relatedCases&relatedCasesType=Planning+Applications&keyVal=${key}`).catch(() => "");
    for (const item of historyFrom(html, session.host)) {
      if (seen.has(refKey(item.reference))) continue;
      seen.add(refKey(item.reference));
      out.push(item);
    }
  }
  return out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.reference.localeCompare(a.reference));
}

async function readApplication(session: IdoxSession, council: string, keyVal: string): Promise<IdoxApplication> {
  const base = `/online-applications/applicationDetails.do?keyVal=${keyVal}`;
  const summary = await session.html(`${base}&activeTab=summary`);
  const fields = summaryFields(summary);
  const [documents, related] = await Promise.all([
    session.html(`${base}&activeTab=documents`).then(h => documentsFrom(h, session.host)).catch(() => [] as IdoxDocument[]),
    session.html(`${base}&activeTab=relatedCases`).then(h => propertyKeys(h)).catch(() => [] as string[]),
  ]);
  const history = await historyOf(session, related);
  return {
    council,
    reference: fields["Reference"] || "",
    url: `https://${session.host}${base}&activeTab=summary`,
    address: fields["Address"] || "",
    proposal: fields["Proposal"] || "",
    status: fields["Status"] || "",
    decision: fields["Decision"] || "",
    received: fields["Application Received"] || fields["Application Validated"] || "",
    decided: fields["Decision Issued Date"] || "",
    appealStatus: fields["Appeal Status"] || "",
    appealDecision: fields["Appeal Decision"] || "",
    fields,
    documents,
    history,
  };
}

export type LookupResult =
  | { ok: true; application: IdoxApplication; session: IdoxSession }
  | { ok: false; error: string };

/** An application on its council's Idox register, by its reference. */
export async function lookupIdoxApplication(args: { reference: string; postcode?: string | null; council?: string | null }): Promise<LookupResult> {
  const reference = args.reference.trim();
  if (!reference) return { ok: false, error: "A planning reference is needed." };
  const council = await resolveIdoxCouncil({ postcode: args.postcode, council: args.council });
  if (!council) return { ok: false, error: "That council is not one whose Idox register the app can read. Give the council's name or the property's postcode." };
  const session = new IdoxSession(council.host);
  try {
    const found = await search(session, reference);
    let keyVal = /applicationDetails\.do/i.test(found.url) ? found.url.match(/keyVal=([A-Z0-9]+)/i)?.[1] : undefined;
    if (!keyVal) {
      const hits = parseResultsHtml(found.html, council.host, council.name);
      const hit = hits.find(h => refKey(h.reference) === refKey(reference));
      keyVal = hit?.documentUrl.match(/keyVal=([A-Z0-9]+)/i)?.[1];
      if (!keyVal && /<th[^>]*>\s*Reference\s*<\/th>/i.test(found.html)) keyVal = found.html.match(/keyVal=([A-Z0-9]+)/i)?.[1];
    }
    if (!keyVal) return { ok: false, error: `${reference} was not found on ${council.name}'s register.` };
    const application = await readApplication(session, council.name, keyVal);
    if (refKey(application.reference) !== refKey(reference)) return { ok: false, error: `${reference} was not found on ${council.name}'s register.` };
    return { ok: true, application, session };
  } catch (err: any) {
    return { ok: false, error: `${council.name}'s register could not be read: ${err?.message || err}` };
  }
}

/** The text of a register document (a PDF), read in the application's own session. */
export async function readIdoxDocumentText(session: IdoxSession, doc: IdoxDocument, maxChars = 8000): Promise<string | null> {
  try {
    const res = await session.request(doc.url, { timeoutMs: 45_000 });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024 || buf.subarray(0, 5).toString() !== "%PDF-") return null;
    const { extractPdfText } = await import("./document-reader");
    const text = (await extractPdfText(buf)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return text ? text.slice(0, maxChars) : null;
  } catch {
    return null;
  }
}

/** The documents worth reading first: decision notices, officers' reports, appeal decisions. */
export function keyDocuments(docs: IdoxDocument[], limit = 3): IdoxDocument[] {
  const rank = (d: IdoxDocument) => {
    const t = `${d.type} ${d.description}`.toLowerCase();
    if (/appeal decision/.test(t)) return 0;
    if (/decision notice|refusal|permission|approval/.test(t) && !/plan|drawing|elevation/.test(t)) return 1;
    if (/delegated|officer|committee report|report of/.test(t)) return 2;
    return 9;
  };
  const toTime = (d: IdoxDocument) => Date.parse(d.date) || 0;
  return docs.filter(d => rank(d) < 9).sort((a, b) => rank(a) - rank(b) || toTime(b) - toTime(a)).slice(0, limit);
}

/**
 * The building's own planning history from the council's register: the
 * address searched, the first application whose address is the property's,
 * then every application the council files against that property.
 */
export async function idoxBuildingHistory(args: {
  postcode: string;
  searchTerm: string;
  fits: (address: string) => boolean;
}): Promise<{ council: string; history: IdoxHistoryItem[] } | null> {
  const council = await resolveIdoxCouncil({ postcode: args.postcode });
  if (!council) return null;
  const session = new IdoxSession(council.host);
  try {
    const found = await search(session, args.searchTerm);
    let keyVals: string[] = [];
    if (/applicationDetails\.do/i.test(found.url)) {
      const f = summaryFields(found.html);
      const one = found.url.match(/keyVal=([A-Z0-9]+)/i)?.[1];
      if (one && args.fits(f["Address"] || "")) keyVals = [one];
    } else {
      // A building can be filed as more than one property ("26A", "26A And 26B"):
      // a few of the matching applications give all of them.
      keyVals = parseResultsHtml(found.html, council.host, council.name)
        .filter(h => args.fits(h.address))
        .map(h => h.documentUrl.match(/keyVal=([A-Z0-9]+)/i)?.[1])
        .filter((k): k is string => !!k)
        .slice(0, 4);
    }
    if (!keyVals.length) return { council: council.name, history: [] };
    const related = new Set<string>();
    for (const k of keyVals) {
      for (const p of await session.html(`/online-applications/applicationDetails.do?keyVal=${k}&activeTab=relatedCases`).then(propertyKeys).catch(() => [] as string[])) related.add(p);
    }
    let history = await historyOf(session, [...related]);
    // Its later applications can be filed against another property record too
    // (Lambeth files 26A's 2014 and 2018 work under "26A And 26B").
    const before = related.size;
    for (const item of history.slice(0, 3)) {
      const k = item.url.match(/keyVal=([A-Z0-9]+)/i)?.[1];
      if (!k) continue;
      for (const p of await session.html(`/online-applications/applicationDetails.do?keyVal=${k}&activeTab=relatedCases`).then(propertyKeys).catch(() => [] as string[])) related.add(p);
    }
    if (related.size > before) history = await historyOf(session, [...related]);
    return { council: council.name, history };
  } catch (err: any) {
    console.warn(`[idox-application] ${council.name} history for "${args.searchTerm}" failed: ${err?.message}`);
    return null;
  }
}
