// The offers left on the Letting Tracker by the one-off email import of
// 14 August 2026 (backfillActivityFromInteractions in server/viewing-sync.ts,
// which nothing calls since). It replayed three months of stored emails and
// wrote an unconfirmed offer for every email that mentioned an offer and could
// be pinned on a tracker unit: 970 rows on 31 units, Pending, no terms, most
// credited to nobody, to the landlord or to BGP (186 on one unit, 80 on
// 4 Cathedral Walk). Woody, 2026-11-19, chose an admin Preview then Apply to
// clear them (server/email-offer-cleanup.ts).
//
// This file is the one rule for which import rows are still exactly as the
// import wrote them. A row anyone has touched since is kept, with the reason.
// A row credited to a tenant brand counts as that brand's offer on the Brand
// CRM, so it is listed on its own for a person to tick.
//
// The import wrote one row for every email in a thread, so one real offer can
// be 144 rows (Woody, 2026-11-19: "these are actual offers but its picking up
// all the emails so shows hundred of entries for each offer"). One email
// thread on one unit (the subject without Re: or Fwd:, threadKey) is one
// offer: one of its rows stays as the offer (threadKeeper) and only the copies
// are cleared. A person can tick a thread that is not an offer at all (a
// newsletter caught by the import) to clear the one kept row as well.

export const IMPORT_COMMENT_PREFIX = "Backfilled from synced email: ";
export const IMPORT_KEY_PREFIX = "int_";
// The comment exactly as the import wrote it. Anything added or changed means
// a person has edited it.
const IMPORT_COMMENT = /^Backfilled from synced email: "([\s\S]*)" — figures need confirming\.$/;

// Every term column on unit_offers (and on a negotiation round). A term set on
// an import row means a person entered it.
export const OFFER_TERM_COLUMNS = [
  "rent_pa", "rent_free_months", "term_years", "break_option", "incentives", "premium",
  "fitting_out_contribution", "rent_review", "rent_deposit", "turnover_rent_pct",
] as const;

// A negotiation round on the offer. Opening an offer's negotiation log writes
// a blank round 1 from the offer row (ensureRounds in server/unit-negotiation.ts:
// no author, no note, no terms); that is not a touch. Anything else is.
export type ImportRound = {
  roundNo: number;
  party: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  note: string | null;
  hasTerms: boolean;
  edited: boolean;
};

export type ImportOfferFacts = {
  source: string | null;
  comments: string | null;
  emailConversationId: string | null;
  status: string | null;
  confirmedAt: unknown;
  agreedAt: unknown;
  agreedByUserId: string | null;
  agreedByName: string | null;
  /** The term columns, keyed as OFFER_TERM_COLUMNS. */
  terms: Record<string, unknown>;
  viewingId: string | null;
  /** Null on every row nobody has saved since migration 0051 added it. */
  updatedAt: unknown;
  rounds: ImportRound[];
  /** The unit's Heads of Terms were generated from it (available_units.hots_offer_id). */
  hotsOffer: boolean;
  /** A transaction recommendation names it (unit_recommendations.offer_id). */
  recommendationOffer: boolean;
  /** A person logged it from a comment not yet logged (letting_suggestions.record_id). */
  loggedFromComment: boolean;
  /** The company it is credited to is a tenant brand (company type starting "Tenant"). */
  creditedToBrand: boolean;
};

export type CleanupGroup = "clear" | "brand" | "kept";
export const CLEANUP_GROUPS: readonly CleanupGroup[] = ["clear", "brand", "kept"];

const blank = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * The import's signature: an email offer carrying the import's own key,
 * int_<interaction id>. Only the import wrote that key (the live inbox sweep
 * writes conv_ or msg_) and no screen edits it, so a row whose comment a
 * person rewrote is still found, and kept as "comments edited".
 */
export function isImportOffer(f: Pick<ImportOfferFacts, "source" | "emailConversationId">): boolean {
  return f.source === "email" && String(f.emailConversationId ?? "").startsWith(IMPORT_KEY_PREFIX);
}

