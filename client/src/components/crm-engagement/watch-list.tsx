// The watch list on the CRM Overview: every company that has been turned on
// (it is on a running strategy), and every Super Brand, with what is new on
// it and what is owed (Woody, 2026-11-15: the CRM "closely watches them more
// than other CRMs"; 2026-11-17: Super Brands get "the CRM VIP treatment").
// The ones that need something are listed first.
import { useState } from "react";
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
import { pillMetrics } from "@/components/ui/pill";

const due = (value: string | null) => { const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null; };

export function CrmWatchList({ noun, onOpenStrategy }: { noun: EngagementNoun | ""; onOpenStrategy: (strategyId: string) => void }) {
  const [all, setAll] = useState(false);
  const [starting, setStarting] = useState<CrmWatchRow | null>(null);
  const watch = useQuery<{ rows: CrmWatchRow[] }>({
    queryKey: ["/api/crm/engagement", "watch"], queryFn: async () => (await apiRequest("GET", "/api/crm/engagement/watch")).json(),
    staleTime: 60_000, refetchInterval: false, retry: 1,
  });
  if (watch.isLoading || watch.isError) return null;
  const rows = (watch.data?.rows || []).filter(row => !noun || row.noun === noun);
  const owing = rows.filter(row => row.owed.length).length;
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <Card className="p-4" data-testid="crm-watch-list">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Eye className="h-4 w-4" />Watch list <span className="font-mono tabular-nums">{rows.length}</span></h3>
        <p className="text-xs text-muted-foreground">{rows.length ? `Companies on a running strategy, and Super Brands${owing ? ` · ${owing} need${owing === 1 ? "s" : ""} something` : ""}. Checked weekly for new sites, planning and news.` : ""}</p>
      </div>
      {!rows.length ? <p className="text-sm text-muted-foreground">Nobody is on a strategy{noun ? ` among ${NOUN_WORDS[noun].many}` : ""} yet. Open the Landlords, Brands, Agents or Lenders tab and press Start strategy on a company to turn it on, or star a brand as a Super Brand.</p> : (
        <ul className="divide-y">
          {shown.map(row => (
            <li key={row.id} className="py-2.5 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]" data-testid={`crm-watch-${row.id}`}>
              <div className="min-w-0">
                {row.superBrand && <Star className="inline w-3.5 h-3.5 mr-1 -mt-0.5 fill-amber-400 text-amber-500" aria-label="Super Brand" data-testid={`crm-watch-super-${row.id}`} />}
                <Link href={`/companies/${row.id}`} className="text-sm font-semibold hover:underline break-words">{row.name}</Link>
                <span className="text-xs text-muted-foreground"> · {row.superBrand ? "Super Brand" : NOUN_WORDS[row.noun].One}</span>
                <p className="text-xs text-muted-foreground break-words">
                  {row.strategies.map((name, i) => <button key={row.strategyIds[i] || name} type="button" className="underline hover:text-foreground mr-2" onClick={() => onOpenStrategy(row.strategyIds[i])}>{name}</button>)}
                </p>
                <p className="text-xs text-muted-foreground">{lastContactShort(row.lastContactAt) ? `Last contact ${lastContactShort(row.lastContactAt)}` : "No contact on record"}</p>
              </div>
              <div className="min-w-0 space-y-1">
                {row.owed.length > 0 && <div className="flex flex-wrap items-center gap-1">{row.owed.map(line => <span key={line} className={`${pillMetrics} border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200`}>{line}</span>)}
                  {row.superBrand && !row.strategies.length && <Button size="sm" variant="outline" className="h-7" onClick={() => setStarting(row)} data-testid={`crm-watch-start-${row.id}`}><Target className="w-3.5 h-3.5 mr-1" />Start strategy</Button>}
                </div>}
                {row.nextAction && <p className="text-[13px] break-words"><span className="text-muted-foreground">Next:</span> {row.nextAction.title}{due(row.nextAction.dueAt) ? <span className={row.overdueActions ? "text-red-700" : "text-muted-foreground"}> · {due(row.nextAction.dueAt)}</span> : null}{row.nextAction.ownerName ? <span className="text-muted-foreground"> · {row.nextAction.ownerName}</span> : null}</p>}
                {row.news.map(line => <p key={line} className="text-xs text-muted-foreground break-words">New: {line}</p>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 6 && <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setAll(v => !v)} aria-expanded={all}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
      {starting && <StartStrategyDialog company={{ id: starting.id, name: starting.name }} onClose={() => setStarting(null)} onStarted={strategyId => { setStarting(null); onOpenStrategy(strategyId); }} />}
    </Card>
  );
}
