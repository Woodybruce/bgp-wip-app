// Everyone on a transaction, with their email and phone (Woody, 24 November
// 2026, on #4664's Parties & AML: "add up there all the other contacts on the
// deal with email and phone number? should be client/s and the details of the
// other side plus advisors agents and solicitors and ability to add a contact
// to the deal"). The groups and words: shared/deal-people.ts.
//
//   GET    /api/deals/:id/people                       everyone, grouped
//   GET    /api/deals/:id/people/search?q=             CRM contacts to add
//   POST   /api/deals/:id/people                       add someone (a CRM contact, or a new one)
//   DELETE /api/deals/:id/people/:contactId            take off someone added here
//   POST   /api/deals/:id/people/:contactId/details    fill a blank email or phone
//
// BGP staff signed in as themselves. Read from where each person is already
// recorded: each party's person to ask, the client contact, the agents, our
// client's solicitors, the solicitors checked at the SRA, and the contacts
// linked to the transaction (crm_contact_deals). Only a contact added here is
// taken off here; the others change where they are set. Details are filled
// where blank, never overwritten (the contact page edits them).
import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { DEAL_PARTY_COLUMNS, DEAL_PARTY_LABEL, DEAL_PARTY_ROLES, dealClientRole, type DealPartyRole } from "@shared/deal-parties";
import { SOLICITOR_SIDE_WORDS, sameSolicitorFirm, solicitorSideOf, type SolicitorCheck } from "@shared/solicitor-aml";
import {
  DEAL_PEOPLE_GROUP_LABEL, PARTY_AGENT_WORDS, cleanPhone, groupForLinked, isDealPeopleGroup, isUkMobile, linkedRoleWords, mergePeople,
  newDealContact, partyWords, personPhones, type DealPeopleGroup, type DealPeopleView, type DealPerson,
} from "@shared/deal-people";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const text = (v: unknown): string => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
const emailOf = (v: unknown): string | null => { const t = text(v).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null; };
const BGP_EMAIL = /@brucegillinghampollard\.com$/i;

// The joint agent first, then each party's own agent.
const AGENT_COLUMNS: Array<{ firm: string; person: string; words: string }> = [
  { firm: "joint_agent_id", person: "joint_agent_contact_id", words: "Joint agent with BGP" },
  { firm: "leasing_agent_id", person: "leasing_agent_contact_id", words: PARTY_AGENT_WORDS.landlord },
  { firm: "acquisition_agent_id", person: "acquisition_agent_contact_id", words: PARTY_AGENT_WORDS.tenant },
  { firm: "vendor_agent_id", person: "vendor_agent_contact_id", words: PARTY_AGENT_WORDS.vendor },
  { firm: "purchaser_agent_id", person: "purchaser_agent_contact_id", words: PARTY_AGENT_WORDS.purchaser },
];

/** Our client's solicitor as the heads of terms save it: "Name · email · phone". */
export function parseSolicitorContact(v: unknown): { name: string | null; email: string | null; phone: string | null } {
  const parts = text(v).split(/\s+·\s+/).map(p => p.trim()).filter(Boolean);
  const email = parts.map(emailOf).find(Boolean) || null;
  const phone = parts.filter(p => !p.includes("@")).map(cleanPhone).find(Boolean) || null;
  const name = parts.find(p => !p.includes("@") && !cleanPhone(p)) || null;
  return { name: name ? name.slice(0, 120) : null, email, phone };
}

function personFrom(c: any, group: DealPeopleGroup, role: string | null, linked = false): DealPerson {
  return {
    key: `contact:${c.id}`,
    contactId: String(c.id),
    name: text(c.name) || "Unnamed",
    company: text(c.co_name) || text(c.company_name) || null,
    companyId: c.company_id ? String(c.company_id) : null,
    jobTitle: text(c.role) || null,
    email: emailOf(c.email),
    phones: personPhones(c),
    detailsFrom: null,
    group,
    roles: role ? [role] : [],
    linked,
    noPerson: false,
  };
}

// The head office the SRA's register gives for a firm checked on the transaction.
function sraContact(check: SolicitorCheck | undefined): { email: string | null; phone: string | null; name: string | null } {
  const sra = check?.register?.sra || null;
  return { email: emailOf(sra?.headOffice?.email), phone: cleanPhone(sra?.headOffice?.phone), name: text(sra?.name) || null };
}

