// Create billing entity (Woody, 2026-11-17, on the Promote to Solicitors box:
// "if cant find a billing entity for tenant then should be able to create one
// and search companies house? Its saying not on xero but is connected to Xero
// just new billing entity for the brand"); since the one deal form, the
// landlord's too ("the billing entity comes up linked to that tenant or
// landlord"). brandId names the landlord or brand. One route, BGP staff only:
//
//   POST /api/billing-entities   { brandId, companyNumber }
//   POST /api/billing-entities   { brandId, person: { name, email?, mobile? } }
//   POST /api/billing-entities   { brandId, abroad: { name, country, registrationNumber?, registerUrl? } }
//
// A person (Woody, 20 November 2026: "need ability to create billing entity
// or contracting entity as a person we will then KYC them"): filed under the
// brand as an entity of kind 'individual' with the CRM contact who is them
// (found by email, else added), and made a Xero contact by name. The deal then
// checks them as a private individual. `xero: false` (the party box for a
// party BGP does not bill, or the deal form's contracting entity) files
// either kind without a Xero contact.
//
// 1. The company is read from Companies House here: the request carries only
//    its number, never a name or an address.
// 2. It is saved under the brand as a company in crm_trading_entities through
//    insertTradingEntity (server/tenancy-tenant.ts, the creation door for "the
//    company on the lease"): a company of that name already under the brand is
//    reused, a brand is never made, the brand's trading_entities list is never
//    written. A new company is logged in investment_comp_migration_log.
// 3. It is made a contact in the firm's Xero through the firm-wide Xero
//    session, after a search by name, so a contact already there is used and
//    never made twice. The same call the invoice routes use to make a contact
//    (server/xero.ts, POST /Contacts), with the legal name, the company number
//    and the registered office as the postal address an invoice prints.
//
// The answer is that Xero contact in the picker's shape, so the picker selects
// it and the deal carries it. A Xero refusal leaves the company saved under the
// brand and says why. Nothing here touches a deal, a schedule row or AML.
//
// The database, the login check, Companies House and Xero are imported lazily
// so the pure parts can be tested without them
// (qa/regression/promote-to-solicitors.test.mjs).
import type { Express, NextFunction, Request, Response } from "express";
import { abroadCompanyInput, type AbroadCompany } from "@shared/foreign-company";

export const BILLING_ENTITY_STAFF_ONLY = "Only BGP staff, signed in as themselves, create a billing entity.";
// A company Companies House lists as closed cannot be billed.
export const CLOSED_COMPANY_STATUSES: readonly string[] = ["dissolved", "converted-closed", "removed", "closed"];

export interface BillingEntityInput { brandId: string; companyNumber: string }
export interface BillingPersonInput { brandId: string; person: { name: string; email: string | null; mobile: string | null } }

// Words that make a name a company's, not a person's.
const COMPANY_WORDS = /\b(limited|ltd|plc|llp|lp|inc|corp|corporation|holdings|group|trust|trustees|partnership|company|properties|investments|estates)\b/i;

