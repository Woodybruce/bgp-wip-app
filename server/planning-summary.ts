// Reads `crm_properties` row, fetches constraints from planning.data.gov.uk
// (point-in-polygon by lat/lng) and recent applications from PlanIt, and
// returns a normalised summary ready for the UI and AI prompts.
//
// Cached in-memory by propertyId, 24h TTL. The upstream APIs are slow-ish
// (300ms-1s each) so we never want to hit them on every page render.

import { storage } from "./storage";
import { fetchPlanitPlanning } from "./planit-planning";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const memoryCache = new Map<string, { fetchedAt: number; data: PlanningSummary }>();

const PLANNING_DATA_DATASETS = [
  "conservation-area",
  "article-4-direction-area",
  "listed-building-outline",
  "tree-preservation-zone",
  "scheduled-monument",
  "world-heritage-site",
  "world-heritage-site-buffer-zone",
  "flood-risk-zone",
  "locally-listed-building",
  "park-and-garden",
] as const;

export type PlanningConstraint = {
  dataset: string;
  name: string;
  reference?: string;
  designationDate?: string;
  documentUrl?: string;
};

export type PlanningApplication = {
  reference: string;
  description: string;
  status?: string;
  receivedAt?: string;
  decidedAt?: string;
  decision?: string;
  lpa?: string;
  documentUrl?: string;
};

export type PlanningSummary = {
  propertyId: string;
  postcode: string | null;
  coordinates: { lat: number; lng: number } | null;
  constraints: {
    listed: PlanningConstraint[];
    conservationArea: PlanningConstraint[];
    article4: PlanningConstraint[];
    tpo: PlanningConstraint[];
    scheduledMonument: PlanningConstraint[];
    worldHeritage: PlanningConstraint[];
    floodRisk: PlanningConstraint[];
    other: PlanningConstraint[];
  };
  recentApplications: PlanningApplication[];
  applicationCount: { total: number; lastYear: number; pending: number };
  fetchedAt: string;
};

function emptySummary(propertyId: string, postcode: string | null): PlanningSummary {
  return {
    propertyId,
    postcode,
    coordinates: null,
    constraints: {
      listed: [],
      conservationArea: [],
      article4: [],
      tpo: [],
      scheduledMonument: [],
      worldHeritage: [],
      floodRisk: [],
      other: [],
    },
    recentApplications: [],
    applicationCount: { total: 0, lastYear: 0, pending: 0 },
    fetchedAt: new Date().toISOString(),
  };
}

async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const lat = data.result?.latitude;
    const lng = data.result?.longitude;
    return lat && lng ? { lat, lng } : null;
  } catch {
    return null;
  }
}

