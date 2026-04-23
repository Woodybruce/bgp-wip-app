/**
 * PlanIt Explorer planning data source (planit.org.uk).
 *
 * PlanIt is a community-run aggregator that scrapes every UK LPA Idox
 * portal (including Westminster, which blocks Railway's egress IP at
 * TCP level) and serves the results from its own infrastructure.
 *
 * We use it as the Westminster-safe fallback for the Idox scraper and
 * as general London-wide coverage. No API key, but we keep page size
 * modest and cache per postcode.
 */

import type { IdoxPlanningApp } from "./idox-planning";

interface PlanitRecord {
  uid?: string;
  name?: string;
  altid?: string;
  reference?: string | null;
  address?: string;
  description?: string;
  app_state?: string;
  app_type?: string;
  start_date?: string;
  decided_date?: string;
  area_name?: string;
  url?: string;
  link?: string;
  other_fields?: {
    decision?: string;
    docs_url?: string;
    source_url?: string;
    application_type?: string;
    status?: string;
  };
}

function normalise(r: PlanitRecord): IdoxPlanningApp {
  const reference = r.uid || r.reference || r.name || r.altid || "";
  const docs = r.other_fields?.docs_url || r.url || r.link || "";
  return {
    reference,
    address: r.address || "",
    description: r.description || "",
    status: r.other_fields?.status || r.app_state || "",
    type: r.other_fields?.application_type || r.app_type || "",
    receivedAt: r.start_date || "",
    decidedAt: r.decided_date || "",
    decision: r.other_fields?.decision || r.app_state || "",
    documentUrl: docs,
    lpa: r.area_name || "",
    source: "idox" as const, // downstream code treats this as authoritative Idox data
  };
}

export async function fetchPlanitPlanning(
  postcode: string,
  _address: string,
  opts: { maxAgeYears?: number; radiusKm?: number } = {},
): Promise<IdoxPlanningApp[]> {
  const pc = (postcode || "").trim();
  if (!pc) return [];

  const maxAgeYears = opts.maxAgeYears ?? 20;
  const radiusKm = opts.radiusKm ?? 0.3;

  const start = new Date();
  start.setFullYear(start.getFullYear() - maxAgeYears);
  const startDate = start.toISOString().split("T")[0];

  const params = new URLSearchParams({
    postcode: pc,
    krad: String(radiusKm),
    pg_sz: "200",
    start_date: startDate,
  });

  const url = `https://www.planit.org.uk/api/applics/json?${params}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        "User-Agent": "BGP-Dashboard/1.0 (property due diligence)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`[planit-planning] HTTP ${res.status} for ${pc}`);
      return [];
    }
    const data = (await res.json()) as { records?: PlanitRecord[]; total?: number };
    const records = Array.isArray(data?.records) ? data.records : [];
    const mapped = records.map(normalise).filter((a) => a.reference || a.description);
    console.log(`[planit-planning] ${pc} → ${mapped.length} apps (total=${data?.total ?? "?"})`);
    return mapped;
  } catch (err: any) {
    console.warn(`[planit-planning] fetch failed for ${pc}: ${err?.message}`);
    return [];
  }
}
