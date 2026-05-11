import { db } from "./db";
import { externalRequirements, crmRequirementsLeasing, crmCompanies, crmContacts } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { ScraperSession, isScraperApiAvailable } from "./utils/scraperapi";
import { getPipnetCreds } from "./integration-credentials";

const PIPNET_DEFAULT = "https://v1.pipnet.co.uk";
const PIPNET_URL = sanitisePipnetUrl(process.env.PIPNET_URL);

function sanitisePipnetUrl(raw: string | undefined): string {
  if (!raw) return PIPNET_DEFAULT;
  // Strip surrounding quotes and anything after the first whitespace/newline —
  // guards against env-var pastes that accidentally include trailing junk
  // (e.g. a second KEY=value line glued on by a Railway UI quirk).
  const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, "").split(/[\s\n]/)[0];
  try {
    const u = new URL(cleaned);
    return u.origin;
  } catch {
    console.error(`[pipnet] PIPNET_URL env var is malformed (${JSON.stringify(raw)}). Falling back to ${PIPNET_DEFAULT}.`);
    return PIPNET_DEFAULT;
  }
}

let sessionCookie: string | null = null;

// Sticky ScraperAPI session — every PIPnet call (login + every result-page
// fetch) goes through the same upstream proxy IP, so the JSESSIONID cookie
// PIPnet sets on login stays valid for the rest of the scrape. Without this
// every fetch would rotate to a new IP and PIPnet would invalidate the
// session. Reset between full scrapes via `resetSession()` below.
let scraperSession: ScraperSession | null = null;
const PIPNET_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function pipFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // ScraperAPI requires a User-Agent whenever keep_headers=true, otherwise
  // it rejects the request with HTTP 400 "Error, malformed request". PIPnet
  // also responds more reliably with a real-browser UA, so we always set
  // one here even on the direct-fetch dev path.
  const mergedInit: RequestInit = {
    ...init,
    headers: {
      "User-Agent": PIPNET_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      ...(init.headers as Record<string, string> | undefined),
    },
  };
  // Fall back to direct fetch if ScraperAPI isn't configured (dev mode,
  // tests, etc). PIPnet works fine direct from a dev laptop — this proxy
  // detour is purely for Railway egress where pip's WAF blocks the IP.
  if (!isScraperApiAvailable()) return fetch(url, mergedInit);
  if (!scraperSession) scraperSession = new ScraperSession();
  return scraperSession.fetch(url, mergedInit);
}

async function login(): Promise<string> {
  if (sessionCookie) {
    const testRes = await pipFetch(`${PIPNET_URL}/reqSearch.jsp`, {
      headers: { Cookie: sessionCookie },
      redirect: "manual",
    });
    if (testRes.status === 200) return sessionCookie;
    sessionCookie = null;
  }

  const creds = await getPipnetCreds();
  if (!creds.password || !creds.email) {
    throw new Error("PIPnet not configured — set username, email and password in /subscriptions or Railway env vars.");
  }
  const body = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    email: creds.email,
    Submit: "Login",
  });

  // ScraperAPI's standard API has been returning HTTP 400 "malformed request"
  // for our PIPnet POST (probably because we combine premium + session_number
  // + keep_headers in a way it doesn't like). Try direct fetch first — if
  // PIPnet's WAF blocks Railway's egress IP we'll see a 403 or similar and
  // fall back to the proxy. The fallback path keeps the original behaviour.
  const loginUrl = `${PIPNET_URL}/checkLogin.jsp`;
  const loginInit: RequestInit = {
    method: "POST",
    headers: {
      "User-Agent": PIPNET_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "manual",
  };
  let res: Response;
  let via = "direct fetch";
  try {
    res = await fetch(loginUrl, loginInit);
    if (res.status === 403 || res.status === 406 || res.status === 429 || res.status >= 500) {
      console.warn(`[pipnet login] direct fetch returned HTTP ${res.status}, falling back to ScraperAPI`);
      if (isScraperApiAvailable()) {
        res = await pipFetch(loginUrl, loginInit);
        via = "ScraperAPI proxy (after direct fetch was blocked)";
      }
    }
  } catch (err: any) {
    console.warn(`[pipnet login] direct fetch threw (${err?.message}), falling back to ScraperAPI`);
    if (!isScraperApiAvailable()) throw err;
    res = await pipFetch(loginUrl, loginInit);
    via = "ScraperAPI proxy (after direct fetch threw)";
  }
  console.log(`[pipnet login] used ${via}, status ${res.status}`);

  const jsessionid = extractJsessionId(res);
  const bodyText = await res.text();

  if (!jsessionid) {
    if (bodyText.includes("Invalid logon")) {
      throw new Error("PIPnet login failed: invalid credentials");
    }
    const hdrKeys: string[] = [];
    res.headers.forEach((_v, k) => hdrKeys.push(k));
    console.error(`[pipnet login] no JSESSIONID. via=${via} status=${res.status} headers=${hdrKeys.join(",")} bodyPreview=${bodyText.slice(0, 300).replace(/\s+/g, " ")}`);
    throw new Error(`PIPnet login failed: no session cookie (HTTP ${res.status} via ${via})`);
  }

  if (bodyText.includes("Invalid logon")) {
    throw new Error("PIPnet login failed: invalid credentials");
  }

  sessionCookie = jsessionid;
  return sessionCookie;
}

