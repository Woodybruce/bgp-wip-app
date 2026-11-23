// The people a party's checks are about, read from the records (the rule is
// shared/kyc-people.ts; Woody, 19 November 2026). One read of the deal's
// client checks requests, their files and their identity checks serves every
// party: an identity check passed on someone else's link still counts for
// the person it was.

import { pool } from "./db";
import type { PartyReliance } from "@shared/aml-reliance";
import { partyPeople, verifiedPersonDob, type PartyPeople, type PeopleRequest, type PublicFigureCheck } from "@shared/kyc-people";
import { verifiedPersonName } from "@shared/kyc-prechecks";
import { isKycDocKey, kycIdStateFor, type KycPartyKind, type KycRequestPerson } from "@shared/kyc-request";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Every client checks request on the deal (tests left out), as the people rule reads them. */
export async function dealPeopleRequests(dealId: string, db: Db = pool): Promise<PeopleRequest[]> {
  const rows = (await db.query(
    `SELECT token, company_id, contact_name, request, revoked_at, expires_at, completed_at
       FROM kyc_upload_tokens WHERE deal_id = $1 AND request IS NOT NULL AND is_test IS NOT TRUE
        AND COALESCE(request->>'audience', 'client') <> 'joint_agent' ORDER BY created_at`, [dealId])).rows;
  if (!rows.length) return [];
  const tokens = rows.map((r: any) => r.token);
  const files = (await db.query(
    `SELECT f.token, f.original_filename, f.doc_type, f.uploaded_at, d.file_url, d.id AS document_id
       FROM kyc_upload_files f LEFT JOIN kyc_documents d ON d.id::text = f.kyc_document_id
      WHERE f.token = ANY($1::varchar[]) ORDER BY f.uploaded_at`, [tokens])).rows;
  const sessionIds = [...new Set(rows.flatMap((r: any) => Array.isArray(r.request?.veriffSessionIds) ? r.request.veriffSessionIds : []))];
  const sessions = sessionIds.length ? (await db.query(
    `SELECT session_id, status, verdict_person FROM veriff_sessions WHERE session_id = ANY($1::varchar[])`, [sessionIds])).rows : [];
  const now = Date.now();
  return rows.map((r: any): PeopleRequest => {
    const request = r.request || {};
    const person: KycRequestPerson | null = request.person && typeof request.person.name === "string" ? request.person : null;
    return {
      token: r.token,
      ref: String(request.ref || ""),
      companyId: r.company_id || null,
      recipientName: r.contact_name || null,
      person: person ? { key: String(person.key || ""), name: person.name, roles: Array.isArray(person.roles) ? person.roles : [] } : null,
      ...(request.purpose === "trust_structure" ? { trustDocs: true } : {}),
      cancelled: !!r.revoked_at,
      expired: new Date(r.expires_at).getTime() < now,
      finished: !!r.completed_at,
      sentAt: typeof request.sentAt === "string" ? request.sentAt : null,
      needsIdCheck: !!request.needsIdCheck,
      docs: (Array.isArray(request.docs) ? request.docs : []).filter(isKycDocKey),
      ownerNames: Array.isArray(request.ownerNames) ? request.ownerNames.filter((n: unknown) => typeof n === "string") : [],
      idChecks: (Array.isArray(request.veriffSessionIds) ? request.veriffSessionIds : [])
        .map((id: string) => sessions.find((s: any) => s.session_id === id))
        .filter(Boolean)
        .map((s: any) => ({ state: kycIdStateFor(s.status), verifiedName: verifiedPersonName(s.verdict_person), verifiedDob: verifiedPersonDob(s.verdict_person) })),
      files: files.filter((f: any) => f.token === r.token).map((f: any) => {
        // A proof of address's reading and an officer's acceptance, kept on the request (server/kyc-address-proof.ts).
        const documentId = f.document_id != null ? String(f.document_id) : null;
        return {
          name: f.original_filename, docKey: isKycDocKey(f.doc_type) ? f.doc_type : null,
          uploadedAt: new Date(f.uploaded_at).toISOString(), url: f.file_url || null,
          documentId,
          reading: documentId ? request.addressProofs?.[documentId] || null : null,
          accepted: documentId ? request.addressAccepted?.[documentId] || null : null,
        };
      }),
    };
  });
}

/**
 * The people to check for one party. A company is read from BGP's checks
 * before asking on the company that signs; with none named there is no
 * register to read (the checks wait for it).
 */
