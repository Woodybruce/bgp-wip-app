import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileCardView } from "@/components/mobile-card-view";
import {
  Search, Building2, Briefcase, Users, BarChart3, Crosshair,
  Crown, MapPin, ChevronRight, ArrowUpDown, Landmark,
} from "lucide-react";

interface Landlord {
  id: string;
  name: string;
  company_type: string | null;
  domain: string | null;
  head_office_address: string | null;
  investment_hunter_flag: boolean | null;
  last_interaction_at: string | null;
  active_deals: number;
  total_fee: number;
  last_deal_update: string | null;
  property_count: number;
  contact_count: number;
}

type HubTab = "overview" | "portfolio" | "hunter";
type SortKey = "name" | "company_type" | "active_deals" | "total_fee" | "property_count" | "contact_count";

const formatGBP = (n: number) => {
  if (!n || n === 0) return "—";
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `£${(n / 1_000).toFixed(0)}k`;
  return `£${n.toLocaleString("en-GB")}`;
};

const formatRelative = (iso: string | null) => {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

export default function LandlordsPage() {
  const searchParams = useSearch();
  const rawTab = new URLSearchParams(searchParams).get("tab");
  const initialTab: HubTab = rawTab && ["overview", "portfolio", "hunter"].includes(rawTab) ? (rawTab as HubTab) : "overview";
  const [activeTab, setActiveTab] = useState<HubTab>(initialTab);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_fee");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const isMobile = useIsMobile();

  const { data, isLoading } = useQuery<{ landlords: Landlord[] }>({
    queryKey: ["/api/crm/landlords"],
    staleTime: 60_000,
  });

  const all = data?.landlords ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(l =>
      l.name.toLowerCase().includes(q) ||
      (l.domain || "").toLowerCase().includes(q) ||
      (l.head_office_address || "").toLowerCase().includes(q)
    );
  }, [all, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let av: any = a[sortKey];
      let bv: any = b[sortKey];
      if (sortKey === "name" || sortKey === "company_type") {
        av = (av || "").toString().toLowerCase();
        bv = (bv || "").toString().toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totals = useMemo(() => ({
    count: all.length,
    activeDeals: all.reduce((s, l) => s + (Number(l.active_deals) || 0), 0),
    totalFee: all.reduce((s, l) => s + (Number(l.total_fee) || 0), 0),
    properties: all.reduce((s, l) => s + (Number(l.property_count) || 0), 0),
    hunters: all.filter(l => l.investment_hunter_flag).length,
  }), [all]);

  const topByFee = useMemo(() => [...all].sort((a, b) => (Number(b.total_fee) || 0) - (Number(a.total_fee) || 0)).slice(0, 8), [all]);
  const topByPortfolio = useMemo(() => [...all].sort((a, b) => (Number(b.property_count) || 0) - (Number(a.property_count) || 0)).slice(0, 8), [all]);
  const hunters = useMemo(() => all.filter(l => l.investment_hunter_flag).sort((a, b) => (Number(b.total_fee) || 0) - (Number(a.total_fee) || 0)), [all]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "company_type" ? "asc" : "desc");
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto" data-testid="page-landlords">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-indigo-500" />
            Landlord Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">The active client base — fees, deals, portfolios and acquisition targets.</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search landlords..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-9 pl-7 text-xs"
            data-testid="input-landlord-search"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {([
          { key: "overview", label: "Overview", icon: BarChart3 },
          { key: "portfolio", label: "Portfolio", icon: Building2 },
          { key: "hunter", label: "Investment Hunter", icon: Crosshair },
        ] as { key: HubTab; label: string; icon: any }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-${t.key}`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Landlords", value: totals.count.toString(), icon: Briefcase, colour: "text-indigo-500" },
              { label: "Active deals", value: totals.activeDeals.toString(), icon: BarChart3, colour: "text-blue-500" },
              { label: "Properties", value: totals.properties.toString(), icon: Building2, colour: "text-emerald-500" },
              { label: "Total fees", value: formatGBP(totals.totalFee), icon: Landmark, colour: "text-amber-500" },
              { label: "Hunter targets", value: totals.hunters.toString(), icon: Crosshair, colour: "text-rose-500" },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="p-4 flex items-center gap-3">
                  <s.icon className={`w-7 h-7 ${s.colour} shrink-0`} />
                  <div className="min-w-0">
                    <div className="text-xl font-bold tabular-nums">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Leaderboard
              title="Top by fees"
              icon={Crown}
              accent="text-amber-500"
              rows={topByFee}
              metric={l => formatGBP(Number(l.total_fee) || 0)}
            />
            <Leaderboard
              title="Biggest portfolios"
              icon={Building2}
              accent="text-emerald-500"
              rows={topByPortfolio}
              metric={l => `${l.property_count || 0} ${(l.property_count || 0) === 1 ? "property" : "properties"}`}
            />
            <Leaderboard
              title="Investment Hunter targets"
              icon={Crosshair}
              accent="text-rose-500"
              rows={hunters.slice(0, 8)}
              metric={l => (l.active_deals ? `${l.active_deals} active` : "—")}
              empty="No landlords flagged as targets yet."
            />
          </div>
        </>
      )}

      {/* ── Portfolio (full sortable table) ──────────────────────── */}
      {activeTab === "portfolio" && isMobile && (
        <MobileCardView
          emptyMessage="No landlords match"
          items={sorted.map(l => ({
            id: l.id,
            title: l.name,
            subtitle: l.company_type || l.domain || undefined,
            status: l.investment_hunter_flag ? "Hunter" : undefined,
            statusColor: "bg-amber-500",
            href: `/companies/${l.id}`,
            fields: [
              { label: "Active deals", value: l.active_deals || 0 },
              { label: "Total fee", value: formatGBP(Number(l.total_fee) || 0) },
              { label: "Properties", value: l.property_count || 0 },
              { label: "Contacts", value: l.contact_count || 0 },
              { label: "Last touch", value: formatRelative(l.last_deal_update || l.last_interaction_at) },
            ],
          }))}
        />
      )}
      {activeTab === "portfolio" && !isMobile && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="Landlord" k="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[280px]" />
                  <SortHead label="Type" k="company_type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[150px]" />
                  <SortHead label="Active" k="active_deals" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[80px]" align="right" />
                  <SortHead label="Total Fee" k="total_fee" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[100px]" align="right" />
                  <SortHead label="Props" k="property_count" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[80px]" align="right" />
                  <SortHead label="Contacts" k="contact_count" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[80px]" align="right" />
                  <TableHead className="w-[100px]">Last touch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No landlords match.</TableCell>
                  </TableRow>
                ) : (
                  sorted.map(l => {
                    const lastTouch = l.last_deal_update || l.last_interaction_at;
                    return (
                      <TableRow key={l.id} data-testid={`row-landlord-${l.id}`}>
                        <TableCell className="px-3 py-2">
                          <Link href={`/companies/${l.id}`} className="text-sm font-medium hover:underline">{l.name}</Link>
                          {l.investment_hunter_flag && (
                            <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200">Hunter</Badge>
                          )}
                          {l.domain && <p className="text-[11px] text-muted-foreground truncate">{l.domain}</p>}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs text-muted-foreground">{l.company_type || "—"}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">{l.active_deals || "—"}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums font-medium">{formatGBP(Number(l.total_fee) || 0)}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">{l.property_count || "—"}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">{l.contact_count || "—"}</TableCell>
                        <TableCell className="px-3 py-2 text-xs text-muted-foreground">{formatRelative(lastTouch)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Investment Hunter ────────────────────────────────────── */}
      {activeTab === "hunter" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Landlords flagged as acquisition / investment targets. Flag a landlord with the Hunter marker on its company record to surface it here.
          </p>
          {hunters.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No landlords flagged as investment targets yet.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {hunters.map(l => (
                <Link key={l.id} href={`/companies/${l.id}`}>
                  <Card className="hover:border-indigo-300 transition-colors cursor-pointer h-full">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{l.name}</div>
                          <div className="text-xs text-muted-foreground">{l.company_type || "Landlord"}</div>
                        </div>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200 shrink-0">Hunter</Badge>
                      </div>
                      {l.head_office_address && (
                        <div className="text-[11px] text-muted-foreground flex items-start gap-1">
                          <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="truncate">{l.head_office_address}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-xs pt-1 border-t">
                        <span className="tabular-nums"><span className="font-semibold">{l.active_deals || 0}</span> <span className="text-muted-foreground">deals</span></span>
                        <span className="tabular-nums"><span className="font-semibold">{l.property_count || 0}</span> <span className="text-muted-foreground">props</span></span>
                        <span className="tabular-nums font-medium ml-auto">{formatGBP(Number(l.total_fee) || 0)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Leaderboard({ title, icon: Icon, accent, rows, metric, empty }: {
  title: string;
  icon: any;
  accent: string;
  rows: Landlord[];
  metric: (l: Landlord) => string;
  empty?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Icon className={`w-4 h-4 ${accent}`} />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">{empty || "No data yet."}</p>
        ) : (
          <div className="space-y-1">
            {rows.map((l, i) => (
              <Link key={l.id} href={`/companies/${l.id}`} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted/60 transition-colors">
                <span className="text-xs text-muted-foreground w-4 tabular-nums shrink-0">{i + 1}</span>
                <span className="text-sm font-medium truncate flex-1 min-w-0">{l.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{metric(l)}</span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SortHead({ label, k, sortKey, sortDir, onSort, className, align }: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  className?: string;
  align?: "right";
}) {
  const active = sortKey === k;
  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(k)}
        className={`flex items-center gap-1 hover:text-foreground transition-colors ${align === "right" ? "ml-auto" : ""} ${active ? "text-foreground font-medium" : ""}`}
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? "opacity-100" : "opacity-30"}`} />
      </button>
    </TableHead>
  );
}
