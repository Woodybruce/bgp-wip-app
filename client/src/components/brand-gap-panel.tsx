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
import { getAuthHeaders } from "@/lib/queryClient";
import { renderAiCommentary } from "@/components/property-asset-brief";
import {
  MapPin, TrendingUp, AlertCircle, FileText, Sparkles, RefreshCw,
  Swords, Globe2, Store, ChevronRight, Loader2, Radar, ExternalLink,
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
    examples: Array<{ id: string; name: string; peers: number; live_req: boolean }>;
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
  }>;
  stats: { totalBrands: number; hospitalityBrands?: number; brandsWithStores: number };
  positioning?: { key: "luxury" | "mainstream" | "value"; source: "tag" | "tenant_mix" | "default"; label: string; categories: string; peers: string; peersShort: string; brandsNoun: string };
  liveIntel?: { byBrand: Record<string, LiveIntelBrand>; generatedAt: string } | null;
}

// Two-line row: the brand NAME owns the first line (badges after it, name
// never crushed to "W…"), the scheme evidence sits underneath (Woody,
// 2026-08-04: "design issues on the brand names").
function BrandRow({ b, context, intel }: { b: GapBrand; context?: string; intel?: LiveIntelBrand }) {
  return (
    <Link
      href={`/companies/${b.brand_company_id}`}
      className="block text-xs hover:bg-muted/50 rounded px-1 py-1 min-w-0"
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium truncate min-w-0" title={b.brand_name}>{b.brand_name}</span>
        {b.has_live_requirement && (
          <Badge className="text-[11px] bg-muted text-foreground border-border shrink-0">live req</Badge>
        )}
        {intel?.expanding && (
          <Badge className="text-[11px] bg-muted text-foreground border-border shrink-0" title={intel.note}>
            <Radar className="w-2 h-2 mr-0.5" />expanding
          </Badge>
        )}
        {(b.rollout_status === "scaling" || b.rollout_status === "entering_uk") && (
          <Badge className="text-[11px] bg-muted text-foreground border-border shrink-0">
            <TrendingUp className="w-2 h-2 mr-0.5" />{b.rollout_status === "scaling" ? "scaling" : "entering UK"}
          </Badge>
        )}
      </span>
      {context && (
        <span className="block text-[11px] text-muted-foreground truncate mt-0.5" title={context}>
          {context}
        </span>
      )}
    </Link>
  );
}

function GapColumn({ icon: Icon, tint, title, sub, brands, contextFor, emptyText, intelByBrand }: {
  icon: any; tint: string; title: string; sub?: string;
  brands: GapBrand[]; contextFor: (b: GapBrand) => string; emptyText: string;
  intelByBrand?: Record<string, LiveIntelBrand>;
}) {
  return (
    <div className="rounded-lg border p-2.5 min-w-0">
      <div className={`${SUB_LABEL} mb-0.5 flex items-center gap-1.5`}>
        <Icon className={`w-3.5 h-3.5 ${tint}`} />
        {title}
        <span className="font-mono tabular-nums">{brands.length}</span>
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mb-1.5">{sub}</div>}
      {brands.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic py-2">{emptyText}</p>
      ) : (
        <div className="space-y-0.5 max-h-[300px] overflow-y-auto pr-1">
          {brands.slice(0, 20).map(b => (
            <BrandRow key={b.brand_company_id} b={b} context={contextFor(b)} intel={intelByBrand?.[b.brand_name.toLowerCase()]} />
          ))}
          {brands.length > 20 && <p className="text-[11px] text-muted-foreground pl-1">+{brands.length - 20} more</p>}
        </div>
      )}
    </div>
  );
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

