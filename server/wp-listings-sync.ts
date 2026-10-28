// Keeps the Listings on brucegillinghampollard.com (the WordPress site that
// stays live until bgp.uk.com launches) in step with the leasing tracker.
//
// Source: this app's own public feed, /api/public/leasing-listings — the same
// rows and publish gate the new site reads, so a unit goes live on both sites
// under one rule. Target: the WordPress `listings` post type, written through
// the BGP Tracker Bridge plugin (wp-content/plugins/bgp-tracker-bridge):
// posts + media via the core REST API, ACF values via /wp-json/bgp/v1/acf/<id>.
//
// Each synced post carries meta bgp_unit_id = tracker unit id. Posts without
// that meta are the team's hand-made listings and are never touched unless
// an admin runs the sync with retireLegacy, which drafts them.
//
// Env (Railway): BGP_WP_APP_PASSWORD (WordPress application password,
// required — sync is idle without it), BGP_WP_USER (default CaraMilligan),
// BGP_WP_URL (default https://www.brucegillinghampollard.com),
// PUBLIC_APP_URL (default https://chatbgp.app, where the feed is read from).
// The host drops roughly one connection in three, so every call retries.
import { Router } from "express";
import { createHash } from "node:crypto";
import { requireAdmin, requireAuth } from "./auth";

const WP_URL = (process.env.BGP_WP_URL || "https://www.brucegillinghampollard.com").replace(/\/$/, "");
const WP_USER = process.env.BGP_WP_USER || "CaraMilligan";
const WP_PASS = process.env.BGP_WP_APP_PASSWORD || "";
const FEED_URL = (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/$/, "");
const INTERVAL_MS = 60 * 60 * 1000;

// ACF field keys on the `listings` post type (Custom Fields → the nine groups).
const F = {
  size: "field_620fae4920ca8",
  location: "field_620f893638c92",
  emailAgent: "field_6213befed90bf",
  whatsappAgent: "field_6213bf09d90c0",
  description: "field_620c1b12dde1e",
  imageOne: "field_620c1b2edde1f",
  imageTwo: "field_620c1b41dde20",
  details: "field_620f885a990e5",
  informationList: "field_620f8865990e6",
  infoType: "field_620f8876990e7",
  infoDetail: "field_620f8896990e8",
  floorplan: "field_6214f020af339",
  brochure: "field_6214f06176b4b",
  gallery: "field_621524961f8df",
  image: "field_620c15336f0e2",
};

interface FeedFile { id: string; fileName: string; mimeType: string | null; category?: string | null }
interface FeedListing {
  id: string; unitName: string | null; propertyName: string | null; floor: string | null; sqft: number | null;
  askingRent: number | null; rentPoa: boolean | null; ratesPa: number | null; serviceChargePa: number | null;
  useClass: string | null; condition: string | null; availableDate: string | null; leaseTerms: string | null;
  marketingStatus: string | null; location: string | null; epcRating: string | null; assetClass: string | null;
  addressLine: string | null; postcode: string | null; latitude: string | null; longitude: string | null;
  files: FeedFile[]; agents: Array<{ name: string; email: string | null; phone: string | null }>;
}

export interface SyncResult {
  at: string; ok: boolean; error?: string; feed: number; created: number; updated: number; unchanged: number;
  retired: number; legacyRetired: number; uploaded: number; failures: string[]; durationMs: number;
}

let lastResult: SyncResult | null = null;
let running: Promise<SyncResult> | null = null;
let timer: NodeJS.Timeout | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const authHeader = () => "Basic " + Buffer.from(`${WP_USER}:${WP_PASS}`).toString("base64");

