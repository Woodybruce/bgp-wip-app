/**
 * Premises licensing scraper for IDOX Public Access authorities.
 *
 * Uses the same ScraperAPI residential-proxy pipeline as planning-docs.ts,
 * targeting the IDOX licensing module instead of the planning module. Covers
 * roughly 20 of 33 London boroughs (Westminster, Camden, Islington, Hackney,
 * K&C, Lambeth, Southwark, Tower Hamlets, Wandsworth etc) — each council
 * runs the same Idox Public Access software, just on a different hostname.
 *
 * Licensing Act 2003 registers are statutorily public. What we scrape:
 *   - premises licence applications (alcohol, entertainment, late-night)
 *   - variations, transfers, reviews
 *   - status (granted / pending / refused / lapsed)
 *   - applicant name (= trading entity at the address, very useful for
 *     due diligence)
 *
 * Deliberately standalone: no dependency on property-pathway.ts. Callers
 * pass in a borough + postcode and get back a structured list. Integration
 * into Stage 4 is a separate step once the scraper is proven.
 *
 * Idox licensing search URL template:
 *   https://{host}/online-applications/search.do?action=advanced
 *     &searchType=Licensing&postcode={postcode}
 *
 * Results table: `<table id="searchresults">` with rows: reference,
 * description (including premises name), status, dateReceived, link.
 */

const SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/";

import { webshareF, isProxyConfigured, isConnectionError } from "./proxy-fetch";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface LicensingApp {
  reference: string;
  premises: string;
  applicant?: string;
  description: string;
  status: string;
  type: string;
  appliedAt: string;
  decidedAt?: string;
  detailsUrl: string;
  activities?: string[]; // alcohol / late_night / entertainment / film etc
  lpa: string;
}

interface BoroughConfig {
  lpa: string;
  host: string;      // idoxpa.westminster.gov.uk
  searchType: string; // "Licensing" on most installs, sometimes "LicensingRegister"
}

// Start with the central-London boroughs that run Idox. Add more on demand.
// Hostname confirmed from public registers as of 2026. If a council has
// migrated off Idox, the search URL will 404 and we skip it.
export const IDOX_LICENSING_BOROUGHS: BoroughConfig[] = [
  { lpa: "Westminster", host: "idoxpa.westminster.gov.uk", searchType: "Licensing" },
  { lpa: "Camden", host: "planningrecords.camden.gov.uk", searchType: "Licensing" },
  { lpa: "Islington", host: "planning.islington.gov.uk", searchType: "Licensing" },
  { lpa: "Hackney", host: "planning.hackney.gov.uk", searchType: "Licensing" },
  { lpa: "Kensington & Chelsea", host: "www.rbkc.gov.uk/planning", searchType: "Licensing" },
  { lpa: "Lambeth", host: "planning.lambeth.gov.uk", searchType: "Licensing" },
  { lpa: "Southwark", host: "planning.southwark.gov.uk", searchType: "Licensing" },
  { lpa: "Tower Hamlets", host: "development.towerhamlets.gov.uk", searchType: "Licensing" },
  { lpa: "Wandsworth", host: "planning1app.wandsworth.gov.uk", searchType: "Licensing" },
];

// 24h cache — licensing registers don't change minute-to-minute and
// each ScraperAPI call costs a credit.
const cache = new Map<string, { fetchedAt: number; apps: LicensingApp[] }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(raw: string): string {
  const cleaned = (raw || "").trim();
  if (!cleaned) return "";
  const iso = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return cleaned;
}

function classifyActivities(description: string, type: string): string[] {
  const s = `${description} ${type}`.toLowerCase();
  const out: string[] = [];
  if (/\balcohol\b|\bon[-\s]?sales?\b|\boff[-\s]?sales?\b|sale\s+of\s+alcohol/.test(s)) out.push("alcohol");
  if (/late[-\s]?night\s+refreshment|lnr\b/.test(s)) out.push("late_night");
  if (/regulated\s+entertainment|recorded\s+music|live\s+music|dance|performance/.test(s)) out.push("entertainment");
  if (/film|cinema/.test(s)) out.push("film");
  if (/boxing|wrestling/.test(s)) out.push("sports");
  if (/gambling|betting|bingo/.test(s)) out.push("gambling");
  if (/street\s+trading/.test(s)) out.push("street_trading");
  return out;
}

function classifyType(description: string, statusRaw: string): string {
  const s = `${description} ${statusRaw}`.toLowerCase();
  if (/new\s+premises\s+licence|grant\s+of\s+premises/.test(s)) return "New Premises";
  if (/variation/.test(s)) return "Variation";
  if (/transfer/.test(s)) return "Transfer";
  if (/review/.test(s)) return "Review";
  if (/tens?\b|temporary\s+event/.test(s)) return "Temporary Event";
  if (/change\s+of\s+dpss?|designated\s+premises/.test(s)) return "DPS Change";
  return "Licensing";
}

