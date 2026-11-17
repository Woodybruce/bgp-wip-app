// Create billing entity (Woody, 2026-11-17, on the Promote to Solicitors box:
// "if cant find a billing entity for tenant then should be able to create one
// and search companies house? Its saying not on xero but is connected to Xero
// just new billing entity for the brand"). One route, BGP staff only:
//
//   POST /api/billing-entities   { brandId, companyNumber }
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

export const BILLING_ENTITY_STAFF_ONLY = "Only BGP staff, signed in as themselves, create a billing entity.";
// A company Companies House lists as closed cannot be billed.
export const CLOSED_COMPANY_STATUSES: readonly string[] = ["dissolved", "converted-closed", "removed", "closed"];

export interface BillingEntityInput { brandId: string; companyNumber: string }

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
  | { id: string; name: string; companiesHouseNumber: string | null; created: boolean }
  | { conflict: string };

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
          `${actorName}: entity_created under ${brandId} as a billing entity (Companies House ${companyNumber}) from the Promote to Solicitors box`]);
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

export function setupBillingEntityRoutes(app: Express) {
  const signedIn = (req: Request, res: Response, next: NextFunction) => {
    import("./auth").then(m => m.requireAuth(req, res, next)).catch(next);
  };

  app.post("/api/billing-entities", signedIn, async (req: Request, res: Response) => {
    try {
      // Xero and the CRM's companies are BGP's: a client login, or BGP staff
      // viewing as a client, is refused before anything is read.
      const { isClientRequestUser, resolveCompanyScope } = await import("./company-scope");
      if ((await isClientRequestUser(req)) || (await resolveCompanyScope(req))) return res.status(403).json({ message: BILLING_ENTITY_STAFF_ONLY });
      const input = billingEntityInput(req.body);
      if (!input) return res.status(400).json({ message: "Pick the company from Companies House, and the brand first." });

      const { pool } = await import("./db");
      const brand = (await pool.query(`SELECT id, name, merged_into_id FROM crm_companies WHERE id = $1`, [input.brandId])).rows[0];
      if (!brand) return res.status(404).json({ message: "That brand was not found." });
      if (brand.merged_into_id) return res.status(409).json({ message: "That brand was merged into another record. Pick the brand again." });

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
        return res.status(409).json({ message: `${brand.name} already has a company called ${name}, with Companies House number ${entity.conflict}. Check which company is right on the brand page.` });
      }

      // The contact in the firm's Xero: the one already there by that name, or a new one.
      let contact: Record<string, unknown> | null = null;
      let xeroCreated = false;
      let xeroError: string | null = null;
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
