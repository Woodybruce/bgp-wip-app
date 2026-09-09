import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export type TenancyImportCandidate = {
  id: string;
  unitNumber: string | null;
  tenantName: string | null;
  tradingName: string | null;
  floorLevel: string | null;
  premises: string | null;
  values: Record<string, unknown>;
};

export type TenancyImportReviewRow = {
  sourceRow: number;
  unitNumber: string | null;
  floorLevel: string | null;
  premises: string | null;
  reason: "missing_identity" | "ambiguous_identity" | "different_facts";
  existingIds: string[];
  differingFields: string[];
  incomingValues?: Record<string, unknown>;
  candidates?: TenancyImportCandidate[];
};

const reasons = {
  missing_identity: "The file needs a unit or demise reference.",
  ambiguous_identity: "More than one saved entry could match this unit.",
  different_facts: "The file differs from information already saved.",
};
const labels: Record<string, string> = {
  unit_number: "Unit", tenant_name: "Tenant", trading_name: "Trading name", premises: "Demise reference",
  floor_level: "Level", passing_rent_pa: "Passing rent per year", erv_pa: "ERV per year",
  lease_start: "Lease start", lease_expiry: "Lease expiry", break_date: "Tenant break",
  landlord_break_date: "Landlord break", next_review_date: "Next rent review", nia_sqft: "NIA (sq ft)", gia_sqft: "GIA (sq ft)",
};
const fieldLabel = (field: string) => labels[field] || field.replace(/_/g, " ").replace(/^./, value => value.toUpperCase());
function show(value: unknown, field: string): string {
  if (value == null || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ") || "Not recorded";
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(value))) {
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
    if (!isNaN(date.getTime())) return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  if (/rent_pa$|erv_pa$|rateable_value|service_charge|insurance|deposit_held|arrears_balance/.test(field) && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(Number(value));
  }
  return String(value);
}

export function TenancyImportReview({ rows, onSelectCandidate }: {
  rows: TenancyImportReviewRow[];
  onSelectCandidate?: (candidate: TenancyImportCandidate) => void;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows]);
  if (!rows.length) return null;
  const pageSize = 10;
  const visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-3 text-sm" aria-label="Import entries needing review" data-testid="tenancy-import-review">
      <div>
        <h3 className="font-semibold">Import review · <span className="font-mono tabular-nums">{rows.length}</span> entries</h3>
        <p className="text-muted-foreground mt-1">These entries were left unchanged. Compare the file with the saved information before editing the schedule.</p>
      </div>
      <div className="max-h-[32rem] overflow-y-auto space-y-2">
        {visibleRows.map((row, index) => (
          <details key={`${row.sourceRow}-${index}`} className="rounded-lg border border-border p-3" open={rows.length === 1}>
            <summary className="cursor-pointer min-h-11 sm:min-h-0">
              <span className="font-semibold">{row.unitNumber || row.premises || "Missing unit reference"}</span>
              <span className="text-muted-foreground"> · File row <span className="font-mono tabular-nums">{row.sourceRow}</span>{row.floorLevel ? ` · ${row.floorLevel}` : ""}</span>
              <span className="block text-muted-foreground mt-1">{reasons[row.reason]}</span>
            </summary>
            <div className="mt-3 space-y-3">
              {row.reason === "missing_identity" && <p>Add the unit reference to this file row, then import it again.</p>}
              {(row.candidates || []).map((candidate, candidateIndex) => {
                const compared = row.differingFields.length ? row.differingFields : Object.keys(row.incomingValues || {});
                return (
                  <div key={candidate.id} className="rounded-lg bg-muted/40 p-3 space-y-2">
                    <div className="flex flex-wrap justify-between gap-2 items-start">
                      <div className="min-w-0 break-words">
                        <p className="font-semibold">Saved entry {candidateIndex + 1}: {candidate.unitNumber || candidate.premises || "Unit"}</p>
                        <p className="text-muted-foreground">{[candidate.tradingName || candidate.tenantName, candidate.floorLevel, candidate.premises].filter(Boolean).join(" · ") || "No tenant or level recorded"}</p>
                      </div>
                      {onSelectCandidate && <Button type="button" variant="outline" size="sm" onClick={() => onSelectCandidate(candidate)}>Find this unit</Button>}
                    </div>
                    {compared.map(field => (
                      <div key={field} className="border-t border-border pt-2">
                        <p className="text-xs font-semibold text-muted-foreground">{fieldLabel(field)}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1 min-w-0">
                          <p className="min-w-0 break-words whitespace-pre-wrap"><span className="text-muted-foreground">File: </span><span className="tabular-nums">{show(row.incomingValues?.[field], field)}</span></p>
                          <p className="min-w-0 break-words whitespace-pre-wrap"><span className="text-muted-foreground">Saved: </span><span className="tabular-nums">{show(candidate.values[field], field)}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>
      {rows.length > pageSize && <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">Entries <span className="font-mono tabular-nums">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)}</span> of <span className="font-mono tabular-nums">{rows.length}</span></p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</Button>
          <Button type="button" variant="outline" size="sm" disabled={(page + 1) * pageSize >= rows.length} onClick={() => setPage(value => value + 1)}>Next</Button>
        </div>
      </div>}
    </section>
  );
}