function parseIdoxLicensingHtml(html: string, baseUrl: string, lpa: string): LicensingApp[] {
  const apps: LicensingApp[] = [];

  // Scope to the searchresults table — Idox puts nav/filter tables around it.
  const tableMatch = html.match(/<(?:table|ul)[^>]*(?:id|class)="[^"]*(?:searchresults|searchResultsContainer|results)[^"]*"[^>]*>([\s\S]*?)<\/(?:table|ul)>/i);
  const scope = tableMatch ? tableMatch[1] : html;

  // Idox licensing often uses a <ul> of <li> cards rather than a table.
  // Try cards first, fall back to table rows.
  const cardRe = /<li[^>]*class="[^"]*searchresult[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = cardRe.exec(scope)) !== null) {
    const card = match[1];
    const linkMatch = card.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const href = linkMatch[1].replace(/&amp;/g, "&");
    let detailsUrl: string;
    try {
      detailsUrl = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
    } catch { continue; }
    const linkText = stripHtml(linkMatch[2]);

    // Reference usually formatted "YY/NNNNN/LIPN" or similar
    const refMatch = card.match(/\b(\d{2}\/\d{4,6}\/[A-Z]{2,6})\b/) || linkText.match(/\b(\d{2}\/\d{4,6}\/[A-Z]{2,6})\b/);
    const reference = refMatch ? refMatch[1] : linkText.split(/\s\|\s/)[0];

    // Description + status + dates live in <p> / <dl> children
    const description = stripHtml((card.match(/<p[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1]) || linkText);
    const status = stripHtml(card.match(/status[^>]*>([\s\S]*?)<\/(?:span|td|dd)>/i)?.[1] || card.match(/>Status:?<\/[a-z]+>\s*<[a-z]+[^>]*>([\s\S]*?)</i)?.[1] || "").slice(0, 60);
    const premises = stripHtml(card.match(/address[^>]*>([\s\S]*?)<\/(?:span|td|dd|p)>/i)?.[1] || "");
    const applied = stripHtml(card.match(/(?:received|submitted|applied)[^<]*<[^>]+>([\s\S]*?)<\/[a-z]+>/i)?.[1] || "");

    const type = classifyType(description, status);
    const activities = classifyActivities(description, type);

    apps.push({
      reference,
      premises,
      description,
      status,
      type,
      appliedAt: parseDate(applied),
      detailsUrl,
      activities,
      lpa,
    });
  }

  // Fallback: classic Idox tabular results (some boroughs still use it)
  if (apps.length === 0) {
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(scope)) !== null) {
      const row = rowMatch[1];
      const cellMatches = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
      if (cellMatches.length < 3) continue;
      const linkMatch = row.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      const href = linkMatch[1].replace(/&amp;/g, "&");
      let detailsUrl: string;
      try {
        detailsUrl = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
      } catch { continue; }
      const cells = cellMatches.map((m) => stripHtml(m[1]));
      const reference = cells.find((c) => /\d{2}\/\d{4,6}\/[A-Z]{2,6}/.test(c)) || cells[0];
      const description = cells.find((c) => c.length > 10 && c !== reference) || cells[1] || "";
      const status = cells.find((c) => /granted|refused|pending|withdrawn|lapsed|issued|decided/i.test(c)) || "";
      const applied = cells.find((c) => /\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(c)) || "";
      const type = classifyType(description, status);
      apps.push({
        reference,
        premises: "",
        description,
        status,
        type,
        appliedAt: parseDate(applied),
        detailsUrl,
        activities: classifyActivities(description, type),
        lpa,
      });
    }
  }

  return apps;
}

function buildSearchUrl(cfg: BoroughConfig, postcode: string): string {
  const host = cfg.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const params = new URLSearchParams({
    action: "advanced",
    searchType: cfg.searchType,
    postcode: postcode,
  });
  return `https://${host}/online-applications/search.do?${params.toString()}`;
}

