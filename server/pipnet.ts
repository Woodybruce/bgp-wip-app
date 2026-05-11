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

  for (const row of results) {
    if (!loggedHeaders) {
      console.log(`[pipnet import] PIPnet row columns: ${JSON.stringify(Object.keys(row))}`);
      loggedHeaders = true;
    }
    const companyName =
      row["Client"] || row["Company"] || row["Name"] || "Unknown";
    if (companyName === "Unknown" || companyName === "[No Client Quoted]") continue;

    const agentCompany = (row["Agent"] || row["Agency"] || row["Acting Agent"] || "").trim();
    const agentContactName = (row["Contact"] || row["Contact Name"] || row["Agent Contact"] || "").trim();
    // Size: prefer dedicated size headers; fall back to "Area" only if no other.
    const sizeRange = (row["Size"] || row["Sales Area"] || row["Sq Ft"] || row["Square Footage"] || row["Floor Area"] || row["Area"] || "").trim();
    // Location: never reads "Area" (collides with size); use dedicated location headers.
    const locationRaw = (row["Location"] || row["Locations"] || row["Town"] || row["Region"] || row["Wanted Area"] || row["Search Area"] || row["Geographic Area"] || row["Where"] || row["Area Required"] || "").trim();
    const useClass = (row["Use"] || row["Use Class"] || row["Use Type"] || row["Type"] || row["Property Type"] || row["Sector"] || row["Class"] || "").trim();
    const docDate = row["Document Date"] || row["Date"] || row["Updated"] || row["Last Updated"] || "";

    const parsedDate = parseUkDate(docDate);
    if (parsedDate && parsedDate < cutoff) {
      skippedOld++;
      continue;
    }

    const sourceId = `pipnet-req-${companyName}-${agentCompany}-${sizeRange}`.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();

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

    const record = {
      source: "PIPnet" as const,
      sourceId,
      companyName,
      // PIPnet's "Contact" is the agent's named contact, not a client-side
      // contact. Stored here for the promote step to route to agentContactId.
      contactName: agentContactName || null,
      contactPhone: row["Tel. No"] || row["Phone"] || row["Telephone"] || row["Tel"] || null,
      contactEmail: row["Email"] || row["E-Mail"] || row["E-mail"] || null,
      tenure: row["Tenure"] || null,
      sizeRange: sizeRange || null,
      useClass: useClass || null,
      locations: locationRaw ? locationRaw.split(/\s*[,;|]\s*/).filter(Boolean) : null,
      lastUpdated: docDate || null,
      description: agentCompany ? `Acting agent: ${agentCompany}` : null,
      status: row["Status"] || "active",
      rawData: { ...row, _agentCompany: agentCompany } as any,
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
    rawData: any;
  }
): Promise<boolean> {
  const agentCompanyName: string = (item.rawData?._agentCompany || "").trim();
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

    // Agent company — the agency representing the client (PIPnet "Agent"
    // column). Looked up by name; if missing, created with companyType="Agent".
    let agentCompanyId: string | null = null;
    if (agentCompanyName) {
      const existingAgentCo = await tx
        .select()
        .from(crmCompanies)
        .where(eq(crmCompanies.name, agentCompanyName))
        .limit(1);
      if (existingAgentCo.length > 0) {
        agentCompanyId = existingAgentCo[0].id;
      } else {
        const [newAgentCo] = await tx
          .insert(crmCompanies)
          .values({ name: agentCompanyName, companyType: "Agent" })
          .returning({ id: crmCompanies.id });
        agentCompanyId = newAgentCo.id;
      }
    }

    // Agent contact — the named person at the agency (PIPnet "Contact"
    // column). Goes into agentContactId, NOT principalContactId.
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
      } else {
        const [newContact] = await tx
          .insert(crmContacts)
          .values({
            name: item.contactName,
            companyName: agentCompanyName || null,
            email: item.contactEmail,
            phone: item.contactPhone,
            companyId: agentCompanyId,
          })
          .returning({ id: crmContacts.id });
        agentContactId = newContact.id;
      }
    }

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

    await tx.insert(crmRequirementsLeasing).values({
      name: item.companyName,
      companyId: clientCompanyId,
      principalContactId: null,
      agentContactId,
      use: item.useClass ? [item.useClass] : null,
      size: item.sizeRange ? [item.sizeRange] : null,
      requirementLocations: item.locations,
      comments: [item.description, `Tenure: ${item.tenure || "N/A"}`, "Source: PIPnet"].filter(Boolean).join("\n"),
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
