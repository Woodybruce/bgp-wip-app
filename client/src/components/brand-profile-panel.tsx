import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, Store, TrendingUp, TrendingDown, Users, Handshake, ShieldCheck,
  Building2, ExternalLink, Pencil, Check, X, Plus, Image as ImageIcon,
  Instagram, Coins, FileText, AlertCircle, Clock, Download, Newspaper,
  MapPin, Activity, Target, Briefcase, PoundSterling, Search,
} from "lucide-react";
import { BrandPortfolioMap } from "@/components/brand-portfolio-map";

interface BrandProfile {
  company: {
    id: string;
    name: string;
    description: string | null;
    company_type: string | null;
    companies_house_number: string | null;
    companies_house_data: any;
    domain: string | null;
    domain_url: string | null;
    is_tracked_brand: boolean;
    tracking_reason: string | null;
    brand_group_id: string | null;
    parent_company_id: string | null;
    concept_pitch: string | null;
    store_count: number | null;
    rollout_status: string | null;
    backers: string | null;
    instagram_handle: string | null;
    agent_type: string | null;
    ai_generated_fields: Record<string, string> | null;
    last_enriched_at: string | null;
    brand_analysis: string | null;
    brand_analysis_at: string | null;
    kyc_status: string | null;
    kyc_expires_at: string | null;
    aml_risk_level: string | null;
    aml_pep_status: string | null;
    bgp_contact_crm: string | null;
  };
  signals: Array<any>;
  representedBy: Array<any>;
  representing: Array<any>;
  kyc: { doc_count: number; last_uploaded_at: string | null };
  images: Array<any>;
  deals: Array<any>;
  completedDeals: Array<any>;
  activeDeals: Array<any>;
  parentGroup: { id: string; name: string; store_count: number | null } | null;
  siblings: Array<any>;
  news: Array<{
    id: string;
    title: string;
    summary: string | null;
    ai_summary: string | null;
    url: string;
    image_url: string | null;
    source_name: string | null;
    published_at: string | null;
    category: string | null;
  }>;
  requirements: Array<{ id: string; size_min: string | null; size_max: string | null; budget: string | null; use_class: string | null; status: string | null; location_notes: string | null; updated_at: string | null }>;
  pitchedTo: Array<{ id: string; unit_name: string | null; target_brands: string | null; status: string | null; priority: string | null; property_id: string; property_name: string; property_address: string | null; updated_at: string | null }>;
  contacts: Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null; linkedin_url: string | null; avatar_url: string | null; last_contacted_at: string | null; enrichment_source: string | null }>;
  stores: Array<{ id: string; name: string; address: string | null; lat: number | null; lng: number | null; place_id: string | null; status: string | null; store_type: string | null; source_type: string | null; researched_at: string | null }>;
  turnover: Array<{ period: string | null; turnover: number | null; turnover_per_sqft: number | null; confidence: string | null; source: string | null }>;
  covenant: {
    companyStatus: string | null;
    accountsOverdue: boolean;
    confirmationStatementOverdue: boolean;
    hasInsolvencyHistory: boolean;
    hasCharges: boolean;
    lastAccountsMadeUpTo: string | null;
    dateOfCreation: string | null;
    checkedAt: string | null;
    trafficLight: "green" | "amber" | "red";
  } | null;
  rolloutVelocity: {
    openings12m: number;
    closures12m: number;
    net12m: number;
    currentOpen: number;
    currentClosed: number;
  } | null;
  rentAffordability: {
    avgRentPsf: number | null;
    avgTurnoverPsf: number | null;
    rentToTurnoverPct: number | null;
    peerRentPsf: number | null;
    peerSampleSize: number;
    brandSampleSize: number;
    useClass: string | null;
  } | null;
  rentComps: Array<{
    id: string;
    tenant: string | null;
    area_sqft: number | null;
    headline_rent: number | null;
    rent_psf_overall: number | null;
    rent_psf_nia: number | null;
    zone_a_rate: number | null;
    use_class: string | null;
    postcode: string | null;
    completion_date: string | null;
  }>;
  bgpDeals: Array<{
    id: string;
    name: string;
    deal_type: string | null;
    status: string | null;
    fee: number | null;
    team: string[] | null;
    internal_agent: string[] | null;
    created_at: string | null;
    updated_at: string | null;
    party_role: string | null;
    property_name: string | null;
  }>;
  bgpSummary: {
    totalDeals: number;
    completedDeals: number;
    totalFees: number;
    team: string[];
    interactionsTotal: number;
    interactionsLast90d: number;
    lastInteractionAt: string | null;
  };
  decisionMakers: Array<{
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    avatar_url: string | null;
    last_enriched_at: string | null;
  }>;
  leaseEvents: Array<{
    id: string;
    unit_name: string | null;
    tenant_name: string | null;
    lease_expiry: string | null;
    lease_break: string | null;
    rent_review: string | null;
    property_id: string;
    property_name: string;
  }>;
  competitors: Array<{
    id: string;
    name: string;
    store_count: number | null;
    rollout_status: string | null;
  }>;
  spacePreferences: {
    sampleSize: number;
    sqftMin: number | null;
    sqftMax: number | null;
    sqftMedian: number | null;
    rentPsfMin: number | null;
    rentPsfMax: number | null;
    rentPsfMedian: number | null;
    topUseClass: string | null;
  };
}

const ROLLOUT_OPTIONS = [
  { value: "scaling",      label: "Scaling — opening stores" },
  { value: "stable",       label: "Stable — holding estate" },
  { value: "contracting",  label: "Contracting — closing stores" },
  { value: "entering_uk",  label: "Entering UK" },
  { value: "rumoured",     label: "Rumoured entry" },
];

function RolloutBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string; icon: any }> = {
    scaling:     { label: "Scaling",     cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: TrendingUp },
    stable:      { label: "Stable",      cls: "bg-blue-100 text-blue-700 border-blue-200",          icon: Check },
    contracting: { label: "Contracting", cls: "bg-red-100 text-red-700 border-red-200",             icon: TrendingDown },
    entering_uk: { label: "Entering UK", cls: "bg-purple-100 text-purple-700 border-purple-200",    icon: Sparkles },
    rumoured:    { label: "Rumoured",    cls: "bg-amber-100 text-amber-700 border-amber-200",       icon: AlertCircle },
  };
  const m = map[status];
  if (!m) return <Badge variant="outline">{status}</Badge>;
  const Icon = m.icon;
  return <Badge className={m.cls}><Icon className="w-3 h-3 mr-1" />{m.label}</Badge>;
}

function Sparkline({ values, width = 60, height = 16 }: { values: number[]; width?: number; height?: number }) {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length < 2) return null;
  const max = Math.max(...clean);
  const min = Math.min(...clean);
  const span = max - min || 1;
  const step = width / (clean.length - 1);
  const points = clean.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`).join(" ");
  const lastIsUp = clean[clean.length - 1] >= clean[0];
  return (
    <svg width={width} height={height} className="inline-block" aria-hidden>
      <polyline
        fill="none"
        stroke={lastIsUp ? "#059669" : "#dc2626"}
        strokeWidth={1.5}
        points={points}
      />
    </svg>
  );
}

function AiChip() {
  return (
    <span title="AI-generated — any edit makes it ground truth" className="inline-flex items-center gap-0.5 text-[10px] text-purple-600 ml-1">
      <Sparkles className="w-2.5 h-2.5" /> ai
    </span>
  );
}

type RepForm = {
  otherCompanyId: string;
  otherCompanyName: string;
  agent_type: string;
  region: string;
};

const EMPTY_REP_FORM: RepForm = { otherCompanyId: "", otherCompanyName: "", agent_type: "tenant_rep", region: "" };

export function BrandProfilePanel({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<BrandProfile["company"]>>({});
  const [addRep, setAddRep] = useState<"brand" | "agent" | null>(null);
  const [repForm, setRepForm] = useState<RepForm>(EMPTY_REP_FORM);
  const [repSearch, setRepSearch] = useState("");

  const { data, isLoading, isError } = useQuery<BrandProfile>({
    queryKey: ["/api/brand", companyId, "profile"],
    queryFn: async () => {
      const res = await fetch(`/api/brand/${companyId}/profile`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const patchMutation = useMutation({
    mutationFn: async (body: Partial<BrandProfile["company"]>) => {
      const res = await apiRequest("PATCH", `/api/brand/${companyId}`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Brand profile saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", companyId] });
      setEditing(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/brand/enrich/${companyId}`, {});
      return res.json();
    },
    onSuccess: (out: { updated?: string[]; skipped?: string[]; reason?: string }) => {
      if (out.reason) {
        toast({ title: "AI enrichment skipped", description: out.reason, variant: "destructive" });
      } else if (!out.updated || out.updated.length === 0) {
        toast({ title: "No new info found", description: "AI had nothing to add." });
      } else {
        toast({ title: "Enriched", description: `Updated: ${out.updated.join(", ")}` });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", companyId] });
    },
    onError: (e: any) => toast({ title: "Enrichment failed", description: e.message, variant: "destructive" }),
  });

  const findUkEntityMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/companies-house/find-uk-entity/${companyId}`, {});
      return res.json();
    },
    onSuccess: (out: any) => {
      const msg = `${out.ukStores?.length || 0} UK stores found · ${out.activeChCandidates?.length || 0} active CH candidates`;
      toast({ title: "UK entity search complete", description: msg });
    },
    onError: (e: any) => toast({ title: "UK entity search failed", description: e.message, variant: "destructive" }),
  });

  // All companies, used by the representation picker (autocomplete)
  const { data: allCompaniesForPicker = [] } = useQuery<Array<{ id: string; name: string; agent_type: string | null; is_tracked_brand: boolean }>>({
    queryKey: ["/api/crm/companies"],
    enabled: addRep !== null,
  });

  const addRepMutation = useMutation({
    mutationFn: async (vars: { brandCompanyId: string; agentCompanyId: string; agentType: string; region?: string }) => {
      const res = await apiRequest("POST", `/api/brand/representations`, vars);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Representation added" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      setAddRep(null);
      setRepForm(EMPTY_REP_FORM);
      setRepSearch("");
    },
    onError: (e: any) => toast({ title: "Add failed", description: e.message, variant: "destructive" }),
  });

  const endRepMutation = useMutation({
    mutationFn: async (repId: string) => {
      await apiRequest("PATCH", `/api/brand/representations/${repId}`, { end_date: new Date().toISOString().slice(0, 10) });
    },
    onSuccess: () => {
      toast({ title: "Representation ended" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return null;

  const c = data.company;
  const aiFields = c.ai_generated_fields || {};
  const stores = data.stores || [];
  const pitchedTo = data.pitchedTo || [];
  const requirements = data.requirements || [];
  const completedDeals = data.completedDeals || [];
  const activeDeals = data.activeDeals || [];
  const turnover = data.turnover || [];
  const covenant = data.covenant || null;
  const rolloutVelocity = data.rolloutVelocity || null;
  const rentAffordability = data.rentAffordability || null;
  const rentComps = data.rentComps || [];
  const bgpDeals = data.bgpDeals || [];
  const bgpSummary = data.bgpSummary || null;
  const decisionMakers = data.decisionMakers || [];
  const leaseEvents = data.leaseEvents || [];
  const competitors = data.competitors || [];
  const spacePreferences = data.spacePreferences || null;
  const siblingBrands = data.siblings || [];
  const parentGroup = data.parentGroup || null;
  const isBrand = !!c.is_tracked_brand;
  const isAgent = !!c.agent_type;

  const startEdit = () => {
    setForm({
      concept_pitch: c.concept_pitch || "",
      store_count: c.store_count as any,
      rollout_status: c.rollout_status || "",
      backers: c.backers || "",
      instagram_handle: c.instagram_handle || "",
      tracking_reason: c.tracking_reason || "",
      agent_type: c.agent_type || "",
      is_tracked_brand: c.is_tracked_brand,
    });
    setEditing(true);
  };

  return (
    <Card data-testid="brand-profile-panel">
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-500" />
          Brand Profile
          {c.is_tracked_brand && <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px]">Tracked brand</Badge>}
          {c.agent_type && <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">{c.agent_type.replace(/_/g, " ")}</Badge>}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(`/api/brand/${companyId}/pack.pdf`, "_blank")}
            title="Download brand pack PDF"
            data-testid="button-brand-pack"
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending || editing}
            title="Ask AI to fill in gaps"
            data-testid="button-brand-enrich"
          >
            <Sparkles className={`w-3.5 h-3.5 text-purple-500 ${enrichMutation.isPending ? "animate-pulse" : ""}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={editing ? () => setEditing(false) : startEdit} data-testid="button-brand-edit">
            {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-0 space-y-2.5">
        {editing ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Agent type (leave blank if this isn't an agent)</Label>
              <Select value={(form.agent_type as string) || "none"} onValueChange={(v) => setForm({ ...form, agent_type: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Not an agent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not an agent</SelectItem>
                  <SelectItem value="tenant_rep">Tenant rep</SelectItem>
                  <SelectItem value="landlord_rep">Landlord rep</SelectItem>
                  <SelectItem value="investment">Investment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Concept pitch</Label>
              <Textarea
                value={(form.concept_pitch as string) || ""}
                onChange={(e) => setForm({ ...form, concept_pitch: e.target.value })}
                rows={3}
                placeholder="e.g. Premium artisan bakery with all-day café, targeting prime high streets"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Store count</Label>
                <Input
                  type="number"
                  value={form.store_count ?? ""}
                  onChange={(e) => setForm({ ...form, store_count: e.target.value === "" ? null : Number(e.target.value) as any })}
                />
              </div>
              <div>
                <Label className="text-xs">Rollout status</Label>
                <Select value={(form.rollout_status as string) || "none"} onValueChange={(v) => setForm({ ...form, rollout_status: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Unknown" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unknown</SelectItem>
                    {ROLLOUT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Backers / investors</Label>
              <Input value={(form.backers as string) || ""} onChange={(e) => setForm({ ...form, backers: e.target.value })} placeholder="e.g. Sequoia, Index Ventures" />
            </div>
            <div>
              <Label className="text-xs">Instagram handle</Label>
              <Input value={(form.instagram_handle as string) || ""} onChange={(e) => setForm({ ...form, instagram_handle: e.target.value })} placeholder="@brandname" />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button size="sm" onClick={() => patchMutation.mutate(form)} disabled={patchMutation.isPending}>
                <Check className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Concept pitch */}
            {c.concept_pitch && (
              <div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                  <FileText className="w-3 h-3" /> Concept {aiFields.concept_pitch && <AiChip />}
                </div>
                <p className="text-sm leading-snug">{c.concept_pitch}</p>
              </div>
            )}

            {/* AI brand analysis — auto-generated briefing */}
            {c.brand_analysis && (
              <div className="rounded-md border border-purple-200 dark:border-purple-900 bg-purple-50/60 dark:bg-purple-950/30 p-2">
                <div className="flex items-center gap-1 text-[11px] text-purple-700 dark:text-purple-300 mb-1">
                  <Sparkles className="w-3 h-3" /> Brand analysis
                  {c.brand_analysis_at && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(c.brand_analysis_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-snug text-foreground/90">{c.brand_analysis}</p>
              </div>
            )}

            {/* Flagship store street view — silently hides if no geocoded open store */}
            {stores.some(s => typeof s.lat === "number" && typeof s.lng === "number") && (
              <FlagshipImage companyId={companyId} />
            )}

            {/* Key facts row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              {c.store_count != null && (
                <div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Store className="w-3 h-3" /> Stores {aiFields.store_count && <AiChip />}
                  </div>
                  <div className="font-semibold flex items-center gap-1.5">
                    {c.store_count.toLocaleString()}
                    {rolloutVelocity && rolloutVelocity.net12m !== 0 && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          rolloutVelocity.net12m > 0
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        }`}
                        title={`${rolloutVelocity.openings12m} opened · ${rolloutVelocity.closures12m} closed (last 12m)`}
                      >
                        {rolloutVelocity.net12m > 0 ? "+" : ""}{rolloutVelocity.net12m} in 12m
                      </Badge>
                    )}
                  </div>
                </div>
              )}
              {c.rollout_status && (
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Rollout {aiFields.rollout_status && <AiChip />}</div>
                  <RolloutBadge status={c.rollout_status} />
                </div>
              )}
              {c.backers && (
                <div className="col-span-2">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1">
                    <Coins className="w-3 h-3" /> Backers {aiFields.backers && <AiChip />}
                  </div>
                  {Array.isArray(aiFields.backers_detail) && aiFields.backers_detail.length > 0 ? (
                    <div className="space-y-1">
                      {(aiFields.backers_detail as Array<{ name: string; type?: string; description?: string }>).map((b, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-sm">
                          <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
                          <div className="min-w-0">
                            <span className="font-medium">{b.name}</span>
                            {b.type && <Badge variant="outline" className="ml-1.5 text-[10px] py-0">{b.type.replace(/_/g, " ")}</Badge>}
                            {b.description && <p className="text-[11px] text-muted-foreground leading-snug">{b.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm">{c.backers}</div>
                  )}
                </div>
              )}
              {c.instagram_handle && (
                <div>
                  <a
                    href={`https://instagram.com/${c.instagram_handle.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    <Instagram className="w-3 h-3" /> {c.instagram_handle}
                  </a>
                </div>
              )}
            </div>

            {c.tracking_reason && (
              <div className="text-xs text-muted-foreground italic border-l-2 border-purple-300 pl-2">
                {c.tracking_reason}
              </div>
            )}

            {/* Parent group */}
            {data.parentGroup && (
              <div className="text-xs flex items-center gap-1 text-muted-foreground">
                <Building2 className="w-3 h-3" /> Part of
                <Link href={`/companies/${data.parentGroup.id}`} className="text-primary hover:underline">
                  {data.parentGroup.name}
                </Link>
                {data.siblings.length > 0 && <span>· {data.siblings.length} sister brand{data.siblings.length === 1 ? "" : "s"}</span>}
              </div>
            )}

            {/* Represented by (agents repping this brand) */}
            {(data.representedBy.length > 0 || isBrand) && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1"><Handshake className="w-3 h-3" /> Represented by</span>
                  <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={() => { setAddRep("agent"); setRepForm({ ...EMPTY_REP_FORM, agent_type: "tenant_rep" }); }} data-testid="button-add-agent">
                    <Plus className="w-3 h-3 mr-0.5" /> Add agent
                  </Button>
                </div>
                <div className="space-y-1">
                  {data.representedBy.map((r: any) => (
                    <div key={r.id} className="text-xs flex items-center gap-2 group">
                      <Badge variant="outline" className="text-[10px]">{r.agent_type.replace(/_/g, " ")}</Badge>
                      <Link href={`/companies/${r.agent_company_id}`} className="text-primary hover:underline font-medium">{r.agent_name}</Link>
                      {r.region && <span className="text-muted-foreground">({r.region.replace(/_/g, " ")})</span>}
                      {r.contact_name && <span className="text-muted-foreground">· {r.contact_name}</span>}
                      <button
                        type="button"
                        onClick={() => { if (confirm(`End representation by ${r.agent_name}?`)) endRepMutation.mutate(r.id); }}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                        aria-label="End representation"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {data.representedBy.length === 0 && <div className="text-xs text-muted-foreground italic">No agents currently retained.</div>}
                </div>
              </div>
            )}

            {/* Represents (brands this agent reps) */}
            {(data.representing.length > 0 || isAgent) && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Currently representing ({data.representing.length})</span>
                  <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={() => { setAddRep("brand"); setRepForm({ ...EMPTY_REP_FORM, agent_type: c.agent_type || "tenant_rep" }); }} data-testid="button-add-brand">
                    <Plus className="w-3 h-3 mr-0.5" /> Add brand
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {data.representing.slice(0, 12).map((r: any) => (
                    <span key={r.id} className="inline-flex items-center gap-1 group">
                      <Link href={`/companies/${r.brand_company_id}`}>
                        <Badge variant="outline" className="text-[10px] hover:bg-muted cursor-pointer">
                          {r.brand_name}
                          {r.region && <span className="ml-1 text-muted-foreground">· {r.region.replace(/_/g, " ")}</span>}
                        </Badge>
                      </Link>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`End representation of ${r.brand_name}?`)) endRepMutation.mutate(r.id); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                        aria-label="End representation"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {data.representing.length === 0 && <span className="text-xs text-muted-foreground italic">No brands currently represented.</span>}
                  {data.representing.length > 12 && <span className="text-[10px] text-muted-foreground">+{data.representing.length - 12} more</span>}
                </div>
              </div>
            )}

            {/* Add-representation inline picker */}
            {addRep && (
              <div className="border rounded-md p-2 space-y-2 bg-muted/40" data-testid="add-representation-form">
                <div className="text-xs font-medium flex items-center justify-between">
                  <span>{addRep === "agent" ? "Add an agent representing this brand" : "Add a brand this agent represents"}</span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setAddRep(null); setRepForm(EMPTY_REP_FORM); setRepSearch(""); }}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                <div className="relative">
                  <Input
                    placeholder={addRep === "agent" ? "Search agent company..." : "Search brand company..."}
                    value={repForm.otherCompanyName || repSearch}
                    onChange={(e) => { setRepSearch(e.target.value); setRepForm({ ...repForm, otherCompanyId: "", otherCompanyName: "" }); }}
                    className="h-8 text-xs"
                  />
                  {repSearch && !repForm.otherCompanyId && (
                    <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {allCompaniesForPicker
                        .filter(co => co.id !== companyId && co.name.toLowerCase().includes(repSearch.toLowerCase()))
                        .filter(co => addRep === "agent" ? !!co.agent_type : true)
                        .slice(0, 10)
                        .map(co => (
                          <button
                            type="button"
                            key={co.id}
                            onClick={() => { setRepForm({ ...repForm, otherCompanyId: co.id, otherCompanyName: co.name }); setRepSearch(""); }}
                            className="w-full text-left px-2 py-1.5 hover:bg-accent text-xs flex items-center gap-2"
                          >
                            {addRep === "agent" && <Handshake className="w-3 h-3 text-blue-500" />}
                            {addRep === "brand" && <Sparkles className="w-3 h-3 text-purple-500" />}
                            <span className="truncate">{co.name}</span>
                            {co.agent_type && <Badge variant="outline" className="text-[10px] ml-auto">{co.agent_type.replace(/_/g, " ")}</Badge>}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={repForm.agent_type} onValueChange={(v) => setRepForm({ ...repForm, agent_type: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tenant_rep">Tenant rep</SelectItem>
                      <SelectItem value="landlord_rep">Landlord rep</SelectItem>
                      <SelectItem value="investment">Investment</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Region (optional)"
                    value={repForm.region}
                    onChange={(e) => setRepForm({ ...repForm, region: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!repForm.otherCompanyId || addRepMutation.isPending}
                    onClick={() => {
                      const vars = addRep === "agent"
                        ? { brandCompanyId: companyId, agentCompanyId: repForm.otherCompanyId, agentType: repForm.agent_type, region: repForm.region || undefined }
                        : { brandCompanyId: repForm.otherCompanyId, agentCompanyId: companyId, agentType: repForm.agent_type, region: repForm.region || undefined };
                      addRepMutation.mutate(vars);
                    }}
                  >
                    <Check className="w-3 h-3 mr-1" /> Add
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setAddRep(null); setRepForm(EMPTY_REP_FORM); setRepSearch(""); }}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Covenant strip — CH financials + traffic light */}
            {covenant && (
              <div className="border-t pt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Activity className="w-3 h-3" /> Covenant &amp; CH health
                  </div>
                  <Badge className={
                    covenant.trafficLight === "green" ? "bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]" :
                    covenant.trafficLight === "amber" ? "bg-amber-100 text-amber-700 border-amber-200 text-[10px]" :
                    "bg-red-100 text-red-700 border-red-200 text-[10px]"
                  }>
                    {covenant.trafficLight === "green" ? "Strong" : covenant.trafficLight === "amber" ? "Verify" : "At risk"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Status</div>
                    <div className="font-medium capitalize">{covenant.companyStatus || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Last accounts</div>
                    <div className="font-medium">{covenant.lastAccountsMadeUpTo ? new Date(covenant.lastAccountsMadeUpTo).toLocaleDateString("en-GB") : "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Insolvency</div>
                    <div className={`font-medium ${covenant.hasInsolvencyHistory ? "text-red-600" : ""}`}>
                      {covenant.hasInsolvencyHistory ? "Yes" : "None"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Charges</div>
                    <div className={`font-medium ${covenant.hasCharges ? "text-amber-600" : ""}`}>
                      {covenant.hasCharges ? "Yes" : "None"}
                    </div>
                  </div>
                </div>
                {covenant.companyStatus && covenant.companyStatus !== "active" && (
                  <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      Linked CH entity is <b>{covenant.companyStatus}</b>. This may be an old holding company.
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-auto px-1 py-0 text-[11px] text-amber-700 underline"
                        onClick={() => findUkEntityMutation.mutate()}
                        disabled={findUkEntityMutation.isPending}
                      >
                        Find active UK entity
                      </Button>
                    </div>
                  </div>
                )}
                {turnover.length > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
                    <PoundSterling className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Turnover trend:</span>
                    {turnover.slice(0, 3).reverse().map((t: any) => (
                      <Badge key={t.period} variant="outline" className="text-[10px]">
                        {t.period}: £{(t.turnover / 1_000_000).toFixed(1)}m
                      </Badge>
                    ))}
                    <Sparkline values={turnover.slice().reverse().map((t: any) => Number(t.turnover) || 0)} />
                  </div>
                )}
                {rentAffordability && rentAffordability.rentToTurnoverPct != null && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] pt-2 border-t">
                    <div>
                      <div className="text-muted-foreground">Avg rent psf</div>
                      <div className="font-semibold">
                        £{rentAffordability.avgRentPsf?.toFixed(0) ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Rent ÷ turnover</div>
                      <div className={`font-semibold ${
                        rentAffordability.rentToTurnoverPct > 15 ? "text-red-600"
                        : rentAffordability.rentToTurnoverPct > 10 ? "text-amber-600"
                        : "text-emerald-700"
                      }`}>
                        {rentAffordability.rentToTurnoverPct.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">
                        Peer ({rentAffordability.useClass || "—"}, n={rentAffordability.peerSampleSize})
                      </div>
                      <div className="font-semibold">
                        £{rentAffordability.peerRentPsf?.toFixed(0) ?? "—"}
                      </div>
                    </div>
                  </div>
                )}
                {rentComps.length > 0 && (
                  <div className="mt-2 pt-2 border-t">
                    <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                      <PoundSterling className="w-3 h-3" /> Recent deal comps ({rentComps.length})
                    </div>
                    <div className="space-y-0.5">
                      {rentComps.slice(0, 5).map((rc) => {
                        const psf = rc.rent_psf_overall ?? rc.rent_psf_nia ?? rc.zone_a_rate;
                        return (
                          <Link key={rc.id} href={`/comps/${rc.id}`}>
                            <div className="flex items-center justify-between text-[11px] hover:bg-muted/40 rounded px-1 py-0.5 cursor-pointer">
                              <span className="truncate flex-1 min-w-0">
                                {rc.postcode || "—"}
                                {rc.area_sqft ? ` · ${Math.round(rc.area_sqft).toLocaleString()} sqft` : ""}
                                {rc.use_class ? ` · ${rc.use_class}` : ""}
                              </span>
                              <span className="font-semibold tabular-nums ml-2 shrink-0">
                                {psf != null ? `£${Math.round(Number(psf))} psf` : "—"}
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                      {rentComps.length > 5 && (
                        <p className="text-[10px] text-muted-foreground pl-1">+{rentComps.length - 5} more</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Relationship strip — lead broker, last touchpoint, active contacts */}
            {(c.bgp_contact_crm || data.contacts.length > 0) && (() => {
              const lastContactedAt = data.contacts
                .map((ct: any) => ct.last_contacted_at)
                .filter(Boolean)
                .sort()
                .reverse()[0] as string | undefined;
              const recent90d = data.contacts.filter((ct: any) => {
                if (!ct.last_contacted_at) return false;
                const d = new Date(ct.last_contacted_at);
                return Date.now() - d.getTime() < 90 * 864e5;
              }).length;
              const daysSince = lastContactedAt
                ? Math.floor((Date.now() - new Date(lastContactedAt).getTime()) / 864e5)
                : null;
              return (
                <div className="border-t pt-2">
                  <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                    <Handshake className="w-3 h-3" /> Relationship
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {c.bgp_contact_crm && (
                      <div>
                        <div className="text-[10px] text-muted-foreground">Lead broker</div>
                        <div className="font-medium truncate">{c.bgp_contact_crm}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] text-muted-foreground">Contacts</div>
                      <div className="font-medium">{data.contacts.length}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Last touch</div>
                      <div className={`font-medium ${
                        daysSince == null ? "text-muted-foreground"
                        : daysSince < 30 ? "text-emerald-700"
                        : daysSince < 90 ? "text-amber-600"
                        : "text-red-600"
                      }`}>
                        {daysSince == null ? "—"
                         : daysSince === 0 ? "today"
                         : daysSince === 1 ? "1 day ago"
                         : `${daysSince} days ago`}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Active (90d)</div>
                      <div className={`font-medium ${recent90d > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                        {recent90d}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Decision-makers — Property, C-suite */}
            {decisionMakers.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Decision-makers ({decisionMakers.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {decisionMakers.slice(0, 6).map((dm) => (
                    <Link key={dm.id} href={`/contacts/${dm.id}`}>
                      <div className="flex items-center gap-1.5 text-xs rounded px-1.5 py-1 hover:bg-muted/50 cursor-pointer group">
                        {dm.avatar_url ? (
                          <img src={dm.avatar_url} alt={dm.name} className="w-6 h-6 rounded-full bg-muted shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-teal-100 dark:bg-teal-900 flex items-center justify-center text-[10px] font-semibold text-teal-700 dark:text-teal-300 shrink-0">
                            {dm.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate group-hover:text-primary transition-colors">{dm.name}</div>
                          {dm.role && <div className="text-[10px] text-muted-foreground truncate">{dm.role}</div>}
                        </div>
                        {dm.linkedin_url && (
                          <a
                            href={dm.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground hover:text-primary shrink-0"
                            title="LinkedIn"
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* BGP relationship history */}
            {bgpSummary && (bgpSummary.totalDeals > 0 || bgpSummary.interactionsTotal > 0) && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Briefcase className="w-3 h-3" /> BGP with this brand
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Deals</div>
                    <div className="font-semibold">{bgpSummary.totalDeals}{bgpSummary.completedDeals > 0 ? ` · ${bgpSummary.completedDeals} done` : ""}</div>
                  </div>
                  {bgpSummary.totalFees > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">Fees</div>
                      <div className="font-semibold">£{(bgpSummary.totalFees / 1000).toFixed(0)}k</div>
                    </div>
                  )}
                  <div>
                    <div className="text-[10px] text-muted-foreground">Touches</div>
                    <div className="font-semibold">{bgpSummary.interactionsTotal}{bgpSummary.interactionsLast90d > 0 ? ` · ${bgpSummary.interactionsLast90d} (90d)` : ""}</div>
                  </div>
                  {bgpSummary.team.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">BGP team</div>
                      <div className="font-medium truncate text-[11px]">{bgpSummary.team.slice(0, 3).join(", ")}{bgpSummary.team.length > 3 ? ` +${bgpSummary.team.length - 3}` : ""}</div>
                    </div>
                  )}
                </div>
                {bgpDeals.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {bgpDeals.slice(0, 4).map((d) => (
                      <Link key={d.id} href={`/deals/${d.id}`}>
                        <div className="text-xs flex items-center gap-1.5 hover:bg-muted/50 rounded px-1 py-0.5 cursor-pointer">
                          {d.party_role && <Badge variant="outline" className="text-[10px] shrink-0 capitalize">{d.party_role}</Badge>}
                          <span className="truncate flex-1">{d.name}</span>
                          {d.status && <Badge variant="secondary" className="text-[10px] shrink-0">{d.status}</Badge>}
                        </div>
                      </Link>
                    ))}
                    {bgpDeals.length > 4 && <p className="text-[10px] text-muted-foreground pl-1">+{bgpDeals.length - 4} more deals</p>}
                  </div>
                )}
              </div>
            )}

            {/* Lease-expiry radar — tenant's upcoming lease events on our schedule */}
            {leaseEvents.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-600" /> Lease events in next 18 months ({leaseEvents.length})
                </div>
                <div className="space-y-0.5">
                  {leaseEvents.slice(0, 5).map((le) => {
                    const expiry = le.lease_expiry ? new Date(le.lease_expiry) : null;
                    const brk = le.lease_break ? new Date(le.lease_break) : null;
                    const nextEvent = [expiry, brk].filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0];
                    const label = nextEvent === expiry ? "expiry" : "break";
                    return (
                      <Link key={le.id} href={`/properties/${le.property_id}`}>
                        <div className="text-xs flex items-center gap-1.5 hover:bg-muted/50 rounded px-1 py-0.5 cursor-pointer">
                          <Badge variant="outline" className="text-[10px] shrink-0 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400 capitalize">{label}</Badge>
                          <span className="truncate flex-1">{le.property_name}{le.unit_name ? ` · ${le.unit_name}` : ""}</span>
                          <span className="font-medium tabular-nums text-[11px] shrink-0">{nextEvent?.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>
                        </div>
                      </Link>
                    );
                  })}
                  {leaseEvents.length > 5 && <p className="text-[10px] text-muted-foreground pl-1">+{leaseEvents.length - 5} more events</p>}
                </div>
              </div>
            )}

            {/* Space preferences — what they typically take */}
            {spacePreferences && spacePreferences.sampleSize >= 2 && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Target className="w-3 h-3" /> Space preferences (from {spacePreferences.sampleSize} comps)
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {spacePreferences.sqftMin != null && spacePreferences.sqftMax != null && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">Unit size</div>
                      <div className="font-semibold">{Math.round(spacePreferences.sqftMin).toLocaleString()}–{Math.round(spacePreferences.sqftMax).toLocaleString()} sqft</div>
                    </div>
                  )}
                  {spacePreferences.rentPsfMin != null && spacePreferences.rentPsfMax != null && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">Rent range</div>
                      <div className="font-semibold">£{Math.round(spacePreferences.rentPsfMin)}–£{Math.round(spacePreferences.rentPsfMax)} psf</div>
                    </div>
                  )}
                  {spacePreferences.topUseClass && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">Typical use class</div>
                      <div className="font-semibold">{spacePreferences.topUseClass}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Parent group + sibling brands */}
            {(parentGroup || siblingBrands.length > 0) && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Group &amp; sibling brands
                </div>
                {parentGroup && (
                  <Link href={`/companies/${parentGroup.id}`}>
                    <div className="text-xs flex items-center gap-1.5 hover:bg-muted/50 rounded px-1 py-0.5 cursor-pointer">
                      <Badge variant="outline" className="text-[10px] shrink-0">parent</Badge>
                      <span className="font-medium truncate flex-1">{parentGroup.name}</span>
                      {parentGroup.store_count && <span className="text-[10px] text-muted-foreground tabular-nums">{parentGroup.store_count} stores</span>}
                    </div>
                  </Link>
                )}
                {siblingBrands.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {siblingBrands.slice(0, 10).map((s: any) => (
                      <Link key={s.id} href={`/companies/${s.id}`}>
                        <Badge variant="outline" className="text-[10px] hover:bg-muted cursor-pointer">
                          {s.name}
                          {s.store_count && <span className="ml-1 text-muted-foreground">· {s.store_count}</span>}
                        </Badge>
                      </Link>
                    ))}
                    {siblingBrands.length > 10 && (
                      <span className="text-[10px] text-muted-foreground">+{siblingBrands.length - 10} more</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Competitor cluster */}
            {competitors.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Similar tenants (same use class)
                </div>
                <div className="flex flex-wrap gap-1">
                  {competitors.slice(0, 8).map((comp) => (
                    <Link key={comp.id} href={`/companies/${comp.id}`}>
                      <Badge variant="outline" className="text-[10px] hover:bg-muted cursor-pointer">
                        {comp.name}
                        {comp.store_count && <span className="ml-1 text-muted-foreground">· {comp.store_count}</span>}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Deal ledger + active pipeline */}
            {(completedDeals?.length > 0 || activeDeals?.length > 0 || requirements.length > 0) && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Briefcase className="w-3 h-3" /> Deal ledger &amp; pipeline
                </div>
                <div className="flex gap-2 text-xs flex-wrap">
                  {completedDeals?.length > 0 && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
                      {completedDeals.length} completed
                    </Badge>
                  )}
                  {activeDeals?.length > 0 && (
                    <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">
                      {activeDeals.length} active
                    </Badge>
                  )}
                  {requirements.filter(r => r.status === "Active").length > 0 && (
                    <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px]">
                      {requirements.filter(r => r.status === "Active").length} active req
                    </Badge>
                  )}
                </div>
                {data.deals.slice(0, 5).length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {data.deals.slice(0, 5).map((d: any) => (
                      <Link key={d.id} href={`/deals/${d.id}`} className="text-xs flex items-center gap-1.5 hover:bg-muted/50 rounded px-1 py-0.5">
                        <Badge variant="outline" className="text-[10px] shrink-0">{d.role}</Badge>
                        <span className="truncate flex-1">{d.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{d.stage || d.status}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Active requirements — what this brand is looking for */}
            {requirements.filter(r => r.status === "Active").length > 0 && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" /> Active requirements ({requirements.filter(r => r.status === "Active").length})
                  </span>
                  <Link
                    href={`/requirements?companyId=${c.id}`}
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    manage →
                  </Link>
                </div>
                <div className="space-y-0.5">
                  {requirements.filter(r => r.status === "Active").slice(0, 6).map((r) => {
                    const size = r.size_min && r.size_max
                      ? `${r.size_min}–${r.size_max} sqft`
                      : r.size_max ? `≤${r.size_max} sqft`
                      : r.size_min ? `≥${r.size_min} sqft` : null;
                    return (
                      <Link
                        key={r.id}
                        href={`/requirements?companyId=${c.id}`}
                        className="text-xs flex items-center gap-1.5 hover:bg-muted/50 rounded px-1 py-0.5"
                      >
                        {r.use_class && <Badge variant="outline" className="text-[10px] shrink-0">{r.use_class}</Badge>}
                        {size && <span className="font-medium shrink-0">{size}</span>}
                        {r.location_notes && <span className="truncate text-muted-foreground">{r.location_notes}</span>}
                        {r.budget && <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">£{r.budget}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pitched-to history */}
            {pitchedTo.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Target className="w-3 h-3" /> Pitched into ({pitchedTo.length})
                </div>
                <div className="space-y-0.5">
                  {pitchedTo.slice(0, 6).map((p) => (
                    <Link key={p.id} href={`/properties/${p.property_id}`} className="text-xs flex items-center gap-1.5 hover:bg-muted/50 rounded px-1 py-0.5">
                      <span className="truncate flex-1 font-medium">{p.property_name}</span>
                      {p.unit_name && <span className="text-[10px] text-muted-foreground shrink-0">{p.unit_name}</span>}
                      {p.status && <Badge variant="outline" className="text-[10px] shrink-0">{p.status}</Badge>}
                    </Link>
                  ))}
                  {pitchedTo.length > 6 && (
                    <p className="text-[10px] text-muted-foreground pl-1">+{pitchedTo.length - 6} more</p>
                  )}
                </div>
              </div>
            )}

            {/* Stores — Google Places list. Auto-researched by the background
                enrichment scheduler; no manual trigger. */}
            {stores.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Stores ({stores.length}{c.store_count && c.store_count > 0 && stores.length !== c.store_count ? ` of ~${c.store_count}` : ""})
                </div>
                <div className="mb-1.5">
                  <BrandPortfolioMap stores={stores as any} />
                </div>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {stores.slice(0, 10).map((s) => (
                    <div key={s.id} className="text-xs flex items-center gap-1.5 px-1 py-0.5">
                      <MapPin className={`w-3 h-3 shrink-0 ${s.status === "closed" ? "text-red-500" : s.status === "open" ? "text-emerald-500" : "text-muted-foreground"}`} />
                      <span className="truncate flex-1">{s.name}</span>
                      {s.address && <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">{s.address.split(",").slice(-3, -2)[0]?.trim()}</span>}
                      {s.place_id && (
                        <a
                          href={`https://www.google.com/maps/place/?q=place_id:${s.place_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-primary"
                          title="View on Google Maps"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  ))}
                  {stores.length > 10 && (
                    <p className="text-[10px] text-muted-foreground pl-1">+{stores.length - 10} more stores</p>
                  )}
                </div>
              </div>
            )}

            {/* KYC tile */}
            {(c.kyc_status || data.kyc.doc_count > 0 || c.aml_risk_level) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-2">
                <ShieldCheck className="w-3 h-3" />
                {c.kyc_status === "approved" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">KYC approved</Badge>}
                {c.kyc_status === "pass" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">KYC passed</Badge>}
                {c.kyc_status === "warning" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Verify entity</Badge>}
                {c.kyc_status === "in_review" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">KYC in review</Badge>}
                {c.kyc_status === "rejected" && <Badge variant="destructive" className="text-[10px]">KYC rejected</Badge>}
                {c.kyc_status === "fail" && <Badge variant="destructive" className="text-[10px]">KYC fail — insolvency</Badge>}
                {!c.kyc_status && <Badge variant="secondary" className="text-[10px]">KYC pending</Badge>}
                {c.aml_risk_level && <span>· {c.aml_risk_level} risk</span>}
                <span>· {data.kyc.doc_count} doc{data.kyc.doc_count === 1 ? "" : "s"}</span>
                {c.kyc_expires_at && <span>· re-check {new Date(c.kyc_expires_at).toLocaleDateString("en-GB")}</span>}
              </div>
            )}

            {/* Images */}
            {data.images.length > 0 && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" /> {data.images.length} image{data.images.length === 1 ? "" : "s"} in gallery
                </div>
                <div className="flex gap-1 flex-wrap">
                  {data.images.slice(0, 8).map((img: any) => (
                    <div key={img.id} className="w-12 h-12 rounded border border-border/60 overflow-hidden bg-muted">
                      {img.thumbnail_data ? (
                        <img src={`data:${img.mime_type || "image/jpeg"};base64,${img.thumbnail_data}`} alt={img.file_name} className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-muted-foreground m-auto mt-4" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signals feed */}
            {data.signals.length > 0 && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Recent signals
                </div>
                <div className="space-y-1">
                  {data.signals.slice(0, 6).map((s: any) => {
                    const typeCls: Record<string, string> = {
                      opening:     "bg-emerald-50 text-emerald-700 border-emerald-200",
                      closure:     "bg-red-50 text-red-700 border-red-200",
                      funding:     "bg-violet-50 text-violet-700 border-violet-200",
                      exec_change: "bg-blue-50 text-blue-700 border-blue-200",
                      sector_move: "bg-amber-50 text-amber-700 border-amber-200",
                      rumour:      "bg-zinc-50 text-zinc-600 border-zinc-200 italic",
                      news:        "bg-zinc-50 text-zinc-700 border-zinc-200",
                    };
                    const sentCls: Record<string, string> = {
                      positive: "border-l-emerald-400",
                      negative: "border-l-red-400",
                      neutral:  "border-l-muted",
                    };
                    return (
                      <div key={s.id} className={`text-xs flex items-start gap-2 border-l-2 pl-2 ${sentCls[s.sentiment] || "border-l-muted"}`}>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${typeCls[s.signal_type] || ""}`}>
                          {s.signal_type.replace(/_/g, " ")}
                          {s.magnitude === "large" && " ●●"}
                          {s.magnitude === "medium" && " ●"}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          {s.source && s.source.startsWith("http") ? (
                            <a href={s.source} target="_blank" rel="noopener noreferrer" className="font-medium truncate block hover:underline">
                              {s.headline}
                            </a>
                          ) : (
                            <p className="font-medium truncate">{s.headline}</p>
                          )}
                          {s.signal_date && <span className="text-[10px] text-muted-foreground">{new Date(s.signal_date).toLocaleDateString("en-GB")}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* News articles mentioning this brand */}
            {data.news && data.news.length > 0 && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <Newspaper className="w-3 h-3" /> News ({data.news.length})
                </div>
                <div className="space-y-1.5">
                  {data.news.slice(0, 5).map((article) => (
                    <a
                      key={article.id}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 text-xs group hover:bg-muted/40 rounded-md p-1.5 -mx-1.5 transition-colors"
                    >
                      {article.image_url && !/google\.com|gstatic\.com|googleusercontent\.com\/.*\/proxy/i.test(article.image_url) ? (
                        <img
                          src={article.image_url}
                          alt=""
                          className="w-10 h-10 rounded object-cover shrink-0 border"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded shrink-0 border bg-muted flex items-center justify-center">
                          <Newspaper className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">{article.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {article.source_name && (
                            <span className="text-[10px] text-muted-foreground">{article.source_name}</span>
                          )}
                          {article.published_at && (
                            <span className="text-[10px] text-muted-foreground">
                              {article.source_name ? "·" : ""} {new Date(article.published_at).toLocaleDateString("en-GB")}
                            </span>
                          )}
                          <ExternalLink className="w-2.5 h-2.5 text-muted-foreground ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </a>
                  ))}
                  {data.news.length > 5 && (
                    <p className="text-[10px] text-muted-foreground pl-1.5">+{data.news.length - 5} more articles</p>
                  )}
                </div>
              </div>
            )}

            {c.last_enriched_at && (
              <div className="text-[10px] text-muted-foreground pt-1 border-t flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" /> Last enriched {new Date(c.last_enriched_at).toLocaleString("en-GB")}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FlagshipImage({ companyId }: { companyId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="rounded-md overflow-hidden border bg-muted/40">
      <img
        src={`/api/brand/${companyId}/flagship-image`}
        alt="Flagship store street view"
        className="w-full object-cover"
        style={{ height: 140 }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
