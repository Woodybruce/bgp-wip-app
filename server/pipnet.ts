import { db } from "./db";
import { externalRequirements, crmRequirementsLeasing, crmCompanies, crmContacts } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { ScraperSession, isScraperApiAvailable } from "./utils/scraperapi";
import { getPipnetCreds } from "./integration-credentials";
import { saveFile } from "./file-storage";
import { randomBytes } from "crypto";
import { parseRequirementBrochure, mergeVisionIntoRecord } from "./requirement-vision-parser";
import { geocodeOne } from "./geocode";

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
function withPipHeaders(init: RequestInit = {}): RequestInit {
  // ScraperAPI requires a User-Agent whenever keep_headers=true, otherwise
  // it rejects the request with HTTP 400 "Error, malformed request". PIPnet
  // also responds more reliably with a real-browser UA, so we always set one.
  return {
    ...init,
    headers: {
      "User-Agent": PIPNET_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      ...(init.headers as Record<string, string> | undefined),
    },
  };
}
function pipFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const mergedInit = withPipHeaders(init);
  // Fall back to direct fetch if ScraperAPI isn't configured (dev mode, tests).
  // Otherwise route through the sticky proxy session. NOTE: login() logs in via
  // a DIRECT fetch first (PIPnet's WAF lets the login POST through, and the
  // JSESSIONID it returns works fine even when the follow-up reqfetch/detail
  // calls come via the proxy — PIPnet does not pin the session to the IP).
  if (!isScraperApiAvailable()) return fetch(url, mergedInit);
  if (!scraperSession) scraperSession = new ScraperSession();
  return scraperSession.fetch(url, mergedInit);
}

// PIPnet serves its login/search form with HTTP 200, so a bare status check
// can't tell an authenticated page from a bounced one. These markers only
// appear on the unauthenticated login/search form (never on a result list or
// a requirement detail page), so their presence means the session is dead.
function looksUnauthenticated(html: string): boolean {
  if (!html) return true;
  if (/checkLogin\.jsp|name=["']password["']|Invalid logon/i.test(html)) return true;
  // The retail search form — bounced detail/result fetches land here.
  const isSearchForm = /reqsearchretailtabbed|locationListBox|minSalesArea/i.test(html);
  const hasResults = /class=["']results?Table["']|reqdetails\.jsp/i.test(html);
  return isSearchForm && !hasResults;
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

  // Log in via DIRECT fetch first — PIPnet's WAF lets the login POST through
  // from Railway, and the JSESSIONID it returns works fine even though the
  // follow-up reqfetch/reqdetails calls come via the ScraperAPI proxy (PIPnet
  // does not pin the session to the egress IP). Only fall back to the proxy if
  // the direct login is actually blocked. (Routing the login POST through
  // ScraperAPI produces a broken session and the search comes back empty.)
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

// Serialise an HTML form's current field defaults into URL-encoded params —
// text/hidden input values, checked checkboxes/radios, and each select's
// selected (or first) option. Lets us "replay" PIPnet's property search exactly
// as the browser would on a default Search, without hardcoding its operator
// option values.
function serializeFormDefaults(html: string, actionContains: string): URLSearchParams {
  const params = new URLSearchParams();
  const formRe = new RegExp(`<form[^>]*action="[^"]*${actionContains}[^"]*"[^>]*>([\\s\\S]*?)</form>`, "i");
  const scope = html.match(formRe)?.[1] ?? html;
  for (const m of scope.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = tag.match(/name="([^"]+)"/i)?.[1];
    if (!name) continue;
    const type = (tag.match(/type="([^"]+)"/i)?.[1] || "text").toLowerCase();
    const value = tag.match(/value="([^"]*)"/i)?.[1] ?? "";
    if (type === "checkbox" || type === "radio") {
      if (/\bchecked\b/i.test(tag)) params.append(name, value || "on");
    } else if (type !== "submit" && type !== "button" && type !== "reset") {
      params.set(name, value);
    }
  }
  for (const m of scope.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const name = m[1];
    const inner = m[2];
    const sel =
      inner.match(/<option[^>]*\bselected\b[^>]*?value="([^"]*)"/i)?.[1] ??
      inner.match(/<option[^>]*?value="([^"]*)"[^>]*\bselected\b/i)?.[1] ??
      inner.match(/<option[^>]*?value="([^"]*)"/i)?.[1] ?? "";
    params.set(name, sel);
  }
  return params;
}

export async function searchPipnetProperties(params: {
  location?: string;
  minSize?: string;
  maxSize?: string;
  type?: string;
}): Promise<Record<string, string>[]> {
  const cookie = await login();

  // Load the property search form (retailsearch.jsp → posts to detailsfetch.jsp)
  // from the choice.jsp menu, so we get a valid form + prime the session. Then
  // replay its defaults. PIPnet's property form is an operator/operand filter,
  // completely different from the requirements form.
  let formHtml = "";
  try {
    const choice = await pipFetch(`${PIPNET_URL}/choice.jsp`, { headers: { Cookie: cookie } });
    const chtml = await choice.text();
    const link = (chtml.match(/href="(retailsearch\.jsp[^"]*)"/i)?.[1] || "retailsearch.jsp").replace(/&amp;/g, "&");
    const formRes = await pipFetch(`${PIPNET_URL}/${link.replace(/^\//, "")}`, { headers: { Cookie: cookie } });
    formHtml = await formRes.text();
  } catch (e: any) {
    console.warn(`[pipnet props] could not load property search form: ${e?.message}`);
  }

  const body = serializeFormDefaults(formHtml, "detailsfetch.jsp");
  body.set("Search", "Search");
  body.delete("Reset");
  // Optional overrides — narrow by town / size when asked.
  if (params.location) body.set("operandTown", params.location);
  if (params.minSize) body.set("operandAreaMinimum", params.minSize);
  if (params.maxSize) body.set("operandAreaMaximum", params.maxSize);

  const res = await pipFetch(`${PIPNET_URL}/detailsfetch.jsp`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`PIPnet prop search failed: ${res.status}`);
  const html = await res.text();
  return parseHtmlTable(html);
}