function extractJsessionId(res: Response): string | null {
  const raw = (res.headers as any).getSetCookie?.();
  if (Array.isArray(raw) && raw.length > 0) {
    const hit = raw.map((c: string) => c.split(";")[0]).find((c: string) => c.startsWith("JSESSIONID="));
    if (hit) return hit;
  }
  const single = res.headers.get("set-cookie");
  if (single) {
    const parts = single.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    for (const p of parts) {
      const head = p.trim().split(";")[0];
      if (head.startsWith("JSESSIONID=")) return head;
    }
  }
  let found: string | null = null;
  res.headers.forEach((value, key) => {
    if (found) return;
    if (key.toLowerCase() !== "set-cookie") return;
    const head = value.trim().split(";")[0];
    if (head.startsWith("JSESSIONID=")) found = head;
  });
  return found;
}

function parseHtmlTable(html: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const tableMatch = html.match(/<table class="result(?:s)?Table"[\s\S]*?<\/table>/i);
  if (!tableMatch) return rows;
  const table = tableMatch[0];

  const allTrs = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (allTrs.length < 2) return rows;

  const headers: string[] = [];
  const headerTds = [...allTrs[0][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
  for (const td of headerTds) {
    headers.push(td[1].replace(/<[^>]+>/g, "").trim());
  }
  if (headers.length === 0) {
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let hm;
    while ((hm = thRegex.exec(allTrs[0][1])) !== null) {
      headers.push(hm[1].replace(/<[^>]+>/g, "").trim());
    }
  }

  for (let i = 1; i < allTrs.length; i++) {
    const cells: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(allTrs[i][1])) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, "").trim());
    }
    if (cells.length >= 3 && headers.length > 0) {
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (idx < cells.length) row[h] = cells[idx];
      });
      // Capture the first per-row detail link so the importer can fetch the
      // requirement's full detail page (use class, email, mobile, brochure URL).
      // Pagination links are ignored — they all live outside the row body.
      const rowHrefs = [...allTrs[i][1].matchAll(/href="([^"]+)"/gi)].map(m => m[1]);
      const detailHref = rowHrefs.find(h => /req|detail|show|view/i.test(h) && !/action=next/i.test(h));
      if (detailHref) row._detailHref = detailHref;
      rows.push(row);
    }
  }
  return rows;
}

function parseTotalPages(html: string): number {
  const match = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : 1;
}

