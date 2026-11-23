// Guarantors on a transaction (Woody, 23 November 2026, on Inception T2: "one
// is signing cornhill bar and the other is guaranteeing so should be able to
// allocate add as the guarantor"). The rules are shared/deal-guarantor.ts. A
// guarantor is a company or a person filed under the party it stands behind,
// kept in deal_guarantors (boot migration in server/index.ts). It counts only
// while it is still filed under the party the transaction names and is not
// the company that signs.

import { pool } from "./db";
import { DEAL_PARTY_COLUMNS, signerKindOf } from "@shared/deal-parties";
import { GUARANTEED_ROLES, guarantorChecksState, guarantorRedFlags, type DealGuarantorView, type GuaranteedRole } from "@shared/deal-guarantor";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export interface GuarantorRow {
  id: string;
  dealId: string;
  role: GuaranteedRole;
  companyId: string;
  entityId: string;
  name: string;
  kind: "company" | "individual";
  companiesHouseNumber: string | null;
  addedBy: string | null;
  addedAt: string;
}

// The party's brand and its company that signs, by role, for the join.
const brandCase = (alias: string) => `CASE g.role ${GUARANTEED_ROLES.map(r => `WHEN '${r}' THEN ${alias}.${DEAL_PARTY_COLUMNS[r].brand}`).join(" ")} END`;
const signerCase = (alias: string) => `CASE g.role ${GUARANTEED_ROLES.map(r => `WHEN '${r}' THEN ${alias}.${DEAL_PARTY_COLUMNS[r].company}`).join(" ")} END`;

/** The live guarantors of these transactions: still filed under the party, never the company that signs. */
export async function guarantorRows(dealIds: string[], db: Db = pool): Promise<GuarantorRow[]> {
  const ids = [...new Set(dealIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = (await db.query(
    `SELECT g.id, g.deal_id, g.role, g.company_id, g.entity_id, g.added_by_name, g.added_at,
            e.name, e.entity_kind, e.companies_house_number
       FROM deal_guarantors g
       JOIN crm_deals d ON d.id = g.deal_id
       JOIN crm_trading_entities e ON e.id = g.entity_id AND e.parent_company_id = g.company_id
      WHERE g.deal_id = ANY($1::varchar[]) AND g.removed_at IS NULL
        AND g.company_id = ${brandCase("d")}
        AND g.entity_id IS DISTINCT FROM ${signerCase("d")}
      ORDER BY g.added_at, g.id`, [ids])).rows;
  return rows.map((r: any) => ({
    id: String(r.id), dealId: String(r.deal_id), role: r.role as GuaranteedRole, companyId: String(r.company_id), entityId: String(r.entity_id),
    name: String(r.name || "The guarantor"), kind: signerKindOf(r.entity_kind),
    companiesHouseNumber: r.companies_house_number ? String(r.companies_house_number).trim() || null : null,
    addedBy: r.added_by_name || null, addedAt: new Date(r.added_at).toISOString(),
  }));
}

/** Each guarantor with where BGP's checks on it stand, for the party box and the AML box. */
export async function guarantorViews(dealId: string, db: Db = pool, now: Date = new Date()): Promise<Array<DealGuarantorView & { role: GuaranteedRole; companyId: string }>> {
  const rows = await guarantorRows([dealId], db);
  if (!rows.length) return [];
  const { latestPrecheck, precheckRunning } = await import("./kyc-prechecks");
  return Promise.all(rows.map(async g => {
    const stored = await latestPrecheck(g.companyId, g.entityId).catch(() => null);
    const running = !!precheckRunning(g.companyId, g.entityId);
    return {
      id: g.id, role: g.role, companyId: g.companyId, entityId: g.entityId, name: g.name, kind: g.kind, companiesHouseNumber: g.companiesHouseNumber,
      checks: {
        state: guarantorChecksState(stored?.ranAt || null, running, now), ranAt: stored?.ranAt || null,
        redFlags: guarantorRedFlags({ guarantor: { id: g.entityId, name: g.name }, precheck: stored?.result || null }).length,
      },
      addedBy: g.addedBy, addedAt: g.addedAt,
    };
  }));
}

/** The guarantors of one party (by its brand) with BGP's checks on each, for the people to check. */
export async function guarantorsForParty(dealId: string, companyId: string, db: Db = pool) {
  const rows = (await guarantorRows([dealId], db)).filter(g => g.companyId === companyId);
  if (!rows.length) return [];
  const { latestPrecheck } = await import("./kyc-prechecks");
  return Promise.all(rows.map(async g => ({
    name: g.name, kind: g.kind,
    precheck: (await latestPrecheck(g.companyId, g.entityId).catch(() => null))?.result || null,
  })));
}
