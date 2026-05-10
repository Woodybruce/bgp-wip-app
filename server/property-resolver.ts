/**
 * Property Resolver — canonical property identity for the whole app.
 *
 * Every feature that talks about a specific property (Pathway, ChatBGP,
 * KYC Clouseau, Land Registry, comps, contacts, the Property Intelligence
 * page, the PLA Matter tracker, valuation engine, photo gallery…) reads
 * and writes through this single service.
 *
 * Input: anything that identifies a property (UPRN, TOID, title number,
 * address text, postcode+number, lat/lng, internal id).
 *
 * Output: a CanonicalProperty record (a row in crm_properties enriched
 * with cross-references — UPRN, TOID, polygon, INSPIRE, VOA BA ref, FHRSID,
 * admin geography). When the input is ambiguous (postcode-only, vague
 * address text), returns a candidate list so the UI can force a pick.
 *
 * Cross-references are filled in lazily — the first feature to need a
 * polygon fetches it, every later feature reads it for free.
 */

import { db } from "./db";
import { crmProperties, type CrmProperty } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import {
  osPlacesFind,
  osPlacesByPostcode,
  osPlacesByUprn,
  osPlacesNearest,
  isOsConfigured,
  type OsPlacesResult,
} from "./os-data";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PropertyInput =
  | { kind: "uprn"; uprn: string }
  | { kind: "toid"; toid: string }
  | { kind: "titleNumber"; titleNumber: string }
  | { kind: "voaBaReference"; reference: string }
  | { kind: "address"; text: string; postcode?: string }
  | { kind: "postcode"; postcode: string }
  | { kind: "latLng"; lat: number; lng: number }
  | { kind: "googlePlace"; placeId: string }
  | { kind: "internalId"; id: string };

export type CanonicalProperty = CrmProperty;

export type ResolverCandidate = {
  uprn: string;
  address: string;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  classification: string | null;
  /** Set when a CrmProperty row already exists for this UPRN — UI should mark it so the user knows we already track it. */
  existingPropertyId: string | null;
};

export type ResolveResult =
  | { kind: "resolved"; property: CanonicalProperty; source: ResolveSource }
  | { kind: "candidates"; candidates: ResolverCandidate[]; reason: string }
  | { kind: "not_found"; reason: string };

type ResolveSource =
  | "internal_id"
  | "uprn_db"
  | "uprn_os"
  | "toid_db"
  | "title_db"
  | "voa_db"
  | "address_single_match"
  | "latlng_single_match"
  | "postcode_single_match"
  | "created";

// ─── Main entry point ────────────────────────────────────────────────────────

export async function resolveProperty(input: PropertyInput): Promise<ResolveResult> {
  switch (input.kind) {
    case "internalId":      return resolveByInternalId(input.id);
    case "uprn":            return resolveByUprn(input.uprn);
    case "toid":            return resolveByToid(input.toid);
    case "titleNumber":     return resolveByTitleNumber(input.titleNumber);
    case "voaBaReference":  return resolveByVoaRef(input.reference);
    case "latLng":          return resolveByLatLng(input.lat, input.lng);
    case "postcode":        return resolveByPostcode(input.postcode);
    case "address":         return resolveByAddress(input.text, input.postcode);
    case "googlePlace":     return resolveByGooglePlace(input.placeId);
  }
}

// ─── Per-input-kind handlers ────────────────────────────────────────────────

async function resolveByInternalId(id: string): Promise<ResolveResult> {
  const [row] = await db.select().from(crmProperties).where(eq(crmProperties.id, id));
  return row
    ? { kind: "resolved", property: row, source: "internal_id" }
    : { kind: "not_found", reason: `no crm_property with id ${id}` };
}

async function resolveByUprn(uprn: string): Promise<ResolveResult> {
  if (!uprn) return { kind: "not_found", reason: "empty UPRN" };
  // 1. Already in our DB?
  const [existing] = await db.select().from(crmProperties).where(eq(crmProperties.uprn, uprn));
  if (existing) return { kind: "resolved", property: existing, source: "uprn_db" };
  // 2. Look up canonical address from OS Places, then create
  if (!isOsConfigured()) return { kind: "not_found", reason: "OS Places not configured; cannot resolve unknown UPRN" };
  const dpa = await osPlacesByUprn(uprn);
  if (!dpa) return { kind: "not_found", reason: `OS Places didn't recognise UPRN ${uprn}` };
  return createFromDpa(dpa, "uprn_os");
}

