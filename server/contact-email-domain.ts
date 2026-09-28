// Move a company's contacts to a new email domain (Woody, 2026-09-28:
// Canary Wharf Group moved canarywharf.com → cwg.com). Only that company's
// contacts on the old domain change; the local part is kept. Preview first,
// then apply. An address already held by another contact is skipped, never
// duplicated.

type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

const DOMAIN_RE = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** "@CanaryWharf.com " → "canarywharf.com"; null when it isn't a domain. */
export function normaliseEmailDomain(raw: unknown): string | null {
  const d = String(raw ?? "").trim().toLowerCase().replace(/^@+/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

export type DomainMoveRow = { id: string; name: string; from: string; to: string; skipped: string | null };

/** The planned change per contact on the old domain. `taken` holds every
 *  lower-cased email already used by a contact outside this move. */
export function planEmailDomainMove(contacts: Array<{ id: string; name: string; email: string | null }>, from: string, to: string, taken: Set<string>): DomainMoveRow[] {
  const out: DomainMoveRow[] = [];
  const claimed = new Set<string>();
  for (const c of contacts) {
    const email = String(c.email || "").trim();
    const at = email.lastIndexOf("@");
    if (at <= 0 || email.slice(at + 1).toLowerCase() !== from) continue;
    const next = `${email.slice(0, at)}@${to}`;
    const key = next.toLowerCase();
    const skipped = taken.has(key) || claimed.has(key) ? `${next} is already another contact's email` : null;
    if (!skipped) claimed.add(key);
    out.push({ id: c.id, name: c.name, from: email, to: next, skipped });
  }
  return out;
}

export async function moveCompanyEmailDomain(db: Queryable, companyId: string, rawFrom: unknown, rawTo: unknown, apply: boolean) {
  const from = normaliseEmailDomain(rawFrom), to = normaliseEmailDomain(rawTo);
  if (!from || !to) throw Object.assign(new Error("Give both domains, like canarywharf.com and cwg.com."), { status: 400 });
  if (from === to) throw Object.assign(new Error("The two domains are the same."), { status: 400 });
  const company = (await db.query(`SELECT id, name FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!company) throw Object.assign(new Error("Company not found"), { status: 404 });
  const contacts = (await db.query(
    `SELECT id, name, email FROM crm_contacts WHERE company_id = $1 AND lower(split_part(trim(email), '@', 2)) = $2 ORDER BY name`,
    [companyId, from],
  )).rows;
  const wanted = contacts.map((c: any) => `${String(c.email).trim().slice(0, String(c.email).trim().lastIndexOf("@"))}@${to}`.toLowerCase());
  const taken = new Set<string>((await db.query(
    `SELECT lower(trim(email)) AS email FROM crm_contacts WHERE lower(trim(email)) = ANY($1::text[]) AND NOT (id = ANY($2::text[]))`,
    [wanted, contacts.map((c: any) => c.id)],
  )).rows.map((r: any) => r.email));
  const rows = planEmailDomainMove(contacts, from, to, taken);
  let changed = 0;
  if (apply) {
    for (const r of rows) {
      if (r.skipped) continue;
      // Guarded on the address still being the one previewed.
      const u = await db.query(`UPDATE crm_contacts SET email = $2, updated_at = now() WHERE id = $1 AND company_id = $3 AND trim(email) = $4`, [r.id, r.to, companyId, r.from]);
      changed += u.rowCount ?? 0;
    }
  }
  return { company: { id: company.id, name: company.name }, from, to, applied: apply, changed, rows };
}
