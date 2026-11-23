// Each deal party's contracting company and the person to ask (Woody,
// 18 November 2026; the rules are shared/deal-parties.ts). BGP staff signed
// in as themselves only: the companies, the people and Xero are BGP's.
//
//   GET  /api/deals/:id/parties                  every party, what is set, what to offer, what is missing
//   PUT  /api/deals/:id/parties/:role            { companyId?, personId?, xero? }: set or clear (null) any
//   POST /api/deals/:id/parties/:role/person     { name, email?, mobile?, jobTitle? }: find or add the
//                                                person under the brand, and make them the one to ask
//   POST /api/deals/:id/parties/:role/owner      { key, email?, mobile? }: save the contact details of
//                                                one of the party's people to check (an owner the
//                                                register names) to the CRM under the brand
//   POST /api/deals/:id/billing/same-company     the client's billing contact is the company that signs
//   POST /api/deals/:id/billing/signing          bill the client's company that signs, not another company
//   GET  /api/deals/:id/payer                    the third party that pays for the client, and its checks
//   PUT  /api/deals/:id/payer                    { companyId, relationship, note }: set or clear (null) it
//   POST /api/deals/:id/payer/checks             run BGP's checks before asking on it again
//
// Who pays (Woody, 20 November 2026: "the Xero billing entity and the aml
// entity need to be flagged if they are different", then "yes biuild"): BGP's
// client is billed as the company that signs unless the deal says otherwise;
// another company is flagged; a third party that pays is recorded with how it
// is related, and checked (shared/deal-billing.ts).
//
// The company that signs is always one filed under the party's brand: the
// deal saves refuse anything else (checkPartyCompanies, called by the deal
// doors in server/letting-service.ts), and a change of brand drops a company
// filed under the old one. A person typed here is saved to the CRM under the
// brand, so they are there next time and on the KYC4U request. An email
// already on the CRM for that brand is the same person: blank fields are
// filled, nothing is overwritten. Every change is a line in deal_audit_log.

import { Router, type Request, type Response } from "express";
import { PUBLIC_BODY_SUBJECT, isPublicBodyRecord, knownPublicBody, publicBodyMarkInName } from "@shared/aml-sdd";
import {
  DEAL_PARTY_COLUMNS, DEAL_PARTY_FIELDS, DEAL_PARTY_LABEL, DEAL_PARTY_ROLES, companyOffer, dealClientRole, isDealPartyRole, newPartyPerson, ownerContactMatch, partyGaps, partySubjectKind, personFill,
  privateMarkInName, isTrustRecord, trustMarkInName, foundationMarkInName, sameCompaniesHouseNumber, signerKindOf,
  type DealPartyBilling, type DealPartyCompany, type DealPartyPayer, type DealPartyPerson, type DealPartyRole, type DealPartyView,
} from "@shared/deal-parties";
import { ownerRegister, personDisplayName, personNamesMatch } from "@shared/kyc-prechecks";
import { readsLikeCharity } from "@shared/charity-register";
import { billingState, billingWords, payerInput, payerRelationshipWords, PAYER_RELATIONSHIPS } from "@shared/deal-billing";
import { kycPersonRoleWords } from "@shared/kyc-request";
import { isGuaranteedRole } from "@shared/deal-guarantor";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export class PartyCompanyRefusal extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "PartyCompanyRefusal";
  }
}

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * The deal as it will be after a save: a company sent for a party must be
 * filed under that party's brand (else PartyCompanyRefusal); a company the
 * deal already carried that no longer sits under the party's brand (the
 * party changed) is cleared. Returns the fields to clear.
 */
export async function checkPartyCompanies(db: Db, after: Record<string, any>, sent: Record<string, any>): Promise<Record<string, null>> {
  const clear: Record<string, null> = {};
  const wanted = DEAL_PARTY_ROLES
    .map(role => ({ role, f: DEAL_PARTY_FIELDS[role] }))
    .filter(({ f }) => text(after[f.company]));
  if (!wanted.length) return clear;
  const ids = [...new Set(wanted.map(({ f }) => text(after[f.company])))];
  const rows = (await db.query(`SELECT id, parent_company_id, name FROM crm_trading_entities WHERE id = ANY($1::varchar[])`, [ids])).rows;
  for (const { role, f } of wanted) {
    const id = text(after[f.company]);
    const row = rows.find((r: any) => r.id === id);
    const brand = text(after[f.brand]);
    const fits = !!row && !!brand && row.parent_company_id === brand;
    if (fits) continue;
    if (f.company in sent && text(sent[f.company])) {
      throw new PartyCompanyRefusal(row
        ? `${row.name} is not filed under the ${DEAL_PARTY_LABEL[role].toLowerCase()} on this transaction. Pick a company filed under it.`
        : `The ${DEAL_PARTY_LABEL[role].toLowerCase()}'s company was not found. Pick it again.`);
    }
    clear[f.company] = null;
  }
  return clear;
}

interface DealRow extends Record<string, any> { id: string; name: string }

/** BGP's client on the deal: the party it invoices (shared/deal-parties.ts dealClientRole). */
export const clientRoleOf = (deal: Record<string, any>): DealPartyRole =>
  dealClientRole({ dealType: deal.deal_type, bgpActingFor: deal.bgp_acting_for, team: deal.team });

