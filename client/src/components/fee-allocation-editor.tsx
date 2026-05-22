import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/format";

export interface FeeAllocationRow {
  agentName: string;
  allocationType: "percentage" | "fixed";
  percentage: number;
  fixedAmount: number;
  isBgpHouse?: boolean;
}

interface Props {
  rows: FeeAllocationRow[];
  onChange: (rows: FeeAllocationRow[]) => void;
  /** Single split-type toggle applied to every row. */
  allocType: "percentage" | "fixed";
  onAllocTypeChange: (t: "percentage" | "fixed") => void;
  /** Total deal fee — drives the calculated-amount preview for % rows. */
  dealFee?: number | null;
  /** BGP staff to pick from. The agentName field stores their display name. */
  bgpAgents: { id: string; name: string }[];
  /** Dot colour per agent name. Optional. */
  colorMap?: Record<string, string>;
  /** Whether to render the "BGP House" line that flags is_bgp_house. */
  showBgpHouseToggle?: boolean;
  className?: string;
}

// Controlled fee-split editor — same shape the deal-detail FeeAllocationCard
// has used for months, but with no internal mutation / query. Drives off
// caller-owned state so the create-deal form can collect allocations
// before the deal row exists. On submit, the parent POSTs the deal first
// then the allocations using the returned id.
//
// Single split-type toggle applies to every row (matches existing UX —
// mixed % + fixed in the same deal was never supported on the deal page).
// is_bgp_house is per-row so you can flag the firm overhead slice.
export function FeeAllocationEditor({
  rows,
  onChange,
  allocType,
  onAllocTypeChange,
  dealFee,
  bgpAgents,
  colorMap,
  showBgpHouseToggle = true,
  className = "",
}: Props) {
  const addRow = () => {
    onChange([
      ...rows,
      { agentName: "", allocationType: allocType, percentage: 0, fixedAmount: 0, isBgpHouse: false },
    ]);
  };

  const removeRow = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, patch: Partial<FeeAllocationRow>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const totalFee = dealFee || 0;
  const totalAllocated = rows.reduce((s, r) => {
    if (allocType === "percentage") return s + (totalFee * (r.percentage || 0)) / 100;
    return s + (r.fixedAmount || 0);
  }, 0);
  const totalPct = rows.reduce((s, r) => s + (r.percentage || 0), 0);

  // BGP staff list excluding already-picked names (so the dropdown doesn't
  // let you double-allocate to the same person on different rows). BGP
  // House lines are exempt — multiple BGP House rows are valid (e.g.
  // separate splits for different cost centres).
  const availableAgents = (rowIdx: number) =>
    bgpAgents.filter(
      (a) => !rows.some((r, i) => i !== rowIdx && !r.isBgpHouse && r.agentName === a.name),
    );

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center rounded-full border p-0.5 gap-0.5">
          {(["percentage", "fixed"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onAllocTypeChange(t)}
              className={`text-[11px] px-2.5 py-1 rounded-full transition-colors ${
                allocType === t
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`fee-editor-type-${t}`}
            >
              {t === "percentage" ? "% Split" : "Fixed £"}
            </button>
          ))}
        </div>
        {totalFee > 0 && (
          <span className="text-[11px] text-muted-foreground">
            Total fee: {formatCurrency(totalFee)}
            {rows.length > 0 && (
              <>
                {" "}
                · Allocated: {formatCurrency(totalAllocated)}
                {allocType === "percentage" && (
                  <span className={totalPct === 100 ? "text-emerald-600 ml-1" : "text-amber-600 ml-1"}>
                    ({totalPct.toFixed(1)}%)
                  </span>
                )}
              </>
            )}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          No fee split set — add at least one agent below.
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2" data-testid={`fee-editor-row-${idx}`}>
              {row.isBgpHouse ? (
                // BGP House rows don't need an agent picker — they're the
                // firm overhead, displayed inline with a static label.
                <div className="flex-1 h-8 px-3 text-xs flex items-center rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 font-medium">
                  BGP House (firm overhead)
                </div>
              ) : (
                <Select
                  value={row.agentName || undefined}
                  onValueChange={(v) => updateRow(idx, { agentName: v })}
                >
                  <SelectTrigger className="h-8 text-xs flex-1" data-testid={`fee-editor-agent-${idx}`}>
                    <SelectValue placeholder="Select BGP agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAgents(idx).map((a) => (
                      <SelectItem key={a.id} value={a.name}>
                        <span className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${colorMap?.[a.name] || "bg-zinc-500"}`} />
                          {a.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {allocType === "percentage" ? (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={row.percentage || ""}
                    onChange={(e) => updateRow(idx, { percentage: Number(e.target.value) })}
                    className="w-20 h-8 text-xs text-right"
                    placeholder="0"
                    step="0.1"
                    data-testid={`fee-editor-pct-${idx}`}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">£</span>
                  <Input
                    type="number"
                    value={row.fixedAmount || ""}
                    onChange={(e) => updateRow(idx, { fixedAmount: Number(e.target.value) })}
                    className="w-28 h-8 text-xs text-right"
                    placeholder="0"
                    data-testid={`fee-editor-amount-${idx}`}
                  />
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeRow(idx)}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                data-testid={`fee-editor-remove-${idx}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          className="h-7 text-xs"
          data-testid="fee-editor-add"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add agent
        </Button>
        {showBgpHouseToggle && !rows.some((r) => r.isBgpHouse) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([
                ...rows,
                { agentName: "BGP House", allocationType: allocType, percentage: 0, fixedAmount: 0, isBgpHouse: true },
              ])
            }
            className="h-7 text-xs bg-amber-50/60 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200"
            data-testid="fee-editor-add-bgp-house"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add BGP House
          </Button>
        )}
      </div>
    </div>
  );
}
