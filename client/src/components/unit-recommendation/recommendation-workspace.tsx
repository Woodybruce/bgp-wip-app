// The letting transaction recommendation on a Letting Tracker unit (Woody,
// 2026-11-12: "we also need to provide letting transaction recommendation
// once the HOTs are issued to a tenant"). One dialog: BGP writes the
// recommendation in the form the client asked for (the transaction, how it
// measures against the brief, how the bid moved, comparable evidence and
// commentary), issues it once the Heads of Terms have gone to the tenant,
// and the client's leasing and asset managers decide.
// Types: shared/unit-recommendation.ts. Routes: server/unit-recommendation.ts.
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, CircleCheck, CircleDashed, CircleHelp, CircleX, ClipboardCheck, Download, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, pillActive, pillInactive, pillMetrics } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { briefRoleLabel } from "@shared/unit-brief";
import {
  RECOMMENDATION_COMMENTARY, RECOMMENDATION_OPTIONS, RECOMMENDATION_TERM_FIELDS,
  type RecommendationCommentaryKey, type RecommendationComparable, type RecommendationDecider, type RecommendationDecision,
  type RecommendationOption, type RecommendationTermKey, type RecommendationWorkspace,
} from "@shared/unit-recommendation";
import { HotsError, MICRO_LABEL, TONE_GOOD, TONE_WARN, downloadWithAuth, fmtDate, hotsCall, listNames } from "@/components/unit-hots/hots-api";
import {
  DECISION_COMMENT_MAX, FIGURE, LONG_TEXT_MAX, SECTION, SECTION_TITLE, SUMMARY_MAX, TONE_BAD, count, draftErrors, draftOf, has, patchOf, sameDraft, termDisplay,
  type RecommendationDraft,
} from "./recommendation-format";
import { RecommendationComparables } from "./recommendation-comparables";
import { RecommendationHistory, RecommendationMeasureTable, RecommendationRounds } from "./recommendation-parts";

export interface RecommendationUnitRef { id: string; unitName: string; propertyId: string | null }

export interface RecommendationDialogProps {
  unit: RecommendationUnitRef | null;
  open: boolean;
  onClose: () => void;
  onOpenHots?: () => void;     // open the unit's Heads of Terms (shown while they are not yet issued)
  onOpenOffers?: () => void;   // open the unit's offers (shown when no offer has agreed terms)
  onChanged?: () => void;      // called after every successful write
}

type StepKey = "draft" | "issued" | "decision";
const STEPS: { key: StepKey; label: string }[] = [{ key: "draft", label: "Draft" }, { key: "issued", label: "Issued" }, { key: "decision", label: "Decision" }];
type IssueAnswer = RecommendationWorkspace & { emailed: number; emailFailed: string[]; emailReason: string | null; alreadyIssued?: boolean };
type Deciding = { personId: string; decision: RecommendationDecision; comment: string };

const optionTone = (key: RecommendationOption | null): string => {
  const tone = RECOMMENDATION_OPTIONS.find(o => o.key === key)?.tone;
  return tone === "good" ? TONE_GOOD : tone === "warn" ? TONE_WARN : tone === "bad" ? TONE_BAD : "";
};
const sentence = (s: string): string => { const t = s.trim(); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : ""; };