/** Who BGP's client is billed as, set against the company that signs, and the payer the deal records. */
function partyBilling(deal: DealRow, role: DealPartyRole, kind: "company" | "individual", company: DealPartyCompany | null, filed: DealPartyCompany[]): DealPartyBilling {
  const col = DEAL_PARTY_COLUMNS[role];
  const own = text(deal.xero_contact_id) || text(deal.xero_contact_name)
    ? { contactId: text(deal.xero_contact_id) || null, name: text(deal.xero_contact_name) || null } : null;
  const partyBilled = text(deal[col.xeroId]) ? { contactId: text(deal[col.xeroId]), name: text(deal[col.xeroName]) || null } : null;
  const billed = own || partyBilled;
  const row = text(deal.invoice_payer_entity_id) ? filed.find(c => c.id === text(deal.invoice_payer_entity_id)) || null : null;
  const relationship = text(deal.invoice_payer_relationship) || null;
  const payer: DealPartyPayer | null = row ? {
    id: row.id, name: row.name, companiesHouseNumber: row.companiesHouseNumber, xeroContactId: row.xeroContactId || null,
    relationship, relationshipWords: payerRelationshipWords(relationship), note: text(deal.invoice_payer_note) || null,
    clear: !!PAYER_RELATIONSHIPS.find(r => r.key === relationship)?.clear,
  } : null;
  // A person who signs is billed as the one who signs, as a company is; a
  // private individual with nobody named is billed in their own name.
  const state = billingState({
    individual: kind === "individual" && !company,
    signing: company ? { name: company.name, xeroContactId: company.xeroContactId || null, xeroContactName: company.xeroContactName || null } : null,
    billed,
    payer: payer ? { name: payer.name, xeroContactId: payer.xeroContactId, xeroContactName: row?.xeroContactName || null } : null,
  });
  return {
    ...billingWords(state, { billed: billed?.name || null, signing: company?.name || null, payer: payer?.name || null, relationship, signingPerson: company?.kind === "individual" }),
    billed, from: own ? "deal" : partyBilled ? "party" : null, payer,
  };
}

async function readDeal(db: Db, dealId: string): Promise<DealRow | null> {
  const cols = DEAL_PARTY_ROLES.flatMap(r => Object.values(DEAL_PARTY_COLUMNS[r]));
  return (await db.query(
    `SELECT id, name, deal_type, team, bgp_acting_for, client_contact_id, tenancy_unit_id, xero_contact_id, xero_contact_name,
            invoice_payer_entity_id, invoice_payer_relationship, invoice_payer_note, ${cols.join(", ")}
       FROM crm_deals WHERE id = $1`, [dealId])).rows[0] || null;
}

// The company on the lease of the deal's unit (a letting's tenant): the
// schedule row the deal carries, else one that names the deal, else the one
// its tracker row names.
async function leaseCompanyId(db: Db, deal: DealRow): Promise<string | null> {
  const row = (await db.query(
    `SELECT t.tenant_entity_id FROM tenancy_schedule_units t
      WHERE t.tenant_entity_id IS NOT NULL AND (
            t.id = $2
         OR t.deal_id = $1
         OR t.id IN (SELECT a.tenancy_unit_id FROM available_units a WHERE a.deal_id = $1 AND a.tenancy_unit_id IS NOT NULL))
      ORDER BY (t.id = $2) DESC, (t.deal_id = $1) DESC LIMIT 1`, [deal.id, deal.tenancy_unit_id || ""]).catch(() => ({ rows: [] as any[] }))).rows[0];
  return row?.tenant_entity_id || null;
}

const personOf = (r: any): DealPartyPerson => ({
  id: String(r.id), name: text(r.name) || "Unnamed", email: text(r.email) || null,
  mobile: text(r.phone_mobile) || text(r.phone) || null, jobTitle: text(r.role) || null,
});

export interface DealPartiesView { deal: { id: string; name: string }; parties: DealPartyView[] }

// A tenant brand's own name is a trading name ("Foundation Coffee House"):
// only the company that signs for it is read for a foundation. The English
// word counts only when the CRM records the party abroad.
const foundationHintFor = (brand: { name?: unknown; company_type?: unknown; ho_country?: unknown }, companyName: unknown): boolean => {
  const abroad = ownerRegister(typeof brand.ho_country === "string" ? brand.ho_country : null) === "abroad";
  return foundationMarkInName(companyName, { abroad }) || (!/^tenant/i.test(String(brand.company_type || "")) && foundationMarkInName(brand.name, { abroad }));
};

// A UK foundation or charity with no company record (a charitable trust or a
// CIO: Woody, 21 November 2026, "foundations in the uk"): recorded as a trust
// or foundation, BGP's checks read its entry and trustees on the Charity
// Commission's register. A charitable company is set as the company that
// signs instead, so this is only for a party with no Companies House number,
// no company that signs, and a name that is not a company's.
const charityHintFor = (brand: { name?: unknown; company_type?: unknown; ho_country?: unknown; companies_house_number?: unknown }, company: unknown): boolean =>
  !company && !text(brand.companies_house_number) && !/^tenant/i.test(String(brand.company_type || ""))
  && ownerRegister(typeof brand.ho_country === "string" ? brand.ho_country : null) !== "abroad"
  && readsLikeCharity(brand.name) && !/\b(ltd|limited|plc|llp)\.?$/i.test(text(brand.name));

