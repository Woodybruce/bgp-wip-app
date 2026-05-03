import { useState, useMemo } from "react";
import { ScrollableTable } from "@/components/scrollable-table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Building2,
  PoundSterling,
  MapPin,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  BarChart3,
  Loader2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface VoaRating {
  id: number;
  uarn: string;
  baCode: string;
  baRef: string;
  descriptionCode: string;
  descriptionText: string;
  firmName: string;
  numberOrName: string;
  street: string;
  town: string;
  locality: string;
  county: string;
  postcode: string;
  scatCode: string;
  rateableValue: number | null;
  effectiveDate: string;
  listAlterationDate: string;
  compositeBillingAuthority: string;
  listYear: string;
}

interface RatingsResponse {
  items: VoaRating[];
  total: number;
  page: number;
  limit: number;
  baNames: Record<string, string>;
}

interface StatsResponse {
  byAuthority: { baCode: string; name: string; count: number; avgRv: number; totalRv: number; minRv: number; maxRv: number }[];
  byType: { descriptionCode: string; descriptionText: string; count: number; avgRv: number }[];
  baNames: Record<string, string>;
}

interface DescCode {
  code: string;
  text: string;
  count: number;
}

const formatCurrency = (val: number | null) => {
  if (val === null || val === undefined) return "—";
  return "£" + val.toLocaleString();
};

const formatLargeCurrency = (val: number) => {
  if (val >= 1e9) return "£" + (val / 1e9).toFixed(1) + "bn";
  if (val >= 1e6) return "£" + (val / 1e6).toFixed(1) + "m";
  if (val >= 1e3) return "£" + (val / 1e3).toFixed(0) + "k";
  return "£" + val.toLocaleString();
};

