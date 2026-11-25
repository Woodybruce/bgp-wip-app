// The red flags on a party, shared by every AML screen: the transaction's
// Parties & AML box and the client KYC window (Woody, 24 November 2026: "one
// build for AML"). Each opens what is behind it, and the officers can set one
// aside with a comment or put it back. The addresses come from the AML scope
// (client/src/lib/aml-scope.tsx): a transaction's, or a client file's.
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Flag, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAmlUrls } from "@/lib/aml-scope";
import { RaiseReportButton } from "@/components/aml-register";
import { useAmlOfficerLabel } from "@/components/aml-policy-panel";
import { FLAG_REVIEW_COMMENT_MIN, isSanctionsFlag, type KycRedFlag, type SetAsideFlag } from "@shared/kyc-red-flags";
import { precheckDay } from "@shared/kyc-prechecks";
import { SET_ASIDE_VERDICT_WORDS, type SetAsideSuggestion } from "@shared/flag-set-aside";

// A red flag makes the party the officers' (enhanced due diligence; it went to
// KYC4U until 23 November 2026, when Woody stopped using them).
// Each opens what is behind it, and the MLRO (admins until one is appointed)
// can set one aside with a comment (Woody, 2026-11-19: "We also need to see
// the detail of the red flag and have the option to ignore with a comment as
// comply advantage is picking up things that are not really a massive problem").
function refreshAml(dealId: string, onChanged?: () => void) {
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
  onChanged?.();
}

