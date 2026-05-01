// Admin routes — read-only diagnostics for one-off backfill prep.
//
//   GET /api/admin/wip-preview.csv?type=properties
//   GET /api/admin/wip-preview.csv?type=landlords
//
// Returns the same CSVs as scripts/wip-backfill-preview.ts, but as a download
// you can hit from the browser. Auth-gated via requireAuth.
import { type Express } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const CLOSED_STATUSES = new Set([
  "Completed",
  "Lost",
  "Invoiced",
  "Leasing - Completed",
]);

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPropertyName(dealName: string): string {
  const m = dealName.match(/^(.*?)\s*[–-]\s*/);
  return (m ? m[1] : dealName).trim();
}

async function buildWipPreview(): Promise<{ properties: string; landlords: string }> {
  const dealsRes = await pool.query<{
    id: string;
    name: string;
    group_name: string | null;
    property_id: string | null;
    landlord_id: string | null;
    status: string | null;
  }>(`select id, name, group_name, property_id, landlord_id, status from crm_deals`);

  const activeDeals = dealsRes.rows.filter(
    (d) => !d.status || !CLOSED_STATUSES.has(d.status)
  );

  const propsRes = await pool.query<{
    id: string;
    name: string;
    postcode: string | null;
    landlord_id: string | null;
  }>(`select id, name, postcode, landlord_id from crm_properties`);

  const compsRes = await pool.query<{
    id: string;
    name: string;
    company_type: string | null;
  }>(`select id, name, company_type from crm_companies`);

  const propIndex = propsRes.rows.map((p) => ({ ...p, norm: normalise(p.name) }));
  const compIndex = compsRes.rows.map((c) => ({ ...c, norm: normalise(c.name) }));

  // Properties bucket
  type PropBucket = {
    extract: string;
    norm: string;
    dealCount: number;
    linkedCount: number;
    sampleDealNames: string[];
    landlords: Set<string>;
  };
  const propBuckets = new Map<string, PropBucket>();

  for (const d of activeDeals) {
    const extract = extractPropertyName(d.name);
    const norm = normalise(extract);
    if (!norm) continue;
    let b = propBuckets.get(norm);
    if (!b) {
      b = {
        extract,
        norm,
        dealCount: 0,
        linkedCount: 0,
        sampleDealNames: [],
        landlords: new Set(),
      };
      propBuckets.set(norm, b);
    }
    b.dealCount++;
    if (d.property_id) b.linkedCount++;
    if (b.sampleDealNames.length < 3) b.sampleDealNames.push(d.name);
    if (d.group_name) b.landlords.add(d.group_name);
  }

  const propRows: (string | number)[][] = [
    [
      "property_extract",
      "deal_count",
      "currently_linked",
      "linked_pct",
      "suggested_property_id",
      "suggested_property_name",
      "match_type",
      "landlords_in_wip",
      "sample_deal_names",
    ],
  ];

  for (const b of [...propBuckets.values()].sort((a, b) => b.dealCount - a.dealCount)) {
    let match = propIndex.find((p) => p.norm === b.norm);
    let matchType = match ? "exact" : "";
    if (!match) {
      match = propIndex.find((p) => p.norm.startsWith(b.norm) || b.norm.startsWith(p.norm));
      if (match) matchType = "prefix";
    }
    if (!match) {
      match = propIndex.find((p) => p.norm.includes(b.norm) || b.norm.includes(p.norm));
      if (match) matchType = "contains";
    }
    if (!match) matchType = "none";

    propRows.push([
      b.extract,
      b.dealCount,
      b.linkedCount,
      `${Math.round((b.linkedCount / b.dealCount) * 100)}%`,
      match?.id ?? "",
      match?.name ?? "",
      matchType,
      [...b.landlords].join(" | "),
      b.sampleDealNames.join(" | "),
    ]);
  }

  // Landlord bucket
  type LandBucket = {
    groupName: string;
    norm: string;
    dealCount: number;
    landlordIdLinkedCount: number;
    distinctLandlordIds: Set<string>;
  };
  const landBuckets = new Map<string, LandBucket>();

  for (const d of activeDeals) {
    const g = (d.group_name || "").trim();
    if (!g) continue;
    const key = normalise(g);
    let b = landBuckets.get(key);
    if (!b) {
      b = {
        groupName: g,
        norm: key,
        dealCount: 0,
        landlordIdLinkedCount: 0,
        distinctLandlordIds: new Set(),
      };
      landBuckets.set(key, b);
    }
    b.dealCount++;
    if (d.landlord_id) {
      b.landlordIdLinkedCount++;
      b.distinctLandlordIds.add(d.landlord_id);
    }
  }

  const landRows: (string | number)[][] = [
    [
      "group_name",
      "deal_count",
      "landlord_id_linked",
      "linked_pct",
      "current_distinct_landlord_ids",
      "suggested_canonical_company_id",
      "suggested_canonical_name",
      "company_type",
      "match_type",
    ],
  ];

  for (const b of [...landBuckets.values()].sort((a, b) => b.dealCount - a.dealCount)) {
    let match = compIndex.find((c) => c.norm === b.norm);
    let matchType = match ? "exact" : "";
    if (!match) {
      match = compIndex.find((c) => c.norm.startsWith(b.norm) || b.norm.startsWith(c.norm));
      if (match) matchType = "prefix";
    }
    if (!match) {
      match = compIndex.find((c) => c.norm.includes(b.norm) || b.norm.includes(c.norm));
      if (match) matchType = "contains";
    }
    if (!match) matchType = "none";

    landRows.push([
      b.groupName,
      b.dealCount,
      b.landlordIdLinkedCount,
      `${Math.round((b.landlordIdLinkedCount / b.dealCount) * 100)}%`,
      [...b.distinctLandlordIds].join(" | "),
      match?.id ?? "",
      match?.name ?? "",
      match?.company_type ?? "",
      matchType,
    ]);
  }

  return { properties: csv(propRows), landlords: csv(landRows) };
}

export function registerAdminRoutes(app: Express) {
  app.get("/api/admin/wip-preview.csv", requireAuth, async (req, res) => {
    const type = String(req.query.type || "properties");
    if (type !== "properties" && type !== "landlords") {
      return res.status(400).json({ error: "type must be 'properties' or 'landlords'" });
    }
    try {
      const out = await buildWipPreview();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="wip-${type}.csv"`
      );
      res.send(type === "properties" ? out.properties : out.landlords);
    } catch (err: any) {
      console.error("[admin/wip-preview] failed:", err);
      res.status(500).json({ error: err?.message || "failed" });
    }
  });
}
