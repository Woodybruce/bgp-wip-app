import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, ChevronRight, Circle, Plus } from "lucide-react";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Pill, PillCount, pillInactive, pillMetrics } from "@/components/ui/pill";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmEntityPicker } from "@/components/crm-entity-picker";
import { ActionEditor } from "@/components/crm-engagement/dialogs";
import { invalidateEngagement } from "@/components/crm-engagement/overview";
import { CRM_ENGAGEMENT_KEY, type CompanySearch } from "@/components/crm-engagement/helpers";
import type { ActionInput, EngagementData, EngagementOptions } from "@shared/crm-engagement";
import {
  DIARY_BUCKETS, DIARY_BUCKET_LABELS, DIARY_KINDS, DIARY_KIND_LABELS, diaryBucket,
  type DiaryData, type DiaryItem, type DiaryKind,
} from "@shared/brand-diary";

// The Diary view of the Brand CRM (docs/brand-crm-spec-2026-11-12.md, 2.3):
// one dated list across brands. BGP staff read /api/brand-crm/diary; every
// Landsec view reads /api/landsec/diary, which the server has already cut to
// that login's brands, schemes and kinds of item. The screen groups and
// filters what it was sent and adds nothing. An action the viewer owns or
// raised is ticked off here through the CRM plan's own route; staff add a
// brand action and a full Landsec login adds a request to BGP the same way.

const STAFF_KEY = "/api/brand-crm/diary";
const LANDSEC_KEY = "/api/landsec/diary";
type GroupBy = "date" | "person" | "brand" | "scheme";
const GROUPS: Array<{ key: GroupBy; label: string }> = [
  { key: "date", label: "Date" }, { key: "person", label: "Person" }, { key: "brand", label: "Brand" }, { key: "scheme", label: "Scheme" },
];
const EMPTY: EngagementData = { events: [], strategies: [], actions: [] };
const EMPTY_OPTIONS: EngagementOptions = { staff: [], companies: [], contacts: [] };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const dash = <span className="text-muted-foreground">-</span>;

async function read<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
  // Not this login's to see: the caller says so instead of showing an error.
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
function cleanError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const json = message.match(/\{.*\}$/s)?.[0];
  if (json) { try { return JSON.parse(json).error || message; } catch {} }
  return message;
}
async function refreshDiary() {
  await Promise.all([
    invalidateEngagement(),
    ...[STAFF_KEY, LANDSEC_KEY, "/api/brand-crm/plan", "/api/landsec/brand-crm/plan"].map(key => queryClient.invalidateQueries({ queryKey: [key] })),
  ]);
}

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
function when(item: DiaryItem): string {
  if (item.date) return dayLabel(item.date);
  return item.daysWaiting === null ? "No date" : item.daysWaiting === 0 ? "Since today" : `${plural(item.daysWaiting, "day")} waiting`;
}
const place = (item: DiaryItem) => [item.scheme?.name, item.unitLabel].filter(Boolean).join(" · ");
// Under the title: the kind of item, and for an action who raised it and how far it has got.
function detail(item: DiaryItem, staff: boolean): string {
  if (item.kind !== "crm_action") return "";
  return [
    item.raisedBy === "client" ? (staff ? "Raised by the client" : "Your request to BGP") : staff ? "" : "From BGP",
    item.status === "in_progress" ? "In progress" : "",
  ].filter(Boolean).join(" · ");
}

interface Section { key: string; label: string; items: DiaryItem[] }
function sections(items: DiaryItem[], groupBy: GroupBy, today: string): Section[] {
  if (groupBy === "date") {
    return DIARY_BUCKETS.map(bucket => ({ key: bucket, label: DIARY_BUCKET_LABELS[bucket], items: items.filter(item => diaryBucket(item, today) === bucket) })).filter(s => s.items.length);
  }
  const none = groupBy === "person" ? "No owner named" : groupBy === "brand" ? "No brand" : "No scheme";
  const nameOf = (item: DiaryItem) => (groupBy === "person" ? item.owner : groupBy === "brand" ? item.brand?.name : item.scheme?.name) || none;
  const byName = new Map<string, DiaryItem[]>();
  for (const item of items) byName.set(nameOf(item), [...(byName.get(nameOf(item)) || []), item]);
  return Array.from(byName.entries())
    .sort(([a], [b]) => Number(a === none) - Number(b === none) || a.localeCompare(b))
    .map(([label, list]) => ({ key: label, label, items: list }));
}

