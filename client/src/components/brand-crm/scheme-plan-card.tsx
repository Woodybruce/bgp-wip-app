import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Briefcase, Building2, ClipboardList, MapPinned, Plus } from "lucide-react";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill, pillActive, pillInactive, pillMetrics } from "@/components/ui/pill";
import { CrmEntityPicker } from "@/components/crm-entity-picker";
import { BRAND_STAGE_MEANINGS, ON_HOLD_VALUE, REQ_CHIP_LABELS, brandStageRank, type BrandPlan, type BrandStage, type PlanRow } from "@shared/brand-stage";

// "Schemes and units" on a brand's page (docs/brand-crm-spec-2026-11-12.md,
// 2.3): one line per scheme and unit with the stage the records show, the
// requirement fit, the next step and who has it. BGP staff read
// /api/brand-crm/plan/:id (every landlord, with the lead, On hold and the
// Wanted lines to add or retire); a Landsec view reads
// /api/landsec/brand-crm/plan/:id, which the server has already cut to that
// login's schemes and to what a client may see. A login the server refuses
// gets no card.

const SELECT_CLASS = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const dash = <span className="text-muted-foreground">—</span>;

const day = (value: string | null | undefined, year = false) => {
  if (!value) return null;
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" as const } : {}), timeZone: "Europe/London" }) : null;
};
const londonToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const whole = (n: number) => Math.round(n).toLocaleString("en-GB");
const failure = (error: unknown, fallback: string) => (error instanceof Error ? error.message.replace(/^\d{3}:\s*/, "") : "") || fallback;
const refreshPlans = () => Promise.all([
  queryClient.invalidateQueries({ queryKey: ["/api/brand-crm/plan"] }),
  queryClient.invalidateQueries({ queryKey: ["/api/landsec/brand-crm/plan"] }),
]);

const ROW_LINKS = [
  { key: "tracker", label: "Letting Tracker row", Icon: ClipboardList },
  { key: "deal", label: "Deal", Icon: Briefcase },
  { key: "unitPage", label: "Landsec unit page", Icon: Building2 },
] as const;

const schemeId = (row: PlanRow) => row.scheme.key || row.scheme.propertyId || row.scheme.name;
const whereOf = (row: PlanRow) => `${row.scheme.name}${row.unit ? `, ${row.unit.label}` : ""}`;

// One look for a stage wherever it is drawn (this card, the Targets board).
export const stageChipClass = (stage: BrandStage) => `${pillMetrics} ${brandStageRank(stage) >= brandStageRank("negotiating") ? pillActive : pillInactive}`;

export function StageChip({ row }: { row: PlanRow }) {
  return <span className={stageChipClass(row.stage)} title={BRAND_STAGE_MEANINGS[row.stage]}>{row.stageLabel}</span>;
}

export function stageLine(row: PlanRow): string {
  const first = row.evidence[0];
  const days = row.daysAtStage == null ? null : row.daysAtStage === 0 ? "today" : `${whole(row.daysAtStage)} day${row.daysAtStage === 1 ? "" : "s"}`;
  return [
    row.stage === "not_proceeding" ? row.notProceedingReason : null,
    first ? `${first.label}${day(first.at, true) ? `, ${day(first.at, true)}` : ""}${first.byName ? " (matched by name)" : ""}` : null,
    days,
  ].filter(Boolean).join(" · ");
}

export function RequirementCell({ row }: { row: PlanRow }) {
  const { chip, unitSqft, range } = row.requirement;
  if (chip === "no_requirement") return dash;
  return <div className="min-w-0 space-y-0.5">
    <span className={`${pillMetrics} ${pillInactive} max-w-full`} title={REQ_CHIP_LABELS[chip]}><span className="truncate">{REQ_CHIP_LABELS[chip]}</span></span>
    {(chip === "place_fits_size_out" || chip === "size_out_no_places") && unitSqft != null && range && <p className="text-xs text-muted-foreground" data-testid="scheme-plan-size-detail"><span className="font-mono tabular-nums">{whole(unitSqft)}</span> sq ft, outside the <span className="font-mono tabular-nums">{whole(range.min)}</span> to <span className="font-mono tabular-nums">{whole(range.max)}</span> we allow around the size they asked for</p>}
  </div>;
}

