import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, AlertTriangle, Search, ArrowUpDown } from "lucide-react";
import { Link } from "wouter";
import { AIActivityTrigger } from "@/components/ai-activity-card";

type Row = {
  id: string;
  name: string;
  companyType?: string | null;
  aum?: number | null;
  capitalSource?: string | null;
  fundVintageYear?: number | null;
  fundEndYear?: number | null;
  yrsToFundEnd?: number | null;
  fundAge?: number | null;
  mandateAssetClass?: string[] | null;
  mandateGeographies?: string[] | null;
  mandateLotSizeMin?: number | null;
  mandateLotSizeMax?: number | null;
  acquiringNow: boolean;
  acquiringNowNotes?: string | null;
  disposingNow: boolean;
  disposingNowNotes?: string | null;
  distressFlag: boolean;
  distressNotes?: string | null;
  acq12mo: number;
  acqValue12mo?: number | null;
  disp12mo: number;
  dispValue12mo?: number | null;
  debtEvents12mo: number;
  distressSignals12mo: number;
  fundraises12mo: number;
  upcomingMaturities: number;
  buyerScore: number;
  distressScore: number;
};

export default function HuntersInvestment() {
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["/api/hunters/investment"],
  });

  const filtered = useMemo(() => {
    if (!search) return rows;
    return rows.filter((x) => x.name.toLowerCase().includes(search.toLowerCase()));
  }, [rows, search]);

  const buyers = useMemo(() => [...filtered].sort((a, b) => b.buyerScore - a.buyerScore).filter((r) => r.buyerScore > 0 || r.acquiringNow), [filtered]);
  const distressed = useMemo(() => [...filtered].sort((a, b) => b.distressScore - a.distressScore).filter((r) => r.distressScore > 0 || r.distressFlag || r.disposingNow), [filtered]);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-emerald-600" />
          Investment Hunter
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Buyers actively deploying capital and distressed sellers under refinance/fund-life pressure.
        </p>
      </div>

      <div className="relative max-w-[400px]">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input placeholder="Search investor / landlord…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
      </div>

      <Tabs defaultValue="buyers" className="w-full">
        <TabsList>
          <TabsTrigger value="buyers" className="text-xs">
            <TrendingUp className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Buyers ({buyers.length})
          </TabsTrigger>
          <TabsTrigger value="distressed" className="text-xs">
            <TrendingDown className="w-3.5 h-3.5 mr-1 text-red-600" />
            Distressed / Sellers ({distressed.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="buyers" className="mt-3">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
              ) : buyers.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No buyers identified. Mark companies as "Buying Now" on their profile.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <Th label="Investor" align="left" />
                        <Th label="Score" />
                        <Th label="AUM" />
                        <Th label="Capital" />
                        <Th label="Fund age" />
                        <Th label="Lot size" />
                        <Th label="Mandate" align="left" />
                        <Th label="Acq 12mo" />
                        <Th label="Notes" align="left" />
                        <th className="px-2 py-2 w-[90px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {buyers.map((r) => (
                        <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <Link href={`/companies/${r.id}`} className="hover:underline font-medium">{r.name}</Link>
                              {r.acquiringNow && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">Buying</Badge>}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center"><ScoreBadge score={r.buyerScore} variant="buyer" /></td>
                          <td className="px-2 py-2 text-center">{r.aum ? `£${r.aum}m` : "—"}</td>
                          <td className="px-2 py-2 text-center text-[10px] text-muted-foreground">{r.capitalSource?.replace(/_/g, " ") || "—"}</td>
                          <td className="px-2 py-2 text-center text-[10px]">{r.fundAge != null ? `${r.fundAge}y` : "—"}</td>
                          <td className="px-2 py-2 text-center text-[10px]">{r.mandateLotSizeMin || r.mandateLotSizeMax ? `£${r.mandateLotSizeMin || "?"}–${r.mandateLotSizeMax || "?"}m` : "—"}</td>
                          <td className="px-2 py-2 text-[10px]">
                            {r.mandateAssetClass?.length ? r.mandateAssetClass.join(", ") : "—"}
                            {r.mandateGeographies?.length ? <span className="text-muted-foreground"> · {r.mandateGeographies.join(", ")}</span> : null}
                          </td>
                          <td className="px-2 py-2 text-center">{r.acq12mo || "—"}</td>
                          <td className="px-2 py-2 text-muted-foreground max-w-[260px] truncate" title={r.acquiringNowNotes || ""}>{r.acquiringNowNotes || "—"}</td>
                          <td className="px-2 py-2 text-right"><AIActivityTrigger subjectType="brand" subjectId={r.id} title={`${r.name} — Activity`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distressed" className="mt-3">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
              ) : distressed.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No distress signals. Add debt events and flag distressed landlords on their profile.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <Th label="Landlord" align="left" />
                        <Th label="Distress" />
                        <Th label="Maturity 12mo" />
                        <Th label="Signals 12mo" />
                        <Th label="Disp 12mo" />
                        <Th label="Disp value" />
                        <Th label="Yrs fund end" />
                        <Th label="Notes" align="left" />
                        <th className="px-2 py-2 w-[90px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {distressed.map((r) => (
                        <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Link href={`/companies/${r.id}`} className="hover:underline font-medium">{r.name}</Link>
                              {r.distressFlag && <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />Distress</Badge>}
                              {r.disposingNow && <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">Selling</Badge>}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center"><ScoreBadge score={r.distressScore} variant="distress" /></td>
                          <td className="px-2 py-2 text-center">{r.upcomingMaturities || "—"}</td>
                          <td className="px-2 py-2 text-center">{r.distressSignals12mo || "—"}</td>
                          <td className="px-2 py-2 text-center">{r.disp12mo || "—"}</td>
                          <td className="px-2 py-2 text-center text-muted-foreground">{r.dispValue12mo ? `£${r.dispValue12mo.toLocaleString()}` : "—"}</td>
                          <td className="px-2 py-2 text-center">{r.yrsToFundEnd != null ? `${r.yrsToFundEnd}y` : "—"}</td>
                          <td className="px-2 py-2 text-muted-foreground max-w-[260px] truncate" title={r.distressNotes || r.disposingNowNotes || ""}>
                            {r.distressNotes || r.disposingNowNotes || "—"}
                          </td>
                          <td className="px-2 py-2 text-right"><AIActivityTrigger subjectType="landlord" subjectId={r.id} title={`${r.name} — Activity`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="text-[10px] text-muted-foreground space-y-1">
        <div><strong>Buyer score</strong> = Buying Now × 60 + acq 12mo × 8 + fundraises × 25 + early-vintage fund (≤3y) × 20.</div>
        <div><strong>Distress score</strong> = Distress flag × 80 + upcoming maturities × 30 + breach/writedown × 20 + Selling Now × 30 + disposals × 5 + fund-life ending (≤2y) × 25.</div>
      </div>
    </div>
  );
}

function Th({ label, align = "center" }: { label: string; align?: "left" | "center" }) {
  return <th className={`px-2 py-2 font-medium text-[10px] uppercase tracking-wide text-muted-foreground text-${align}`}>{label}</th>;
}

function ScoreBadge({ score, variant }: { score: number; variant: "buyer" | "distress" }) {
  if (variant === "distress") {
    const cls = score >= 80 ? "bg-red-100 text-red-800 border-red-300"
              : score >= 50 ? "bg-red-50 text-red-700 border-red-200"
              : score >= 25 ? "bg-orange-50 text-orange-700 border-orange-200"
              : "bg-zinc-50 text-zinc-600 border-zinc-200";
    return <Badge className={`${cls} text-[10px] font-semibold`}>{score}</Badge>;
  }
  const cls = score >= 80 ? "bg-emerald-100 text-emerald-800 border-emerald-300"
            : score >= 50 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : score >= 25 ? "bg-blue-50 text-blue-700 border-blue-200"
            : "bg-zinc-50 text-zinc-600 border-zinc-200";
  return <Badge className={`${cls} text-[10px] font-semibold`}>{score}</Badge>;
}