async function wp<T = any>(path: string, init: { method?: string; json?: unknown; body?: Buffer; headers?: Record<string, string>; attempts?: number } = {}): Promise<T> {
  const { method = "GET", json, body, headers = {}, attempts = 8 } = init;
  let last: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${WP_URL}/wp-json/${path}`, {
        method,
        headers: { Authorization: authHeader(), ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        body: json !== undefined ? JSON.stringify(json) : body,
        signal: AbortSignal.timeout(120_000),
      });
      const text = await r.text();
      if (r.status >= 500 && i < attempts - 1) { last = new Error(`WordPress ${r.status}: ${text.slice(0, 200)}`); await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`WordPress ${r.status} ${method} ${path}: ${text.slice(0, 300)}`);
      return (text ? JSON.parse(text) : null) as T;
    } catch (e: any) {
      if (/^WordPress [45]\d\d/.test(e?.message || "")) throw e;
      last = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

async function fetchFeed<T>(path: string, attempts = 4): Promise<T> {
  let last: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${FEED_URL}${path}`, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`feed ${r.status} ${path}`);
      return (await r.json()) as T;
    } catch (e) { last = e; await sleep(1000 * (i + 1)); }
  }
  throw last;
}

async function fetchFeedBytes(path: string): Promise<{ buf: Buffer; mime: string } | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`${FEED_URL}${path}`, { signal: AbortSignal.timeout(120_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`feed ${r.status}`);
      return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "application/octet-stream" };
    } catch { await sleep(1000 * (i + 1)); }
  }
  return null;
}

const gbp = (n: number | null | undefined) => (n == null ? null : `£${Math.round(n).toLocaleString("en-GB")}`);
const sqftText = (n: number | null | undefined) => (n == null ? "" : `${Math.round(n).toLocaleString("en-GB")} sq ft`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (lines: Array<string | null | undefined>) => lines.filter((l): l is string => !!l && !!l.trim()).map((l) => `<p>${esc(l.trim())}</p>`).join("\n");

// Same naming rule as the new site's listing cards: an address-shaped
// property name leads, otherwise the unit name does.
const ADDRESS_NAME_RE = /^\d|\b(street|st|road|rd|lane|square|place|row|way|avenue|court|yard|walk|arcade|parade)\b/i;
function titleFor(l: FeedListing): string {
  const unit = (l.unitName || "").trim();
  const prop = (l.propertyName || "").trim();
  if (!prop || prop === unit) return unit || prop || "Listing";
  return ADDRESS_NAME_RE.test(prop) ? `${prop}${unit ? `, ${unit}` : ""}` : `${unit}, ${prop}`;
}

// Media uploads are named after the tracker file id so a re-run finds the
// existing attachment instead of uploading it again.
const mediaCache = new Map<string, number>();
async function ensureMedia(f: FeedFile, title: string, stats: SyncResult): Promise<number | null> {
  if (mediaCache.has(f.id)) return mediaCache.get(f.id)!;
  const ext = (f.fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1] || ((f.mimeType || "").includes("pdf") ? "pdf" : "jpg")).toLowerCase();
  const slug = `bgp-unit-${f.id}`;
  // Exact slug lookup: the title is changed after upload, so a text search
  // would not find it again.
  const found = await wp<any[]>(`wp/v2/media?slug=${encodeURIComponent(slug)}&_fields=id,slug`);
  const hit = found.find((m) => m.slug === slug);
  if (hit) { mediaCache.set(f.id, hit.id); return hit.id; }
  const bytes = await fetchFeedBytes(`/api/public/unit-files/${encodeURIComponent(f.id)}`);
  if (!bytes) return null;
  const m = await wp<any>("wp/v2/media", {
    method: "POST", body: bytes.buf,
    headers: { "Content-Type": f.mimeType || bytes.mime, "Content-Disposition": `attachment; filename="${slug}.${ext}"` },
    attempts: 4,
  });
  await wp(`wp/v2/media/${m.id}`, { method: "POST", json: { title, alt_text: title } }).catch(() => {});
  mediaCache.set(f.id, m.id);
  stats.uploaded++;
  return m.id;
}

const termCache = new Map<string, number>();
async function ensureLocationTerm(name: string | null): Promise<number | null> {
  const n = (name || "").trim();
  if (!n) return null;
  // "London W12" and the like file under London; towns match by name.
  const wanted = /^london\b/i.test(n) ? "London" : n;
  const key = wanted.toLowerCase();
  if (termCache.has(key)) return termCache.get(key)!;
  const found = await wp<any[]>(`wp/v2/location?search=${encodeURIComponent(wanted)}&per_page=20&_fields=id,name`);
  let hit = found.find((t) => t.name.toLowerCase() === key);
  if (!hit) hit = await wp<any>("wp/v2/location", { method: "POST", json: { name: wanted } }).catch(async (e: any) => {
    const m = String(e?.message || "").match(/"term_id":(\d+)/); // term_exists carries the id
    return m ? { id: Number(m[1]) } : null;
  });
  if (!hit) return null;
  termCache.set(key, hit.id);
  return hit.id;
}

