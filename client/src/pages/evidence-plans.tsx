// Scheme evidence plans (Pete Wood / Brent Cross, 2026-09-02) — the
// interactive replacement for the annotated-PowerPoint evidence plan.
// List page + full-screen plan viewer/editor:
//   • background scheme plan (PDF/image) with zoom + pan
//   • unit outlines drawn once (click corners, double-click to close);
//     labels sit at each unit's centroid — inside the unit, not scattered
//   • per-unit facts editable in place; tenancy-schedule import fills
//     expiry / break / review / ERV / passing for matched units only
//   • TAF PDFs (single or tranche scans) AI-extract into evidence entries
//   • swap the background plan any time — outlines and data stay put
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Map as MapIcon, Plus, Upload, ZoomIn, ZoomOut, Pencil, Trash2, FileSpreadsheet, FileText, X, Loader2 } from "lucide-react";

type Pt = { x: number; y: number };
type PlanLevel = {
  id: string; name: string; background_key: string | null;
  background_width: number | null; background_height: number | null;
};
type PlanUnit = {
  id: string; unit_ref: string; unit_norm?: string; ts_linked?: boolean;
  tenant_name: string | null; level_id: string | null; polygon: Pt[] | null;
  lease_expiry: string | null; break_date: string | null; review_date: string | null;
  erv: string | null; passing_rent: string | null; sqft: string | null; notes: string | null;
};
type Matter = { id: string; matter_type: string; status: string; acting_for: string | null; unit_name: string | null; unit_norm: string | null };
type Entry = {
  id: string; unit_id: string | null; unit_ref: string | null; tenant: string | null;
  transaction_type: string | null; transaction_date: string | null; size_sqft: string | null;
  zone_a: string | null; itza: string | null; headline_rent: string | null; net_effective: string | null;
  term: string | null; concession: string | null; notes: string | null; source_key: string | null;
};

const fmtMoney = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : "—";
};
const fmtDate = (v: any) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" as const }) });
};
const centroid = (poly: Pt[]): Pt => {
  const n = poly.length || 1;
  return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
};
// Mirrors normaliseUnitRef in server/evidence-plan.ts — used to resolve a
// ?unit= deep link against the plan's units.
const normRef = (raw: string) => String(raw || "")
  .toUpperCase()
  .replace(/\b(UNIT|STORE|SHOP)\b/g, " ")
  .replace(/[^A-Z0-9/&-]+/g, " ")
  .trim()
  .split(/\s+/)
  .map(tok => tok.replace(/([A-Z]+)0+(\d)/g, "$1$2"))
  .join(" ")
  .trim();

const MATTER_TYPE_LABELS: Record<string, string> = {
  rent_review: "Rent review", lease_renewal: "Lease renewal", dilapidations: "Dilapidations",
  service_charge: "Service charge", regear: "Regear", general: "General",
};

