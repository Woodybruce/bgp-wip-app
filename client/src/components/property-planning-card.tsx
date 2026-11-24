import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, TreePine, Waves, ScrollText, ShieldAlert, FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Constraint = {
  dataset: string;
  name: string;
  reference?: string;
  designationDate?: string;
  documentUrl?: string;
};

type Application = {
  reference: string;
  description: string;
  status?: string;
  receivedAt?: string;
  decidedAt?: string;
  decision?: string;
  lpa?: string;
  documentUrl?: string;
  address?: string;
  year?: number | null;
};

type PlanningSummary = {
  propertyId: string;
  postcode: string | null;
  coordinates: { lat: number; lng: number } | null;
  constraints: {
    listed: Constraint[];
    conservationArea: Constraint[];
    article4: Constraint[];
    tpo: Constraint[];
    scheduledMonument: Constraint[];
    worldHeritage: Constraint[];
    floodRisk: Constraint[];
    other: Constraint[];
  };
  recentApplications: Application[];
  nearbyApplications?: Application[];
  applicationCount: { total: number; lastYear: number; pending: number };
  addressKnown?: boolean;
  historyFrom?: string | null;
  fetchedAt: string;
};

interface PropertyPlanningCardProps {
  propertyId: string | null | undefined;
  compact?: boolean;
  className?: string;
}

export function PropertyPlanningCard({ propertyId, compact = false, className }: PropertyPlanningCardProps) {
  const [showAll, setShowAll] = useState(false);
  const [showNearby, setShowNearby] = useState(false);
  const { data, isLoading, error } = useQuery<PlanningSummary>({
    queryKey: [`/api/crm/properties/${propertyId}/planning-summary`],
    enabled: !!propertyId,
    staleTime: 1000 * 60 * 60, // 1h client-side cache; server cache is 24h
  });

  if (!propertyId) return null;

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading planning data…
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Couldn't load planning data.
        </CardContent>
      </Card>
    );
  }

  const chips = buildChips(data);
  const nearby = data.nearbyApplications ?? [];
  const hasAny = chips.length > 0 || data.recentApplications.length > 0 || nearby.length > 0;

  if (compact) {
    return (
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {chips.length === 0 ? (
          <span className="text-xs text-muted-foreground">No planning constraints</span>
        ) : (
          chips.map((chip, i) => (
            <Badge key={i} variant="outline" className={cn("gap-1 text-xs", chip.color)}>
              <chip.icon className="h-3 w-3" />
              {chip.label}
            </Badge>
          ))
        )}
        {data.applicationCount.total > 0 && (
          <Badge variant="outline" className="gap-1 text-xs">
            <FileText className="h-3 w-3" />
            {data.applicationCount.total} apps
            {data.applicationCount.pending > 0 && <span className="text-amber-600">· {data.applicationCount.pending} pending</span>}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          Planning context
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!hasAny && (
          <p className="text-xs text-muted-foreground">No planning constraints or recent applications found at this location.</p>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip, i) => (
              <Badge key={i} variant="outline" className={cn("gap-1", chip.color)}>
                <chip.icon className="h-3 w-3" />
                {chip.label}
              </Badge>
            ))}
          </div>
        )}

        {data.addressKnown === false && (
          <p className="text-xs text-muted-foreground" data-testid="planning-address-unknown">
            The property's address has no number and street or building name, so its own applications can't be told from its neighbours'. Add the address to see them.
          </p>
        )}

        {data.addressKnown !== false && (
          <div data-testid="planning-own-applications">
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Planning history at this address</h4>
              {data.recentApplications.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {data.applicationCount.total} total · {data.applicationCount.lastYear} last year
                  {data.applicationCount.pending > 0 && <span className="text-amber-600"> · {data.applicationCount.pending} pending</span>}
                </span>
              )}
            </div>
            {data.recentApplications.length === 0 ? (
              <p className="text-xs text-muted-foreground">No planning applications found at this address.</p>
            ) : (
              <ApplicationList apps={showAll ? data.recentApplications : data.recentApplications.slice(0, 6)} />
            )}
            {data.recentApplications.length > 6 && (
              <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setShowAll(v => !v)} data-testid="planning-show-all">
                {showAll ? "Show fewer" : `Show all ${data.recentApplications.length}`}
              </button>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {data.historyFrom ? `From ${data.historyFrom}'s planning register and PlanIt.` : "From PlanIt, last 20 years."}
            </p>
          </div>
        )}

        {nearby.length > 0 && (
          <div data-testid="planning-nearby-applications">
            <button type="button" className="text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground" onClick={() => setShowNearby(v => !v)}>
              Nearby, not this building ({nearby.length}) {showNearby ? "▾" : "▸"}
            </button>
            {showNearby && <div className="mt-1.5"><ApplicationList apps={nearby} withAddress /></div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApplicationList({ apps, withAddress = false }: { apps: Application[]; withAddress?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {apps.map((a) => {
        const outcome = a.decision || a.status;
        const when = a.receivedAt ? a.receivedAt.slice(0, 10) : a.year ? String(a.year) : null;
        return (
          <li key={a.reference} className="text-xs border-l-2 border-muted pl-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              {a.documentUrl ? (
                <a href={a.documentUrl} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">{a.reference}</a>
              ) : (
                <span className="font-mono">{a.reference}</span>
              )}
              {when && <span>· {when}</span>}
              {outcome && (
                <span className={cn(
                  "ml-auto",
                  /granted|approved|permitted/i.test(outcome) && "text-green-700",
                  /refused|rejected|dismissed/i.test(outcome) && "text-rose-700",
                )}>
                  {outcome}
                </span>
              )}
            </div>
            {withAddress && a.address && <div className="text-muted-foreground">{a.address}</div>}
            {a.description && <div className="line-clamp-2">{a.description}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function buildChips(s: PlanningSummary) {
  const chips: Array<{ label: string; icon: any; color: string }> = [];
  if (s.constraints.listed.length > 0) {
    const grade = s.constraints.listed.map(l => l.name).find(n => /grade/i.test(n)) || "Listed";
    chips.push({ label: grade, icon: Landmark, color: "border-amber-300 bg-amber-50 text-amber-900" });
  }
  if (s.constraints.conservationArea.length > 0) {
    const name = s.constraints.conservationArea[0].name || "Conservation area";
    chips.push({ label: `CA: ${name}`, icon: Landmark, color: "border-emerald-300 bg-emerald-50 text-emerald-900" });
  }
  if (s.constraints.article4.length > 0) {
    chips.push({ label: "Article 4", icon: ScrollText, color: "border-purple-300 bg-purple-50 text-purple-900" });
  }
  if (s.constraints.tpo.length > 0) {
    chips.push({ label: "TPO", icon: TreePine, color: "border-emerald-300 bg-emerald-50 text-emerald-900" });
  }
  if (s.constraints.scheduledMonument.length > 0) {
    chips.push({ label: "Scheduled monument", icon: ShieldAlert, color: "border-orange-300 bg-orange-50 text-orange-900" });
  }
  if (s.constraints.worldHeritage.length > 0) {
    chips.push({ label: "World heritage", icon: Landmark, color: "border-orange-300 bg-orange-50 text-orange-900" });
  }
  if (s.constraints.floodRisk.length > 0) {
    chips.push({ label: "Flood risk", icon: Waves, color: "border-sky-300 bg-sky-50 text-sky-900" });
  }
  return chips;
}
