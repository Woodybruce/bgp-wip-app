import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Building2, Flame, Search, ArrowUpDown, Clock, AlertTriangle } from "lucide-react";
import { Link } from "wouter";

type Row = {
  id: string;
  name: string;
  companyType?: string | null;
  lettingHunterFlag: boolean;
  lettingHunterNotes?: string | null;
  ownedCount: number;
  totalSqft: number;
  competitorCount: number;
  staleAgentCount: number;
  upcomingEvents: number;
  upcomingSqft: number;
  recentAcq: number;
  score: number;
};

type SortKey = "score" | "upcomingEvents" | "upcomingSqft" | "staleAgentCount" | "ownedCount" | "recentAcq" | "name";

export default function HuntersLetting() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [showHunterOnly, setShowHunterOnly] = useState(false);

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["/api/hunters/letting"],
  });

  const filtered = useMemo(() => {
    let r = rows;
    if (search) r = r.filter((x) => x.name.toLowerCase().includes(search.toLowerCase()));
    if (showHunterOnly) r = r.filter((x) => x.lettingHunterFlag);
    return [...r].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      return ((b[sortKey] as number) || 0) - ((a[sortKey] as number) || 0);
    });
  }, [rows, search, showHunterOnly, sortKey]);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-600" />
          Letting Hunter
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Landlords ranked by leasing opportunity. Top scores have voids, upcoming lease events, stale competitor agents, or fresh acquisitions.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input placeholder="Search landlord…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
        </div>
        <Button size="sm" variant={showHunterOnly ? "default" : "outline"} onClick={() => setShowHunterOnly(!showHunterOnly)}>
          <Flame className="w-3.5 h-3.5 mr-1" />
          Hunter picks only
        </Button>
        <div className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {rows.length}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading hunt list…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No landlords match.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <Th label="Landlord" k="name" sortKey={sortKey} setSortKey={setSortKey} className="text-left" />
                    <Th label="Score" k="score" sortKey={sortKey} setSortKey={setSortKey} />
                    <Th label="Owned" k="ownedCount" sortKey={sortKey} setSortKey={setSortKey} />
                    <Th label="Events 12mo" k="upcomingEvents" sortKey={sortKey} setSortKey={setSortKey} />
                    <Th label="Sqft 12mo" k="upcomingSqft" sortKey={sortKey} setSortKey={setSortKey} />
                    <Th label="Stale agent" k="staleAgentCount" sortKey={sortKey} setSortKey={setSortKey} />
                    <Th label="New acq" k="recentAcq" sortKey={sortKey} setSortKey={setSortKey} />
                    <th className="text-left px-2 py-2 font-medium text-[10px] uppercase tracking-wide text-muted-foreground">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/companies/${r.id}`} className="hover:underline font-medium">{r.name}</Link>
                          {r.lettingHunterFlag && <Flame className="w-3 h-3 text-amber-500" />}
                        </div>
                        {r.companyType && <div className="text-[10px] text-muted-foreground">{r.companyType}</div>}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <ScoreBadge score={r.score} />
                      </td>
                      <td className="px-2 py-2 text-center">{r.ownedCount}</td>
                      <td className="px-2 py-2 text-center">
                        {r.upcomingEvents > 0 ? <Badge variant="outline" className="text-[10px]"><Clock className="w-2.5 h-2.5 mr-0.5" />{r.upcomingEvents}</Badge> : "—"}
                      </td>
                      <td className="px-2 py-2 text-center text-muted-foreground">
                        {r.upcomingSqft ? r.upcomingSqft.toLocaleString() : "—"}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {r.staleAgentCount > 0 ? <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />{r.staleAgentCount}</Badge> : "—"}
                      </td>
                      <td className="px-2 py-2 text-center">{r.recentAcq || "—"}</td>
                      <td className="px-2 py-2 text-muted-foreground max-w-[280px] truncate" title={r.lettingHunterNotes || ""}>
                        {r.lettingHunterNotes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-[10px] text-muted-foreground space-y-1">
        <div><strong>Score</strong> = upcoming sqft × 0.001 + events × 5 + stale agent × 30 + new acq × 15 + hunter flag × 50.</div>
        <div>Stale agent = competitor instructed &gt;12 months. Edit competitor agent on each property page.</div>
      </div>
    </div>
  );
}

function Th({ label, k, sortKey, setSortKey, className = "text-center" }: { label: string; k: SortKey; sortKey: SortKey; setSortKey: (k: SortKey) => void; className?: string }) {
  const active = sortKey === k;
  return (
    <th className={`px-2 py-2 font-medium text-[10px] uppercase tracking-wide ${active ? "text-foreground" : "text-muted-foreground"} ${className}`}>
      <button className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => setSortKey(k)}>
        {label} <ArrowUpDown className="w-2.5 h-2.5" />
      </button>
    </th>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 80 ? "bg-red-50 text-red-700 border-red-200"
            : score >= 50 ? "bg-orange-50 text-orange-700 border-orange-200"
            : score >= 25 ? "bg-amber-50 text-amber-700 border-amber-200"
            : "bg-zinc-50 text-zinc-600 border-zinc-200";
  return <Badge className={`${cls} text-[10px] font-semibold`}>{score}</Badge>;
}