/** A person typed as the billing or contracting entity, or why not. */
export function billingPersonInput(body: unknown): BillingPersonInput | { problem: string } {
  const b: Record<string, unknown> = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const brandId = typeof b.brandId === "string" ? b.brandId.trim() : "";
  const p: Record<string, unknown> = b.person && typeof b.person === "object" && !Array.isArray(b.person) ? (b.person as Record<string, unknown>) : {};
  const name = String(p.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const email = String(p.email ?? "").trim().toLowerCase().slice(0, 200) || null;
  const mobile = String(p.mobile ?? "").replace(/[^\d+() -]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || null;
  if (!brandId || brandId.length > 200) return { problem: "Pick the landlord or brand first." };
  if (name.split(" ").filter(w => /[a-z]/i.test(w)).length < 2) return { problem: "Give the person's first name and surname." };
  if (COMPANY_WORDS.test(name)) return { problem: `${name} reads as a company: find it at Companies House instead.` };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { problem: "That email does not look right." };
  return { brandId, person: { name, email, mobile } };
}

/** The contact made in Xero for a person: their name, first name and surname, and email. */
export function xeroContactForPerson(person: { name: string; email: string | null }): Record<string, unknown> {
  const words = person.name.split(" ");
  return {
    Name: person.name.slice(0, 255),
    FirstName: words.slice(0, -1).join(" ").slice(0, 255),
    LastName: words[words.length - 1].slice(0, 255),
    ...(person.email ? { EmailAddress: person.email } : {}),
  };
}

/** The brand and the Companies House number from a request, or null when either is missing or malformed. */
export function billingEntityInput(body: unknown): BillingEntityInput | null {
  const b: Record<string, unknown> = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const brandId = typeof b.brandId === "string" ? b.brandId.trim() : "";
  let companyNumber = typeof b.companyNumber === "string" ? b.companyNumber.replace(/\s+/g, "").toUpperCase() : "";
  if (/^\d{1,7}$/.test(companyNumber)) companyNumber = companyNumber.padStart(8, "0");
  if (!brandId || brandId.length > 200 || !/^[A-Z0-9]{8}$/.test(companyNumber)) return null;
  return { brandId, companyNumber };
}

export interface RegisteredOffice {
  premises?: string | null; address_line_1?: string | null; address_line_2?: string | null;
  locality?: string | null; region?: string | null; postal_code?: string | null; country?: string | null;
}

const clean = (v: unknown, max: number): string | undefined => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

/** The contact made in Xero for a company from Companies House: its legal name, its number and its registered office as the postal (POBOX) address invoices print. */
export function xeroContactFor(company: { name: string; number: string; office?: RegisteredOffice | null }): Record<string, unknown> {
  const o: RegisteredOffice = company.office || {};
  const address = {
    AddressType: "POBOX",
    AddressLine1: clean([o.premises, o.address_line_1].filter(Boolean).join(" "), 500),
    AddressLine2: clean(o.address_line_2, 500),
    City: clean(o.locality, 255),
    Region: clean(o.region, 255),
    PostalCode: clean(o.postal_code, 50),
    Country: clean(o.country, 50),
  };
  const hasAddress = Object.entries(address).some(([k, v]) => k !== "AddressType" && !!v);
  return { Name: company.name.slice(0, 255), CompanyNumber: company.number, ...(hasAddress ? { Addresses: [address] } : {}) };
}

/** The same name, read the way a person reads it: case and runs of spaces do not count. */
export const sameCompanyName = (a: unknown, b: unknown): boolean =>
  String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Why Xero did not give a contact, in plain words. Never a status code or a raw reply. */
export function xeroRefusal(message: unknown): string {
  const m = String(message ?? "");
  if (/already assigned to another contact|must be unique/i.test(m)) return "Xero already has a contact by this name. Type the name in the box to find it.";
  if (/not connected|no xero tenant/i.test(m)) return "The firm's Xero link is not connected, so no Xero contact was made. An admin connects Xero in Settings.";
  if (/rate-limiting|\b429\b/i.test(m)) return "Xero is busy. Try again in a minute.";
  return "Xero did not make the contact. Try again, or add it in Xero and search for it here.";
}

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

export type SavedEntity =
  | { id: string; name: string; companiesHouseNumber: string | null; created: boolean; kind?: "company" | "individual"; contactId?: string | null; country?: string | null; registrationNumber?: string | null }
  | { conflict: string };

/**
 * A person under the brand: the entity of kind 'individual' (one of that name
 * already filed is reused; a company of that name is not), and the CRM contact
 * who is them, found by email or added. One transaction.
 */
export async function savePersonEntity(pool: Pool, brandId: string, person: BillingPersonInput["person"], actorName: string,
  insertTradingEntity: (db: Db, entity: { parentCompanyId: string; name: string; companiesHouseNumber?: string | null }) => Promise<{ id: string; created: boolean }>,
  findOrAddPartyPerson: (db: Db, brandId: string, typed: { name: string; email: string | null; mobile: string | null; jobTitle: string | null }, note: string) => Promise<{ id: string; created: boolean }>): Promise<SavedEntity> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const made = await insertTradingEntity(client, { parentCompanyId: brandId, name: person.name, companiesHouseNumber: null });
    const row = (await client.query(`SELECT id, name, companies_house_number, entity_kind, contact_id FROM crm_trading_entities WHERE id = $1`, [made.id])).rows[0];
    const number = String(row?.companies_house_number || "").trim();
    // A company of that name already filed, with its Companies House number, is not a person.
    if (!made.created && number) {
      await client.query("ROLLBACK");
      return { conflict: number };
    }
    let contactId: string | null = row?.contact_id ? String(row.contact_id) : null;
    if (!contactId) {
      contactId = (await findOrAddPartyPerson(client, brandId, { name: person.name, email: person.email, mobile: person.mobile, jobTitle: null },
        `Added on a transaction by ${actorName} as the person who signs or is billed (20 November 2026 feature: a person as the billing or contracting entity).`)).id;
    } else if (person.email || person.mobile) {
      // Blank fields only: an email or mobile already held is kept.
      await client.query(
        `UPDATE crm_contacts SET email = COALESCE(NULLIF(email, ''), $2), phone_mobile = COALESCE(NULLIF(phone_mobile, ''), $3), updated_at = now() WHERE id = $1`,
        [contactId, person.email, person.mobile]);
    }
    await client.query(`UPDATE crm_trading_entities SET entity_kind = 'individual', contact_id = $2 WHERE id = $1`, [made.id, contactId]);
    if (made.created) {
      await client.query(
        `INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note) VALUES ($1, $2, $3, $4, $5, $6)`,
        ["billing-entity", "crm_trading_entities", made.id, "entity_created", null,
          `${actorName}: entity_created under ${brandId} as a person who signs or is billed, from a deal`]);
    }
    await client.query("COMMIT");
    return { id: made.id, name: String(row?.name || person.name), companiesHouseNumber: null, created: made.created, kind: "individual", contactId };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * The company under the brand, through the creation door. One transaction (the
 * door works inside a savepoint). A company of that name already under the
 * brand is used as it is, unless it carries a different Companies House number:
 * then nothing is written and the caller is told.
 */
export async function saveBillingEntity(pool: Pool, brandId: string, name: string, companyNumber: string, actorName: string,
  insertTradingEntity: (db: Db, entity: { parentCompanyId: string; name: string; companiesHouseNumber?: string | null }) => Promise<{ id: string; created: boolean }>): Promise<SavedEntity> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const made = await insertTradingEntity(client, { parentCompanyId: brandId, name, companiesHouseNumber: companyNumber });
    const row = (await client.query(`SELECT id, name, companies_house_number FROM crm_trading_entities WHERE id = $1`, [made.id])).rows[0];
    const held = String(row?.companies_house_number || "").replace(/\s+/g, "").toUpperCase();
    if (!made.created && held && held !== companyNumber) {
      await client.query("ROLLBACK");
      return { conflict: held };
    }
    if (made.created) {
      await client.query(
        `INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note) VALUES ($1, $2, $3, $4, $5, $6)`,
        ["billing-entity", "crm_trading_entities", made.id, "entity_created", null,
          `${actorName}: entity_created under ${brandId} as a billing entity (Companies House ${companyNumber}) from the deal form`]);
    }
    await client.query("COMMIT");
    return { id: made.id, name: String(row?.name || name), companiesHouseNumber: held || null, created: made.created };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * A company registered abroad under the brand (23 November 2026, Woody: no
 * outside providers, "all happen in the app"): its name, country, number on
 * its own register and a link to its entry. A company of that name already
 * filed with a Companies House number is a UK company, not this one.
 */
export async function saveAbroadEntity(pool: Pool, brandId: string, abroad: AbroadCompany, actorName: string,
  insertTradingEntity: (db: Db, entity: { parentCompanyId: string; name: string; companiesHouseNumber?: string | null }) => Promise<{ id: string; created: boolean }>): Promise<SavedEntity> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const made = await insertTradingEntity(client, { parentCompanyId: brandId, name: abroad.name, companiesHouseNumber: null });
    const row = (await client.query(`SELECT id, name, companies_house_number, entity_kind FROM crm_trading_entities WHERE id = $1`, [made.id])).rows[0];
    const held = String(row?.companies_house_number || "").replace(/\s+/g, "").toUpperCase();
    if (!made.created && (held || row?.entity_kind === "individual")) {
      await client.query("ROLLBACK");
      return { conflict: held || "a person" };
    }
    await client.query(`UPDATE crm_trading_entities SET country = $2, registration_number = $3, register_url = $4, updated_at = now() WHERE id = $1`,
      [made.id, abroad.country, abroad.registrationNumber, abroad.registerUrl]);
    await client.query(
      `INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note) VALUES ($1, $2, $3, $4, $5, $6)`,
      ["billing-entity", "crm_trading_entities", made.id, made.created ? "entity_created" : "entity_updated", null,
        `${actorName}: ${made.created ? "entity_created" : "recorded as registered abroad"} under ${brandId}: registered in ${abroad.country}${abroad.registrationNumber ? `, number ${abroad.registrationNumber}` : ""}, from a transaction`]);
    await client.query("COMMIT");
    return { id: made.id, name: String(row?.name || abroad.name), companiesHouseNumber: null, created: made.created, kind: "company", country: abroad.country, registrationNumber: abroad.registrationNumber };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** The firm's Xero contact by this exact name, or a new one from `body`. Never throws: a refusal is said in words. */
async function xeroContactByName(name: string, body: Record<string, unknown>): Promise<{ contact: Record<string, unknown> | null; created: boolean; error: string | null }> {
  try {
    const { withSystemXero } = await import("./xero-system-session");
    const { xeroApi, pickBillingAddress, rememberXeroContact } = await import("./xero");
    const got = await withSystemXero(async (sys: any) => {
      const found = await xeroApi(sys, `/Contacts?where=${encodeURIComponent(`Name=="${name.replace(/"/g, "")}"`)}`);
      const same = (found?.Contacts || []).find((c: any) => c?.ContactStatus !== "ARCHIVED" && sameCompanyName(c?.Name, name));
      if (same) return { contact: same, created: false, tenantId: sys?.xeroTokens?.tenantId || null };
      const made = await xeroApi(sys, "/Contacts", { method: "POST", body: JSON.stringify({ Contacts: [body] }) });
      const c = made?.Contacts?.[0];
      if (!c?.ContactID) throw new Error("Xero did not send the new contact back");
      return { contact: c, created: true, tenantId: sys?.xeroTokens?.tenantId || null };
    });
    if (!got) return { contact: null, created: false, error: xeroRefusal("Not connected") };
    const c = got.contact;
    rememberXeroContact(got.tenantId, c);
    return {
      contact: { ContactID: c.ContactID, Name: c.Name, AccountNumber: c.AccountNumber || null, EmailAddress: c.EmailAddress || null, BillingAddress: pickBillingAddress(c.Addresses), Addresses: c.Addresses || [] },
      created: got.created, error: null,
    };
  } catch (e: any) {
    console.warn("[billing-entity] Xero contact not made:", e?.message || e);
    return { contact: null, created: false, error: xeroRefusal(e?.message) };
  }
}

export function setupBillingEntityRoutes(app: Express) {
  const signedIn = (req: Request, res: Response, next: NextFunction) => {
    import("./auth").then(m => m.requireAuth(req, res, next)).catch(next);
  };

  // A sub company already filed under an account, linked to its contact in
  // the firm's Xero (Woody, 24 November 2026: the SPVs "use those for xero
  // invoicing too"): the contact there by that name, or a new one. The
  // company keeps it (crm_trading_entities.xero_contact_*), so a transaction
  // it signs bills it. BGP staff signed in as themselves.
  app.post("/api/billing-entities/:entityId/xero", signedIn, async (req: Request, res: Response) => {
    try {
      const { isClientRequestUser, resolveCompanyScope } = await import("./company-scope");
      if ((await isClientRequestUser(req)) || (await resolveCompanyScope(req))) return res.status(403).json({ message: BILLING_ENTITY_STAFF_ONLY });
      const { pool } = await import("./db");
      const entity = (await pool.query(
        `SELECT e.id, e.name, e.companies_house_number, e.entity_kind, e.contact_id, e.xero_contact_id, e.xero_contact_name, c.merged_into_id
           FROM crm_trading_entities e JOIN crm_companies c ON c.id = e.parent_company_id WHERE e.id = $1`, [String(req.params.entityId)])).rows[0];
      if (!entity || entity.merged_into_id) return res.status(404).json({ message: "That company was not found." });
      if (entity.xero_contact_id) return res.json({ contact: { ContactID: entity.xero_contact_id, Name: entity.xero_contact_name || entity.name }, xeroCreated: false, xeroError: null, already: true });
      const name = String(entity.name || "").replace(/\s+/g, " ").trim();
      if (!name) return res.status(400).json({ message: "The company has no name to find in Xero." });
      let body: Record<string, unknown> = { Name: name.slice(0, 255) };
      if (String(entity.entity_kind || "").toLowerCase() === "individual") {
        const person = entity.contact_id ? (await pool.query(`SELECT email FROM crm_contacts WHERE id = $1`, [entity.contact_id])).rows[0] : null;
        body = xeroContactForPerson({ name, email: person?.email || null });
      } else if (entity.companies_house_number) {
        let office: RegisteredOffice | null = null;
        try {
          const { chFetch } = await import("./companies-house");
          office = (await chFetch(`/company/${encodeURIComponent(String(entity.companies_house_number))}`, { timeoutMs: 15_000 }))?.registered_office_address || null;
        } catch { office = null; }
        body = xeroContactFor({ name, number: String(entity.companies_house_number), office });
      }
      const got = await xeroContactByName(name, body);
      if (got.contact) {
        await pool.query(`UPDATE crm_trading_entities SET xero_contact_id = $2, xero_contact_name = $3 WHERE id = $1`,
          [entity.id, String(got.contact.ContactID), String(got.contact.Name || name)]);
      }
      res.status(got.contact ? (got.created ? 201 : 200) : 502).json({ contact: got.contact, xeroCreated: got.created, xeroError: got.error });
    } catch (err: any) {
      console.error("[billing-entity] Xero link failed:", err?.message || err);
      res.status(500).json({ message: "It could not be linked to Xero. Try again in a moment." });
    }
  });

  // GLEIF, searched by name for the Registered abroad box (Woody, 25 November
  // 2026: "can this all not just be automatically when i type in Google LLC?").
  // Reads only. BGP staff signed in as themselves.
  app.get("/api/billing-entities/gleif-search", signedIn, async (req: Request, res: Response) => {
    try {
      const { isClientRequestUser, resolveCompanyScope } = await import("./company-scope");
      if ((await isClientRequestUser(req)) || (await resolveCompanyScope(req))) return res.status(403).json({ message: BILLING_ENTITY_STAFF_ONLY });
      const { gleifOn, searchGleifByName } = await import("./gleif");
      if (!gleifOn()) return res.json({ results: [], off: true });
      const results = await searchGleifByName(String(req.query.q || ""));
      res.json({ results: results.map(e => ({ lei: e.lei, name: e.name, country: e.country, jurisdiction: e.jurisdiction, registeredAs: e.registeredAs, status: e.status })) });
    } catch (err: any) {
      res.status(502).json({ message: err?.message || "GLEIF could not be searched. Try again in a moment.", results: [] });
    }
  });

  app.post("/api/billing-entities", signedIn, async (req: Request, res: Response) => {
    try {
      // Xero and the CRM's companies are BGP's: a client login, or BGP staff
      // viewing as a client, is refused before anything is read.
      const { isClientRequestUser, resolveCompanyScope } = await import("./company-scope");
      if ((await isClientRequestUser(req)) || (await resolveCompanyScope(req))) return res.status(403).json({ message: BILLING_ENTITY_STAFF_ONLY });
      // A company registered abroad (23 November 2026): no Companies House record.
      if (req.body && typeof req.body === "object" && req.body.abroad != null) {
        const abroadIn = abroadCompanyInput(req.body);
        if ("problem" in abroadIn) return res.status(400).json({ message: abroadIn.problem });
        const { pool } = await import("./db");
        const brand = (await pool.query(`SELECT id, name, merged_into_id FROM crm_companies WHERE id = $1`, [abroadIn.brandId])).rows[0];
        if (!brand) return res.status(404).json({ message: "That landlord or brand was not found." });
        if (brand.merged_into_id) return res.status(409).json({ message: "That landlord or brand was merged into another record. Pick it again." });
        const userId = req.session?.userId || (req as any).tokenUserId || null;
        const me = userId ? (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0] : null;
        const actorName = String(me?.name || me?.email || userId || "BGP staff");
        const { insertTradingEntity } = await import("./tenancy-tenant");
        const entity = await saveAbroadEntity(pool as unknown as Pool, brand.id, abroadIn.abroad, actorName, insertTradingEntity);
        if ("conflict" in entity) {
          return res.status(409).json({ message: entity.conflict === "a person"
            ? `${brand.name} already has a person called ${abroadIn.abroad.name}. Pick them instead.`
            : `${brand.name} already has a company called ${abroadIn.abroad.name}, with Companies House number ${entity.conflict}: a UK company. Pick that one instead.` });
        }
        if (req.body?.xero === false) return res.status(entity.created ? 201 : 200).json({ entity, contact: null, xeroCreated: false, xeroError: null });
        const got = await xeroContactByName(abroadIn.abroad.name, { Name: abroadIn.abroad.name.slice(0, 255) });
        if (got.contact) {
          await pool.query(`UPDATE crm_trading_entities SET xero_contact_id = $2, xero_contact_name = $3 WHERE id = $1`,
            [entity.id, String(got.contact.ContactID), String(got.contact.Name || abroadIn.abroad.name)]).catch((e: any) => console.warn("[billing-entity] Xero contact not kept on the company abroad:", e?.message));
        }
        return res.status(entity.created || got.created ? 201 : 200).json({ entity, contact: got.contact, xeroCreated: got.created, xeroError: got.error });
      }
      // A person (20 November 2026), or a company from Companies House.
      const personIn = req.body && typeof req.body === "object" && req.body.person != null ? billingPersonInput(req.body) : null;
      if (personIn && "problem" in personIn) return res.status(400).json({ message: personIn.problem });
      const input = personIn ? null : billingEntityInput(req.body);
      if (!personIn && !input) return res.status(400).json({ message: "Pick the company from Companies House, and the landlord or brand first." });

      const { pool } = await import("./db");
      const brand = (await pool.query(`SELECT id, name, merged_into_id FROM crm_companies WHERE id = $1`, [personIn ? personIn.brandId : input!.brandId])).rows[0];
      if (!brand) return res.status(404).json({ message: "That landlord or brand was not found." });
      if (brand.merged_into_id) return res.status(409).json({ message: "That landlord or brand was merged into another record. Pick it again." });

      if (personIn) {
        const userId = req.session?.userId || (req as any).tokenUserId || null;
        const me = userId ? (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0] : null;
        const actorName = String(me?.name || me?.email || userId || "BGP staff");
        const { insertTradingEntity } = await import("./tenancy-tenant");
        const { findOrAddPartyPerson } = await import("./deal-parties");
        const entity = await savePersonEntity(pool as unknown as Pool, brand.id, personIn.person, actorName, insertTradingEntity, findOrAddPartyPerson);
        if ("conflict" in entity) {
          return res.status(409).json({ message: `${brand.name} already has a company called ${personIn.person.name}, with Companies House number ${entity.conflict}. Pick that company instead.` });
        }
        if (req.body?.xero === false) return res.status(entity.created ? 201 : 200).json({ entity, contact: null, xeroCreated: false, xeroError: null });
        const got = await xeroContactByName(personIn.person.name, xeroContactForPerson(personIn.person));
        if (got.contact) {
          await pool.query(`UPDATE crm_trading_entities SET xero_contact_id = $2, xero_contact_name = $3 WHERE id = $1`,
            [entity.id, String(got.contact.ContactID), String(got.contact.Name || personIn.person.name)]).catch((e: any) => console.warn("[billing-entity] Xero contact not kept on the person:", e?.message));
          console.log(`[billing-entity] ${actorName} ${got.created ? "made" : "picked the existing"} Xero contact for a person under brand ${brand.id}`);
        }
        return res.status(entity.created || got.created ? 201 : 200).json({ entity, contact: got.contact, xeroCreated: got.created, xeroError: got.error });
      }
      if (!input) return res.status(400).json({ message: "Pick the company from Companies House, and the landlord or brand first." });

      // The company as Companies House holds it.
      const { chFetch } = await import("./companies-house");
      let profile: any;
      try {
        profile = await chFetch(`/company/${encodeURIComponent(input.companyNumber)}`);
      } catch (e: any) {
        const said = String(e?.message || "");
        if (/not configured/i.test(said)) return res.status(503).json({ message: "Companies House is not set up on this server, so the company cannot be looked up." });
        if (/error 404\b/i.test(said)) return res.status(404).json({ message: "Companies House has no company with that number." });
        throw e;
      }
      const name = String(profile?.company_name || "").replace(/\s+/g, " ").trim();
      if (!name) return res.status(404).json({ message: "Companies House has no company with that number." });
      if (CLOSED_COMPANY_STATUSES.includes(String(profile?.company_status || "").toLowerCase())) {
        return res.status(409).json({ message: `${name} is ${String(profile.company_status).replace(/-/g, " ")} at Companies House. Pick the live company.` });
      }

      const userId = req.session?.userId || (req as any).tokenUserId || null;
      const me = userId ? (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0] : null;
      const actorName = String(me?.name || me?.email || userId || "BGP staff");
      const { insertTradingEntity } = await import("./tenancy-tenant");
      const entity = await saveBillingEntity(pool as unknown as Pool, brand.id, name, input.companyNumber, actorName, insertTradingEntity);
      if ("conflict" in entity) {
        return res.status(409).json({ message: `${brand.name} already has a company called ${name}, with Companies House number ${entity.conflict}. Check which company is right on its page.` });
      }

      // The contact in the firm's Xero: the one already there by that name, or
      // a new one. Not when the company is only being set as the one that
      // signs (xero: false, from the deal's party box): BGP bills one side.
      let contact: Record<string, unknown> | null = null;
      let xeroCreated = false;
      let xeroError: string | null = null;
      if (req.body?.xero === false) {
        return res.status(entity.created ? 201 : 200).json({ entity, contact: null, xeroCreated: false, xeroError: null });
      }
      try {
        const { withSystemXero } = await import("./xero-system-session");
        const { xeroApi, pickBillingAddress, rememberXeroContact } = await import("./xero");
        const got = await withSystemXero(async (sys: any) => {
          const found = await xeroApi(sys, `/Contacts?where=${encodeURIComponent(`Name=="${name.replace(/"/g, "")}"`)}`);
          const same = (found?.Contacts || []).find((c: any) => c?.ContactStatus !== "ARCHIVED" && sameCompanyName(c?.Name, name));
          if (same) return { contact: same, created: false, tenantId: sys?.xeroTokens?.tenantId || null };
          const made = await xeroApi(sys, "/Contacts", {
            method: "POST",
            body: JSON.stringify({ Contacts: [xeroContactFor({ name, number: input.companyNumber, office: profile?.registered_office_address })] }),
          });
          const c = made?.Contacts?.[0];
          if (!c?.ContactID) throw new Error("Xero did not send the new contact back");
          return { contact: c, created: true, tenantId: sys?.xeroTokens?.tenantId || null };
        });
        if (!got) {
          xeroError = xeroRefusal("Not connected");
        } else {
          const c = got.contact;
          contact = { ContactID: c.ContactID, Name: c.Name, AccountNumber: c.AccountNumber || null, EmailAddress: c.EmailAddress || null,
            BillingAddress: pickBillingAddress(c.Addresses), Addresses: c.Addresses || [] };
          xeroCreated = got.created;
          rememberXeroContact(got.tenantId, c);
          // The company keeps its own Xero contact (20 November 2026), so
          // billing it is known to be billing this company.
          await pool.query(`UPDATE crm_trading_entities SET xero_contact_id = $2, xero_contact_name = $3 WHERE id = $1`,
            [entity.id, String(c.ContactID), String(c.Name || name)]).catch((e: any) => console.warn("[billing-entity] Xero contact not kept on the company:", e?.message));
          console.log(`[billing-entity] ${actorName} ${got.created ? "made" : "picked the existing"} Xero contact for ${name} (${input.companyNumber}) under brand ${brand.id}`);
        }
      } catch (e: any) {
        console.warn("[billing-entity] Xero contact not made:", e?.message || e);
        xeroError = xeroRefusal(e?.message);
      }
      res.status(entity.created || xeroCreated ? 201 : 200).json({ entity, contact, xeroCreated, xeroError });
    } catch (err: any) {
      console.error("[billing-entity] failed:", err?.message || err);
      res.status(500).json({ message: "The billing entity could not be made. Try again in a moment." });
    }
  });
}
