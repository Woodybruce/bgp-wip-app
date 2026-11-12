// Comparable evidence on a transaction recommendation: the rows as a table
// (cards on a phone), with rent per sq ft and the net effective rent less
// three months' fit-out worked out for each. A person adds, edits and
// removes rows; "Add from this scheme" copies the figures of a letting
// already in the app into a row, which is then just a row.
import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { parseMoney } from "@shared/unit-brief";
import { recommendationNer, type RecommendationComparable } from "@shared/unit-recommendation";
import { MICRO_LABEL, hotsCall } from "@/components/unit-hots/hots-api";
import {
  COMPARABLES_MAX, FIGURE, SECTION, SECTION_TITLE, TONE_BAD, comparableDate, figureError, has, money, newComparableId, parseNumber, psf, validComparableDate,
} from "./recommendation-format";

type Candidate = Omit<RecommendationComparable, "id"> & { key: string; source: "deal" | "comps"; sourceLabel: string };
type FormValues = Record<FieldKey, string>;
type FieldKey = "transaction" | "date" | "tenant" | "unit" | "areaSqFt" | "use" | "rentPa" | "turnoverPct" | "rentFreeMonths" | "capitalContribution" | "termYears" | "breaks" | "rentReview" | "comment";

const FIELDS: { key: FieldKey; label: string; kind: "text" | "money" | "number" | "longtext"; hint?: string; max?: number; wide?: boolean }[] = [
  { key: "tenant", label: "Tenant", kind: "text", max: 200 },
  { key: "unit", label: "Unit, level, mall and centre", kind: "text", max: 300 },
  { key: "transaction", label: "Type of transaction", kind: "text", hint: "new letting, renewal, regear", max: 120 },
  { key: "date", label: "Date", kind: "text", hint: "a day or a month: 2026-03-25 or 2026-03", max: 10 },
  { key: "use", label: "Use", kind: "text", max: 200 },
  { key: "areaSqFt", label: "Area (sq ft)", kind: "number", max: 10_000_000 },
  { key: "rentPa", label: "Headline rent a year", kind: "money" },
  { key: "turnoverPct", label: "Turnover rent %", kind: "number", max: 100 },
  { key: "rentFreeMonths", label: "Rent free (months)", kind: "number", max: 600 },
  { key: "capitalContribution", label: "Capital contribution", kind: "money" },
  { key: "termYears", label: "Term (years)", kind: "number", max: 999 },
  { key: "breaks", label: "Breaks", kind: "text", max: 300 },
  { key: "rentReview", label: "Rent review", kind: "text", max: 300 },
  { key: "comment", label: "Any other comments", kind: "longtext", max: 1000, wide: true },
];

const blank = (): FormValues => Object.fromEntries(FIELDS.map(f => [f.key, ""])) as FormValues;
const valuesOf = (row: RecommendationComparable): FormValues =>
  Object.fromEntries(FIELDS.map(f => { const v = row[f.key]; return [f.key, v === null || v === undefined ? "" : String(v)]; })) as FormValues;

function fieldError(f: (typeof FIELDS)[number], v: string): string | null {
  if (f.kind === "money" || f.kind === "number") return figureError(f.kind, v, f.max);
  const t = v.trim();
  if (f.max && t.length > f.max) return `Too long: the limit is ${f.max.toLocaleString("en-GB")} characters`;
  if (f.key === "date" && t && !validComparableDate(t)) return "A day or a month, like 2026-03-25 or 2026-03";
  return null;
}

// The row a filled form makes. The figures are parsed as the server parses them.
function rowOf(id: string, dealId: string | null, v: FormValues): RecommendationComparable {
  const text = (k: FieldKey) => v[k].trim() || null;
  const fig = (k: FieldKey, kind: "money" | "number") => (kind === "money" ? parseMoney(v[k]) : parseNumber(v[k])) ?? null;
  return {
    id, transaction: text("transaction"), date: text("date"), tenant: text("tenant"), unit: text("unit"), areaSqFt: fig("areaSqFt", "number"), use: text("use"),
    rentPa: fig("rentPa", "money"), turnoverPct: fig("turnoverPct", "number"), rentFreeMonths: fig("rentFreeMonths", "number"),
    capitalContribution: fig("capitalContribution", "money"), termYears: fig("termYears", "number"), breaks: text("breaks"), rentReview: text("rentReview"),
    comment: text("comment"), dealId,
  };
}

