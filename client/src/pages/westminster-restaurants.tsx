/**
 * Westminster Restaurants — BD prospecting page.
 *
 * Pulls FHRS-registered restaurants/takeaways/pubs in the City of
 * Westminster, cross-references with crm_properties, and surfaces the
 * prospects (everything not yet in CRM). v1 — same approach scales to
 * any borough, just swap the local-authority id.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Utensils, MapPin, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type RestaurantRow = {
  fhrsid: number;
  name: string;
  address: string;
  postcode: string | null;
  businessType: string;
  fhrsRating: string | null;
  fhrsRatingDate: string | null;
  hygieneScore: number | null;
  lat: number | null;
  lng: number | null;
  crmPropertyId: string | null;
  crmPropertyName: string | null;
  inCrm: boolean;
};

type ApiResponse = {
  rows: RestaurantRow[];
  cached: boolean;
  fetchedAt: number;
};

const BUSINESS_TYPES = [
  { value: "all", label: "All restaurant types" },
  { value: "Restaurant/Cafe/Canteen", label: "Restaurants & cafés" },
  { value: "Takeaway/sandwich shop", label: "Takeaways" },
  { value: "Pub/bar/nightclub", label: "Pubs & bars" },
];

function ratingBadgeColor(rating: string | null): string {
  if (!rating) return "bg-muted text-muted-foreground";
  if (rating === "5") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (rating === "4") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (rating === "3") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
  if (rating === "2" || rating === "1") return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
  if (rating === "0") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  return "bg-muted text-muted-foreground";
}

export default function WestminsterRestaurantsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "prospects" | "in_crm">("prospects");
  const [refreshing, setRefreshing] = useState(false);
  const [laId, setLaId] = useState<string>("197");

  const { data: boroughs = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/westminster/boroughs"],
    queryFn: async () => {
      const r = await fetch("/api/westminster/boroughs", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data, isLoading, refetch } = useQuery<ApiResponse & { laId: number }>({
    queryKey: ["/api/westminster/restaurants", laId],
    queryFn: async () => {
      const res = await fetch(`/api/westminster/restaurants?laId=${laId}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("fetch failed");
      return res.json();
    },
  });

  const currentBorough = boroughs.find((b) => String(b.id) === laId)?.name || "City of Westminster";

  const rows = data?.rows || [];

  const filtered = useMemo(() => {
    let out = rows;
    if (statusFilter === "prospects") out = out.filter((r) => !r.inCrm);
    else if (statusFilter === "in_crm") out = out.filter((r) => r.inCrm);
    if (typeFilter !== "all") out = out.filter((r) => r.businessType === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q) ||
        (r.postcode || "").toLowerCase().includes(q),
      );
    }
    return out.slice(0, 1000); // cap at 1000 for table render performance
  }, [rows, search, typeFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const inCrm = rows.filter((r) => r.inCrm).length;
    const prospects = total - inCrm;
    const ratings = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0, "0": 0, "Unknown": 0 } as Record<string, number>;
    for (const r of rows) {
      const k = r.fhrsRating || "Unknown";
      if (k in ratings) ratings[k]++;
      else ratings["Unknown"]++;
    }
    return { total, inCrm, prospects, ratings };
  }, [rows]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/westminster/restaurants?laId=${laId}&refresh=1`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      await refetch();
      toast({ title: "Refreshed FHRS feed" });
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err?.message, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="border-b bg-background sticky top-0 z-10 px-4 lg:px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Utensils className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">London Restaurants</h1>
            <Select value={laId} onValueChange={setLaId}>
              <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {boroughs.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-xs">FSA FHRS · BD prospecting</Badge>
          </div>
          <Button onClick={refresh} disabled={refreshing} variant="outline" size="sm" className="gap-1.5">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh feed
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <StatCard label="Total restaurants" value={stats.total} />
          <StatCard label="Already in CRM" value={stats.inCrm} subtle />
          <StatCard label="Prospects (gap)" value={stats.prospects} highlight />
          <StatCard label="5-star hygiene" value={stats.ratings["5"]} />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / address / postcode…"
            className="max-w-xs"
          />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prospects">Prospects only</SelectItem>
              <SelectItem value="in_crm">Already in CRM</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BUSINESS_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-auto">
            Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 lg:p-6">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-12 text-center text-muted-foreground">
            <Utensils className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No restaurants match — try different filters or refresh the feed.</p>
          </CardContent></Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Postcode</TableHead>
                  <TableHead>Hygiene</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.fhrsid}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{r.name}</span>
                        <a
                          href={`https://ratings.food.gov.uk/business/${r.fhrsid}`}
                          target="_blank"
                          rel="noreferrer"
                          className="opacity-50 hover:opacity-100 shrink-0"
                          title="View on FSA"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.businessType}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1 min-w-0">
                        <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{r.address}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-mono">{r.postcode || "—"}</TableCell>
                    <TableCell>
                      <Badge className={ratingBadgeColor(r.fhrsRating)} variant="secondary">
                        {r.fhrsRating || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.inCrm ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                          In CRM
                        </Badge>
                      ) : (
                        <ResolveButton restaurant={r} onResolved={() => refetch()} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight, subtle }: { label: string; value: number; highlight?: boolean; subtle?: boolean }) {
  return (
    <Card className={highlight ? "border-primary/40" : ""}>
      <CardContent className="p-3">
        <div className={`text-xs ${subtle ? "text-muted-foreground" : "text-muted-foreground"}`}>{label}</div>
        <div className={`text-2xl font-semibold ${highlight ? "text-primary" : ""}`}>
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

function ResolveButton({ restaurant, onResolved }: { restaurant: RestaurantRow; onResolved: () => void }) {
  const { toast } = useToast();
  const [working, setWorking] = useState(false);

  const resolve = async () => {
    setWorking(true);
    try {
      // Resolver auto-creates the canonical CRM property if it doesn't exist
      const input = restaurant.postcode
        ? { kind: "address", text: restaurant.address, postcode: restaurant.postcode }
        : { kind: "address", text: restaurant.address };
      const res = await fetch("/api/property-resolver/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const result = await res.json();
      if (result.kind === "resolved") {
        toast({ title: "Added to CRM", description: result.property.name });
        onResolved();
      } else if (result.kind === "candidates") {
        toast({
          title: "Multiple addresses match",
          description: "Open Property Intelligence and pick the right one.",
        });
      } else {
        toast({ title: "Couldn't resolve", description: result.reason, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Resolver failed", description: err?.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={resolve} disabled={working}>
      {working ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
      Add to CRM
    </Button>
  );
}
