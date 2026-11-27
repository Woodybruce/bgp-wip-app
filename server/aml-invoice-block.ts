// The hold on invoicing while AML checks are outstanding (shared/aml-invoice.ts).
// The officers switch it on (Policy pill): it is off until they do, because on
// the day it was built most of BGP's landlord clients had no checks on file.
import { pool } from "./db";
import { AML_INVOICE_BLOCK_CODE, invoiceBlockParties, invoiceBlockWords } from "@shared/aml-invoice";
import { amlRegime } from "@shared/aml-policy";
import { dealClientRole } from "@shared/deal-parties";

const SETTING = "aml_invoice_block";

export interface InvoiceBlockSetting { on: boolean; by: string | null; at: string | null }

export async function readInvoiceBlock(): Promise<InvoiceBlockSetting> {
  const row = (await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [SETTING]).catch(() => ({ rows: [] as any[] }))).rows[0];
  const v = row?.value && typeof row.value === "object" ? row.value : null;
  return { on: v?.on === true, by: v?.by ? String(v.by) : null, at: v?.at ? String(v.at) : null };
}

export async function writeInvoiceBlock(on: boolean, by: string): Promise<InvoiceBlockSetting> {
  const value = { on, by, at: new Date().toISOString() };
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`, [SETTING, JSON.stringify(value)]);
  return value;
}

/** Why this transaction cannot be invoiced yet, or null. A read that fails holds nothing. */
export async function amlInvoiceDenial(dealId: string): Promise<{ code: string; message: string } | null> {
  if (!(await readInvoiceBlock()).on) return null;
  const d = (await pool.query(
    `SELECT id, deal_type, team, rent_pa, bgp_acting_for, landlord_id, tenant_id, vendor_id, purchaser_id, aml_check_completed FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  if (!d) return null;
  // The officer's own sign-off on the transaction lifts it, as it lifts the gate.
  if (String(d.aml_check_completed || "") === "YES") return null;
  const { checkCounterpartyAml } = await import("./deal-gates");
  const gate = await checkCounterpartyAml({ dealId, landlordId: d.landlord_id, tenantId: d.tenant_id, vendorId: d.vendor_id, purchaserId: d.purchaser_id });
  const advisory = amlRegime({ dealType: d.deal_type, team: d.team, rentPa: d.rent_pa }).regime === "advisory";
  const clientRole = dealClientRole({ dealType: d.deal_type, bgpActingFor: d.bgp_acting_for, team: d.team });
  const parties = invoiceBlockParties({ notReady: gate.notReady.map(n => ({ role: String((n as any).role || ""), name: n.name, reason: n.reason })), advisory, clientRole });
  if (!parties.length) return null;
  return { code: AML_INVOICE_BLOCK_CODE, message: invoiceBlockWords(parties) };
}