async function fetchDataset(
  dataset: string,
  lat: number,
  lng: number,
): Promise<PlanningConstraint[]> {
  try {
    const url = `https://www.planning.data.gov.uk/entity.json?dataset=${dataset}&longitude=${lng}&latitude=${lat}&limit=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    const entities = Array.isArray(data?.entities) ? data.entities : [];
    return entities.map((e: any) => ({
      dataset,
      name: e.name || e.reference || dataset,
      reference: e.reference,
      designationDate: e["designation-date"] || e["start-date"],
      documentUrl: e["document-url"] || e["documentation-url"],
    }));
  } catch {
    return [];
  }
}

function bucketConstraints(all: Record<string, PlanningConstraint[]>) {
  return {
    listed: all["listed-building-outline"] ?? [],
    conservationArea: all["conservation-area"] ?? [],
    article4: all["article-4-direction-area"] ?? [],
    tpo: all["tree-preservation-zone"] ?? [],
    scheduledMonument: all["scheduled-monument"] ?? [],
    worldHeritage: [
      ...(all["world-heritage-site"] ?? []),
      ...(all["world-heritage-site-buffer-zone"] ?? []),
    ],
    floodRisk: all["flood-risk-zone"] ?? [],
    other: [
      ...(all["locally-listed-building"] ?? []),
      ...(all["park-and-garden"] ?? []),
    ],
  };
}

function summariseApplications(apps: PlanningApplication[]) {
  const now = Date.now();
  const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
  let lastYear = 0;
  let pending = 0;
  for (const a of apps) {
    const dt = a.receivedAt ? Date.parse(a.receivedAt) : NaN;
    if (!Number.isNaN(dt) && dt >= yearAgo) lastYear++;
    const status = (a.status || "").toLowerCase();
    if (status && !/(decided|determined|withdrawn|refused|granted|approved)/.test(status)) {
      pending++;
    }
  }
  return { total: apps.length, lastYear, pending };
}

async function buildSummary(
  cacheKey: string,
  postcode: string | null,
  coordinates: { lat: number; lng: number } | null,
  propertyName: string | null,
): Promise<PlanningSummary> {
  if (!coordinates && postcode) {
    coordinates = await geocodePostcode(postcode);
  }
  if (!coordinates) {
    const empty = emptySummary(cacheKey, postcode);
    memoryCache.set(cacheKey, { fetchedAt: Date.now(), data: empty });
    return empty;
  }

  const datasetResults: Record<string, PlanningConstraint[]> = {};
  const [, applicationsRaw] = await Promise.all([
    Promise.all(
      PLANNING_DATA_DATASETS.map(async (dataset) => {
        datasetResults[dataset] = await fetchDataset(dataset, coordinates!.lat, coordinates!.lng);
      })
    ),
    postcode
      ? fetchPlanitPlanning(postcode, propertyName || "", { maxAgeYears: 5, radiusKm: 0.2 }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const recentApplications: PlanningApplication[] = (applicationsRaw as any[])
    .slice(0, 20)
    .map((a) => ({
      reference: a.reference,
      description: a.description,
      status: a.status,
      receivedAt: a.receivedAt,
      decidedAt: a.decidedAt,
      decision: a.decision,
      lpa: a.lpa,
      documentUrl: a.documentUrl,
    }));

  const summary: PlanningSummary = {
    propertyId: cacheKey,
    postcode,
    coordinates,
    constraints: bucketConstraints(datasetResults),
    recentApplications,
    applicationCount: summariseApplications(recentApplications),
    fetchedAt: new Date().toISOString(),
  };

  memoryCache.set(cacheKey, { fetchedAt: Date.now(), data: summary });
  return summary;
}

export async function getPlanningSummary(
  propertyId: string,
  opts: { force?: boolean } = {},
): Promise<PlanningSummary> {
  if (!opts.force) {
    const hit = memoryCache.get(propertyId);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data;
  }

  const property = await storage.getCrmProperty(propertyId);
  if (!property) {
    return emptySummary(propertyId, null);
  }

  const postcode = (property.postcode || "").trim() || null;
  let coordinates: { lat: number; lng: number } | null = null;
  if (property.latitude && property.longitude) {
    const lat = parseFloat(property.latitude);
    const lng = parseFloat(property.longitude);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) coordinates = { lat, lng };
  }

  return buildSummary(propertyId, postcode, coordinates, property.name || null);
}

// Variant for callers that don't have a crm_properties.id — e.g. pathway runs
// where we have postcode + lat/lng directly. Pass a stable cacheKey (e.g. the
// pathway runId) so we can dedupe repeated lookups.
export async function getPlanningSummaryForLocation(args: {
  cacheKey: string;
  postcode?: string | null;
  lat?: number | null;
  lng?: number | null;
  propertyName?: string | null;
  force?: boolean;
}): Promise<PlanningSummary> {
  const { cacheKey, force } = args;
  if (!force) {
    const hit = memoryCache.get(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data;
  }
  const postcode = args.postcode?.trim() || null;
  const coordinates = args.lat != null && args.lng != null && !Number.isNaN(args.lat) && !Number.isNaN(args.lng)
    ? { lat: args.lat as number, lng: args.lng as number }
    : null;
  return buildSummary(cacheKey, postcode, coordinates, args.propertyName ?? null);
}

// Compact markdown block for injection into AI generation prompts
// (Why Buy gamma, document briefs, ChatBGP responses).
export function planningSummaryToMarkdown(s: PlanningSummary): string {
  const lines: string[] = ["## Planning context"];
  const c = s.constraints;
  const chips: string[] = [];
  if (c.listed.length) {
    const grades = c.listed.map((l) => l.name).filter(Boolean).join(", ");
    chips.push(`Listed: ${grades || "yes"}`);
  }
  if (c.conservationArea.length) chips.push(`Conservation area: ${c.conservationArea[0].name}`);
  if (c.article4.length) chips.push(`Article 4 direction: ${c.article4[0].name}`);
  if (c.tpo.length) chips.push(`TPO`);
  if (c.scheduledMonument.length) chips.push(`Scheduled monument`);
  if (c.worldHeritage.length) chips.push(`World heritage`);
  if (c.floodRisk.length) chips.push(`Flood risk zone`);
  if (chips.length === 0) lines.push("- No designated constraints found at this location.");
  else for (const chip of chips) lines.push(`- ${chip}`);

  if (s.recentApplications.length > 0) {
    lines.push("", `**Recent planning history** (${s.applicationCount.total} apps total, ${s.applicationCount.lastYear} in last year, ${s.applicationCount.pending} pending):`);
    for (const a of s.recentApplications.slice(0, 5)) {
      const date = a.receivedAt ? a.receivedAt.slice(0, 10) : "?";
      const status = a.decision || a.status || "?";
      lines.push(`- ${date} · ${a.reference} · ${status} · ${a.description?.slice(0, 120) ?? ""}`);
    }
  }

  return lines.join("\n");
}