export function RecommendationDialog({ unit, open, onClose, onOpenHots, onOpenOffers, onChanged }: RecommendationDialogProps) {
  // The body says whether there are unsaved changes, so closing can warn.
  const dirtyRef = useRef(false);
  const requestClose = () => {
    if (dirtyRef.current && !window.confirm("You have changes that are not saved. Close without saving them?")) return;
    dirtyRef.current = false;
    onClose();
  };
  return (
    <Dialog open={open && !!unit} onOpenChange={v => { if (!v) requestClose(); }}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-5xl flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90vh] sm:w-full sm:rounded-lg"
        data-testid="recommendation-dialog"
      >
        {unit && <RecommendationBody key={unit.id} unit={unit} dirtyRef={dirtyRef} onOpenHots={onOpenHots} onOpenOffers={onOpenOffers} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}

function RecommendationBody({ unit, dirtyRef, onOpenHots, onOpenOffers, onChanged }: {
  unit: RecommendationUnitRef;
  dirtyRef: MutableRefObject<boolean>;
  onOpenHots?: () => void;
  onOpenOffers?: () => void;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const api = `/api/unit-recommendations/${unit.id}`;
  const queryKey = useMemo(() => ["/api/unit-recommendations", unit.id], [unit.id]);
  // Always asked afresh on opening: the offers and the Heads of Terms change in other dialogs.
  const query = useQuery<RecommendationWorkspace, HotsError>({ queryKey, queryFn: () => hotsCall<RecommendationWorkspace>("GET", api), retry: false, refetchOnMount: "always" });
  const ws = query.data;

  const [busy, setBusy] = useState<string | null>(null);
  // The working copy in the form, and the saved state it was loaded from.
  const [draft, setDraft] = useState<RecommendationDraft | null>(null);
  const [base, setBase] = useState<{ version: number; draft: RecommendationDraft } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  // What "Help me write it" answered when it could not help, by section.
  const [helpNote, setHelpNote] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<Deciding | null>(null);
  const [changing, setChanging] = useState<string | null>(null);

  const dirty = !!base && !!draft && !sameDraft(draft, base.draft);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty, dirtyRef]);
  useEffect(() => () => { dirtyRef.current = false; }, [dirtyRef]);
  // Follow the server unless the person is part-way through a change; then
  // their text stays and the stale note offers the latest.
  useEffect(() => {
    if (!ws) return;
    const next = draftOf(ws);
    if (!base || (!dirty && (ws.version !== base.version || !sameDraft(next, base.draft)))) {
      setBase({ version: ws.version, draft: next });
      setDraft(next);
    }
  }, [ws, base, dirty]);
  const stale = !!ws && !!base && dirty && ws.version !== base.version;

  const adopt = (next: RecommendationWorkspace) => {
    const d = draftOf(next);
    setBase({ version: next.version, draft: d });
    setDraft(d);
    setShowErrors(false);
  };
  const put = (next: RecommendationWorkspace) => queryClient.setQueryData(queryKey, next);
  const afterWrite = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["/api/unit-recommendations/summary"] });
    onChanged?.();
  };
  const run = async (key: string, failTitle: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      afterWrite();
    } catch (e) {
      const err = e as HotsError;
      toast({ title: failTitle, description: err.message || "Try again.", variant: "destructive" });
      if (err.status === 409 || err.status === 404) query.refetch();
    } finally {
      setBusy(null);
    }
  };

  const errors = useMemo(() => (draft ? draftErrors(draft) : {}), [draft]);
  const setTerm = (key: RecommendationTermKey, value: string) => setDraft(d => (d ? { ...d, terms: { ...d.terms, [key]: value } } : d));
  const setCommentary = (key: RecommendationCommentaryKey, value: string) => setDraft(d => (d ? { ...d, commentary: { ...d.commentary, [key]: value } } : d));
  const setSummary = (value: string) => setDraft(d => (d ? { ...d, summary: value } : d));
  const setOption = (value: RecommendationOption | null) => setDraft(d => (d ? { ...d, recommendation: value } : d));
  const setComparables = (rows: RecommendationComparable[]) => setDraft(d => (d ? { ...d, comparables: rows } : d));

  // ── Start, save, refresh ────────────────────────────────────────────
  const start = () => run("start", "The recommendation was not started", async () => {
    const next = await hotsCall<RecommendationWorkspace>("POST", `${api}/start`, {});
    put(next);
    adopt(next);
    toast({ title: "Recommendation started", description: "The terms are filled from the agreed offer. Check them, then write the commentary." });
  });
  const save = async () => {
    if (busy || !base || !draft || !dirty || !ws) return;
    if (Object.keys(errors).length) {
      // The boxes are marked and the save bar says so: no toast over the Save button.
      setShowErrors(true);
      return;
    }
    setBusy("save");
    try {
      const next = await hotsCall<RecommendationWorkspace>("PUT", `${api}/content`, { baseVersion: base.version, ...patchOf(base.draft, draft) });
      put(next);
      adopt(next);
      if (next.version !== base.version) toast({ title: "Changes saved", description: `Version ${next.version}. The client is asked to decide on this version.` });
      else toast({ title: "Changes saved" });
      afterWrite();
    } catch (e) {
      const err = e as HotsError;
      const latest = err.code === "STALE" ? (err.data?.workspace as RecommendationWorkspace | undefined) : undefined;
      // Someone else changed it: keep this person's text, show the note.
      if (latest) put(latest);
      else {
        toast({ title: "Changes not saved", description: err.message || "Try again.", variant: "destructive" });
        if (err.status === 409 || err.status === 404) query.refetch();
      }
    } finally {
      setBusy(null);
    }
  };
  const discard = () => {
    if (!ws || !window.confirm("Discard your unsaved changes?")) return;
    adopt(ws);
  };
  const loadLatest = () => {
    if (!ws) return;
    if (!window.confirm("Load the latest version? What you typed is replaced, so copy anything you want to keep first.")) return;
    adopt(ws);
  };
  const refresh = () => {
    if (!ws) return;
    if (ws.issuedAt && !window.confirm("Refresh the terms from the agreed offer? If a term changes, the recommendation goes back to the client for decision.")) return;
    run("refresh", "The terms were not refreshed", async () => {
      const next = await hotsCall<RecommendationWorkspace & { refreshed?: boolean }>("POST", `${api}/refresh`, {});
      put(next);
      adopt(next);
      toast(next.refreshed ? { title: "Terms refreshed from the agreed offer", description: "What you wrote yourself is unchanged." } : { title: "Nothing to refresh", description: "The terms already match the agreed offer." });
    });
  };
  const download = async () => {
    if (busy || !ws) return;
    setBusy("pdf");
    try {
      await downloadWithAuth(`${api}/pdf`, `Recommendation - ${ws.unit.unitName}.pdf`);
    } catch (e) {
      toast({ title: "The PDF could not be downloaded", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // ── Help me write it ────────────────────────────────────────────────
  const help = async (section: "summary" | RecommendationCommentaryKey) => {
    if (busy || !draft) return;
    setBusy(`help:${section}`);
    setHelpNote(n => ({ ...n, [section]: "" }));
    try {
      const out = await hotsCall<{ text: string }>("POST", `${api}/draft-ai`, { section });
      const current = section === "summary" ? draft.summary : draft.commentary[section];
      if (current.trim() && !window.confirm("Replace what is in the box with the draft? Cancel keeps your text.")) return;
      if (section === "summary") setSummary(out.text); else setCommentary(section, out.text);
    } catch (e) {
      // What the person typed stays as it is.
      setHelpNote(n => ({ ...n, [section]: (e as Error).message || "AI help is not available. Write the section yourself." }));
    } finally {
      setBusy(null);
    }
  };

  // ── Issue, decide ───────────────────────────────────────────────────
  const issue = () => {
    if (!ws) return;
    const client = ws.unit.clientName || "the client";
    const names = ws.deciders.map(d => d.name);
    const who = names.length ? `${listNames(names)} ${names.length === 1 ? "is" : "are"} emailed and asked to decide.` : "Nobody from the client is on the Targeting Brief, so nobody is emailed or asked to decide.";
    if (!window.confirm(`Issue ${ws.issuedAt ? `version ${ws.version} of the recommendation` : "the recommendation"} to ${client}?\n\n${who}`)) return;
    run("issue", "The recommendation was not issued", async () => {
      const next = await hotsCall<IssueAnswer>("POST", `${api}/issue`, {});
      put(next);
      if (next.emailFailed.length) toast({ title: "Issued, but not everyone was emailed", description: `Not emailed: ${listNames(next.emailFailed)}. ${next.emailReason || ""} Tell them yourself.` });
      else toast({ title: "Recommendation issued", description: next.emailed ? `${count(next.emailed, "person", "people")} emailed.` : undefined });
    });
  };
  const decide = (d: RecommendationDecider, decision: RecommendationDecision, comment: string) => {
    if (!ws) return;
    const word = decision === "approved" ? "approved" : decision === "query" ? "raised a query on" : "declined";
    if (!d.isMe && !window.confirm(`Record that ${d.name} has ${word} version ${ws.version} of the recommendation? The record will show that you recorded it.`)) return;
    run(`decide:${d.briefPersonId}`, "The decision was not recorded", async () => {
      put(await hotsCall<RecommendationWorkspace>("POST", `${api}/decide`, {
        version: ws.version, decision, ...(comment.trim() ? { comment: comment.trim() } : {}), ...(d.isMe ? {} : { briefPersonId: d.briefPersonId }),
      }));
      setDeciding(null);
      setChanging(null);
    });
  };

  const header = (
    <DialogHeader className="space-y-1 text-left">
      <DialogTitle className="flex items-start gap-2 pr-8 text-left">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">Transaction recommendation: {ws?.unit.unitName || unit.unitName}</span>
      </DialogTitle>
      <DialogDescription className="text-left">
        {ws ? [ws.unit.propertyName, ws.unit.clientName, ws.unit.dealRef !== null ? `Deal #${ws.unit.dealRef}` : ""].filter(Boolean).join(" · ") || "Letting Tracker unit" : "Loading the recommendation"}
      </DialogDescription>
    </DialogHeader>
  );

  if (!ws || !draft) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        {header}
        {query.isError ? (
          <div className="space-y-3 rounded-lg border border-dashed p-6 text-center" data-testid="recommendation-load-error">
            <CircleAlert className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="text-sm">{query.error?.message || "The recommendation could not be loaded."}</p>
            {query.error?.status !== 403 && query.error?.status !== 404 && (
              <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()} data-testid="recommendation-retry">Try again</Button>
            )}
          </div>
        ) : (
          <div className="space-y-3" data-testid="recommendation-loading">
            <Skeleton className="h-6 w-full max-w-md" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </div>
    );
  }

  const { stage, viewer, approval } = ws;
  const started = !!ws.id;
  const issued = !!ws.issuedAt;
  const canEdit = viewer.canEdit && started;
  const client = ws.unit.clientName || "the client";
  const tenant = has(ws.terms.tenant) ? String(ws.terms.tenant) : ws.offer?.companyName || "The tenant";
  const done: Record<StepKey, boolean> = { draft: issued, issued, decision: stage === "approved" };
  const current: StepKey = issued ? "decision" : "draft";
  const changedSinceIssue = issued && ws.issuedVersion !== null && ws.issuedVersion !== ws.version;
  const waiting = ws.deciders.filter(d => d.decision !== "approved").map(d => d.name);
  const decliners = ws.deciders.filter(d => d.decision === "declined").map(d => d.name);
  const statusLine =
    !started ? (ws.ready.agreedOffer ? "Not started. An offer has agreed terms, so the recommendation can be written." : "Not started. The recommendation is written once an offer has agreed terms.")
    : stage === "draft" ? `Draft. Not yet issued to ${client}.`
    : stage === "approved" ? `Approved by ${approval.total === 1 ? ws.deciders[0].name : `all ${approval.total} decision-makers`} on ${fmtDate(ws.decidedAt)}.`
    : stage === "declined" ? `${listNames(decliners)} declined version ${ws.version}.`
    : approval.total === 0 ? `Issued to ${client} on ${fmtDate(ws.issuedAt)}. Nobody from the client is on the brief to decide it.`
    : `Issued to ${client} on ${fmtDate(ws.issuedAt)}. ${approval.approved} of ${approval.total} approved. Waiting for ${listNames(waiting)}.`;

  const errorOf = (key: string): string | undefined => (showErrors ? errors[key] : undefined);
  const canIssueNow = viewer.canIssue && started && (!issued || changedSinceIssue) && ws.ready.hotsIssued && ws.missing.length === 0 && !dirty;
  const myRow = ws.deciders.find(d => d.isMe) || null;
  // One filled button at a time: save, else start, else issue, else approve.
  const issueIsPrimary = canIssueNow && !dirty;
  const approveIsPrimary = !dirty && !issueIsPrimary && issued && !!myRow && !myRow.decision;
  // Who could not be emailed when this version was issued (BGP staff only see the line).
  const emailFailed = issued ? [...ws.events].reverse().find(e => e.kind === "email_failed" && e.version === ws.issuedVersion) || null : null;

  const helpButton = (section: "summary" | RecommendationCommentaryKey) => (
    <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => help(section)} data-testid={`recommendation-help-${section}`}>
      {busy === `help:${section}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}Help me write it
    </Button>
  );
  const helpLine = (section: string) => !!helpNote[section] && (
    <p className={cn("flex items-start gap-1.5 text-xs", TONE_WARN)} role="status" data-testid={`recommendation-help-note-${section}`}>
      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {helpNote[section]}
    </p>
  );
  const lengthLine = (text: string, max: number) => text.length > max * 0.85 && (
    <span className={cn("text-xs", text.trim().length > max ? TONE_BAD : "text-muted-foreground")}>{text.trim().length.toLocaleString("en-GB")} of {max.toLocaleString("en-GB")} characters</span>
  );

  // The facts the app knows, beside the heading they bear on.
  const priority = ws.facts.targetPriority ? (/priority/i.test(ws.facts.targetPriority) ? ws.facts.targetPriority : `Priority ${ws.facts.targetPriority}`) : "";
  const factLine: Partial<Record<RecommendationCommentaryKey, string>> = {
    againstErv: [ws.measure.headlineVsErvPct !== null ? `Headline rent is ${ws.measure.headlineVsErvPct}% of ERV.` : "", ws.measure.nerVsFloorPct !== null ? `Net effective rent is ${ws.measure.nerVsFloorPct}% of the floor.` : ""].filter(Boolean).join(" "),
    strategyFit: `${ws.facts.onTargetList ? `${tenant} is on this unit's target list${priority ? `, ${priority}` : ""}.` : `${tenant} is not on this unit's target list.`} ${ws.facts.briefAgreed ? "The Targeting Brief is agreed." : "The Targeting Brief is not yet agreed."}`,
    otherInterest: `${count(ws.facts.otherOffers, "other offer", "other offers")} on this unit, ${count(ws.facts.viewingsHeld, "viewing", "viewings")} held, ${count(ws.facts.interestLogged, "enquiry", "enquiries")} logged.`,
  };

  // ── The decision block for one decider ──────────────────────────────
  const deciderState = (d: RecommendationDecider): ReactNode => {
    const by = d.recordedOnBehalf && d.decidedByName ? <span className="font-normal text-muted-foreground"> · recorded by {d.decidedByName}</span> : null;
    if (d.decision === "approved") return <span className={cn("inline-flex flex-wrap items-center gap-x-1 font-medium", TONE_GOOD)}><CircleCheck className="h-3.5 w-3.5 shrink-0" /> Approved {fmtDate(d.decidedAt)}{by}</span>;
    if (d.decision === "query") return <span className={cn("inline-flex flex-wrap items-start gap-x-1 font-medium", TONE_WARN)}><CircleHelp className="mt-px h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">Query raised {fmtDate(d.decidedAt)}: {d.comment}{by}</span></span>;
    if (d.decision === "declined") return <span className={cn("inline-flex flex-wrap items-start gap-x-1 font-medium", TONE_BAD)}><CircleX className="mt-px h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">Declined {fmtDate(d.decidedAt)}: {d.comment}{by}</span></span>;
    if (d.staleDecision) return <span className={cn("inline-flex items-start gap-1 font-medium", TONE_WARN)}><CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> Decided an earlier version</span>;
    return <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleDashed className="h-3.5 w-3.5 shrink-0" /> Awaiting decision</span>;
  };
  const deciderActions = (d: RecommendationDecider): ReactNode => {
    const mayAct = issued && !ws.viewer.isStaff ? d.isMe && viewer.canDecide : issued && viewer.isStaff && (d.isMe || !d.userId);
    if (!mayAct) {
      return issued && viewer.isStaff && !!d.userId && !d.decision
        ? <p className="text-xs text-muted-foreground" data-testid={`recommendation-decider-has-login-${d.briefPersonId}`}>Has a login, decides for themselves</p> : null;
    }
    const id = d.briefPersonId;
    const open = deciding?.personId === id ? deciding : null;
    const working = busy === `decide:${id}`;
    // Decided on this version: the choices come back only when asked for.
    if (d.decision && changing !== id && !open) {
      return (
        <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => setChanging(id)} data-testid={`recommendation-change-decision-${id}`}>
          {d.isMe ? "Change my decision" : "Change the recorded decision"}
        </Button>
      );
    }
    if (!d.isMe && changing !== id && !open) {
      return (
        <Button type="button" variant="outline" size="sm" disabled={!!busy || dirty} onClick={() => setChanging(id)} aria-label={`Record a decision for ${d.name}`} data-testid={`recommendation-record-${id}`}>
          Record a decision
        </Button>
      );
    }
    const commentError = !!open && !open.comment.trim() ? (open.decision === "query" ? "Say what the query is." : "Say why it is declined.") : open && open.comment.trim().length > DECISION_COMMENT_MAX ? `Too long: the limit is ${DECISION_COMMENT_MAX.toLocaleString("en-GB")} characters.` : "";
    return (
      <div className="space-y-2" data-testid={`recommendation-decide-${id}`}>
        {!d.isMe && <p className="text-xs text-muted-foreground">Record {d.name}'s decision once they have confirmed it, for example by email. The record shows that you recorded it.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={approveIsPrimary && d.isMe && !open ? "default" : "outline"} disabled={!!busy || dirty} onClick={() => decide(d, "approved", "")} data-testid={`recommendation-approve-${id}`}>
            {working && !open ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}Approve
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!!busy || dirty} aria-pressed={open?.decision === "query"} onClick={() => setDeciding({ personId: id, decision: "query", comment: open?.comment || "" })} data-testid={`recommendation-query-${id}`}>
            Raise a query
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!!busy || dirty} aria-pressed={open?.decision === "declined"} onClick={() => setDeciding({ personId: id, decision: "declined", comment: open?.comment || "" })} data-testid={`recommendation-decline-${id}`}>
            Decline
          </Button>
          {(open || changing === id) && (
            <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => { setDeciding(null); setChanging(null); }} data-testid={`recommendation-decide-cancel-${id}`}>Cancel</Button>
          )}
        </div>
        {open && (
          <div className="space-y-1.5">
            <Label htmlFor={`recommendation-decision-comment-${id}`} className="text-xs">{open.decision === "query" ? "What is the query?" : "Why is it declined?"}</Label>
            <Textarea id={`recommendation-decision-comment-${id}`} value={open.comment} onChange={e => setDeciding({ ...open, comment: e.target.value })} className="min-h-[72px]" data-testid={`recommendation-decision-comment-${id}`} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!!busy || !!commentError} onClick={() => decide(d, open.decision, open.comment)} data-testid={`recommendation-decision-send-${id}`}>
                {working && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{open.decision === "query" ? "Send the query" : "Decline the recommendation"}
              </Button>
              {commentError && <span className="text-xs text-muted-foreground" data-testid={`recommendation-decision-comment-hint-${id}`}>{commentError}</span>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="shrink-0 space-y-3 border-b px-4 pb-3 pt-4 sm:px-6 sm:pt-6">
        {header}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ol className="flex flex-wrap gap-1.5" aria-label="Progress" data-testid="recommendation-steps">
            {STEPS.map(s => (
              <li key={s.key}>
                <span
                  className={cn(pillMetrics, s.key === current ? pillActive : pillInactive, done[s.key] && s.key !== current && "text-foreground")}
                  aria-current={s.key === current ? "step" : undefined}
                  data-state={s.key === current ? "current" : done[s.key] ? "done" : "todo"}
                  data-testid={`recommendation-step-${s.key}`}
                >
                  {done[s.key] && <Check className="h-3 w-3" aria-label="Done" />}
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
          {/* A pill, so it sits on the steps' row on a phone instead of taking a row of its own. */}
          {started && (
            <button type="button" data-no-min-touch disabled={!!busy} onClick={download} aria-label="Download PDF"
              className={cn(pillMetrics, pillInactive, "text-foreground disabled:opacity-50")} data-testid="recommendation-download-pdf">
              {busy === "pdf" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              <span className="hidden sm:inline">Download </span>PDF
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3 sm:px-6" data-testid="recommendation-scroll">
        <div className="min-w-0 space-y-1">
          <p className="text-sm" data-testid="recommendation-status-line">{statusLine}</p>
          {started && <p className="text-xs text-muted-foreground" data-testid="recommendation-version-line">Version <span className={FIGURE}>{ws.version}</span>. Subject to contract.</p>}
          {dirty && started && <p className="text-xs text-muted-foreground">The PDF is the saved version, without the changes you have not saved.</p>}
        </div>

        {!started && (
          <div className="space-y-3 rounded-lg border border-dashed p-5 text-center" data-testid="recommendation-not-started">
            <ClipboardCheck className="mx-auto h-6 w-6 text-muted-foreground" />
            {!viewer.canEdit ? (
              <p className="text-sm text-muted-foreground" data-testid="recommendation-not-written">The agents have not written the recommendation for this letting yet.</p>
            ) : ws.ready.agreedOffer ? (
              <>
                <p className="text-sm">The recommendation starts from the agreed offer. The terms are filled in for you to check, then you write the commentary.</p>
                <Button type="button" disabled={!!busy} onClick={start} className="h-auto min-h-9 whitespace-normal py-2" data-testid="recommendation-start">
                  {busy === "start" && <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" />}Start the recommendation from {ws.offer?.companyName ? `${ws.offer.companyName}'s` : "the"} agreed terms
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm" data-testid="recommendation-no-agreed-offer">No offer has agreed terms yet.</p>
                {onOpenOffers && <Button type="button" onClick={onOpenOffers} data-testid="recommendation-open-offers">Open offers</Button>}
              </>
            )}
          </div>
        )}

        {started && (
          <>
            {/* 1. The recommendation: first, so a busy reader gets it. */}
            <section className={SECTION} data-testid="recommendation-section-recommendation">
              <h3 className={SECTION_TITLE}>The recommendation</h3>
              {canEdit ? (
                <>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="The recommendation">
                    {RECOMMENDATION_OPTIONS.map(o => (
                      <Pill key={o.key} active={draft.recommendation === o.key} aria-pressed={draft.recommendation === o.key}
                        onClick={() => setOption(draft.recommendation === o.key ? null : o.key)} data-testid={`recommendation-option-${o.key}`}>
                        {o.label}
                      </Pill>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="recommendation-summary" className="text-xs">Summary: what we recommend and why, in a paragraph</Label>
                      {helpButton("summary")}
                    </div>
                    <Textarea id="recommendation-summary" value={draft.summary} onChange={e => setSummary(e.target.value)} className="min-h-[110px] leading-relaxed" aria-invalid={!!errorOf("summary")} data-testid="recommendation-summary" />
                    {errorOf("summary") && <p className={cn("text-xs", TONE_BAD)} role="alert">{errorOf("summary")}</p>}
                    {lengthLine(draft.summary, SUMMARY_MAX)}
                    {helpLine("summary")}
                  </div>
                </>
              ) : (
                <>
                  <p className={cn("text-base font-semibold", optionTone(ws.recommendation))} data-testid="recommendation-option-read">
                    {RECOMMENDATION_OPTIONS.find(o => o.key === ws.recommendation)?.label || <span className="text-sm font-normal text-muted-foreground">No recommendation chosen yet.</span>}
                  </p>
                  {ws.summary
                    ? <p className="whitespace-pre-line break-words text-sm leading-relaxed" data-testid="recommendation-summary-read">{ws.summary}</p>
                    : <p className="text-sm text-muted-foreground" data-testid="recommendation-summary-read">The summary has not been written yet.</p>}
                </>
              )}
            </section>

            {/* 2. The transaction. */}
            <section className={SECTION} data-testid="recommendation-section-transaction">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={SECTION_TITLE}>The transaction</h3>
                {canEdit && (
                  <Button type="button" variant="ghost" size="sm" disabled={!!busy || dirty || !ws.ready.agreedOffer} onClick={refresh}
                    title={dirty ? "Save or discard your changes first" : !ws.ready.agreedOffer ? "No offer has agreed terms now" : undefined} data-testid="recommendation-refresh">
                    {busy === "refresh" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}Refresh from the agreed offer
                  </Button>
                )}
              </div>
              {ws.offer && (
                <p className="text-xs text-muted-foreground" data-testid="recommendation-offer-line">
                  From {ws.offer.companyName ? `${ws.offer.companyName}'s` : "the"} agreed offer of {fmtDate(ws.offer.offerDate)}.{canEdit ? " Correct anything that has moved since." : ""}
                </p>
              )}
              {canEdit ? (
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  {RECOMMENDATION_TERM_FIELDS.map(f => {
                    const id = `recommendation-term-${f.key}`;
                    const error = errorOf(`term:${f.key}`);
                    const hint = "hint" in f ? f.hint : undefined;
                    const value = draft.terms[f.key];
                    return (
                      <div key={f.key} className={cn("min-w-0 space-y-1", f.kind === "longtext" && "sm:col-span-2")}>
                        <Label htmlFor={id} className="text-xs">{f.label}</Label>
                        {f.kind === "longtext" ? (
                          <Textarea id={id} value={value} onChange={e => setTerm(f.key, e.target.value)} className="min-h-[72px]" aria-invalid={!!error} data-testid={id} />
                        ) : f.kind === "money" ? (
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">£</span>
                            <Input id={id} value={value} onChange={e => setTerm(f.key, e.target.value)} inputMode="decimal" className={cn("pl-7 text-right", FIGURE)} aria-invalid={!!error} data-testid={id} />
                          </div>
                        ) : (
                          <Input id={id} value={value} onChange={e => setTerm(f.key, e.target.value)} inputMode={f.kind === "number" ? "decimal" : undefined}
                            className={cn(f.kind === "number" && `text-right ${FIGURE}`)} aria-invalid={!!error} data-testid={id} />
                        )}
                        {error ? <p className={cn("text-xs", TONE_BAD)} role="alert" data-testid={`${id}-error`}>{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2" data-testid="recommendation-terms-read">
                  {RECOMMENDATION_TERM_FIELDS.filter(f => has(ws.terms[f.key])).map(f => (
                    <div key={f.key} className={cn("min-w-0", f.kind === "longtext" && "sm:col-span-2")} data-testid={`recommendation-term-read-${f.key}`}>
                      <dt className={MICRO_LABEL}>{f.label}</dt>
                      <dd className={cn("whitespace-pre-line break-words text-sm", (f.kind === "money" || f.kind === "number") && "tabular-nums")}>{termDisplay(f, ws.terms[f.key])}</dd>
                    </div>
                  ))}
                  {!RECOMMENDATION_TERM_FIELDS.some(f => has(ws.terms[f.key])) && <p className="text-sm text-muted-foreground">No terms have been entered yet.</p>}
                </dl>
              )}
            </section>

            {/* 3. Against the brief. 4. How the bid moved. */}
            <RecommendationMeasureTable measure={ws.measure} rentPa={typeof ws.terms.rentPa === "number" ? ws.terms.rentPa : null} dirty={dirty} />
            <RecommendationRounds rounds={ws.rounds} />

            {/* 5. Comparable evidence. */}
            <RecommendationComparables rows={canEdit ? draft.comparables : ws.comparables} canEdit={canEdit} api={api} onChange={setComparables} />

            {/* 6. Commentary. */}
            <section className={SECTION} data-testid="recommendation-section-commentary">
              <h3 className={SECTION_TITLE}>Commentary</h3>
              <div className="space-y-4">
                {RECOMMENDATION_COMMENTARY.map(c => {
                  const id = `recommendation-commentary-${c.key}`;
                  const error = errorOf(`commentary:${c.key}`);
                  const hint = "hint" in c ? c.hint : undefined;
                  const fact = factLine[c.key];
                  return (
                    <div key={c.key} className="min-w-0 space-y-1.5" data-testid={`recommendation-commentary-block-${c.key}`}>
                      <div className="flex flex-wrap items-center justify-between gap-x-2">
                        <Label htmlFor={canEdit ? id : undefined} className="text-sm font-medium">{c.label}</Label>
                        {canEdit && helpButton(c.key)}
                      </div>
                      {hint && canEdit && <p className="text-xs text-muted-foreground">{hint}</p>}
                      {fact && <p className="text-xs text-muted-foreground" data-testid={`recommendation-fact-${c.key}`}>{fact}</p>}
                      {canEdit ? (
                        <>
                          <Textarea id={id} value={draft.commentary[c.key]} onChange={e => setCommentary(c.key, e.target.value)} className="min-h-[96px] leading-relaxed" aria-invalid={!!error} data-testid={id} />
                          {error && <p className={cn("text-xs", TONE_BAD)} role="alert">{error}</p>}
                          {lengthLine(draft.commentary[c.key], LONG_TEXT_MAX)}
                          {helpLine(c.key)}
                        </>
                      ) : ws.commentary[c.key] ? (
                        <p className="whitespace-pre-line break-words text-sm leading-relaxed" data-testid={`${id}-read`}>{ws.commentary[c.key]}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground" data-testid={`${id}-read`}>Not written yet.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 7. Decision. */}
            <section className={SECTION} data-testid="recommendation-section-decision">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={SECTION_TITLE}>Decision</h3>
                {issued && approval.total > 0 && (
                  <span className={cn("rounded-full border px-2 py-px text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap",
                    approval.complete ? `border-emerald-600/60 ${TONE_GOOD}` : approval.declined > 0 ? `border-destructive/60 ${TONE_BAD}` : `border-amber-500/60 ${TONE_WARN}`)} data-testid="recommendation-decision-count">
                    <span className={FIGURE}>{approval.approved}</span> of <span className={FIGURE}>{approval.total}</span> approved
                  </span>
                )}
              </div>

              {!issued && !viewer.isStaff && (
                <p className="text-sm text-muted-foreground" data-testid="recommendation-not-issued">{viewer.canEdit ? "This is the agents' draft. BGP issues it to the client for decision." : "This is the agents' draft. It has not been issued for decision yet."}</p>
              )}
              {issued && (
                <div className="space-y-1">
                  <p className={cn("text-sm font-medium", TONE_GOOD)} data-testid="recommendation-issued-line">
                    Issued {fmtDate(ws.issuedAt)}{ws.issuedByName ? ` by ${ws.issuedByName}` : ""}{ws.issuedVersion !== null ? `, version ${ws.issuedVersion}` : ""}
                  </p>
                  {emailFailed && (
                    <p className={cn("flex items-start gap-1.5 text-xs", TONE_WARN)} data-testid="recommendation-email-failed">
                      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">{sentence(emailFailed.body || "")}</span>
                    </p>
                  )}
                  {changedSinceIssue && (
                    <p className={cn("text-xs", TONE_WARN)} data-testid="recommendation-changed-since">
                      Changed since it was issued: this is version {ws.version}. {viewer.canIssue ? "Issue it again so the client is told." : "BGP will issue it again."}
                    </p>
                  )}
                </div>
              )}

              {viewer.canIssue && (!issued || changedSinceIssue) && (
                <div className="space-y-2.5" data-testid="recommendation-issue-block">
                  {ws.missing.length > 0 && (
                    <div className="space-y-1" data-testid="recommendation-missing">
                      <p className="text-xs font-medium">Still to write before it can be issued:</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                        {ws.missing.map(x => <li key={x}>{x}</li>)}
                      </ul>
                    </div>
                  )}
                  {!ws.ready.hotsIssued && (
                    <div className="flex flex-wrap items-center gap-2" data-testid="recommendation-hots-not-issued">
                      <p className={cn("text-xs", TONE_WARN)}>The Heads of Terms have not been issued to the tenant yet. The recommendation goes to the client after they have.</p>
                      {onOpenHots && <Button type="button" variant="outline" size="sm" onClick={onOpenHots} data-testid="recommendation-open-hots">Open Heads of Terms</Button>}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant={issueIsPrimary ? "default" : "outline"} disabled={!!busy || !canIssueNow} onClick={issue} className="h-auto min-h-9 whitespace-normal py-2" data-testid="recommendation-issue">
                      {busy === "issue" ? <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5 shrink-0" />}
                      {issued ? `Issue version ${ws.version} to ${client}` : `Issue to ${client}`}
                    </Button>
                    {!canIssueNow && (
                      <span className="text-xs text-muted-foreground" data-testid="recommendation-issue-hint">
                        {dirty ? "Save your changes before issuing." : !ws.ready.hotsIssued ? "Waiting for the Heads of Terms to be issued." : ws.missing.length ? `${count(ws.missing.length, "thing", "things")} still to write.` : ""}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {ws.deciders.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="recommendation-no-deciders">
                  Nobody from the client is on this unit's Targeting Brief. Add the leasing and asset managers there so they can decide.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border" data-testid="recommendation-deciders">
                  {ws.deciders.map(d => (
                    <li key={d.briefPersonId} className="space-y-1.5 p-3" data-testid={`recommendation-decider-${d.briefPersonId}`}>
                      <div className="min-w-0">
                        <p className={MICRO_LABEL}>{briefRoleLabel(d.role)}</p>
                        <p className="break-words text-sm font-medium">
                          {d.name}
                          {d.isMe && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">You</span>}
                        </p>
                        {d.firm && <p className="break-words text-xs text-muted-foreground">{d.firm}</p>}
                      </div>
                      <p className="text-xs" data-testid={`recommendation-decider-state-${d.briefPersonId}`}>
                        {issued ? deciderState(d) : <span className="text-muted-foreground">Decides once it is issued</span>}
                      </p>
                      {deciderActions(d)}
                    </li>
                  ))}
                </ul>
              )}
              {issued && !viewer.isStaff && !myRow && (
                <p className="text-xs text-muted-foreground" data-testid="recommendation-read-only-note">You can read the recommendation. The decision is made by the client's people listed on the Targeting Brief.</p>
              )}
            </section>

            {/* 8. History. */}
            <RecommendationHistory events={ws.events} />
          </>
        )}
      </div>

      {/* One save bar, fixed at the foot, while there are unsaved changes. */}
      {canEdit && dirty && (
        <div className="shrink-0 space-y-2 border-t bg-background px-4 py-2.5 sm:px-6" data-testid="recommendation-save-bar">
          {stale && (
            <div className="flex flex-wrap items-center gap-2" role="alert" data-testid="recommendation-stale">
              <p className={cn("min-w-0 flex-1 text-xs", TONE_WARN)}>Someone else changed the recommendation while you were editing. What you typed is still here, but it cannot be saved over theirs.</p>
              <Button type="button" variant="outline" size="sm" onClick={loadLatest} data-testid="recommendation-load-latest">Load the latest</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Unsaved changes</p>
              {issued && <p className="text-xs text-muted-foreground" data-testid="recommendation-save-warning">Saving a change sends the recommendation back for decision.</p>}
              {showErrors && Object.keys(errors).length > 0 && <p className={cn("text-xs", TONE_BAD)} role="alert" data-testid="recommendation-save-errors">Correct the marked boxes, then save.</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={discard} data-testid="recommendation-discard">Discard</Button>
              <Button type="button" size="sm" disabled={!!busy || stale} onClick={save} data-testid="recommendation-save">
                {busy === "save" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