function acfFor(l: FeedListing, photoIds: number[], brochureId: number | null, floorplanId: number | null) {
  const agent = l.agents[0] || null;
  const rent = l.rentPoa ? "On application." : l.askingRent != null ? `${gbp(l.askingRent)} per annum exclusive.` : "On application.";
  const info: Array<[string, string]> = [
    ["Accommodation", [sqftText(l.sqft), l.floor ? `arranged over ${l.floor}` : null, l.condition].filter(Boolean).join(", ") + "."],
    ["Tenure", (l.leaseTerms || "A new lease on terms to be agreed.").trim()],
    ["Rent", rent],
    ["Service Charge", l.serviceChargePa != null ? `${gbp(l.serviceChargePa)} per annum.` : "Details are available on request."],
    ["Rates Payable", l.ratesPa != null ? `${gbp(l.ratesPa)} per annum. Interested parties are advised to make their own enquiries with the Local Authority.` : "Interested parties are advised to make their own enquiries with the Local Authority."],
    ["Use", l.useClass ? `${l.useClass}.` : "Class E."],
    ["Availability", l.availableDate || "Immediately."],
    ["EPC", l.epcRating ? `Rating ${l.epcRating}.` : "Available on request."],
    ["Costs", "Each party to be responsible for their own legal and all other professional costs."],
  ];
  const lat = l.latitude != null ? Number(l.latitude) : null;
  const lng = l.longitude != null ? Number(l.longitude) : null;
  return {
    [F.size]: sqftText(l.sqft),
    [F.location]: {
      address: [l.addressLine, l.postcode && !(l.addressLine || "").includes(l.postcode) ? l.postcode : null].filter(Boolean).join(", "),
      lat: Number.isFinite(lat) ? lat : "", lng: Number.isFinite(lng) ? lng : "", zoom: 14,
      post_code: l.postcode || "", country: "United Kingdom", country_short: "GB",
    },
    [F.emailAgent]: agent?.email || "",
    [F.whatsappAgent]: agent?.phone || "",
    [F.description]: paras([
      `${titleFor(l)}${l.location ? `, ${l.location}` : ""}.`,
      [sqftText(l.sqft), l.rentPoa ? "rent on application" : l.askingRent != null ? `${gbp(l.askingRent)} per annum` : null].filter(Boolean).join(", "),
      l.leaseTerms,
      l.condition,
    ]),
    // Same slots the hand-made listings use: featured image is the hero,
    // two photos sit beside the description, the rest make the gallery.
    [F.imageOne]: photoIds[1] ? String(photoIds[1]) : "",
    [F.imageTwo]: photoIds[2] ? String(photoIds[2]) : "",
    [F.details]: "",
    [F.informationList]: info.map(([t, d]) => ({ [F.infoType]: t, [F.infoDetail]: d })),
    [F.floorplan]: floorplanId ? String(floorplanId) : "",
    [F.brochure]: brochureId ? String(brochureId) : "",
    [F.gallery]: photoIds.slice(3).map(String),
    [F.image]: "",
  };
}

