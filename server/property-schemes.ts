// Estate schemes (Woody, 2026-09-28). One property can be a whole estate
// with named schemes — Canary Wharf: Jubilee Place, Cabot Place, Canada
// Place, Crossrail Place … — each invoiced to its own landlord entity. The
// scheme NAME is the label a unit or deal carries (tenancy grouping, leasing
// zone, available_units.scheme, crm_deals.scheme); property_schemes holds the
// facts per scheme.
//
//   GET    /api/properties/:id/schemes              schemes (+ unit counts, unmatched labels for staff)
//   POST   /api/properties/:id/schemes              add (staff)
//   PUT    /api/properties/:id/schemes/:schemeId    edit; a rename relabels the units and deals (staff)
//   DELETE /api/properties/:id/schemes/:schemeId    remove the scheme row; labels stay (staff)

import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { findScheme, schemeKey } from "@shared/property-schemes";

type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type SchemeRow = {
  id: string;
  property_id: string;
  name: string;
  code: string | null;
  billing_entity_id: string | null;
  invoicing_email: string | null;
  sharepoint_folder_url: string | null;
  plan_id: string | null;
  sort_order: number | null;
};

/** SQL twin of schemeKey() for comparing a label column with a name. */
export function schemeKeySql(expr: string): string {
  return `trim(regexp_replace(replace(lower(coalesce(${expr}, '')), '&', ' and '), '[^a-z0-9]+', ' ', 'g'))`;
}

export async function listSchemes(db: Queryable, propertyId: string): Promise<SchemeRow[]> {
  const exists = (await db.query(`SELECT to_regclass('property_schemes') IS NOT NULL AS ok`)).rows[0]?.ok;
  if (!exists) return [];
  return (await db.query(
    `SELECT id, property_id, name, code, billing_entity_id, invoicing_email, sharepoint_folder_url, plan_id, sort_order
       FROM property_schemes WHERE property_id = $1 ORDER BY sort_order NULLS LAST, name`,
    [propertyId],
  )).rows;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHAREPOINT_URL_RE = /^https:\/\/brucegillinghampollardlimited(-my)?\.sharepoint\.com\//i;

/** Validated scheme fields from a request body; throws a 400 on bad input. */
export function schemeFields(body: any, { requireName }: { requireName: boolean }): Partial<SchemeRow> {
  const out: Partial<SchemeRow> = {};
  const text = (v: any) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
  const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
  if ("name" in (body || {}) || requireName) {
    const name = text(body?.name).replace(/\s+/g, " ");
    if (!name || name.length > 120) throw bad("Give the scheme a name (up to 120 characters).");
    out.name = name;
  }
  if ("code" in (body || {})) out.code = text(body.code).slice(0, 40) || null;
  if ("billingEntityId" in (body || {})) out.billing_entity_id = text(body.billingEntityId) || null;
  if ("invoicingEmail" in (body || {})) {
    const email = text(body.invoicingEmail);
    if (email && !EMAIL_RE.test(email)) throw bad("That invoicing email doesn't look right.");
    out.invoicing_email = email || null;
  }
  if ("sharepointFolderUrl" in (body || {})) {
    const url = text(body.sharepointFolderUrl);
    if (url && !SHAREPOINT_URL_RE.test(url)) throw bad("Paste a link to a folder in the BGP SharePoint or OneDrive.");
    out.sharepoint_folder_url = url || null;
  }
  if ("planId" in (body || {})) out.plan_id = text(body.planId) || null;
  if ("sortOrder" in (body || {})) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) throw bad("Sort order must be a number.");
    out.sort_order = Math.round(n);
  }
  return out;
}