export async function searchPipnetRequirements(params: {
  location?: string;
  minSize?: string;
  maxSize?: string;
  client?: string;
  status?: string;
  documentDate?: string;
  allPages?: boolean;
  maxPages?: number;
  stopBeforeDate?: Date;
}): Promise<Record<string, string>[]> {
  const cookie = await login();
  const body = new URLSearchParams({
    requirementType: "ReqRetail",
    locationSearchEdit: "",
    locationListBox: params.location || "",
    status: params.status || "Latest",
    documentDate: params.documentDate || "",
    extrapolated: "True",
    clientSearchEdit: params.client || "",
    clientListBox: "",
    minSalesArea: params.minSize || "",
    maxSalesArea: params.maxSize || "",
    Search: "Search",
  });

  const res = await pipFetch(`${PIPNET_URL}/reqfetch.jsp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`PIPnet req search failed: ${res.status}`);
  let html = await res.text();
  const allRows = parseHtmlTable(html);
  const totalPages = parseTotalPages(html);

  if (params.allPages && totalPages > 1) {
    const maxPages = Math.min(totalPages, params.maxPages || 5);
    for (let page = 2; page <= maxPages; page++) {
      const nextMatch = html.match(/href="(reqresults\.jsp\?action=next&hash=[^"]+)"/);
      if (!nextMatch) break;
      const pageRes = await pipFetch(`${PIPNET_URL}/${nextMatch[1]}`, {
        headers: { Cookie: cookie },
      });
      if (!pageRes.ok) break;
      html = await pageRes.text();
      const pageRows = parseHtmlTable(html);
      if (pageRows.length === 0) break;
      allRows.push(...pageRows);
      // PIPnet sorts newest-first. If every row on this page is already
      // outside the 3-month window, the rest will be too — stop paginating.
      if (params.stopBeforeDate && pageRows.every(r => {
        const d = parseUkDate(r["Document Date"] || r["Date"] || r["Updated"]);
        return d ? d < params.stopBeforeDate! : false;
      })) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return allRows;
}

export async function searchPipnetProperties(params: {
  location?: string;
  minSize?: string;
  maxSize?: string;
  type?: string;
}): Promise<Record<string, string>[]> {
  const cookie = await login();
  const body = new URLSearchParams({
    propertyType: params.type || "PropRetail",
    locationSearchEdit: "",
    locationListBox: params.location || "",
    status: "Available",
    documentDate: "",
    extrapolated: "True",
    addressSearchEdit: "",
    minSalesArea: params.minSize || "",
    maxSalesArea: params.maxSize || "",
    Search: "Search",
  });

  const res = await pipFetch(`${PIPNET_URL}/detailsfetch.jsp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`PIPnet prop search failed: ${res.status}`);
  const html = await res.text();
  return parseHtmlTable(html);
}

