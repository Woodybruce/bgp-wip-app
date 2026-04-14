import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck, ShieldAlert, Clock, AlertCircle, CheckCircle2,
  Loader2, FileText, Search, Building2, Sun, Handshake, ChevronRight,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface BoardRow {
  id: string;
  name: string;
  kyc_status: string | null;
  kyc_checked_at: string | null;
  kyc_approved_by: string | null;
  kyc_expires_at: string | null;
  aml_risk_level: string | null;
  aml_pep_status: string | null;
  aml_checklist: any;
  companies_house_number: string | null;
  doc_count: number;
  deals: Array<{ id: string; name: string; role: string }> | null;
  column: "missing" | "in_review" | "approved" | "expired" | "rejected";
  isExpired: boolean;
}

interface BoardData {
  counts: {
    missing: number; in_review: number; approved: number; expired: number; rejected: number; total: number;
  };
  rows: BoardRow[];
}

const COLUMNS: Array<{
  key: BoardRow["column"];
  label: string;
  tone: string;
  icon: any;
  description: string;
}> = [
  { key: "missing", label: "Documents pending", tone: "border-amber-300 bg-amber-50/30", icon: AlertCircle, description: "No KYC started — needs uploads" },
  { key: "in_review", label: "Under review", tone: "border-blue-300 bg-blue-50/30", icon: Clock, description: "Docs uploaded, awaiting MLRO sign-off" },
  { key: "approved", label: "Approved", tone: "border-emerald-400 bg-emerald-50/40", icon: CheckCircle2, description: "AML clean — invoice unlocked" },
  { key: "expired", label: "Expired — re-check", tone: "border-orange-400 bg-orange-50/40", icon: Clock, description: "Past 12-month review date" },
  { key: "rejected", label: "Rejected", tone: "border-red-300 bg-red-50/40", icon: ShieldAlert, description: "Cannot proceed" },
];

function CardItem({ row }: { row: BoardRow }) {
  const dealCount = row.deals?.length || 0;
  const checklistTicked = row.aml_checklist
    ? Object.values(row.aml_checklist as Record<string, { ticked?: boolean }>).filter(v => v?.ticked).length
    : 0;
  return (
    <Link
      href={`/companies/${row.id}`}
      className="block bg-white border border-border/60 rounded-lg p-3 hover:shadow-sm hover:border-primary/40 transition-all"
      data-testid={`board-card-${row.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="font-semibold text-sm truncate">{row.name}</span>
        </div>
        {row.column === "approved" && (
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" data-testid={`board-tick-${row.id}`} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {row.aml_risk_level && (
          <Badge variant="outline" className={`text-[10px] ${
            row.aml_risk_level === "critical" ? "border-red-300 text-red-700" :
            row.aml_risk_level === "high" ? "border-orange-300 text-orange-700" :
            row.aml_risk_level === "medium" ? "border-amber-300 text-amber-700" :
            "border-emerald-300 text-emerald-700"
          }`}>
            {row.aml_risk_level} risk
          </Badge>
        )}
        {row.aml_pep_status && row.aml_pep_status !== "clear" && (
          <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700">PEP</Badge>
        )}
        {row.companies_house_number && (
          <Badge variant="outline" className="text-[10px]">CH {row.companies_house_number}</Badge>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{row.doc_count} doc{row.doc_count === 1 ? "" : "s"}</span>
        <span>{checklistTicked}/12 checked</span>
        {dealCount > 0 && (
          <span>· {dealCount} deal{dealCount === 1 ? "" : "s"}</span>
        )}
      </div>
      {row.kyc_expires_at && (
        <div className={`text-[11px] mt-1 ${row.isExpired ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
          {row.isExpired ? "Re-check overdue" : "Re-check"} {new Date(row.kyc_expires_at).toLocaleDateString("en-GB")}
        </div>
      )}
      {row.deals && row.deals.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/40 flex flex-wrap gap-1">
          {row.deals.slice(0, 3).map((d, i) => (
            <span key={`${d.id}-${i}`} className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded uppercase">
              {d.role}
            </span>
          ))}
          {row.deals.length > 3 && <span className="text-[10px] text-muted-foreground">+{row.deals.length - 3}</span>}
        </div>
      )}
    </Link>
  );
}

interface DealRow {
  id: string;
  name: string;
  status: string | null;
  dealType: string | null;
  fee: number | null;
  propertyName: string | null;
  counterparties: Array<{ id: string; name: string; role: string; status: string | null; expiresAt: string | null; isApproved: boolean; isExpired: boolean }>;
  column: "not_started" | "in_progress" | "ready_to_invoice";
  canInvoice: boolean;
}

interface DealBoardData {
  counts: { not_started: number; in_progress: number; ready_to_invoice: number; total: number };
  rows: DealRow[];
}