export async function loadDealParties(db: Db, dealId: string): Promise<DealPartiesView | null> {
  const deal = await readDeal(db, dealId);
  if (!deal) return null;
  const roles = DEAL_PARTY_ROLES.filter(r => text(deal[DEAL_PARTY_COLUMNS[r].brand]));
  const brandIds = [...new Set(roles.map(r => String(deal[DEAL_PARTY_COLUMNS[r].brand])))];
  if (!brandIds.length) return { deal: { id: deal.id, name: deal.name }, parties: [] };
  const [brands, companies, people] = await Promise.all([
    db.query(`SELECT id, name, companies_house_number, aml_subject_type, company_type, head_office_address->>'country' AS ho_country,
                     COALESCE(NULLIF(companies_house_data->'profile'->>'companyName', ''), NULLIF(companies_house_data->>'company_name', ''), NULLIF(uk_entity_name, '')) AS legal_name
                FROM crm_companies WHERE id = ANY($1::varchar[])`, [brandIds]),
    db.query(`SELECT id, parent_company_id, name, companies_house_number, is_default, xero_contact_id, xero_contact_name, entity_kind, contact_id FROM crm_trading_entities
               WHERE parent_company_id = ANY($1::varchar[]) ORDER BY is_default DESC, lower(name)`, [brandIds]),
    db.query(`SELECT id, company_id, name, email, phone_mobile, phone, role FROM (
                SELECT c.*, row_number() OVER (PARTITION BY c.company_id ORDER BY (COALESCE(c.email, '') = ''), lower(c.name)) AS n
                  FROM crm_contacts c WHERE c.company_id = ANY($1::varchar[])) x
               WHERE n <= 80`, [brandIds]),
  ]);
  // The people set on the deal, its client contact, and a person who signs,
  // even when filed elsewhere.
  const signerContacts = companies.rows.filter((c: any) => signerKindOf(c.entity_kind) === "individual" && text(c.contact_id)
    && roles.some(r => text(deal[DEAL_PARTY_COLUMNS[r].company]) === String(c.id))).map((c: any) => text(c.contact_id));
  const namedIds = [...new Set([...roles.map(r => text(deal[DEAL_PARTY_COLUMNS[r].person])), text(deal.client_contact_id), ...signerContacts].filter(Boolean))];
  const named = namedIds.length
    ? (await db.query(`SELECT id, company_id, name, email, phone_mobile, phone, role FROM crm_contacts WHERE id = ANY($1::varchar[])`, [namedIds])).rows
    : [];
  const lease = roles.includes("tenant") ? await leaseCompanyId(db, deal) : null;

  // Guarantors of a tenant or a buyer, with where BGP's checks on each stand (23 November 2026).
  const guarantors = roles.some(r => isGuaranteedRole(r))
    ? await import("./deal-guarantors").then(m => m.guarantorViews(deal.id, db)).catch(() => [])
    : [];

  const parties: DealPartyView[] = [];
  for (const role of roles) {
    const col = DEAL_PARTY_COLUMNS[role];
    const brandRow = brands.rows.find((b: any) => b.id === deal[col.brand]);
    if (!brandRow) continue;
    const filed: DealPartyCompany[] = companies.rows.filter((c: any) => c.parent_company_id === brandRow.id).map((c: any) => ({
      id: String(c.id), name: text(c.name), companiesHouseNumber: text(c.companies_house_number) || null, isDefault: !!c.is_default,
      xeroContactId: text(c.xero_contact_id) || null, xeroContactName: text(c.xero_contact_name) || null,
      kind: signerKindOf(c.entity_kind), contactId: text(c.contact_id) || null,
    }));
    const company = filed.find(c => c.id === deal[col.company]) || null;
    const setPerson = named.find((p: any) => p.id === deal[col.person]);
    const clientPerson = named.find((p: any) => p.id === deal.client_contact_id && p.company_id === brandRow.id);
    // A person who signs is asked themselves when nobody else is named.
    const signerPerson = company?.kind === "individual" && company.contactId ? named.find((p: any) => p.id === company.contactId) : undefined;
    const person = setPerson ? { ...personOf(setPerson), from: "party" as const }
      : clientPerson ? { ...personOf(clientPerson), from: "client" as const }
      : signerPerson ? { ...personOf(signerPerson), from: "signer" as const } : null;
    // A person who signs is checked as a private individual (20 November 2026).
    const kind = partySubjectKind(brandRow.aml_subject_type, company);
    const brandNumber = text(brandRow.companies_house_number);
    const brandOwn = kind === "company" && !company && brandNumber && !filed.some(c => sameCompaniesHouseNumber(c.companiesHouseNumber, brandNumber))
      ? { name: text(brandRow.legal_name) || text(brandRow.name), number: brandNumber } : null;
    parties.push({
      role, label: DEAL_PARTY_LABEL[role],
      brand: { id: String(brandRow.id), name: text(brandRow.name), companiesHouseNumber: text(brandRow.companies_house_number) || null, kind,
        recordIndividual: String(brandRow.aml_subject_type || "").toLowerCase() === "individual", privateMark: privateMarkInName(brandRow.name),
        recordTrust: isTrustRecord(brandRow.aml_subject_type),
        recordPublicBody: isPublicBodyRecord(brandRow.aml_subject_type),
        publicBodyHint: !text(brandRow.companies_house_number) && !company && publicBodyMarkInName(brandRow.name),
        publicBodyKnown: knownPublicBody(brandRow.name)?.legalName || null,
        trustHint: trustMarkInName(brandRow.name) || trustMarkInName(company?.name) || foundationHintFor(brandRow, company?.name) || charityHintFor(brandRow, company),
        foundationHint: foundationHintFor(brandRow, company?.name),
        charityHint: charityHintFor(brandRow, company) },
      company,
      offer: company ? null : companyOffer(filed, role === "tenant" ? lease : null),
      brandOwn,
      companies: filed,
      xero: text(deal[col.xeroId]) ? { contactId: String(deal[col.xeroId]), name: text(deal[col.xeroName]) || null } : null,
      person,
      people: people.rows.filter((p: any) => p.company_id === brandRow.id).map(personOf),
      gaps: partyGaps({ role, kind, brandName: brandRow.name, companySet: !!company, person, trust: isTrustRecord(brandRow.aml_subject_type) || isPublicBodyRecord(brandRow.aml_subject_type) }),
      client: role === clientRoleOf(deal),
      billing: role === clientRoleOf(deal) ? partyBilling(deal, role, kind, company, filed) : null,
      ...(isGuaranteedRole(role) ? { guarantors: guarantors.filter(g => g.role === role).map(({ role: _r, companyId: _c, ...g }) => g) } : {}),
    });
  }
  return { deal: { id: deal.id, name: deal.name }, parties };
}

/** The company that signs for each party, by brand id: what the AML screens key on. Brands with none set are absent. */
export async function dealPartyCompanies(db: Db, dealId: string): Promise<Record<string, string>> {
  const deal = await readDeal(db, dealId).catch(() => null);
  const out: Record<string, string> = {};
  if (!deal) return out;
  for (const role of DEAL_PARTY_ROLES) {
    const col = DEAL_PARTY_COLUMNS[role];
    if (text(deal[col.brand]) && text(deal[col.company]) && !(deal[col.brand] in out)) out[deal[col.brand]] = String(deal[col.company]);
  }
  return out;
}

