import { db } from "./db";
import { externalRequirements } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { ScraperSession, isScraperApiAvailable } from "./utils/scraperapi";

const PIPNET_URL = process.env.PIPNET_URL || "https://v1.pipnet.co.uk";
const PIPNET_USERNAME = process.env.PIPNET_USERNAME || "helliott";
const PIPNET_PASSWORD = process.env.PIPNET_PASSWORD || "";
const PIPNET_EMAIL = process.env.PIPNET_EMAIL || "";

let sessionCookie: string | null = null;

// Sticky ScraperAPI session — every PIPnet call (login + every result-page
// fetch) goes through the same upstream proxy IP, so the JSESSIONID cookie
// PIPnet sets on login stays valid for the rest of the scrape. Without this
// every fetch would rotate to a new IP and PIPnet would invalidate the
// session. Reset between full scrapes via `resetSession()` below.
let scraperSession: ScraperSession | null = null;
function pipFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // Fall back to direct fetch if ScraperAPI isn't configured (dev mode,
  // tests, etc). PIPnet works fine direct from a dev laptop — this proxy
  // detour is purely for Railway egress where pip's WAF blocks the IP.
  if (!isScraperApiAvailable()) return fetch(url, init);
  if (!scraperSession) scraperSession = new ScraperSession();
  return scraperSession.fetch(url, init);
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

  const body = new URLSearchParams({
    username: PIPNET_USERNAME,
    password: PIPNET_PASSWORD,
    email: PIPNET_EMAIL,
    Submit: "Login",
  });

  const res = await pipFetch(`${PIPNET_URL}/checkLogin.jsp`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });

  const cookies = res.headers.getSetCookie?.() || [];
  const jsessionid = cookies
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("JSESSIONID="));

  if (!jsessionid) {
    const html = await res.text();
    if (html.includes("Invalid logon")) {
      throw new Error("PIPnet login failed: invalid credentials");
    }
    throw new Error("PIPnet login failed: no session cookie");
  }

  const checkHtml = await res.text();
  if (checkHtml.includes("Invalid logon")) {
    throw new Error("PIPnet login failed: invalid credentials");
  }

  sessionCookie = jsessionid;
  return sessionCookie;
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
    const maxPages = Math.min(totalPages, params.maxPages || 50);
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

export async function importPipnetRequirements(params: {
  location?: string;
  minSize?: string;
  maxSize?: string;
  client?: string;
  documentDate?: string;
  allPages?: boolean;
}): Promise<{ imported: number; total: number; pages: number }> {
  const results = await searchPipnetRequirements({
    ...params,
    allPages: params.allPages ?? true,
  });
  let imported = 0;

  for (const row of results) {
    const companyName =
      row["Client"] || row["Company"] || row["Name"] || "Unknown";
    if (companyName === "Unknown" || companyName === "[No Client Quoted]") continue;

    const agent = row["Agent"] || "";
    const contact = row["Contact"] || "";
    const area = row["Area"] || row["Size"] || row["Sales Area"] || "";
    const docDate = row["Document Date"] || row["Date"] || row["Updated"] || "";

    const sourceId = `pipnet-req-${companyName}-${agent}-${area}`.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();

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
      contactName: contact || null,
      contactPhone: row["Tel. No"] || row["Phone"] || row["Telephone"] || null,
      contactEmail: row["Email"] || null,
      tenure: row["Tenure"] || null,
      sizeRange: area || null,
      useClass: row["Use"] || row["Use Class"] || null,
      locations: row["Location"] ? [row["Location"]] : null,
      lastUpdated: docDate || null,
      description: agent ? `Agent: ${agent}` : null,
      status: row["Status"] || "active",
      rawData: row as any,
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db
        .update(externalRequirements)
        .set(record)
        .where(eq(externalRequirements.id, existing[0].id));
    } else {
      await db.insert(externalRequirements).values(record);
    }
    imported++;
  }

  return { imported, total: results.length, pages: Math.ceil(results.length / 20) };
}

export function resetSession() {
  sessionCookie = null;
  scraperSession = null;
}
