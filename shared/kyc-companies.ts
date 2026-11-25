// The Companies view on Transactions → AML (Woody, 24 November 2026: "We need
// a dashboard so it's easy to search and add a company ... Should auto
// populate with all the companies we have in the transactions list both
// brands and landlords. I can then go over all of them and start adding the
// contracting entities to start KYC", then "We also want the deals /
// transactions to also be in there so we can aml the transactions too as we
// currently do"). One row per company: every landlord, tenant, seller and
// buyer on the transactions the AML board covers, and any company added here
// with no transaction. Pure rules: the row's shape, the next step, the
// sanctions-only switch, search and filters. The feed is
// server/kyc-companies.ts.

import { clientKycBucket, clientKycSummary, clientKycWords, type ClientKycCompanyRow } from "./client-kyc";
import type { AmlBucket, AmlStage } from "./aml-dashboard";

export type KycCompanyKind = "landlord" | "brand" | "other";

export interface KycCompanyEntity {
  // The sub company (crm_trading_entities); null = the company's own record,
  // which is checked itself only when it is a person, a trust or a UK public body.
  id: string | null;
  name: string;
  number: string | null;
  kind: "company" | "person" | "abroad";
  status: string | null;
  expiresAt: string | null;
  scope: "sanctions_only" | null;
  started: boolean;
  xero: boolean;
  signsOn: number;
}

export interface KycCompanyTransaction {
  id: string;
  ref: number | null;
  name: string;
  status: string | null;
  dealType: string | null;
  role: string;
  signsAs: string | null;
  stage: AmlStage;
  bucket: AmlBucket;
  sanctionsOnly: boolean;
  late: boolean;
  waitingOn: string;
}

export interface KycCompanyPerson { id: string; name: string; role: string | null; email: string | null; phone: string | null }
// An agent acting for the company: a brand's current tenant rep (or the agent
// on an open requirement), or the agent the transaction records for its side.
export interface KycCompanyAgent { firmId: string | null; firm: string | null; contactId: string | null; person: string | null; email: string | null; on: string }

export interface KycCompanyRow {
  id: string;
  name: string;
  kind: KycCompanyKind;
  companyType: string | null;
  website: string | null;
  entities: KycCompanyEntity[];
  kyc: { label: string; tone: "ok" | "warn" | "bad" | "none"; title: string };
  transactions: KycCompanyTransaction[];
  people: { count: number; first: KycCompanyPerson[] };
  agents: KycCompanyAgent[];
  sanctionsOnly: { on: boolean; auto: boolean; set: boolean | null };
  next: KycCompanyNext;
  // Added on the Companies view with no transaction.
  listed: boolean;
  // KYC4U's request folders linked to the company (its past checks, kept as
  // records since 23 November 2026), and the latest one's date.
  kyc4u: { folders: number; last: string | null } | null;
}

export interface KycCompanyNext { tone: "ok" | "act" | "wait" | "bad"; lead: string; words: string }

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/** A landlord or a brand: the CRM type first, else the side it is on in its transactions. */
export function kycCompanyKind(companyType: string | null | undefined, roles: string[]): KycCompanyKind {
  const t = clean(companyType).toLowerCase();
  if (/^tenant/.test(t)) return "brand";
  if (["landlord", "client", "landlord / client", "landlord/freeholder", "freeholder", "investor", "reit", "developer", "fund", "asset manager"].includes(t)) return "landlord";
  if (roles.some(r => r === "landlord" || r === "vendor")) return "landlord";
  if (roles.some(r => r === "tenant" || r === "purchaser")) return "brand";
  return "other";
}

/**
 * Sanctions checks only, by default, when every transaction the company is on
 * is a letting under £10,000 a month (the AML board's own reading of each).
 * A person can switch it either way (`set`); with no transaction it is off.
 */
export function kycSanctionsOnly(transactions: Array<{ sanctionsOnly: boolean }>, set: boolean | null | undefined): { on: boolean; auto: boolean; set: boolean | null } {
  const auto = transactions.length > 0 && transactions.every(t => t.sanctionsOnly);
  const s = set === true || set === false ? set : null;
  return { on: s ?? auto, auto, set: s };
}

/** Each entity as the KYC summary reads it: on a sanctions-only company a sanctions-only sign-off is all it needs. */
export function kycEntityRows(entities: KycCompanyEntity[], sanctionsOnly: boolean): ClientKycCompanyRow[] {
  return entities.map(e => ({ status: e.status, expiresAt: e.expiresAt, scope: sanctionsOnly ? null : e.scope, started: e.started }));
}

// The CRM chip's own words, so a company reads the same on the CRM boards, this
// view and its page: a sanctions-only sign-off says so whatever the switch.
export function kycCompanyChip(entities: KycCompanyEntity[], _sanctionsOnly: boolean, now: Date): KycCompanyRow["kyc"] {
  if (!entities.length) return { label: "Not started", tone: "none", title: "No contracting entity yet" };
  return clientKycWords(clientKycSummary(kycEntityRows(entities, false), now));
}

