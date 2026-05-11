import { db } from "./db";
import { externalRequirements } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { ScraperSession, isScraperApiAvailable } from "./utils/scraperapi";
import { getPipnetCreds } from "./integration-credentials";

const PIPNET_URL = process.env.PIPNET_URL || "https://v1.pipnet.co.uk";

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

  const res = await pipFetch(`${PIPNET_URL}/checkLogin.jsp`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });

  const jsessionid = extractJsessionId(res);
  const bodyText = await res.text();

  if (!jsessionid) {
    if (bodyText.includes("Invalid logon")) {
      throw new Error("PIPnet login failed: invalid credentials");
    }
    const hdrKeys: string[] = [];
    res.headers.forEach((_v, k) => hdrKeys.push(k));
    console.error(`[pipnet login] no JSESSIONID. status=${res.status} headers=${hdrKeys.join(",")} bodyPreview=${bodyText.slice(0, 300).replace(/\s+/g, " ")}`);
    throw new Error(`PIPnet login failed: no session cookie (HTTP ${res.status} from ${PIPNET_URL}/checkLogin.jsp via ${isScraperApiAvailable() ? "ScraperAPI proxy" : "direct fetch"})`);
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
