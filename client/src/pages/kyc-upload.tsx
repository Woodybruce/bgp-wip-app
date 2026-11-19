// The client's own page for their identity checks (public: the link's token
// is the key). One card per thing we need, an upload button on each, the
// identity check, and Finish. Rebuilt on 17 November 2026 (Woody: "not that
// clear or user friendly"); the words of the emails that link here are in
// shared/kyc-request.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { AlertCircle, CheckCircle2, ChevronDown, FileText, Loader2, Lock, Mail, Phone, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KYC_DATA_USE, KYC_OWNERS_QUESTION, KYC_PEP_QUESTION, KYC_PRIVACY_URL, KYC_UPLOAD_EXTENSIONS, KYC_WHY_WE_ASK, kycLongDate, kycPepWords, type KycAgent, type KycDocKey, type KycOwnersAnswer, type KycPepAnswer, type KycPortalView } from "@shared/kyc-request";

type Loaded =
  | { state: "loading" }
  | { state: "closed"; message: string; agents: KycAgent[] }
  | { state: "error"; message: string }
  | { state: "open"; view: KycPortalView };

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.doc,.docx,application/pdf,image/*";
const firstName = (name: string | null | undefined) => String(name || "").trim().split(/\s+/)[0] || "";

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

function Logo() {
  return <img src="/bgp-logo.png" alt="Bruce Gillingham Pollard" className="h-10 w-auto" data-testid="kyc-logo" />;
}

function AgentContact({ agents }: { agents: KycAgent[] }) {
  const shown = agents.filter(a => a.name).slice(0, 2);
  if (!shown.length) return <p className="text-sm text-muted-foreground">Reply to the email we sent you and we'll help.</p>;
  return (
    <div className="space-y-2">
      {shown.map(a => (
        <div key={a.name} className="text-sm">
          <div className="font-semibold text-foreground">{a.name}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {a.phone && <a href={`tel:${a.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="w-3.5 h-3.5" />{a.phone}</a>}
            {a.email && <a href={`mailto:${a.email}`} className="inline-flex items-center gap-1 hover:text-foreground break-all"><Mail className="w-3.5 h-3.5" />{a.email}</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
        <div className="rounded-lg border bg-background shadow-sm">
          <div className="border-b-[3px] border-[#6E0C25] px-5 py-5 sm:px-8"><Logo /></div>
          <div className="px-5 py-6 sm:px-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

function StepNumber({ n, done }: { n: number; done: boolean }) {
  return done
    ? <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" aria-label="Done" />
    : <span className="flex w-7 h-7 shrink-0 items-center justify-center rounded-full bg-[#6E0C25] text-white text-sm font-bold">{n}</span>;
}

function FileLine({ name }: { name: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="truncate">{name}</span>
    </li>
  );
}

function UploadCard({ n, title, detail, files, docKey, busy, error, onFiles }: {
  n: number; title: string; detail: string; files: Array<{ name: string }>; docKey: KycDocKey;
  busy: boolean; error: string | null; onFiles: (key: KycDocKey, list: FileList | File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const done = files.length > 0;
  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${over ? "border-[#6E0C25] bg-[#6E0C25]/5" : done ? "border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10" : ""}`}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) onFiles(docKey, e.dataTransfer.files); }}
      data-testid={`kyc-doc-${docKey}`}
    >
      <div className="flex gap-3">
        <StepNumber n={n} done={done} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base leading-snug">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{detail}</p>
          {files.length > 0 && <ul className="mt-3 space-y-1.5">{files.map((f, i) => <FileLine key={`${f.name}-${i}`} name={f.name} />)}</ul>}
          {error && <p className="mt-2 flex items-start gap-1.5 text-sm text-red-700"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" variant={done ? "outline" : "default"} className={done ? "" : "bg-[#6E0C25] hover:bg-[#5a0a1f] text-white"} disabled={busy} onClick={() => input.current?.click()} data-testid={`kyc-upload-${docKey}`}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {busy ? "Uploading…" : done ? "Add another file" : "Upload"}
            </Button>
            <span className="hidden sm:inline text-xs text-muted-foreground">or drop files here</span>
          </div>
          <input ref={input} type="file" accept={ACCEPT} multiple className="hidden"
            onChange={e => { if (e.target.files?.length) onFiles(docKey, e.target.files); e.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

// The one question (HMRC: asking the customer is one way to find a
// politically exposed person). No saves at once; Yes or Not sure offers a
// box for who and what role.
function QuestionCard({ n, kind, answer, detail, onSave }: {
  n: number; kind: "individual" | "company"; answer: KycPepAnswer | null; detail: string | null;
  onSave: (pep: KycPepAnswer, pepDetail: string | null) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(!answer);
  const [choice, setChoice] = useState<KycPepAnswer | null>(answer);
  const [text, setText] = useState(detail || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (pep: KycPepAnswer, pepDetail: string | null) => {
    setSaving(true);
    setError(null);
    const failed = await onSave(pep, pepDetail);
    setSaving(false);
    if (failed) setError(failed); else setEditing(false);
  };
  const done = !!answer && !editing;
  return (
    <div className={`rounded-lg border p-4 ${done ? "border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10" : ""}`} data-testid="kyc-question">
      <div className="flex gap-3">
        <StepNumber n={n} done={done} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base leading-snug">{KYC_PEP_QUESTION.title}</h3>
          {done ? (
            <div className="mt-1 text-sm">
              <span className="text-muted-foreground">Your answer: </span><strong>{kycPepWords(answer)}</strong>{detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
              <button type="button" className="ml-3 text-sm underline text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>Change</button>
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm leading-relaxed">{kind === "individual" ? KYC_PEP_QUESTION.individual : KYC_PEP_QUESTION.company}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{KYC_PEP_QUESTION.examples}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["no", "yes", "unsure"] as const).map(option => (
                  <Button key={option} type="button" variant={choice === option ? "default" : "outline"} disabled={saving}
                    className={choice === option ? "bg-[#6E0C25] hover:bg-[#5a0a1f] text-white" : ""}
                    onClick={() => { setChoice(option); if (option === "no") void save("no", null); }} data-testid={`kyc-pep-${option}`}>
                    {option === "no" ? "No" : option === "yes" ? "Yes" : "I'm not sure"}
                  </Button>
                ))}
              </div>
              {(choice === "yes" || choice === "unsure") && (
                <div className="mt-3 space-y-2">
                  <label className="text-sm font-medium" htmlFor="kyc-pep-detail">Who, and what role? (optional)</label>
                  <textarea id="kyc-pep-detail" rows={2} value={text} onChange={e => setText(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
                  <Button type="button" disabled={saving} onClick={() => save(choice, text.trim() || null)} data-testid="kyc-pep-save">
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save my answer
                  </Button>
                  <p className="text-xs text-muted-foreground">That's fine: it means we ask a few more questions, which your agent will explain.</p>
                </div>
              )}
              {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// The owners Companies House lists, to confirm rather than send a chart
// (Woody, 2026-11-17: ask only what is left). Yes saves at once; No asks
// what has changed.
function OwnersCard({ n, owners, onSave }: {
  n: number; owners: NonNullable<KycPortalView["owners"]>;
  onSave: (answer: KycOwnersAnswer, detail: string | null) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(!owners.answer);
  const [choice, setChoice] = useState<KycOwnersAnswer | null>(owners.answer);
  const [text, setText] = useState(owners.detail || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (answer: KycOwnersAnswer, detail: string | null) => {
    setSaving(true);
    setError(null);
    const failed = await onSave(answer, detail);
    setSaving(false);
    if (failed) setError(failed); else setEditing(false);
  };
  const done = !!owners.answer && !editing;
  return (
    <div className={`rounded-lg border p-4 ${done ? "border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10" : ""}`} data-testid="kyc-owners">
      <div className="flex gap-3">
        <StepNumber n={n} done={done} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base leading-snug">{KYC_OWNERS_QUESTION.title}</h3>
          <p className="mt-1 text-sm leading-relaxed">{KYC_OWNERS_QUESTION.intro}</p>
          <ul className="mt-2 space-y-1 text-sm" data-testid="kyc-owners-list">
            {owners.list.map((o, i) => <li key={`${o.name}-${i}`}><strong>{o.name}</strong><span className="text-muted-foreground">: {o.detail}</span></li>)}
          </ul>
          {done ? (
            <div className="mt-2 text-sm">
              <span className="text-muted-foreground">Your answer: </span><strong>{owners.answer === "yes" ? "Yes, that's right" : "No, it has changed"}</strong>{owners.detail ? <span className="text-muted-foreground"> · {owners.detail}</span> : null}
              <button type="button" className="ml-3 text-sm underline text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>Change</button>
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["yes", "no"] as const).map(option => (
                  <Button key={option} type="button" variant={choice === option ? "default" : "outline"} disabled={saving}
                    className={choice === option ? "bg-[#6E0C25] hover:bg-[#5a0a1f] text-white" : ""}
                    onClick={() => { setChoice(option); if (option === "yes") void save("yes", null); }} data-testid={`kyc-owners-${option}`}>
                    {option === "yes" ? "Yes, that's right" : "No, it has changed"}
                  </Button>
                ))}
              </div>
              {choice === "no" && (
                <div className="mt-3 space-y-2">
                  <label className="text-sm font-medium" htmlFor="kyc-owners-detail">{KYC_OWNERS_QUESTION.no}</label>
                  <textarea id="kyc-owners-detail" rows={3} value={text} onChange={e => setText(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
                  <Button type="button" disabled={saving || !text.trim()} onClick={() => save("no", text.trim())} data-testid="kyc-owners-save">
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save my answer
                  </Button>
                </div>
              )}
              {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const ID_COPY: Record<string, { line: string; button: string | null }> = {
  not_started: { line: "On your phone or computer: a photo of your passport, driving licence or identity card and a short selfie. It takes about two minutes.", button: "Start the identity check" },
  started: { line: "You've started the identity check. Pick up where you left off.", button: "Continue the identity check" },
  retry: { line: "The identity check needs another go. This usually means a photo wasn't clear enough.", button: "Try again" },
  restart: { line: "The identity check didn't finish. Please start it again.", button: "Start again" },
  submitted: { line: "Done, thank you. We'll be in touch if anything else is needed.", button: null },
  approved: { line: "Done, thank you. Your identity has been confirmed.", button: null },
};

export default function KycUploadPage() {
  const { token } = useParams<{ token: string }>();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [busyKey, setBusyKey] = useState<KycDocKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<KycDocKey, string>>>({});
  const [idBusy, setIdBusy] = useState(false);
  const [idMessage, setIdMessage] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/kyc-upload/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await readJson(res);
      if (res.status === 410) return setLoaded({ state: "closed", message: body.message || "This link is no longer open.", agents: body.agents || [] });
      if (!res.ok) return setLoaded({ state: "error", message: body.message || "Something went wrong. Please try again in a minute." });
      setLoaded({ state: "open", view: body });
    } catch {
      setLoaded({ state: "error", message: "We couldn't load the page. Please check your connection and try again." });
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // Coming back from the identity check: read it again a few times while
  // Veriff's result arrives.
  useEffect(() => {
    if (loaded.state !== "open" || !loaded.view.idCheck) return;
    if (!["started", "not_started"].includes(loaded.view.idCheck.state)) return;
    const timer = setTimeout(() => { void load(); }, 15000);
    return () => clearTimeout(timer);
  }, [loaded, load]);

  if (loaded.state === "loading") {
    return <Shell><div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" />Loading your checks…</div></Shell>;
  }
  if (loaded.state === "error") {
    return <Shell><div className="py-6 text-center space-y-4"><p className="text-sm">{loaded.message}</p><Button variant="outline" onClick={() => { setLoaded({ state: "loading" }); void load(); }}>Try again</Button></div></Shell>;
  }
  if (loaded.state === "closed") {
    return (
      <Shell>
        <div className="space-y-5" data-testid="kyc-closed">
          <div className="flex items-start gap-2"><AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" /><p className="text-base">{loaded.message}</p></div>
          {loaded.agents.length > 0 && <div><h2 className="text-sm font-semibold mb-2">Your contact</h2><AgentContact agents={loaded.agents} /></div>}
        </div>
      </Shell>
    );
  }

  const view = loaded.view;
  const setView = (next: KycPortalView) => setLoaded({ state: "open", view: next });
  // Someone else's identity check on this link is not this person's (Woody,
  // 19 November 2026: an agent copied on the request did it on the link).
  const idOther = !!view.idCheck?.otherPerson;
  const idDone = !!view.idCheck && !idOther && (view.idCheck.state === "approved" || view.idCheck.state === "submitted");
  const answered = !!view.question?.pep;
  const ownersDone = !!view.owners?.answer;
  const total = view.docs.length + (view.idCheck ? 1 : 0) + (view.question ? 1 : 0) + (view.owners ? 1 : 0);
  const done = view.docs.filter(d => d.files.length).length + (idDone ? 1 : 0) + (view.question && answered ? 1 : 0) + (view.owners && ownersDone ? 1 : 0);
  const outstanding = [
    ...(view.idCheck && !idDone ? ["the identity check"] : []),
    ...(view.owners && !ownersDone ? ["confirming who owns the company"] : []),
    ...view.docs.filter(d => !d.files.length).map(d => d.title.toLowerCase()),
    ...(view.question && !answered ? ["the question about public roles"] : []),
  ];

  const uploadFiles = async (key: KycDocKey, list: FileList | File[]) => {
    setErrors(e => ({ ...e, [key]: undefined }));
    setBusyKey(key);
    try {
      for (const file of Array.from(list)) {
        if (!KYC_UPLOAD_EXTENSIONS.test(file.name)) { setErrors(e => ({ ...e, [key]: `${file.name}: please send a PDF, a photo (JPG, PNG or HEIC) or a Word document.` })); continue; }
        if (file.size > view.maxFileMb * 1024 * 1024) { setErrors(e => ({ ...e, [key]: `${file.name} is over ${view.maxFileMb}MB. Please send a smaller copy, or a photo of the page.` })); continue; }
        const form = new FormData();
        form.append("docKey", key);
        form.append("file", file);
        const res = await fetch(`/api/kyc-upload/${encodeURIComponent(token)}/file`, { method: "POST", body: form });
        const body = await readJson(res);
        if (!res.ok) { setErrors(e => ({ ...e, [key]: body.message || "The upload didn't work. Please try again." })); if (res.status === 410) await load(); break; }
        setView(body);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const startId = async () => {
    setIdBusy(true);
    setIdMessage(null);
    try {
      const res = await fetch(`/api/kyc-upload/${encodeURIComponent(token)}/id-check`, { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) { setIdMessage(body.message || "The identity check couldn't be started. Please try again."); return; }
      if (body.test) { setIdMessage("Test page: in a real request this opens the identity check, run for BGP by Veriff. You come back here when it's done."); return; }
      if (body.url) window.location.href = body.url;
    } catch {
      setIdMessage("The identity check couldn't be started. Please check your connection and try again.");
    } finally {
      setIdBusy(false);
    }
  };

  const saveAnswer = async (pep: KycPepAnswer, pepDetail: string | null): Promise<string | null> => {
    try {
      const res = await fetch(`/api/kyc-upload/${encodeURIComponent(token)}/answers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pep, pepDetail }) });
      const body = await readJson(res);
      if (!res.ok) { if (res.status === 410) await load(); return body.message || "Your answer wasn't saved. Please try again."; }
      setView(body);
      return null;
    } catch {
      return "Your answer wasn't saved. Please check your connection and try again.";
    }
  };

  const saveOwners = async (answer: KycOwnersAnswer, detail: string | null): Promise<string | null> => {
    try {
      const res = await fetch(`/api/kyc-upload/${encodeURIComponent(token)}/owners`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer, detail }) });
      const body = await readJson(res);
      if (!res.ok) { if (res.status === 410) await load(); return body.message || "Your answer wasn't saved. Please try again."; }
      setView(body);
      return null;
    } catch {
      return "Your answer wasn't saved. Please check your connection and try again.";
    }
  };

  const finish = async () => {
    if (outstanding.length && !confirmFinish) { setConfirmFinish(true); return; }
    setFinishing(true);
    try {
      const res = await fetch(`/api/kyc-upload/${encodeURIComponent(token)}/finish`, { method: "POST" });
      const body = await readJson(res);
      if (res.ok) setView(body);
      else if (res.status === 410) await load();
    } finally {
      setFinishing(false);
      setConfirmFinish(false);
    }
  };

  const contactName = firstName(view.agents[0]?.name) || "your agent";
  let step = 0;

  return (
    <Shell>
      {view.test && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="kyc-test-banner">
          <strong>Test page.</strong> This is what a client sees. Files you upload here are not kept, and nothing is sent to a client.{view.idCheck?.real ? " The identity check is a real one, run by Veriff." : ""}
        </div>
      )}

      {view.finishedAt ? (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:bg-emerald-950/20" data-testid="kyc-finished">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <h2 className="font-semibold text-base">Thank you{firstName(view.recipientName) ? `, ${firstName(view.recipientName)}` : ""}. That's all done.</h2>
              <p className="mt-1 text-sm text-muted-foreground">We've let {contactName} know. If anything else is needed, they'll be in touch. You can still add files here until {kycLongDate(view.expiresAt)}.</p>
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-base">Hello{firstName(view.recipientName) ? ` ${firstName(view.recipientName)}` : ""},</p>
      <h1 className="mt-2 text-2xl font-bold leading-tight text-[#6E0C25] dark:text-[#e8a3b3]">Your identity checks for {view.dealName}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Before the deal can go ahead, the law requires us to confirm who we are dealing with
        {view.kind === "company" ? <> for <strong className="text-foreground">{view.partyName}</strong></> : null}. This page is just for you, and it should take about ten minutes.
        {view.kind === "company" ? " We read the company's details from Companies House ourselves, so you don't need to send anything filed there." : ""}
      </p>

      <div className="mt-5" data-testid="kyc-progress">
        <div className="flex items-center justify-between text-sm"><span className="font-medium">{done} of {total} done</span><span className="text-muted-foreground">Works until {kycLongDate(view.expiresAt)}</span></div>
        <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></div>
      </div>

      {view.note && (
        <div className="mt-5 border-l-[3px] border-[#6E0C25] bg-muted/50 px-4 py-3 text-sm">
          <div className="font-semibold">A note from {contactName}</div>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{view.note}</p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {view.idCheck && (() => {
          step++;
          const copy = idOther ? ID_COPY.not_started : ID_COPY[view.idCheck.state] || ID_COPY.not_started;
          return (
            <div className={`rounded-lg border p-4 ${idDone ? "border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10" : ""}`} data-testid="kyc-id-check">
              <div className="flex gap-3">
                <StepNumber n={step} done={idDone} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-base leading-snug">A quick identity check</h3>
                  {idOther && (
                    <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="kyc-id-other">
                      The identity check done on this page was {view.idCheck.verifiedName || "someone else"}'s. This page is for {view.recipientName || "the person we asked"}: if that is not you, please pass the link to them so they can do their own.
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{copy.line}</p>
                  {copy.button && view.idCheck.canStart && (
                    <Button type="button" className="mt-3 bg-[#6E0C25] hover:bg-[#5a0a1f] text-white" disabled={idBusy} onClick={startId} data-testid="kyc-start-id">
                      {idBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}{copy.button}
                    </Button>
                  )}
                  {copy.button && !view.idCheck.canStart && <p className="mt-2 text-sm">Please contact {contactName} to start the identity check again.</p>}
                  {idMessage && <p className="mt-2 text-sm text-muted-foreground" data-testid="kyc-id-message">{idMessage}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">Run for us by Veriff, an identity verification service.</p>
                </div>
              </div>
            </div>
          );
        })()}

        {view.owners && (() => {
          step++;
          return <OwnersCard n={step} owners={view.owners} onSave={saveOwners} />;
        })()}

        {view.docs.map(doc => {
          step++;
          return <UploadCard key={doc.key} n={step} title={doc.title} detail={doc.detail} files={doc.files} docKey={doc.key}
            busy={busyKey === doc.key} error={errors[doc.key] || null} onFiles={uploadFiles} />;
        })}

        {view.question && (() => {
          step++;
          return <QuestionCard n={step} kind={view.kind} answer={view.question.pep} detail={view.question.pepDetail} onSave={saveAnswer} />;
        })()}

        {view.otherFiles.length > 0 && (
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Other files you've sent</h3>
            <ul className="mt-2 space-y-1.5">{view.otherFiles.map((f, i) => <FileLine key={`${f.name}-${i}`} name={f.name} />)}</ul>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-lg bg-muted/50 p-4">
        {!view.finishedAt ? (
          <>
            <h2 className="font-semibold text-base">When you've sent everything</h2>
            <p className="mt-1 text-sm text-muted-foreground">Press Finish and we'll let {contactName} know. You can still add files afterwards.</p>
            {confirmFinish && outstanding.length > 0 && (
              <p className="mt-3 text-sm text-amber-800 dark:text-amber-300" data-testid="kyc-finish-warning">You haven't sent {outstanding.join(", ")} yet. You can finish now and send the rest later, or go back and add them.</p>
            )}
            <Button type="button" className="mt-3 bg-[#6E0C25] hover:bg-[#5a0a1f] text-white" disabled={finishing} onClick={finish} data-testid="kyc-finish">
              {finishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {confirmFinish && outstanding.length ? "Finish anyway" : "Finish"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Finished. Need to add something? Use the upload buttons above.</p>
        )}
      </div>

      <div className="mt-6 space-y-4 border-t pt-5">
        <div>
          <h2 className="text-sm font-semibold mb-2">Questions?</h2>
          <AgentContact agents={view.agents} />
        </div>
        <div>
          <button type="button" className="flex items-center gap-1 text-sm font-semibold" onClick={() => setShowWhy(v => !v)} aria-expanded={showWhy}>
            Why we ask, and how we look after your information <ChevronDown className={`w-4 h-4 transition-transform ${showWhy ? "rotate-180" : ""}`} />
          </button>
          {showWhy && (
            <div className="mt-2 space-y-2 text-sm text-muted-foreground leading-relaxed">
              <p>{KYC_WHY_WE_ASK}</p>
              <p>{KYC_DATA_USE} It goes straight to Bruce Gillingham Pollard over a secure connection and is seen only by the people at BGP who handle these checks.</p>
              <p>Our <a href={KYC_PRIVACY_URL} target="_blank" rel="noreferrer" className="underline hover:text-foreground">privacy notice</a> explains how we handle your information and your rights.</p>
            </div>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="w-3.5 h-3.5" />Bruce Gillingham Pollard · Reference {view.ref}</p>
      </div>
    </Shell>
  );
}
