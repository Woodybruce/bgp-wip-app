// Scheme evidence plans (Pete Wood / Brent Cross, 2026-09-02) — the
// interactive replacement for the annotated-PowerPoint evidence plan.
// List page + full-screen plan viewer/editor:
//   • background scheme plan (PDF/image) with zoom + pan
//   • trace closed demises or draw/correct their corners
//   • editable, contained summary labels on every unit
//   • per-unit facts editable in place; tenancy-schedule import fills
//     expiry / break / review / ERV / passing for matched units only
//   • TAF PDFs (single or tranche scans) AI-extract into evidence entries
//   • swap the background plan any time — outlines and data stay put
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { containedMarker, isValidPolygon, moveMarkerInside } from "@shared/plan-geometry";
import { planOutlineDisplay, planOutlinePoints, type OutlinePlacement } from "@shared/plan-outline-display";
import type { ScanReviewResponse } from "@shared/plan-scan-review";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidencePlanReview } from "@/components/evidence-plan-review";
import { EvidencePlanScanReview } from "@/components/evidence-plan-scan-review";
import { TenancyImportReview, type TenancyImportReviewRow } from "@/components/tenancy-import-review";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Map as MapIcon, Plus, Upload, ZoomIn, ZoomOut, Pencil, Trash2, FileSpreadsheet, FileText, X, Loader2, Maximize2, Minimize2, Sparkles, Crop as CropIcon } from "lucide-react";

type Pt = { x: number; y: number };
type PlanLevel = {
  id: string; name: string; background_key: string | null;
  background_width: number | null; background_height: number | null;
  source_pdf_url?: string | null;
};
type PlanUnit = {
  id: string; unit_ref: string; unit_norm?: string; ts_linked?: boolean; ts_row_id?: string | null;
  tenant_name: string | null; level_id: string | null; polygon: Pt[] | null; dot?: Pt | null;
  lease_expiry: string | null; break_date: string | null; review_date: string | null;
  erv: string | null; passing_rent: string | null; sqft: string | null; notes: string | null;
  source?: string | null; ts_link_status?: string; ts_link_reason?: string | null;
  tenancy_unit_id?: string | null; ts_row_updated_at?: string | null; ts_candidate_ids?: string[];
  ts_equivalent_row_ids?: string[]; ts_match_method?: string | null;
  ts_conflicts?: { field: string; label: string }[];
};
type Matter = { id: string; matter_type: string; status: string; acting_for: string | null; unit_name: string | null; unit_norm: string | null };
type Entry = {
  id: string; unit_id: string | null; unit_ref: string | null; tenant: string | null;
  transaction_type: string | null; transaction_date: string | null; size_sqft: string | null;
  zone_a: string | null; itza: string | null; headline_rent: string | null; net_effective: string | null;
  term: string | null; concession: string | null; notes: string | null; source_key: string | null;
};

const fmtMoney = (v: any) => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : "—";
};
const fmtDate = (v: any) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" as const }) });
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

