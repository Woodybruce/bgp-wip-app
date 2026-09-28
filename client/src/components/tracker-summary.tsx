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
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { LETTING_STATUSES, DEAL_STATUS_LABELS, legacyToCode, type DealStatusCode } from "@shared/deal-status";
import { DEAL_STATUS_BADGE_COLORS, DEAL_STATUS_DOT_COLORS } from "@/lib/deal-status-colors";

const LIVE_CODES = new Set<DealStatusCode>(["OPP", "REP", "AVA", "NEG", "HOT", "SOL", "EXC"]);

// "L063 Bluewater - Whole Demise" → "L063 · Whole Demise" on Bluewater's page.
function withoutScheme(unitName: string | null, propertyName?: string | null) {
  const word = (propertyName || "").split(/[\s,(]/)[0];
  if (!unitName || word.length < 4) return unitName;
  const out = unitName.replace(new RegExp(`\\s*\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s*(?:-\\s*)?`, "i"), " · ").replace(/^\s*·\s*|\s*·\s*$/g, "").trim();
  return out || unitName;
}

type Unit = {
  id: string; propertyId: string; unitName: string | null; sqft: number | null;
  askingRent: number | null; marketingStatus: string | null; dealId?: string | null;
};

function useTrackerUnits(propertyId?: string, propertyIds?: string[]) {
  const { data: units = [], isLoading, isError, refetch } = useQuery<Unit[]>({
    queryKey: propertyId ? ["/api/available-units", { propertyId }] : ["/api/available-units"],
    queryFn: async () => {
      const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
      const r = await fetch(`/api/available-units${qs}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`Tracker lookup failed (${r.status})`);
      return r.json();
    },
  });
  // The linked deal's status wins over the unit's own marketing status —
  // same rule as the Letting Tracker page (effByUnit), so the summary
  // never disagrees with the board it deep-links to.
  const { data: deals = [], isLoading: dealsLoading, isError: dealsError, refetch: retryDeals } = useQuery<{ id: string; status: string | null }[]>({
    queryKey: ["/api/crm/deals"],
  });
  const effOf = useMemo(() => {
    const byId: Record<string, string | null> = {};
    for (const d of deals) byId[d.id] = d.status;
    return (u: Unit): DealStatusCode =>
      (u.dealId ? legacyToCode(byId[u.dealId]) : null) || legacyToCode(u.marketingStatus) || "AVA";
  }, [deals]);
  const scoped = useMemo(
    () => (propertyIds && propertyIds.length ? units.filter(u => propertyIds.includes(u.propertyId)) : units),
    [units, propertyIds],
  );
  const counts = useMemo(() => {
    const c = {} as Record<DealStatusCode, number>;
    for (const s of LETTING_STATUSES) c[s] = 0;
    for (const u of scoped) {
      const code = effOf(u);
      if (c[code] !== undefined) c[code]++;
    }
    return c;
  }, [scoped, effOf]);
  const live = useMemo(() => scoped.filter(u => LIVE_CODES.has(effOf(u))), [scoped, effOf]);
  return { units: scoped, live, counts, effOf, isLoading: isLoading || dealsLoading, isError: isError || dealsError,
    retry: () => Promise.all([refetch(), retryDeals()]) };
}

function trackerHref(propertyId?: string, status?: DealStatusCode) {
  const p = new URLSearchParams();
  if (propertyId) p.set("propertyId", propertyId);
  if (status) p.set("status", status);
  const qs = p.toString();
  return `/deals/letting${qs ? `?${qs}` : ""}`;
}

export function TrackerSummary({ propertyId, propertyIds, variant, tall, propertyName }: {
  propertyId?: string;
  // On a property's own page the scheme name inside every unit name is noise.
  propertyName?: string | null;
  propertyIds?: string[];
  variant: "strip" | "card";
  // Dashboard widget sits beside the (tall) Tasks & Briefing card — let it
  // stretch so the two columns match (Woody, 2026-08-19).
  tall?: boolean;
}) {
  const { live, counts, effOf, isLoading, isError, retry } = useTrackerUnits(propertyId, propertyIds);
  if (isError) return <div className="space-y-2" role="status"><p className="text-xs text-muted-foreground">Letting Tracker data could not be loaded.</p><Button variant="outline" size="sm" onClick={() => retry()}>Retry tracker</Button><Link href={trackerHref(propertyId)} className="text-xs hover:underline">Open Letting Tracker</Link></div>;
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading tracker…</p>;

  if (variant === "strip") {
    return (
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="tracker-summary-strip">
        {/* Only the stages with units in them — a row of greyed zeros was noise. */}
        {LETTING_STATUSES.filter(code => counts[code] > 0).map(code => (
          <Link
            key={code}
            href={trackerHref(propertyId, code)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] hover:opacity-80 bg-card"
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
  // Nothing live: one line with the action in it, then whatever closed
  // stages there are — "0 live lettings" over an icon and "Nothing live"
  // said it twice (Woody, 2026-09-28).
  if (!live.length) {
    return (
      <div className="space-y-1.5" data-testid="tracker-summary-card">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Nothing live — <Link href={trackerHref(propertyId)} className="text-primary hover:underline">add a unit</Link></span>
          <Link href={trackerHref(propertyId)} className="text-[11px] text-primary hover:underline inline-flex items-center shrink-0">
            Letting Tracker <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
        {LETTING_STATUSES.some(code => counts[code] > 0) && (
          <div className="flex items-center gap-1 flex-wrap">
            {LETTING_STATUSES.filter(code => counts[code] > 0).map(code => (
              <Link key={code} href={trackerHref(propertyId, code)}>
                <Badge variant="outline" className={`text-[11px] cursor-pointer ${DEAL_STATUS_BADGE_COLORS[code] || ""}`}>
                  {counts[code]} {DEAL_STATUS_LABELS[code]}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="tracker-summary-card">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs">
          <span className="font-semibold font-mono tabular-nums">{live.length}</span>
          <span className="text-muted-foreground"> live letting{live.length === 1 ? "" : "s"}</span>
          {totalSqft > 0 && <span className="text-muted-foreground"> · <span className="font-mono tabular-nums">{Math.round(totalSqft).toLocaleString("en-GB")}</span> sq ft</span>}
        </div>
        <Link href={trackerHref(propertyId)} className="text-[11px] text-primary hover:underline inline-flex items-center shrink-0">
          Letting Tracker <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {LETTING_STATUSES.filter(code => counts[code] > 0).map(code => (
          <Link key={code} href={trackerHref(propertyId, code)}>
            <Badge variant="outline" className={`text-[11px] cursor-pointer ${DEAL_STATUS_BADGE_COLORS[code] || ""}`}>
              {counts[code]} {DEAL_STATUS_LABELS[code]}
            </Badge>
          </Link>
        ))}
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading tracker…</p>
      ) : (
        <div className={`space-y-1 ${tall ? "max-h-[640px]" : "max-h-[300px]"} overflow-y-auto pr-1`}>
          {live.map(u => (
            <Link key={u.id} href={trackerHref(u.propertyId)} className="flex items-center justify-between gap-2 p-1.5 rounded border bg-card hover:bg-muted/40 min-w-0">
              <span className="text-xs font-medium truncate" title={u.unitName || undefined}>{withoutScheme(u.unitName, propertyName) || "—"}</span>
              <span className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground">
                {u.sqft ? `${Math.round(Number(u.sqft)).toLocaleString("en-GB")} sq ft` : ""}
                <Badge variant="outline" className={`text-[11px] ${DEAL_STATUS_BADGE_COLORS[effOf(u)] || ""}`}>
                  {DEAL_STATUS_LABELS[effOf(u)]}
                </Badge>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
