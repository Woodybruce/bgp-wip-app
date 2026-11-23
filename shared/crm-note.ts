// A plain note read into a CRM form: a strategy, an action or an event
// (Woody, 2026-11-15: "add in the AI form filling feature we built to this",
// the New CRM strategy form). The person types what they mean in their own
// words; the reader fills the boxes; nothing is saved until they press Create,
// so the form itself is the check. This file is the contract and the checks.
//
// What may fill a box:
// - Text the person wrote (objective, notes, purpose, a reason for a company)
//   is a span of the note, word for word. If the reader's span is not in the
//   note, the objective / notes box takes the whole note.
// - A name or title is the reader's own short wording, kept only when most of
//   its words are the note's.
// - An owner is a BGP person named in the note, and only when the name picks
//   out one person.
// - A date comes with the words it was read from, which must be in the note
//   and must carry that month, that day or a relative word ("next Tuesday").
// - A company is one the note names that is on the CRM's list for this view;
//   a name that is not found is listed back, never guessed.

export type CrmNoteForm = "strategy" | "action" | "event";
export const CRM_NOTE_FORMS: CrmNoteForm[] = ["strategy", "action", "event"];
export const CRM_NOTE_MAX = 4000;
export const CRM_EVENT_KINDS = ["bgp", "industry", "speaking", "pitch", "press"] as const;

export interface CrmNoteReading {
  form: CrmNoteForm;
  fields: {
    title?: string;        // strategy name, action title, event name
    text?: string;         // objective, notes, purpose and format
    ownerId?: string;
    team?: string;
    startsOn?: string;     // yyyy-mm-dd (strategy)
    endsOn?: string;
    dueAt?: string;        // yyyy-mm-ddTHH:mm, London (action)
    startsAt?: string;     // yyyy-mm-ddTHH:mm, London (event)
    endsAt?: string;
    location?: string;
    eventKind?: string;
  };
  companies: Array<{ id: string; name: string; reason: string }>;
  /** Company names in the note that are not on this view's list. */
  notFound: string[];
  /** Plain labels of what was filled, in form order. */
  filled: string[];
  /** Things the person should look at: a time that was assumed, a name that matched nobody. */
  check: string[];
}

