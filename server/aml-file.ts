// The AML file (Woody, 20 November 2026: "an option for the AML officers to
// generate a report to include all the documents etc which we can then send
// to HMRC if asked? Also we can send to KYC4U if we get stuck and need them so
// they can move quicker").
//
//   GET  /api/deals/:id/aml-file?role=&format=zip|pdf   one party, or every party on the deal
//   POST /api/deals/:id/aml-file/kyc4u   410: KYC4U is no longer used (23 November 2026)
//
// The Nominated Officer and the Deputies only (admins until a Nominated
// Officer is set): decider() in server/deal-party-aml.ts. The report says
// everything BGP holds on a party's checks, read by the same functions as the
// deal's AML box; the ZIP adds every document on the party's KYC record as it
// is stored. These are BGP's records under MLR 2017 reg 40, which HMRC, BGP's
// supervisor, can ask for. Never in it: the AML register (internal reports to
// the Nominated Officer, suspicious activity reports), because the file may
// leave BGP (tipping off, POCA 2002 s.333A). Each file made is written on the
// party's KYC history and the deal's history, with who made it.
//
// Filed for KYC4U, the report is a KYC document of type "aml_file" on the
// party (the company that signs when the deal names one), so Request KYC4U
// check offers it with the other documents and the bookmark attaches it.

