// ── Fill blanks from Xero (Woody, 2026-10-12: "can you access Xero — does it
// have everyone's contact info? … yes do both") ──────────────────────────
// Two admin-only fills, each previewed and only written when an admin
// presses Apply. They only fill EMPTY fields — nothing in the app is
// overwritten — and nothing is written to Xero.
//   staff      Xero Payroll → date of birth, home address and personal email
//              for staff linked to their payroll record (HR → Link to Xero).
//              Payroll's phone number is NOT copied: the profile phone shows
//              on business cards and email signatures.
//   companies  Xero contacts → a CRM company's phone and head office address
//              when blank, plus Xero's contact people (and the main billing
//              email) as CRM contacts when that email isn't in the CRM yet.
//              Matched only where the names agree exactly and uniquely.

import { pool } from "./db";
import { xeroApi, xeroPayrollApi } from "./xero";

const key = (s: unknown) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\b(limited|ltd|plc|llp|the)\b/g, " ").replace(/[^a-z0-9]/g, "");
const clean = (s: unknown) => String(s ?? "").trim();

async function session() {
  const { getSystemXeroSession } = await import("./xero-system-session");
  const s = await getSystemXeroSession();
  if (!s) throw Object.assign(new Error("Xero isn't connected — connect it on the Finance page first"), { status: 409 });
  return s;
}

export type StaffFill = { userId: string; name: string; fields: Record<string, string> };

