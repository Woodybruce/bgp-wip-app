// "Drop a note in, fill the form" (Woody, 2026-11-13): a plain note such as
// "Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF" is read into
// the fields of an offer, a negotiation round, a viewing, a viewing outcome
// or an interest line. The reader only suggests: the person checks the form
// and saves through the form's own route. Nothing here is ever saved by
// itself. This file is the contract between the server reader
// (server/unit-note-reader.ts), the shared box (client/src/components/
// letting-note/note-fill.tsx) and every form that mounts it.

export const NOTE_KINDS = ["offer", "round", "viewing", "viewing_outcome", "interest"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_MAX = 4000;

// Every key is optional. A key that is absent was not stated in the note:
// the form keeps what it has. For kind "round" this matters: an absent term
// carries over from the last position, so the reader never sends null for a
// term the note did not mention.
export interface LettingNoteFields {
  brandName?: string | null;
  brandId?: string | null;                 // only when the caller may already pick that brand
  contactName?: string | null;             // the brand's own person; never the BGP person who wrote the note
  agentName?: string | null;               // the brand's agent as written (a person or a firm)
  agentCompanyName?: string | null;
  agentCompanyId?: string | null;          // staff only
  moreBrands?: { id?: string | null; name: string }[];   // interest: one agent asking for several brands
  date?: string | null;                    // yyyy-mm-dd: offer date, round date, viewing date or interest date
  time?: string | null;                    // HH:MM
  party?: "tenant" | "landlord" | null;    // round: whose position it is
  rentPa?: number | null;
  rentFreeMonths?: number | null;
  termYears?: number | null;
  breakOption?: string | null;
  premium?: number | null;
  fittingOutContribution?: number | null;
  turnoverRentPct?: number | null;
  rentReview?: string | null;
  rentDeposit?: string | null;
  incentives?: string | null;
  outcome?: string | null;                 // viewing: one of VIEWING_OUTCOMES or "No Show"
  nextAction?: string | null;
  followUpDate?: string | null;            // yyyy-mm-dd
  attendees?: string | null;
  note?: string | null;                    // what is left over, for the form's comments or notes box
}
export type LettingNoteField = keyof LettingNoteFields;

// Where an existing piece of writing in the app is read from. The server
// fetches the text itself and checks the caller may read it: the client
// never sends the words of a comment it wants read "as" a comment.
export type NoteSource =
  | { type: "target_comment"; targetId: string; at: string };   // an entry in a target's comment log, found by its timestamp

export interface ReadNoteRequest {
  kind: NoteKind;
  text?: string;                           // a pasted or typed note
  source?: NoteSource;                     // or a piece of writing already in the app
  offerId?: string;                        // round: the offer the position belongs to
}

export interface LettingNoteReading {
  kind: NoteKind;
  text: string;                            // the words that were read
  fields: LettingNoteFields;
  quotes: Partial<Record<LettingNoteField, string>>;   // the words each value came from
  unplaced: string[];                      // parts of the note that fit no box
  dropped: { field: string; reason: string }[];        // values the reader found but would not trust
  saidBy: string | null;                   // who wrote the note, when it names them or the source records it
  usedAi: boolean;                         // false when the shorthand rules alone read it
  // A note written out in full fills only a sure date, time and brand on the
  // unit. What else was read (by the rules or by Claude) is listed here, each
  // value with its words; it is never applied as a whole: the person puts one
  // value at a time into the form with its Use button. Absent on a tight
  // shorthand note.
  unsure?: { field: LettingNoteField; value: string | number; quote: string }[];
  reason?: string;                         // one plain line on why some or all of the note was not filled
}

// What the form shows for a field, in plain words.
export const NOTE_FIELD_LABELS: Record<LettingNoteField, string> = {
  brandName: "Brand", brandId: "Brand", contactName: "Contact", agentName: "Agent", agentCompanyName: "Agent's firm", agentCompanyId: "Agent's firm",
  moreBrands: "Other brands", date: "Date", time: "Time", party: "Whose position", rentPa: "Rent a year", rentFreeMonths: "Rent free (months)",
  termYears: "Term (years)", breakOption: "Break", premium: "Premium", fittingOutContribution: "Fit-out contribution", turnoverRentPct: "Turnover rent %",
  rentReview: "Rent review", rentDeposit: "Rent deposit", incentives: "Incentives", outcome: "Outcome", nextAction: "Next action",
  followUpDate: "Follow up by", attendees: "Who attended", note: "Notes",
};
