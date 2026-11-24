// Only a sign-off counts (Woody, 24 November 2026: "Only sign off counts remove
// the old bit. The result are in the app"). A KYC status counts when it is a
// sign-off: an approval, a rejection, or an approval past its re-check date.
// Anything else a record holds ("in review", "pending", left by the retired
// in-app screening, its review of 23 September 2026, or KYC4U, which BGP no
// longer uses) reads as not signed off. The KYC history keeps what was there.

export type SignedOffStatus = "approved" | "rejected" | "expired";

export function signedOffStatus(status: unknown): SignedOffStatus | null {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "approved" || s === "rejected" || s === "expired" ? s : null;
}

/** What a screen shows for a record's KYC status: a sign-off, or what a lookup found ("not_found"). "In review" and "pending" show as nothing. */
export function shownKycStatus(status: unknown): string | null {
  const s = String(status ?? "").trim().toLowerCase();
  return !s || s === "in_review" || s === "pending" ? null : s;
}
