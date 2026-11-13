import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { LandlordCovenantReport } from "@shared/landlord-covenant";

const GRADE_STYLE = {
  A: "bg-emerald-700 text-white",
  B: "bg-emerald-700 text-white",
  C: "bg-amber-100 text-amber-900",
  D: "bg-orange-100 text-orange-900",
  E: "bg-red-100 text-red-900",
};

// dense (a brand's Company checks card): the paragraphs are set at 13px, the
// size of the covenant verdict above them in that card.
export function LandlordCovenantSummary({ companyId, companyName, companyNumber, covenantComputedAt, dense = false }: {
  companyId: string; companyName: string; companyNumber?: string | null; covenantComputedAt?: string | null; dense?: boolean;
}) {
  const queryClient = useQueryClient();
  const ratingDetailsId = useId();
  const { data, isLoading, isError, refetch } = useQuery<LandlordCovenantReport>({
    queryKey: ["/api/landlord-relationships", companyId, "covenant"],
    queryFn: async () => (await apiRequest("GET", `/api/landlord-relationships/${companyId}/covenant`)).json(),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  // The shared check can finish after this cache-only summary has loaded.
  // Refresh the summary when that existing report changes; do not run a second check.
  useEffect(() => {
    if (covenantComputedAt) void queryClient.invalidateQueries({ queryKey: ["/api/landlord-relationships", companyId, "covenant"], exact: true });
  }, [queryClient, companyId, covenantComputedAt]);
  if (isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading the company and group summary…</p>;
  if (isError || !data) return <p className="text-sm text-muted-foreground">The entity check is unavailable. <button className="underline" onClick={() => refetch()}>Try again</button></p>;
  const interpretation = data.interpretation;
  const overview = data.overview;
  const assessment = data.assessment;
  const assessedOn = assessment && new Date(assessment.computedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const evidence = [...(overview?.evidence || []), ...(interpretation.evidence || [])];
  return <section aria-label="Covenant summary" className={dense ? "space-y-1.5 [&>h3]:!text-[13px] [&>p.text-sm]:!text-[13px] [&>p.text-sm]:!leading-snug [&_[role=note]_p]:!text-[13px]" : "space-y-2.5"} data-testid="landlord-covenant-summary">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className={dense ? "text-[11px] uppercase tracking-wider text-muted-foreground" : "text-xs text-muted-foreground"}>Covenant · company &amp; group</p>
      {assessment && <span className="inline-flex items-center gap-1.5 text-xs" aria-describedby={ratingDetailsId} data-testid="landlord-covenant-rating">
        <span className="font-medium">BGP covenant</span>
        <span className={`rounded px-2 py-0.5 font-semibold ${GRADE_STYLE[assessment.grade]}`}>{assessment.grade} · {assessment.score}/100</span>
      </span>}
    </div>
    {overview?.warning && <div className="rounded-md border border-amber-300 bg-amber-50/50 p-2.5 space-y-1" role="note">
      <p className="text-sm font-semibold">{overview.warning.title}</p><p className="text-sm leading-relaxed">{overview.warning.summary}</p>
    </div>}
    {/* dense: the label above is the card's one sub-heading style; a title that only repeats it is not printed, any other reads as a line of the text. */}
    {(!dense || !/^company and group covenant\.?$/i.test(String(overview?.title || interpretation.title || "").trim())) && <h3 className={dense ? "text-sm font-medium leading-snug" : "text-sm font-semibold leading-snug"}>{overview?.title || interpretation.title}</h3>}
    <p className="text-sm leading-relaxed">{overview?.company || interpretation.summary}</p>
    {overview?.group && <p className="text-sm leading-relaxed">{overview.group}</p>}
    {overview?.entityNote && <p className="text-xs leading-relaxed text-muted-foreground">{overview.entityNote}</p>}
    <details className="text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer py-1 underline underline-offset-2">Figures, sources &amp; entity details</summary>
      <div className="space-y-3 pt-2">
        {assessment && <div className="space-y-1" id={ratingDetailsId}>
          <p className="font-medium">BGP covenant: {assessment.grade} · {assessment.score}/100 · assessed {assessedOn}</p>
          <p className="leading-relaxed">BGP’s internal A–E assessment of {data.companyName}, based on Companies House, filed accounts and the checks available in the report. This is not an external agency credit rating.</p>
          {!!assessment.missing.length && <p className="leading-relaxed">Checks not completed: {assessment.missing.join("; ")}.</p>}
          {!!assessment.flags.length && <ul className="list-disc pl-4 space-y-0.5">{assessment.flags.map((flag, index) => <li key={index}>{flag.label}{flag.detail ? ` — ${flag.detail}` : ""}</li>)}</ul>}
        </div>}
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
