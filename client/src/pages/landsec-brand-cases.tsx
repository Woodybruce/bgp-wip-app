// Landsec brand cases (docs/landsec-pitch-plan.md, item 5): one card per
// rollout brand with the asset managers' responses tallied, so the leasing
// lead can see who is on board across the portfolio.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LANDSEC_CASE_RESPONSES } from "@shared/landsec";

interface CaseCard {
  id: string; companyId: string; headline: string | null; status: string; sentAt: string | null; updatedAt: string | null;
  brand: { name: string; logoUrl: string | null; storeCount: number | null; rolloutStatus: string | null };
  proposedUnits: { id: string }[]; tally: Record<string, number>; myResponse: string | null; responseCount: number;
}

export default function LandsecBrandCases() {
  const { data, isLoading, error } = useQuery<{ cases: CaseCard[] }>({ queryKey: ["/api/landsec/brand-cases"], staleTime: 60 * 1000 });
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClient = user?.role === "Client" || !!user?.companyScopeId;
  const [newId, setNewId] = useState("");

  if (error) return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">Brand cases could not be loaded.</p></div>;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-brand-cases">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Brand cases</h1>
          <p className="text-sm text-muted-foreground mt-0.5">The portfolio case for each rollout brand, and where every asset manager stands on it.</p>
        </div>
        <Link href="/brands"><Button variant="outline" size="sm">Brand directory</Button></Link>
      </div>

      {isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>}

      {data && data.cases.length === 0 && (
        <p className="text-sm text-muted-foreground">No brand case yet.{isClient ? "" : " Open a brand's profile and press Brand case to start one."}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.cases.map(c => (
          <Link key={c.id} href={`/landsec/brand-case/${c.companyId}`} className="block h-full">
            <Card className="h-full hover:border-foreground/30 transition-colors" data-testid={`landsec-brand-case-${c.companyId}`}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {c.brand.logoUrl ? <img src={c.brand.logoUrl} alt="" className="w-9 h-9 rounded object-contain bg-white border" /> : <div className="w-9 h-9 rounded bg-muted" />}
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight truncate">{c.brand.name}</p>
                    <p className="text-[11px] text-muted-foreground">{c.status === "sent" ? "Sent to asset managers" : "Draft"}{c.proposedUnits.length ? ` · ${c.proposedUnits.length} proposed unit${c.proposedUnits.length === 1 ? "" : "s"}` : ""}</p>
                  </div>
                </div>
                {c.headline && <p className="text-sm line-clamp-2">{c.headline}</p>}
                <div className="grid grid-cols-4 gap-1 text-center">
                  {LANDSEC_CASE_RESPONSES.map(r => (
                    <div key={r.key} className={`rounded-md border px-1 py-1 ${c.myResponse === r.key ? "border-foreground" : ""}`}>
                      <p className="text-sm font-bold tabular-nums leading-tight">{c.tally[r.key] || 0}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider leading-tight">{r.key === "visit" ? "Store visit" : r.label}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {!isClient && data && (
        <div className="rounded-lg border p-3 space-y-1.5 max-w-md">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start a case</p>
          <p className="text-xs text-muted-foreground">Paste the brand's CRM id, or open the brand's profile and press Brand case.</p>
          <div className="flex gap-1.5">
            <Input value={newId} onChange={e => setNewId(e.target.value.trim())} placeholder="Brand CRM id" className="h-8 text-sm" />
            <Link href={newId ? `/landsec/brand-case/${newId}` : "#"}><Button size="sm" className="h-8" disabled={!newId}>Open</Button></Link>
          </div>
        </div>
      )}
    </div>
  );
}
