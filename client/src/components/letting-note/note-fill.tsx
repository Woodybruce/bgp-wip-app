// "Paste a note" on a letting form (Woody, 2026-11-13: "drop in the basic
// info and that populate the form"). The person drops a plain note in,
// presses Read note, sees what was read and where each value came from, then
// fills the form. This box never saves: it hands the reading to the form it
// sits in, and that form's own Save is the only write. It asks the server one
// question (the note reader) and nothing else, and reads nothing from the
// CRM, so it is safe on a joint agent's pages.
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatCalendarDate } from "@shared/calendar-date";
import {
  NOTE_FIELD_LABELS, NOTE_MAX,
  type LettingNoteField, type LettingNoteReading, type NoteKind, type NoteSource, type ReadNoteRequest,
} from "@shared/letting-note";

export interface NoteFillProps {
  kind: NoteKind;
  unitId: string;
  offerId?: string;                 // round: the offer the position belongs to
  source?: NoteSource;              // read a piece of writing already in the app instead of a pasted note
  initialText?: string;
  autoRead?: boolean;               // read as soon as it mounts (used with source or initialText)
  autoApply?: boolean;              // and fill the form without a second press; the person still checks and saves
  onApply: (reading: LettingNoteReading) => void;
  className?: string;
}

export interface NoteReadingRow { field: LettingNoteField; label: string; value: string; quote: string | null }

// The order the read-back lists what was found. The two id keys never show:
// the name beside them does.
const ROW_ORDER: LettingNoteField[] = [
  "brandName", "contactName", "agentName", "agentCompanyName", "moreBrands", "date", "time", "party",
  "rentPa", "turnoverRentPct", "termYears", "rentFreeMonths", "breakOption", "premium", "fittingOutContribution",
  "rentReview", "rentDeposit", "incentives", "outcome", "nextAction", "followUpDate", "attendees", "note",
];
const MONEY: ReadonlySet<LettingNoteField> = new Set<LettingNoteField>(["rentPa", "premium", "fittingOutContribution"]);
const DATES: ReadonlySet<LettingNoteField> = new Set<LettingNoteField>(["date", "followUpDate"]);

const plainNumber = (n: number): string => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

// One value as it reads on the screen: money as "£120,000", a date as
// "9 Nov 2026", a percentage with its sign. Blank when there is nothing.
export function noteValueText(field: LettingNoteField, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field === "moreBrands") {
    return Array.isArray(value) ? value.map(b => String(b?.name || "").trim()).filter(Boolean).join(", ") : "";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (MONEY.has(field)) return `£${plainNumber(value)}`;
    if (field === "turnoverRentPct") return `${plainNumber(value)}%`;
    return plainNumber(value);
  }
  const text = String(value).trim();
  if (!text) return "";
  if (DATES.has(field)) return formatCalendarDate(text) || text;
  if (field === "party") return text === "tenant" ? "Tenant" : text === "landlord" ? "Landlord" : text;
  return text;
}

// What a reading found, as label, value and the words it came from. For a
// form that wants to show the reading its own way, and for tests.
export function readingRows(reading: LettingNoteReading): NoteReadingRow[] {
  const fields = reading?.fields || {};
  const quotes = reading?.quotes || {};
  const rows: NoteReadingRow[] = [];
  for (const field of ROW_ORDER) {
    const value = noteValueText(field, fields[field]);
    if (!value) continue;
    const quote = String(quotes[field] ?? (field === "brandName" ? quotes.brandId : field === "agentCompanyName" ? quotes.agentCompanyId : "") ?? "").trim();
    rows.push({ field, label: NOTE_FIELD_LABELS[field], value, quote: quote || null });
  }
  return rows;
}

