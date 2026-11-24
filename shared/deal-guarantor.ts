// Guarantors (Woody, 23 November 2026, on Inception T2: "one is signing
// cornhill bar and the other is guaranteeing so should be able to allocate
// add as the guarantor"). HMRC's letting agency guidance (AMLG2300 s18):
// "Guarantors are a party to a tenancy agreement" and are treated as
// customers; s19: the ID verification aspects of CDD on the "tenant,
// guarantor or trustee" are completed "before any agreement or contract is
// made"; s21: source of funds and wealth is verified "when guarantors pay".
//
// A guarantor is a company or a person filed under the party it stands
// behind (a tenant, or a buyer), never the company that signs. BGP's checks
// before asking run on it, its red flags join that party's, a company's owners
// and a person who guarantees join that party's People to check, and the
// party is not signed off until the guarantor's checks have run.

import type { KycRedFlag } from "./kyc-red-flags";
import { precheckRedFlags, type KycPrecheckResult } from "./kyc-prechecks";

/** The parties whose obligations a guarantor stands behind: a tenant, or a buyer. */
export const GUARANTEED_ROLES = ["tenant", "purchaser"] as const;
export type GuaranteedRole = (typeof GUARANTEED_ROLES)[number];
export const isGuaranteedRole = (v: unknown): v is GuaranteedRole =>
  typeof v === "string" && (GUARANTEED_ROLES as readonly string[]).includes(v);

/** How fresh the guarantor's checks must be for the party's sign-off (the party's own rule). */
export const GUARANTOR_CHECKS_DAYS = 30;

export type GuarantorChecksState = "not_run" | "running" | "done" | "stale";

export interface DealGuarantorView {
  /** The deal_guarantors row. */
  id: string;
  /** The company or person filed under the party (crm_trading_entities). */
  entityId: string;
  name: string;
  kind: "company" | "individual";
  companiesHouseNumber: string | null;
  checks: { state: GuarantorChecksState; ranAt: string | null; redFlags: number };
  addedBy: string | null;
  addedAt: string;
}

export function guarantorChecksState(ranAt: string | null, running: boolean, now: Date = new Date()): GuarantorChecksState {
  if (running) return "running";
  if (!ranAt) return "not_run";
  const t = Date.parse(ranAt);
  if (!Number.isFinite(t)) return "not_run";
  return now.getTime() - t > GUARANTOR_CHECKS_DAYS * 86400000 ? "stale" : "done";
}

export const GUARANTOR_CHECKS_WORDS: Record<GuarantorChecksState, string> = {
  not_run: "BGP's checks have not run",
  running: "BGP's checks are running",
  done: "BGP's checks have run",
  stale: `BGP's checks are more than ${GUARANTOR_CHECKS_DAYS} days old`,
};

/** The guarantor's findings, as red flags on the party it stands behind (keys and words of its own). */
export function guarantorRedFlags(input: { guarantor: { id: string; name: string }; precheck: KycPrecheckResult | null }): KycRedFlag[] {
  if (!input.precheck) return [];
  const { id, name } = input.guarantor;
  return precheckRedFlags(input.precheck, { sanctionsCurrent: true })
    .map(f => ({ ...f, key: `guarantor:${id}:${f.key}`, label: `The guarantor, ${name}: ${f.label}` }));
}

