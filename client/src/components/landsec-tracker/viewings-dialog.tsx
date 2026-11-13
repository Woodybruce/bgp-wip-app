// Viewings on a unit, on the joint agent's tracker: the unit's viewings and
// a short form to add one, through the unit's existing viewing routes. The
// brand is typed or picked by name and the person met is a typed name; no
// CRM contact is linked. The outcome, the follow-up and the rest of a
// viewing's details are worked on the Viewings page (/landsec/viewings).
// Only the names, the date, the outcome and the agent's own note are shown:
// never an invitation's guest list or subject.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, CalendarPlus, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { orderViewings } from "@/components/tracker-activity-cells";
import { VIEWING_OUTCOMES } from "@shared/viewing-workflow";
import { NoteFill } from "@/components/letting-note/note-fill";
import type { LettingNoteReading } from "@shared/letting-note";
import { BrandInput, type BrandValue } from "./brand-input";
import { MICRO_LABEL, noteBrand, noteDay, noteOutcome, noteText, noteTime, serverMessage, shortDay, todayIso, withNote } from "./format";

interface ViewingRow {
  id: string; companyName: string | null; contactName: string | null; viewingDate: string | null; viewingTime: string | null;
  status: string | null; outcome: string | null; notes: string | null; ownerName?: string | null;
}
const NO_BRAND: BrandValue = { id: null, name: "" };
const NO_OUTCOME = "__none__";
const STATUS: Record<string, { label: string; tone: string }> = {
  completed: { label: "Attended", tone: "border-emerald-600/60 text-emerald-700 dark:text-emerald-400" },
  no_show: { label: "No-show", tone: "border-amber-500/60 text-amber-700 dark:text-amber-400" },
  cancelled: { label: "Cancelled", tone: "border-border text-muted-foreground" },
  not_leasing: { label: "Not a viewing", tone: "border-border text-muted-foreground" },
};
// The agent's own note. A diary-captured viewing's note opens with the
// invitation's subject on the staff side: that line is never shown here.
const ownNote = (notes: string | null): string =>
  String(notes || "").replace(/^\s*(Synced from Outlook: "[^\r\n]*"|Captured from Outlook\.)\s*/i, "").trim();

