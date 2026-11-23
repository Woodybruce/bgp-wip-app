// Heads of terms on the transaction page (Woody, 23 November 2026, on the
// Parties & AML pill at "To do · Set the company that signs": "where is the
// upload HOTs place? so can populate?"). Upload the heads of terms; the app
// reads each party's registered company and number, the guarantor and the
// terms, and offers each beside what the transaction holds. Nothing is saved
// until a person presses a button, and each button saves through the route
// the party box or the deal form already uses. BGP staff only: the server
// (server/deal-hots.ts) refuses anyone else. The rules are shared/deal-hots.ts.
import { Suspense, lazy, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, invalidateDealCaches, queryClient } from "@/lib/queryClient";
import {
  HOTS_ROLE_WORDS, hotsTermPatch, hotsTermWords,
  type HotsParty, type HotsPartyMatch, type HotsReadReply, type HotsTermView,
} from "@shared/deal-hots";
import type { DealPartyRole } from "@shared/deal-parties";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "");
const ROLE_FIELD: Record<DealPartyRole, string> = { landlord: "landlordId", tenant: "tenantId", vendor: "vendorId", purchaser: "purchaserId" };
const ROLE_TYPE: Record<DealPartyRole, string> = { landlord: "Landlord", tenant: "Tenant", vendor: "Vendor", purchaser: "Purchaser" };
const CLOSED = ["dissolved", "converted-closed", "removed", "closed", "liquidation"];
const companyWords = (c: { name: string; number: string | null }) => `${c.name}${c.number ? ` · ${c.number}` : ""}`;
const fileable = (name: string) => /\.(pdf|docx)$/i.test(name);

// The party box, loaded when asked for (it carries this file's button: no import cycle).
const DealPartyEditor = lazy(() => import("@/components/deal-parties").then(m => ({ default: m.DealPartyEditor })));

// What the party box's own saves refresh, and the transaction's caches.
function refreshAll(dealId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId] });
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
  invalidateDealCaches(dealId);
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId] });
}