async function resolveByToid(toid: string): Promise<ResolveResult> {
  const [row] = await db.select().from(crmProperties).where(eq(crmProperties.toid, toid));
  if (row) return { kind: "resolved", property: row, source: "toid_db" };
  // Resolving a TOID we don't yet track requires intersecting NGD building
  // polygons with OS Places UPRNs — implemented in a later PR.
  return { kind: "not_found", reason: "TOID not yet linked; polygon-intersect lookup not implemented in v1" };
}

async function resolveByTitleNumber(titleNumber: string): Promise<ResolveResult> {
  const [row] = await db
    .select()
    .from(crmProperties)
    .where(eq(crmProperties.titleNumber, titleNumber));
  return row
    ? { kind: "resolved", property: row, source: "title_db" }
    : { kind: "not_found", reason: `no CRM property with title_number ${titleNumber}` };
}

async function resolveByVoaRef(reference: string): Promise<ResolveResult> {
  const [row] = await db
    .select()
    .from(crmProperties)
    .where(eq(crmProperties.voaBaReference, reference));
  return row
    ? { kind: "resolved", property: row, source: "voa_db" }
    : { kind: "not_found", reason: `no CRM property with voa_ba_reference ${reference}` };
}

async function resolveByLatLng(lat: number, lng: number, radius = 25): Promise<ResolveResult> {
  if (!isOsConfigured()) return { kind: "not_found", reason: "OS Places not configured" };
  const results = await osPlacesNearest(lat, lng, radius);
  if (results.length === 0) return { kind: "not_found", reason: `no UPRN within ${radius}m of point` };
  if (results.length === 1 && results[0].uprn) {
    return resolveByUprn(results[0].uprn);
  }
  return {
    kind: "candidates",
    candidates: await annotateCandidates(results),
    reason: "multiple UPRNs near this point — user must pick",
  };
}

async function resolveByPostcode(postcode: string): Promise<ResolveResult> {
  if (!isOsConfigured()) return { kind: "not_found", reason: "OS Places not configured" };
  const results = await osPlacesByPostcode(postcode);
  if (results.length === 0) return { kind: "not_found", reason: `no addresses at postcode ${postcode}` };
  if (results.length === 1 && results[0].uprn) {
    return resolveByUprn(results[0].uprn);
  }
  return {
    kind: "candidates",
    candidates: await annotateCandidates(results),
    reason: "postcode has multiple addresses — user must pick",
  };
}

async function resolveByAddress(text: string, postcode?: string): Promise<ResolveResult> {
  // Strip trailing country/region noise that confuses both Google's
  // country:uk filter (returns ZERO_RESULTS when suffix duplicates the
  // filter) and OS Places find (treats ", UK" as part of the address).
  const cleanedText = text
    .replace(/,?\s*(United\s+Kingdom|UK|England|Wales|Scotland|Northern\s+Ireland|Great\s+Britain|GB)\s*$/i, "")
    .replace(/,\s*$/, "")
    .trim();
  const query = postcode ? `${cleanedText} ${postcode}` : cleanedText;

  // Primary path: Google Places resolves "what address did the user mean"
  // (typo-tolerant, partial-postcode-tolerant, business-name-tolerant)
  // BEFORE we hit OS Places. Once Google returns a place_id we follow the
  // standard googlePlace path → OS Places nearest → canonical UPRN.
  if (process.env.GOOGLE_API_KEY) {
    try {
      const params = new URLSearchParams({
        input: query,
        key: process.env.GOOGLE_API_KEY,
        types: "geocode|establishment",
        components: "country:uk",
      });
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (resp.ok) {
        const data = await resp.json();
        const top = (data?.predictions || [])[0];
        if (top?.place_id && (data?.status === "OK")) {
          const googleResult = await resolveByGooglePlace(top.place_id);
          if (googleResult.kind === "resolved") return googleResult;
          // For ambiguous Google results we'd still surface candidates, but
          // resolveByGooglePlace funnels through latLng so a resolved
          // outcome is the typical case. If Google didn't help, fall through
          // to OS Places below as a safety net.
          if (googleResult.kind === "candidates") return googleResult;
        }
      }
    } catch (err: any) {
      console.warn("[property-resolver] Google primary lookup failed, falling back to OS Places:", err?.message);
    }
  }

  // Fallback: OS Places find — same behaviour as before for backwards compat.
  if (!isOsConfigured()) return { kind: "not_found", reason: "OS Places not configured (and Google didn't match)" };
  const results = await osPlacesFind(query, 10);
  if (results.length === 0) return { kind: "not_found", reason: `no address match for "${query}"` };
  if (results.length === 1 && results[0].uprn) {
    return resolveByUprn(results[0].uprn);
  }
  return {
    kind: "candidates",
    candidates: await annotateCandidates(results),
    reason: "ambiguous address — user must pick",
  };
}

