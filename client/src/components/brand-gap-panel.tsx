// Brand gap analysis — the hospitality & leisure gap board (Woody,
// 2026-08-04 rework: full width; competing centres + national peers +
// local market lenses; sector coverage with missing-sector callouts;
// AI gap read; international watchlist). The server slices by the scheme's
// positioning: hospitality/F&B/wellness/café/leisure for a mainstream scheme,
// plus luxury & premium retail (and no quick-service chains) for a luxury one.
import type { PropertyResearchContext } from "@shared/property-research";
import { useState } from "react";
import { formatSizeList } from "@/lib/format-size";
import { useClassLabel } from "@/lib/format";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLandsecRestricted } from "@/hooks/use-landsec-restricted";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompanyChip } from "@/components/company-chip";
import { PillSelect } from "@/components/crm-hub/company-list";
import { useIsLandsecView } from "@/components/landsec/deal-clock";
import { LANDSEC_CATEGORIES, LANDSEC_OTHER_LABEL, landsecCategoryLabel, landsecCategoryOf } from "@shared/landsec";
import { renderAiCommentary } from "@/components/property-asset-brief";
import {
  MapPin, TrendingUp, AlertCircle, FileText, Sparkles, RefreshCw,
  Swords, Globe2, Store, ChevronRight, Loader2, Radar, ExternalLink, Plus, Search, Target,
} from "lucide-react";

type LiveIntelBrand = {
  name: string;
  expanding: boolean;
  confidence?: "high" | "medium" | "low";
  note: string;
  source_url?: string;
};

type GapBrand = {
  brand_company_id: string;
  brand_name: string;
  nearest_distance_km: number;
  total_stores: number;
  rollout_status: string | null;
  company_type: string | null;
  sector?: string | null;
  peer_schemes?: string[];
  competing_at?: string[];
  has_live_requirement?: boolean;
  requirement_note?: string | null;
};

interface BrandGapResult {
  applicable?: boolean;
  researchContext?: PropertyResearchContext;
  reason?: string;
  property: { id: string; name: string; postcode: string | null; lat: number; lng: number };
  onScheme: GapBrand[];
  wider: GapBrand[];
  gap: Array<GapBrand & { nearest_store: { name: string; address: string | null }; gap_score: number }>;
  peerGaps?: GapBrand[];
  competingCentres?: Array<{ name: string; distance_km: number }>;
  competitorGaps?: GapBrand[];
  localMarket?: GapBrand[];
  sectors?: Array<{
    key: string; label: string; on_scheme: number; on_scheme_names: string[];
    at_competing: number; at_peers: number; missing: boolean;
    examples: Array<{ id: string; name: string; peers: number; live_req: boolean; req_note?: string | null }>;
  }>;
  missingSectors?: BrandGapResult["sectors"];
  peerSchemesConsidered?: number;
  benchmark?: {
    here: { brands: number; sectors: number };
    centres: Array<{ name: string; distance_km: number; brands: number; sectors: number; shared: number; not_here: number; not_here_top: Array<{ id: string; name: string }>; from_schedule: boolean }>;
  } | null;
  categorySignature: Record<string, number>;
  matchingRequirements?: Array<{
    id: string; name: string | null; use: string[] | null; size: string | null;
    requirement_locations: string | null; company_id: string | null;
    company_name: string | null; domain: string | null;
    state?: string; reason?: string | null;
  }>;
  stats: { totalBrands: number; hospitalityBrands?: number; brandsWithStores: number };
  positioning?: { key: "luxury" | "mainstream" | "value"; source: "tag" | "tenant_mix" | "default"; label: string; categories: string; peers: string; peersShort: string; brandsNoun: string };
  liveIntel?: { byBrand: Record<string, LiveIntelBrand>; generatedAt: string } | null;
}


function GapCommentary({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const key = ["/api/property", propertyId, "gap-commentary"];
  const { data, isLoading } = useQuery<{ text: string; generatedAt: string }>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/brand-gaps/commentary`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/brand-gaps/commentary?refresh=1`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (fresh) => qc.setQueryData(key, fresh),
  });
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className={`${SUB_LABEL} flex items-center gap-1.5`}>
          <Sparkles className="w-3.5 h-3.5" /> BGP take — brand gap
          {data?.generatedAt && (
            <span className="font-normal normal-case tracking-normal">
              — {new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).replace(/\bSept\b/, "Sep")}
            </span>
          )}
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="p-1 rounded hover:bg-muted"
          title="Regenerate the gap read"
          data-testid="gap-commentary-refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${refresh.isPending ? "animate-spin" : ""}`} />
        </button>
      </div>
      {isLoading || refresh.isPending ? (
        <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Reading the gaps — competing centres, sectors, live demand…
        </p>
      ) : data?.text ? (
        renderAiCommentary(data.text)
      ) : (
        <p className="text-xs text-muted-foreground italic">No read yet — hit refresh to generate.</p>
      )}
    </div>
  );
}

