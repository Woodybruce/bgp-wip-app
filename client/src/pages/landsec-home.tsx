// Landsec home — the first screen for the Landsec instruction
// (docs/landsec-pitch-plan.md, item 1): the 14 schemes grouped North /
// South / Outlets / London, each card carrying its units, vacancy and the
// live letting pipeline, opening the scheme's property page. BGP admins
// also see the Landsec-linked records that fall outside the instruction and
// a merge control for schemes that still have more than one record.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Building2, ChevronRight, Clock, Merge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill, PillCount } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";

type Stage = "AVA" | "NEG" | "HOT" | "SOL";
const STAGES: { code: Stage; label: string; short: string }[] = [
  { code: "AVA", label: "Marketing", short: "Mkt" },
  { code: "NEG", label: "Negotiating", short: "Neg" },
  { code: "HOT", label: "HOTs", short: "HOTs" },
  { code: "SOL", label: "Solicitors", short: "Sols" },
];

interface SchemeRecord { id: string; name: string; units: number; deals: number; files: number }
interface Scheme {
  key: string; name: string; town: string; group: string;
  propertyId: string | null; recordCount: number;
  units: number; vacant: number; passingRent: number; rentUnits: number;
  pipeline: { tracker: Record<Stage, number>; liveDeals: number; oldestLiveDays: number | null };
  records?: SchemeRecord[];
}
interface HomeData {
  companyId: string;
  groups: { group: string; schemes: Scheme[] }[];
  totals: { units: number; vacant: number; liveDeals: number; tracker: Record<Stage, number>; withRecord: number };
  outOfScope?: { id: string; name: string; units: number; deals: number }[];
}

export default function LandsecHome() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data, isLoading, error } = useQuery<HomeData>({ queryKey: ["/api/landsec/home"], staleTime: 60 * 1000 });
  const [mergeScheme, setMergeScheme] = useState<Scheme | null>(null);
  const [showOutOfScope, setShowOutOfScope] = useState(false);

  const { data: cases } = useQuery<{ cases: { id: string; companyId: string; headline: string | null; status: string; brand: { name: string; logoUrl: string | null }; tally: Record<string, number>; responseCount: number }[] }>({ queryKey: ["/api/landsec/brand-cases"], staleTime: 60 * 1000 });
  const isStaff = !!data?.outOfScope;
  const isAdmin = !!user?.isAdmin;
  const schemeCount = useMemo(() => data?.groups.reduce((n, g) => n + g.schemes.length, 0) ?? 0, [data]);

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-2xl font-bold tracking-tight">Landsec portfolio</h1>
        <p className="text-sm text-muted-foreground mt-2">The portfolio could not be loaded. {(error as any)?.message || ""}</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="landsec-home">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Landsec portfolio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data
              ? `${schemeCount} schemes · ${data.totals.units.toLocaleString("en-GB")} units · ${data.totals.vacant.toLocaleString("en-GB")} vacant · ${data.totals.liveDeals} live lettings`
              : "Hospitality & leisure leasing across the instruction"}
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap gap-1.5" data-testid="landsec-home-stages">
            {STAGES.map(s => (
              <Link key={s.code} href="/deals/letting">
                <Pill title={`${s.label} on the letting tracker`}>
                  {s.label} <PillCount n={data.totals.tracker[s.code]} />
                </Pill>
              </Link>
            ))}
          </div>
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
              <SchemeCard key={s.key} scheme={s} isStaff={isStaff} isAdmin={isAdmin} onMerge={() => setMergeScheme(s)} />
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

      {mergeScheme && <MergeDialog scheme={mergeScheme} onClose={() => setMergeScheme(null)} />}
    </div>
  );
}

