import { useState } from "react";
import { Plus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineNumber } from "@/components/inline-edit";

// Shared "stacked numbers + popover editor" table cell. Extracted from the
// hand-rolled PricingCell / LeaseTermsCell on the Deals board (and the Costs
// cell on the Letting Tracker) which were byte-for-byte the same shell with
// only their row descriptor differing. Keep new money/number cells driven by
// a `rows` config rather than copy-pasting the shell again.
export type NumericRow = {
  key: string;
  label: string;   // full label shown in the popover editor
  short: string;   // compact tag shown in the collapsed cell
  prefix?: string; // e.g. "£"
  suffix?: string; // e.g. "%", " years"
};

function formatValue(val: number | null | undefined, prefix?: string, suffix?: string): string {
  if (val == null) return "—";
  const num = prefix === "£" ? Number(val).toLocaleString("en-GB") : String(val);
  return `${prefix || ""}${num}${suffix || ""}`;
}

export function NumericStackedCell({
  row, rows, title, emptyLabel, onSave, testId, align = "start", popoverWidth = "w-[300px]", labelWidth = "100px",
}: {
  row: Record<string, any>;
  rows: NumericRow[];
  title: string;
  emptyLabel: string;
  onSave: (field: string, value: number | null) => void;
  testId?: string;
  align?: "start" | "end";
  popoverWidth?: string;
  labelWidth?: string;
}) {
  const [open, setOpen] = useState(false);
  const populated = rows.filter(r => row[r.key] != null && row[r.key] !== "");
  const alignClass = align === "end" ? "text-right items-end" : "text-left";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`w-full flex flex-col gap-0.5 px-1 py-0.5 hover:bg-accent rounded text-xs min-w-[120px] ${alignClass}`}
          data-testid={testId}
        >
          {populated.length === 0 ? (
            <span className={`text-muted-foreground text-[11px] flex items-center gap-1 ${align === "end" ? "justify-end" : ""}`}>
              <Plus className="w-3 h-3" /> {emptyLabel}
            </span>
          ) : (
            populated.map(r => (
              <div key={r.key} className={`flex items-center gap-1 truncate ${align === "end" ? "justify-end" : ""}`}>
                <span className="text-[9px] uppercase text-muted-foreground tracking-wide shrink-0">{r.short}</span>
                <span className="truncate font-mono text-[11px]">{formatValue(row[r.key], r.prefix, r.suffix)}</span>
              </div>
            ))
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className={`${popoverWidth} p-3 space-y-2.5`} align={align}>
        <p className="text-xs font-semibold">{title}</p>
        {rows.map(r => (
          <div key={r.key} className="grid items-center gap-2" style={{ gridTemplateColumns: `${labelWidth} 1fr` }}>
            <Label className="text-xs text-muted-foreground">{r.label}</Label>
            <InlineNumber
              value={row[r.key]}
              onSave={(v) => onSave(r.key, v)}
              prefix={r.prefix}
              suffix={r.suffix}
            />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
