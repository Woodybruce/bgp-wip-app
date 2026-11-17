// What a note read for the deal form changes (Woody, 2026-11-17: "the type it
// and AI fills in ability in a new box at the top" of the one deal form used
// for New Deal, Promote to Solicitors and the Heads of Terms' Convert to
// Solicitors). The box reads the note as an offer with the letting note
// reader (shared/letting-note.ts), so its rules hold: a tight note fills, a
// note written out in full lists each value for the person to Use. This maps
// a reading onto the deal form. Only the keys the reading holds change the
// form: the rent, the lease length, the rent free, the break and the capital
// contribution fill their boxes; the tenant brand only when it is one the
// form's tenant picker lists; anything with no box goes into Comments as a
// labelled line, once. An offer's date is never the target date. Pure, so it
// is tested without React.
import type { LettingNoteReading } from "../../../shared/letting-note";
import { formatCalendarDate } from "../../../shared/calendar-date";

export interface DealNoteForm {
  tenantId: string;
  tenantEntityId: string;
  tenantEntityName: string;
  rentPa: string;
  leaseLength: string;
  rentFree: string;
  breakOption: string;
  capitalContribution: string;
  comments: string;
}

export interface DealNoteTenant { id: string; name: string }

const words = (s: unknown) => String(s ?? "").trim();
const same = (s: unknown) => words(s).toLowerCase().replace(/\s+/g, " ");
const figure = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const pounds = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? `£${v.toLocaleString("en-GB")}` : null);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Lines added to Comments once: a line already there (typed, or from an earlier fill) is not added again. */
export function addCommentLines(existing: string, parts: Array<string | null | undefined>): string {
  const out = [words(existing)].filter(Boolean);
  for (const part of parts) {
    const line = words(part);
    if (line && !out.some(have => same(have).includes(same(line)))) out.push(line);
  }
  return out.join("\n");
}

/** The tenant a reading names: its id when the picker lists it, else one exact name among the picker's tenants. */
export function noteTenant(reading: LettingNoteReading, tenants: ReadonlyArray<DealNoteTenant>): DealNoteTenant | null {
  const f = reading.fields || {};
  if (f.brandId) {
    const byId = tenants.find(t => String(t.id) === String(f.brandId));
    if (byId) return byId;
  }
  const want = same(f.brandName);
  if (!want) return null;
  const hits = tenants.filter(t => same(t.name) === want);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The changes a reading makes to the deal form, and what to say under the
 * tenant picker: the brand's name when the note named a brand the picker does
 * not list (it is never picked), null when the tenant was found, undefined
 * when the note named no brand.
 */
export function dealNotePatch(form: DealNoteForm, reading: LettingNoteReading, tenants: ReadonlyArray<DealNoteTenant>): { patch: Partial<DealNoteForm>; brandHint: string | null | undefined } {
  const f = reading.fields || {};
  const patch: Partial<DealNoteForm> = {};
  const rent = figure(f.rentPa);
  if (rent !== null) patch.rentPa = rent;
  const term = figure(f.termYears);
  if (term !== null) patch.leaseLength = term;
  const free = figure(f.rentFreeMonths);
  if (free !== null) patch.rentFree = free;
  if (words(f.breakOption)) patch.breakOption = words(f.breakOption);
  const contribution = figure(f.fittingOutContribution);
  if (contribution !== null) patch.capitalContribution = contribution;

  let brandHint: string | null | undefined;
  if (f.brandId || words(f.brandName)) {
    const tenant = noteTenant(reading, tenants);
    if (tenant) {
      brandHint = null;
      if (String(tenant.id) !== form.tenantId) Object.assign(patch, { tenantId: String(tenant.id), tenantEntityId: "", tenantEntityName: "" });
    } else {
      brandHint = words(f.brandName) || null;
    }
  }

  const premium = pounds(f.premium);
  const agent = [f.agentName, f.agentCompanyName].map(words).filter(Boolean);
  const comments = addCommentLines(form.comments, [
    typeof f.turnoverRentPct === "number" ? `Turnover rent: ${f.turnoverRentPct}%` : null,
    premium ? `Premium: ${premium}` : null,
    words(f.rentReview) ? `Rent review: ${words(f.rentReview)}` : null,
    words(f.rentDeposit) ? `Rent deposit: ${words(f.rentDeposit)}` : null,
    words(f.incentives) ? `Incentives: ${words(f.incentives)}` : null,
    words(f.contactName) ? `Contact: ${words(f.contactName)}` : null,
    agent.length ? `Agent: ${agent.filter((a, i) => agent.findIndex(b => same(b) === same(a)) === i).join(", ")}` : null,
    isDay(f.date) ? `Dated ${formatCalendarDate(f.date) || f.date}` : null,
    f.note, ...(reading.unplaced || []),
  ]);
  if (comments !== words(form.comments)) patch.comments = comments;
  return { patch, brandHint };
}