async function fetchLicensingHtml(cfg: BoroughConfig, searchUrl: string): Promise<string | null> {
  const baseInit = {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    redirect: "follow" as const,
  };

  // Tier 1: direct (short timeout if proxy is standing by)
  try {
    const res = await fetch(searchUrl, {
      ...baseInit,
      signal: AbortSignal.timeout(isProxyConfigured() ? 8000 : 30000),
    });
    if (res.ok) return await res.text();
    if (res.status >= 400 && res.status < 500) {
      // Client error — proxy won't help
      console.warn(`[licensing] ${cfg.lpa} direct ${res.status}`);
      return null;
    }
    console.warn(`[licensing] ${cfg.lpa} direct ${res.status} — trying next tier`);
  } catch (err: unknown) {
    if (!isConnectionError(err)) {
      console.warn(`[licensing] ${cfg.lpa} direct error: ${(err as any)?.message}`);
      return null;
    }
    console.log(`[licensing] ${cfg.lpa} direct blocked — escalating to proxy`);
  }

  // Tier 2: Webshare residential proxy
  if (isProxyConfigured()) {
    try {
      const res = await webshareF(searchUrl, {
        ...baseInit,
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        console.log(`[licensing] ${cfg.lpa} via Webshare proxy`);
        return await res.text();
      }
      console.warn(`[licensing] ${cfg.lpa} proxy ${res.status}`);
    } catch (err: unknown) {
      console.warn(`[licensing] ${cfg.lpa} proxy failed: ${(err as any)?.message}`);
    }
  }

  // Tier 3: ScraperAPI fallback
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) return null;
  try {
    const proxied = `${SCRAPERAPI_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(searchUrl)}&country_code=uk&render=false`;
    const res = await fetch(proxied, { signal: AbortSignal.timeout(45000) });
    if (res.ok) {
      console.log(`[licensing] ${cfg.lpa} via ScraperAPI`);
      return await res.text();
    }
    console.warn(`[licensing] ${cfg.lpa} ScraperAPI ${res.status}`);
    return null;
  } catch (err: unknown) {
    console.warn(`[licensing] ${cfg.lpa} ScraperAPI failed: ${(err as any)?.message}`);
    return null;
  }
}

export async function fetchLicensingForBorough(cfg: BoroughConfig, postcode: string): Promise<LicensingApp[]> {
  const pc = (postcode || "").trim();
  if (!pc) return [];

  const searchUrl = buildSearchUrl(cfg, pc);
  const cacheKey = `${cfg.lpa}::${pc}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.apps;
  }

  try {
    const html = await fetchLicensingHtml(cfg, searchUrl);
    if (!html) return [];
    const apps = parseIdoxLicensingHtml(html, searchUrl, cfg.lpa);
    cache.set(cacheKey, { fetchedAt: Date.now(), apps });
    console.log(`[licensing] ${cfg.lpa} ${pc} → ${apps.length} apps`);
    return apps;
  } catch (err: any) {
    console.warn(`[licensing] ${cfg.lpa} fetch failed: ${err?.message}`);
    return [];
  }
}

// Resolve which borough covers a postcode. Central-London outward prefixes
// are distinctive enough that a simple prefix map works. Falls back to
// trying every configured borough in parallel if the prefix is ambiguous.
const OUTWARD_TO_LPA: Record<string, string> = {
  "SW1": "Westminster", "W1": "Westminster", "W2": "Westminster", "WC2": "Westminster", "NW1": "Westminster",
  "WC1": "Camden", "NW3": "Camden", "NW5": "Camden", "NW6": "Camden",
  "N1": "Islington", "N5": "Islington", "N7": "Islington", "EC1": "Islington",
  "E2": "Hackney", "E5": "Hackney", "E8": "Hackney", "E9": "Hackney", "N16": "Hackney",
  "SW3": "Kensington & Chelsea", "SW5": "Kensington & Chelsea", "SW7": "Kensington & Chelsea", "SW10": "Kensington & Chelsea", "W8": "Kensington & Chelsea", "W10": "Kensington & Chelsea", "W11": "Kensington & Chelsea",
  "SW2": "Lambeth", "SW4": "Lambeth", "SW9": "Lambeth", "SE11": "Lambeth", "SE24": "Lambeth", "SE27": "Lambeth",
  "SE1": "Southwark", "SE5": "Southwark", "SE15": "Southwark", "SE16": "Southwark", "SE17": "Southwark", "SE22": "Southwark",
  "E1": "Tower Hamlets", "E3": "Tower Hamlets", "E14": "Tower Hamlets",
  "SW11": "Wandsworth", "SW15": "Wandsworth", "SW17": "Wandsworth", "SW18": "Wandsworth",
};

export function boroughFromPostcode(postcode: string): BoroughConfig | null {
  const outward = (postcode || "").toUpperCase().replace(/\s+/g, "").slice(0, -3);
  if (!outward) return null;
  // Try full outward, then back off to shorter prefixes (SW1Y → SW1)
  for (let len = outward.length; len >= 2; len--) {
    const prefix = outward.slice(0, len);
    const lpa = OUTWARD_TO_LPA[prefix];
    if (lpa) return IDOX_LICENSING_BOROUGHS.find((b) => b.lpa === lpa) || null;
  }
  return null;
}

export async function fetchLicensingForPostcode(postcode: string): Promise<LicensingApp[]> {
  const cfg = boroughFromPostcode(postcode);
  if (!cfg) {
    console.warn(`[licensing] no borough mapped for postcode ${postcode}`);
    return [];
  }
  return fetchLicensingForBorough(cfg, postcode);
}