export default function ComplianceBoard() {
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<BoardData>({
    queryKey: ["/api/kyc/board"],
    queryFn: async () => {
      const res = await fetch("/api/kyc/board", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: dealsData, isLoading: dealsLoading } = useQuery<DealBoardData>({
    queryKey: ["/api/kyc/board/deals"],
    queryFn: async () => {
      const res = await fetch("/api/kyc/board/deals", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load deals");
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter(r => {
      if (q && !(r.name.toLowerCase().includes(q) || (r.companies_house_number || "").includes(q))) return false;
      if (riskFilter && r.aml_risk_level !== riskFilter) return false;
      return true;
    });
  }, [data, search, riskFilter]);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  );
  if (error) return (
    <div className="p-6 text-red-600">Failed to load compliance board.</div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Compliance Board
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AML status for every counterparty on a live deal · {data?.counts.total || 0} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company or CH number..."
              className="h-9 pl-8 w-64 text-sm"
              data-testid="input-board-search"
            />
          </div>
          <select
            value={riskFilter || ""}
            onChange={(e) => setRiskFilter(e.target.value || null)}
            className="h-9 text-sm border border-input bg-background rounded-md px-2"
            data-testid="select-board-risk-filter"
          >
            <option value="">All risk levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <Tabs defaultValue="counterparties">
        <TabsList>
          <TabsTrigger value="counterparties" data-testid="tab-counterparties">
            <Building2 className="w-3.5 h-3.5 mr-1.5" />
            Counterparties ({data?.counts.total || 0})
          </TabsTrigger>
          <TabsTrigger value="deals" data-testid="tab-deals">
            <Handshake className="w-3.5 h-3.5 mr-1.5" />
            Live deals ({dealsData?.counts.total || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="counterparties" className="mt-4">
          {/* Summary row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {COLUMNS.map(col => {
              const count = data?.counts[col.key] || 0;
              const Icon = col.icon;
              return (
                <Card key={col.key} className={`border-l-4 ${col.tone}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide">{col.label}</span>
                    </div>
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-[10px] text-muted-foreground">{col.description}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Kanban */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {COLUMNS.map(col => {
              const items = filtered.filter(r => r.column === col.key);
              return (
                <div key={col.key} className={`rounded-lg border-2 ${col.tone} p-2 min-h-[400px]`} data-testid={`board-column-${col.key}`}>
                  <div className="flex items-center justify-between px-1 py-1.5 mb-2">
                    <h3 className="font-semibold text-sm flex items-center gap-1.5">
                      <col.icon className="w-3.5 h-3.5" />
                      {col.label}
                    </h3>
                    <Badge variant="secondary">{items.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {items.length === 0 ? (
                      <div className="text-center text-xs text-muted-foreground italic py-8">None</div>
                    ) : (
                      items.map(row => <CardItem key={row.id} row={row} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="deals" className="mt-4">
          <DealsKanban data={dealsData} loading={dealsLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const DEAL_COLUMNS: Array<{ key: DealRow["column"]; label: string; tone: string; icon: any; description: string }> = [
  { key: "not_started", label: "KYC not started", tone: "border-red-300 bg-red-50/30", icon: AlertCircle, description: "No counterparty has KYC" },
  { key: "in_progress", label: "KYC in progress", tone: "border-amber-300 bg-amber-50/30", icon: Clock, description: "At least one side started" },
  { key: "ready_to_invoice", label: "Ready to invoice", tone: "border-emerald-400 bg-emerald-50/40", icon: CheckCircle2, description: "Both counterparties AML clear" },
];

function DealsKanban({ data, loading }: { data: DealBoardData | undefined; loading: boolean }) {
  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-sm text-muted-foreground">No live deals.</div>;

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {DEAL_COLUMNS.map(col => {
          const count = (data.counts as any)[col.key] || 0;
          const Icon = col.icon;
          return (
            <Card key={col.key} className={`border-l-4 ${col.tone}`}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wide">{col.label}</span>
                </div>
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-[10px] text-muted-foreground">{col.description}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {DEAL_COLUMNS.map(col => {
          const items = data.rows.filter(r => r.column === col.key);
          return (
            <div key={col.key} className={`rounded-lg border-2 ${col.tone} p-2 min-h-[400px]`} data-testid={`deal-column-${col.key}`}>
              <div className="flex items-center justify-between px-1 py-1.5 mb-2">
                <h3 className="font-semibold text-sm flex items-center gap-1.5">
                  <col.icon className="w-3.5 h-3.5" />
                  {col.label}
                </h3>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground italic py-8">None</div>
                ) : (
                  items.map(row => <DealCard key={row.id} row={row} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DealCard({ row }: { row: DealRow }) {
  return (
    <Link
      href={`/deals/${row.id}`}
      className="block bg-white border border-border/60 rounded-lg p-3 hover:shadow-sm hover:border-primary/40 transition-all"
      data-testid={`deal-card-${row.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Handshake className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="font-semibold text-sm truncate">{row.name}</span>
        </div>
        {row.canInvoice && (
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
        )}
      </div>
      {row.propertyName && (
        <div className="text-[11px] text-muted-foreground truncate mb-1.5">{row.propertyName}</div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {row.status && <Badge variant="outline" className="text-[10px]">{row.status}</Badge>}
        {row.dealType && <Badge variant="outline" className="text-[10px]">{row.dealType}</Badge>}
        {row.fee && <Badge variant="outline" className="text-[10px]">£{Number(row.fee).toLocaleString()}</Badge>}
      </div>
      <div className="space-y-1 pt-2 border-t border-border/40">
        {row.counterparties.length === 0 ? (
          <div className="text-[11px] text-red-600 italic">No counterparties set on deal</div>
        ) : row.counterparties.map(cp => (
          <div key={cp.id} className="flex items-center gap-1.5 text-[11px]">
            {cp.isApproved ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
            ) : cp.isExpired ? (
              <Clock className="w-3 h-3 text-red-500 shrink-0" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
            )}
            <span className="uppercase text-[9px] text-muted-foreground font-semibold shrink-0">{cp.role}</span>
            <span className="truncate">{cp.name}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}
