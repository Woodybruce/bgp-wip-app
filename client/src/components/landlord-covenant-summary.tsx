import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { LandlordCovenantReport } from "@shared/landlord-covenant";

export function LandlordCovenantSummary({ companyId, companyName, companyNumber }: {
  companyId: string; companyName: string; companyNumber?: string | null;
}) {
  const { data, isLoading, isError, refetch } = useQuery<LandlordCovenantReport>({
    queryKey: ["/api/landlord-relationships", companyId, "covenant"],
    queryFn: async () => (await apiRequest("GET", `/api/landlord-relationships/${companyId}/covenant`)).json(),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  if (isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading the company and group summary…</p>;
  if (isError || !data) return <p className="text-sm text-muted-foreground">The entity check is unavailable. <button className="underline" onClick={() => refetch()}>Try again</button></p>;
  const interpretation = data.interpretation;
  const overview = data.overview;
  const evidence = [...(overview?.evidence || []), ...(interpretation.evidence || [])];
  return <section aria-label="Covenant summary" className="space-y-2.5" data-testid="landlord-covenant-summary">
    <p className="text-xs text-muted-foreground">Covenant · company &amp; group</p>
    {overview?.warning && <div className="rounded-md border border-amber-300 bg-amber-50/50 p-2.5 space-y-1" role="note">
      <p className="text-sm font-semibold">{overview.warning.title}</p><p className="text-sm leading-relaxed">{overview.warning.summary}</p>
    </div>}
    <h3 className="text-sm font-semibold leading-snug">{overview?.title || interpretation.title}</h3>
    <p className="text-sm leading-relaxed">{overview?.company || interpretation.summary}</p>
    {overview?.group && <p className="text-sm leading-relaxed">{overview.group}</p>}
    {overview?.entityNote && <p className="text-xs leading-relaxed text-muted-foreground">{overview.entityNote}</p>}
    <details className="text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer py-1 underline underline-offset-2">Figures, sources &amp; entity details</summary>
      <div className="space-y-3 pt-2">
        {overview?.financial && <div>
          <p className="font-medium">{overview.financial.companyName} · {overview.financial.companyNumber}</p>
          <p className="mt-0.5">Accounts to {overview.financial.period}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {overview.financial.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd className="font-medium text-foreground">{fact.value}</dd></div>)}
          </dl>
        </div>}
        {evidence.map((item, index) => <p key={index} className="leading-relaxed">{item.text}{" "}<a className="underline underline-offset-2" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceLabel}</a></p>)}
        <div className="border-t pt-2 space-y-1">
          <p className="font-medium">Saved legal entity: {data.companyName}{data.companyNumber ? ` · ${data.companyNumber}` : ""}</p>
          <p className="leading-relaxed">{interpretation.summary}</p>
          {interpretation.dates.map((date, index) => <p key={index}>{date.label}: {new Date(`${date.date}T12:00:00Z`).toLocaleDateString("en-GB", {day:"numeric",month:"short",year:"numeric"})}</p>)}
          {data.assessment && <p>Existing entity assessment: grade {data.assessment.grade} · {new Date(data.assessment.computedAt).toLocaleDateString("en-GB")}</p>}
        </div>
        {[...(overview?.limitations || []), ...interpretation.context].map((item, index) => <p key={index} className="leading-relaxed">{item}</p>)}
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {data.sourceUrl && <a className="underline underline-offset-2" href={data.sourceUrl} target="_blank" rel="noopener noreferrer">Saved entity register · {data.companyNumber}</a>}
          {data.checkedAt && <span>Checked {new Date(data.checkedAt).toLocaleDateString("en-GB", {day:"numeric",month:"short",year:"numeric"})}</span>}
        </div>
      </div>
    </details>
  </section>;
}
