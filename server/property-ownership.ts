// The Ownership & KYC tab of the property page (Woody, 23 November 2026: "the
// landreg search should really feed the inital KYC. We dont need to KYC every
// building but have the option to from there? then we can set a builidng up
// and AML / KUYC the client from there when we get an instruction").
//
//   GET  /api/properties/:id/ownership        who owns the building at Land Registry, the roles, the owner's checks
//   POST /api/properties/:id/ownership/use    { titleNumber, dataset, position }: record the title, set the empty
//                                              roles, file the owner under the Owner (what the AML box offers)
//   GET  /api/properties/:id/ownership?title=WM757813   the same, with that title looked up (a person typed it)
//
// The KYC on a company filed here is the shared client KYC window (one build
// for AML, 24 November 2026): BGP's checks start only when a person opens it.
//
// BGP staff signed in as themselves only. Free data only: the Land Registry
// company ownership lists loaded in the app (hmlr_proprietors, CCOD and OCOD);
// never PropertyData, which charges per title. Rules: shared/property-ownership.ts.
import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { propertyLookupIdentity } from "@shared/property-lookup-identity";
import {
  OWNERSHIP_ROLES, addressNamesBuilding, addressNumberAndStreet, buildingSearchTerm, countryWords, isUnitLease, ownershipKycWords, postTown,
  sameRegisteredCompany, titleFit, titleUsePlan, unnumberedStreet,
  type LandRegistryProprietor, type OwnershipCompanyRef, type OwnershipKyc, type PropertyOwnershipView,
  type ProprietorView, type TitleView,
} from "@shared/property-ownership";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const tidyNumber = (v: unknown): string | null => {
  const s = String(v ?? "").replace(/\s+/g, "").toUpperCase();
  if (!s) return null;
  return /^\d+$/.test(s) ? s.padStart(8, "0") : s;
};
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

async function staffMe(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) } : null;
}

// The SQL twin of legalNameKey (shared/deal-hots.ts), to find candidates by
// name; every candidate is checked again with legalNameKey itself.
const LEGAL_FORM = `(limited|ltd|public limited company|plc|llp|limited liability partnership|lp|llc|inc|incorporated)`;
export const nameKeySql = (col: string): string =>
  `replace(regexp_replace(regexp_replace(regexp_replace(btrim(regexp_replace(replace(replace(lower(coalesce(${col}, '')), '&', ' and '), '''', ''), '[^a-z0-9]+', ' ', 'g')), '^the\\s+', ''), '\\s*\\m${LEGAL_FORM}\\s*$', ''), '\\s*\\m${LEGAL_FORM}\\s*$', ''), ' ', '')`;
const numberKeySql = (col: string): string => `lpad(upper(regexp_replace(coalesce(${col}, ''), '\\s', '', 'g')), 8, '0')`;

interface PropertyRow {
  id: string; name: string; address: unknown; postcode: string | null;
  title_number: string | null; proprietor_name: string | null; proprietor_company_number: string | null; proprietor_address: string | null; title_search_date: unknown;
  landlord_id: string | null; freeholder_id: string | null; long_leaseholder_id: string | null; senior_lender_id: string | null; junior_lender_id: string | null; asset_manager_id: string | null;
}