const dash = <span className="text-muted-foreground">-</span>;
const rentPsf = (c: RecommendationComparable): number | null => (c.rentPa !== null && c.areaSqFt ? c.rentPa / c.areaSqFt : null);
const nerLessFitOut = (c: RecommendationComparable): number | null =>
  recommendationNer({ rentPa: c.rentPa, termYears: c.termYears, rentFreeMonths: c.rentFreeMonths, capitalContribution: c.capitalContribution }, 3);
const incentive = (c: RecommendationComparable): string =>
  [c.rentFreeMonths !== null ? `${c.rentFreeMonths} ${c.rentFreeMonths === 1 ? "month" : "months"} rent free` : "", c.capitalContribution !== null && c.capitalContribution > 0 ? money(c.capitalContribution) : ""].filter(Boolean).join(", ");
const termOf = (c: RecommendationComparable): string =>
  [c.termYears !== null ? `${c.termYears} ${c.termYears === 1 ? "year" : "years"}` : "", c.breaks || ""].filter(Boolean).join(", ");
const underLine = (c: RecommendationComparable): string =>
  [c.transaction, c.use, c.turnoverPct !== null ? `Turnover rent ${c.turnoverPct}%` : "", c.rentReview ? `Rent review: ${c.rentReview}` : "", c.comment].filter(has).join(" · ");

