// Guarantors on a transaction (Woody, 23 November 2026, on Inception T2: "one
// is signing cornhill bar and the other is guaranteeing so should be able to
// allocate add as the guarantor"). The rules are shared/deal-guarantor.ts. A
// guarantor is a company or a person filed under the party it stands behind,
// kept in deal_guarantors (boot migration in server/index.ts). It counts only
// while it is still filed under the party the transaction names and is not
// the company that signs.

import { pool } from "./db";
import { DEAL_PARTY_COLUMNS, signerKindOf } from "@shared/deal-parties";
import { SIGNER_ROLES, guarantorChecksState, guarantorRedFlags, signerRedFlags, type DealGuarantorView, type GuaranteedRole, type SignerRole } from "@shared/deal-guarantor";

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

// The party's brand and its company that signs, by role, for the join. Every
// party role: a guarantor stands behind a tenant or a buyer only (the route
// keeps to that), and another company can sign for any party.
const brandCase = (alias: string) => `CASE g.role ${SIGNER_ROLES.map(r => `WHEN '${r}' THEN ${alias}.${DEAL_PARTY_COLUMNS[r].brand}`).join(" ")} END`;
const signerCase = (alias: string) => `CASE g.role ${SIGNER_ROLES.map(r => `WHEN '${r}' THEN ${alias}.${DEAL_PARTY_COLUMNS[r].company}`).join(" ")} END`;

/** What a deal_guarantors row is: a guarantor, or another company that signs (kind 'signer', 24 November 2026). */
export type ExtraPartyKind = "guarantor" | "signer";

async function extraRows(dealIds: string[], kind: ExtraPartyKind, db: Db): Promise<GuarantorRow[]> {
  const ids = [...new Set(dealIds.filter(Boolean))];
  if (!ids.length) return [];
  const query = (byKind: boolean) => db.query(
    `SELECT g.id, g.deal_id, g.role, g.company_id, g.entity_id, g.added_by_name, g.added_at,
            e.name, e.entity_kind, e.companies_house_number
       FROM deal_guarantors g
       JOIN crm_deals d ON d.id = g.deal_id
       JOIN crm_trading_entities e ON e.id = g.entity_id AND e.parent_company_id = g.company_id
      WHERE g.deal_id = ANY($1::varchar[]) AND g.removed_at IS NULL
        ${byKind ? "AND COALESCE(g.kind, 'guarantor') = $2" : ""}
        AND g.company_id = ${brandCase("d")}
        AND g.entity_id IS DISTINCT FROM ${signerCase("d")}
      ORDER BY g.added_at, g.id`, byKind ? [ids, kind] : [ids]);
  // A database not yet given the kind column (the boot migration, just after a
  // deploy) holds guarantors only: no other company signs there.
  const rows = (await query(true).catch(async (e: any) => {
    if (e?.code !== "42703") throw e;
    return kind === "signer" ? { rows: [] as any[] } : query(false);
  })).rows;
  return rows.map((r: any) => ({
    id: String(r.id), dealId: String(r.deal_id), role: r.role as GuaranteedRole, companyId: String(r.company_id), entityId: String(r.entity_id),
    name: String(r.name || (kind === "signer" ? "The other company that signs" : "The guarantor")), kind: signerKindOf(r.entity_kind),
    companiesHouseNumber: r.companies_house_number ? String(r.companies_house_number).trim() || null : null,
    addedBy: r.added_by_name || null, addedAt: new Date(r.added_at).toISOString(),
  }));
}

/** The live guarantors of these transactions: still filed under the party, never the company that signs. */
export async function guarantorRows(dealIds: string[], db: Db = pool): Promise<GuarantorRow[]> {
  return extraRows(dealIds, "guarantor", db);
}

/** The other companies (or people) that sign for a party, by the same rules: filed under it, never the company that signs. */
export async function signerRows(dealIds: string[], db: Db = pool): Promise<Array<Omit<GuarantorRow, "role"> & { role: SignerRole }>> {
  return extraRows(dealIds, "signer", db) as Promise<Array<Omit<GuarantorRow, "role"> & { role: SignerRole }>>;
}