// Pulls every additional field that lives on a requirement's detail page —
// use class, email, mobile, address, comments, tenure, plus the "View All
// Images" URL which the team treats as the landlord pack. The list view
// doesn't expose any of these, so a per-row detail fetch is mandatory if we
// want a complete record.
async function fetchPipnetDetail(href: string, cookie: string): Promise<{
  requirementId?: string;
  useClass?: string;
  email?: string;
  mobile?: string;
  telephone?: string;
  contactName?: string;
  tenure?: string;
  comments?: string;
  address1?: string;
  address2?: string;
  town?: string;
  county?: string;
  postCode?: string;
  documentDate?: string;
  landlordPackUrl?: string;
}> {
  const url = href.startsWith("http") ? href : `${PIPNET_URL}/${href.replace(/^\//, "")}`;
  const res = await pipFetch(url, { headers: { Cookie: cookie } });
  if (!res.ok) return {};
  const html = await res.text();

  const fields: Record<string, string> = {};
  const clean = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

  for (const m of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const k = clean(m[1]); const v = clean(m[2]);
    if (k && v && k.length < 60) fields[k] = v;
  }
  for (const m of html.matchAll(/<td[^>]*class="[^"]*(?:label|fieldLabel|key)[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const k = clean(m[1]); const v = clean(m[2]);
    if (k && v && k.length < 60) fields[k] = v;
  }
  for (const m of html.matchAll(/<td[^>]*>\s*([^<:]{2,40}):\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const k = clean(m[1]); const v = clean(m[2]);
    if (k && v && !(k in fields)) fields[k] = v;
  }

  // "View All Images" — the multi-page brochure the team calls the landlord pack.
  const viewAllMatch = html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*View All Images\s*<\/a>/i);
  const landlordPackUrl = viewAllMatch
    ? (viewAllMatch[1].startsWith("http") ? viewAllMatch[1] : `${PIPNET_URL}/${viewAllMatch[1].replace(/^\//, "")}`)
    : undefined;

  // "Requirement ID: 87425" — sometimes in a labelled row, sometimes inline.
  let requirementId = fields["Requirement ID"] || fields["Req. ID"] || fields["Req ID"];
  if (!requirementId) {
    const idMatch = html.match(/Requirement\s*ID\s*:?\s*<\/?[^>]*>?\s*(\d+)/i);
    if (idMatch) requirementId = idMatch[1];
  }

  return {
    requirementId,
    useClass: fields["User Categories"] || fields["Use Categories"] || fields["Use Class"],
    email: fields["Email"] || fields["E-Mail"] || fields["E-mail"],
    mobile: fields["Mobile"],
    telephone: fields["Telephone"] || fields["Tel"] || fields["Tel. No"],
    contactName: fields["Contact"],
    tenure: fields["Tenures"] || fields["Tenure"],
    comments: fields["Comments"] || fields["Notes"],
    address1: fields["Address 1"],
    address2: fields["Address 2"],
    town: fields["Town"],
    county: fields["County"],
    postCode: fields["Post Code"] || fields["Postcode"],
    documentDate: fields["Document Date"] || fields["Date"],
    landlordPackUrl,
  };
}

function parseUkDate(input: string | undefined | null): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    let year = parseInt(m[3], 10);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const d = new Date(Date.UTC(year, month, day));
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
    return isNaN(d.getTime()) ? null : d;
  }
  // DD Mon YYYY or DD Month YYYY (e.g. "11 May 2026" / "11-May-2026")
  const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  m = s.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3,})[\s\-/]+(\d{2,4})/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      let year = parseInt(m[3], 10);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      const d = new Date(Date.UTC(year, mon, day));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  // Last resort — let Date parse it
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

