// Who may use the folder engine, and the records a folder hangs on (Woody,
// 24 November 2026; docs/folders-review-2026-11-20.md, 4.6). BGP staff signed
// in as themselves link, unlink, label, colour, search, browse and act on
// folders, with their own Microsoft 365. A client login, staff viewing as a
// client and a session scoped to a company are refused here: they see their
// data room through /api/client/sharepoint/, as before.
import type { Request } from "express";
import { isFolderRecordType, type FolderRecordRef, type FolderRecordType } from "@shared/folders";

export type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export interface FolderStaff { userId: string; name: string; email: string }

/** BGP staff signed in as themselves, else null. */
export async function folderStaff(req: Request, db: Db): Promise<FolderStaff | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("../contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await db.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { userId: String(u.id), name: String(u.name || u.email || ""), email: String(u.email || "") } : null;
}

export interface FolderRecord extends FolderRecordRef { propertyId: string | null; propertyName: string | null }

// Each record's name and, for a transaction, scheme, Lease Advisory matter
// or Pathway run, its property (whose folders it also shows).
const RECORD_SQL: Record<FolderRecordType, string> = {
  property: `SELECT id, name, NULL::text AS property_id FROM crm_properties WHERE id = $1`,
  deal: `SELECT id, name, property_id FROM crm_deals WHERE id = $1`,
  company: `SELECT id, name, NULL::text AS property_id FROM crm_companies WHERE id = $1`,
  scheme: `SELECT id, name, property_id FROM property_schemes WHERE id = $1`,
  pla_matter: `SELECT m.id, initcap(replace(m.matter_type, '_', ' ')) || COALESCE(' · ' || p.name, '') AS name, m.property_id
                 FROM pla_matters m LEFT JOIN crm_properties p ON p.id = m.property_id WHERE m.id = $1`,
  pathway_run: `SELECT id, address AS name, property_id FROM property_pathway_runs WHERE id = $1`,
};

/** The record, when it exists. BGP staff may open any record. */
export async function folderRecord(db: Db, type: unknown, id: unknown): Promise<FolderRecord | null> {
  if (!isFolderRecordType(type) || typeof id !== "string" || !id || id.length > 100) return null;
  const row = (await db.query(RECORD_SQL[type], [id])).rows[0];
  if (!row) return null;
  const property = row.property_id ? (await db.query(`SELECT id, name FROM crm_properties WHERE id = $1`, [String(row.property_id)])).rows[0] : null;
  return { type, id: String(row.id), name: String(row.name || ""), propertyId: property ? String(property.id) : null, propertyName: property ? String(property.name || "") : null };
}

const NAME_SQL: Record<FolderRecordType, string> = {
  property: `SELECT id, name FROM crm_properties WHERE id = ANY($1::text[])`,
  deal: `SELECT id, name FROM crm_deals WHERE id = ANY($1::text[])`,
  company: `SELECT id, name FROM crm_companies WHERE id = ANY($1::text[])`,
  scheme: `SELECT id, name FROM property_schemes WHERE id = ANY($1::text[])`,
  pla_matter: `SELECT id, initcap(replace(matter_type, '_', ' ')) AS name FROM pla_matters WHERE id = ANY($1::text[])`,
  pathway_run: `SELECT id, address AS name FROM property_pathway_runs WHERE id = ANY($1::text[])`,
};
/** Names of several records, for "Also linked to". A record that has gone has no name and is left out. */
export async function recordNames(db: Db, refs: { type: string; id: string }[]): Promise<Map<string, string>> {
  const byType = new Map<FolderRecordType, Set<string>>();
  for (const r of refs) {
    if (!isFolderRecordType(r.type)) continue;
    (byType.get(r.type) || byType.set(r.type, new Set()).get(r.type)!).add(r.id);
  }
  const out = new Map<string, string>();
  for (const [type, ids] of byType) {
    const rows = (await db.query(NAME_SQL[type], [[...ids]]).catch(() => ({ rows: [] as any[] }))).rows;
    for (const row of rows) out.set(`${type}:${row.id}`, String(row.name || ""));
  }
  return out;
}