export async function runWpListingsSync(opts: { retireLegacy?: boolean } = {}): Promise<SyncResult> {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    const stats: SyncResult = { at: new Date().toISOString(), ok: false, feed: 0, created: 0, updated: 0, unchanged: 0, retired: 0, legacyRetired: 0, uploaded: 0, failures: [], durationMs: 0 };
    try {
      if (!WP_PASS) throw new Error("BGP_WP_APP_PASSWORD is not set");
      const feed = await fetchFeed<FeedListing[]>("/api/public/leasing-listings");
      stats.feed = feed.length;
      const existing = await wp<any[]>("bgp/v1/acf-bulk/listings?status=publish,draft,pending,private");
      const byUnit = new Map<string, any>();
      for (const p of existing) if (p.meta?.bgp_unit_id) byUnit.set(String(p.meta.bgp_unit_id), p);

      for (const l of feed) {
        try {
          const title = titleFor(l);
          const photos = l.files.filter((f) => (f.mimeType || "").startsWith("image/") || f.category === "photo");
          const brochure = l.files.find((f) => f.category === "brochure" && (f.mimeType || "").includes("pdf")) || l.files.find((f) => (f.mimeType || "").includes("pdf"));
          const floorplan = l.files.find((f) => f.category === "floorplan");
          const photoIds: number[] = [];
          for (const f of photos.slice(0, 12)) { const id = await ensureMedia(f, title, stats); if (id) photoIds.push(id); }
          const brochureId = brochure ? await ensureMedia(brochure, `${title} brochure`, stats) : null;
          const floorplanId = floorplan && floorplan !== brochure ? await ensureMedia(floorplan, `${title} floorplan`, stats) : null;
          const termId = await ensureLocationTerm(l.location);
          const acf = acfFor(l, photoIds, brochureId, floorplanId);
          // A hash, not the JSON itself: WordPress unslashes meta on save, so a
          // literal "\n" in stored JSON would never compare equal again.
          const signature = createHash("sha1").update(JSON.stringify({ title, acf, termId, status: l.marketingStatus })).digest("hex");
          const prev = byUnit.get(l.id);
          const postBody: any = {
            title, status: "publish",
            featured_media: photoIds[0] || 0,
            location: termId ? [termId] : [],
          };
          if (prev && prev.meta?.bgp_signature === signature) { stats.unchanged++; continue; }
          let postId: number;
          if (prev) { postId = prev.id; await wp(`wp/v2/listings/${postId}`, { method: "POST", json: postBody }); }
          else { const created = await wp<any>("wp/v2/listings", { method: "POST", json: postBody }); postId = created.id; }
          // Meta goes through the bridge (plain update_post_meta), so it does
          // not depend on the post type exposing custom fields over REST.
          await wp(`bgp/v1/acf/${postId}`, { method: "POST", json: { fields: acf, meta: { bgp_unit_id: l.id, bgp_synced_at: new Date().toISOString(), bgp_signature: signature } } });
          if (prev) stats.updated++; else stats.created++;
        } catch (e: any) {
          stats.failures.push(`${l.unitName || l.id}: ${e?.message || e}`);
        }
      }

      // Units that left the tracker's public set come off the site.
      const live = new Set(feed.map((l) => l.id));
      for (const [unitId, p] of byUnit) {
        if (live.has(unitId) || p.status === "draft") continue;
        try { await wp(`wp/v2/listings/${p.id}`, { method: "POST", json: { status: "draft" } }); stats.retired++; }
        catch (e: any) { stats.failures.push(`retire ${p.title}: ${e?.message || e}`); }
      }
      if (opts.retireLegacy) {
        for (const p of existing) {
          if (p.meta?.bgp_unit_id || p.status !== "publish") continue;
          try { await wp(`wp/v2/listings/${p.id}`, { method: "POST", json: { status: "draft" } }); stats.legacyRetired++; }
          catch (e: any) { stats.failures.push(`legacy ${p.title}: ${e?.message || e}`); }
        }
      }
      stats.ok = stats.failures.length === 0;
    } catch (e: any) {
      stats.error = e?.message || String(e);
    }
    stats.durationMs = Date.now() - started;
    lastResult = stats;
    const summary = `${stats.feed} in feed, ${stats.created} created, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.retired} retired, ${stats.uploaded} files uploaded`;
    if (stats.error) console.warn(`[wp-listings-sync] failed: ${stats.error}`);
    else console.log(`[wp-listings-sync] ${summary}${stats.failures.length ? `, ${stats.failures.length} failures: ${stats.failures.join(" | ").slice(0, 400)}` : ""} (${Math.round(stats.durationMs / 1000)}s)`);
    return stats;
  })();
  try { return await running; } finally { running = null; }
}