export function Diary({ staff }: { staff: boolean }) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const base = staff ? STAFF_KEY : LANDSEC_KEY;
  const query = useQuery<DiaryData | null>({ queryKey: [base], queryFn: () => read<DiaryData>(base), staleTime: 60_000, retry: false, refetchInterval: false });
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  const [kind, setKind] = useState<DiaryKind | null>(null);
  const [waitingOnLandsec, setWaitingOnLandsec] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ticking, setTicking] = useState("");

  const data = query.data;
  const all = data?.items || [];
  const kindCounts = useMemo(() => DIARY_KINDS.map(k => ({ kind: k, count: all.filter(item => item.kind === k).length })).filter(k => k.count > 0), [all]);
  const landsecCount = all.filter(item => item.waitingOn?.side === "landsec").length;
  const shown = all.filter(item => (!kind || item.kind === kind) && (!waitingOnLandsec || item.waitingOn?.side === "landsec"));
  const grouped = useMemo(() => sections(shown, groupBy, data?.today || ""), [shown, groupBy, data?.today]);
  // Brands a request can be raised on without searching: the ones already in the diary.
  const knownBrands = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of all) if (item.brand?.id) byId.set(item.brand.id, item.brand.name);
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  async function tickOff(item: DiaryItem) {
    if (!item.canComplete || !item.actionId) return;
    setTicking(item.id);
    try {
      await apiRequest("PATCH", `${CRM_ENGAGEMENT_KEY}/actions/${encodeURIComponent(item.actionId)}`, { status: "done" });
      await refreshDiary();
      toast({ title: "CRM action done" });
    } catch (error) { toast({ title: "Could not update the CRM action", description: cleanError(error, "Please try again."), variant: "destructive" }); }
    finally { setTicking(""); }
  }

  if (query.isLoading) return <p className="text-sm text-muted-foreground" data-testid="brand-diary-loading">Loading the diary…</p>;
  if (query.isError) return <p role="status" className="text-sm text-muted-foreground">The diary could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>;
  if (!data) return <p className="text-sm text-muted-foreground" data-testid="brand-diary-refused">The diary is not available for this account.</p>;

  const tick = (item: DiaryItem) => item.canComplete
    ? <button type="button" data-no-min-touch className="text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={ticking === item.id}
        aria-label={`Mark done: ${item.title}`} title="Mark done" onClick={() => tickOff(item)} data-testid={`brand-diary-done-${item.id}`}>
        {ticking === item.id ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Circle className="h-4 w-4" aria-hidden="true" />}
      </button>
    : null;
  const kindChip = (item: DiaryItem) => <span className={`${pillMetrics} ${pillInactive}`}>{DIARY_KIND_LABELS[item.kind]}</span>;
  const whenText = (item: DiaryItem) => <span className={cn("font-mono tabular-nums text-xs whitespace-nowrap", item.overdue ? "text-destructive font-semibold" : "text-muted-foreground")}>{when(item)}</span>;
  const brandName = (item: DiaryItem) => !item.brand ? null
    : item.brand.id ? <Link href={`/companies/${item.brand.id}`} className="font-medium hover:underline">{item.brand.name}</Link> : <span className="font-medium">{item.brand.name}</span>;
  const open = (item: DiaryItem) => item.url
    ? <Link href={item.url} className="inline-flex items-center text-xs font-medium text-primary hover:underline" aria-label={`Open: ${item.title}`} data-testid={`brand-diary-open-${item.id}`}>Open<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
    : null;

  return <div className="space-y-3" data-testid="brand-diary">
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <p className="text-sm text-muted-foreground" data-testid="brand-diary-summary">
        {shown.length === all.length ? plural(all.length, "item") : `${shown.length} of ${plural(all.length, "item")}`}
        {data.counts.overdue > 0 && <> · <span className="font-mono tabular-nums">{data.counts.overdue}</span> overdue</>}
        {data.counts.waiting > 0 && <> · <span className="font-mono tabular-nums">{data.counts.waiting}</span> waiting on someone</>}
      </p>
      {data.canAddAction && <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="brand-diary-add-action"><Plus className="h-3.5 w-3.5 mr-1" />Add action</Button>}
      {!data.canAddAction && data.canAddRequest && <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="brand-diary-add-request"><Plus className="h-3.5 w-3.5 mr-1" />Add request</Button>}
    </div>

    <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0" data-testid="brand-diary-groups">
      <span className="text-xs text-muted-foreground">Group by</span>
      {GROUPS.map(group => <Pill key={group.key} active={groupBy === group.key} aria-pressed={groupBy === group.key} onClick={() => setGroupBy(group.key)} data-testid={`brand-diary-group-${group.key}`}>{group.label}</Pill>)}
    </div>
    <div className="flex gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0" data-testid="brand-diary-kinds">
      <Pill active={!kind} onClick={() => setKind(null)} data-testid="brand-diary-kind-all">Everything<PillCount n={all.length} active={!kind} /></Pill>
      {kindCounts.map(k => <Pill key={k.kind} active={kind === k.kind} onClick={() => setKind(kind === k.kind ? null : k.kind)} data-testid={`brand-diary-kind-${k.kind}`}>
        {DIARY_KIND_LABELS[k.kind]}<PillCount n={k.count} active={kind === k.kind} /></Pill>)}
      {landsecCount > 0 && <Pill active={waitingOnLandsec} aria-pressed={waitingOnLandsec} onClick={() => setWaitingOnLandsec(!waitingOnLandsec)} data-testid="brand-diary-filter-waiting-landsec">
        Waiting on Landsec<PillCount n={landsecCount} active={waitingOnLandsec} /></Pill>}
    </div>

    {all.length === 0
      ? <p className="text-sm text-muted-foreground" data-testid="brand-diary-empty">{staff
        ? "Nothing in the diary. Brand actions, booked viewings, viewing follow-ups, deals waiting on someone, briefs to sign and brand cases awaiting a reply appear here."
        : "Nothing in the diary for your schemes."}</p>
      : shown.length === 0
        ? <p className="text-sm text-muted-foreground" data-testid="brand-diary-no-match">Nothing matches these filters.</p>
        : grouped.map((section, s) => <section key={section.key} className="space-y-1.5" data-testid={`brand-diary-section-${s}`}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.label} <span className="font-mono tabular-nums">{section.items.length}</span></h3>
          {isMobile
            ? <div className="space-y-2" data-testid={`brand-diary-cards-${s}`}>
              {section.items.map(item => <div key={item.id} className="rounded-2xl border border-border bg-card p-3 space-y-1.5 shadow-sm" data-testid={`brand-diary-item-${item.id}`}>
                <div className="flex items-start gap-2">
                  {tick(item)}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold break-words">{item.title}</p>
                    {detail(item, staff) && <p className="text-xs text-muted-foreground">{detail(item, staff)}</p>}
                  </div>
                  {whenText(item)}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">{kindChip(item)}{brandName(item)}{place(item) && <span className="text-muted-foreground">{place(item)}</span>}</div>
                {(item.owner || item.waitingOn) && <p className="text-xs text-muted-foreground">
                  {item.owner && <>Owner <span className="font-medium text-foreground">{item.owner}</span></>}{item.owner && item.waitingOn && " · "}
                  {item.waitingOn && <>Waiting on <span className="font-medium text-foreground">{item.waitingOn.name}</span></>}</p>}
                {open(item)}
              </div>)}
            </div>
            : <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm" data-testid={`brand-diary-table-${s}`}>
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="w-8 py-1.5 pl-3"><span className="sr-only">Done</span></th>
                    {["When", "What", "Brand", "Scheme and unit", "Owner", "Waiting on"].map(heading => <th key={heading} scope="col" className="py-1.5 pr-3 font-semibold">{heading}</th>)}
                    <th scope="col" className="py-1.5 pr-3 font-semibold"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map(item => <tr key={item.id} className="border-b border-border last:border-b-0 align-top" data-testid={`brand-diary-item-${item.id}`}>
                    <td className="py-2 pl-3">{tick(item)}</td>
                    <td className="py-2 pr-3">{whenText(item)}</td>
                    <td className="py-2 pr-3 max-w-[320px]">
                      <p className="font-medium break-words">{item.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{kindChip(item)}{detail(item, staff)}</p>
                    </td>
                    <td className="py-2 pr-3">{brandName(item) || dash}</td>
                    <td className="py-2 pr-3">{place(item) || dash}</td>
                    <td className="py-2 pr-3">{item.owner || dash}</td>
                    <td className="py-2 pr-3">{item.waitingOn?.name || dash}</td>
                    <td className="py-2 pr-3 text-right">{open(item)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
        </section>)}

    {data.warnings.map(warning => <p key={warning} role="status" className="text-xs text-muted-foreground">{warning}</p>)}

    {adding && data.canAddAction && <StaffAction onClose={() => setAdding(false)} />}
    {adding && !data.canAddAction && data.canAddRequest && <ClientRequest brands={knownBrands} onClose={() => setAdding(false)} />}
  </div>;
}

async function saveAction(input: ActionInput) {
  try { await apiRequest("POST", `${CRM_ENGAGEMENT_KEY}/actions`, input); }
  catch (error) { throw new Error(cleanError(error, "The CRM action could not be saved.")); }
  await refreshDiary();
}

// Brands found by typing. A client login is only ever given brands on its own list.
function useBrandSearch() {
  const [text, setText] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const matches = useQuery<{ brands?: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/brands/search", { q: text }],
    queryFn: async () => (await apiRequest("GET", `/api/brands/search?q=${encodeURIComponent(text)}`)).json(),
    enabled: text.length >= 2, staleTime: 60_000, refetchInterval: false, retry: false,
  });
  return {
    choices: (matches.data?.brands || []).map(brand => ({ id: brand.id, name: brand.name })),
    onSearch: (typed: string) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setText(typed.trim()), 250); },
  };
}

