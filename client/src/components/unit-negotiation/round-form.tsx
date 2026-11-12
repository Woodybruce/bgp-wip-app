// The form for one position in a negotiation: whose it is, the date, the
// terms and a note. It starts from the last position, so the person changes
// only what moved; only the terms they changed are sent, and the server
// carries the rest over. Used for the next position and to correct one.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/pill";
import { parseMoney } from "@shared/unit-brief";
import {
  ROUND_PARTIES, ROUND_TERM_FIELDS, roundNetEffectiveRent,
  type RoundParty, type RoundTermKey, type RoundTerms,
} from "@shared/unit-negotiation";
import { fmtMoney, isBlank, type TermField } from "./format";

export type RoundPayload = { party: RoundParty; roundDate: string; note: string | null } & { [K in RoundTermKey]?: number | string | null };

interface RoundFormProps {
  idPrefix: string;        // "add" or "edit": prefixes the ids and test ids
  title: string;
  base: RoundTerms;        // the position the form starts from
  party: RoundParty;
  roundDate: string;       // yyyy-mm-dd
  note: string;
  requireChange: boolean;  // a new position must move a term or carry a note
  roomy: boolean;          // the panel is wide enough for three columns of fields
  saveLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: RoundPayload) => void;
}

const NUMBER_MAX: Partial<Record<RoundTermKey, number>> = { termYears: 999, rentFreeMonths: 600, turnoverRentPct: 100 };
const TEXT_MAX = 500;
const NOTE_MAX = 4000;
const PLACEHOLDER: Partial<Record<RoundTermKey, string>> = {
  breakOption: "For example, year 5", rentReview: "For example, year 5, upward only",
  rentDeposit: "For example, 6 months", incentives: "Anything else on the table",
};

// The form holds every term as text, the way it was typed.
const asText = (f: TermField, v: number | string | null | undefined): string => {
  if (isBlank(v)) return "";
  if (f.kind === "money") { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : String(v); }
  return String(v);
};

type Read = { ok: true; value: number | string | null } | { ok: false; message: string };

function readField(f: TermField, raw: string): Read {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (f.kind === "money") {
    const n = parseMoney(text);
    if (n === undefined || n === null || n < 0) return { ok: false, message: "Use a number, for example 95000 or 95k." };
    return { ok: true, value: n };
  }
  if (f.kind === "number") {
    const max = NUMBER_MAX[f.key] ?? 1_000_000;
    const s = text.replace(/\s*%$/, "");
    const n = /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
    if (!Number.isFinite(n) || n > max) return { ok: false, message: `Use a number from 0 to ${max}.` };
    return { ok: true, value: n };
  }
  if (text.length > TEXT_MAX) return { ok: false, message: `Keep this to ${TEXT_MAX} characters.` };
  return { ok: true, value: text };
}

