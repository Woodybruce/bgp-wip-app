import { useState, useMemo, useEffect } from "react";
import { usePropertyContext } from "@/lib/property-context";
import { ScrollableTable } from "@/components/scrollable-table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
  ExternalLink,
  X,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Pill } from "@/components/ui/pill";
import { MobileCardView } from "@/components/mobile-card-view";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const isMobile = useIsMobile();
  const ctxProperty = usePropertyContext();
  const [search, setSearch] = useState(ctxProperty?.postcode || ctxProperty?.name || "");
  // Refresh when the parent Property Intelligence resolves a different property
  useEffect(() => {
    const next = ctxProperty?.postcode || ctxProperty?.name;
    if (next) setSearch(next);
  }, [ctxProperty?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [searchInput, setSearchInput] = useState("");
  const [baFilter, setBaFilter] = useState("all");
  const [descFilter, setDescFilter] = useState("all");
  const [postcodeFilter, setPostcodeFilter] = useState("");
  const [minRv, setMinRv] = useState("");
  const [maxRv, setMaxRv] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<VoaRating | null>(null);
  const [sortBy, setSortBy] = useState("rateableValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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

  // Address finder — live suggestions from the rating list itself (Woody,
  // 2026-08-26: "needs address finder linked to the rating list so auto
  // fills"). Reuses the tokenised /ratings search, so "55 wells street"
  // matches number + street across their separate columns.
  const [suggestQ, setSuggestQ] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSuggestQ(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);
  const { data: suggestData } = useQuery<RatingsResponse>({
    queryKey: [`/api/voa/ratings?search=${encodeURIComponent(suggestQ)}&limit=8&sortBy=rateableValue&sortDir=desc&page=1`],
    enabled: suggestQ.length >= 3 && showSuggest,
    staleTime: 60_000,
  });
  const suggestions = (suggestQ.length >= 3 && showSuggest) ? (suggestData?.items || []) : [];
  const pickSuggestion = (item: VoaRating) => {
    setShowSuggest(false);
    setSearchInput(item.firmName || [item.numberOrName, item.street].filter(Boolean).join(" "));
    setSearch(item.firmName || [item.numberOrName, item.street].filter(Boolean).join(" "));
    setPage(1);
    setDetail(item);
  };

  const handleSearch = () => {
    setShowSuggest(false);
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
    <div className="p-4 sm:p-6 space-y-6" data-testid="voa-ratings-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Business Rates</h1>
          <p className="text-sm text-muted-foreground">
            VOA Rating List — commercial property rateable values
            {data && <span className="ml-1">({data.total.toLocaleString()} properties)</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Pill
            active={tab === "browse"}
            onClick={() => setTab("browse")}
            data-testid="button-tab-browse"
          >
            <Building2 className="w-3 h-3" />
            Browse
          </Pill>
          <Pill
            active={tab === "stats"}
            onClick={() => setTab("stats")}
            data-testid="button-tab-stats"
          >
            <BarChart3 className="w-3 h-3" />
            Statistics
          </Pill>
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
                    onChange={(e) => { setSearchInput(e.target.value); setShowSuggest(true); }}
                    onFocus={() => setShowSuggest(true)}
                    onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    autoComplete="off"
                    data-testid="input-search"
                  />
                  {suggestions.length > 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                      {suggestions.map((sug) => (
                        <button
                          key={sug.uarn}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickSuggestion(sug)}
                          className="w-full text-left px-3 py-2 hover:bg-accent flex items-baseline justify-between gap-2"
                          data-testid={`voa-suggest-${sug.uarn}`}
                        >
                          <span className="min-w-0">
                            <span className="text-sm font-medium block truncate">{sug.firmName || sug.numberOrName || "—"}</span>
                            <span className="text-xs text-muted-foreground block truncate">
                              {[sug.town, sug.postcode].filter(Boolean).join(" · ")}{sug.descriptionText ? ` · ${sug.descriptionText.toLowerCase()}` : ""}
                            </span>
                          </span>
                          <span className="text-xs font-mono tabular-nums shrink-0 text-muted-foreground">
                            {sug.rateableValue != null ? `£${Number(sug.rateableValue).toLocaleString()}` : "no RV"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
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

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : isMobile ? (
              <>
                <MobileCardView
                  emptyMessage="No properties found"
                  items={(data?.items || []).map((item) => ({
                    id: String(item.id ?? item.uarn),
                    title: item.firmName || item.numberOrName || "—",
                    subtitle: item.street || undefined,
                    onClick: () => setDetail(item),
                    fields: [
                      { label: "Postcode", value: item.postcode },
                      { label: "Type", value: item.descriptionText || item.descriptionCode },
                      { label: "Rateable value", value: formatCurrency(item.rateableValue) },
                    ],
                  }))}
                />
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
                      <TableRow
                        key={item.id ?? item.uarn}
                        onClick={() => setDetail(item)}
                        className="cursor-pointer"
                        data-testid={`row-voa-${item.id ?? item.uarn}`}
                      >
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

      <RatingDetailSheet item={detail} baNames={baNames} onClose={() => setDetail(null)} />
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
          {/* Phone: one row per type (docs/DESIGN.md §7) — the table below is desktop-only. */}
          <div className="md:hidden divide-y divide-border">
            {stats.byType.map((t) => (
              <div key={t.descriptionCode} className="py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium truncate">{t.descriptionText}</span>
                  <Badge variant="outline" className="shrink-0 text-xs whitespace-nowrap font-mono">{Number(t.count).toLocaleString()}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">
                  {t.descriptionCode} · Avg RV {formatCurrency(Number(t.avgRv))}
                </p>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


// Full record for one rating-list entry — every stored field plus a link to
// the official VOA summary valuation for the UARN (which also explains
// entries with no current rateable value: deleted or altered assessments
// keep their address in the compiled list but lose the RV).
function RatingDetailSheet({ item, baNames, onClose }: { item: VoaRating | null; baNames: Record<string, string>; onClose: () => void }) {
  if (!item) return null;
  const address = [item.numberOrName, item.street, item.town, item.locality, item.county, item.postcode]
    .filter(Boolean).join(", ");
  const rows: Array<[string, string]> = [
    ["Address", address || "—"],
    ["Description", item.descriptionText || item.descriptionCode || "—"],
    ["Rateable value", item.rateableValue != null ? `£${Number(item.rateableValue).toLocaleString()}` : "No current value"],
    ["Billing authority", baNames[item.baCode] || item.baCode || "—"],
    ["BA reference", item.baRef || "—"],
    ["Effective date", item.effectiveDate || "—"],
    ["List altered", item.listAlterationDate || "—"],
    ["List year", item.listYear || "—"],
    ["UARN", item.uarn || "—"],
  ];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideClose aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto p-0 rounded-t-3xl sm:max-w-2xl sm:mx-auto">
        <div className="px-4 pt-4 pb-3 flex items-start gap-2 border-b border-border/40 sticky top-0 bg-background">
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-base font-semibold leading-snug">{item.firmName || item.numberOrName || "Rating entry"}</SheetTitle>
            <p className="text-xs text-muted-foreground">{item.postcode}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-full active:bg-muted" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-2.5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
          {item.rateableValue == null && (
            <p className="text-xs rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-3 py-2">
              This entry has no current rateable value in the compiled list — the assessment was
              removed or altered (often a split or merge). The official VOA record below shows its
              history and any replacement assessments.
            </p>
          )}
          <dl className="divide-y divide-border/50">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0">{label}</dt>
                <dd className={`text-sm text-right break-words min-w-0 ${label === "Rateable value" ? "font-mono tabular-nums font-semibold" : ""}`}>{value}</dd>
              </div>
            ))}
          </dl>
          <a
            href={`https://www.tax.service.gov.uk/business-rates-find/valuations/${encodeURIComponent(item.uarn)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-11 rounded-xl border border-border/60 text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-muted/40"
            data-testid="voa-detail-official"
          >
            Full valuation on VOA <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