// BGP staff: the Brand CRM's own action form, for any brand.
function StaffAction({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const options = useQuery<EngagementOptions>({
    queryKey: [CRM_ENGAGEMENT_KEY, "options", "brand"], queryFn: async () => (await apiRequest("GET", `${CRM_ENGAGEMENT_KEY}/options?kind=brand`)).json(),
    staleTime: 5 * 60_000, refetchInterval: false, retry: 1,
  });
  // The strategies and events an action can be linked to.
  const plan = useQuery<EngagementData>({
    queryKey: [CRM_ENGAGEMENT_KEY, { kind: "brand" }], queryFn: async () => (await apiRequest("GET", `${CRM_ENGAGEMENT_KEY}?kind=brand`)).json(),
    staleTime: 60_000, refetchInterval: false, retry: 1,
  });
  const found = useBrandSearch();
  const [picked, setPicked] = useState<Array<{ id: string; name: string }>>([]);
  const listed = options.data || EMPTY_OPTIONS;
  const merged = useMemo<EngagementOptions>(() => ({ ...listed, companies: [...listed.companies, ...picked.filter(c => !listed.companies.some(o => o.id === c.id))] }), [listed, picked]);
  const search: CompanySearch = { ...found, onPick: brand => setPicked(previous => previous.some(c => c.id === brand.id) ? previous : [...previous, brand]) };
  if (options.isError) return <FormNotice onClose={onClose} text="The action form could not be loaded." retry={() => options.refetch()} />;
  if (!options.data) return <FormNotice onClose={onClose} text="Loading the action form…" />;
  return <ActionEditor kind="brand" options={merged} data={plan.data || EMPTY} search={search} onClose={onClose}
    onSave={async input => { await saveAction(input); toast({ title: "CRM action saved" }); }} />;
}

// A full Landsec login: a request to BGP on one brand from its own list. The
// brand comes first, because the form's list of BGP owners is asked for per brand.
function ClientRequest({ brands, onClose }: { brands: Array<{ id: string; name: string }>; onClose: () => void }) {
  const { toast } = useToast();
  const found = useBrandSearch();
  const [brand, setBrand] = useState<{ id: string; name: string } | null>(null);
  const options = useQuery<EngagementOptions>({
    queryKey: [CRM_ENGAGEMENT_KEY, "options", brand?.id || ""],
    queryFn: async () => (await apiRequest("GET", `${CRM_ENGAGEMENT_KEY}/options?companyId=${encodeURIComponent(brand!.id)}`)).json(),
    enabled: !!brand, staleTime: 5 * 60_000, refetchInterval: false, retry: false,
  });
  if (!brand) {
    const choices = [...brands, ...found.choices.filter(c => !brands.some(b => b.id === c.id))];
    return <Dialog open onOpenChange={isOpen => { if (!isOpen) onClose(); }}><DialogContent className="max-w-md" aria-describedby="brand-diary-request-description">
      <DialogHeader><DialogTitle>Add a request to BGP</DialogTitle><DialogDescription id="brand-diary-request-description">Choose the brand the request is about. BGP sees it on that brand's plan and in its diary.</DialogDescription></DialogHeader>
      <CrmEntityPicker value={null} options={choices} onSearchChange={found.onSearch} searchPlaceholder="Search brands…" emptyLabel="Choose a brand"
        className="border rounded-md px-3 py-2 min-h-9" testIdPrefix="brand-diary-request-brand" onSelect={choice => setBrand({ id: choice.id, name: choice.name })} />
    </DialogContent></Dialog>;
  }
  if (options.isError) return <FormNotice onClose={onClose} text={`A request cannot be added on ${brand.name} from this login.`} />;
  if (!options.data) return <FormNotice onClose={onClose} text="Loading the request form…" />;
  return <ActionEditor kind="brand" companyId={brand.id} initial={{ companyId: brand.id, title: "" }} options={options.data} data={EMPTY} onClose={onClose}
    onSave={async input => { await saveAction(input); toast({ title: "Request sent to BGP" }); }} />;
}

function FormNotice({ text, onClose, retry }: { text: string; onClose: () => void; retry?: () => void }) {
  return <Dialog open onOpenChange={isOpen => { if (!isOpen) onClose(); }}><DialogContent className="max-w-md" aria-describedby="brand-diary-form-notice">
    <DialogHeader><DialogTitle>CRM action</DialogTitle><DialogDescription id="brand-diary-form-notice" role="status">{text}</DialogDescription></DialogHeader>
    {retry && <Button type="button" variant="outline" size="sm" className="w-fit" onClick={retry}>Try again</Button>}
  </DialogContent></Dialog>;
}
