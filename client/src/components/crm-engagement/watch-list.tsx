// The watch list on the CRM Overview: every company that has been turned on
// (it is on a running strategy), and every Super Brand, with what is new on
// it and what is owed (Woody, 2026-11-15: the CRM "closely watches them more
// than other CRMs"; 2026-11-17: Super Brands get "the CRM VIP treatment").
// The ones that need something are listed first. An entry opens its own box
// (watch-entry.tsx): what's needed with a button for each, its strategy, and
// BGP's activity with it; each owed chip does its own job (Woody, 2026-11-23).
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Eye, Star, Target } from "lucide-react";
import type { EngagementNoun } from "@shared/crm-engagement";
import { NOUN_WORDS } from "@shared/crm-engagement";
import type { CrmWatchRow } from "@shared/crm-watch";
import { lastContactShort } from "@shared/last-contact";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StartStrategyDialog } from "@/components/crm-engagement/start-strategy";
import { AddPersonDialog, WatchEntryDialog, owedKind, type WatchHandlers, type WatchTab } from "@/components/crm-engagement/watch-entry";
import { pillMetrics } from "@/components/ui/pill";

const due = (value: string | null) => { const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null; };

// `aside` sits beside the list in the same card: the CRM actions on the CRM
// page's Overview (Woody, 2026-11-23: "combine the CRM actions with the watch
// list on to the top board together").
export function CrmWatchList({ noun, match, handlers, aside }: { noun: EngagementNoun | ""; match?: (row: CrmWatchRow) => boolean; handlers: Omit<WatchHandlers, "onStartStrategy" | "onAddPerson">; aside?: ReactNode }) {
  const [all, setAll] = useState(false);
  const [starting, setStarting] = useState<CrmWatchRow | null>(null);
  const [addingPerson, setAddingPerson] = useState<CrmWatchRow | null>(null);
  const [open, setOpen] = useState<{ id: string; tab?: WatchTab } | null>(null);
  const onOpenStrategy = handlers.onOpenStrategy;
  const entryHandlers: WatchHandlers = {
    ...handlers,
    onOpenStrategy: id => { setOpen(null); handlers.onOpenStrategy(id); },
    onAddAction: (row, initial) => { setOpen(null); handlers.onAddAction(row, initial); },
    onStartStrategy: row => { setOpen(null); setStarting(row); },
    onAddPerson: row => { setOpen(null); setAddingPerson(row); },
  };
  // Each owed chip does its own job; the ones that need a choice open the box.
  const chip = (row: CrmWatchRow, line: string) => {
    switch (owedKind(line)) {
      case "strategy": return entryHandlers.onStartStrategy(row);
      case "next": return entryHandlers.onAddAction(row, { companyId: row.id, strategyId: row.strategyIds.length === 1 ? row.strategyIds[0] : null });
      case "people": return entryHandlers.onAddPerson(row);
      case "contact": return entryHandlers.onAddAction(row, { companyId: row.id, strategyId: row.strategyIds.length === 1 ? row.strategyIds[0] : null, title: `Get in touch with ${row.name}` });
      default: return setOpen({ id: row.id, tab: "needed" });
    }
  };
  const chipTitle = (line: string) => ({ strategy: "Start a strategy", next: "Add the next step", people: "Add a person at this company", contact: "Plan a call or meeting", overdue: "See the overdue actions", other: "See what's needed" } as const)[owedKind(line)];
  const watch = useQuery<{ rows: CrmWatchRow[] }>({
    queryKey: ["/api/crm/engagement", "watch"], queryFn: async () => (await apiRequest("GET", "/api/crm/engagement/watch")).json(),
    staleTime: 60_000, refetchInterval: false, retry: 1,
  });
  if ((watch.isLoading || watch.isError) && !aside) return null;
  const everyRow = watch.data?.rows || [];
  const rows = everyRow.filter(row => (!noun || row.noun === noun) && (!match || match(row)));
  const owing = rows.filter(row => row.owed.length).length;
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <Card className="p-4" data-testid="crm-watch-list">
      <div className={aside ? "grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]" : ""}><div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Eye className="h-4 w-4" />Watch list <span className="font-mono tabular-nums">{rows.length}</span></h3>
        <p className="text-xs text-muted-foreground">{rows.length ? `Companies on a running strategy, and Super Brands${owing ? ` · ${owing} need${owing === 1 ? "s" : ""} something` : ""}. Checked weekly for new sites, planning and news.` : ""}</p>
      </div>
      {watch.isLoading ? <p className="text-sm text-muted-foreground">Loading the watch list…</p> : watch.isError ? <p className="text-sm text-muted-foreground">The watch list could not be loaded. <button type="button" className="underline" onClick={() => watch.refetch()}>Try again</button></p> : !rows.length && everyRow.length && match ? <p className="text-sm text-muted-foreground">Nothing on the watch list matches these filters.</p> : !rows.length ? <p className="text-sm text-muted-foreground">Nobody is on a strategy{noun ? ` among ${NOUN_WORDS[noun].many}` : ""} yet. Open the Landlords, Brands, Agents or Lenders tab and press Start strategy on a company to turn it on, or star a brand as a Super Brand.</p> : (
        <ul className="divide-y">
          {shown.map(row => (
            <li key={row.id} className="py-2.5 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]" data-testid={`crm-watch-${row.id}`}>
              <div className="min-w-0">
                {row.superBrand && <Star className="inline w-3.5 h-3.5 mr-1 -mt-0.5 fill-amber-400 text-amber-500" aria-label="Super Brand" data-testid={`crm-watch-super-${row.id}`} />}
                <button type="button" className="text-sm font-semibold hover:underline break-words text-left" onClick={() => setOpen({ id: row.id })} title="What's needed, the strategy and BGP's activity" data-testid={`crm-watch-open-${row.id}`}>{row.name}</button>
                <span className="text-xs text-muted-foreground"> · {row.superBrand ? "Super Brand" : NOUN_WORDS[row.noun].One}</span>
                <p className="text-xs text-muted-foreground break-words">
                  {row.strategies.map((name, i) => <button key={row.strategyIds[i] || name} type="button" className="underline hover:text-foreground mr-2" onClick={() => onOpenStrategy(row.strategyIds[i])}>{name}</button>)}
                </p>
                <p className="text-xs text-muted-foreground">{[lastContactShort(row.lastContactAt) ? `Last contact ${lastContactShort(row.lastContactAt)}` : "No contact logged", due(row.nextMeetingAt || null) ? `meeting ${due(row.nextMeetingAt || null)}` : null, row.peopleCount != null ? `${row.peopleCount} ${row.peopleCount === 1 ? "person" : "people"}` : null].filter(Boolean).join(" · ")}
                  {" · "}<button type="button" className="underline hover:text-foreground" onClick={() => setOpen({ id: row.id, tab: "activity" })}>Activity</button>{" · "}<Link href={`/companies/${row.id}`} className="underline hover:text-foreground">Page</Link></p>
              </div>
              <div className="min-w-0 space-y-1">
                {row.owed.length > 0 && <div className="flex flex-wrap items-center gap-1">{row.owed.map(line => <button type="button" key={line} onClick={() => chip(row, line)} title={chipTitle(line)} data-testid={`crm-watch-owed-${row.id}-${owedKind(line)}`} className={`${pillMetrics} border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900`}>{line}</button>)}
                  {row.superBrand && !row.strategies.length && <Button size="sm" variant="outline" className="h-7" onClick={() => setStarting(row)} data-testid={`crm-watch-start-${row.id}`}><Target className="w-3.5 h-3.5 mr-1" />Start strategy</Button>}
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen({ id: row.id, tab: "needed" })} data-testid={`crm-watch-needed-${row.id}`}>What's needed</Button>
                </div>}
                {row.nextAction && <p className="text-[13px] break-words"><span className="text-muted-foreground">Next:</span> {row.nextAction.title}{due(row.nextAction.dueAt) ? <span className={row.overdueActions ? "text-red-700" : "text-muted-foreground"}> · {due(row.nextAction.dueAt)}</span> : null}{row.nextAction.ownerName ? <span className="text-muted-foreground"> · {row.nextAction.ownerName}</span> : null}</p>}
                {row.news.map(line => <p key={line} className="text-xs text-muted-foreground break-words">New: {line}</p>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 6 && <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setAll(v => !v)} aria-expanded={all}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
      </div>{aside && <div className="min-w-0 border-t pt-4 xl:border-t-0 xl:pt-0 xl:border-l xl:pl-6" data-testid="crm-watch-aside">{aside}</div>}</div>
      {starting && <StartStrategyDialog company={{ id: starting.id, name: starting.name }} onClose={() => setStarting(null)} onStarted={strategyId => { setStarting(null); onOpenStrategy(strategyId); }} />}
      {open && everyRow.find(r => r.id === open.id) && <WatchEntryDialog key={open.id} row={everyRow.find(r => r.id === open.id)!} initialTab={open.tab} handlers={entryHandlers} onClose={() => setOpen(null)} />}
      {addingPerson && <AddPersonDialog company={addingPerson} onClose={() => { setAddingPerson(null); watch.refetch(); }} />}
    </Card>
  );
}