/**
 * Google Places ID → resolver. Google Places Autocomplete is much better at
 * "what address did the user actually mean" than OS Places — handles typos,
 * partial postcodes, business names. Once Google gives us a confirmed
 * place_id, we look up its precise lat/lng and feed that to OS Places nearest
 * to get the canonical UK UPRN. End-to-end: typo-friendly UX → authoritative
 * UK government identifier.
 */
async function resolveByGooglePlace(placeId: string): Promise<ResolveResult> {
  if (!process.env.GOOGLE_API_KEY) {
    return { kind: "not_found", reason: "GOOGLE_API_KEY not configured" };
  }
  if (!placeId) return { kind: "not_found", reason: "empty placeId" };

  // Fetch place details — fields restricted to what we need (cheap)
  const fields = "geometry,formatted_address,place_id,address_components";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${process.env.GOOGLE_API_KEY}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) return { kind: "not_found", reason: `Google Place Details ${resp.status}` };
  const data = await resp.json();
  if (data.status !== "OK") {
    return { kind: "not_found", reason: `Google Place Details: ${data.status} ${data.error_message || ""}` };
  }
  const result = data.result;
  const lat = result?.geometry?.location?.lat;
  const lng = result?.geometry?.location?.lng;
  const formatted = result?.formatted_address;
  const postcode = (result?.address_components || []).find((c: any) => c.types?.includes("postal_code"))?.long_name;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { kind: "not_found", reason: "Google Place Details returned no geometry" };
  }

  // Primary: postcode + street-number match. When Google gives us a
  // postcode, we don't need geometry guesswork — pull every DPA record
  // in that postcode from OS Places and find the one whose address
  // starts with the street number Google extracted. Deterministic for
  // big West End buildings where lat/lng nearest-radius is unreliable
  // (the building centroid often sits >40m from any entrance UPRN).
  if (postcode && isOsConfigured()) {
    const streetNumber = extractStreetNumber(formatted);
    if (streetNumber) {
      const all = await osPlacesByPostcode(postcode, 100);
      const matches = filterByStreetNumber(all, streetNumber);
      if (matches.length === 1 && matches[0].uprn) {
        return resolveByUprn(matches[0].uprn);
      }
      if (matches.length > 1) {
        return {
          kind: "candidates",
          candidates: await annotateCandidates(matches),
          reason: `Multiple addresses at ${postcode} starting with ${streetNumber} — user must pick`,
        };
      }
    }
  }

  // Fallback: lat/lng nearest with a generous 50m radius. Google-derived
  // building centroids on big West End blocks sit further from individual
  // entrance UPRNs than the 25m default.
  const llResult = await resolveByLatLng(lat, lng, 50);
  // Final fallback: OS Places find on the formatted address — don't
  // re-enter resolveByAddress, which would re-Google and loop.
  if (llResult.kind === "not_found" && formatted) {
    const results = await osPlacesFind(formatted, 10);
    if (results.length === 1 && results[0].uprn) {
      return resolveByUprn(results[0].uprn);
    }
    if (results.length > 1) {
      return {
        kind: "candidates",
        candidates: await annotateCandidates(results),
        reason: "Google match → OS Places returned multiple — user must pick",
      };
    }
  }
  return llResult;
}

/** Pull a leading street number / range out of a formatted address. */
function extractStreetNumber(formatted: string | undefined | null): string | null {
  if (!formatted) return null;
  const m = formatted.match(/^\s*(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)\b/i);
  return m ? m[1].replace(/\s*-\s*/g, "-").toLowerCase() : null;
}

/**
 * Filter DPA records by street-number prefix. Handles ranges like "18-22"
 * by accepting any record whose first number falls inside the range, plus
 * exact-string matches like "18-22 Haymarket".
 */