export async function importPipnetRequirements(params: {
  location?: string;
  minSize?: string;
  maxSize?: string;
  client?: string;
  documentDate?: string;
  allPages?: boolean;
  monthsBack?: number;
  autoPromote?: boolean;
}): Promise<{ imported: number; promoted: number; skippedOld: number; total: number; pages: number }> {
  const monthsBack = params.monthsBack ?? 3;
  const autoPromote = params.autoPromote ?? true;
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsBack);

  const results = await searchPipnetRequirements({
    ...params,
    allPages: params.allPages ?? true,
    maxPages: params.allPages === false ? 1 : 5,
    stopBeforeDate: cutoff,
  });
  let imported = 0;
  let promoted = 0;
  let skippedOld = 0;
  let loggedHeaders = false;

  const cookie = await login();

  for (const row of results) {
    if (!loggedHeaders) {
      console.log(`[pipnet import] PIPnet row columns: ${JSON.stringify(Object.keys(row))}`);
      loggedHeaders = true;
    }
    const companyName =
      row["Client"] || row["Company"] || row["Name"] || "Unknown";
    if (companyName === "Unknown" || companyName === "[No Client Quoted]") continue;

    const agentCompany = (row["Agent"] || row["Agency"] || row["Acting Agent"] || "").trim();
    // List view's Contact has a "(Agent)" suffix — strip it. Detail page Contact is cleaner anyway.
    const listContactName = (row["Contact"] || row["Contact Name"] || row["Agent Contact"] || "").trim().replace(/\s*\(Agent\)\s*$/i, "");
    const sizeRange = (row["Size"] || row["Sales Area"] || row["Sq Ft"] || row["Square Footage"] || row["Floor Area"] || row["Area"] || "").trim();
    const docDate = row["Document Date"] || row["Date"] || row["Updated"] || row["Last Updated"] || "";

    const parsedDate = parseUkDate(docDate);
    if (parsedDate && parsedDate < cutoff) {
      skippedOld++;
      continue;
    }

    // Per-row detail fetch — pulls use class, email, mobile, brochure URL etc.
    // The list view doesn't expose any of these. Adds one HTTP request per row.
    let detail: Awaited<ReturnType<typeof fetchPipnetDetail>> = {};
    if (row._detailHref) {
      try {
        detail = await fetchPipnetDetail(row._detailHref, cookie);
        await new Promise(r => setTimeout(r, 150));
      } catch (e: any) {
        console.error(`[pipnet detail] ${row._detailHref}: ${e?.message}`);
      }
    }

    // Prefer PIPnet's stable Requirement ID for dedup; fall back to the old
    // hash-style id for rows where the detail page didn't yield one.
    const sourceId = detail.requirementId
      ? `pipnet-req-${detail.requirementId}`
      : `pipnet-req-${companyName}-${agentCompany}-${sizeRange}`.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();

    const existing = await db
      .select()
      .from(externalRequirements)
      .where(
        and(
          eq(externalRequirements.source, "PIPnet"),
          eq(externalRequirements.sourceId, sourceId)
        )
      )
      .limit(1);

    const contactName = (detail.contactName || listContactName || "").trim();
    const useClass = detail.useClass || "";

    const record = {
      source: "PIPnet" as const,
      sourceId,
      companyName,
      contactName: contactName || null,
      contactPhone: detail.telephone || row["Tel. No"] || row["Phone"] || row["Telephone"] || row["Tel"] || null,
      contactEmail: detail.email || row["Email"] || row["E-Mail"] || row["E-mail"] || null,
      tenure: detail.tenure || row["Tenure"] || null,
      sizeRange: sizeRange || null,
      useClass: useClass || null,
      locations: null, // PIPnet does not expose wanted locations — team fills manually.
      lastUpdated: detail.documentDate || docDate || null,
      description: [detail.comments, agentCompany ? `Acting agent: ${agentCompany}` : null].filter(Boolean).join("\n\n") || null,
      status: row["Status"] || "active",
      rawData: {
        ...row,
        _agentCompany: agentCompany,
        _detail: detail,
        _landlordPackUrl: detail.landlordPackUrl || null,
        _mobile: detail.mobile || null,
        _address: { line1: detail.address1, line2: detail.address2, town: detail.town, county: detail.county, postCode: detail.postCode },
      } as any,
      updatedAt: new Date(),
    };

    let externalId: string;
    if (existing.length > 0) {
      await db
        .update(externalRequirements)
        .set(record)
        .where(eq(externalRequirements.id, existing[0].id));
      externalId = existing[0].id;
    } else {
      const [inserted] = await db.insert(externalRequirements).values(record).returning({ id: externalRequirements.id });
      externalId = inserted.id;
    }
    imported++;

    if (autoPromote && (existing.length === 0 || existing[0].status !== "converted")) {
      const created = await promoteToCrmRequirement(externalId, record);
      if (created) promoted++;
    }
  }

  return { imported, promoted, skippedOld, total: results.length, pages: Math.ceil(results.length / 20) };
}