export async function partyPeopleFor(party: { companyId: string; entityId: string | null; kind: KycPartyKind; dealId?: string | null }, requests: PeopleRequest[]): Promise<PartyPeople> {
  let precheck: Parameters<typeof partyPeople>[0]["precheck"] = null;
  // A trust or foundation is checked on its own record, with no company that
  // signs (21 November 2026): its checks are read too.
  // A trust's structure applies whether or not a company signs for it (a
  // corporate trustee set as the company that signs: Fortis Green, 23 November 2026).
  const trustRecord = party.kind === "company"
    && (await pool.query(`SELECT 1 FROM crm_companies WHERE id = $1 AND lower(COALESCE(aml_subject_type, '')) = 'trust'`, [party.companyId]).catch(() => ({ rows: [] as any[] }))).rows.length > 0;
  // A UK public body (Layla, 23 November 2026): no owners to verify and nobody owes an ID.
  const publicBody = party.kind === "company" && !party.entityId
    && (await pool.query(`SELECT 1 FROM crm_companies WHERE id = $1 AND lower(COALESCE(aml_subject_type, '')) = 'public_body'`, [party.companyId]).catch(() => ({ rows: [] as any[] }))).rows.length > 0;
  const ownRecord = (trustRecord || publicBody) && !party.entityId;
  // A private individual's own record is checked too: its sanctions lines name
  // the people on that side (22 November 2026: People read "not screened").
  if (party.kind === "individual" || (party.kind === "company" && (party.entityId || ownRecord))) {
    const { latestPrecheck } = await import("./kyc-prechecks");
    precheck = (await latestPrecheck(party.companyId, party.entityId).catch(() => null))?.result || null;
  }
  const { abroadPeopleFor } = await import("./kyc-abroad");
  const abroadPeople = party.kind === "company" ? await abroadPeopleFor(party.companyId, party.entityId).catch(() => []) : [];
  // A trust's structure as BGP recorded it (23 November 2026): its people are the ones to check.
  const trust = trustRecord ? (await import("./trust-structure").then(m => m.trustStructureFor(party.companyId)).catch(() => null))?.structure || null : undefined;
  // The party's guarantors (23 November 2026): a person who guarantees and a
  // guarantor company's owners are checked with the party.
  const guarantors = party.dealId
    ? await import("./deal-guarantors").then(m => m.guarantorsForParty(String(party.dealId), party.companyId)).catch(() => [])
    : [];
  return partyPeople({
    companyId: party.companyId, kind: party.kind, precheck, requests, publicFigures: await publicFiguresFor(party.companyId, party.entityId), abroadPeople,
    // Documents BGP uploaded on the party, read and checked (23 November 2026).
    uploads: await import("./kyc-documents").then(m => m.uploadsFor(party.companyId, party.entityId)).catch(() => []),
    ...(trust !== undefined ? { trust } : {}),
    ...(guarantors.length ? { guarantors } : {}),
    ...(publicBody ? { publicBody: true } : {}),
    reliance: party.dealId ? await relianceFor(party.dealId, party.companyId, party.entityId) : null,
  });
}

/**
 * Another firm's checks BGP relies on for a party on this deal (MLR 2017
 * reg 39; Woody, 21 November 2026), not withdrawn: the latest. Reliance is
 * agreed for one deal, so it is not carried to the party's other deals. A
 * failed read is none.
 */
export async function relianceFor(dealId: string, companyId: string, entityId: string | null, db: Db = pool): Promise<PartyReliance | null> {
  const r = (await db.query(
    `SELECT * FROM kyc_reliance WHERE deal_id = $1 AND company_id = $2 AND trading_entity_id IS NOT DISTINCT FROM $3::varchar AND withdrawn_at IS NULL
      ORDER BY recorded_at DESC LIMIT 1`, [dealId, companyId, entityId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (!r) return null;
  return {
    id: String(r.id), firm: String(r.firm), kind: r.firm_kind, where: r.firm_where === "abroad" ? "abroad" : "uk", country: r.firm_country || null,
    regulator: String(r.regulator || ""), regulatorRef: r.regulator_ref || null, contact: r.contact || null,
    agreedOn: r.agreed_on instanceof Date ? r.agreed_on.toISOString().slice(0, 10) : String(r.agreed_on).slice(0, 10),
    note: String(r.note || ""), by: String(r.recorded_by_name || "an officer"), at: new Date(r.recorded_at).toISOString(),
    documents: Array.isArray(r.document_ids) ? r.document_ids.length : 0,
  };
}

/** The people verified from public sources for a party (the brand and the company that signs), not withdrawn. */
export async function publicFiguresFor(companyId: string, entityId: string | null, db: Db = pool): Promise<PublicFigureCheck[]> {
  const rows = (await db.query(
    `SELECT * FROM kyc_public_figure_checks
      WHERE company_id = $1 AND trading_entity_id IS NOT DISTINCT FROM $2::varchar AND withdrawn_at IS NULL ORDER BY verified_at DESC`,
    [companyId, entityId]).catch(() => ({ rows: [] as any[] }))).rows;
  return rows.map((r: any) => ({
    id: String(r.id), name: String(r.person_name), note: String(r.note || ""), by: String(r.verified_by_name || "an officer"),
    at: new Date(r.verified_at).toISOString(),
    links: Array.isArray(r.links) ? r.links.filter((l: unknown) => typeof l === "string") : [],
    documents: Array.isArray(r.document_ids) ? r.document_ids.length : 0,
    method: r.method === "certified" ? "certified" as const : "public" as const,
  }));
}
