import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import type { CrmDeal } from "@shared/schema";

const KANBAN_COLUMNS = [
  { key: "Pipeline", label: "Pipeline", statuses: ["Targeting", "Available", "Marketing", "Speculative", "Live"] },
  { key: "NEG", label: "Under Negotiation", statuses: ["NEG", "Under Negotiation"] },
  { key: "HOTs", label: "HOTs", statuses: ["HOTs"] },
  { key: "SOLs", label: "SOLs", statuses: ["SOLs"] },
  { key: "Exchanged", label: "Exchanged", statuses: ["Exchanged"] },
  { key: "Completed", label: "Completed", statuses: ["Completed"] },
  { key: "Invoiced", label: "Invoiced", statuses: ["Invoiced"] },
];

const DEAL_TYPE_COLORS: Record<string, string> = {
  "Acquisition": "bg-blue-600 text-white",
  "Sale": "bg-red-600 text-white",
  "Leasing": "bg-green-600 text-white",
  "Lease Renewal": "bg-purple-600 text-white",
  "Rent Review": "bg-orange-500 text-white",
  "Investment": "bg-indigo-600 text-white",
  "Lease Advisory": "bg-cyan-600 text-white",
  "Tenant Rep": "bg-rose-600 text-white",
  "Lease Acquisition": "bg-violet-600 text-white",
  "Lease Disposal": "bg-amber-600 text-white",
  "Regear": "bg-teal-600 text-white",
  "Purchase": "bg-emerald-600 text-white",
  "New Letting": "bg-lime-600 text-white",
  "Sub-Letting": "bg-sky-600 text-white",
  "Assignment": "bg-slate-600 text-white",
};

const ASSET_CLASS_COLORS: Record<string, string> = {
  "Retail": "bg-indigo-500",
  "Leisure": "bg-lime-600",
  "Office": "bg-slate-600",
  "Hotel": "bg-yellow-500",
  "Resi": "bg-cyan-500",
  "Mixed Use": "bg-violet-500",
  "Other": "bg-neutral-400",
};

const TEAM_COLORS: Record<string, string> = {
  "Development": "bg-orange-100 text-orange-800",
  "London Leasing": "bg-blue-100 text-blue-800",
  "National Leasing": "bg-emerald-100 text-emerald-800",
  "Investment": "bg-purple-100 text-purple-800",
  "Tenant Rep": "bg-rose-100 text-rose-800",
  "Lease Advisory": "bg-cyan-100 text-cyan-800",
  "Office / Corporate": "bg-slate-100 text-slate-800",
  "Landsec": "bg-sky-100 text-sky-800",
};

function formatFee(fee: number | null | undefined): string {
  if (fee == null) return "";
  return `£${Number(fee).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

interface DealKanbanProps {
  deals: CrmDeal[];
  propertyMap: Map<string, string>;
}

export function DealKanban({ deals, propertyMap }: DealKanbanProps) {
  // Group deals into columns
  const columns = KANBAN_COLUMNS.map((col) => {
    const columnDeals = deals.filter((d) =>
      col.statuses.includes(d.status || "")
    );
    const totalFee = columnDeals.reduce(
      (sum, d) => sum + (d.fee ? Number(d.fee) : 0),
      0
    );
    return { ...col, deals: columnDeals, totalFee };
  });

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 px-1 min-h-[400px]">
      {columns.map((col) => (
        <div
          key={col.key}
          className="flex flex-col min-w-[260px] max-w-[300px] w-[280px] shrink-0 rounded-lg bg-muted/50 border"
        >
          {/* Column header */}
          <div className="px-3 py-2.5 border-b bg-muted/80 rounded-t-lg">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-foreground truncate">
                {col.label}
              </h3>
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-5 shrink-0"
              >
                {col.deals.length}
              </Badge>
            </div>
            {col.totalFee > 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {formatFee(col.totalFee)} total
              </p>
            )}
          </div>

          {/* Scrollable card list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[calc(100vh-280px)]">
            {col.deals.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                No deals
              </p>
            )}
            {col.deals.map((deal) => {
              const propName = deal.propertyId
                ? propertyMap.get(deal.propertyId) || ""
                : "";
              const displayName = propName || deal.name;
              const agents = Array.isArray(deal.internalAgent)
                ? deal.internalAgent.join(", ")
                : deal.internalAgent || "";
              const teams: string[] = Array.isArray(deal.team)
                ? deal.team
                : deal.team
                  ? [deal.team]
                  : [];

              return (
                <Link key={deal.id} href={`/deals/${deal.id}`}>
                  <div className="bg-background rounded-md border shadow-sm p-3 space-y-2 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
                    {/* Name */}
                    <p className="text-sm font-semibold leading-tight truncate group-hover:text-primary transition-colors">
                      {displayName}
                    </p>

                    {/* Deal type badge + asset class dot */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {deal.dealType && (
                        <Badge
                          className={`text-[9px] px-1.5 py-0 h-4 ${DEAL_TYPE_COLORS[deal.dealType] || "bg-zinc-500 text-white"}`}
                        >
                          {deal.dealType}
                        </Badge>
                      )}
                      {deal.assetClass && (
                        <span
                          className={`inline-block w-2 h-2 rounded-full shrink-0 ${ASSET_CLASS_COLORS[deal.assetClass] || "bg-neutral-400"}`}
                          title={deal.assetClass}
                        />
                      )}
                    </div>

                    {/* Fee */}
                    {deal.fee != null && Number(deal.fee) > 0 && (
                      <p className="text-xs font-medium text-foreground">
                        {formatFee(deal.fee)}
                      </p>
                    )}

                    {/* Agent */}
                    {agents && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {agents}
                      </p>
                    )}

                    {/* Team badges */}
                    {teams.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {teams.map((t) => (
                          <Badge
                            key={t}
                            variant="outline"
                            className={`text-[9px] px-1.5 py-0 h-4 border-0 ${TEAM_COLORS[t] || "bg-muted text-muted-foreground"}`}
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Column footer with total */}
          {col.deals.length > 0 && (
            <div className="px-3 py-2 border-t bg-muted/60 rounded-b-lg">
              <p className="text-[10px] text-muted-foreground">
                {col.deals.length} deal{col.deals.length !== 1 ? "s" : ""}
                {col.totalFee > 0 && <span className="ml-1">· {formatFee(col.totalFee)}</span>}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
