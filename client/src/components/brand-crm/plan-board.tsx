import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Pill, PillCount, pillActive, pillInactive, pillMetrics } from "@/components/ui/pill";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BRAND_STAGES, BRAND_STAGE_LABELS, BRAND_STAGE_MEANINGS, type BrandGrid, type BrandGridBrand, type BrandGridCell, type BrandPlan, type BrandStage, type PlanRow } from "@shared/brand-stage";
import { NextStepCell, RequirementCell, RowLinks, SchemeName, StageChip, UnitCell, showsRequirement, stageChipClass, stageLine } from "./scheme-plan-card";

// The Targets view of the Brand CRM (docs/brand-crm-spec-2026-11-12.md, 2.3):
// brands down, the Landsec schemes across in their groups, each cell the
// furthest stage that brand has reached at that scheme. BGP staff read
// /api/brand-crm/plan; every Landsec view reads /api/landsec/brand-crm/plan,
// which the server has already cut to that login's brands and schemes. A
// cell opens the brand's lines in a side sheet. A joint agent holds no brand
// ids, so its lines arrive with the grid and it gets no link to a brand page.

const GROUP_ORDER = ["North", "South", "Outlets", "London"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function read<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
  // Not this login's to see: the caller says so instead of showing an error.
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

interface Filters { stage: BrandStage | null; scheme: string | null; owner: string | null; noNextStep: boolean; wanted: boolean }
const NO_FILTERS: Filters = { stage: null, scheme: null, owner: null, noNextStep: false, wanted: false };
const filtering = (f: Filters) => !!(f.stage || f.scheme || f.owner || f.noNextStep || f.wanted);

const cellPasses = (schemeKey: string, cell: BrandGridCell, f: Filters) =>
  (!f.scheme || f.scheme === schemeKey)
  && (!f.stage || cell.stage === f.stage)
  && (!f.owner || (cell.owners || []).includes(f.owner))
  && (!f.noNextStep || (cell.noNextStep || 0) > 0)
  && (!f.wanted || cell.wanted > 0);

const brandsWith = (brands: BrandGridBrand[], test: (schemeKey: string, cell: BrandGridCell) => boolean) =>
  brands.filter(b => Object.entries(b.cells).some(([key, cell]) => test(key, cell))).length;

interface MenuOption { value: string; label: string; count: number; group?: string }

// A filter with many values: a pill that opens the list (docs/DESIGN.md, 5).
function PillMenu({ label, all, value, options, onChange, testId }: { label: string; all: string; value: string | null; options: MenuOption[]; onChange: (value: string | null) => void; testId: string }) {
  const [open, setOpen] = useState(false);
  const chosen = options.find(o => o.value === value);
  const pick = (next: string | null) => { onChange(next); setOpen(false); };
  const item = "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted";
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" data-no-min-touch className={cn(pillMetrics, chosen ? pillActive : pillInactive)} data-testid={testId}>
        {chosen ? chosen.label : label}<ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-64 max-h-80 overflow-y-auto p-1">
      <button type="button" className={cn(item, !chosen && "font-semibold")} onClick={() => pick(null)} data-testid={`${testId}-all`}>{all}</button>
      {options.map((o, i) => <div key={o.value}>
        {o.group && o.group !== options[i - 1]?.group && <p className="px-2 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{o.group}</p>}
        <button type="button" className={cn(item, o.value === value && "font-semibold")} onClick={() => pick(o.value)} data-testid={`${testId}-${o.value}`}>
          <span className="truncate">{o.label}</span><span className="font-mono tabular-nums text-xs text-muted-foreground">{o.count}</span>
        </button>
      </div>)}
    </PopoverContent>
  </Popover>;
}

const underName = (brand: BrandGridBrand, staff: boolean): string => [
  Object.keys(brand.cells).length ? plural(Object.keys(brand.cells).length, "scheme") : "No scheme yet",
  brand.requirementHeld ? "Requirement held" : staff ? "No requirement" : null,
  staff && brand.lead ? `Lead ${brand.lead.name}` : null,
  staff && brand.openActions ? plural(brand.openActions, "open action") : null,
  brand.otherSchemeCount ? `Also at ${plural(brand.otherSchemeCount, "other scheme")}` : null,
].filter(Boolean).join(" · ");

export function PlanBoard({ staff }: { staff: boolean }) {
  const isMobile = useIsMobile();
  const base = staff ? "/api/brand-crm/plan" : "/api/landsec/brand-crm/plan";
  const query = useQuery<BrandGrid | null>({
    queryKey: [base],
    queryFn: () => read<BrandGrid>(staff ? `${base}?landlord=landsec` : base),
    staleTime: 60_000, retry: false, refetchInterval: false,
  });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [text, setText] = useState("");
  const [opened, setOpened] = useState<{ brandKey: string; schemeKey: string | null } | null>(null);
  const set = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));

  const grid = query.data;
  const brands = grid?.brands || [];
  const schemes = grid?.schemes || [];
  const groups = useMemo(() => {
    const names = Array.from(new Set(schemes.map(s => s.group)));
    names.sort((a, b) => (GROUP_ORDER.indexOf(a) < 0 ? 99 : GROUP_ORDER.indexOf(a)) - (GROUP_ORDER.indexOf(b) < 0 ? 99 : GROUP_ORDER.indexOf(b)));
    return names.map(group => ({ group, schemes: schemes.filter(s => s.group === group) }));
  }, [schemes]);
  const columns = groups.flatMap(g => g.schemes);
  const groupStart = new Set(groups.map(g => g.schemes[0]?.key));

  const stageCounts = useMemo(() => BRAND_STAGES.map(stage => ({ stage, count: brandsWith(brands, (_k, c) => c.stage === stage) })).filter(s => s.count > 0), [brands]);
  const schemeOptions: MenuOption[] = columns.map(s => ({ value: s.key, label: s.name, group: s.group, count: brandsWith(brands, key => key === s.key) }));
  const ownerOptions: MenuOption[] = useMemo(() => {
    const names = Array.from(new Set(brands.flatMap(b => Object.values(b.cells).flatMap(c => c.owners || [])))).sort((a, b) => a.localeCompare(b));
    return names.map(name => ({ value: name, label: name, count: brandsWith(brands, (_k, c) => (c.owners || []).includes(name)) }));
  }, [brands]);
  const noNextStepCount = brandsWith(brands, (_k, c) => (c.noNextStep || 0) > 0);
  const wantedCount = brandsWith(brands, (_k, c) => c.wanted > 0);

  const active = filtering(filters);
  const needle = text.trim().toLowerCase();
  const shown = brands.filter(b => (!needle || b.name.toLowerCase().includes(needle))
    && (!active || Object.entries(b.cells).some(([key, cell]) => cellPasses(key, cell, filters))));
  const dim = (schemeKey: string, cell: BrandGridCell) => active && !cellPasses(schemeKey, cell, filters);
  const openedBrand = opened ? brands.find(b => b.key === opened.brandKey) || null : null;

  if (query.isLoading) return <p className="text-sm text-muted-foreground" data-testid="brand-plan-board-loading">Loading targets…</p>;
  if (query.isError) return <p role="status" className="text-sm text-muted-foreground">Targets could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>;
  if (!grid) return <p className="text-sm text-muted-foreground" data-testid="brand-plan-board-refused">Targets are not available for this account.</p>;

  const cellLabel = (brand: BrandGridBrand, schemeName: string, cell: BrandGridCell) => `${brand.name} at ${schemeName}: ${BRAND_STAGE_LABELS[cell.stage]}, ${plural(cell.count, "line")}`;

  return <div className="space-y-3" data-testid="brand-plan-board">
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <p className="text-sm text-muted-foreground" data-testid="brand-plan-board-summary">
        {shown.length === brands.length ? plural(brands.length, "brand") : `${shown.length} of ${plural(brands.length, "brand")}`} across {plural(schemes.length, "scheme")}
        {staff && <>. Landsec schemes only: a brand's lines with other landlords are on its page.</>}
      </p>
      <div className="relative w-full md:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={text} onChange={event => setText(event.target.value)} placeholder="Search brands…" aria-label="Search brands" className="h-9 pl-8" data-testid="brand-plan-search" />
      </div>
    </div>

    <div className="flex gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0" data-testid="brand-plan-stage-filters">
      <Pill active={!filters.stage} onClick={() => set({ stage: null })} data-testid="brand-plan-stage-all">All stages<PillCount n={brands.length} active={!filters.stage} /></Pill>
      {stageCounts.map(({ stage, count }) => <Pill key={stage} active={filters.stage === stage} title={BRAND_STAGE_MEANINGS[stage]} data-testid={`brand-plan-stage-${stage}`}
        onClick={() => set({ stage: filters.stage === stage ? null : stage })}>{BRAND_STAGE_LABELS[stage]}<PillCount n={count} active={filters.stage === stage} /></Pill>)}
    </div>
    <div className="flex gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0" data-testid="brand-plan-more-filters">
      {columns.length > 1 && <PillMenu label="Scheme" all="All schemes" value={filters.scheme} options={schemeOptions} onChange={scheme => set({ scheme })} testId="brand-plan-scheme-filter" />}
      {staff && ownerOptions.length > 0 && <PillMenu label="Owner" all="All owners" value={filters.owner} options={ownerOptions} onChange={owner => set({ owner })} testId="brand-plan-owner-filter" />}
      {staff && <Pill active={filters.noNextStep} aria-pressed={filters.noNextStep} onClick={() => set({ noNextStep: !filters.noNextStep })} title="A line between Wanted and Solicitors with no next step" data-testid="brand-plan-filter-no-next-step">
        No next step<PillCount n={noNextStepCount} active={filters.noNextStep} /></Pill>}
      <Pill active={filters.wanted} aria-pressed={filters.wanted} onClick={() => set({ wanted: !filters.wanted })} title="Wanted at a scheme, with no unit picked yet" data-testid="brand-plan-filter-wanted">
        Wanted, no unit<PillCount n={wantedCount} active={filters.wanted} /></Pill>
      {(active || needle) && <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { setFilters(NO_FILTERS); setText(""); }} data-testid="brand-plan-clear-filters">Clear</button>}
    </div>

    {brands.length === 0
      ? <p className="text-sm text-muted-foreground" data-testid="brand-plan-board-empty">{staff
        ? "No brand has a line at a Landsec scheme yet. Open a brand's page and add the schemes we want it in under Schemes and units."
        : "No brand has a line at your schemes yet."}</p>
      : shown.length === 0
        ? <p className="text-sm text-muted-foreground" data-testid="brand-plan-board-no-match">No brand matches these filters.</p>
        : isMobile
          ? <div className="space-y-2" data-testid="brand-plan-cards">
            {shown.map((brand, i) => <div key={brand.key} className="rounded-2xl border border-border bg-card p-3 space-y-2 shadow-sm" data-testid={`brand-plan-card-${i}`}>
              <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpened({ brandKey: brand.key, schemeKey: null })} data-testid={`brand-plan-card-open-${i}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{brand.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{underName(brand, staff)}</span>
                </span>
                {staff && brand.onHold && <span className={`${pillMetrics} ${pillInactive} shrink-0`}>On hold</span>}
              </button>
              {Object.keys(brand.cells).length > 0 && <div className="flex flex-wrap gap-1.5">
                {columns.filter(s => brand.cells[s.key]).map(s => {
                  const cell = brand.cells[s.key];
                  return <button key={s.key} type="button" data-no-min-touch aria-label={cellLabel(brand, s.name, cell)} data-testid={`brand-plan-chip-${i}-${s.key}`}
                    className={cn(stageChipClass(cell.stage), dim(s.key, cell) && "opacity-40")} onClick={() => setOpened({ brandKey: brand.key, schemeKey: s.key })}>
                    {s.name} · {BRAND_STAGE_LABELS[cell.stage]}{cell.count > 1 && <span className="font-mono tabular-nums">{cell.count}</span>}
                  </button>;
                })}
              </div>}
            </div>)}
          </div>
          : <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card">
            <table className="w-full border-separate border-spacing-0 text-sm" data-testid="brand-plan-grid">
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th scope="col" rowSpan={2} className="sticky left-0 z-30 min-w-[220px] border-b border-border bg-card px-3 py-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Brand</th>
                  {groups.map(g => <th key={g.group} scope="colgroup" colSpan={g.schemes.length} className="border-l border-border px-2 pt-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.group}</th>)}
                </tr>
                <tr>
                  {columns.map(s => <th key={s.key} scope="col" className={cn("min-w-[112px] border-b border-border px-2 py-1.5 text-left align-bottom text-xs font-semibold", groupStart.has(s.key) && "border-l")}>
                    <Link href={`/landsec/scheme/${s.key}`} className="hover:underline" data-testid={`brand-plan-scheme-${s.key}`}>{s.name}</Link>
                  </th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((brand, i) => <tr key={brand.key} className="group" data-testid={`brand-plan-row-${i}`}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-border bg-card px-3 py-2 text-left align-top font-normal">
                    <button type="button" className="max-w-[260px] text-left" onClick={() => setOpened({ brandKey: brand.key, schemeKey: null })} data-testid={`brand-plan-brand-${i}`}>
                      <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold group-hover:underline">{brand.name}</span>{staff && brand.onHold && <span className={`${pillMetrics} ${pillInactive}`}>On hold</span>}</span>
                      <span className="block text-xs text-muted-foreground">{underName(brand, staff)}</span>
                    </button>
                  </th>
                  {columns.map(s => {
                    const cell = brand.cells[s.key];
                    return <td key={s.key} className={cn("border-b border-border px-2 py-2 align-top", groupStart.has(s.key) && "border-l")}>
                      {cell && <button type="button" data-no-min-touch title={BRAND_STAGE_MEANINGS[cell.stage]} aria-label={cellLabel(brand, s.name, cell)} data-testid={`brand-plan-cell-${i}-${s.key}`}
                        className={cn("inline-flex items-center gap-1", dim(s.key, cell) && "opacity-40")} onClick={() => setOpened({ brandKey: brand.key, schemeKey: s.key })}>
                        <span className={stageChipClass(cell.stage)}>{BRAND_STAGE_LABELS[cell.stage]}</span>
                        {cell.count > 1 && <span className="font-mono tabular-nums text-xs text-muted-foreground" title={plural(cell.count, "line")}>{cell.count}</span>}
                      </button>}
                    </td>;
                  })}
                </tr>)}
              </tbody>
            </table>
          </div>}

    {grid.warnings.map(warning => <p key={warning} role="status" className="text-xs text-muted-foreground">{warning}</p>)}

    {openedBrand && <BrandLines brand={openedBrand} schemeKey={opened!.schemeKey} schemeName={columns.find(s => s.key === opened!.schemeKey)?.name || null}
      base={base} staff={staff} bottom={isMobile} onClose={() => setOpened(null)} />}
  </div>;
}

function Line({ row, staff, id, withScheme }: { row: PlanRow; staff: boolean; id: string; withScheme: boolean }) {
  const line = stageLine(row);
  return <div className="rounded-lg border border-border p-2.5 space-y-2" data-testid={`brand-plan-line-${id}`}>
    <div className="min-w-0">{withScheme && <SchemeName row={row} />}<UnitCell row={row} staff={staff} /></div>
    <div className="min-w-0 space-y-0.5">
      <StageChip row={row} />
      {line && <p className="text-xs text-muted-foreground break-words">{line}</p>}
      {row.notes.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
      {row.wish?.note && <p className="text-xs text-muted-foreground break-words">Note: {row.wish.note}</p>}
    </div>
    {showsRequirement(row) && <RequirementCell row={row} />}
    {row.nextStep && <div><p className="text-xs font-semibold text-muted-foreground">Next step</p><NextStepCell row={row} /></div>}
    {row.owner?.name && <p className="text-xs text-muted-foreground">Owner <span className="font-medium text-foreground">{row.owner.name}</span></p>}
    <RowLinks row={row} id={`board-${id}`} labelled />
  </div>;
}

// One brand's lines, the pressed scheme first. A right-hand sheet on
// desktop, a bottom sheet on a phone.
function BrandLines({ brand, schemeKey, schemeName, base, staff, bottom, onClose }: { brand: BrandGridBrand; schemeKey: string | null; schemeName: string | null; base: string; staff: boolean; bottom: boolean; onClose: () => void }) {
  const query = useQuery<BrandPlan | null>({
    queryKey: [base, brand.id],
    queryFn: () => read<BrandPlan>(`${base}/${encodeURIComponent(brand.id!)}`),
    enabled: !!brand.id, staleTime: 60_000, retry: false, refetchInterval: false,
  });
  const plan = brand.id ? query.data : null;
  const rows: PlanRow[] = brand.id ? [...(plan?.rows || []), ...(plan?.notProceeding || [])] : brand.rows || [];
  const here = schemeKey ? rows.filter(r => r.scheme.key === schemeKey) : rows;
  const elsewhere = schemeKey ? rows.filter(r => r.scheme.key !== schemeKey && r.stage !== "not_proceeding") : [];
  const loading = !!brand.id && query.isLoading;
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent side={bottom ? "bottom" : "right"} className={bottom ? "max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4" : "w-full overflow-y-auto p-5 sm:max-w-md"} data-testid="brand-plan-sheet">
      <SheetHeader className="space-y-1 pr-6 text-left">
        <SheetTitle>{brand.name}</SheetTitle>
        <SheetDescription>{schemeName ? `At ${schemeName}` : "Every scheme"}{plan?.brand.headline ? ` · ${plan.brand.headline}` : ""}</SheetDescription>
      </SheetHeader>
      <div className="mt-3 space-y-3">
        {brand.id && <Link href={`/companies/${brand.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" data-testid="brand-plan-sheet-brand-page">
          Open the brand page<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}
        {loading ? <p className="text-sm text-muted-foreground">Loading lines…</p>
          : brand.id && query.isError ? <p role="status" className="text-sm text-muted-foreground">The lines could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>
          : brand.id && !plan ? <p className="text-sm text-muted-foreground">This brand's lines are not available for this login.</p>
          : <>
            {here.length === 0
              ? <p className="text-sm text-muted-foreground" data-testid="brand-plan-sheet-empty">{schemeName ? `No line at ${schemeName}.` : "No scheme or unit is recorded for this brand yet."}</p>
              : <div className="space-y-2">{here.map((row, i) => <Line key={row.key} row={row} staff={staff} id={String(i)} withScheme={!schemeKey} />)}</div>}
            {elsewhere.length > 0 && <div className="space-y-2" data-testid="brand-plan-sheet-elsewhere">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Other schemes</h4>
              {elsewhere.map((row, i) => <div key={row.key} className="flex items-start justify-between gap-2 text-sm" data-testid={`brand-plan-elsewhere-${i}`}>
                <span className="min-w-0 break-words"><span className="font-medium">{row.scheme.name}</span>{row.unit ? ` · ${row.unit.label}` : ""}</span>
                <span className="shrink-0"><StageChip row={row} /></span>
              </div>)}
            </div>}
            {!!brand.otherSchemeCount && <p className="text-xs text-muted-foreground">Also at {plural(brand.otherSchemeCount, "other scheme")} outside your own.</p>}
          </>}
      </div>
    </SheetContent>
  </Sheet>;
}