export async function loadDealPeople(db: Db, dealId: string): Promise<DealPeopleView | null> {
  const partyCols = DEAL_PARTY_ROLES.flatMap(r => [DEAL_PARTY_COLUMNS[r].brand, DEAL_PARTY_COLUMNS[r].person]);
  const agentCols = AGENT_COLUMNS.flatMap(a => [a.firm, a.person]);
  const d = (await db.query(
    `SELECT id, name, deal_type, team, bgp_acting_for, client_contact_id, solicitor_firm, solicitor_contact, ${[...partyCols, ...agentCols].join(", ")}
       FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  if (!d) return null;
  const clientRole = dealClientRole({ dealType: d.deal_type, bgpActingFor: d.bgp_acting_for, team: d.team });

  const links = (await db.query(
    `SELECT contact_id, deal_group, deal_label FROM crm_contact_deals WHERE deal_id = $1 ORDER BY added_at NULLS FIRST`, [dealId])).rows;
  const contactIds = new Set<string>();
  const companyIds = new Set<string>();
  for (const r of DEAL_PARTY_ROLES) {
    if (d[DEAL_PARTY_COLUMNS[r].brand]) companyIds.add(String(d[DEAL_PARTY_COLUMNS[r].brand]));
    if (d[DEAL_PARTY_COLUMNS[r].person]) contactIds.add(String(d[DEAL_PARTY_COLUMNS[r].person]));
  }
  if (d.client_contact_id) contactIds.add(String(d.client_contact_id));
  for (const a of AGENT_COLUMNS) {
    // Older rows hold a person in the firm column (ids never collide across the two tables).
    if (d[a.firm]) { companyIds.add(String(d[a.firm])); contactIds.add(String(d[a.firm])); }
    if (d[a.person]) contactIds.add(String(d[a.person]));
  }
  for (const l of links) contactIds.add(String(l.contact_id));

  const contacts = contactIds.size ? (await db.query(
    `SELECT c.id, c.name, c.email, c.phone, c.phone_mobile, c.role, c.company_id, c.company_name, co.name AS co_name, co.company_type
       FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id WHERE c.id = ANY($1::varchar[])`, [[...contactIds]])).rows : [];
  const companies = companyIds.size ? (await db.query(
    `SELECT id, name, company_type, phone FROM crm_companies WHERE id = ANY($1::varchar[])`, [[...companyIds]])).rows : [];
  const contactById = new Map<string, any>(contacts.map((c: any) => [String(c.id), c]));
  const companyById = new Map<string, any>(companies.map((c: any) => [String(c.id), c]));

  const entries: DealPerson[] = [];
  const parties: DealPeopleView["parties"] = [];
  const named = new Set<DealPartyRole>();
  const brandOf: Partial<Record<DealPartyRole, string>> = {};
  for (const role of DEAL_PARTY_ROLES) {
    const brandId = d[DEAL_PARTY_COLUMNS[role].brand];
    if (!brandId) continue;
    brandOf[role] = String(brandId);
    parties.push({ role, name: text(companyById.get(String(brandId))?.name) || DEAL_PARTY_LABEL[role], client: role === clientRole });
    const person = contactById.get(String(d[DEAL_PARTY_COLUMNS[role].person] || ""));
    if (person) {
      entries.push(personFrom(person, role === clientRole ? "client" : "other_side", `Who to ask (${partyWords(role)})`));
      named.add(role);
    }
  }
  const client = contactById.get(String(d.client_contact_id || ""));
  if (client) { entries.push(personFrom(client, "client", "Client contact")); named.add(clientRole); }

  for (const a of AGENT_COLUMNS) {
    const firmId = d[a.firm] ? String(d[a.firm]) : null;
    const firm = firmId ? companyById.get(firmId) : null;
    const person = contactById.get(String(d[a.person] || "")) || (firmId && !firm ? contactById.get(firmId) : null);
    if (person) {
      const p = personFrom(person, "agents", a.words);
      if (firm && !p.company) { p.company = text(firm.name) || null; p.companyId = firmId; }
      entries.push(p);
    } else if (firm) {
      const phone = cleanPhone(firm.phone);
      entries.push({
        key: `firm:${firmId}`, contactId: null, name: text(firm.name) || "Agent", company: null, companyId: firmId, jobTitle: null,
        email: null, phones: phone ? [phone] : [], detailsFrom: phone ? "firm" : null, group: "agents", roles: [a.words], linked: false, noPerson: true,
      });
    }
  }

  const otherBrandIds = DEAL_PARTY_ROLES.filter(r => r !== clientRole && brandOf[r]).map(r => brandOf[r]!);
  for (const l of links) {
    const c = contactById.get(String(l.contact_id));
    if (!c) continue;
    const group = groupForLinked({ chosen: l.deal_group, companyId: c.company_id ? String(c.company_id) : null, companyType: c.company_type || null, clientBrandId: brandOf[clientRole] || null, otherBrandIds });
    entries.push(personFrom(c, group, linkedRoleWords(group, text(l.deal_label) || null), true));
    if (group === "client") named.add(clientRole);
    for (const r of DEAL_PARTY_ROLES) if (brandOf[r] && String(c.company_id || "") === brandOf[r]) named.add(r);
    if (group === "other_side" && otherBrandIds.length === 1) {
      const only = DEAL_PARTY_ROLES.find(r => r !== clientRole && brandOf[r]);
      if (only) named.add(only);
    }
  }

  // Solicitors: ours as the transaction records them, and every firm checked at the SRA.
  const checks = (await db.query(
    `SELECT DISTINCT ON (lower(firm)) firm, result FROM kyc_solicitor_checks WHERE deal_id = $1 ORDER BY lower(firm), checked_at DESC`, [dealId])
    .catch(() => ({ rows: [] as any[] }))).rows as Array<{ firm: string; result: SolicitorCheck }>;
  const onDeal = text(d.solicitor_firm) || null;
  const checkFor = (firm: string) => checks.find(c => sameSolicitorFirm(c.firm, firm) || sameSolicitorFirm(c.result?.register?.sra?.name, firm))?.result;
  if (onDeal) {
    const typed = parseSolicitorContact(d.solicitor_contact);
    const sra = sraContact(checkFor(onDeal));
    let held: any = null;
    if (typed.name || typed.email) {
      held = contacts.find((c: any) => (typed.email && emailOf(c.email) === typed.email) || (typed.name && text(c.name).toLowerCase() === typed.name.toLowerCase())) || null;
      if (!held && typed.email) {
        held = (await db.query(
          `SELECT c.id, c.name, c.email, c.phone, c.phone_mobile, c.role, c.company_id, c.company_name, co.name AS co_name, co.company_type
             FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id WHERE lower(c.email) = $1 ORDER BY c.created_at NULLS LAST LIMIT 1`, [typed.email])).rows[0] || null;
      }
    }
    const role = SOLICITOR_SIDE_WORDS.client;
    if (held) {
      const p = personFrom(held, "solicitors", role);
      p.company = p.company || onDeal;
      p.email = p.email || typed.email;
      if (!p.phones.length && typed.phone) p.phones = [typed.phone];
      entries.push(p);
    } else {
      const email = typed.email || sra.email;
      const phone = typed.phone || sra.phone;
      entries.push({
        key: `solicitor:client`, contactId: null, name: typed.name || sra.name || onDeal, company: typed.name ? onDeal : null, companyId: null, jobTitle: null,
        email, phones: phone ? [phone] : [], detailsFrom: !typed.email && !typed.phone && (sra.email || sra.phone) ? "sra" : null,
        group: "solicitors", roles: [role], linked: false, noPerson: !typed.name,
      });
    }
  }
  for (const c of checks) {
    const side = solicitorSideOf(c.result || { firm: c.firm }, onDeal);
    if (side === "client" && onDeal) continue;
    const sra = sraContact(c.result);
    const name = sra.name || c.firm;
    // Someone at the firm is already listed (the heads of terms file them): they carry the side.
    const atFirm = entries.find(e => [name, c.firm].some(f => sameSolicitorFirm(e.company, f) || (e.noPerson && sameSolicitorFirm(e.name, f))));
    if (atFirm) {
      const words = SOLICITOR_SIDE_WORDS[side];
      atFirm.roles = [...atFirm.roles.filter(r => r !== linkedRoleWords("solicitors", null)), ...(atFirm.roles.includes(words) ? [] : [words])];
      atFirm.group = "solicitors";
      continue;
    }
    entries.push({
      key: `sra:${text(c.firm).toLowerCase()}`, contactId: null, name, company: null, companyId: null, jobTitle: null,
      email: sra.email, phones: sra.phone ? [sra.phone] : [], detailsFrom: sra.email || sra.phone ? "sra" : null,
      group: "solicitors", roles: [SOLICITOR_SIDE_WORDS[side]], linked: false, noPerson: true,
    });
  }

  // A party with nobody named yet: a line to add someone at it.
  for (const role of DEAL_PARTY_ROLES) {
    const brandId = brandOf[role];
    if (!brandId || named.has(role)) continue;
    const brand = companyById.get(brandId);
    entries.push({
      key: `party:${role}`, contactId: null, name: text(brand?.name) || DEAL_PARTY_LABEL[role], company: null, companyId: brandId, jobTitle: null,
      email: null, phones: [], detailsFrom: null, group: role === clientRole ? "client" : "other_side", roles: [DEAL_PARTY_LABEL[role]], linked: false, noPerson: true,
    });
  }

  return { dealId: String(d.id), clientRole, people: mergePeople(entries), parties };
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function staffMe(req: Request): Promise<{ id: string; name: string | null } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) || null } : null;
}

const STAFF_ONLY = "BGP staff only, signed in as themselves.";

async function audit(dealId: string, oldValue: string | null, newValue: string | null, reason: string, me: { id: string; name: string | null }) {
  await pool.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, 'deal_people', $2, $3, $4, $5, $6)`,
    [dealId, oldValue, newValue, reason.slice(0, 500), me.id, me.name]).catch((e: any) => console.warn(`[deal-people] audit line not written: ${e?.message}`));
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

const router = Router();

router.get("/api/deals/:id/people", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const view = await loadDealPeople(pool, String(req.params.id));
    if (!view) return res.status(404).json({ message: "Transaction not found" });
    res.json(view);
  } catch (err: any) {
    console.error("[deal-people] read failed:", err?.message);
    res.status(500).json({ message: "The people on this transaction could not be read." });
  }
});