export function RoundForm({ idPrefix, title, base, party: startParty, roundDate: startDate, note: startNote, requireChange, roomy, saveLabel, busy, onCancel, onSave }: RoundFormProps) {
  const start = (): Record<RoundTermKey, string> => {
    const out = {} as Record<RoundTermKey, string>;
    for (const f of ROUND_TERM_FIELDS) out[f.key] = asText(f, base[f.key]);
    return out;
  };
  const [initial] = useState(start);
  const [values, setValues] = useState(initial);
  const [party, setParty] = useState<RoundParty>(startParty);
  const [roundDate, setRoundDate] = useState(startDate);
  const [note, setNote] = useState(startNote);
  const [errors, setErrors] = useState<Partial<Record<RoundTermKey | "roundDate" | "note" | "form", string>>>({});

  const set = (key: RoundTermKey, text: string) => {
    setValues(v => ({ ...v, [key]: text }));
    setErrors(e => (e[key] || e.form ? { ...e, [key]: undefined, form: undefined } : e));
  };
  // A money figure typed as "95k" settles to "95,000" when the box is left.
  const settle = (f: TermField) => {
    if (f.kind !== "money") return;
    const read = readField(f, values[f.key]);
    if (read.ok && typeof read.value === "number") setValues(v => ({ ...v, [f.key]: asText(f, read.value) }));
  };

  // The position as typed so far, for the net effective rent under the form.
  const typed: RoundTerms = {};
  for (const f of ROUND_TERM_FIELDS) {
    const read = readField(f, values[f.key]);
    typed[f.key] = read.ok ? read.value : null;
  }
  const ner = roundNetEffectiveRent(typed);
  const nerBefore = roundNetEffectiveRent(base);

  const save = () => {
    const nextErrors: typeof errors = {};
    const payload: RoundPayload = { party, roundDate, note: note.trim() || null };
    let moved = 0;
    for (const f of ROUND_TERM_FIELDS) {
      const read = readField(f, values[f.key]);
      if (!read.ok) { nextErrors[f.key] = read.message; continue; }
      if (values[f.key].trim() !== initial[f.key].trim()) { payload[f.key] = read.value; moved++; }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(roundDate)) nextErrors.roundDate = "Set the date of this position.";
    if (note.length > NOTE_MAX) nextErrors.note = `Keep the note to ${NOTE_MAX} characters.`;
    if (requireChange && !moved && !payload.note && Object.keys(nextErrors).length === 0) {
      nextErrors.form = "Nothing has changed from the last position. Change a term or add a note.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSave(payload);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3 min-w-0" data-testid={`negotiation-${idPrefix}-form`}>
      <p className="text-sm font-medium">{title}</p>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground" id={`neg-${idPrefix}-party-label`}>Whose position is this?</p>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby={`neg-${idPrefix}-party-label`}>
          {ROUND_PARTIES.map(p => (
            <Pill key={p.key} active={party === p.key} aria-pressed={party === p.key} disabled={busy} className="disabled:opacity-60" onClick={() => setParty(p.key)} data-testid={`negotiation-${idPrefix}-party-${p.key}`}>
              {p.label}
            </Pill>
          ))}
        </div>
      </div>

      <div className={roomy ? "grid grid-cols-3 gap-3" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`neg-${idPrefix}-date`} className="text-xs">Date</Label>
          <Input id={`neg-${idPrefix}-date`} type="date" className="min-w-0" value={roundDate} disabled={busy}
            onChange={e => { setRoundDate(e.target.value); setErrors(er => ({ ...er, roundDate: undefined })); }}
            aria-invalid={!!errors.roundDate} data-testid={`negotiation-${idPrefix}-date`} />
          {errors.roundDate && <p className="text-[11px] text-destructive">{errors.roundDate}</p>}
        </div>
        {ROUND_TERM_FIELDS.map(f => {
          const id = `neg-${idPrefix}-${f.key}`;
          const changed = values[f.key].trim() !== initial[f.key].trim();
          return (
            <div key={f.key} className="min-w-0 space-y-1">
              <Label htmlFor={id} className="text-xs">
                {f.label}{f.kind === "money" ? " (£)" : ""}
                {changed && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground" data-testid={`negotiation-${idPrefix}-changed-${f.key}`}>{initial[f.key] ? `was ${f.kind === "money" ? "£" : ""}${initial[f.key]}` : "new"}</span>}
              </Label>
              <Input id={id} value={values[f.key]} disabled={busy}
                inputMode={f.kind === "text" ? "text" : "decimal"} autoComplete="off"
                className={f.kind === "text" ? "min-w-0" : "min-w-0 font-mono tabular-nums"}
                placeholder={PLACEHOLDER[f.key]}
                onChange={e => set(f.key, e.target.value)} onBlur={() => settle(f)}
                aria-invalid={!!errors[f.key]} data-testid={`negotiation-${idPrefix}-${f.key}`} />
              {errors[f.key] && <p className="text-[11px] text-destructive" data-testid={`negotiation-${idPrefix}-error-${f.key}`}>{errors[f.key]}</p>}
            </div>
          );
        })}
      </div>

      {ner !== null && (
        <p className="text-xs text-muted-foreground" data-testid={`negotiation-${idPrefix}-ner`}>
          Net effective rent <span className="font-mono tabular-nums text-foreground">{fmtMoney(ner)}</span> a year
          {nerBefore !== null && nerBefore !== ner && <> (was <span className="font-mono tabular-nums">{fmtMoney(nerBefore)}</span>)</>}
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor={`neg-${idPrefix}-note`} className="text-xs">Note</Label>
        <Textarea id={`neg-${idPrefix}-note`} rows={2} value={note} disabled={busy} placeholder="What was said, by whom"
          onChange={e => { setNote(e.target.value); setErrors(er => (er.note || er.form ? { ...er, note: undefined, form: undefined } : er)); }}
          aria-invalid={!!errors.note} data-testid={`negotiation-${idPrefix}-note`} />
        {errors.note && <p className="text-[11px] text-destructive">{errors.note}</p>}
      </div>

      {errors.form && <p className="text-xs text-destructive" role="alert" data-testid={`negotiation-${idPrefix}-form-error`}>{errors.form}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel} data-testid={`negotiation-${idPrefix}-cancel`}>Cancel</Button>
        <Button type="button" size="sm" disabled={busy} onClick={save} data-testid={`negotiation-${idPrefix}-save`}>
          {busy && <Loader2 className="animate-spin" />}{saveLabel}
        </Button>
      </div>
    </div>
  );
}