async function promoteToCrmRequirement(
  externalId: string,
  item: {
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    useClass: string | null;
    sizeRange: string | null;
    locations: string[] | null;
    tenure: string | null;
    description: string | null;
    lastUpdated?: string | null;
    rawData: any;
  }
): Promise<boolean> {
  const agentCompanyName: string = (item.rawData?._agentCompany || "").trim();
  const landlordPackUrl: string | null = item.rawData?._landlordPackUrl || null;
  const mobile: string | null = item.rawData?._mobile || null;
  const addr = item.rawData?._address || {};
  return db.transaction(async (tx) => {
    // Client company — the tenant looking for space (PIPnet "Client" column).
    let clientCompanyId: string | null = null;
    if (item.companyName) {
      const existingCompany = await tx
        .select()
        .from(crmCompanies)
        .where(eq(crmCompanies.name, item.companyName))
        .limit(1);
      if (existingCompany.length > 0) {
        clientCompanyId = existingCompany[0].id;
      } else {
        const [newCompany] = await tx
          .insert(crmCompanies)
          .values({ name: item.companyName })
          .returning({ id: crmCompanies.id });
        clientCompanyId = newCompany.id;
      }
    }

    // Agent company — look up by name. On create, tag companyType="Agent".
    // On existing rows without a type, also set it — pre-PIPnet rows for
    // Savills/CBRE/etc. otherwise never get the tag.
    let agentCompanyId: string | null = null;
    if (agentCompanyName) {
      const existingAgentCo = await tx
        .select()
        .from(crmCompanies)
        .where(eq(crmCompanies.name, agentCompanyName))
        .limit(1);
      if (existingAgentCo.length > 0) {
        agentCompanyId = existingAgentCo[0].id;
        if (!existingAgentCo[0].companyType) {
          await tx
            .update(crmCompanies)
            .set({ companyType: "Agent" })
            .where(eq(crmCompanies.id, existingAgentCo[0].id));
        }
      } else {
        const [newAgentCo] = await tx
          .insert(crmCompanies)
          .values({ name: agentCompanyName, companyType: "Agent" })
          .returning({ id: crmCompanies.id });
        agentCompanyId = newAgentCo.id;
      }
    }

    // Agent contact — named person at the agency. Goes into agentContactId,
    // not principalContactId. Email + mobile + address are merged on existing
    // rows so subsequent syncs enrich rather than duplicate.
    let agentContactId: string | null = null;
    if (item.contactName) {
      const existingContact = await tx
        .select()
        .from(crmContacts)
        .where(
          and(
            eq(crmContacts.name, item.contactName),
            agentCompanyId ? eq(crmContacts.companyId, agentCompanyId) : isNull(crmContacts.companyId),
          )
        )
        .limit(1);
      if (existingContact.length > 0) {
        agentContactId = existingContact[0].id;
        const updates: Record<string, any> = {};
        if (!existingContact[0].email && item.contactEmail) updates.email = item.contactEmail;
        if (!existingContact[0].phone && item.contactPhone) updates.phone = item.contactPhone;
        if (!existingContact[0].phoneMobile && mobile) updates.phoneMobile = mobile;
        if (Object.keys(updates).length > 0) {
          await tx.update(crmContacts).set(updates).where(eq(crmContacts.id, existingContact[0].id));
        }
      } else {
        const [newContact] = await tx
          .insert(crmContacts)
          .values({
            name: item.contactName,
            companyName: agentCompanyName || null,
            email: item.contactEmail,
            phone: item.contactPhone,
            phoneMobile: mobile,
            companyId: agentCompanyId,
            contactType: "Agent",
          })
          .returning({ id: crmContacts.id });
        agentContactId = newContact.id;
      }
    }

    // Use class arrives comma-separated from PIPnet ("A1,A3,SG,A4,E") — split.
    const useArray = item.useClass
      ? item.useClass.split(/[,;|]/).map(s => s.trim()).filter(Boolean)
      : null;

    const landlordPackJson = landlordPackUrl
      ? JSON.stringify({ url: landlordPackUrl, name: "PIPnet brochure" })
      : null;

    const requirementDate = parseUkDate(item.lastUpdated || "");
    const requirementDateIso = requirementDate ? requirementDate.toISOString().slice(0, 10) : null;

    // Skip if a leasing requirement for this client already exists — avoids
    // duplicating when a re-sync sees the same client.
    const existingReq = await tx
      .select({ id: crmRequirementsLeasing.id })
      .from(crmRequirementsLeasing)
      .where(eq(crmRequirementsLeasing.name, item.companyName))
      .limit(1);
    if (existingReq.length > 0) {
      await tx
        .update(externalRequirements)
        .set({ status: "converted" })
        .where(eq(externalRequirements.id, externalId));
      return false;
    }

    const addressLine = [addr.line1, addr.line2, addr.town, addr.county, addr.postCode].filter(Boolean).join(", ");
    await tx.insert(crmRequirementsLeasing).values({
      name: item.companyName,
      companyId: clientCompanyId,
      principalContactId: null,
      agentContactId,
      requirementDate: requirementDateIso,
      use: useArray,
      size: item.sizeRange ? [item.sizeRange] : null,
      requirementLocations: item.locations,
      landlordPack: landlordPackJson,
      comments: [
        item.description,
        item.tenure ? `Tenure: ${item.tenure}` : null,
        addressLine ? `Agent address: ${addressLine}` : null,
        "Source: PIPnet",
      ].filter(Boolean).join("\n"),
      status: "Active",
    });

    await tx
      .update(externalRequirements)
      .set({ status: "converted" })
      .where(eq(externalRequirements.id, externalId));
    return true;
  });
}

