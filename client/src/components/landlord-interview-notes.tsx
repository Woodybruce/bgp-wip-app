import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { LandlordInterviewMention } from "../../../server/landlord-interview-links";

export function LandlordInterviewNotes({ companyId, onCreateAction }: { companyId: string; onCreateAction?: (note: LandlordInterviewMention) => void }) {
  const { data = [], isError } = useQuery<LandlordInterviewMention[]>({
    queryKey: ["/api/crm/landlords/interview-links", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/crm/landlords/interview-links?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 30_000,
    refetchInterval: false,
  });
  if (isError) return <p className="text-sm text-muted-foreground">CRM interview notes could not be loaded.</p>;
  if (!data.length) return null;
  return <details className="space-y-3 border-t border-border pt-3" data-testid="landlord-interview-notes">
    <summary className="text-sm font-medium cursor-pointer">Team planning notes <span className="font-mono tabular-nums text-muted-foreground">({data.length})</span></summary>
    <p className="text-xs text-muted-foreground">Saved mentions from internal team interviews. A company name or list is context, not an agreed action or a meeting with the client.</p>
    <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
      {data.map(note => <div key={`${note.interviewId}-${note.questionId}`} className="text-sm space-y-2 border-b border-border pb-3 last:border-0 last:pb-0">
        <p className="text-sm font-semibold">{note.questionLabel || "Team planning note"}</p>
        <p className="text-xs font-medium text-muted-foreground">{note.interviewee || note.team} · Internal interview</p>
        {note.questionText && <p className="text-xs text-muted-foreground">{note.questionText}</p>}
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">{note.excerpt}</blockquote>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={note.sourceUrl} className="text-xs text-muted-foreground underline underline-offset-2">Read interview</Link>
          {onCreateAction && <button type="button" onClick={() => onCreateAction(note)} className="text-xs text-primary hover:underline">Create action</button>}
        </div>
      </div>)}
    </div>
  </details>;
}