// Import PIPnet's AVAILABLE (retail) properties — the mirror of
// importPipnetRequirements but for space on the market rather than occupier
// requirements. Each listing is upserted into crm_properties (which is what
// the Property Map plots), geocoded for lat/lng, and its "View All Images"
// brochure is downloaded and stored under landlord-packs (same mechanism the
// requirements side uses). Listings are tagged status "Market Listing" /
// group "PIPnet" so they're distinguishable from BGP's own instructed stock.
//
// NOTE: PIPnet's property result columns aren't visible from this sandbox
// (the search returns rows only once the session/transport fix is deployed),
// so the row→field mapping below is defensive — it tries every plausible
// header — and should be tuned against real headers after the first live run
// (the [pipnet props] column log prints them).
// Fetch a property's detail page(s) and capture EVERY field. Summary lives on
// detailsdetails.jsp (Rent, Rateable Value, Tenure, User Category, Agent,
// Contact, Telephone + Address/Availability in the header + the "View All
// Images" brochure link); the "View Full Details" page (detailsfulldetail.jsp)
// holds the rest, incl. Service Charge. Returns structured fields plus a flat
// map of all captured label/value pairs (rawData), so nothing is lost.
async function fetchPipnetPropertyDetail(folderId: string, cookie: string): Promise<{
  address?: string | null; town?: string | null; street?: string | null; postcode?: string | null;
  availability?: string | null; rent?: string | null; serviceCharge?: string | null;
  rateableValue?: string | null; areaSqft?: string | null; tenure?: string | null;
  useCategory?: string | null; agent?: string | null; contactName?: string | null;
  telephone?: string | null; email?: string | null; documentDate?: string | null;
  brochureUrl?: string | null; allFields?: Record<string, string>;
}> {
  const clean = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&pound;/g, "£").replace(/&#149;/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const cellAfter = (html: string, labelPat: string): string | null => {
    const m = html.match(new RegExp(`>\\s*${labelPat}\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i"));
    const v = m ? clean(m[1]) : "";
    return v || null;
  };
  const out: any = { allFields: {} };

  const res = await pipFetch(`${PIPNET_URL}/detailsdetails.jsp?folderid=${folderId}`, { headers: { Cookie: cookie } });
  if (!res.ok) { console.error(`[pipnet prop detail] ${folderId}: HTTP ${res.status}`); return out; }
  const html = await res.text();
  if (/Please provide your account information|name="password"/i.test(html)) { console.error(`[pipnet prop detail] ${folderId}: bounced to login`); return out; }
  if (/unexpected error has occ/i.test(html)) { console.error(`[pipnet prop detail] ${folderId}: error page`); return out; }

  out.rent = cellAfter(html, "Rent\\s*&pound;");
  out.rateableValue = cellAfter(html, "Rateable Value\\s*&pound;");
  out.tenure = cellAfter(html, "Tenure");
  out.useCategory = cellAfter(html, "User Category");
  out.agent = cellAfter(html, "Agent");
  out.contactName = cellAfter(html, "Contact");
  out.telephone = cellAfter(html, "Telephone");

  // Header: "Address: , , 244/256, STATION ROAD, , ADDLESTONE, KT15 2PS  • Availability: AVAILABLE"
  const addrRaw = html.match(/Address:\s*([^•<]+)/i)?.[1];
  if (addrRaw) {
    const parts = clean(addrRaw).split(",").map(s => s.trim()).filter(Boolean);
    out.address = parts.join(", ");
    out.postcode = out.address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0] || null;
    if (parts.length >= 2) out.town = out.postcode ? parts[parts.length - 2] : parts[parts.length - 1];
    const streetPart = parts.find(p => /road|street|lane|avenue|way|place|square|hill|gate|parade|precinct|centre|mall/i.test(p));
    if (streetPart) out.street = streetPart;
  }
  out.availability = html.match(/Availability:\s*([A-Za-z][^•<]*)/i)?.[1]?.trim() || null;
  out.documentDate = html.match(/Document Date:\s*([0-9/]+)/i)?.[1] || null;
  out.email = html.match(/mailto:([^?"&]+)/i)?.[1] || null;
  out.brochureUrl = html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*View All Images\s*<\/a>/i)?.[1] || null;

  // "View Full Details" page — Service Charge, EPC, lease terms, etc. Capture
  // every label/value pair so nothing is dropped.
  try {
    const fr = await pipFetch(`${PIPNET_URL}/detailsfulldetail.jsp?folderid=${folderId}`, { headers: { Cookie: cookie } });
    if (fr.ok) {
      const fhtml = await fr.text();
      if (!/Please provide your account information|unexpected error has occ/i.test(fhtml)) {
        out.serviceCharge = cellAfter(fhtml, "Service Charge\\s*&pound;") || cellAfter(fhtml, "Service Charge");
        for (const m of fhtml.matchAll(/>\s*([A-Za-z][^<:]{1,40}?)\s*(?:&pound;)?\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
          const k = clean(m[1]); const v = clean(m[2]);
          if (k && v && k.length < 40 && !(k in out.allFields)) out.allFields[k] = v;
        }
      }
    }
  } catch (e: any) { /* full-detail is best-effort */ }

  return out;
}

export async function importPipnetProperties(params: {
  location?: string;
  minSize?: string;
  maxSize?: string;
  type?: string;
  allPages?: boolean;
}): Promise<{ imported: number; geocoded: number; withBrochure: number; total: number }> {
  const { upsertExternalProperty } = await import("./external-properties");
  const results = await searchPipnetProperties({
    location: params.location,
    minSize: params.minSize,
    maxSize: params.maxSize,
    type: params.type,
  });
  // Reuse the search's session cookie — calling login() here would wipe the
  // result context and break every detail fetch (see importPipnetRequirements).
  const cookie = sessionCookie;
  if (!cookie) throw new Error("PIPnet session missing after search");
  let imported = 0;
  let geocoded = 0;
  let withBrochure = 0;
  let loggedHeaders = false;

  for (const row of results) {
    if (!loggedHeaders) {
      console.log(`[pipnet props] PIPnet property columns: ${JSON.stringify(Object.keys(row))}`);
      loggedHeaders = true;
    }

    const folderId = row._detailHref?.match(/folderid=(\d+)/i)?.[1] || null;
    if (!folderId) continue;
    const sourceId = `pipnet-prop-${folderId}`;

    let detail: Awaited<ReturnType<typeof fetchPipnetPropertyDetail>> = {};
    try {
      detail = await fetchPipnetPropertyDetail(folderId, cookie);
      await new Promise(r => setTimeout(r, 150));
    } catch (e: any) {
      console.error(`[pipnet props] detail ${folderId}: ${e?.message}`);
    }

    // Address — prefer the detail-page address, fall back to the list row.
    const listStreet = (row["Street"] || "").trim();
    const listNo = (row["No"] || "").trim();
    const listTown = (row["Town"] || "").trim();
    const listSuburb = (row["Suburb"] || "").trim();
    const fullAddress = detail.address || [listNo, listStreet, listSuburb, listTown].filter(Boolean).join(", ");
    if (!fullAddress) continue;

    const postcode = detail.postcode || (fullAddress.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0] ?? null);
    const areaSqft = (row["Primary Area ft2"] || row["Primary Area ft²"] || "").trim() || null;

    // Brochure ("View All Images" → allimages PDF) → landlord pack, named after
    // the address. Fetched as raw binary (the proxy mangles binaries).
    let brochurePack: { url: string; name: string; pages: number } | null = null;
    if (detail.brochureUrl) {
      try {
        const pack = await downloadBrochureAsPdf(detail.brochureUrl, cookie, folderId, fullAddress);
        if (pack) { brochurePack = { url: pack.url, name: pack.name, pages: pack.pages }; withBrochure++; }
      } catch (e: any) {
        console.error(`[pipnet props] brochure ${fullAddress}: ${e?.message}`);
      }
    }

    // Geocode for the map (cached).
    const geo = await geocodeOne(fullAddress);
    if (geo.lat != null && geo.lng != null) geocoded++;

    await upsertExternalProperty({
      id: sourceId,
      source: "PIPnet",
      folderId,
      address: geo.formattedAddress || fullAddress,
      town: detail.town || listTown || null,
      street: detail.street || listStreet || null,
      postcode,
      latitude: geo.lat ?? null,
      longitude: geo.lng ?? null,
      rent: detail.rent || null,
      serviceCharge: detail.serviceCharge || null,
      rateableValue: detail.rateableValue || null,
      areaSqft,
      tenure: detail.tenure || null,
      useCategory: detail.useCategory || null,
      availability: detail.availability || null,
      agent: detail.agent || (row["Agent"] || "").trim() || null,
      contactName: detail.contactName || (row["Contact"] || "").trim() || null,
      contactPhone: detail.telephone || (row["Telephone"] || "").trim() || null,
      contactEmail: detail.email || null,
      landlordPack: brochurePack ? JSON.stringify(brochurePack) : null,
      documentDate: detail.documentDate || (row["Date"] || "").trim() || null,
      rawData: { listRow: row, allFields: detail.allFields, brochureUrl: detail.brochureUrl },
    });
    imported++;
  }

  return { imported, geocoded, withBrochure, total: results.length };
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
  // Fetch by folderid alone. The row link carries a session-positional
  // `index=N` that errors out once the search result set rotates (across
  // paginated runs), whereas folderid is PIPnet's stable requirement id and
  // resolves directly. (folderid 87746 == the brochure's requirement=87746.)
  const folderId = href.match(/folderid=(\d+)/i)?.[1] || null;
  const url = folderId
    ? `${PIPNET_URL}/reqdetails.jsp?folderid=${folderId}`
    : href.startsWith("http") ? href : `${PIPNET_URL}/${href.replace(/^\//, "")}`;
  const res = await pipFetch(url, { headers: { Cookie: cookie } });
  if (!res.ok) {
    console.error(`[pipnet detail] ${url}: HTTP ${res.status}`);
    return {};
  }
  const html = await res.text();
  // PIPnet serves a small "unexpected error has occured" page when it can't
  // resolve the detail (e.g. the search result context was wiped by a stray
  // reqSearch.jsp hit). Treat that as a failure rather than parsing 0 fields.
  if (/unexpected error has occ/i.test(html)) {
    console.error(`[pipnet detail] ${url}: PIPnet returned its error page (result context lost) — no brochure link`);
    return {};
  }

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

  // The brochure / landlord pack link — Pipnet uses several different anchor
  // texts ("View All Images", "View Brochure", "Download Pack", sometimes
  // wrapped around an image). Try each pattern from most specific to most
  // permissive; the first hit wins.
  const brochureRegexes = [
    /<a[^>]+href="([^"]+)"[^>]*>\s*View All Images\s*<\/a>/i,
    /<a[^>]+href="([^"]+)"[^>]*>\s*View\s+Brochure\s*<\/a>/i,
    /<a[^>]+href="([^"]+)"[^>]*>\s*Download\s+(?:Pack|Brochure)\s*<\/a>/i,
    /<a[^>]+href="([^"]*viewallimages[^"]*)"/i,
    /<a[^>]+href="([^"]*\/brochure[^"]*)"/i,
    /<a[^>]+href="([^"]*landlord[_-]?pack[^"]*)"/i,
  ];
  let viewAllMatch: RegExpMatchArray | null = null;
  for (const re of brochureRegexes) {
    viewAllMatch = html.match(re);
    if (viewAllMatch) break;
  }
  const landlordPackUrl = viewAllMatch
    ? (viewAllMatch[1].startsWith("http") ? viewAllMatch[1] : `${PIPNET_URL}/${viewAllMatch[1].replace(/^\//, "")}`)
    : undefined;

  // "Requirement ID: 87425" — sometimes in a labelled row, sometimes inline.
  // Fall back to the folderid from the link, which IS the requirement id — the
  // detail page often has no th/td label rows, so without this the brochure
  // download (gated on requirementId) would be skipped even when the page and
  // its View All Images PDF link are present.
  let requirementId = fields["Requirement ID"] || fields["Req. ID"] || fields["Req ID"];
  if (!requirementId) {
    const idMatch = html.match(/Requirement\s*ID\s*:?\s*<\/?[^>]*>?\s*(\d+)/i);
    if (idMatch) requirementId = idMatch[1];
  }
  if (!requirementId && folderId) requirementId = folderId;
  // The brochure URL embeds requirement=<id> — last-resort source of the id.
  if (!requirementId && landlordPackUrl) {
    requirementId = landlordPackUrl.match(/requirement=(\d+)/i)?.[1] || requirementId;
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

// Turn a tenant/company name into a safe, readable file slug for the landlord
// pack — "City Slots" → "City-Slots". Keeps the saved file named after the
// tenant (what the team wants) rather than the opaque PIPnet folder id.
function packSlug(name: string): string {
  return (name || "landlord-pack")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "landlord-pack";
}

// Count UTF-8 replacement-char sequences (EF BF BD). ScraperAPI re-encodes
// binary responses as UTF-8, turning every high byte (incl. JPEG 0xFF markers)
// into U+FFFD — which destroys the embedded images and yields a blank PDF. A
// clean binary has essentially none; a mangled one has thousands.
function isMangledBinary(buf: Buffer): boolean {
  let hits = 0;
  for (let i = 0; i + 2 < buf.length && hits <= 25; i++) {
    if (buf[i] === 0xef && buf[i + 1] === 0xbf && buf[i + 2] === 0xbd) hits++;
  }
  return hits > 25;
}

// Fetch a PIPnet binary (the brochure PDF / its images) WITHOUT corrupting it.
// The brochure URL carries its own ?sessionid= auth, so a direct fetch works
// and — unlike the ScraperAPI proxy — preserves the raw bytes. We only fall
// back to the proxy if the direct fetch is blocked, and reject a proxied body
// that came back UTF-8-mangled rather than save a blank PDF.
async function fetchPipnetBinary(url: string, cookie: string): Promise<{ buf: Buffer; ct: string } | null> {
  const headers = { "User-Agent": PIPNET_UA, Accept: "*/*", Cookie: cookie };
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (!isMangledBinary(buf)) return { buf, ct: (r.headers.get("content-type") || "").toLowerCase() };
      console.warn(`[pipnet brochure] direct fetch returned mangled bytes for ${url} — trying proxy`);
    } else if (isScraperApiAvailable()) {
      console.warn(`[pipnet brochure] direct fetch HTTP ${r.status} — trying proxy`);
    } else {
      return null;
    }
  } catch (e: any) {
    console.warn(`[pipnet brochure] direct fetch threw (${e?.message}) — trying proxy`);
  }
  if (!isScraperApiAvailable()) return null;
  const r = await pipFetch(url, { headers: { Cookie: cookie } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (isMangledBinary(buf)) {
    console.error(`[pipnet brochure] proxy also returned mangled binary for ${url} — cannot recover image`);
    return null;
  }
  return { buf, ct: (r.headers.get("content-type") || "").toLowerCase() };
}

// Download a requirement's "View All Images" brochure, stitch every page into
// a single PDF, save via the existing file-storage helper and return the
// BGP-hosted URL ready for the landlord_pack JSON. Returns null if the
// brochure couldn't be fetched or contained no usable pages. `displayName`
// (the tenant/company) names the saved file.
async function downloadBrochureAsPdf(brochureUrl: string, cookie: string, reqId: string, displayName?: string): Promise<{ url: string; name: string; pages: number; buffer: Buffer } | null> {
  try {
    const slug = packSlug(displayName || `pipnet-${reqId}`);
    const packName = displayName ? `${displayName} — Landlord Pack` : "PIPnet brochure";
    const fileName = `${displayName || `requirement-${reqId}`}.pdf`;
    const fetched = await fetchPipnetBinary(brochureUrl, cookie);
    if (!fetched) {
      console.error(`[pipnet brochure] ${reqId}: could not fetch a clean brochure binary`);
      return null;
    }
    const ct = fetched.ct;

    // Direct PDF — save as-is.
    if (ct.includes("pdf") || fetched.buf.slice(0, 5).toString("latin1") === "%PDF-") {
      const buf = fetched.buf;
      const key = `landlord-packs/${slug}-${randomBytes(4).toString("hex")}.pdf`;
      await saveFile(key, buf, "application/pdf", fileName);
      return { url: `/api/crm/landlord-packs/${key.split("/").pop()}`, name: packName, pages: 1, buffer: buf };
    }

    // Direct image — wrap in single-page PDF.
    if (ct.startsWith("image/")) {
      const buf = fetched.buf;
      const pdf = await imagesToPdf([{ bytes: buf, contentType: ct }]);
      if (!pdf) return null;
      const key = `landlord-packs/${slug}-${randomBytes(4).toString("hex")}.pdf`;
      await saveFile(key, pdf, "application/pdf", fileName);
      return { url: `/api/crm/landlord-packs/${key.split("/").pop()}`, name: packName, pages: 1, buffer: pdf };
    }

    // HTML index — find every <img>, download each, stitch.
    const html = fetched.buf.toString("utf8");
    const imgSrcs = Array.from(new Set(
      [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map(m => m[1])
    ));
    // Filter to brochure pages: prefer same-origin, skip obvious chrome
    // (logos, icons, spacers).
    const skipChrome = /(logo|icon|spacer|button|nav|header|footer|pixel\.gif|blank\.gif)/i;
    const baseUrl = new URL(brochureUrl);
    const pageImageUrls = imgSrcs
      .filter(src => !skipChrome.test(src))
      .map(src => {
        if (src.startsWith("http")) return src;
        if (src.startsWith("//")) return `${baseUrl.protocol}${src}`;
        if (src.startsWith("/")) return `${baseUrl.origin}${src}`;
        return new URL(src, brochureUrl).toString();
      })
      .filter(u => u.startsWith(baseUrl.origin)); // only PIPnet-hosted

    if (pageImageUrls.length === 0) {
      console.error(`[pipnet brochure] ${reqId}: no usable images on ${brochureUrl}`);
      return null;
    }

    const pages: { bytes: Buffer; contentType: string }[] = [];
    for (const u of pageImageUrls.slice(0, 50)) { // cap at 50 pages just in case
      // Use the binary-safe fetch — these page images are JPEGs and would be
      // UTF-8-mangled (blank) if pulled through the proxy.
      const got = await fetchPipnetBinary(u, cookie);
      if (!got) continue;
      const ict = got.ct.startsWith("image/") ? got.ct : "image/jpeg";
      pages.push({ bytes: got.buf, contentType: ict });
      await new Promise(rs => setTimeout(rs, 80));
    }

    if (pages.length === 0) {
      console.error(`[pipnet brochure] ${reqId}: all image downloads failed`);
      return null;
    }

    const pdfBytes = await imagesToPdf(pages);
    if (!pdfBytes) return null;
    const key = `landlord-packs/${slug}-${randomBytes(4).toString("hex")}.pdf`;
    await saveFile(key, pdfBytes, "application/pdf", fileName);
    return { url: `/api/crm/landlord-packs/${key.split("/").pop()}`, name: `${packName} (${pages.length} pages)`, pages: pages.length, buffer: pdfBytes };
  } catch (e: any) {
    console.error(`[pipnet brochure] ${reqId}: ${e?.message}`);
    return null;
  }
}

// Stitch an array of image buffers into one PDF, sized to each image. Uses
// pdf-lib's JPEG/PNG embedders directly — no rasterising, so resolution is
// preserved at the cost of a slightly larger file.
async function imagesToPdf(pages: { bytes: Buffer; contentType: string }[]): Promise<Buffer | null> {
  if (pages.length === 0) return null;
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const p of pages) {
    try {
      const img = p.contentType.includes("png")
        ? await pdf.embedPng(p.bytes)
        : await pdf.embedJpg(p.bytes);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } catch (e: any) {
      console.error(`[pipnet brochure] PDF embed failed: ${e?.message}`);
    }
  }
  if (pdf.getPageCount() === 0) return null;
  return Buffer.from(await pdf.save());
}

// Cross-source brand-name dedup. The same agent often registers a brand on
// both PIPnet and TRL under slightly different strings — collapse them.
function normaliseBrandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(ltd|limited|plc|llp|inc|co|company|group|holdings|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

  // Reuse the cookie the search just established — do NOT call login() here.
  // login() pings reqSearch.jsp to validate the session, and that hit wipes
  // PIPnet's server-side result set, making every subsequent reqdetails fetch
  // return the "unexpected error" page (no fields, no brochure link). That was
  // the real reason Use class / tenure / email / brochure all came back empty.
  const cookie = sessionCookie;
  if (!cookie) throw new Error("PIPnet session missing after search");

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

    // Download the "View All Images" brochure (the landlord pack — flyer plus
    // photos) and stitch into a single PDF hosted by BGP. Falls back to the
    // raw PIPnet URL on failure so the link still works (with PIPnet login).
    let brochurePack: { url: string; name: string; pages: number; buffer?: Buffer } | null = null;
    if (detail.landlordPackUrl && detail.requirementId) {
      brochurePack = await downloadBrochureAsPdf(detail.landlordPackUrl, cookie, detail.requirementId, companyName);
      if (!brochurePack) {
        console.warn(`[pipnet import] brochure download returned null for ${companyName} (${detail.requirementId}): ${detail.landlordPackUrl}`);
      }
    } else if (!detail.landlordPackUrl) {
      console.warn(`[pipnet import] no landlordPackUrl detected for ${companyName} — Use/Type/Comments will be empty unless cached`);
    }

    // Run Claude vision over the brochure pages to extract structured fields.
    // PIPnet's tabular metadata is sparse + often wrong — the brochure images
    // contain the real requirement (size, use class, target locations, format).
    let visionParse: Awaited<ReturnType<typeof parseRequirementBrochure>> = null;
    if (brochurePack?.buffer) {
      try {
        visionParse = await parseRequirementBrochure({ pdfBuffer: brochurePack.buffer });
        if (visionParse) {
          console.log(`[pipnet import] vision parse for ${companyName} (${visionParse.confidence}): size=${visionParse.sizeRange}, locations=${visionParse.locations?.length || 0}`);
        }
      } catch (e: any) {
        console.warn(`[pipnet import] vision parse failed for ${companyName}: ${e?.message}`);
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

    // If fresh vision didn't run (no brochure link / download failed / parse
    // returned null) but we have a cached vision parse from a prior sync, reuse
    // it. Saves the Claude call AND keeps Use / Type / Comments populated when
    // PIPnet's HTML occasionally drops the brochure link.
    if (!visionParse && existing.length > 0) {
      const cached = (existing[0].rawData as any)?._visionParse;
      if (cached && cached.confidence && cached.confidence !== "low") {
        visionParse = cached;
        console.log(`[pipnet import] reusing cached vision parse for ${companyName} (${cached.confidence})`);
      }
    }

    // Similarly, if we couldn't get a fresh brochure pack this run but the
    // previous sync stored one, keep the cached URL so the Landlord Pack
    // column still has a clickable link.
    if (!brochurePack && existing.length > 0) {
      const cachedPack = (existing[0].rawData as any)?._brochurePack;
      if (cachedPack?.url) {
        brochurePack = cachedPack;
        console.log(`[pipnet import] reusing cached brochure pack for ${companyName}`);
      }
    }

    const contactName = (detail.contactName || listContactName || "").trim();
    const useClass = detail.useClass || "";

    const record: any = {
      source: "PIPnet" as const,
      sourceId,
      companyName,
      contactName: contactName || null,
      contactPhone: detail.telephone || row["Tel. No"] || row["Phone"] || row["Telephone"] || row["Tel"] || null,
      contactEmail: detail.email || row["Email"] || row["E-Mail"] || row["E-mail"] || null,
      tenure: detail.tenure || row["Tenure"] || null,
      sizeRange: sizeRange || null,
      useClass: useClass || null,
      locations: null as string[] | null, // PIPnet does not expose wanted locations — team fills manually.
      lastUpdated: detail.documentDate || docDate || null,
      description: [detail.comments, agentCompany ? `Acting agent: ${agentCompany}` : null].filter(Boolean).join("\n\n") || null,
      status: row["Status"] || "active",
      rawData: {
        ...row,
        _agentCompany: agentCompany,
        _detail: detail,
        _landlordPackUrl: detail.landlordPackUrl || null,
        _brochurePack: brochurePack ? { url: brochurePack.url, name: brochurePack.name, pages: brochurePack.pages } : null,
        _mobile: detail.mobile || null,
        _address: { line1: detail.address1, line2: detail.address2, town: detail.town, county: detail.county, postCode: detail.postCode },
        _visionParse: visionParse,
      } as any,
      updatedAt: new Date(),
    };

    // Merge vision-extracted fields into the record. Vision wins on empty
    // fields, AND wins entirely when confidence === "high".
    if (visionParse) {
      mergeVisionIntoRecord(record, visionParse);
    }

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

    // Always run promote — for new rows it creates the CRM requirement, for
    // already-converted rows it RE-ENRICHES (fills empty columns from the
    // vision parse and refreshes the landlord pack). Without this, rows
    // converted by an earlier sync never pick up newly-extracted Use / Type /
    // locations or the freshly-downloaded clean brochure.
    if (autoPromote) {
      const created = await promoteToCrmRequirement(externalId, record);
      if (created) promoted++;
    }
  }

  return { imported, promoted, skippedOld, total: results.length, pages: Math.ceil(results.length / 20) };
}

// Coarse fallback when the vision parse didn't run (no brochure / parse failed).
// Maps PIPnet's raw planning-class string ("A1,A3,SG,E") onto BGP's Use options.
// Vision parse gives a far better classification — this is only a safety net so
// the Use column isn't completely empty.
function mapPlanningClassToBgpUse(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  const tokens = raw.toUpperCase().split(/[,;|\s]+/).filter(Boolean);
  for (const t of tokens) {
    if (t === "A1" || t.startsWith("E(A)") || t === "RETAIL") out.add("Retail");
    else if (t.match(/^A[3-5]$/) || t.startsWith("E(B)")) out.add("Restaurant");
    else if (t === "D2" || t.startsWith("E(D)")) out.add("Leisure");
    else if (t === "SG" || t.startsWith("SUI")) out.add("Other");
  }
  return Array.from(out);
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
  const brochurePack: { url: string; name: string; pages: number } | null = item.rawData?._brochurePack || null;
  const mobile: string | null = item.rawData?._mobile || null;
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

    // Use + Type + Comments come from the vision parse (Claude reads the
    // brochure pages and maps onto BGP's categorical options). Fall back to
    // a coarse planning-class map only when vision didn't run.
    const visionParse: any = item.rawData?._visionParse || null;
    const useArray: string[] | null = (visionParse?.useCategories?.length
      ? visionParse.useCategories
      : mapPlanningClassToBgpUse(item.useClass)) || null;
    const requirementType: string[] | null = visionParse?.typeCategory ? [visionParse.typeCategory] : null;
    const aiSummary: string | null = visionParse?.summary || null;

    // Prefer the BGP-hosted PDF (no PIPnet login required). Fall back to the
    // raw PIPnet URL only if the download/stitch failed, so the link still
    // works for anyone logged into PIPnet in the same browser.
    const landlordPackJson = brochurePack
      ? JSON.stringify({ url: brochurePack.url, name: brochurePack.name, pages: brochurePack.pages })
      : landlordPackUrl
      ? JSON.stringify({ url: landlordPackUrl, name: "PIPnet brochure (PIPnet-hosted)" })
      : null;

    const requirementDate = parseUkDate(item.lastUpdated || "");
    const requirementDateIso = requirementDate ? requirementDate.toISOString().slice(0, 10) : null;

    // Skip if a leasing requirement for this client already exists. Match by
    // normalised name so "Pret", "Pret A Manger", "Pret A Manger Ltd" — and
    // the same brand seen via TRL — all collapse to a single CRM row.
    const normalisedTarget = normaliseBrandName(item.companyName);
    const candidateReqs = await tx
      .select()
      .from(crmRequirementsLeasing);
    const existingReq = candidateReqs.find(r => normaliseBrandName(r.name) === normalisedTarget);
    if (existingReq) {
      // Enrich: fill any empty field on the existing row with PIPnet data,
      // leave non-empty fields untouched (don't trample manual edits).
      const updates: Record<string, any> = {};
      if (!existingReq.agentContactId && agentContactId) updates.agentContactId = agentContactId;
      if ((!existingReq.use || existingReq.use.length === 0) && useArray && useArray.length > 0) updates.use = useArray;
      if ((!existingReq.requirementType || existingReq.requirementType.length === 0) && requirementType) updates.requirementType = requirementType;
      if ((!existingReq.size || existingReq.size.length === 0) && item.sizeRange) updates.size = [item.sizeRange];
      if ((!existingReq.requirementLocations || existingReq.requirementLocations.length === 0) && item.locations && item.locations.length > 0) {
        updates.requirementLocations = item.locations;
      }
      // Refresh the landlord pack: a freshly-downloaded clean brochure this run
      // (brochurePack) replaces any stale/mangled pack from an earlier sync;
      // otherwise just fill it if empty.
      if (brochurePack && landlordPackJson) updates.landlordPack = landlordPackJson;
      else if (!existingReq.landlordPack && landlordPackJson) updates.landlordPack = landlordPackJson;
      if (!existingReq.requirementDate && requirementDateIso) updates.requirementDate = requirementDateIso;
      if ((!existingReq.comments || !existingReq.comments.trim()) && aiSummary) updates.comments = aiSummary;
      // Append "PIPnet" to the sources array if not already there.
      const existingSources = existingReq.sources ?? [];
      if (!existingSources.includes("PIPnet")) {
        updates.sources = [...existingSources, "PIPnet"];
      }
      if (Object.keys(updates).length > 0) {
        await tx.update(crmRequirementsLeasing).set(updates).where(eq(crmRequirementsLeasing.id, existingReq.id));
      }
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
      requirementDate: requirementDateIso,
      use: useArray && useArray.length > 0 ? useArray : null,
      requirementType,
      size: item.sizeRange ? [item.sizeRange] : null,
      requirementLocations: item.locations,
      landlordPack: landlordPackJson,
      sources: ["PIPnet"],
      comments: aiSummary,
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
  bounced?: boolean;
  fields: Record<string, string>;
  htmlPreview: string;
  htmlLength: number;
  variants?: any;
  brochure?: {
    url: string;
    contentType: string;
    bytes: number;
    isHtml: boolean;
    htmlPreview?: string;
    imageUrls?: string[];
  } | null;
}> {
  // Diagnostic: log in ONCE, run the search inline (so the result set is held
  // in this session), then fetch the detail page in the SAME session with NO
  // intervening login()/reqSearch.jsp call — the production importer re-logs-in
  // between search and detail, and that reqSearch.jsp hit appears to reset the
  // server-side result context that reqdetails.jsp?index=N depends on, making
  // every detail return PIPnet's "unexpected error" page. We test two fetch
  // strategies so we know which one to use in the importer.
  resetSession();
  const cookie = await login();
  const searchBody = new URLSearchParams({
    requirementType: "ReqRetail", locationSearchEdit: "", locationListBox: "",
    status: "Latest", documentDate: "", extrapolated: "True",
    clientSearchEdit: "", clientListBox: "", minSalesArea: "", maxSalesArea: "", Search: "Search",
  });
  const listRes = await pipFetch(`${PIPNET_URL}/reqfetch.jsp`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: searchBody.toString(),
  });
  const listHtml = await listRes.text();
  const rows = parseHtmlTable(listHtml);
  const detailHref = rows.map(r => r._detailHref).find(Boolean) || null;
  const candidateLinks = rows.map(r => r._detailHref).filter(Boolean).slice(0, 20) as string[];

  if (!detailHref) {
    return { candidateLinks, detailUrl: null, fields: {}, htmlPreview: listHtml.slice(0, 900), htmlLength: listHtml.length };
  }

  const folderId = detailHref.match(/folderid=(\d+)/i)?.[1] || null;
  const detailUrl = detailHref.startsWith("http") ? detailHref : `${PIPNET_URL}/${detailHref.replace(/^\//, "")}`;
  const isErr = (h: string) => /unexpected error has occ/i.test(h);

  // Strategy A: the row's link as-is (index=N&folderid=X), fetched immediately.
  const resA = await pipFetch(detailUrl, { headers: { Cookie: cookie } });
  const htmlA = await resA.text();
  // Strategy B: folderid only (no session-positional index). Re-run the search
  // first so the session context is fresh for this attempt.
  await pipFetch(`${PIPNET_URL}/reqfetch.jsp`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: searchBody.toString(),
  });
  const urlB = folderId ? `${PIPNET_URL}/reqdetails.jsp?folderid=${folderId}` : detailUrl;
  const resB = await pipFetch(urlB, { headers: { Cookie: cookie } });
  const htmlB = await resB.text();

  const countFields = (h: string) => [...h.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)].length;
  const variants = {
    A_indexAndFolder: { url: detailUrl, status: resA.status, htmlLength: htmlA.length, isError: isErr(htmlA), thtdPairs: countFields(htmlA) },
    B_folderOnly: { url: urlB, status: resB.status, htmlLength: htmlB.length, isError: isErr(htmlB), thtdPairs: countFields(htmlB) },
  };

  // Use whichever strategy produced a real page for the field/brochure dump.
  const detailHtml = !isErr(htmlA) && htmlA.length > 1500 ? htmlA : (!isErr(htmlB) ? htmlB : htmlA);
  const bounced = looksUnauthenticated(detailHtml);

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
    candidateLinks,
    detailUrl,
    bounced,
    variants,
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

// Diagnostic: dump PIPnet's PROPERTY search form so we can see the real input
// names + endpoint (they differ from the requirements form, which is why the
// property search returns 0 rows). Also fires the current detailsfetch.jsp
// params and reports whether they yield a result table, an error, or the form.
export async function inspectPipnetPropertySearch(): Promise<any> {
  resetSession();
  const cookie = await login();
  const out: any = { formPages: [], detailsfetch: null };

  // First, crawl the main menu pages and collect every link (with its anchor
  // text) so we can FIND the property / available-space search page rather than
  // guess its filename. PIPnet's logo links to index.jsp.
  out.menuLinks = [];
  const fetchForms = async (page: string) => {
    const r = await pipFetch(page.startsWith("http") ? page : `${PIPNET_URL}/${page.replace(/^\//, "")}`, { headers: { Cookie: cookie } });
    if (!r.ok) return { status: r.status };
    const html = await r.text();
    const forms = [...html.matchAll(/<form[^>]*?action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/gi)].map(m => ({
      action: m[1],
      inputs: Array.from(new Set([...m[2].matchAll(/<(?:input|select|textarea)[^>]*?name="([^"]+)"/gi)].map(x => x[1]))),
    }));
    return { status: 200, htmlLength: html.length, forms };
  };
  for (const menu of ["choice.jsp", "watchresults.jsp", "index.jsp", "menu.jsp"]) {
    try {
      const r = await pipFetch(`${PIPNET_URL}/${menu}`, { headers: { Cookie: cookie } });
      if (!r.ok) { out.menuLinks.push({ menu, status: r.status }); continue; }
      const html = await r.text();
      const links = [...html.matchAll(/<a[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
        .map(m => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))
        .filter(l => !/^(#|javascript:|mailto:)/i.test(l.href));
      const jspRefs = Array.from(new Set([...html.matchAll(/\b([a-zA-Z][\w]*\.(?:jsp|htm))\b/g)].map(m => m[1])));
      const interesting = links.filter(l => /detail|propert|space|available|avail|search|retail/i.test(l.href + " " + l.text));
      // Follow each interesting link one level deep to capture its form inputs.
      const followed: any[] = [];
      for (const l of interesting.slice(0, 8)) {
        try { followed.push({ link: l, ...(await fetchForms(l.href)) }); } catch (e: any) { followed.push({ link: l, error: e?.message }); }
      }
      out.menuLinks.push({ menu, status: 200, htmlLength: html.length, jspRefs, interesting, allLinks: links.slice(0, 40), followed });
    } catch (e: any) { out.menuLinks.push({ menu, error: e?.message }); }
  }

  // Candidate property search pages (parallel to reqsearchretailtabbed.htm).
  const candidates = [
    "detailsearchretailtabbed.htm",
    "detailsearchtabbed.htm",
    "detailsearch.htm",
    "detailsearch.jsp",
    "propsearchretailtabbed.htm",
    "reqsearchretailtabbed.htm", // tabbed page may host BOTH req + property forms
  ];
  for (const page of candidates) {
    try {
      const r = await pipFetch(`${PIPNET_URL}/${page}`, { headers: { Cookie: cookie } });
      if (!r.ok) { out.formPages.push({ page, status: r.status }); continue; }
      const html = await r.text();
      const forms = [...html.matchAll(/<form[^>]*?action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/gi)].map(m => ({
        action: m[1],
        inputs: Array.from(new Set([...m[2].matchAll(/<(?:input|select|textarea)[^>]*?name="([^"]+)"/gi)].map(x => x[1]))),
        selectOptions: [...m[2].matchAll(/<select[^>]*?name="([^"]+)"[\s\S]*?<\/select>/gi)].slice(0, 6).map(s => ({
          name: s[0].match(/name="([^"]+)"/)?.[1],
          options: [...s[0].matchAll(/<option[^>]*?value="([^"]*)"[^>]*>([^<]*)</gi)].slice(0, 12).map(o => `${o[1]}=${o[2].trim()}`),
        })),
      }));
      const allNames = Array.from(new Set([...html.matchAll(/<(?:input|select|textarea)[^>]*?name="([^"]+)"/gi)].map(x => x[1])));
      // Tabs/nav links — these point to the sibling search pages (e.g. property
      // / available-space search). Capture href + text, and any onclick targets.
      const links = [...html.matchAll(/<a[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
        .map(m => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))
        .filter(l => !/^(#|javascript:void|mailto:)/i.test(l.href));
      const onclicks = [...html.matchAll(/(?:onclick|location(?:\.href)?\s*=)\s*["']?([^"'<>]*\.(?:jsp|htm)[^"'<>]*)/gi)].map(m => m[1]);
      const jspRefs = Array.from(new Set([...html.matchAll(/\b([a-zA-Z][\w]*\.jsp)\b/g)].map(m => m[1])));
      out.formPages.push({ page, status: 200, htmlLength: html.length, forms, allNames, links: links.slice(0, 60), onclicks: Array.from(new Set(onclicks)).slice(0, 40), jspRefs });
    } catch (e: any) { out.formPages.push({ page, error: e?.message }); }
  }

  // What does the CURRENT property search params return?
  const body = new URLSearchParams({
    propertyType: "PropRetail", locationSearchEdit: "", locationListBox: "London",
    status: "Available", documentDate: "", extrapolated: "True", addressSearchEdit: "",
    minSalesArea: "", maxSalesArea: "", Search: "Search",
  });
  try {
    const dr = await pipFetch(`${PIPNET_URL}/detailsfetch.jsp`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: body.toString(),
    });
    const dhtml = await dr.text();
    const firstRow = dhtml.match(/<table class="results?Table"[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>/i);
    out.detailsfetch = {
      status: dr.status,
      htmlLength: dhtml.length,
      hasResultTable: /class="results?Table"/i.test(dhtml),
      isError: /unexpected error/i.test(dhtml),
      looksLikeForm: /detailsearchretailtabbed|propertyType|addressSearchEdit/i.test(dhtml) && !/class="results?Table"/i.test(dhtml),
      firstRowCells: firstRow ? firstRow[1].replace(/<[^>]+>/g, "|").replace(/\s+/g, " ").slice(0, 300) : null,
      preview: dhtml.slice(0, 600),
    };
  } catch (e: any) { out.detailsfetch = { error: e?.message }; }

  // Run the REWRITTEN searchPipnetProperties end-to-end and report the rows it
  // gets, so we can confirm the new form-replay actually returns listings.
  let firstHref: string | null = null;
  try {
    const rows = await searchPipnetProperties({});
    firstHref = rows.map(r => r._detailHref).find(Boolean) || null;
    out.liveSearch = {
      rows: rows.length,
      columns: rows.length ? Array.from(new Set(rows.flatMap(r => Object.keys(r)))) : [],
      sample: rows.slice(0, 3),
    };
  } catch (e: any) { out.liveSearch = { error: e?.message }; }

  // CLEAN detail test: fresh session → property search → fetch the first
  // listing's detail IMMEDIATELY in the same session (no intervening fetches),
  // exactly as the importer will. Try the href as-is (index+folderid) and
  // folderid-only. This avoids the session-expiry artifact from all the
  // exploratory fetches above.
  try {
    resetSession();
    const rows = await searchPipnetProperties({});
    const href = rows.map(r => r._detailHref).find(Boolean) || null;
    const cookie2 = sessionCookie || cookie;
    const folderId = href?.match(/folderid=(\d+)/i)?.[1] || null;
    const clean = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const probe = async (label: string, u: string) => {
      const r = await pipFetch(u, { headers: { Cookie: cookie2 } });
      const html = await r.text();
      const isLogin = /Please provide your account information|name="password"/i.test(html);
      const fields: Record<string, string> = {};
      for (const m of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) { const k=clean(m[1]),v=clean(m[2]); if(k&&v&&k.length<60)fields[k]=v; }
      for (const m of html.matchAll(/<td[^>]*>\s*([^<:]{2,40}):\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) { const k=clean(m[1]),v=clean(m[2]); if(k&&v&&!(k in fields))fields[k]=v; }
      const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1])).filter(Boolean);
      const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ href: m[1], text: clean(m[2]) }));
      const broch = links.find(l => /image|brochure|pdf|pack|view all/i.test(l.href + " " + l.text));
      return { label, url: u, status: r.status, isLogin, isError: /unexpected error/i.test(html), htmlLength: html.length, fields, cells, links, brochure: broch || null, fullHtml: html.slice(0, 4000) };
    };
    out.cleanDetail = { firstHref: href };
    if (href) {
      const urlA = href.startsWith("http") ? href : `${PIPNET_URL}/${href.replace(/^\//, "")}`;
      out.cleanDetail.A_asIs = await probe("as-is (index+folderid)", urlA);
      if (folderId) out.cleanDetail.B_folderOnly = await probe("folderid-only", `${PIPNET_URL}/detailsdetails.jsp?folderid=${folderId}`);
    }
  } catch (e: any) { out.cleanDetail = { error: e?.message }; }

  return out;
}
