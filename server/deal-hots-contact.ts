// A solicitor or agent read from heads of terms, filed in the CRM (Woody,
// 23 November 2026: "the HOTs upload / drop didnt pick up their solcitors or
// ours or their agent"). The only write the heads of terms screen makes of its
// own: the firm and its person, linked to the transaction. What goes on the
// transaction itself is saved through the transaction's own save.

import { legalNameKey } from "@shared/deal-hots";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * The firm and its person in the CRM: the person by their email first (and
 * their firm with them), else the firm by its name (an agent firm, or a law
 * firm typed "Solicitor"), else added. A person already there only gains
 * blank fields. The person is linked to the transaction.
 */
export async function fileHotsContact(db: Db, input: { dealId: string; dealName: string; kind: "solicitor" | "agent"; firm: string; person: string | null; email: string | null; phone: string | null }): Promise<{
  company: { id: string; name: string; created: boolean }; contact: { id: string; name: string; created: boolean } | null;
}> {
  const type = input.kind === "agent" ? "Agent" : "Solicitor";
  let contact: { id: string; name: string; company_id: string | null; email: string | null; phone: string | null } | null = input.email
    ? (await db.query(`SELECT id, name, company_id, email, phone FROM crm_contacts WHERE lower(btrim(email)) = lower($1) ORDER BY created_at ASC NULLS LAST LIMIT 1`, [input.email])).rows[0] || null
    : null;
  let company: { id: string; name: string; created: boolean } | null = null;
  if (contact?.company_id) {
    const row = (await db.query(`SELECT id, name FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL`, [contact.company_id])).rows[0];
    if (row) company = { id: String(row.id), name: String(row.name), created: false };
  }
  if (!company) {
    const key = legalNameKey(input.firm);
    const rows = (await db.query(
      `SELECT id, name, company_type FROM crm_companies
        WHERE merged_into_id IS NULL AND lower(btrim(name)) = lower(btrim($1))
        ORDER BY (lower(coalesce(company_type, '')) = lower($2)) DESC, created_at ASC NULLS LAST LIMIT 5`, [input.firm, type])).rows;
    const row = rows.find((r: any) => legalNameKey(r.name) === key) || rows[0];
    if (row) company = { id: String(row.id), name: String(row.name), created: false };
  }
  if (!company) {
    const { storage } = await import("./storage");
    const made: any = await storage.createCrmCompany({ name: input.firm, companyType: type } as any);
    company = { id: String(made.id), name: String(made.name || input.firm), created: true };
  }
  if (!contact && input.person) {
    contact = (await db.query(`SELECT id, name, company_id, email, phone FROM crm_contacts WHERE company_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1`, [company.id, input.person])).rows[0] || null;
  }
  let created = false;
  if (contact) {
    // Blank fields only: never overwrite what the CRM holds.
    await db.query(
      `UPDATE crm_contacts SET email = COALESCE(NULLIF(btrim(email), ''), $2), phone = COALESCE(NULLIF(btrim(phone), ''), $3),
              company_id = COALESCE(company_id, $4), company_name = COALESCE(NULLIF(btrim(company_name), ''), $5)
        WHERE id = $1`, [contact.id, input.email, input.phone, company.id, company.name]);
  } else if (input.person || input.email) {
    const { storage } = await import("./storage");
    const made: any = await storage.createCrmContact({
      name: input.person || input.email!, email: input.email || null, phone: input.phone || null, companyId: company.id, companyName: company.name,
      role: input.kind === "agent" ? "Agent" : "Solicitor",
      notes: `Added from the heads of terms of ${input.dealName}`,
    } as any);
    contact = { id: String(made.id), name: String(made.name), company_id: company.id, email: input.email, phone: input.phone };
    created = true;
  }
  if (contact) {
    await db.query(`INSERT INTO crm_contact_deals (contact_id, deal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [contact.id, input.dealId]).catch(() => undefined);
  }
  return { company, contact: contact ? { id: String(contact.id), name: String(contact.name), created } : null };
}

