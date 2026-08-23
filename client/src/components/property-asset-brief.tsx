// Property Asset Brief — the client-facing operational dashboard for
// a property. Replaces the old "Notes" blob with structured cards
// that read like a live working board: header (logo + asset lead),
// this week's focus, active deals, activity feed, risk register,
// performance scorecard, asset-lead commentary.
//
// Everything except weekly_focus + commentary is derived live by
// the /asset-brief endpoint so neither BGP nor the client landlord
// (e.g. Landsec → Mark) has to keep anything in sync by hand.
//
// One view for both audiences — no BGP-only tab. The only thing
// scrubbed for clients is email body content (the activity feed
// returns sanitised summaries, not message bodies).
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import {
  Target, Handshake, Activity, AlertTriangle, BarChart3, Building2,
  Pencil, Plus, Trash2, ChevronRight, Mail, Phone, Users,
  Calendar as CalendarIcon, TrendingUp, TrendingDown, Sparkles,
  Wand2, Search, X, Check, Loader2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AssetBrief {
  property: { id: string; name: string; postcode: string | null; last_updated_at: string };
  owner: { id: string; name: string; logo_url: string; domain: string | null } | null;
  asset_lead: { id: string; name: string; email: string | null; avatar_url: string | null } | null;
  weekly_focus: Array<{ id: string; text: string; owner_user_id?: string | null; deal_id?: string | null }>;
  active_deals: Array<{
    id: string; name: string; status: string; stage_label: string; stage_bucket: string;
    unit_id: string | null; tenancy_unit_id: string | null; unit_name: string | null;
    tenant_id: string | null; tenant_name: string | null; tenant_logo_url: string | null;
    fee_pence: number | null; bgp_user_ids: string[]; last_touch_at: string | null;
  }>;
  pipeline: Record<string, number>;
  activity: Array<{
    id: string; kind: string; direction: string | null; date: string;
    bgp_user: string | null; contact_name: string | null; company_name: string | null;
    deal_id: string | null; deal_name: string | null; summary: string;
  }>;
  risks: Array<{ kind: string; severity: "high" | "med"; message: string; unit_id?: string; unit_name?: string }>;
  performance: {
    total_units: number; occupied_units: number; vacancy_rate: number; wault_years: number | null;
    top_psqft: Array<{ unit_name: string; tenant_name: string | null; mat_psqft: number | null; lfl_percent: string | null }>;
    bottom_psqft: Array<{ unit_name: string; tenant_name: string | null; mat_psqft: number | null; lfl_percent: string | null }>;
  };
  commentary: string;
  bgp_commentary: string | null;
  bgp_commentary_at: string | null;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const d = Math.floor((Date.now() - then) / 86_400_000);
  if (d < 1) return "today";
  if (d === 1) return "1 day ago";
  if (d < 7) return `${d} days ago`;
  if (d < 56) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}

function formatMoney(p: number | null): string {
  if (p == null) return "—";
  return `£${Math.round(p / 100).toLocaleString()}`;
}

const STAGE_BUCKETS: { key: string; label: string; colour: string }[] = [
  { key: "engaged",   label: "Engaged",   colour: "bg-slate-100 text-slate-700 border-slate-300" },
  { key: "viewed",    label: "Viewed",    colour: "bg-sky-100 text-sky-700 border-sky-300" },
  { key: "pitch_out", label: "Pitch out", colour: "bg-indigo-100 text-indigo-700 border-indigo-300" },
  { key: "hots",      label: "HoTs",      colour: "bg-amber-100 text-amber-700 border-amber-300" },
  { key: "legals",    label: "Legals",    colour: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  { key: "signed",    label: "Signed",    colour: "bg-emerald-600 text-white border-emerald-600" },
];

// Shared query key + fetch so every sub-card (PropertyCoveringStrip,
// PipelinePerformanceBoard, PropertyAssetBriefPanel) shares one
// react-query cache hit.
function useAssetBrief(propertyId: string) {
  return useQuery<AssetBrief>({
    queryKey: ["/api/properties", propertyId, "asset-brief"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/asset-brief`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

// Compact covering strip — Asset Owner logo + Asset Lead avatar +
// Last activity, packed into a tight single row. Replaces the
// earlier roomy 3-column header that had too much vertical space.
export function PropertyCoveringStrip({ propertyId }: { propertyId: string }) {
  const { data, isLoading, isError } = useAssetBrief(propertyId);
  // Pull the linkage audit in parallel so we can show a Spine health
  // chip inline. Doesn't block the strip — if it 404s we just hide
  // the chip.
  const { data: audit } = useQuery<any>({
    queryKey: ["/api/properties", propertyId, "linkage-audit"],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/linkage-audit`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
  });

  if (isError) {
    return (
      <div className="flex items-center gap-2 h-8 text-xs text-rose-600 italic">
        Couldn't load property header.
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 h-8">
        <Skeleton className="w-8 h-8 rounded" />
        <Skeleton className="w-24 h-4" />
      </div>
    );
  }

  // Spine health = % of tenancy rows resolved to brand. Amber if any
  // integrity gaps; red if many. Clicking the chip is just a visual
  // hint — the actionable buttons sit in the linkage card below.
  const tr = audit?.tenancy_resolution || { total: 0, resolved: 0, unresolved: 0 };
  const integrity = audit?.integrity || {};
  const gapTotal =
    (Number(integrity.duplicate_unit_numbers) || 0) +
    (Number(integrity.tenants_pointing_at_merged_brand) || 0) +
    (Number(integrity.deals_with_property_unit_mismatch) || 0) +
    (Number(integrity.available_units_deal_on_other_property) || 0) +
    (Number(integrity.active_deals_no_unit_fk) || 0) +
    (Number(integrity.available_units_no_unit_fk) || 0) +
    (Number(integrity.leasing_units_no_unit_fk) || 0);
  const pct = tr.total > 0 ? Math.round((tr.resolved / tr.total) * 100) : null;
  const spineTone =
    pct === null ? "border-muted text-muted-foreground bg-muted/30"
    : gapTotal === 0 && pct >= 95 ? "border-emerald-300 text-emerald-700 bg-emerald-50"
    : pct >= 60 ? "border-amber-300 text-amber-700 bg-amber-50"
    : "border-rose-300 text-rose-700 bg-rose-50";
  const spineTitle =
    pct === null ? "No tenancy schedule rows yet"
    : `${tr.resolved}/${tr.total} tenants linked to brand${gapTotal > 0 ? ` · ${gapTotal} integrity gap${gapTotal === 1 ? "" : "s"}` : ""}`;

  return (
    <div className="flex items-center gap-x-3 gap-y-1 text-xs flex-wrap">
      {data.owner ? (
        <Link href={`/companies/${data.owner.id}`} className="flex items-center gap-1.5 min-w-0 hover:underline">
          <img
            src={data.owner.logo_url}
            alt={data.owner.name}
            className="w-7 h-7 rounded border bg-white object-contain p-0.5 shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="font-semibold truncate">{data.owner.name}</span>
        </Link>
      ) : (
        <span className="text-[11px] text-muted-foreground italic">Set freeholder above</span>
      )}
      {data.asset_lead && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-5 h-5 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[9px] font-semibold shrink-0">
              {data.asset_lead.avatar_url ? (
                <img
                  src={data.asset_lead.avatar_url}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // Avatar URL is broken (e.g. SharePoint avatar 404'd
                    // after a profile change). Drop the img and let the
                    // initials show through from the parent div's text.
                    const img = e.target as HTMLImageElement;
                    img.style.display = "none";
                    if (img.parentElement) img.parentElement.textContent = data.asset_lead!.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
                  }}
                />
              ) : (
                data.asset_lead.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()
              )}
            </div>
            <span className="text-muted-foreground truncate">
              Lead <span className="text-foreground font-medium">{data.asset_lead.name.split(" ")[0]}</span>
            </span>
          </div>
        </>
      )}
      {pct !== null && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${spineTone}`}
            title={spineTitle}
            data-testid="chip-spine-health"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${gapTotal === 0 && pct >= 95 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500"}`} />
            Spine {pct}%{gapTotal > 0 ? ` · ${gapTotal}` : ""}
          </span>
        </>
      )}
      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
        <span className="uppercase tracking-wider mr-1">Last activity</span>
        <span className="text-foreground font-medium">{timeAgo(data.property.last_updated_at)}</span>
      </span>
    </div>
  );
}

