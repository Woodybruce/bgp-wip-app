// KYC4U takes requests only on its own portal (Jack, 20 November 2026: "KYC4U
// will want it uploaded in the portal"; the Send to ChatBGP bookmark that was
// to fill their form had never been used: on live every request prepared since
// October still sat at "queued"). So: the agent downloads a pack for the
// portal (the request sheet in KYC4U's own field order, BGP's AML report and
// the documents), types it in on KYC4U's portal and uploads the files, then
// records here that it went (Submitted on KYC4U's portal, with KYC4U's
// reference). Until then the party is not with KYC4U.

// KYC4U is no longer used (Woody, 23 November 2026: "We are no longer using
// KYC 4U update the app accross everyhting"; "we want to keep and record the
// hiostoric AML checks from KYC4U though which are downloaded on the app").
// No new request goes to them; their past results, documents and the files
// copied from their site stay on record and still count.
export const KYC4U_RETIRED_ON = "2026-11-23";
export const KYC4U_RETIRED_WORDS = "KYC4U is no longer used (since 23 November 2026). Its past checks and files stay on record.";

/** KYC4U's Raise New Service Request form, field by field, in its order. */
export const KYC4U_FORM_FIELDS: ReadonlyArray<{ key: string; label: string; required?: boolean; long?: boolean; hint?: string; type?: string }> = [
  { key: "partyType", label: "Party type", required: true, hint: "As KYC4U's dropdown words it — usually Client or Counterparty" },
  { key: "partyName", label: "Party name", required: true },
  { key: "propertyAddress", label: "Property address", required: true, long: true },
  { key: "requestType", label: "Request type", required: true, hint: "As KYC4U's dropdown words it. Leave blank to pick it on their form" },
  { key: "metFaceToFace", label: "Have you met the party face to face?", required: true },
  { key: "howLongKnown", label: "How long have you known the party?", required: true, hint: "e.g. 1 year 3 months" },
  { key: "instructorName", label: "Name the individual who has instructed you", required: true },
  { key: "instructorDesignation", label: "Their designation in the organisation", required: true },
  { key: "jointAgent", label: "Joint agent (if any)" },
  { key: "feeEarnerEmails", label: "Fee earner email(s)" },
  { key: "clientEmails", label: "Client email(s)" },
  { key: "expectedCompletion", label: "Expected completion date", type: "date" },
  { key: "note", label: "Note", long: true },
];

/** A request prepared and never submitted is stale after this many days. */
export const KYC4U_PREPARED_STALE_DAYS = 30;

export type Kyc4uDraftState = "none" | "prepared" | "stale" | "submitted";

/**
 * Where a party's KYC4U request stands, from its latest request that is not
 * cancelled. Only one recorded as submitted (by a person here, by KYC4U's own
 * list, or filled by the bookmark) is with KYC4U; one only prepared is not, and
 * after 30 days it is stale: it no longer says "ready" and is offered to cancel.
 */
export function kyc4uDraftState(draft: { status?: string | null; created_at?: string | Date | null } | null | undefined, now: Date = new Date()): Kyc4uDraftState {
  if (!draft || draft.status === "cancelled") return "none";
  if (draft.status === "submitted" || draft.status === "filled") return "submitted";
  if (draft.status !== "queued") return "none";
  const at = draft.created_at ? new Date(draft.created_at).getTime() : NaN;
  if (Number.isFinite(at) && now.getTime() - at > KYC4U_PREPARED_STALE_DAYS * 86_400_000) return "stale";
  return "prepared";
}

/** SQL for a request that counts as with KYC4U (the sign-off and the AML dashboard read it). */
export const KYC4U_WITH_THEM_SQL = `d.status IN ('filled', 'submitted')`;

export interface Kyc4uSubmittedInput { reference: string | null; date: string }

/** What a person records when they have submitted on KYC4U's portal: a reference (optional) and the date (not in the future). */
export function kyc4uSubmittedInput(body: unknown, now: Date = new Date()): Kyc4uSubmittedInput | { error: string } {
  const b: any = body && typeof body === "object" ? body : {};
  const reference = typeof b.reference === "string" && b.reference.trim() ? b.reference.replace(/\s+/g, " ").trim().slice(0, 80) : null;
  const raw = typeof b.date === "string" && b.date.trim() ? b.date.trim() : now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T12:00:00Z`).getTime())) return { error: "Give the date as a day." };
  if (raw > now.toISOString().slice(0, 10)) return { error: "The date cannot be in the future." };
  return { reference, date: raw };
}