export function NextStepCell({ row }: { row: PlanRow }) {
  const step = row.nextStep;
  if (!step) return dash;
  const overdue = !!step.dueAt && step.dueAt.slice(0, 10) < londonToday();
  const when = step.dueAt ? `${overdue ? "Overdue since" : "Due"} ${day(step.dueAt)}` : step.daysWaiting != null ? `Waiting ${whole(step.daysWaiting)} day${step.daysWaiting === 1 ? "" : "s"}` : null;
  return <div className="min-w-0">
    <p className="text-sm break-words">{step.title}</p>
    {(when || step.who) && <p className="text-xs text-muted-foreground">{when && <span className={overdue ? "text-destructive" : undefined}>{when}</span>}{when && step.who ? " · " : ""}{step.who}</p>}
  </div>;
}

export function UnitCell({ row, staff }: { row: PlanRow; staff: boolean }) {
  if (!row.unit) return <p className="text-sm text-muted-foreground">No unit yet</p>;
  const facts: ReactNode[] = [];
  if (row.unit.sqft) facts.push(<span key="sqft"><span className="font-mono tabular-nums">{whole(row.unit.sqft)}</span> sq ft</span>);
  if (row.unit.occupier && row.stage !== "trading") facts.push(<span key="occupier">Now {row.unit.occupier}</span>);
  if (day(row.unit.leaseExpiry, true)) facts.push(<span key="expiry">Lease to {day(row.unit.leaseExpiry, true)}</span>);
  return <div className="min-w-0">
    <p className="text-sm break-words">{row.unit.label}</p>
    {facts.length > 0 && <p className="text-xs text-muted-foreground flex flex-wrap gap-x-2">{facts}</p>}
    {staff && row.unit.splitKey && <p className="text-xs text-muted-foreground">Not linked to the tenancy schedule</p>}
  </div>;
}

export function SchemeName({ row }: { row: PlanRow }) {
  const href = row.links.scheme || row.links.property;
  return href ? <Link href={href} className="text-sm font-semibold hover:underline">{row.scheme.name}</Link> : <span className="text-sm font-semibold">{row.scheme.name}</span>;
}