async function readProperty(db: Db, id: string, lock = false): Promise<PropertyRow | null> {
  return (await db.query(
    `SELECT id, name, address, postcode, title_number, proprietor_name, proprietor_company_number, proprietor_address, title_search_date,
            landlord_id, freeholder_id, long_leaseholder_id, senior_lender_id, junior_lender_id, asset_manager_id
       FROM crm_properties WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id])).rows[0] || null;
}

const PROPRIETOR_COLUMNS = `title_number, dataset, proprietor_position, proprietor_name, proprietor_category, company_registration_no, country_incorporated,
  proprietor_address_1, proprietor_address_2, proprietor_address_3, to_char(date_proprietor_added, 'YYYY-MM-DD') AS date_added,
  price_paid, property_address, tenure`;

interface TitleRow { titleNumber: string; tenure: string | null; propertyAddress: string | null; pricePaid: string | null; dateAdded: string | null; proprietors: LandRegistryProprietor[] }

function groupTitles(rows: any[]): TitleRow[] {
  const by = new Map<string, TitleRow>();
  for (const r of rows) {
    const tn = text(r.title_number);
    if (!tn || !text(r.proprietor_name)) continue;
    if (!by.has(tn)) by.set(tn, { titleNumber: tn, tenure: text(r.tenure) || null, propertyAddress: text(r.property_address) || null, pricePaid: text(r.price_paid) || null, dateAdded: text(r.date_added) || null, proprietors: [] });
    const t = by.get(tn)!;
    if (t.proprietors.some(p => p.dataset === r.dataset && p.position === Number(r.proprietor_position))) continue;
    t.proprietors.push({
      name: text(r.proprietor_name),
      category: text(r.proprietor_category) || null,
      number: tidyNumber(r.company_registration_no),
      country: text(r.country_incorporated) || null,
      address: [r.proprietor_address_1, r.proprietor_address_2, r.proprietor_address_3].map(text).filter(Boolean).join(", ") || null,
      dataset: r.dataset === "ocod" ? "ocod" : "ccod",
      position: Number(r.proprietor_position) || 1,
    });
  }
  return [...by.values()];
}

/** Whether the Land Registry lists are loaded, when they were last loaded, and a failed refresh since. */
async function landRegistryState(db: Db): Promise<PropertyOwnershipView["landRegistry"]> {
  const { isHmlrProprietorsAvailable } = await import("./hmlr-direct");
  const available = await isHmlrProprietorsAvailable().catch(() => false);
  if (!available) return { available: false, loadedOn: null, refreshFailed: null };
  const runs = (await db.query(
    `SELECT max(finished_at) FILTER (WHERE status = 'ok') AS loaded, max(started_at) FILTER (WHERE status = 'error') AS failed
       FROM hmlr_ingest_runs WHERE dataset IN ('ccod', 'ocod')`).catch(() => ({ rows: [] as any[] }))).rows[0] || {};
  const loaded = iso(runs.loaded), failed = iso(runs.failed);
  return { available, loadedOn: loaded, refreshFailed: failed && (!loaded || failed > loaded) ? failed : null };
}

interface Candidates {
  companies: Array<{ id: string; name: string; number: string | null; companyType: string | null }>;
  entities: Array<{ id: string; name: string; number: string | null; parentId: string; parentName: string; parentNumber: string | null }>;
}

// The CRM companies and the companies filed under accounts that could be one of these owners.
async function crmCandidates(db: Db, proprietors: LandRegistryProprietor[]): Promise<Candidates> {
  const numbers = [...new Set(proprietors.map(p => p.number).filter((n): n is string => !!n))];
  const { legalNameKey } = await import("@shared/deal-hots");
  const keys = [...new Set(proprietors.map(p => legalNameKey(p.name)).filter(Boolean))];
  if (!numbers.length && !keys.length) return { companies: [], entities: [] };
  const [companies, entities] = await Promise.all([
    db.query(
      `SELECT id, name, companies_house_number, company_type FROM crm_companies
        WHERE merged_into_id IS NULL AND ((companies_house_number IS NOT NULL AND ${numberKeySql("companies_house_number")} = ANY($1::text[])) OR ${nameKeySql("name")} = ANY($2::text[]))
        LIMIT 60`, [numbers, keys]),
    db.query(
      `SELECT e.id, e.name, e.companies_house_number, e.parent_company_id, c.name AS parent_name, c.companies_house_number AS parent_number
         FROM crm_trading_entities e JOIN crm_companies c ON c.id = e.parent_company_id
        WHERE c.merged_into_id IS NULL AND ((e.companies_house_number IS NOT NULL AND ${numberKeySql("e.companies_house_number")} = ANY($1::text[])) OR ${nameKeySql("e.name")} = ANY($2::text[]))
        LIMIT 60`, [numbers, keys]),
  ]);
  return {
    companies: companies.rows.map((r: any) => ({ id: String(r.id), name: text(r.name), number: tidyNumber(r.companies_house_number), companyType: text(r.company_type) || null })),
    entities: entities.rows.map((r: any) => ({ id: String(r.id), name: text(r.name), number: tidyNumber(r.companies_house_number), parentId: String(r.parent_company_id), parentName: text(r.parent_name), parentNumber: tidyNumber(r.parent_number) })),
  };
}

async function kycFor(db: Db, ownerId: string, entityId: string): Promise<OwnershipKyc> {
  const { loadPartyKyc } = await import("./deal-gates");
  const state = (await loadPartyKyc(db as any, [{ role: "owner", brandId: ownerId, entityId, fullChecks: true }]).catch(() => ({} as Record<string, any>)))["owner"];
  return ownershipKycWords(state || null);
}

// The titles a wider search reads: by the building's own name in its town, and freeholds on its street.
const LIKE = (v: string) => `%${v.replace(/[\\%_]/g, "")}%`;
async function titlesBeyondPostcode(db: Db, q: { name: string | null; street: string | null; town: string | null; outcode: string | null }): Promise<{ byName: any[]; byStreet: any[] }> {
  const near = `(($2::text IS NOT NULL AND postcode_normalised IS NOT NULL AND length(postcode_normalised) > 3 AND left(postcode_normalised, length(postcode_normalised) - 3) = $2)
                 OR ($3::text IS NOT NULL AND lower(property_address) LIKE $3))`;
  const town = q.town ? LIKE(q.town.toLowerCase()) : null;
  if (!q.outcode && !town) return { byName: [], byStreet: [] };
  const [byName, byStreet] = await Promise.all([
    q.name ? db.query(`SELECT ${PROPRIETOR_COLUMNS} FROM hmlr_proprietors WHERE lower(property_address) LIKE $1 AND ${near} ORDER BY title_number, dataset, proprietor_position LIMIT 300`,
      [LIKE(q.name), q.outcode, town]).then(r => r.rows).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    q.street ? db.query(`SELECT ${PROPRIETOR_COLUMNS} FROM hmlr_proprietors WHERE lower(property_address) LIKE $1 AND lower(tenure) = 'freehold' AND ${near} ORDER BY title_number, dataset, proprietor_position LIMIT 200`,
      [LIKE(q.street.toLowerCase()), q.outcode, town]).then(r => r.rows).catch(() => [] as any[]) : Promise.resolve([] as any[]),
  ]);
  return { byName, byStreet };
}

const isFreehold = (t: { tenure: string | null }) => /^free/i.test(t.tenure || "");
const isLeasehold = (t: { tenure: string | null }) => /^lease/i.test(t.tenure || "");

/** The Ownership & KYC view of one property. `typedTitle`: a title number a person typed, looked up too. */
export async function loadPropertyOwnership(propertyId: string, db: Db = pool, opts: { withChecks?: boolean; typedTitle?: string | null } = {}): Promise<PropertyOwnershipView | null> {
  const p = await readProperty(db, propertyId);
  if (!p) return null;
  const { postcode } = propertyLookupIdentity({ postcode: p.postcode, address: p.address });
  const place = addressNumberAndStreet(p.address) || addressNumberAndStreet(p.name);
  const landRegistry = await landRegistryState(db);

  const rows: any[] = [];
  if (landRegistry.available && postcode) {
    rows.push(...(await db.query(
      `SELECT ${PROPRIETOR_COLUMNS} FROM hmlr_proprietors WHERE postcode_normalised = $1 ORDER BY title_number, dataset, proprietor_position LIMIT 400`,
      [postcode.replace(/\s+/g, "").toUpperCase()]).catch(() => ({ rows: [] as any[] }))).rows);
  }
  const storedTitle = text(p.title_number).toUpperCase() || null;
  if (landRegistry.available && storedTitle && !rows.some(r => text(r.title_number).toUpperCase() === storedTitle)) {
    rows.push(...(await db.query(`SELECT ${PROPRIETOR_COLUMNS} FROM hmlr_proprietors WHERE title_number = $1 ORDER BY dataset, proprietor_position`, [storedTitle])
      .catch(() => ({ rows: [] as any[] }))).rows);
  }
  const grouped = groupTitles(rows);
  const fits = grouped.map(t => {
    const onRecord = !!storedTitle && t.titleNumber.toUpperCase() === storedTitle;
    const fit = onRecord ? "record" as const : titleFit(t.propertyAddress, { name: p.name, number: place?.number || null, street: place?.street || null });
    return { t, onRecord, fit };
  });
  // A lease of a unit here is a tenant's (Touchwood's shops), listed apart and never offered as the Long leaseholder.
  const unitLease = (t: TitleRow) => isLeasehold(t) && isUnitLease(t.propertyAddress);
  const tenureRank = (t: TitleRow) => (isFreehold(t) ? 0 : isLeasehold(t) ? 1 : 2);
  const order = { record: 0, address: 1, name: 2, postcode: 3 } as const;
  const fitted = fits.filter(f => f.fit);
  const here = fitted.filter(f => f.onRecord || !unitLease(f.t))
    .sort((a, b) => tenureRank(a.t) - tenureRank(b.t) || Number(b.onRecord) - Number(a.onRecord) || order[a.fit!] - order[b.fit!] || a.t.titleNumber.localeCompare(b.t.titleNumber))
    .slice(0, 20);
  const units: TitleRow[] = fitted.filter(f => !f.onRecord && unitLease(f.t)).map(f => f.t);
  const nearby = fitted.length ? [] : fits.filter(f => !f.fit).map(f => f.t).sort((a, b) => tenureRank(a) - tenureRank(b) || a.titleNumber.localeCompare(b.titleNumber)).slice(0, 12);

  // No freehold among the building's titles: look beyond its postcode (Touchwood, 24 November 2026).
  let freeholds: PropertyOwnershipView["freeholds"] = null;
  const candidates: Array<{ t: TitleRow; fit: "elsewhere" | "street" }> = [];
  if (landRegistry.available && !here.some(f => isFreehold(f.t))) {
    const firstAddressPart = text(typeof p.address === "string" ? p.address : (p.address as any)?.street || "").split(",")[0];
    const searched = {
      name: buildingSearchTerm(p.name) || buildingSearchTerm(firstAddressPart),
      street: unnumberedStreet(p.address) || place?.street || null,
      town: postTown(p.address, p.name),
    };
    const outcode = postcode ? postcode.replace(/\s+/g, "").toUpperCase().slice(0, -3) || null : null;
    const seen = new Set([...grouped.map(t => t.titleNumber)]);
    const wider = await titlesBeyondPostcode(db, { ...searched, outcode });
    for (const t of groupTitles(wider.byName)) {
      if (seen.has(t.titleNumber) || !addressNamesBuilding(t.propertyAddress, searched.name!, null)) continue;
      seen.add(t.titleNumber);
      if (isFreehold(t)) candidates.push({ t, fit: "elsewhere" });
      else if (unitLease(t)) units.push(t);
    }
    for (const t of groupTitles(wider.byStreet)) {
      if (seen.has(t.titleNumber)) continue;
      seen.add(t.titleNumber);
      candidates.push({ t, fit: "street" });
    }
    freeholds = { searched, titles: [] };
  }

  // A title number a person typed (from the lease's register, or the map).
  const typedNumber = text(opts.typedTitle).toUpperCase().replace(/\s+/g, "") || null;
  let typed: TitleRow | null = null;
  if (landRegistry.available && typedNumber) {
    typed = groupTitles((await db.query(`SELECT ${PROPRIETOR_COLUMNS} FROM hmlr_proprietors WHERE title_number = $1 ORDER BY dataset, proprietor_position`, [typedNumber])
      .catch(() => ({ rows: [] as any[] }))).rows)[0] || null;
  }

  const roleIds = OWNERSHIP_ROLES.map(r => ({ ...r, id: text((p as any)[r.column]) || null }));
  const roleCompanies = (await db.query(
    `SELECT id, name, companies_house_number, kyc_status, kyc_expires_at, kyc_approved_by FROM crm_companies WHERE id = ANY($1::varchar[])`,
    [[...new Set(roleIds.map(r => r.id).filter(Boolean))]])).rows;
  const ref = (row: any): OwnershipCompanyRef | null => (row ? { id: String(row.id), name: text(row.name), companiesHouseNumber: tidyNumber(row.companies_house_number) } : null);
  const owner = ref(roleCompanies.find((c: any) => c.id === p.landlord_id));
  const longLeaseholder = ref(roleCompanies.find((c: any) => c.id === p.long_leaseholder_id));
  const freeholder = ref(roleCompanies.find((c: any) => c.id === p.freeholder_id));
  // Whom a title's owner is filed under for the AML: the Long leaseholder for a head lease; for a freehold, the
  // Freeholder when the building is held on a long lease (Touchwood), else the Owner.
  const accountFor = (t: TitleRow, onRecord: boolean) => (isLeasehold(t) ? longLeaseholder
    : p.long_leaseholder_id && !onRecord && isFreehold(t) ? freeholder : owner);

  const cappedCandidates = candidates.sort((a, b) => (a.fit === b.fit ? a.t.titleNumber.localeCompare(b.t.titleNumber) : a.fit === "elsewhere" ? -1 : 1)).slice(0, 12);
  const allProprietors = [...here.map(f => f.t), ...nearby, ...cappedCandidates.map(c => c.t), ...(typed ? [typed] : [])].flatMap(t => t.proprietors);
  const cands = await crmCandidates(db, allProprietors);
  const roles = { freeholderId: text(p.freeholder_id) || null, longLeaseholderId: text(p.long_leaseholder_id) || null };

  const proprietorView = async (t: TitleRow, onRecord: boolean, pr: LandRegistryProprietor, unit: boolean): Promise<ProprietorView> => {
    if (unit) return { ...pr, account: null, filed: null, isAccount: false, crm: null, elsewhere: null, use: null, kyc: null };
    const account = accountFor(t, onRecord);
    const fitsIt = (c: { name: string; number: string | null }) => sameRegisteredCompany({ name: pr.name, number: pr.number }, { name: c.name, number: c.number });
    const filedRow = account ? cands.entities.find(e => e.parentId === account.id && fitsIt(e)) : undefined;
    const isAccount = !!account && sameRegisteredCompany({ name: pr.name, number: pr.number }, { name: account.name, number: account.companiesHouseNumber });
    const crmRow = cands.companies.find(fitsIt);
    const elsewhereRow = cands.entities.find(e => (!account || e.parentId !== account.id) && fitsIt(e));
    const filed = filedRow ? { entityId: filedRow.id, name: filedRow.name } : null;
    const crm = crmRow ? { id: crmRow.id, name: crmRow.name, companiesHouseNumber: crmRow.number } : null;
    const use = titleUsePlan({ onRecord, tenure: t.tenure, owner, proprietor: { filed: !!filed, crm }, roles });
    const withKyc = opts.withChecks !== false && account && filed;
    return {
      ...pr,
      account,
      filed,
      isAccount,
      crm,
      elsewhere: elsewhereRow ? { entityId: elsewhereRow.id, name: elsewhereRow.name, under: { id: elsewhereRow.parentId, name: elsewhereRow.parentName, companiesHouseNumber: elsewhereRow.parentNumber } } : null,
      use,
      kyc: withKyc ? await kycFor(db, account!.id, filed!.entityId) : null,
    };
  };
  const view = async (t: TitleRow, onRecord: boolean, fit: TitleView["fit"]): Promise<TitleView> => ({
    titleNumber: t.titleNumber, tenure: t.tenure, propertyAddress: t.propertyAddress, pricePaid: t.pricePaid, dateAdded: t.dateAdded,
    fit, onRecord,
    proprietors: await Promise.all(t.proprietors.map(pr => proprietorView(t, onRecord, pr, fit === "unit"))),
  });

  const unitTitles = [...new Map(units.map(t => [t.titleNumber, t])).values()]
    .sort((a, b) => text(a.propertyAddress).localeCompare(text(b.propertyAddress), "en", { numeric: true })).slice(0, 40);
  if (freeholds) freeholds.titles = await Promise.all(cappedCandidates.map(c => view(c.t, false, c.fit)));
  return {
    property: { id: p.id, name: text(p.name), postcode: postcode || null, number: place?.number || null, street: place?.street || null },
    landRegistry,
    stored: storedTitle || text(p.proprietor_name) ? {
      titleNumber: storedTitle, proprietorName: text(p.proprietor_name) || null, proprietorCompanyNumber: tidyNumber(p.proprietor_company_number),
      proprietorAddress: text(p.proprietor_address) || null, searchedAt: iso(p.title_search_date),
    } : null,
    titles: await Promise.all(here.map(f => view(f.t, f.onRecord, f.fit!))),
    postcodeTitles: await Promise.all(nearby.map(t => view(t, false, "postcode"))),
    unitLeases: await Promise.all(unitTitles.map(t => view(t, false, "unit"))),
    freeholds,
    ...(typedNumber ? { typed: typed ? await view(typed, !!storedTitle && typed.titleNumber === storedTitle, "typed") : null, typedNumber } : {}),
    roles: roleIds.map(r => {
      const c = roleCompanies.find((x: any) => x.id === r.id);
      return {
        field: r.field, label: r.label,
        company: c ? { id: String(c.id), name: text(c.name), companiesHouseNumber: tidyNumber(c.companies_house_number), kyc: ownershipKycWords({ status: c.kyc_status, expiresAt: c.kyc_expires_at, approvedBy: c.kyc_approved_by }) } : null,
      };
    }),
    owner,
  };
}

/**
 * File a title's owner under an account for the AML (the Owner, or the Long
 * leaseholder): a UK company with its number; a company on Land Registry's
 * overseas list with its country, so BGP's checks look for it abroad.
 */
async function fileUnder(client: Db, accountId: string, pr: LandRegistryProprietor, companyName: string): Promise<{ id: string } | { conflict: string }> {
  const { insertTradingEntity } = await import("./tenancy-tenant");
  const made = await insertTradingEntity(client as any, { parentCompanyId: accountId, name: companyName, companiesHouseNumber: pr.number });
  const held = (await client.query(`SELECT companies_house_number, country FROM crm_trading_entities WHERE id = $1`, [made.id])).rows[0];
  const heldNumber = tidyNumber(held?.companies_house_number);
  if (!made.created && heldNumber && pr.number && heldNumber !== pr.number) return { conflict: String(held.companies_house_number) };
  if (!made.created && !heldNumber && pr.number) {
    await client.query(`UPDATE crm_trading_entities SET companies_house_number = $2 WHERE id = $1 AND companies_house_number IS NULL`, [made.id, pr.number]);
  }
  const country = pr.dataset === "ocod" && !pr.number ? countryWords(pr.country) : null;
  if (country && !text(held?.country)) {
    await client.query(`UPDATE crm_trading_entities SET country = $2, updated_at = now() WHERE id = $1 AND country IS NULL`, [made.id, country]);
  }
  return { id: made.id };
}

const CLOSED = ["dissolved", "converted-closed", "removed", "closed"];

/**
 * Use one owner of one title: what titleUsePlan says, done on the server
 * from the Land Registry row read again here, never from the request. The
 * title goes on the property; an empty Owner is set to the CRM company that
 * is this company (or a new one); an empty Freeholder (freehold title) or Long
 * leaseholder (leasehold title) is set to the Owner; and the company is filed
 * under the Owner, so a transaction's AML box offers it as the company that
 * signs. A role a person set is never changed.
 */
export async function useLandRegistryOwner(propertyId: string, pick: { titleNumber: string; dataset: string | null; position: number | null }, actor: { id: string; name: string }):
  Promise<{ status: number; message: string; done?: string[] }> {
  const titleNumber = text(pick.titleNumber).toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{0,4}\d{1,9}$/.test(titleNumber)) return { status: 400, message: "Which Land Registry title?" };
  const { findProprietorsByTitle } = await import("./hmlr-direct");
  const rows = (await findProprietorsByTitle(titleNumber).catch(() => [])).filter(r => text(r.proprietorName));
  if (!rows.length) return { status: 404, message: `Land Registry's lists in the app hold no owner for title ${titleNumber}.` };
  const row = rows.find(r => r.dataset === pick.dataset && r.position === pick.position) || rows[0];
  const pr: LandRegistryProprietor = {
    name: text(row.proprietorName), category: text(row.proprietorCategory) || null, number: tidyNumber(row.companyRegistrationNo),
    country: text(row.countryIncorporated) || null, address: text(row.proprietorAddress) || null, dataset: row.dataset, position: row.position,
  };

  // The company as Companies House holds it now, when Land Registry gives a UK number.
  let registeredName: string | null = null;
  if (pr.number && process.env.COMPANIES_HOUSE_API_KEY) {
    try {
      const { chFetch } = await import("./companies-house");
      const profile: any = await chFetch(`/company/${encodeURIComponent(pr.number)}`, { timeoutMs: 15_000 });
      registeredName = text(profile?.company_name) || null;
      if (CLOSED.includes(text(profile?.company_status).toLowerCase())) {
        return { status: 409, message: `${registeredName || pr.name} is ${text(profile.company_status).replace(/-/g, " ")} at Companies House. Land Registry's list may be out of date: check the title before using it.` };
      }
    } catch { /* Companies House busy or down: Land Registry's name is used */ }
  }
  const companyName = registeredName || pr.name;

  const client = await (pool as any).connect();
  const done: string[] = [];
  try {
    await client.query("BEGIN");
    const p = await readProperty(client, propertyId, true);
    if (!p) { await client.query("ROLLBACK"); return { status: 404, message: "Property not found." }; }
    const onRecord = text(p.title_number).toUpperCase() === titleNumber && sameRegisteredCompany({ name: p.proprietor_name, number: p.proprietor_company_number }, { name: pr.name, number: pr.number });
    const exists = async (id: string | null) => (id && (await client.query(`SELECT 1 FROM crm_companies WHERE id = $1`, [id])).rows[0] ? id : null);
    let ownerId = await exists(text(p.landlord_id) || null);
    const leaseholderId = await exists(text(p.long_leaseholder_id) || null);
    const leasehold = text(row.tenure).toLowerCase() === "leasehold";
    const freeholderId = await exists(text(p.freeholder_id) || null);
    // Whom the company is filed under for the AML: the Long leaseholder for a head lease; for a freehold, the
    // Freeholder when the building is held on a long lease, else the Owner.
    const asFreeholder = !leasehold && !!leaseholderId && !onRecord && text(row.tenure).toLowerCase() === "freehold";
    const accountId = leasehold ? leaseholderId : asFreeholder ? freeholderId : ownerId;
    const cands = await crmCandidates(client, [pr]);
    const fitsIt = (c: { name: string; number: string | null }) => sameRegisteredCompany({ name: pr.name, number: pr.number }, { name: c.name, number: c.number });
    const filedRow = accountId ? cands.entities.find(e => e.parentId === accountId && fitsIt(e)) : undefined;
    const crmRow = cands.companies.find(fitsIt) || null;
    const plan = titleUsePlan({
      onRecord, tenure: row.tenure, owner: ownerId ? { id: ownerId } : null, proprietor: { filed: !!filedRow, crm: crmRow },
      roles: { freeholderId, longLeaseholderId: leaseholderId },
      // A lease of a unit is a tenant's: never the building's Long leaseholder (unless a person put it on the record).
      unitLease: leasehold && !onRecord && text(p.title_number).toUpperCase() !== titleNumber && isUnitLease(row.propertyAddress),
    });
    if (!plan) { await client.query("ROLLBACK"); return { status: 200, message: "Already set up from this title.", done: [] }; }

    // A head lease's owner (the Long leaseholder), or a freehold's on a building held on a long lease (the
    // Freeholder): the empty pill, to the CRM company that is it, and the company filed under it.
    if (plan.kind === "long_leaseholder" || plan.kind === "freeholder") {
      const column = plan.kind === "long_leaseholder" ? "long_leaseholder_id" : "freeholder_id";
      const role = plan.kind === "long_leaseholder" ? "Long leaseholder" : "Freeholder";
      let holderId = plan.kind === "long_leaseholder" ? leaseholderId : freeholderId;
      if (plan.company !== "keep") {
        const companyId = crmRow ? crmRow.id : String((await client.query(
          `INSERT INTO crm_companies (name, companies_house_number, company_type) VALUES ($1, $2, 'Landlord') RETURNING id`, [companyName, pr.number])).rows[0].id);
        if (!crmRow) done.push(`${companyName} added to the CRM`);
        const set = await client.query(`UPDATE crm_properties SET ${column} = $2, updated_at = now() WHERE id = $1 AND ${column} IS NULL RETURNING id`, [propertyId, companyId]);
        if (set.rows[0]) { done.push(`${role} set`); holderId = companyId; }
        else holderId = await exists(text((await client.query(`SELECT ${column} AS id FROM crm_properties WHERE id = $1`, [propertyId])).rows[0]?.id) || null);
      }
      if (plan.files && holderId) {
        const filed = await fileUnder(client, holderId, pr, companyName);
        if ("conflict" in filed) {
          await client.query("ROLLBACK");
          return { status: 409, message: `The ${role} already has a company called ${companyName}, with number ${filed.conflict}. Check which company is right on its page.` };
        }
        done.push(`${companyName} filed for the AML`);
      }
    } else {
    if (plan.records) {
      await client.query(
        `UPDATE crm_properties SET title_number = $2, proprietor_name = $3, proprietor_type = 'company', proprietor_address = $4,
                proprietor_company_number = $5, title_search_date = now(), updated_at = now() WHERE id = $1`,
        [propertyId, titleNumber, pr.name, pr.address, pr.number]);
      done.push(`title ${titleNumber} recorded`);
    }
    if (!ownerId) {
      if (crmRow) {
        ownerId = crmRow.id;
      } else {
        ownerId = String((await client.query(
          `INSERT INTO crm_companies (name, companies_house_number, company_type) VALUES ($1, $2, 'Landlord') RETURNING id`, [companyName, pr.number])).rows[0].id);
        done.push(`${companyName} added to the CRM`);
      }
      await client.query(`UPDATE crm_properties SET landlord_id = $2, updated_at = now() WHERE id = $1 AND landlord_id IS NOT DISTINCT FROM $3`, [propertyId, ownerId, p.landlord_id]);
      done.push("Owner set");
    }
    if (plan.freeholder) {
      const set = await client.query(`UPDATE crm_properties SET freeholder_id = $2, updated_at = now() WHERE id = $1 AND freeholder_id IS NULL RETURNING id`, [propertyId, ownerId]);
      if (set.rows[0]) done.push("Freeholder set");
    }
    if (plan.files) {
      const filed = await fileUnder(client, ownerId!, pr, companyName);
      if ("conflict" in filed) {
        await client.query("ROLLBACK");
        return { status: 409, message: `The owner already has a company called ${companyName}, with Companies House number ${filed.conflict}. Check which company is right on its page.` };
      }
      done.push(`${companyName} filed under the owner`);
    }
    }
    await client.query(
      `INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note) VALUES ($1, $2, $3, $4, $5, $6)`,
      ["property-ownership", "crm_properties", propertyId, "land_registry_owner_used",
        JSON.stringify({ title_number: p.title_number, proprietor_name: p.proprietor_name, landlord_id: p.landlord_id, freeholder_id: p.freeholder_id, long_leaseholder_id: p.long_leaseholder_id }),
        `${actor.name}: title ${titleNumber}, ${pr.name}${pr.number ? ` (${pr.number})` : ""}: ${done.join(", ")}`]);
    await client.query("COMMIT");
    return { status: 200, message: done.join(", "), done };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const router = Router();

router.get("/api/properties/:id/ownership", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const typed = typeof req.query.title === "string" ? text(req.query.title).toUpperCase().replace(/\s+/g, "") : "";
    if (typed && !/^[A-Z]{0,4}\d{1,9}$/.test(typed)) return res.status(400).json({ message: "A Land Registry title number looks like WM757813." });
    const view = await loadPropertyOwnership(String(req.params.id), pool, { typedTitle: typed || null });
    if (!view) return res.status(404).json({ message: "Property not found." });
    res.json(view);
  } catch (e: any) {
    console.error("[property-ownership] read failed:", e?.message);
    res.status(500).json({ message: "The building's ownership could not be read." });
  }
});

router.post("/api/properties/:id/ownership/use", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await useLandRegistryOwner(String(req.params.id), {
      titleNumber: text(body.titleNumber), dataset: body.dataset === "ocod" ? "ocod" : body.dataset === "ccod" ? "ccod" : null,
      position: Number.isFinite(Number(body.position)) ? Number(body.position) : null,
    }, me);
    if (out.status !== 200) return res.status(out.status).json({ message: out.message });
    res.json({ message: out.message, done: out.done || [], view: await loadPropertyOwnership(String(req.params.id)) });
  } catch (e: any) {
    console.error("[property-ownership] use failed:", e?.message);
    res.status(500).json({ message: "The owner could not be set up." });
  }
});

export default router;
