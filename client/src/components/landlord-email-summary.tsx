import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { AiCommentary, type CommentaryEntity } from "./ai-commentary";
import { BrandEmailHistory, type ThreadsResponse } from "./brand-email-history";
import { LandlordActivityCard } from "./landlord-activity-card";

export function LandlordEmailSummary({ companyId, companyName, entities }: {
  companyId: string; companyName: string; entities?: CommentaryEntity[];
}) {
  const [open, setOpen] = useState(false);
  const attemptedSummary = useRef("");
  const queryClient = useQueryClient();
  const key = ["/api/brand", companyId, "email-threads"];
  const { data, isLoading, isError, refetch } = useQuery<ThreadsResponse>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/brand/${encodeURIComponent(companyId)}/email-threads`)).json(),
    staleTime: 5 * 60_000, retry: false,
  });
  const summarise = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/brand/${encodeURIComponent(companyId)}/email-threads/summary`)).json(),
    onSuccess: (out: { summary: ThreadsResponse["summary"] }) => queryClient.setQueryData<ThreadsResponse>(key, previous => previous && (!out.summary || out.summary.evidenceKey === previous.evidenceKey) ? { ...previous, summary: out.summary } : previous),
  });
  useEffect(() => {
    const evidence = `${companyId}:${data?.evidenceKey || data?.conversations[0]?.last || ""}`;
    if (data?.conversations.length && !data.summary && !summarise.isPending && attemptedSummary.current !== evidence) {
      attemptedSummary.current = evidence;
      summarise.mutate();
    }
  }, [data]);
  const last = data?.conversations[0]?.last;
  return <>
    <LandlordActivityCard title="Email threads" icon={<Mail className="h-4 w-4 text-muted-foreground" />}
      count={data ? `${data.total} threads` : undefined} testId="landlord-email-summary"
      actionLabel="View emails" onOpen={() => setOpen(true)}
      footer={last ? `Latest ${new Date(last).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}` : "Recorded correspondence"}>
      {isLoading ? <p className="text-sm text-muted-foreground animate-pulse">Loading correspondence…</p>
        : isError ? <p role="status" className="text-sm text-muted-foreground">Emails could not be loaded. <button className="underline" onClick={() => refetch()}>Try again</button></p>
        : !data?.conversations.length ? <p className="text-sm text-muted-foreground">No email conversations linked yet.</p>
        : <>
          {data.summary?.text ? <div className="line-clamp-3 text-sm leading-relaxed" data-testid="landlord-email-ai-summary"><AiCommentary text={data.summary.text} size="sm" entities={entities} /></div>
            : <p className="text-sm text-muted-foreground">{summarise.isPending ? "Preparing the email summary…" : "Recent correspondence with the landlord and people copied in."}</p>}
          <div className="divide-y divide-border/60">
            {data.conversations.slice(0, 2).map(conversation => <button key={conversation.subject + conversation.last} onClick={() => setOpen(true)} className="block w-full text-left py-2 first:pt-0 hover:text-primary">
              <p className="text-xs font-medium text-primary">{new Date(conversation.last).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })} · {conversation.messages} {conversation.messages === 1 ? "email" : "emails"}</p>
              <p className="text-sm font-medium truncate mt-0.5">{conversation.subject}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{conversation.preview || "Open to see the people and correspondence."}</p>
            </button>)}
          </div>
        </>}
    </LandlordActivityCard>
    <BrandEmailHistory companyId={companyId} companyName={companyName} open={open} onOpenChange={setOpen} entities={entities} landlord />
  </>;
}
