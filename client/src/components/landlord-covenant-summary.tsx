import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AiCommentary } from "@/components/ai-commentary";
import type { LandlordCovenantReport } from "@shared/landlord-covenant";

export function LandlordCovenantSummary({ companyId, companyName, companyNumber }: {
  companyId: string; companyName: string; companyNumber?: string | null;
}) {
  const { data, isLoading, isError, refetch } = useQuery<LandlordCovenantReport>({
    queryKey: ["/api/landlord-relationships", companyId, "covenant"],
    queryFn: async () => (await apiRequest("GET", `/api/landlord-relationships/${companyId}/covenant`)).json(),
    staleTime: 30 * 60_000,
    retry: 1,
    enabled: !!companyNumber,
  });
  if (!companyNumber) return <p className="text-sm text-muted-foreground">Confirm the contracting entity before assessing {companyName}’s covenant.</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground" role="status">Checking the linked legal entity…</p>;
  if (isError || !data) return <p className="text-sm text-muted-foreground">The entity check is unavailable. <button className="underline" onClick={() => refetch()}>Try again</button></p>;
  const interpretation = data.interpretation;
  return <section aria-label="Covenant summary" className="space-y-2.5" data-testid="landlord-covenant-summary">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>Covenant · linked entity</span>
      {data.assessment && <span className="rounded border px-1.5 py-0.5 font-medium">Grade {data.assessment.grade}</span>}
    </div>
    <h3 className="text-sm font-semibold leading-snug">{interpretation.title}</h3>
    <p className="text-xs font-medium text-muted-foreground">{data.companyName} · {data.companyNumber}</p>
    <p className="text-sm leading-relaxed">{interpretation.summary}</p>
    {interpretation.evidence?.map((item, index) => <p key={index} className="text-xs leading-relaxed text-muted-foreground">{item.text}{" "}<a className="underline underline-offset-2" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceLabel}</a></p>)}
    {interpretation.context.map((item, index) => <p key={index} className="text-xs leading-relaxed text-muted-foreground">{item}</p>)}
    {data.assessment?.verdict && <AiCommentary text={data.assessment.verdict} className="text-sm" />}
    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
      {data.sourceUrl && <a className="underline underline-offset-2" href={data.sourceUrl} target="_blank" rel="noopener noreferrer">Companies House · {data.companyNumber}</a>}
      {data.checkedAt && <span>Checked {new Date(data.checkedAt).toLocaleDateString("en-GB", {day:"numeric",month:"short",year:"numeric"})}</span>}
    </div>
  </section>;
}
