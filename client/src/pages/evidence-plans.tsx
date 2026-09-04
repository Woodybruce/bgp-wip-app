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
import { Map as MapIcon, Plus, Upload, ZoomIn, ZoomOut, Pencil, Trash2, FileSpreadsheet, FileText, X, Loader2, Maximize2, Minimize2, Sparkles, Crop as CropIcon } from "lucide-react";

type Pt = { x: number; y: number };
type PlanLevel = {
  id: string; name: string; background_key: string | null;
  background_width: number | null; background_height: number | null;
};
type PlanUnit = {
  id: string; unit_ref: string; unit_norm?: string; ts_linked?: boolean;
  tenant_name: string | null; level_id: string | null; polygon: Pt[] | null; dot?: Pt | null;
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

// Evidence transaction types → dot colour + key label. Colours picked to
// hold against the teal-heavy plan artwork.
const evidenceTypeKey = (t: string | null | undefined): "OML" | "LR" | "RR" | "RG" | "OTHER" => {
  const s = String(t || "").toLowerCase();
  if (/oml|open market/.test(s)) return "OML";
  if (/renewal/.test(s)) return "LR";
  if (/review/.test(s)) return "RR";
  if (/re-?gear/.test(s)) return "RG";
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
  const { data, isLoading } = useQuery<{ plan: any; levels: PlanLevel[]; units: PlanUnit[]; entries: Entry[]; matters: Matter[]; jobs: any[] }>({
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
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [cropRect, setCropRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const cropStart = useRef<Pt | null>(null);
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
  const detectRunning = (data?.jobs || []).some((j: any) => j.kind === "detect");
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
  const [dotDraft, setDotDraft] = useState<{ unitId: string; x: number; y: number } | null>(null);
  // UX #137 — the unit-ref used to come from a raw window.prompt(); Esc
  // silently threw the just-drawn outline away. App dialog keeps the
  // polygon on Cancel so it can be re-named rather than redrawn.
  const [pendingPoly, setPendingPoly] = useState<Pt[] | null>(null);
  const [pendingRef, setPendingRef] = useState("");
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

  // Marker declutter (Woody, 2026-09-04: "overlapping") — map-app style.
  // Working in viewBox coordinates (isotropic on screen): higher Zone A
  // places first; a colliding disc is nudged away a little; if there's
  // still no room it collapses to a small plain dot at its true anchor.
  // Radii shrink as you zoom in, so minis graduate to full discs.
  const markerLayout = useMemo(() => {
    const aspect = activeLevel?.background_width ? (activeLevel.background_height || 0) / activeLevel.background_width : 0.7;
    const out = new Map<string, { x: number; y: number; r: number; mini: boolean }>();
    const items = levelUnits
      .filter(u => (evidenceCountByUnit.get(u.id) || 0) > 0 && Array.isArray(u.polygon) && (u.polygon as Pt[]).length >= 3)
      .map(u => {
        const poly = u.polygon as Pt[];
        const dp = dotDraft?.unitId === u.id ? dotDraft
          : (u.dot && typeof u.dot.x === "number" ? u.dot : centroid(poly));
        const za = latestZaByUnit.get(u.id);
        const label = String(u.unit_ref || "");
        const isRealRef = /\d/.test(label) && label.length <= 8;
        const twoLine = isRealRef && showZa && za != null;
        const R = (twoLine ? 1.0 : 0.85) * Math.max(1.15, Math.min(1.9, 2.3 / Math.sqrt(zoom)));
        return { id: u.id, ox: dp.x * 100, oy: dp.y * 100 * aspect, R, za: za ?? -1 };
      })
      .sort((a, b) => b.za - a.za);
    const placed: Array<{ x: number; y: number; r: number }> = [];
    for (const m of items) {
      let x = m.ox, y = m.oy;
      const r = m.R;
      for (let iter = 0; iter < 4; iter++) {
        const hit = placed.find(p => Math.hypot(p.x - x, p.y - y) < p.r + r + 0.15);
        if (!hit) break;
        const d = Math.hypot(hit.x - x, hit.y - y) || 0.01;
        const need = hit.r + r + 0.2 - d;
        x += ((x - hit.x) / d) * need;
        y += ((y - hit.y) / d) * need;
        if (Math.hypot(x - m.ox, y - m.oy) > r * 1.6) break; // don't wander off the unit
      }
      const collides = placed.some(p => Math.hypot(p.x - x, p.y - y) < p.r + r + 0.1);
      const tooFar = Math.hypot(x - m.ox, y - m.oy) > r * 1.6;
      if (collides || tooFar) {
        const miniR = Math.max(0.3, r * 0.3);
        out.set(m.id, { x: m.ox, y: m.oy, r: miniR, mini: true });
        placed.push({ x: m.ox, y: m.oy, r: miniR });
      } else {
        out.set(m.id, { x, y, r, mini: false });
        placed.push({ x, y, r });
      }
    }
    return out;
  }, [levelUnits, evidenceCountByUnit, latestZaByUnit, dotDraft, zoom, activeLevel, showZa]);


  const toPlanCoords = (clientX: number, clientY: number): Pt | null => {
    const el = surfaceRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const addUnit = useMutation({
    mutationFn: async ({ polygon, unitRef }: { polygon: Pt[]; unitRef: string }) => {
      const r = await apiRequest("POST", `/api/evidence-plans/${planId}/units`, { unitRef, polygon, levelId: activeLevel?.id || null });
      return r.json();
    },
    onSuccess: (u: any) => {
      setPendingPoly(null);
      setPendingRef("");
      invalidate();
      setSelectedId(u.id);
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
        toast({ title: "Tenancy schedule imported", description: j.message || `${j.imported} rows imported to ${plan?.property_name || "the property"} — plan units pick the facts up automatically.` });
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

  return (
    <div ref={fsRef} className="flex flex-col h-[calc(100dvh-var(--mobile-top,0px))] md:h-full bg-background">
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
          {detectRunning ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground rounded-full border border-border px-2.5 py-1" data-testid="detect-indicator">
              <Sparkles className="w-3 h-3" /> AI reading the plan… units appear as it finishes
            </span>
          ) : hasBg ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy !== null}
              onClick={async () => {
                if (!window.confirm(`Re-detect the units on ${activeLevel?.name || "this level"}? AI-drawn outlines are replaced (their evidence relinks to the new ones); hand-drawn units are kept.`)) return;
                try {
                  const r = await apiRequest("POST", `/api/evidence-plans/${planId}/detect-units`, { levelId: activeLevel?.id || null });
                  if (!r.ok) throw new Error((await r.json()).error || "failed");
                  invalidate();
                } catch (e: any) { toast({ title: "Couldn't start detection", description: e.message, variant: "destructive" }); }
              }}
              data-testid="button-redetect">
              <Sparkles className="w-3.5 h-3.5 mr-1" /> Re-detect
            </Button>
          ) : null}
          <Pill active={drawing} onClick={() => { setDrawing(d => !d); setDraft([]); }} data-testid="pill-draw-unit">
            <Pencil className="w-3 h-3 mr-1 inline" />{drawing ? "Drawing… (double-click to close)" : "Draw unit"}
          </Pill>
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
          <Button variant={cropping ? "default" : "outline"} size="icon" className="h-8 w-8"
            onClick={() => { setCropping(c => !c); setCropRect(null); setDrawing(false); setDraft([]); }}
            title="Crop plan — drag the area to keep" disabled={!hasBg} data-testid="button-crop-plan">
            <CropIcon className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={toggleFullscreen} title={isFullscreen ? "Exit full screen" : "Full screen"} data-testid="button-fullscreen">
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

      <LinkPropertyDialog open={linkingProperty} onOpenChange={setLinkingProperty} plan={plan} onSaved={invalidate} />

      {/* UX #137 — unit-ref dialog for a just-drawn outline. Closing keeps
          the polygon pending until Discard is chosen explicitly. */}
      <Dialog open={!!pendingPoly} onOpenChange={(o) => { if (!o) { /* keep polygon; just hide */ } }}>
        <DialogContent className="max-w-xs" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-sm">Name this unit</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Unit reference (e.g. A15, N10, E7A)"
            value={pendingRef}
            onChange={(e) => setPendingRef(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && pendingRef.trim() && pendingPoly) addUnit.mutate({ polygon: pendingPoly, unitRef: pendingRef.trim() }); }}
            data-testid="input-unit-ref"
          />
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setPendingPoly(null); setPendingRef(""); }} data-testid="button-discard-outline">
              Discard outline
            </Button>
            <Button size="sm" disabled={!pendingRef.trim() || addUnit.isPending} onClick={() => pendingPoly && addUnit.mutate({ polygon: pendingPoly, unitRef: pendingRef.trim() })} data-testid="button-save-unit-ref">
              {addUnit.isPending ? "Saving…" : "Save unit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <button
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${showZa ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground"}`}
            onClick={() => setShowZa(s => { try { localStorage.setItem("bgp-ep-za", s ? "0" : "1"); } catch {} return !s; })}
            data-testid="button-toggle-za">
            £ ZA
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* Plan canvas */}
        <div
          ref={canvasRef}
          className="relative flex-1 min-h-[45dvh] overflow-hidden bg-muted/30 select-none touch-none"
          onWheel={e => {
            e.preventDefault();
            // Cursor-anchored zoom (the point under the mouse stays put) with
            // gesture-scaled speed — centre-anchored fixed steps felt "very
            // hard to control" (Woody, 2026-09-03). ctrlKey = trackpad pinch.
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
            const nz = Math.min(12, Math.max(0.5, zoom * factor));
            if (nz === zoom) return;
            const k = nz / zoom;
            const mx = e.clientX - rect.left - rect.width / 2;
            const my = e.clientY - rect.top - rect.height / 2;
            setPan(p => ({ x: mx - (mx - p.x) * k, y: my - (my - p.y) * k }));
            setZoom(nz);
          }}
          onPointerDown={e => {
            if (drawing) return;
            if (cropping) {
              const pt = toPlanCoords(e.clientX, e.clientY);
              if (pt) { cropStart.current = pt; setCropRect({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }); }
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              return;
            }
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            dragging.current = { start: { x: e.clientX, y: e.clientY }, panStart: pan, moved: false };
          }}
          onPointerUp={async () => {
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
                  setPendingRef("");
                  setPendingPoly(poly);
                }}
              >
                <img src={`/api/evidence-plans/levels/${activeLevel!.id}/background?v=${encodeURIComponent(activeLevel!.background_key || "")}`} alt="" className="absolute inset-0 w-full h-full" draggable={false} />
                <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${aspect >= 1 ? 100 : 100} ${100 * aspect}`} preserveAspectRatio="none" style={{ pointerEvents: "none" }}>
                  {levelUnits.filter(u => Array.isArray(u.polygon) && u.polygon.length >= 3).map(u => {
                    const poly = u.polygon as Pt[];
                    const pts = poly.map(p => `${p.x * 100},${p.y * 100 * aspect}`).join(" ");
                    const isSel = u.id === selectedId;
                    const isHover = hover?.unitId === u.id;
                    // No visible boxes (Woody, 2026-09-03: misplaced squares
                    // look bad) — the dot is the marker; the outline shows
                    // only on hover (light) or selection (strong, so a wrong
                    // box can be seen and redrawn).
                    return (
                      <g key={u.id} style={{ pointerEvents: "auto", cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); if (!drawing && !dragging.current?.moved) setSelectedId(u.id); }}
                        onMouseMove={e => {
                          const rect = canvasRef.current?.getBoundingClientRect();
                          if (rect) setHover({ unitId: u.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
                        }}
                        onMouseLeave={() => setHover(h => (h?.unitId === u.id ? null : h))}>
                        <polygon points={pts}
                          fill="transparent"
                          stroke={isSel ? "hsl(17 60% 45%)" : isHover ? "hsl(220 10% 35% / 0.6)" : "transparent"}
                          strokeWidth={isSel ? 0.3 : 0.16} strokeDasharray={isSel ? "1 0.5" : undefined} vectorEffect="non-scaling-stroke" />
                      </g>
                    );
                  })}
                  {/* Markers render in their own layer ABOVE every polygon —
                      when each disc lived inside its unit's <g>, a later big
                      unit's transparent polygon sat on top of earlier units'
                      discs and swallowed their clicks (D15 selecting M&S). */}
                  {levelUnits.filter(u => Array.isArray(u.polygon) && u.polygon.length >= 3 && (evidenceCountByUnit.get(u.id) || 0) > 0).map(u => {
                    const poly = u.polygon as Pt[];
                    const c = centroid(poly);
                    const isSel = u.id === selectedId;
                    const za = latestZaByUnit.get(u.id);
                    const latest = latestEntryByUnit.get(u.id);
                    const typeColour = colourOf(evidenceTypeKey(latest?.transaction_type));
                    // Contained marker (Woody, 2026-09-04): a coloured
                    // disc holding the unit ref and Zone A — neater
                    // than dot + floating figure. Anchored to the
                    // frontage; draggable when the unit is selected.
                    const layout = markerLayout.get(u.id);
                    const label = String(u.unit_ref || "");
                    const isRealRef = /\d/.test(label) && label.length <= 8;
                    const zaStr = za != null ? `£${za.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : null;
                    const showFig = showZa && zaStr != null;
                    // A decluttered-away marker renders as a small plain
                    // dot at its true anchor — unless selected, which
                    // always earns the full disc.
                    const mini = !!layout?.mini && !isSel;
                    const twoLine = !mini && isRealRef && showFig;
                    const R = (mini ? layout!.r : (layout?.r ?? (twoLine ? 1.0 : 0.85) * Math.max(1.15, Math.min(1.9, 2.3 / Math.sqrt(zoom))))) * (isSel ? 1.15 : 1);
                    const dp = dotDraft?.unitId === u.id ? { x: dotDraft.x * 100, y: dotDraft.y * 100 * aspect }
                      : isSel && u.dot && typeof u.dot.x === "number" ? { x: u.dot.x * 100, y: u.dot.y * 100 * aspect }
                      : layout ? { x: layout.x, y: layout.y }
                      : { x: c.x * 100, y: c.y * 100 * aspect };
                    const cx = dp.x, cy = dp.y;
                    const refFont = Math.min(R * 0.58, (R * 2.6) / Math.max(2, label.length));
                    const zaFont = zaStr ? Math.min(R * (twoLine ? 0.52 : 0.6), (R * 2.6) / zaStr.length) : 0;
                    return (
                      <g key={`marker-${u.id}`} style={{ pointerEvents: "auto", cursor: isSel ? "grab" : "pointer" }}
                        onClick={e => { e.stopPropagation(); if (!drawing && !dragging.current?.moved) setSelectedId(u.id); }}
                        onMouseMove={e => {
                          const rect = canvasRef.current?.getBoundingClientRect();
                          if (rect) setHover({ unitId: u.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
                        }}
                        onMouseLeave={() => setHover(h => (h?.unitId === u.id ? null : h))}
                        onPointerDown={e => { if (!isSel) return; e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); }}
                        onPointerMove={e => {
                          if (!isSel || e.buttons !== 1) return;
                          e.stopPropagation();
                          const pt = toPlanCoords(e.clientX, e.clientY);
                          if (pt) setDotDraft({ unitId: u.id, x: pt.x, y: pt.y });
                        }}
                        onPointerUp={e => {
                          if (dotDraft?.unitId !== u.id) return;
                          e.stopPropagation();
                          saveUnit.mutate({ id: u.id, patch: { dot: { x: dotDraft.x, y: dotDraft.y } } });
                          setDotDraft(null);
                        }}>
                        <circle cx={cx} cy={cy} r={R} fill={typeColour} stroke="#FFFFFF" strokeWidth={R * 0.09} />
                        {mini ? null : twoLine ? (
                          <>
                            <text x={cx} y={cy - R * 0.32} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: refFont, fontWeight: 700, fill: "#FFFFFF", pointerEvents: "none" }}>{label}</text>
                            <text x={cx} y={cy + R * 0.38} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: zaFont, fontWeight: 700, fill: "#FFFFFF", pointerEvents: "none" }}>{zaStr}</text>
                          </>
                        ) : (
                          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: showFig ? zaFont : (isRealRef ? refFont : Math.min(R * 0.55, (R * 2.6) / 3)), fontWeight: 700, fill: "#FFFFFF", pointerEvents: "none" }}>
                            {showFig ? zaStr : (isRealRef ? label : "£")}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {draft.length > 0 && (
                    <polygon points={draft.map(p => `${p.x * 100},${p.y * 100 * aspect}`).join(" ")}
                      fill="hsl(17 60% 45% / 0.15)" stroke="hsl(17 60% 45%)" strokeWidth={0.3} strokeDasharray="1 0.6" vectorEffect="non-scaling-stroke" />
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
          {cropping && (
            <div className="absolute left-3 top-3 rounded-md bg-card border border-border px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm">
              Crop: drag over the part of the plan to keep — release to confirm.
              <button className="ml-2 underline" onClick={() => { setCropping(false); setCropRect(null); }}>cancel</button>
            </div>
          )}

          {/* Hover card — the artifact-style pop-up */}
          {hover && !drawing && (() => {
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
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white rounded px-1 py-0.5"
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
                    <span className="text-[10px] text-muted-foreground">Zone A</span>
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] text-muted-foreground">No evidence yet</div>
                )}
                <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
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
        <div className="w-full md:w-[380px] border-t md:border-t-0 md:border-l border-border overflow-y-auto bg-background">
          {!selected ? (
            <div className="p-4">
              {/* Mock-up style: the panel is the level's evidence list until
                  a unit is picked — hover or tap a marker, or pick a row. */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Evidence · {activeLevel?.name || "this level"}</h3>
              <p className="text-[11px] text-muted-foreground mb-3">Hover or tap a marker on the plan, or pick from the list.</p>
              {unlinkedCount > 0 && (
                <details className="mb-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300" data-testid="unlinked-evidence">
                  <summary className="cursor-pointer font-medium">
                    {unlinkedCount} evidence entr{unlinkedCount === 1 ? "y" : "ies"} not matched to a unit — open to match them
                  </summary>
                  <p className="mt-1.5 mb-2 text-[10px] opacity-90">Their TAF unit refs don't match any drawn unit. They link themselves when a matching unit appears (Re-detect or Draw unit) — or pick the unit here.</p>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {entries.filter(e => !e.unit_id).map(e => (
                      <div key={e.id} className="rounded-md bg-card border border-border px-2 py-1.5 text-foreground">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold truncate">{e.unit_ref || e.tenant || "—"}</span>
                          <span className="text-[11px] font-bold tabular-nums shrink-0">{e.zone_a != null ? `£${Number(e.zone_a).toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{EVIDENCE_TYPE_META[evidenceTypeKey(e.transaction_type)].label}{e.transaction_date ? ` · ${fmtDate(e.transaction_date)}` : ""}{e.tenant && e.tenant !== e.unit_ref ? ` · ${e.tenant}` : ""}</div>
                        <select
                          className="mt-1 w-full h-6 rounded border border-input bg-background px-1 text-[10px]"
                          value=""
                          onChange={async ev => {
                            const unitId = ev.target.value;
                            if (!unitId) return;
                            try {
                              const r = await apiRequest("PUT", `/api/evidence-plans/entries/${e.id}`, { unitId });
                              if (!r.ok) throw new Error((await r.json()).error || "failed");
                              invalidate();
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
                </details>
              )}
              {(() => {
                const levelUnitIds = new Set(levelUnits.map(u => u.id));
                const list = entries.filter(e => e.unit_id && levelUnitIds.has(e.unit_id));
                if (list.length === 0) return <p className="text-xs text-muted-foreground">No evidence on this level yet — Add TAFs or add it on a unit.</p>;
                return (
                  <div className="space-y-1.5">
                    {list.map(e => {
                      const tk = evidenceTypeKey(e.transaction_type);
                      const unit = units.find(u => u.id === e.unit_id);
                      return (
                        <button key={e.id} onClick={() => setSelectedId(e.unit_id)}
                          className="w-full text-left rounded-xl border border-border bg-card px-3 py-2 hover:border-primary/40 transition-colors flex items-center gap-2.5"
                          data-testid={`evidence-row-${e.id}`}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colourOf(tk) }} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold truncate">{unit?.unit_ref || e.unit_ref || e.tenant}</span>
                            <span className="block text-[10px] text-muted-foreground truncate">{EVIDENCE_TYPE_META[tk].label}{e.transaction_date ? ` · ${fmtDate(e.transaction_date)}` : ""}{e.tenant && unit?.unit_ref !== e.tenant ? ` · ${e.tenant}` : ""}</span>
                          </span>
                          <span className="text-sm font-bold tabular-nums shrink-0">{e.zone_a != null ? `£${Number(e.zone_a).toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
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
