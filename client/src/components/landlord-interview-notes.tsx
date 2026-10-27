import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { LandlordInterviewMention } from "../../../server/landlord-interview-links";

export function LandlordInterviewNotes({ companyId }: { companyId: string }) {
  const { data = [], isError } = useQuery<LandlordInterviewMention[]>({
    queryKey: ["/api/crm/landlords/interview-links", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/crm/landlords/interview-links?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  if (isError) return <p className="text-sm text-muted-foreground">CRM interview notes could not be loaded.</p>;
  if (!data.length) return null;
  return <div className="space-y-3 border-t border-border pt-3" data-testid="landlord-interview-notes">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From CRM meetings</h3>
    {data.slice(0, 3).map(note => <div key={`${note.interviewId}-${note.questionId}`} className="text-sm space-y-1">
      <p className="whitespace-pre-wrap break-words">{note.excerpt}</p>
      <Link href={note.sourceUrl} className="text-xs text-muted-foreground underline underline-offset-2">
        {note.interviewee || note.team} · {note.meetingDate ? new Date(`${note.meetingDate.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Date not recorded"} · Read interview
      </Link>
    </div>)}
    {data.length > 3 && <Link href="/contacts?tab=meetings" className="text-xs underline">More interview notes</Link>}
  </div>;
}
