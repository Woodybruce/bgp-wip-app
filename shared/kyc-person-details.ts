// A private individual's date of birth and nationality, typed in by BGP with
// no documents (Woody, 24 November 2026: yes to recording them, after asking
// "on the sanctions only for a private are you sure we dont need adderess or
// DOB?"). On a letting under £10,000 a month only the sanctions checks apply
// (BGP's AML policy A) and the law asks for no date of birth; it is what tells
// the person from someone of the same name on the sanctions lists and in
// ComplyAdvantage, so a private individual's sanctions-only sign-off waits for
// it. Kept per party record in kyc_person_details; BGP's checks screen with it.
// Server: server/kyc-person-details.ts.

export interface PersonDetails {
  dateOfBirth: string;          // yyyy-mm-dd
  nationality: string | null;   // in words, as the person or their papers give it ("British")
  recordedBy: string | null;
  recordedAt: string;
}

export type PersonDetailsInput = { ok: true; dateOfBirth: string; nationality: string | null } | { ok: false; message: string };

const MIN_AGE = 16;
const MAX_AGE = 110;

/** What a person typed, checked: a real date, between 16 and 110 years ago; a nationality in words. */
export function personDetailsInput(body: unknown, today: Date = new Date()): PersonDetailsInput {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const raw = String(b.dateOfBirth ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { ok: false, message: "Give their date of birth." };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return { ok: false, message: "That date does not exist." };
  const age = ageOn(raw, today);
  if (age < MIN_AGE) return { ok: false, message: `That makes them under ${MIN_AGE}: check the date.` };
  if (age > MAX_AGE) return { ok: false, message: "Check the year of birth." };
  const nationality = String(b.nationality ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || null;
  if (nationality && !/^[\p{L}][\p{L} .'’()-]*$/u.test(nationality)) return { ok: false, message: "Write the nationality in words, such as British." };
  return { ok: true, dateOfBirth: raw, nationality };
}

/** Their age on a day, in whole years. */
export function ageOn(dateOfBirth: string, today: Date): number {
  const [y, mo, d] = dateOfBirth.split("-").map(Number);
  const t = { y: today.getUTCFullYear(), mo: today.getUTCMonth() + 1, d: today.getUTCDate() };
  return t.y - y - (t.mo < mo || (t.mo === mo && t.d < d) ? 1 : 0);
}

/** The year and month the screening uses (Mesh and the lists compare years, and months where both give one). */
export function dobParts(dateOfBirth: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(dateOfBirth || ""));
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** "Born 12 Mar 1971 · British". */
export function personDetailsWords(d: Pick<PersonDetails, "dateOfBirth" | "nationality"> | null | undefined): string | null {
  if (!d?.dateOfBirth) return null;
  const [y, mo, day] = d.dateOfBirth.split("-").map(Number);
  const born = new Date(Date.UTC(y, mo - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return [`Born ${born}`, d.nationality].filter(Boolean).join(" · ");
}

/** Whether the sign-off needs the date of birth: a private individual on sanctions checks only. */
export function personDobNeeded(f: { kind: string; sanctionsOnly: boolean; trust?: boolean }): boolean {
  return f.kind === "individual" && f.sanctionsOnly && !f.trust;
}

export const PERSON_DOB_NEEDED = "Add their date of birth first (step 1): it tells them apart from people of the same name on the sanctions lists.";
export const PERSON_DOB_AFTER_RUN = "Their date of birth was added after they were screened: the checks run again by themselves, or press Run again.";

/** The person's details as the AML box and the client KYC window read them. */
export interface PersonDetailsView {
  details: PersonDetails | null;
  needed: boolean;       // the sign-off waits for the date of birth
  words: string | null;  // personDetailsWords
}
