import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, MapPin, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import type { LandlordMeeting, LandlordMeetingCoverage, LandlordMeetingDigest } from "@shared/landlord-meetings";

export function upcomingLandlordMeetings(meetings: LandlordMeeting[], now = Date.now()): LandlordMeeting[] {
  return meetings.filter(meeting => {
    const start = Date.parse(meeting.start);
    const end = Date.parse(meeting.end);
    return Number.isFinite(start) && (Number.isFinite(end) ? end : start) >= now;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function landlordMeetingWhen(meeting: LandlordMeeting, now = new Date()): string {
  const start = new Date(meeting.start);
  if (Number.isNaN(start.getTime())) return "Time not recorded";
  const dayKey = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const tomorrow = new Date(Date.parse(`${dayKey(now)}T12:00:00Z`) + 86400000);
  const date = dayKey(start) === dayKey(now) ? "Today" : dayKey(start) === dayKey(tomorrow) ? "Tomorrow" : start.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London",
  });
  const time = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return `${date} · ${time}`;
}

export function landlordMeetingCoverageText(coverage?: LandlordMeetingCoverage): string {
  if (!coverage || coverage.status === "not_synced") return "Diaries have not been checked yet. Refresh to find linked invitations.";
  if (coverage.status === "partial") return `Diary coverage is partial (${coverage.mailboxesChecked} of ${coverage.mailboxesExpected} connected diaries checked). Other meetings may be missing.`;
  return `${coverage.mailboxesChecked} connected ${coverage.mailboxesChecked === 1 ? "diary" : "diaries"} checked. Times shown in London time.`;
}

export function LandlordMeetingsSummary({ companyId, canRefresh = true }: { companyId: string; canRefresh?: boolean }) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [refreshRequestedAt, setRefreshRequestedAt] = useState(0);
  const queryKey = ["/api/crm/landlords", companyId, "meetings"];
  const { data, isLoading, isError, refetch } = useQuery<LandlordMeetingDigest>({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/crm/landlords/${encodeURIComponent(companyId)}/meetings`, {
        credentials: "include", headers: getAuthHeaders(), signal,
      });
      if (!response.ok) throw new Error("Linked diary invitations could not be loaded.");
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
    refetchInterval: query => query.state.data?.coverage.refreshing || (refreshRequestedAt > 0 && Date.now() - refreshRequestedAt < 90_000) ? 5_000 : 60_000,
  });
  const refresh = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/crm/landlords/meetings/refresh", {});
      return response.json();
    },
    onSuccess: () => {
      setRefreshRequestedAt(Date.now());
      queryClient.invalidateQueries({ predicate: query =>
        (query.queryKey[0] === "/api/crm/landlords" && query.queryKey[2] === "meetings")
        || query.queryKey[0] === "/api/crm/landlords/meetings/week" });
    },
  });
  const refreshing = refresh.isPending || !!data?.coverage.refreshing;
  const upcoming = upcomingLandlordMeetings(data?.meetings || []);
  const shown = showAll ? upcoming : upcoming.slice(0, 3);
  return <section className="space-y-3 min-w-0" aria-label="Upcoming landlord meetings" data-testid="landlord-upcoming-meetings">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Calendar className="h-4 w-4" />Next meetings</h3>
      {canRefresh && <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refreshing} data-testid="landlord-refresh-meetings">
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "Refreshing…" : "Refresh diaries"}
      </Button>}
    </div>
    {isLoading ? <div className="animate-pulse space-y-2" aria-label="Loading linked invitations"><div className="h-5 w-1/3 bg-muted rounded" /><div className="h-12 bg-muted rounded" /></div>
      : isError ? <div role="status" className="text-sm text-muted-foreground">Linked diary invitations could not be loaded. <button className="underline text-primary" onClick={() => refetch()}>Try again</button></div>
      : upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming invitations linked in the checked diaries.</p>
      : <div className={`grid gap-2 ${showAll ? "max-h-96 overflow-y-auto" : ""}`}>
        {shown.map(meeting => <article key={meeting.id} className="rounded-lg border border-border bg-muted/25 p-3 min-w-0" data-testid="landlord-meeting">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground"><time dateTime={meeting.start}>{landlordMeetingWhen(meeting)}</time></p>
              <p className="text-sm break-words mt-0.5">{meeting.subject || "Calendar meeting"}</p>
            </div>
            {meeting.webLink && <Button asChild size="sm" variant="outline" className="shrink-0"><a href={meeting.webLink} target="_blank" rel="noopener noreferrer">Invitation</a></Button>}
          </div>
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            {meeting.participants.length > 0 && <p className="flex items-start gap-1.5"><Users className="w-3.5 h-3.5 mt-1 shrink-0" /><span className="break-words"><span className="font-medium">On the invitation: </span>{meeting.participants.map(person => person.name || person.email).join(", ")}</span></p>}
            {meeting.bgpParticipants.length > 0 && <p className="pl-5"><span className="font-medium text-foreground">BGP: </span>{meeting.bgpParticipants.map(person => person.name || person.email).join(", ")}</p>}
            {meeting.location && <p className="flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 mt-1 shrink-0" /><span className="break-words">{meeting.location}</span></p>}
          </div>
        </article>)}
      </div>}
    {upcoming.length > 3 && <Button variant="ghost" size="sm" onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer meetings" : `Show all ${upcoming.length} meetings`}</Button>}
    {!isLoading && !isError && <p className="text-[11px] text-muted-foreground" data-testid="landlord-diary-coverage">{landlordMeetingCoverageText(data?.coverage)}
      {data?.coverage.checkedAt && !Number.isNaN(Date.parse(data.coverage.checkedAt)) && <> Last checked {new Date(data.coverage.checkedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}.</>}
    </p>}
    {refresh.isError && <p role="status" className="text-sm text-destructive">The diary refresh could not start. Existing invitations are still shown.</p>}
  </section>;
}