/** The person set to ask for a party on the deal (by brand id), else the deal's client contact when filed under that brand. */
export async function dealPartyPerson(db: Db, dealId: string, brandId: string): Promise<string | null> {
  const deal = await readDeal(db, dealId).catch(() => null);
  if (!deal) return null;
  for (const role of DEAL_PARTY_ROLES) {
    const col = DEAL_PARTY_COLUMNS[role];
    if (deal[col.brand] === brandId && text(deal[col.person])) return String(deal[col.person]);
  }
  if (text(deal.client_contact_id)) {
    const c = (await db.query(`SELECT company_id FROM crm_contacts WHERE id = $1`, [deal.client_contact_id])).rows[0];
    if (c?.company_id === brandId) return String(deal.client_contact_id);
  }
  return null;
}

/**
 * The CRM contact for a person typed against a brand: the one already filed
 * under it with that email (blank fields filled), else a new contact. Never
 * an employer change, never an overwrite.
 */
export async function findOrAddPartyPerson(db: Db, brandId: string, typed: { name: string; email: string | null; mobile: string | null; jobTitle: string | null }, note: string): Promise<{ id: string; created: boolean }> {
  const brand = (await db.query(`SELECT id, name FROM crm_companies WHERE id = $1`, [brandId])).rows[0];
  if (!brand) throw new PartyCompanyRefusal("That party was not found.");
  const held = typed.email
    ? (await db.query(`SELECT id, email, phone_mobile, role FROM crm_contacts WHERE company_id = $1 AND lower(email) = $2 ORDER BY created_at NULLS LAST LIMIT 1`, [brandId, typed.email])).rows[0]
    : null;
  if (held) {
    const fill = personFill(held, typed);
    const keys = Object.keys(fill);
    if (keys.length) {
      await db.query(`UPDATE crm_contacts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [held.id, ...keys.map(k => fill[k])]);
    }
    return { id: String(held.id), created: false };
  }
  const made = (await db.query(
    `INSERT INTO crm_contacts (name, email, phone_mobile, role, company_id, company_name, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [typed.name, typed.email, typed.mobile, typed.jobTitle, brandId, brand.name, note.slice(0, 500)])).rows[0];
  return { id: String(made.id), created: true };
}

async function audit(db: Db, dealId: string, field: string, oldValue: string | null, newValue: string | null, reason: string, me: { id: string; name: string | null }) {
  await db.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [dealId, field, oldValue, newValue, reason, me.id, me.name]).catch((e: any) => console.warn(`[deal-parties] audit line not written: ${e?.message}`));
}

async function staffMe(req: Request): Promise<{ id: string; name: string | null } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const { pool } = await import("./db");
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) || null } : null;
}

const STAFF_ONLY = "BGP staff only, signed in as themselves.";

const router = Router();

router.get("/api/deals/:id/parties", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const { pool } = await import("./db");
    const view = await loadDealParties(pool, String(req.params.id));
    if (!view) return res.status(404).json({ message: "Transaction not found" });
    res.json(view);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not load the parties" });
  }
});

router.put("/api/deals/:id/parties/:role", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { pool } = await import("./db");
    const deal = await readDeal(pool, String(req.params.id));
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const col = DEAL_PARTY_COLUMNS[role];
    const brandId = text(deal[col.brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the transaction first.` });

    const sets: Record<string, string | null> = {};
    const lines: Array<[string, string | null, string | null, string]> = [];
    if ("companyId" in body) {
      const id = body.companyId == null ? null : text(body.companyId);
      if (id) {
        const row = (await pool.query(`SELECT id, name, parent_company_id FROM crm_trading_entities WHERE id = $1`, [id])).rows[0];
        if (!row || row.parent_company_id !== brandId) return res.status(400).json({ message: `Pick a company filed under the ${role}.` });
        lines.push([col.company, deal[col.company] || null, id, `${DEAL_PARTY_LABEL[role]} signs as ${row.name}`]);
      } else {
        lines.push([col.company, deal[col.company] || null, null, `${DEAL_PARTY_LABEL[role]}'s company that signs cleared`]);
      }
      sets[col.company] = id;
    }
    if ("personId" in body) {
      const id = body.personId == null ? null : text(body.personId);
      if (id) {
        const row = (await pool.query(`SELECT id, name, company_id FROM crm_contacts WHERE id = $1`, [id])).rows[0];
        if (!row || row.company_id !== brandId) return res.status(400).json({ message: `Pick someone filed under the ${role}, or add them.` });
        lines.push([col.person, deal[col.person] || null, id, `Ask ${row.name} for the ${role}'s checks`]);
      } else {
        lines.push([col.person, deal[col.person] || null, null, `The ${role}'s person to ask cleared`]);
      }
      sets[col.person] = id;
    }
    // The Xero contact invoices go to, made from the company (the billing
    // entity route makes or finds it): recorded here as the deal form does.
    if ("xero" in body) {
      const x = body.xero && typeof body.xero === "object" ? body.xero : null;
      const contactId = x ? text(x.contactId).slice(0, 100) : "";
      const name = x ? text(x.name).slice(0, 255) : "";
      if (x && (!contactId || !name)) return res.status(400).json({ message: "Pick the Xero contact again." });
      sets[col.xeroId] = contactId || null;
      sets[col.xeroName] = name || null;
      lines.push([col.xeroId, deal[col.xeroId] || null, contactId || null, contactId ? `${DEAL_PARTY_LABEL[role]} billed to ${name} in Xero` : `${DEAL_PARTY_LABEL[role]}'s Xero billing contact cleared`]);
    }
    const keys = Object.keys(sets);
    if (!keys.length) return res.status(400).json({ message: "Nothing to change" });
    await pool.query(`UPDATE crm_deals SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [deal.id, ...keys.map(k => sets[k])]);
    for (const [field, oldValue, newValue, reason] of lines) if (oldValue !== newValue) await audit(pool, deal.id, field, oldValue, newValue, reason, me);
    res.json(await loadDealParties(pool, deal.id));
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not save the party" });
  }
});

router.post("/api/deals/:id/parties/:role/person", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party" });
    const typed = newPartyPerson(req.body);
    if ("problem" in typed) return res.status(400).json({ message: typed.problem });
    const { pool } = await import("./db");
    const deal = await readDeal(pool, String(req.params.id));
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const col = DEAL_PARTY_COLUMNS[role];
    const brandId = text(deal[col.brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the transaction first.` });
    const person = await findOrAddPartyPerson(pool, brandId, typed.person, `Added by ${me.name || "BGP"} as the person to ask for the ${role}'s checks on ${deal.name}.`);
    await pool.query(`UPDATE crm_deals SET ${col.person} = $2, updated_at = now() WHERE id = $1`, [deal.id, person.id]);
    if ((deal[col.person] || null) !== person.id) {
      await audit(pool, deal.id, col.person, deal[col.person] || null, person.id,
        `Ask ${typed.person.name} for the ${role}'s checks${person.created ? " (added to the CRM)" : ""}`, me);
    }
    res.json({ ...(await loadDealParties(pool, deal.id)), personId: person.id, created: person.created });
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not add the person" });
  }
});

