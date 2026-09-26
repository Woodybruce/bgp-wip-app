// Account deals board (Delivery 3) — the landlord workspace's real deal
// list: paginated rows backed by the account resolver via
// GET /api/accounts/:id/deals, not the old LIMIT 20 profile query.
// Instructions and related market activity (tenant-rep deals at the
// account's centres) are distinguished by badge — related activity never
// reads as a client instruction. Fees render only when the server marks
// them visible (staff); completed deals stay a filter away, never deleted.
// Desktop renders a table; phone renders stacked cards.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, ChevronLeft, ChevronRight } from "lucide-react";
import { DEAL_STATUS_LABELS, DEAL_STATUS_COLORS, legacyToCode } from "@shared/deal-status";

interface AccountDealRow {
  dealId: string;
  name: string;
  bucket: "instruction" | "related";
  activityKind: "tenant_rep" | "investment" | "other" | null;
  partyEntityId: string | null;
  propertyId: string | null;
  propertyName: string | null;
  unitName: string | null;
  counterparty: string | null;
  service: string | null;
  status: string | null;
  stage: string | null;
  team: string[];
  lastActivityAt: string | null;
  instructedAt: string | null;
  targetDate: string | null;
  completedAt: string | null;
  fee?: number | null;
  nextAction: { taskId: string; title: string; ownerName: string | null; dueDate: string | null } | null;
}

interface AccountDealsResponse {
  deals: AccountDealRow[];
  total: number;
  completedTotal: number;
  page: number;
  pageSize: number;
  feesVisible: boolean;
  entities: Array<{ companyId: string; name: string }>;
  properties: Array<{ propertyId: string; name: string }>;
  services: string[];
  stages: string[];
  people: string[];
}

interface Filters {
  bucket: string;
  propertyId: string;
  entityId: string;
  service: string;
  stage: string;
  person: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { bucket: "all", propertyId: "", entityId: "", service: "", stage: "", person: "", from: "", to: "" };

function relDate(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatusChip({ status }: { status: string | null }) {
  const code = legacyToCode(status);
  if (!code) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={`text-[10px] border-transparent ${DEAL_STATUS_COLORS[code]}`}>
      {DEAL_STATUS_LABELS[code]}
    </Badge>
  );
}

function DealBadges({ d }: { d: AccountDealRow }) {
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {d.bucket === "related" ? (
        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
          Related activity{d.activityKind === "tenant_rep" ? " · tenant rep" : d.activityKind === "investment" ? " · investment" : ""}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px]">Instruction</Badge>
      )}
      {d.service && <span className="text-[10px] text-muted-foreground">{d.service}</span>}
    </span>
  );
}

