// Heads of Terms on a Letting Tracker unit (Woody, 2026-11-12). One dialog
// that follows the flow: the property's standard, the draft generated from
// the agreed offer, amendments and sign-off by the people on the unit's
// Targeting Brief, issue to the tenant, the final agreed version, and the
// move to Solicitors. Types: shared/unit-hots.ts. Routes: server/unit-hots.ts.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, Download, FileSignature, FileText, Loader2, RefreshCw, Send, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { pillActive, pillInactive, pillMetrics } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { HOTS_TOKENS, type HotsConversion, type HotsSigner, type HotsWorkspace } from "@shared/unit-hots";
import { HotsError, MICRO_LABEL, TONE_GOOD, TONE_WARN, downloadWithAuth, fmtDate, fmtMoney, hotsCall, listNames } from "./hots-api";
import { HotsHistory, HotsSignoff } from "./hots-signoff";
import { HotsConversionResult, HotsConvertForm, type HotsConvertBody } from "./hots-convert";

export interface HotsUnitRef { id: string; unitName: string; propertyId: string | null }

export interface HotsWorkspaceDialogProps {
  unit: HotsUnitRef | null;
  open: boolean;
  onClose: () => void;
  onOpenOffers?: () => void;   // open the unit's offers (shown when no offer has agreed terms)
  onChanged?: () => void;      // called after every successful write
}

type StepKey = "standard" | "draft" | "signoff" | "issued" | "final" | "solicitors";
const STEPS: { key: StepKey; label: string }[] = [
  { key: "standard", label: "Standard" }, { key: "draft", label: "Draft" }, { key: "signoff", label: "Sign-off" },
  { key: "issued", label: "Issued" }, { key: "final", label: "Final" }, { key: "solicitors", label: "Solicitors" },
];