// A party recorded as a private individual (Woody, 20 November 2026: the
// Kick off AML step asked for "the company buying" for Sandy Macaskill
// (private), a private buyer, and nothing on the app could record him as a
// person). Sets the record's own subject type, crm_companies.aml_subject_type,
// which every AML reader follows (partySubjectKind): no company that signs is
// then needed and the checks are about the person. A record with a Companies
// House number is a company and is refused. Undo puts it back to not
// recorded. The record is shared, so every deal with it follows. A line on
// the deal's history and on the record's KYC history.
router.put("/api/deals/:id/parties/:role/individual", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party" });
    const wanted = req.body && typeof req.body === "object" ? (req.body as any).individual : undefined;
    if (typeof wanted !== "boolean") return res.status(400).json({ message: "Say whether the party is a private individual." });
    const { pool } = await import("./db");
    const deal = await readDeal(pool, String(req.params.id));
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const brandId = text(deal[DEAL_PARTY_COLUMNS[role].brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the transaction first.` });
    const brand = (await pool.query(`SELECT id, name, companies_house_number, aml_subject_type FROM crm_companies WHERE id = $1`, [brandId])).rows[0];
    if (!brand) return res.status(404).json({ message: "Party not found" });
    if (wanted && text(brand.companies_house_number)) {
      return res.status(409).json({ message: `${text(brand.name)} has a Companies House number (${text(brand.companies_house_number)}), so it is a company. If a person signs for it in their own name, use A person signs.` });
    }
    const before = text(brand.aml_subject_type) || null;
    const isIndividual = (before || "").toLowerCase() === "individual";
    const after = wanted ? "individual" : (isIndividual ? null : before);
    if (wanted !== isIndividual) {
      await pool.query(`UPDATE crm_companies SET aml_subject_type = $2 WHERE id = $1`, [brandId, after]);
      const words = wanted
        ? `${text(brand.name)} recorded as a private individual: the checks are about the person, with no company that signs`
        : `${text(brand.name)} no longer recorded as a private individual`;
      await audit(pool, deal.id, "aml_subject_type", before, after, words, me);
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'aml_subject_type', $2, $3)`,
        [brandId, me.name || me.id, `${words} (on ${deal.name})`]).catch((e: any) => console.warn(`[deal-parties] KYC history line not written: ${e?.message}`));
    }
    res.json(await loadDealParties(pool, deal.id));
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not record the party" });
  }
});

// A party recorded as a trust (Jack, 20 November 2026, on Fortis Green's
// vendor URC Thames North Trust: "Trusts are listed as high risk under our
// policy ... I think we should send trusts to KYC4U in full"). Sets the
// record's subject type to 'trust': BGP's AML policy factor makes it enhanced
// (policyFactorFlags), so the next step is KYC4U and only the officers sign it
// off. A trust needs no company that signs; a corporate trustee can still be
// set as one. Undo clears only what it set. The record is shared, so every
// deal with it follows. A line on the deal's and the record's KYC history.
router.put("/api/deals/:id/parties/:role/trust", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party" });
    const wanted = req.body && typeof req.body === "object" ? (req.body as any).trust : undefined;
    if (typeof wanted !== "boolean") return res.status(400).json({ message: "Say whether the party is a trust." });
    const { pool } = await import("./db");
    const deal = await readDeal(pool, String(req.params.id));
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const brandId = text(deal[DEAL_PARTY_COLUMNS[role].brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the transaction first.` });
    const brand = (await pool.query(`SELECT id, name, aml_subject_type FROM crm_companies WHERE id = $1`, [brandId])).rows[0];
    if (!brand) return res.status(404).json({ message: "Party not found" });
    const before = text(brand.aml_subject_type) || null;
    const isTrust = isTrustRecord(before);
    if (wanted !== isTrust) {
      const after = wanted ? "trust" : null;
      await pool.query(`UPDATE crm_companies SET aml_subject_type = $2 WHERE id = $1`, [brandId, after]);
      const words = wanted
        ? `${text(brand.name)} recorded as a trust or foundation: enhanced due diligence, signed off by the Nominated Officer or a Deputy`
        : `${text(brand.name)} no longer recorded as a trust or foundation`;
      await audit(pool, deal.id, "aml_subject_type", before, after, words, me);
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'aml_subject_type', $2, $3)`,
        [brandId, me.name || me.id, `${words} (on ${deal.name})`]).catch((e: any) => console.warn(`[deal-parties] KYC history line not written: ${e?.message}`));
    }
    res.json(await loadDealParties(pool, deal.id));
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not record the party" });
  }
});

