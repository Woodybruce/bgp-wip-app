// Deleting AML records after five years (Woody, 19 November 2026: build what
// BGP's AML policy needs). The Money Laundering Regulations 2017, reg 40:
// due diligence records and a transaction's records are kept for five years
// after the business relationship ends (or the occasional transaction
// completes), and personal data obtained for the Regulations is then deleted
// unless another law needs it kept or the person agreed. BGP's AML policy,
// section M, keeps due diligence for five years from completion of the check
// and training records for five years.
//
// Nothing is deleted by itself: the Nominated Officer or the Deputy previews
// what is due and ticks what goes (server/aml-records-retention.ts). A party
// is due only when both clocks have run: its latest check is more than five
// years old, and every deal it was on ended more than five years ago.

export const AML_RETENTION_YEARS = 5;

/** The day five years before today, as yyyy-mm-dd (London's date). */
export function retentionCutoff(now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = today.split("-").map(Number);
  const cut = new Date(Date.UTC(y - AML_RETENTION_YEARS, m - 1, d));
  // 29 February five years on is 1 March.
  return cut.toISOString().slice(0, 10);
}

export type RetentionCategory = "party" | "deal" | "archive" | "training" | "register";
export const RETENTION_CATEGORY_WORDS: Record<RetentionCategory, string> = {
  party: "A party's AML records",
  deal: "A closed deal's AML fields",
  archive: "Records kept from a deleted or merged deal or company",
  training: "Training records",
  register: "Closed entries in the AML register",
};

const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);
const words = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "never");

export interface PartyRetentionFacts {
  liveDeals: number;
  // When the party's last closed deal ended (completed, else last changed).
  lastDealEndedAt: string | null;
  // The newest of the party's AML records.
  latestRecordAt: string | null;
  openRegisterEntries: number;
}

/** Whether a party's AML records are due for deletion, and why (or why not). */
export function partyRetention(f: PartyRetentionFacts, cutoff: string): { due: boolean; why: string } {
  if (f.liveDeals > 0) return { due: false, why: `On ${f.liveDeals} live deal${f.liveDeals === 1 ? "" : "s"}` };
  if (f.openRegisterEntries > 0) return { due: false, why: "An open entry in the AML register is about them" };
  const latest = day(f.latestRecordAt);
  const ended = day(f.lastDealEndedAt);
  if (!latest) return { due: false, why: "No AML records" };
  if (latest > cutoff) return { due: false, why: `Last checked ${words(latest)}, within five years` };
  if (ended && ended > cutoff) return { due: false, why: `A deal with them ended ${words(ended)}, within five years` };
  return { due: true, why: `Last checked ${words(latest)}${ended ? `; last deal ended ${words(ended)}` : "; on no deal"}` };
}

/** Whether a closed deal's AML fields are due: the deal ended more than five years ago. */
export function dealRetention(f: { closed: boolean; endedAt: string | null }, cutoff: string): { due: boolean; why: string } {
  if (!f.closed) return { due: false, why: "The deal is still live" };
  const ended = day(f.endedAt);
  if (!ended) return { due: false, why: "When the deal ended is not recorded" };
  if (ended > cutoff) return { due: false, why: `Ended ${words(ended)}, within five years` };
  return { due: true, why: `Ended ${words(ended)}` };
}

export interface RetentionItem {
  id: string;
  category: RetentionCategory;
  label: string;
  why: string;
  // How many rows of each kind go (a party's records), for the preview.
  counts?: Record<string, number>;
}

export const retentionItemId = (category: RetentionCategory, id: string | number) => `${category}:${id}`;
export function parseRetentionItemId(raw: unknown): { category: RetentionCategory; id: string } | null {
  const m = /^(party|deal|archive|training|register):(.{1,80})$/.exec(String(raw || ""));
  return m ? { category: m[1] as RetentionCategory, id: m[2] } : null;
}

// A preview is applied only by the officer who made it, within the hour.
export const RETENTION_PREVIEW_MINUTES = 60;
export const RETENTION_CONFIRM_WORD = "DELETE";
