// The CRM page's one list (Woody, 2026-11-15): landlords, brands, agents and
// lenders drawn the same way, as cards or a table. Every row says who at BGP
// owns the relationship, when we last spoke, the next action and whether it
// is on a CRM strategy. Fed by GET /api/crm/hub/:kind (BGP staff only); the
// filters and their counts are the rules in shared/crm-hub.ts.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, Users, X } from "lucide-react";
import {
  CRM_HUB_FILTERS, rowMatchesFilter, rowMatchesSearch,
  type CrmHubFilter, type CrmHubKind, type CrmHubResponse, type CrmHubRow,
} from "@shared/crm-hub";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, PillCount, pillActive, pillInactive, pillMetrics } from "@/components/ui/pill";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ViewToggle } from "@/components/mobile-card-view";
import { CRM_HUB_KEY, CRM_TABLE_COLUMNS, CrmCompanyCard, CrmCompanyTableRow, type CrmRowActions } from "./company-row";
import { CrmSelectBar } from "./crm-select-bar";

export { CRM_HUB_KEY } from "./company-row";

const WORDS: Record<CrmHubKind, { one: string; many: string; empty: string }> = {
  landlord: { one: "landlord", many: "landlords", empty: "No landlord accounts yet." },
  brand: { one: "brand", many: "brands", empty: "No brands are being worked yet. A brand joins this list when it is on a strategy, has an open action, a live transaction or a requirement, or is starred as a Super Brand." },
  agent: { one: "agent firm", many: "agent firms", empty: "No agent firms yet." },
  lender: { one: "lender", many: "lenders", empty: "No lenders yet." },
};
type View = "card" | "table";
type ClientFilter = "all" | "clients" | "non-clients";
const PAGE = { phone: 30, desktop: 90 };
const filterRow = "flex items-center gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0";

// Cards or table, remembered for each list in this browser.
const viewKey = (kind: CrmHubKind) => `bgp_crm_hub_view_${kind}`;
function storedView(kind: CrmHubKind): View {
  try { return window.localStorage.getItem(viewKey(kind)) === "table" ? "table" : "card"; } catch { return "card"; }
}
function storeView(kind: CrmHubKind, view: View) {
  try { window.localStorage.setItem(viewKey(kind), view); } catch { /* the choice lasts for this visit only */ }
}