export function ViewingsDialog({ unit, startAdding, ownerUserId, onClose, onChanged }: {
  unit: { id: string; unitName: string; propertyName: string } | null;
  startAdding?: boolean;            // open with the Add viewing form showing
  ownerUserId?: string | null;      // a joint agent is the agent on a viewing they add
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const unitId = unit?.id || "";
  const key = ["/api/available-units", unitId, "viewings"];
  const { data: rows = [], isLoading, error } = useQuery<ViewingRow[]>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/available-units/${unitId}/viewings`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "The viewings could not be loaded");
      const json = await r.json();
      return Array.isArray(json) ? json : [];
    },
    enabled: !!unitId,
  });

  const [adding, setAdding] = useState(false);
  const [brand, setBrand] = useState<BrandValue>(NO_BRAND);
  const [contact, setContact] = useState("");
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState("");
  const [outcome, setOutcome] = useState(NO_OUTCOME);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const reset = () => { setBrand(NO_BRAND); setContact(""); setDate(todayIso()); setTime(""); setOutcome(NO_OUTCOME); setNotes(""); setFormError(null); };
  useEffect(() => { reset(); setAdding(!!startAdding); }, [unitId, startAdding]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["/api/leasing-viewings"] });
    onChanged();
  };
  const future = !!date && date > todayIso();

  // A read note fills the form and saves nothing. The brand and the person
  // are names; the brand carries an id only when the reading gives one. An
  // outcome is filled only for a viewing whose date has come.
  const applyNote = (reading: LettingNoteReading) => {
    const f = reading?.fields || {};
    const read = noteBrand(f);
    if (read) setBrand(read);
    const person = noteText(f.contactName, 200);
    if (person) setContact(person);
    const day = noteDay(f.date);
    if (day) setDate(day);
    const at = noteTime(f.time);
    if (at) setTime(at);
    const result = noteOutcome(f.outcome);
    if (result && (day || date) <= todayIso()) setOutcome(result);
    setNotes(had => withNote(had, noteText(f.note, 2000), true));
    setFormError(null);
  };

  const save = async () => {
    if (busy || !unitId) return;
    if (!brand.name.trim() && !contact.trim()) { setFormError("Name the brand or the person viewing."); return; }
    setBusy(true); setFormError(null);
    const body: Record<string, unknown> = {
      companyName: brand.name.trim() || null, contactName: contact.trim() || null, viewingDate: date, viewingTime: time || null,
      notes: notes.trim() || null, outcome: !future && outcome !== NO_OUTCOME ? outcome : "",
      ...(ownerUserId ? { ownerUserId } : {}),
    };
    try {
      // The brand's id goes with it only when it was picked from the list; if
      // the server will not take the link, the viewing is logged by name.
      let done = false;
      if (brand.id) {
        try { await apiRequest("POST", `/api/available-units/${unitId}/viewings`, { ...body, companyId: brand.id }); done = true; }
        catch (e) { if (!/^(400|403)\b/.test(e instanceof Error ? e.message : "")) throw e; }
      }
      if (!done) await apiRequest("POST", `/api/available-units/${unitId}/viewings`, body);
      toast({ title: "Viewing added" });
      reset(); setAdding(false);
      refresh();
    } catch (e) {
      setFormError(serverMessage(e, "The viewing could not be added."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: ViewingRow) => {
    if (!window.confirm("Delete this viewing?")) return;
    setRemoving(v.id);
    try {
      await apiRequest("DELETE", `/api/available-units/viewings/${v.id}`);
      refresh();
    } catch (e) {
      toast({ title: "The viewing could not be deleted", description: serverMessage(e, ""), variant: "destructive" });
    } finally {
      setRemoving(null);
    }
  };

  const ordered = orderViewings(rows);
  const today = todayIso();

  return (
    <Dialog open={!!unit} onOpenChange={v => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="ja-viewings-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 shrink-0" /> Viewings</DialogTitle>
          <DialogDescription className="truncate">{unit ? `${unit.unitName} · ${unit.propertyName}` : ""}</DialogDescription>
        </DialogHeader>

        <div>
          <Link href="/landsec/viewings"><Button variant="outline" size="sm" data-testid="ja-viewings-open-calendar">Open in Viewings</Button></Link>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{serverMessage(error, "The viewings could not be loaded.")}</p>}
        {!isLoading && !error && ordered.length === 0 && !adding && <p className="py-4 text-center text-sm text-muted-foreground">No viewings yet.</p>}
        {ordered.length > 0 && (
          <ul className="space-y-2" data-testid="ja-viewings-list">
            {ordered.map(v => {
              const who = v.companyName || v.contactName || "No brand recorded";
              const status = STATUS[String(v.status || "")];
              const upcoming = String(v.viewingDate || "").slice(0, 10) >= today && !status;
              const note = ownNote(v.notes);
              return (
                <li key={v.id} className="rounded-lg border border-border p-3 text-sm" data-testid={`ja-viewing-row-${v.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{who}{v.contactName && v.companyName && <span className="font-normal text-muted-foreground"> · {v.contactName}</span>}</p>
                      <p className={`text-[11px] tabular-nums ${upcoming ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {shortDay(v.viewingDate)}{v.viewingTime ? ` at ${v.viewingTime}` : ""}{v.ownerName ? ` · ${v.ownerName}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {status && <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${status.tone}`}>{status.label}</span>}
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" disabled={removing === v.id} onClick={() => remove(v)} aria-label="Delete viewing" title="Delete viewing" data-testid={`ja-viewing-delete-${v.id}`}>
                        {removing === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  {v.outcome && <p className="mt-1 text-xs"><span className="text-muted-foreground">Outcome: </span>{v.outcome}</p>}
                  {note && <p className="mt-0.5 text-xs text-muted-foreground break-words">{note}</p>}
                  <Link href={`/landsec/viewings?viewingId=${encodeURIComponent(v.id)}`} className="mt-1 inline-block text-[11px] text-muted-foreground underline hover:text-foreground" data-testid={`ja-viewing-open-${v.id}`}>
                    Report the outcome or change the details in Viewings
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {adding ? (
          <div className="space-y-2 rounded-lg border border-border p-3" data-testid="ja-viewing-form">
            <p className="text-sm font-medium">Add viewing</p>
            <NoteFill kind="viewing" unitId={unitId} onApply={applyNote} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block min-w-0"><span className={MICRO_LABEL}>Brand</span>
                <BrandInput value={brand} onChange={setBrand} placeholder="Brand" disabled={busy} testId="ja-viewing-brand" />
              </label>
              <label className="block min-w-0"><span className={MICRO_LABEL}>Person viewing</span>
                <Input value={contact} onChange={e => setContact(e.target.value)} placeholder="Their name" disabled={busy} data-testid="ja-viewing-contact" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block min-w-0"><span className={MICRO_LABEL}>Date</span>
                <Input type="date" className="min-w-0" value={date} onChange={e => setDate(e.target.value)} disabled={busy} data-testid="ja-viewing-date" />
              </label>
              <label className="block min-w-0"><span className={MICRO_LABEL}>Time</span>
                <Input type="time" className="min-w-0" value={time} onChange={e => setTime(e.target.value)} disabled={busy} data-testid="ja-viewing-time" />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="min-w-0">
                <span className={MICRO_LABEL}>Outcome</span>
                <Select value={future ? NO_OUTCOME : outcome} onValueChange={setOutcome} disabled={busy || future}>
                  <SelectTrigger data-testid="ja-viewing-outcome"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_OUTCOME}>{future ? "Not held yet" : "Not reported yet"}</SelectItem>
                    {VIEWING_OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    <SelectItem value="No Show">No show</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="block min-w-0"><span className={MICRO_LABEL}>Note</span>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything to remember" disabled={busy} data-testid="ja-viewing-notes" />
              </label>
            </div>
            {formError && <p className="text-sm text-destructive" role="alert" data-testid="ja-viewing-error">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { setAdding(false); reset(); }}>Cancel</Button>
              <Button size="sm" disabled={busy || !date || (!brand.name.trim() && !contact.trim())} onClick={save} data-testid="ja-viewing-save">
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {busy ? "Saving…" : "Add viewing"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)} data-testid="ja-viewing-add">
            <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Add viewing
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