export async function planStaffFill(): Promise<{ fills: StaffFill[]; unlinked: string[] }> {
  const s = await session();
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.dob, u.address, u.personal_email, sp.xero_employee_id
       FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE u.is_active IS NOT FALSE AND lower(u.email) LIKE '%@brucegillinghampollard.com' ORDER BY u.name`);
  const fills: StaffFill[] = [];
  const unlinked: string[] = [];
  for (const u of rows) {
    if (!u.xero_employee_id) { unlinked.push(u.name); continue; }
    if (clean(u.dob) && clean(u.address) && clean(u.personal_email)) continue;
    let e: any;
    try {
      const d = await xeroPayrollApi(s, `/Employees/${u.xero_employee_id}`);
      e = d.employee || d.Employee || d.Employees?.[0] || d.employees?.[0];
    } catch { continue; }
    if (!e) continue;
    const fields: Record<string, string> = {};
    const dob = clean(e.dateOfBirth || e.DateOfBirth).slice(0, 10);
    if (!clean(u.dob) && /^\d{4}-\d{2}-\d{2}$/.test(dob)) fields.dob = dob;
    const a = e.address || e.Address || {};
    const addr = [a.addressLine1 || a.AddressLine1, a.addressLine2 || a.AddressLine2, a.city || a.City, a.postCode || a.PostCode].map(clean).filter(Boolean).join(", ");
    if (!clean(u.address) && addr) fields.address = addr;
    const email = clean(e.email || e.Email).toLowerCase();
    if (!clean(u.personal_email) && email && email !== String(u.email || "").toLowerCase() && !email.endsWith("@brucegillinghampollard.com")) fields.personal_email = email;
    if (Object.keys(fields).length) fills.push({ userId: u.id, name: u.name, fields });
  }
  return { fills, unlinked };
}

export async function applyStaffFill(): Promise<{ people: number; fields: number }> {
  const { fills } = await planStaffFill();
  let n = 0;
  for (const f of fills) {
    for (const [col, val] of Object.entries(f.fields)) {
      if (!["dob", "address", "personal_email"].includes(col)) continue;
      // Re-checked blank at write time — never overwrites.
      const r = await pool.query(`UPDATE users SET ${col} = $2 WHERE id = $1 AND COALESCE(${col}, '') = ''`, [f.userId, val]);
      n += r.rowCount || 0;
    }
  }
  return { people: fills.length, fields: n };
}

type XeroContact = { ContactID: string; Name: string; EmailAddress?: string; FirstName?: string; LastName?: string; Phones?: any[]; Addresses?: any[]; ContactPersons?: any[]; ContactStatus?: string };
async function allXeroContacts(s: any): Promise<XeroContact[]> {
  const out: XeroContact[] = [];
  for (let page = 1; page <= 100; page++) {
    const d = await xeroApi(s, `/Contacts?page=${page}&includeArchived=false`);
    const list: XeroContact[] = d.Contacts || [];
    out.push(...list);
    if (list.length < 100) break;
  }
  return out.filter(c => c.ContactStatus !== "ARCHIVED");
}

export type CompanyFill = { companyId: string; company: string; xeroName: string; phone?: string; address?: { address: string; city?: string; postcode?: string }; newContacts: Array<{ name: string; email: string }> };

export async function planCompanyFill(): Promise<{ fills: CompanyFill[]; xeroContacts: number; matched: number }> {
  const s = await session();
  const contacts = await allXeroContacts(s);
  const { rows: companies } = await pool.query(`SELECT id, name, uk_entity_name, phone, head_office_address FROM crm_companies`);
  const byKey = new Map<string, any[]>();
  for (const c of companies) for (const k of new Set([key(c.name), key(c.uk_entity_name)].filter(k => k.length >= 3))) byKey.set(k, [...(byKey.get(k) || []), c]);
  const xeroByKey = new Map<string, number>();
  for (const x of contacts) xeroByKey.set(key(x.Name), (xeroByKey.get(key(x.Name)) || 0) + 1);
  const { rows: emailRows } = await pool.query(`SELECT lower(email) AS e FROM crm_contacts WHERE email IS NOT NULL AND email <> ''`);
  const known = new Set(emailRows.map((r: any) => r.e));
  const fills: CompanyFill[] = [];
  let matched = 0;
  for (const x of contacts) {
    const k = key(x.Name);
    const hits = byKey.get(k) || [];
    if (k.length < 3 || hits.length !== 1 || xeroByKey.get(k) !== 1) continue;
    matched++;
    const c = hits[0];
    const fill: CompanyFill = { companyId: c.id, company: c.name, xeroName: x.Name, newContacts: [] };
    const phone = (x.Phones || []).find((p: any) => p.PhoneType === "DEFAULT" && clean(p.PhoneNumber)) || (x.Phones || []).find((p: any) => clean(p.PhoneNumber));
    if (!clean(c.phone) && phone) fill.phone = [phone.PhoneCountryCode ? `+${clean(phone.PhoneCountryCode).replace(/^\+/, "")}` : "", clean(phone.PhoneAreaCode), clean(phone.PhoneNumber)].filter(Boolean).join(" ");
    const addr = (x.Addresses || []).find((a: any) => a.AddressType === "STREET" && clean(a.AddressLine1)) || (x.Addresses || []).find((a: any) => clean(a.AddressLine1));
    if (!c.head_office_address && addr) {
      const line = [addr.AddressLine1, addr.AddressLine2, addr.AddressLine3, addr.City, addr.PostalCode].map(clean).filter(Boolean).join(", ");
      fill.address = { address: line, ...(clean(addr.City) ? { city: clean(addr.City) } : {}), ...(clean(addr.PostalCode) ? { postcode: clean(addr.PostalCode) } : {}) };
    }
    const people = [
      { name: [x.FirstName, x.LastName].map(clean).filter(Boolean).join(" "), email: clean(x.EmailAddress).toLowerCase() },
      ...(x.ContactPersons || []).map((p: any) => ({ name: [p.FirstName, p.LastName].map(clean).filter(Boolean).join(" "), email: clean(p.EmailAddress).toLowerCase() })),
    ];
    for (const p of people) {
      if (!p.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) || known.has(p.email) || fill.newContacts.some(n => n.email === p.email)) continue;
      fill.newContacts.push({ name: p.name || `Accounts – ${c.name}`, email: p.email });
    }
    if (fill.phone || fill.address || fill.newContacts.length) fills.push(fill);
  }
  return { fills, xeroContacts: contacts.length, matched };
}

export async function applyCompanyFill(): Promise<{ companies: number; phones: number; addresses: number; contacts: number }> {
  const { fills } = await planCompanyFill();
  let phones = 0, addresses = 0, contacts = 0;
  for (const f of fills) {
    if (f.phone) phones += (await pool.query(`UPDATE crm_companies SET phone = $2 WHERE id = $1 AND COALESCE(phone, '') = ''`, [f.companyId, f.phone])).rowCount || 0;
    if (f.address) addresses += (await pool.query(`UPDATE crm_companies SET head_office_address = $2::jsonb WHERE id = $1 AND head_office_address IS NULL`, [f.companyId, JSON.stringify(f.address)])).rowCount || 0;
    for (const p of f.newContacts) {
      const r = await pool.query(
        `INSERT INTO crm_contacts (name, email, company_id, company_name, role, notes, enrichment_source)
         SELECT $1, $2, $3, $4, 'Accounts / billing', 'Added from their Xero contact', 'xero'
          WHERE NOT EXISTS (SELECT 1 FROM crm_contacts WHERE lower(email) = $2)`, [p.name, p.email, f.companyId, f.company]);
      contacts += r.rowCount || 0;
    }
  }
  return { companies: fills.length, phones, addresses, contacts };
}