router.get("/api/deals/:id/people/search", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const q = text(req.query.q).slice(0, 80);
    if (q.length < 2) return res.json({ contacts: [] });
    const rows = (await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.phone_mobile, c.role, coalesce(co.name, c.company_name) AS company
         FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id
        WHERE (c.name ILIKE $1 OR c.email ILIKE $1 OR coalesce(co.name, c.company_name) ILIKE $1)
          AND coalesce(c.email, '') !~* '@brucegillinghampollard\\.com$'
        ORDER BY (lower(c.name) LIKE $2) DESC, lower(c.name) LIMIT 12`,
      [`%${escapeLike(q)}%`, `${escapeLike(q.toLowerCase())}%`])).rows;
    res.json({
      contacts: rows.map((c: any) => ({
        id: String(c.id), name: text(c.name) || "Unnamed", company: text(c.company) || null, jobTitle: text(c.role) || null,
        email: emailOf(c.email), phones: personPhones(c),
      })),
    });
  } catch (err: any) {
    console.error("[deal-people] search failed:", err?.message);
    res.status(500).json({ message: "The CRM could not be searched." });
  }
});

router.post("/api/deals/:id/people", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const deal = (await pool.query(`SELECT id, name FROM crm_deals WHERE id = $1`, [String(req.params.id)])).rows[0];
    if (!deal) return res.status(404).json({ message: "Transaction not found" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    let contactId: string;
    let group: DealPeopleGroup;
    let label: string | null;
    let created = false;
    let name: string;
    if (text(body.contactId)) {
      if (!isDealPeopleGroup(body.group)) return res.status(400).json({ message: "Say who they are on the transaction." });
      const held = (await pool.query(`SELECT id, name, email FROM crm_contacts WHERE id = $1`, [text(body.contactId)])).rows[0];
      if (!held) return res.status(404).json({ message: "That contact is not in the CRM." });
      if (BGP_EMAIL.test(text(held.email))) return res.status(400).json({ message: "BGP's own people are on the BGP team, set in Fees & invoicing." });
      contactId = String(held.id);
      name = text(held.name);
      group = body.group;
      label = text(body.label).slice(0, 80) || null;
    } else {
      const typed = newDealContact(body);
      if ("problem" in typed) return res.status(400).json({ message: typed.problem });
      const t = typed.contact;
      if (t.email && BGP_EMAIL.test(t.email)) return res.status(400).json({ message: "BGP's own people are on the BGP team, set in Fees & invoicing." });
      group = t.group;
      label = t.label;
      name = t.name;
      const phoneCol = t.phone && isUkMobile(t.phone) ? "phone_mobile" : "phone";
      const held = t.email
        ? (await pool.query(`SELECT id, name, email, phone, phone_mobile, role FROM crm_contacts WHERE lower(email) = $1 ORDER BY created_at NULLS LAST LIMIT 1`, [t.email])).rows[0]
        : null;
      if (held) {
        contactId = String(held.id);
        name = text(held.name) || t.name;
        // Blank fields only: the contact page changes what is there.
        const fill: Record<string, string> = {};
        if (t.phone && !personPhones(held).length) fill[phoneCol] = t.phone;
        if (t.jobTitle && !text(held.role)) fill.role = t.jobTitle;
        const keys = Object.keys(fill);
        if (keys.length) await pool.query(`UPDATE crm_contacts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [contactId, ...keys.map(k => fill[k])]);
      } else {
        // The firm typed is filed against its CRM record when exactly one company has that name.
        const firms = t.company
          ? (await pool.query(`SELECT id, name FROM crm_companies WHERE lower(name) = lower($1) AND merged_into_id IS NULL LIMIT 2`, [t.company])).rows
          : [];
        const firm = firms.length === 1 ? firms[0] : null;
        const made = (await pool.query(
          `INSERT INTO crm_contacts (name, email, ${phoneCol}, role, company_id, company_name, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [t.name, t.email, t.phone, t.jobTitle, firm ? String(firm.id) : null, firm ? text(firm.name) : t.company,
            `Added by ${me.name || "BGP"} to the transaction ${text(deal.name) || ""} (${DEAL_PEOPLE_GROUP_LABEL[group].toLowerCase()}).`.slice(0, 500)])).rows[0];
        contactId = String(made.id);
        created = true;
      }
    }
    await pool.query(
      `INSERT INTO crm_contact_deals (contact_id, deal_id, deal_group, deal_label, added_by, added_by_name, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (contact_id, deal_id) DO UPDATE SET deal_group = EXCLUDED.deal_group, deal_label = coalesce(EXCLUDED.deal_label, crm_contact_deals.deal_label)`,
      [contactId, deal.id, group, label, me.id, me.name]);
    await audit(deal.id, null, contactId, `Added ${name} (${DEAL_PEOPLE_GROUP_LABEL[group].toLowerCase()}${label ? `, ${label}` : ""})${created ? ", new in the CRM" : ""}`, me);
    res.json({ ...(await loadDealPeople(pool, deal.id)), contactId, created });
  } catch (err: any) {
    console.error("[deal-people] add failed:", err?.message);
    res.status(500).json({ message: "The contact could not be added." });
  }
});

router.delete("/api/deals/:id/people/:contactId", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const dealId = String(req.params.id);
    const gone = (await pool.query(
      `DELETE FROM crm_contact_deals l USING crm_contacts c WHERE l.deal_id = $1 AND l.contact_id = $2 AND c.id = l.contact_id RETURNING c.name`,
      [dealId, String(req.params.contactId)])).rows[0];
    if (!gone) return res.status(404).json({ message: "They were not added on this card. Change them where they are set." });
    await audit(dealId, String(req.params.contactId), null, `Took ${text(gone.name)} off the transaction's people`, me);
    res.json(await loadDealPeople(pool, dealId));
  } catch (err: any) {
    console.error("[deal-people] remove failed:", err?.message);
    res.status(500).json({ message: "They could not be taken off." });
  }
});

router.post("/api/deals/:id/people/:contactId/details", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const dealId = String(req.params.id);
    const view = await loadDealPeople(pool, dealId);
    if (!view) return res.status(404).json({ message: "Transaction not found" });
    const contactId = String(req.params.contactId);
    if (!view.people.some(p => p.contactId === contactId)) return res.status(404).json({ message: "They are not on this transaction." });
    const held = (await pool.query(`SELECT id, name, email, phone, phone_mobile FROM crm_contacts WHERE id = $1`, [contactId])).rows[0];
    if (!held) return res.status(404).json({ message: "That contact is not in the CRM." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const email = text(body.email).toLowerCase() || null;
    const phone = text(body.phone) || null;
    if (email && !emailOf(email)) return res.status(400).json({ message: "That email address does not look right." });
    if (phone && !cleanPhone(phone)) return res.status(400).json({ message: "That phone number does not look right." });
    const fill: Record<string, string> = {};
    if (email && !emailOf(held.email)) fill.email = email;
    if (phone && !personPhones(held).length) fill[isUkMobile(phone) ? "phone_mobile" : "phone"] = phone;
    const keys = Object.keys(fill);
    if (!keys.length) return res.status(409).json({ message: "Those are already held. Change them on the contact's page." });
    await pool.query(`UPDATE crm_contacts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [contactId, ...keys.map(k => fill[k])]);
    await audit(dealId, null, contactId, `Added ${keys.includes("email") ? "an email" : ""}${keys.length > 1 ? " and " : ""}${keys.some(k => k !== "email") ? "a phone" : ""} for ${text(held.name)}`, me);
    res.json(await loadDealPeople(pool, dealId));
  } catch (err: any) {
    console.error("[deal-people] details failed:", err?.message);
    res.status(500).json({ message: "The details could not be saved." });
  }
});

export default router;
