// KYC4U's past checks that name a record's registered companies, wherever the
// matcher filed them (Woody, 25 November 2026, on Sheet Anchor Evolve (London)
// Ltd: KYC4U's REQ103894 was filed on the parent's record). Read only: the
// match itself is changed by Match on the KYC4U grid. The rule is
// shared/kyc4u-names.ts.

import { pool } from "./db";
import { kyc4uCompanyKeys, kyc4uRequestKeys, kyc4uRequestNames } from "@shared/kyc4u-names";

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

export interface Kyc4uNamedRequest {
  listId: string; itemId: string; listName: string | null; title: string | null; status: string | null;
  entityName: string | null; modifiedAt: string | null; createdAt: string | null; webUrl: string | null;
  // The record the matcher filed it on (null: not matched to any company).
  filedOn: { id: string; name: string } | null;
}

const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** For each record: KYC4U's requests that name its own registered company or one filed under it. */
export async function kyc4uRequestsNaming(companyIds: string[], db: Db = pool): Promise<Map<string, Kyc4uNamedRequest[]>> {
  const out = new Map<string, Kyc4uNamedRequest[]>();
  const ids = [...new Set(companyIds.filter(Boolean))];
  if (!ids.length) return out;
  const [names, requests] = await Promise.all([
    db.query(`SELECT c.id, c.uk_entity_name AS n FROM crm_companies c WHERE c.id = ANY($1::text[])
              UNION ALL SELECT c.id, c.companies_house_data->>'company_name' FROM crm_companies c WHERE c.id = ANY($1::text[])
              UNION ALL SELECT e.parent_company_id, e.name FROM crm_trading_entities e WHERE e.parent_company_id = ANY($1::text[])`, [ids]),
    db.query(`SELECT q.list_id, q.item_id, q.list_name, q.title, q.status, q.entity_name, q.modified_at_source, q.created_at_source, q.web_url,
                     q.fields->>'Sections' AS sections,
                     COALESCE(q.company_id_manual, q.company_id, e.parent_company_id) AS filed_id, c.name AS filed_name
                FROM kyc4u_requests q
                LEFT JOIN crm_trading_entities e ON e.id = q.trading_entity_id
                LEFT JOIN crm_companies c ON c.id = COALESCE(q.company_id_manual, q.company_id, e.parent_company_id)
               WHERE q.list_id <> 'manual'`),
  ]);
  const byCompany = new Map<string, string[]>();
  for (const r of names.rows) {
    const id = String(r.id || "");
    if (!id || !r.n) continue;
    byCompany.set(id, [...(byCompany.get(id) || []), String(r.n)]);
  }
  const companyKeys = new Map([...byCompany.entries()].map(([id, list]) => [id, kyc4uCompanyKeys(list)] as const));
  for (const q of requests.rows) {
    const keys = kyc4uRequestKeys(q.entity_name, q.sections);
    if (!keys.length) continue;
    for (const [id, mine] of companyKeys) {
      if (!kyc4uRequestNames(keys, mine)) continue;
      const row: Kyc4uNamedRequest = {
        listId: String(q.list_id), itemId: String(q.item_id), listName: q.list_name ?? null, title: q.title ?? null, status: q.status ?? null,
        entityName: q.entity_name ?? null, modifiedAt: iso(q.modified_at_source), createdAt: iso(q.created_at_source), webUrl: q.web_url ?? null,
        filedOn: q.filed_id ? { id: String(q.filed_id), name: String(q.filed_name || "another company") } : null,
      };
      out.set(id, [...(out.get(id) || []), row]);
    }
  }
  return out;
}
