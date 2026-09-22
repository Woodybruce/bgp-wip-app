import type {
  ClientAgentBrand, ClientAgentDirectoryEntry, ClientAgentSource,
} from "@shared/client-agent-directory";

export interface ClientAgentDirectoryRow {
  brandId: string;
  brandName: string;
  source: ClientAgentSource;
  region: string | null;
  firmId: string | null;
  firmName: string | null;
  firmDomain: string | null;
  firmCompanyType: string | null;
  contactId: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactSpecialty: string | null;
}

// brandSliceSql comes from clientBrandSliceSql, never a request parameter.
export function buildClientAgentDirectoryQuery(
  brandSliceSql: string,
  requirementScope: string | null,
  noAccessScope: string,
): { text: string; values: (string | null)[] } {
  return {
    text: `WITH slice_brands AS (
      SELECT id, name FROM crm_companies
       WHERE ${brandSliceSql} AND merged_into_id IS NULL
         AND ($1::varchar IS NULL OR $1 <> $2::varchar)
    ), links AS (
      SELECT b.id AS "brandId", b.name AS "brandName",
             'representation'::text AS source, r.region,
             a.id AS "firmId", a.name AS "firmName",
             a.domain AS "firmDomain", a.company_type AS "firmCompanyType",
             ct.id AS "contactId", ct.name AS "contactName",
             ct.role AS "contactRole", ct.email AS "contactEmail",
             COALESCE(NULLIF(ct.phone_mobile, ''), ct.phone) AS "contactPhone",
             ct.agent_specialty AS "contactSpecialty"
        FROM brand_agent_representations r
        JOIN slice_brands b ON b.id = r.brand_company_id
        LEFT JOIN crm_companies a ON a.id = r.agent_company_id
          AND a.merged_into_id IS NULL AND a.id <> b.id
        LEFT JOIN crm_contacts ct ON ct.id = r.primary_contact_id
       WHERE r.agent_type = 'tenant_rep' AND r.end_date IS NULL
         AND (r.start_date IS NULL OR r.start_date <= now())

      UNION ALL

      SELECT b.id, b.name, 'requirement'::text, NULL::text,
             a.id, a.name, a.domain, a.company_type,
             ct.id, ct.name, ct.role, ct.email,
             COALESCE(NULLIF(ct.phone_mobile, ''), ct.phone), ct.agent_specialty
        FROM crm_requirements_leasing q
        JOIN slice_brands b ON b.id = q.company_id
        JOIN crm_contacts ct ON ct.id = q.agent_contact_id
        LEFT JOIN crm_companies a ON a.id = ct.company_id
          AND a.merged_into_id IS NULL AND a.id <> b.id
          AND a.company_type ILIKE 'Agent%'
       WHERE lower(trim(COALESCE(q.status, ''))) IN ('', 'active')
         AND ($1::varchar IS NULL OR q.company_id = $1
           OR ($1 <> $2::varchar AND 'PIPnet' = ANY(COALESCE(q.sources, '{}'::text[]))))
    )
    SELECT * FROM links
     WHERE "firmId" IS NOT NULL OR "contactId" IS NOT NULL`,
    values: [requirementScope, noAccessScope],
  };
}

function addBrand(brands: ClientAgentBrand[], row: ClientAgentDirectoryRow): void {
  let brand = brands.find(b => b.brandId === row.brandId);
  if (!brand) {
    brand = { brandId: row.brandId, brandName: row.brandName, sources: [], regions: [] };
    brands.push(brand);
  }
  if (!brand.sources.includes(row.source)) brand.sources.push(row.source);
  const region = row.region?.trim();
  if (region && !brand.regions.includes(region)) brand.regions.push(region);
}

function sortBrands(brands: ClientAgentBrand[]): void {
  brands.sort((a, b) => a.brandName.localeCompare(b.brandName, "en", { sensitivity: "base" })
    || a.brandId.localeCompare(b.brandId));
  for (const brand of brands) {
    brand.sources.sort((a, b) => Number(a === "requirement") - Number(b === "requirement"));
    brand.regions.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  }
}

export function mapClientAgentDirectoryRows(rows: ClientAgentDirectoryRow[]): ClientAgentDirectoryEntry[] {
  const entries = new Map<string, ClientAgentDirectoryEntry>();
  for (const row of rows) {
    const id = row.firmId || (row.contactId ? `contact:${row.contactId}` : null);
    const name = row.firmId ? row.firmName : row.contactName;
    if (!id || name === null) continue;
    let entry = entries.get(id);
    if (!entry) {
      entry = {
        id, name, kind: row.firmId ? "firm" : "contact", companyId: row.firmId,
        domain: row.firmId ? row.firmDomain : null,
        companyType: row.firmId ? row.firmCompanyType : null,
        contacts: [], represents: [],
      };
      entries.set(id, entry);
    }
    addBrand(entry.represents, row);
    if (row.contactId && row.contactName !== null) {
      let contact = entry.contacts.find(c => c.id === row.contactId);
      if (!contact) {
        contact = {
          id: row.contactId, name: row.contactName, role: row.contactRole,
          email: row.contactEmail, phone: row.contactPhone, specialty: row.contactSpecialty,
          represents: [],
        };
        entry.contacts.push(contact);
      }
      addBrand(contact.represents, row);
    }
  }
  const result = [...entries.values()];
  for (const entry of result) {
    sortBrands(entry.represents);
    entry.contacts.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })
      || a.id.localeCompare(b.id));
    for (const contact of entry.contacts) sortBrands(contact.represents);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    || a.id.localeCompare(b.id));
}