// apiRequest throws "403: the server's own words". Anything that is not a
// short plain sentence (a proxy's HTML page, a stack) is not shown.
function cleanError(error: unknown): string {
  const message = (error instanceof Error ? error.message : "").replace(/^\d{3}:\s*/, "").trim();
  return message && message.length <= 160 && !/[<{]/.test(message) ? message : "";
}

// A one-choice drop-down whose trigger is a pill (filled once a choice is made).
export function PillSelect({ label, any, value, options, onChange, testId }: {
  label: string; any: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; testId: string;
}) {
  const chosen = options.find(option => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-no-min-touch className={cn(pillMetrics, chosen ? pillActive : pillInactive, "max-w-[240px]")} data-testid={testId}>
          <span className="truncate">{chosen ? `${label}: ${chosen.label}` : label}</span><ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">{any}</DropdownMenuRadioItem>
          {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LoadingList({ kind }: { kind: CrmHubKind }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" role="status" aria-label={`Loading ${WORDS[kind].many}`} data-testid={`crm-hub-loading-${kind}`}>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} className="rounded-xl border border-card-border bg-card p-3 space-y-3">
          <div className="flex items-center gap-2.5"><Skeleton className="h-10 w-10 rounded-lg" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div>
          <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function CrmCompanyList({ kind, onStartStrategy, onOpenStrategy }: {
  kind: CrmHubKind;
  onStartStrategy: (row: CrmHubRow) => void;
  onOpenStrategy?: (strategyId: string) => void;
}) {
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const words = WORDS[kind];
  const query = useQuery<CrmHubResponse>({
    queryKey: [CRM_HUB_KEY, kind],
    queryFn: async () => (await apiRequest("GET", `${CRM_HUB_KEY}/${kind}`)).json(),
    staleTime: 60_000, refetchInterval: false, retry: 1,
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CrmHubFilter>("all");
  const [owner, setOwner] = useState("");
  const [clients, setClients] = useState<ClientFilter>("all");
  const [city, setCity] = useState("");
  const [subType, setSubType] = useState("");
  const [view, setView] = useState<View>(() => storedView(kind));
  // Select and Delete (Woody, 2026-11-23), for admins, as on Brand Explorer.
  const { data: me } = useQuery<{ isAdmin?: boolean }>({ queryKey: ["/api/auth/me"] });
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  useEffect(() => { setSelecting(false); setPicked(new Set()); }, [kind]);
  const page = isMobile ? PAGE.phone : PAGE.desktop;
  const [shown, setShown] = useState(page);
  // Each list keeps its own filters and view: a change of list starts clean.
  useEffect(() => {
    setSearch(""); setFilter("all"); setOwner(""); setClients("all"); setCity(""); setSubType(""); setView(storedView(kind));
  }, [kind]);
  useEffect(() => { setShown(page); }, [kind, page, search, filter, owner, clients, city, subType, view]);
  const chooseView = (next: "table" | "card" | "board") => {
    const picked: View = next === "table" ? "table" : "card";
    setView(picked);
    // The phone has cards only: that is not the person's choice, so it is not remembered.
    if (!isMobile) storeView(kind, picked);
  };

  const data = query.data;
  const rows = data?.rows || [];
  // Everything but the main pills narrows first, so each pill's count is what pressing it would show.
  const narrowed = useMemo(() => rows.filter(row =>
    rowMatchesSearch(row, search)
    && (!owner || row.owners.some(person => person.id === owner))
    && (kind !== "landlord" || clients === "all" || row.isClient === (clients === "clients"))
    && (kind !== "agent" || !city || row.city === city)
    && (kind !== "lender" || !subType || row.subType === subType)),
  [rows, search, owner, clients, city, subType, kind]);
  const counts = useMemo(() => {
    const now = Date.now();
    return Object.fromEntries(CRM_HUB_FILTERS.map(option => [option.key, narrowed.filter(row => rowMatchesFilter(row, option.key, now)).length])) as Record<CrmHubFilter, number>;
  }, [narrowed]);
  const list = useMemo(() => {
    const now = Date.now();
    return filter === "all" ? narrowed : narrowed.filter(row => rowMatchesFilter(row, filter, now));
  }, [narrowed, filter]);
  const clientCounts = useMemo(() => {
    const base = rows.filter(row => rowMatchesSearch(row, search) && (!owner || row.owners.some(person => person.id === owner)));
    return { clients: base.filter(row => row.isClient).length, others: base.filter(row => !row.isClient).length };
  }, [rows, search, owner]);
  const subTypeCounts = useMemo(() => {
    const base = rows.filter(row => rowMatchesSearch(row, search) && (!owner || row.owners.some(person => person.id === owner)));
    return new Map((data?.subTypes || []).map(type => [type, base.filter(row => row.subType === type).length]));
  }, [rows, data?.subTypes, search, owner]);

  const filtered = !!search.trim() || filter !== "all" || !!owner || clients !== "all" || !!city || !!subType;
  const clear = () => { setSearch(""); setFilter("all"); setOwner(""); setClients("all"); setCity(""); setSubType(""); };
  const toggle = (row: CrmHubRow) => setPicked(previous => { const next = new Set(previous); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; });
  const actions: CrmRowActions = { onOpen: row => selecting ? toggle(row) : navigate(`/companies/${encodeURIComponent(row.id)}`), onStartStrategy, onOpenStrategy };
  const tick = (row: CrmHubRow) => (selecting ? picked.has(row.id) : undefined);
  const asTable = view === "table" && !isMobile;
  const visible = list.slice(0, shown);

  if (query.isError) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center space-y-3" role="alert" data-testid={`crm-hub-list-${kind}`}>
        <p className="text-sm text-muted-foreground">{cleanError(query.error) || `The ${words.many} could not be loaded.`}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching} data-testid={`crm-hub-retry-${kind}`}>
          {query.isFetching ? "Trying again…" : "Retry"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0" data-testid={`crm-hub-list-${kind}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-full md:w-auto md:flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${words.many}, people or owners…`} className="pl-9 pr-8 h-9"
            aria-label={`Search ${words.many}`} data-testid={`crm-hub-search-${kind}`} />
          {search && (
            <button type="button" data-no-min-touch className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear the search" onClick={() => setSearch("")}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {data && (
          <p className="text-sm text-muted-foreground" data-testid={`crm-hub-count-${kind}`}>
            <span className="font-mono tabular-nums">{list.length.toLocaleString("en-GB")}</span>
            {filtered && <> of <span className="font-mono tabular-nums">{rows.length.toLocaleString("en-GB")}</span></>} {(filtered ? rows.length : list.length) === 1 ? words.one : words.many}
          </p>
        )}
        <div className="flex items-center gap-2 md:ml-auto">
          {me?.isAdmin && !selecting && <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setSelecting(true)} data-testid={`crm-hub-select-${kind}`}>Select</Button>}
          <div className="hidden md:block"><ViewToggle view={view} onToggle={chooseView} /></div>
        </div>
      </div>
      {selecting && <CrmSelectBar kind={kind} words={words} picked={picked} onPick={setPicked} shown={list.map(row => ({ id: row.id, name: row.name }))}
        onDone={() => { setSelecting(false); setPicked(new Set()); }} />}

      <div className={filterRow} data-testid={`crm-hub-filters-${kind}`}>
        {CRM_HUB_FILTERS.map(option => (
          <Pill key={option.key} active={filter === option.key} aria-pressed={filter === option.key} data-testid={`crm-hub-filter-${option.key}`}
            onClick={() => setFilter(filter === option.key ? "all" : option.key)}>
            {option.label}{data && <PillCount n={counts[option.key]} active={filter === option.key} />}
          </Pill>
        ))}
        <span className="h-4 w-px bg-border" aria-hidden />
        <PillSelect label="Owner" any="Anyone" value={owner} onChange={setOwner} testId="crm-hub-filter-owner"
          options={(data?.owners || []).map(person => ({ value: person.id, label: person.name }))} />
        {kind === "landlord" && (
          <>
            <Pill active={clients === "clients"} aria-pressed={clients === "clients"} onClick={() => setClients(clients === "clients" ? "all" : "clients")} data-testid="crm-hub-filter-clients">
              BGP clients{data && <PillCount n={clientCounts.clients} active={clients === "clients"} />}
            </Pill>
            <Pill active={clients === "non-clients"} aria-pressed={clients === "non-clients"} onClick={() => setClients(clients === "non-clients" ? "all" : "non-clients")} data-testid="crm-hub-filter-non-clients">
              Non-clients{data && <PillCount n={clientCounts.others} active={clients === "non-clients"} />}
            </Pill>
          </>
        )}
        {kind === "agent" && (data?.cities.length || 0) > 0 && (
          <PillSelect label="City" any="Anywhere" value={city} onChange={setCity} testId="crm-hub-filter-city" options={(data?.cities || []).map(name => ({ value: name, label: name }))} />
        )}
        {kind === "lender" && (data?.subTypes || []).map(type => (
          <Pill key={type} active={subType === type} aria-pressed={subType === type} onClick={() => setSubType(subType === type ? "" : type)}
            data-testid={`crm-hub-filter-sub-${type.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            {type}<PillCount n={subTypeCounts.get(type) || 0} active={subType === type} />
          </Pill>
        ))}
      </div>

      {query.isLoading ? <LoadingList kind={kind} /> : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center space-y-3" data-testid={`crm-hub-empty-${kind}`}>
          <Users className="w-6 h-6 mx-auto text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{filtered ? `No ${words.many} match these filters.` : words.empty}</p>
          {filtered && <Button type="button" variant="outline" size="sm" onClick={clear} data-testid={`crm-hub-clear-${kind}`}>Clear filters</Button>}
        </div>
      ) : asTable ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid={`crm-hub-table-${kind}`}>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-2 pl-3 pr-3 font-semibold">{words.one}</th>
                {["BGP owner", "Last contact", "Next action", "Strategy"].map(heading => <th key={heading} scope="col" className="py-2 pr-3 font-semibold whitespace-nowrap">{heading}</th>)}
                <th scope="col" className="py-2 pr-3 font-semibold font-mono text-right">Contacts</th>
                <th scope="col" className="py-2 pr-2 w-10"><span className="sr-only">People</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => <CrmCompanyTableRow key={row.id} row={row} actions={actions} selected={tick(row)} />)}
              {list.length > visible.length && (
                <tr><td colSpan={CRM_TABLE_COLUMNS} className="p-2 text-center">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShown(count => count + page)} data-testid={`crm-hub-more-${kind}`}>
                    Show more ({(list.length - visible.length).toLocaleString("en-GB")} left)
                  </Button>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start" data-testid={`crm-hub-cards-${kind}`}>
            {visible.map(row => <CrmCompanyCard key={row.id} row={row} actions={actions} phone={isMobile} selected={tick(row)} />)}
          </div>
          {list.length > visible.length && (
            <Button type="button" variant="outline" className="w-full" onClick={() => setShown(count => count + page)} data-testid={`crm-hub-more-${kind}`}>
              Show more ({(list.length - visible.length).toLocaleString("en-GB")} left)
            </Button>
          )}
        </>
      )}
    </div>
  );
}