// Why a read failed, in plain words. Never a status code, never raw HTML.
export function noteReadError(e: unknown): string {
  const raw = typeof (e as any)?.message === "string" ? String((e as any).message) : "";
  const coded = /^(\d{3}):\s*([\s\S]*)$/.exec(raw);
  const status = coded ? Number(coded[1]) : 0;
  const said = (coded ? coded[2] : "").trim();
  const usable = said && said.length <= 240 && !/[<{]/.test(said) && !/^(not found|forbidden|unauthorized|bad request|internal server error|too many requests)$/i.test(said);
  if (!status) return "Could not reach the server. Check your connection and try again.";
  if (status === 401) return "You have been signed out. Sign in again, then read the note.";
  if (status === 404) return usable ? said : "Notes cannot be read here yet. Fill the form by hand.";
  if (status === 429) return usable ? said : "Too many notes read in a short time. Try again in a minute.";
  if (status === 403) return usable ? said : "You cannot read notes on this unit.";
  if (status >= 500) return "The note could not be read. Try again, or fill the form by hand.";
  return usable ? said : "The note could not be read. Try again, or fill the form by hand.";
}

const EXAMPLE = "Offered: 15 year lease. Rent £120k pax and 9% t/o. 6 MRF";

export function NoteFill({ kind, unitId, offerId, source: sourceProp, initialText, autoRead, autoApply, onApply, className }: NoteFillProps) {
  const [source, setSource] = useState<NoteSource | undefined>(sourceProp);
  const [open, setOpen] = useState(!!sourceProp || !!initialText || !!autoRead);
  const [text, setText] = useState(initialText || "");
  const [reading, setReading] = useState<LettingNoteReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const latest = useRef(0);
  const started = useRef(false);
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  const read = async (from?: NoteSource) => {
    const words = text.trim();
    if (!from && !words) return;
    const body: ReadNoteRequest = from
      ? { kind, source: from, ...(offerId ? { offerId } : {}) }
      : { kind, text: words.slice(0, NOTE_MAX), ...(offerId ? { offerId } : {}) };
    const turn = ++latest.current;
    setBusy(true); setError(null); setReading(null); setFilled(false);
    try {
      const res = await apiRequest("POST", `/api/unit-offers/unit/${encodeURIComponent(unitId)}/read-note`, body);
      const data = (await res.json()) as LettingNoteReading;
      if (turn !== latest.current) return;
      if (!data || typeof data !== "object" || !data.fields) throw new Error("500: empty");
      setReading(data);
      if (autoApply && Object.keys(data.fields).length) { onApplyRef.current(data); setFilled(true); }
    } catch (e) {
      if (turn !== latest.current) return;
      setError(noteReadError(e));
    } finally {
      if (turn === latest.current) setBusy(false);
    }
  };

  // Read on arrival, once: a comment already in the app, or a note handed in.
  useEffect(() => {
    if (!autoRead || started.current) return;
    started.current = true;
    if (sourceProp || (initialText || "").trim()) void read(sourceProp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = reading ? readingRows(reading) : [];
  const unsure = (reading?.unsure || []).filter(u => u && u.field && noteValueText(u.field, u.value));
  const unplaced = (reading?.unplaced || []).map(s => String(s || "").trim()).filter(Boolean);
  const dropped = (reading?.dropped || []).filter(d => d && (d.field || d.reason));
  const droppedLabel = (field: string) => (NOTE_FIELD_LABELS as Record<string, string>)[field] || field;

  if (!open) {
    return (
      <div className={cn("min-w-0", className)} data-testid="note-fill">
        <button
          type="button"
          data-no-min-touch
          className="inline-flex min-h-8 items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          data-testid="note-fill-open"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Paste a note
        </button>
      </div>
    );
  }

  return (
    <div className={cn("w-full min-w-0 space-y-2 rounded-lg border border-border bg-muted/30 p-3", className)} data-testid="note-fill">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {source ? "Read from the comment" : "Paste a note"}
        </p>
        {!busy && (
          <button
            type="button"
            data-no-min-touch
            className="inline-flex min-h-8 items-center text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => { latest.current++; setOpen(false); setBusy(false); setError(null); }}
            data-testid="note-fill-close"
          >
            Hide
          </button>
        )}
      </div>

      {source ? (
        <div className="space-y-1.5">
          {reading?.text && <p className="whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-xs text-muted-foreground" data-testid="note-fill-source-text">{reading.text}</p>}
          {!busy && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {(error || !reading) && (
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => read(source)} data-testid="note-fill-read">
                  <Sparkles className="mr-1 h-3.5 w-3.5" /> Read the comment
                </Button>
              )}
              <button
                type="button"
                data-no-min-touch
                className="inline-flex min-h-8 items-center text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => { latest.current++; setSource(undefined); setReading(null); setError(null); setFilled(false); setText(""); }}
                data-testid="note-fill-other"
              >
                Paste a different note
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <Textarea
            rows={3}
            value={text}
            maxLength={NOTE_MAX}
            onChange={e => setText(e.target.value)}
            placeholder={`e.g. ${EXAMPLE}`}
            aria-label="Note to read"
            className="w-full text-sm"
            disabled={busy}
            data-testid="note-fill-text"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => read()} disabled={busy || !text.trim()} data-testid="note-fill-read">
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {busy ? "Reading…" : reading ? "Read again" : "Read note"}
            </Button>
            {!reading && !busy && !error && <span className="text-[11px] text-muted-foreground">Nothing is saved until you save the form.</span>}
            {text.length >= NOTE_MAX && <span className="text-[11px] text-muted-foreground">The note is cut at {NOTE_MAX.toLocaleString("en-GB")} characters.</span>}
          </div>
        </>
      )}

      {busy && source && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="note-fill-busy">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the comment…
        </p>
      )}

      {error && <p className="text-xs text-destructive" role="alert" data-testid="note-fill-error">{error}</p>}

      {reading && (
        <div className="space-y-2 border-t border-border pt-2" data-testid="note-fill-reading">
          {reading.saidBy && <p className="text-[11px] text-muted-foreground" data-testid="note-fill-said-by">Written by {reading.saidBy}</p>}
          {reading.reason && <p className="break-words text-xs text-muted-foreground" data-testid="note-fill-reason">{reading.reason}</p>}
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="note-fill-empty">
              {unsure.length ? "Nothing was filled from this note. Type the values into the form yourself." : "Nothing in this note fits a box on this form."}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {rows.map(r => (
                <div key={r.field} className="min-w-0" data-testid={`note-fill-row-${r.field}`}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{r.label}</dt>
                  <dd className={cn("break-words text-sm", (MONEY.has(r.field) || r.field === "turnoverRentPct" || r.field === "termYears" || r.field === "rentFreeMonths") && "font-mono tabular-nums")}>{r.value}</dd>
                  {r.quote && <dd className="break-words text-[11px] text-muted-foreground">from “{r.quote}”</dd>}
                </div>
              ))}
            </dl>
          )}
          {unsure.length > 0 && (
            <div className="space-y-1 rounded-md border border-dashed border-border p-2" data-testid="note-fill-unsure">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Not filled, check these</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {unsure.map((u, i) => (
                  <div key={`${u.field}-${i}`} className="min-w-0" data-testid={`note-fill-unsure-${u.field}`}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{NOTE_FIELD_LABELS[u.field] || u.field}</dt>
                    <dd className={cn("break-words text-sm", (MONEY.has(u.field) || u.field === "turnoverRentPct" || u.field === "termYears" || u.field === "rentFreeMonths") && "font-mono tabular-nums")}>{noteValueText(u.field, u.value)}</dd>
                    {u.quote && <dd className="break-words text-[11px] text-muted-foreground">from “{u.quote}”</dd>}
                  </div>
                ))}
              </dl>
            </div>
          )}
          {unplaced.length > 0 && (
            <p className="break-words text-xs" data-testid="note-fill-unplaced">
              <span className="text-muted-foreground">Could not place: </span>{unplaced.join("; ")}
            </p>
          )}
          {dropped.length > 0 && (
            <div className="text-xs" data-testid="note-fill-dropped">
              <span className="text-muted-foreground">Left out: </span>
              {dropped.map((d, i) => (
                <span key={i} className="break-words">{i > 0 ? "; " : ""}{droppedLabel(d.field)}{d.reason ? ` (${d.reason})` : ""}</span>
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
              <Button type="button" size="sm" variant={filled ? "outline" : "secondary"} className="h-8 text-xs" onClick={() => { onApply(reading); setFilled(true); }} data-testid="note-fill-apply">
                {filled ? "Fill again" : "Fill the form"}
              </Button>
              <span className="text-[11px] text-muted-foreground" data-testid="note-fill-hint">
                {filled ? `Form filled from this ${source ? "comment" : "note"}. Check it, then save.` : "Fills the form. Check it, then save."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