/** Relabel every unit and deal on the property carrying the old scheme name. */
export async function relabelScheme(db: Queryable, propertyId: string, oldName: string, newName: string): Promise<number> {
  let n = 0;
  for (const [table, col] of [["tenancy_schedule_units", "grouping"], ["leasing_schedule_units", "zone"], ["available_units", "scheme"], ["crm_deals", "scheme"]]) {
    const r = await db.query(
      `UPDATE ${table} SET ${col} = $3, updated_at = now() WHERE property_id = $1 AND ${schemeKeySql(col)} = $2`,
      [propertyId, schemeKey(oldName), newName],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

/** Create a scheme or return the one of that name. */
export async function ensureScheme(db: Queryable, propertyId: string, name: string, extra: Partial<SchemeRow> = {}): Promise<{ scheme: SchemeRow; created: boolean }> {
  const existing = findScheme(await listSchemes(db, propertyId), name);
  if (existing && schemeKey(existing.name) === schemeKey(name)) return { scheme: existing, created: false };
  const sort = (await db.query(`SELECT coalesce(max(sort_order), 0) + 1 AS next FROM property_schemes WHERE property_id = $1`, [propertyId])).rows[0]?.next ?? 1;
  const row = (await db.query(
    `INSERT INTO property_schemes (property_id, name, code, billing_entity_id, invoicing_email, sharepoint_folder_url, plan_id, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [propertyId, name, extra.code ?? null, extra.billing_entity_id ?? null, extra.invoicing_email ?? null,
      extra.sharepoint_folder_url ?? null, extra.plan_id ?? null, extra.sort_order ?? sort],
  )).rows[0];
  return { scheme: row, created: true };
}

/** What a new deal on a scheme starts with: the canonical scheme name (from
 *  the deal, else its tenancy unit's grouping), and — only where the deal
 *  has none — the scheme's landlord entity as the invoice contact and its
 *  invoicing email. */
export async function schemeDealDefaults(db: Queryable, deal: {
  propertyId?: string | null; scheme?: string | null; tenancyUnitId?: string | null;
  xeroContactId?: string | null; xeroContactName?: string | null; invoicingEmail?: string | null;
}): Promise<{ scheme?: string; xeroContactName?: string; invoicingEmail?: string }> {
  if (!deal.propertyId) return {};
  const schemes = await listSchemes(db, deal.propertyId);
  if (!schemes.length) return {};
  let label = deal.scheme || null;
  if (!label && deal.tenancyUnitId) {
    label = (await db.query(`SELECT grouping FROM tenancy_schedule_units WHERE id = $1 AND property_id = $2`, [deal.tenancyUnitId, deal.propertyId])).rows[0]?.grouping || null;
  }
  const scheme = findScheme(schemes, label);
  if (!scheme) return {};
  const out: { scheme?: string; xeroContactName?: string; invoicingEmail?: string } = { scheme: scheme.name };
  if (!deal.xeroContactId && !deal.xeroContactName && scheme.billing_entity_id) {
    const entity = (await db.query(`SELECT name FROM crm_companies WHERE id = $1`, [scheme.billing_entity_id])).rows[0];
    if (entity?.name) out.xeroContactName = entity.name;
  }
  if (!deal.invoicingEmail && scheme.invoicing_email) out.invoicingEmail = scheme.invoicing_email;
  return out;
}

async function staffOnly(req: Request, res: Response): Promise<boolean> {
  const { isClientRequestUser } = await import("./company-scope");
  if (await isClientRequestUser(req as any)) { res.status(403).json({ error: "Not available for client accounts" }); return false; }
  return true;
}

export function registerPropertySchemeRoutes(app: Express) {
  app.get("/api/properties/:id/schemes", requireAuth, async (req: Request, res: Response) => {
    try {
      const propertyId = String(req.params.id);
      const { clientBlockedForProperty, isClientRequestUser } = await import("./company-scope");
      if (await clientBlockedForProperty(req as any, propertyId)) return res.status(403).json({ error: "Access denied" });
      const schemes = await listSchemes(pool, propertyId);
      // Clients see the names only — billing entities and inboxes are BGP's.
      if (await isClientRequestUser(req as any)) {
        return res.json({ schemes: schemes.map(s => ({ id: s.id, name: s.name, sortOrder: s.sort_order })), unmatchedLabels: [] });
      }
      const [labels, entities] = await Promise.all([
        pool.query(
          `SELECT label, count(*)::int AS n FROM (
             SELECT grouping AS label FROM tenancy_schedule_units WHERE property_id = $1 AND coalesce(trim(grouping), '') <> ''
             UNION ALL SELECT zone FROM leasing_schedule_units WHERE property_id = $1 AND coalesce(trim(zone), '') <> ''
             UNION ALL SELECT scheme FROM available_units WHERE property_id = $1 AND coalesce(trim(scheme), '') <> ''
           ) x GROUP BY label`,
          [propertyId],
        ),
        pool.query(`SELECT id, name FROM crm_companies WHERE id = ANY($1::text[])`, [schemes.map(s => s.billing_entity_id).filter(Boolean)]),
      ]);
      const entityName = new Map(entities.rows.map((r: any) => [r.id, r.name]));
      const counts = new Map<string, number>();
      const unmatched = new Map<string, { label: string; count: number }>();
      for (const r of labels.rows) {
        const s = findScheme(schemes, r.label);
        if (s) counts.set(s.id, (counts.get(s.id) || 0) + r.n);
        else {
          const k = schemeKey(r.label);
          const u = unmatched.get(k) || { label: String(r.label).trim(), count: 0 };
          u.count += r.n;
          unmatched.set(k, u);
        }
      }
      res.json({
        schemes: schemes.map(s => ({
          id: s.id, name: s.name, code: s.code, billingEntityId: s.billing_entity_id,
          billingEntityName: s.billing_entity_id ? entityName.get(s.billing_entity_id) || null : null,
          invoicingEmail: s.invoicing_email, sharepointFolderUrl: s.sharepoint_folder_url, planId: s.plan_id,
          sortOrder: s.sort_order, unitCount: counts.get(s.id) || 0,
        })),
        unmatchedLabels: [...unmatched.values()].sort((a, b) => b.count - a.count),
      });
    } catch (e: any) {
      console.error("[property-schemes] list failed:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/properties/:id/schemes", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const propertyId = String(req.params.id);
      const property = (await pool.query(`SELECT id FROM crm_properties WHERE id = $1`, [propertyId])).rows[0];
      if (!property) return res.status(404).json({ error: "Property not found" });
      const fields = schemeFields(req.body, { requireName: true });
      const { scheme, created } = await ensureScheme(pool, propertyId, fields.name!, fields);
      if (!created) return res.status(409).json({ error: `${scheme.name} is already a scheme here.` });
      res.status(201).json(scheme);
    } catch (e: any) {
      res.status(e?.status || 500).json({ error: e.message });
    }
  });

  app.put("/api/properties/:id/schemes/:schemeId", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const propertyId = String(req.params.id);
      const current = (await pool.query(`SELECT * FROM property_schemes WHERE id = $1 AND property_id = $2`, [req.params.schemeId, propertyId])).rows[0];
      if (!current) return res.status(404).json({ error: "Scheme not found" });
      const fields = schemeFields(req.body, { requireName: false });
      const entries = Object.entries(fields);
      if (!entries.length) return res.status(400).json({ error: "Nothing to change" });
      if (fields.name && schemeKey(fields.name) !== schemeKey(current.name)) {
        const clash = (await listSchemes(pool, propertyId)).find(s => s.id !== current.id && schemeKey(s.name) === schemeKey(fields.name));
        if (clash) return res.status(409).json({ error: `${clash.name} is already a scheme here.` });
      }
      const sets = entries.map(([k], i) => `${k} = $${i + 3}`).join(", ");
      const updated = (await pool.query(
        `UPDATE property_schemes SET ${sets}, updated_at = now() WHERE id = $1 AND property_id = $2 RETURNING *`,
        [current.id, propertyId, ...entries.map(([, v]) => v)],
      )).rows[0];
      const relabelled = fields.name && fields.name !== current.name ? await relabelScheme(pool, propertyId, current.name, fields.name) : 0;
      res.json({ ...updated, relabelled });
    } catch (e: any) {
      res.status(e?.status || 500).json({ error: e.message });
    }
  });

  app.delete("/api/properties/:id/schemes/:schemeId", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const r = await pool.query(`DELETE FROM property_schemes WHERE id = $1 AND property_id = $2`, [req.params.schemeId, req.params.id]);
      if (!r.rowCount) return res.status(404).json({ error: "Scheme not found" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