// ── One-off: marry the hand-made WordPress listings to tracker units ───────
// The team's 69 hand-made listings carry ~105 photos and brochures the
// tracker never had. Match each one to a tracker unit by postcode and the
// street number / name in its title, copy the files onto the unit (as if
// uploaded on the Letting Tracker), and report what matched and what did
// not. Dry run by default; `apply` copies files; `retire` then drafts every
// hand-made listing so the site carries only what the tracker publishes.
const TOKEN_RE = /[a-z0-9]+/g;
// Words that never identify a building on their own.
const STOP = new Set("the and of unit units ground floor basement first second level london street st road rd square sq place lane way avenue court row under offer north south east west upper lower new old little great house park centre center shopping gardens garden".split(" "));
// Words dropped before comparing a listing's name with a property's name.
const GENERIC = new Set("the london shopping centre center".split(" "));
const POSTCODE_TOKEN = /^[a-z]{1,2}\d[a-z\d]?$/;
const tokens = (s: string) => (s.toLowerCase().match(TOKEN_RE) || []).filter((t) => !STOP.has(t));
const nameTokens = (s: string) => (s.toLowerCase().match(TOKEN_RE) || []).filter((t) => !GENERIC.has(t) && !POSTCODE_TOKEN.test(t) && !/^\d/.test(t));
const numberTokens = (s: string) => (s.toLowerCase().match(TOKEN_RE) || []).filter((t) => /^\d+[a-z]?$/.test(t)).map((t) => t.replace(/[a-z]$/, ""));
const outward = (s: string) => (s.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/) || [])[1] || null;
const contiguous = (a: string[], b: string[]) => a.length > 0 && a.length <= b.length && b.some((_, i) => a.every((t, j) => b[i + j] === t));
const addressText = (a: any): string => !a ? "" : typeof a === "string" ? a : [a.street, a.city, a.postcode, a.formatted, a.address].filter(Boolean).join(" ");

export interface LegacyMatch { wpId: number; title: string; postcode: string | null; propertyId: string | null; unitId: string | null; unitLabel: string | null; score: number; files: number; copied: number }