// A party recorded as a UK public body (Layla, 23 November 2026, on #3965, The
// Crown Estate: "it fits the lower risk category for simplified due
// diligence"). Sets the record's subject type to 'public_body': no company
// that signs, no beneficial owners to verify, simplified due diligence unless
// a red flag makes it enhanced. A record with a Companies House number is a
// company, never the body itself, and is refused. The record is shared, so
// every transaction with it follows.
router.put("/api/deals/:id/parties/:role/public-body", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party" });
    const wanted = req.body && typeof req.body === "object" ? (req.body as any).publicBody : undefined;
    if (typeof wanted !== "boolean") return res.status(400).json({ message: "Say whether the party is a public body." });
    const { pool } = await import("./db");
    const deal = await readDeal(pool, String(req.params.id));
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const brandId = text(deal[DEAL_PARTY_COLUMNS[role].brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the transaction first.` });
    const brand = (await pool.query(`SELECT id, name, aml_subject_type, companies_house_number FROM crm_companies WHERE id = $1`, [brandId])).rows[0];
    if (!brand) return res.status(404).json({ message: "Party not found" });
    const before = text(brand.aml_subject_type) || null;
    const is = isPublicBodyRecord(before);
    if (wanted && !is) {
      if (text(brand.companies_house_number)) return res.status(409).json({ message: `${text(brand.name)} has a Companies House number, so it is a company, not the public body itself. A company or joint venture a public body has an interest in needs standard checks.` });
      if (before) return res.status(409).json({ message: `${text(brand.name)} is recorded as ${before === "trust" ? "a trust" : before === "individual" ? "a private individual" : before}. Undo that first.` });
    }
    if (wanted !== is) {
      const after = wanted ? PUBLIC_BODY_SUBJECT : null;
      await pool.query(`UPDATE crm_companies SET aml_subject_type = $2 WHERE id = $1`, [brandId, after]);
      const words = wanted
        ? `${text(brand.name)} recorded as a UK public body: simplified due diligence, no company that signs and no beneficial owners to verify`
        : `${text(brand.name)} no longer recorded as a public body`;
      await audit(pool, deal.id, "aml_subject_type", before, after, words, me);
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'aml_subject_type', $2, $3)`,
        [brandId, me.name || me.id, `${words} (on ${deal.name})`]).catch((e: any) => console.warn(`[deal-parties] KYC history line not written: ${e?.message}`));
    }
    res.json(await loadDealParties(pool, deal.id));
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not record the party" });
  }
});

// The contact details of someone the party's AML checks need (Woody,
// 20 November 2026: "these owners need to AML and prompt for contact details
// at that stage"). The person is named by their key on the party's people to
// check (server/kyc-people.ts, read from the register), never by a name the
// request types, so only someone the checks need is written. Saved on the
// CRM contact under the brand that is them (by email, else by name: blank
// fields filled, nothing overwritten), else a new one; the deal's person to
// ask is not changed.
router.post("/api/deals/:id/parties/:role/owner", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party" });
    const key = text(req.body?.key).slice(0, 200);
    if (!key) return res.status(400).json({ message: "Pick the person." });
    const { pool } = await import("./db");
    const deal = await readDeal(pool, String(req.params.id));
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const col = DEAL_PARTY_COLUMNS[role];
    const brandId = text(deal[col.brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the transaction first.` });
    const brand = (await pool.query(`SELECT id, name, aml_subject_type FROM crm_companies WHERE id = $1`, [brandId])).rows[0];
    if (!brand) return res.status(404).json({ message: "That party was not found." });
    const signer = text(deal[col.company]) ? (await pool.query(`SELECT entity_kind FROM crm_trading_entities WHERE id = $1`, [deal[col.company]])).rows[0] || { entity_kind: null } : null;
    const kind = partySubjectKind(brand.aml_subject_type, signer ? { kind: signer.entity_kind } : null);
    const { dealPeopleRequests, partyPeopleFor } = await import("./kyc-people");
    const people = await partyPeopleFor({ companyId: brandId, entityId: text(deal[col.company]) || null, kind, dealId: String(deal.id) }, await dealPeopleRequests(deal.id));
    const who = people?.people.find(p => p.key === key);
    if (!who) return res.status(400).json({ message: "That person is not one of the people this party's checks need." });
    const name = personDisplayName(who.name);
    const typed = newPartyPerson({ name, email: req.body?.email, mobile: req.body?.mobile });
    if ("problem" in typed) return res.status(400).json({ message: typed.problem });

    const contacts = (await pool.query(`SELECT id, name, email, phone_mobile, role FROM crm_contacts WHERE company_id = $1`, [brandId])).rows;
    const held = ownerContactMatch(who.name, typed.person.email, contacts.map((c: any) => ({ ...c, id: String(c.id), name: text(c.name) })), personNamesMatch);
    let contactId: string;
    let created = false;
    let kept: string | null = null;
    if (held) {
      const fill = personFill(held, typed.person);
      const keys = Object.keys(fill);
      if (keys.length) {
        await pool.query(`UPDATE crm_contacts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [held.id, ...keys.map(k => fill[k])]);
      }
      // An email already held is never overwritten: the reply says which was kept.
      if (typed.person.email && text(held.email) && text(held.email).toLowerCase() !== typed.person.email) kept = text(held.email);
      contactId = held.id;
    } else {
      // The note says what they are to the company the checks are about.
      const signing = text(deal[col.company]) ? (await pool.query(`SELECT name FROM crm_trading_entities WHERE id = $1`, [deal[col.company]])).rows[0] : null;
      const roleWords = kycPersonRoleWords(who.roles, text(signing?.name) || text(brand.name));
      const made = await findOrAddPartyPerson(pool, brandId, typed.person, `Added by ${me.name || "BGP"} for the AML checks on ${deal.name}: ${roleWords}, from Companies House.`);
      contactId = made.id;
      created = made.created;
    }
    await audit(pool, deal.id, "aml_person_contact", null, contactId,
      `Contact details for ${name} saved for the ${role}'s AML checks${created ? " (added to the CRM)" : ""}`, me);
    res.json({ ...(await loadDealParties(pool, deal.id)), contactId, created, kept });
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not save their details" });
  }
});

// ── Who pays BGP's invoice (Woody, 20 November 2026) ───────────────────────