import { guarantorLine, type DealGuarantorView } from "@shared/deal-guarantor";
import { KYC4U_RETIRED_WORDS } from "@shared/kyc4u-portal";
import type { JointAgentPartyView } from "@shared/joint-agent-checks";
import { Router, type Request, type Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { pool } from "./db";
import { getFile } from "./file-storage";
import { DEAL_PARTY_COLUMNS, DEAL_PARTY_LABEL, DEAL_PARTY_ROLES, dealClientRole, isDealPartyRole, type DealPartyRole } from "@shared/deal-parties";
import { amlRegime, type PartyDueDiligence } from "@shared/aml-policy";
import { amlFileName, amlFileDocWords, amlFileSafeName, amlFileStateWords, amlStillNeeded } from "@shared/aml-file";
import { amlDeadline } from "@shared/aml-dashboard";
import type { KycRedFlag, SetAsideFlag } from "@shared/kyc-red-flags";
import type { PartyPeople } from "@shared/kyc-people";
import type { PartyKycState } from "@shared/party-kyc";
import { buildRiskAssessment, type RiskAssessment } from "@shared/aml-risk-assessment";
import type { SolicitorCheck } from "@shared/solicitor-aml";

const router = Router();
const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const day = (v: unknown): string => {
  if (!v) return "";
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
};
const when = (v: unknown): string => {
  if (!v) return "";
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
};

// ── What the file holds ─────────────────────────────────────────────────────

export interface AmlFileDoc {
  id: string; type: string; name: string; at: string | null; note: string | null;
  url: string | null; mime: string | null; size: number | null; onCompany: boolean;
}

export interface AmlFileParty {
  role: DealPartyRole;
  brand: { id: string; name: string; number: string | null };
  company: { id: string; name: string; number: string | null } | null;
  person: { name: string; email: string | null } | null;
  individual: boolean;
  state: PartyKycState | null;
  notRequired: { reasonWords: string; comment: string | null; by: string | null; at: string | null } | null;
  precheck: { state: string; ranAt: string | null; lines: Array<{ label: string; state: string; detail: string | null; links: Array<{ label: string; url: string }> }>; errors: string[]; company: any; charity?: any; gleif?: string | null } | null;
  flags: KycRedFlag[];
  aside: SetAsideFlag[];
  level: PartyDueDiligence | null;
  people: PartyPeople | null;
  requests: any[];
  kyc4u: { drafts: any[]; records: any[] };
  history: Array<{ at: string | null; who: string | null; what: string; detail: string | null }>;
  documents: AmlFileDoc[];
  // A record that could not be read: the report says so, never that there was nothing.
  unread: string[];
  // BGP acts for this party (dealClientRole), and it is recorded as a trust.
  client: boolean;
  trust: boolean;
  // The written risk assessment in KYC4U's shape (shared/aml-risk-assessment.ts, 21 November 2026).
  riskAssessment: RiskAssessment | null;
  // What BGP recorded against a company abroad that owns it (21 November 2026).
  abroadRecords?: Array<{ ownerName: string; kind: string; note: string | null; personName: string | null; detail: string | null; by: string; at: string }>;
  // The joint agent asked for their checks on this party, and what came back (22 November 2026).
  joint?: JointAgentPartyView | null;
  // A trust's structure as BGP recorded it, as lines (23 November 2026); null when not a trust.
  trustStructure?: string[] | null;
  // A tenant's or buyer's guarantors, with where BGP's checks on each stand (23 November 2026).
  guarantors?: DealGuarantorView[];
}

export interface AmlFileData {
  deal: {
    id: string; name: string; ref: string | null; type: string | null; status: string | null; property: string | null;
    agents: string[]; rentPa: number | null;
  };
  regime: { regime: string; why: string };
  // The officers do enhanced checks in-house (22 November 2026).
  inHouse?: boolean;
  agents: Array<{ roleWords: string; name: string; words: string }>;
  dealFlags: KycRedFlag[];
  dealAside: SetAsideFlag[];
  unchecked: string[];
  parties: AmlFileParty[];
  // The other side's solicitors as checked (server/solicitor-aml.ts), and the
  // deal's heads of terms: the unit's final agreed file, else the text made in
  // the app (21 November 2026).
  solicitors: SolicitorCheck[];
  hots: { file: { name: string; url: string } | null; text: string | null; version: number | null } | null;
  madeBy: string;
  madeAt: string;
}

const HISTORY_FIELDS = ["aml_sign_off", "aml_sdd_note", "kyc4u_result", "aml_red_flag", "aml_person_contact", "aml_not_required", "aml_reliance", "aml_public_figure", "aml_stopped", "client_checks_sent", "client_checks_link", "aml_file"];

/** Everything BGP holds on the checks of the deal's parties (all of them, or the roles given). */
export async function gatherAmlFile(dealId: string, roles: DealPartyRole[] | null, me: { id: string; name: string }): Promise<AmlFileData | null> {
  const partyCols = DEAL_PARTY_ROLES.flatMap(r => [`d.${DEAL_PARTY_COLUMNS[r].brand}`, `d.${DEAL_PARTY_COLUMNS[r].company}`]);
  const deal = (await pool.query(
    `SELECT d.id, d.name, d.deal_ref, d.deal_type, d.status, d.team, d.rent_pa, d.internal_agent, d.internal_agent_ids, d.bgp_acting_for,
            ${partyCols.join(", ")}, p.name AS property_name, p.postcode AS property_postcode
       FROM crm_deals d LEFT JOIN crm_properties p ON p.id = d.property_id WHERE d.id = $1`, [dealId])).rows[0];
  if (!deal) return null;
  const present = DEAL_PARTY_ROLES.filter(r => text(deal[DEAL_PARTY_COLUMNS[r].brand]) && (!roles || roles.includes(r)));
  const agentIds: string[] = Array.isArray(deal.internal_agent_ids) ? deal.internal_agent_ids.filter(Boolean) : [];
  const agentNames: string[] = Array.isArray(deal.internal_agent) ? deal.internal_agent.map(text).filter(Boolean) : [];
  const agentUsers = agentIds.length ? (await pool.query(`SELECT id, name FROM users WHERE id = ANY($1::varchar[])`, [agentIds])).rows : [];
  const agents = [...new Set([...agentNames, ...agentUsers.map((u: any) => text(u.name)).filter(Boolean)])];

  const { loadDealParties, dealPartyCompanies } = await import("./deal-parties");
  const { loadPartyKyc } = await import("./deal-gates");
  const { loadNotRequired } = await import("./aml-policy");
  const { dealPrechecks } = await import("./kyc-prechecks");
  const { loadDealRedFlags } = await import("./kyc-red-flags");
  const { dealPeopleRequests, partyPeopleFor } = await import("./kyc-people");
  const { clientChecksForDeal } = await import("./aml-portal");
  const { dealAgentsAml } = await import("./agent-aml");

  const signs = await dealPartyCompanies(pool, dealId).catch(() => ({} as Record<string, string>));
  const view = await loadDealParties(pool, dealId).catch(() => null);
  const brandIds = present.map(r => text(deal[DEAL_PARTY_COLUMNS[r].brand]));
  const kinds = (await pool.query(
    `SELECT id, lower(COALESCE(aml_subject_type, '')) AS kind FROM crm_companies WHERE id = ANY($1::varchar[]) AND lower(COALESCE(aml_subject_type, '')) IN ('individual', 'trust', 'public_body')`, [brandIds])).rows;
  const individuals = new Set(kinds.filter((r: any) => r.kind === "individual").map((r: any) => String(r.id)));
  // A trust or foundation is checked on its own record too (21 November 2026).
  const signsItself = new Set(kinds.map((r: any) => String(r.id)));
  const [states, marks, prechecks, flags, peopleRequests, requests, agentRows] = await Promise.all([
    loadPartyKyc(pool, present.map(r => ({ role: r, brandId: text(deal[DEAL_PARTY_COLUMNS[r].brand]), entityId: signs[text(deal[DEAL_PARTY_COLUMNS[r].brand])] || null }))).catch(() => ({} as Record<string, PartyKycState>)),
    loadNotRequired(pool, [dealId]).catch(() => new Map()),
    dealPrechecks(dealId, brandIds.map(id => ({ companyId: id, entityId: signs[id] || null, needsCompany: !signs[id] && !signsItself.has(id) })), { userId: me.id, autoStart: false }).catch(() => ({} as Record<string, any>)),
    loadDealRedFlags(dealId, brandIds, signs).catch(() => null),
    dealPeopleRequests(dealId).catch(() => null),
    clientChecksForDeal(dealId).catch((e: any) => { console.warn(`[aml-file] could not read the client checks: ${e?.message}`); return null; }),
    dealAgentsAml(pool, dealId).catch(() => null),
  ]);
  const jointView = await import("./joint-agent-checks").then(m => m.jointChecksForDeal(dealId)).catch((e: any) => { console.warn(`[aml-file] could not read the joint agent's checks: ${e?.message}`); return null; });
  const { dealSolicitorsAml } = await import("./solicitor-aml");
  const solicitors = (await dealSolicitorsAml(pool, dealId).catch(() => null))?.checks || [];
  const hotsRow = (await pool.query(
    `SELECT au.hots_content, au.hots_version, f.file_name AS final_name, f.file_path AS final_path
       FROM available_units au LEFT JOIN unit_marketing_files f ON f.id = au.hots_final_file_id AND f.unit_id = au.id
      WHERE au.deal_id = $1 ORDER BY (au.hots_final_file_id IS NOT NULL) DESC, au.updated_at DESC NULLS LAST LIMIT 1`, [dealId]).catch(() => ({ rows: [] as any[] }))).rows[0] || null;
  const hots = hotsRow && (hotsRow.final_path || text(hotsRow.hots_content))
    ? { file: hotsRow.final_path ? { name: text(hotsRow.final_name) || "Final heads of terms", url: String(hotsRow.final_path) } : null,
        text: hotsRow.final_path ? null : String(hotsRow.hots_content || ""), version: hotsRow.hots_version == null ? null : Number(hotsRow.hots_version) }
    : null;
  const clientRole = dealClientRole({ dealType: deal.deal_type, bgpActingFor: deal.bgp_acting_for, team: deal.team });
  const trusts = new Set((await pool.query(
    `SELECT id FROM crm_companies WHERE id = ANY($1::varchar[]) AND lower(COALESCE(aml_subject_type, '')) = 'trust'`, [brandIds]).catch(() => ({ rows: [] as any[] }))).rows.map((r: any) => String(r.id)));

  const parties: AmlFileParty[] = [];
  for (const role of present) {
    const brandId = text(deal[DEAL_PARTY_COLUMNS[role].brand]);
    const entityId = signs[brandId] || null;
    const brand = (await pool.query(`SELECT id, name, companies_house_number FROM crm_companies WHERE id = $1`, [brandId])).rows[0];
    if (!brand) continue;
    const pv = view?.parties.find(p => p.role === role) || null;
    const mark = (marks as Map<string, any>).get(`${dealId}:${role}`);
    // A person who signs is a private individual (the party view's kind).
    const kind = pv ? pv.brand.kind : individuals.has(brandId) ? "individual" : "company";
    const unread: string[] = [];
    const read = <T,>(what: string, run: Promise<T>, empty: T): Promise<T> => run.catch((e: any) => {
      unread.push(what);
      console.warn(`[aml-file] could not read ${what} for ${brandId}: ${e?.message}`);
      return empty;
    });
    const people = peopleRequests ? await read("the people to check", partyPeopleFor({ companyId: brandId, entityId, kind, dealId }, peopleRequests), null) : null;
    if (!peopleRequests) unread.push("the people to check");
    const [drafts, records, kycHistory, dealHistory, docs] = await Promise.all([
      read("the KYC4U requests raised", pool.query(
        `SELECT d.id, d.status, d.created_at, d.filled_at, d.request_item_id, q.web_url AS request_url, q.status AS request_status, q.title AS request_title
           FROM kyc4u_drafts d LEFT JOIN kyc4u_requests q ON q.list_id = d.request_list_id AND q.item_id = d.request_item_id
          WHERE d.deal_id = $1 AND d.company_id = $2 ORDER BY d.created_at DESC LIMIT 20`, [dealId, brandId]).then(r => r.rows), [] as any[]),
      read("KYC4U's records", pool.query(
        `SELECT list_id, title, status, entity_name, fields, web_url, created_at_source, modified_at_source, synced_at
           FROM kyc4u_requests
          WHERE company_id = $1 OR company_id_manual = $1 OR ($2::varchar IS NOT NULL AND trading_entity_id = $2)
          ORDER BY COALESCE(modified_at_source, created_at_source, synced_at) DESC NULLS LAST LIMIT 20`, [brandId, entityId]).then(r => r.rows), [] as any[]),
      read("the KYC history", pool.query(
        `SELECT action, performed_by, notes, created_at FROM kyc_audit_log
          WHERE company_id = $1 OR ($2::text <> '' AND entity_kind = 'trading_entity' AND entity_id = $2)
          ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 200`, [brandId, entityId || ""]).then(r => r.rows), [] as any[]),
      read("the transaction's AML history", pool.query(
        `SELECT field, new_value, reason, changed_by_name, created_at FROM deal_audit_log
          WHERE deal_id = $1 AND (field = ANY($2::text[]) OR field IN ($3, $4))
          ORDER BY created_at DESC NULLS LAST LIMIT 200`,
        [dealId, HISTORY_FIELDS, DEAL_PARTY_COLUMNS[role].company, DEAL_PARTY_COLUMNS[role].person]).then(r => r.rows), [] as any[]),
      read("the documents on the KYC record", pool.query(
        `SELECT id, doc_type, file_name, file_url, mime_type, file_size, uploaded_at, notes, trading_entity_id
           FROM kyc_documents
          WHERE deleted_at IS NULL AND company_id = $1 AND (trading_entity_id IS NULL OR trading_entity_id = $2)
          ORDER BY uploaded_at ASC NULLS LAST, id ASC LIMIT 400`, [brandId, entityId]).then(r => r.rows), [] as any[]),
    ]);
    const pre = (prechecks as Record<string, any>)[brandId] || null;
    if (!pre) unread.push("BGP's checks before asking");
    const abroadRecords = kind === "company" ? await read("what BGP recorded about companies abroad",
      import("./kyc-abroad").then(m => m.abroadRecordsFor(brandId, entityId)), []) : [];
    if (!Array.isArray(requests)) unread.push("the client checks");
    const trustStructure = trusts.has(brandId) ? await read("the trust's structure", import("./trust-structure").then(async m => {
      const { trustStructureLines } = await import("@shared/trust-structure");
      const r = await m.trustStructureFor(brandId);
      return r ? trustStructureLines(r.structure, text(brand.name)) : ["No structure recorded yet."];
    }), null as string[] | null) : null;
    if (!flags) unread.push("the red flags");
    parties.push({
      role,
      brand: { id: brandId, name: text(brand.name), number: text(brand.companies_house_number) || null },
      company: pv?.company ? { id: pv.company.id, name: pv.company.name, number: pv.company.companiesHouseNumber || null } : null,
      person: pv?.person ? { name: pv.person.name, email: pv.person.email || null } : null,
      guarantors: pv?.guarantors || [],
      individual: kind === "individual",
      state: (states as Record<string, PartyKycState>)[role] || null,
      notRequired: mark && mark.companyId === brandId ? { reasonWords: mark.reasonWords, comment: mark.comment || null, by: mark.by || null, at: mark.at || null } : null,
      precheck: pre ? { state: pre.state, ranAt: pre.ranAt, lines: pre.lines || [], errors: pre.errors || [], company: pre.company || null, charity: pre.charity || null, gleif: pre.gleif || null } : null,
      flags: flags?.parties?.[brandId] || [],
      aside: flags?.setAside?.[brandId] || [],
      level: flags?.levels?.[brandId] || null,
      people,
      requests: Array.isArray(requests) ? requests.filter((r: any) => r.companyId === brandId) : [],
      kyc4u: { drafts, records },
      history: [
        ...kycHistory.map((h: any) => ({ at: h.created_at ? new Date(h.created_at).toISOString() : null, who: text(h.performed_by) || null, what: text(h.action).replace(/_/g, " "), detail: text(h.notes) || null })),
        ...dealHistory.filter((h: any) => h.field !== "aml_file").map((h: any) => ({ at: h.created_at ? new Date(h.created_at).toISOString() : null, who: text(h.changed_by_name) || null, what: text(h.field).replace(/_/g, " "), detail: text(h.reason || h.new_value) || null })),
      ].sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime()),
      documents: docs.map((d: any) => ({
        id: String(d.id), type: text(d.doc_type) || "document", name: text(d.file_name) || "file", at: d.uploaded_at ? new Date(d.uploaded_at).toISOString() : null,
        note: text(d.notes) || null, url: text(d.file_url) || null, mime: text(d.mime_type) || null, size: d.file_size == null ? null : Number(d.file_size),
        onCompany: !!d.trading_entity_id,
      })),
      unread,
      client: role === clientRole,
      trust: trusts.has(brandId),
      riskAssessment: null,
      abroadRecords: abroadRecords.map(r => ({ ownerName: r.ownerName, kind: r.kind, note: r.note, personName: r.person?.name || null, detail: r.person?.detail || null, by: r.by, at: r.at })),
      joint: jointView?.parties.find(j => j.companyId === brandId && j.requests.length) || null,
      trustStructure,
    });
  }
  const data: AmlFileData = {
    deal: {
      id: String(deal.id), name: text(deal.name) || "Untitled deal", ref: deal.deal_ref == null ? null : String(deal.deal_ref),
      type: text(deal.deal_type) || null, status: text(deal.status) || null,
      property: [text(deal.property_name), text(deal.property_postcode)].filter(Boolean).join(", ") || null,
      agents, rentPa: deal.rent_pa == null ? null : Number(deal.rent_pa),
    },
    regime: amlRegime({ dealType: deal.deal_type, team: deal.team, rentPa: deal.rent_pa }),
    inHouse: await import("./aml-authority").then(m => m.readInHouseEdd()).then(v => !!v.on).catch(() => true),
    agents: (agentRows?.agents || []).map((a: any) => ({ roleWords: text(a.roleWords), name: text(a.name), words: text(a.state?.words) })),
    dealFlags: flags?.deal || [],
    dealAside: flags?.dealSetAside || [],
    unchecked: flags?.unchecked || [],
    parties,
    solicitors,
    hots,
    madeBy: me.name,
    madeAt: new Date().toISOString(),
  };
  for (const p of data.parties) {
    try { p.riskAssessment = riskAssessmentFor(data, p); }
    catch (e: any) { p.unread.push("the risk assessment"); console.warn(`[aml-file] risk assessment for ${p.brand.id}: ${e?.message}`); }
  }
  return data;
}