// Match each hand-made listing to a tracker PROPERTY by name (scheme-level:
// "Westgate, Oxford" = Westgate Shopping Centre, Oxford) or by street
// number + street name + postcode (building-level). A building-level match,
// or a property with a single unit, copies files onto that UNIT's Files; a
// scheme-level match copies them into the property's image gallery, where
// anyone marketing a unit there can pick them up. Street numbers that
// disagree (82 New Oxford Street vs 102) rule a property out outright.
export async function importLegacyListingPhotos(opts: { apply?: boolean; retire?: boolean } = {}): Promise<{ matched: LegacyMatch[]; unmatched: LegacyMatch[]; copied: number; retired: number }> {
  if (!WP_PASS) throw new Error("BGP_WP_APP_PASSWORD is not set");
  const { db } = await import("./db");
  const { eq, sql } = await import("drizzle-orm");
  const { availableUnits, crmProperties, propertyUnits, unitMarketingFiles } = await import("@shared/schema");
  const { saveFile } = await import("./file-storage");
  const { storeImageFromBuffer } = await import("./image-studio");
  const crypto = await import("node:crypto");
  const pathMod = await import("node:path");

  const units = await db
    .select({
      id: availableUnits.id, unitName: availableUnits.unitName, location: availableUnits.location, propertyId: availableUnits.propertyId,
      unitAddress: propertyUnits.unitAddress, unitPostcode: propertyUnits.unitPostcode,
      propertyName: crmProperties.name, propertyAddress: crmProperties.address, postcode: crmProperties.postcode, landlordId: crmProperties.landlordId,
    })
    .from(availableUnits)
    .leftJoin(crmProperties, eq(availableUnits.propertyId, crmProperties.id))
    .leftJoin(propertyUnits, eq(availableUnits.unitId, propertyUnits.id))
    .where(sql`${availableUnits.marketingStatus} IS NOT NULL`);
  type U = (typeof units)[number];
  const byProperty = new Map<string, U[]>();
  for (const u of units) { if (!u.propertyId) continue; (byProperty.get(u.propertyId) || byProperty.set(u.propertyId, []).get(u.propertyId)!).push(u); }
  const props = Array.from(byProperty.entries()).map(([propertyId, us]) => {
    const u = us[0];
    const addr = addressText(u.propertyAddress);
    const name = u.propertyName || "";
    const unitText = us.map((x) => `${x.unitAddress || ""} ${x.unitName || ""}`).join(" ");
    return {
      propertyId, name, units: us, landlordId: u.landlordId, address: addr,
      pt: nameTokens(name),
      nt: new Set(tokens(`${name} ${addr} ${u.location || ""}`).filter((t) => !/^\d/.test(t) && t.length >= 3)),
      nums: new Set(numberTokens(`${name} ${addr} ${unitText}`)),
      ows: new Set([outward(addr), outward(name), ...us.map((x) => outward(x.unitPostcode || "")), ...us.map((x) => outward(x.unitAddress || ""))].filter(Boolean) as string[]),
    };
  });

  const legacy = (await wp<any[]>("bgp/v1/acf-bulk/listings?status=publish")).filter((p) => !p.meta?.bgp_unit_id);
  const matched: LegacyMatch[] = [], unmatched: LegacyMatch[] = [];
  let copied = 0;
  for (const p of legacy) {
    const f = p.fields || {};
    const loc = f.location && typeof f.location === "object" ? f.location : {};
    const pc = String(loc.post_code || "") || null;
    const title: string = p.title;
    const ow = (pc && outward(pc)) || outward(String(loc.address || "")) || outward(title);
    const lnums = new Set(numberTokens(title.split(",")[0]));
    const lnames = tokens(title).filter((t) => !/^\d/.test(t) && t.length >= 3);
    const lt = nameTokens(title.split(",")[0]).filter((t) => !/^(birmingham|leeds|oxford|cardiff|edinburgh|portsmouth|essex|somerset|guildford|croydon|brixton|mayfair|farringdon|ealing|victoria|hoxton|putney|manchester|sunderland|liverpool|bristol|rochester|reading|albans)$/.test(t));
    let best: { prop: (typeof props)[number]; score: number; scheme: boolean } | null = null;
    for (const prop of props) {
      if (lnums.size && prop.nums.size && ![...lnums].some((n) => prop.nums.has(n))) continue;
      const pt = prop.pt;
      const exact = lt.length > 0 && lt.length === pt.length && lt.every((t, i) => t === pt[i]);
      const scheme = exact || ((contiguous(lt, pt) || contiguous(pt, lt)) && lt.length >= 2 && pt.length >= 2);
      // A property named by its street number ("10 Piccadilly") needs that number in the listing.
      if (scheme && !exact && !lnums.size && numberTokens(prop.name).length) continue;
      const numHit = [...lnums].some((n) => prop.nums.has(n)) && lnames.some((t) => prop.nt.has(t));
      const numOutward = [...lnums].some((n) => prop.nums.has(n)) && !!ow && prop.ows.has(ow);
      if (!(scheme || numHit || numOutward)) continue;
      const score = (exact ? 8 : scheme ? 6 : 0) + (numHit ? 4 : 0) + (numOutward ? 3 : 0) + lnames.filter((t) => prop.nt.has(t)).length + (ow && prop.ows.has(ow) ? 2 : 0);
      if (!best || score > best.score) best = { prop, score, scheme };
    }
    const mediaIds: string[] = Array.from(new Set([p.featured_media, f.image, f.image_one, f.image_two, ...(Array.isArray(f.gallery) ? f.gallery : [])].filter(Boolean).map(String)));
    const files = mediaIds.length + (f.brochure ? 1 : 0);
    if (!best) { unmatched.push({ wpId: p.id, title, postcode: pc, propertyId: null, unitId: null, unitLabel: null, score: 0, files, copied: 0 }); continue; }
    const { prop } = best;
    let unit: U | null = prop.units.length === 1 ? prop.units[0] : null;
    if (!unit && lnums.size) unit = prop.units.find((x) => numberTokens(`${x.unitAddress || ""} ${x.unitName || ""}`).some((n) => lnums.has(n))) || null;
    const row: LegacyMatch = { wpId: p.id, title, postcode: pc, propertyId: prop.propertyId, unitId: unit?.id || null, unitLabel: unit ? `${prop.name} — ${unit.unitName || ""}` : `${prop.name} (property gallery, ${prop.units.length} units)`, score: best.score, files, copied: 0 };
    if (opts.apply) {
      const have = unit ? new Set((await db.select({ n: unitMarketingFiles.fileName }).from(unitMarketingFiles).where(eq(unitMarketingFiles.unitId, unit.id))).map((h) => h.n)) : new Set<string>();
      const pulls: Array<{ mediaId: string; category: "photo" | "brochure" }> = [...mediaIds.map((m) => ({ mediaId: m, category: "photo" as const })), ...(f.brochure ? [{ mediaId: String(f.brochure), category: "brochure" as const }] : [])];
      for (const pull of pulls) {
        try {
          const m = await wp<any>(`wp/v2/media/${pull.mediaId}?_fields=id,source_url,mime_type,title`);
          if (!m?.source_url) continue;
          const ext = pathMod.extname(new URL(m.source_url).pathname).toLowerCase() || (pull.category === "brochure" ? ".pdf" : ".jpg");
          const fileName = `${title.replace(/[^\w\s&'.-]/g, "").trim()} (old site ${m.id})${ext}`;
          if (have.has(fileName)) continue;
          const r = await fetch(m.source_url, { signal: AbortSignal.timeout(120_000) });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          const mime = m.mime_type || "application/octet-stream";
          if (unit) {
            const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
            await saveFile(`marketing-files/${uniqueName}`, buf, mime, fileName);
            await db.insert(unitMarketingFiles).values({ unitId: unit.id, fileName, filePath: `/uploads/marketing-files/${uniqueName}`, fileType: "upload", fileSize: buf.length, mimeType: mime, category: pull.category });
          }
          if (pull.category === "photo") {
            // Image Gallery copy filed under the property (unit-level too, as the tracker upload does).
            await storeImageFromBuffer({
              buffer: buf, fileName, category: "Properties", source: "old-website",
              tags: ["old-website", prop.name, ...(unit?.unitName ? [unit.unitName] : [])].filter(Boolean),
              description: `From the brucegillinghampollard.com listing "${title}"`,
              propertyId: prop.propertyId, companyId: prop.landlordId || null, address: prop.address || undefined, mimeType: mime,
            }).catch((e: any) => console.warn(`[wp-listings-sync] gallery copy failed for ${title}: ${e?.message}`));
          }
          row.copied++; copied++;
        } catch (e: any) {
          console.warn(`[wp-listings-sync] legacy file ${pull.mediaId} for ${title}: ${e?.message}`);
        }
      }
    }
    matched.push(row);
  }
  let retired = 0;
  if (opts.retire) {
    for (const p of legacy) {
      try { await wp(`wp/v2/listings/${p.id}`, { method: "POST", json: { status: "draft" } }); retired++; }
      catch (e: any) { console.warn(`[wp-listings-sync] retire ${p.title}: ${e?.message}`); }
    }
  }
  console.log(`[wp-listings-sync] legacy import: ${matched.length} matched, ${unmatched.length} unmatched, ${copied} files copied, ${retired} retired${opts.apply ? "" : " (dry run)"}`);
  return { matched, unmatched, copied, retired };
}