// Pipeline + Performance combined into one card. Sits above the
// Plans block in the property page (per Woody's spec) — gives the
// asset lead a single 'how's the building doing' tile without
// scrolling into the lower brief.
export function PipelinePerformanceBoard({ propertyId }: { propertyId: string }) {
  const { data, isLoading, isError } = useAssetBrief(propertyId);
  // Lozenges drill down — tap a stage to see who's in it (Woody,
  // 2026-08-05: pills that look like filters must do something).
  const [openStage, setOpenStage] = useState<string | null>(null);
  if (isError) {
    return <Card><CardContent className="p-3"><p className="text-xs text-rose-600 italic">Couldn't load — refresh to retry.</p></CardContent></Card>;
  }
  if (isLoading || !data) {
    return <Card><CardContent className="p-3"><Skeleton className="h-24 w-full" /></CardContent></Card>;
  }
  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <BarChart3 className="w-3.5 h-3.5" /> Pipeline &amp; performance
          <Badge variant="secondary" className="text-[10px]">{data.active_deals.length} active</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {/* Pipeline funnel — tap a stage with members to expand them */}
        <div className="grid grid-cols-6 gap-1.5">
          {STAGE_BUCKETS.map(b => {
            const count = data.pipeline[b.key] || 0;
            const isOpen = openStage === b.key;
            return (
              <button
                key={b.key}
                onClick={() => count > 0 && setOpenStage(isOpen ? null : b.key)}
                className={`rounded border ${b.colour} px-1.5 py-1 text-center transition-shadow ${count > 0 ? "cursor-pointer hover:shadow-sm" : "cursor-default opacity-70"} ${isOpen ? "ring-2 ring-foreground/30" : ""}`}
                data-testid={`funnel-stage-${b.key}`}
              >
                <div className="text-lg font-bold leading-none">{count}</div>
                <div className="text-[9px] uppercase tracking-wider mt-0.5">{b.label}</div>
              </button>
            );
          })}
        </div>
        {openStage && ((data as any).pipeline_items?.[openStage]?.length || 0) > 0 && (
          <div className="rounded border bg-muted/30 p-2 space-y-0.5" data-testid="funnel-stage-items">
            {((data as any).pipeline_items[openStage] as Array<{ label: string; sub: string | null }>).map((it, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="font-medium truncate">{it.label}</span>
                {it.sub && <span className="text-muted-foreground shrink-0 ml-2">{it.sub}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Performance scorecard */}
        <div className="grid grid-cols-3 gap-2 pt-1 border-t">
          <div className="rounded border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Vacancy</div>
            <div className="text-base font-bold">{(data.performance.vacancy_rate * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-muted-foreground">{data.performance.total_units - data.performance.occupied_units} of {data.performance.total_units} units</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">WAULT</div>
            <div className="text-base font-bold">{data.performance.wault_years != null ? `${data.performance.wault_years.toFixed(1)} yrs` : "—"}</div>
            <div className="text-[10px] text-muted-foreground">average unexpired</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Active deals</div>
            <div className="text-base font-bold">{data.active_deals.length}</div>
            <div className="text-[10px] text-muted-foreground">in pipeline</div>
          </div>
        </div>

        {/* Top + bottom MAT psqft side-by-side — handy at a glance */}
        {(data.performance.top_psqft.length > 0 || data.performance.bottom_psqft.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t">
            {data.performance.top_psqft.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-600" />Top MAT psqft</div>
                <div className="space-y-0.5 text-[11px]">
                  {data.performance.top_psqft.map(u => (
                    <div key={u.unit_name} className="flex items-center justify-between">
                      <span className="truncate"><span className="font-medium">{u.tenant_name || u.unit_name}</span></span>
                      <span className="font-mono text-emerald-700 shrink-0">{u.mat_psqft ? `£${Number(u.mat_psqft).toLocaleString()}` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.performance.bottom_psqft.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1"><TrendingDown className="w-3 h-3 text-rose-600" />Bottom MAT psqft</div>
                <div className="space-y-0.5 text-[11px]">
                  {data.performance.bottom_psqft.map(u => (
                    <div key={u.unit_name} className="flex items-center justify-between">
                      <span className="truncate"><span className="font-medium">{u.tenant_name || u.unit_name}</span></span>
                      <span className="font-mono text-rose-700 shrink-0">{u.mat_psqft ? `£${Number(u.mat_psqft).toLocaleString()}` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PropertyAssetBriefPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading, isError } = useAssetBrief(propertyId);

  if (isError) {
    return <Card><CardContent className="p-3"><p className="text-xs text-rose-600 italic">Couldn't load asset brief — refresh to retry.</p></CardContent></Card>;
  }
  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-3 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header strip lives in the property top board now via
          PropertyCoveringStrip. Pipeline + Performance live above
          Plans via PipelinePerformanceBoard. The brief stack here is
          the operational view: focus → active deals → activity →
          risks → commentary. */}

      {/* Weekly focus + risk register now live in the top-strip
          2-col row above this panel (next to the news feed). */}

      {/* Active deals grid removed — the right sidebar's 'Linked
          deals' panel already surfaces the same list. Active deal
          counts still feed the Pipeline & Performance card above
          Plans. */}

      {/* Recent activity moved to the right sidebar via the
          PropertyRecentActivityCard export. BGP Commentary renders
          standalone via BgpCommentaryCard in property-detail. */}

      {/* Risk register now lives in the top-strip 2-col row beside
          Weekly Focus, via the standalone RiskRegisterCard export. */}

    </div>
  );
}

// Standalone Risk Register card. Same source data as the brief
// panel via useAssetBrief (react-query dedupes). Renders compactly
// for the top-strip 2-col row beside Weekly Focus.
export function RiskRegisterCard({ propertyId }: { propertyId: string }) {
  const { data, isLoading, isError } = useAssetBrief(propertyId);
  if (isError) {
    return <Card><CardContent className="p-3"><p className="text-xs text-rose-600 italic">Couldn't load — refresh.</p></CardContent></Card>;
  }
  if (isLoading || !data) {
    return <Card><CardContent className="p-3"><Skeleton className="h-16 w-full" /></CardContent></Card>;
  }
  const high = data.risks.filter(r => r.severity === "high");
  const med = data.risks.filter(r => r.severity !== "high");
  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-3 pb-2 bg-gradient-to-r from-rose-500/[0.06] to-transparent">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <span className="w-6 h-6 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          </span>
          Risk register
          {high.length > 0 && (
            <Badge className="text-[10px] bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-300 border-transparent">{high.length} urgent</Badge>
          )}
          {med.length > 0 && (
            <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 border-transparent">{med.length} watch</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        {data.risks.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No flagged risks. All long-expiry tenants have live deals.</p>
        ) : (
          <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
            {[...high, ...med].map((r, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-xs px-2 py-1.5 rounded-md border-l-2 leading-snug ${
                  r.severity === "high"
                    ? "border-l-rose-500 bg-rose-50/60 dark:bg-rose-950/20"
                    : "border-l-amber-400 bg-amber-50/50 dark:bg-amber-950/15"
                }`}
              >
                <div className="flex-1 min-w-0">{r.message}</div>
                <span className={`text-[9px] font-semibold uppercase tracking-wide shrink-0 mt-0.5 ${
                  r.severity === "high" ? "text-rose-600" : "text-amber-600"
                }`}>{r.severity === "high" ? "Urgent" : "Watch"}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Linkage audit — visible diagnostic of what's hooked up to this
// property. Counts deals (by property_id / via unit_id /
// landlord-orphans), tasks (direct + via deal), interactions,
// units across the three tables, and tenants on the schedule that
// aren't tied to a crm_companies row. Each red number is a fix-it.
export function PropertyLinkageCard({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [resolving, setResolving] = useState(false);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/properties", propertyId, "linkage-audit"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/linkage-audit`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const runResolve = async () => {
    setResolving(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/resolve-tenants`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const bits: string[] = [];
      bits.push(`${j.resolved} tenants → brand`);
      if (j.unresolved > 0) bits.push(`${j.unresolved} still need a brand`);
      if (j.deals_linked > 0) bits.push(`${j.deals_linked} deals linked to tenancy unit`);
      if (j.available_linked > 0) bits.push(`${j.available_linked} vacant units linked`);
      if (j.leasing_linked > 0) bits.push(`${j.leasing_linked} leasing rows linked`);
      toast({ title: "Resolution complete", description: bits.join(" · ") });
      qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "linkage-audit"] });
      qc.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      qc.invalidateQueries({ queryKey: ["/api/leasing-schedule/units", propertyId] });
    } catch (e: any) {
      toast({ title: "Resolve failed", description: e.message, variant: "destructive" });
    } finally {
      setResolving(false);
    }
  };

  const [promoting, setPromoting] = useState(false);
  const [repointing, setRepointing] = useState(false);
  const runRepointMerged = async () => {
    setRepointing(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/repoint-merged-brands`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const total = (j.moved?.tenancy || 0) + (j.moved?.leasing || 0) + (j.moved?.available || 0) + (j.moved?.deals || 0);
      toast({ title: "Repointed", description: `${total} rows moved to surviving brands.` });
      qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "linkage-audit"] });
      qc.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
    } catch (e: any) {
      toast({ title: "Repoint failed", description: e.message, variant: "destructive" });
    } finally {
      setRepointing(false);
    }
  };
  const runPromote = async () => {
    setPromoting(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/promote-orphans-to-tenancy`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      toast({
        title: "Promoted to tenancy spine",
        description: `${j.tenancy_rows_created || 0} new tenancy rows · ${j.leasing_promoted || 0} leasing + ${j.available_promoted || 0} vacant lifted on`,
      });
      qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "linkage-audit"] });
      qc.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
    } catch (e: any) {
      toast({ title: "Promote failed", description: e.message, variant: "destructive" });
    } finally {
      setPromoting(false);
    }
  };

  if (isError) {
    return <p className="text-xs text-rose-600 italic">Couldn't load asset brief — refresh to retry.</p>;
  }
  if (isLoading || !data) {
    return <Skeleton className="h-24 w-full" />;
  }
  const Row = ({ label, value, warn = false }: { label: string; value: number | string; warn?: boolean }) => (
    <div className="flex items-center justify-between text-[11px] px-1 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-medium ${warn && Number(value) > 0 ? "text-rose-600" : "text-foreground"}`}>{value}</span>
    </div>
  );
  const tr = data.tenancy_resolution || { total: 0, resolved: 0, unresolved: 0 };
  return (
    <div className="space-y-2.5">
      <div className="rounded-md border border-border bg-muted/40 p-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-primary" /> Tenancy schedule (spine)
          </div>
          <Badge variant="outline" className="text-[10px] bg-white">
            {tr.resolved}/{tr.total} linked to brand
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground leading-snug mb-1.5">
          Every tenant row should resolve to a CRM brand. Linked tenants click straight to the brand board; unlinked ones won't surface deals, KYC, or news.
        </p>
        <div className="flex gap-1.5 flex-wrap">
          <Button
            size="sm" variant="default" className="h-6 text-[11px] gap-1"
            onClick={runResolve} disabled={resolving}
            data-testid="btn-resolve-tenants"
          >
            {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            Resolve unmatched tenants
          </Button>
          {((data.integrity?.leasing_units_no_unit_fk || 0) > 0 || (data.integrity?.available_units_no_unit_fk || 0) > 0) && (
            <Button
              size="sm" variant="outline" className="h-6 text-[11px] gap-1"
              onClick={runPromote} disabled={promoting}
              data-testid="btn-promote-orphans"
            >
              {promoting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Promote orphans to tenancy
            </Button>
          )}
          {tr.unresolved > 0 && (
            <Button
              size="sm" variant="outline" className="h-6 text-[11px] gap-1"
              onClick={() => setShowUnresolved(true)}
              data-testid="btn-show-unresolved"
            >
              <Search className="w-3 h-3" />
              {tr.unresolved} unresolved
            </Button>
          )}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Deals</div>
        <Row label="Active, correctly linked" value={data.deals.active_correctly_linked} />
        <Row label="Tagged with property_id" value={data.deals.by_property_id} />
        <Row label="Linked via unit only" value={data.deals.by_unit_id_only} />
        <Row label="Landlord orphans (need tagging)" value={data.deals.landlord_orphans} warn />
        {data.deals.landlord_orphans > 0 && (
          <OrphanDealsList propertyId={propertyId} />
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Tasks</div>
        <Row label="Linked direct to property" value={data.tasks.linked_direct} />
        <Row label="Via a linked deal" value={data.tasks.linked_via_deal} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Interactions on deals</div>
        <Row label="Last 30 days" value={data.interactions.last_30d} />
        <Row label="Last 90 days" value={data.interactions.last_90d} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Contacts via deals</div>
        <Row label="Distinct contacts" value={data.contacts.via_deals} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Units</div>
        <Row label="property_units (master)" value={data.units.property_units} />
        <Row label="leasing_schedule_units" value={data.units.leasing_schedule_units} />
        <Row label="available_units" value={data.units.available_units} />
        <Row label="Schedule units not yet in master" value={data.units.schedule_units_missing_from_property_units} warn />
      </div>

      {data.integrity && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Integrity gaps</div>
          <div className="flex items-center justify-between text-[11px] px-1 py-0.5">
            <span className="text-muted-foreground">Duplicate unit numbers on tenancy</span>
            <div className="flex items-center gap-1.5">
              <span className={`font-mono font-medium ${data.integrity.duplicate_unit_numbers > 0 ? "text-rose-600" : "text-foreground"}`}>
                {data.integrity.duplicate_unit_numbers}
              </span>
              {data.integrity.duplicate_unit_numbers > 0 && (
                <Button
                  size="sm" variant="ghost" className="h-4 px-1 text-[9px] text-rose-600 hover:bg-rose-50"
                  onClick={() => setShowDuplicates(true)}
                  data-testid="btn-show-duplicates"
                >
                  Fix
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] px-1 py-0.5">
            <span className="text-muted-foreground">Tenants linked to a merged brand</span>
            <div className="flex items-center gap-1.5">
              <span className={`font-mono font-medium ${data.integrity.tenants_pointing_at_merged_brand > 0 ? "text-rose-600" : "text-foreground"}`}>
                {data.integrity.tenants_pointing_at_merged_brand}
              </span>
              {data.integrity.tenants_pointing_at_merged_brand > 0 && (
                <Button
                  size="sm" variant="ghost" className="h-4 px-1 text-[9px] text-rose-600 hover:bg-rose-50"
                  onClick={runRepointMerged} disabled={repointing}
                  data-testid="btn-repoint-merged"
                >
                  {repointing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : "Repoint"}
                </Button>
              )}
            </div>
          </div>
          <Row label="Deals with property/unit mismatch" value={data.integrity.deals_with_property_unit_mismatch} warn />
          <Row label="Available units' deal on other property" value={data.integrity.available_units_deal_on_other_property} warn />
          <Row label="Active deals not yet on tenancy unit" value={data.integrity.active_deals_no_unit_fk} warn />
          <Row label="Available units not on tenancy unit" value={data.integrity.available_units_no_unit_fk} warn />
          <Row label="Leasing rows not on tenancy unit" value={data.integrity.leasing_units_no_unit_fk} warn />
        </div>
      )}

      {showDuplicates && (
        <DuplicateUnitsDialog propertyId={propertyId} onClose={() => setShowDuplicates(false)} />
      )}

      {(data.deals.landlord_orphans > 0
        || data.units.schedule_units_missing_from_property_units > 0
        || tr.unresolved > 0
        || (data.integrity && Object.values(data.integrity).some((v: any) => Number(v) > 0))) && (
        <p className="text-[10px] text-muted-foreground italic pt-1 border-t leading-snug">
          Red numbers = something the dashboard can't see yet. Hit "Resolve unmatched tenants" above — it also stamps the canonical unit FK on every deal / available / leasing row. Then adopt any orphan deals and rename duplicate units on the tenancy schedule.
        </p>
      )}

      {showUnresolved && (
        <UnresolvedTenantsDialog propertyId={propertyId} onClose={() => setShowUnresolved(false)} />
      )}
    </div>
  );
}

// Dialog showing every tenant string on the schedule that didn't
// resolve to a brand. For each, the user can search the CRM for the
// brand, pick it, and (optionally) save the tenant name as a
// trading-entity alias on the brand so the next import auto-resolves.
function UnresolvedTenantsDialog({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: unresolved = [], isLoading } = useQuery<Array<{ name: string; units: number }>>({
    queryKey: ["/api/properties", propertyId, "unresolved-tenants"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/unresolved-tenants`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status} — couldn't load unresolved tenants`);
      return res.json();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            Unresolved tenants on this property
          </DialogTitle>
          <DialogDescription className="text-xs">
            These tenant strings didn't match a brand or trading entity. Pick a brand for each and we'll add the string as a trading-entity alias so it auto-resolves next time.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : unresolved.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-8 text-center">
            Everything resolved. Nothing to fix.
          </p>
        ) : (
          <div className="space-y-2">
            {unresolved.map(u => (
              <UnresolvedTenantRow
                key={u.name}
                propertyId={propertyId}
                tenantName={u.name}
                units={u.units}
                onAssigned={() => {
                  qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "unresolved-tenants"] });
                  qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "linkage-audit"] });
                  qc.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
                  toast({ title: "Tenant linked", description: `"${u.name}" now resolves to the brand.` });
                }}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Duplicate units on the tenancy spine — same unit_number normalised
// to the same key. Lets the team pick a primary and merge the rest
// into it (moves FKs from leasing/available/deals → primary, deletes
// secondaries). One round of click-merging usually cleans up an
// imported Landsec schedule.
function DuplicateUnitsDialog({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ clusters: Record<string, any[]> }>({
    queryKey: ["/api/properties", propertyId, "duplicate-units"],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/duplicate-units`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status} — couldn't load duplicate units`);
      return r.json();
    },
  });
  const [busy, setBusy] = useState<string | null>(null);

  const merge = async (primaryId: string, secondaryId: string, force = false) => {
    setBusy(secondaryId);
    try {
      const r = await fetch(`/api/properties/${propertyId}/merge-tenancy-units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ primaryId, secondaryId, force }),
      });
      // 409 brand_mismatch — primary and secondary resolve to
      // different brands. Confirm with the team before forcing.
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        if (body?.error === "brand_mismatch") {
          const confirmed = window.confirm(
            `${body.message}\n\nClick OK to merge anyway (secondary's brand link will be replaced).`
          );
          if (confirmed) {
            await merge(primaryId, secondaryId, true);
          }
          return;
        }
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      const m = j.moved || { deals: 0, leasing: 0, available: 0 };
      toast({
        title: "Merged",
        description: `${m.deals || 0} deal · ${m.leasing || 0} leasing · ${m.available || 0} vacant links moved to primary.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "duplicate-units"] });
      qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "linkage-audit"] });
      qc.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
    } catch (e: any) {
      toast({ title: "Merge failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const clusters = data?.clusters || {};
  const clusterKeys = Object.keys(clusters);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            Duplicate unit numbers
          </DialogTitle>
          <DialogDescription className="text-xs">
            These tenancy rows share a unit name. Pick the primary (the one to keep), then click Merge on the others — their downstream deals / leasing / vacant links transfer over and the duplicate row is deleted.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? <Skeleton className="h-32 w-full" /> :
          clusterKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-8 text-center">No duplicates left.</p>
          ) : (
            <div className="space-y-3">
              {clusterKeys.map(k => (
                <DuplicateCluster key={k} cluster={clusters[k]} onMerge={merge} busy={busy} />
              ))}
            </div>
          )
        }
      </DialogContent>
    </Dialog>
  );
}

function DuplicateCluster({
  cluster, onMerge, busy,
}: { cluster: any[]; onMerge: (primaryId: string, secondaryId: string) => void; busy: string | null }) {
  const [primaryId, setPrimaryId] = useState<string>(String(cluster[0].id));
  return (
    <div className="border rounded-md p-2 space-y-1.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        "{cluster[0].unit_number}" — {cluster.length} rows
      </div>
      <div className="space-y-1">
        {cluster.map(r => {
          const isPrimary = String(r.id) === primaryId;
          return (
            <div
              key={r.id}
              className={`flex items-center gap-2 text-xs border rounded px-2 py-1 ${isPrimary ? "border-primary bg-primary/5" : "bg-white"}`}
            >
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  checked={isPrimary}
                  onChange={() => setPrimaryId(String(r.id))}
                  className="w-3 h-3"
                />
                <span className="text-[10px] text-muted-foreground">{isPrimary ? "Primary" : "Merge in"}</span>
              </label>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate">{r.tenant_name || r.trading_name || "—"}</span>
                  {r.tenant_company_id && (
                    <Badge variant="outline" className="text-[9px]">linked</Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {r.status || "—"}
                  {r.nia_sqft && ` · ${Math.round(Number(r.nia_sqft)).toLocaleString()} sqft`}
                  {r.passing_rent_pa && ` · £${Math.round(Number(r.passing_rent_pa)).toLocaleString()} pa`}
                  {r.lease_expiry && ` · exp ${new Date(r.lease_expiry).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`}
                </div>
              </div>
              {!isPrimary && (
                <Button
                  size="sm" variant="outline" className="h-5 text-[10px] px-1.5 text-rose-700 border-rose-300 hover:bg-rose-50"
                  onClick={() => onMerge(primaryId, String(r.id))}
                  disabled={busy === String(r.id)}
                >
                  {busy === String(r.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : "Merge"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Inline list of active landlord-orphan deals (no property_id set,
// tagged on the landlord only). Each row has a one-click "Adopt"
// button that stamps property_id (and unit_id if the tenant resolves
// to a unit on the tenancy schedule).
function OrphanDealsList({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data = [] } = useQuery<Array<{ id: string; name: string; status: string; tenant_name: string | null; deal_ref: string | null; rent_pa: number | null }>>({
    queryKey: ["/api/properties", propertyId, "orphan-deals"],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/orphan-deals`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const adopt = async (dealId: string) => {
    setBusyId(dealId);
    try {
      const r = await fetch(`/api/properties/${propertyId}/adopt-deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dealId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      toast({ title: "Deal adopted", description: j.unitId ? "Linked to property and unit." : "Linked to property." });
      qc.invalidateQueries({ queryKey: ["/api/properties", propertyId] });
    } catch (e: any) {
      toast({ title: "Adopt failed", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  if (!data.length) return null;
  return (
    <div className="mt-1 space-y-1 pl-1 border-l-2 border-rose-200">
      {data.slice(0, 5).map(d => (
        <div key={d.id} className="flex items-center gap-1.5 text-[11px] py-0.5">
          <span className="font-medium truncate flex-1">
            {d.tenant_name || d.name || "Untitled deal"}
            {d.deal_ref && <span className="ml-1 text-muted-foreground">#{d.deal_ref}</span>}
          </span>
          <Badge variant="outline" className="text-[9px]">{d.status}</Badge>
          <Button
            size="sm" variant="ghost" className="h-5 text-[10px] gap-0.5 px-1.5"
            onClick={() => adopt(d.id)} disabled={busyId === d.id}
            data-testid={`btn-adopt-deal-${d.id}`}
          >
            {busyId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Adopt
          </Button>
        </div>
      ))}
      {data.length > 5 && (
        <p className="text-[10px] text-muted-foreground italic">+{data.length - 5} more orphan deals</p>
      )}
    </div>
  );
}

function UnresolvedTenantRow({
  propertyId, tenantName, units, onAssigned,
}: { propertyId: string; tenantName: string; units: number; onAssigned: () => void }) {
  const { toast } = useToast();
  const [query, setQuery] = useState(tenantName);
  // Debounced version of `query` — typing fires the on-change every
  // keystroke but the search only re-runs 300ms after the user stops,
  // so we don't hammer the API while someone types "Sainsbury's".
  const [debouncedQuery, setDebouncedQuery] = useState(tenantName);
  const [showResults, setShowResults] = useState(false);
  const [saveAsAlias, setSaveAsAlias] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [] } = useQuery<Array<{ id: string; name: string; domain: string | null }>>({
    queryKey: ["/api/crm/companies/search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) return [];
      const r = await fetch(`/api/crm/companies?q=${encodeURIComponent(debouncedQuery)}&limit=8`, { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d.companies || []);
      return arr.map((c: any) => ({ id: String(c.id), name: c.name, domain: c.domain || c.domainUrl || null }));
    },
    staleTime: 30_000,
    enabled: showResults,
  });

  const assign = async (brandCompanyId: string) => {
    setSaving(true);
    try {
      const r = await fetch(`/api/properties/${propertyId}/assign-tenant-brand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tenantName, brandCompanyId, addAsTradingEntity: saveAsAlias }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      onAssigned();
    } catch (e: any) {
      toast({ title: "Assign failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
      setShowResults(false);
    }
  };

  return (
    <div className="border rounded-md p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{tenantName}</div>
        <Badge variant="outline" className="text-[10px]">{units} {units === 1 ? "unit" : "units"}</Badge>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
            placeholder="Search CRM for brand…"
            className="h-7 text-xs"
          />
          {showResults && results.length > 0 && (
            <div className="absolute z-20 top-7 left-0 right-0 bg-white border rounded-md shadow-md max-h-48 overflow-y-auto">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => assign(r.id)}
                  disabled={saving}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted border-b last:border-b-0"
                >
                  <div className="font-medium">{r.name}</div>
                  {r.domain && <div className="text-[10px] text-muted-foreground">{r.domain}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={saveAsAlias} onChange={e => setSaveAsAlias(e.target.checked)} className="w-3 h-3" />
          Save as alias
        </label>
        {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}

// Recent activity (last 14 days) — extracted for use in the right
// sidebar dropdown rather than the main column. Sanitised summaries
// only, no email body content (per the access rules for client
// users like Mark at Landsec).
export function PropertyRecentActivityCard({ propertyId }: { propertyId: string }) {
  const { data, isLoading, isError } = useAssetBrief(propertyId);
  if (isError) {
    return <p className="text-xs text-rose-600 italic">Couldn't load asset brief — refresh to retry.</p>;
  }
  if (isLoading || !data) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (data.activity.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No emails / calls / meetings logged in the last 14 days.</p>;
  }
  return (
    <div className="space-y-0.5 max-h-[360px] overflow-y-auto pr-1">
      {data.activity.map(a => {
        const Icon = a.kind === "email" ? Mail : a.kind === "call" ? Phone : a.kind === "meeting" ? Users : Activity;
        return (
          <div key={a.id} className="flex items-start gap-2 text-xs px-1.5 py-1 rounded hover:bg-muted/40">
            <Icon className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="leading-snug">{a.summary}</div>
              <div className="text-[10px] text-muted-foreground">{timeAgo(a.date)}</div>
            </div>
            {a.deal_id && (
              <Link href={`/deals/${a.deal_id}`}>
                <Badge variant="outline" className="text-[9px] shrink-0 cursor-pointer hover:bg-muted">
                  deal →
                </Badge>
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

// BGP Commentary — purple AI panel matching the brand_analysis
// design pattern. Reads from data.bgp_commentary; refresh button
// regenerates via Claude from the live asset-brief context.
// Minimal markdown for the AI commentary — paragraph spacing + **bold**
// (Landsec, 2026-08-04: the prose wall was "hard to read"). Same treatment
// as the mobile briefing renderer.
export function renderAiCommentary(text: string) {
  return text.split(/\n+/).filter(l => l.trim()).map((para, i) => (
    <p key={i} className="text-sm leading-relaxed text-foreground/90 mb-2 last:mb-0">
      {para.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={j}>{p.slice(2, -2)}</strong>
          : <span key={j}>{p}</span>
      )}
    </p>
  ));
}

export function BgpCommentaryCard({ propertyId, commentary, updatedAt }: { propertyId: string; commentary: string | null; updatedAt: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/properties/${propertyId}/bgp-commentary/regenerate`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "BGP Commentary refreshed" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "asset-brief"] });
    },
    onError: (e: any) => toast({ title: "Couldn't regenerate", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-muted-foreground" /> BGP Commentary
          {updatedAt && (
            <span className="text-[10px] text-muted-foreground font-normal ml-auto">
              {new Date(updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          )}
        </CardTitle>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px]"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
          title="Re-run Claude over the latest deals / activity / risks"
        >
          <Sparkles className={`w-3 h-3 mr-1 ${regenerate.isPending ? "animate-spin" : ""}`} />
          {regenerate.isPending ? "Thinking…" : (commentary ? "Refresh" : "Generate")}
        </Button>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {commentary ? (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            {renderAiCommentary(commentary)}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-3 text-center">
            <p className="text-xs text-muted-foreground">No commentary yet. Generate one based on the live deals, activity feed, risks, and leasing schedule for this property.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Weekly focus — pulled live from the existing my-tasks system,
// filtered to tasks linked to this property OR a deal whose unit
// belongs here. Shows what every BGP user is actively pushing on
// the building, with the same priority / due-date / status rules
// the My Tasks page uses. Inline 'add task' creates a row tied to
// this property without leaving the page.
interface PropertyTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "urgent" | "high" | "medium" | "low" | null;
  status: string;
  is_pinned: boolean;
  linked_deal_id: string | null;
  linked_property_id: string | null;
  user_id: string;
  owner_name: string | null;
  profile_pic_url: string | null;
  deal_name: string | null;
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-rose-500",
  high: "bg-amber-500",
  medium: "bg-sky-500",
  low: "bg-slate-300",
};

function dueLabel(iso: string | null): { label: string; tone: "overdue" | "soon" | "later" | null } {
  if (!iso) return { label: "", tone: null };
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { label: "today", tone: "soon" };
  if (days === 1) return { label: "tomorrow", tone: "soon" };
  if (days < 7) return { label: `${days}d`, tone: "soon" };
  return { label: new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), tone: "later" };
}

export function WeeklyFocusCard({ propertyId }: { propertyId: string; focus?: AssetBrief["weekly_focus"] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  // Same abilities as My Tasks on create (Woody, 2026-08-04: "same level
  // of ability?") — assign to a colleague and set priority inline.
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState("medium");
  const { data: allUsersRaw } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/users"] });
  const allUsers = Array.isArray(allUsersRaw) ? allUsersRaw : [];

  const { data: tasksRes } = useQuery<{ tasks: PropertyTask[] }>({
    queryKey: ["/api/properties", propertyId, "tasks"],
    queryFn: async () => {
      // Bearer header too, not just cookies — token-auth contexts (the
      // mobile app) got a 401 here and the focus list rendered empty even
      // though task creation worked.
      const res = await fetch(`/api/properties/${propertyId}/tasks?status=active`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  const tasks = tasksRes?.tasks || [];

  const addTask = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiRequest("POST", "/api/tasks", {
        title,
        linkedPropertyId: propertyId,
        priority,
        ...(assigneeId ? { assigneeUserId: assigneeId } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      setDraft("");
      setAssigneeId("");
      setPriority("medium");
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: (e: any) => toast({ title: "Couldn't add task", description: e?.message, variant: "destructive" }),
  });

  const completeTask = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/tasks/${id}`, { status: "done" });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "tasks"] }),
    onError: (e: any) => toast({ title: "Couldn't update", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Target className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          This week's focus
          <Badge variant="secondary" className="text-[10px]">{tasks.length}</Badge>
        </CardTitle>
        <Link href="/tasks">
          <Button size="sm" variant="ghost" className="h-6 text-[10px]">
            All tasks →
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-1.5">
        {tasks.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">No open tasks on this property. Add the things being pushed this week below — they'll appear on My Tasks too.</p>
        )}
        <div className="space-y-0.5 max-h-[220px] overflow-y-auto pr-1">
          {tasks.slice(0, 10).map(t => {
            const due = dueLabel(t.due_date);
            return (
              <div key={t.id} className={`flex items-start gap-2 text-[12px] px-2 py-1.5 rounded-md border-l-2 group ${
                t.priority === "high"
                  ? "border-l-rose-400 bg-rose-50/50 dark:bg-rose-950/15 hover:bg-rose-50 dark:hover:bg-rose-950/25"
                  : t.priority === "low"
                    ? "border-l-slate-300 dark:border-l-slate-700 hover:bg-muted/40"
                    : "border-l-violet-300 dark:border-l-violet-800 bg-violet-50/30 dark:bg-violet-950/10 hover:bg-violet-50/60 dark:hover:bg-violet-950/20"
              }`}>
                <button
                  onClick={() => completeTask.mutate(t.id)}
                  disabled={completeTask.isPending}
                  className="w-3.5 h-3.5 rounded border border-muted-foreground/40 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950 mt-0.5 shrink-0 flex items-center justify-center transition-colors"
                  title="Mark task done"
                  data-testid={`task-complete-${t.id}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-transparent group-hover:bg-emerald-500" />
                </button>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${PRIORITY_DOT[t.priority || "medium"]}`} title={`Priority: ${t.priority || "medium"}`} />
                <div className="flex-1 min-w-0">
                  <div className="leading-snug truncate">{t.title}</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                    {t.owner_name && <span>{t.owner_name.split(" ")[0]}</span>}
                    {t.deal_name && (
                      <>
                        <span>·</span>
                        <Link href={`/deals/${t.linked_deal_id}`}>
                          <span className="hover:underline truncate">{t.deal_name}</span>
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                {due.label && (
                  <span className={`text-[10px] shrink-0 mt-0.5 font-medium ${
                    due.tone === "overdue" ? "text-rose-600" : due.tone === "soon" ? "text-amber-600" : "text-muted-foreground"
                  }`}>{due.label}</span>
                )}
              </div>
            );
          })}
          {tasks.length > 10 && (
            <div className="text-[10px] italic text-muted-foreground pt-1 px-1.5">
              + {tasks.length - 10} more — see them all on My Tasks.
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 pt-1 border-t mt-1.5 flex-wrap">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) addTask.mutate(draft.trim()); }}
            placeholder="Add a task — e.g. Pizza Express HOTs to legals by Friday"
            className="text-xs h-7 flex-1 min-w-[180px]"
          />
          <Select value={assigneeId || "me"} onValueChange={(v) => setAssigneeId(v === "me" ? "" : v)}>
            <SelectTrigger className="h-7 w-[110px] text-[10px]" data-testid="focus-task-assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="me">Me</SelectItem>
              {allUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-7 w-[80px] text-[10px]" data-testid="focus-task-priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            onClick={() => draft.trim() && addTask.mutate(draft.trim())}
            disabled={!draft.trim() || addTask.isPending}
          >
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
