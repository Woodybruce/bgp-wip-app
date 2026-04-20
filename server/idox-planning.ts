/**
 * Idox Public Access scraper for LPA planning data.
 *
 * Most London LPAs (Westminster, Camden, K&C, Hackney, Islington,
 * Hammersmith & Fulham, Tower Hamlets, Lambeth) run the same Idox
 * Public Access product, so one parser covers all of them.
 *
 * Idox simple search is a two-step flow:
 *   1. GET /online-applications/search.do?action=simple to receive
 *      a JSESSIONID cookie and a _csrf token embedded in the form.
 *   2. POST /online-applications/simpleSearchResults.do?action=firstPage
 *      with the cookie + _csrf + searchCriteria.simpleSearchString.
 *
 * No auth, no keys — public site, but we keep the request volume low,
 * throttle between councils, and cache results for 12h.
 */

const LPA_REGISTRY: Array<{ prefixes: string[]; name: string; host: string }> = [
  { prefixes: ["W1", "SW1", "WC1", "WC2", "NW1", "NW8"], name: "Westminster", host: "idoxpa.westminster.gov.uk" },
  { prefixes: ["SW3", "SW5", "SW7", "SW10", "W8", "W10", "W11", "W14"], name: "Kensington & Chelsea", host: "www.rbkc.gov.uk" },
  { prefixes: ["NW3", "NW5", "N6", "N7"], name: "Camden", host: "accountforms.camden.gov.uk" },
  { prefixes: ["N1", "EC1"], name: "Islington", host: "planning.islington.gov.uk" },
  { prefixes: ["E1", "E2", "E3", "E14"], name: "Tower Hamlets", host: "development.towerhamlets.gov.uk" },
  { prefixes: ["SE1", "SE11", "SW2", "SW4", "SW8", "SW9"], name: "Lambeth", host: "planning.lambeth.gov.uk" },
  { prefixes: ["W6", "SW6", "W12"], name: "Hammersmith & Fulham", host: "public-access.lbhf.gov.uk" },
  { prefixes: ["E5", "E8", "E9", "N16"], name: "Hackney", host: "developmentandhousing.hackney.gov.uk" },
];

export interface IdoxPlanningApp {
  reference: string;
  address: string;
  description: string;
  status: string;
  type: string;
  receivedAt: string;
  decidedAt: string;
  decision: string;
  documentUrl: string;
  lpa: string;
  source: "idox";
}