/** KYC4U's latest result for the party: the reading of their report kept on a result added in the app, else their latest status. */
function latestKyc4u(records: any[]): RiskAssessmentKyc4uInput {
  const latest = records[0];
  if (!latest) return null;
  const withReading = records.find(r => r?.fields && typeof r.fields === "object" && r.fields["KYC4U assessment"]);
  const pick = withReading || latest;
  const fields = pick.fields && typeof pick.fields === "object" ? pick.fields : {};
  return {
    status: text(pick.status) || null,
    at: pick.modified_at_source || pick.created_at_source || pick.synced_at ? new Date(pick.modified_at_source || pick.created_at_source || pick.synced_at).toISOString() : null,
    recordedBy: String(pick.list_id || "").startsWith("manual") ? text(fields["Recorded by"]) || null : null,
    assessment: fields["KYC4U assessment"] || null,
  };
}
type RiskAssessmentKyc4uInput = Parameters<typeof buildRiskAssessment>[0]["party"]["kyc4u"];

/** The written risk assessment for one party, from what the file gathered. */
export function riskAssessmentFor(data: AmlFileData, p: AmlFileParty): RiskAssessment {
  return buildRiskAssessment({
    inHouse: !!data.inHouse || p.trust,
    deal: { name: data.deal.name, ref: data.deal.ref, type: data.deal.type, property: data.deal.property, agents: data.deal.agents, regimeWhy: data.regime.why },
    party: {
      roleLabel: DEAL_PARTY_LABEL[p.role], name: p.company?.name || p.brand.name, brandName: p.brand.name, client: p.client,
      individual: p.individual, trust: p.trust, person: p.person ? { name: p.person.name } : null,
      company: p.precheck?.company || null,
      charity: p.precheck?.charity || null,
      gleif: p.precheck?.gleif || null,
      precheckRan: !!p.precheck?.ranAt,
      webRan: !!p.precheck?.lines?.some(l => l.state !== "not_run" && /^Public roles and adverse media/.test(l.label)),
      flags: p.flags, aside: p.aside, level: p.level, people: p.people, requests: p.requests,
      state: p.state ? { status: p.state.status, approvedBy: p.state.approvedBy, approvedAt: p.state.approvedAt ?? null, expiresAt: p.state.expiresAt } : null,
      notRequired: p.notRequired ? { reasonWords: p.notRequired.reasonWords } : null,
      documents: p.documents.map(d => ({ type: d.type, name: d.name })),
      kyc4u: latestKyc4u(p.kyc4u.records),
      abroadRecords: p.abroadRecords || [],
    },
    dealFlags: data.dealFlags,
    agents: data.agents,
    solicitors: data.solicitors,
  });
}