function filterByStreetNumber(records: OsPlacesResult[], streetNumber: string): OsPlacesResult[] {
  const sn = streetNumber.toLowerCase();
  const range = sn.match(/^(\d+)([a-z]?)-(\d+)([a-z]?)$/);
  return records.filter((r) => {
    const addr = (r.address || "").toLowerCase();
    if (!addr) return false;
    // Exact prefix: "18-22 haymarket..." matches "18-22"
    if (addr.startsWith(`${sn} `) || addr.startsWith(`${sn},`)) return true;
    // Range: "18 haymarket..." or "20 haymarket..." matches "18-22"
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[3], 10);
      const m = addr.match(/^(\d+)([a-z]?)\b/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= lo && n <= hi) return true;
      }
    } else {
      // Single number: "18 haymarket..." matches "18"
      const m = addr.match(/^(\d+)([a-z]?)\b/);
      if (m && m[1] === sn.replace(/[a-z]$/, "") && (sn.match(/[a-z]$/)?.[0] || "") === (m[2] || "")) {
        return true;
      }
    }
    return false;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createFromDpa(dpa: OsPlacesResult, source: ResolveSource): Promise<ResolveResult> {
  // Race-safety: if another request just created this UPRN, return that row.
  if (dpa.uprn) {
    const [byUprn] = await db.select().from(crmProperties).where(eq(crmProperties.uprn, dpa.uprn));
    if (byUprn) return { kind: "resolved", property: byUprn, source: "uprn_db" };
  }
  const name = dpa.address || "Unknown property";
  const [created] = await db
    .insert(crmProperties)
    .values({
      name,
      address: { formatted: dpa.address, line1: dpa.address } as any,
      postcode: dpa.postcode ?? null,
      latitude: typeof dpa.latitude === "number" ? String(dpa.latitude) : null,
      longitude: typeof dpa.longitude === "number" ? String(dpa.longitude) : null,
      uprn: dpa.uprn ?? null,
      resolutionStatus: "verified",
      resolvedAt: new Date(),
    })
    .returning();
  // NOTE: heavy enrichment (HMLR / Companies House / AML) is deliberately
  // NOT auto-fired here — the user might still be picking the wrong
  // property, and we don't want to burn PropertyData credits or pollute
  // the AML feed on every keystroke-resolve. Enrichment is feature-driven:
  //   - Property Intelligence Land Registry tab → triggers HMLR
  //   - Property Intelligence Investigator tab → triggers Companies House
  //   - PLA matter creation → triggers folder template
  //   - Pathway Stage 1 → triggers full investigation cascade
  //   - "Confirm and enrich" button on the resolver UI (next commit) →
  //     explicit user action to run the full cascade once they've
  //     confirmed the right property
  return { kind: "resolved", property: created, source };
}

/**
 * Explicit enrichment endpoint — called by an "Enrich now" button on the
 * resolver UI / property detail page after the user has CONFIRMED the
 * property is the right one. Reuses the existing land-registry cascade.
 *
 * Best-effort throughout. Logs warnings, never throws.
 */
export async function enrichResolvedPropertyAsync(propertyId: string): Promise<{ ok: boolean; error?: string }> {
  const [prop] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId));
  if (!prop) return { ok: false, error: "property not found" };
  // Skip if already enriched recently
  if (prop.titleSearchDate && (Date.now() - new Date(prop.titleSearchDate).getTime()) < 24 * 60 * 60 * 1000) {
    return { ok: true };
  }
  try {
    const { resolveBuildingTitles } = await import("./land-registry");
    const lat = prop.latitude ? Number(prop.latitude) : undefined;
    const lng = prop.longitude ? Number(prop.longitude) : undefined;
    const addrField = prop.address as any;
    const addressStr = typeof addrField === "string" ? addrField : addrField?.formatted || addrField?.line1 || prop.name;
    await resolveBuildingTitles({
      address: addressStr,
      postcode: prop.postcode || undefined,
      lat,
      lng,
      // Critical: pass the resolver-canonical UPRN so PropertyData looks
      // up THIS exact building's title — not every title in the postcode.
      uprn: prop.uprn || undefined,
      source: "resolver",
      pathwayRunId: null,
      userId: null,
      skipPersist: false,
    } as any);

    // VOA enrichment — if the local VOA SQLite snapshot has a row that
    // looks like this property, stamp the BA reference. Free data, the
    // crm_properties.voa_ba_reference field already exists.
    if (prop.postcode && !prop.voaBaReference) {
      try {
        const { lookupVoaByPostcode, voaSqliteAvailable } = await import("./voa-sqlite");
        if (voaSqliteAvailable()) {
          const street = (addressStr || "").split(",")[0]?.trim();
          const candidates = lookupVoaByPostcode(prop.postcode, street, 5);
          // Best-match heuristic: candidate whose address starts with the
          // property name (e.g. "12 Hanover Square" matches "12 Hanover Sq").
          const propLower = (prop.name || "").toLowerCase();
          const best = candidates.find((c) => {
            if (!c.address) return false;
            const addrLower = c.address.toLowerCase();
            return addrLower.includes(propLower) || propLower.includes(addrLower.split(",")[0] || "");
          }) || candidates[0];
          if (best?.baRef) {
            await db
              .update(crmProperties)
              .set({ voaBaReference: best.baRef })
              .where(eq(crmProperties.id, propertyId));
          }
        }
      } catch (err: any) {
        console.warn(`[property-resolver] VOA enrichment failed for ${propertyId}:`, err?.message);
      }
    }

    return { ok: true };
  } catch (err: any) {
    console.warn(`[property-resolver] enrichment failed for ${propertyId}:`, err?.message);
    return { ok: false, error: err?.message || "enrichment failed" };
  }
}