function resolveLpa(postcode: string): { name: string; host: string } | null {
  const pc = postcode.toUpperCase().replace(/\s+/g, "");
  const m = pc.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)/);
  if (!m) return null;
  const outward = m[1];
  const hit = LPA_REGISTRY
    .flatMap((lpa) => lpa.prefixes.map((p) => ({ ...lpa, prefix: p })))
    .filter((e) => outward.startsWith(e.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return hit ? { name: hit.name, host: hit.host } : null;
}

function parseDate(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return "";
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return cleaned;
  return d.toISOString().split("T")[0];
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractField(meta: string, labelRe: RegExp): string {
  // Idox meta looks like: "Ref. No: 26/00766/ADV · Received: Mon 09 Feb 2026 · Decided: ..."
  // Each label is followed by a value that runs until the next recognised label or end.
  const m = meta.match(labelRe);
  return m ? m[1].trim() : "";
}

function parseResultsHtml(html: string, host: string, lpaName: string): IdoxPlanningApp[] {
  const results: IdoxPlanningApp[] = [];
  const itemRe = /<li\b[^>]*class="[^"]*\bsearchresult\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[1];

    // Status from the badges block (modern Idox).
    const statusMatch = block.match(/<div[^>]+class="[^"]*badge-status[^"]*"[^>]*>[\s\S]*?<div[^>]+class="[^"]*value[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const status = statusMatch ? stripHtml(statusMatch[1]) : "";

    // Description + detail link.
    const linkMatch = block.match(/<a[^>]+href="([^"]*applicationDetails\.do[^"]*)"[^>]*class="[^"]*summaryLink[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const rawHref = linkMatch ? linkMatch[1].replace(/&amp;/g, "&") : "";
    const detailUrl = rawHref
      ? `https://${host}${rawHref.startsWith("/") ? "" : "/online-applications/"}${rawHref.replace(/^\//, "")}`
      : "";
    const description = linkMatch ? stripHtml(linkMatch[2]) : "";

    // Address
    const addressMatch = block.match(/<p[^>]+class="[^"]*address[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const address = addressMatch ? stripHtml(addressMatch[1]) : "";

    // Meta info block — Ref/Received/Decided etc.
    const metaMatch = block.match(/<p[^>]+class="[^"]*metaInfo[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const metaRaw = metaMatch ? stripHtml(metaMatch[1]) : "";

    const reference = extractField(metaRaw, /Ref(?:erence)?\.?\s*No\.?:?\s+([A-Z0-9/\-]+(?:\/[A-Z0-9]+)*)/i);
    if (!reference) continue;

    const received = extractField(metaRaw, /Received:?\s+([A-Za-z]{3}\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    const validated = extractField(metaRaw, /Validated:?\s+([A-Za-z]{3}\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    const decided = extractField(metaRaw, /(?:Decided|Decision\s+Date):?\s+([A-Za-z]{3}\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    const decision = extractField(metaRaw, /Decision:?\s+([^·]+?)(?=\s+(?:Ref|Received|Validated|Decided|Appeal|Case)|$)/i);

    results.push({
      reference,
      address,
      description,
      status,
      type: "",
      receivedAt: parseDate(received || validated),
      decidedAt: parseDate(decided),
      decision: decision.trim(),
      documentUrl: detailUrl,
      lpa: lpaName,
      source: "idox",
    });
  }
  return results;
}

function parseCookies(setCookieHeader: string | null): string {
  if (!setCookieHeader) return "";
  // node-fetch combines multiple Set-Cookie headers with a comma, but commas also appear
  // inside Expires dates. Split on the key=value boundary before each `; Path` reset.
  const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  return parts
    .map((p) => p.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function getCsrfAndCookie(host: string): Promise<{ csrf: string; cookie: string }> {
  const resp = await fetch(`https://${host}/online-applications/search.do?action=simple`, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`Idox ${host} landing ${resp.status}`);
  const html = await resp.text();
  const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!csrfMatch) throw new Error(`Idox ${host}: no CSRF token on search page`);
  const cookie = parseCookies(resp.headers.get("set-cookie"));
  return { csrf: csrfMatch[1], cookie };
}

async function fetchIdoxResults(host: string, searchTerm: string): Promise<string> {
  const { csrf, cookie } = await getCsrfAndCookie(host);
  const body = new URLSearchParams({
    _csrf: csrf,
    searchType: "Application",
    "searchCriteria.simpleSearchString": searchTerm,
    "searchCriteria.simpleSearch": "true",
  });
  const resp = await fetch(`https://${host}/online-applications/simpleSearchResults.do?action=firstPage`, {
    method: "POST",
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Referer: `https://${host}/online-applications/search.do?action=simple`,
      Origin: `https://${host}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(25000),
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`Idox ${host} search POST ${resp.status}`);
  return await resp.text();
}

const cache = new Map<string, { at: number; data: IdoxPlanningApp[] }>();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export async function fetchIdoxPlanning(
  postcode: string,
  address?: string,
  opts?: { maxAgeYears?: number },
): Promise<IdoxPlanningApp[]> {
  const lpa = resolveLpa(postcode);
  if (!lpa) {
    console.log(`[idox] No LPA mapping for ${postcode} — skipping scrape`);
    return [];
  }

  // Try postcode first (widest net at the right building level), then address if nothing comes back.
  const cleanPc = postcode.toUpperCase().replace(/\s+/g, " ").trim();
  const attempts: string[] = [cleanPc];
  if (address) {
    // Extract the street+number portion (drop postcode/city noise that can confuse Idox simple search).
    const streetGuess = address.replace(/,?\s*(london|greater london)\s*,?/i, ",").replace(/,?\s*[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\s*$/i, "").replace(/,\s*,/g, ",").replace(/,+$/, "").trim();
    if (streetGuess && !attempts.includes(streetGuess)) attempts.push(streetGuess);
  }

  const cacheKey = `${lpa.host}::${attempts.join("|")}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    console.log(`[idox] cache hit: ${lpa.name} ${attempts[0]} (${cached.data.length})`);
    return cached.data;
  }

  const minDate = opts?.maxAgeYears
    ? new Date(Date.now() - opts.maxAgeYears * 365 * 24 * 3600 * 1000)
    : null;

  let results: IdoxPlanningApp[] = [];
  let lastError: string | null = null;
  for (const term of attempts) {
    try {
      const html = await fetchIdoxResults(lpa.host, term);
      const parsed = parseResultsHtml(html, lpa.host, lpa.name);
      console.log(`[idox] ${lpa.name} "${term}" → ${parsed.length} applications`);
      if (parsed.length > 0) {
        results = parsed;
        break;
      }
    } catch (err: any) {
      const causeCode = err?.cause?.code || err?.cause?.errno;
      const causeMsg = err?.cause?.message;
      lastError = err?.message;
      console.warn(
        `[idox] ${lpa.name} search failed for "${term}":`,
        err?.message,
        causeCode ? `cause=${causeCode}` : "",
        causeMsg && causeMsg !== err?.message ? `(${causeMsg})` : "",
      );
    }
  }

  if (results.length === 0 && lastError) {
    // Leave no cache entry so we retry rather than caching an error.
    return [];
  }

  if (minDate) {
    results = results.filter((a) => {
      const d = a.receivedAt || a.decidedAt;
      if (!d) return true;
      const t = new Date(d);
      return isNaN(t.getTime()) || t >= minDate;
    });
  }

  const seen = new Set<string>();
  const deduped = results.filter((a) => {
    const key = a.reference.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  cache.set(cacheKey, { at: Date.now(), data: deduped });
  return deduped;
}
