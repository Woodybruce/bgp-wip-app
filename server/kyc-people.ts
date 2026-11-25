// The people a party's checks are about, read from the records (the rule is
// shared/kyc-people.ts; Woody, 19 November 2026). One read of the deal's
// client checks requests, their files and their identity checks serves every
// party: an identity check passed on someone else's link still counts for
// the person it was.

import { pool } from "./db";
import type { PartyReliance } from "@shared/aml-reliance";
import { ID_CHECK_REUSE_YEARS, partyPeople, verifiedPersonDob, type PartyPeople, type PeopleRequest, type PriorAddressProof, type PriorIdCheck, type PublicFigureCheck } from "@shared/kyc-people";
import { verifiedPersonName } from "@shared/kyc-prechecks";
import { isKycDocKey, kycIdStateFor, type KycPartyKind, type KycRequestPerson } from "@shared/kyc-request";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Every client checks request on the deal (tests left out), as the people rule
 * reads them. dealId null: a client file (Woody, 24 November 2026: BGP's
 * client checked with no transaction), the requests with no transaction for
 * that company (and, when given, that sub company).
 */
export async function dealPeopleRequests(dealId: string | null, db: Db = pool, client?: { companyId: string; entityId?: string | null }): Promise<PeopleRequest[]> {
  if (!dealId && !client) return [];
  const rows = (await db.query(
    dealId
      ? `SELECT token, company_id, contact_name, contact_email, request, revoked_at, expires_at, completed_at
           FROM kyc_upload_tokens WHERE deal_id = $1 AND request IS NOT NULL AND is_test IS NOT TRUE
            AND COALESCE(request->>'audience', 'client') <> 'joint_agent' ORDER BY created_at`
      : `SELECT token, company_id, contact_name, contact_email, request, revoked_at, expires_at, completed_at
           FROM kyc_upload_tokens WHERE deal_id IS NULL AND company_id = $1 AND ($2::boolean OR trading_entity_id IS NOT DISTINCT FROM $3::varchar)
            AND request IS NOT NULL AND is_test IS NOT TRUE
            AND COALESCE(request->>'audience', 'client') <> 'joint_agent' ORDER BY created_at`,
    dealId ? [dealId] : [client!.companyId, client!.entityId === undefined, client!.entityId ?? null])).rows;
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
      email: r.contact_email || null,
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
        .map((s: any) => ({ sessionId: s.session_id, state: kycIdStateFor(s.status), verifiedName: verifiedPersonName(s.verdict_person), verifiedDob: verifiedPersonDob(s.verdict_person) })),
      files: files.filter((f: any) => f.token === r.token).map((f: any) => {
        // A proof of address's reading and an officer's acceptance, kept on the request (server/kyc-address-proof.ts).
        const documentId = f.document_id != null ? String(f.document_id) : null;
        return {
          name: f.original_filename, docKey: isKycDocKey(f.doc_type) ? f.doc_type : null,
          uploadedAt: new Date(f.uploaded_at).toISOString(), url: f.file_url || null,
          documentId,
          reading: documentId ? request.addressProofs?.[documentId] || null : null,
          accepted: documentId ? request.addressAccepted?.[documentId] || null : null,
          // Who the sender said it is for (24 November 2026): a hint, never proof.
          forKey: documentId ? request.addressProofFor?.[documentId] || null : null,
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
  // The other companies that sign for the party (24 November 2026), the same way.
  const signers = party.dealId
    ? await import("./deal-guarantors").then(m => m.signersForParty(String(party.dealId), party.companyId)).catch(() => [])
    : [];
  const prior = await priorEvidence(requests.map(r => r.token)).catch(() => ({ idChecks: [], proofs: [] }));
  return partyPeople({
    companyId: party.companyId, kind: party.kind, precheck, requests,
    priorIdChecks: prior.idChecks, priorAddressProofs: prior.proofs, publicFigures: await publicFiguresFor(party.companyId, party.entityId), abroadPeople,
    // Documents BGP uploaded on the party, read and checked (23 November 2026).
    uploads: await import("./kyc-documents").then(m => m.uploadsFor(party.companyId, party.entityId)).catch(() => []),
    ...(trust !== undefined ? { trust } : {}),
    ...(guarantors.length ? { guarantors } : {}),
    ...(signers.length ? { signers } : {}),
    ...(publicBody ? { publicBody: true } : {}),
    reliance: party.dealId ? await relianceFor(party.dealId, party.companyId, party.entityId) : null,
  });
}

/**
 * Identity checks passed, and proofs of address sent, on other transactions
 * and client files (Woody, 25 November 2026: a person already verified is not
 * asked again). Test requests are left out, and the requests in hand (their
 * evidence is read already). The rules for who they count for are in
 * shared/kyc-people.ts (priorIdCheckFor, priorAddressProofFor).
 */
export async function priorEvidence(excludeTokens: string[], db: Db = pool): Promise<{ idChecks: PriorIdCheck[]; proofs: PriorAddressProof[] }> {
  const where = (deal: string | null, company: string | null) =>
    deal ? `another transaction, ${deal}` : company ? `the client file for ${company}` : "another transaction";
  const ids = (await db.query(
    `SELECT s.session_id, s.verdict_person, COALESCE(s.received_at, s.created_at) AS at, t.token, t.contact_email,
            t.request->>'ref' AS ref, d.name AS deal_name, c.name AS company_name
       FROM veriff_sessions s
       JOIN kyc_upload_tokens t ON t.request->'veriffSessionIds' ? s.session_id
       LEFT JOIN crm_deals d ON d.id = t.deal_id
       LEFT JOIN crm_companies c ON c.id = t.company_id
      WHERE lower(COALESCE(s.status, '')) = 'approved' AND s.verdict_person IS NOT NULL
        AND t.is_test IS NOT TRUE AND NOT (t.token = ANY($1::varchar[]))
        AND COALESCE(s.received_at, s.created_at) > now() - interval '${ID_CHECK_REUSE_YEARS} years'
      ORDER BY at DESC LIMIT 5000`, [excludeTokens])).rows;
  const idChecks: Array<PriorIdCheck & { token: string }> = ids.flatMap((r: any) => {
    const name = verifiedPersonName(r.verdict_person);
    if (!name) return [];
    return [{
      sessionId: String(r.session_id), verifiedName: name, verifiedDob: verifiedPersonDob(r.verdict_person),
      email: r.contact_email || null, at: new Date(r.at).toISOString(), where: where(r.deal_name, r.company_name),
      ref: r.ref || null, token: String(r.token),
    }];
  });
  const files = (await db.query(
    `SELECT f.token, f.original_filename, f.uploaded_at, d.file_url, d.id AS document_id, t.contact_email, t.request,
            td.name AS deal_name, c.name AS company_name
       FROM kyc_upload_files f
       JOIN kyc_upload_tokens t ON t.token = f.token
       LEFT JOIN kyc_documents d ON d.id::text = f.kyc_document_id
       LEFT JOIN crm_deals td ON td.id = t.deal_id
       LEFT JOIN crm_companies c ON c.id = t.company_id
      WHERE f.doc_type = 'proof_of_address' AND t.is_test IS NOT TRUE AND NOT (f.token = ANY($1::varchar[]))
        AND f.uploaded_at > now() - interval '400 days'
      ORDER BY f.uploaded_at DESC LIMIT 5000`, [excludeTokens])).rows;
  const proofs: PriorAddressProof[] = files.flatMap((f: any) => {
    const documentId = f.document_id != null ? String(f.document_id) : null;
    const reading = documentId ? f.request?.addressProofs?.[documentId] || null : null;
    if (!reading) return [];
    return [{
      token: String(f.token), ref: f.request?.ref || null, where: where(f.deal_name, f.company_name),
      email: f.contact_email || null, documentId, fileName: String(f.original_filename || "Proof of address"), url: f.file_url || null,
      uploadedAt: new Date(f.uploaded_at).toISOString(), reading,
      forKey: documentId ? f.request?.addressProofFor?.[documentId] || null : null,
      idChecks: idChecks.filter(c => c.token === String(f.token)),
    }];
  });
  return { idChecks, proofs };
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