// Hourly; the first run shortly after boot so a redeploy never leaves the
// old site behind for long. Silent (one log line) when the password is unset.
export function startWpListingsSync(): void {
  if (timer) return;
  if (!WP_PASS) { console.log("[wp-listings-sync] idle: BGP_WP_APP_PASSWORD not set"); return; }
  setTimeout(() => { runWpListingsSync().catch(() => {}); }, 2 * 60 * 1000).unref();
  timer = setInterval(() => { runWpListingsSync().catch(() => {}); }, INTERVAL_MS);
  timer.unref();
}

const router = Router();
router.get("/api/admin/wp-listings-sync", requireAuth, requireAdmin, (_req, res) => {
  res.json({ configured: !!WP_PASS, wordpress: WP_URL, feed: FEED_URL, running: !!running, last: lastResult });
});
router.post("/api/admin/wp-listings-sync/legacy-photos", requireAuth, requireAdmin, async (req, res) => {
  try {
    const apply = req.query.apply === "1" || req.body?.apply === true;
    const retire = req.query.retire === "1" || req.body?.retire === true;
    res.json(await importLegacyListingPhotos({ apply, retire }));
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Import failed" });
  }
});
router.post("/api/admin/wp-listings-sync", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await runWpListingsSync({ retireLegacy: req.query.retireLegacy === "1" || req.body?.retireLegacy === true });
    res.status(result.error ? 500 : 200).json(result);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Sync failed" });
  }
});
export default router;
