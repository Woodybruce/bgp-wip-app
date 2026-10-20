import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Download, LockKeyhole, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import type { SharedEvidenceEntry, SharedEvidenceLevel, SharedEvidencePlan, SharedEvidenceUnit } from "@shared/evidence-plan-sharing";
import { containedMarker, isValidPolygon } from "@shared/plan-geometry";
import bgpLogo from "@/assets/BGP_BlackHolder_1771853582461.png";

const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#c2baa3] bg-white px-3 py-2 text-sm font-medium text-[#6e0c25] hover:bg-[#eeece1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6e0c25] disabled:cursor-not-allowed disabled:opacity-50";
const number = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : null;
const money = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? `£${number(value)}` : null;
const date = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

// Only use the token-scoped URLs supplied in the public response. Never
// substitute staff endpoints or follow an arbitrary source document URL.
function assetUrl(raw: string | null | undefined, token: string, kind: "levels" | "entries") {
  if (!raw || typeof window === "undefined") return null;
  try {
    const url = new URL(raw, window.location.origin);
    const prefix = `/api/public/evidence-plans/${encodeURIComponent(token)}/${kind}/`;
    const suffix = kind === "levels" ? "/background" : "/document";
    if (url.origin !== window.location.origin || !url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}

function Fields({ fields }: { fields: Array<[string, string | null | undefined]> }) {
  const visible = fields.filter(([, value]) => value != null && value !== "");
  if (!visible.length) return null;
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
    {visible.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-black/60">{label}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>)}
  </dl>;
}

function EvidenceCard({ entry, token, unit, onUnit }: { entry: SharedEvidenceEntry; token: string; unit?: SharedEvidenceUnit; onUnit?: (unit: SharedEvidenceUnit) => void }) {
  const document = assetUrl(entry.documentUrl, token, "entries");
  return <article className="min-w-0 rounded-lg border border-[#c2baa3]/60 bg-white p-4" data-testid={`shared-evidence-${entry.id}`}>
    <h3 className="break-words font-semibold text-[#6e0c25]">{entry.unitRef || unit?.unitRef || "Unlinked evidence"}{entry.tenant ? ` · ${entry.tenant}` : ""}</h3>
    <p className="mb-4 mt-1 text-sm text-black/60">{[entry.transactionType, date(entry.transactionDate)].filter(Boolean).join(" · ") || "Evidence entry"}</p>
    <Fields fields={[
      ["Size (sq ft)", number(entry.sizeSqft)], ["ITZA", number(entry.itza)],
      ["Zone A", money(entry.zoneA)], ["Net Zone A", money(entry.netZoneA)],
      ["Headline rent", money(entry.headlineRent)], ["Net effective rent", money(entry.netEffective)],
      ["Term", entry.term], ["Concession", entry.concession],
    ]} />
    {(document || (unit && onUnit)) && <div className="mt-4 flex flex-wrap gap-2">
      {unit && onUnit && <button type="button" className={buttonClass} onClick={() => onUnit(unit)}>View unit</button>}
      {document && <a className={buttonClass} href={document} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Download className="h-4 w-4" /> Download source document</a>}
    </div>}
    {!unit && <p className="mt-3 text-xs text-black/60">This evidence is not linked to a unit on the plan.</p>}
  </article>;
}

function PlanDrawing({ level, units, selectedId, token, updatedAt, zoom, onUnit, onUnavailable }: {
  level: SharedEvidenceLevel; units: SharedEvidenceUnit[]; selectedId: string | null;
  token: string; updatedAt: string | null; zoom: number;
  onUnit: (unit: SharedEvidenceUnit) => void; onUnavailable: () => void;
}) {
  const source = assetUrl(level.imageUrl, token, "levels");
  const sourceKey = `${source ?? ""}|${updatedAt ?? ""}`;
  const [image, setImage] = useState<{ key: string; url: string; width?: number; height?: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  useEffect(() => {
    setImage(null); setFailed(null);
    if (!source) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    void fetch(source, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("The plan image is unavailable.");
        const blob = await response.blob();
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ key: sourceKey, url: objectUrl });
      }).catch(reason => {
        if (!active || reason?.name === "AbortError") return;
        setFailed(sourceKey);
        onUnavailableRef.current();
      });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, sourceKey]);
  const shown = image?.key === sourceKey ? image : null;
  const width = shown?.width || level.width || 1400;
  const height = shown?.height || level.height || 1000;
  const aspect = height / width;
  const positions = useMemo(() => units.flatMap(unit => {
    const polygon = isValidPolygon(unit.polygon) ? unit.polygon : null;
    const dot = unit.dot && Number.isFinite(unit.dot.x) && Number.isFinite(unit.dot.y) && unit.dot.x >= 0 && unit.dot.x <= 1 && unit.dot.y >= 0 && unit.dot.y <= 1 ? unit.dot : null;
    const point = polygon ? containedMarker(polygon, dot, 0, aspect) : dot;
    return point ? [{ unit, polygon, point }] : [];
  }), [units, aspect]);

  if (!source) return <div className="flex min-h-80 items-center justify-center p-8 text-center text-sm text-black/60">No plan image is available for this floor. You can still choose units and read the approved evidence below.</div>;
  if (!shown) return <div className="flex min-h-80 items-center justify-center p-8 text-sm text-black/60" role="status">{failed === sourceKey ? "Plan image unavailable." : "Loading plan image…"}</div>;
  return <div className="overflow-auto overscroll-contain rounded-b-lg bg-[#eeece1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6e0c25]" style={{ height: "min(65vh, 720px)", minHeight: 320 }} tabIndex={0} role="region" aria-label="Scrollable plan. Zoom in, then scroll to explore." data-testid="shared-plan-viewport">
    <div className="relative bg-white" style={{ width: `${zoom * 100}%`, minWidth: "100%", aspectRatio: `${width} / ${height}` }} data-testid="shared-plan-surface">
      <img src={shown.url} alt={`${level.name} — scheme plan`} className="absolute inset-0 h-full w-full" draggable={false} referrerPolicy="no-referrer"
        onLoad={event => { const img = event.currentTarget; if (img.naturalWidth && img.naturalHeight) setImage(current => current?.key === sourceKey ? { ...current, width: img.naturalWidth, height: img.naturalHeight } : current); }}
        onError={() => onUnavailableRef.current()} />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        {positions.map(({ unit, polygon }) => polygon && <polygon key={unit.id} points={polygon.map(point => `${point.x * 1000},${point.y * 1000}`).join(" ")}
          fill={unit.id === selectedId ? "#6e0c2533" : "#6e0c2508"} stroke={unit.id === selectedId ? "#6e0c25" : "#6e0c2580"} strokeWidth={unit.id === selectedId ? 3 : 1.5} vectorEffect="non-scaling-stroke" className="cursor-pointer" onClick={() => onUnit(unit)} />)}
      </svg>
      {positions.map(({ unit, point }) => <button key={unit.id} type="button" onClick={() => onUnit(unit)} title={`${unit.unitRef}${unit.tenantName ? ` · ${unit.tenantName}` : ""}`} aria-label={`View unit ${unit.unitRef}${unit.tenantName ? `, ${unit.tenantName}` : ""}`} aria-pressed={unit.id === selectedId}
        className={`absolute flex h-7 min-w-7 max-w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 px-1 text-[11px] font-semibold shadow-sm focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6e0c25] ${unit.id === selectedId ? "z-10 border-[#6e0c25] bg-[#fc9f8d] text-[#6e0c25]" : "border-white bg-[#6e0c25] text-white"}`}
        style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} data-testid={`shared-plan-unit-${unit.id}`}><span className="truncate">{unit.unitRef}</span></button>)}
    </div>
  </div>;
}