export function HotsWorkspaceDialog({ unit, open, onClose, onOpenOffers, onChanged }: HotsWorkspaceDialogProps) {
  // The body says whether the draft has unsaved amendments, so closing can warn.
  const dirtyRef = useRef(false);
  const requestClose = () => {
    if (dirtyRef.current && !window.confirm("You have amendments that are not saved. Close without saving them?")) return;
    dirtyRef.current = false;
    onClose();
  };
  return (
    <Dialog open={open && !!unit} onOpenChange={v => { if (!v) requestClose(); }}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-4xl flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90vh] sm:w-full sm:rounded-lg"
        data-testid="hots-workspace-dialog"
      >
        {unit && <HotsBody key={unit.id} unit={unit} dirtyRef={dirtyRef} onOpenOffers={onOpenOffers} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}

function HotsBody({ unit, dirtyRef, onOpenOffers, onChanged }: {
  unit: HotsUnitRef;
  dirtyRef: MutableRefObject<boolean>;
  onOpenOffers?: () => void;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const api = `/api/unit-hots/${unit.id}`;
  const queryKey = useMemo(() => ["/api/unit-hots", unit.id], [unit.id]);
  const query = useQuery<HotsWorkspace, HotsError>({ queryKey, queryFn: () => hotsCall<HotsWorkspace>("GET", api), retry: false });
  const ws = query.data;

  const [busy, setBusy] = useState<string | null>(null);
  // The text in the box, and the version it was loaded from.
  const [draft, setDraft] = useState("");
  const [base, setBase] = useState<{ version: number; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [standardOpen, setStandardOpen] = useState(false);
  const [standardText, setStandardText] = useState("");
  const [showTokens, setShowTokens] = useState(false);
  const [showSigned, setShowSigned] = useState(false);
  const [converted, setConverted] = useState<HotsConversion | null>(null);
  const standardInput = useRef<HTMLInputElement>(null);
  const finalInput = useRef<HTMLInputElement>(null);

  const dirty = !!base && draft !== base.text;
  useEffect(() => { dirtyRef.current = dirty; }, [dirty, dirtyRef]);
  useEffect(() => () => { dirtyRef.current = false; }, [dirtyRef]);
  // Follow the server's text unless the person is part-way through an
  // amendment; then their text stays and the stale note offers the latest.
  useEffect(() => {
    if (!ws) return;
    const text = ws.content || "";
    if (!base || (!dirty && (ws.version !== base.version || text !== base.text))) {
      setBase({ version: ws.version, text });
      setDraft(text);
    }
  }, [ws, base, dirty]);
  const stale = !!ws && !!base && dirty && ws.version !== base.version;

  const adopt = (next: HotsWorkspace) => {
    setBase({ version: next.version, text: next.content || "" });
    setDraft(next.content || "");
  };
  const put = (next: HotsWorkspace) => queryClient.setQueryData(queryKey, next);
  const afterWrite = (alsoDeals = false) => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({
      predicate: q => {
        const head = q.queryKey[0];
        return typeof head === "string" && (head.startsWith("/api/available-units") || (alsoDeals && head.startsWith("/api/crm/deals")));
      },
    });
    onChanged?.();
  };
  const run = async (key: string, failTitle: string, fn: () => Promise<void>, alsoDeals = false) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      afterWrite(alsoDeals);
    } catch (e) {
      const err = e as HotsError;
      toast({ title: failTitle, description: err.message || "Try again.", variant: "destructive" });
      if (err.status === 409 || err.status === 404) query.refetch();
    } finally {
      setBusy(null);
    }
  };

  // ── The standard ────────────────────────────────────────────────────
  const createStandard = (replace: boolean) => {
    if (replace && !window.confirm(`Replace this property's standard Heads of Terms with ${ws?.template.schemeStandardName ? `the ${ws.template.schemeStandardName}` : "BGP's standard 37 clauses"}? Drafts already generated are not changed.`)) return;
    run("standard", "The standard was not created", async () => {
      const next = await hotsCall<HotsWorkspace>("POST", `${api}/template/standard`, { replace });
      put(next);
      setStandardText(next.template.text || "");
      setStandardOpen(true);
      toast({ title: "Standard Heads of Terms created", description: `${ws?.template.schemeStandardName || "BGP's standard 37 clauses"}. Edit them for this property if you need to.` });
    });
  };
  const uploadStandard = (file: File) => {
    let replaceText = false;
    if (ws?.template.text) {
      replaceText = window.confirm("Use the text of this Word document as the property's standard from now on?\n\nOK replaces the standard text. Cancel keeps the current text and only stores the document.");
    }
    run("standard-upload", "The standard was not uploaded", async () => {
      const fd = new FormData();
      fd.append("file", file);
      if (replaceText) fd.append("replaceText", "true");
      const out = await hotsCall<{ name: string; tokens: number; textSaved: boolean; note: string | null; workspace: HotsWorkspace }>("POST", `${api}/template/upload`, fd);
      put(out.workspace);
      setStandardText(out.workspace.template.text || "");
      setNotice(out.note);
      toast({ title: "Standard Heads of Terms uploaded", description: out.textSaved ? `${out.name}: ${out.tokens} ${out.tokens === 1 ? "placeholder" : "placeholders"} found.` : out.name });
    });
  };
  const saveStandard = () => run("standard-save", "The standard was not saved", async () => {
    const next = await hotsCall<HotsWorkspace>("PUT", `${api}/template`, { text: standardText });
    put(next);
    setStandardText(next.template.text || "");
    toast({ title: "Standard saved" });
  });
  const openStandard = () => {
    setStandardText(ws?.template.text || "");
    setStandardOpen(true);
  };
  const closeStandard = () => {
    if (standardText !== (ws?.template.text || "") && !window.confirm("Close the standard without saving your changes to it?")) return;
    setStandardOpen(false);
  };

  // ── The draft ───────────────────────────────────────────────────────
  const generate = (replace: boolean) => {
    if (replace && !window.confirm(`Replace the draft with a fresh copy from the agreed offer? Amendments made to the draft are lost${ws && ws.approval.agreed > 0 ? ", and everyone is asked to agree again" : ""}.`)) return;
    run("generate", "The Heads of Terms were not generated", async () => {
      const next = await hotsCall<HotsWorkspace>("POST", `${api}/generate`, { replace });
      put(next);
      adopt(next);
      setNotice(null);
      toast({ title: replace ? "Draft refreshed from the offer" : "Heads of Terms generated", description: next.gaps.length ? `${next.gaps.length} ${next.gaps.length === 1 ? "gap" : "gaps"} still to fill.` : undefined });
    });
  };
  const save = async () => {
    if (busy || !base || !dirty) return;
    setBusy("save");
    try {
      const next = await hotsCall<HotsWorkspace>("PUT", `${api}/content`, { content: draft, baseVersion: base.version });
      put(next);
      adopt(next);
      // Spacing at the end is not an amendment: the version stays as it was.
      if (next.version === base.version) toast({ title: "Nothing to save", description: "The terms are the same as the saved version." });
      else toast({ title: "Amendments saved", description: `Version ${next.version}.${next.signers.some(s => s.staleAgreedAt) ? " Everyone is asked to agree this version." : ""}` });
      afterWrite();
    } catch (e) {
      const err = e as HotsError;
      const latest = err.code === "STALE" ? (err.data?.workspace as HotsWorkspace | undefined) : undefined;
      // Someone else amended it: keep this person's text, show the note.
      if (latest) put(latest);
      else {
        toast({ title: "Amendments not saved", description: err.message || "Try again.", variant: "destructive" });
        if (err.status === 409 || err.status === 404) query.refetch();
      }
    } finally {
      setBusy(null);
    }
  };
  const loadLatest = () => {
    if (!ws) return;
    if (!window.confirm("Load the latest version? The text you typed is replaced, so copy anything you want to keep first.")) return;
    adopt(ws);
  };
  const download = async (format: "pdf" | "docx") => {
    if (busy || !ws) return;
    setBusy(`download:${format}`);
    try {
      await downloadWithAuth(`${api}/download?format=${format}`, `Heads of Terms - ${ws.unit.unitName}.${format}`);
    } catch (e) {
      toast({ title: "The document could not be downloaded", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // ── Sign-off, issue ─────────────────────────────────────────────────
  const agree = (s: HotsSigner) => {
    if (!ws) return;
    if (!s.isMe && !window.confirm(`Record that ${s.name} has agreed version ${ws.version} of the Heads of Terms? The record will show that you recorded it.`)) return;
    run(`agree:${s.briefPersonId}`, "Agreement not recorded", async () => {
      put(await hotsCall<HotsWorkspace>("POST", `${api}/agree`, { version: ws.version, ...(s.isMe ? {} : { briefPersonId: s.briefPersonId }) }));
    });
  };
  const withdraw = (s: HotsSigner) => {
    if (!window.confirm(s.isMe ? "Withdraw your agreement to the Heads of Terms?" : `Withdraw ${s.name}'s agreement to the Heads of Terms? The record will show that you withdrew it.`)) return;
    run(`agree:${s.briefPersonId}`, "Agreement not withdrawn", async () => {
      put(await hotsCall<HotsWorkspace>("POST", `${api}/agree`, { withdraw: true, ...(s.isMe ? {} : { briefPersonId: s.briefPersonId }) }));
    });
  };
  const issue = () => {
    if (!ws) return;
    const nobody = ws.signers.length === 0 ? "\n\nNobody is listed on the brief, so nobody has signed these off." : "";
    if (!window.confirm(`Issue the Heads of Terms to the tenant?\n\nThis records them as issued and moves the unit to HOTs. It does not send an email, so download the PDF or Word and send it yourself.${nobody}`)) return;
    run("issue", "The Heads of Terms were not issued", async () => {
      const next = await hotsCall<HotsWorkspace & { statusWarning?: string }>("POST", `${api}/issue`, {});
      put(next);
      setNotice(next.statusWarning || null);
      toast({ title: "Heads of Terms issued", description: "Recorded as issued. Download the PDF or Word and send it to the tenant." });
    }, true);
  };
  const reopen = () => {
    if (!window.confirm("Reopen the Heads of Terms for amendments? They stop showing as issued. Signatures stay as they are until the text is changed.")) return;
    run("reopen", "The Heads of Terms were not reopened", async () => {
      put(await hotsCall<HotsWorkspace>("POST", `${api}/reopen`, {}));
      setNotice(null);
    });
  };

  // ── Final, convert ──────────────────────────────────────────────────
  const uploadFinal = (file: File) => run("final", "The final Heads of Terms were not uploaded", async () => {
    const fd = new FormData();
    fd.append("file", file);
    put(await hotsCall<HotsWorkspace>("POST", `${api}/final`, fd));
    toast({ title: "Final Heads of Terms uploaded", description: file.name });
  });
  const removeFinal = () => {
    if (!window.confirm("Remove the final Heads of Terms? The file stays in the unit's files; this unit goes back a step.")) return;
    run("final-remove", "The final Heads of Terms were not removed", async () => {
      put(await hotsCall<HotsWorkspace>("DELETE", `${api}/final`));
    });
  };
  const openFinal = async () => {
    if (busy || !ws?.finalFile) return;
    setBusy("final-open");
    try {
      await downloadWithAuth(ws.finalFile.url, ws.finalFile.fileName);
    } catch (e) {
      toast({ title: "The file could not be downloaded", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const convert = (body: HotsConvertBody) => run("convert", "The deal was not converted", async () => {
    const out = await hotsCall<HotsConversion>("POST", `${api}/convert`, body);
    setConverted(out);
    toast({ title: "Converted to Solicitors", description: out.dealRef !== null ? `Deal #${out.dealRef} is now at Solicitors.` : "The deal is now at Solicitors." });
  }, true);

  const header = (
    <DialogHeader className="space-y-1 text-left">
      <DialogTitle className="flex items-start gap-2 pr-8 text-left">
        <FileSignature className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">Heads of Terms: {ws?.unit.unitName || unit.unitName}</span>
      </DialogTitle>
      <DialogDescription className="text-left">
        {ws ? [ws.unit.propertyName, ws.unit.dealRef !== null ? `Deal #${ws.unit.dealRef}` : ""].filter(Boolean).join(" · ") || "Letting Tracker unit" : "Loading the Heads of Terms"}
      </DialogDescription>
    </DialogHeader>
  );

  if (!ws) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        {header}
        {query.isError ? (
          <div className="space-y-3 rounded-lg border border-dashed p-6 text-center" data-testid="hots-load-error">
            <CircleAlert className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="text-sm">{query.error?.message || "The Heads of Terms could not be loaded."}</p>
            {query.error?.status !== 403 && query.error?.status !== 404 && (
              <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()} data-testid="hots-retry">Try again</Button>
            )}
          </div>
        ) : (
          <div className="space-y-3" data-testid="hots-loading">
            <Skeleton className="h-6 w-full max-w-md" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </div>
    );
  }

  const { stage, viewer, approval } = ws;
  const conversion = converted || ws.conversion || null;
  const done: Record<StepKey, boolean> = {
    standard: !!ws.template.text || !!ws.template.docxName,
    draft: !!ws.content,
    signoff: !!ws.content && approval.complete,
    issued: !!ws.issuedAt,
    final: !!ws.finalFile,
    solicitors: !!conversion,
  };
  const current: StepKey = conversion ? "solicitors"
    : stage === "no_template" ? "standard" : stage === "no_draft" ? "draft" : stage === "draft" ? "signoff"
    : stage === "agreed" ? "issued" : stage === "issued" ? "final" : "solicitors";
  const waiting = ws.signers.filter(s => !s.agreedAt).map(s => s.name);
  const statusLine =
    conversion ? `The deal ${conversion.dealRef !== null ? `#${conversion.dealRef} ` : ""}is at Solicitors.`
    : stage === "no_template" ? (viewer.canManageTemplate ? "Start with this property's standard Heads of Terms." : "BGP adds the standard Heads of Terms for this property first.")
    : stage === "no_draft" ? "The standard is in place. The Heads of Terms are generated from the offer once its terms are agreed."
    : stage === "draft" ? (approval.total === 0 ? `Draft, version ${ws.version}. Nobody is listed on the brief to sign it off.` : `Draft, version ${ws.version}. Still to agree: ${listNames(waiting)}.`)
    : stage === "agreed" ? `Everyone agreed version ${ws.version} on ${fmtDate(ws.agreedAt)}. ${viewer.canIssue ? "You can now issue it to the tenant." : "BGP can now issue it to the tenant."}`
    : stage === "issued" ? "The Heads of Terms have been issued to the tenant."
    : "The final agreed Heads of Terms are on file.";

  const mine = ws.signers.find(s => s.isMe) || null;
  const signoffOpen = stage === "draft" || stage === "agreed";
  const canIssueNow = viewer.canIssue && signoffOpen && !dirty && (approval.complete || approval.total === 0);
  // One filled button at a time: save, else agree, else issue.
  const agreeIsPrimary = signoffOpen && !dirty && !!mine && !mine.agreedAt;
  const issueIsPrimary = canIssueNow && !agreeIsPrimary;
  const standardName = ws.template.standardName || (ws.template.isStandard ? "BGP standard, 37 clauses" : ws.template.docxName || "This property's own standard");
  const offerLine = ws.agreedOffer
    ? [ws.agreedOffer.companyName || "Tenant not named", ws.agreedOffer.rentPa !== null ? `${fmtMoney(ws.agreedOffer.rentPa)} a year` : "", `offer of ${fmtDate(ws.agreedOffer.offerDate)}`].filter(Boolean).join(" · ")
    : "";

  const downloads = !!ws.content && (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => download("pdf")} data-testid="hots-download-pdf">
        {busy === "download:pdf" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}Download PDF
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => download("docx")} data-testid="hots-download-word">
        {busy === "download:docx" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}Download Word
      </Button>
    </div>
  );
  const downloadNote = dirty && <p className="text-xs text-muted-foreground">Downloads are the saved version, without the amendments you have not saved.</p>;

  const standardEditor = standardOpen && viewer.canManageTemplate && (
    <div className="space-y-2 rounded-lg border p-3" data-testid="hots-standard-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="hots-standard-text" className={MICRO_LABEL}>Standard Heads of Terms for {ws.unit.propertyName || "this property"}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowTokens(v => !v)} aria-expanded={showTokens} data-testid="hots-standard-tokens-toggle">
          {showTokens ? "Hide placeholders" : "Show placeholders"}
        </Button>
      </div>
      {showTokens && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md bg-muted/50 p-2.5 text-xs sm:grid-cols-2" data-testid="hots-standard-tokens">
          {HOTS_TOKENS.map(t => (
            <div key={t.token} className="flex flex-wrap gap-x-1.5">
              <dt className="font-mono">{`{${t.token}}`}</dt>
              <dd className="text-muted-foreground">{t.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-muted-foreground">
        A placeholder in curly brackets is filled from the agreed offer, the unit and the brief when the Heads of Terms are generated. Text in square brackets is left for a person to fill in.
      </p>
      <Textarea id="hots-standard-text" value={standardText} onChange={e => setStandardText(e.target.value)} className="min-h-[320px] font-mono text-xs leading-relaxed md:text-xs" spellCheck={false} data-testid="hots-standard-text" />
      <div className="flex flex-wrap justify-end gap-2">
        {!ws.template.isStandard && (
          <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => createStandard(true)} data-testid="hots-standard-reset">{ws.template.schemeStandardName ? "Replace with the scheme's standard" : "Replace with BGP's standard"}</Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => standardInput.current?.click()} data-testid="hots-standard-upload-word">
          {busy === "standard-upload" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}Upload a Word standard
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={closeStandard} data-testid="hots-standard-close">Close</Button>
        <Button type="button" variant="outline" size="sm" disabled={!!busy || standardText === (ws.template.text || "")} onClick={saveStandard} data-testid="hots-standard-save">
          {busy === "standard-save" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save standard
        </Button>
      </div>
    </div>
  );
  const standardUploadInput = viewer.canManageTemplate && (
    <input ref={standardInput} type="file" accept=".docx" className="hidden" data-testid="hots-standard-file"
      onChange={e => { const f = e.target.files?.[0]; if (f) uploadStandard(f); e.target.value = ""; }} />
  );
  const finalUploadInput = viewer.isStaff && (
    <input ref={finalInput} type="file" accept=".pdf,.docx" className="hidden" data-testid="hots-final-file"
      onChange={e => { const f = e.target.files?.[0]; if (f) uploadFinal(f); e.target.value = ""; }} />
  );

  const issueButton = (
    <Button type="button" className="w-full sm:w-auto" variant={issueIsPrimary ? "default" : "outline"} disabled={!!busy || !canIssueNow} onClick={issue} data-testid="hots-issue">
      {busy === "issue" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}Issue to tenant
    </Button>
  );
  const side = (
    <aside className="space-y-5 min-w-0">
      <HotsSignoff ws={ws} open={signoffOpen} busy={busy} dirty={dirty} agreeIsPrimary={agreeIsPrimary} onAgree={agree} onWithdraw={withdraw} />
      {/* Until it can be issued the button waits here, saying why. Once it can, it sits under the status line. */}
      {signoffOpen && viewer.canIssue && !canIssueNow && (
        <div className="space-y-1.5" data-testid="hots-issue-block">
          {issueButton}
          <p className="text-xs text-muted-foreground" data-testid="hots-issue-hint">
            {dirty ? "Save your amendments before issuing." : "Everyone on the brief agrees this version before it is issued."}
          </p>
        </div>
      )}
      <HotsHistory events={ws.events} />
    </aside>
  );

  return (
    <>
      <div className="shrink-0 space-y-3 border-b px-4 pb-3 pt-4 sm:px-6 sm:pt-6">
        {header}
        <ol className="flex flex-wrap gap-1.5" aria-label="Progress" data-testid="hots-steps">
          {STEPS.map(s => (
            <li key={s.key}>
              <span
                className={cn(pillMetrics, s.key === current ? pillActive : pillInactive, done[s.key] && s.key !== current && "text-foreground")}
                aria-current={s.key === current ? "step" : undefined}
                data-state={s.key === current ? "current" : done[s.key] ? "done" : "todo"}
                data-testid={`hots-step-${s.key}`}
              >
                {done[s.key] && <Check className="h-3 w-3" aria-label="Done" />}
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3 sm:px-6" data-testid="hots-scroll">
      <div className="space-y-1.5 min-w-0">
        <p className="text-sm" data-testid="hots-status-line">{statusLine}</p>
        {canIssueNow && <div className="pt-1" data-testid="hots-issue-block">{issueButton}</div>}
        {notice && (
          <p className={`flex items-start gap-1.5 text-xs ${TONE_WARN}`} data-testid="hots-notice">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {notice}
          </p>
        )}
      </div>
      {standardUploadInput}
      {finalUploadInput}

      {stage === "no_template" && (
        <div className="space-y-3 rounded-lg border border-dashed p-5 text-center" data-testid="hots-stage-no-template">
          <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="text-sm">This property has no standard Heads of Terms yet.</p>
          {viewer.canManageTemplate ? (
            <>
              <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
                <Button type="button" disabled={!!busy} onClick={() => createStandard(false)} data-testid="hots-create-standard">
                  {busy === "standard" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Create standard HOTs
                </Button>
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => standardInput.current?.click()} data-testid="hots-upload-standard">
                  {busy === "standard-upload" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}Upload standard HOTs (.docx)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{ws.template.schemeStandardName ? `Create standard HOTs starts from the ${ws.template.schemeStandardName}, ready to edit.` : "Create standard HOTs makes BGP's standard 37 clauses, ready to edit for this property."}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="hots-no-template-wait">BGP adds the standard Heads of Terms for this property first.</p>
          )}
        </div>
      )}

      {stage === "no_draft" && (
        <div className="space-y-4 min-w-0" data-testid="hots-stage-no-draft">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <div className="min-w-0">
              <p className={MICRO_LABEL}>Standard</p>
              <p className="text-sm font-medium break-words" data-testid="hots-standard-name">{standardName}</p>
            </div>
            {viewer.canManageTemplate && !standardOpen && (
              <Button type="button" variant="outline" size="sm" onClick={openStandard} data-testid="hots-standard-open">View or edit the standard</Button>
            )}
          </div>
          {standardEditor}
          {ws.agreedOffer ? (
            <div className="space-y-2 rounded-lg border p-4" data-testid="hots-generate-block">
              <p className={MICRO_LABEL}>Agreed offer</p>
              <p className="text-sm font-medium break-words" data-testid="hots-agreed-offer">{offerLine}</p>
              {viewer.canEdit ? (
                <Button type="button" disabled={!!busy} onClick={() => generate(false)} className="h-auto min-h-9 whitespace-normal py-2 text-left" data-testid="hots-generate">
                  {busy === "generate" && <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" />}Generate Heads of Terms from the agreed offer
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="hots-generate-wait">BGP or the client generates the Heads of Terms from this offer.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-dashed p-5 text-center" data-testid="hots-no-agreed-offer">
              <p className="text-sm">No offer has agreed terms yet. Agree the terms on an offer, then generate.</p>
              {onOpenOffers && <Button type="button" onClick={onOpenOffers} data-testid="hots-open-offers">Open offers</Button>}
            </div>
          )}
          <HotsHistory events={ws.events} />
        </div>
      )}

      {(stage === "draft" || stage === "agreed" || stage === "issued") && (
        <div className="grid grid-cols-1 gap-5 min-w-0 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid={`hots-stage-${stage}`}>
          <div className="space-y-2.5 min-w-0">
            <div className="space-y-0.5">
              <p className="text-sm font-medium" data-testid="hots-version-line">
                Version <span className="font-mono tabular-nums">{ws.version}</span>, last amended {fmtDate(ws.updatedAt)}
              </p>
              {ws.offer && (
                <p className="text-xs text-muted-foreground" data-testid="hots-offer-line">
                  Generated from {ws.offer.companyName ? `${ws.offer.companyName}'s` : "the"} offer of {fmtDate(ws.offer.offerDate)}.
                </p>
              )}
              {ws.offerOutOfStep && (
                <p className={`text-xs ${TONE_WARN}`} data-testid="hots-offer-out-of-step">
                  {ws.offer?.status === "Agreed"
                    ? `The offer has changed since this draft was written${ws.offer.rentPa !== null ? ` (it is now agreed at ${fmtMoney(ws.offer.rentPa)} a year)` : ""}. Refresh the draft from the offer, or amend it to match, before anyone agrees it.`
                    : "The offer this draft was written from is no longer agreed. Agree the terms on an offer, then refresh the draft."}
                </p>
              )}
              {stage === "issued" && (
                <>
                  <p className={`text-sm font-medium ${TONE_GOOD}`} data-testid="hots-issued-line">Issued {fmtDate(ws.issuedAt)}{ws.issuedByName ? ` by ${ws.issuedByName}` : ""}</p>
                  <p className="text-xs text-muted-foreground">The negotiation on the Heads of Terms happens outside the app. Upload the final agreed version here when it is done.</p>
                </>
              )}
            </div>
            {signoffOpen && ws.gaps.length > 0 && (
              <p className={`text-xs ${TONE_WARN}`} data-testid="hots-gaps">Still to fill: {ws.gaps.join(", ")}</p>
            )}
            <Label htmlFor="hots-draft-text" className="sr-only">Heads of Terms draft</Label>
            <Textarea
              id="hots-draft-text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              readOnly={!viewer.canEdit}
              className={cn("h-[50vh] min-h-[280px] leading-relaxed", !viewer.canEdit && "bg-muted/40")}
              data-testid="hots-draft-text"
            />
            {!viewer.canEdit && signoffOpen && (
              <p className="text-xs text-muted-foreground" data-testid="hots-read-only-note">You can read and agree the Heads of Terms. BGP and the client make the amendments.</p>
            )}
            {/* Beside the Save button, where the person is looking when it happens. */}
            {stale && (
              <div className="space-y-2 rounded-lg border border-amber-500/60 p-3" role="alert" data-testid="hots-stale">
                <p className={`text-sm ${TONE_WARN}`}>Someone else amended the Heads of Terms while you were editing. Your text is still in the box, but it cannot be saved over theirs.</p>
                <Button type="button" variant="outline" size="sm" onClick={loadLatest} data-testid="hots-load-latest">Load the latest</Button>
              </div>
            )}
            {viewer.canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={dirty ? "default" : "outline"} disabled={!!busy || !dirty || stale} onClick={save} data-testid="hots-save">
                  {busy === "save" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save amendments
                </Button>
                {ws.agreedOffer && (
                  <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => generate(true)} data-testid="hots-refresh">
                    {busy === "generate" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}Refresh from the offer
                  </Button>
                )}
              </div>
            )}
            {downloads}
            {downloadNote}
            {stage === "issued" && viewer.isStaff && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3" data-testid="hots-issued-actions">
                <Button type="button" disabled={!!busy} onClick={() => finalInput.current?.click()} data-testid="hots-upload-final">
                  {busy === "final" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}Upload final agreed HOTs
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={reopen} data-testid="hots-reopen">
                  {busy === "reopen" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Reopen for amendments
                </Button>
              </div>
            )}
            {stage === "issued" && !viewer.isStaff && (
              <p className="text-sm text-muted-foreground" data-testid="hots-issued-wait">BGP uploads the final agreed Heads of Terms here.</p>
            )}
            {viewer.canManageTemplate && !standardOpen && (
              <div className="border-t pt-2">
                <Button type="button" variant="ghost" size="sm" onClick={openStandard} data-testid="hots-standard-open">View or edit the property's standard</Button>
              </div>
            )}
            {standardEditor}
          </div>
          {side}
        </div>
      )}

      {stage === "final" && ws.finalFile && (
        <div className="grid grid-cols-1 gap-5 min-w-0 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="hots-stage-final">
          <div className="space-y-4 min-w-0">
            <div className="space-y-2 rounded-lg border p-3" data-testid="hots-final-file-block">
              <p className={MICRO_LABEL}>Final agreed Heads of Terms</p>
              <button type="button" onClick={openFinal} disabled={!!busy} className="flex max-w-full items-start gap-1.5 text-left text-sm font-medium text-primary underline-offset-2 hover:underline" data-testid="hots-final-open">
                {busy === "final-open" ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0 break-words">{ws.finalFile.fileName}</span>
              </button>
              <p className="text-xs text-muted-foreground" data-testid="hots-final-meta">
                Uploaded {fmtDate(ws.finalFile.uploadedAt)}{ws.finalFile.uploadedByName ? ` by ${ws.finalFile.uploadedByName}` : ""}
              </p>
              {viewer.isStaff && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => finalInput.current?.click()} data-testid="hots-final-replace">
                    {busy === "final" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Replace the file
                  </Button>
                  {!conversion && (
                    <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={removeFinal} data-testid="hots-final-remove">
                      {busy === "final-remove" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Remove
                    </Button>
                  )}
                </div>
              )}
            </div>
            {conversion ? (
              <HotsConversionResult conversion={conversion} isStaff={viewer.isStaff} />
            ) : viewer.canConvert && ws.convertDefaults ? (
              <HotsConvertForm defaults={ws.convertDefaults} busy={busy === "convert"} onConvert={convert} />
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="hots-convert-wait">BGP converts the deal to Solicitors now that the final Heads of Terms are on file.</p>
            )}
            {ws.content && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowSigned(v => !v)} aria-expanded={showSigned} data-testid="hots-signed-toggle">
                    {showSigned ? "Hide the issued draft" : "Show the issued draft"}
                  </Button>
                  {downloads}
                </div>
                {showSigned && <Textarea value={ws.content} readOnly aria-label="The issued draft" className="min-h-[320px] bg-muted/40 leading-relaxed" data-testid="hots-signed-text" />}
              </div>
            )}
          </div>
          {side}
        </div>
      )}
      </div>
    </>
  );
}