/** The email subject the import quoted, or null when the comment is not the import's. */
export function importSubject(comments: string | null | undefined): string | null {
  const m = IMPORT_COMMENT.exec(String(comments ?? ""));
  return m ? m[1] : null;
}

/** A round that is only the blank round 1 the negotiation log writes when it is opened. */
export function isBlankFirstRound(r: ImportRound): boolean {
  return r.roundNo === 1 && (r.party ?? "tenant") === "tenant" && blank(r.createdByUserId) && blank(r.createdByName)
    && blank(r.note) && !r.hasTerms && !r.edited;
}

/** Why an import row counts as touched by a person, in plain words. Empty = untouched. */
export function touchedBecause(f: ImportOfferFacts): string[] {
  const why: string[] = [];
  const status = String(f.status ?? "").trim() || "Pending";
  if (!/^pending$/i.test(status)) why.push(`status is ${status}`);
  if (f.confirmedAt) why.push("confirmed by a person");
  if (f.agreedAt || !blank(f.agreedByUserId) || !blank(f.agreedByName)) why.push("terms agreed");
  if (OFFER_TERM_COLUMNS.some(c => !blank(f.terms?.[c]))) why.push("terms entered");
  if (importSubject(f.comments) === null) why.push("comments edited");
  if (!blank(f.viewingId)) why.push("linked to a viewing");
  if (!blank(f.updatedAt)) why.push("saved since the import");
  if (f.rounds.length > 1 || f.rounds.some(r => !isBlankFirstRound(r))) why.push("negotiation logged");
  if (f.hotsOffer) why.push("the unit's Heads of Terms name it");
  if (f.recommendationOffer) why.push("a recommendation names it");
  if (f.loggedFromComment) why.push("logged from a comment");
  return why;
}

/**
 * Which list an offer belongs on: "clear" (an untouched import row), "brand"
 * (an untouched import row credited to a tenant brand: deletable, but a person
 * ticks each one), or "kept" (not the import's, or touched since; never deleted).
 */
export function cleanupGroup(f: ImportOfferFacts): { group: CleanupGroup; keptBecause: string[] } {
  if (!isImportOffer(f)) return { group: "kept", keptBecause: ["not from the 14 August import"] };
  const keptBecause = touchedBecause(f);
  if (keptBecause.length) return { group: "kept", keptBecause };
  return { group: f.creditedToBrand ? "brand" : "clear", keptBecause: [] };
}

export const mayClear = (group: CleanupGroup): boolean => group === "clear" || group === "brand";

/** The thread an import row belongs to: its subject without any run of reply
 *  or forward prefixes (Re:, RE:, Fwd:, FW:, AW:, Re[2]:), spacing or case. */
export function threadKey(subject: string | null | undefined): string {
  let s = String(subject ?? "").trim();
  for (let i = 0; i < 20; i += 1) {
    const next = s.replace(/^(?:re|fw|fwd|aw|sv|wg)\s*(?:\[\d+\])?\s*[:：]\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export type ThreadRow = { id: string; offerDate: string | null; group: CleanupGroup; creditedToBrand: boolean };

const byDateThenId = (a: ThreadRow, b: ThreadRow): number => {
  const da = a.offerDate || "~", db = b.offerDate || "~";
  return da < db ? -1 : da > db ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * Which row of one thread on one unit stands for its offer. A row a person
 * has worked on does, if there is one (chosen false: it is kept anyway).
 * Otherwise one untouched row is kept as the offer (chosen true): one credited
 * to a brand first, then the earliest email, then the lowest id. Null for a
 * thread with no rows.
 */
export function threadKeeper(rows: ThreadRow[]): { keeperId: string | null; chosen: boolean } {
  const touched = rows.filter(r => r.group === "kept").sort(byDateThenId);
  if (touched.length) return { keeperId: touched[0].id, chosen: false };
  const open = rows.filter(r => mayClear(r.group));
  if (!open.length) return { keeperId: null, chosen: false };
  const pick = [...open].sort((a, b) => Number(b.creditedToBrand) - Number(a.creditedToBrand) || byDateThenId(a, b))[0];
  return { keeperId: pick.id, chosen: true };
}

export const KEEPER_REASON = "the offer for this email thread: its other emails are the copies";
