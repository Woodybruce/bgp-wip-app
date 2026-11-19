// Clearing the offers the 14 August 2026 email import left on the Letting
// Tracker (server/email-offer-cleanup.ts; the rule is shared/email-offer-cleanup.ts).
// For admins, in Settings with the other letting repairs: Preview, tick, Apply
// (typing APPLY), and Undo from the recent runs. Nothing here runs by itself.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Pill, PillCount } from "@/components/ui/pill";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Group = "clear" | "brand" | "kept";
type Row = { id: string; offerDate: string | null; companyName: string | null; contactName: string | null; subject: string | null; group: Group; keptBecause: string[]; thread: string; keeper: boolean };
type Thread = { key: string; subject: string | null; emails: number; keeperId: string | null; keeperChosen: boolean; counts: Record<Group, number>; first: string | null; last: string | null };
type Unit = { unitId: string; onTracker: boolean; unitName: string | null; propertyId: string | null; propertyName: string | null; counts: Record<Group, number>; otherOffers: number; threads: Thread[]; rows: Row[] };
type Run = { kind: "apply" | "undo"; at: string; byName: string | null; batch: string; undoOf?: string; undoneAt?: string; counts: Record<string, number> };
type Preview = { previewedAt: string; counts: { offers: number; units: number; threads: number } & Record<Group, number>; units: Unit[]; runs: Run[] };

const GROUPS: Array<{ key: Group; label: string; what: string }> = [
  { key: "clear", label: "Copies to clear", what: "The import wrote one row for every email in a thread, so one offer could become a hundred rows. One row per email thread stays as the offer (one credited to a brand first, else the first email) and these copies are cleared. Tick a unit or a thread. Tick Not an offer on a thread that is not an offer at all, such as a newsletter, to clear its kept row too." },
  { key: "brand", label: "Credited to a brand", what: "Copies credited to a company typed as a tenant brand, so each shows as that brand's offer on the Brand CRM. Read the subject first. Each is ticked on its own." },
  { key: "kept", label: "Kept", what: "The row kept as each email thread's offer, and import rows a person has worked on since. A row a person has worked on is never cleared." },
];

const offers = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "offer" : "offers"}`;
const copies = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "copy" : "copies"}`;
const emails = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "email" : "emails"}`;
const threadsWord = (n: number) => `${n.toLocaleString("en-GB")} email ${n === 1 ? "thread" : "threads"}`;
const units = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "unit" : "units"}`;
const slotOf = (unitId: string, key: string) => `${unitId}\u0000${key}`;
const plainMessage = (err: unknown) => (err instanceof Error ? err.message : String(err ?? "")).replace(/^\d{3}:\s*/, "") || "Try again in a moment.";
const unitLabel = (u: Unit) => (u.onTracker ? `${u.propertyName || "No property"} · ${u.unitName || "Unnamed unit"}` : "A unit no longer on the tracker");
const day = (d: string | null) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return d || "No date";
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

function OfferLine({ row, unit, ticked, onTick }: { row: Row; unit?: Unit; ticked?: boolean; onTick?: (on: boolean) => void }) {
  return (
    <li className="flex items-start gap-2 py-1 text-xs border-b border-border/50 last:border-0">
      {onTick && <Checkbox className="mt-0.5" checked={!!ticked} onCheckedChange={(v) => onTick(v === true)} aria-label={`Clear the offer of ${day(row.offerDate)}`} data-testid={`checkbox-email-offer-row-${row.id}`} />}
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap gap-x-2">
          <span className="tabular-nums text-muted-foreground">{day(row.offerDate)}</span>
          <span className="font-medium">{row.companyName || "No company"}</span>
          {row.contactName && <span className="text-muted-foreground">{row.contactName}</span>}
          {unit && <span className="text-muted-foreground">{unitLabel(unit)}</span>}
        </div>
        <p className="break-words text-muted-foreground">{row.subject ? `“${row.subject}”` : "No subject"}</p>
        {row.keptBecause.length > 0 && <p className="text-foreground">Kept: {row.keptBecause.join(", ")}</p>}
      </div>
    </li>
  );
}

