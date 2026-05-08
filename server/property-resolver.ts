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

async function resolveByLatLng(lat: number, lng: number): Promise<ResolveResult> {
  if (!isOsConfigured()) return { kind: "not_found", reason: "OS Places not configured" };
  const results = await osPlacesNearest(lat, lng, 25);
  if (results.length === 0) return { kind: "not_found", reason: "no UPRN within 25m of point" };
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
  if (!isOsConfigured()) return { kind: "not_found", reason: "OS Places not configured" };
  const query = postcode ? `${text} ${postcode}` : text;
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
  return { kind: "resolved", property: created, source };
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