/** Why the party cannot be signed off yet because of a guarantor, or null. */
export function guarantorChecksDenial(list: Array<{ name: string; state: GuarantorChecksState }> | null | undefined): string | null {
  const open = (list || []).filter(g => g.state !== "done");
  if (!open.length) return null;
  const running = open.filter(g => g.state === "running");
  if (running.length === open.length) return `BGP's checks on the guarantor (${running.map(g => g.name).join(", ")}) are still running. Sign off once they finish.`;
  return `Run BGP's checks on the guarantor first (${open.map(g => `${g.name}: ${GUARANTOR_CHECKS_WORDS[g.state].replace(/^BGP's checks /, "")}`).join("; ")}). Press Run checks on the guarantor's line.`;
}

/** One line for a guarantor on the party's card: "Inception Ventures Group Limited (07950473) · BGP's checks have run · 1 red flag". */
export function guarantorLine(g: Pick<DealGuarantorView, "name" | "kind" | "companiesHouseNumber" | "checks">): string {
  const who = g.kind === "individual" ? `${g.name} (a person)` : g.companiesHouseNumber ? `${g.name} (${g.companiesHouseNumber})` : g.name;
  const flags = g.checks.state === "done" || g.checks.state === "stale"
    ? g.checks.redFlags ? ` · ${g.checks.redFlags} red flag${g.checks.redFlags === 1 ? "" : "s"}` : " · no red flags" : "";
  return `${who} · ${GUARANTOR_CHECKS_WORDS[g.checks.state]}${flags}`;
}

// Another company that signs (Woody, 24 November 2026, on #4664's party box:
// "can we add 2 entities? maybe should disappear with just clear left and
// also add another entity"; then "yes"). A second company or person signing
// for the same party: joint landlords on one title, a joint venture, two
// people buying together. Kept in deal_guarantors with kind 'signer', filed
// under the party, never the company that signs. Each one is a customer: BGP's
// checks run on it, its red flags join the party's, a company's owners (or the
// person) join People to check, the party's sign-off waits for its checks and
// approves it too, and the party reads cleared only once each one is.

/** Any party can have more than one company that signs. */
export const SIGNER_ROLES = ["landlord", "tenant", "vendor", "purchaser"] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];
export const isSignerRole = (v: unknown): v is SignerRole =>
  typeof v === "string" && (SIGNER_ROLES as readonly string[]).includes(v);

/** Its findings, as red flags on the party it signs for. */
export function signerRedFlags(input: { signer: { id: string; name: string }; precheck: KycPrecheckResult | null }): KycRedFlag[] {
  if (!input.precheck) return [];
  const { id, name } = input.signer;
  return precheckRedFlags(input.precheck, { sanctionsCurrent: true })
    .map(f => ({ ...f, key: `signer:${id}:${f.key}`, label: `Also signs, ${name}: ${f.label}` }));
}

/** Why the party cannot be signed off yet because of another company that signs, or null. */
export function signerChecksDenial(list: Array<{ name: string; state: GuarantorChecksState }> | null | undefined): string | null {
  const open = (list || []).filter(g => g.state !== "done");
  if (!open.length) return null;
  const names = (gs: typeof open) => gs.map(g => g.name).join(", ");
  if (open.every(g => g.state === "running")) return `BGP's checks on ${names(open)}, which also sign${open.length === 1 ? "s" : ""}, are still running. Sign off once they finish.`;
  return `Run BGP's checks on each company that signs first (${open.map(g => `${g.name}: ${GUARANTOR_CHECKS_WORDS[g.state].replace(/^BGP's checks /, "")}`).join("; ")}). Press Run checks on its line.`;
}

/** One line for another company that signs: "ST JOHN'S HILL PH03 LLP (OC443074) · BGP's checks have run · no red flags". */
export const signerLine = guarantorLine;

/**
 * The approval of each other company that signs, for the party's own: the
 * party reads cleared only while every one of them holds an approval of its
 * own, in date (a sanctions-only one only where the transaction needs no more).
 * Returns the names still to be signed off; an empty list when all are.
 */
export function signersNotCleared(signers: Array<{ name: string; status: string | null; expiresAt: string | Date | null; scope: "full" | "sanctions_only" | null }>,
  fullChecks: boolean, now: Date = new Date()): string[] {
  return signers.filter(s => {
    if (String(s.status || "").toLowerCase() !== "approved") return true;
    const until = s.expiresAt ? new Date(s.expiresAt).getTime() : NaN;
    if (Number.isFinite(until) && until < now.getTime()) return true;
    return fullChecks && s.scope === "sanctions_only";
  }).map(s => s.name);
}