export interface CrmNoteContext {
  form: CrmNoteForm;
  text: string;
  today: string; // yyyy-mm-dd, London
  staff: Array<{ id: string; name: string }>;
  /** The companies on this view's list that the note's names matched (the server looks them up). */
  companies: Array<{ id: string; name: string }>;
}

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s: unknown) => squash(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const inNote = (note: string, span: unknown) => { const q = plain(span); return q.length >= 2 && plain(note).includes(q); };

const STOP = new Set(["with", "from", "that", "this", "into", "their", "them", "have", "will", "about", "over", "more", "next", "each", "team", "plan", "strategy", "programme", "program", "push", "drive", "campaign"]);
/** A title the reader wrote: kept when at least 60% of its longer words are the note's own. */
export function titleFromNote(title: unknown, note: string, max = 120): string | null {
  const t = squash(title).replace(/[.;:,\s]+$/, "").slice(0, max);
  if (t.length < 3) return null;
  const words = t.toLowerCase().match(/[a-z0-9&']{4,}/g)?.filter(w => !STOP.has(w)) || [];
  if (!words.length) return inNote(note, t) ? t : null;
  const hay = plain(note);
  const own = words.filter(w => hay.includes(w.replace(/(?:ing|ed|es|s)$/, ""))).length;
  return own / words.length >= 0.6 ? t : null;
}

export const companyKey = (name: unknown) => plain(name).replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
  .replace(/\b(?:ltd|limited|plc|llp|group|holdings|uk|the)\b/g, " ").replace(/\s+/g, " ").trim();

// "Forge agency" in a note is the record "forge" (Woody, 2026-11-23): a word
// that only says what kind of firm it is, at the end of the name as written,
// is dropped when nothing matched the whole name.
export const KIND_WORDS_AT_END = /\s+(?:agency|agents?|estate agents?|property|properties|real estate|partners|company|co|firm|landlord|lender|brand|restaurants?)$/;
export const withoutKindWord = (key: string) => key.replace(KIND_WORDS_AT_END, "").trim();

/** The one BGP person a name in the note picks out, or null. */
export function ownerFromNote(said: unknown, note: string, staff: CrmNoteContext["staff"]): { id: string; name: string } | null {
  const name = squash(said);
  if (!name || !inNote(note, name)) return null;
  const key = plain(name);
  const full = staff.filter(p => plain(p.name) === key);
  if (full.length === 1) return full[0];
  if (full.length > 1 || key.includes(" ")) return null;
  const first = staff.filter(p => plain(p.name).split(" ")[0] === key);
  return first.length === 1 ? first[0] : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const RELATIVE_RE = /\b(today|tomorrow|tonight|this|next|end of|start of|beginning of|mid|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|quarter|q[1-4]|year|christmas|easter|summer|autumn|winter|spring|fortnight|days?)\b/i;

/** A date the reader gave, kept only with words from the note that carry it. */
export function dateFromNote(value: unknown, quote: unknown, note: string, today: string): string | null {
  const day = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !inNote(note, quote)) return null;
  const t = Date.parse(`${day}T00:00:00Z`), now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(now) || t < now - 370 * 86400000 || t > now + 5 * 366 * 86400000) return null;
  const q = plain(quote), [, m, d] = day.split("-").map(Number);
  const month = MONTHS[m - 1];
  const hasMonth = new RegExp(`\\b${month.slice(0, 3)}[a-z]*\\b`).test(q);
  const hasNumeric = new RegExp(`\\b0?${d}[/.-]0?${m}\\b`).test(q);
  // A day number beside the month must be this date's day ("12 December" is never the 13th).
  const days = [...q.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b(?!:|\.\d|\s*(?:am|pm))/g)].map(x => Number(x[1]));
  if (hasMonth) return !days.length || days.includes(d) ? day : null;
  return hasNumeric || RELATIVE_RE.test(q) ? day : null;
}

/** A clock time the reader gave ("15:00"), kept only when the quoted words carry a time. */
export function timeFromNote(value: unknown, quote: unknown, note: string): string | null {
  const m = String(value ?? "").match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m || !inNote(note, quote)) return null;
  if (!/\b\d{1,2}(?::\d{2}|\.\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\bnoon\b|\bmidday\b|\blunch(?:time)?\b|\bbreakfast\b|\bevening\b|\bmorning\b|\bafternoon\b/i.test(String(quote))) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** The reader's answer, checked. Nothing here is saved: it fills a form a person then reads. */
export function checkCrmAnswer(answer: any, ctx: CrmNoteContext): CrmNoteReading {
  const note = squash(ctx.text).slice(0, CRM_NOTE_MAX);
  const out: CrmNoteReading = { form: ctx.form, fields: {}, companies: [], notFound: [], filled: [], check: [] };
  const a = answer && typeof answer === "object" ? answer : {};
  const label = { title: ctx.form === "strategy" ? "Strategy name" : ctx.form === "action" ? "Action" : "Event name", text: ctx.form === "strategy" ? "Objective" : ctx.form === "action" ? "Notes" : "Purpose and format" };

  const title = titleFromNote(a.title, note, ctx.form === "strategy" ? 120 : 160);
  if (title) { out.fields.title = title; out.filled.push(label.title); }

  // The person's own words. A strategy's objective is required, so with no span the whole note stands in.
  const span = squash(a.text);
  if (span && inNote(note, span)) out.fields.text = span;
  else if (ctx.form === "strategy" || !title) out.fields.text = note;
  if (out.fields.text) out.filled.push(label.text);

  if (a.owner) {
    const owner = ownerFromNote(a.owner, note, ctx.staff);
    if (owner) { out.fields.ownerId = owner.id; out.filled.push("BGP owner"); }
    else out.check.push(`BGP owner: "${squash(a.owner).slice(0, 60)}" did not pick out one person at BGP`);
  }

  if (ctx.form === "strategy") {
    const team = squash(a.team).slice(0, 100);
    if (team && inNote(note, team)) { out.fields.team = team; out.filled.push("Team"); }
    const start = dateFromNote(a.startsOn?.date, a.startsOn?.quote, note, ctx.today);
    const end = dateFromNote(a.endsOn?.date, a.endsOn?.quote, note, ctx.today);
    if (start) { out.fields.startsOn = start; out.filled.push("Start date"); }
    if (end && (!start || end >= start)) { out.fields.endsOn = end; out.filled.push("Review / end date"); }
  }

  const when = (raw: any, what: string, fallbackTime: string): string | undefined => {
    const day = dateFromNote(raw?.date, raw?.quote, note, ctx.today);
    if (!day) return undefined;
    const time = timeFromNote(raw?.time, raw?.quote, note);
    if (!time) out.check.push(`${what}: no time in the note, set to ${fallbackTime}`);
    return `${day}T${time || fallbackTime}`;
  };
  if (ctx.form === "action") {
    const due = when(a.dueAt, "Due", "17:00");
    if (due) { out.fields.dueAt = due; out.filled.push("Due"); }
  }
  if (ctx.form === "event") {
    const start = when(a.startsAt, "Starts", "09:00");
    if (start) {
      out.fields.startsAt = start; out.filled.push("Starts");
      const endDay = dateFromNote(a.endsAt?.date, a.endsAt?.quote, note, ctx.today);
      const endTime = timeFromNote(a.endsAt?.time, a.endsAt?.quote, note);
      const end = endTime ? `${endDay || start.slice(0, 10)}T${endTime}` : null;
      if (end && end > start) { out.fields.endsAt = end; out.filled.push("Ends"); }
    }
    const place = squash(a.location).slice(0, 400);
    if (place && inNote(note, place)) { out.fields.location = place; out.filled.push("Location"); }
    if ((CRM_EVENT_KINDS as readonly string[]).includes(a.kind)) { out.fields.eventKind = a.kind; out.filled.push("Type"); }
  }

  const said: Array<{ name: string; reason: string }> = [];
  for (const c of Array.isArray(a.companies) ? a.companies.slice(0, 12) : []) {
    const name = squash(c?.name).slice(0, 200);
    if (!name || !inNote(note, name) || said.some(s => companyKey(s.name) === companyKey(name))) continue;
    const reason = squash(c?.reason);
    said.push({ name, reason: reason && inNote(note, reason) ? reason.slice(0, 2000) : "" });
  }
  for (const s of said) {
    // The name as written first, then without Ltd / plc / Group, then as the start of a longer name.
    const key = companyKey(s.name);
    const tiers = [
      ctx.companies.filter(c => plain(c.name) === plain(s.name)),
      ctx.companies.filter(c => companyKey(c.name) === key),
      ctx.companies.filter(c => companyKey(c.name).startsWith(`${key} `)),
      ...(withoutKindWord(key) && withoutKindWord(key) !== key ? [ctx.companies.filter(c => companyKey(c.name) === withoutKindWord(key))] : []),
    ];
    const starts = tiers.find(t => t.length) || [];
    if (key && starts.length === 1) {
      if (!out.companies.some(c => c.id === starts[0].id)) out.companies.push({ id: starts[0].id, name: starts[0].name, reason: s.reason });
    } else out.notFound.push(starts.length > 1 ? `${s.name} (${starts.length} records share that name)` : s.name);
  }
  // An action is about one company.
  if (ctx.form === "action" && out.companies.length > 1) {
    out.check.push(`The note names ${out.companies.length} companies: an action is for one, so the first was used`);
    out.companies = out.companies.slice(0, 1);
  }
  if (out.companies.length) out.filled.push(out.companies.length === 1 ? out.companies[0].name : `${out.companies.length} companies`);
  return out;
}
