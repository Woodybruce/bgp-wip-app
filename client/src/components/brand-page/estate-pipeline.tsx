// The Expansion tab's two measured cards (Woody, 2026-11-15: "Yes to all on
// expansion"). Store count: the brand's sites as counted on its own website,
// with what opened and closed between counts. Sites on the way: planning
// applications that name the brand, job adverts for new openings and for
// property people, and what its filed accounts say it plans. All of it is
// public-register data, so a client login reads it too; only BGP staff can
// ask for a fresh count or check.
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPin, Store } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BrandCard, BrandBlockHeading, BrandQuietLine, ShowAll, brandCardAction, useCap } from "./brand-card";

type Site = { label: string; town: string; url: string | null };
interface StoreCountSummary {
  count: number | null; countedAt: string | null; method: "sitemap" | "website_list" | null; sourceUrl: string | null; uk: boolean | null;
  comingSoon: Site[];
  change: null | { since: string; months: number; opened: Site[]; closed: Site[]; net: number };
  history: { countedAt: string; count: number }[];
}
interface PipelineItem { kind: "planning" | "job_new_opening" | "job_property_role"; title: string; town: string | null; authority: string | null; address: string | null; date: string | null; url: string | null; state?: string | null }
interface PipelineSummary {
  checkedAt: string | null; planning: PipelineItem[]; jobs: PipelineItem[]; jobsConfigured: boolean; jobsTotal: number | null;
  jobTowns: { town: string; adverts: number }[]; planningSkipped: string | null;
}
export interface StatedPlans {
  period: string | null; mode?: "text" | "scan"; none?: boolean; failed?: number;
  openings?: { summary: string; count: number | null; quote: string } | null;
  closures?: { summary: string; count: number | null; quote: string } | null;
  capex?: { summary: string; count: number | null; quote: string } | null;
}

const day = (value: string | null | undefined, year = true) => {
  const d = value ? new Date(value) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }) : "";
};
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

function SiteList({ rows, tone, testId }: { rows: Site[]; tone: "opened" | "closed" | "soon"; testId: string }) {
  const cap = useCap(rows, 6);
  return (
    <div data-testid={testId}>
      <ul className="space-y-0.5">
        {cap.shown.map((s, i) => (
          <li key={`${s.label}-${i}`} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-1.5 text-[13px] leading-snug">
            <span className={`font-mono font-semibold ${tone === "opened" ? "text-emerald-700" : tone === "closed" ? "text-red-700" : "text-muted-foreground"}`}>{tone === "opened" ? "+" : tone === "closed" ? "−" : "·"}</span>
            <span className="min-w-0 break-words">
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{s.label}</a> : s.label}
              {s.town && s.town.toLowerCase() !== s.label.toLowerCase() && <span className="text-muted-foreground"> · {s.town}</span>}
            </span>
          </li>
        ))}
      </ul>
      {cap.over && <ShowAll total={rows.length} open={cap.open} onToggle={cap.toggle} testId={`${testId}-all`} />}
    </div>
  );
}

