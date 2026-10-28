import type { EngagementData, EngagementEvent } from "./crm-engagement";

const time = (value: string | null) => value ? new Date(value).getTime() : NaN;

// The company page is a view of the same planning records, never a second
// guest list or task store. Recheck links here so stale cached data cannot
// show another landlord's target reason or follow-up.
export function landlordEngagementView(data: EngagementData, companyId: string, now = Date.now()) {
  const strategies = data.strategies.filter(strategy => strategy.status === "active"
    && strategy.targets.some(target => target.companyId === companyId));
  const events = data.events.filter(event => event.companies.some(link => link.companyId === companyId));
  const upcoming = events.filter(event => event.status !== "cancelled" && event.status !== "completed"
    && (!event.dateConfirmed || !Number.isFinite(time(event.startsAt)) || time(event.startsAt) >= now))
    .sort((a, b) => {
      const aDate = a.dateConfirmed && Number.isFinite(time(a.startsAt)) ? time(a.startsAt) : Infinity;
      const bDate = b.dateConfirmed && Number.isFinite(time(b.startsAt)) ? time(b.startsAt) : Infinity;
      return aDate - bDate || a.title.localeCompare(b.title);
    });
  const completed = events.filter(event => event.status === "completed" && !!event.outcome?.trim()
    && event.dateConfirmed && Number.isFinite(time(event.startsAt)) && time(event.startsAt) <= now)
    .sort((a, b) => time(b.startsAt) - time(a.startsAt));
  const actions = data.actions.filter(action => action.companyId === companyId && action.status !== "done")
    .sort((a, b) => (Number.isFinite(time(a.dueAt)) ? time(a.dueAt) : Infinity)
      - (Number.isFinite(time(b.dueAt)) ? time(b.dueAt) : Infinity) || a.title.localeCompare(b.title));
  return { strategies, events, upcoming, completed, actions };
}

export function landlordEventGuestSummary(event: EngagementEvent, companyId: string): string {
  const guests = event.guests.filter(guest => guest.companyId === companyId);
  const labels = [
    ["suggested", "suggested"], ["invited", "invited"], ["accepted", "accepted"],
    ["declined", "declined"], ["attended", "attended"], ["no_show", "did not attend"],
  ];
  return labels.flatMap(([status, label]) => {
    const count = guests.filter(guest => guest.status === status).length;
    return count ? [`${count} ${label}`] : [];
  }).join(" · ");
}

export function crmEngagementLink(companyId: string, record?: { event?: string; strategy?: string; action?: string }): string {
  return `/contacts?${new URLSearchParams({ tab: "overview", company: companyId, ...record }).toString()}`;
}