// Evidence transaction types → dot colour + key label. Colours picked to
// hold against the teal-heavy plan artwork.
const evidenceTypeKey = (t: string | null | undefined): "OML" | "LR" | "RR" | "RG" | "OTHER" => {
  const s = String(t || "").toLowerCase();
  if (/oml|open market/.test(s)) return "OML";
  if (/renewal|^lr$/.test(s)) return "LR";
  if (/review|^rr$/.test(s)) return "RR";
  if (/re-?gear|^rg$/.test(s)) return "RG";
  return "OTHER";
};
// Defaults picked to CONTRAST with typical letting-plan artwork (teal
// blocks, white malls, blue sidebars) — and each is editable per plan by
// clicking its swatch in the key (Woody, 2026-09-04).
const EVIDENCE_TYPE_META: Record<string, { label: string; colour: string }> = {
  OML: { label: "OML", colour: "#1E40AF" },
  LR: { label: "Lease renewal", colour: "#7B2D8E" },
  RR: { label: "Rent review", colour: "#DC2626" },
  RG: { label: "Re-gear", colour: "#BE185D" },
  OTHER: { label: "Other", colour: "#57534E" },
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
    <div className="flex flex-col h-full min-h-screen">
      {/* Header matches the Jobs / Comps pages — one Lease Advisory toolset. */}
      <div className="border-b bg-background sticky top-0 z-10 px-4 lg:px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <MapIcon className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Evidence Plans</h1>
              <p className="text-xs text-muted-foreground">{plans.length ? `${plans.length} scheme${plans.length === 1 ? "" : "s"}` : "Interactive scheme plans with rental evidence"}</p>
            </div>
          </div>
          <Button onClick={() => setCreating(true)} size="sm" className="gap-1.5" data-testid="button-new-plan"><Plus className="h-4 w-4" /> New plan</Button>
        </div>
        {/* Lease advisory toolset — jobs, evidence plans and comps together */}
        <div className="flex items-center gap-1.5 mt-3">
          <Pill onClick={() => navigate("/pla/matters")} data-testid="pill-la-jobs">Jobs</Pill>
          <Pill active data-testid="pill-la-evidence-plans">Evidence plans</Pill>
          <Pill onClick={() => navigate("/comps")} data-testid="pill-la-comps">Comps</Pill>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 lg:p-6">
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
      </div>

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
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<{ plan: any; levels: PlanLevel[]; units: PlanUnit[]; entries: Entry[]; matters: Matter[]; jobs: any[]; schedule_rows?: any[] }>({
    queryKey: ["/api/evidence-plans", planId],
    queryFn: async () => {
      const r = await fetch(`/api/evidence-plans/${planId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    // Detection/extraction jobs run server-side — keep the plan fresh while
    // one is in flight so outlines and evidence appear as they land.
    refetchInterval: (query: any) => (query.state.data?.jobs?.length ? 4000 : false),
  });

  // Viewport: zoom + pan via CSS transform on the plan surface.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const dragging = useRef<null | { start: Pt; panStart: Pt; moved: boolean }>(null);
  const suppressClick = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [tracing, setTracing] = useState(false);
  const [traceBusy, setTraceBusy] = useState(false);
  const traceGeneration = useRef(0);
  const [redrawId, setRedrawId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [unitSearch, setUnitSearch] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [scanReviewOpen, setScanReviewOpen] = useState(false);
  const [cleanPlan, setCleanPlan] = useState(false);
  const [strongLines, setStrongLines] = useState(false);
  const [hideRedInk, setHideRedInk] = useState(false);
  const [numberLabels, setNumberLabels] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [cropRect, setCropRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const cropStart = useRef<Pt | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const draftRef = useRef<Pt[]>([]);
  const draftBackgroundKey = useRef<string | null>(null);
  const setPoints = (points: Pt[]) => { draftRef.current = points; setDraft(points); };
  const [busy, setBusy] = useState<string | null>(null);
  const [importReviewRows, setImportReviewRows] = useState<TenancyImportReviewRow[]>([]);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const tsInputRef = useRef<HTMLInputElement>(null);
  const tafInputRef = useRef<HTMLInputElement>(null);
  const tafFolderRef = useRef<HTMLInputElement>(null);

  const plan = data?.plan;
  const levels = data?.levels || [];
  const units = data?.units || [];
  const entries = data?.entries || [];
  const matters = data?.matters || [];
  const detectRunning = (data?.jobs || []).some((j: any) => j.kind === "detect");
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanReport, setScanReport] = useState<string | null>(null);
  const completedScan = useRef<string | null>(null);
  const { data: scanJob } = useQuery<any>({
    queryKey: ["/api/evidence-plans/jobs", scanJobId], enabled: !!scanJobId,
    queryFn: async () => (await apiRequest("GET", `/api/evidence-plans/jobs/${scanJobId}`)).json(),
    refetchInterval: query => query.state.data?.status === "running" ? 2000 : false,
  });
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [linkingProperty, setLinkingProperty] = useState(false);
  const [tafJob, setTafJob] = useState<any>(null);

  // Full screen for meetings (Pete) — the whole viewer incl. the unit
  // panel; Esc or the button exits.
  const fsRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    const el: any = fsRef.current;
    (el?.requestFullscreen || el?.webkitRequestFullscreen)?.call(el);
  };
  const activeLevel = levels.find(l => l.id === activeLevelId) || levels[0] || null;
  // A unit belongs to its level; pre-levels units (level_id null) sit on the first.
  const levelUnits = useMemo(
    () => units.filter(u => (u.level_id ?? levels[0]?.id) === activeLevel?.id),
    [units, levels, activeLevel]);
  const scanReview = useQuery<ScanReviewResponse>({
    queryKey: ["/api/evidence-plans", planId, "scan-review", activeLevel?.id],
    enabled: !!activeLevel?.id,
    queryFn: async () => (await apiRequest("GET", `/api/evidence-plans/${planId}/scan-review?levelId=${encodeURIComponent(activeLevel!.id)}`)).json(),
    staleTime: 0, retry: false,
  });
  const outlineDisplay = useMemo(() => planOutlineDisplay(levelUnits, scanReview.isError ? null : scanReview.data?.review, {
    planId, levelId: activeLevel?.id || "", backgroundKey: activeLevel?.background_key || null,
  }), [levelUnits, scanReview.data, scanReview.isError, planId, activeLevel]);

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
  const selectUnit = (id: string) => { setSelectedId(id); setDetailsOpen(true); setHover(null); };
  const selectedEntries = useMemo(
    () => entries.filter(e => (selected ? e.unit_id === selected.id : false)),
    [entries, selected]);
  const unlinkedCount = entries.filter(e => !e.unit_id).length;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/evidence-plans", planId] });
  useEffect(() => {
    const job = data?.jobs?.find((item: any) => item.kind === "detect");
    if (job && job.id !== scanJobId) { setScanJobId(job.id); setScanReport(null); }
  }, [data?.jobs, scanJobId]);
  useEffect(() => {
    if (!scanJob || scanJob.status === "running" || completedScan.current === scanJob.id) return;
    completedScan.current = scanJob.id;
    const summary = scanJob.reviewSummary;
    setScanReport(scanJob.status === "error" ? `Scan couldn't finish: ${scanJob.error || "Try again or trace a unit individually."}`
      : summary ? `${summary.detected} boundaries detected · ${summary.added} added · ${summary.refined} refined · ${summary.current} already current · ${summary.needsReview} awaiting review. Existing unit information has been kept.`
      : `Scan finished. ${scanJob.created || 0} units added. ${scanJob.error || "Review scan to inspect the detected outlines and any boundaries awaiting review."}`);
    if (scanJob.status === "done" && summary?.needsReview > 0 && scanJob.level_id === activeLevel?.id) setScanReviewOpen(true);
    invalidate();
  }, [scanJob]);
  const refreshUnits = async () => {
    try {
      const r = await apiRequest("POST", `/api/evidence-plans/${planId}/detect-units`, { levelId: activeLevel?.id || null });
      const started = await r.json(); setScanJobId(started.jobId); setScanReport(null);
      invalidate();
    } catch (e: any) { toast({ title: "Couldn't start detection", description: e.message, variant: "destructive" }); }
  };

  // Latest Zone A per unit — drives the dot's figure on the plan.
  const latestZaByUnit = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      if (!e.unit_id || e.zone_a == null) continue;
      if (!m.has(e.unit_id)) m.set(e.unit_id, Number(e.zone_a)); // entries arrive newest-first
    }
    return m;
  }, [entries]);
  const evidenceCountByUnit = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) if (e.unit_id) m.set(e.unit_id, (m.get(e.unit_id) || 0) + 1);
    return m;
  }, [entries]);
  // Latest full entry per unit — drives dot colour (transaction type) and
  // the hover card. Entries arrive newest-first.
  const latestEntryByUnit = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of entries) if (e.unit_id && !m.has(e.unit_id)) m.set(e.unit_id, e);
    return m;
  }, [entries]);
  const typesOnPlan = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.unit_id) s.add(evidenceTypeKey(e.transaction_type));
    return s;
  }, [entries]);
  const [hover, setHover] = useState<{ unitId: string; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setCanvasSize({ width: canvas.clientWidth, height: canvas.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(canvas); measure();
    return () => observer.disconnect();
  }, [isLoading, isMobile]);
  const [dotDraft, setDotDraft] = useState<{ unitId: string; x: number; y: number } | null>(null);
  const dotGesture = useRef<{ unitId: string; start: Pt; point: Pt; moved: boolean } | null>(null);
  const [dotSaving, setDotSaving] = useState(false);
  // UX #137 — the unit-ref used to come from a raw window.prompt(); Esc
  // silently threw the just-drawn outline away. App dialog keeps the
  // polygon on Cancel so it can be re-named rather than redrawn.
  const [pendingPoly, setPendingPoly] = useState<Pt[] | null>(null);
  const [pendingRef, setPendingRef] = useState("");
  const pendingTarget = useRef<{ unitId: string | null; levelId: string | null; backgroundKey: string | null } | null>(null);
  // Per-plan key colours: defaults from EVIDENCE_TYPE_META, overridable by
  // clicking a swatch in the key (saved on the plan, shared by everyone).
  const colourOf = (k: string) => (plan?.dot_colours?.[k] as string) || EVIDENCE_TYPE_META[k]?.colour || EVIDENCE_TYPE_META.OTHER.colour;
  const saveColour = async (k: string, hex: string) => {
    try {
      const r = await apiRequest("PUT", `/api/evidence-plans/${planId}`, { dotColours: { ...(plan?.dot_colours || {}), [k]: hex } });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      invalidate();
    } catch (e: any) { toast({ title: "Couldn't save colour", description: e.message, variant: "destructive" }); }
  };
  const [showZa, setShowZa] = useState<boolean>(() => { try { return localStorage.getItem("bgp-ep-za") !== "0"; } catch { return true; } });

  // Each label belongs to its own demise. Never nudge it into another
  // shop to resolve overlap; fit the disc to the available interior space.
  const markerLayout = useMemo(() => {
    const aspect = activeLevel?.background_width ? (activeLevel.background_height || 1) / activeLevel.background_width : 0.7;
    return new Map(outlineDisplay.placed.map(u => {
      const desired = dotDraft?.unitId === u.id ? dotDraft : u.dot;
      return [u.id, containedMarker(u.polygon!, desired, 0.019 / Math.sqrt(zoom), aspect)];
    }));
  }, [outlineDisplay, dotDraft, zoom, activeLevel]);

  const toPlanCoords = (clientX: number, clientY: number): Pt | null => {
    const el = surfaceRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const addUnit = useMutation({
    mutationFn: async ({ polygon, unitRef, levelId, backgroundKey }: { polygon: Pt[]; unitRef: string; levelId: string | null; backgroundKey: string | null }) => {
      const r = await apiRequest("POST", `/api/evidence-plans/${planId}/units`, { unitRef, polygon, levelId, expectedBackgroundKey: backgroundKey });
      return r.json();
    },
    onSuccess: (u: any) => {
      setPendingPoly(null);
      setPendingRef("");
      stopDrawing();
      invalidate();
      selectUnit(u.id);
      if (u.adopted > 0) toast({ title: `Unit ${u.unit_ref} added`, description: `${u.adopted} waiting evidence entr${u.adopted === 1 ? "y" : "ies"} linked to it.` });
    },
    onError: (e: any) => toast({ title: "Couldn't add unit", description: e.message, variant: "destructive" }),
  });


  const saveUnit = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const r = await apiRequest("PUT", `/api/evidence-plans/units/${id}`, patch);
      return r.json();
    },
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const stopDrawing = () => { traceGeneration.current++; setTraceBusy(false); setDrawing(false); setTracing(false); setRedrawId(null); setPoints([]); pendingTarget.current = null; };
  const finishOutline = () => {
    const points = draftRef.current;
    if (!isValidPolygon(points)) {
      toast({ title: "Check the outline", description: "Use at least three distinct corners without crossing the boundary lines.", variant: "destructive" });
      return;
    }
    setPendingPoly(points);
    pendingTarget.current = { unitId: redrawId, levelId: activeLevel?.id || null, backgroundKey: draftBackgroundKey.current };
    setPendingRef(redrawId ? units.find(u => u.id === redrawId)?.unit_ref || "" : "");
    setDrawing(false);
    setTracing(false);
  };
  const saveOutline = async () => {
    const target = pendingTarget.current;
    if (!pendingPoly || !pendingRef.trim() || !target) return;
    if (!target.unitId) { addUnit.mutate({ polygon: pendingPoly, unitRef: pendingRef.trim(), levelId: target.levelId, backgroundKey: target.backgroundKey }); return; }
    try {
      await saveUnit.mutateAsync({ id: target.unitId, patch: { polygon: pendingPoly, dot: null, expectedBackgroundKey: target.backgroundKey } });
      selectUnit(target.unitId);
      setPendingPoly(null); setPendingRef(""); stopDrawing();
    } catch { /* Keep the complete outline available for retry. */ }
  };
  const traceAt = async (point: Pt) => {
    if (traceBusy || !activeLevel) return;
    const generation = ++traceGeneration.current;
    const target = { unitId: redrawId, levelId: activeLevel.id, backgroundKey: activeLevel.background_key };
    setTraceBusy(true);
    try {
      const result = await apiRequest("POST", `/api/evidence-plans/levels/${activeLevel.id}/trace-unit`, point);
      const candidate = await result.json();
      if (generation !== traceGeneration.current) return;
      if (candidate.backgroundKey !== target.backgroundKey) throw new Error("The plan image changed while tracing. Reload this level before tracing its current boundaries.");
      if (!isValidPolygon(candidate.polygon)) throw new Error("No closed unit boundary found here. Try a clear part of the unit fill, or use Draw unit.");
      draftBackgroundKey.current = candidate.backgroundKey;
      pendingTarget.current = { ...target, backgroundKey: candidate.backgroundKey };
      setPoints(candidate.polygon);
      setPendingPoly(candidate.polygon);
      setPendingRef(redrawId ? units.find(u => u.id === redrawId)?.unit_ref || "" : "");
      setTracing(false);
    } catch (error: any) { if (generation === traceGeneration.current) toast({ title: "Couldn't trace this unit", description: error.message, variant: "destructive" }); }
    finally { if (generation === traceGeneration.current) setTraceBusy(false); }
  };
  const saveMarker = async (unitId: string, point: Pt) => {
    setDotDraft({ unitId, ...point }); setDotSaving(true);
    try { await saveUnit.mutateAsync({ id: unitId, patch: { dot: point, expectedBackgroundKey: activeLevel?.background_key || null } }); }
    catch { /* Server coordinates remain authoritative if saving fails. */ }
    finally { setDotSaving(false); setDotDraft(null); }
  };

  const uploadFile = async (kind: "background" | "import-tenancy", file: File) => {
    setBusy(kind);
    try {
      const fd = new FormData();
      fd.append(kind === "background" ? "background" : "file", file);
      // A single-image replace targets the level being viewed; a multi-page
      // PDF refreshes every level server-side.
      if (kind === "background" && activeLevel) fd.append("levelId", activeLevel.id);
      // A LINKED plan's tenancy schedule lives on the property — route the
      // file to the canonical importer so the property's schedule (the
      // single source of truth) is what gets filled; the plan overlays it.
      const linkedTs = kind === "import-tenancy" ? plan?.property_id || null : null;
      if (linkedTs) fd.append("propertyId", linkedTs);
      const url = linkedTs ? `/api/tenancy-schedule/import-excel` : `/api/evidence-plans/${planId}/${kind}`;
      const r = await fetch(url, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      invalidate();
      if (linkedTs) {
        setImportReviewRows(j.reviewRows || []);
        toast({ title: j.needsReview ? "Schedule imported — review needed" : "Tenancy schedule imported",
          description: `${j.imported ?? 0} added · ${j.skippedExisting ?? 0} already present${j.needsReview ? ` · ${j.needsReview} changed or ambiguous rows need review on the property's tenancy schedule` : ""}. Existing entries and plan links kept.` });
      } else if (kind === "import-tenancy") {
        toast({ title: "Tenancy schedule imported", description: `${j.matched} unit${j.matched === 1 ? "" : "s"} matched${j.unmatched?.length ? ` · ${j.unmatched.length} TS rows had no unit on the plan` : ""}` });
      } else {
        toast({ title: "Plan image updated", description: (j.levels?.length || 0) > 1 ? `${j.levels.length} levels — outlines and data kept.` : "Outlines and data kept." });
      }
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  // TAF extraction is a server-side background job (a tranche set takes
  // minutes of vision reading — far past the 45s edge timeout). Upload,
  // get a job id back, poll: evidence appears per document as it lands.
  const uploadTafs = async (files: File[]) => {
    const usable = files.filter(f => /\.(pdf|zip)$/i.test(f.name));
    if (usable.length === 0) {
      toast({ title: "No TAFs found", description: "Pick PDFs, a zip, or a folder containing PDFs.", variant: "destructive" });
      return;
    }
    setBusy("ingest-taf");
    try {
      const fd = new FormData();
      for (const f of usable) fd.append("file", f);
      const r = await fetch(`/api/evidence-plans/${planId}/ingest-taf`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      setTafJob({ status: "running", done_docs: 0, total_docs: j.docs });
      toast({ title: "TAF extraction started", description: `${j.docs} document${j.docs === 1 ? "" : "s"} uploaded — evidence appears as each one is read.` });
      const poll = async () => {
        try {
          const jr = await fetch(`/api/evidence-plans/jobs/${j.jobId}`, { credentials: "include", headers: getAuthHeaders() });
          if (!jr.ok) throw new Error();
          const job = await jr.json();
          setTafJob(job);
          if (job.status === "done") {
            invalidate();
            toast({ title: "TAFs extracted", description: `${job.extracted} analysis sheet${job.extracted === 1 ? "" : "s"} across ${job.pages} pages — ${job.linked} linked to plan units` });
            setBusy(null); setTafJob(null);
          } else if (job.status === "error") {
            toast({ title: "TAF extraction failed", description: job.error || "Unknown error", variant: "destructive" });
            setBusy(null); setTafJob(null);
          } else {
            invalidate();
            setTimeout(poll, 4000);
          }
        } catch { setTimeout(poll, 6000); }
      };
      setTimeout(poll, 4000);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
      setBusy(null);
    }
  };

  if (isLoading) return <div className="p-6"><Skeleton className="h-[70vh] rounded-2xl" /></div>;
  if (!plan) return <div className="p-6 text-sm text-muted-foreground">Plan not found.</div>;

  const hasBg = !!activeLevel?.background_key;
  const aspect = hasBg && activeLevel?.background_width ? (activeLevel.background_height || 0) / activeLevel.background_width : 0.7;
  const fitWidth = canvasSize.width && canvasSize.height ? Math.min(canvasSize.width * .94, canvasSize.height * .94 / Math.max(.1, aspect)) : null;
  const actualSizeZoom = fitWidth ? (activeLevel?.background_width || fitWidth) / fitWidth : 1;
  const maxZoom = Math.max(24, actualSizeZoom);
  const overlaysVisible = !cleanPlan || drawing || tracing;

  return (
    <div ref={fsRef} className="flex flex-col h-[calc(100dvh-var(--mobile-top,0px))] md:h-full bg-background">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap bg-background">
        <button onClick={() => navigate("/evidence-plans")} className="text-sm text-muted-foreground hover:text-foreground">←</button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{plan.name}</h1>
          <p className="text-[11px] text-muted-foreground">
            {units.length} units · {entries.length} evidence entries{unlinkedCount ? ` · ${unlinkedCount} unlinked` : ""} ·{" "}
            <button className="underline underline-offset-2 hover:text-foreground" onClick={() => setLinkingProperty(true)} data-testid="button-link-property">
              {plan.property_name || "link to a property"}
            </button>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {detectRunning ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground rounded-full border border-border px-2.5 py-1" data-testid="detect-indicator">
              <Sparkles className="w-3 h-3" /> {scanJob?.status === "running" && scanJob.total_docs > 1 ? `Scanning · ${scanJob.done_docs} / ${scanJob.total_docs} sections` : "Reading the plan…"}
            </span>
          ) : hasBg ? (
            <Button variant="outline" size="sm" disabled={busy !== null}
              onClick={refreshUnits}
              data-testid="button-redetect">
              <Sparkles className="w-3.5 h-3.5 mr-1" /> Refresh units
            </Button>
          ) : null}
          <Button variant="outline" size="sm" disabled={!hasBg} onClick={() => setScanReviewOpen(true)} data-testid="button-review-scan">Review scan</Button>
          <Button variant={tracing ? "default" : "outline"} size="sm" disabled={!hasBg || traceBusy} onClick={() => { stopDrawing(); setCleanPlan(false); draftBackgroundKey.current = activeLevel?.background_key || null; setTracing(!tracing); setCropping(false); setDetailsOpen(false); }} data-testid="pill-trace-unit">
            {traceBusy ? "Tracing…" : "Trace unit"}
          </Button>
          <Button variant={drawing ? "default" : "outline"} size="sm" disabled={!hasBg} onClick={() => { stopDrawing(); setCleanPlan(false); draftBackgroundKey.current = activeLevel?.background_key || null; setDrawing(!drawing); setCropping(false); setDetailsOpen(false); }} data-testid="pill-draw-unit">
            <Pencil className="w-3 h-3 mr-1 inline" />{drawing ? "Drawing unit" : "Draw unit"}
          </Button>
          {plan.property_id && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/tenancy-schedule/${plan.property_id}`)} data-testid="button-open-ts">
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Tenancy schedule
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => tsInputRef.current?.click()} disabled={busy !== null} data-testid="button-import-ts">
            {busy === "import-tenancy" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />} Import tenancy schedule
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy !== null} data-testid="button-ingest-taf">
                {busy === "ingest-taf" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
                {busy === "ingest-taf" && tafJob ? `Extracting ${tafJob.done_docs ?? 0}/${tafJob.total_docs ?? "…"}` : busy === "ingest-taf" ? "Uploading…" : "Add TAFs"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => tafInputRef.current?.click()}>PDFs or a zip…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => tafFolderRef.current?.click()}>A whole folder…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant={cropping ? "default" : "outline"} size="icon" className="h-11 w-11"
            onClick={() => { setCropping(c => !c); setCropRect(null); stopDrawing(); }}
            title="Crop plan — drag the area to keep" disabled={!hasBg} data-testid="button-crop-plan">
            <CropIcon className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-11 w-11" onClick={toggleFullscreen} title={isFullscreen ? "Exit full screen" : "Full screen"} data-testid="button-fullscreen">
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => bgInputRef.current?.click()} disabled={busy !== null} data-testid="button-replace-bg">
            {busy === "background" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />} {hasBg ? "Replace plan" : "Upload plan"}
          </Button>
        </div>
        <input ref={bgInputRef} type="file" accept=".pdf,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile("background", f); e.target.value = ""; }} />
        <input ref={tsInputRef} type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile("import-tenancy", f); e.target.value = ""; }} />
        <input ref={tafInputRef} type="file" accept=".pdf,.zip" multiple hidden onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) uploadTafs(fs); e.target.value = ""; }} />
        <input ref={tafFolderRef} type="file" hidden multiple {...({ webkitdirectory: "" } as any)} onChange={e => { const fs = Array.from(e.target.files || []).filter(f => /\.(pdf|zip)$/i.test(f.name)); if (fs.length) uploadTafs(fs); else toast({ title: "No TAFs found", description: "That folder has no PDFs or zips in it.", variant: "destructive" }); e.target.value = ""; }} />
      </div>

      {scanReport && <div role="status" className="px-4 py-2 border-b border-border text-sm bg-card flex items-center gap-3 flex-wrap" data-testid="scan-report"><p className="flex-1 min-w-48">{scanReport}</p><Button variant="outline" size="sm" disabled={!hasBg} onClick={() => setScanReviewOpen(true)} data-testid="button-review-completed-scan">Review scan</Button><Button variant="ghost" size="sm" onClick={() => setScanReport(null)}>Dismiss</Button></div>}
      {scanJob?.status === "running" && scanJob.error && <p role="status" className="px-4 py-2 text-sm text-muted-foreground border-b border-border">{scanJob.error}</p>}

      <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-wrap">
        <Pill active={!cleanPlan && !numberLabels} onClick={() => { setCleanPlan(false); setNumberLabels(false); }} data-testid="view-plan-units">Units & evidence</Pill>
        <Pill active={!cleanPlan && numberLabels} onClick={() => { setCleanPlan(false); setNumberLabels(true); }} data-testid="view-unit-numbers">Unit numbers</Pill>
        <Pill active={cleanPlan} disabled={drawing || tracing || cropping} onClick={() => { setCleanPlan(true); setDetailsOpen(false); setHover(null); }} data-testid="view-clean-plan">Clean plan</Pill>
        <Pill active={hideRedInk} disabled={!hasBg} onClick={() => setHideRedInk(v => !v)} data-testid="view-hide-red">Hide red ink</Pill>
        <Pill active={strongLines} disabled={!hasBg} onClick={() => setStrongLines(v => !v)} data-testid="view-strong-lines">Darker lines</Pill>
        <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)} data-testid="button-review-plan">Review & clean up</Button>
        {activeLevel?.source_pdf_url && <Button variant="outline" size="sm" asChild><a href={activeLevel.source_pdf_url} target="_blank" rel="noreferrer" data-testid="link-original-plan">Original PDF</a></Button>}
        <span className="text-[11px] text-muted-foreground">{hideRedInk ? "Hides red/orange ink, including text and symbols; original kept." : strongLines ? "Contrast enhanced for viewing; source unchanged." : "Original image tones."}</span>
      </div>
      {!cleanPlan && numberLabels && <p className="px-4 py-2 text-sm text-muted-foreground border-b border-border">Select a unit and use Edit to set its number. Drag its label to position it; numbers are not guessed from neighbouring shops.</p>}
      <EvidencePlanReview open={reviewOpen} onOpenChange={setReviewOpen} units={units} levels={levels} activeLevelId={activeLevel?.id || null} propertyLinked={!!plan.property_id} unlinkedCount={unlinkedCount}
        evidence={<UnlinkedEvidence entries={entries} units={units} levels={levels} onSaved={invalidate} initiallyOpen />}
        onSelect={id => { const unit = units.find(u => u.id === id); stopDrawing(); setCleanPlan(false); setActiveLevelId(unit?.level_id || levels[0]?.id || null); setZoom(1); setPan({ x: 0, y: 0 }); selectUnit(id); }} />
      {activeLevel && <EvidencePlanScanReview key={activeLevel.id} open={scanReviewOpen} onOpenChange={setScanReviewOpen} planId={planId} level={activeLevel} onSaved={invalidate} onRefresh={refreshUnits} scanRunning={detectRunning} />}

      <LinkPropertyDialog open={linkingProperty} onOpenChange={setLinkingProperty} plan={plan} onSaved={invalidate} />
      <Dialog open={importReviewRows.length > 0} onOpenChange={open => { if (!open) setImportReviewRows([]); }}>
        <DialogContent className="max-w-3xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review imported tenancy entries</DialogTitle><DialogDescription>New entries have been added. The differences below need a decision before existing schedule information is changed.</DialogDescription></DialogHeader>
          <TenancyImportReview rows={importReviewRows} />
          <DialogFooter><Button variant="outline" onClick={() => setImportReviewRows([])}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UX #137 — unit-ref dialog for a just-drawn outline. Closing keeps
          the polygon pending until Discard is chosen explicitly. */}
      <Dialog open={!!pendingPoly} onOpenChange={(o) => { if (!o) { /* keep polygon; just hide */ } }}>
        <DialogContent className="max-w-sm max-md:top-auto max-md:bottom-0 max-md:translate-y-0 max-md:rounded-b-none" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-base">{redrawId ? "Save corrected outline" : "Name this unit"}</DialogTitle>
          </DialogHeader>
          <DialogDescription>{redrawId ? "The unit's information and evidence will stay linked." : "Check the boundary on the plan. You can add its information after saving."}</DialogDescription>
          <Input
            autoFocus
            placeholder="Unit reference (e.g. A15, N10, E7A)"
            value={pendingRef}
            disabled={!!redrawId}
            onChange={(e) => setPendingRef(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !addUnit.isPending && !saveUnit.isPending) saveOutline(); }}
            data-testid="input-unit-ref"
          />
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setPendingPoly(null); setPendingRef(""); stopDrawing(); }} data-testid="button-discard-outline">
              Discard outline
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setPendingPoly(null); setDrawing(true); }} data-testid="button-adjust-outline">Adjust corners</Button>
            <Button size="sm" disabled={!pendingRef.trim() || addUnit.isPending || saveUnit.isPending} onClick={saveOutline} data-testid="button-save-unit-ref">
              {addUnit.isPending || saveUnit.isPending ? "Saving…" : redrawId ? "Save outline" : "Save unit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Level switcher — a scheme plan PDF becomes one level per page */}
      {levels.length > 1 && (
        <div className="px-4 py-1.5 border-b border-border flex items-center gap-1.5 overflow-x-auto bg-background">
          {levels.map(l => (
            <Pill key={l.id} active={l.id === activeLevel?.id}
              onClick={() => { setActiveLevelId(l.id); setSelectedId(null); stopDrawing(); setZoom(1); setPan({ x: 0, y: 0 }); }}
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

      {/* Key — mock-up style, its own row under the levels. Click a swatch
          to change that type's colour for this plan. */}
      {typesOnPlan.size > 0 && (
        <div className="px-4 py-1.5 border-b border-border flex items-center gap-3 flex-wrap bg-background" data-testid="evidence-key">
          {Object.keys(EVIDENCE_TYPE_META).filter(k => typesOnPlan.has(k)).map(k => (
            <label key={k} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer relative" title="Click the dot to change this colour">
              <span className="w-2.5 h-2.5 rounded-full inline-block ring-1 ring-border" style={{ background: colourOf(k) }} />
              {EVIDENCE_TYPE_META[k].label}
              <input type="color" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                value={colourOf(k)} onChange={e => saveColour(k, e.target.value)} data-testid={`key-colour-${k}`} />
            </label>
          ))}
          <Pill active={showZa}
            onClick={() => setShowZa(s => { try { localStorage.setItem("bgp-ep-za", s ? "0" : "1"); } catch {} return !s; })}
            data-testid="button-toggle-za">
            £ ZA
          </Pill>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* Plan canvas */}
        <div
          ref={canvasRef}
          className="relative flex-1 min-w-0 min-h-[45dvh] overflow-hidden bg-muted/30 select-none touch-none"
          onWheel={e => {
            e.preventDefault();
            // Cursor-anchored zoom (the point under the mouse stays put) with
            // gesture-scaled speed — centre-anchored fixed steps felt "very
            // hard to control" (Woody, 2026-09-03). ctrlKey = trackpad pinch.
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
            const nz = Math.min(maxZoom, Math.max(0.5, zoom * factor));
            if (nz === zoom) return;
            const k = nz / zoom;
            const mx = e.clientX - rect.left - rect.width / 2;
            const my = e.clientY - rect.top - rect.height / 2;
            setPan(p => ({ x: mx - (mx - p.x) * k, y: my - (my - p.y) * k }));
            setZoom(nz);
          }}
          onPointerDown={e => {
            if (drawing || tracing) return;
            suppressClick.current = false;
            if (cropping) {
              const pt = toPlanCoords(e.clientX, e.clientY);
              if (pt) { cropStart.current = pt; setCropRect({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }); }
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              return;
            }
            dragging.current = { start: { x: e.clientX, y: e.clientY }, panStart: pan, moved: false };
          }}
          onPointerUp={async () => {
            suppressClick.current = !!dragging.current?.moved;
            dragging.current = null;
            if (!cropping || !cropRect || !cropStart.current) return;
            cropStart.current = null;
            const clamp = (v: number) => Math.min(1, Math.max(0, v));
            const r = {
              x0: clamp(Math.min(cropRect.x0, cropRect.x1)), y0: clamp(Math.min(cropRect.y0, cropRect.y1)),
              x1: clamp(Math.max(cropRect.x0, cropRect.x1)), y1: clamp(Math.max(cropRect.y0, cropRect.y1)),
            };
            setCropping(false);
            setCropRect(null);
            if (r.x1 - r.x0 < 0.05 || r.y1 - r.y0 < 0.05) return;
            if (!window.confirm(`Crop ${activeLevel?.name || "this level"} to the selected area? Units and dots move with it; the original image is kept in storage.`)) return;
            try {
              const resp = await apiRequest("POST", `/api/evidence-plans/levels/${activeLevel!.id}/crop`, r);
              if (!resp.ok) throw new Error((await resp.json()).error || "failed");
              setZoom(1); setPan({ x: 0, y: 0 });
              invalidate();
              toast({ title: "Plan cropped", description: "Outlines and dots remapped to the new frame." });
            } catch (err: any) { toast({ title: "Crop failed", description: err.message, variant: "destructive" }); }
          }}
          onPointerMove={e => {
            if (cropping && cropStart.current && e.buttons === 1) {
              const pt = toPlanCoords(e.clientX, e.clientY);
              if (pt) setCropRect({ x0: cropStart.current.x, y0: cropStart.current.y, x1: pt.x, y1: pt.y });
              return;
            }
            const d = dragging.current;
            if (!d) return;
            const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            if (d.moved) e.currentTarget.setPointerCapture(e.pointerId);
            setPan({ x: d.panStart.x + dx, y: d.panStart.y + dy });
          }}
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
              style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center", width: fitWidth ? `${fitWidth}px` : "90%" }}
            >
              <div
                ref={surfaceRef}
                data-testid="evidence-plan-surface"
                className="relative w-full"
                style={{ aspectRatio: `${activeLevel?.background_width || 10} / ${activeLevel?.background_height || 7}` }}
                onClick={e => {
                  if (!drawing && !tracing) return;
                  const pt = toPlanCoords(e.clientX, e.clientY);
                  if (!pt || pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) return;
                  if (tracing) { traceAt(pt); return; }
                  if (e.detail > 1) return;
                  const last = draftRef.current.at(-1);
                  if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) > 0.00001) setPoints([...draftRef.current, pt]);
                }}
                onDoubleClick={() => {
                  if (drawing) finishOutline();
                }}
              >
                <img src={`/api/evidence-plans/levels/${activeLevel!.id}/background?v=${encodeURIComponent(activeLevel!.background_key || "")}${hideRedInk ? "&hideRed=1" : ""}`} alt={`${plan.name} — ${activeLevel?.name || "plan"}`} className="absolute inset-0 w-full h-full" style={{ filter: strongLines ? "contrast(1.7)" : "none" }} draggable={false} data-testid="plan-background-image" />
                <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${aspect >= 1 ? 100 : 100} ${100 * aspect}`} preserveAspectRatio="none" style={{ pointerEvents: "none" }}>
                  {overlaysVisible && selected && outlineDisplay.placement.get(selected.id) === "needs_review" && isValidPolygon(selected.polygon) && (
                    <polygon points={planOutlinePoints(selected.polygon!, 100, 100 * aspect)} fill="none" stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" data-testid="unit-outline-inspection">
                      <title>Unreviewed saved outline for {selected.unit_ref}. Use Review scan or redraw to place this unit.</title>
                    </polygon>
                  )}
                  {overlaysVisible && outlineDisplay.placed.map(u => {
                    const poly = u.polygon as Pt[];
                    const pts = planOutlinePoints(poly, 100, 100 * aspect);
                    const isSel = u.id === selectedId;
                    const isHover = hover?.unitId === u.id;
                    // Only manually saved or current scan-backed outlines
                    // may label a unit or capture clicks on the plan.
                    return (
                      <g key={u.id} style={{ pointerEvents: drawing || tracing || cropping ? "none" : "auto", cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); if (!suppressClick.current) selectUnit(u.id); }}
                        onMouseMove={e => {
                          const rect = canvasRef.current?.getBoundingClientRect();
                          if (rect) setHover({ unitId: u.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
                        }}
                        onMouseLeave={() => setHover(h => (h?.unitId === u.id ? null : h))}>
                        <polygon points={pts} data-testid={`unit-outline-${u.id}`}
                          fill={isSel ? "hsl(var(--primary) / 0.1)" : "transparent"}
                          stroke={isSel ? "hsl(var(--primary))" : isHover ? "hsl(var(--foreground))" : "hsl(var(--primary) / 0.45)"}
                          strokeWidth={isSel ? 2.5 : 1} vectorEffect="non-scaling-stroke" />
                      </g>
                    );
                  })}
                  {/* Labels stay in their own demise, including units awaiting evidence. */}
                  {overlaysVisible && outlineDisplay.placed.map(u => {
                    const layout = markerLayout.get(u.id)!;
                    const isSel = u.id === selectedId;
                    const latest = latestEntryByUnit.get(u.id);
                    const za = latestZaByUnit.get(u.id);
                    const label = String(u.unit_ref || "Unit");
                    const zaStr = showZa && za != null ? `£${za.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : null;
                    const R = layout.radius * 100;
                    const cx = layout.x * 100, cy = layout.y * 100 * aspect;
                    const typeColour = latest ? colourOf(evidenceTypeKey(latest.transaction_type)) : "hsl(var(--muted-foreground))";
                    return (
                      <g key={`marker-${u.id}`} role="button" tabIndex={drawing || tracing || cropping ? -1 : 0}
                        aria-label={`Unit ${label}${zaStr ? `, ${zaStr} Zone A` : ", no Zone A evidence"}. Select to edit; drag or use arrow keys to move its label.`}
                        data-testid={`unit-marker-${u.id}`}
                        style={{ pointerEvents: drawing || tracing || cropping ? "none" : "auto", cursor: dotSaving ? "wait" : "grab" }}
                        onClick={e => { e.stopPropagation(); if (!suppressClick.current) selectUnit(u.id); }}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectUnit(u.id); return; }
                          if (!e.key.startsWith("Arrow") || dotSaving) return;
                          e.preventDefault();
                          const step = e.shiftKey ? 0.01 : 0.002;
                          const point = moveMarkerInside(u.polygon!, { x: layout.x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0), y: layout.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) / aspect }, 0.019 / Math.sqrt(zoom), aspect);
                          saveMarker(u.id, point);
                        }}
                        onPointerDown={e => {
                          if (e.button !== 0 || dotSaving || drawing || tracing || cropping) return;
                          e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
                          suppressClick.current = false;
                          dotGesture.current = { unitId: u.id, start: { x: e.clientX, y: e.clientY }, point: layout, moved: false };
                        }}
                        onPointerMove={e => {
                          const gesture = dotGesture.current;
                          if (!gesture || gesture.unitId !== u.id) return;
                          e.stopPropagation();
                          if (Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) < 4 && !gesture.moved) return;
                          const pt = toPlanCoords(e.clientX, e.clientY);
                          if (!pt) return;
                          gesture.moved = true;
                          gesture.point = moveMarkerInside(u.polygon!, pt, 0.019 / Math.sqrt(zoom), aspect);
                          setSelectedId(u.id); setHover(null);
                          setDotDraft({ unitId: u.id, ...gesture.point });
                        }}
                        onPointerUp={e => {
                          const gesture = dotGesture.current;
                          if (!gesture || gesture.unitId !== u.id) return;
                          e.stopPropagation(); dotGesture.current = null;
                          suppressClick.current = gesture.moved;
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                          if (gesture.moved) saveMarker(u.id, gesture.point);
                        }}
                        onPointerCancel={() => { dotGesture.current = null; setDotDraft(null); }}>
                        <title>{label}{u.tenant_name ? ` · ${u.tenant_name}` : ""}{zaStr ? ` · ${zaStr} ZA` : " · Add evidence"}</title>
                        <circle cx={cx} cy={cy} r={R} fill={numberLabels ? "transparent" : typeColour} stroke={numberLabels ? "none" : isSel ? "hsl(var(--foreground))" : "#FFFFFF"} strokeWidth={R * 0.09} />
                        <text x={cx} y={cy - (!numberLabels && zaStr ? R * 0.29 : 0)} textAnchor="middle" dominantBaseline="middle"
                          style={{ fontSize: Math.min(R * (numberLabels ? .75 : .5), R * 2.7 / Math.max(3, label.length)), fontWeight: 700, fill: numberLabels ? "hsl(var(--foreground))" : "#FFFFFF", stroke: numberLabels ? "hsl(var(--background))" : "none", strokeWidth: numberLabels ? R * .12 : 0, paintOrder: "stroke", pointerEvents: "none" }}>{label}</text>
                        {!numberLabels && zaStr && <text x={cx} y={cy + R * 0.37} textAnchor="middle" dominantBaseline="middle"
                          style={{ fontSize: Math.min(R * 0.48, R * 2.7 / zaStr.length), fontWeight: 700, fill: "#FFFFFF", pointerEvents: "none" }}>{zaStr}</text>}
                      </g>
                    );
                  })}
                  {draft.length > 0 && (
                    <polygon points={draft.map(p => `${p.x * 100},${p.y * 100 * aspect}`).join(" ")}
                      fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
                  )}
                  {cropRect && (
                    <rect x={Math.min(cropRect.x0, cropRect.x1) * 100} y={Math.min(cropRect.y0, cropRect.y1) * 100 * aspect}
                      width={Math.abs(cropRect.x1 - cropRect.x0) * 100} height={Math.abs(cropRect.y1 - cropRect.y0) * 100 * aspect}
                      fill="hsl(215 70% 45% / 0.12)" stroke="hsl(215 70% 45%)" strokeWidth={0.3} strokeDasharray="1.2 0.8" vectorEffect="non-scaling-stroke" />
                  )}
                </svg>
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute right-3 top-3 flex flex-col gap-1">
            <Button aria-label="Zoom in" variant="outline" size="icon" className="h-11 w-11 bg-card" onClick={() => setZoom(z => Math.min(maxZoom, z * 1.3))} data-testid="button-zoom-in"><ZoomIn className="w-4 h-4" /></Button>
            <Button aria-label="Zoom out" variant="outline" size="icon" className="h-11 w-11 bg-card" onClick={() => setZoom(z => Math.max(0.5, z / 1.3))} data-testid="button-zoom-out"><ZoomOut className="w-4 h-4" /></Button>
            <Button aria-label="Fit whole plan" variant="outline" size="icon" className="h-11 w-11 bg-card text-[11px] font-semibold" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} data-testid="button-zoom-reset">Fit</Button>
            <Button aria-label="Actual image size" title="One source pixel per screen pixel" variant="outline" size="icon" className="h-11 w-11 bg-card text-[11px] font-semibold" onClick={() => { setZoom(actualSizeZoom); setPan({ x: 0, y: 0 }); }} data-testid="button-actual-size">100%</Button>
          </div>
          {(drawing || tracing) && (
            <div className="absolute left-3 right-16 top-3 max-w-lg rounded-xl bg-card border border-border p-3 text-sm shadow-sm">
              <p>{tracing ? "Click a clear area inside the unit to trace its boundary." : `${redrawId ? "Redraw the unit" : "Draw a unit"}: click each corner, then Finish outline.`}</p>
              <div className="mt-2 flex gap-2 flex-wrap">
                {drawing && <><Button size="sm" disabled={draft.length < 3} onClick={finishOutline} data-testid="button-finish-outline">Finish outline</Button>
                <Button variant="outline" size="sm" disabled={!draft.length} onClick={() => setPoints(draftRef.current.slice(0, -1))} data-testid="button-undo-point">Undo point</Button>
                <span className="font-mono text-muted-foreground self-center">{draft.length} points</span></>}
                <Button variant="ghost" size="sm" onClick={stopDrawing} data-testid="button-cancel-drawing">Cancel</Button>
              </div>
            </div>
          )}
          {dotSaving && <div className="absolute bottom-3 left-3 rounded-lg bg-card border border-border px-3 py-2 text-sm" role="status">Saving label…</div>}
          {isMobile && !drawing && !tracing && <Button variant="outline" className="absolute bottom-3 left-3 bg-card" onClick={() => setDetailsOpen(true)} data-testid="button-plan-details">{selected ? `Unit ${selected.unit_ref}` : "Units & evidence"}</Button>}
          {cropping && (
            <div className="absolute left-3 top-3 rounded-md bg-card border border-border px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm">
              Crop: drag over the part of the plan to keep — release to confirm.
              <button className="ml-2 underline" onClick={() => { setCropping(false); setCropRect(null); }}>cancel</button>
            </div>
          )}

          {/* Hover card — the artifact-style pop-up */}
          {hover && overlaysVisible && !drawing && !tracing && !isMobile && !dotGesture.current && (() => {
            const u = units.find(x => x.id === hover.unitId);
            if (!u) return null;
            const latest = latestEntryByUnit.get(u.id);
            const za = latestZaByUnit.get(u.id);
            const tk = evidenceTypeKey(latest?.transaction_type);
            const evCount = evidenceCountByUnit.get(u.id) || 0;
            return (
              <div className="absolute z-20 pointer-events-none rounded-xl border border-border bg-card shadow-lg px-3 py-2.5 w-[230px]"
                style={{
                  left: Math.max(8, Math.min(hover.x + 14, (canvasRef.current?.clientWidth || 400) - 240)),
                  top: Math.max(8, Math.min(hover.y + 14, (canvasRef.current?.clientHeight || 300) - 160)),
                }}>
                <div className="flex items-center gap-1.5">
                  {latest && (
                    <span className="text-[11px] font-bold uppercase tracking-wider text-white rounded px-1 py-0.5"
                      style={{ background: colourOf(tk) }}>
                      {EVIDENCE_TYPE_META[tk].label}
                    </span>
                  )}
                  <span className="text-sm font-bold truncate">{u.unit_ref}</span>
                </div>
                {u.tenant_name && u.tenant_name !== u.unit_ref && <div className="text-[11px] text-muted-foreground truncate">{u.tenant_name}</div>}
                {za != null ? (
                  <div className="mt-1">
                    <span className="text-lg font-bold tabular-nums" style={{ color: colourOf(tk) }}>
                      £{za.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>{" "}
                    <span className="text-[11px] text-muted-foreground">Zone A</span>
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] text-muted-foreground">No evidence yet</div>
                )}
                <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  {latest?.transaction_date && <><span>Evidence date</span><span className="text-foreground">{fmtDate(latest.transaction_date)}</span></>}
                  {latest?.size_sqft != null && <><span>Size</span><span className="text-foreground">{Number(latest.size_sqft).toLocaleString("en-GB")} sq ft</span></>}
                  {u.lease_expiry && <><span>Lease expiry</span><span className="text-foreground">{fmtDate(u.lease_expiry)}</span></>}
                  {evCount > 1 && <><span>Evidence entries</span><span className="text-foreground">{evCount}</span></>}
                </div>
              </div>
            );
          })()}

        </div>

        {/* Unit panel */}
        {isMobile ? <Sheet open={detailsOpen && !cleanPlan} onOpenChange={setDetailsOpen}>
          <SheetContent side="bottom" hideClose={!!selected} className="max-h-[80dvh] overflow-y-auto p-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
            <SheetHeader className={selected ? "sr-only" : "px-4 pt-4"}><SheetTitle>{selected ? `Unit ${selected.unit_ref}` : "Units & evidence"}</SheetTitle></SheetHeader>
            {selected ? <UnitPanel key={selected.id} unit={selected} entries={selectedEntries} planId={planId} scheduleRows={data?.schedule_rows || []}
              placement={outlineDisplay.placement.get(selected.id)} onReviewScan={() => { setDetailsOpen(false); setScanReviewOpen(true); }}
              matters={matters.filter(m => m.unit_norm && m.unit_norm === (selected.unit_norm || normRef(selected.unit_ref)))}
              onClose={() => { setSelectedId(null); setDetailsOpen(false); }}
              onSave={patch => saveUnit.mutateAsync({ id: selected.id, patch })}
              onRedraw={mode => { stopDrawing(); draftBackgroundKey.current = activeLevel?.background_key || null; setRedrawId(selected.id); setDrawing(mode === "draw"); setTracing(mode === "trace"); setDetailsOpen(false); }}
              onDeleted={() => { setSelectedId(null); invalidate(); }} />
              : <div className="p-4"><UnitList units={levelUnits} entries={entries} placement={outlineDisplay.placement} search={unitSearch} onSearch={setUnitSearch} onSelect={selectUnit} /><UnlinkedEvidence entries={entries} units={units} levels={levels} onSaved={invalidate} /></div>}
          </SheetContent>
        </Sheet> : <div className={cleanPlan ? "hidden" : "w-[380px] shrink-0 border-l border-border overflow-y-auto bg-background"}>
          {!selected ? (
            <div className="p-4">
              {/* Mock-up style: the panel is the level's evidence list until
                  a unit is picked — hover or tap a marker, or pick a row. */}
              <h3 className="text-sm font-semibold mb-1">Units · {activeLevel?.name || "this level"}</h3>
              <p className="text-sm text-muted-foreground mb-3">Select a boundary or label to enter information. Drag a label to move it within its unit.</p>
              <UnitList units={levelUnits} entries={entries} placement={outlineDisplay.placement} search={unitSearch} onSearch={setUnitSearch} onSelect={selectUnit} />
              <UnlinkedEvidence entries={entries} units={units} levels={levels} onSaved={invalidate} />

            </div>
          ) : (
            <UnitPanel key={selected.id} unit={selected} entries={selectedEntries} planId={planId} scheduleRows={data?.schedule_rows || []}
              placement={outlineDisplay.placement.get(selected.id)} onReviewScan={() => setScanReviewOpen(true)}
              matters={matters.filter(m => m.unit_norm && m.unit_norm === (selected.unit_norm || normRef(selected.unit_ref)))}
              onClose={() => setSelectedId(null)}
              onSave={(patch) => saveUnit.mutateAsync({ id: selected.id, patch })}
              onRedraw={mode => { stopDrawing(); draftBackgroundKey.current = activeLevel?.background_key || null; setRedrawId(selected.id); setDrawing(mode === "draw"); setTracing(mode === "trace"); }}
              onDeleted={() => { setSelectedId(null); invalidate(); }} />
          )}
        </div>}
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
          <p className="text-sm text-muted-foreground">Matched units use this property's tenancy schedule. You can select a schedule row and edit its lease facts from the unit panel. Unmatched units keep their manually entered information.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} data-testid="button-save-property-link">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlinkedEvidence({ entries, units, levels, onSaved, initiallyOpen = false }: { entries: Entry[]; units: PlanUnit[]; levels: PlanLevel[]; onSaved: () => void; initiallyOpen?: boolean }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(initiallyOpen);
  const unlinkedCount = entries.filter(entry => !entry.unit_id).length;
  const matches = entries.filter(entry => !entry.unit_id && `${entry.unit_ref || ""} ${entry.tenant || ""}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / 6));
  const currentPage = Math.min(page, pages - 1);
  if (!unlinkedCount) return null;
  return (
                <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground" data-testid="unlinked-evidence">
                  <summary className="cursor-pointer font-medium">
                    {unlinkedCount} evidence entr{unlinkedCount === 1 ? "y" : "ies"} not matched to a unit — open to match them
                  </summary>
                  <p className="mt-1.5 mb-2 text-sm text-muted-foreground">Choose the correct unit for each entry. Clear, unique matches are linked automatically when an outline is added.</p>
                  {open && <>
                  <Input aria-label="Search unlinked evidence" placeholder="Find evidence by unit or tenant…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="mb-2" />
                  <div className="space-y-2">
                    {matches.slice(currentPage * 6, currentPage * 6 + 6).map(e => (
                      <div key={e.id} className="rounded-md bg-card border border-border px-2 py-1.5 text-foreground">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold truncate">{e.unit_ref || e.tenant || "—"}</span>
                          <span className="text-[11px] font-bold tabular-nums shrink-0">{e.zone_a != null ? `£${Number(e.zone_a).toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{EVIDENCE_TYPE_META[evidenceTypeKey(e.transaction_type)].label}{e.transaction_date ? ` · ${fmtDate(e.transaction_date)}` : ""}{e.tenant && e.tenant !== e.unit_ref ? ` · ${e.tenant}` : ""}</div>
                        <select
                          aria-label={`Link evidence ${e.unit_ref || e.tenant || e.id} to unit`} className="mt-1 w-full min-h-11 rounded border border-input bg-background px-2 text-sm"
                          value=""
                          onChange={async ev => {
                            const unitId = ev.target.value;
                            if (!unitId) return;
                            try {
                              const r = await apiRequest("PUT", `/api/evidence-plans/entries/${e.id}`, { unitId });
                              if (!r.ok) throw new Error((await r.json()).error || "failed");
                              onSaved();
                            } catch (err: any) { toast({ title: "Couldn't link", description: err.message, variant: "destructive" }); }
                          }}
                          data-testid={`link-entry-${e.id}`}>
                          <option value="">Link to unit…</option>
                          {[...units].sort((a, b) => String(a.unit_ref).localeCompare(String(b.unit_ref), undefined, { numeric: true })).map(u => (
                            <option key={u.id} value={u.id}>{u.unit_ref}{levels.length > 1 ? ` (${levels.find(l => l.id === u.level_id)?.name || "?"})` : ""}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  {!matches.length && <p className="text-sm text-muted-foreground">No evidence matches this search.</p>}
                  {pages > 1 && <div className="mt-3 flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous evidence</Button><span className="font-mono text-[11px]">{currentPage + 1} / {pages}</span><Button variant="outline" size="sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next evidence</Button></div>}
                  </>}
                </details>
  );
}

function UnitList({ units, entries, placement, search, onSearch, onSelect }: {
  units: PlanUnit[]; entries: Entry[]; placement: Map<string, OutlinePlacement>; search: string; onSearch: (value: string) => void; onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [needsPlacementOnly, setNeedsPlacementOnly] = useState(false);
  const needsPlacement = units.filter(unit => ["unplaced", "needs_review"].includes(placement.get(unit.id) || "unplaced"));
  useEffect(() => setPage(0), [search, units.length, needsPlacementOnly]);
  const matches = (needsPlacementOnly ? needsPlacement : units).filter(u => `${u.unit_ref} ${u.tenant_name || ""}`.toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 12) - 1));
  return <div className="space-y-2 mb-4">
    <div className="flex gap-2 flex-wrap"><Pill active={!needsPlacementOnly} onClick={() => setNeedsPlacementOnly(false)} data-testid="unit-list-all">All units · <span className="font-mono tabular-nums">{units.length}</span></Pill><Pill active={needsPlacementOnly} onClick={() => setNeedsPlacementOnly(true)} data-testid="unit-list-needs-placement">Needs placement · <span className="font-mono tabular-nums">{needsPlacement.length}</span></Pill></div>
    {!!needsPlacement.length && <p className="text-[11px] text-muted-foreground">Unreviewed old outlines are kept off the plan. Their units and evidence remain here to edit or place using Review scan.</p>}
    <Input aria-label="Search units" placeholder="Find unit or tenant…" value={search} onChange={e => onSearch(e.target.value)} data-testid="input-unit-search" />
    <p className="text-[11px] text-muted-foreground font-mono">{matches.length} units</p>
    {matches.slice(currentPage * 12, currentPage * 12 + 12).map(unit => {
      const evidence = entries.filter(e => e.unit_id === unit.id);
      return <button key={unit.id} data-testid={`unit-row-${unit.id}`} onClick={() => onSelect(unit.id)} className="w-full min-h-11 text-left border border-border rounded-xl bg-card p-3 hover:border-primary">
        <span className="block font-semibold text-sm">{unit.unit_ref}</span>
        <span className="block text-[11px] text-muted-foreground">{unit.tenant_name || "Tenant not entered"} · {evidence.length ? `${evidence.length} evidence entries` : "Add information"}</span>
        {placement.get(unit.id) === "needs_review" && <span className="block text-[11px] text-muted-foreground mt-1">Outline needs review · select to inspect</span>}
        {placement.get(unit.id) === "unplaced" && <span className="block text-[11px] text-muted-foreground mt-1">No outline placed</span>}
      </button>;
    })}
    {!matches.length && <p className="text-sm text-muted-foreground">{units.length ? "No units match your search." : "No units yet — trace a unit or draw its boundary."}</p>}
    {matches.length > 12 && <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="font-mono text-[11px]">{currentPage + 1} / {Math.ceil(matches.length / 12)}</span><Button variant="outline" size="sm" disabled={(currentPage + 1) * 12 >= matches.length} onClick={() => setPage(currentPage + 1)}>Next</Button></div>}
  </div>;
}

// ── Unit side panel ───────────────────────────────────────────────────────
function UnitPanel({ unit, entries, planId, matters = [], scheduleRows, placement, onReviewScan, onClose, onSave, onDeleted, onRedraw }: {
  unit: PlanUnit; entries: Entry[]; planId: string; matters?: Matter[]; scheduleRows: any[];
  placement?: OutlinePlacement; onReviewScan: () => void;
  onClose: () => void; onSave: (patch: any) => Promise<unknown>; onDeleted: () => void; onRedraw: (mode: "draw" | "trace") => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [originalForm, setOriginalForm] = useState<any>({});
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [ev, setEv] = useState<any>({});
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [evidenceSaving, setEvidenceSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [evidenceError, setEvidenceError] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [editScheduleId, setEditScheduleId] = useState<string | null>(null);
  const [editScheduleVersion, setEditScheduleVersion] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(unit.ts_link_status === "ambiguous" || unit.ts_link_status === "stale-link");
  const scheduleChoice = scheduleRows.find(row => row.id === scheduleId);
  const suggestedScheduleRows = scheduleRows.filter(row => unit.ts_candidate_ids?.includes(row.id));
  const ambiguousSchedule = unit.ts_link_status === "ambiguous";
  const otherDifferences = (unit.ts_conflicts || []).filter(item => !["unit_number", "tenant_name", "trading_name", "floor_level", "passing_rent_pa", "lease_expiry", "break_date", "next_review_date", "erv_pa", "nia_sqft", "gia_sqft", "saved_tenant"].includes(item.field));
  const differenceValue = (row: any, field: string) => {
    const value = row[field];
    if (value === null || value === undefined || value === "") return "Not recorded";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
    if (field.endsWith("_date") || ["lease_start", "lease_expiry"].includes(field)) return fmtDate(value);
    return typeof value === "number" ? value.toLocaleString("en-GB") : String(value);
  };

  const startEdit = () => {
    const values = {
      unitRef: unit.unit_ref, tenantName: unit.tenant_name || "",
      leaseExpiry: unit.lease_expiry?.slice(0, 10) || "", breakDate: unit.break_date?.slice(0, 10) || "",
      reviewDate: unit.review_date?.slice(0, 10) || "", erv: unit.erv ?? "", passingRent: unit.passing_rent ?? "",
      sqft: unit.sqft ?? "", notes: unit.notes || "",
    };
    setForm(values); setOriginalForm(values);
    setEditScheduleId(unit.ts_row_id || null);
    setEditScheduleVersion(unit.ts_row_updated_at || null);
    setSaveError("");
    setEditing(true);
  };

  const removeUnit = async () => {
    if (!window.confirm(`Delete unit ${unit.unit_ref} from the plan? Its evidence entries are kept (unlinked).`)) return;
    await apiRequest("DELETE", `/api/evidence-plans/units/${unit.id}`, undefined);
    onDeleted();
  };

  const saveFacts = async () => {
    setSaving(true); setSaveError("");
    const changed = Object.fromEntries(Object.entries(form).filter(([key, value]) => String(value ?? "") !== String(originalForm[key] ?? "")));
    try {
      if (Object.keys(changed).length) await onSave({ ...changed, scheduleRowId: editScheduleId, scheduleRowUpdatedAt: editScheduleVersion });
      setEditing(false);
    }
    catch (error: any) { setSaveError(error.message || "Couldn't save. Your changes are kept here."); }
    finally { setSaving(false); }
  };
  const linkSchedule = async () => {
    if (!scheduleId) return;
    setSaving(true); setSaveError("");
    try { await onSave({ linkScheduleRowId: scheduleId, expectedScheduleRowId: unit.ts_row_id || null,
      expectedTenancyUnitId: unit.tenancy_unit_id || null, expectedTargetUpdatedAt: scheduleChoice?.updated_at || null }); setScheduleId(""); }
    catch (error: any) { setSaveError(error.message); }
    finally { setSaving(false); }
  };
  const startEvidence = (entry?: Entry) => {
    setEditingEvidenceId(entry?.id || null); setEvidenceError("");
    setEv(entry ? { tenant: entry.tenant || "", transactionType: entry.transaction_type || "", transactionDate: entry.transaction_date?.slice(0, 10) || "", sizeSqft: entry.size_sqft ?? "", zoneA: entry.zone_a ?? "", itza: entry.itza ?? "", headlineRent: entry.headline_rent ?? "", netEffective: entry.net_effective ?? "", notes: entry.notes || "" } : {});
    setAddingEvidence(true);
  };
  const addEvidence = async () => {
    setEvidenceSaving(true); setEvidenceError("");
    try {
      const r = await apiRequest(editingEvidenceId ? "PUT" : "POST", editingEvidenceId ? `/api/evidence-plans/entries/${editingEvidenceId}` : `/api/evidence-plans/${planId}/entries`, { ...ev, unitId: unit.id, unitRef: unit.unit_ref });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      setAddingEvidence(false);
      setEv({});
      queryClient.invalidateQueries({ queryKey: ["/api/evidence-plans", planId] });
    } catch (e: any) {
      setEvidenceError(e.message);
    } finally { setEvidenceSaving(false); }
  };

  const fact = (label: string, value: string) => (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-mono tabular-nums">{value}</div>
    </div>
  );
  const field = (label: string, key: string, type: "text" | "date" | "number" = "text") => (
    <div>
      <label htmlFor={`unit-field-${key}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input id={`unit-field-${key}`} data-testid={`unit-field-${key}`} type={type} step={type === "number" ? "any" : undefined} value={form[key] ?? ""} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))} className="mt-0.5 min-h-11 text-sm" />
    </div>
  );
  const evField = (label: string, key: string, type: "text" | "date" | "number" = "text") => (
    <div>
      <label htmlFor={`evidence-field-${key}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input id={`evidence-field-${key}`} data-testid={`evidence-field-${key}`} type={type} step={type === "number" ? "any" : undefined} value={ev[key] ?? ""} onChange={e => setEv((f: any) => ({ ...f, [key]: e.target.value }))} className="mt-0.5 min-h-11 text-sm" />
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight break-words">{unit.unit_ref}</h2>
          <p className="text-[11px] text-muted-foreground">{unit.tenant_name || "No tenant on record"}{unit.sqft ? ` · ${Number(unit.sqft).toLocaleString("en-GB")} sq ft` : ""}</p>
        </div>
        <div className="flex items-center gap-1">
          {!editing && <Button variant="ghost" size="sm" className="min-h-11 px-2" onClick={startEdit} data-testid="button-edit-unit">Edit</Button>}
          <Button aria-label="Delete unit" variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground" onClick={removeUnit} data-testid="button-delete-unit"><Trash2 className="w-4 h-4" /></Button>
          <Button aria-label="Close unit" variant="ghost" size="icon" className="h-11 w-11" onClick={onClose} data-testid="button-close-unit"><X className="w-4 h-4" /></Button>
        </div>
      </div>

      {(placement === "needs_review" || placement === "unplaced") && <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2" data-testid="unit-placement-review">
        <p className="text-sm">{placement === "needs_review" ? "This old outline needs review. The dashed shape is an inspection preview; it is not used to position a label." : "This unit has no placed outline."} You can edit all its information and evidence below.</p>
        <Button variant="outline" size="sm" onClick={onReviewScan}>Review scan to place unit</Button>
      </div>}
      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {field("Unit ref", "unitRef")}
            <>
              {field(unit.ts_linked ? "Trading name" : "Tenant", "tenantName")}
              {field("Lease expiry", "leaseExpiry", "date")}
              {field("Break", "breakDate", "date")}
              {field("Next review", "reviewDate", "date")}
              {field("Size sq ft", "sqft", "number")}
              {field("ERV £pa", "erv", "number")}
              {field("Passing £pa", "passingRent", "number")}
            </>
          </div>
          {unit.ts_linked && <p className="text-sm text-muted-foreground">Saving these lease facts updates this unit's linked tenancy-schedule row.</p>}
          {field("Notes", "notes")}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={saveFacts} data-testid="button-save-unit">{saving ? "Saving…" : "Save"}</Button>
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
          {unit.ts_linked && <p className="text-[11px] text-muted-foreground mt-2">Live from the property's tenancy schedule</p>}
        </div>
      )}
      {saveError && <p role="alert" className="text-sm text-destructive" data-testid="unit-save-error">{saveError}</p>}
      {!editing && unit.notes && <div className="rounded-xl border border-border p-3"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</h3><p className="text-sm whitespace-pre-wrap break-words">{unit.notes}</p></div>}
      {!editing && <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => onRedraw("draw")} data-testid="button-redraw-unit">Redraw boundary</Button>
        <Button variant="outline" size="sm" onClick={() => onRedraw("trace")} data-testid="button-trace-boundary">Trace boundary</Button>
      </div>}
      {!editing && (scheduleRows.length > 0 || unit.tenancy_unit_id) && <details open={scheduleOpen} onToggle={event => setScheduleOpen(event.currentTarget.open)} className="rounded-xl border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">{unit.ts_linked ? "Change schedule link" : "Link schedule row"}</summary>
        {ambiguousSchedule && <p className="mt-2 text-sm" role="status">These schedule entries need a choice. Compare the tenant and lease facts, then select the entry that applies to this unit.</p>}
        {ambiguousSchedule && unit.ts_link_reason && <p className="mt-2 text-xs text-muted-foreground">{unit.ts_link_reason}</p>}
        {unit.ts_link_status === "stale-link" && <p className="mt-2 text-sm" role="status">The linked entry is no longer available on this property. Choose its replacement to restore the lease details.</p>}
        <p className="text-muted-foreground mt-2">Choose the matching entry once. This outline will keep its link to that entry, including after a reimport. Its plan label and evidence stay attached.</p>
        {ambiguousSchedule && suggestedScheduleRows.length > 0 && <div className="mt-3 space-y-2" data-testid="schedule-match-comparison">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Entries to compare</h3>
          {suggestedScheduleRows.slice(0, 6).map((row, index) => <div key={row.id} className={`rounded-lg border bg-card p-3 space-y-2 ${scheduleId === row.id ? "border-primary" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground">Entry <span className="font-mono tabular-nums">{index + 1}</span>{row.floor_level ? ` · ${row.floor_level}` : ""}</p>
            <p className="font-semibold break-words">{row.unit_number} · {row.trading_name || row.tenant_name || "No tenant entered"}</p>
            {row.tenant_name && row.tenant_name !== row.trading_name && <p className="text-[11px] text-muted-foreground break-words">Legal tenant: {row.tenant_name}</p>}
            <div className="grid grid-cols-2 gap-2">{fact("Passing rent", fmtMoney(row.passing_rent_pa))}{fact("Lease expiry", fmtDate(row.lease_expiry))}{fact("Break", fmtDate(row.break_date))}{fact("Next review", fmtDate(row.next_review_date))}{fact("ERV", fmtMoney(row.erv_pa))}{fact("Size", row.nia_sqft != null || row.gia_sqft != null ? `${Number(row.nia_sqft ?? row.gia_sqft).toLocaleString("en-GB")} sq ft` : "—")}</div>
            {otherDifferences.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">{otherDifferences.length} other {otherDifferences.length === 1 ? "difference" : "differences"}</summary><dl className="mt-2 space-y-2">{otherDifferences.map(item => <div key={item.field}><dt className="capitalize text-muted-foreground">{item.label}</dt><dd className="break-words">{differenceValue(row, item.field)}</dd></div>)}</dl></details>}
            <Button variant="outline" size="sm" disabled={saving} aria-pressed={scheduleId === row.id} onClick={() => setScheduleId(row.id)} data-testid={`choose-schedule-${row.id}`}>{scheduleId === row.id ? "Entry selected" : "Use this entry"}</Button>
          </div>)}
          {suggestedScheduleRows.length > 6 && <p className="text-[11px] text-muted-foreground">More matches are available in the search below.</p>}
        </div>}
        <Input aria-label="Search tenancy schedule rows" placeholder="Find unit or tenant…" value={scheduleSearch} onChange={e => setScheduleSearch(e.target.value)} className="mt-2" />
        <select aria-label="Tenancy schedule row" className="w-full min-h-11 mt-2 rounded-md border border-input bg-background px-2" value={scheduleId} onChange={e => setScheduleId(e.target.value)} data-testid="select-unit-schedule">
          <option value="">Choose a schedule row…</option>
          {scheduleRows.filter(row => row.id === scheduleId || `${row.unit_number || ""} ${row.trading_name || ""} ${row.tenant_name || ""}`.toLowerCase().includes(scheduleSearch.toLowerCase())).map(row => <option key={row.id} value={row.id}>{row.unit_number} · {row.trading_name || row.tenant_name || "No tenant"}{row.floor_level ? ` · ${row.floor_level}` : ""} · {fmtMoney(row.passing_rent_pa)} · expires {fmtDate(row.lease_expiry)} · {row.id.slice(-6)}</option>)}
        </select>
        {scheduleChoice && <div className="mt-3 border border-border rounded-lg p-3 space-y-2" data-testid="schedule-choice-preview">
          <p className="font-semibold break-words">{scheduleChoice.unit_number} · {scheduleChoice.trading_name || "Trading name not entered"}</p>
          <p className="text-[11px] text-muted-foreground break-words">Legal tenant: {scheduleChoice.tenant_name || "Not entered"}{scheduleChoice.floor_level ? ` · ${scheduleChoice.floor_level}` : ""}</p>
          <div className="grid grid-cols-2 gap-2">{fact("Passing rent", fmtMoney(scheduleChoice.passing_rent_pa))}{fact("Lease expiry", fmtDate(scheduleChoice.lease_expiry))}{fact("ERV", fmtMoney(scheduleChoice.erv_pa))}{fact("Size", scheduleChoice.nia_sqft ?? scheduleChoice.gia_sqft ? `${Number(scheduleChoice.nia_sqft ?? scheduleChoice.gia_sqft).toLocaleString("en-GB")} sq ft` : "—")}</div>
        </div>}
        <Button className="mt-2" size="sm" disabled={!scheduleId || saving} onClick={linkSchedule} data-testid="button-link-unit-schedule">{saving ? "Saving link…" : "Link schedule row"}</Button>
      </details>}

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
          <Button variant="ghost" size="sm" className="min-h-11 px-2" onClick={() => startEvidence()} data-testid="button-add-evidence">
            <Plus className="w-3 h-3 mr-0.5" /> Add evidence
          </Button>
        </div>

        {addingEvidence && (
          <div className="rounded-xl border border-border bg-card p-3 mb-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {evField("Tenant", "tenant")}
              <div><label htmlFor="evidence-field-transactionType" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Transaction type</label>
                <select id="evidence-field-transactionType" data-testid="evidence-field-transactionType" className="w-full min-h-11 rounded-md border border-input bg-background px-2 text-sm mt-0.5" value={ev.transactionType || ""} onChange={e => setEv((v: any) => ({ ...v, transactionType: e.target.value }))}>
                  <option value="">Choose type…</option><option value="OML">Open market letting</option><option value="Lease renewal">Lease renewal</option><option value="Rent review">Rent review</option><option value="Re-gear">Re-gear</option><option value="Other">Other</option>
                  {ev.transactionType && !["OML", "Lease renewal", "Rent review", "Re-gear", "Other"].includes(ev.transactionType) && <option value={ev.transactionType}>{ev.transactionType}</option>}
                </select></div>
              {evField("Date", "transactionDate", "date")}
              {evField("Size sq ft", "sizeSqft", "number")}
              {evField("Zone A £psf", "zoneA", "number")}
              {evField("ITZA", "itza", "number")}
              {evField("Headline £pa", "headlineRent", "number")}
              {evField("Net effective £pa", "netEffective", "number")}
            </div>
            {evField("Notes", "notes")}
            {evidenceError && <p role="alert" className="text-sm text-destructive">{evidenceError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={evidenceSaving} onClick={() => setAddingEvidence(false)}>Cancel</Button>
              <Button size="sm" disabled={evidenceSaving} onClick={addEvidence} data-testid="button-save-evidence">{evidenceSaving ? "Saving…" : "Save evidence"}</Button>
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
                  <Button variant="ghost" size="sm" onClick={() => startEvidence(e)} data-testid={`button-edit-evidence-${e.id}`}>Edit evidence</Button>
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
  if (matched && params?.id) return <PlanView key={params.id} planId={params.id} />;
  return <PlanList />;
}
