// Requirements centre, BGP staff only (Woody, 2026-11-12): the To confirm tray
// of suggestions and the evidence drawer on a requirement. Both read and
// write the staff routes in server/requirement-intake-routes.ts; neither is
// mounted for a client login. A suggestion is never a requirement: a person
// answers each one here, and nowhere else in the app.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { cn, countLabel } from "@/lib/utils";
import { formatRequirementDay } from "@shared/requirement-live";

// One line of evidence as the staff routes send it (evidenceOut in server/requirement-intake.ts).
export type EvidenceLine = {
  id: string;
  requirementId: string | null;
  companyId: string | null;
  brandName: string | null;
  kind: string;
  sourceLabel: string | null;
  sourceRef: string | null;
  evidenceDate: string | null;
  headline: string | null;
  excerpt: string | null;
  url: string | null;
  saidBy: string | null;
  details: Record<string, any> | null;
  confidence: string | null;
  status: string;
  createdBy: { kind: string; userId: string | null; name: string | null };
  resolved: { userId: string | null; name: string | null; at: string; reason: string | null } | null;
  createdAt: string | null;
};
type OnFile = { id: string; name: string; status: string | null; state: string; stateLabel: string; dateLabel: string };
export type RequirementSuggestion = EvidenceLine & {
  brand: { companyId: string | null; name: string | null; saidAs: string | null; matched: boolean; candidates: Array<{ id: string; name: string }> };
  lineCount: number;
  lines: EvidenceLine[];
  existingRequirements: OnFile[];
  proposed: "pick_brand" | "confirm_existing" | "choose" | "new" | "mark_satisfied" | "still_live";
};
export type SuggestionList = { status: string; suggestions: RequirementSuggestion[]; counts: { open: number; unmatched: number; byKind: Record<string, number> } };
type BrandOption = { id: string; name: string; companyType?: string | null };

const KIND_LABELS: Record<string, string> = {
  press: "News", chat: "ChatBGP", team_chat: "Team chat", gossip: "Gossip", meeting: "Meeting", viewing: "Viewing", offer: "Offer",
  deal: "Deal", listing: "Market listing", call: "Call", email: "Email", whatsapp: "WhatsApp", note: "Note",
};
const KIND_PLURALS: Record<string, string> = { meeting: "Meetings", viewing: "Viewings", offer: "Offers", deal: "Deals", call: "Calls", email: "Emails", note: "Notes" };
const kindLabel = (kind: string) => KIND_LABELS[kind] || kind;

const microLabel = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const chip = "inline-flex items-center rounded border border-border px-1 py-px text-[10px] font-normal leading-none text-muted-foreground whitespace-nowrap";

function dayOf(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? formatRequirementDay(d, new Date()) : "no date";
}

const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// What a reader took out of the source: sites, size, use, places, timing.
function detectedFacts(d: Record<string, any> | null): string[] {
  if (!d) return [];
  const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
  const out: string[] = [];
  const sites = Number(d.sites);
  if (Number.isFinite(sites) && sites > 0) out.push(`${countLabel(sites, "site")}${d.uk === true ? " in the UK" : ""}`);
  for (const key of ["size", "use", "locations"]) {
    const vals = list(d[key]);
    if (vals.length) out.push(vals.join(", "));
  }
  if (typeof d.timing === "string" && d.timing.trim()) out.push(d.timing.trim());
  return out;
}

const listText = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).join(", ");
const textList = (v: string) => v.split(/[,;\n]/).map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, 40);
// A size carries its own commas ("2,500 to 3,500 sq ft"): more than one is separated by a semicolon, never a comma.
const sizeText = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).join("; ");
const sizeList = (v: string) => v.split(/[;\n]/).map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, 40);
// How long a dismissal waits for Undo before it is saved.
const UNDO_MS = 6000;

