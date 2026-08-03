// TrackerSummary — THE units-availability summary, everywhere.
//
// One component fed only by the Letting Tracker (available_units) on the
// canonical LETTING_STATUSES vocabulary, replacing the drifted one-off
// summaries (the dashboard widget still counted "Under Offer"/"Let" —
// statuses the tracker retired). Two variants (Woody, 2026-08-03):
//
//   strip — horizontal stage lozenges for page headers; each deep-links to
//           the Letting Tracker pre-filtered to that stage (+ property).
//   card  — sidebar card: headline, stage chips, top units, tracker link.
//
// Scope with `propertyId` (property pages) or `propertyIds` (dashboard
// favourites). Client logins are scoped server-side by the endpoint.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Store, ChevronRight } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { LETTING_STATUSES, DEAL_STATUS_LABELS, legacyToCode, type DealStatusCode } from "@shared/deal-status";
import { DEAL_STATUS_BADGE_COLORS, DEAL_STATUS_DOT_COLORS } from "@/lib/deal-status-colors";

const LIVE_CODES = new Set<DealStatusCode>(["OPP", "REP", "AVA", "NEG", "SOL", "EXC"]);

type Unit = {
  id: string; propertyId: string; unitName: string | null; sqft: number | null;
  askingRent: number | null; marketingStatus: string | null;
};

function useTrackerUnits(propertyId?: string, propertyIds?: string[]) {
  const { data: units = [], isLoading } = useQuery<Unit[]>({
    queryKey: propertyId ? ["/api/available-units", { propertyId }] : ["/api/available-units"],
    queryFn: async () => {
      const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
      const r = await fetch(`/api/available-units${qs}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const scoped = useMemo(
    () => (propertyIds && propertyIds.length ? units.filter(u => propertyIds.includes(u.propertyId)) : units),
    [units, propertyIds],
  );
  const counts = useMemo(() => {
    const c = {} as Record<DealStatusCode, number>;
    for (const s of LETTING_STATUSES) c[s] = 0;
    for (const u of scoped) {
      const code = legacyToCode(u.marketingStatus) || "AVA";
      if (c[code] !== undefined) c[code]++;
    }
    return c;
  }, [scoped]);
  const live = useMemo(() => scoped.filter(u => LIVE_CODES.has(legacyToCode(u.marketingStatus) || "AVA")), [scoped]);
  return { units: scoped, live, counts, isLoading };
}

function trackerHref(propertyId?: string, status?: DealStatusCode) {
  const p = new URLSearchParams();
  if (propertyId) p.set("propertyId", propertyId);
  if (status) p.set("status", status);
  const qs = p.toString();
  return `/deals/letting${qs ? `?${qs}` : ""}`;
}

export function TrackerSummary({ propertyId, propertyIds, variant }: {
  propertyId?: string;
  propertyIds?: string[];
  variant: "strip" | "card";
}) {
  const { live, counts, isLoading } = useTrackerUnits(propertyId, propertyIds);

  if (variant === "strip") {
    return (
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="tracker-summary-strip">
        {LETTING_STATUSES.map(code => (
          <Link
            key={code}
            href={trackerHref(propertyId, code)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] hover:opacity-80 ${counts[code] ? "bg-card" : "opacity-40"}`}
            title={`${DEAL_STATUS_LABELS[code]} — open on the Letting Tracker`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${DEAL_STATUS_DOT_COLORS[code] || "bg-muted-foreground"}`} />
            <span className="font-semibold tabular-nums">{counts[code]}</span>
            <span className="text-muted-foreground">{DEAL_STATUS_LABELS[code]}</span>
          </Link>
        ))}
      </div>
    );
  }

  const totalSqft = live.reduce((n, u) => n + (Number(u.sqft) || 0), 0);
  return (
    <div className="space-y-2" data-testid="tracker-summary-card">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs">
          <span className="font-semibold tabular-nums">{live.length}</span>
          <span className="text-muted-foreground"> live letting{live.length === 1 ? "" : "s"}</span>
          {totalSqft > 0 && <span className="text-muted-foreground"> · {totalSqft.toLocaleString()} sq ft</span>}
        </div>
        <Link href={trackerHref(propertyId)} className="text-[11px] text-primary hover:underline inline-flex items-center shrink-0">
          Letting Tracker <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {LETTING_STATUSES.filter(code => counts[code] > 0).map(code => (
          <Link key={code} href={trackerHref(propertyId, code)}>
            <Badge variant="outline" className={`text-[10px] cursor-pointer ${DEAL_STATUS_BADGE_COLORS[code] || ""}`}>
              {counts[code]} {DEAL_STATUS_LABELS[code]}
            </Badge>
          </Link>
        ))}
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading tracker…</p>
      ) : live.length === 0 ? (
        <div className="text-center py-3">
          <Store className="w-6 h-6 mx-auto mb-1 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">Nothing live on the Letting Tracker.</p>
          <Link href={trackerHref(propertyId)} className="text-[11px] text-primary hover:underline">Add a unit →</Link>
        </div>
      ) : (
        <div className="space-y-1">
          {live.slice(0, 5).map(u => (
            <Link key={u.id} href={trackerHref(u.propertyId)} className="flex items-center justify-between gap-2 p-1.5 rounded border bg-card hover:bg-muted/40 min-w-0">
              <span className="text-xs font-medium truncate">{u.unitName || "—"}</span>
              <span className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
                {u.sqft ? `${Number(u.sqft).toLocaleString()} sqft` : ""}
                <Badge variant="outline" className={`text-[9px] ${DEAL_STATUS_BADGE_COLORS[legacyToCode(u.marketingStatus) || "AVA"] || ""}`}>
                  {DEAL_STATUS_LABELS[legacyToCode(u.marketingStatus) || "AVA"]}
                </Badge>
              </span>
            </Link>
          ))}
          {live.length > 5 && (
            <Link href={trackerHref(propertyId)} className="text-[10px] text-muted-foreground hover:text-foreground pl-1 block">
              +{live.length - 5} more on the tracker →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