function StoreCountCard({ companyId, staff }: { companyId: string; staff: boolean }) {
  const { toast } = useToast();
  const key = ["/api/brand", companyId, "store-count"];
  const { data } = useQuery<StoreCountSummary>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/store-count`)).json(),
    staleTime: 5 * 60_000, retry: false,
  });
  const recount = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/brand/${companyId}/store-count/refresh`)).json(),
    onSuccess: (fresh: any) => {
      queryClient.setQueryData(key, fresh);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "hunter-score"] });
      if (fresh?.refresh?.ok === false) toast({ title: "The stores could not be counted", description: fresh.refresh.reason || "The website has no page per store that could be counted." });
    },
    onError: (e: any) => toast({ title: "The count did not run", description: e?.message, variant: "destructive" }),
  });
  const action = staff ? <button type="button" className={brandCardAction} disabled={recount.isPending} onClick={() => recount.mutate()} data-testid="button-store-count-refresh">{recount.isPending ? "Counting…" : data?.count != null ? "Count again" : "Count now"}</button> : null;
  if (!data || data.count == null) {
    return staff ? <BrandQuietLine testId="brand-store-count-empty">Stores not counted yet · {action}</BrandQuietLine> : null;
  }
  const change = data.change;
  const where = data.uk === true ? "UK sites" : "sites";
  return (
    <BrandCard
      testId="brand-store-count"
      title={<><Store className="w-3.5 h-3.5" /> Store count</>}
      action={action}
      summary={<>Counted on its own website{data.countedAt ? `, ${day(data.countedAt)}` : ""}{data.method === "website_list" ? " (the list on its locations page)" : ""}{data.uk === null ? ". Country not known" : ""}{data.sourceUrl && <> · <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">source <ExternalLink className="w-2.5 h-2.5" /></a></>}</>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="brand-store-count-value">
          <span><span className="font-mono tabular-nums text-2xl font-semibold leading-none">{data.count.toLocaleString("en-GB")}</span> <span className="text-xs text-muted-foreground">{where}</span></span>
          {change ? (
            <span className="text-[13px]">
              <span className={`font-mono tabular-nums font-semibold ${change.net > 0 ? "text-emerald-700" : change.net < 0 ? "text-red-700" : ""}`}>{change.net > 0 ? "+" : change.net < 0 ? "−" : ""}{Math.abs(change.net)}</span>
              <span className="text-muted-foreground"> net since {day(change.since)}{change.opened.length + change.closed.length > 0 ? ` (${change.opened.length} opened, ${change.closed.length} closed)` : change.net !== 0 ? " (its website was rebuilt between counts, so the sites are not listed)" : ""}</span>
            </span>
          ) : <span className="text-xs text-muted-foreground">First count: openings and closures show from the next one, a month on</span>}
        </div>
        {change && change.opened.length > 0 && <div><BrandBlockHeading count={change.opened.length}>Opened</BrandBlockHeading><SiteList rows={change.opened} tone="opened" testId="brand-store-count-opened" /></div>}
        {change && change.closed.length > 0 && <div><BrandBlockHeading count={change.closed.length}>Closed or removed</BrandBlockHeading><SiteList rows={change.closed} tone="closed" testId="brand-store-count-closed" /></div>}
        {data.comingSoon.length > 0 && <div><BrandBlockHeading count={data.comingSoon.length}>Coming soon</BrandBlockHeading><SiteList rows={data.comingSoon} tone="soon" testId="brand-store-count-soon" /></div>}
      </div>
    </BrandCard>
  );
}

function PipelineRows({ rows, testId }: { rows: PipelineItem[]; testId: string }) {
  const cap = useCap(rows, 5);
  return (
    <div data-testid={testId}>
      <ul className="divide-y divide-border/60">
        {cap.shown.map((item, i) => (
          <li key={`${item.url || item.title}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 py-1.5 first:pt-0 last:pb-0 text-[13px] leading-snug">
            <span className="min-w-0">
              <span className="font-medium">{item.town || item.authority || "Place not given"}</span>
              {item.address && <span className="text-muted-foreground"> · {item.address}</span>}
              <span className="block text-xs text-muted-foreground line-clamp-2 break-words" title={item.title}>
                {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.title}</a> : item.title}
                {item.state ? ` · ${item.state}` : ""}
              </span>
            </span>
            <span className="font-mono tabular-nums text-[11px] text-muted-foreground whitespace-nowrap pt-0.5">{day(item.date, false)}</span>
          </li>
        ))}
      </ul>
      {cap.over && <ShowAll total={rows.length} open={cap.open} onToggle={cap.toggle} testId={`${testId}-all`} />}
    </div>
  );
}

function PipelineCard({ companyId, staff, plans }: { companyId: string; staff: boolean; plans: StatedPlans | null }) {
  const { toast } = useToast();
  const key = ["/api/brand", companyId, "pipeline"];
  const { data } = useQuery<PipelineSummary>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/pipeline`)).json(),
    staleTime: 5 * 60_000, retry: false,
  });
  const recheck = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/brand/${companyId}/pipeline/refresh`)).json(),
    onSuccess: (fresh: any) => {
      queryClient.setQueryData(key, fresh);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "hunter-score"] });
    },
    onError: (e: any) => toast({ title: "The check did not run", description: e?.message, variant: "destructive" }),
  });
  const stated = plans && !plans.none && (plans.openings || plans.closures || plans.capex) ? plans : null;
  const planning = data?.planning || [];
  const jobs = data?.jobs || [];
  const action = staff ? <button type="button" className={brandCardAction} disabled={recheck.isPending} onClick={() => recheck.mutate()} data-testid="button-pipeline-refresh">{recheck.isPending ? "Checking…" : data?.checkedAt ? "Check again" : "Check now"}</button> : null;
  if (!planning.length && !jobs.length && !stated) {
    if (!staff) return null;
    return (
      <BrandQuietLine testId="brand-pipeline-empty">
        {data?.checkedAt ? `No planning applications or new-opening adverts found${data.planningSkipped ? ` (planning: ${data.planningSkipped})` : ""}, checked ${day(data.checkedAt)}` : "Planning applications and job adverts not checked yet"} · {action}
      </BrandQuietLine>
    );
  }
  const yearEnd = stated?.period ? new Date(stated.period).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "";
  return (
    <BrandCard
      testId="brand-pipeline"
      title={<><MapPin className="w-3.5 h-3.5" /> Sites on the way</>}
      action={action}
      summary={data?.checkedAt ? `Planning registers${data.jobsConfigured ? " and job adverts" : ""} checked ${day(data.checkedAt)}` : undefined}
    >
      <div className="space-y-3">
        {stated && (
          <div data-testid="brand-pipeline-plans">
            <BrandBlockHeading>Stated in its accounts{yearEnd ? ` to ${yearEnd}` : ""}</BrandBlockHeading>
            <ul className="space-y-1.5">
              {([["Openings planned", stated.openings], ["Closures planned", stated.closures], ["Capital spend", stated.capex]] as const).filter(([, line]) => !!line).map(([label, line]) => (
                <li key={label} className="text-[13px] leading-snug">
                  <span className="font-medium">{label}:</span> {line!.summary}
                  <span className="block text-xs text-muted-foreground italic break-words">“{line!.quote}”</span>
                </li>
              ))}
            </ul>
            {stated.mode === "scan" && <p className="mt-1 text-[11px] text-muted-foreground">Read from scanned accounts: check the wording against the filing.</p>}
          </div>
        )}
        {planning.length > 0 && <div><BrandBlockHeading count={planning.length}>Planning applications naming it, 12 months</BrandBlockHeading><PipelineRows rows={planning} testId="brand-pipeline-planning" /></div>}
        {jobs.length > 0 && <div><BrandBlockHeading count={jobs.length}>Job adverts: new openings and property roles</BrandBlockHeading><PipelineRows rows={jobs} testId="brand-pipeline-jobs" /></div>}
        {data?.jobsConfigured && (data.jobTowns || []).length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="brand-pipeline-job-towns">
            {data.jobsTotal != null ? `${plural(data.jobsTotal, "live advert")} in all. ` : ""}Most adverts: {data.jobTowns.slice(0, 8).map(t => `${t.town} (${t.adverts})`).join(", ")}
          </p>
        )}
        {staff && data && !data.jobsConfigured && <p className="text-[11px] text-muted-foreground">Job adverts are not switched on yet (they need an Adzuna key).</p>}
        {staff && data?.planningSkipped && <p className="text-[11px] text-muted-foreground">Planning not searched: {data.planningSkipped}.</p>}
      </div>
    </BrandCard>
  );
}

/** The two cards, one under the other. Renders nothing for a client login when there is nothing to show. */
export function EstatePipelineCards({ companyId, staff, plans }: { companyId: string; staff: boolean; plans: StatedPlans | null }) {
  return (
    <>
      <StoreCountCard companyId={companyId} staff={staff} />
      <PipelineCard companyId={companyId} staff={staff} plans={plans} />
    </>
  );
}