export function resetSession() {
  sessionCookie = null;
  scraperSession = null;
}

// One-shot inspector: run a small search, find the first per-row link inside
// the result table, fetch that page, and dump every label/value pair it can
// find. Returns the discovered detail URL plus a flat object of fields. Used
// purely to figure out what's actually on PIPnet's requirement detail page.
export async function inspectPipnetDetail(): Promise<{
  candidateLinks: string[];
  detailUrl: string | null;
  fields: Record<string, string>;
  htmlPreview: string;
  htmlLength: number;
  brochure?: {
    url: string;
    contentType: string;
    bytes: number;
    isHtml: boolean;
    htmlPreview?: string;
    imageUrls?: string[];
  } | null;
}> {
  const cookie = await login();
  const body = new URLSearchParams({
    requirementType: "ReqRetail",
    locationSearchEdit: "",
    locationListBox: "",
    status: "Latest",
    documentDate: "",
    extrapolated: "True",
    clientSearchEdit: "",
    clientListBox: "",
    minSalesArea: "",
    maxSalesArea: "",
    Search: "Search",
  });
  const listRes = await pipFetch(`${PIPNET_URL}/reqfetch.jsp`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: body.toString(),
  });
  if (!listRes.ok) throw new Error(`PIPnet list fetch failed: ${listRes.status}`);
  const listHtml = await listRes.text();

  // Pull every href on the page; filter to ones that look like a per-row
  // detail link (not pagination, not nav, not search).
  const allHrefs = Array.from(new Set(
    [...listHtml.matchAll(/href="([^"]+)"/gi)].map(m => m[1])
  ));
  const skip = /^(#|javascript:|mailto:|\/?logout|\/?login|reqresults\.jsp\?action=next|.*\.css|.*\.js)/i;
  const detailCandidates = allHrefs.filter(h => !skip.test(h));
  const detailHref = detailCandidates.find(h => /req|detail|show|view/i.test(h)) || detailCandidates[0] || null;

  if (!detailHref) {
    return { candidateLinks: detailCandidates.slice(0, 20), detailUrl: null, fields: {}, htmlPreview: listHtml.slice(0, 800), htmlLength: listHtml.length };
  }

  const detailUrl = detailHref.startsWith("http") ? detailHref : `${PIPNET_URL}/${detailHref.replace(/^\//, "")}`;
  const detailRes = await pipFetch(detailUrl, { headers: { Cookie: cookie } });
  if (!detailRes.ok) throw new Error(`PIPnet detail fetch failed: ${detailRes.status}`);
  const detailHtml = await detailRes.text();

  const fields: Record<string, string> = {};
  const clean = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

  // Pattern 1: <th>Label</th><td>Value</td>
  for (const m of detailHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const k = clean(m[1]); const v = clean(m[2]);
    if (k && v && k.length < 60) fields[k] = v;
  }
  // Pattern 2: <td class="label">Label</td><td>Value</td>
  for (const m of detailHtml.matchAll(/<td[^>]*class="[^"]*(?:label|fieldLabel|key)[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const k = clean(m[1]); const v = clean(m[2]);
    if (k && v && k.length < 60) fields[k] = v;
  }
  // Pattern 3: <dt>Label</dt><dd>Value</dd>
  for (const m of detailHtml.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const k = clean(m[1]); const v = clean(m[2]);
    if (k && v && k.length < 60) fields[k] = v;
  }
  // Pattern 4: generic <td>Label:</td><td>Value</td> (colon-terminated label)
  for (const m of detailHtml.matchAll(/<td[^>]*>\s*([^<:]{2,40}):\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const k = clean(m[1]); const v = clean(m[2]);
    if (k && v && !(k in fields)) fields[k] = v;
  }
  // Pattern 5: bold-label rows — <b>Label</b> ... <td>Value</td>
  for (const m of detailHtml.matchAll(/<b[^>]*>([^<:]{2,40}):?<\/b>\s*([^<]{1,200})/gi)) {
    const k = clean(m[1]); const v = clean(m[2]);
    if (k && v && !(k in fields)) fields[k] = v;
  }

  // Also follow the "View All Images" link so we can see what format the
  // brochure is in (HTML index, single image, PDF, etc). Determines the
  // downloader / OCR pipeline we need to build next.
  let brochure: { url: string; contentType: string; bytes: number; isHtml: boolean; htmlPreview?: string; imageUrls?: string[] } | null = null;
  const viewAllMatch = detailHtml.match(/<a[^>]+href="([^"]+)"[^>]*>\s*View All Images\s*<\/a>/i);
  if (viewAllMatch) {
    const brochureUrl = viewAllMatch[1].startsWith("http") ? viewAllMatch[1] : `${PIPNET_URL}/${viewAllMatch[1].replace(/^\//, "")}`;
    try {
      const bRes = await pipFetch(brochureUrl, { headers: { Cookie: cookie } });
      const ct = bRes.headers.get("content-type") || "";
      const isHtml = /html/i.test(ct);
      if (isHtml) {
        const bHtml = await bRes.text();
        const imgs = Array.from(new Set(
          [...bHtml.matchAll(/<img[^>]+src="([^"]+)"/gi)].map(m => m[1])
        )).slice(0, 20);
        brochure = { url: brochureUrl, contentType: ct, bytes: bHtml.length, isHtml: true, htmlPreview: bHtml.slice(0, 1500), imageUrls: imgs };
      } else {
        const buf = await bRes.arrayBuffer();
        brochure = { url: brochureUrl, contentType: ct, bytes: buf.byteLength, isHtml: false };
      }
    } catch (e: any) {
      brochure = { url: brochureUrl, contentType: `error: ${e?.message}`, bytes: 0, isHtml: false };
    }
  }

  return {
    candidateLinks: detailCandidates.slice(0, 20),
    detailUrl,
    fields,
    htmlPreview: detailHtml.slice(0, 1200),
    htmlLength: detailHtml.length,
    brochure,
  };
}

export async function testPipnetLogin(): Promise<{ ok: boolean; message: string; status?: number; via: string }> {
  resetSession();
  const via = isScraperApiAvailable() ? "ScraperAPI proxy" : "direct fetch";
  try {
    const cookie = await login();
    return { ok: true, message: `Login successful — JSESSIONID acquired (${cookie.split("=")[1]?.slice(0, 6)}…) via ${via}.`, via };
  } catch (err: any) {
    return { ok: false, message: err?.message || String(err), via };
  }
}