async function annotateCandidates(results: OsPlacesResult[]): Promise<ResolverCandidate[]> {
  const uprns = results.map((r) => r.uprn).filter((u): u is string => !!u);
  const byUprn = new Map<string, string>();
  if (uprns.length > 0) {
    const existing = await db
      .select({ id: crmProperties.id, uprn: crmProperties.uprn })
      .from(crmProperties)
      .where(sql`${crmProperties.uprn} = ANY(${uprns})`);
    for (const e of existing) {
      if (e.uprn) byUprn.set(e.uprn, e.id);
    }
  }
  return results.map((r) => ({
    uprn: r.uprn ?? "",
    address: r.address ?? "",
    postcode: r.postcode ?? null,
    latitude: typeof r.latitude === "number" ? r.latitude : null,
    longitude: typeof r.longitude === "number" ? r.longitude : null,
    classification: r.classification ?? null,
    existingPropertyId: r.uprn ? byUprn.get(r.uprn) ?? null : null,
  }));
}

// ─── Compatibility shims for legacy callers ──────────────────────────────────
// These preserve the older ad-hoc resolver signatures so server/{land-registry,
// universal-ingest, property-gap-analysis}.ts keep working unchanged.
// New code should call resolveProperty() directly.

/** Legacy: address+postcode → CrmProperty (or null if no exact resolution). */
export async function resolveCanonicalByAddress(
  address: string,
  postcode?: string | null,
): Promise<CanonicalProperty | null> {
  const r = await resolveProperty({
    kind: "address",
    text: address,
    postcode: postcode || undefined,
  });
  return r.kind === "resolved" ? r.property : null;
}

/** Legacy: address text → UPRN (or null). Used by ChatBGP free-text lookups. */
export async function resolveAddressToUprn(text: string): Promise<string | null> {
  const r = await resolveProperty({ kind: "address", text });
  if (r.kind === "resolved") return r.property.uprn ?? null;
  if (r.kind === "candidates" && r.candidates[0]?.uprn) return r.candidates[0].uprn;
  return null;
}

// ─── HTTP routes ─────────────────────────────────────────────────────────────

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";