export function RowLinks({ row, id, labelled }: { row: PlanRow; id: string; labelled?: boolean }) {
  const shown = ROW_LINKS.filter(link => !!row.links[link.key]);
  if (!shown.length) return labelled ? null : dash;
  return <div className={`flex flex-wrap items-center ${labelled ? "gap-x-4" : "gap-1"}`}>
    {shown.map(({ key, label, Icon }) => <Link key={key} href={row.links[key]!} title={label} aria-label={`${label} for ${whereOf(row)}`} data-testid={`scheme-plan-open-${key}-${id}`}
      className={labelled ? "inline-flex min-h-11 items-center gap-1.5 text-xs font-medium underline underline-offset-2" : "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{labelled && label}
    </Link>)}
  </div>;
}

export function SchemePlanCard({ companyId, client = false }: { companyId: string; client?: boolean }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState<{ schemeKey?: string } | null>(null);
  const [retiring, setRetiring] = useState<{ id: string; where: string; shown: boolean } | null>(null);
  const [noting, setNoting] = useState<{ id: string; where: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAdding(null); setRetiring(null); setNoting(null); }, [companyId]);
  const base = client ? "/api/landsec/brand-crm/plan" : "/api/brand-crm/plan";
  const query = useQuery<BrandPlan | null>({
    queryKey: [base, companyId],
    queryFn: async () => {
      const res = await fetch(`${base}/${encodeURIComponent(companyId)}`, { credentials: "include", headers: getAuthHeaders() });
      // Not this login's to see (another client, a brand outside its list): no card.
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    staleTime: 60_000, retry: false, refetchInterval: false,
  });
  const plan = query.data;
  if (query.isSuccess && !plan) return null;

  async function change(run: () => Promise<unknown>, done: string, fallback: string) {
    setBusy(true);
    try { await run(); await refreshPlans(); toast({ title: done }); }
    catch (error) { toast({ title: failure(error, fallback), variant: "destructive" }); }
    finally { setBusy(false); }
  }
  const patchWish = (id: string, body: Record<string, unknown>, done: string) =>
    change(() => apiRequest("PATCH", `/api/brand-crm/targets/${encodeURIComponent(id)}`, body), done, "The Wanted line could not be changed.");

  const staff = !!plan?.canEdit;
  const onHold = !!plan?.brand.onHold;
  const restricted = plan?.otherSchemeCount !== undefined;
  const rows = plan?.rows || [];
  const stopped = plan?.notProceeding || [];
  const brandCase = [...rows, ...stopped].find(row => row.links.brandCase)?.links.brandCase || null;
  const firstOfScheme = (i: number) => i === 0 || schemeId(rows[i]) !== schemeId(rows[i - 1]);

  // A Wanted line BGP wrote: its note, whether Landsec is shown it, and retiring it.
  const wishControls = (row: PlanRow, id: string) => {
    const wish = row.wish;
    if (!staff || !wish) return null;
    return <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid={`scheme-plan-wish-${id}`}>
      {wish.note && <span className="w-full break-words">Note: {wish.note}</span>}
      {wish.ruledOut
        ? <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={busy} data-testid={`scheme-plan-wish-restore-${id}`}
            onClick={() => patchWish(wish.id, { ruledOut: null }, "Wanted line brought back")}>Bring back the Wanted line</button>
        : <>
          {row.scheme.key && <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" className="accent-primary" checked={wish.visibleToClient} disabled={busy} data-testid={`scheme-plan-wish-visible-${id}`}
              onChange={event => { const show = event.target.checked; patchWish(wish.id, { visibleToClient: show }, show ? "Wanted line shown to Landsec" : "Wanted line hidden from Landsec"); }} />
            Show to Landsec
          </label>}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={busy} data-testid={`scheme-plan-wish-note-${id}`}
            onClick={() => setNoting({ id: wish.id, where: whereOf(row), note: wish.note || "" })}>{wish.note ? "Edit note" : "Add note"}</button>
          <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={busy} data-testid={`scheme-plan-wish-retire-${id}`}
            onClick={() => setRetiring({ id: wish.id, where: whereOf(row), shown: wish.visibleToClient })}>Retire the Wanted line</button>
        </>}
    </div>;
  };
  const stageCell = (row: PlanRow, id: string) => <div className="min-w-0 space-y-0.5">
    <StageChip row={row} />
    {stageLine(row) && <p className="text-xs text-muted-foreground break-words" title={row.evidence.map(e => e.label).join("\n")}>{stageLine(row)}</p>}
    {row.notes.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
    {wishControls(row, id)}
  </div>;

  return <section style={{ containerType: "inline-size" }} className="rounded-xl border border-card-border bg-card shadow-sm p-3 space-y-3" data-testid="scheme-plan-card">
    <div className="flex items-start justify-between flex-wrap gap-2">
      <div className="min-w-0 space-y-0.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><MapPinned className="h-4 w-4 text-primary" />Schemes and units</h3>
        {plan && <p className="text-sm text-muted-foreground" data-testid="scheme-plan-headline">{plan.brand.headline}</p>}
      </div>
      {plan && staff && <div className="flex items-center flex-wrap gap-2">
        <Pill active={onHold} aria-pressed={onHold} disabled={busy} data-testid="scheme-plan-on-hold" title={onHold ? "This brand is on hold. Press to take it off hold." : "Mark this brand as on hold"}
          onClick={() => change(async () => {
            await apiRequest("PATCH", `/api/brand/${encodeURIComponent(companyId)}`, { concept_status: onHold ? null : ON_HOLD_VALUE });
            await queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
          }, onHold ? "Taken off hold" : "Marked on hold", "On hold could not be changed.")}>{onHold ? "On hold" : "Put on hold"}</Pill>
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding({})} data-testid="scheme-plan-add"><Plus className="h-3.5 w-3.5 mr-1" />Scheme</Button>
      </div>}
    </div>

    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading schemes and units…</p>
      : query.isError || !plan ? <p role="status" className="text-sm text-muted-foreground">Schemes and units could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>
      : <>
        {staff && <div className="space-y-1 text-xs text-muted-foreground" data-testid="scheme-plan-staff-line">
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Lead <span className="font-medium text-foreground">{plan.brand.lead?.name || "not set"}</span></span>
            <span>Next step {plan.brand.nextAction
              ? <><span className="font-medium text-foreground">{plan.brand.nextAction.title}</span>{plan.brand.nextAction.ownerName ? ` · ${plan.brand.nextAction.ownerName}` : ""}{day(plan.brand.nextAction.dueAt) ? ` · Due ${day(plan.brand.nextAction.dueAt)}` : ""}</>
              : <span className="font-medium text-foreground">none set</span>}</span>
          </p>
          {plan.brand.aim && <p className="line-clamp-2">Aim: {plan.brand.aim}</p>}
        </div>}

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="scheme-plan-requirement">
          {plan.requirements.length > 0 ? <>
            <span className="text-xs font-semibold text-muted-foreground">Requirement</span>
            {plan.requirements.slice(0, 2).map(req => <span key={req.id} className="min-w-0 break-words">{req.summary}
              {(req.ageDays != null || req.source) && <span className="text-xs text-muted-foreground"> · {[req.source, req.ageDays == null ? null : req.ageDays === 0 ? "updated today" : `updated ${whole(req.ageDays)} day${req.ageDays === 1 ? "" : "s"} ago`].filter(Boolean).join(" · ")}</span>}
            </span>)}
            {plan.requirements.length > 2 && <span className="text-xs text-muted-foreground">and {plan.requirements.length - 2} more</span>}
            {!restricted && <Link href={`/requirements?companyId=${encodeURIComponent(companyId)}`} className="text-xs text-primary hover:underline" data-testid="scheme-plan-requirements-link">Open requirements</Link>}
          </> : <>
            <span className="text-muted-foreground">No requirement held</span>
            {staff && <Link href={`/requirements?companyId=${encodeURIComponent(companyId)}&new=1`} className="text-xs text-primary hover:underline" data-testid="scheme-plan-add-requirement">Add requirement</Link>}
          </>}
        </div>

        {rows.length === 0
          ? <p className="text-sm text-muted-foreground" data-testid="scheme-plan-empty">{staff ? "No scheme or unit is recorded for this brand yet. Add the schemes we want it in with + Scheme." : "No scheme or unit is recorded for this brand yet."}</p>
          : <>
            {/* A table when the card is wide enough, a card list below that (phones, side panels). */}
            <div className="hidden [@container(min-width:720px)]:block overflow-x-auto">
              <table className="w-full text-sm" data-testid="scheme-plan-table">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    {["Scheme", "Unit", "Stage", "Requirement", "Next step", "Owner"].map(heading => <th key={heading} scope="col" className="py-1.5 pr-3 font-semibold">{heading}</th>)}
                    <th scope="col" className="py-1.5 font-semibold"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => <tr key={row.key} className={`align-top ${firstOfScheme(i) && i > 0 ? "border-t border-border" : ""}`} data-testid={`scheme-plan-row-${i}`}>
                    <td className="py-2 pr-3">{firstOfScheme(i) && <SchemeName row={row} />}</td>
                    <td className="py-2 pr-3"><UnitCell row={row} staff={staff} /></td>
                    <td className="py-2 pr-3">{stageCell(row, String(i))}</td>
                    <td className="py-2 pr-3 max-w-[220px]"><RequirementCell row={row} /></td>
                    <td className="py-2 pr-3"><NextStepCell row={row} /></td>
                    <td className="py-2 pr-3 text-sm">{row.owner?.name || dash}</td>
                    <td className="py-2"><RowLinks row={row} id={String(i)} /></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 [@container(min-width:720px)]:hidden" data-testid="scheme-plan-list">
              {rows.map((row, i) => <div key={row.key} className="rounded-lg border border-border p-2.5 space-y-2" data-testid={`scheme-plan-item-${i}`}>
                <div className="min-w-0"><SchemeName row={row} /><UnitCell row={row} staff={staff} /></div>
                {stageCell(row, `m${i}`)}
                {row.requirement.chip !== "no_requirement" && <RequirementCell row={row} />}
                {row.nextStep && <div><p className="text-xs font-semibold text-muted-foreground">Next step</p><NextStepCell row={row} /></div>}
                {row.owner?.name && <p className="text-xs text-muted-foreground">Owner <span className="font-medium text-foreground">{row.owner.name}</span></p>}
                <RowLinks row={row} id={`m${i}`} labelled />
              </div>)}
            </div>
          </>}

        {plan.askedNoTarget.length > 0 && <div className="space-y-1" data-testid="scheme-plan-asked">
          <h4 className="text-xs font-semibold text-muted-foreground">Asked for, no target yet</h4>
          {plan.askedNoTarget.map(asked => <p key={asked.place} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className="font-medium">{asked.place}</span>
            {asked.schemes.map(scheme => staff && !scheme.noProperty
              ? <button key={scheme.key} type="button" className="text-xs text-primary hover:underline" onClick={() => setAdding({ schemeKey: scheme.key })} data-testid={`scheme-plan-asked-add-${scheme.key}`}>{scheme.name}</button>
              : <span key={scheme.key} className="text-xs text-muted-foreground">{scheme.name}{scheme.noProperty ? " (no property record yet)" : ""}</span>)}
          </p>)}
          {staff && plan.askedNoTarget.some(asked => asked.schemes.some(scheme => !scheme.noProperty)) && <p className="text-xs text-muted-foreground">Press a scheme to add it as a Wanted line.</p>}
        </div>}

        {stopped.length > 0 && <details data-testid="scheme-plan-not-proceeding">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Not proceeding ({stopped.length})</summary>
          <div className="mt-2 space-y-2">
            {stopped.map((row, i) => <div key={row.key} className="text-sm" data-testid={`scheme-plan-stopped-${i}`}>
              <p className="break-words"><span className="font-medium">{row.scheme.name}</span>{row.unit ? ` · ${row.unit.label}` : ""}</p>
              {stageLine(row) && <p className="text-xs text-muted-foreground break-words">{stageLine(row)}</p>}
              {wishControls(row, `s${i}`)}
            </div>)}
          </div>
        </details>}

        {restricted && (plan.otherSchemeCount || 0) > 0 && <p className="text-xs text-muted-foreground" data-testid="scheme-plan-other-schemes">
          Also at {plan.otherSchemeCount} other scheme{plan.otherSchemeCount === 1 ? "" : "s"}.
          {brandCase && <> <Link href={brandCase} className="text-primary hover:underline">See the brand case</Link></>}
        </p>}

        {plan.warnings.map(warning => <p key={warning} role="status" className="text-xs text-muted-foreground">{warning}</p>)}
      </>}

    {noting && <NoteForm where={noting.where} note={noting.note} onClose={() => setNoting(null)}
      onSave={async note => { await apiRequest("PATCH", `/api/brand-crm/targets/${encodeURIComponent(noting.id)}`, { note: note || null }); await refreshPlans(); toast({ title: "Note saved" }); }} />}
    {adding && plan && <WishForm companyId={companyId} brandName={plan.brand.name} schemeKey={adding.schemeKey} requirements={plan.requirements.filter(req => !req.detailHidden)} onClose={() => setAdding(null)}
      onSaved={async () => { await refreshPlans(); toast({ title: "Wanted line added" }); }} />}
    {retiring && <RetireForm where={retiring.where} shown={retiring.shown} onClose={() => setRetiring(null)}
      onSave={async reason => { await apiRequest("PATCH", `/api/brand-crm/targets/${encodeURIComponent(retiring.id)}`, { ruledOut: { reason } }); await refreshPlans(); toast({ title: "Wanted line retired" }); }} />}
  </section>;
}

