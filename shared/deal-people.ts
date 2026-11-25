// Everyone on a transaction, with their email and phone (Woody, 24 November
// 2026, on #4664's Parties & AML, which listed only the BGP team: "be good to
// add up there all the other contacts on the deal with email and phone
// number? should be client/s and the details of the other side plus advisors
// agents and solicitors and ability to add a contact to the deal").
//
// Pure: the groups, who goes in which, and the words. The reads and the
// routes are server/deal-people.ts; the card is
// client/src/components/deal-people.tsx.

import { DEAL_PARTY_LABEL, type DealPartyRole } from "./deal-parties";

export const DEAL_PEOPLE_GROUPS = ["client", "other_side", "agents", "solicitors", "advisers"] as const;
export type DealPeopleGroup = typeof DEAL_PEOPLE_GROUPS[number];
export const DEAL_PEOPLE_GROUP_LABEL: Record<DealPeopleGroup, string> = {
  client: "Our client",
  other_side: "The other side",
  agents: "Agents",
  solicitors: "Solicitors",
  advisers: "Advisers and others",
};
export const isDealPeopleGroup = (v: unknown): v is DealPeopleGroup =>
  typeof v === "string" && (DEAL_PEOPLE_GROUPS as readonly string[]).includes(v);

export interface DealPerson {
  // Stable within the card: contact:<id>, firm:<id>, sra:<firm>.
  key: string;
  contactId: string | null;
  name: string;
  // The firm or company they are at, and its CRM record when there is one.
  company: string | null;
  companyId: string | null;
  jobTitle: string | null;
  email: string | null;
  phones: string[];
  // Where the email and phone came from when they are not the person's own:
  // a law firm's head office on the SRA's register, or the firm's CRM record.
  detailsFrom: "sra" | "firm" | null;
  group: DealPeopleGroup;
  // What they are on the transaction ("Who to ask for the landlord's checks").
  roles: string[];
  // Added on this card: it can be taken off here. Everyone else is set where
  // they come from (the party box, the transaction's own fields).
  linked: boolean;
  // A firm or party with nobody named at it.
  noPerson: boolean;
}

export interface DealPeopleView {
  dealId: string;
  clientRole: DealPartyRole;
  people: DealPerson[];
  // The parties as the card offers them for Add a contact ("Works at").
  parties: Array<{ role: DealPartyRole; name: string; client: boolean }>;
}

const text = (v: unknown): string => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";

/** A phone worth showing: digits, not an email address typed in the wrong box. */
export function cleanPhone(v: unknown): string | null {
  const t = text(v);
  if (!t || t.includes("@") || (t.match(/\d/g) || []).length < 6) return null;
  return t.slice(0, 40);
}

/** The phones held for a person, mobile first, each once (spaces aside). */
export function personPhones(c: { phone?: unknown; phone_mobile?: unknown }): string[] {
  const out: string[] = [];
  for (const p of [cleanPhone(c.phone_mobile), cleanPhone(c.phone)]) {
    if (p && !out.some(o => o.replace(/\D/g, "") === p.replace(/\D/g, ""))) out.push(p);
  }
  return out;
}

/** A typed phone goes in the mobile box when it reads as a UK mobile, else the phone box. */
export const isUkMobile = (phone: string): boolean => /^(?:\+?44\s*\(?0?\)?\s*|0)7\d/.test(phone.replace(/[\s-]/g, ""));

/** The words for a party's agent column. */
export const PARTY_AGENT_WORDS: Record<DealPartyRole, string> = {
  landlord: "The landlord's agent",
  tenant: "The tenant's agent",
  vendor: "The seller's agent",
  purchaser: "The buyer's agent",
};

export const partyWords = (role: DealPartyRole): string => DEAL_PARTY_LABEL[role].toLowerCase();

/**
 * Which group a contact linked to the transaction belongs in when nothing was
 * chosen (a link made before this card, or by the heads of terms reader): the
 * party it is filed under, else its firm's kind, else advisers.
 */
export function groupForLinked(input: {
  chosen?: unknown;
  companyId: string | null;
  companyType: string | null;
  clientBrandId: string | null;
  otherBrandIds: readonly string[];
}): DealPeopleGroup {
  if (isDealPeopleGroup(input.chosen)) return input.chosen;
  if (input.companyId && input.companyId === input.clientBrandId) return "client";
  if (input.companyId && input.otherBrandIds.includes(input.companyId)) return "other_side";
  const type = text(input.companyType).toLowerCase();
  if (/solicitor|law\b|legal|lawyer/.test(type)) return "solicitors";
  if (/^agent|agent$|agency/.test(type)) return "agents";
  return "advisers";
}

/**
 * One entry per person: a contact met in more than one place keeps every role
 * and sits in the first group any of them gives (client, the other side,
 * agents, solicitors, advisers).
 */
export function mergePeople(entries: readonly DealPerson[]): DealPerson[] {
  const order = (g: DealPeopleGroup) => DEAL_PEOPLE_GROUPS.indexOf(g);
  const byKey = new Map<string, DealPerson>();
  for (const e of entries) {
    const held = byKey.get(e.key);
    if (!held) { byKey.set(e.key, { ...e, roles: [...e.roles], phones: [...e.phones] }); continue; }
    for (const r of e.roles) if (!held.roles.includes(r)) held.roles.push(r);
    if (order(e.group) < order(held.group)) held.group = e.group;
    held.linked = held.linked || e.linked;
    held.email = held.email || e.email;
    for (const p of e.phones) if (!held.phones.some(h => h.replace(/\D/g, "") === p.replace(/\D/g, ""))) held.phones.push(p);
    held.company = held.company || e.company;
    held.companyId = held.companyId || e.companyId;
    held.jobTitle = held.jobTitle || e.jobTitle;
  }
  // A firm-only line is dropped once someone at that firm is listed in the same group.
  const people = [...byKey.values()];
  return people.filter(p => !(p.noPerson && p.companyId && people.some(o => !o.noPerson && o.companyId === p.companyId && o.group === p.group)))
    .sort((a, b) => order(a.group) - order(b.group) || Number(a.noPerson) - Number(b.noPerson) || a.name.localeCompare(b.name));
}

export interface NewDealContact { name: string; email: string | null; phone: string | null; company: string | null; jobTitle: string | null; label: string | null; group: DealPeopleGroup }

/** What Add a contact may save: a name, an email or a phone that look right, and the group. */
export function newDealContact(body: unknown): { contact: NewDealContact } | { problem: string } {
  const b: Record<string, unknown> = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const name = text(b.name).slice(0, 120);
  const email = text(b.email).toLowerCase().slice(0, 200) || null;
  const phone = text(b.phone).slice(0, 40) || null;
  const company = text(b.company).slice(0, 160) || null;
  const jobTitle = text(b.jobTitle).slice(0, 120) || null;
  const label = text(b.label).slice(0, 80) || null;
  if (!isDealPeopleGroup(b.group)) return { problem: "Say who they are on the transaction." };
  if (!name) return { problem: "Give their name." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { problem: "That email address does not look right." };
  if (phone && !cleanPhone(phone)) return { problem: "That phone number does not look right." };
  if (!email && !phone) return { problem: "Give their email or phone." };
  return { contact: { name, email, phone, company, jobTitle, label, group: b.group } };
}

/** The words a person is listed with on the card when added there. */
export function linkedRoleWords(group: DealPeopleGroup, label: string | null): string {
  if (label) return label;
  return group === "client" ? "Our client's side"
    : group === "other_side" ? "The other side"
    : group === "agents" ? "Agent"
    : group === "solicitors" ? "Solicitor"
    : "Adviser";
}