async function viewsOf<R extends string>(rows: Array<Omit<GuarantorRow, "role"> & { role: R }>, kind: ExtraPartyKind, now: Date): Promise<Array<DealGuarantorView & { role: R; companyId: string }>> {
  if (!rows.length) return [];
  const { latestPrecheck, precheckRunning } = await import("./kyc-prechecks");
  return Promise.all(rows.map(async g => {
    const stored = await latestPrecheck(g.companyId, g.entityId).catch(() => null);
    const running = !!precheckRunning(g.companyId, g.entityId);
    const flags = kind === "signer"
      ? signerRedFlags({ signer: { id: g.entityId, name: g.name }, precheck: stored?.result || null })
      : guarantorRedFlags({ guarantor: { id: g.entityId, name: g.name }, precheck: stored?.result || null });
    return {
      id: g.id, role: g.role, companyId: g.companyId, entityId: g.entityId, name: g.name, kind: g.kind, companiesHouseNumber: g.companiesHouseNumber,
      checks: { state: guarantorChecksState(stored?.ranAt || null, running, now), ranAt: stored?.ranAt || null, redFlags: flags.length },
      addedBy: g.addedBy, addedAt: g.addedAt,
    };
  }));
}

/** Each guarantor with where BGP's checks on it stand, for the party box and the AML box. */
export async function guarantorViews(dealId: string, db: Db = pool, now: Date = new Date()): Promise<Array<DealGuarantorView & { role: GuaranteedRole; companyId: string }>> {
  return viewsOf(await guarantorRows([dealId], db), "guarantor", now);
}

/** Each other company that signs, with where BGP's checks on it stand. */
export async function signerViews(dealId: string, db: Db = pool, now: Date = new Date()): Promise<Array<DealGuarantorView & { role: SignerRole; companyId: string }>> {
  return viewsOf(await signerRows([dealId], db), "signer", now);
}

async function forParty(rows: GuarantorRow[] | Array<Omit<GuarantorRow, "role"> & { role: string }>, companyId: string) {
  const mine = rows.filter(g => g.companyId === companyId);
  if (!mine.length) return [];
  const { latestPrecheck } = await import("./kyc-prechecks");
  return Promise.all(mine.map(async g => ({
    name: g.name, kind: g.kind,
    precheck: (await latestPrecheck(g.companyId, g.entityId).catch(() => null))?.result || null,
  })));
}

/** The guarantors of one party (by its brand) with BGP's checks on each, for the people to check. */
export async function guarantorsForParty(dealId: string, companyId: string, db: Db = pool) {
  return forParty(await guarantorRows([dealId], db), companyId);
}

/** The other companies that sign for one party (by its brand) with BGP's checks on each, for the people to check. */
export async function signersForParty(dealId: string, companyId: string, db: Db = pool) {
  return forParty(await signerRows([dealId], db), companyId);
}

/**
 * The other companies that sign, by transaction and role, with each one's own
 * approval: for the party's state (a party reads cleared only once each is
 * signed off too). A failed read gives null, which the caller reads as "not
 * cleared": never as approved.
 */
export type SignerApproval = { companyId: string; entityId: string; name: string; status: string | null; expiresAt: string | null; scope: "full" | "sanctions_only" | null };
export async function signerApprovals(dealIds: string[], db: Db = pool): Promise<Map<string, SignerApproval[]> | null> {
  try {
    const rows = await signerRows(dealIds, db);
    const out = new Map<string, SignerApproval[]>();
    if (!rows.length) return out;
    const { entitySignOffScope } = await import("@shared/party-kyc");
    const checks = (await db.query(
      `SELECT entity_id, kyc_status, expires_at, approved_at,
              evidence->'bgpSignOff'->>'regime' AS signoff_regime, evidence->'bgpSignOff'->>'at' AS signoff_at
         FROM crm_entity_kyc WHERE entity_kind = 'trading_entity' AND entity_id = ANY($1::text[])`,
      [[...new Set(rows.map(r => r.entityId))]])).rows;
    for (const r of rows) {
      const k = checks.find((c: any) => String(c.entity_id) === r.entityId);
      const key = `${r.dealId}:${r.role}`;
      const list = out.get(key) || [];
      list.push({
        companyId: r.companyId, entityId: r.entityId, name: r.name, status: k?.kyc_status || null,
        expiresAt: k?.expires_at ? new Date(k.expires_at).toISOString() : null,
        scope: k ? entitySignOffScope({ regime: k.signoff_regime, signedOffAt: k.signoff_at, approvedAt: k.approved_at }) : null,
      });
      out.set(key, list);
    }
    return out;
  } catch {
    return null;
  }
}