export default function VoaRatingsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [baFilter, setBaFilter] = useState("all");
  const [descFilter, setDescFilter] = useState("all");
  const [postcodeFilter, setPostcodeFilter] = useState("");
  const [minRv, setMinRv] = useState("");
  const [maxRv, setMaxRv] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("firmName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [tab, setTab] = useState<"browse" | "stats">("browse");

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (baFilter !== "all") p.set("baCode", baFilter);
    if (descFilter !== "all") p.set("descriptionCode", descFilter);
    if (postcodeFilter) p.set("postcode", postcodeFilter);
    if (minRv) p.set("minRv", minRv);
    if (maxRv) p.set("maxRv", maxRv);
    p.set("sortBy", sortBy);
    p.set("sortDir", sortDir);
    p.set("page", String(page));
    p.set("limit", "50");
    return p.toString();
  }, [search, baFilter, descFilter, postcodeFilter, minRv, maxRv, sortBy, sortDir, page]);

  const { data, isLoading } = useQuery<RatingsResponse>({
    queryKey: [`/api/voa/ratings?${params}`],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<StatsResponse>({
    queryKey: ["/api/voa/stats"],
    enabled: tab === "stats",
  });

  const { data: descCodes } = useQuery<DescCode[]>({
    queryKey: ["/api/voa/description-codes"],
  });

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;
  const baNames = data?.baNames || {};
  const topDescCodes = (descCodes || []).slice(0, 30);

  return (
    <div className="h-full flex flex-col p-4 sm:p-6 gap-6 min-h-0" data-testid="voa-ratings-page">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Business Rates</h1>
          <p className="text-sm text-muted-foreground">
            VOA Rating List — commercial property rateable values
            {data && <span className="ml-1">({data.total.toLocaleString()} properties)</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={tab === "browse" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("browse")}
            data-testid="button-tab-browse"
          >
            <Building2 className="w-4 h-4 mr-1.5" />
            Browse
          </Button>
          <Button
            variant={tab === "stats" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("stats")}
            data-testid="button-tab-stats"
          >
            <BarChart3 className="w-4 h-4 mr-1.5" />
            Statistics
          </Button>
        </div>
      </div>

      {tab === "stats" && (
        <StatsView stats={stats} loading={statsLoading} />
      )}

      {tab === "browse" && (<>
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search properties, streets, postcodes..."
                    className="pl-9"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    data-testid="input-search"
                  />
                </div>
              </div>
              <Select value={baFilter} onValueChange={(v) => { setBaFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[200px]" data-testid="select-authority">
                  <SelectValue placeholder="All authorities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All authorities</SelectItem>
                  {Object.entries(baNames).map(([code, name]) => (
                    <SelectItem key={code} value={code}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={descFilter} onValueChange={(v) => { setDescFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[200px]" data-testid="select-property-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All property types</SelectItem>
                  {topDescCodes.map((d) => (
                    <SelectItem key={d.code} value={d.code}>
                      {d.text} ({d.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Postcode..."
                className="w-[120px]"
                value={postcodeFilter}
                onChange={(e) => { setPostcodeFilter(e.target.value.toUpperCase()); setPage(1); }}
                data-testid="input-postcode"
              />
              <Input
                placeholder="Min RV"
                className="w-[100px]"
                type="number"
                value={minRv}
                onChange={(e) => { setMinRv(e.target.value); setPage(1); }}
                data-testid="input-min-rv"
              />
              <Input
                placeholder="Max RV"
                className="w-[100px]"
                type="number"
                value={maxRv}
                onChange={(e) => { setMaxRv(e.target.value); setPage(1); }}
                data-testid="input-max-rv"
              />
              <Button onClick={handleSearch} data-testid="button-search">
                <Search className="w-4 h-4 mr-1.5" />
                Search
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex-1 min-h-0 flex flex-col">
          <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : (
              <>
                <ScrollableTable minWidth={1200}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer hover:text-foreground"
                        onClick={() => handleSort("firmName")}
                        data-testid="th-property"
                      >
                        <div className="flex items-center gap-1">
                          Property
                          {sortBy === "firmName" && <ArrowUpDown className="w-3 h-3" />}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-foreground"
                        onClick={() => handleSort("street")}
                      >
                        <div className="flex items-center gap-1">
                          Street
                          {sortBy === "street" && <ArrowUpDown className="w-3 h-3" />}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-foreground"
                        onClick={() => handleSort("postcode")}
                      >
                        <div className="flex items-center gap-1">
                          Postcode
                          {sortBy === "postcode" && <ArrowUpDown className="w-3 h-3" />}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-foreground"
                        onClick={() => handleSort("descriptionText")}
                      >
                        <div className="flex items-center gap-1">
                          Type
                          {sortBy === "descriptionText" && <ArrowUpDown className="w-3 h-3" />}
                        </div>
                      </TableHead>
                      <TableHead>Authority</TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-foreground text-right"
                        onClick={() => handleSort("rateableValue")}
                      >
                        <div className="flex items-center gap-1 justify-end">
                          Rateable Value
                          {sortBy === "rateableValue" && <ArrowUpDown className="w-3 h-3" />}
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.items || []).map((item) => (
                      <TableRow key={item.id} data-testid={`row-voa-${item.id}`}>
                        <TableCell>
                          <div className="max-w-[300px]">
                            <p className="text-sm font-medium truncate" title={item.firmName}>
                              {item.firmName || item.numberOrName || "—"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{item.street || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {item.postcode || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {item.descriptionText || item.descriptionCode || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {baNames[item.baCode] || item.baCode}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {formatCurrency(item.rateableValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(data?.items || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No properties found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </ScrollableTable>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between p-4 border-t">
                    <span className="text-sm text-muted-foreground">
                      Page {page} of {totalPages} ({data?.total.toLocaleString()} results)
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page <= 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(Math.min(totalPages, page + 1))}
                        disabled={page >= totalPages}
                        data-testid="button-next-page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </>)}
    </div>
  );
}

function StatsView({ stats, loading }: { stats: StatsResponse | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stats.byAuthority.map((a) => (
          <Card key={a.baCode}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{a.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold">{Number(a.count).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Properties</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatLargeCurrency(Number(a.totalRv))}</p>
                  <p className="text-xs text-muted-foreground">Total RV</p>
                </div>
                <div>
                  <p className="text-lg font-semibold">{formatCurrency(Number(a.avgRv))}</p>
                  <p className="text-xs text-muted-foreground">Average RV</p>
                </div>
                <div>
                  <p className="text-lg font-semibold">{formatCurrency(Number(a.maxRv))}</p>
                  <p className="text-xs text-muted-foreground">Highest RV</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">By Property Type</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Avg RV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.byType.map((t) => (
                <TableRow key={t.descriptionCode}>
                  <TableCell className="text-sm">{t.descriptionText}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{t.descriptionCode}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {Number(t.count).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCurrency(Number(t.avgRv))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