async function send(method: "POST", path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(path, { method, credentials: "include", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// A link kept on a line: a screen in the app, or the article in a new tab.
function EvidenceLink({ url, navigate, testId }: { url: string | null; navigate: (to: string) => void; testId?: string }) {
  if (!url) return null;
  const cls = "inline-flex items-center gap-0.5 text-primary hover:underline";
  if (url.startsWith("/")) return <button type="button" className={cls} onClick={() => navigate(url)} data-testid={testId}>Open</button>;
  if (!/^https?:\/\//i.test(url)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cls} data-testid={testId}>
      Open <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function BrandPicker({ companies, candidates, onPick, onNone, onCancel, busy, testId }: {
  companies: BrandOption[];
  candidates: Array<{ id: string; name: string }>;
  onPick: (brand: { id: string; name: string }) => void;
  /** "It is not about a brand in the CRM": dismissed as the wrong brand. */
  onNone: () => void;
  onCancel: () => void;
  busy: boolean;
  testId: string;
}) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return companies.filter((c) => c.name.toLowerCase().includes(s))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(s)) - Number(a.name.toLowerCase().startsWith(s)) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [companies, q]);
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2" data-testid={testId}>
      <p className={microLabel}>Which brand is it about?</p>
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {candidates.map((c) => (
            <Button key={c.id} type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={busy} onClick={() => onPick(c)} data-testid={`${testId}-candidate-${c.id}`}>
              {c.name}
            </Button>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) { e.preventDefault(); onPick(results[0]); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
          }}
          placeholder="Search brands…"
          className="h-9 pl-8"
          data-testid={`${testId}-search`}
        />
      </div>
      {results.length > 0 && (
        <div className="rounded-md border border-border bg-popover">
          {results.map((c) => (
            <button key={c.id} type="button" disabled={busy} className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent" onClick={() => onPick(c)} data-testid={`${testId}-option-${c.id}`}>
              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.companyType && <span className="shrink-0 text-[10px] text-muted-foreground">{c.companyType}</span>}
            </button>
          ))}
        </div>
      )}
      {q.trim() && results.length === 0 && <p className="text-[11px] text-muted-foreground">No brand in the CRM matches. Add it with New Brand first, or say it is not a brand we hold.</p>}
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel} data-testid={`${testId}-cancel`}>Cancel</Button>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={busy} onClick={onNone} data-testid={`${testId}-none`}>Not a brand we hold</Button>
      </div>
    </div>
  );
}

type AnswerMode = "confirm" | "attach" | "satisfied" | "still_live" | "not_live";
type AnswerState = { suggestion: RequirementSuggestion; mode: AnswerMode; existing: OnFile[]; target: string | null };
type Chosen = { requirementId: string | null; how: string | null; fields: Record<string, any> | null };
const NEW_TARGET = "__new__";