// ── The documents themselves ────────────────────────────────────────────────

/** A document's bytes, as stored: the app's file store, or a Veriff result written out from its session. */
export async function amlFileDocBytes(doc: AmlFileDoc): Promise<{ data: Buffer; ext: string } | { missing: string }> {
  const url = doc.url || "";
  const media = url.match(/^\/api\/chat-media\/([^/?#]+)$/);
  if (media) {
    const stored = await getFile(`chat-media/${decodeURIComponent(media[1])}`).catch(() => null);
    if (!stored) return { missing: "not found in the app's file store" };
    return { data: stored.data, ext: path.extname(media[1]) || path.extname(doc.name) || "" };
  }
  // A unit's own files (the final agreed heads of terms, 21 November 2026).
  const unitFile = url.match(/^\/uploads\/marketing-files\/([^/?#]+)$/);
  if (unitFile) {
    const stored = await getFile(`marketing-files/${decodeURIComponent(unitFile[1])}`).catch(() => null);
    if (!stored) return { missing: "not found in the app's file store" };
    return { data: stored.data, ext: path.extname(unitFile[1]) || path.extname(doc.name) || "" };
  }
  const veriff = url.match(/^\/api\/veriff\/sessions\/([^/?#]+)\/report$/);
  if (veriff) {
    const s = (await pool.query(`SELECT * FROM veriff_sessions WHERE session_id = $1`, [decodeURIComponent(veriff[1])]).catch(() => ({ rows: [] as any[] }))).rows[0];
    if (!s) return { missing: "the Veriff session is no longer held" };
    const json = {
      sessionId: s.session_id, askedOf: [s.first_name, s.last_name].filter(Boolean).join(" ") || null, status: s.status,
      decisionCode: s.decision_code, decisionReason: s.decision_reason, person: s.verdict_person, document: s.verdict_document,
      started: s.created_at, decided: s.received_at,
    };
    return { data: Buffer.from(JSON.stringify(json, null, 2)), ext: ".json" };
  }
  if (/^https?:\/\//i.test(url)) return { missing: `held outside the app: ${url}` };
  return { missing: url ? `held at ${url}, which the file cannot read` : "no file was kept" };
}

// ── The report ──────────────────────────────────────────────────────────────

const ID_WORDS: Record<string, string> = {
  approved: "passed", submitted: "done, waiting for Veriff's result", started: "started", retry: "asked to try again",
  restart: "needs starting again", not_started: "not started",
};

const BORDEAUX = "#6E0C25";
const INK = "#1c1917";
const MUTED = "#6b6560";
const RULE = "#d8d2cb";
const AMBER = "#92400e";
const RED = "#991b1b";
const GREEN = "#166534";

function assetPath(...parts: string[]): string | null {
  for (const base of [path.join(process.cwd(), "server/assets"), path.join(process.cwd(), "dist/server/assets")]) {
    const p = path.join(base, ...parts);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function fontPath(file: string): string | null {
  const p = path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts", file);
  return fs.existsSync(p) ? p : null;
}

type Doc = any;

class Writer {
  doc: Doc;
  body = "Helvetica";
  bold = "Helvetica-Bold";
  constructor(doc: Doc) {
    this.doc = doc;
    const regular = fontPath("LiberationSans-Regular.ttf");
    const strong = fontPath("LiberationSans-Bold.ttf");
    if (regular && strong) {
      doc.registerFont("Body", regular);
      doc.registerFont("Bold", strong);
      this.body = "Body";
      this.bold = "Bold";
    }
  }
  get left() { return this.doc.page.margins.left; }
  get width() { return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right; }
  room(h: number) {
    if (this.doc.y + h > this.doc.page.height - this.doc.page.margins.bottom) this.doc.addPage();
  }
  title(t: string) {
    this.room(40);
    this.doc.moveDown(0.8);
    this.doc.font(this.bold).fontSize(13).fillColor(BORDEAUX).text(t, this.left, this.doc.y, { width: this.width });
    const y = this.doc.y + 2;
    this.doc.moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(0.6).strokeColor(RULE).stroke();
    this.doc.y = y + 6;
  }
  sub(t: string) {
    this.room(26);
    this.doc.moveDown(0.3);
    this.doc.font(this.bold).fontSize(10).fillColor(INK).text(t, this.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.15);
  }
  kv(label: string, value: string | null | undefined, colour = INK) {
    const v = String(value ?? "").split("\n").map(text).filter(Boolean).join("\n") || "Not recorded";
    const lw = 128;
    const vw = this.width - lw - 8;
    this.doc.font(this.body).fontSize(9);
    const h = Math.max(this.doc.heightOfString(label, { width: lw }), this.doc.heightOfString(v, { width: vw }));
    this.room(h + 3);
    const y = this.doc.y;
    this.doc.font(this.body).fontSize(9).fillColor(MUTED).text(label, this.left, y, { width: lw });
    this.doc.font(this.body).fontSize(9).fillColor(text(value) ? colour : MUTED).text(v, this.left + lw + 8, y, { width: vw });
    this.doc.y = y + h + 3;
  }
  para(t: string, colour = INK, size = 9) {
    const v = text(t);
    if (!v) return;
    this.doc.font(this.body).fontSize(size);
    this.room(this.doc.heightOfString(v, { width: this.width }) + 3);
    this.doc.fillColor(colour).text(v, this.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.25);
  }
  item(mark: string, t: string, colour = INK, detail?: string | null) {
    const v = text(t);
    if (!v) return;
    const indent = 14;
    this.doc.font(this.body).fontSize(9);
    const d = String(detail || "").split("\n").map(text).filter(Boolean).join("\n");
    const h = this.doc.heightOfString(v, { width: this.width - indent }) + (d ? this.doc.heightOfString(d, { width: this.width - indent }) : 0);
    this.room(h + 4);
    const y = this.doc.y;
    this.doc.font(this.bold).fontSize(9).fillColor(colour).text(mark, this.left, y, { width: indent });
    this.doc.font(this.body).fontSize(9).fillColor(colour).text(v, this.left + indent, y, { width: this.width - indent });
    if (d) this.doc.font(this.body).fontSize(8.5).fillColor(MUTED).text(d, this.left + indent, this.doc.y, { width: this.width - indent });
    this.doc.y += 3;
  }
}

const RISK_COLOUR = { ok: GREEN, attention: AMBER, info: INK } as const;

/** BGP's written risk assessment (21 November 2026). */
function writeRiskAssessment(w: Writer, ra: RiskAssessment) {
  w.sub("Risk assessment");
  w.para("BGP's written risk assessment. Every line is read from the checks below.", MUTED, 8.5);
  for (const r of ra.job) w.kv(r.label, r.value, RISK_COLOUR[r.tone]);
  w.sub("Risk details");
  for (const h of ra.risks) w.kv(`${h.label}: ${h.value}`, h.details.join("\n") || "None", h.value === "Higher" ? AMBER : INK);
  w.sub("Standard or enhanced due diligence");
  for (const r of ra.diligence) w.kv(r.label, r.value, RISK_COLOUR[r.tone]);
  if (ra.structure.length) {
    w.sub("The structure, its ownership and the evidence");
    for (const e of ra.structure) w.item("•", `${e.name}: ${e.location}, country risk ${e.countryRisk.toLowerCase()}, ${e.orgType.toLowerCase()}`, INK, e.evidence.join("\n"));
  }
  w.sub("Beneficial owners");
  if (ra.ownersNote) w.para(ra.ownersNote, MUTED);
  for (const o of ra.owners) {
    w.item("•", `${o.name}: nationality ${o.nationality}, residence ${o.residence}. Verified by: ${o.idMethod}. Owner risk ${o.risk.toLowerCase()}; PEP ${o.pep.toLowerCase()}`, o.risk === "Higher" ? AMBER : INK, o.evidence.join("\n"));
  }
  if (ra.certified.length) { w.sub("Certified documents"); for (const c of ra.certified) w.item("•", c); }
  w.sub("Detailed risk assessment");
  w.kv("Risk identified", ra.riskIdentified.join("\n") || "No risk identified.", ra.riskIdentified.length ? AMBER : GREEN);
  w.kv("Mitigating factors", ra.mitigating.join("\n") || (ra.riskIdentified.length ? "None recorded." : "Not required, as no risk has been identified."));
  w.kv("Overall conclusion", ra.conclusion.join("\n"));
  w.sub("Counterparty details");
  for (const r of ra.counterparty) w.kv(r.label, r.value, RISK_COLOUR[r.tone]);
  w.sub("Approvals");
  for (const r of ra.approvals) w.kv(r.label, r.value, RISK_COLOUR[r.tone]);
}

const JOINT_STATUS_WORDS: Record<string, string> = {
  not_sent: "the email did not go", sent: "asked, nothing back yet", opened: "they opened the link", in: "their checks came in",
  finished: "they finished", expired: "the link ran out", cancelled: "cancelled",
};

function writeJointAgent(w: Writer, j: JointAgentPartyView) {
  w.sub("The joint agent's checks");
  for (const r of j.requests) {
    w.item("•", `${r.manual ? "Added from their email" : "Request"} ${r.ref} to ${r.firm}${r.to ? ` (${r.to}${r.toEmail ? ` <${r.toEmail}>` : ""})` : ""}: ${JOINT_STATUS_WORDS[r.status] || r.status}`, r.status === "cancelled" ? MUTED : INK, [
      r.manual ? "Files the joint agent emailed to BGP, added by BGP" : r.sentAt ? `asked ${when(r.sentAt)}${r.sentBy ? ` by ${r.sentBy}` : ""}` : `not sent${r.sendError ? `: ${r.sendError}` : ""}`,
      r.openedAt ? `opened ${when(r.openedAt)}` : null,
      r.finishedAt ? `finished ${when(r.finishedAt)}` : null,
      r.reliance ? `reliance terms agreed by ${[r.reliance.name, r.reliance.position].filter(Boolean).join(", ")} of ${r.reliance.firm} on ${when(r.reliance.agreedAt)}; supervised by ${r.reliance.supervisor}${r.reliance.registration ? ` (${r.reliance.registration})` : ""}` : null,
      ...r.files.map(f => `${f.name} (${day(f.uploadedAt)}): ${f.reading?.state === "read" ? [f.reading.title || f.reading.kind, (f.reading.people || []).map(x => x.name).join(", ") || null, f.reading.result || null].filter(Boolean).join(", ") : f.reading?.why || "not read yet"}`),
    ].filter(Boolean).join("\n"));
  }
  const current = j.requests.find(r => r.status !== "cancelled");
  if (current?.chases.length) {
    w.kv("Asked for what was missing", current.chases.map(ch => `${when(ch.at)}${ch.auto ? " (by the app)" : `, ${ch.by}`}: ${ch.missing.join("; ")}`).join("\n")
      + (current.chaseStoppedAt ? `\nThe app stopped chasing on ${when(current.chaseStoppedAt)}.` : ""));
  }
  if (j.gaps.length) w.kv("Still missing", j.gaps.join("\n"), AMBER);
  const c = j.coverage;
  if (!c) return;
  for (const person of c.people) {
    w.item(person.missing.length ? "!" : "•", `${person.name}: ${person.missing.length ? `not covered: ${person.missing.join(" and ")}` : "identity and address covered"}`, person.missing.length ? AMBER : INK,
      [person.id ? `identity: ${person.id}` : null, person.address ? `address: ${person.address}` : null].filter(Boolean).join("\n") || null);
  }
  if (c.company) w.kv("The company", [c.company.register ? `register: ${c.company.register}` : "register entry not sent", c.company.ownership ? `ownership: ${c.company.ownership}` : "ownership not sent"].join("; "), c.company.register && c.company.ownership ? INK : AMBER);
  w.kv("Screening", c.screening || "not sent", c.screening ? INK : AMBER);
  for (const f of c.flags) w.item("!", f, RED, null);
  if (c.others.length) w.kv("Also named in their files", c.others.join(", "));
  if (c.unread) w.kv("Not read", `${c.unread} file${c.unread === 1 ? "" : "s"}: open them on the transaction`, AMBER);
}

/** What the party still needs, from what the file holds (shared/aml-file.ts amlStillNeeded). */
export function stillNeededFor(data: AmlFileData, p: AmlFileParty, now: Date = new Date()): string[] {
  const status = String(p.state?.status || "").toLowerCase();
  const expires = p.state?.expiresAt ? new Date(p.state.expiresAt as any).getTime() : null;
  const settled = status === "rejected" ? "rejected" as const
    : p.notRequired ? "not_required" as const
    : status === "approved" && (expires === null || expires >= now.getTime()) ? "approved" as const : null;
  const pre = p.precheck;
  const ranAt = pre?.ranAt ? new Date(pre.ranAt).getTime() : null;
  const precheck = !pre || pre.state === "none" || pre.state === "cap" ? "not_run" as const
    : pre.state === "off" ? "off" as const
    : pre.state === "running" || pre.state === "waiting" ? "running" as const
    : pre.state === "done" && ranAt !== null && now.getTime() - ranAt > 30 * 86400000 ? "old" as const : "done" as const;
  const openRequests = (p.requests || []).filter((r: any) => !["cancelled", "expired", "finished"].includes(String(r.status)));
  return amlStillNeeded({
    deadline: amlDeadline(p.role, data.deal.status, p.client ? p.role : "other"),
    settled,
    needsCompany: !p.individual && !p.trust,
    companySet: !!p.company,
    precheck,
    flags: p.flags.map(f => ({ label: f.label, factor: !!f.factor })),
    level: p.level?.level || null,
    sanctionsOnly: data.regime.regime === "sanctions_only",
    peopleOutstanding: p.people?.outstanding || [],
    requests: openRequests.map((r: any) => ({
      ref: String(r.ref || ""),
      to: text(r.person?.name) || text(r.recipientName) || text(r.recipientEmail) || "the client",
      missing: [
        ...(r.needsIdCheck && !["approved", "submitted"].includes(String(r.idState || "")) ? ["identity check"] : []),
        // "Photo ID" reads "photo ID" in a sentence; "ID for each owner" keeps its capitals.
        ...(r.docs || []).filter((d: any) => !d.done).map((d: any) => String(d.title || "")).filter(Boolean)
          .map((t: string) => /^[A-Z][A-Z]/.test(t) ? t : t[0].toLowerCase() + t.slice(1)),
      ],
    })),
    anyRequest: (p.requests || []).some((r: any) => String(r.status) !== "cancelled"),
    jointGaps: p.joint?.gaps || [],
    trustGaps: p.trust && (p.trustStructure || []).some(l => /^No structure recorded/.test(l)) ? ["add the trust's information: what kind of trust, who set it up, the trustees and who benefits"] : [],
    guarantors: (p.guarantors || []).map(g => ({ name: g.name, state: g.checks.state })),
  });
}

function writeParty(w: Writer, data: AmlFileData, p: AmlFileParty, docNames: Map<string, string>) {
  const doc = w.doc;
  const name = p.company?.name || p.brand.name;
  w.title(`${DEAL_PARTY_LABEL[p.role]}: ${name}`);
  if (p.riskAssessment) {
    writeRiskAssessment(w, p.riskAssessment);
    w.sub("The checks in detail");
  }
  w.kv("Brand on the transaction", p.brand.name);
  w.kv(p.individual ? "Who signs" : "Company that signs", p.individual ? (p.company ? `${p.company.name}, a private individual` : "A private individual") : p.company ? `${p.company.name}${p.company.number ? ` (Companies House ${p.company.number})` : ""}` : "Not set on the transaction", p.individual || p.company ? INK : AMBER);
  w.kv("Person dealing with BGP", p.person ? `${p.person.name}${p.person.email ? `, ${p.person.email}` : ""}` : null);
  if (p.guarantors?.length) w.kv(p.guarantors.length > 1 ? "Guarantors" : "Guarantor", p.guarantors.map(g => guarantorLine(g)).join("\n"),
    p.guarantors.some(g => g.checks.state !== "done") ? AMBER : INK);
  if (p.trustStructure) w.kv("Trust structure (recorded by BGP)", p.trustStructure.join("\n"));
  const state = amlFileStateWords(p.state, p.notRequired);
  w.kv("Where it stands", state.words, state.tone === "done" ? GREEN : state.tone === "flag" ? RED : AMBER);
  if (p.level) {
    w.kv("Due diligence", `${p.level.level[0].toUpperCase()}${p.level.level.slice(1)} (approval lasts ${p.level.recheckYears} year${p.level.recheckYears === 1 ? "" : "s"})`, p.level.level === "enhanced" ? AMBER : INK);
    w.kv("Why", p.level.why.join("; "));
    if (p.level.toWeigh.length) w.kv("To weigh", p.level.toWeigh.join("; "));
  }
  if (p.notRequired?.comment) w.kv("Not required because", p.notRequired.comment);
  if (p.unread.length) w.kv("Could not be read", `${[...new Set(p.unread)].join("; ")}. Make the file again, or check these on the transaction.`, RED);

  // What is still needed at this point, in BGP's AML policy's order (Issue 4).
  const still = stillNeededFor(data, p);
  w.kv("Still needed", still.join("\n"), still.length === 1 && still[0].startsWith("Nothing") ? GREEN : AMBER);

  // The company, as the register gives it.
  const c = p.precheck?.company;
  if (c) {
    w.sub("The company at Companies House");
    w.kv("Name and number", `${c.name} (${c.number})`);
    w.kv("Type and status", [c.type, c.status, c.incorporatedOn ? `incorporated ${c.incorporatedOn}` : null].filter(Boolean).join(", "));
    if (c.registeredOffice) w.kv("Registered office", c.registeredOffice);
    if (c.business?.length) w.kv("Business", c.business.join("; "));
    if (c.listing) w.kv("Listed", `${c.listing}. ${c.listingNote || ""}`);
    if (c.overseasEntity) w.kv("Overseas entities register", c.overseasEntity);
    if (c.directors?.length) w.kv("Directors", c.directors.join(", "));
    if (c.owners?.length) w.kv("Owners (PSC register)", c.owners.map((o: any) => `${o.name} (${o.control})`).join("; "));
    if (c.ownerNote) w.kv("Owners", c.ownerNote);
    if (c.chain?.length) w.kv("Owned through", c.chain.join(" > "));
    if (c.accounts) w.kv("Latest accounts", c.accounts);
    if (c.warnings?.length) w.kv("Warnings", c.warnings.join("; "), RED);
    w.kv("Register", c.registerUrl);
  }

  // BGP's checks before asking.
  w.sub("BGP's checks before asking anyone");
  if (!p.precheck || p.precheck.state === "off") w.para("Not run.", MUTED);
  else if (p.precheck.state === "needs_company") w.para("Not run: the transaction does not name the company that signs, and the checks are about that company.", AMBER);
  else {
    if (p.precheck.ranAt) w.para(`Run ${when(p.precheck.ranAt)}: Companies House, the UK, US and EU sanctions lists, ComplyAdvantage where it answered, and a web search for public roles and adverse media.`, MUTED);
    for (const l of p.precheck.lines) {
      const mark = l.state === "attention" ? "!" : "•";
      const colour = l.state === "attention" ? AMBER : l.state === "ok" ? INK : MUTED;
      w.item(mark, l.label, colour, [l.detail, ...l.links.map(k => `${k.label}: ${k.url}`)].filter(Boolean).join("\n"));
    }
    if (p.precheck.errors.length) w.para(`Could not be read: ${p.precheck.errors.join("; ")}.`, AMBER);
  }

  // Red flags and higher-risk factors.
  w.sub("Red flags and higher-risk factors");
  const live = p.flags;
  if (!live.length && !p.aside.length) w.para("None found.", GREEN);
  for (const f of live) {
    w.item("!", `${f.factor ? "Higher-risk factor" : "Red flag"}: ${f.label}`, f.factor ? AMBER : RED,
      [f.detail, ...(f.facts || []).map(x => `${x.label}: ${x.value}${x.url ? ` (${x.url})` : ""}`), `Found by ${f.source}${f.at ? `, ${day(f.at)}` : ""}`].filter(Boolean).join("\n"));
  }
  for (const a of p.aside) {
    w.item("•", `Set aside: ${a.flag.label}`, MUTED, `${a.review.by ? `By ${a.review.by}` : "Set aside"}${a.review.at ? `, ${day(a.review.at)}` : ""}: "${a.review.comment}"`);
  }

  // The people the checks need.
  if (p.people && p.people.basis !== "individual") {
    w.sub("People to check");
    for (const person of p.people.people) {
      const id = person.id.state === "passed" ? "identity check passed" : person.id.state === "waiting" ? "identity check done, waiting for Veriff's result"
        : person.id.state === "document" ? "photo ID sent, for the MLRO to check" : person.id.state === "not_started" ? "identity check not done" : `identity check: ${person.id.state.replace(/_/g, " ")}`;
      const proof = person.address.proof;
      const address = person.address.done
        ? `proof of address: ${proof?.summary || "received"}${proof?.accepted ? ` (accepted by ${proof.accepted.by}: ${proof.accepted.note})` : ""}`
        : proof ? `proof of address to check: ${proof.summary}${proof.reasons.length ? ` (${proof.reasons.join("; ")})` : ""}` : "proof of address not sent";
      w.item("•", `${person.name} (${person.roles.join(", ")})${person.born ? `, born ${person.born}` : ""}`, person.outstanding.length ? AMBER : INK,
        [person.ownerDetail, `${id}${person.id.elsewhere ? ` ${person.id.elsewhere}` : ""}${person.id.someoneElse ? ` (the check on their link was ${person.id.someoneElse}'s)` : ""}`, address,
          `sanctions: ${person.sanctions.replace(/_/g, " ")}`].filter(Boolean).join("\n"));
    }
    if (p.people.directors.length) w.kv("Directors (sanctions only)", p.people.directors.map(d => `${d.name} (${d.sanctions.replace(/_/g, " ")})`).join("; "));
  }

  // The client checks sent and what came back.
  w.sub("Client checks");
  if (!p.requests.length) w.para("None sent.", MUTED);
  for (const r of p.requests) {
    const steps = [
      ...(r.needsIdCheck ? [`identity check: ${r.idOtherPerson ? `done by ${r.idVerifiedName || "someone else"}, not ${r.recipientName || "the person it was for"}` : ID_WORDS[r.idState || "not_started"] || String(r.idState).replace(/_/g, " ")}`] : []),
      ...(r.docs || []).map((d: any) => `${d.title}: ${d.done ? "received" : "outstanding"}${d.note ? ` (${d.note})` : ""}`),
    ];
    const answers = [
      r.askPep ? `public roles (MLR 2017 reg 35): ${r.pep || "not answered"}${r.pepDetail ? `, ${r.pepDetail}` : ""}` : null,
      r.owners ? `owners on the register: ${r.owners.answer || "not answered"}${r.owners.detail ? `, ${r.owners.detail}` : ""}` : null,
      ...(r.notAsked || []).map((n: any) => `not asked for ${n.key.replace(/_/g, " ")}: ${n.reason}`),
    ].filter(Boolean);
    const files = (r.files || []).map((f: any) => `${f.name} (${day(f.uploadedAt)})`);
    w.item("•", `${r.person ? `${r.person.name}'s own link` : "Request"} ${r.ref} to ${r.recipientName || r.recipientEmail || "the client"}${r.recipientEmail ? ` <${r.recipientEmail}>` : ""}: ${String(r.status).replace(/_/g, " ")}`,
      INK, [
        r.sentAt ? `sent ${when(r.sentAt)}${r.sentBy ? ` by ${r.sentBy}` : ""}${r.sentFrom ? ` from ${r.sentFrom}` : ""}${r.remindersSent ? `, ${r.remindersSent} reminder(s)` : ""}` : `not sent${r.sendError ? `: ${r.sendError}` : ""}`,
        r.openedAt ? `opened ${when(r.openedAt)}` : null,
        r.finishedAt ? `finished ${when(r.finishedAt)}` : null,
        ...steps, ...answers,
        files.length ? `files: ${files.join("; ")}` : null,
      ].filter(Boolean).join("\n"));
  }

  // The joint agent's checks (HMRC: AMLG2200 s21 on a sale; a reliance agreement on a letting).
  if (p.joint) writeJointAgent(w, p.joint);

  // KYC4U.
  w.sub("KYC4U (past checks)");
  if (!p.kyc4u.drafts.length && !p.kyc4u.records.length) w.para("None. KYC4U is no longer used (since 23 November 2026).", MUTED);
  for (const d of p.kyc4u.drafts) {
    w.item("•", `Request prepared ${day(d.created_at)}: ${d.status === "queued" ? "waiting to be filled on KYC4U's form" : d.status === "filled" ? `filled on KYC4U's form ${day(d.filled_at)}` : d.status === "submitted" ? "raised with KYC4U" : d.status}`,
      INK, [d.request_title ? `KYC4U's request: ${d.request_title}` : null, d.request_status ? `their status: ${d.request_status}` : null, d.request_url].filter(Boolean).join("\n"));
  }
  for (const k of p.kyc4u.records) {
    const fields = k.fields && typeof k.fields === "object" ? k.fields : {};
    const manual = String(k.list_id || "").startsWith("manual");
    w.item("•", `${manual ? "Result added in the app" : "KYC4U's record"}: ${k.status || "no status"}${k.entity_name ? ` (${k.entity_name})` : ""}`, INK,
      [k.title, manual ? [fields.reference ? `reference ${fields.reference}` : null, fields.note || null, fields.addedBy ? `added by ${fields.addedBy}` : null].filter(Boolean).join(", ") : null,
        day(k.modified_at_source || k.created_at_source || k.synced_at), k.web_url].filter(Boolean).join("\n"));
  }

  // The history, oldest first.
  w.sub("History");
  if (!p.history.length) w.para("Nothing recorded.", MUTED);
  for (const h of p.history) w.item("•", `${when(h.at)}${h.who ? `, ${h.who}` : ""}: ${h.what}`, INK, h.detail);

  // The documents.
  w.sub("Documents on the KYC record");
  if (!p.documents.length) w.para("None held.", MUTED);
  else if (!docNames.size) w.para("The documents themselves are in the ZIP version of this file (Report and every document).", MUTED);
  for (const d of p.documents) {
    const inFile = docNames.get(`${p.role}:${d.id}`);
    w.item("•", `${d.name} (${amlFileDocWords(d.type)}${d.at ? `, ${day(d.at)}` : ""}${d.onCompany ? ", the company that signs" : ""})`, INK,
      [inFile ? (inFile.startsWith("(") ? `Not included: ${inFile.replace(/^\(not included: |\)$/g, "")}` : `In this file as ${inFile}`) : null, d.note].filter(Boolean).join("\n"));
  }
  void doc;
}

/** The report, as a PDF. docNames: where each document sits in the ZIP (role:id), or what kept it out. */
export async function renderAmlReport(data: AmlFileData, docNames: Map<string, string> = new Map()): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const subject = data.parties.length === 1 ? (data.parties[0].company?.name || data.parties[0].brand.name) : data.deal.name;
  const doc = new PDFDocument({
    size: "A4", margins: { top: 56, bottom: 60, left: 50, right: 50 }, bufferPages: true,
    info: { Title: `AML file: ${subject}`, Author: "Bruce Gillingham Pollard", Subject: "Customer due diligence records (MLR 2017 reg 40)" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>(resolve => doc.on("end", () => resolve()));
  const w = new Writer(doc);

  const logo = assetPath("branding", "BGP_BlackWordmark_trimmed.png") || assetPath("BGP_BlackHolder.png");
  if (logo) { try { doc.image(logo, w.left, 40, { width: 120 }); } catch { /* the report reads without it */ } }
  doc.y = 92;
  doc.font(w.bold).fontSize(18).fillColor(INK).text("AML file", w.left, doc.y, { width: w.width });
  doc.font(w.body).fontSize(11).fillColor(INK).text(subject, { width: w.width });
  doc.moveDown(0.3);
  doc.font(w.body).fontSize(9).fillColor(MUTED)
    .text(`${data.deal.name}${data.deal.ref ? ` (Ref ${data.deal.ref})` : ""}. Made ${when(data.madeAt)} by ${data.madeBy}.`, { width: w.width });
  doc.moveDown(0.5);
  doc.font(w.body).fontSize(8.5).fillColor(MUTED).text(
    "Confidential. Bruce Gillingham Pollard's customer due diligence records for this transaction, kept under the Money Laundering Regulations 2017 (reg 40): " +
    "what BGP checked, what the client sent, the decisions made and by whom, and the documents held. Internal reports to the Nominated Officer are kept in BGP's AML register and are not part of this file.",
    { width: w.width });

  w.title("The transaction");
  w.kv("Transaction", `${data.deal.name}${data.deal.ref ? ` (Ref ${data.deal.ref})` : ""}`);
  w.kv("Type and stage", [data.deal.type, data.deal.status].filter(Boolean).join(", "));
  w.kv("Property", data.deal.property);
  w.kv("BGP's agents", data.deal.agents.join(", ") || null);
  w.kv("Checks needed", data.regime.why);
  if (data.agents.length) w.kv("Other agents", data.agents.map(a => `${a.roleWords}: ${a.name}. ${a.words}`).join("\n"));
  w.kv("Heads of terms", data.hots?.file ? `${data.hots.file.name}: the final agreed heads of terms${docNames.get("hots") ? `, in this file as ${docNames.get("hots")}` : ""}`
    : data.hots?.text ? `Drawn up in the app${data.hots.version ? ` (version ${data.hots.version})` : ""}${docNames.get("hots") ? `, in this file as ${docNames.get("hots")}` : ""}`
    : "None held in the app for this transaction (any on a party's KYC record are listed with its documents)");
  for (const f of data.dealFlags) w.item("!", `On the transaction record: ${f.label}`, f.factor ? AMBER : RED, f.detail);
  for (const a of data.dealAside) w.item("•", `Set aside on the transaction record: ${a.flag.label}`, MUTED, `${a.review.by || ""}${a.review.at ? `, ${day(a.review.at)}` : ""}: "${a.review.comment}"`);
  if (data.unchecked.length) w.para(`Red flags could not be checked against: ${data.unchecked.join(", ")}.`, AMBER);

  for (const p of data.parties) writeParty(w, data, p, docNames);

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(w.body).fontSize(7.5).fillColor(MUTED)
      .text(`Bruce Gillingham Pollard · AML file · ${subject} · Confidential · page ${i - range.start + 1} of ${range.count}`,
        w.left, doc.page.height - 38, { width: w.width, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** The ZIP: per party, the report and every document as stored. Over the size cap, a document is listed and left out. */
export async function buildAmlZip(data: AmlFileData, capBytes = 200 * 1024 * 1024): Promise<{ zip: Buffer; included: number; missing: number }> {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip();
  const top = amlFileSafeName(amlFileName(data, "folder"));
  const docNames = new Map<string, string>();
  const files: Array<{ path: string; data: Buffer }> = [];
  let total = 0, included = 0, missing = 0;
  // The deal's heads of terms (21 November 2026): the final agreed file, else the text drawn up in the app.
  if (data.hots?.file) {
    const got = await amlFileDocBytes({ id: "hots", type: "heads_of_terms", name: data.hots.file.name, at: null, note: null, url: data.hots.file.url, mime: null, size: null, onCompany: false });
    if ("missing" in got) missing += 1;
    else {
      const name = `00 Heads of terms - ${amlFileSafeName(data.hots.file.name.replace(/\.[A-Za-z0-9]{1,6}$/, ""))}${path.extname(data.hots.file.name) || got.ext}`;
      files.push({ path: `${top}/${name}`, data: got.data });
      docNames.set("hots", name);
      total += got.data.length;
      included += 1;
    }
  } else if (data.hots?.text) {
    const name = `00 Heads of terms${data.hots.version ? ` version ${data.hots.version}` : ""}.txt`;
    files.push({ path: `${top}/${name}`, data: Buffer.from(data.hots.text, "utf8") });
    docNames.set("hots", name);
    included += 1;
  }
  for (const p of data.parties) {
    const folder = data.parties.length > 1 ? `${top}/${amlFileSafeName(`${DEAL_PARTY_LABEL[p.role]} - ${p.company?.name || p.brand.name}`)}` : top;
    let n = 0;
    for (const d of p.documents) {
      n += 1;
      const got = await amlFileDocBytes(d);
      if ("missing" in got) { missing += 1; docNames.set(`${p.role}:${d.id}`, `(not included: ${got.missing})`); continue; }
      if (total + got.data.length > capBytes) { missing += 1; docNames.set(`${p.role}:${d.id}`, "(not included: the file would be over 200 MB; download it from the deal)"); continue; }
      const base = d.name.replace(/\.[A-Za-z0-9]{1,6}$/, "");
      const ext = path.extname(d.name) || got.ext;
      const name = `${String(n).padStart(2, "0")} ${amlFileSafeName(`${amlFileDocWords(d.type)} - ${base}`)}${ext}`;
      files.push({ path: `${folder}/documents/${name}`, data: got.data });
      docNames.set(`${p.role}:${d.id}`, `documents/${name}`);
      total += got.data.length;
      included += 1;
    }
  }
  for (const p of data.parties) {
    const folder = data.parties.length > 1 ? `${top}/${amlFileSafeName(`${DEAL_PARTY_LABEL[p.role]} - ${p.company?.name || p.brand.name}`)}` : top;
    const one: AmlFileData = { ...data, parties: [p] };
    zip.addFile(`${folder}/00 AML report - ${amlFileSafeName(p.company?.name || p.brand.name)}.pdf`, await renderAmlReport(one, docNames));
  }
  for (const f of files) zip.addFile(f.path, f.data);
  return { zip: zip.toBuffer(), included, missing };
}

// ── Who may make it, and the record that they did ───────────────────────────

async function officer(req: Request) {
  const { decider } = await import("./deal-party-aml");
  return decider(req);
}

async function recordMade(data: AmlFileData, me: { id: string; name: string }, how: string) {
  for (const p of data.parties) {
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'aml_file', $2, $3)`,
      [p.brand.id, me.name, `AML file ${how} for ${data.deal.name}: ${p.documents.length} document${p.documents.length === 1 ? "" : "s"} on the KYC record.`]).catch(() => {});
  }
  await pool.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, 'aml_file', NULL, $2, $3, $4, $5)`,
    [data.deal.id, data.parties.map(p => p.role).join(", "), `AML file ${how} (${data.parties.map(p => p.company?.name || p.brand.name).join(", ")})`, me.id, me.name]).catch(() => {});
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

router.get("/api/deals/:id/aml-file", async (req: Request, res: Response) => {
  try {
    const me = await officer(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const roleParam = text(req.query.role);
    if (roleParam && !isDealPartyRole(roleParam)) return res.status(400).json({ message: "Which party?" });
    const data = await gatherAmlFile(String(req.params.id), roleParam ? [roleParam as DealPartyRole] : null, me);
    if (!data) return res.status(404).json({ message: "No such transaction." });
    if (!data.parties.length) return res.status(404).json({ message: roleParam ? "The transaction has no such party." : "The transaction has no parties yet." });
    if (text(req.query.format) === "pdf") {
      const pdf = await renderAmlReport(data);
      await recordMade(data, me, "made (report)");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition(`${amlFileName(data, "report")}.pdf`));
      return res.send(pdf);
    }
    const { zip, included, missing } = await buildAmlZip(data);
    await recordMade(data, me, `made (report and ${included} document${included === 1 ? "" : "s"}${missing ? `, ${missing} not included` : ""})`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", contentDisposition(`${amlFileName(data, "folder")}.zip`));
    res.send(zip);
  } catch (err: any) {
    console.error("[aml-file] not made:", err?.message);
    if (!res.headersSent) res.status(500).json({ message: "The AML file could not be made." });
  }
});

// The written risk assessment for one party, for the AML box (21 November
// 2026). BGP staff signed in as themselves: it says nothing the box does not
// already show them; it only reads.
router.get("/api/deals/:id/aml-risk-assessment", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session?.userId || (req as any).tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not signed in." });
    const { contactViewer } = await import("./contact-viewer");
    if (!(await contactViewer(req)).staff) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const role = text(req.query.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Which party?" });
    const u = (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0];
    const data = await gatherAmlFile(String(req.params.id), [role as DealPartyRole], { id: String(userId), name: text(u?.name) || text(u?.email) || "BGP" });
    if (!data) return res.status(404).json({ message: "No such transaction." });
    const p = data.parties[0];
    if (!p) return res.status(404).json({ message: "The transaction has no such party." });
    res.json({ riskAssessment: p.riskAssessment, unread: p.unread });
  } catch (err: any) {
    console.error("[aml-file] risk assessment failed:", err?.message);
    res.status(500).json({ message: "The risk assessment could not be read." });
  }
});

// The report filed for KYC4U: KYC4U is no longer used (23 November 2026).
router.post("/api/deals/:id/aml-file/kyc4u", (_req: Request, res: Response) => {
  res.status(410).json({ message: KYC4U_RETIRED_WORDS });
});

export default router;
