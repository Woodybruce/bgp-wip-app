// What the "Paste a note" box (note-fill.tsx) hands the form it sits in. Pure,
// so it is tested without React (server/letting-note.test.ts).
import type { LettingNoteField, LettingNoteFields, LettingNoteReading } from "@shared/letting-note";

export type NoteUnsureRow = NonNullable<LettingNoteReading["unsure"]>[number];

// Keys a person never puts in a form from "Not filled, check these".
const NEVER_ONE_BY_ONE: ReadonlySet<LettingNoteField> = new Set<LettingNoteField>(["note", "brandId", "agentCompanyId"]);

/**
 * What "Fill the form" applies. A note that is not tight shorthand (the
 * reading carries a `reason` or an `unsure` list) never puts words in the
 * form's Comments or Notes box: no `fields.note`, and no `unplaced` text,
 * which the forms add to that box. Those words stay in the read-back only.
 */
export function readingToFill(reading: LettingNoteReading): LettingNoteReading {
  if (reading.reason === undefined && reading.unsure === undefined) return reading;
  const fields: LettingNoteFields = { ...reading.fields };
  delete fields.note;
  return { ...reading, fields, unplaced: [] };
}

/**
 * One value from "Not filled, check these", as a reading that holds that one
 * box and nothing else: its words as the quote, no leftover text, nothing
 * dropped or unsure. The forms apply only the keys a reading holds, so
 * pressing Use changes that one box. Null for a key no form takes this way.
 */
export function oneValueReading(reading: LettingNoteReading, row: NoteUnsureRow): LettingNoteReading | null {
  if (!row || !row.field || NEVER_ONE_BY_ONE.has(row.field)) return null;
  let value: unknown = row.value;
  if (row.field === "moreBrands") {
    const names = String(row.value ?? "").split(/\s*,\s*/).map(n => n.trim()).filter(Boolean);
    if (!names.length) return null;
    value = names.map(name => ({ name }));
  } else if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return null;
  }
  const quote = String(row.quote ?? "").trim();
  return {
    kind: reading.kind,
    text: reading.text,
    fields: { [row.field]: value } as LettingNoteFields,
    quotes: quote ? { [row.field]: quote } : {},
    unplaced: [],
    dropped: [],
    saidBy: reading.saidBy,
    usedAi: reading.usedAi,
  };
}