function NextActionCell({ d }: { d: AccountDealRow }) {
  if (!d.nextAction) return <span className="text-muted-foreground">—</span>;
  const na = d.nextAction;
  return (
    <span className="block min-w-0">
      <span className="block truncate">{na.title}</span>
      <span className="block text-[10px] text-muted-foreground truncate">
        {[na.ownerName, na.dueDate ? `due ${new Date(na.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : null].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

export function AccountDealsBoard({ companyId }: { companyId: string }) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const set = (patch: Partial<Filters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1); };

  const params = new URLSearchParams({ page: String(page), pageSize: "10" });
  for (const [k, v] of Object.entries(filters)) if (v && v !== "all") params.set(k, v);

  const { data, isLoading, isError } = useQuery<AccountDealsResponse>({
    queryKey: ["/api/accounts", companyId, "deals", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${companyId}/deals?${params}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;
  const filtersActive = Object.entries(filters).some(([k, v]) => v && v !== "all");

  return (
    <Card data-testid={`account-deals-board-${companyId}`}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Briefcase className="w-3.5 h-3.5" /> Deals &amp; activity
          {data && <Badge variant="outline" className="text-[11px] font-mono tabular-nums">{data.total}</Badge>}
          {data && data.completedTotal > 0 && (
            <span className="text-[10px] text-muted-foreground normal-case font-normal">
              {data.completedTotal} completed — filter by stage to see them
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-2">
        {/* Filters — options arrive with the deals payload, so the row never
            needs a second round trip. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill active={filters.bucket === "all"} onClick={() => set({ bucket: "all" })} data-testid="account-deals-bucket-all">All</Pill>
          <Pill active={filters.bucket === "instruction"} onClick={() => set({ bucket: "instruction" })} data-testid="account-deals-bucket-instruction">Instructions</Pill>
          <Pill active={filters.bucket === "related"} onClick={() => set({ bucket: "related" })} data-testid="account-deals-bucket-related">Related activity</Pill>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={filters.propertyId || "all"} onValueChange={v => set({ propertyId: v === "all" ? "" : v })}>
              <SelectTrigger className="h-7 w-auto min-w-[8rem] text-[11px]"><SelectValue placeholder="Property" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {data.properties.map(p => <SelectItem key={p.propertyId} value={p.propertyId}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.entityId || "all"} onValueChange={v => set({ entityId: v === "all" ? "" : v })}>
              <SelectTrigger className="h-7 w-auto min-w-[8rem] text-[11px]"><SelectValue placeholder="Entity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All entities</SelectItem>
                {data.entities.map(e => <SelectItem key={e.companyId} value={e.companyId}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {data.services.length > 0 && (
              <Select value={filters.service || "all"} onValueChange={v => set({ service: v === "all" ? "" : v })}>
                <SelectTrigger className="h-7 w-auto min-w-[7rem] text-[11px]"><SelectValue placeholder="Service" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {data.services.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {data.stages.length > 0 && (
              <Select value={filters.stage || "all"} onValueChange={v => set({ stage: v === "all" ? "" : v })}>
                <SelectTrigger className="h-7 w-auto min-w-[7rem] text-[11px]"><SelectValue placeholder="Stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {data.stages.map(s => <SelectItem key={s} value={s}>{DEAL_STATUS_LABELS[legacyToCode(s) as keyof typeof DEAL_STATUS_LABELS] ?? s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {data.people.length > 0 && (
              <Select value={filters.person || "all"} onValueChange={v => set({ person: v === "all" ? "" : v })}>
                <SelectTrigger className="h-7 w-auto min-w-[7rem] text-[11px]"><SelectValue placeholder="BGP person" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Anyone</SelectItem>
                  {data.people.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Input type="date" value={filters.from} onChange={e => set({ from: e.target.value })} className="h-7 w-auto text-[11px]" aria-label="Active from" />
            <Input type="date" value={filters.to} onChange={e => set({ to: e.target.value })} className="h-7 w-auto text-[11px]" aria-label="Active to" />
            {filtersActive && (
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</Button>
            )}
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground italic">Loading deals…</p>}
        {isError && <p className="text-sm text-muted-foreground italic">Couldn't load the deal list — try again.</p>}
        {data && data.deals.length === 0 && (
          <p className="text-sm text-muted-foreground italic">{filtersActive ? "No deals match these filters." : "No deals on this account yet."}</p>
        )}

        {data && data.deals.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/40">
                    <th className="py-1 pr-2 font-medium">Property / unit</th>
                    <th className="py-1 pr-2 font-medium">Counterparty</th>
                    <th className="py-1 pr-2 font-medium">Instruction / service</th>
                    <th className="py-1 pr-2 font-medium">Stage</th>
                    <th className="py-1 pr-2 font-medium">BGP team</th>
                    <th className="py-1 pr-2 font-medium">Last activity</th>
                    <th className="py-1 pr-2 font-medium">Next action</th>
                    {data.feesVisible && <th className="py-1 font-medium text-right">Fee</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.deals.map(d => (
                    <tr key={d.dealId} className="border-b border-border/20 last:border-0 hover:bg-muted/40" data-testid={`account-deal-row-${d.dealId}`}>
                      <td className="py-1.5 pr-2 max-w-[12rem]">
                        {d.propertyId ? (
                          <Link href={`/properties/${d.propertyId}`} className="font-medium hover:underline block truncate">{d.propertyName || "—"}</Link>
                        ) : <span className="text-muted-foreground">—</span>}
                        {d.unitName && <span className="block text-[10px] text-muted-foreground truncate">{d.unitName}</span>}
                        <Link href={`/deals?id=${d.dealId}`} className="block text-[10px] text-primary hover:underline truncate">{d.name}</Link>
                      </td>
                      <td className="py-1.5 pr-2 max-w-[10rem] truncate">{d.counterparty || "—"}</td>
                      <td className="py-1.5 pr-2"><DealBadges d={d} /></td>
                      <td className="py-1.5 pr-2"><StatusChip status={d.status} /></td>
                      <td className="py-1.5 pr-2 max-w-[9rem] truncate" title={d.team.join(", ")}>{d.team.join(", ") || "—"}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">{relDate(d.lastActivityAt)}</td>
                      <td className="py-1.5 pr-2 max-w-[12rem]"><NextActionCell d={d} /></td>
                      {data.feesVisible && (
                        <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                          {d.fee != null ? `£${Number(d.fee).toLocaleString()}` : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone: stacked cards, no wide table */}
            <div className="md:hidden space-y-1.5">
              {data.deals.map(d => (
                <div key={d.dealId} className="rounded border border-border/60 p-2 space-y-1" data-testid={`account-deal-card-${d.dealId}`}>
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/deals?id=${d.dealId}`} className="text-xs font-medium hover:underline truncate">{d.name}</Link>
                    <StatusChip status={d.status} />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <DealBadges d={d} />
                    {d.propertyId && (
                      <Link href={`/properties/${d.propertyId}`} className="text-[10px] text-muted-foreground hover:underline">
                        {d.propertyName}{d.unitName ? ` · ${d.unitName}` : ""}
                      </Link>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {d.counterparty && <span>{d.counterparty} · </span>}
                    {relDate(d.lastActivityAt)}
                    {d.team.length > 0 && <span> · {d.team.join(", ")}</span>}
                    {data.feesVisible && d.fee != null && <span> · £{Number(d.fee).toLocaleString()}</span>}
                  </div>
                  {d.nextAction && (
                    <div className="text-[11px]">
                      <span className="text-foreground">{d.nextAction.title}</span>
                      <span className="text-muted-foreground">
                        {" "}— {[d.nextAction.ownerName, d.nextAction.dueDate ? `due ${new Date(d.nextAction.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Pagination — totals come from the server over the filtered
                set, so they're stable regardless of page size. */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {data.total === 0 ? "" : `Showing ${from}–${to} of ${data.total}`}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="account-deals-prev">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-[10px] text-muted-foreground tabular-nums">{page} / {totalPages}</span>
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="account-deals-next">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