// Reads the heads of terms as a file, or a note typed in the box, and holds
// the dialog that shows what was read. onOpenChange tells a dialog underneath
// (the party box) that this one is open over it.
function useHotsReader(dealId: string, opts: { inEditor?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reply, setReply] = useState<HotsReadReply | null>(null);

  const read = async (what: { file: File } | { text: string }): Promise<boolean> => {
    setBusy(true);
    try {
      const fd = new FormData();
      if ("file" in what) fd.append("file", what.file);
      else fd.append("text", what.text);
      const r = await fetch(`/api/deals/${dealId}/heads-of-terms/read`, { method: "POST", credentials: "include", headers: getAuthHeaders(), body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.message || `Not read (${r.status})`);
      setFile("file" in what ? what.file : null);
      setReply(data as HotsReadReply);
      opts.onOpenChange?.(true);
      return true;
    } catch (e) {
      toast({ title: "file" in what ? "Couldn't read the heads of terms" : "Couldn't read that", description: plain(e), variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const dialog = reply ? (
    <DealHotsDialog dealId={dealId} file={file} reply={reply} onReply={setReply} inEditor={!!opts.inEditor}
      onClose={() => { setReply(null); setFile(null); opts.onOpenChange?.(false); }} />
  ) : null;
  return { busy, read, dialog };
}

const HOTS_ACCEPT = ".pdf,.docx,.doc,.txt,.rtf";

/** The button: choose the document, read it, show the dialog. */
// inEditor: opened from the party box, whose own dialog must not close under it
// (onOpenChange tells it), and whose "Choose the company" is the box itself.
export function DealHotsButton({ dealId, label = "Heads of terms", className, variant = "outline", testId = "deal-hots-button", inEditor = false, onOpenChange }: {
  dealId: string; label?: string; className?: string; variant?: "outline" | "ghost" | "default"; testId?: string;
  inEditor?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, read, dialog } = useHotsReader(dealId, { inEditor, onOpenChange });
  return (
    <>
      <input ref={input} type="file" accept={HOTS_ACCEPT} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (input.current) input.current.value = ""; if (f) void read({ file: f }); }} data-testid={`${testId}-input`} />
      <Button type="button" size="sm" variant={variant} className={className || "h-7 px-2 text-xs"} disabled={busy}
        onClick={() => input.current?.click()} data-testid={testId}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1 h-3.5 w-3.5" />}
        {busy ? "Reading…" : label}
      </Button>
      {dialog}
    </>
  );
}

/**
 * The box at the top of Parties and AML (Woody, 23 November 2026: "shall we
 * have the box that populates the deal here too? drop HOTS or type it out?
 * Easier for people"): type the transaction out, or drop or choose the heads
 * of terms. One line until it is used.
 */
export function DealDescribeBox({ dealId }: { dealId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { busy, read, dialog } = useHotsReader(dealId);
  const typed = text.trim();
  const choose = () => input.current?.click();
  return (
    <div
      className={`rounded-md border px-2.5 py-2 transition-colors ${dragging ? "border-primary bg-primary/5" : "border-dashed border-border"}`}
      onDragOver={e => { if (Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={e => { const f = e.dataTransfer.files?.[0]; if (!f) return; e.preventDefault(); setDragging(false); void read({ file: f }); }}
      data-testid="deal-describe-box"
    >
      <input ref={input} type="file" accept={HOTS_ACCEPT} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (input.current) input.current.value = ""; if (f) void read({ file: f }); }} data-testid="deal-describe-file" />
      <div className="flex items-start gap-2">
        <Textarea
          value={text}
          rows={open ? 3 : 1}
          onFocus={() => setOpen(true)}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && typed.length >= 10 && !busy) { e.preventDefault(); void read({ text: typed }); } }}
          placeholder={dragging ? "Drop the heads of terms to read them" : "Describe the transaction, or drop the heads of terms here"}
          className={`min-h-0 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0 ${open ? "" : "h-9 overflow-hidden"}`}
          aria-label="Describe the transaction"
          data-testid="deal-describe-text"
        />
        {!open && (
          <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-xs" disabled={busy} onClick={choose} data-testid="deal-describe-choose">
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1 h-3.5 w-3.5" />}
            {busy ? "Reading…" : "Heads of terms"}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="h-7 text-xs" disabled={busy || typed.length < 10} onClick={() => void read({ text: typed })} data-testid="deal-describe-read">
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}{busy ? "Reading…" : "Fill it in"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={choose}>
            <FileText className="mr-1 h-3.5 w-3.5" />Choose the heads of terms
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={() => { setOpen(false); setText(""); }}>
            Cancel
          </Button>
          <span className="basis-full text-[11px] text-muted-foreground">e.g. "Landlord is Braeburn Estates Ltd, tenant is Bill's Restaurants Ltd, £85k pa, 10 yrs"</span>
        </div>
      )}
      {dialog}
    </div>
  );
}

function DealHotsDialog({ dealId, file, reply, onReply, onClose, inEditor }: {
  dealId: string; file: File | null; reply: HotsReadReply; onReply: (r: HotsReadReply) => void; onClose: () => void; inEditor: boolean;
}) {
  const fromNote = !file;
  const { toast } = useToast();
  const [editing, setEditing] = useState<DealPartyRole | null>(null);
  const [filed, setFiled] = useState(false);
  const reading = reply.reading;
  const parties: HotsParty[] = reply.parties.map(p => p.read);

  // After anything is set, where each party stands is read again (the document is not).
  const rematch = async () => {
    const r = await apiRequest("POST", `/api/deals/${dealId}/heads-of-terms/match`, { parties, terms: reply.terms });
    const next = await r.json() as HotsReadReply;
    onReply({ ...reply, parties: next.parties, terms: next.terms, filing: next.filing });
  };
  const act = useMutation({
    mutationFn: async (run: () => Promise<string>) => run(),
    onSuccess: async (said) => {
      refreshAll(dealId);
      toast({ title: said });
      await rematch().catch(() => undefined);
    },
    onError: (e) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  const busy = act.isPending;

  const useCompany = (role: DealPartyRole, companyId: string, name: string) => act.mutate(async () => {
    await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}`, { companyId });
    return `${name} signs for the ${role}`;
  });
  const addCompany = (role: DealPartyRole, brandId: string, number: string, name: string) => act.mutate(async () => {
    const r = await apiRequest("POST", "/api/billing-entities", { brandId, companyNumber: number, xero: false });
    const made = await r.json();
    const companyId = String(made?.entity?.id || "");
    if (!companyId) throw new Error("The company was not saved.");
    await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}`, { companyId });
    return `${made?.entity?.name || name} signs for the ${role}`;
  });
  const setParty = (role: DealPartyRole, brandId: string, brandName: string, entityId: string | null) => act.mutate(async () => {
    await apiRequest("PUT", `/api/crm/deals/${dealId}`, { [ROLE_FIELD[role]]: brandId });
    if (entityId) await apiRequest("PUT", `/api/deals/${dealId}/parties/${role}`, { companyId: entityId });
    return `${brandName} is the ${role}`;
  });
  const addParty = (role: DealPartyRole, name: string) => act.mutate(async () => {
    const r = await apiRequest("POST", "/api/crm/companies", { name, companyType: ROLE_TYPE[role] });
    const made = await r.json();
    queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    await apiRequest("PUT", `/api/crm/deals/${dealId}`, { [ROLE_FIELD[role]]: String(made.id) });
    return `${made.name} added to the CRM as the ${role}`;
  });
  const saveTerms = (list: HotsTermView[]) => act.mutate(async () => {
    const patch = Object.assign({}, ...list.map(t => hotsTermPatch(t.key, t.value)));
    await apiRequest("PUT", `/api/crm/deals/${dealId}`, patch);
    return list.length === 1 ? `${list[0].label} filled in` : `${list.length} terms filled in`;
  });
  const fileIt = () => act.mutate(async () => {
    if (!reply.filing || !file) throw new Error("No tracker unit to file them on.");
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`/api/unit-hots/${encodeURIComponent(reply.filing.unitId)}/final`, { method: "POST", credentials: "include", headers: getAuthHeaders(), body: fd });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `Not filed (${r.status})`);
    queryClient.invalidateQueries({ queryKey: ["/api/unit-hots", reply.filing.unitId] });
    queryClient.invalidateQueries({ queryKey: ["/api/available-units", reply.filing.unitId, "files"] });
    setFiled(true);
    return `Filed on ${reply.filing.unitName} as the final agreed heads of terms`;
  });

  const blanks = reply.terms.filter(t => t.state === "blank");
  const dealParties = reply.parties.filter(p => p.role);
  const guarantors = reply.parties.filter(p => !p.role);

  return (
    <>
      <Dialog open onOpenChange={o => { if (!o && !editing) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="deal-hots-dialog">
          <DialogHeader>
            <DialogTitle>{fromNote ? "What you typed" : "Heads of terms"}</DialogTitle>
            <DialogDescription className="break-words">
              {fromNote ? "Read from your note." : `${reply.fileName || file?.name}.`} Nothing is saved until you press a button.
            </DialogDescription>
          </DialogHeader>

          {reading?.note && <p className="text-xs text-muted-foreground" data-testid="deal-hots-note">Read without Claude: {reading.note}.</p>}
          {reading?.scanned && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="deal-hots-scanned">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />A scan: its words could not be checked. Check each line against the document.
            </p>
          )}

          <section className="space-y-2" data-testid="deal-hots-parties">
            <h4 className="text-sm font-semibold">Parties</h4>
            {dealParties.length === 0 && guarantors.length === 0 && (
              <p className="text-xs text-muted-foreground">No landlord, tenant, vendor or purchaser could be read{fromNote ? ': write them as "Landlord is …", "Tenant is …"' : ""}. Or set them in the party box.</p>
            )}
            {dealParties.map(p => (
              <PartyLine key={`${p.role}-${p.read.name}`} match={p} busy={busy} source={fromNote ? "Your note" : "The heads of terms"}
                onUse={useCompany} onAdd={addCompany} onSetParty={setParty} onAddParty={addParty} onChoose={(role) => (inEditor ? onClose() : setEditing(role))} />
            ))}
            {guarantors.map(g => (
              <div key={`g-${g.read.name}`} className="rounded-md border px-2.5 py-2 text-xs" data-testid="deal-hots-guarantor">
                <div><span className="font-semibold">Guarantor</span> · {companyWords(g.read)}</div>
                {g.register[0] && <div className="text-muted-foreground">At Companies House: {companyWords(g.register[0])}{g.register[0].status ? ` · ${g.register[0].status}` : ""}</div>}
                <Quote text={g.read.quote} />
              </div>
            ))}
          </section>

          {reply.terms.length > 0 && (
            <section className="space-y-2" data-testid="deal-hots-terms">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold">Terms</h4>
                {blanks.length > 1 && (
                  <Button type="button" size="sm" className="ml-auto h-7 text-xs" disabled={busy} onClick={() => saveTerms(blanks)} data-testid="deal-hots-fill-blanks">
                    Fill the {blanks.length} blank ones
                  </Button>
                )}
              </div>
              <ul className="divide-y rounded-md border">
                {reply.terms.map(t => (
                  <li key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs" data-testid={`deal-hots-term-${t.key}`}>
                    <span className="w-28 shrink-0 text-muted-foreground sm:w-36">{t.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium tabular-nums">{hotsTermWords(t.kind, t.value)}</span>
                      {t.state === "differs" && <span className="ml-2 text-amber-800 dark:text-amber-300">the transaction has {hotsTermWords(t.kind, t.current)}</span>}
                      <Quote text={t.quote} />
                    </span>
                    {t.state === "same"
                      ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Same</span>
                      : <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => saveTerms([t])}>{t.state === "blank" ? "Fill in" : "Use this"}</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {reply.filing && file && fileable(file.name) && (
            <section className="space-y-1.5 text-xs" data-testid="deal-hots-filing">
              {reply.filing.onFile || filed
                ? <p className="text-muted-foreground">Final agreed heads of terms on file on {reply.filing.unitName}{reply.filing.onFile ? `: ${reply.filing.onFile}` : ""}.</p>
                : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-muted-foreground">{reply.filing.unitName} has no final agreed heads of terms on file. Filed there, they go in the AML file too.</span>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={fileIt} data-testid="deal-hots-file">
                      File these as the final agreed heads of terms
                    </Button>
                  </div>
                )}
            </section>
          )}

          {(reading?.dropped || []).length > 0 && (
            <details className="text-xs text-muted-foreground" data-testid="deal-hots-dropped">
              <summary className="cursor-pointer">Left out ({reading!.dropped.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {reading!.dropped.map((d, i) => <li key={i}>{d.what}: {d.value} ({d.reason})</li>)}
              </ul>
            </details>
          )}
        </DialogContent>
      </Dialog>
      {editing && (
        <Suspense fallback={null}>
          <DealPartyEditor dealId={dealId} role={editing} onClose={() => { setEditing(null); void rematch().catch(() => undefined); }} />
        </Suspense>
      )}
    </>
  );
}

function Quote({ text }: { text: string }) {
  if (!text) return null;
  return <span className="mt-0.5 block truncate text-[11px] italic text-muted-foreground" title={text}>"{text}"</span>;
}

function PartyLine({ match, busy, source, onUse, onAdd, onSetParty, onAddParty, onChoose }: {
  match: HotsPartyMatch; busy: boolean; source: string;
  onUse: (role: DealPartyRole, companyId: string, name: string) => void;
  onAdd: (role: DealPartyRole, brandId: string, number: string, name: string) => void;
  onSetParty: (role: DealPartyRole, brandId: string, brandName: string, entityId: string | null) => void;
  onAddParty: (role: DealPartyRole, name: string) => void;
  onChoose: (role: DealPartyRole) => void;
}) {
  const role = match.role!;
  const read = match.read;
  const brand = match.brand;
  const hit = match.register[0] || null;
  const closed = hit ? CLOSED.includes(String(hit.status || "").toLowerCase()) : false;
  const quiet = "h-7 text-xs";

  const body = (() => {
    switch (match.state) {
      case "signs":
        return <p className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Already the company that signs.</p>;
      case "filed":
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">Filed under {brand!.name}: <span className="font-medium">{companyWords(match.filed!)}</span>{match.signing ? <span className="text-muted-foreground"> (signs now: {match.signing.name})</span> : null}</span>
            <Button type="button" size="sm" className={quiet} disabled={busy} onClick={() => onUse(role, match.filed!.id, match.filed!.name)} data-testid={`deal-hots-use-${role}`}>Use as the company that signs</Button>
          </div>
        );
      case "register":
        return (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">At Companies House: <span className="font-medium">{companyWords(hit!)}</span>{hit!.status ? <span className="text-muted-foreground"> · {hit!.status.replace(/-/g, " ")}</span> : null}</span>
              {!closed && (
                <Button type="button" size="sm" className={quiet} disabled={busy} onClick={() => onAdd(role, brand!.id, hit!.number, hit!.name)} data-testid={`deal-hots-add-${role}`}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Add under {brand!.name} and use it
                </Button>
              )}
            </div>
            {!hit!.agrees && <p className="text-amber-800 dark:text-amber-300">Named as {read.name} in {source.toLowerCase()}: check it is the same company.</p>}
            {match.registerNote && <p className={closed ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}>{match.registerNote}</p>}
          </div>
        );
      case "choose":
        return (
          <div className="space-y-1">
            <p className="text-muted-foreground">Companies House has more than one live company of that name. Pick the one that signs:</p>
            {match.register.map(h => (
              <div key={h.number} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">{companyWords(h)}{h.address ? <span className="text-muted-foreground"> · {h.address}</span> : null}</span>
                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => onAdd(role, brand!.id, h.number, h.name)}>Use</Button>
              </div>
            ))}
          </div>
        );
      case "not_found":
      case "no_company":
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-muted-foreground">
              {match.state === "no_company" ? `No registered company is given for ${read.name}.` : match.registerNote || "Not found at Companies House."}
            </span>
            <Button type="button" size="sm" variant="outline" className={quiet} disabled={busy} onClick={() => onChoose(role)} data-testid={`deal-hots-choose-${role}`}>Choose the company</Button>
          </div>
        );
      case "no_party":
        return (
          <div className="space-y-1">
            <p className="text-muted-foreground">The transaction has no {role} yet.</p>
            {match.candidates.slice(0, 3).map(c => (
              <div key={`${c.companyId}-${c.entityId || ""}`} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">{c.companyName}{c.entityName ? <span className="text-muted-foreground"> · signing as {c.entityName}{c.entityNumber ? ` (${c.entityNumber})` : ""}</span> : null}</span>
                <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy}
                  onClick={() => onSetParty(role, c.companyId, c.companyName, c.entityId)} data-testid={`deal-hots-set-${role}`}>Make them the {role}</Button>
              </div>
            ))}
            {match.candidates.length === 0 && (
              <Button type="button" size="sm" variant="outline" className={quiet} disabled={busy} onClick={() => onAddParty(role, read.name)} data-testid={`deal-hots-add-party-${role}`}>
                <Plus className="mr-1 h-3.5 w-3.5" />Add {read.name} as the {role}
              </Button>
            )}
          </div>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-1 rounded-md border px-2.5 py-2 text-xs" data-testid={`deal-hots-party-${role}`}>
      <div>
        <span className="font-semibold">{HOTS_ROLE_WORDS[role]}</span>
        {brand && <span className="text-muted-foreground"> · {brand.name}</span>}
      </div>
      <div>{source}: <span className="font-medium">{companyWords(read)}</span>{!read.checked && <span className="text-amber-800 dark:text-amber-300"> · check it by eye</span>}</div>
      <Quote text={read.quote} />
      {body}
    </div>
  );
}
