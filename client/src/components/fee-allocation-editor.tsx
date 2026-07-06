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

// BGP House percentage of total fee. Fixed firm policy — every deal
// takes 15% off the top before agents split the remainder. Change here
// if the firm rate ever changes.
export const BGP_HOUSE_PCT = 15;

// Controlled fee-split editor — same shape the deal-detail FeeAllocationCard
// has used for months, but with no internal mutation / query. Drives off
// caller-owned state so the create-deal form can collect allocations
// before the deal row exists. On submit, the parent POSTs the deal first
// then the allocations using the returned id.
//
// BGP House row is ALWAYS present at 15% of total fee — locked, not
// removable, no manual "add" button. Agents split the remaining 85%.
// is_bgp_house is per-row so the server / commission calc can find the
// firm overhead slice without name-matching.
export function FeeAllocationEditor({
  rows,
  onChange,
  allocType,
  onAllocTypeChange,
  dealFee,
  bgpAgents,
  colorMap,
  showBgpHouseToggle: _ignored, // kept for back-compat but BGP House is now always auto-added
  className = "",
}: Props) {
  // Ensure exactly one BGP House row is always present. Runs on every
  // render so the row is materialised even if the parent forgot to
  // include it on initial state. Agents only ever interact with the
  // non-BGP-House rows.
  React.useEffect(() => {
    const hasBgp = rows.some((r) => r.isBgpHouse);
    if (!hasBgp) {
      onChange([
        ...rows,
        {
          agentName: "BGP House",
          allocationType: allocType,
          percentage: BGP_HOUSE_PCT,
          fixedAmount: (dealFee || 0) * BGP_HOUSE_PCT / 100,
          isBgpHouse: true,
        },
      ]);
      return;
    }
    // Keep the BGP House row canonical in BOTH directions. The previous
    // version only synced fixedAmount when allocType==='fixed', so
    // toggling £ → % left the BGP House percentage at whatever stale
    // value it had been initialised with — never re-set to BGP_HOUSE_PCT.
    const bgpRow = rows.find((r) => r.isBgpHouse)!;
    const expectedFixed = (dealFee || 0) * BGP_HOUSE_PCT / 100;
    const fixedStale = Math.abs((bgpRow.fixedAmount || 0) - expectedFixed) > 0.5;
    const pctStale = Math.abs((bgpRow.percentage || 0) - BGP_HOUSE_PCT) > 0.01;
    if (fixedStale || pctStale) {
      onChange(rows.map((r) => r.isBgpHouse
        ? { ...r, fixedAmount: expectedFixed, percentage: BGP_HOUSE_PCT, allocationType: allocType }
        : r
      ));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, dealFee, allocType]);

  const addRow = () => {
    // Append a fresh AGENT row (not BGP House — that's auto-managed).
    onChange([
      ...rows,
      { agentName: "", allocationType: allocType, percentage: 0, fixedAmount: 0, isBgpHouse: false },
    ]);
  };

  const removeRow = (idx: number) => {
    const r = rows[idx];
    if (r?.isBgpHouse) return; // BGP House is locked
    onChange(rows.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, patch: Partial<FeeAllocationRow>) => {
    const r = rows[idx];
    if (r?.isBgpHouse) return; // BGP House values are policy-driven, not editable
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const totalFee = dealFee || 0;
  const totalAllocated = rows.reduce((s, r) => {
    if (allocType === "percentage") return s + (totalFee * (r.percentage || 0)) / 100;
    return s + (r.fixedAmount || 0);
  }, 0);
  const totalPct = rows.reduce((s, r) => s + (r.percentage || 0), 0);
  // Agents-only totals — BGP House contributes 15% (locked), agents
  // must contribute the remaining 85%.
  const agentRows = rows.filter((r) => !r.isBgpHouse);
  const agentPctTotal = agentRows.reduce((s, r) => s + (r.percentage || 0), 0);
  const agentPctTarget = 100 - BGP_HOUSE_PCT; // 85
  const agentPctIsBalanced = Math.abs(agentPctTotal - agentPctTarget) < 0.01;

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
            {allocType === "percentage" && (
              <span className="ml-2">
                · Agents:
                <span className={agentPctIsBalanced ? "text-emerald-600 ml-1" : "text-amber-600 ml-1"}>
                  {agentPctTotal.toFixed(1)}% / {agentPctTarget}%
                </span>
              </span>
            )}
          </span>
        )}
      </div>
      {/* Firm-policy reminder so Layla knows where the 15% goes. */}
      <p className="text-[10px] text-muted-foreground">
        BGP House takes {BGP_HOUSE_PCT}% off the top automatically. Agents share the remaining {100 - BGP_HOUSE_PCT}%.
      </p>

      {agentRows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          Add the agents earning on this deal — BGP House is already taking {BGP_HOUSE_PCT}%.
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
                    step="any"
                    disabled={row.isBgpHouse}
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
                    step="any"
                    disabled={row.isBgpHouse}
                    data-testid={`fee-editor-amount-${idx}`}
                  />
                </div>
              )}
              {/* BGP House can't be removed — firm policy locks the
                  15% slice on every deal. Render an empty slot to keep
                  rows aligned. */}
              {row.isBgpHouse ? (
                <span className="w-8" aria-hidden="true" />
              ) : (
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
              )}
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
        {/* Equal-split helper: distributes the 85% pool evenly across
            agent rows. Useful for the 33.3% / 33.3% / 33.3% case Layla
            writes in her WIP template. Only enabled in % mode. */}
        {allocType === "percentage" && agentRows.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              // Round each agent to 2dp; the last agent gets the remainder
              // so the total lands exactly on agentPctTarget (avoids the
              // 33.33×3 = 99.99 / 100.01 rounding drift that triggered the
              // amber 'not balanced' warning).
              const n = agentRows.length;
              const each = Math.round((agentPctTarget / n) * 100) / 100;
              const remainder = Math.round((agentPctTarget - each * (n - 1)) * 100) / 100;
              let assigned = 0;
              onChange(rows.map((r) => {
                if (r.isBgpHouse) return r;
                assigned += 1;
                return { ...r, percentage: assigned === n ? remainder : each };
              }));
            }}
            className="h-7 text-xs text-muted-foreground"
            data-testid="fee-editor-equal-split"
          >
            Equal split (each {agentRows.length > 0 ? (agentPctTarget / agentRows.length).toFixed(1) : 0}%)
          </Button>
        )}
      </div>
    </div>
  );
}
