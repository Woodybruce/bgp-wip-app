// The Landsec Hospitality & Leisure instruction is 14 schemes in four groups
// (docs/landsec-pitch-plan.md). The CRM holds 65-odd properties linked to
// Landsec — this registry says which records ARE the instruction and which
// group each sits in, so the Landsec home, the client property list and the
// analytics all agree. Records are matched by name, not id: the live DB has
// duplicates (a second Liverpool ONE, five Victoria records, Queens Arcade
// alongside St David's) and every one rolls up under its scheme until the
// admin merges them on the home page.
import { pool } from "./db";

export type LandsecGroup = "North" | "South" | "Outlets" | "London";

export interface LandsecScheme {
  key: string;
  name: string;
  town: string;
  group: LandsecGroup;
  // The requirement-form region chips this scheme answers to (Brand CRM
  // requirement chip, shared/brand-stage.ts). There is no Yorkshire chip, so
  // the Leeds schemes sit under North East until Woody says otherwise.
  regions: string[];
  match: RegExp;
}

export const LANDSEC_GROUPS: LandsecGroup[] = ["North", "South", "Outlets", "London"];

export const LANDSEC_SCHEMES: LandsecScheme[] = [
  { key: "liverpool-one", name: "Liverpool ONE", town: "Liverpool", group: "North", regions: ["North West"], match: /liverpool\s*(one|1)\b/i },
  { key: "trinity-leeds", name: "Trinity Leeds", town: "Leeds", group: "North", regions: ["North East"], match: /\btrinity\b(?!\s*walk)/i },
  { key: "white-rose", name: "White Rose", town: "Leeds", group: "North", regions: ["North East"], match: /white\s*rose/i },
  { key: "buchanan-galleries", name: "Buchanan Galleries", town: "Glasgow", group: "North", regions: ["Scotland"], match: /buchanan/i },
  { key: "bluewater", name: "Bluewater", town: "Kent", group: "South", regions: ["South East"], match: /bluewater/i },
  { key: "westgate-oxford", name: "Westgate Oxford", town: "Oxford", group: "South", regions: ["South East"], match: /westgate/i },
  { key: "st-davids", name: "St David's & Queens Arcade", town: "Cardiff", group: "South", regions: ["Wales"], match: /st\.?\s*david|queen'?s?\s*arcade/i },
  { key: "gunwharf-quays", name: "Gunwharf Quays", town: "Portsmouth", group: "Outlets", regions: ["South East"], match: /gunwharf/i },
  { key: "clarks-village", name: "Clarks Village", town: "Street", group: "Outlets", regions: ["South West"], match: /clarks\s*village/i },
  { key: "braintree-village", name: "Braintree Village", town: "Braintree", group: "Outlets", regions: ["East Anglia"], match: /braintree/i },
  { key: "one-new-change", name: "One New Change", town: "London EC4", group: "London", regions: ["London"], match: /one\s*new\s*change|\bonc\b/i },
  { key: "new-street-square", name: "New Street Square", town: "London EC4", group: "London", regions: ["London"], match: /new\s*street\s*sq/i },
  { key: "lucent", name: "Lucent", town: "London W1", group: "London", regions: ["London"], match: /\blucent\b|piccadilly\s*lights/i },
  { key: "victoria", name: "Victoria", town: "London SW1", group: "London", regions: ["London"], match: /cardinal\s*place|123\s*victoria|victoria\s*(street|estate|london|sw1)|\bnova\s*victoria|^victoria\b(?!\s*(centre|center|quarter|gate|square|park|place|shopping|station|road|rd))/i },
];

export function schemeForPropertyName(name: string | null | undefined): LandsecScheme | null {
  if (!name) return null;
  return LANDSEC_SCHEMES.find(s => s.match.test(name)) || null;
}

export interface SchemePropertyRow {
  id: string;
  name: string;
  address: any;
  status: string | null;
  asset_class: string | null;
  lat: string | null;
  lng: string | null;
  units: number;
  vacant: number;
  passing_rent: number;
  rent_units: number;
  deals: number;
  files: number;
}

export interface ResolvedScheme extends Omit<LandsecScheme, "match"> {
  properties: SchemePropertyRow[];
  canonicalId: string | null;
}

export interface LandsecPortfolio {
  companyId: string;
  schemes: ResolvedScheme[];
  outOfScope: SchemePropertyRow[];
}

const cache = new Map<string, { at: number; value: LandsecPortfolio }>();
const CACHE_MS = 2 * 60 * 1000;

export function clearLandsecPortfolioCache() {
  cache.clear();
}

// The Landsec company row (the client scope id). Name match, same rule the
// analytics endpoint and the Properties page use.
export async function landsecCompanyId(): Promise<string | null> {
  const r = await pool.query(
    `SELECT id FROM crm_companies
      WHERE regexp_replace(lower(name), '[^a-z]', '', 'g') IN ('landsec', 'landsecurities')
      ORDER BY (SELECT COUNT(*) FROM crm_company_properties cp WHERE cp.company_id = crm_companies.id) DESC
      LIMIT 1`
  );
  return r.rows[0]?.id || null;
}

export async function isLandsecCompany(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const r = await pool.query(
    `SELECT 1 FROM crm_companies WHERE id = $1 AND regexp_replace(lower(name), '[^a-z]', '', 'g') IN ('landsec', 'landsecurities') LIMIT 1`,
    [companyId]
  );
  return r.rows.length > 0;
}

// Every property linked to the company, bucketed into the 14 schemes.
// Within a scheme the canonical record is the one with the most tenancy
// units (then deals, then the oldest) — that is where links go until the
// duplicates are merged.
export async function resolveLandsecPortfolio(companyId: string): Promise<LandsecPortfolio> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const r = await pool.query(
    `SELECT p.id, p.name, p.address, p.status, p.asset_class, p.latitude AS lat, p.longitude AS lng, p.created_at,
            (SELECT COUNT(*) FROM tenancy_schedule_units t WHERE t.property_id = p.id)::int AS units,
            (SELECT COUNT(*) FROM tenancy_schedule_units t WHERE t.property_id = p.id AND t.status IN ('Vacant', 'Void', 'Available'))::int AS vacant,
            (SELECT COALESCE(SUM(t.passing_rent_pa), 0) FROM tenancy_schedule_units t WHERE t.property_id = p.id
               AND t.status NOT IN ('Vacant', 'Void', 'Available'))::float AS passing_rent,
            (SELECT COUNT(*) FROM tenancy_schedule_units t WHERE t.property_id = p.id AND t.passing_rent_pa > 0
               AND t.status NOT IN ('Vacant', 'Void', 'Available'))::int AS rent_units,
            (SELECT COUNT(*) FROM crm_deals d WHERE d.property_id = p.id)::int AS deals
       FROM crm_properties p
      WHERE p.landlord_id = $1
         OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1)
      ORDER BY p.name`,
    [companyId]
  );

  // Brochure + plan counts guide the admin's choice of keeper when merging;
  // the tables may be missing on an older DB, so a failure just reads 0.
  const files = new Map<string, number>();
  if (r.rows.length > 0) {
    await pool.query(
      `SELECT property_id, COUNT(*)::int AS n FROM (
         SELECT property_id FROM property_brochures WHERE property_id = ANY($1)
         UNION ALL
         SELECT property_id FROM property_plans WHERE property_id = ANY($1)
       ) f GROUP BY property_id`,
      [r.rows.map((x: any) => x.id)]
    ).then(q => { for (const row of q.rows) files.set(row.property_id, row.n); }).catch(() => undefined);
  }

  const schemes: ResolvedScheme[] = LANDSEC_SCHEMES.map(({ match: _m, ...s }) => ({ ...s, properties: [], canonicalId: null }));
  const outOfScope: SchemePropertyRow[] = [];
  for (const row of r.rows) {
    const scheme = schemeForPropertyName(row.name);
    const prop: SchemePropertyRow = {
      id: row.id, name: row.name, address: row.address, status: row.status, asset_class: row.asset_class,
      lat: row.lat, lng: row.lng, units: row.units, vacant: row.vacant, passing_rent: row.passing_rent,
      rent_units: row.rent_units, deals: row.deals, files: files.get(row.id) || 0,
    };
    if (!scheme) { outOfScope.push(prop); continue; }
    schemes.find(s => s.key === scheme.key)!.properties.push(prop);
  }
  for (const s of schemes) {
    s.properties.sort((a, b) => (b.units - a.units) || (b.deals - a.deals) || a.name.localeCompare(b.name));
    s.canonicalId = s.properties[0]?.id || null;
  }

  const value = { companyId, schemes, outOfScope };
  cache.set(companyId, { at: Date.now(), value });
  return value;
}

// Property ids inside the 14 schemes — the filter the client property list
// and the portfolio endpoint apply so the 51 out-of-scope Landsec records
// stay out of the client's view.
export async function landsecSchemePropertyIds(companyId: string): Promise<Set<string>> {
  const portfolio = await resolveLandsecPortfolio(companyId);
  const ids = new Set<string>();
  for (const s of portfolio.schemes) for (const p of s.properties) ids.add(p.id);
  return ids;
}

// The live letting pipeline per scheme (stage counts, days at stage, where
// the tracker and the deals differ) is landsecCounts in
// server/landsec-counts.ts: one rule, counted from the deal.
