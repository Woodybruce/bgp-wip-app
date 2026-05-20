import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Building2, Briefcase, Users, BarChart3 } from "lucide-react";

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
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ landlords: Landlord[] }>({
    queryKey: ["/api/crm/landlords"],
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const list = data?.landlords ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(l =>
      l.name.toLowerCase().includes(q) ||
      (l.domain || "").toLowerCase().includes(q) ||
      (l.head_office_address || "").toLowerCase().includes(q)
    );
  }, [data, search]);

  const totals = useMemo(() => {
    const list = filtered;
    return {
      count: list.length,
      activeDeals: list.reduce((s, l) => s + (Number(l.active_deals) || 0), 0),
      totalFee: list.reduce((s, l) => s + (Number(l.total_fee) || 0), 0),
      properties: list.reduce((s, l) => s + (Number(l.property_count) || 0), 0),
    };
  }, [filtered]);

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="page-landlords">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Landlords</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Active client base — fees, deals, coverage at a glance.</p>
        </div>
        <div className="relative w-64">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard icon={Briefcase} label="Landlords" value={totals.count.toString()} />
        <StatCard icon={BarChart3} label="Active deals" value={totals.activeDeals.toString()} />
        <StatCard icon={Building2} label="Properties" value={totals.properties.toString()} />
        <StatCard icon={Users} label="Total fees" value={formatGBP(totals.totalFee)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[280px]">Landlord</TableHead>
                  <TableHead className="w-[110px]">Type</TableHead>
                  <TableHead className="w-[80px] text-right">Active</TableHead>
                  <TableHead className="w-[100px] text-right">Total Fee</TableHead>
                  <TableHead className="w-[80px] text-right">Props</TableHead>
                  <TableHead className="w-[80px] text-right">Contacts</TableHead>
                  <TableHead className="w-[100px]">Last touch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      No landlords match.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(l => {
                    const lastTouch = l.last_deal_update || l.last_interaction_at;
                    return (
                      <TableRow key={l.id} data-testid={`row-landlord-${l.id}`}>
                        <TableCell className="px-3 py-2">
                          <Link href={`/companies/${l.id}`} className="text-sm font-medium hover:underline">
                            {l.name}
                          </Link>
                          {l.investment_hunter_flag && (
                            <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200">
                              Hunter
                            </Badge>
                          )}
                          {l.domain && (
                            <p className="text-[11px] text-muted-foreground truncate">{l.domain}</p>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                          {l.company_type || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                          {l.active_deals || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums font-medium">
                          {formatGBP(Number(l.total_fee) || 0)}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                          {l.property_count || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                          {l.contact_count || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                          {formatRelative(lastTouch)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-base font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