// ── List page ─────────────────────────────────────────────────────────────
function PlanList() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: plans = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/evidence-plans"] });
  const { data: properties = [] } = useQuery<any[]>({ queryKey: ["/api/crm/properties"] });

  const create = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("name", name.trim());
      if (propertyId) fd.append("propertyId", propertyId);
      const f = fileRef.current?.files?.[0];
      if (f) fd.append("background", f);
      const r = await fetch("/api/evidence-plans", { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Create failed");
      return j;
    },
    onSuccess: (plan: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/evidence-plans"] });
      setCreating(false);
      navigate(`/evidence-plans/${plan.id}`);
    },
    onError: (e: any) => toast({ title: "Couldn't create plan", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Evidence Plans</h1>
          <p className="text-sm text-muted-foreground">{plans.length ? `${plans.length} scheme${plans.length === 1 ? "" : "s"}` : "Interactive scheme plans with rental evidence"}</p>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="button-new-plan"><Plus className="w-4 h-4 mr-1.5" /> New plan</Button>
      </div>

      {/* Part of the Lease Advisory toolset */}
      <div className="flex items-center gap-1.5">
        <Pill onClick={() => navigate("/pla/matters")} data-testid="pill-la-jobs">Jobs</Pill>
        <Pill active data-testid="pill-la-evidence-plans">Evidence plans</Pill>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : plans.length === 0 ? (
        <Card><CardContent className="p-10 text-center">
          <MapIcon className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium">No evidence plans yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Upload a scheme plan, outline the units once, and the evidence lives on the plan from then on.</p>
          <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1.5" /> New plan</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {plans.map((p: any) => (
            <Link key={p.id} href={`/evidence-plans/${p.id}`} className="block rounded-2xl bg-card border border-border p-4 hover:border-primary/40 transition-colors" data-testid={`plan-card-${p.id}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-sm truncate">{p.name}</span>
                <span className="text-[11px] text-muted-foreground shrink-0">Updated {fmtDate(p.updated_at)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {p.unit_count} unit{p.unit_count === 1 ? "" : "s"} · {p.evidence_count} evidence entr{p.evidence_count === 1 ? "y" : "ies"}{p.property_name ? ` · ${p.property_name}` : ""}{!p.background_key ? " · no plan image yet" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New evidence plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scheme name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Brent Cross" className="mt-1" data-testid="input-plan-name" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scheme plan (PDF or image)</label>
              <Input ref={fileRef} type="file" accept=".pdf,image/*" className="mt-1" data-testid="input-plan-background" />
              <p className="text-[11px] text-muted-foreground mt-1">The plan straight from the landlord's agents — each page of a PDF becomes a level of the scheme. You can replace it any time without losing the unit outlines.</p>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">CRM property (optional)</label>
              <select
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-plan-property"
              >
                <option value="">Not linked</option>
                {[...properties].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Linked plans read lease expiry / break / review / ERV / passing straight from that property's tenancy schedule — one source of truth.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} data-testid="button-create-plan">
              {create.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />} Create plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Plan viewer / editor ──────────────────────────────────────────────────
function PlanView({ planId }: { planId: string }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<{ plan: any; levels: PlanLevel[]; units: PlanUnit[]; entries: Entry[]; matters: Matter[] }>({
    queryKey: ["/api/evidence-plans", planId],
    queryFn: async () => {
      const r = await fetch(`/api/evidence-plans/${planId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  // Viewport: zoom + pan via CSS transform on the plan surface.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const dragging = useRef<null | { start: Pt; panStart: Pt; moved: boolean }>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const tsInputRef = useRef<HTMLInputElement>(null);
  const tafInputRef = useRef<HTMLInputElement>(null);
  const tafFolderRef = useRef<HTMLInputElement>(null);

  const plan = data?.plan;
  const levels = data?.levels || [];
  const units = data?.units || [];
  const entries = data?.entries || [];
  const matters = data?.matters || [];
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [linkingProperty, setLinkingProperty] = useState(false);
  const activeLevel = levels.find(l => l.id === activeLevelId) || levels[0] || null;
  // A unit belongs to its level; pre-levels units (level_id null) sit on the first.
  const levelUnits = useMemo(
    () => units.filter(u => (u.level_id ?? levels[0]?.id) === activeLevel?.id),
    [units, levels, activeLevel]);

  // ?unit=A15 deep link (from a lease advisory job) — select the unit and
  // jump to its level once the plan loads.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || units.length === 0) return;
    const want = new URLSearchParams(window.location.search).get("unit");
    if (!want) { deepLinked.current = true; return; }
    const unit = units.find(u => (u.unit_norm || normRef(u.unit_ref)) === normRef(want));
    if (unit) {
      setSelectedId(unit.id);
      if (unit.level_id) setActiveLevelId(unit.level_id);
    }
    deepLinked.current = true;
  }, [units]);
  const selected = units.find(u => u.id === selectedId) || null;
  const selectedEntries = useMemo(
    () => entries.filter(e => (selected ? e.unit_id === selected.id : false)),
    [entries, selected]);
  const unlinkedCount = entries.filter(e => !e.unit_id).length;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/evidence-plans", planId] });

  // Latest Zone A per unit — drives the label's second line on the plan.
  const latestZaByUnit = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      if (!e.unit_id || e.zone_a == null) continue;
      if (!m.has(e.unit_id)) m.set(e.unit_id, Number(e.zone_a)); // entries arrive newest-first
    }
    return m;
  }, [entries]);

  const toPlanCoords = (clientX: number, clientY: number): Pt | null => {
    const el = surfaceRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const addUnit = useMutation({
    mutationFn: async (polygon: Pt[]) => {
      const unitRef = window.prompt("Unit reference (e.g. A15, N10, E7A):")?.trim();
      if (!unitRef) throw new Error("cancelled");
      const r = await apiRequest("POST", `/api/evidence-plans/${planId}/units`, { unitRef, polygon, levelId: activeLevel?.id || null });
      return r.json();
    },
    onSuccess: (u: any) => { invalidate(); setSelectedId(u.id); },
    onError: (e: any) => { if (e.message !== "cancelled") toast({ title: "Couldn't add unit", description: e.message, variant: "destructive" }); },
  });

  const saveUnit = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const r = await apiRequest("PUT", `/api/evidence-plans/units/${id}`, patch);
      return r.json();
    },
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const uploadFile = async (kind: "background" | "import-tenancy" | "ingest-taf", file: File | File[]) => {
    const files = Array.isArray(file) ? file : [file];
    if (kind === "ingest-taf" && files.every(f => !/\.(pdf|zip)$/i.test(f.name))) {
      toast({ title: "No TAFs found", description: "Pick PDFs, a zip, or a folder containing PDFs.", variant: "destructive" });
      return;
    }
    setBusy(kind);
    try {
      const fd = new FormData();
      for (const f of files) fd.append(kind === "background" ? "background" : "file", f);
      // A single-image replace targets the level being viewed; a multi-page
      // PDF refreshes every level server-side.
      if (kind === "background" && activeLevel) fd.append("levelId", activeLevel.id);
      const r = await fetch(`/api/evidence-plans/${planId}/${kind}`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      invalidate();
      if (kind === "import-tenancy") {
        toast({ title: "Tenancy schedule imported", description: `${j.matched} unit${j.matched === 1 ? "" : "s"} matched${j.unmatched?.length ? ` · ${j.unmatched.length} TS rows had no unit on the plan` : ""}` });
      } else if (kind === "ingest-taf") {
        toast({ title: "TAFs extracted", description: `${j.extracted} analysis sheet${j.extracted === 1 ? "" : "s"} found across ${j.pages} pages — ${j.linked} linked to plan units` });
      } else {
        toast({ title: "Plan image updated", description: (j.levels?.length || 0) > 1 ? `${j.levels.length} levels — outlines and data kept.` : "Outlines and data kept." });
      }
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  if (isLoading) return <div className="p-6"><Skeleton className="h-[70vh] rounded-2xl" /></div>;
  if (!plan) return <div className="p-6 text-sm text-muted-foreground">Plan not found.</div>;

  const hasBg = !!activeLevel?.background_key;
  const aspect = hasBg && activeLevel?.background_width ? (activeLevel.background_height || 0) / activeLevel.background_width : 0.7;

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--mobile-top,0px))] md:h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap bg-background">
        <button onClick={() => navigate("/evidence-plans")} className="text-sm text-muted-foreground hover:text-foreground">←</button>
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight truncate">{plan.name}</h1>
          <p className="text-[11px] text-muted-foreground">
            {units.length} units · {entries.length} evidence entries{unlinkedCount ? ` · ${unlinkedCount} unlinked` : ""} ·{" "}
            <button className="underline underline-offset-2 hover:text-foreground" onClick={() => setLinkingProperty(true)} data-testid="button-link-property">
              {plan.property_name || "link to a property"}
            </button>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <Pill active={drawing} onClick={() => { setDrawing(d => !d); setDraft([]); }} data-testid="pill-draw-unit">
            <Pencil className="w-3 h-3 mr-1 inline" />{drawing ? "Drawing… (double-click to close)" : "Draw unit"}
          </Pill>
          {plan.property_id ? (
            <Button variant="outline" size="sm" onClick={() => navigate(`/tenancy-schedule/${plan.property_id}`)} data-testid="button-open-ts">
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Tenancy schedule
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => tsInputRef.current?.click()} disabled={busy !== null} data-testid="button-import-ts">
              {busy === "import-tenancy" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />} Import tenancy schedule
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy !== null} data-testid="button-ingest-taf">
                {busy === "ingest-taf" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1" />} Add TAFs
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => tafInputRef.current?.click()}>PDFs or a zip…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => tafFolderRef.current?.click()}>A whole folder…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => bgInputRef.current?.click()} disabled={busy !== null} data-testid="button-replace-bg">
            {busy === "background" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />} {hasBg ? "Replace plan" : "Upload plan"}
          </Button>
        </div>
        <input ref={bgInputRef} type="file" accept=".pdf,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile("background", f); e.target.value = ""; }} />
        <input ref={tsInputRef} type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile("import-tenancy", f); e.target.value = ""; }} />
        <input ref={tafInputRef} type="file" accept=".pdf,.zip" multiple hidden onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) uploadFile("ingest-taf", fs); e.target.value = ""; }} />
        <input ref={tafFolderRef} type="file" hidden multiple {...({ webkitdirectory: "" } as any)} onChange={e => { const fs = Array.from(e.target.files || []).filter(f => /\.(pdf|zip)$/i.test(f.name)); if (fs.length) uploadFile("ingest-taf", fs); else toast({ title: "No TAFs found", description: "That folder has no PDFs or zips in it.", variant: "destructive" }); e.target.value = ""; }} />
      </div>

      <LinkPropertyDialog open={linkingProperty} onOpenChange={setLinkingProperty} plan={plan} onSaved={invalidate} />

      {/* Level switcher — a scheme plan PDF becomes one level per page */}
      {levels.length > 1 && (
        <div className="px-4 py-1.5 border-b border-border flex items-center gap-1.5 overflow-x-auto bg-background">
          {levels.map(l => (
            <Pill key={l.id} active={l.id === activeLevel?.id}
              onClick={() => { setActiveLevelId(l.id); setSelectedId(null); setDrawing(false); setDraft([]); setZoom(1); setPan({ x: 0, y: 0 }); }}
              data-testid={`pill-level-${l.id}`}>
              {l.name}
            </Pill>
          ))}
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 px-1"
            title="Rename this level"
            onClick={async () => {
              if (!activeLevel) return;
              const name = window.prompt("Level name:", activeLevel.name)?.trim();
              if (!name || name === activeLevel.name) return;
              try {
                await apiRequest("PUT", `/api/evidence-plans/levels/${activeLevel.id}`, { name });
                invalidate();
              } catch (e: any) { toast({ title: "Rename failed", description: e.message, variant: "destructive" }); }
            }}
            data-testid="button-rename-level"
          ><Pencil className="w-3 h-3" /></button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* Plan canvas */}
        <div
          className="relative flex-1 min-h-[45dvh] overflow-hidden bg-muted/30 select-none touch-none"
          onWheel={e => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            setZoom(z => Math.min(12, Math.max(0.5, z * factor)));
          }}
          onPointerDown={e => {
            if (drawing) return;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            dragging.current = { start: { x: e.clientX, y: e.clientY }, panStart: pan, moved: false };
          }}
          onPointerMove={e => {
            const d = dragging.current;
            if (!d) return;
            const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            setPan({ x: d.panStart.x + dx, y: d.panStart.y + dy });
          }}
          onPointerUp={() => { dragging.current = null; }}
          data-testid="evidence-plan-canvas"
        >
          {!hasBg ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <MapIcon className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No plan image yet — Upload plan to get started.</p>
              </div>
            </div>
          ) : (
            <div
              className="absolute left-1/2 top-1/2"
              style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center", width: "min(90%, 1400px)" }}
            >
              <div
                ref={surfaceRef}
                className="relative w-full"
                style={{ aspectRatio: `${activeLevel?.background_width || 10} / ${activeLevel?.background_height || 7}` }}
                onClick={e => {
                  if (!drawing) return;
                  const pt = toPlanCoords(e.clientX, e.clientY);
                  if (pt) setDraft(d => [...d, pt]);
                }}
                onDoubleClick={() => {
                  if (!drawing || draft.length < 3) return;
                  setDrawing(false);
                  const poly = draft;
                  setDraft([]);
                  addUnit.mutate(poly);
                }}
              >
                <img src={`/api/evidence-plans/levels/${activeLevel!.id}/background?v=${encodeURIComponent(activeLevel!.background_key || "")}`} alt="" className="absolute inset-0 w-full h-full" draggable={false} />
                <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${aspect >= 1 ? 100 : 100} ${100 * aspect}`} preserveAspectRatio="none" style={{ pointerEvents: "none" }}>
                  {levelUnits.filter(u => Array.isArray(u.polygon) && u.polygon.length >= 3).map(u => {
                    const poly = u.polygon as Pt[];
                    const pts = poly.map(p => `${p.x * 100},${p.y * 100 * aspect}`).join(" ");
                    const c = centroid(poly);
                    const isSel = u.id === selectedId;
                    const za = latestZaByUnit.get(u.id);
                    return (
                      <g key={u.id} style={{ pointerEvents: "auto", cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); if (!drawing && !dragging.current?.moved) setSelectedId(u.id); }}>
                        <polygon points={pts}
                          fill={isSel ? "hsl(17 60% 45% / 0.30)" : za != null ? "hsl(17 60% 45% / 0.14)" : "hsl(220 10% 40% / 0.10)"}
                          stroke={isSel ? "hsl(17 60% 45%)" : "hsl(220 10% 35% / 0.55)"}
                          strokeWidth={isSel ? 0.35 : 0.18} vectorEffect="non-scaling-stroke" />
                        <text x={c.x * 100} y={c.y * 100 * aspect} textAnchor="middle" dominantBaseline="middle"
                          style={{ fontSize: Math.max(1.1, 2.4 / Math.sqrt(zoom)), fontWeight: 700, fill: "#1C1917", paintOrder: "stroke", stroke: "#FFFFFF", strokeWidth: 0.35 }}>
                          {u.unit_ref}
                        </text>
                        {za != null && (
                          <text x={c.x * 100} y={c.y * 100 * aspect + Math.max(1.4, 2.8 / Math.sqrt(zoom))} textAnchor="middle" dominantBaseline="middle"
                            style={{ fontSize: Math.max(0.9, 1.8 / Math.sqrt(zoom)), fontWeight: 600, fill: "hsl(17 60% 38%)", paintOrder: "stroke", stroke: "#FFFFFF", strokeWidth: 0.3 }}>
                            £{za.toLocaleString("en-GB", { maximumFractionDigits: 0 })} ZA
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {draft.length > 0 && (
                    <polygon points={draft.map(p => `${p.x * 100},${p.y * 100 * aspect}`).join(" ")}
                      fill="hsl(17 60% 45% / 0.15)" stroke="hsl(17 60% 45%)" strokeWidth={0.3} strokeDasharray="1 0.6" vectorEffect="non-scaling-stroke" />
                  )}
                </svg>
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute right-3 top-3 flex flex-col gap-1">
            <Button variant="outline" size="icon" className="h-9 w-9 bg-card" onClick={() => setZoom(z => Math.min(12, z * 1.3))} data-testid="button-zoom-in"><ZoomIn className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-9 w-9 bg-card" onClick={() => setZoom(z => Math.max(0.5, z / 1.3))} data-testid="button-zoom-out"><ZoomOut className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-9 w-9 bg-card text-[10px] font-semibold" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} data-testid="button-zoom-reset">1:1</Button>
          </div>
          {drawing && (
            <div className="absolute left-3 top-3 rounded-md bg-card border border-border px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm">
              Click the unit's corners · double-click to close · {draft.length} point{draft.length === 1 ? "" : "s"}
              {draft.length > 0 && <button className="ml-2 underline" onClick={() => setDraft([])}>clear</button>}
            </div>
          )}
        </div>

        {/* Unit panel */}
        <div className="w-full md:w-[380px] border-t md:border-t-0 md:border-l border-border overflow-y-auto bg-background">
          {!selected ? (
            <div className="p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">No unit selected</p>
              <p className="text-xs leading-relaxed">Tap a unit on the plan to see its facts and evidence. Draw unit adds a new outline; Import tenancy schedule fills expiry / break / review / ERV / passing for units on the plan.</p>
              {unlinkedCount > 0 && (
                <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                  {unlinkedCount} evidence entr{unlinkedCount === 1 ? "y" : "ies"} couldn't be matched to a drawn unit — draw those units and re-run the TAF, or set the unit on each entry.
                </div>
              )}
            </div>
          ) : (
            <UnitPanel key={selected.id} unit={selected} entries={selectedEntries} planId={planId}
              matters={matters.filter(m => m.unit_norm && m.unit_norm === (selected.unit_norm || normRef(selected.unit_ref)))}
              onClose={() => setSelectedId(null)}
              onSave={(patch) => saveUnit.mutate({ id: selected.id, patch })}
              onDeleted={() => { setSelectedId(null); invalidate(); }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Link-to-property dialog ──────────────────────────────────────────────
// Linking hands the plan's unit facts over to the property's tenancy
// schedule (the single source of truth) and surfaces its lease advisory jobs.
function LinkPropertyDialog({ open, onOpenChange, plan, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; plan: any; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [propertyId, setPropertyId] = useState<string>(plan?.property_id || "");
  const { data: properties = [] } = useQuery<any[]>({ queryKey: ["/api/crm/properties"], enabled: open });
  useEffect(() => { if (open) setPropertyId(plan?.property_id || ""); }, [open, plan?.property_id]);

  const save = async () => {
    try {
      const r = await apiRequest("PUT", `/api/evidence-plans/${plan.id}`, { propertyId: propertyId || null });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      onSaved();
      onOpenChange(false);
      toast({ title: propertyId ? "Linked to property" : "Unlinked", description: propertyId ? "Unit facts now come from the property's tenancy schedule." : "The plan keeps its own imported facts again." });
    } catch (e: any) { toast({ title: "Couldn't save", description: e.message, variant: "destructive" }); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Link to a CRM property</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <select
            value={propertyId}
            onChange={e => setPropertyId(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="select-link-property"
          >
            <option value="">Not linked</option>
            {[...properties].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">When linked, lease expiry / break / review / ERV / passing rent on every matched unit read live from that property's tenancy schedule — the plan stops keeping its own copy. Lease advisory jobs on the property show on their units too.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} data-testid="button-save-property-link">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Unit side panel ───────────────────────────────────────────────────────
function UnitPanel({ unit, entries, planId, matters = [], onClose, onSave, onDeleted }: {
  unit: PlanUnit; entries: Entry[]; planId: string; matters?: Matter[];
  onClose: () => void; onSave: (patch: any) => void; onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [ev, setEv] = useState<any>({});

  const startEdit = () => {
    setForm({
      unitRef: unit.unit_ref, tenantName: unit.tenant_name || "",
      leaseExpiry: unit.lease_expiry?.slice(0, 10) || "", breakDate: unit.break_date?.slice(0, 10) || "",
      reviewDate: unit.review_date?.slice(0, 10) || "", erv: unit.erv || "", passingRent: unit.passing_rent || "",
      sqft: unit.sqft || "", notes: unit.notes || "",
    });
    setEditing(true);
  };

  const removeUnit = async () => {
    if (!window.confirm(`Delete unit ${unit.unit_ref} from the plan? Its evidence entries are kept (unlinked).`)) return;
    await apiRequest("DELETE", `/api/evidence-plans/units/${unit.id}`, undefined);
    onDeleted();
  };

  const addEvidence = async () => {
    try {
      const r = await apiRequest("POST", `/api/evidence-plans/${planId}/entries`, { ...ev, unitId: unit.id, unitRef: unit.unit_ref });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      setAddingEvidence(false);
      setEv({});
      queryClient.invalidateQueries({ queryKey: ["/api/evidence-plans", planId] });
    } catch (e: any) {
      toast({ title: "Couldn't add evidence", description: e.message, variant: "destructive" });
    }
  };

  const fact = (label: string, value: string) => (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-mono tabular-nums">{value}</div>
    </div>
  );
  const field = (label: string, key: string, type: "text" | "date" | "number" = "text") => (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input type={type} value={form[key] ?? ""} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))} className="mt-0.5 h-8 text-xs" />
    </div>
  );
  const evField = (label: string, key: string, type: "text" | "date" | "number" = "text") => (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input type={type} value={ev[key] ?? ""} onChange={e => setEv((f: any) => ({ ...f, [key]: e.target.value }))} className="mt-0.5 h-8 text-xs" />
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight">{unit.unit_ref}</h2>
          <p className="text-[11px] text-muted-foreground">{unit.tenant_name || "No tenant on record"}{unit.sqft ? ` · ${Number(unit.sqft).toLocaleString("en-GB")} sq ft` : ""}</p>
        </div>
        <div className="flex items-center gap-1">
          {!editing && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={startEdit} data-testid="button-edit-unit">Edit</Button>}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={removeUnit} data-testid="button-delete-unit"><Trash2 className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {field("Unit ref", "unitRef")}
            {!unit.ts_linked && <>
              {field("Tenant", "tenantName")}
              {field("Lease expiry", "leaseExpiry", "date")}
              {field("Break", "breakDate", "date")}
              {field("Next review", "reviewDate", "date")}
              {field("Size sq ft", "sqft", "number")}
              {field("ERV £pa", "erv", "number")}
              {field("Passing £pa", "passingRent", "number")}
            </>}
          </div>
          {unit.ts_linked && <p className="text-[11px] text-muted-foreground">Lease facts come from the property's tenancy schedule — edit them there.</p>}
          {field("Notes", "notes")}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { onSave(unit.ts_linked ? { unitRef: form.unitRef, notes: form.notes } : form); setEditing(false); }} data-testid="button-save-unit">Save</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {fact("Lease expiry", fmtDate(unit.lease_expiry))}
            {fact("Break", fmtDate(unit.break_date))}
            {fact("Next review", fmtDate(unit.review_date))}
            {fact("ERV", fmtMoney(unit.erv))}
            {fact("Passing rent", fmtMoney(unit.passing_rent))}
            {fact("Size", unit.sqft ? `${Number(unit.sqft).toLocaleString("en-GB")} sq ft` : "—")}
          </div>
          {unit.ts_linked && <p className="text-[10px] text-muted-foreground mt-2">Live from the property's tenancy schedule</p>}
        </div>
      )}

      {matters.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Lease advisory jobs</h3>
          <div className="space-y-1.5">
            {matters.map(m => (
              <Link key={m.id} href={`/pla/matters/${m.id}`} className="block rounded-lg border border-border bg-card px-3 py-2 hover:border-primary/40 transition-colors" data-testid={`unit-matter-${m.id}`}>
                <span className="text-xs font-medium">{MATTER_TYPE_LABELS[m.matter_type] || m.matter_type}</span>
                <span className="text-[11px] text-muted-foreground"> · {m.status}{m.acting_for ? ` · for ${m.acting_for}` : ""}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence · <span className="font-mono">{entries.length}</span></h3>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setAddingEvidence(a => !a)} data-testid="button-add-evidence">
            <Plus className="w-3 h-3 mr-0.5" /> Add evidence
          </Button>
        </div>

        {addingEvidence && (
          <div className="rounded-xl border border-border bg-card p-3 mb-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {evField("Tenant", "tenant")}
              {evField("Type (OML/LR/RR)", "transactionType")}
              {evField("Date", "transactionDate", "date")}
              {evField("Size sq ft", "sizeSqft", "number")}
              {evField("Zone A £psf", "zoneA", "number")}
              {evField("ITZA", "itza", "number")}
              {evField("Headline £pa", "headlineRent", "number")}
              {evField("Net effective £pa", "netEffective", "number")}
            </div>
            {evField("Notes", "notes")}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingEvidence(false)}>Cancel</Button>
              <Button size="sm" onClick={addEvidence} data-testid="button-save-evidence">Save evidence</Button>
            </div>
          </div>
        )}

        {entries.length === 0 && !addingEvidence ? (
          <p className="text-xs text-muted-foreground">No evidence yet — Add evidence, or Add TAF PDF to extract it automatically.</p>
        ) : (
          <div className="space-y-1.5">
            {entries.map(e => (
              <div key={e.id} className="rounded-xl border border-border bg-card px-3 py-2" data-testid={`evidence-entry-${e.id}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium truncate">{e.tenant || "—"}</span>
                  <span className="text-xs font-mono tabular-nums shrink-0">{e.zone_a ? `£${Number(e.zone_a).toLocaleString("en-GB", { maximumFractionDigits: 2 })} ZA` : fmtMoney(e.headline_rent)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {[e.transaction_type, fmtDate(e.transaction_date), e.size_sqft ? `${Number(e.size_sqft).toLocaleString("en-GB")} sq ft` : null].filter(Boolean).join(" · ")}
                </div>
                {(e.headline_rent || e.net_effective || e.concession) && (
                  <div className="text-[11px] text-muted-foreground">
                    {[e.headline_rent ? `Headline ${fmtMoney(e.headline_rent)}` : null, e.net_effective ? `Net ${fmtMoney(e.net_effective)}` : null, e.concession].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  {e.source_key && (
                    <a href={`/api/evidence-plans/source?key=${encodeURIComponent(e.source_key)}`} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">Open source TAF</a>
                  )}
                  <button
                    className="text-[11px] text-muted-foreground hover:text-destructive ml-auto"
                    onClick={async () => {
                      if (!window.confirm("Delete this evidence entry?")) return;
                      await apiRequest("DELETE", `/api/evidence-plans/entries/${e.id}`, undefined);
                      queryClient.invalidateQueries({ queryKey: ["/api/evidence-plans", planId] });
                    }}
                  >Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EvidencePlansPage() {
  const [matched, params] = useRoute("/evidence-plans/:id");
  if (matched && params?.id) return <PlanView planId={params.id} />;
  return <PlanList />;
}