type HomeSchemes = { groups: Array<{ group: string; schemes: Array<{ key: string; name: string; propertyId: string | null }> }> };
type SchemeUnits = { units?: Array<{ id: string; unit: string | null; tenant: string | null; status: string | null }> };

// "+ Scheme": we want this brand at a scheme, with or without a unit. It
// writes a Wanted line, never a deal.
function WishForm({ companyId, brandName, schemeKey: initialScheme, requirements, onClose, onSaved }: { companyId: string; brandName: string; schemeKey?: string; requirements: BrandPlan["requirements"]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [schemeKey, setSchemeKey] = useState(initialScheme || "");
  const [unit, setUnit] = useState<{ id: string; name: string } | null>(null);
  const [unitLabel, setUnitLabel] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [note, setNote] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const home = useQuery<HomeSchemes>({ queryKey: ["/api/landsec/home"], staleTime: 60_000 });
  const units = useQuery<SchemeUnits>({
    queryKey: ["/api/landsec/scheme", schemeKey],
    queryFn: async () => (await apiRequest("GET", `/api/landsec/scheme/${encodeURIComponent(schemeKey)}`)).json(),
    enabled: !!schemeKey, staleTime: 5 * 60_000, refetchInterval: false, retry: false,
  });
  const unitOptions = (units.data?.units || []).map(u => ({ id: u.id, name: u.unit || "Unit", meta: u.tenant || u.status }));
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[90dvh] flex flex-col overflow-hidden p-4 sm:p-6" aria-describedby="scheme-plan-wish-description">
      <DialogHeader><DialogTitle>Add a scheme for {brandName}</DialogTitle><DialogDescription id="scheme-plan-wish-description">Records that we want this brand at the scheme, with a unit if one is picked. It is a Wanted line, not a deal.</DialogDescription></DialogHeader>
      <form className="min-h-0 flex flex-col gap-4" data-testid="scheme-plan-wish-form" onSubmit={async event => {
        event.preventDefault(); setError("");
        if (!schemeKey) { setError("Choose a scheme."); return; }
        setSaving(true);
        try {
          await apiRequest("POST", "/api/brand-crm/targets", { companyId, schemeKey, ...(unit ? { tenancyUnitId: unit.id } : unitLabel.trim() ? { unitLabel: unitLabel.trim() } : {}), ...(requirementId ? { requirementId } : {}), ...(note.trim() ? { note: note.trim() } : {}), visibleToClient: visible });
          await onSaved(); onClose();
        } catch (err) { setError(failure(err, "The Wanted line could not be saved.")); }
        finally { setSaving(false); }
      }}>
        <div className="overflow-y-auto min-h-0 space-y-4 pr-1">
          <label className="block space-y-1.5 text-sm"><span className="font-medium">Scheme</span>
            <select className={SELECT_CLASS} value={schemeKey} required disabled={home.isLoading} data-testid="scheme-plan-wish-scheme" onChange={event => { setSchemeKey(event.target.value); setUnit(null); }}>
              <option value="">{home.isLoading ? "Loading schemes…" : home.isError ? "Schemes could not be loaded" : "Choose a scheme"}</option>
              {(home.data?.groups || []).map(group => <optgroup key={group.group} label={group.group}>
                {group.schemes.map(scheme => <option key={scheme.key} value={scheme.key} disabled={!scheme.propertyId}>{scheme.name}{scheme.propertyId ? "" : " (no property record yet)"}</option>)}
              </optgroup>)}
            </select>
          </label>
          <div className="space-y-1.5"><p className="text-sm font-medium">Unit (optional)</p>
            <CrmEntityPicker kind="property" value={unit?.id || null} valueName={unit?.name} options={unitOptions} disabled={!schemeKey}
              emptyLabel={!schemeKey ? "Choose a scheme first" : units.isLoading ? "Loading units…" : units.isError ? "Units could not be loaded" : "No unit yet"} searchPlaceholder="Search units…"
              className="border rounded-md px-3 py-2 min-h-9" testIdPrefix="scheme-plan-wish-unit" onSelect={picked => setUnit({ id: picked.id, name: picked.name })} onClear={() => setUnit(null)} />
            {!unit && <Input maxLength={200} value={unitLabel} onChange={event => setUnitLabel(event.target.value)} disabled={!schemeKey} aria-label="A unit that is not on the schedule"
              placeholder="Or name a unit that is not on the schedule" data-testid="scheme-plan-wish-unit-label" />}
          </div>
          {requirements.length > 0 && <label className="block space-y-1.5 text-sm"><span className="font-medium">Answers their requirement (optional)</span>
            <select className={SELECT_CLASS} value={requirementId} data-testid="scheme-plan-wish-requirement" onChange={event => setRequirementId(event.target.value)}>
              <option value="">Not linked to a requirement</option>
              {requirements.map(req => <option key={req.id} value={req.id}>{req.summary}</option>)}
            </select>
          </label>}
          <label className="block space-y-1.5 text-sm"><span className="font-medium">Note (BGP only)</span>
            <Textarea rows={3} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="Why this scheme, and anything the team should know" data-testid="scheme-plan-wish-note" />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-primary" checked={visible} onChange={event => setVisible(event.target.checked)} data-testid="scheme-plan-wish-visible" />
            <span>Show to Landsec<span className="block text-xs text-muted-foreground">Landsec, and the joint agent on that scheme, see the brand, the scheme, the unit and the stage. Nobody outside BGP sees the note. Left unticked, only BGP sees this line.</span></span>
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <DialogFooter className="gap-2 border-t pt-3"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving} data-testid="scheme-plan-wish-save">{saving ? "Saving…" : "Add scheme"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

// BGP's note on a Wanted line. Nobody outside BGP is sent it.
function NoteForm({ where, note: initial, onClose, onSave }: { where: string; note: string; onClose: () => void; onSave: (note: string) => Promise<unknown> }) {
  const [note, setNote] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-w-md p-4 sm:p-6" aria-describedby="scheme-plan-note-description">
      <DialogHeader><DialogTitle>Note on the Wanted line</DialogTitle><DialogDescription id="scheme-plan-note-description">{where}. Only BGP sees this note.</DialogDescription></DialogHeader>
      <form className="space-y-4" data-testid="scheme-plan-note-form" onSubmit={async event => {
        event.preventDefault(); setError(""); setSaving(true);
        try { await onSave(note.trim()); onClose(); }
        catch (err) { setError(failure(err, "The note could not be saved.")); }
        finally { setSaving(false); }
      }}>
        <Textarea rows={4} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} aria-label="Note (BGP only)" data-testid="scheme-plan-note-text" />
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <DialogFooter className="gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving} data-testid="scheme-plan-note-save">{saving ? "Saving…" : "Save note"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

// Retiring keeps the line, with its reason, under Not proceeding.
function RetireForm({ where, shown, onClose, onSave }: { where: string; shown: boolean; onClose: () => void; onSave: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-w-md p-4 sm:p-6" aria-describedby="scheme-plan-retire-description">
      <DialogHeader><DialogTitle>Retire the Wanted line</DialogTitle><DialogDescription id="scheme-plan-retire-description">{where}. The line moves to Not proceeding with its reason and can be brought back.</DialogDescription></DialogHeader>
      <form className="space-y-4" data-testid="scheme-plan-retire-form" onSubmit={async event => {
        event.preventDefault(); setError(""); setSaving(true);
        try { await onSave(reason.trim()); onClose(); }
        catch (err) { setError(failure(err, "The Wanted line could not be retired.")); }
        finally { setSaving(false); }
      }}>
        <label className="block space-y-1.5 text-sm"><span className="font-medium">Reason</span>
          <Input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="For example, the brand has ruled the town out" data-testid="scheme-plan-retire-reason" />
          {shown && <span className="block text-xs text-muted-foreground">This line is shown to Landsec, so Landsec will read the reason. The joint agent on the scheme is told only that BGP ruled it out.</span>}
        </label>
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <DialogFooter className="gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving} data-testid="scheme-plan-retire-save">{saving ? "Saving…" : "Retire"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