function FlagFacts({ flag }: { flag: KycRedFlag }) {
  const facts = flag.facts || [];
  return (
    <dl className="mt-1 space-y-0.5 rounded border border-border bg-background p-2 text-[11px] text-foreground" data-testid={`kyc-flag-facts-${flag.key}`}>
      {facts.map((f, i) => (
        <div key={i}>
          <dt className="inline text-muted-foreground">{f.label}: </dt>
          <dd className="inline break-words">{f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-primary">{f.value}</a> : f.value}</dd>
        </div>
      ))}
      <div><dt className="inline text-muted-foreground">Found by: </dt><dd className="inline">{flag.source}{flag.at ? `, ${precheckDay(flag.at)}` : ""}</dd></div>
    </dl>
  );
}

// The app reads the flag and drafts the reason into the box when the dialog opens (Woody,
// 24 November 2026: "can you get the app to review and put a suggestions of why can set
// aside these flags in this box?"). The officer reads and edits it; Set aside is the only save.
function SetAsideDialog({ dealId, role, flag, onClose, onChanged }: { dealId: string; role: string | null; flag: KycRedFlag; onClose: () => void; onChanged?: () => void }) {
  const { toast } = useToast();
  const urls = useAmlUrls();
  const [comment, setComment] = useState("");
  const [typed, setTyped] = useState(false);
  const suggest = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${urls.redFlags(dealId)}/suggest`, { role, key: flag.key })).json() as Promise<SetAsideSuggestion>,
    onSuccess: (r) => { if (r.comment && !typed) setComment(r.comment); },
  });
  // Asked once, when the box opens.
  useEffect(() => { suggest.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${urls.redFlags(dealId)}/set-aside`, { role, key: flag.key, comment })).json(),
    onSuccess: () => { refreshAml(dealId, onChanged); toast({ title: "Set aside", description: "It stays on the KYC record with your comment, and no longer counts as a red flag." }); onClose(); },
    onError: (e: any) => toast({ title: "Not set aside", description: String(e?.message || e).replace(/^\d{3}:\s*/, ""), variant: "destructive" }),
  });
  const short = comment.trim().length < FLAG_REVIEW_COMMENT_MIN;
  const draft = suggest.data;
  const verdictTone = draft?.verdict === "set_aside" ? "text-foreground" : draft?.verdict === "keep" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="kyc-flag-set-aside-dialog">
        <DialogHeader><DialogTitle>Set this red flag aside</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-medium">{flag.label}</div>
            {flag.detail && <div className="text-muted-foreground text-xs mt-0.5">{flag.detail}</div>}
            <FlagFacts flag={flag} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Why it is not a concern</Label>
            <div className="flex items-start gap-1.5 text-xs" data-testid="kyc-flag-suggestion">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                {suggest.isPending ? <span className="text-muted-foreground">The app is reading the findings…</span>
                  : suggest.isError ? <span className="text-muted-foreground">The app could not draft a reason. Write it yourself.</span>
                  : draft?.verdict ? <span className={verdictTone} data-testid="kyc-flag-suggestion-verdict">{SET_ASIDE_VERDICT_WORDS[draft.verdict]}{draft.comment ? ". Its draft is below: read it and change what you need." : "."}</span>
                  : draft?.unavailable ? <span className="text-muted-foreground" data-testid="kyc-flag-suggestion-unavailable">{draft.unavailable}</span>
                  : null}
                {draft?.comment && typed && comment !== draft.comment && (
                  <button type="button" className="ml-2 underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setComment(draft.comment)} data-testid="kyc-flag-suggestion-use">Use the app's draft</button>
                )}
              </div>
            </div>
            <Textarea value={comment} onChange={e => { setTyped(true); setComment(e.target.value); }} rows={7}
              placeholder={suggest.isPending ? "" : "e.g. The article is about a merger review by the CMA, cleared in 2016: no finding of wrongdoing."} data-testid="input-kyc-flag-comment" />
            <p className="text-[11px] text-muted-foreground">Kept on the KYC record with your name and the date. If the checks find something new about it, it is raised again.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={short || save.isPending} onClick={() => save.mutate()} data-testid="button-kyc-flag-set-aside-save">
            {save.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Set aside
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RedFlagList({ dealId, role, flags, setAside, canDecide, title, step, testId, whoDecides, factors, onChanged, reportDealId }: {
  dealId: string; role: string | null; flags: KycRedFlag[]; setAside: SetAsideFlag[]; canDecide: boolean;
  title: string; step: string; testId: string; whoDecides?: string;
  // The policy's higher-risk factors: amber, not red, and worded as factors.
  factors?: boolean;
  // A client file (no transaction): refresh it after a change; reports are filed with no transaction.
  onChanged?: () => void;
  reportDealId?: string | null;
}) {
  const { toast } = useToast();
  const urls = useAmlUrls();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [asideOpen, setAsideOpen] = useState(false);
  const [dialog, setDialog] = useState<KycRedFlag | null>(null);
  const putBack = useMutation({
    mutationFn: async (reviewId: number) => (await apiRequest("POST", `${urls.redFlags(dealId)}/put-back`, { reviewId })).json(),
    onSuccess: () => { refreshAml(dealId, onChanged); toast({ title: "Put back", description: "It counts as a red flag again." }); },
    onError: (e: any) => toast({ title: "Not put back", description: String(e?.message || e).replace(/^\d{3}:\s*/, ""), variant: "destructive" }),
  });
  if (!flags.length && !setAside.length) return null;
  return (
    <div className="space-y-1.5" data-testid={testId}>
      {flags.length > 0 && (
        <div className={`rounded-md border p-2.5 text-xs ${factors ? "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/20 dark:text-red-200"}`} data-testid={`${testId}-live`}>
          <div className="flex items-center gap-1.5 text-sm font-semibold"><Flag className="w-3.5 h-3.5 shrink-0" />{title}</div>
          <ul className="mt-1.5 space-y-1.5">
            {flags.map((f, i) => {
              const id = `${f.key}-${i}`;
              const open = openKey === id;
              return (
                <li key={id} className="space-y-0.5" data-testid={`kyc-flag-${f.key}`}>
                  <div className="flex items-start gap-1.5">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${factors ? "bg-amber-600" : "bg-red-600"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{f.label}</div>
                      {f.detail && <div className={`${factors ? "text-amber-900/80 dark:text-amber-100/80" : "text-red-800/80 dark:text-red-200/80"} break-words`}>{f.detail}</div>}
                      {f.kind === "sanctions" || (f.kind === "provider_screen" && /sanction/i.test(f.label)) ? (
                        <div className="mt-0.5 font-medium" data-testid={`kyc-flag-ofsi-${f.key}`}>If it is a true match: tell the Nominated Officer now. It is reported to OFSI as soon as practicable, and legal advice is taken before BGP acts further (AML policy J and 3.10).</div>
                      ) : null}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <button type="button" className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline" onClick={() => setOpenKey(open ? null : id)} data-testid={`kyc-flag-detail-${f.key}`}>
                          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{open ? "Hide detail" : "Detail"}
                        </button>
                        {canDecide && (
                          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setDialog(f)} data-testid={`kyc-flag-set-aside-${f.key}`}>Set aside</button>
                        )}
                        {(f.kind === "sanctions" || (f.kind === "provider_screen" && /sanction/i.test(f.label))) && (
                          <RaiseReportButton variant="text" className="underline-offset-2 hover:underline"
                            label={canDecide ? "Record an OFSI report" : "Tell the Nominated Officer"} kind="sanctions" dealId={reportDealId === undefined ? dealId : reportDealId} role={role}
                            seed={`${f.label}.${f.detail ? ` ${f.detail}` : ""}`} officer={canDecide} testId={`kyc-flag-ofsi-report-${f.key}`} />
                        )}
                      </div>
                      {open && <FlagFacts flag={f} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5">{step}{canDecide ? (/aside/.test(step) ? "" : " Or, if one does not apply, set it aside with a comment.") : ` ${whoDecides ? whoDecides.charAt(0).toUpperCase() + whoDecides.slice(1) : "The Nominated Officer or the Deputy"} can set one aside with a comment.`}</p>
        </div>
      )}
      {setAside.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-2 text-xs" data-testid={`${testId}-aside`}>
          <button type="button" className="flex w-full items-center gap-1 text-left text-muted-foreground hover:text-foreground" onClick={() => setAsideOpen(o => !o)}>
            {asideOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {setAside.length} {factors ? "factor" : "red flag"}{setAside.length === 1 ? "" : "s"} set aside
          </button>
          {asideOpen && (
            <ul className="mt-1.5 space-y-1.5">
              {setAside.map(({ flag, review }) => (
                <li key={review.id || flag.key} className="space-y-0.5" data-testid={`kyc-flag-aside-${flag.key}`}>
                  <div className="text-foreground line-through decoration-muted-foreground/60">{flag.label}</div>
                  <div className="text-muted-foreground">Set aside{review.by ? ` by ${review.by}` : ""}{review.at ? `, ${precheckDay(review.at)}` : ""}: “{review.comment}”</div>
                  {/* Set aside by the app itself (id 0): a new match brings it back, nothing to put back by hand. */}
                  {canDecide && review.id > 0 && (
                    <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={putBack.isPending} onClick={() => putBack.mutate(review.id)} data-testid={`kyc-flag-put-back-${flag.key}`}>Put back</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {dialog && <SetAsideDialog dealId={dealId} role={role} flag={dialog} onClose={() => setDialog(null)} onChanged={onChanged} />}
    </div>
  );
}


/**
 * A party's red flags and the policy's higher-risk factors, each in its own
 * list, worded once for every screen: raised with the AML Officer, who checks
 * each one and signs the party off, or sets one aside with a comment.
 * only: the screening step draws both; sanctionsOnly: a small letting's possible sanctions matches alone.
 */
export function RedFlagLists({ dealId, role, flags, setAside, canDecide, whoDecides, only, sanctionsOnly, testKey, onChanged, reportDealId }: {
  dealId: string; role: string | null; flags: KycRedFlag[]; setAside: SetAsideFlag[]; canDecide: boolean; whoDecides?: string;
  only?: "flags" | "factors"; sanctionsOnly?: boolean; testKey: string; onChanged?: () => void; reportDealId?: string | null;
}) {
  // Raised with the AML Officer, not KYC4U (Jack, 23 November 2026).
  const officer = useAmlOfficerLabel();
  const f = flags.filter(x => !sanctionsOnly || isSanctionsFlag(x));
  const a = setAside.filter(x => !sanctionsOnly || isSanctionsFlag(x.flag));
  const common = { dealId, role, canDecide, whoDecides, onChanged, reportDealId };
  return (
    <>
      {only !== "factors" && <RedFlagList {...common}
        flags={f.filter(x => !x.factor)} setAside={a.filter(x => !x.flag.factor)}
        title={`Red flag: raise with ${officer}`}
        step={`${officer} checks each one and signs the party off, or sets a flag aside with a comment.`}
        testId={`kyc-red-flags-${testKey}`} />}
      {only !== "flags" && <RedFlagList {...common} factors
        flags={f.filter(x => x.factor)} setAside={a.filter(x => x.flag.factor)}
        title="Enhanced due diligence: higher-risk factors in BGP's AML policy"
        step={`${officer} checks these and signs the party off, or sets one aside where it does not apply.`}
        testId={`kyc-policy-factors-${testKey}`} />}
    </>
  );
}