function BrandGapBody({ data, sectors, missing, present, competing, propertyId }: {
  data: BrandGapResult;
  sectors: NonNullable<BrandGapResult["sectors"]>;
  missing: NonNullable<BrandGapResult["sectors"]>;
  present: NonNullable<BrandGapResult["sectors"]>;
  competing: NonNullable<BrandGapResult["competingCentres"]>;
  propertyId: string;
}) {
  // Minimise everything below the AI read (Woody, 2026-08-04: "create a
  // minimise after the commentary so can reduce if need to").
  const [detailsOpen, setDetailsOpen] = useState(false);
  const centre = data.researchContext?.mode !== "local";
  const positioning = data.positioning;
  const peers = positioning?.peers || "the top UK centres";

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
        {competing.length > 0 && <> · vs {competing.map(c => `${c.name} (${c.distance_km}km)`).join(" · ")}</>}
      </p>
        {/* Local mode's reason only repeated the card's own heading. */}
        {data.researchContext && !centre && data.researchContext.mode !== "local" && <p className="text-sm text-muted-foreground">{data.researchContext.reason}</p>}
        {/* AI gap read */}
        <GapCommentary propertyId={propertyId} />

        {/* Live web sweep — who is actively taking sites right now */}
        <LiveExpansionIntel propertyId={propertyId} />

        {centre && data.benchmark && <CentreBenchmark benchmark={data.benchmark} name={data.property.name} peers={peers} brandsNoun={positioning?.brandsNoun || "F&B & leisure brands"} />}
        {centre && <CentreOpenings propertyId={propertyId} />}

        {/* Minimise everything below the read */}
        <button
          onClick={() => setDetailsOpen(o => !o)}
          className="w-full flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground py-0.5"
          data-testid="gap-details-toggle"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${detailsOpen ? "rotate-90" : ""}`} />
          {detailsOpen ? "Minimise detail" : "Show detail — gaps, sectors, watchlist"}
          <span className="flex-1 border-t border-border/60 ml-1" />
        </button>

        {detailsOpen && (<>
        {/* Matching brand requirements — active leasing reqs that fit available units */}
        {data.matchingRequirements && data.matchingRequirements.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-2">
            <div className="text-[11px] mb-1 flex items-center gap-1 font-medium">
              <FileText className="w-3 h-3 text-primary" />
              Matching brand requirements ({data.matchingRequirements.length}) — use-class fits an available unit
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
              {data.matchingRequirements.slice(0, 12).map(r => (
                <Link
                  key={r.id}
                  href={r.company_id ? `/companies/${r.company_id}` : `/requirements/${r.id}`}
                  className="text-xs flex items-center gap-1.5 hover:bg-muted/60 rounded px-1 py-0.5 min-w-0 overflow-hidden"
                >
                  <span className="font-medium truncate flex-1 min-w-0">
                    {r.company_name || r.name || "Unnamed"}
                  </span>
                  {r.use && r.use.length > 0 && (
                    <Badge variant="outline" className="text-[11px] shrink-0 bg-background">
                      {[...new Set(r.use.slice(0, 2).map((u: string) => useClassLabel(u)))].join(", ")}{r.use.length > 2 ? "…" : ""}
                    </Badge>
                  )}
                  {r.size && (
                    <span className="text-[11px] text-muted-foreground truncate max-w-[150px]" title={r.size}>{formatSizeList(r.size)}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Three lenses — competing centres, national peers, local market */}
        <div className={`grid grid-cols-1 ${centre ? "md:grid-cols-3" : ""} gap-3`}>
          {centre && <><GapColumn
            icon={Swords}
            tint="text-muted-foreground"
            title="At competing centres, not here"
            sub={competing.length ? `Trading at ${competing.map(c => c.name).join(" / ")}` : undefined}
            brands={data.competitorGaps || []}
            contextFor={(b) => (b.competing_at || []).join(", ")}
            emptyText="No competing-centre gaps found — or no competing centre within range."
            intelByBrand={data.liveIntel?.byBrand}
          />
          <GapColumn
            icon={AlertCircle}
            tint="text-muted-foreground"
            title={`At ${peers}, not here`}
            sub={data.peerSchemesConsidered ? `Across the ${data.peerSchemesConsidered} benchmark centres` : undefined}
            brands={data.peerGaps || []}
            contextFor={(b) => {
              const ps = b.peer_schemes || [];
              return ps.slice(0, 2).join(", ") + (ps.length > 2 ? ` +${ps.length - 2}` : "");
            }}
            emptyText="No national peer-scheme gaps."
            intelByBrand={data.liveIntel?.byBrand}
          /></>}
          <GapColumn
            icon={MapPin}
            tint="text-muted-foreground"
            title={centre ? "In the local market, not on scheme" : "Nearby occupiers"}
            sub={centre ? "Trading within 5km — potential operators to investigate" : "Trading within 5km — verify interest and fit for the actual available unit"}
            brands={data.localMarket || []}
            contextFor={(b) => `${b.nearest_distance_km.toFixed(1)}km away`}
            emptyText="Nothing nearby that isn't already on scheme."
            intelByBrand={data.liveIntel?.byBrand}
          />
        </div>

        {/* Sector coverage — missing sectors first, loud */}
        {centre && sectors.length > 0 && (
          <div>
            <div className={`${SUB_LABEL} mb-1.5 flex items-center gap-1.5`}>
              <Store className="w-3.5 h-3.5 text-muted-foreground" />
              Sector coverage
              {missing.length > 0 && (
                <Badge className="text-[11px] bg-muted text-foreground border-border">
                  {missing.length} missing sector{missing.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {[...missing, ...present].map(s => (
                <div
                  key={s.key}
                  className={`rounded-lg border p-2 min-w-0 ${s.missing ? "border-border bg-muted/40" : ""}`}
                  data-testid={`sector-${s.key}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold truncate">{s.label}</span>
                    {s.missing
                      ? <Badge className="text-[11px] bg-muted text-foreground border-border shrink-0">missing</Badge>
                      : <span className="text-[11px] text-muted-foreground shrink-0">{s.on_scheme} here</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {s.missing
                      ? `0 on scheme · ${s.at_peers} brand${s.at_peers === 1 ? "" : "s"} at ${peers}${s.at_competing ? ` · ${s.at_competing} at competitors` : ""}`
                      : s.on_scheme_names.slice(0, 3).join(", ") + (s.on_scheme > 3 ? ` +${s.on_scheme - 3}` : "")}
                  </div>
                  {s.examples.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.examples.slice(0, 3).map(e => (
                        <Link key={e.id} href={`/companies/${e.id}`}>
                          <Badge
                            variant="outline"
                            className={`text-[11px] cursor-pointer hover:bg-muted ${e.live_req ? "border-border text-foreground" : ""}`}
                            title={`At ${e.peers} of ${peers}${e.live_req ? " · live requirement" : ""}`}
                          >
                            {e.name}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* International watchlist — larger-scheme play, collapsed by default */}
        {centre && <InternationalWatchlist propertyId={propertyId} />}

        {/* On-scheme / wider chips — reference detail, tucked away */}
        <details className="group/os">
          <summary className="text-[11px] text-muted-foreground cursor-pointer list-none flex items-center gap-1 hover:text-foreground">
            <ChevronRight className="w-3 h-3 transition-transform group-open/os:rotate-90" />
            {centre ? "On-scheme & nearby detail" : "Recorded tenants & nearby detail"} ({data.onScheme.length} {centre ? "on scheme" : "recorded tenants"} · {data.wider.length} within 2km)
          </summary>
          <div className="mt-2 space-y-2">
            {data.onScheme.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.onScheme.slice(0, 30).map(b => (
                  <Link key={b.brand_company_id} href={`/companies/${b.brand_company_id}`}>
                    <Badge variant="outline" className="text-[11px] bg-muted hover:bg-muted/80 border-border cursor-pointer">
                      {b.brand_name}
                      <span className="ml-1 text-muted-foreground">
                        {b.nearest_distance_km < 0.1 ? "here" : `${(b.nearest_distance_km * 1000).toFixed(0)}m`}
                      </span>
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
            {data.wider.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.wider.slice(0, 30).map(b => (
                  <Link key={b.brand_company_id} href={`/companies/${b.brand_company_id}`}>
                    <Badge variant="outline" className="text-[11px] bg-muted hover:bg-muted/80 border-border cursor-pointer">
                      {b.brand_name}
                      <span className="ml-1 text-muted-foreground">{b.nearest_distance_km.toFixed(1)}km</span>
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </details>

        {data.onScheme.length === 0 && (data.peerGaps || []).length === 0 && (data.localMarket || []).length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No hospitality store data nearby yet. Populate stores for brands via "Find stores" on each brand page.
          </p>
        )}
        </>)}
    </div>
  );
}

// This centre against each benchmark centre on the same hospitality /
// leisure slice (Woody, 2026-09-27: "compare the top 25 shopping centres").
function CentreBenchmark({ benchmark, name, peers, brandsNoun }: { benchmark: NonNullable<BrandGapResult["benchmark"]>; name: string; peers: string; brandsNoun: string }) {
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
              <span className="font-medium truncate">{r.name}</span>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{r.distance_km}km</span>
              {r.from_schedule && <span className="text-[11px] text-muted-foreground shrink-0" title="Counted from our own tenancy schedule">· our data</span>}
            </div>
            <div className="md:contents flex gap-3 text-[11px] text-muted-foreground mt-0.5 md:mt-0">
              <span className="md:text-right tabular-nums md:text-xs md:text-foreground"><span className="md:hidden">Brands </span>{r.brands}</span>
              <span className="md:text-right tabular-nums md:text-xs"><span className="md:hidden">Shared </span>{r.shared}</span>
              <span className="md:text-right tabular-nums md:text-xs"><span className="md:hidden">Not here </span>{r.not_here}</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1 md:mt-0 min-w-0">
              {(distinct.get(r.name) || []).map(b => (
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
