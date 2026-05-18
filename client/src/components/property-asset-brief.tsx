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
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Target, Handshake, Activity, AlertTriangle, BarChart3, Building2,
  Pencil, Plus, Trash2, ChevronRight, Mail, Phone, Users,
  Calendar as CalendarIcon, TrendingUp, TrendingDown,
} from "lucide-react";

interface AssetBrief {
  property: { id: string; name: string; postcode: string | null; last_updated_at: string };
  owner: { id: string; name: string; logo_url: string; domain: string | null } | null;
  asset_lead: { id: string; name: string; email: string | null; avatar_url: string | null } | null;
  weekly_focus: Array<{ id: string; text: string; owner_user_id?: string | null; deal_id?: string | null }>;
  active_deals: Array<{
    id: string; name: string; status: string; stage_label: string; stage_bucket: string;
    unit_id: string | null; unit_name: string | null;
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
      const res = await fetch(`/api/properties/${propertyId}/asset-brief`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

// Compact covering strip — Asset Owner logo + Asset Lead avatar +
// Last activity. Sits in the property's top board, replacing the
// old Tenants + Comp. Instructed row. Same data as the brief
// panel; react-query dedupes the network call.
export function PropertyCoveringStrip({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useAssetBrief(propertyId);
  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded" />
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {data.owner ? (
        <div className="flex items-center gap-2">
          <img
            src={data.owner.logo_url}
            alt={data.owner.name}
            className="w-10 h-10 rounded border bg-white object-contain p-1 shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-tight">Asset owner</div>
            <Link href={`/companies/${data.owner.id}`}>
              <div className="text-sm font-semibold hover:underline truncate">{data.owner.name}</div>
            </Link>
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground italic">Set freeholder / landlord above to show owner.</div>
      )}
      {data.asset_lead && (
        <div className="flex items-center gap-2 border-l pl-3 ml-1">
          <div className="w-8 h-8 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[10px] font-semibold shrink-0">
            {data.asset_lead.avatar_url
              ? <img src={data.asset_lead.avatar_url} alt="" className="w-full h-full object-cover" />
              : data.asset_lead.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-tight">Asset lead</div>
            <div className="text-sm font-semibold truncate">{data.asset_lead.name}</div>
          </div>
        </div>
      )}
      <div className="ml-auto text-right">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-tight">Last activity</div>
        <div className="text-xs font-medium">{timeAgo(data.property.last_updated_at)}</div>
      </div>
    </div>
  );
}

// Pipeline + Performance combined into one card. Sits above the
// Plans block in the property page (per Woody's spec) — gives the
// asset lead a single 'how's the building doing' tile without
// scrolling into the lower brief.
export function PipelinePerformanceBoard({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useAssetBrief(propertyId);
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
        {/* Pipeline funnel */}
        <div className="grid grid-cols-6 gap-1.5">
          {STAGE_BUCKETS.map(b => (
            <div key={b.key} className={`rounded border ${b.colour} px-1.5 py-1 text-center`}>
              <div className="text-lg font-bold leading-none">{data.pipeline[b.key] || 0}</div>
              <div className="text-[9px] uppercase tracking-wider mt-0.5">{b.label}</div>
            </div>
          ))}
        </div>

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
  const { data, isLoading } = useAssetBrief(propertyId);

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

      {/* Active deals grid */}
      <Card>
        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <Handshake className="w-3.5 h-3.5" /> Active deals
            <Badge variant="secondary" className="text-[10px]">{data.active_deals.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {data.active_deals.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">No active deals on this property.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.active_deals.slice(0, 12).map(d => (
                <Link key={d.id} href={`/deals/${d.id}`}>
                  <div className="flex items-start gap-2 p-2 rounded border bg-card hover:bg-muted/50 transition-colors cursor-pointer">
                    {d.tenant_logo_url && (
                      <img
                        src={d.tenant_logo_url}
                        alt=""
                        className="w-8 h-8 rounded border bg-white object-contain p-0.5 shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold truncate">{d.tenant_name || d.name}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0">{d.stage_label}</Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {d.unit_name && <span>{d.unit_name}</span>}
                        {d.fee_pence != null && <span> · {formatMoney(d.fee_pence)} fee</span>}
                        {d.last_touch_at && <span> · {timeAgo(d.last_touch_at)}</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </Link>
              ))}
              {data.active_deals.length > 12 && (
                <div className="text-[10px] text-muted-foreground italic col-span-full">
                  + {data.active_deals.length - 12} more — view all via the Deals tab
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity feed (sanitised summaries — no email body content) */}
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <Activity className="w-3.5 h-3.5" /> Recent activity
            <Badge variant="secondary" className="text-[10px]">last 14 days</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {data.activity.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">No emails / calls / meetings logged in the last 14 days.</p>
          ) : (
            <div className="space-y-0.5 max-h-[260px] overflow-y-auto pr-1">
              {data.activity.map(a => {
                const Icon = a.kind === "email" ? Mail : a.kind === "call" ? Phone : a.kind === "meeting" ? Users : Activity;
                return (
                  <div key={a.id} className="flex items-start gap-2 text-[11px] px-1.5 py-1 rounded hover:bg-muted/40">
                    <Icon className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{a.summary}</div>
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
          )}
        </CardContent>
      </Card>

      {/* Risk register now lives in the top-strip 2-col row beside
          Weekly Focus, via the standalone RiskRegisterCard export. */}

    </div>
  );
}

// Standalone Risk Register card. Same source data as the brief
// panel via useAssetBrief (react-query dedupes). Renders compactly
// for the top-strip 2-col row beside Weekly Focus.
export function RiskRegisterCard({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useAssetBrief(propertyId);
  if (isLoading || !data) {
    return <Card><CardContent className="p-3"><Skeleton className="h-16 w-full" /></CardContent></Card>;
  }
  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5" /> Risk register
          <Badge variant="secondary" className="text-[10px]">{data.risks.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {data.risks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">No flagged risks. All long-expiry tenants have live deals.</p>
        ) : (
          <div className="space-y-0.5 max-h-[220px] overflow-y-auto pr-1">
            {data.risks.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] px-1.5 py-1 rounded">
                <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${r.severity === "high" ? "bg-rose-500" : "bg-amber-500"}`} />
                <div className="flex-1 min-w-0">{r.message}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Weekly focus — small editor inline. PATCH the whole list back on
// each add / remove / edit. Tight CRUD, no undo, but the list is
// 3-5 items so this is fine. Exported so it can render in the
// property's top-strip 2-col row beside the Risk Register.
export function WeeklyFocusCard({ propertyId, focus: focusProp }: { propertyId: string; focus?: AssetBrief["weekly_focus"] }) {
  // If parent didn't pass focus down, fetch it ourselves so the
  // card stays usable standalone (the property top-strip use case).
  const { data } = useAssetBrief(propertyId);
  const focus = focusProp ?? (data?.weekly_focus || []);
  return <WeeklyFocusCardInner propertyId={propertyId} focus={focus} />;
}

function WeeklyFocusCardInner({ propertyId, focus }: { propertyId: string; focus: AssetBrief["weekly_focus"] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: async (next: AssetBrief["weekly_focus"]) => {
      const res = await apiRequest("PATCH", `/api/properties/${propertyId}/weekly-focus`, { focus: next });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "asset-brief"] }),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });

  function addItem() {
    const text = draft.trim();
    if (!text) return;
    save.mutate([...focus, { id: `f-${Date.now()}`, text }]);
    setDraft("");
  }
  function removeItem(id: string) {
    save.mutate(focus.filter(f => f.id !== id));
  }

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Target className="w-3.5 h-3.5" /> This week's focus
          <Badge variant="secondary" className="text-[10px]">{focus.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-1.5">
        {focus.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">Nothing on the focus list yet. Add the 3-5 things being pushed this week so the client sees what's in motion.</p>
        )}
        {focus.map(f => (
          <div key={f.id} className="flex items-start gap-2 text-sm px-1.5 py-1 rounded hover:bg-muted/40 group">
            <span className="text-emerald-600 mt-1">▸</span>
            <span className="flex-1 leading-snug">{f.text}</span>
            <button
              onClick={() => removeItem(f.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-rose-500 hover:text-rose-700"
              title="Remove from focus list"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5 pt-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
            placeholder="e.g. Pizza Express HOTs to legals by Friday"
            className="text-sm h-8"
          />
          <Button size="sm" variant="outline" className="h-8" onClick={addItem} disabled={!draft.trim() || save.isPending}>
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
