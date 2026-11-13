// The Viewings card on a brand's page (Deals & space): upcoming viewings and
// the ones attended in the last 90 days, each with its outcome and, for BGP
// staff, the next action and the follow-up date. Same request and same rows as the viewing
// activity card used elsewhere (brand-viewing-activity.tsx).
import { useQuery } from "@tanstack/react-query";
import { calendarDateValue } from "@shared/calendar-date";
import type { ViewingRecord } from "@shared/viewing-workflow";
import { apiRequest } from "@/lib/queryClient";
import { useLandsecRestricted } from "@/hooks/use-landsec-restricted";
import { brandViewingRows, viewingDayMonth } from "@/components/brand-viewing-activity";
import { BrandCard, BrandQuietLine, ShowAll, brandCardAction, brandQuietLink, useCap } from "./brand-card";

const VIEWINGS_CAP = 4;

export function BrandViewingsCard({ companyId, staff }: { companyId: string; staff: boolean }) {
  // The viewings list is refused to a Landsec joint agent: not asked for, no card.
  const landsecRestricted = useLandsecRestricted();
  const query = useQuery<{ viewings: ViewingRecord[] }>({
    queryKey: ["/api/leasing-viewings", "brand", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/leasing-viewings?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 30_000,
    enabled: !landsecRestricted,
  });
  const { today, attended, upcoming, activity } = brandViewingRows(query.data?.viewings, companyId);
  const cap = useCap(activity, VIEWINGS_CAP);
  const calendarHref = `/available?workspace=viewings&brandId=${encodeURIComponent(companyId)}`;
  if (query.isError) {
    return (
      <BrandQuietLine testId="brand-viewings-error">
        Viewing activity unavailable right now · <button type="button" onClick={() => void query.refetch()} className={brandQuietLink}>Retry</button>
      </BrandQuietLine>
    );
  }
  if (!query.isSuccess) return null;
  if (activity.length === 0) {
    // A client login gets nothing for an empty card; staff get the way in.
    return staff ? (
      <BrandQuietLine testId="brand-viewings-empty">
        No upcoming or recently attended viewings · <a href={calendarHref} className={brandQuietLink}>Open viewing calendar</a>
      </BrandQuietLine>
    ) : null;
  }
  return (
    <BrandCard title="Viewings" count={activity.length} testId="brand-viewing-activity"
      summary={<><span className="font-mono tabular-nums">{upcoming.length}</span> upcoming · <span className="font-mono tabular-nums">{attended.length}</span> attended in 90 days</>}
      action={<a href={calendarHref} className={brandCardAction}>Open viewing calendar</a>}>
      <div className="divide-y divide-border/40">
        {cap.shown.map(viewing => {
          const followUp = calendarDateValue(viewing.followUpDate);
          const overdue = !!followUp && followUp < today;
          return (
            <div key={viewing.id} className="py-1.5 first:pt-0 last:pb-0 min-w-0" data-testid={`brand-viewing-row-${viewing.id}`}>
              <div className="flex items-baseline justify-between gap-2">
                <a href={`/available?workspace=viewings&viewing=${encodeURIComponent(viewing.id)}`} className="min-w-0 text-sm font-medium hover:underline break-words">
                  {viewing.propertyName || "Property to confirm"} · {viewing.unitName || "Unit to confirm"}
                </a>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{viewingDayMonth(viewing.viewingDate)}{viewing.viewingTime ? ` · ${viewing.viewingTime}` : ""}</span>
              </div>
              <p className="text-[11px] text-muted-foreground break-words">
                {viewing.status === "completed" ? "Attended" : "Scheduled"}
                {viewing.sqft != null && <> · <span className="font-mono tabular-nums">{viewing.sqft.toLocaleString("en-GB")}</span> sq ft</>}
                {viewing.outcome ? ` · ${viewing.outcome}` : ""}
              </p>
              {/* BGP's next action and its follow-up date are BGP's own working notes: staff only.
                  A client login reads the viewing and its outcome. */}
              {staff && (viewing.nextAction || followUp) && (
                <p className="text-xs break-words" data-testid={`brand-viewing-next-${viewing.id}`}>
                  {viewing.nextAction && <><span className="text-muted-foreground">Next: </span>{viewing.nextAction}</>}
                  {followUp && (
                    <span className={overdue ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
                      {viewing.nextAction ? " · " : ""}{overdue ? "follow-up was due " : "follow up "}<span className="tabular-nums">{viewingDayMonth(followUp)}</span>
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {cap.over && <ShowAll total={activity.length} open={cap.open} onToggle={cap.toggle} testId="button-brand-viewings-all" />}
    </BrandCard>
  );
}