// The step before an answer that needs a choice: which requirement, or the
// detected fields of a new one, editable before anything is saved.
function AnswerDialog({ state, onClose, onSubmit }: { state: AnswerState; onClose: () => void; onSubmit: (chosen: Chosen) => void }) {
  const { suggestion: s, mode, existing } = state;
  const d = s.details || {};
  const brandName = s.brand.name || s.brand.saidAs || "this brand";
  const [target, setTarget] = useState<string | null>(state.target ?? (mode === "confirm" && !existing.length ? NEW_TARGET : existing.length === 1 && mode !== "confirm" ? existing[0].id : null));
  const [name, setName] = useState(brandName);
  const [use, setUse] = useState(listText(d.use));
  const [size, setSize] = useState(sizeText(d.size));
  const [places, setPlaces] = useState(listText(d.locations));
  const [notes, setNotes] = useState("");
  const [how, setHow] = useState("source");
  const isNew = target === NEW_TARGET;
  const title = mode === "confirm" ? `Confirm a requirement for ${brandName}`
    : mode === "attach" ? "Add to which requirement?"
    : mode === "satisfied" ? "Which requirement does the deal satisfy?"
    : mode === "still_live" ? "Which requirement is still live?"
    : "Which requirement is no longer live?";
  const note = mode === "confirm" ? "You are recorded as confirming it today. Check what was detected before it is saved."
    : mode === "attach" ? "The evidence is added to the requirement. Its confirmed date does not move."
    : mode === "satisfied" ? "The requirement is closed as Past and the deal is kept on it."
    : mode === "still_live" ? "You are recorded as confirming it today."
    : "The requirement is archived and the story is kept on it.";
  const sourceHow = s.kind === "press" ? "I read it in the press (stays press-reported)"
    : s.kind === "viewing" || s.kind === "offer" ? "From the viewings"
    : s.kind === "meeting" ? "From the meeting"
    : s.kind === "call" ? "From the call"
    : s.kind === "email" ? "From the email"
    : s.kind === "chat" || s.kind === "team_chat" || s.kind === "gossip" || s.kind === "whatsapp" ? "From the chat"
    : "From this suggestion";
  const submit = () => {
    if (!target) return;
    const fields: Record<string, any> = {};
    if (isNew) {
      if (name.trim() && !sameName(name, brandName)) fields.name = name.trim().slice(0, 200);
      if (textList(use).length) fields.use = textList(use);
      if (sizeList(size).length) fields.size = sizeList(size);
      if (textList(places).length) fields.requirementLocations = textList(places);
      if (notes.trim()) fields.comments = notes.trim();
    }
    onSubmit({ requirementId: isNew ? null : target, how: mode === "confirm" && how !== "source" ? how : null, fields: isNew && Object.keys(fields).length ? fields : null });
  };
  const input = "h-11 sm:h-9";
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="dialog-suggestion-answer">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{note}</DialogDescription>
          </DialogHeader>
          {(existing.length > 0 || mode !== "confirm") && (
            <div className="space-y-1.5" role="radiogroup" aria-label="Requirement">
              {existing.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={target === r.id} onClick={() => setTarget(r.id)}
                  className={cn("flex w-full items-center gap-2 rounded-md border p-2 text-left", target === r.id ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/30")}
                  data-testid={`answer-target-${r.id}`}>
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", target === r.id ? "border-foreground bg-foreground text-background" : "border-border")}>
                    {target === r.id && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{r.stateLabel} · {r.dateLabel}</span>
                  </span>
                </button>
              ))}
              {existing.length === 0 && <p className="text-sm text-muted-foreground">{brandName} has no open requirement.</p>}
              {mode === "confirm" && (
                <button type="button" role="radio" aria-checked={isNew} onClick={() => setTarget(NEW_TARGET)}
                  className={cn("flex w-full items-center gap-2 rounded-md border p-2 text-left", isNew ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/30")}
                  data-testid="answer-target-new">
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", isNew ? "border-foreground bg-foreground text-background" : "border-border")}>
                    {isNew && <Check className="h-3 w-3" />}
                  </span>
                  <span className="text-sm font-medium">A separate, new requirement</span>
                </button>
              )}
            </div>
          )}
          {isNew && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className={microLabel}>Requirement name</span>
                <Input className={input} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="answer-field-name" />
              </label>
              <label className="space-y-1">
                <span className={microLabel}>Size</span>
                <Input className={input} value={size} onChange={(e) => setSize(e.target.value)} placeholder="2,000–3,000 sq ft" title="More than one size: separate them with a semicolon" data-testid="answer-field-size" />
              </label>
              <label className="space-y-1">
                <span className={microLabel}>Use</span>
                <Input className={input} value={use} onChange={(e) => setUse(e.target.value)} placeholder="Restaurant" data-testid="answer-field-use" />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={microLabel}>Locations, separated by commas</span>
                <Input className={input} value={places} onChange={(e) => setPlaces(e.target.value)} placeholder="Leeds, York" data-testid="answer-field-locations" />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={microLabel}>Comments</span>
                <Textarea rows={2} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} data-testid="answer-field-comments" />
              </label>
            </div>
          )}
          {mode === "confirm" && (
            <div className="space-y-1">
              <span className={microLabel}>How do you know?</span>
              <Select value={how} onValueChange={setHow}>
                <SelectTrigger className={input} data-testid="answer-field-how"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="source">{sourceHow}</SelectItem>
                  <SelectItem value="call">I spoke to the brand (call)</SelectItem>
                  <SelectItem value="meeting">I met the brand</SelectItem>
                  <SelectItem value="email">The brand told me by email</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} data-testid="answer-cancel">Cancel</Button>
            <Button type="submit" disabled={!target} data-testid="answer-submit">
              {mode === "confirm" ? "Confirm" : mode === "attach" ? "Add to requirement" : mode === "satisfied" ? "Mark satisfied" : mode === "still_live" ? "Still live" : "Not live"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The To confirm tray: every open suggestion as a card with one-tap answers.
 * Keys on a focused card: C confirm, A add to an existing requirement,
 * W wrong brand, N not a requirement, arrows to move. An answered card
 * leaves at once; if the save fails it comes back with the reason.
 */
export function SuggestionTray({ suggestions, totalOpen, searching, isLoading, isError, onRetry, companies, isMobile, navigate, onAnswered }: {
  /** Open suggestions, already narrowed by the page's search. */
  suggestions: RequirementSuggestion[];
  totalOpen: number;
  searching: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  companies: BrandOption[];
  isMobile: boolean;
  navigate: (to: string) => void;
  onAnswered: () => void;
}) {
  const { toast } = useToast();
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<string | null>(null);
  const [brandFor, setBrandFor] = useState<string | null>(null);
  const [brandBusy, setBrandBusy] = useState(false);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const cards = useRef(new Map<string, HTMLDivElement>());

  const open = useMemo(() => suggestions.filter((s) => !cleared.has(s.id)), [suggestions, cleared]);
  const byKind = useMemo(() => {
    const map = new Map<string, number>();
    open.forEach((s) => map.set(s.kind, (map.get(s.kind) || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1] || kindLabel(a[0]).localeCompare(kindLabel(b[0])));
  }, [open]);
  const activeKind = kind && byKind.some(([k]) => k === kind) ? kind : null;
  const visible = activeKind ? open.filter((s) => s.kind === activeKind) : open;

  const focusCard = (id: string | undefined) => {
    if (!id) return;
    requestAnimationFrame(() => {
      const el = cards.current.get(id);
      if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" }); }
    });
  };
  const move = (id: string, step: number) => {
    const i = visible.findIndex((s) => s.id === id);
    focusCard(visible[i + step]?.id);
  };
  const setClearedFor = (id: string, on: boolean) => setCleared((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  // The card leaves at once; the answer is saved behind it.
  const save = async (s: RequirementSuggestion, action: string, body: Record<string, any>, done: (data: any) => string, mode: AnswerMode, quiet = false) => {
    const i = visible.findIndex((v) => v.id === s.id);
    const neighbour = (visible[i + 1] || visible[i - 1])?.id;
    const hadFocus = !!cards.current.get(s.id)?.contains(document.activeElement);
    setClearedFor(s.id, true);
    if (hadFocus) focusCard(neighbour);
    let r: { ok: boolean; status: number; data: any };
    try {
      r = await send("POST", `/api/requirement-suggestions/${encodeURIComponent(s.id)}/${action}`, body);
    } catch {
      r = { ok: false, status: 0, data: { error: "No connection. Nothing was saved." } };
    }
    if (r.ok) { if (!quiet) toast({ title: done(r.data) }); onAnswered(); return; }
    if (r.status === 409 && r.data.code === "ALREADY_ANSWERED") {
      toast({ title: "Someone has already answered this", description: r.data.error });
      onAnswered();
      return;
    }
    setClearedFor(s.id, false);
    const existing: OnFile[] = Array.isArray(r.data.existing) ? r.data.existing : [];
    if (r.status === 409 && (r.data.code === "EXISTING_REQUIREMENT" || r.data.code === "REQUIREMENT_NEEDED") && existing.length) {
      setAnswer({ suggestion: s, mode, existing, target: null });
      return;
    }
    if (r.status === 409 && r.data.code === "BRAND_NEEDED") setBrandFor(s.id);
    toast({ title: "The answer was not saved", description: r.data.error || "Try again.", variant: "destructive" });
  };

  const brandOf = (s: RequirementSuggestion) => s.brand.name || s.brand.saidAs || "This brand";
  const confirmNow = (s: RequirementSuggestion, body: Record<string, any>, mode: AnswerMode = "confirm") =>
    save(s, "confirm", body, (data) => data.outcome === "confirmed_existing"
      ? `${brandOf(s)}: confirmed by you today`
      : `${brandOf(s)}: requirement added, confirmed by you today`, mode);
  const attachTo = (s: RequirementSuggestion, requirementId: string) =>
    save(s, "attach", { requirementId }, () => `${brandOf(s)}: added to the requirement`, "attach");
  // A dismissal is one tap, so it waits a few seconds for Undo before it is
  // saved. Leaving the page saves the ones still waiting.
  const waiting = useRef(new Map<string, { timer: number; run: () => void }>());
  useEffect(() => () => { waiting.current.forEach((w) => { window.clearTimeout(w.timer); w.run(); }); }, []);
  const dismissAs = (s: RequirementSuggestion, reason: string) => {
    if (waiting.current.has(s.id)) return;
    const i = visible.findIndex((v) => v.id === s.id);
    const neighbour = (visible[i + 1] || visible[i - 1])?.id;
    const hadFocus = !!cards.current.get(s.id)?.contains(document.activeElement);
    setClearedFor(s.id, true);
    if (hadFocus) focusCard(neighbour);
    const run = () => { waiting.current.delete(s.id); void save(s, "dismiss", { reason }, () => "", "confirm", true); };
    const timer = window.setTimeout(run, UNDO_MS);
    waiting.current.set(s.id, { timer, run });
    const undo = () => {
      if (!waiting.current.has(s.id)) return;
      window.clearTimeout(timer);
      waiting.current.delete(s.id);
      setClearedFor(s.id, false);
      focusCard(s.id);
    };
    toast({
      title: `${brandOf(s)}: dismissed`,
      description: s.kind === "press" && !isQuestion(s) && reason !== "wrong_brand" ? "Its news is quiet for 30 days." : undefined,
      duration: UNDO_MS,
      action: <ToastAction altText="Undo the dismissal" onClick={undo} data-testid={`suggestion-undo-${s.id}`}>Undo</ToastAction>,
    });
  };
  const satisfied = (s: RequirementSuggestion, requirementId?: string) =>
    save(s, "satisfied", requirementId ? { requirementId } : {}, () => `${brandOf(s)}: requirement marked satisfied`, "satisfied");
  const notLive = (s: RequirementSuggestion, requirementId?: string) =>
    save(s, "not-live", requirementId ? { requirementId } : {}, () => `${brandOf(s)}: requirement archived`, "not_live");

  const isQuestion = (s: RequirementSuggestion) => s.proposed === "mark_satisfied" || s.proposed === "still_live";
  const primary = (s: RequirementSuggestion) => {
    if (s.proposed === "pick_brand") return setBrandFor(s.id);
    if (s.proposed === "mark_satisfied") return void satisfied(s);
    if (s.proposed === "still_live") return void confirmNow(s, {}, "still_live");
    if (s.proposed === "confirm_existing") return void confirmNow(s, { requirementId: s.existingRequirements[0].id });
    setAnswer({ suggestion: s, mode: "confirm", existing: s.existingRequirements, target: null });
  };
  const addToExisting = (s: RequirementSuggestion) => {
    if (s.proposed === "pick_brand") return setBrandFor(s.id);
    if (!s.existingRequirements.length) {
      toast({ title: `${brandOf(s)} has no requirement to add this to`, description: "Confirm makes one." });
      return;
    }
    if (s.existingRequirements.length === 1) return void attachTo(s, s.existingRequirements[0].id);
    setAnswer({ suggestion: s, mode: "attach", existing: s.existingRequirements, target: null });
  };
  const negative = (s: RequirementSuggestion) => void dismissAs(s, isQuestion(s) ? "not_relevant" : "not_a_requirement");

  const pickBrand = async (s: RequirementSuggestion, brand: { id: string; name: string }) => {
    if (brandBusy) return;
    setBrandBusy(true);
    try {
      const r = await send("POST", `/api/requirement-suggestions/${encodeURIComponent(s.id)}/brand`, { companyId: brand.id });
      if (!r.ok) throw new Error(r.data.error || "The brand could not be set");
      setBrandFor(null);
      if (r.data.joined) {
        setClearedFor(s.id, true);
        toast({ title: `Added to ${brand.name}'s open suggestion` });
      } else {
        toast({ title: `Brand set to ${brand.name}` });
        focusCard(s.id);
      }
      onAnswered();
    } catch (e: any) {
      toast({ title: "The brand was not changed", description: e?.message, variant: "destructive" });
    } finally {
      setBrandBusy(false);
    }
  };

  const submitAnswer = (chosen: Chosen) => {
    if (!answer) return;
    const { suggestion: s, mode } = answer;
    setAnswer(null);
    if (mode === "attach") return void attachTo(s, chosen.requirementId!);
    if (mode === "satisfied") return void satisfied(s, chosen.requirementId!);
    if (mode === "not_live") return void notLive(s, chosen.requirementId!);
    if (mode === "still_live") return void confirmNow(s, { requirementId: chosen.requirementId }, "still_live");
    void confirmNow(s, {
      ...(chosen.requirementId ? { requirementId: chosen.requirementId } : s.existingRequirements.length || answer.existing.length ? { createNew: true } : {}),
      ...(chosen.how ? { how: chosen.how } : {}),
      ...(chosen.fields ? { fields: chosen.fields } : {}),
    });
  };

  if (isError) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3" data-testid="requirements-suggestion-tray-error">
        <p className="text-sm text-muted-foreground">The suggestions could not be loaded.</p>
        <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-suggestions-refresh">Refresh</Button>
      </div>
    );
  }
  if (isLoading) return <div className="space-y-2" data-testid="requirements-suggestion-tray-loading">{[1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (!open.length) return null;

  const btn = isMobile ? "h-11 w-full justify-center text-sm" : "h-8 text-xs";
  const count = (n: number) => <span className="font-mono tabular-nums">{n.toLocaleString("en-GB")}</span>;

  return (
    <section className="space-y-2" aria-label="Suggestions to answer" data-testid="requirements-suggestion-tray">
      <div>
        <h3 className="text-sm font-semibold">
          Suggestions to answer <span className="font-mono tabular-nums font-normal text-muted-foreground">{open.length.toLocaleString("en-GB")}</span>
        </h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Picked up from chat, viewings, deals, meetings and news. None of these is a requirement until a person confirms it, and this is the only place they are answered.
          {!searching && totalOpen > suggestions.length ? ` Showing the newest ${suggestions.length.toLocaleString("en-GB")} of ${totalOpen.toLocaleString("en-GB")}.` : ""}
        </p>
      </div>
      {byKind.length > 1 && (
        <div className={cn("flex items-center gap-1.5", isMobile ? "flex-nowrap overflow-x-auto pb-1" : "flex-wrap")} data-testid="suggestion-sources">
          <Pill active={!activeKind} aria-pressed={!activeKind} onClick={() => setKind(null)} data-testid="suggestion-source-all">All {count(open.length)}</Pill>
          {byKind.map(([k, n]) => (
            <Pill key={k} active={activeKind === k} aria-pressed={activeKind === k} onClick={() => setKind(activeKind === k ? null : k)} data-testid={`suggestion-source-${k}`}>
              {KIND_PLURALS[k] || kindLabel(k)} {count(n)}
            </Pill>
          ))}
        </div>
      )}
      {!isMobile && (
        <p className="text-[11px] text-muted-foreground" data-testid="suggestion-keys">
          Keys on a selected card: <kbd className="font-mono">C</kbd> confirm · <kbd className="font-mono">A</kbd> add to existing · <kbd className="font-mono">W</kbd> wrong brand · <kbd className="font-mono">N</kbd> not a requirement · <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> move
        </p>
      )}
      <div className={isMobile ? "grid grid-cols-1 gap-3" : "space-y-2"}>
        {visible.map((s) => {
          const facts = detectedFacts(s.details);
          const others = s.lines.filter((l) => l.id !== s.id);
          const onFile = s.existingRequirements;
          const question = isQuestion(s);
          const prompt = s.proposed === "pick_brand" ? (s.brand.candidates.length ? "More than one brand is possible. Pick the brand to answer this." : "Not matched to a brand in the CRM. Pick the brand to answer this.")
            : s.proposed === "mark_satisfied" ? "A deal for this brand reached solicitors. Is the requirement now satisfied?"
            : s.proposed === "still_live" ? "Is this brand's requirement still live?"
            : s.proposed === "confirm_existing" ? `On file: ${onFile[0].name} · ${onFile[0].stateLabel} · ${onFile[0].dateLabel}`
            : s.proposed === "choose" ? `${countLabel(onFile.length, "requirement")} on file for this brand`
            : "Nothing on our books for this brand";
          return (
            <div
              key={s.id}
              ref={(el) => { if (el) cards.current.set(s.id, el); else cards.current.delete(s.id); }}
              tabIndex={0}
              role="group"
              aria-label={`Suggestion: ${brandOf(s)}`}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
                const k = e.key.toLowerCase();
                if (k === "c") primary(s);
                else if (k === "a") addToExisting(s);
                else if (k === "w") { if (!question) setBrandFor(s.id); }
                else if (k === "n") negative(s);
                else if (k === "arrowdown" || k === "j") move(s.id, 1);
                else if (k === "arrowup" || k === "k") move(s.id, -1);
                else return;
                e.preventDefault();
              }}
              className={cn(
                "border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isMobile ? "space-y-3 rounded-2xl p-4 shadow-sm" : "flex items-start gap-4 rounded-lg p-3",
              )}
              data-testid={`suggestion-card-${s.id}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {s.brand.matched && s.brand.companyId ? (
                    <button type="button" className="min-w-0 truncate text-left text-sm font-semibold text-primary hover:underline" onClick={() => navigate(`/companies/${s.brand.companyId}`)} data-testid={`suggestion-brand-${s.id}`}>
                      {s.brand.name}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate text-sm font-semibold" data-testid={`suggestion-brand-${s.id}`}>“{s.brand.saidAs || "No name"}”</span>
                  )}
                  <span className={chip}>{kindLabel(s.kind)}</span>
                  {s.brand.matched && s.brand.saidAs && !sameName(s.brand.saidAs, s.brand.name) && (
                    <span className="text-[11px] text-muted-foreground">said as “{s.brand.saidAs}”</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground" data-testid={`suggestion-prompt-${s.id}`}>{prompt}</p>
                {s.headline && <p className="break-words text-sm">{s.headline}</p>}
                {facts.length > 0 && <p className="break-words text-xs" data-testid={`suggestion-facts-${s.id}`}><span className="text-muted-foreground">Detected: </span>{facts.join(" · ")}</p>}
                {s.excerpt && <p className="break-words text-xs text-muted-foreground">“{s.excerpt}”</p>}
                <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground" data-testid={`suggestion-evidence-${s.id}`}>
                  <span>{s.sourceLabel || kindLabel(s.kind)}</span>
                  <span>·</span>
                  <span className="font-mono tabular-nums">{dayOf(s.evidenceDate || s.createdAt)}</span>
                  {s.saidBy && <><span>·</span><span>said by {s.saidBy}</span></>}
                  {s.createdBy.name && !sameName(s.createdBy.name, s.saidBy) && <><span>·</span><span>{s.createdBy.kind === "person" ? "raised by" : "found by"} {s.createdBy.name}</span></>}
                  {s.url && <><span>·</span><EvidenceLink url={s.url} navigate={navigate} testId={`suggestion-link-${s.id}`} /></>}
                </p>
                {others.length > 0 && (
                  expanded.has(s.id) ? (
                    <ul className="space-y-1 border-l border-border pl-2">
                      {others.map((l) => (
                        <li key={l.id} className="text-[11px] text-muted-foreground">
                          <span className="font-mono tabular-nums">{dayOf(l.evidenceDate || l.createdAt)}</span> · {l.sourceLabel || kindLabel(l.kind)}{l.headline ? ` · ${l.headline}` : ""}{" "}
                          <EvidenceLink url={l.url} navigate={navigate} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setExpanded((prev) => new Set(prev).add(s.id))} data-testid={`suggestion-more-${s.id}`}>
                      Show all {s.lines.length} lines
                    </button>
                  )
                )}
                {brandFor === s.id && (
                  <BrandPicker
                    companies={companies}
                    candidates={s.brand.candidates}
                    busy={brandBusy}
                    onPick={(brand) => void pickBrand(s, brand)}
                    onNone={() => { setBrandFor(null); void dismissAs(s, "wrong_brand"); }}
                    onCancel={() => { setBrandFor(null); focusCard(s.id); }}
                    testId={`suggestion-brand-picker-${s.id}`}
                  />
                )}
              </div>
              <div className={isMobile ? "flex flex-col gap-2" : "flex w-[330px] shrink-0 flex-wrap justify-end gap-1.5"}>
                {s.proposed === "pick_brand" ? (
                  <Button size="sm" className={btn} onClick={() => setBrandFor(s.id)} data-testid={`suggestion-pick-brand-${s.id}`}>Pick the brand</Button>
                ) : s.proposed === "mark_satisfied" ? (
                  <>
                    <Button size="sm" className={btn} title="Mark the requirement satisfied (C)" onClick={() => primary(s)} data-testid={`suggestion-satisfied-${s.id}`}>Mark satisfied</Button>
                    <Button variant="outline" size="sm" className={btn} title="Keep the deal on the requirement, which stays open (A)" onClick={() => addToExisting(s)} data-testid={`suggestion-attach-${s.id}`}>Not yet: keep the deal on it</Button>
                  </>
                ) : s.proposed === "still_live" ? (
                  <>
                    <Button size="sm" className={btn} title="Record that you confirmed it today (C)" onClick={() => primary(s)} data-testid={`suggestion-confirm-${s.id}`}>Yes, still live</Button>
                    <Button variant="outline" size="sm" className={btn} title="Archive the requirement" onClick={() => void notLive(s)} data-testid={`suggestion-not-live-${s.id}`}>No, not live</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" className={btn} title={s.proposed === "confirm_existing" ? "Confirm the requirement on file as live today (C)" : "Check what was detected, then confirm (C)"} onClick={() => primary(s)} data-testid={`suggestion-confirm-${s.id}`}>
                      <Check className="mr-1 h-3.5 w-3.5" />
                      {s.proposed === "confirm_existing" ? "Confirm the one on file" : "Confirm"}
                    </Button>
                    {onFile.length > 0 && (
                      <Button variant="outline" size="sm" className={btn} title="Add this to the requirement without confirming it (A)" onClick={() => addToExisting(s)} data-testid={`suggestion-attach-${s.id}`}>Add to existing</Button>
                    )}
                    {s.proposed === "confirm_existing" && (
                      <Button variant="outline" size="sm" className={btn} title="It is a separate search: add a new requirement" onClick={() => setAnswer({ suggestion: s, mode: "confirm", existing: onFile, target: NEW_TARGET })} data-testid={`suggestion-new-search-${s.id}`}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Separate search
                      </Button>
                    )}
                  </>
                )}
                {!question && s.proposed !== "pick_brand" && (
                  <Button variant="outline" size="sm" className={btn} title="It is about a different brand (W)" onClick={() => setBrandFor(brandFor === s.id ? null : s.id)} data-testid={`suggestion-wrong-brand-${s.id}`}>Wrong brand</Button>
                )}
                <Button variant="ghost" size="sm" className={cn(btn, "text-muted-foreground")} title={question ? "Dismiss the question (N)" : "Dismiss: this is not a requirement (N)"} onClick={() => negative(s)} data-testid={`suggestion-dismiss-${s.id}`}>
                  {question ? "Dismiss" : "Not a requirement"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {answer && <AnswerDialog key={`${answer.suggestion.id}:${answer.mode}`} state={answer} onClose={() => setAnswer(null)} onSubmit={submitAnswer} />}
    </section>
  );
}

type EvidencePage = {
  requirement: { id: string; name: string; companyId: string | null; status: string | null; live: { state: string; stateLabel: string; why: string; dateLabel: string } };
  howSure: { key: string; label: string; why: string };
  evidence: EvidenceLine[];
};
const NOTE_KINDS = [
  { value: "note", label: "Note" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
] as const;
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * The evidence behind one requirement: the dated lines (confirmations, calls,
 * ChatBGP, chat posts, meetings, press stories, the market listing, and the
 * brand's viewings and offers read live), the "how sure" label worked out
 * from them, and "Add evidence" for what a person knows.
 */
export function RequirementEvidenceDrawer({ requirement, onClose, isMobile, navigate, onChanged }: {
  requirement: { id: string; name: string } | null;
  onClose: () => void;
  isMobile: boolean;
  navigate: (to: string) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const key = requirement ? `/api/requirement-centre/requirements/${encodeURIComponent(requirement.id)}/evidence` : "";
  const { data, isLoading, isError, refetch } = useQuery<EvidencePage>({ queryKey: [key], enabled: !!requirement, staleTime: 0 });
  const [kind, setKind] = useState<string>("note");
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayIso());
  const [confirms, setConfirms] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setKind("note"); setText(""); setDate(todayIso()); setConfirms(false); }, [requirement?.id]);

  const closed = data?.requirement.live.state === "closed";
  const add = async () => {
    if (!requirement || !text.trim() || saving) return;
    setSaving(true);
    try {
      const r = await send("POST", key, { kind, text: text.trim(), date: date ? `${date}T12:00:00Z` : null, confirms });
      if (!r.ok) throw new Error(r.data.error || "The evidence could not be added");
      setText(""); setConfirms(false);
      queryClient.invalidateQueries({ queryKey: [key] });
      onChanged();
      toast({ title: confirms ? "Evidence added, and confirmed by you today" : "Evidence added" });
    } catch (e: any) {
      toast({ title: "The evidence was not added", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!requirement} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("flex flex-col gap-4 overflow-y-auto", isMobile ? "max-h-[88vh] rounded-t-2xl p-4" : "w-full sm:max-w-md")} data-testid="drawer-requirement-evidence">
        <SheetHeader className="text-left">
          <SheetTitle>{requirement?.name || "Requirement"}</SheetTitle>
          <SheetDescription>The evidence behind this requirement. BGP staff only.</SheetDescription>
        </SheetHeader>
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : isError || !data ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">The evidence could not be loaded.</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()} data-testid="button-evidence-refresh">Refresh</Button>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border p-3" data-testid="evidence-how-sure">
              <p className={microLabel}>How sure</p>
              <p className="text-sm font-semibold" data-testid={`evidence-how-sure-${data.howSure.key}`}>{data.howSure.label}</p>
              <p className="text-[11px] text-muted-foreground">{data.howSure.why}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{data.requirement.live.stateLabel}: {data.requirement.live.why}.</p>
            </div>

            {closed ? (
              <p className="text-[11px] text-muted-foreground">This requirement is closed. Reopen it to add evidence.</p>
            ) : (
              <form className="space-y-2 rounded-lg border border-border p-3" onSubmit={(e) => { e.preventDefault(); void add(); }} data-testid="form-add-evidence">
                <p className={microLabel}>Add evidence</p>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={kind} onValueChange={(v) => { setKind(v); if (v === "note") setConfirms(false); }}>
                    <SelectTrigger className="h-11 sm:h-9" aria-label="What it is" data-testid="evidence-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NOTE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="date" className="h-11 font-mono sm:h-9" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="Date" data-testid="evidence-date" />
                </div>
                <Textarea rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="What was said or seen, in a line or two" data-testid="evidence-text" />
                {kind !== "note" && (
                  <label className="flex items-start gap-2 text-xs">
                    <Checkbox checked={confirms} onCheckedChange={(v) => setConfirms(v === true)} className="mt-0.5" data-testid="evidence-confirms" />
                    <span>The brand confirmed the requirement is still live. Record me as confirming it today.</span>
                  </label>
                )}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">Type what you know. The app does not read email for requirements.</p>
                  <Button type="submit" size="sm" className="h-11 shrink-0 sm:h-8" disabled={!text.trim() || saving} data-testid="button-add-evidence">
                    {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                    Add evidence
                  </Button>
                </div>
              </form>
            )}

            <div>
              <p className={microLabel}>Evidence <span className="font-mono tabular-nums">{data.evidence.length.toLocaleString("en-GB")}</span></p>
              {data.evidence.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground" data-testid="evidence-empty">No evidence yet — add a line on how you know.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border" data-testid="evidence-list">
                  {data.evidence.map((l) => (
                    <li key={l.id} className="space-y-0.5 py-2" data-testid={`evidence-line-${l.id}`}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{dayOf(l.evidenceDate || l.createdAt)}</span>
                        <span className={chip}>{kindLabel(l.kind)}</span>
                        {l.sourceLabel && !sameName(l.sourceLabel, kindLabel(l.kind)) && <span className="text-[11px] text-muted-foreground">{l.sourceLabel}</span>}
                      </div>
                      {l.headline && <p className="break-words text-sm">{l.headline}</p>}
                      {l.excerpt && <p className="break-words text-xs text-muted-foreground">“{l.excerpt}”</p>}
                      <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                        {l.saidBy && <span>said by {l.saidBy}</span>}
                        {l.createdBy.name && !sameName(l.createdBy.name, l.saidBy) && <span>{l.createdBy.kind === "person" ? "added by" : "from"} {l.createdBy.name}</span>}
                        {l.status === "confirmed" && l.resolved?.name && !sameName(l.resolved.name, l.createdBy.name) && <span>confirmed with this by {l.resolved.name}</span>}
                        <EvidenceLink url={l.url} navigate={(to) => { onClose(); navigate(to); }} testId={`evidence-link-${l.id}`} />
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">Viewings and offers are read from their own records. A story from an email newsletter has no link to open.</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
