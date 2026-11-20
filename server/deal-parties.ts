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
//
// The company that signs is always one filed under the party's brand: the
// deal saves refuse anything else (checkPartyCompanies, called by the deal
// doors in server/letting-service.ts), and a change of brand drops a company
// filed under the old one. A person typed here is saved to the CRM under the
// brand, so they are there next time and on the KYC4U request. An email
// already on the CRM for that brand is the same person: blank fields are
// filled, nothing is overwritten. Every change is a line in deal_audit_log.

import { Router, type Request, type Response } from "express";
import {
  DEAL_PARTY_COLUMNS, DEAL_PARTY_FIELDS, DEAL_PARTY_LABEL, DEAL_PARTY_ROLES, companyOffer, isDealPartyRole, newPartyPerson, ownerContactMatch, partyGaps, personFill,
  sameCompaniesHouseNumber,
  type DealPartyCompany, type DealPartyPerson, type DealPartyRole, type DealPartyView,
} from "@shared/deal-parties";
import { personDisplayName, personNamesMatch } from "@shared/kyc-prechecks";
import { kycPersonRoleWords } from "@shared/kyc-request";

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
        ? `${row.name} is not filed under the ${DEAL_PARTY_LABEL[role].toLowerCase()} on this deal. Pick a company filed under it.`
        : `The ${DEAL_PARTY_LABEL[role].toLowerCase()}'s company was not found. Pick it again.`);
    }
    clear[f.company] = null;
  }
  return clear;
}

interface DealRow extends Record<string, any> { id: string; name: string }

async function readDeal(db: Db, dealId: string): Promise<DealRow | null> {
  const cols = DEAL_PARTY_ROLES.flatMap(r => Object.values(DEAL_PARTY_COLUMNS[r]));
  return (await db.query(
    `SELECT id, name, deal_type, client_contact_id, tenancy_unit_id, ${cols.join(", ")} FROM crm_deals WHERE id = $1`, [dealId])).rows[0] || null;
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

export async function loadDealParties(db: Db, dealId: string): Promise<DealPartiesView | null> {
  const deal = await readDeal(db, dealId);
  if (!deal) return null;
  const roles = DEAL_PARTY_ROLES.filter(r => text(deal[DEAL_PARTY_COLUMNS[r].brand]));
  const brandIds = [...new Set(roles.map(r => String(deal[DEAL_PARTY_COLUMNS[r].brand])))];
  if (!brandIds.length) return { deal: { id: deal.id, name: deal.name }, parties: [] };
  const [brands, companies, people] = await Promise.all([
    db.query(`SELECT id, name, companies_house_number, aml_subject_type,
                     COALESCE(NULLIF(companies_house_data->'profile'->>'companyName', ''), NULLIF(companies_house_data->>'company_name', ''), NULLIF(uk_entity_name, '')) AS legal_name
                FROM crm_companies WHERE id = ANY($1::varchar[])`, [brandIds]),
    db.query(`SELECT id, parent_company_id, name, companies_house_number, is_default FROM crm_trading_entities
               WHERE parent_company_id = ANY($1::varchar[]) ORDER BY is_default DESC, lower(name)`, [brandIds]),
    db.query(`SELECT id, company_id, name, email, phone_mobile, phone, role FROM (
                SELECT c.*, row_number() OVER (PARTITION BY c.company_id ORDER BY (COALESCE(c.email, '') = ''), lower(c.name)) AS n
                  FROM crm_contacts c WHERE c.company_id = ANY($1::varchar[])) x
               WHERE n <= 80`, [brandIds]),
  ]);
  // The people set on the deal, and its client contact, even when filed elsewhere.
  const namedIds = [...new Set([...roles.map(r => text(deal[DEAL_PARTY_COLUMNS[r].person])), text(deal.client_contact_id)].filter(Boolean))];
  const named = namedIds.length
    ? (await db.query(`SELECT id, company_id, name, email, phone_mobile, phone, role FROM crm_contacts WHERE id = ANY($1::varchar[])`, [namedIds])).rows
    : [];
  const lease = roles.includes("tenant") ? await leaseCompanyId(db, deal) : null;

  const parties: DealPartyView[] = [];
  for (const role of roles) {
    const col = DEAL_PARTY_COLUMNS[role];
    const brandRow = brands.rows.find((b: any) => b.id === deal[col.brand]);
    if (!brandRow) continue;
    const filed: DealPartyCompany[] = companies.rows.filter((c: any) => c.parent_company_id === brandRow.id).map((c: any) => ({
      id: String(c.id), name: text(c.name), companiesHouseNumber: text(c.companies_house_number) || null, isDefault: !!c.is_default,
    }));
    const company = filed.find(c => c.id === deal[col.company]) || null;
    const setPerson = named.find((p: any) => p.id === deal[col.person]);
    const clientPerson = named.find((p: any) => p.id === deal.client_contact_id && p.company_id === brandRow.id);
    const person = setPerson ? { ...personOf(setPerson), from: "party" as const }
      : clientPerson ? { ...personOf(clientPerson), from: "client" as const } : null;
    const kind = String(brandRow.aml_subject_type || "").toLowerCase() === "individual" ? "individual" as const : "company" as const;
    const brandNumber = text(brandRow.companies_house_number);
    const brandOwn = kind === "company" && !company && brandNumber && !filed.some(c => sameCompaniesHouseNumber(c.companiesHouseNumber, brandNumber))
      ? { name: text(brandRow.legal_name) || text(brandRow.name), number: brandNumber } : null;
    parties.push({
      role, label: DEAL_PARTY_LABEL[role],
      brand: { id: String(brandRow.id), name: text(brandRow.name), companiesHouseNumber: text(brandRow.companies_house_number) || null, kind },
      company,
      offer: company ? null : companyOffer(filed, role === "tenant" ? lease : null),
      brandOwn,
      companies: filed,
      xero: text(deal[col.xeroId]) ? { contactId: String(deal[col.xeroId]), name: text(deal[col.xeroName]) || null } : null,
      person,
      people: people.rows.filter((p: any) => p.company_id === brandRow.id).map(personOf),
      gaps: partyGaps({ role, kind, brandName: brandRow.name, companySet: !!company, person }),
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
    if (!view) return res.status(404).json({ message: "Deal not found" });
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
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    const col = DEAL_PARTY_COLUMNS[role];
    const brandId = text(deal[col.brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the deal first.` });

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
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    const col = DEAL_PARTY_COLUMNS[role];
    const brandId = text(deal[col.brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the deal first.` });
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
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    const col = DEAL_PARTY_COLUMNS[role];
    const brandId = text(deal[col.brand]);
    if (!brandId) return res.status(400).json({ message: `Set the ${role} on the deal first.` });
    const brand = (await pool.query(`SELECT id, name, aml_subject_type FROM crm_companies WHERE id = $1`, [brandId])).rows[0];
    if (!brand) return res.status(404).json({ message: "That party was not found." });
    const kind = String(brand.aml_subject_type || "").toLowerCase() === "individual" ? "individual" as const : "company" as const;
    const { dealPeopleRequests, partyPeopleFor } = await import("./kyc-people");
    const people = await partyPeopleFor({ companyId: brandId, entityId: text(deal[col.company]) || null, kind }, await dealPeopleRequests(deal.id));
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

export default router;