export function EmailOfferCleanupPanel() {
  const { toast } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState<Group | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Threads ticked as not an offer at all: every row goes, the kept one too.
  const [whole, setWhole] = useState<Set<string>>(new Set());
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"preview" | "apply" | "undo" | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "apply" } | { kind: "undo"; batch: string } | null>(null);
  const [word, setWord] = useState("");
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiRequest("GET", "/api/admin/email-offer-cleanup/runs")
      .then((r) => r.json())
      .then((d) => { if (live) setRuns(Array.isArray(d?.runs) ? d.runs : []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const rowsIn = (group: Group) => (preview?.units || []).flatMap((u) => u.rows.filter((r) => r.group === group).map((r) => ({ row: r, unit: u })));
  const clearIds = useMemo(() => new Set(rowsIn("clear").map((x) => x.row.id)), [preview]);
  // What Apply will clear: the ticked copies, plus every clearable row of a
  // thread ticked as not an offer (the server works the same list out).
  const going = useMemo(() => {
    const ids = new Set(ticked);
    for (const u of preview?.units || []) {
      for (const r of u.rows) {
        if (!whole.has(slotOf(u.unitId, r.thread))) continue;
        if (r.group !== "kept" || (r.keeper && u.threads.find((t) => t.key === r.thread)?.keeperChosen)) ids.add(r.id);
      }
    }
    return ids;
  }, [preview, ticked, whole]);
  const tickedUnits = useMemo(() => new Set((preview?.units || []).filter((u) => u.rows.some((r) => going.has(r.id))).map((u) => u.unitId)), [preview, going]);
  const closeConfirm = () => { setConfirm(null); setWord(""); };
  const setTick = (ids: string[], on: boolean) => {
    const next = new Set(ticked);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    setTicked(next);
  };
  const refreshTracker = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/available-units") });

  const runPreview = async () => {
    setBusy("preview");
    try {
      const data: Preview = await (await apiRequest("POST", "/api/admin/email-offer-cleanup", { dryRun: true })).json();
      setPreview(data);
      setRuns(data.runs || []);
      setTicked(new Set());
      setWhole(new Set());
      setOpenThreads(new Set());
      setExpanded(new Set());
      setOpen(data.counts.clear ? "clear" : data.counts.brand ? "brand" : data.counts.kept ? "kept" : null);
      setResult(null);
    } catch (err) {
      toast({ title: "Preview failed", description: plainMessage(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runApply = async () => {
    setBusy("apply");
    try {
      const threads = [...whole].map((s) => { const [unitId, key] = s.split("\u0000"); return { unitId, key }; });
      const data = await (await apiRequest("POST", "/api/admin/email-offer-cleanup", { dryRun: false, ids: [...ticked], threads, previewedAt: preview?.previewedAt })).json();
      const c = data.counts || {};
      const said = `Cleared ${offers(c.deleted ?? 0)} on ${units(c.units ?? 0)}`
        + (c.wholeThreads ? `, ${threadsWord(c.wholeThreads)} cleared completely as not offers` : "")
        + (c.skipped ? `; ${offers(c.skipped)} left, because a person has worked on them or their thread's offer has gone since the preview` : "")
        + (c.failed ? `; ${units(c.failed)} failed and nothing was cleared there` : "") + ".";
      setResult(said);
      setRuns([{ kind: "apply", at: data.appliedAt, byName: data.byName, batch: data.batch, counts: c }, ...runs]);
      setPreview(null);
      setTicked(new Set());
      setWhole(new Set());
      closeConfirm();
      refreshTracker();
      toast({ title: "Applied", description: said });
    } catch (err) {
      toast({ title: "Apply failed", description: plainMessage(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runUndo = async (batch: string) => {
    setBusy("undo");
    try {
      const data = await (await apiRequest("POST", "/api/admin/email-offer-cleanup/undo", { batch })).json();
      const c = data.counts || {};
      const said = `Put back ${offers(c.restored ?? 0)}`
        + (c.notRestored ? `; ${offers(c.notRestored)} could not go back, because the unit has gone or the email has been logged again` : "") + ".";
      setResult(said);
      setRuns([{ kind: "undo", at: data.undoneAt, byName: data.byName, batch: data.batch, undoOf: batch, counts: c },
        ...runs.map((r) => (r.batch === batch ? { ...r, undoneAt: data.undoneAt } : r))]);
      setPreview(null);
      setTicked(new Set());
      setWhole(new Set());
      closeConfirm();
      refreshTracker();
      toast({ title: "Undone", description: said });
    } catch (err) {
      toast({ title: "Undo failed", description: plainMessage(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const openGroup = GROUPS.find((g) => g.key === open);
  const needed = confirm?.kind === "undo" ? "UNDO" : "APPLY";

  return (
    <div className="rounded-md border border-border p-2 space-y-2" data-testid="panel-email-offer-cleanup">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium">Offers from the 14 August email import</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={runPreview} disabled={busy !== null} data-testid="button-email-offer-preview">
            {busy === "preview" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
            {busy === "preview" ? "Previewing…" : "Preview"}
          </Button>
          <Button size="sm" onClick={() => { setWord(""); setConfirm({ kind: "apply" }); }} disabled={!preview || going.size === 0 || busy !== null} data-testid="button-email-offer-apply">
            {busy === "apply" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {busy === "apply" ? "Applying…" : `Apply${going.size ? `: clear ${going.size.toLocaleString("en-GB")} ${going.size === 1 ? "row" : "rows"}` : ""}`}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        On 14 August 2026 a one-off import read three months of stored emails and logged an unconfirmed offer for every email that mentioned an offer and could be pinned on a tracker unit,
        so one offer became one row for every email in its thread. This keeps one offer per email thread and clears the copies. Offers people logged are never touched, nor import rows anyone has worked on since.
        Every row cleared is recorded and can be put back with Undo.
      </p>
      {preview && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="text-email-offer-summary">
            Previewed {new Date(preview.previewedAt).toLocaleString("en-GB")}: <span className="tabular-nums">{offers(preview.counts.offers)}</span> from the import on <span className="tabular-nums">{units(preview.counts.units)}</span>, in <span className="tabular-nums">{threadsWord(preview.counts.threads ?? 0)}</span>.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => (
              <Pill key={g.key} active={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)} data-testid={`pill-email-offer-${g.key}`}>
                {g.label}
                <PillCount n={preview.counts[g.key] || 0} active={open === g.key} />
              </Pill>
            ))}
          </div>
          {openGroup && (
            <div className="rounded-md border border-border bg-muted/40 p-2 space-y-1" data-testid={`section-email-offer-${openGroup.key}`}>
              <p className="text-xs text-muted-foreground">{openGroup.what}</p>
              {openGroup.key === "clear" && (
                clearIds.size === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                  <>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setTick([...clearIds], true)} data-testid="button-email-offer-tick-all">Tick all copies</button>
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setTicked(new Set()); setWhole(new Set()); }}>Tick none</button>
                      <span className="text-muted-foreground"><span className="tabular-nums">{going.size.toLocaleString("en-GB")}</span> {going.size === 1 ? "row" : "rows"} ticked on <span className="tabular-nums">{units(tickedUnits.size)}</span>
                        {whole.size ? `, ${threadsWord(whole.size)} as not offers` : ""}</span>
                    </div>
                    <ul>
                      {preview.units.filter((u) => u.counts.clear > 0 || u.threads.some((t) => t.keeperChosen)).map((u) => {
                        const ids = u.rows.filter((r) => r.group === "clear").map((r) => r.id);
                        const on = ids.filter((id) => ticked.has(id)).length;
                        const isOpen = expanded.has(u.unitId);
                        const withCopies = u.threads.filter((t) => t.counts.clear > 0).length;
                        return (
                          <li key={u.unitId} className="py-1 border-b border-border/50 last:border-0">
                            <div className="flex items-start gap-2 text-xs">
                              <Checkbox className="mt-0.5" checked={ids.length > 0 && on === ids.length ? true : on > 0 ? "indeterminate" : false} disabled={ids.length === 0}
                                onCheckedChange={(v) => setTick(ids, v === true)} aria-label={`Clear ${copies(ids.length)} on ${unitLabel(u)}`} data-testid={`checkbox-email-offer-unit-${u.unitId}`} />
                              <button type="button" className="flex min-w-0 flex-1 items-start gap-1 text-left" onClick={() => {
                                const next = new Set(expanded); if (isOpen) next.delete(u.unitId); else next.add(u.unitId); setExpanded(next);
                              }} data-testid={`button-email-offer-unit-${u.unitId}`}>
                                {isOpen ? <ChevronDown className="mt-0.5 w-3 h-3 shrink-0" /> : <ChevronRight className="mt-0.5 w-3 h-3 shrink-0" />}
                                <span className="min-w-0">
                                  <span className="font-medium">{unitLabel(u)}</span>{" "}
                                  <span className="text-muted-foreground">
                                    {ids.length ? <><span className="tabular-nums">{copies(ids.length)}</span> to clear in {threadsWord(withCopies)}; one offer per thread stays</> : `${threadsWord(u.threads.length)}, one email each: nothing to clear unless one is not an offer`}
                                    {u.counts.brand ? `, ${u.counts.brand} credited to a brand` : ""}
                                    {u.otherOffers ? `; ${offers(u.otherOffers)} not from the import ${u.otherOffers === 1 ? "stays" : "stay"}` : ""}</span>
                                </span>
                              </button>
                            </div>
                            {isOpen && (
                              <ul className="ml-6 mt-1">
                                {u.threads.filter((t) => t.counts.clear > 0 || t.keeperChosen).map((t) => {
                                  const slot = slotOf(u.unitId, t.key);
                                  const tIds = u.rows.filter((r) => r.thread === t.key && r.group === "clear").map((r) => r.id);
                                  const tOn = tIds.filter((id) => ticked.has(id)).length;
                                  const notOffer = whole.has(slot);
                                  const keeperRow = u.rows.find((r) => r.id === t.keeperId);
                                  const tOpen = openThreads.has(slot);
                                  return (
                                    <li key={slot} className="py-1 border-b border-border/50 last:border-0 text-xs" data-testid={`row-email-offer-thread-${t.keeperId ?? "none"}`}>
                                      <div className="flex items-start gap-2">
                                        <Checkbox className="mt-0.5" checked={notOffer || (tIds.length > 0 && tOn === tIds.length) ? true : tOn > 0 ? "indeterminate" : false}
                                          disabled={notOffer || tIds.length === 0} onCheckedChange={(v) => setTick(tIds, v === true)}
                                          aria-label={`Clear the ${copies(tIds.length)} of this thread`} data-testid={`checkbox-email-offer-thread-${t.keeperId ?? "none"}`} />
                                        <div className="min-w-0 flex-1 space-y-0.5">
                                          <button type="button" className="flex items-start gap-1 text-left" onClick={() => {
                                            const next = new Set(openThreads); if (tOpen) next.delete(slot); else next.add(slot); setOpenThreads(next);
                                          }}>
                                            {tOpen ? <ChevronDown className="mt-0.5 w-3 h-3 shrink-0" /> : <ChevronRight className="mt-0.5 w-3 h-3 shrink-0" />}
                                            <span className="font-medium break-words">{t.subject ? `“${t.subject}”` : "No subject"}</span>
                                          </button>
                                          <p className="text-muted-foreground">
                                            {emails(t.emails)}{t.first ? `, ${day(t.first)}` : ""}{t.last && t.last !== t.first ? ` to ${day(t.last)}` : ""}.{" "}
                                            {notOffer
                                              ? "All of it is cleared, as not an offer."
                                              : `Keeps the offer of ${day(keeperRow?.offerDate ?? null)}${keeperRow ? ` (${keeperRow.companyName || "no company"})` : ""}${tIds.length ? `, clears ${copies(tIds.length)}` : ""}.`}
                                            {t.counts.brand ? ` ${t.counts.brand} more ${t.counts.brand === 1 ? "is" : "are"} credited to a brand: see Credited to a brand.` : ""}
                                          </p>
                                          {t.keeperChosen && (
                                            <label className="inline-flex items-center gap-1.5 text-muted-foreground">
                                              <Checkbox checked={notOffer} onCheckedChange={(v) => {
                                                const next = new Set(whole); if (v === true) next.add(slot); else next.delete(slot); setWhole(next);
                                              }} data-testid={`checkbox-email-offer-not-offer-${t.keeperId}`} />
                                              Not an offer: clear all of it
                                            </label>
                                          )}
                                        </div>
                                      </div>
                                      {tOpen && (
                                        <ul className="ml-6 mt-1">
                                          {u.rows.filter((r) => r.thread === t.key && (r.group === "clear" || r.keeper)).map((r) => <OfferLine key={r.id} row={r} />)}
                                        </ul>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )
              )}
              {openGroup.key === "brand" && (
                rowsIn("brand").length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                  <ul>{rowsIn("brand").map(({ row, unit }) => <OfferLine key={row.id} row={row} unit={unit} ticked={ticked.has(row.id)} onTick={(on) => setTick([row.id], on)} />)}</ul>
                )
              )}
              {openGroup.key === "kept" && (
                rowsIn("kept").length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                  <ul>{rowsIn("kept").map(({ row, unit }) => <OfferLine key={row.id} row={row} unit={unit} />)}</ul>
                )
              )}
            </div>
          )}
        </>
      )}
      {result && <p className="text-xs" data-testid="text-email-offer-result">{result}</p>}
      {runs.length > 0 && (
        <div className="text-xs space-y-0.5" data-testid="list-email-offer-runs">
          <p className="text-muted-foreground">Recent runs</p>
          {runs.slice(0, 10).map((r) => (
            <div key={r.batch} className="flex flex-wrap items-baseline gap-x-2">
              <span>{new Date(r.at).toLocaleString("en-GB")}{r.byName ? ` by ${r.byName}` : ""}</span>
              <span className="text-muted-foreground">
                {r.kind === "undo" ? `undo: ${offers(r.counts.restored ?? 0)} put back` : `${offers(r.counts.deleted ?? 0)} cleared on ${units(r.counts.units ?? 0)}`}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/70 break-all">{r.batch}</span>
              {r.kind === "apply" && !r.undoneAt && (r.counts.deleted ?? 0) > 0 && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setWord(""); setConfirm({ kind: "undo", batch: r.batch }); }} disabled={busy !== null} data-testid={`button-email-offer-undo-${r.batch}`}>Undo</Button>
              )}
              {r.undoneAt && <span className="text-muted-foreground">undone</span>}
            </div>
          ))}
        </div>
      )}
      <Dialog open={confirm !== null} onOpenChange={(o) => { if (!o) closeConfirm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.kind === "undo" ? "Put these offers back" : "Clear the import's offers"}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "undo"
                ? "Every offer this run cleared goes back on its unit, with its blank negotiation round, unless the unit has gone or the email has been logged again."
                : `${going.size.toLocaleString("en-GB")} ${going.size === 1 ? "row" : "rows"} on ${units(tickedUnits.size)} ${going.size === 1 ? "is" : "are"} deleted, with any blank negotiation round.`
                  + ` One offer per email thread stays${whole.size ? `, except in the ${threadsWord(whole.size)} ticked as not an offer` : ""}.`
                  + " A row a person has worked on since the preview is left, and so are a thread's copies if its kept offer has gone. Every row is recorded and can be put back with Undo."}
              {" "}Type {needed} to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder={needed} autoFocus data-testid="input-email-offer-confirm" />
          <DialogFooter>
            <Button variant="outline" onClick={closeConfirm}>Cancel</Button>
            <Button
              onClick={() => (confirm?.kind === "undo" ? runUndo(confirm.batch) : runApply())}
              disabled={word !== needed || busy !== null}
              data-testid="button-email-offer-confirm"
            >
              {busy === "apply" || busy === "undo" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {confirm?.kind === "undo" ? "Put back" : `Clear ${going.size.toLocaleString("en-GB")} ${going.size === 1 ? "row" : "rows"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