export default function EvidencePlanSharePage() {
  const [, route] = useRoute("/evidence-plan-share/:token");
  const token = route?.token ?? "";
  const [state, setState] = useState<{ token: string; data: SharedEvidencePlan | null; loading: boolean; error: string }>({ token: "", data: null, loading: true, error: "" });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [levelId, setLevelId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [evidenceScope, setEvidenceScope] = useState<"all" | "unlinked">("all");
  const requestSequence = useRef(0);
  const detailRef = useRef<HTMLElement>(null);
  const data = state.token === token ? state.data : null;
  const loading = state.token !== token || state.loading;
  const failure = state.token === token ? state.error : "";

  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const previousViewport = viewport?.content;
    const previousTitle = document.title;
    if (viewport) viewport.content = "width=device-width,initial-scale=1,viewport-fit=cover";
    return () => { if (viewport && previousViewport !== undefined) viewport.content = previousViewport; document.title = previousTitle; };
  }, []);
  useEffect(() => { document.title = data ? `${data.plan.name} — Evidence plan | BGP` : "Shared evidence plan | BGP"; }, [data?.plan.name]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    setLevelId(null); setSelectedId(null); setZoom(1); setSearch("");
    setState({ token, data: null, loading: !!token, error: token ? "" : "This sharing link is incomplete. Please ask your BGP contact for a new link." });
    if (!token) return;
    const refresh = async () => {
      const version = ++requestSequence.current;
      controller?.abort(); controller = new AbortController();
      try {
        const response = await fetch(`/api/public/evidence-plans/${encodeURIComponent(token)}`, {
          credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(response.status === 404 || response.status === 410
          ? "This link is no longer available. Please ask your BGP contact for a current link."
          : "We cannot confirm access to this plan right now. Please try again.");
        const result: SharedEvidencePlan = await response.json();
        if (!result?.plan || typeof result.plan.name !== "string" || !Array.isArray(result.levels) || !Array.isArray(result.units) || !Array.isArray(result.entries)) throw new Error("This plan could not be loaded. Please try again.");
        if (active && version === requestSequence.current) setState({ token, data: result, loading: false, error: "" });
      } catch (reason) {
        if (!active || version !== requestSequence.current || (reason instanceof Error && reason.name === "AbortError")) return;
        // Do not leave previously approved content visible after access fails.
        const message = reason instanceof Error && /^(This link|This plan|We cannot confirm)/.test(reason.message)
          ? reason.message : "We cannot confirm access to this plan right now. Please try again.";
        setState({ token, data: null, loading: false, error: message });
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onFocus = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(onVisible, 30_000);
    window.addEventListener("focus", onFocus); document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; requestSequence.current++; controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, [token, refreshVersion]);

  const level = data?.levels.find(item => item.id === levelId) ?? data?.levels[0];
  const units = useMemo(() => data?.units.filter(unit => (unit.levelId || data.levels[0]?.id) === level?.id) ?? [], [data, level?.id]);
  const selected = data?.units.find(unit => unit.id === selectedId);
  const unitById = useMemo(() => new Map(data?.units.map(unit => [unit.id, unit]) ?? []), [data]);
  const selectedEvidence = data?.entries.filter(entry => entry.unitId === selected?.id) ?? [];
  const visibleEvidence = data?.entries.filter(entry => (evidenceScope === "all" || !entry.unitId || !unitById.has(entry.unitId))
    && `${entry.unitRef ?? ""} ${entry.tenant ?? ""} ${entry.transactionType ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const unlinkedCount = data?.entries.filter(entry => !entry.unitId || !unitById.has(entry.unitId)).length ?? 0;
  const pickUnit = (unit: SharedEvidenceUnit) => {
    setSelectedId(unit.id);
    const nextLevel = unit.levelId || data?.levels[0]?.id;
    if (nextLevel && nextLevel !== level?.id) { setLevelId(nextLevel); setZoom(1); }
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1023px)").matches) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return <main className="min-h-screen bg-[#f8f9ee] text-black" data-testid="public-evidence-plan">
    <header className="border-b border-[#c2baa3] bg-white px-4 py-5 sm:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
        <img src={bgpLogo} alt="Bruce Gillingham Pollard" className="h-12 max-w-[240px] object-contain object-left" />
        <span className="inline-flex items-center gap-2 rounded-full bg-[#f8f9ee] px-3 py-2 text-sm text-[#6e0c25]"><LockKeyhole className="h-4 w-4" /> Read-only evidence plan</span>
      </div>
    </header>
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-8">
      {loading ? <p role="status" className="py-16 text-center">Loading shared plan…</p> : !data ? <section className="mx-auto max-w-xl rounded-xl border border-[#c2baa3] bg-white p-6 text-center sm:p-10">
        <h1 className="text-2xl font-semibold text-[#6e0c25]">Plan unavailable</h1>
        <p role="alert" className="mt-4 text-sm leading-relaxed">{failure || "This plan is not available. Please contact BGP."}</p>
        {!!token && <button type="button" className={`${buttonClass} mt-6`} onClick={() => setRefreshVersion(value => value + 1)}><RefreshCw className="h-4 w-4" /> Try again</button>}
      </section> : <>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><h1 className="break-words text-2xl font-semibold text-[#6e0c25] sm:text-3xl">{data.plan.name}</h1><p className="mt-2 text-sm text-black/60">{data.units.length} units · {data.entries.length} shared evidence {data.entries.length === 1 ? "entry" : "entries"}{data.plan.updatedAt ? ` · Updated ${date(data.plan.updatedAt)}` : ""}</p></div>
          <p className="max-w-md text-sm text-black/60">View the plan, select a unit and read the evidence approved by your BGP contact.</p>
        </div>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 self-start rounded-lg border border-[#c2baa3] bg-white" aria-label="Scheme plan">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c2baa3]/60 p-3">
              <div className="flex max-w-full flex-wrap gap-2" aria-label="Floors">
                {data.levels.map(item => <button key={item.id} type="button" aria-pressed={item.id === level?.id} onClick={() => { setLevelId(item.id); setSelectedId(null); setZoom(1); }} className={`${buttonClass} ${item.id === level?.id ? "!border-[#6e0c25] !bg-[#6e0c25] !text-white" : ""}`}>{item.name}</button>)}
                {!data.levels.length && <span className="text-sm text-black/60">No floor plans available</span>}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className={buttonClass} aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}><ZoomOut className="h-4 w-4" /></button>
                <button type="button" className={buttonClass} onClick={() => setZoom(1)} aria-label="Fit plan width">{Math.round(zoom * 100)}%</button>
                <button type="button" className={buttonClass} aria-label="Zoom in" disabled={zoom >= 5} onClick={() => setZoom(value => Math.min(5, value + 0.5))}><ZoomIn className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="border-b border-[#c2baa3]/60 p-3">
              <label className="block text-xs font-medium text-black/60">Choose a unit on this floor
                <select className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-[#c2baa3] bg-white px-2 text-sm text-black" value={selected && units.some(unit => unit.id === selected.id) ? selected.id : ""} onChange={event => { const unit = unitById.get(event.target.value); if (unit) pickUnit(unit); else setSelectedId(null); }}>
                  <option value="">Select a unit…</option>
                  {units.map(unit => <option key={unit.id} value={unit.id}>{unit.unitRef}{unit.tenantName ? ` · ${unit.tenantName}` : ""}</option>)}
                </select>
              </label>
              <p className="mt-2 text-xs text-black/60">Zoom in and scroll to explore. Select an outline, a marker or a unit above.</p>
            </div>
            {level && <PlanDrawing key={`${token}:${level.id}`} level={level} units={units} selectedId={selectedId} token={token} updatedAt={data.plan.updatedAt} zoom={zoom} onUnit={pickUnit}
              onUnavailable={() => { requestSequence.current++; setState({ token, data: null, loading: false, error: "The plan image is no longer available. Please try again or ask your BGP contact for a current link." }); }} />}
          </section>
          <aside ref={detailRef} className="min-w-0 scroll-mt-4 rounded-lg border border-[#c2baa3] bg-white p-4 sm:p-5" aria-label="Selected unit" data-testid="shared-unit-details">
            {selected ? <>
              <h2 className="break-words text-xl font-semibold text-[#6e0c25]">{selected.unitRef}</h2>
              {selected.tenantName && <p className="mt-1 break-words text-sm">{selected.tenantName}</p>}
              {selected.facts && <section className="my-5 border-y border-[#c2baa3]/60 py-4" aria-label="Shared unit facts"><Fields fields={[
                ["Lease start", date(selected.facts.leaseStart)], ["Lease expiry", date(selected.facts.leaseExpiry)],
                ["Break date", date(selected.facts.breakDate)], ["Rent review", date(selected.facts.reviewDate)],
                ["Landlord & Tenant Act", selected.facts.outsideLtAct], ["Area (sq ft)", number(selected.facts.sqft)],
                ["Passing rent", money(selected.facts.passingRent)], ["ERV", money(selected.facts.erv)],
              ]} /></section>}
              <h3 className="mb-3 mt-5 text-sm font-semibold">Shared evidence · {selectedEvidence.length}</h3>
              <div className="space-y-3">{selectedEvidence.map(entry => <EvidenceCard key={entry.id} entry={entry} token={token} unit={selected} />)}</div>
              {!selectedEvidence.length && <p className="text-sm text-black/60">No evidence has been shared for this unit.</p>}
            </> : <><h2 className="text-lg font-semibold text-[#6e0c25]">Select a unit</h2><p className="mt-3 text-sm text-black/60">Choose a unit on the plan to see its shared evidence and any approved lease facts. All shared evidence is also listed below.</p></>}
          </aside>
        </div>
        <section className="mt-10" aria-labelledby="shared-evidence-title">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 id="shared-evidence-title" className="text-xl font-semibold text-[#6e0c25]">Shared evidence</h2><p className="mt-1 text-sm text-black/60">{data.entries.length} approved {data.entries.length === 1 ? "entry" : "entries"}{unlinkedCount ? ` · ${unlinkedCount} not linked to a unit` : ""}</p></div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <input className="min-h-11 min-w-0 flex-1 rounded-md border border-[#c2baa3] bg-white px-3 text-sm" aria-label="Search shared evidence" placeholder="Find unit, tenant or transaction…" value={search} onChange={event => setSearch(event.target.value)} />
              <select className="min-h-11 rounded-md border border-[#c2baa3] bg-white px-2 text-sm" aria-label="Evidence view" value={evidenceScope} onChange={event => setEvidenceScope(event.target.value as "all" | "unlinked")}><option value="all">All evidence</option><option value="unlinked">Unlinked evidence</option></select>
            </div>
          </div>
          <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleEvidence.map(entry => <EvidenceCard key={entry.id} entry={entry} token={token} unit={entry.unitId ? unitById.get(entry.unitId) : undefined} onUnit={pickUnit} />)}</div>
          {!visibleEvidence.length && <p className="mt-5 rounded-lg border border-[#c2baa3] bg-white p-6 text-sm text-black/60">{data.entries.length ? "No shared evidence matches this view." : "No evidence entries have been shared with this plan."}</p>}
        </section>
        <p className="mt-8 border-t border-[#c2baa3] pt-5 text-xs text-black/60">Shared by Bruce Gillingham Pollard. For questions or changes, please contact the BGP team who sent you this link.</p>
      </>}
    </div>
  </main>;
}
