// DealsSummary — THE deals-pipeline summary, everywhere. The Deals twin of
// TrackerSummary (tracker-summary.tsx): one component fed only by the Deals
// board (crm_deals, tracker-backed pre-SOL deals excluded — those belong to
// the Letting Tracker) on the canonical status vocabulary, replacing the
// drifted one-off "Linked Deals" panels that showed raw status text with no
// stage counts and no way through to the board. Two variants (Woody,
// 2026-08-03):
//
//   strip — horizontal stage lozenges for page headers; each deep-links to
//           the Deals schedule pre-filtered to that stage (+ property).
//   card  — sidebar card: headline, stage chips, live deals (each linking
//           to its deal page), Deals board link.
//
// Scope with `propertyId` (property pages) or `propertyIds` (dashboard
// favourites). Client logins are scoped server-side by the endpoint.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Handshake, ChevronRight } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { WIP_STATUSES, DEAL_STATUS_LABELS, legacyToCode, type DealStatusCode } from "@shared/deal-status";
import { DEAL_STATUS_BADGE_COLORS, DEAL_STATUS_DOT_COLORS } from "@/lib/deal-status-colors";

// The Deals schedule (/deals/list) shows WIP_STATUSES; "live" = still being
// worked (COM/INV are done, they stay visible as chips but not in the list).
const LIVE_CODES = new Set<DealStatusCode>(["REP", "AVA", "NEG", "SOL", "EXC"]);

type Deal = {
  id: string; propertyId: string | null; name: string; status: string | null;
  dealType: string | null; updatedAt: string | null;
};

function useBoardDeals(propertyId?: string, propertyIds?: string[]) {
  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/crm/deals", { excludeTracker: true }],
    queryFn: async () => {
      const r = await fetch("/api/crm/deals?excludeTrackerDeals=true", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const scoped = useMemo(() => {
    if (propertyId) return deals.filter(d => d.propertyId === propertyId);
    if (propertyIds && propertyIds.length) return deals.filter(d => d.propertyId && propertyIds.includes(d.propertyId));
    return deals;
  }, [deals, propertyId, propertyIds]);
  const counts = useMemo(() => {
    const c = {} as Record<DealStatusCode, number>;
    for (const s of WIP_STATUSES) c[s] = 0;
    for (const d of scoped) {
      const code = legacyToCode(d.status);
      if (code && c[code] !== undefined) c[code]++;
    }
    return c;
  }, [scoped]);
  const live = useMemo(
    () => scoped.filter(d => { const code = legacyToCode(d.status); return code !== null && LIVE_CODES.has(code); }),
    [scoped],
  );
  return { deals: scoped, live, counts, isLoading };
}

function boardHref(propertyId?: string, status?: DealStatusCode) {
  const p = new URLSearchParams();
  if (propertyId) p.set("propertyId", propertyId);
  if (status) p.set("status", status);
  const qs = p.toString();
  return `/deals/list${qs ? `?${qs}` : ""}`;
}

export function DealsSummary({ propertyId, propertyIds, variant }: {
  propertyId?: string;
  propertyIds?: string[];
  variant: "strip" | "card";
}) {
  const { live, counts, isLoading } = useBoardDeals(propertyId, propertyIds);

  if (variant === "strip") {
    return (
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="deals-summary-strip">
        {WIP_STATUSES.map(code => (
          <Link
            key={code}
            href={boardHref(propertyId, code)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] hover:opacity-80 ${counts[code] ? "bg-card" : "opacity-40"}`}
            title={`${DEAL_STATUS_LABELS[code]} — open on the Deals board`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${DEAL_STATUS_DOT_COLORS[code] || "bg-muted-foreground"}`} />
            <span className="font-semibold tabular-nums">{counts[code]}</span>
            <span className="text-muted-foreground">{DEAL_STATUS_LABELS[code]}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="deals-summary-card">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs">
          <span className="font-semibold tabular-nums">{live.length}</span>
          <span className="text-muted-foreground"> live deal{live.length === 1 ? "" : "s"}</span>
        </div>
        <Link href={boardHref(propertyId)} className="text-[11px] text-primary hover:underline inline-flex items-center shrink-0">
          Deals board <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {WIP_STATUSES.filter(code => counts[code] > 0).map(code => (
          <Link key={code} href={boardHref(propertyId, code)}>
            <Badge variant="outline" className={`text-[10px] cursor-pointer ${DEAL_STATUS_BADGE_COLORS[code] || ""}`}>
              {counts[code]} {DEAL_STATUS_LABELS[code]}
            </Badge>
          </Link>
        ))}
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading deals…</p>
      ) : live.length === 0 ? (
        <div className="text-center py-3">
          <Handshake className="w-6 h-6 mx-auto mb-1 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">Nothing live on the Deals board.</p>
          <Link href={boardHref(propertyId)} className="text-[11px] text-primary hover:underline">Open the board →</Link>
        </div>
      ) : (
        <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
          {live.map(d => (
            <Link key={d.id} href={`/deals/${d.id}`} className="flex items-center justify-between gap-2 p-1.5 rounded border bg-card hover:bg-muted/40 min-w-0">
              <span className="text-xs font-medium truncate">{d.name || "—"}</span>
              <span className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
                {d.dealType || ""}
                <Badge variant="outline" className={`text-[9px] ${DEAL_STATUS_BADGE_COLORS[legacyToCode(d.status) || ""] || ""}`}>
                  {DEAL_STATUS_LABELS[legacyToCode(d.status) as DealStatusCode] || d.status || "—"}
                </Badge>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