export function RecommendationComparables({ rows, canEdit, api, onChange }: {
  rows: RecommendationComparable[];
  canEdit: boolean;
  api: string;
  onChange: (rows: RecommendationComparable[]) => void;
}) {
  // The inline form: a new row, or the row being edited.
  const [form, setForm] = useState<{ id: string | null; values: FormValues } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [picker, setPicker] = useState<{ loading: boolean; list: Candidate[] | null; error: string | null } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const full = rows.length >= COMPARABLES_MAX;

  const openForm = (row: RecommendationComparable | null) => {
    setShowErrors(false);
    setPicker(null);
    setForm({ id: row ? row.id : null, values: row ? valuesOf(row) : blank() });
  };
  const errors = form ? Object.fromEntries(FIELDS.map(f => [f.key, fieldError(f, form.values[f.key])]).filter(([, e]) => e)) as Partial<Record<FieldKey, string>> : {};
  const nameless = !!form && !form.values.tenant.trim() && !form.values.unit.trim();
  const submit = () => {
    if (!form) return;
    if (Object.keys(errors).length || nameless) { setShowErrors(true); return; }
    if (form.id) {
      const was = rows.find(r => r.id === form.id);
      onChange(rows.map(r => (r.id === form.id ? rowOf(r.id, was?.dealId ?? null, form.values) : r)));
    } else {
      onChange([...rows, rowOf(newComparableId(), null, form.values)]);
    }
    setForm(null);
  };
  const remove = (row: RecommendationComparable) => {
    if (!window.confirm(`Remove the comparable for ${row.tenant || row.unit || "this row"}?`)) return;
    if (form?.id === row.id) setForm(null);
    onChange(rows.filter(r => r.id !== row.id));
  };

  const openPicker = async () => {
    setForm(null);
    setPicker({ loading: true, list: null, error: null });
    try {
      const out = await hotsCall<{ candidates: Candidate[] }>("GET", `${api}/comparable-candidates`);
      setPicker({ loading: false, list: out.candidates, error: null });
    } catch (e) {
      setPicker({ loading: false, list: null, error: (e as Error).message || "The lettings on this scheme could not be loaded." });
    }
  };
  const isAdded = (c: Candidate) => picked.includes(c.key) || (!!c.dealId && rows.some(r => r.dealId === c.dealId));
  const addCandidate = (c: Candidate) => {
    if (full || isAdded(c)) return;
    const { key, source: _source, sourceLabel: _label, ...figures } = c;
    setPicked(p => [...p, key]);
    onChange([...rows, { id: newComparableId(), ...figures }]);
  };

  const actions = (row: RecommendationComparable) => canEdit && (
    <div className="flex shrink-0 gap-1">
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => openForm(row)} aria-label={`Edit the comparable for ${row.tenant || row.unit || "this row"}`} data-testid={`recommendation-comparable-edit-${row.id}`}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(row)} aria-label={`Remove the comparable for ${row.tenant || row.unit || "this row"}`} data-testid={`recommendation-comparable-remove-${row.id}`}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <section className={SECTION} data-testid="recommendation-comparables">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>Comparable evidence</h3>
        {rows.length > 0 && <span className="text-xs text-muted-foreground" data-testid="recommendation-comparables-count">{rows.length} of {COMPARABLES_MAX}</span>}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="recommendation-comparables-empty">No comparable evidence has been added yet.</p>
      ) : (
        <>
          {/* Desktop: a table. */}
          <div className="hidden md:block">
            <table className="w-full table-fixed text-xs" data-testid="recommendation-comparables-table">
              <thead>
                <tr className="border-b text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="w-[24%] py-1.5 pr-2 font-semibold">Tenant and unit</th>
                  <th className="w-[10%] py-1.5 pr-2 font-semibold">Date</th>
                  <th className="w-[8%] py-1.5 pr-2 text-right font-semibold">Sq ft</th>
                  <th className="w-[10%] py-1.5 pr-2 text-right font-semibold">Rent a year</th>
                  <th className="w-[8%] py-1.5 pr-2 text-right font-semibold">Per sq ft</th>
                  <th className="w-[13%] py-1.5 pr-2 font-semibold">Incentive</th>
                  <th className="w-[11%] py-1.5 pr-2 font-semibold">Term</th>
                  <th className="w-[10%] py-1.5 pr-2 text-right font-semibold">Net effective less fit-out</th>
                  {canEdit && <th className="w-[6%] py-1.5"><span className="sr-only">Edit or remove</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(c => {
                  const under = underLine(c), p = rentPsf(c), ner = nerLessFitOut(c);
                  return (
                    <tr key={c.id} className={cn("border-b align-top last:border-b-0", form?.id === c.id && "bg-muted/40")} data-testid={`recommendation-comparable-${c.id}`}>
                      <td className="py-2 pr-2">
                        <p className="break-words font-medium">{c.tenant || "Tenant not named"}</p>
                        {c.unit && <p className="break-words text-muted-foreground">{c.unit}</p>}
                        {under && <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{under}</p>}
                      </td>
                      <td className="py-2 pr-2">{c.date ? comparableDate(c.date) : dash}</td>
                      <td className={cn("py-2 pr-2 text-right", FIGURE)}>{c.areaSqFt !== null ? c.areaSqFt.toLocaleString("en-GB") : dash}</td>
                      <td className={cn("py-2 pr-2 text-right", FIGURE)}>{c.rentPa !== null ? money(c.rentPa) : dash}</td>
                      <td className={cn("py-2 pr-2 text-right", FIGURE)} data-testid={`recommendation-comparable-psf-${c.id}`}>{p !== null ? psf(p) : dash}</td>
                      <td className="break-words py-2 pr-2">{incentive(c) || dash}</td>
                      <td className="break-words py-2 pr-2">{termOf(c) || dash}</td>
                      <td className={cn("py-2 pr-2 text-right", FIGURE)} data-testid={`recommendation-comparable-ner-${c.id}`}>{ner !== null ? money(ner) : dash}</td>
                      {canEdit && <td className="py-1">{actions(c)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Phone: cards. */}
          <ul className="space-y-2 md:hidden" data-testid="recommendation-comparables-cards">
            {rows.map(c => {
              const under = underLine(c), p = rentPsf(c), ner = nerLessFitOut(c);
              return (
                <li key={c.id} className="space-y-1.5 rounded-md border p-2.5" data-testid={`recommendation-comparable-card-${c.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{c.tenant || "Tenant not named"}</p>
                      {c.unit && <p className="break-words text-xs text-muted-foreground">{c.unit}</p>}
                    </div>
                    {actions(c)}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div><dt className="text-muted-foreground">Date</dt><dd>{c.date ? comparableDate(c.date) : dash}</dd></div>
                    <div><dt className="text-muted-foreground">Area</dt><dd>{c.areaSqFt !== null ? <><span className={FIGURE}>{c.areaSqFt.toLocaleString("en-GB")}</span> sq ft</> : dash}</dd></div>
                    <div><dt className="text-muted-foreground">Rent a year</dt><dd className={FIGURE}>{c.rentPa !== null ? money(c.rentPa) : dash}</dd></div>
                    <div><dt className="text-muted-foreground">Per sq ft</dt><dd className={FIGURE}>{p !== null ? psf(p) : dash}</dd></div>
                    <div><dt className="text-muted-foreground">Incentive</dt><dd className="break-words">{incentive(c) || dash}</dd></div>
                    <div><dt className="text-muted-foreground">Term</dt><dd className="break-words">{termOf(c) || dash}</dd></div>
                    <div className="col-span-2"><dt className="text-muted-foreground">Net effective less fit-out</dt><dd className={FIGURE}>{ner !== null ? money(ner) : dash}</dd></div>
                  </dl>
                  {under && <p className="break-words text-xs text-muted-foreground">{under}</p>}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Net effective rent is the headline rent less the rent free, three months' fit-out and the capital contribution, spread over the term. A dash means the rent or the term is missing.</p>
        </>
      )}

      {canEdit && !form && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={full} onClick={() => openForm(null)} data-testid="recommendation-comparable-add">
              <Plus className="mr-1 h-3.5 w-3.5" />Add a comparable
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={full || !!picker?.loading} onClick={openPicker} data-testid="recommendation-comparable-from-scheme">
              {picker?.loading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Add from this scheme
            </Button>
          </div>
          {full && <p className="text-xs text-muted-foreground" data-testid="recommendation-comparables-full">A recommendation holds {COMPARABLES_MAX} comparables at most. Remove one to add another.</p>}
        </div>
      )}

      {canEdit && picker && !picker.loading && (
        <div className="space-y-2 rounded-md border p-3" data-testid="recommendation-candidates">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={MICRO_LABEL}>Lettings on this scheme</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPicker(null)} data-testid="recommendation-candidates-close">Close</Button>
          </div>
          {picker.error ? (
            <p className={cn("text-sm", TONE_BAD)} role="alert" data-testid="recommendation-candidates-error">{picker.error}</p>
          ) : picker.list && picker.list.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="recommendation-candidates-empty">No exchanged or completed lettings with a rent are recorded in the app for this scheme. Add a comparable by hand.</p>
          ) : (
            <ul className="divide-y">
              {(picker.list || []).map(c => {
                const added = isAdded(c);
                return (
                  <li key={c.key} className="flex items-start justify-between gap-3 py-2" data-testid={`recommendation-candidate-${c.key}`}>
                    <div className="min-w-0 text-xs">
                      <p className="break-words text-sm font-medium">{c.tenant || "Tenant not named"}</p>
                      <p className="break-words text-muted-foreground">{[c.unit, c.date ? comparableDate(c.date) : ""].filter(Boolean).join(" · ")}</p>
                      <p className="break-words">
                        {[c.rentPa !== null ? `${money(c.rentPa)} a year` : "", c.areaSqFt ? `${c.areaSqFt.toLocaleString("en-GB")} sq ft` : "", c.termYears !== null ? `${c.termYears} year term` : "",
                          c.rentFreeMonths !== null ? `${c.rentFreeMonths} months rent free` : ""].filter(Boolean).join(" · ")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{c.sourceLabel}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={added || full} onClick={() => addCandidate(c)} aria-label={`Add ${c.tenant || "this letting"} as a comparable`} data-testid={`recommendation-candidate-add-${c.key}`}>
                      {added ? "Added" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Adding one copies its figures into a row. The row does not change if the deal is changed later.</p>
        </div>
      )}

      {canEdit && form && (
        <form className="space-y-3 rounded-md border p-3" onSubmit={e => { e.preventDefault(); e.stopPropagation(); submit(); }} noValidate data-testid="recommendation-comparable-form">
          <p className={MICRO_LABEL}>{form.id ? "Edit the comparable" : "Add a comparable"}</p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map(f => {
              const id = `recommendation-comparable-field-${f.key}`;
              const error = showErrors ? errors[f.key] : undefined;
              const set = (value: string) => setForm(cur => (cur ? { ...cur, values: { ...cur.values, [f.key]: value } } : cur));
              return (
                <div key={f.key} className={cn("min-w-0 space-y-1", f.wide && "sm:col-span-2 lg:col-span-3")}>
                  <Label htmlFor={id} className="text-xs">{f.label}</Label>
                  {f.kind === "longtext" ? (
                    <Textarea id={id} value={form.values[f.key]} onChange={e => set(e.target.value)} className="min-h-[64px]" aria-invalid={!!error} data-testid={id} />
                  ) : (
                    <Input id={id} value={form.values[f.key]} onChange={e => set(e.target.value)} inputMode={f.kind === "text" ? undefined : "decimal"}
                      className={cn(f.kind !== "text" && `text-right ${FIGURE}`)} placeholder={f.kind === "money" ? "£" : f.key === "date" ? "2026-03-25" : undefined} aria-invalid={!!error} data-testid={id} />
                  )}
                  {error ? <p className={cn("text-xs", TONE_BAD)} role="alert">{error}</p> : f.hint ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
                </div>
              );
            })}
          </div>
          {showErrors && nameless && <p className={cn("text-xs", TONE_BAD)} role="alert" data-testid="recommendation-comparable-nameless">Give the tenant or the unit.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setForm(null)} data-testid="recommendation-comparable-cancel">Cancel</Button>
            <Button type="submit" variant="outline" size="sm" data-testid="recommendation-comparable-submit">{form.id ? "Update the row" : "Add the row"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">The row is kept when you save the recommendation.</p>
        </form>
      )}
    </section>
  );
}
