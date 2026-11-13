// Interest on a unit, on the joint agent's tracker: the unit's lines and the
// form to log one, through the unit's existing interest routes. The brand is
// typed or picked by name; the agent's firm is typed; an agent asking for
// several brands is logged as one line per brand. No CRM contact is linked
// and there is no link to a brand page.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, Loader2, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { interestWho } from "@/components/tracker-activity-cells";
import { NoteFill } from "@/components/letting-note/note-fill";
import type { LettingNoteReading } from "@shared/letting-note";
import { BrandInput, type BrandValue } from "./brand-input";
import { MICRO_LABEL, noteBrand, noteDay, noteText, serverMessage, shortDay, todayIso, withNote } from "./format";

interface InterestRow { id: string; companyName: string | null; contactName: string | null; agentCompanyName?: string | null; interestDate: string | null; notes: string | null }
const NO_BRAND: BrandValue = { id: null, name: "" };
// A note the inbox or diary sweep wrote names a mailbox and an email's
// subject. The server does not send those to a joint agent; this page does
// not show one to anyone.
const ownNote = (notes: string | null): string => (/^\s*(synced from|detected in|backfilled from)\b/i.test(String(notes || "")) ? "" : String(notes || "").trim());

export function InterestDialog({ unit, onClose, onChanged }: {
  unit: { id: string; unitName: string; propertyName: string } | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const unitId = unit?.id || "";
  const key = ["/api/available-units", unitId, "interest"];
  const { data: rows = [], isLoading, error } = useQuery<InterestRow[]>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/available-units/${unitId}/interest`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "The interest could not be loaded");
      const json = await r.json();
      return Array.isArray(json) ? json : [];
    },
    enabled: !!unitId,
  });

  const [brand, setBrand] = useState<BrandValue>(NO_BRAND);
  const [more, setMore] = useState<BrandValue[]>([]);
  const [next, setNext] = useState<BrandValue>(NO_BRAND);
  const [agent, setAgent] = useState("");
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [noteRound, setNoteRound] = useState(0);   // a fresh note box after each logged line
  const reset = () => { setBrand(NO_BRAND); setMore([]); setNext(NO_BRAND); setAgent(""); setDate(todayIso()); setNotes(""); setFormError(null); setNoteRound(n => n + 1); };
  useEffect(() => { reset(); }, [unitId]);

  const refresh = () => { queryClient.invalidateQueries({ queryKey: key }); onChanged(); };
  const addMore = (b: BrandValue) => {
    const name = b.name.trim();
    if (!name) return;
    const taken = [brand, ...more].some(x => x.name.trim().toLowerCase() === name.toLowerCase());
    if (!taken) setMore(m => [...m, { id: b.id, name }]);
    setNext(NO_BRAND);
  };

  // A read note fills the form and saves nothing. Brands are names, with an
  // id only when the reading gives one; the agent is their firm's name as
  // typed, never a record from BGP's CRM.
  const applyNote = (reading: LettingNoteReading) => {
    const f = reading?.fields || {};
    const main = noteBrand(f);
    if (main) setBrand(main);
    const firm = noteText(f.agentCompanyName, 200) || noteText(f.agentName, 200);
    if (firm) setAgent(firm);
    const first = (main?.name || brand.name).trim().toLowerCase();
    const others: BrandValue[] = [];
    for (const b of Array.isArray(f.moreBrands) ? f.moreBrands : []) {
      const name = noteText(b?.name, 200);
      if (!name || name.toLowerCase() === first || others.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
      others.push({ id: typeof b?.id === "string" && b.id ? b.id : null, name });
    }
    if (others.length) setMore(others);
    const day = noteDay(f.date);
    if (day) setDate(day);
    setNotes(had => withNote(had, noteText(f.note, 2000), true));
    setFormError(null);
  };

  // One line. The brand's id goes with it only when it was picked from the
  // list; if the server will not take the link, the line is logged by name.
  const logOne = async (b: BrandValue | null) => {
    const body: Record<string, unknown> = { companyName: b?.name.trim() || null, agentCompanyName: agent.trim() || null, interestDate: date, notes: notes.trim() || null };
    if (b?.id) {
      try { await apiRequest("POST", `/api/available-units/${unitId}/interest`, { ...body, companyId: b.id }); return; }
      catch (e) { if (!/^(400|403)\b/.test(e instanceof Error ? e.message : "")) throw e; }
    }
    await apiRequest("POST", `/api/available-units/${unitId}/interest`, body);
  };

  const submit = async () => {
    if (busy || !unitId) return;
    const pending = next.name.trim() ? [...more, { id: next.id, name: next.name.trim() }] : more;
    const brands = [brand, ...pending].filter(b => b.name.trim());
    if (brands.length === 0 && !agent.trim()) { setFormError("Name the brand or the agent who is interested."); return; }
    setBusy(true); setFormError(null);
    let logged = 0;
    try {
      if (brands.length === 0) { await logOne(null); logged = 1; }
      else for (const b of brands) { await logOne(b); logged++; }
      toast({ title: logged === 1 ? "Interest logged" : `${logged} lines of interest logged` });
      reset();
    } catch (e) {
      setFormError(`${logged ? `${logged} logged. ` : ""}${serverMessage(e, "The interest could not be logged.")}`);
    } finally {
      setBusy(false);
      if (logged) refresh();
    }
  };

  const remove = async (row: InterestRow) => {
    const { who } = interestWho(row);
    if (!window.confirm(`Remove the interest from ${who}?`)) return;
    setRemoving(row.id);
    try {
      await apiRequest("DELETE", `/api/available-units/interest/${row.id}`);
      refresh();
    } catch (e) {
      toast({ title: "The interest could not be removed", description: serverMessage(e, ""), variant: "destructive" });
    } finally {
      setRemoving(null);
    }
  };

  const ordered = [...rows].sort((a, b) => String(b.interestDate || "").localeCompare(String(a.interestDate || "")));

  return (
    <Dialog open={!!unit} onOpenChange={v => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="ja-interest-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Flame className="h-5 w-5 shrink-0" /> Interest</DialogTitle>
          <DialogDescription className="truncate">{unit ? `${unit.unitName} · ${unit.propertyName}` : ""}</DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{serverMessage(error, "The interest could not be loaded.")}</p>}
        {!isLoading && !error && ordered.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No interest logged yet.</p>}
        {ordered.length > 0 && (
          <ul className="space-y-2" data-testid="ja-interest-list">
            {ordered.map(i => {
              const { who, via } = interestWho(i);
              return (
                <li key={i.id} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm" data-testid={`ja-interest-row-${i.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{who}{via && <span className="font-normal text-muted-foreground"> via {via}</span>}</p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">{shortDay(i.interestDate)}</p>
                    {ownNote(i.notes) && <p className="mt-0.5 text-xs text-muted-foreground break-words">{ownNote(i.notes)}</p>}
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" disabled={removing === i.id} onClick={() => remove(i)} aria-label={`Remove the interest from ${who}`} title="Remove this interest" data-testid={`ja-interest-remove-${i.id}`}>
                    {removing === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2 border-t border-border pt-3" data-testid="ja-interest-form">
          <p className="text-sm font-medium">Log interest</p>
          {unitId && <NoteFill key={`${unitId}:${noteRound}`} kind="interest" unitId={unitId} onApply={applyNote} />}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-2">
            <label className="block min-w-0"><span className={MICRO_LABEL}>Brand</span>
              <BrandInput value={brand} onChange={setBrand} placeholder="Brand" disabled={busy} testId="ja-interest-brand" />
            </label>
            <label className="block min-w-0"><span className={MICRO_LABEL}>Date</span>
              <Input type="date" className="min-w-0" value={date} onChange={e => setDate(e.target.value)} disabled={busy} data-testid="ja-interest-date" />
            </label>
          </div>
          <label className="block"><span className={MICRO_LABEL}>Agent's firm, if it came through one</span>
            <Input value={agent} onChange={e => setAgent(e.target.value)} placeholder="e.g. Davis Coffer Lyons" disabled={busy} data-testid="ja-interest-agent" />
          </label>
          {(agent.trim() || more.length > 0) && (
            <div className="space-y-1.5" data-testid="ja-interest-more-brands">
              <p className="text-[11px] text-muted-foreground">{agent.trim() ? `Other brands ${agent.trim()} is asking for.` : "Other brands."} Each is logged as its own line.</p>
              {more.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {more.map(b => (
                    <span key={b.name} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]">
                      {b.name}
                      <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${b.name}`} onClick={() => setMore(m => m.filter(x => x.name !== b.name))}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <div className="min-w-0 flex-1"><BrandInput value={next} onChange={v => (v.id ? addMore(v) : setNext(v))} placeholder="Add another brand" disabled={busy} testId="ja-interest-more-brand" /></div>
                <Button type="button" variant="outline" size="sm" className="h-9" disabled={busy || !next.name.trim()} onClick={() => addMore(next)} data-testid="ja-interest-more-add">Add</Button>
              </div>
            </div>
          )}
          <label className="block"><span className={MICRO_LABEL}>Note</span>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. rang about this unit, wants floorplans" disabled={busy} data-testid="ja-interest-notes" />
          </label>
          {formError && <p className="text-sm text-destructive" role="alert" data-testid="ja-interest-error">{formError}</p>}
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || !date || (!brand.name.trim() && !agent.trim())} onClick={submit} data-testid="ja-interest-add">
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
              Log interest
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