async function clientParty(dealId: string) {
  const { pool } = await import("./db");
  const deal = await readDeal(pool, dealId);
  if (!deal) return null;
  const role = clientRoleOf(deal);
  const col = DEAL_PARTY_COLUMNS[role];
  return { pool, deal, role, col, brandId: text(deal[col.brand]), companyId: text(deal[col.company]) || null };
}

// "They are the same company": the client's billing contact is its company
// that signs, kept on the company so the two read as one from then on.
router.post("/api/deals/:id/billing/same-company", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const c = await clientParty(String(req.params.id));
    if (!c) return res.status(404).json({ message: "Transaction not found" });
    if (!c.companyId) return res.status(400).json({ message: `Set the ${c.role}'s company that signs first.` });
    const ownSet = !!(text(c.deal.xero_contact_id) || text(c.deal.xero_contact_name));
    const contactId = ownSet ? text(c.deal.xero_contact_id) : text(c.deal[c.col.xeroId]);
    const contactName = ownSet ? text(c.deal.xero_contact_name) : text(c.deal[c.col.xeroName]);
    if (!contactId && !contactName) return res.status(400).json({ message: "There is no Xero contact on the transaction to match to the company." });
    const company = (await c.pool.query(`SELECT id, name, parent_company_id, xero_contact_id FROM crm_trading_entities WHERE id = $1`, [c.companyId])).rows[0];
    if (!company || company.parent_company_id !== c.brandId) return res.status(404).json({ message: "The company that signs was not found." });
    await c.pool.query(`UPDATE crm_trading_entities SET xero_contact_id = $2, xero_contact_name = $3 WHERE id = $1`, [company.id, contactId || null, contactName || company.name]);
    await audit(c.pool, c.deal.id, "billing_same_company", text(company.xero_contact_id) || null, contactId || contactName,
      `${contactName || "The Xero contact"} confirmed as ${company.name}, the ${c.role}'s company that signs, by ${me.name || "BGP"}`, me);
    res.json(await loadDealParties(c.pool, c.deal.id));
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not save it" });
  }
});

// Bill the company that signs, not another company: the deal's own invoice
// contact and any payer come off, and the client is billed as its company that
// signs (by its own Xero contact when it has one, else found or made at the invoice).
router.post("/api/deals/:id/billing/signing", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const c = await clientParty(String(req.params.id));
    if (!c) return res.status(404).json({ message: "Transaction not found" });
    if (!c.companyId) return res.status(400).json({ message: `Set the ${c.role}'s company that signs first.` });
    const company = (await c.pool.query(`SELECT id, name, parent_company_id, xero_contact_id, xero_contact_name FROM crm_trading_entities WHERE id = $1`, [c.companyId])).rows[0];
    if (!company || company.parent_company_id !== c.brandId) return res.status(404).json({ message: "The company that signs was not found." });
    const before = text(c.deal.xero_contact_name) || text(c.deal[c.col.xeroName]) || null;
    const ownId = text(company.xero_contact_id) || null;
    await c.pool.query(
      `UPDATE crm_deals SET xero_contact_id = NULL, xero_contact_name = NULL, xero_account_number = NULL, xero_billing_address = NULL,
              ${c.col.xeroId} = $2, ${c.col.xeroName} = $3,
              invoice_payer_entity_id = NULL, invoice_payer_relationship = NULL, invoice_payer_note = NULL, updated_at = now()
        WHERE id = $1`,
      [c.deal.id, ownId, ownId ? (text(company.xero_contact_name) || company.name) : null]);
    await audit(c.pool, c.deal.id, "billing_signing", before, company.name, `The ${c.role} billed as ${company.name}, its company that signs${before ? `, not ${before}` : ""}`, me);
    res.json(await loadDealParties(c.pool, c.deal.id));
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not save it" });
  }
});

/** The payer the deal records for BGP's client, and BGP's checks before asking on it. */
router.get("/api/deals/:id/payer", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const c = await clientParty(String(req.params.id));
    if (!c) return res.status(404).json({ message: "Transaction not found" });
    const view = await loadDealParties(c.pool, c.deal.id);
    const payer = view?.parties.find(p => p.role === c.role)?.billing?.payer || null;
    let checks: unknown = null;
    if (payer) {
      const { dealPrechecks } = await import("./kyc-prechecks");
      const views = await dealPrechecks(c.deal.id, [{ companyId: c.brandId, entityId: payer.id }], { userId: me.id, autoStart: false }).catch(() => null);
      checks = views ? views[c.brandId] || null : null;
    }
    res.json({ role: c.role, payer, checks });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not read the payer" });
  }
});