// Perplexity sweep over the top gap candidates: who is actively taking
// sites right now, with citations. Fully automatic (Woody, 2026-08-18:
// "no button") — the GET generates when the cache is stale, the nightly
// cron pre-warms it, and once fresh data lands the gap board is re-pulled
// so the "expanding" badges appear.
function LiveExpansionIntel({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const key = ["/api/property", propertyId, "gap-live-intel"];
  const { data, isLoading, error } = useQuery<{
    brands: LiveIntelBrand[]; market_notes?: string;
    citations?: Array<{ url: string; title?: string }>; generatedAt: string; cached?: boolean;
  }>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/brand-gaps/live-intel`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || loadError(r.status));
      }
      const fresh = await r.json();
      if (fresh?.cached === false) {
        qc.invalidateQueries({ queryKey: ["/api/property", propertyId, "brand-gaps"] });
      }
      return fresh;
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // Only brands with real evidence. The research sometimes flags a brand as
  // expanding while its own note says the evidence is missing or stale —
  // those read as working notes, not intel (Woody, 2026-09-27).
  const NO_EVIDENCE = /cannot be confirmed|can'?t be confirmed|no evidence|wasn'?t returned|not returned|outside the (?:roughly )?\d+-month window|does not identify|does not establish|doesn'?t establish|(?:was|were) not available in the results|doesn'?t identify|no (?:specific|direct|cited) evidence|no (?:attributable )?(?:recent )?(?:expansion )?evidence (?:surfaced|found|was found)|no attributable recent|not a direct match|available results? (?:gives?|shows?|provides?) no/i;
  // Caveat sentences ("No Bluewater-specific plan was found.") are the
  // researcher's working, not intel — drop them from otherwise good notes.
  const CAVEAT = /^(?:no\b[^.]*\b(?:was|were|has been|have been) (?:found|identified|confirmed|announced)|[^.]*\bno [^.]*\b(?:was|were) (?:found|identified|available|returned)\b|[^.]*\b(?:not|yet to be) (?:been )?(?:found|confirmed)\b|no [\w'’ -]+-specific\b|[^.]*\bnot (?:one of )?the specified\b|[^.]*\bnot specifically\b)/i;
  // Also drop the researcher's "[5]" citation markers.
  const tidy = (note?: string | null) => (note || "").replace(/\s*\[\d+\]/g, "").split(/(?<=[.!?])\s+/).filter(x => !CAVEAT.test(x.trim())).join(" ")
    .replace(/,?\s*though not one of the specified centres/gi, "").replace(/\s*[—–-]\s*this is London-wide, not specifically [^.]+\./gi, ".");
  const expanding = (data?.brands || []).filter(b => b.expanding && !NO_EVIDENCE.test(b.note || "")).map(b => ({ ...b, note: tidy(b.note) })).filter(b => b.note.trim());
  const marketNotes = tidy(data?.market_notes).trim();
  const [notesOpen, setNotesOpen] = useState(false);
  return (
    <div className="border-t border-border pt-3" data-testid="gap-live-intel">
      <div className={`${SUB_LABEL} flex flex-wrap items-center gap-x-1.5 mb-1`}>
        <Radar className="w-3.5 h-3.5" /> Live expansion intel
        <span className="font-normal normal-case tracking-normal">web-researched, cited · verify before pitching</span>
        {data?.generatedAt && (
          <span className="font-normal normal-case tracking-normal">
            — {new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).replace(/\bSept\b/, "Sep")}
          </span>
        )}
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Sweeping the web — openings, requirements, rollout funding…
        </p>
      ) : error ? (
        <p className="text-xs text-muted-foreground italic">{(error as Error).message}</p>
      ) : !data?.brands?.length ? (
        <p className="text-xs text-muted-foreground italic">No expansion evidence gathered yet — the sweep runs automatically and refreshes weekly.</p>
      ) : (
        <div className="space-y-1.5">
          {marketNotes && !/available results? (?:gives?|shows?) no|do(?:es)? not establish|no (?:cited |specific )?evidence|could not (?:be )?(?:confirm|establish|find)|not (?:been )?(?:found|confirmed)/i.test(marketNotes) && <p className={`text-xs leading-relaxed ${notesOpen ? "" : "line-clamp-2"} cursor-pointer`} onClick={() => setNotesOpen(v => !v)} title={notesOpen ? undefined : "Click to read the full note"}>{marketNotes}</p>}
          {expanding.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No cited expansion evidence on the current candidates.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {expanding.map((b, i) => (
                <div key={i} className="text-xs rounded-md border border-border px-2 py-1.5 min-w-0">
                  <span className="font-semibold">{b.name}</span>
                  {/* "(high)" read as the researcher's working; only flag a weak one. */}
                  {b.confidence === "low" && <span className="text-[11px] text-muted-foreground ml-1">(unconfirmed)</span>}
                  {b.source_url && (
                    <a href={b.source_url} target="_blank" rel="noreferrer" className="inline-flex align-middle ml-1 text-primary hover:underline" title={b.source_url}>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                  <span className="block text-[11px] text-muted-foreground mt-0.5">{b.note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InternationalWatchlist({ propertyId }: { propertyId: string }) {
  const { data, isLoading, error } = useQuery<{ items: Array<{ name: string; sector: string; origin: string; trades_in: string; uk_status: string; why: string }>; generatedAt: string }>({
    queryKey: ["/api/property", propertyId, "gap-international"],
    queryFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/brand-gaps/international`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  return (
    <details className="rounded-lg border p-2.5 group/intl">
      <summary className={`${SUB_LABEL} cursor-pointer list-none flex flex-wrap items-center gap-1.5`}>
        <ChevronRight className="w-3 h-3 transition-transform group-open/intl:rotate-90" />
        <Globe2 className="w-3.5 h-3.5 text-muted-foreground" />
        International watchlist — concepts not yet in the UK
        <span className="font-normal normal-case tracking-normal">AI-researched · verify before pitching</span>
      </summary>
      <div className="mt-2">
        {isLoading ? (
          <p className="text-xs text-muted-foreground italic flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Researching international concepts…</p>
        ) : error || !data?.items?.length ? (
          <p className="text-xs text-muted-foreground italic">Nothing generated yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {data.items.map((it, i) => (
              <div key={i} className="text-xs rounded border px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold truncate">{it.name}</span>
                  <Badge variant="outline" className="text-[11px] shrink-0">{it.sector}</Badge>
                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{it.origin}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Trades in {it.trades_in} · UK: {it.uk_status}
                </div>
                <div className="text-[11px] mt-0.5">{it.why}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

// Sub-section label inside the board (docs/DESIGN.md §2) — the sections here
// each had their own mix of 11px semibold, primary icons and tinted boxes.
const SUB_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

// Plain words, not "HTTP 429", when a section can't load.
const loadError = (status: number) => status === 429 ? "Busy right now — this refreshes in a minute." : "Couldn't load this just now.";

export function BrandGapPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading, error } = useQuery<BrandGapResult>({
    queryKey: ["/api/property", propertyId, "brand-gaps"],
    queryFn: async () => {
      // Hit the endpoint directly so we can read the server's specific
      // 400 body (no-postcode / no-key / geocode-failed) instead of
      // throwing on the apiRequest layer and losing the reason.
      const res = await fetch(`/api/property/${propertyId}/brand-gaps`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || loadError(res.status));
      }
      return res.json();
    },
    retry: false,
  });

  // The property page frames this in its own "Brand gap" board card — a
  // second Card here drew a box inside the box.
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading store network…</p>;

  if (error || !data) {
    return (
      <p className="text-xs text-muted-foreground">
        {error?.message || "Needs property geocoding or brand_stores data. Use the \"Find stores\" button on brands to populate store locations via Google Places."}
      </p>
    );
  }

  if (data.applicable === false) return (
    <p className="text-xs text-muted-foreground" data-testid="brand-gap-not-applicable">{data.reason}</p>
  );
  const sectors = data.sectors || [];
  const missing = sectors.filter(s => s.missing);
  const present = sectors.filter(s => !s.missing);
  const competing = data.competingCentres || [];
  return (
    <BrandGapBody data={data} sectors={sectors} missing={missing} present={present} competing={competing} propertyId={propertyId} />
  );
}

type GapTarget = {
  brand_company_id: string; brand_name: string; domain: string | null; company_type?: string | null;
  sector: string | null; sector_label: string | null; sector_missing: boolean;
  competing_at: string[]; top_count: number; top_centres: string[]; local_km: number | null;
  rollout_status: string | null; expanding: boolean; expanding_note: string | null; score: number | null;
  has_live_requirement?: boolean; requirement_note?: string | null;
  units: Array<{ id: string; name: string; sqft: number | null }>;
  stage: string | null; stage_label: string | null; stage_unit: string | null; ruled_out: boolean;
};
type CompetingCard = {
  name: string; distance_km: number; brands: number; shared: number; not_here: number;
  not_here_top: Array<{ id: string; name: string }>; property_id: string | null; owner: string | null; from_schedule: boolean;
};
type GapExtras = {
  targets?: GapTarget[]; competingCards?: CompetingCard[];
  sisterSchemes?: Array<{ name: string; distance_km: number; property_id: string | null }>;
  marketingUnits?: Array<{ id: string; name: string; sqft: number | null }>; canWant?: boolean;
};

// Why a brand is on the list, in one line.
function targetWhy(t: GapTarget): string {
  const parts: string[] = [];
  if (t.competing_at.length) parts.push(`At ${t.competing_at.join(", ")}`);
  if (t.top_count) parts.push(`${t.top_count} top centre${t.top_count === 1 ? "" : "s"}`);
  if (t.local_km !== null) parts.push(`${t.local_km}km away`);
  return parts.join(" · ") || "Trading elsewhere";
}
const stagePill = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap";

// One brand's details and the things to do with it (Woody, 2026-11-15: link
// the gap to requirements, the Letting Tracker, the Brand CRM and brands).
function TargetDetail({ target, onClose, propertyId, propertyName, units, canWant, noBrandPages }: {
  target: GapTarget | null; onClose: () => void; propertyId: string; propertyName: string;
  units: NonNullable<GapExtras["marketingUnits"]>; canWant: boolean; noBrandPages: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [unitId, setUnitId] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/property", propertyId, "brand-gaps"] });
  const want = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/brand-crm/targets", { companyId: target!.brand_company_id, propertyId })).json(),
    onSuccess: () => { toast({ title: "Wanted here", description: `${target!.brand_name} is on the Brand CRM for ${propertyName}.` }); refresh(); onClose(); },
    onError: (e: any) => toast({ title: "Couldn't add it", description: e?.message, variant: "destructive" }),
  });
  const addTarget = useMutation({
    mutationFn: async () => {
      const brief = await (await apiRequest("POST", "/api/unit-briefs", { unitId })).json();
      await apiRequest("POST", `/api/unit-briefs/${brief.id}/targets`, { operatorName: target!.brand_name, companyId: target!.brand_company_id, priority: "B" });
    },
    onSuccess: () => {
      toast({ title: "Target added", description: `${target!.brand_name} is a target on ${units.find(u => u.id === unitId)?.name || "the unit"}.` });
      qc.invalidateQueries({ queryKey: ["/api/unit-briefs"] }); refresh(); onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't add the target", description: e?.message, variant: "destructive" }),
  });
  const t = target;
  const offered = t ? [...t.units, ...units.filter(u => !t.units.some(f => f.id === u.id))] : [];
  return (
    <Dialog open={!!t} onOpenChange={open => { if (!open) { setUnitId(""); onClose(); } }}>
      <DialogContent className="max-w-lg" data-testid="gap-target-detail">
        {t && (<>
          <DialogHeader>
            <DialogDescription className="text-xs uppercase tracking-wider font-semibold">{t.sector_label || "Brand"}{t.sector_missing ? " · missing sector here" : ""}</DialogDescription>
            <DialogTitle className="text-base leading-snug"><CompanyChip id={noBrandPages ? null : t.brand_company_id} name={t.brand_name} domain={t.domain} size={22} /></DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {t.competing_at.length > 0 && <GapLine label="Competitors">Trading at {t.competing_at.join(", ")}, not here</GapLine>}
            {t.top_count > 0 && <GapLine label="Top centres">At {t.top_count} of the top centres{t.top_centres.length ? ` (${t.top_centres.join(", ")}${t.top_count > t.competing_at.length + t.top_centres.length ? " and more" : ""})` : ""}</GapLine>}
            {t.local_km !== null && <GapLine label="Nearest">{t.local_km}km from {propertyName}</GapLine>}
            <GapLine label="Expansion">
              {[t.score ? `Score ${t.score}` : null, t.rollout_status === "scaling" ? "Scaling" : t.rollout_status === "entering_uk" ? "Entering the UK" : null, t.expanding ? "Expanding (web research)" : null].filter(Boolean).join(" · ") || "No signal held"}
              {t.expanding_note && <span className="block text-xs text-muted-foreground mt-0.5">{t.expanding_note}</span>}
            </GapLine>
            <GapLine label="Requirement">{t.requirement_note || "None held"}</GapLine>
            <GapLine label="Fits here">{t.units.length ? t.units.map(u => `${u.name}${u.sqft ? ` (${u.sqft.toLocaleString()} sq ft)` : ""}`).join(", ") : t.requirement_note ? "No marketing unit in its size range" : "No size to compare"}</GapLine>
            <GapLine label="At this scheme">{t.stage_label ? `${t.stage_label}${t.stage_unit ? ` · ${t.stage_unit}` : ""}` : t.ruled_out ? "Not proceeding" : "Not in play yet"}</GapLine>
          </div>
          {units.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-border bg-muted/40 px-3 py-2">
              <select value={unitId} onChange={e => setUnitId(e.target.value)} className="h-8 flex-1 min-w-[160px] rounded-md border border-border bg-background px-2 text-sm" aria-label="Unit" data-testid="gap-target-unit">
                <option value="">Choose a unit being marketed…</option>
                {offered.map(u => <option key={u.id} value={u.id}>{u.name}{u.sqft ? ` · ${u.sqft.toLocaleString()} sq ft` : ""}{t.units.some(f => f.id === u.id) ? " · fits" : ""}</option>)}
              </select>
              <Button size="sm" onClick={() => addTarget.mutate()} disabled={!unitId || addTarget.isPending} data-testid="gap-target-add">
                {addTarget.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}Add as target
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {canWant && !t.stage && (
              <Button size="sm" variant="outline" onClick={() => want.mutate()} disabled={want.isPending} data-testid="gap-target-want">
                {want.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Target className="w-3.5 h-3.5 mr-1" />}Want at this scheme
              </Button>
            )}
            {!noBrandPages && <Button size="sm" variant="outline" asChild><Link href={`/requirements?type=leasing&companyId=${t.brand_company_id}${t.requirement_note ? "" : "&new=1"}`} onClick={onClose}><FileText className="w-3.5 h-3.5 mr-1" />{t.requirement_note ? "Its requirements" : "Add requirement"}</Link></Button>}
            {!noBrandPages && <Button size="sm" variant="ghost" asChild><Link href={`/companies/${t.brand_company_id}`} onClick={onClose}><Store className="w-3.5 h-3.5 mr-1" />Brand page</Link></Button>}
          </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
function GapLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 min-w-0">
      <span className="text-xs text-muted-foreground pt-0.5">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

type TargetFilter = "all" | "competitors" | "missing" | "requirement" | "fits" | "inplay";

// landsec: the Landsec view, which reads each target by the categories of
// Landsec's agency brief (shared/landsec.ts) and filters by them.
function TargetsTable({ targets, onOpen, landsec }: { targets: GapTarget[]; onOpen: (t: GapTarget) => void; landsec: boolean }) {
  const [filter, setFilter] = useState<TargetFilter>("all");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const categoryOf = (t: GapTarget) => landsecCategoryOf(t.company_type) || "other";
  const inCategory = (t: GapTarget) => !landsec || !category || categoryOf(t) === category;
  const categoryOptions = landsec
    ? [...LANDSEC_CATEGORIES.map(c => ({ value: c.key as string, label: c.label })), { value: "other", label: LANDSEC_OTHER_LABEL }]
        .filter(option => targets.some(t => categoryOf(t) === option.value))
    : [];
  const kindLine = (t: GapTarget) => landsec
    ? [landsecCategoryLabel(categoryOf(t)), t.sector_label].filter(Boolean).join(" · ")
    : t.sector_label || "Unsorted";
  const tests: Record<TargetFilter, (t: GapTarget) => boolean> = {
    all: () => true,
    competitors: t => t.competing_at.length > 0,
    missing: t => t.sector_missing,
    requirement: t => !!t.requirement_note,
    fits: t => t.units.length > 0,
    inplay: t => !!t.stage,
  };
  const labels: Array<[TargetFilter, string]> = [["all", "All"], ["competitors", "At competitors"], ["missing", "Missing sectors"], ["requirement", "With a requirement"], ["fits", "Fits a unit"], ["inplay", "In play"]];
  const needle = q.trim().toLowerCase();
  const rows = targets.filter(tests[filter]).filter(inCategory).filter(t => !needle || `${t.brand_name} ${kindLine(t)} ${t.competing_at.join(" ")}`.toLowerCase().includes(needle));
  const shown = all || needle ? rows : rows.slice(0, 15);
  return (
    <div className="space-y-2" data-testid="gap-targets">
      <div className="flex items-center gap-1.5 flex-wrap">
        {labels.map(([key, label]) => {
          const n = targets.filter(inCategory).filter(tests[key]).length;
          if (key !== "all" && !n) return null;
          return <Pill key={key} active={filter === key} onClick={() => { setFilter(key); setAll(false); }} data-testid={`gap-filter-${key}`}>{label} <span className="font-mono tabular-nums">{n}</span></Pill>;
        })}
        {categoryOptions.length > 0 && (
          <PillSelect label="Category" any="Every category" value={category} onChange={value => { setCategory(value); setAll(false); }}
            options={categoryOptions} testId="gap-filter-category" />
        )}
        <div className="relative ml-auto w-full sm:w-52">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search brands" className="h-8 pl-7 text-sm" data-testid="gap-target-search" />
        </div>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No brands on this list.</p>}
      {rows.length > 0 && (
        <div className="rounded-lg border divide-y">
          <div className="hidden md:grid grid-cols-[minmax(160px,1.3fr)_minmax(180px,2fr)_minmax(110px,0.9fr)_minmax(130px,1.2fr)_minmax(110px,0.9fr)_20px] gap-3 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Brand</span><span>Why</span><span>Expansion</span><span>Requirement and fit</span><span>At this scheme</span><span />
          </div>
          {shown.map(t => (
            <button key={t.brand_company_id} type="button" data-no-min-touch onClick={() => onOpen(t)}
              className="w-full text-left grid grid-cols-1 md:grid-cols-[minmax(160px,1.3fr)_minmax(180px,2fr)_minmax(110px,0.9fr)_minmax(130px,1.2fr)_minmax(110px,0.9fr)_20px] gap-x-3 gap-y-0.5 px-3 py-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring items-center min-w-0"
              data-testid={`gap-target-${t.brand_company_id}`}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 min-w-0 text-sm font-medium"><CompanyChip name={t.brand_name} domain={t.domain} size={18} /></span>
                <span className="block text-[11px] text-muted-foreground truncate">{kindLine(t)}{t.sector_missing ? " · missing here" : ""}</span>
              </span>
              <span className="text-xs text-muted-foreground min-w-0 md:truncate" title={targetWhy(t)}>{targetWhy(t)}</span>
              <span className="text-xs min-w-0 truncate">
                {!!t.score && <span className="font-mono tabular-nums font-semibold">{t.score}</span>}
                {(t.expanding || t.rollout_status === "scaling" || t.rollout_status === "entering_uk") && <span className="text-muted-foreground">{t.score ? " · " : ""}{t.rollout_status === "entering_uk" ? "entering UK" : t.rollout_status === "scaling" ? "scaling" : "expanding"}</span>}
                {!t.score && !t.expanding && t.rollout_status !== "scaling" && t.rollout_status !== "entering_uk" && <span className="text-muted-foreground/60">—</span>}
              </span>
              <span className="text-xs min-w-0 truncate" title={t.requirement_note || undefined}>
                {t.units.length > 0 ? <span className="font-medium">Fits {t.units.map(u => u.name).join(", ")}</span>
                  : t.requirement_note ? <span className="text-muted-foreground">{t.requirement_note}</span>
                  : <span className="text-muted-foreground/60">—</span>}
              </span>
              <span className="min-w-0">{t.stage_label ? <span className={stagePill}>{t.stage_label}</span> : t.ruled_out ? <span className="text-[11px] text-muted-foreground">Not proceeding</span> : <span className="text-xs text-muted-foreground/60">—</span>}</span>
              <ChevronRight className="hidden md:block w-3.5 h-3.5 text-muted-foreground/50" />
            </button>
          ))}
        </div>
      )}
      {!needle && rows.length > 15 && (
        <button className="text-[11px] text-muted-foreground hover:text-foreground underline" onClick={() => setAll(v => !v)} data-testid="gap-targets-show-all">
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function BrandGapBody({ data, sectors, missing, present, competing, propertyId }: {
  data: BrandGapResult & GapExtras;
  sectors: NonNullable<BrandGapResult["sectors"]>;
  missing: NonNullable<BrandGapResult["sectors"]>;
  present: NonNullable<BrandGapResult["sectors"]>;
  competing: NonNullable<BrandGapResult["competingCentres"]>;
  propertyId: string;
}) {
  const centre = data.researchContext?.mode !== "local";
  const positioning = data.positioning;
  const peers = positioning?.peers || "the top UK centres";
  const noBrandPages = useLandsecRestricted();
  const landsecView = useIsLandsecView();
  const targets = data.targets || [];
  const cards = data.competingCards || [];
  const [tab, setTab] = useState<"targets" | "sectors" | "centres" | "take" | "more">("targets");
  const [opened, setOpened] = useState<GapTarget | null>(null);
  const [centreOpen, setCentreOpen] = useState<string | null>(null);
  const openById = (id: string) => { const t = targets.find(x => String(x.brand_company_id) === String(id)); if (t) setOpened(t); return !!t; };
  const rank = data.benchmark ? data.benchmark.centres.filter(c => c.brands > data.benchmark!.here.brands).length + 1 : null;
  const stats: Array<{ label: string; value: string; sub?: string; go: typeof tab }> = [
    ...(centre && rank !== null ? [{ label: "Rank against the top centres", value: `${rank} of ${data.benchmark!.centres.length + 1}`, sub: `${data.benchmark!.here.brands} ${positioning?.brandsNoun || "F&B & leisure brands"} here`, go: "centres" as const }] : []),
    ...(centre ? [{ label: "Missing sectors", value: String(missing.length), sub: missing.slice(0, 3).map(m => m.label).join(", ") || "None", go: "sectors" as const }] : []),
    { label: "Targets with a requirement", value: String(targets.filter(t => t.requirement_note).length), sub: `${targets.filter(t => t.units.length).length} fit a unit being marketed`, go: "targets" as const },
    { label: "Already in play here", value: String(targets.filter(t => t.stage).length), sub: `of ${targets.length} brands not on scheme`, go: "targets" as const },
  ];
  const brandChip = (b: { id: string; name: string }, title?: string) => {
    const known = targets.some(x => String(x.brand_company_id) === String(b.id));
    const cls = "text-[11px] cursor-pointer hover:bg-muted";
    if (known) return <button key={b.id} type="button" data-no-min-touch onClick={() => openById(b.id)} title={title}><Badge variant="outline" className={cls}>{b.name}</Badge></button>;
    if (noBrandPages) return <Badge key={b.id} variant="outline" className="text-[11px]" title={title}>{b.name}</Badge>;
    return <Link key={b.id} href={`/companies/${b.id}`}><Badge variant="outline" className={cls} title={title}>{b.name}</Badge></Link>;
  };

  return (
    <div className="space-y-3" data-testid="brand-gap-panel">
      <p className="text-[11px] text-muted-foreground">
        {!centre && <span className="font-semibold text-foreground">Local occupier opportunities · </span>}
        {positioning?.categories || "hospitality, F&B, wellness & leisure"}
        {positioning && positioning.key !== "mainstream" && (
          <span title={positioning.source === "tag" ? "From the property's tags — change it with Positioning at the top of the page" : "From the current tenants' brands — set it with Positioning at the top of the page"}>
            {" "}· {positioning.label} positioning
          </span>
        )}
        {competing.length > 0 && <> · competing with {competing.map(c => `${c.name} (${c.distance_km}km)`).join(" · ")}</>}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-testid="gap-stats">
        {stats.map(s => (
          <button key={s.label} type="button" data-no-min-touch onClick={() => setTab(s.go)} className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted/60 min-w-0">
            <span className={`${SUB_LABEL} block truncate`}>{s.label}</span>
            <span className="block text-xl font-bold tabular-nums leading-tight">{s.value}</span>
            {s.sub && <span className="block text-[11px] text-muted-foreground truncate">{s.sub}</span>}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Brand gap views">
        <Pill active={tab === "targets"} onClick={() => setTab("targets")} data-testid="gap-tab-targets">Targets <span className="font-mono tabular-nums">{targets.length}</span></Pill>
        {centre && <Pill active={tab === "sectors"} onClick={() => setTab("sectors")} data-testid="gap-tab-sectors">Sectors{missing.length ? <span className="font-mono tabular-nums"> {missing.length} missing</span> : null}</Pill>}
        {centre && <Pill active={tab === "centres"} onClick={() => setTab("centres")} data-testid="gap-tab-centres">Competing centres</Pill>}
        <Pill active={tab === "take"} onClick={() => setTab("take")} data-testid="gap-tab-take">BGP take</Pill>
        <Pill active={tab === "more"} onClick={() => setTab("more")} data-testid="gap-tab-more">More</Pill>
      </div>

      {tab === "targets" && (
        targets.length
          ? <TargetsTable targets={targets} onOpen={setOpened} landsec={landsecView} />
          : <p className="text-xs text-muted-foreground italic">No store data nearby yet. Populate stores for brands with "Find stores" on each brand page.</p>
      )}

      {tab === "sectors" && centre && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2" data-testid="gap-sectors">
          {[...missing, ...present].map(s => (
            <div key={s.key} className={`rounded-lg border p-2 min-w-0 ${s.missing ? "border-border bg-muted/40" : ""}`} data-testid={`sector-${s.key}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-semibold truncate">{s.label}</span>
                {s.missing
                  ? <Badge className="text-[11px] bg-foreground text-background border-transparent shrink-0">missing</Badge>
                  : <span className="text-[11px] text-muted-foreground shrink-0">{s.on_scheme} here</span>}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {s.missing
                  ? `${s.at_peers} brand${s.at_peers === 1 ? "" : "s"} at ${peers}${s.at_competing ? ` · ${s.at_competing} at competitors` : ""}`
                  : s.on_scheme_names.slice(0, 3).join(", ") + (s.on_scheme > 3 ? ` +${s.on_scheme - 3}` : "")}
              </div>
              {s.examples.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{s.examples.slice(0, 3).map(e => brandChip(e, `At ${e.peers} of ${peers}${e.req_note ? ` · ${e.req_note}` : ""}`))}</div>}
            </div>
          ))}
        </div>
      )}

      {tab === "centres" && centre && (
        <div className="space-y-3" data-testid="gap-centres">
          {cards.length === 0 && <p className="text-sm text-muted-foreground">No competing centre within 60km.</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {cards.map(c => (
              <div key={c.name} className="rounded-lg border p-3 min-w-0 space-y-1.5" data-testid={`gap-centre-${c.name}`}>
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <button type="button" data-no-min-touch onClick={() => setCentreOpen(c.name)} className="text-sm font-semibold truncate hover:underline text-left" data-testid={`gap-centre-open-${c.name}`}>{c.name}</button>
                  <span className="text-[11px] text-muted-foreground shrink-0">{c.distance_km}km</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {[c.owner, `${c.brands} brands`, `${c.shared} shared`, `${c.not_here} not here`].filter(Boolean).join(" · ")}
                  {c.from_schedule ? " · our data" : ""}
                </p>
                {c.not_here_top.length > 0 && <div className="flex flex-wrap gap-1">{c.not_here_top.map(b => brandChip(b))}</div>}
                <CentreNews propertyId={propertyId} centre={c.name} />
              </div>
            ))}
          </div>
          {(data.sisterSchemes || []).length > 0 && (
            <p className="text-[11px] text-muted-foreground" data-testid="gap-sisters">
              Same owner, not counted as competitors:{" "}
              {data.sisterSchemes!.map((s, i) => (
                <span key={s.name}>{i > 0 && ", "}{s.property_id ? <Link href={`/properties/${s.property_id}`} className="underline hover:text-foreground">{s.name}</Link> : s.name}</span>
              ))}
            </p>
          )}
          <CentrePagesSetup />
          {data.benchmark && <CentreBenchmark benchmark={data.benchmark} name={data.property.name} peers={peers} brandsNoun={positioning?.brandsNoun || "F&B & leisure brands"} onCentre={setCentreOpen} noBrandPages={noBrandPages} />}
          <CentreOpenings propertyId={propertyId} />
        </div>
      )}

      {tab === "take" && (
        <div className="space-y-3">
          <GapCommentary propertyId={propertyId} />
          <LiveExpansionIntel propertyId={propertyId} />
        </div>
      )}

      {tab === "more" && (
        <div className="space-y-3">
          {data.matchingRequirements && data.matchingRequirements.length > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-2">
              <div className="text-[11px] mb-1 flex items-center gap-1 font-medium">
                <FileText className="w-3 h-3 text-primary" />
                Requirements whose use fits a unit here ({data.matchingRequirements.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
                {data.matchingRequirements.slice(0, 12).map(r => (
                  <Link key={r.id} href={r.company_id && !noBrandPages ? `/companies/${r.company_id}` : `/requirements`}
                    className="text-xs flex items-center gap-1.5 hover:bg-muted/60 rounded px-1 py-0.5 min-w-0 overflow-hidden" title={r.reason || undefined}>
                    <span className="font-medium truncate flex-1 min-w-0">
                      {r.company_name || r.name || "Unnamed"}
                      {r.reason && <span className="font-normal text-muted-foreground" data-testid={`text-matching-req-reason-${r.id}`}> · {r.reason}</span>}
                    </span>
                    {r.use && r.use.length > 0 && (
                      <Badge variant="outline" className="text-[11px] shrink-0 bg-background">
                        {[...new Set(r.use.slice(0, 2).map((u: string) => useClassLabel(u)))].join(", ")}{r.use.length > 2 ? "…" : ""}
                      </Badge>
                    )}
                    {r.size && <span className="text-[11px] text-muted-foreground truncate max-w-[150px]" title={r.size}>{formatSizeList(r.size)}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {centre && <InternationalWatchlist propertyId={propertyId} />}
          <div>
            <p className={`${SUB_LABEL} mb-1`}>{centre ? "On scheme" : "Recorded tenants"} <span className="font-mono tabular-nums font-normal">{data.onScheme.length}</span></p>
            <div className="flex flex-wrap gap-1">{data.onScheme.slice(0, 40).map(b => brandChip({ id: b.brand_company_id, name: b.brand_name }))}</div>
          </div>
          {data.wider.length > 0 && (
            <div>
              <p className={`${SUB_LABEL} mb-1`}>Within 2km <span className="font-mono tabular-nums font-normal">{data.wider.length}</span></p>
              <div className="flex flex-wrap gap-1">{data.wider.slice(0, 40).map(b => brandChip({ id: b.brand_company_id, name: b.brand_name }, `${b.nearest_distance_km.toFixed(1)}km away`))}</div>
            </div>
          )}
        </div>
      )}

      <CentreDetail centre={centreOpen} onClose={() => setCentreOpen(null)} />
      <TargetDetail target={opened} onClose={() => setOpened(null)} propertyId={propertyId} propertyName={data.property.name}
        units={data.marketingUnits || []} canWant={!!data.canWant} noBrandPages={noBrandPages} />
    </div>
  );
}

// The latest opening news at one competing centre, from the feed the
// openings card already reads.
function CentreNews({ propertyId, centre }: { propertyId: string; centre: string }) {
  const { data } = useQuery<{ peers: CentreOpening[] }>({
    queryKey: ["/api/property", propertyId, "centre-openings"],
    queryFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/centre-openings`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(loadError(r.status));
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const items = (data?.peers || []).filter(o => o.centre === centre).slice(0, 3);
  if (!items.length) return null;
  return (
    <ul className="space-y-0.5 border-t border-border pt-1.5">
      {items.map((o, i) => (
        <li key={`${o.title}-${i}`} className="text-[11px] text-muted-foreground truncate">
          {o.date && <span className="tabular-nums">{new Date(o.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · </span>}
          {o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-foreground">{o.title}</a> : o.title}
        </li>
      ))}
    </ul>
  );
}

type CentreBox = {
  name: string; owner: string | null; propertyId: string | null; website: string | null;
  trading: Array<{ id: string | null; name: string; domain: string | null; leisure: boolean; type: string | null }>; tradingSource: string;
  research: { summary: string | null; items: Array<{ date: string | null; kind: string; headline: string; detail: string | null; brand: string | null; source_url: string | null }>; citations: string[] } | null;
  researchAt: string | null;
};
const KIND_WORDS: Record<string, string> = { opening: "Opening", closure: "Closure", redevelopment: "Redevelopment", ownership: "Ownership", leasing: "Leasing", other: "News" };

type CentreResearch = CentreBox["research"];
const researchWhen = (d: string | null) => !d ? "" : new Date(d.length === 7 ? `${d}-01` : d).toLocaleDateString("en-GB", d.length === 7 ? { month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" });

// What a centre is doing: the weekly web research, one line per item.
function CentreResearchBody({ research }: { research: CentreResearch }) {
  if (!research) return <p className="text-sm text-muted-foreground">Not researched yet. Each top centre is read about once a week, once it has a BGP page.</p>;
  return (
    <>
      {research.summary && <p className="text-sm mb-1.5">{research.summary}</p>}
      {research.items.length > 0 && (
        <ul className="divide-y divide-border/60">
          {research.items.map((item, i) => (
            <li key={`${item.headline}-${i}`} className="py-1.5 flex items-start gap-2 min-w-0">
              <span className="shrink-0 w-24 text-[11px] text-muted-foreground"><span className="block font-semibold text-foreground">{KIND_WORDS[item.kind] || "News"}</span>{researchWhen(item.date)}</span>
              <span className="min-w-0 text-xs">
                {item.source_url
                  ? <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{item.headline}<ExternalLink className="inline w-3 h-3 ml-1 text-muted-foreground" /></a>
                  : <span className="font-medium">{item.headline}</span>}
                {item.detail && <span className="block text-muted-foreground">{item.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!research.items.length && !research.summary && <p className="text-sm text-muted-foreground">Nothing sourced in the last 12 months.</p>}
    </>
  );
}

// The same research on the centre's own property page (News & social). Draws
// nothing on a property that is not a benchmark centre.
export function PropertyCentreResearch({ propertyId }: { propertyId: string }) {
  const { data } = useQuery<{ centre: string | null; research: CentreResearch; researchAt: string | null }>({
    queryKey: ["/api/properties", propertyId, "centre-research"],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/centre-research`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return { centre: null, research: null, researchAt: null };
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  if (!data?.centre) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2" data-testid="property-centre-research">
      <p className={`${SUB_LABEL} mb-1 flex items-center gap-1`}><Radar className="w-3 h-3" />What the centre is doing{data.researchAt ? <span className="font-normal normal-case tracking-normal"> · read {new Date(data.researchAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, web research: check before quoting</span> : null}</p>
      <CentreResearchBody research={data.research} />
    </div>
  );
}

// A competing centre's box: who owns it, what it is doing and who trades
// there. Public data only, the same for every login (Woody, 2026-11-15).
function CentreDetail({ centre, onClose }: { centre: string | null; onClose: () => void }) {
  const [allBrands, setAllBrands] = useState(false);
  const { data, isLoading, error } = useQuery<CentreBox>({
    queryKey: ["/api/benchmark-centres", centre],
    queryFn: async () => {
      const r = await fetch(`/api/benchmark-centres/${encodeURIComponent(centre!)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || loadError(r.status));
      return r.json();
    },
    enabled: !!centre,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const leisure = (data?.trading || []).filter(b => b.leisure);
  const brands = allBrands ? data?.trading || [] : leisure.length ? leisure : (data?.trading || []).slice(0, 40);
  return (
    <Dialog open={!!centre} onOpenChange={open => { if (!open) { setAllBrands(false); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="gap-centre-detail">
        <DialogHeader>
          <DialogDescription className="text-xs uppercase tracking-wider font-semibold">Competing centre</DialogDescription>
          <DialogTitle className="text-base leading-snug">{centre}</DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</p>}
        {error && <p className="text-sm text-muted-foreground">{(error as Error).message}</p>}
        {data && (
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <GapLine label="Owner">{data.owner || "Not recorded"}</GapLine>
              {data.website && <GapLine label="Its news page"><a href={data.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{data.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a></GapLine>}
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2" data-testid="gap-centre-research">
              <p className={`${SUB_LABEL} mb-1 flex items-center gap-1`}><Radar className="w-3 h-3" />What it is doing{data.researchAt ? <span className="font-normal normal-case tracking-normal"> · read {new Date(data.researchAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, web research: check before quoting</span> : null}</p>
              <CentreResearchBody research={data.research} />
            </div>
            <div>
              <p className={`${SUB_LABEL} mb-1`}>Trading there <span className="font-mono tabular-nums font-normal">{allBrands ? data.trading.length : brands.length}</span></p>
              {data.trading.length === 0
                ? <p className="text-muted-foreground">No store locations held for this centre yet.</p>
                : <div className="flex flex-wrap gap-1">
                    {brands.map(b => b.id
                      ? <Link key={`${b.id}`} href={`/companies/${b.id}`} onClick={onClose}><Badge variant="outline" className="text-[11px] cursor-pointer hover:bg-muted" title={b.type || undefined}>{b.name}</Badge></Link>
                      : <Badge key={b.name} variant="outline" className="text-[11px]" title={b.type || undefined}>{b.name}</Badge>)}
                  </div>}
              <p className="text-[11px] text-muted-foreground mt-1">
                {data.tradingSource}
                {leisure.length > 0 && data.trading.length > leisure.length && <> · <button type="button" data-no-min-touch className="underline hover:text-foreground" onClick={() => setAllBrands(v => !v)}>{allBrands ? "Food and leisure only" : `Show all ${data.trading.length}`}</button></>}
              </p>
            </div>
            {data.propertyId && <Button size="sm" variant="outline" asChild><Link href={`/properties/${data.propertyId}`} onClick={onClose}><Store className="w-3.5 h-3.5 mr-1" />Open its page</Link></Button>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Admins: set up a BGP property page for each top centre that has none.
function CentrePagesSetup() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: viewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const admin = !!viewer?.isAdmin && viewer?.role !== "Client" && !viewer?.companyScopeId;
  const { data } = useQuery<{ centres: Array<{ centre: string; action: "create" | "mark" | "none" }> }>({
    queryKey: ["/api/admin/benchmark-centres"],
    queryFn: async () => {
      const r = await fetch("/api/admin/benchmark-centres", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(loadError(r.status));
      return r.json();
    },
    enabled: admin,
    retry: false,
  });
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/benchmark-centres/apply")).json(),
    onSuccess: (r: any) => {
      toast({ title: "Centre pages set up", description: `${r.created} created, ${r.marked} existing pages marked.` });
      qc.invalidateQueries({ queryKey: ["/api/admin/benchmark-centres"] });
      qc.invalidateQueries({ queryKey: ["/api/property"] });
    },
    onError: (e: any) => toast({ title: "Couldn't set the pages up", description: e?.message, variant: "destructive" }),
  });
  const create = (data?.centres || []).filter(c => c.action === "create");
  const mark = (data?.centres || []).filter(c => c.action === "mark");
  if (!admin || !data || (!create.length && !mark.length)) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 flex items-center gap-3 flex-wrap" data-testid="gap-centre-setup">
      <p className="text-xs flex-1 min-w-[220px]">
        {create.length > 0 && <><span className="font-semibold">{create.length} top centre{create.length === 1 ? " has" : "s have"} no BGP page:</span> {create.map(c => c.centre).join(", ")}. </>}
        {mark.length > 0 && <>{mark.length} existing page{mark.length === 1 ? "" : "s"} will be marked as a benchmark centre. </>}
        <span className="text-muted-foreground">Each page is then researched about once a week.</span>
      </p>
      <Button size="sm" onClick={() => { if (confirm(`Create ${create.length} property page${create.length === 1 ? "" : "s"} and mark ${mark.length}?`)) apply.mutate(); }} disabled={apply.isPending} data-testid="gap-centre-setup-apply">
        {apply.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}Set up the pages
      </Button>
    </div>
  );
}

// This centre against each benchmark centre on the same hospitality /
// leisure slice (Woody, 2026-09-27: "compare the top 25 shopping centres").
function CentreBenchmark({ benchmark, name, peers, brandsNoun, onCentre, noBrandPages }: { benchmark: NonNullable<BrandGapResult["benchmark"]>; name: string; peers: string; brandsNoun: string; onCentre?: (name: string) => void; noBrandPages?: boolean }) {
  const [all, setAll] = useState(false);
  const rows = benchmark.centres;
  if (!rows.length) return null;
  const rank = rows.filter(r => r.brands > benchmark.here.brands).length + 1;
  const shown = all ? rows : rows.slice(0, 8);
  // Each row lists brands not already named above it, so the column reads as
  // a shopping list rather than the same four national names on every line.
  const seen = new Set<string>();
  const distinct = new Map(rows.map(r => {
    const pick = r.not_here_top.filter(b => !seen.has(b.id)).slice(0, 4);
    pick.forEach(b => seen.add(b.id));
    return [r.name, pick];
  }));
  return (
    <div className="border-t border-border pt-3" data-testid="centre-benchmark">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
        <div className={`${SUB_LABEL} flex items-center gap-1.5`}>
          <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          Against {peers}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {name}: <span className="tabular-nums font-medium text-foreground">{benchmark.here.brands}</span> {brandsNoun} · {benchmark.here.sectors} sectors · ranks {rank} of {rows.length + 1}
        </span>
      </div>
      <div className="rounded-lg border divide-y">
        <div className="hidden md:grid grid-cols-[minmax(0,1.7fr)_56px_56px_64px_minmax(0,2fr)] gap-2 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>Centre</span><span className="text-right">Brands</span><span className="text-right">Shared</span><span className="text-right">Not here</span><span>They have, you don't (new each row)</span>
        </div>
        {shown.map(r => (
          <div key={r.name} className="px-2 py-1.5 text-xs md:grid md:grid-cols-[minmax(0,1.7fr)_56px_56px_64px_minmax(0,2fr)] md:gap-2 md:items-center" data-testid={`benchmark-${r.name}`}>
            <div className="min-w-0 flex items-center gap-1.5">
              {onCentre
                ? <button type="button" data-no-min-touch onClick={() => onCentre(r.name)} className="font-medium truncate hover:underline text-left">{r.name}</button>
                : <span className="font-medium truncate">{r.name}</span>}
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{r.distance_km}km</span>
              {r.from_schedule && <span className="text-[11px] text-muted-foreground shrink-0" title="Counted from our own tenancy schedule">· our data</span>}
            </div>
            <div className="md:contents flex gap-3 text-[11px] text-muted-foreground mt-0.5 md:mt-0">
              <span className="md:text-right tabular-nums md:text-xs md:text-foreground"><span className="md:hidden">Brands </span>{r.brands}</span>
              <span className="md:text-right tabular-nums md:text-xs"><span className="md:hidden">Shared </span>{r.shared}</span>
              <span className="md:text-right tabular-nums md:text-xs"><span className="md:hidden">Not here </span>{r.not_here}</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1 md:mt-0 min-w-0">
              {(distinct.get(r.name) || []).map(b => noBrandPages
                ? <Badge key={b.id} variant="outline" className="text-[11px] font-medium text-foreground">{b.name}</Badge>
                : (
                <Link key={b.id} href={`/companies/${b.id}`}>
                  <Badge variant="outline" className="text-[11px] font-medium text-foreground cursor-pointer hover:bg-muted">{b.name}</Badge>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
        <p className="text-[11px] text-muted-foreground cursor-help" title="From brands' store lists (within ~700m of each centre) and our tenancy schedules where we hold them.">How this is counted</p>
        {rows.length > 8 && (
          <button className="text-[11px] text-muted-foreground hover:text-foreground underline" onClick={() => setAll(v => !v)}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

type CentreOpening = { centre: string; title: string; url: string; source: string | null; date: string | null; brand: { id: string; name: string } | null; origin: string };

// New brands going in — here and at the benchmark centres (Woody,
// 2026-09-27: "any news about new brands going into those shopping centres").
function CentreOpenings({ propertyId }: { propertyId: string }) {
  const [tab, setTab] = useState<"here" | "peers">("here");
  const [more, setMore] = useState(false);
  const { data, isLoading, error } = useQuery<{ centre: string; here: CentreOpening[]; peers: CentreOpening[]; peerCount: number; peerLabel?: string }>({
    queryKey: ["/api/property", propertyId, "centre-openings"],
    queryFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/centre-openings`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || loadError(r.status));
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const items = (tab === "here" ? data?.here : data?.peers) || [];
  const shown = more ? items : items.slice(0, 6);
  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }).replace(/\bSept\b/, "Sep") : "";
  return (
    <div className="border-t border-border pt-3" data-testid="centre-openings">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div className={`${SUB_LABEL} flex items-center gap-1.5`}>
          <Store className="w-3.5 h-3.5 text-muted-foreground" />
          New brands going in
        </div>
        <div className="flex gap-1">
          {(["here", "peers"] as const).map(key => (
            <Pill key={key} active={tab === key} onClick={() => { setTab(key); setMore(false); }}>
              {key === "here" ? "Here" : data?.peerLabel || "Top centres"}
              {data && <span className="font-mono tabular-nums">{key === "here" ? data.here.length : data.peers.length}</span>}
            </Pill>
          ))}
        </div>
      </div>
      {isLoading && <p className="text-xs text-muted-foreground italic flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Reading opening news across the centres…</p>}
      {error && <p className="text-xs text-muted-foreground">{(error as Error).message}</p>}
      {data && !items.length && <p className="text-xs text-muted-foreground">{tab === "here" ? `No opening news for ${data.centre} in the last 12 months.` : `No opening news at the ${(data.peerLabel || "Top centres").toLowerCase()} in the last 12 months.`}</p>}
      {shown.length > 0 && (
        <div className="rounded-lg border divide-y">
          {shown.map((item, i) => (
            <div key={`${item.title}-${i}`} className="px-2 py-1.5 text-xs flex items-start gap-2 min-w-0">
              <span className="text-[11px] text-muted-foreground tabular-nums w-16 shrink-0 pt-px">{fmt(item.date)}</span>
              <div className="min-w-0 flex-1">
                {item.url
                  ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.title}<ExternalLink className="inline w-3 h-3 ml-1 text-muted-foreground" /></a>
                  : <span>{item.title}</span>}
                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
                  {tab === "peers" && <span className="font-medium text-foreground/80">{item.centre}</span>}
                  {item.brand && <Link href={`/companies/${item.brand.id}`} className="font-medium text-foreground/80 hover:underline">{item.brand.name}</Link>}
                  {item.source && item.source.replace(/\s*\(Google News\)\s*$/i, "").toLowerCase() !== item.brand?.name.toLowerCase() && <span>{item.source.replace(/\s*\(Google News\)\s*$/i, "")}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {items.length > 6 && (
        <button className="text-[11px] text-muted-foreground hover:text-foreground underline mt-1" onClick={() => setMore(v => !v)}>
          {more ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