export function registerPropertyResolverRoutes(app: Express): void {
  /**
   * One endpoint handles every input kind. UI sends a PropertyInput and
   * receives either a resolved CanonicalProperty, a candidate list (when
   * the input is ambiguous — postcode-only, vague address, multi-UPRN
   * point), or not_found. The candidate-list response is what powers the
   * "force a pick" picker on the Property Intelligence page.
   */
  app.post("/api/property-resolver/resolve", requireAuth, async (req: Request, res: Response) => {
    try {
      const input = parseInput(req.body);
      if (!input) {
        return res.status(400).json({ error: "invalid input — expected PropertyInput discriminated union" });
      }
      const result = await resolveProperty(input);
      // Stamp the resolver — useful for audit and to know who picked when
      // a candidate was confirmed.
      if (result.kind === "resolved" && (req as any).user?.id) {
        // Fire-and-forget: don't block the response on the audit write.
        db.update(crmProperties)
          .set({ resolvedBy: (req as any).user.id, resolvedAt: new Date() })
          .where(eq(crmProperties.id, result.property.id))
          .catch((err) => console.warn("[property-resolver] resolvedBy update failed:", err));
      }
      return res.json(result);
    } catch (err: any) {
      console.error("[property-resolver] resolve error:", err);
      return res.status(500).json({ error: err?.message || "resolve failed" });
    }
  });

  /**
   * Google Places Autocomplete proxy — the UI uses this to give live
   * suggestions as the user types. Pinpointing the exact address with
   * Google FIRST means we feed OS Places a precise lat/lng (via the
   * googlePlace kind) and get back the canonical UPRN — instead of
   * passing free-text into OS Places which is fuzzy-match-poor and
   * often returns the wrong building.
   *
   * Bias the search to UK by default; callers can pass `country=` to
   * relax. We restrict to addresses + establishments — most BGP
   * lookups are buildings, not place names like "Westminster".
   */
  app.get("/api/property-resolver/autocomplete", requireAuth, async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q || q.length < 3) return res.json({ suggestions: [] });
      if (!process.env.GOOGLE_API_KEY) {
        return res.status(503).json({ error: "GOOGLE_API_KEY not configured" });
      }
      const country = String(req.query.country || "uk").toLowerCase();
      const sessionToken = String(req.query.sessionToken || "");
      const params = new URLSearchParams({
        input: q,
        key: process.env.GOOGLE_API_KEY,
        // address + establishment covers buildings + businesses; geocode
        // alone strips named places like "Selfridges, Oxford St"
        types: "geocode|establishment",
        components: `country:${country}`,
      });
      if (sessionToken) params.set("sessiontoken", sessionToken);
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!resp.ok) return res.status(502).json({ error: `Google Autocomplete ${resp.status}` });
      const data = await resp.json();
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        return res.status(502).json({ error: `Google: ${data.status} ${data.error_message || ""}` });
      }
      const suggestions = (data.predictions || []).map((p: any) => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting?.main_text || p.description,
        secondaryText: p.structured_formatting?.secondary_text || "",
        types: p.types || [],
      }));
      return res.json({ suggestions });
    } catch (err: any) {
      console.error("[property-resolver] autocomplete error:", err);
      return res.status(500).json({ error: err?.message || "autocomplete failed" });
    }
  });

  /**
   * Confirm a candidate pick — the UI calls this after the user clicks
   * one of the candidates returned above. Server creates/links the row
   * and returns the canonical property. Idempotent.
   */
  app.post("/api/property-resolver/confirm", requireAuth, async (req: Request, res: Response) => {
    try {
      const uprn = String(req.body?.uprn || "").trim();
      if (!uprn) return res.status(400).json({ error: "uprn required" });
      const result = await resolveProperty({ kind: "uprn", uprn });
      if (result.kind === "resolved" && (req as any).user?.id) {
        db.update(crmProperties)
          .set({ resolvedBy: (req as any).user.id, resolvedAt: new Date(), resolutionStatus: "manual" })
          .where(eq(crmProperties.id, result.property.id))
          .catch((err) => console.warn("[property-resolver] confirm update failed:", err));
      }
      return res.json(result);
    } catch (err: any) {
      console.error("[property-resolver] confirm error:", err);
      return res.status(500).json({ error: err?.message || "confirm failed" });
    }
  });

  /**
   * Explicit enrichment trigger — called by "Enrich now" UI button after
   * the user confirms the property is the right one. Runs HMLR title +
   * proprietor lookup (PropertyData API), which auto-cascades to Companies
   * House + AML via the existing land-registry persistence flow.
   *
   * 24-hour cooldown built into the helper to avoid burning credits on
   * rapid re-clicks.
   */
  app.post("/api/property-resolver/enrich/:propertyId", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await enrichResolvedPropertyAsync(String(req.params.propertyId));
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "enrich failed" });
    }
  });
}

function parseInput(body: any): PropertyInput | null {
  if (!body || typeof body !== "object") return null;
  const kind = body.kind;
  switch (kind) {
    case "uprn":           return typeof body.uprn === "string" ? { kind, uprn: body.uprn } : null;
    case "toid":           return typeof body.toid === "string" ? { kind, toid: body.toid } : null;
    case "titleNumber":    return typeof body.titleNumber === "string" ? { kind, titleNumber: body.titleNumber } : null;
    case "voaBaReference": return typeof body.reference === "string" ? { kind, reference: body.reference } : null;
    case "internalId":     return typeof body.id === "string" ? { kind, id: body.id } : null;
    case "postcode":       return typeof body.postcode === "string" ? { kind, postcode: body.postcode } : null;
    case "googlePlace":    return typeof body.placeId === "string" ? { kind, placeId: body.placeId } : null;
    case "latLng":
      return typeof body.lat === "number" && typeof body.lng === "number"
        ? { kind, lat: body.lat, lng: body.lng }
        : null;
    case "address":
      return typeof body.text === "string"
        ? { kind, text: body.text, postcode: typeof body.postcode === "string" ? body.postcode : undefined }
        : null;
    default:
      return null;
  }
}
