// PO numbers (Woody, 2026-09-28). Some clients only pay invoices quoting
// their purchase order — Canary Wharf Group runs "No PO No Pay". A company
// flagged crm_companies.requires_po (or whose parent is) makes every deal
// billed to it need a PO number before an invoice is raised or sent.
//
// Billed parties: the landlord side (deal landlord, the property's landlord
// and the scheme's landlord entity), the vendor / purchaser, and the tenant
// when BGP acts for the tenant.

type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

/** SQL: the billed companies of deal alias `d` that require a PO. */
function billedCompaniesSql(d: string): string {
  return `SELECT c.id, c.name
      FROM crm_companies c
      LEFT JOIN crm_companies parent ON parent.id = c.parent_company_id
     WHERE c.id IN (
             ${d}.landlord_id, ${d}.vendor_id, ${d}.purchaser_id,
             CASE WHEN ${d}.bgp_acting_for = 'tenant' THEN ${d}.tenant_id END,
             (SELECT p.landlord_id FROM crm_properties p WHERE p.id = ${d}.property_id),
             (SELECT s.billing_entity_id FROM property_schemes s
               WHERE s.property_id = ${d}.property_id
                 AND lower(trim(s.name)) = lower(trim(${d}.scheme)) LIMIT 1))
       AND (c.requires_po IS TRUE OR parent.requires_po IS TRUE)`;
}

/** SQL boolean: deal alias `d` is billed to a client that requires a PO. */
export function poRequiredSql(d = "d"): string {
  return `EXISTS (${billedCompaniesSql(d)})`;
}

export type PoCheck = { required: boolean; missing: boolean; requiredBy: Array<{ id: string; name: string }>; poNumber: string | null };

export const hasPo = (po: unknown) => typeof po === "string" && po.trim().length > 0;

/** Whether the deal needs a PO number, who asks for it, and whether it has one. */
export async function dealPoCheck(db: Queryable, dealId: string): Promise<PoCheck | null> {
  const deal = (await db.query(`SELECT id, po_number FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  if (!deal) return null;
  const requiredBy = (await db.query(`SELECT DISTINCT x.id, x.name FROM crm_deals d, LATERAL (${billedCompaniesSql("d")}) x WHERE d.id = $1`, [dealId])).rows;
  const required = requiredBy.length > 0;
  return { required, missing: required && !hasPo(deal.po_number), requiredBy, poNumber: deal.po_number || null };
}

/** The sentence shown when an invoice is blocked for want of a PO. */
export function poMissingMessage(check: PoCheck): string {
  const who = check.requiredBy.map(c => c.name).join(", ") || "This client";
  return `${who} only pays invoices that quote a PO number — add the PO number to the deal before raising the invoice.`;
}