/** What happens next for the company, in a few words. */
export function kycCompanyNext(f: {
  entities: KycCompanyEntity[];
  sanctionsOnly: boolean;
  // Who a request is waiting on: a client checks request with no transaction, or a transaction party in progress.
  waiting: string | null;
  // KYC4U's folders on the company: KYC4U checked it, and the app holds no result.
  kyc4u?: { folders: number; last: string | null } | null;
}, now: Date, fmt: (iso: string) => string = iso => iso.slice(0, 10)): KycCompanyNext {
  // KYC4U checked it before 23 November 2026: their result is the quickest
  // way to clear the transactions it was on (Woody, 24 November 2026, on the
  // closed transactions not checked).
  const kyc4u: KycCompanyNext | null = f.kyc4u?.folders
    ? { tone: "act", lead: "KYC4U checked it", words: `record their result (${f.kyc4u.folders} folder${f.kyc4u.folders === 1 ? "" : "s"}${f.kyc4u.last ? `, ${f.kyc4u.folders === 1 ? "" : "latest "}${fmt(f.kyc4u.last)}` : ""})` }
    : null;
  if (!f.entities.length) return kyc4u || { tone: "act", lead: "To do", words: "add the contracting entity" };
  const rows = kycEntityRows(f.entities, f.sanctionsOnly);
  const buckets = rows.map(r => clientKycBucket(r, now));
  const rejected = f.entities.find((_e, i) => buckets[i] === "rejected");
  if (rejected) return { tone: "bad", lead: "Rejected", words: rejected.name };
  const openAt = buckets.map((b, i) => (b === "cleared" || b === "expiring" ? -1 : i)).filter(i => i >= 0);
  // Shown while BGP's own checks run too (Woody, 25 November 2026, on Karve:
  // the app said "In progress" and hid that KYC4U had considered it).
  if (openAt.length && kyc4u) return kyc4u;
  if (!openAt.length) {
    const soonest = f.entities.map(e => e.expiresAt).filter((x): x is string => !!x).sort()[0] || null;
    return { tone: "ok", lead: "Cleared", words: [soonest ? `until ${fmt(soonest)}` : "", f.sanctionsOnly ? "lettings under £10k a month" : ""].filter(Boolean).join(" · ") };
  }
  if (f.waiting) return { tone: "wait", lead: `Waiting on ${f.waiting}`, words: "" };
  const i = openAt[0];
  const name = f.entities[i].name;
  if (buckets[i] === "expired") return { tone: "act", lead: "Expired", words: `${name}: check again` };
  if (buckets[i] === "sanctions_only") return { tone: "act", lead: "To do", words: `${name}: run the full checks` };
  if (buckets[i] === "in_progress") return { tone: "wait", lead: "In progress", words: name };
  return { tone: "act", lead: "To do", words: `KYC ${name}` };
}

/** Who a transaction party in progress is waiting on, in the Next line's words (null when it is BGP's move). */
export function transactionWaiting(stage: AmlStage): string | null {
  if (stage === "client_sent") return "the client";
  if (stage === "joint_asked") return "the joint agent";
  return null;
}

// ── The view's filters and search ──────────────────────────────────────────

export type KycCompanyFilter = "all" | "landlord" | "brand" | "no_entity" | "not_cleared" | "sanctions_only";

export const KYC_COMPANY_FILTERS: Array<{ key: KycCompanyFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "landlord", label: "Landlords" },
  { key: "brand", label: "Brands" },
  { key: "no_entity", label: "No contracting entity" },
  { key: "not_cleared", label: "Not cleared" },
  { key: "sanctions_only", label: "Sanctions only" },
];

export function kycCompanyMatchesFilter(row: Pick<KycCompanyRow, "kind" | "entities" | "next" | "sanctionsOnly">, filter: KycCompanyFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "landlord": return row.kind === "landlord";
    case "brand": return row.kind === "brand";
    case "no_entity": return row.entities.length === 0;
    case "not_cleared": return row.next.tone !== "ok";
    case "sanctions_only": return row.sanctionsOnly.on;
  }
}

const fold = (v: unknown) => clean(v).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "");

/** One search over a company, its contracting entities, website, transactions and Refs. */
export function kycCompanyMatchesSearch(row: Pick<KycCompanyRow, "name" | "website" | "entities" | "transactions" | "agents" | "people">, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([
    row.name, row.website,
    ...row.entities.flatMap(e => [e.name, e.number]),
    ...row.transactions.flatMap(t => [t.name, t.ref != null ? `#${t.ref}` : "", t.ref != null ? String(t.ref) : "", t.signsAs]),
    ...row.agents.flatMap(a => [a.firm, a.person]),
    ...row.people.first.map(p => p.name),
  ].join(" "));
  return words.every(w => hay.includes(w.replace(/^#/, "")) || hay.includes(w));
}

export function kycCompanyCounts(rows: Array<Pick<KycCompanyRow, "kind" | "entities" | "next" | "sanctionsOnly">>): Record<KycCompanyFilter, number> {
  const out = {} as Record<KycCompanyFilter, number>;
  for (const f of KYC_COMPANY_FILTERS) out[f.key] = rows.filter(r => kycCompanyMatchesFilter(r, f.key)).length;
  return out;
}

/** The company's website as a link, from the CRM's domain fields. */
export function kycCompanyWebsite(domainUrl: string | null | undefined, domain: string | null | undefined): string | null {
  const raw = clean(domainUrl) || clean(domain);
  if (!raw) return null;
  return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "") || null;
}