// Set or clear the third party that pays BGP's invoice for the client. It is a
// company filed under the client (found at Companies House, which also gives
// it a Xero contact), never the company that signs; the client is billed to
// it; BGP's checks before asking start on it at once. Taking it off puts the
// bill back on the company that signs.
router.put("/api/deals/:id/payer", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const input = payerInput(req.body);
    if ("problem" in input) return res.status(400).json({ message: input.problem });
    const c = await clientParty(String(req.params.id));
    if (!c) return res.status(404).json({ message: "Transaction not found" });
    if (!c.brandId) return res.status(400).json({ message: `Set the ${c.role} on the transaction first: BGP bills it.` });
    let payer: any = null;
    if (input.companyId) {
      payer = (await c.pool.query(`SELECT id, name, parent_company_id, xero_contact_id, xero_contact_name FROM crm_trading_entities WHERE id = $1`, [input.companyId])).rows[0];
      if (!payer || payer.parent_company_id !== c.brandId) return res.status(400).json({ message: `Pick a company filed under the ${c.role}, or find it at Companies House.` });
      if (payer.id === c.companyId) return res.status(400).json({ message: "That is the company that signs, not a third party." });
    }
    const oldPayer = text(c.deal.invoice_payer_entity_id) || null;
    const sets: Record<string, string | null> = {
      invoice_payer_entity_id: payer ? String(payer.id) : null,
      invoice_payer_relationship: payer ? input.relationship : null,
      invoice_payer_note: payer ? input.note : null,
    };
    if (payer) {
      // Billed to the payer: its own Xero contact, or none here and found or made at the invoice.
      sets[c.col.xeroId] = text(payer.xero_contact_id) || null;
      sets[c.col.xeroName] = text(payer.xero_contact_id) ? (text(payer.xero_contact_name) || payer.name) : null;
    } else if (oldPayer) {
      const old = (await c.pool.query(`SELECT xero_contact_id FROM crm_trading_entities WHERE id = $1`, [oldPayer])).rows[0];
      if (!text(c.deal[c.col.xeroId]) || (old?.xero_contact_id && old.xero_contact_id === c.deal[c.col.xeroId])) {
        sets[c.col.xeroId] = null;
        sets[c.col.xeroName] = null;
      }
    }
    const keys = Object.keys(sets);
    const assignments = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
    await c.pool.query(`UPDATE crm_deals SET ${assignments}, updated_at = now() WHERE id = $1`, [c.deal.id, ...keys.map(k => sets[k])]);
    await audit(c.pool, c.deal.id, "invoice_payer", oldPayer, payer ? String(payer.id) : null,
      payer ? `${payer.name} pays BGP's invoice for the ${c.role} (${payerRelationshipWords(input.relationship).toLowerCase()}${input.note ? `: ${input.note}` : ""})`
        : `The third party paying BGP's invoice for the ${c.role} taken off`, me);
    let started: string | null = null;
    if (payer) {
      const { startPrecheck } = await import("./kyc-prechecks");
      started = await startPrecheck(c.brandId, { entityId: String(payer.id), dealId: c.deal.id, userId: me.id }).catch(() => null);
    }
    res.json({ ...(await loadDealParties(c.pool, c.deal.id)), started });
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not save who pays" });
  }
});

router.post("/api/deals/:id/payer/checks", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const c = await clientParty(String(req.params.id));
    if (!c) return res.status(404).json({ message: "Transaction not found" });
    const payerId = text(c.deal.invoice_payer_entity_id);
    if (!payerId) return res.status(400).json({ message: "No third party pays on this transaction." });
    const { startPrecheck } = await import("./kyc-prechecks");
    res.json({ started: await startPrecheck(c.brandId, { entityId: payerId, dealId: c.deal.id, userId: me.id, force: true }) });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not start the checks" });
  }
});

// Guarantors (Woody, 23 November 2026, on Inception T2: "one is signing
// cornhill bar and the other is guaranteeing so should be able to allocate
// add as the guarantor"). HMRC AMLG2300 s18: a guarantor is a party to the
// tenancy and a customer. A company or person filed under the party (a tenant
// or a buyer), never the company that signs; BGP's checks start on it at once,
// its red flags join the party's and its owners join the people to check
// (shared/deal-guarantor.ts, server/deal-guarantors.ts).
router.post("/api/deals/:id/guarantors", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const role = req.body?.role;
    if (!isGuaranteedRole(role)) return res.status(400).json({ message: "A guarantor stands behind the tenant or the buyer." });
    const entityId = text(req.body?.companyId);
    if (!entityId) return res.status(400).json({ message: "Pick the company or person that guarantees." });
    const { pool } = await import("./db");
    const deal = await readDeal(pool, String(req.params.id));
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const col = DEAL_PARTY_COLUMNS[role];
    const label = DEAL_PARTY_LABEL[role].toLowerCase();
    const brandId = text(deal[col.brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${label} on the transaction first.` });
    const entity = (await pool.query(`SELECT id, name, parent_company_id FROM crm_trading_entities WHERE id = $1`, [entityId])).rows[0];
    if (!entity || entity.parent_company_id !== brandId) return res.status(400).json({ message: `Pick a company or person filed under the ${label}, or find it at Companies House.` });
    if (entityId === text(deal[col.company])) return res.status(400).json({ message: "That is the company that signs. The guarantor is another company, or a person." });
    const added = (await pool.query(
      `INSERT INTO deal_guarantors (deal_id, role, company_id, entity_id, added_by, added_by_name) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (deal_id, role, entity_id) WHERE removed_at IS NULL DO NOTHING RETURNING id`,
      [deal.id, role, brandId, entityId, me.id, me.name])).rows[0];
    if (added) await audit(pool, deal.id, "guarantor", null, entityId, `${entity.name} added as the guarantor for the ${label}`, me);
    const { startPrecheck } = await import("./kyc-prechecks");
    const started = await startPrecheck(brandId, { entityId, dealId: deal.id, userId: me.id }).catch(() => null);
    res.json({ ...(await loadDealParties(pool, deal.id)), started });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not add the guarantor" });
  }
});

router.delete("/api/deals/:id/guarantors/:guarantorId", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const { pool } = await import("./db");
    const row = (await pool.query(
      `UPDATE deal_guarantors g SET removed_at = now(), removed_by_name = $3
        WHERE g.id::text = $2 AND g.deal_id = $1 AND g.removed_at IS NULL
        RETURNING g.entity_id, g.role, (SELECT name FROM crm_trading_entities e WHERE e.id = g.entity_id) AS name`,
      [String(req.params.id), String(req.params.guarantorId), me.name])).rows[0];
    if (!row) return res.status(404).json({ message: "That guarantor is not on this transaction." });
    await audit(pool, String(req.params.id), "guarantor", String(row.entity_id), null,
      `${row.name || "The guarantor"} taken off as the guarantor for the ${String(row.role)}`, me);
    res.json(await loadDealParties(pool, String(req.params.id)));
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not take the guarantor off" });
  }
});

router.post("/api/deals/:id/guarantors/:guarantorId/checks", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const { guarantorRows } = await import("./deal-guarantors");
    const g = (await guarantorRows([String(req.params.id)])).find(x => x.id === String(req.params.guarantorId));
    if (!g) return res.status(404).json({ message: "That guarantor is not on this transaction." });
    const { startPrecheck } = await import("./kyc-prechecks");
    res.json({ started: await startPrecheck(g.companyId, { entityId: g.entityId, dealId: g.dealId, userId: me.id, force: true }) });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not start the checks" });
  }
});

export default router;
