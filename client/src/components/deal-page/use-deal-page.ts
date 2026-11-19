// The deal page's two reads (server/deal-page.ts): the page (stage, strip,
// clock, letting, checklist, tasks) and its timeline. Keyed under
// "/api/crm/deals" so every deal save (invalidateDealCaches) refreshes them.
import { useQuery } from "@tanstack/react-query";
import type { DealEvent, DealPageData } from "@shared/deal-page";

export const dealPageKey = (dealId: string) => ["/api/crm/deals", dealId, "page"] as const;
export const dealTimelineKey = (dealId: string) => ["/api/crm/deals", dealId, "timeline"] as const;

export function useDealPage(dealId: string) {
  return useQuery<DealPageData>({ queryKey: dealPageKey(dealId), staleTime: 30_000, retry: false });
}

export function useDealTimeline(dealId: string, enabled = true) {
  return useQuery<{ events: DealEvent[]; letting: { trackerId: string; current: boolean } | null }>({
    queryKey: dealTimelineKey(dealId), enabled, staleTime: 30_000, retry: false,
  });
}

// What a person can open from the page: an offer's negotiation, or one of the
// letting's dialogs on its Letting Tracker unit.
export type LettingDialog =
  | { to: "offer"; offerId: string }
  | { to: "hots" } | { to: "checklist" } | { to: "recommendation" } | { to: "brief" };
