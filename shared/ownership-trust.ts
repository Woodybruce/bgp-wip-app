// A trust in the ownership (Woody, 25 November 2026, on PIE RETAIL LIMITED,
// whose parent Beauty Pie Limited is held by a Cayman trust run by The R&H
// Trust Co.: "I still think you need to build it"). Jack's trust rules
// (shared/trust-structure.ts) covered a party that is itself a trust; a trust
// that holds the party, or a company above it, now gets the same record: its
// kind, settlor, trustees and beneficiaries, asked for or added by BGP, and the
// sign-off waits for it.
import type { KycPrecheckResult } from "./kyc-prechecks";

export interface OwnershipTrustHeld {
  /** The company the trust holds: the party, or a company above it. */
  heldAt: string;
  /** The people the register names for it: trustees, and those with control over the trustees. */
  people: Array<{ name: string; role: "trustee" | "controller" }>;
}

const TRUST_CONTROL = /trust/i;
// "Ownership of shares ... with control over the trustees of a trust" is a trustee
// holding; "significant influence or control over the trustees" is control over them.
const holdsAsTrustee = (controls: string[]) => controls.some(c => TRUST_CONTROL.test(c) && /ownership of shares|ownership of voting|right to appoint/i.test(c));

/** The trust a party's ownership runs through, from BGP's checks before asking; null when none. */
export function ownershipTrustFrom(result: Pick<KycPrecheckResult, "companiesHouse"> | null | undefined): OwnershipTrustHeld | null {
  const ch = result?.companiesHouse || null;
  if (!ch) return null;
  const people: OwnershipTrustHeld["people"] = [];
  const at = new Map<string, number>();
  const add = (name: string, controls: string[], foundAt: string) => {
    if (!controls.some(c => TRUST_CONTROL.test(c))) return;
    const key = name.trim().toLowerCase();
    if (!key || people.some(p => p.name.trim().toLowerCase() === key)) return;
    people.push({ name, role: holdsAsTrustee(controls) ? "trustee" : "controller" });
    at.set(foundAt, (at.get(foundAt) || 0) + 1);
  };
  for (const o of ch.owners || []) {
    if (o.kind === "individual" || /\btrustees?\b/i.test(o.name)) add(o.name, o.controls || [], ch.name || "");
  }
  for (const p of ch.peopleUpChain || []) add(p.name, p.controls || [], p.foundAt || "");
  if (!people.length) return null;
  const heldAt = [...at.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ch.name || "";
  return { heldAt: heldAt || "the company", people };
}

/** The name a trust is recorded under until its own name is known. */
export function ownershipTrustDefaultName(heldAt: string): string {
  return `Trust that holds ${heldAt}`.slice(0, 160);
}

/** The words for the Next line and the sign-off when the trust's record is missing or incomplete. */
export function ownershipTrustGapWords(held: OwnershipTrustHeld, recorded: boolean, gaps: string[]): string[] {
  if (!recorded) return [`record the trust that holds ${held.heldAt} and ask for its information`];
  return gaps.map(g => `the trust that holds ${held.heldAt}: ${g.replace(/\.$/, "")}`);
}
