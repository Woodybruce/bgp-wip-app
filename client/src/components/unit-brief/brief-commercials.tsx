// The brief's commercials (shared/unit-brief.ts BRIEF_COMMERCIAL_FIELDS):
// quoting rent, ERV, the net effective rent floor, the incentive ceilings,
// term, break and the occupancy costs. The dialog owns the draft and the
// save; this renders the fields and offers what the unit already holds.
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { BRIEF_COMMERCIAL_FIELDS, parseMoney, type BriefCommercials } from "@shared/unit-brief";

export type CommercialsDraft = Record<keyof BriefCommercials, string>;

export function commercialsToDraft(c: BriefCommercials | null | undefined): CommercialsDraft {
  const d = {} as CommercialsDraft;
  for (const f of BRIEF_COMMERCIAL_FIELDS) {
    const v = c?.[f.key];
    d[f.key] = v === null || v === undefined ? "" : String(v);
  }
  return d;
}

// Fields whose text cannot be read as a number, by label.
export function commercialsInvalid(d: CommercialsDraft): string[] {
  return BRIEF_COMMERCIAL_FIELDS
    .filter(f => f.kind !== "text" && f.kind !== "longtext")
    .filter(f => { const n = parseMoney(f.kind === "percent" ? d[f.key].replace(/%/g, "") : d[f.key]); return n === undefined || (n !== null && n < 0); })
    .map(f => f.label);
}

const show = (kind: string, v: number) => kind === "money" ? formatCurrency(v) : kind === "percent" ? `${v}%` : String(v);

export function BriefCommercialsForm({ draft, onChange, defaults, readOnly }: {
  draft: CommercialsDraft;
  onChange: (key: keyof BriefCommercials, value: string) => void;
  defaults: Partial<BriefCommercials>;
  readOnly: boolean;
}) {
  const hasAny = BRIEF_COMMERCIAL_FIELDS.some(f => draft[f.key].trim());
  if (readOnly && !hasAny) return <p className="text-sm text-muted-foreground" data-testid="brief-commercials-empty">No commercials have been entered yet.</p>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-2.5" data-testid="brief-commercials">
      {BRIEF_COMMERCIAL_FIELDS.map(f => {
        const value = draft[f.key];
        const numeric = f.kind !== "text" && f.kind !== "longtext";
        const parsed = numeric ? parseMoney(f.kind === "percent" ? value.replace(/%/g, "") : value) : null;
        const bad = numeric && (parsed === undefined || (parsed !== null && parsed !== undefined && parsed < 0));
        const fromUnit = defaults[f.key];
        const offer = !readOnly && !value.trim() && fromUnit !== null && fromUnit !== undefined && fromUnit !== "";
        return (
          <label key={f.key} className={`block ${f.kind === "longtext" ? "sm:col-span-2 lg:col-span-3" : ""}`}>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{f.label}{f.hint ? <span className="font-normal normal-case tracking-normal"> · {f.hint}</span> : null}</span>
            {f.kind === "longtext" ? (
              <Textarea rows={2} value={value} disabled={readOnly} onChange={e => onChange(f.key, e.target.value)} className="text-sm mt-0.5" data-testid={`brief-commercial-${f.key}`} />
            ) : (
              <Input
                value={value} disabled={readOnly} onChange={e => onChange(f.key, e.target.value)}
                inputMode={numeric ? "decimal" : undefined}
                className={`h-9 text-sm mt-0.5 ${numeric ? "font-mono tabular-nums" : ""} ${bad ? "border-destructive" : ""}`}
                aria-invalid={bad || undefined}
                data-testid={`brief-commercial-${f.key}`}
              />
            )}
            {bad && <span className="text-[11px] text-destructive">Use a number, for example 95000 or 95k.</span>}
            {!bad && numeric && parsed !== null && parsed !== undefined && (f.kind === "money" ? parsed >= 1000 || value.trim() !== String(parsed) : value.trim() !== String(parsed)) && (
              <span className="text-[11px] text-muted-foreground font-mono tabular-nums">{show(f.kind, parsed)}</span>
            )}
            {offer && (
              <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground" onClick={() => onChange(f.key, String(fromUnit))} data-testid={`brief-commercial-use-${f.key}`}>
                Use the unit's: {typeof fromUnit === "number" ? show(f.kind, fromUnit) : String(fromUnit)}
              </Button>
            )}
          </label>
        );
      })}
    </div>
  );
}
