// Landsec home — the first screen for the Landsec instruction
// (docs/landsec-pitch-plan.md, item 1): the 14 schemes grouped North /
// South / Outlets / London, each card carrying its units, vacancy and the
// live letting pipeline, opening the scheme's property page. BGP admins
// also see the Landsec-linked records that fall outside the instruction and
// a merge control for schemes that still have more than one record.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LandsecAccessPanel } from "@/components/landsec-access-panel";
// The scheme cards and the merge are the shared ones the Properties page's
// "Schemes" view draws (components/landsec/scheme-cards.tsx).
import {
  LandsecStagePills, SchemeCard, MergeDialog,
  type LandsecHomeData as HomeData, type LandsecHomeScheme as Scheme,
} from "@/components/landsec/scheme-cards";

export default function LandsecHome() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data, isLoading, error } = useQuery<HomeData>({ queryKey: ["/api/landsec/home"], staleTime: 60 * 1000 });
  const [mergeScheme, setMergeScheme] = useState<Scheme | null>(null);
  const [showOutOfScope, setShowOutOfScope] = useState(false);

  const { data: cases } = useQuery<{ cases: { id: string; companyId: string; headline: string | null; status: string; brand: { name: string; logoUrl: string | null }; tally: Record<string, number>; responseCount: number }[] }>({ queryKey: ["/api/landsec/brand-cases"], staleTime: 60 * 1000, enabled: !!user && user.landsecRole !== "joint_agent" });
  const isStaff = !!data?.outOfScope;
  // Where the stage counts open. A joint agent has its own tracker for its
  // schemes. Only a joint agent draws this page today: every other Landsec
  // login (an asset manager included, since 13 November 2026) is sent on to
  // Properties, so the Letting Tracker link and the Brand cases strip below
  // are for a login that is not a joint agent, should one land here.
  const role = data?.viewer?.role || user?.landsecRole || null;
  const trackerHref = role === "joint_agent" ? "/landsec/tracker" : "/deals/letting";
  const isAdmin = !!user?.isAdmin;
  const schemeCount = useMemo(() => data?.groups.reduce((n, g) => n + g.schemes.length, 0) ?? 0, [data]);

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-2xl font-bold tracking-tight">Properties</h1>
        <p className="text-sm text-muted-foreground mt-2">The portfolio could not be loaded. {(error as any)?.message || ""}</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="landsec-home">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Properties</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data
              ? `${schemeCount} scheme${schemeCount === 1 ? "" : "s"} · ${(data.totals.units ?? 0).toLocaleString("en-GB")} units · ${(data.totals.vacant ?? 0).toLocaleString("en-GB")} vacant · ${data.totals.liveLettings} live lettings`
              : "Hospitality & leisure leasing across the instruction"}
          </p>
        </div>
        {data && (
          <LandsecStagePills
            tracker={data.totals.tracker}
            hrefFor={() => trackerHref}
            titleFor={label => (trackerHref ? `${label} on the letting tracker` : `${label} across your schemes`)}
            testId="landsec-home-stages"
          />
        )}
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
        </div>
      )}

      {data?.groups.map(g => (
        <section key={g.group} className="space-y-2" data-testid={`landsec-group-${g.group.toLowerCase()}`}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {g.schemes.map(s => (
              <SchemeCard key={s.key} scheme={s} href={s.propertyId ? `/landsec/scheme/${s.key}` : null} isStaff={isStaff} isAdmin={isAdmin} onMerge={() => setMergeScheme(s)} />
            ))}
          </div>
        </section>
      ))}

      {cases && cases.cases.length > 0 && (
        <section className="space-y-2" data-testid="landsec-home-brand-cases">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brand cases</h2>
            <Link href="/landsec/brand-cases" className="text-xs text-muted-foreground hover:text-foreground">All cases</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cases.cases.slice(0, 4).map(c => (
              <Link key={c.id} href={`/landsec/brand-case/${c.companyId}`}>
                <Card className="h-full hover:border-foreground/30 transition-colors">
                  <CardContent className="p-3 flex items-center gap-2">
                    {c.brand.logoUrl ? <img src={c.brand.logoUrl} alt="" className="w-9 h-9 rounded object-contain bg-white border shrink-0" /> : <div className="w-9 h-9 rounded bg-muted shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight truncate">{c.brand.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{c.tally.supportive || 0} supportive · {c.tally.concerns || 0} concerns · {c.tally.visit || 0} want a visit</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {isStaff && data?.outOfScope && data.outOfScope.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setShowOutOfScope(v => !v)}
            data-testid="landsec-out-of-scope-toggle"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${showOutOfScope ? "rotate-90" : ""}`} />
            Landsec records outside the 14 schemes ({data.outOfScope.length}) — BGP only, hidden from Landsec
          </button>
          {showOutOfScope && (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              {data.outOfScope.map(p => (
                <Link key={p.id} href={`/properties/${p.id}`} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 hover:bg-muted/40">
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">{p.units} units · {p.deals} deals</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {isStaff && isAdmin && <LandsecAccessPanel />}

      {mergeScheme && <MergeDialog scheme={mergeScheme} onClose={() => setMergeScheme(null)} />}
    </div>
  );
}
