// What Layla's invoice template is filled from (shared/invoice-template.ts):
// one read of the deal, its parties as they sign, the client's contact, the
// unit (its Letting Tracker name, else the schedule's) and the property's
// address. Used by the deal page's Send to Xero form (GET
// /api/xero/invoice-draft/:dealId) and the automatic draft at exchange or
// completion (server/crm.ts). It reads; it writes nothing.
import { pool } from "./db";
import { dealClientRole } from "@shared/deal-parties";
import { buildInvoiceDraft, invoiceAddress, type InvoiceDraft, type InvoiceTemplateFacts } from "@shared/invoice-template";

const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return s || null;
};
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function invoiceTemplateFactsFor(dealId: string, db: { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> } = pool): Promise<InvoiceTemplateFacts | null> {
  const { rows } = await db.query(
    `SELECT d.name, d.deal_type, d.bgp_acting_for, d.team, d.po_number, d.fee_percentage, d.rent_pa, d.fee, d.fee_currency, d.joint_agent_fee_pct,
            lb.name AS landlord_brand, ls.name AS landlord_signs,
            tb.name AS tenant_brand, ts.name AS tenant_signs,
            p.name AS property_name, p.address AS property_address, p.postcode AS property_postcode,
            coalesce(nullif(trim(tu.unit_number), ''), tu.premises) AS schedule_unit,
            (SELECT au.unit_name FROM available_units au WHERE au.deal_id = d.id ORDER BY au.updated_at DESC NULLS LAST LIMIT 1) AS tracker_unit,
            cc.name AS client_contact,
            lc.name AS landlord_contact, tc.name AS tenant_contact, vc.name AS vendor_contact, pc.name AS purchaser_contact
       FROM crm_deals d
       LEFT JOIN crm_companies lb ON lb.id = d.landlord_id
       LEFT JOIN crm_trading_entities ls ON ls.id = d.landlord_trading_entity_id AND ls.parent_company_id = d.landlord_id
       LEFT JOIN crm_companies tb ON tb.id = d.tenant_id
       LEFT JOIN crm_trading_entities ts ON ts.id = d.tenant_trading_entity_id AND ts.parent_company_id = d.tenant_id
       LEFT JOIN crm_properties p ON p.id = d.property_id
       LEFT JOIN tenancy_schedule_units tu ON tu.id = d.tenancy_unit_id
       LEFT JOIN crm_contacts cc ON cc.id = d.client_contact_id
       LEFT JOIN crm_contacts lc ON lc.id = d.landlord_contact_id
       LEFT JOIN crm_contacts tc ON tc.id = d.tenant_contact_id
       LEFT JOIN crm_contacts vc ON vc.id = d.vendor_contact_id
       LEFT JOIN crm_contacts pc ON pc.id = d.purchaser_contact_id
      WHERE d.id = $1`,
    [dealId],
  );
  const r = rows[0];
  if (!r) return null;
  const clientRole = dealClientRole({ dealType: r.deal_type, bgpActingFor: r.bgp_acting_for, team: r.team });
  // The client's own contact on the deal (landlord_contact_id and so on), when no client contact is set.
  const roleContact: Record<string, unknown> = { landlord: r.landlord_contact, tenant: r.tenant_contact, vendor: r.vendor_contact, purchaser: r.purchaser_contact };
  return {
    dealName: str(r.name),
    dealType: str(r.deal_type),
    clientRole,
    fao: str(r.client_contact) || str(roleContact[clientRole]),
    landlord: str(r.landlord_signs) || str(r.landlord_brand),
    tenant: str(r.tenant_signs) || str(r.tenant_brand),
    address: str(invoiceAddress({ unitName: r.tracker_unit || r.schedule_unit, propertyName: r.property_name, address: r.property_address, postcode: r.property_postcode })),
    poNumber: str(r.po_number),
    feePercentage: num(r.fee_percentage),
    rentPa: num(r.rent_pa),
    fee: num(r.fee),
    currency: String(r.fee_currency || "").toUpperCase() === "USD" ? "USD" : "GBP",
    jointAgentFeePct: num(r.joint_agent_fee_pct),
  };
}

export async function invoiceDraftFor(dealId: string): Promise<{ facts: InvoiceTemplateFacts; draft: InvoiceDraft } | null> {
  const facts = await invoiceTemplateFactsFor(dealId);
  return facts ? { facts, draft: buildInvoiceDraft(facts) } : null;
}