function SchemeCard({ scheme, isStaff, isAdmin, onMerge }: { scheme: Scheme; isStaff: boolean; isAdmin: boolean; onMerge: () => void }) {
  const occupied = scheme.units - scheme.vacant;
  const occupancy = scheme.units > 0 ? Math.round((occupied / scheme.units) * 100) : null;
  const body = (
    <CardContent className="p-3 flex flex-col gap-2 h-full">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold leading-tight truncate">{scheme.name}</p>
          <p className="text-xs text-muted-foreground">{scheme.town}</p>
        </div>
        <Building2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      </div>
      {scheme.propertyId ? (
        <>
          <div className="grid grid-cols-3 gap-1 text-center">
            <Stat label="Units" value={scheme.units.toLocaleString("en-GB")} />
            <Stat label="Vacant" value={scheme.vacant.toLocaleString("en-GB")} />
            <Stat label="Occupancy" value={occupancy === null ? "—" : `${occupancy}%`} />
          </div>
          <div className="flex flex-wrap gap-1">
            {STAGES.map(s => (
              <span
                key={s.code}
                className={`rounded-full border px-1.5 py-px text-[10px] tabular-nums ${scheme.pipeline.tracker[s.code] > 0 ? "border-border text-foreground" : "border-transparent text-muted-foreground/60"}`}
                title={s.label}
              >
                {s.short} {scheme.pipeline.tracker[s.code]}
              </span>
            ))}
          </div>
          <div className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {scheme.rentUnits > 0 ? `${formatCurrency(scheme.passingRent)} pa on ${scheme.rentUnits} units` : "No rents recorded"}
            </span>
            {scheme.pipeline.oldestLiveDays !== null && (
              <span className="flex items-center gap-1 tabular-nums" title="Oldest live deal, days since last change">
                <Clock className="w-3 h-3" /> {scheme.pipeline.oldestLiveDays}d
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No property record yet.</p>
      )}
    </CardContent>
  );

  return (
    <Card className="h-full relative hover:border-foreground/30 transition-colors" data-testid={`landsec-scheme-${scheme.key}`}>
      {scheme.propertyId ? <Link href={`/landsec/scheme/${scheme.key}`} className="block h-full">{body}</Link> : body}
      {isStaff && scheme.recordCount > 1 && (
        <div className="absolute top-2 right-8">
          {isAdmin ? (
            <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={onMerge} data-testid={`landsec-merge-${scheme.key}`}>
              <Merge className="w-3 h-3 mr-1" /> {scheme.recordCount} records
            </Button>
          ) : (
            <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">{scheme.recordCount} records</span>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-1 py-1">
      <p className="text-sm font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}

// Fold a scheme's duplicate records into one keeper. The keeper defaults to
// the record with the most units; every other record's deals, units, files
// and links move onto it and the duplicate row is removed.
function MergeDialog({ scheme, onClose }: { scheme: Scheme; onClose: () => void }) {
  const { toast } = useToast();
  const records = scheme.records || [];
  const [keepId, setKeepId] = useState<string>(scheme.propertyId || records[0]?.id || "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(records.filter(r => r.id !== (scheme.propertyId || records[0]?.id)).map(r => r.id)));

  const merge = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/landsec/schemes/${scheme.key}/merge`, { keepId, mergeIds: Array.from(selected) });
      return res.json();
    },
    onSuccess: (r: any) => {
      const failed = (r?.results || []).filter((x: any) => !x.ok);
      toast({
        title: failed.length ? `Merged with ${failed.length} failure(s)` : "Records merged",
        description: failed.length ? failed.map((f: any) => f.error).join("; ") : `${scheme.name} now has one record.`,
        variant: failed.length ? "destructive" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/landsec/home"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Merge failed", description: e?.message, variant: "destructive" }),
  });

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge {scheme.name} records</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Pick the record to keep; the ticked records' deals, units, files and links move onto it and the duplicates are removed. This cannot be undone.
        </p>
        <div className="space-y-1.5">
          {records.map(r => (
            <div key={r.id} className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${r.id === keepId ? "border-foreground" : ""}`}>
              <label className="flex items-center gap-1.5 text-xs shrink-0">
                <input type="radio" name="keep" checked={r.id === keepId} onChange={() => { setKeepId(r.id); setSelected(prev => { const n = new Set(prev); n.delete(r.id); return n; }); }} />
                Keep
              </label>
              <label className="flex items-center gap-1.5 text-xs shrink-0">
                <input type="checkbox" disabled={r.id === keepId} checked={r.id !== keepId && selected.has(r.id)} onChange={() => toggle(r.id)} />
                Merge
              </label>
              <span className="truncate flex-1">{r.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{r.units} units · {r.deals} deals · {r.files} files</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!keepId || selected.size === 0 || merge.isPending} onClick={() => merge.mutate()} data-testid="landsec-merge-confirm">
            {merge.isPending ? "Merging…" : `Merge ${selected.size} into keeper`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
