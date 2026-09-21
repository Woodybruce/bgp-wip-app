// ─────────────────────────────────────────────────────────────────────────
// Account media view (Delivery 4, Task 2).
//
// One read-only media view over a whole account: company-linked images AND
// images attached only to the account's properties. Today's gallery query
// (brand-profile.ts imagesQ) matches company_id / brand_name only, so
// property-only photos (company_id NULL, brand_name NULL, property_id set)
// never surface on the landlord page. Property linkage here is by
// property_id — never by filename or URL substring.
//
// Groups:
//   approved   — images a BGP human pinned as the saved choice ('brand-hero'
//                tag, staff-only toggle). This is the only marketing-reuse
//                approval signal that exists; public auto-imports are never
//                marked cleared by anything in this pipeline.
//   properties — images with a property_id inside the account's portfolio.
//   corporate  — everything else linked to the account's entities.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { resolveAccountView, type AccountView, type Querier } from "./account-resolver";

export type AccountMediaGroup = "corporate" | "properties" | "approved";

export interface AccountMediaRow {
  id: string;
  file_name: string | null;
  thumbnail_data: string | null;
  mime_type: string | null;
  tags: string[];
  category: string | null;
  source: string | null;
  description: string | null;
  width: number | null;
  height: number | null;
  created_at: string | null;
  company_id: string | null;
  property_id: string | null;
  property_name: string | null;
  group: AccountMediaGroup;
  marketing_cleared: boolean;
}

export interface AccountMediaResponse {
  groups: Record<AccountMediaGroup, AccountMediaRow[]>;
  properties: Array<{ propertyId: string; name: string }>;
  total: number;
}

// The group a row belongs to. 'brand-hero' is the staff-only "Saved choice"
// pin (CompanyImageCoverChoice) — the only human approval signal that
// exists, so it's what "BGP-approved" means. Auto-imported public images
// carry 'brand-auto' and never earn this group by themselves.
export function classifyMediaRow(row: { tags?: unknown; property_id?: unknown }): AccountMediaGroup {
  const tags = Array.isArray(row.tags) ? row.tags : [];
  if (tags.includes("brand-hero")) return "approved";
  if (row.property_id) return "properties";
  return "corporate";
}

export function isMarketingCleared(row: { tags?: unknown }): boolean {
  return Array.isArray(row.tags) && row.tags.includes("brand-hero");
}

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

export async function listAccountMedia(
  companyId: string,
  opts: { scopeCompanyId?: string | null; propertyId?: string | null } = {},
  deps: {
    pool?: Querier;
    resolveView?: (id: string, o: { scopeCompanyId?: string | null }) => Promise<AccountView>;
  } = {},
): Promise<AccountMediaResponse> {
  const q = deps.pool ?? await defaultPool();
  const resolveView = deps.resolveView ?? ((id: string, o: { scopeCompanyId?: string | null }) => resolveAccountView(id, o, { pool: q }));
  const view = await resolveView(companyId, { scopeCompanyId: opts.scopeCompanyId ?? null });

  const entityIds = view.entities.map(e => e.companyId);
  const entityNames = view.entities.map(e => (e.name || "").trim().toLowerCase()).filter(Boolean);
  const portfolioIds = view.properties.map(p => p.propertyId);

  const empty: AccountMediaResponse = { groups: { corporate: [], properties: [], approved: [] }, properties: [], total: 0 };
  if (!entityIds.length && !portfolioIds.length) return empty;

  // Company assets by FK, property assets by property_id, plus the legacy
  // brand_name-only rows (company_id AND property_id NULL) that predate the
  // FK backfill — same fallback as the existing gallery query. Dedupe by
  // image id: a row can satisfy the company and property clauses at once.
  const { rows } = await q.query(
    `SELECT i.id, i.file_name, i.thumbnail_data, i.mime_type, i.tags, i.category, i.source,
            i.description, i.width, i.height, i.created_at, i.company_id, i.property_id,
            p.name AS property_name
       FROM image_studio_images i
       LEFT JOIN crm_properties p ON p.id = i.property_id
      WHERE i.company_id = ANY($1::varchar[])
         OR i.property_id = ANY($2::varchar[])
         OR (i.company_id IS NULL AND i.property_id IS NULL AND i.brand_name IS NOT NULL
             AND lower(trim(i.brand_name)) = ANY($3::text[]))
      ORDER BY ('brand-hero' = ANY(i.tags))::int DESC, i.created_at DESC
      LIMIT 300`,
    [entityIds, portfolioIds, entityNames],
  );

  const seen = new Set<string>();
  const groups: Record<AccountMediaGroup, AccountMediaRow[]> = { corporate: [], properties: [], approved: [] };
  const propertyFilter = opts.propertyId || null;
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const group = classifyMediaRow(r);
    const row: AccountMediaRow = {
      id: r.id,
      file_name: r.file_name ?? null,
      thumbnail_data: r.thumbnail_data ?? null,
      mime_type: r.mime_type ?? null,
      tags: Array.isArray(r.tags) ? r.tags : [],
      category: r.category ?? null,
      source: r.source ?? null,
      description: r.description ?? null,
      width: r.width ?? null,
      height: r.height ?? null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at ?? null,
      company_id: r.company_id ?? null,
      property_id: r.property_id ?? null,
      property_name: r.property_name ?? null,
      group,
      marketing_cleared: isMarketingCleared(r),
    };
    if (group === "properties" && propertyFilter && row.property_id !== propertyFilter) continue;
    groups[group].push(row);
  }

  const properties = view.properties
    .map(p => ({ propertyId: p.propertyId, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { groups, properties, total: groups.corporate.length + groups.properties.length + groups.approved.length };
}

const router = Router();

router.get("/api/accounts/:id/media", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    const propertyId = typeof req.query.propertyId === "string" && req.query.propertyId.trim()
      ? req.query.propertyId.trim()
      : null;
    res.json(await listAccountMedia(String(req.params.id), { scopeCompanyId, propertyId }));
  } catch (e: any) {
    console.error("[/api/accounts/:id/media]", e?.message);
    res.status(500).json({ error: e?.message || "failed" });
  }
});

export default router;
