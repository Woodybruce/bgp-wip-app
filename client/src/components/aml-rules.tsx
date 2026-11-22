// BGP's AML rules in short, on Deals, AML, Rules (Woody, 22 November 2026:
// "a summary of the rules and put an auto refresh in there for any hmrc
// updates every 3 months. Make it simplistic and to the point"). The rules
// are shared/aml-rules.ts; the HMRC check is server/aml-rules.ts. Every BGP
// person reads them; the officers check HMRC now and mark them reviewed.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AML_RULES, AML_RULE_REF_LABEL, HMRC_AML_PAGES, hmrcPageUrl,
  type AmlRuleRef, type AmlRulesReview, type HmrcAmlPage, type HmrcChange, type HmrcRulesCheck,
} from "@shared/aml-rules";

interface RulesFeed {
  writtenOn: string;
  check: HmrcRulesCheck | null;
  review: AmlRulesReview | null;
  changes: HmrcChange[];
  nextCheck: string;
  on: boolean;
  canManage: boolean;
}

const KEY = ["/api/aml-rules"];
const day = (iso: string | null | undefined) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"(,.*)?\}$/, "$1");

function Ref({ refKey }: { refKey: AmlRuleRef }) {
  if (refKey in HMRC_AML_PAGES) {
    const page = refKey as HmrcAmlPage;
    return (
      <a href={hmrcPageUrl(page)} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline underline-offset-2 decoration-muted-foreground/40 hover:text-foreground" title={`HMRC: ${HMRC_AML_PAGES[page]}`}>
        {page.toUpperCase()}
      </a>
    );
  }
  const other = AML_RULE_REF_LABEL[refKey as keyof typeof AML_RULE_REF_LABEL];
  return other.url
    ? <a href={other.url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline underline-offset-2 decoration-muted-foreground/40 hover:text-foreground">{other.label}</a>
    : <span className="whitespace-nowrap">{other.label}</span>;
}

export function AmlRulesBoard() {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const { data, isLoading, error } = useQuery<RulesFeed>({ queryKey: KEY });
  const checkNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-rules/check")).json(),
    onSuccess: (d: RulesFeed) => {
      queryClient.setQueryData(KEY, d);
      toast({ title: d.changes.length ? `HMRC changed ${d.changes.length} page${d.changes.length === 1 ? "" : "s"}` : "No HMRC changes" });
    },
    onError: (e: Error) => toast({ title: "Not checked", description: plain(e), variant: "destructive" }),
  });
  const reviewed = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-rules/reviewed", { note: note.trim() || undefined })).json(),
    onSuccess: (d: RulesFeed) => { queryClient.setQueryData(KEY, d); setNote(""); toast({ title: "Marked reviewed" }); },
    onError: (e: Error) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-5 max-w-3xl" data-testid="aml-rules">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">AML rules in short</h2>
          <p className="text-xs text-muted-foreground" data-testid="aml-rules-status">
            {isLoading ? "Loading…" : error ? "Status could not be loaded." : (
              <>
                From HMRC's guidance, {day(data?.writtenOn)}.
                {" "}{data?.review ? `Reviewed by ${data.review.byName || "an officer"}, ${day(data.review.at)}.` : "Not yet reviewed by the Nominated Officer."}
                {" "}{data?.check ? `HMRC checked ${day(data.check.checkedAt)}.` : "HMRC not checked yet."}
                {" "}{data?.on === false ? "Quarterly check is off." : `Next check ${day(data?.nextCheck)}.`}
              </>
            )}
          </p>
        </div>
        {data?.canManage && (
          <Button variant="outline" size="sm" className="h-8" onClick={() => checkNow.mutate()} disabled={checkNow.isPending} data-testid="aml-rules-check-now">
            {checkNow.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Check HMRC now
          </Button>
        )}
      </div>

      {data && (data.changes.length > 0 || data.check?.error) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2.5 text-sm space-y-2" data-testid="aml-rules-changes">
          {data.changes.length > 0 && <p className="font-medium">HMRC has changed {data.changes.length === 1 ? "a page" : `${data.changes.length} pages`} since the last review</p>}
          {data.changes.length > 0 && (
            <ul className="space-y-1">
              {data.changes.map(c => (
                <li key={`${c.page}-${c.at}`} className="text-[13px]">
                  {c.page ? <a href={hmrcPageUrl(c.page)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{c.label}</a> : c.label}
                  <span className="text-muted-foreground"> · {day(c.at)}</span>
                  {c.note && <span className="text-muted-foreground"> · {c.note}</span>}
                </li>
              ))}
            </ul>
          )}
          {data.check?.error && <p className="text-[13px] text-amber-900 dark:text-amber-200">{data.check.error}</p>}
          {data.canManage && data.changes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 w-64 text-sm bg-background" data-testid="aml-rules-review-note" />
              <Button size="sm" className="h-8" onClick={() => reviewed.mutate()} disabled={reviewed.isPending} data-testid="aml-rules-mark-reviewed">
                {reviewed.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Rules still right
              </Button>
            </div>
          )}
        </div>
      )}

      {data?.canManage && !data.review && data.changes.length === 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="aml-rules-first-review">
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 w-64 text-sm" />
          <Button size="sm" variant="outline" className="h-8" onClick={() => reviewed.mutate()} disabled={reviewed.isPending} data-testid="aml-rules-approve">
            {reviewed.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Approve these rules
          </Button>
        </div>
      )}

      <div className="space-y-5">
        {AML_RULES.map(group => (
          <section key={group.title} className="space-y-1.5">
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <ul className="divide-y rounded-md border bg-card">
              {group.rules.map(rule => (
                <li key={rule.text} className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-4 px-3 py-2 text-sm">
                  <span>{rule.text}</span>
                  <span className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground sm:shrink-0 sm:justify-end">
                    {rule.refs.map(r => <Ref key={r} refKey={r} />)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <ExternalLink className="w-3 h-3" /> The codes link to HMRC's own pages. The app checks them every three months and tells the officers if HMRC changes one.
      </p>
    </div>
  );
}
