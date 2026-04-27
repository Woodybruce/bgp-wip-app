import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useChatBGPState } from "@/contexts/chatbgp-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BgpTakeStrip } from "@/components/bgp-take-strip";
import {
  Sparkles, Store, TrendingUp, TrendingDown, Users, Handshake,
  Building2, ExternalLink, Pencil, Check, X, Plus, Image as ImageIcon,
  Instagram, Coins, FileText, AlertCircle, Clock, Download, Newspaper,
  MapPin, Activity, Target, Briefcase, PoundSterling, Search, Flame,
  Globe, Linkedin, Calendar, BadgeInfo, Phone,
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
    linkedin_url: string | null;
    phone: string | null;
    industry: string | null;
    employee_count: number | null;
    annual_revenue: number | null;
    founded_year: number | null;
    is_tracked_brand: boolean;
    tracking_reason: string | null;
    brand_group_id: string | null;
    parent_company_id: string | null;
    concept_pitch: string | null;
    store_count: number | null;
    rollout_status: string | null;
    backers: string | null;
    instagram_handle: string | null;
    tiktok_handle: string | null;
    dept_store_presence: string | null;
    franchise_activity: string | null;
    hunter_flag: boolean;
    stock_ticker: string | null;
    uk_entity_name: string | null;
    agent_type: string | null;
    concept_status: string | null;
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
  requirements: Array<{ id: string; name: string | null; use: string[] | null; size: string[] | null; requirement_locations: string[] | null; status: string | null; updated_at: string | null }>;
  pitchedTo: Array<{ id: string; unit_name: string | null; target_brands: string | null; status: string | null; priority: string | null; property_id: string; property_name: string; property_address: string | null; updated_at: string | null }>;
  contacts: Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null; linkedin_url: string | null; avatar_url: string | null; last_contacted_at: string | null; enrichment_source: string | null }>;
  stores: Array<{ id: string; name: string; address: string | null; lat: number | null; lng: number | null; place_id: string | null; status: string | null; store_type: string | null; source_type: string | null; researched_at: string | null }>;
  turnover: Array<{ period: string | null; turnover: number | null; turnover_per_sqft: number | null; confidence: string | null; source: string | null }>;
  coverers: Array<{ id: string; name: string; email: string | null }>;
  interactions: Array<{ id: string; type: string; direction: string | null; subject: string | null; preview: string | null; interaction_date: string; bgp_user: string | null }>;
  socialStats: Array<{ platform: string; followers: number | null; fetched_at: string | null }>;
  covenant: {
    companyStatus: string | null;
    accountsOverdue: boolean;
    confirmationStatementOverdue: boolean;
    hasInsolvencyHistory: boolean;
    hasCharges: boolean;
    lastAccountsMadeUpTo: string | null;
    dateOfCreation: string | null;
    checkedAt: string | null;
    registeredAddress: string | null;
    trafficLight: "green" | "amber" | "red";
    officers: { name: string; role: string | null; appointedOn: string | null; nationality: string | null; occupation: string | null }[];
    experian: {
      creditScore: number | null;
      creditBand: string | null;
      creditLimit: number | null;
      riskIndicator: string | null;
      ccj: number | null;
      ccjTotalValue: number | null;
      turnover: number | null;
    } | null;
  } | null;
  rolloutVelocity: {
    openings12m: number;
    closures12m: number;
    net12m: number;
    currentOpen: number;
    currentClosed: number;
    monthly: Array<{ month: string; openings: number; closures: number }>;
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
    enrichment_source: string | null;
    tier: number;
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

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// 12-month bar chart of openings vs closures.
// Each month is two stacked bars (green up, red down) over a baseline.
function RolloutBarChart({ monthly }: { monthly: Array<{ month: string; openings: number; closures: number }> }) {
  const max = Math.max(1, ...monthly.flatMap(m => [m.openings, m.closures]));
  const barW = 100 / monthly.length;
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-full h-10">
      <line x1="0" y1="16" x2="100" y2="16" stroke="currentColor" strokeOpacity="0.15" strokeWidth="0.3" />
      {monthly.map((m, i) => {
        const x = i * barW + barW * 0.15;
        const w = barW * 0.7;
        const openH = (m.openings / max) * 14;
        const closeH = (m.closures / max) * 14;
        return (
          <g key={m.month}>
            {m.openings > 0 && (
              <rect x={x} y={16 - openH} width={w} height={openH} fill="#10b981">
                <title>{m.month}: +{m.openings}</title>
              </rect>
            )}
            {m.closures > 0 && (
              <rect x={x} y={16} width={w} height={closeH} fill="#ef4444">
                <title>{m.month}: -{m.closures}</title>
              </rect>
            )}
          </g>
        );
      })}
    </svg>
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
  const [, navigate] = useLocation();
  const { setInput: setChatInput } = useChatBGPState();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<BrandProfile["company"]>>({});
  const [addRep, setAddRep] = useState<"brand" | "agent" | null>(null);
  const [repForm, setRepForm] = useState<RepForm>(EMPTY_REP_FORM);
  const [repSearch, setRepSearch] = useState("");
  const [newsShowAll, setNewsShowAll] = useState(false);
  const [newsSourceFilter, setNewsSourceFilter] = useState<string | null>(null);
  const [newsTab, setNewsTab] = useState<"press" | "industry" | "linkedin">("industry");
  const [signalsShowAll, setSignalsShowAll] = useState(false);
  const [addSignalOpen, setAddSignalOpen] = useState(false);
  const [newSignal, setNewSignal] = useState({ headline: "", signal_type: "opening", sentiment: "positive", source: "", signal_date: "" });
  const [officerApollo, setOfficerApollo] = useState<Record<string, { loading: boolean; match: any | null; error?: string }>>({});
  const [contactsFinding, setContactsFinding] = useState(false);
  const autoContactsRan = useRef(false);
  const [kycRunning, setKycRunning] = useState(false);
  const autoKycRan = useRef(false);

  async function runContactDiscovery() {
    setContactsFinding(true);
    try {
      await Promise.allSettled([
        apiRequest("POST", `/api/brand/${companyId}/apollo/discover`, {})
          .then(r => r.json())
          .then((res: any) => res.people?.length > 0
            ? apiRequest("POST", `/api/brand/${companyId}/apollo/import`, { people: res.people })
            : null),
        apiRequest("POST", `/api/brand/${companyId}/rocketreach/discover`, {})
          .then(r => r.json())
          .then((res: any) => res.people?.length > 0
            ? apiRequest("POST", `/api/brand/${companyId}/rocketreach/import`, { people: res.people })
            : null),
      ]);
    } finally {
      setContactsFinding(false);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    }
  }

  async function runKycCheck() {
    setKycRunning(true);
    try {
      await apiRequest("POST", `/api/kyc/run-all-checks`, { companyId });
    } catch (e) {
      // silent — orchestrator may partially fail (Veriff, etc.); covenant data still gets saved
    } finally {
      setKycRunning(false);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    }
  }

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

  useEffect(() => {
    if (!data || autoContactsRan.current) return;
    autoContactsRan.current = true;
    if (data.contacts.length === 0) runContactDiscovery();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!data || autoKycRan.current) return;
    autoKycRan.current = true;
    const hasCh = !!data.company?.companies_house_number;
    const hasExperian = !!(data as any).covenant?.experian;
    if (hasCh && !hasExperian) runKycCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const autoStoresRan = useRef(false);
  useEffect(() => {
    if (!data || autoStoresRan.current) return;
    autoStoresRan.current = true;
    if ((data.stores?.length || 0) === 0 && !researchStoresMutation.isPending) {
      researchStoresMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  // "Ask for help" form — surfaced when the auto-resolver fails. Lets the
  // user paste the brand's T&Cs URL, type the UK entity name, or paste the
  // CH number directly. UK law (Companies Act 2006) requires this to be
  // displayed on the brand's website, so failing means we couldn't read it
  // — not that it doesn't exist.
  const [helpForm, setHelpForm] = useState<{ tcsUrl: string; entityName: string; chNumber: string } | null>(null);

  // "Wrong company?" — re-derive the CH match from the brand website,
  // overwriting whatever's stored. Used when the original auto-KYC picked
  // the nearest name match rather than the real operating entity.
  const reResolveKycMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/companies-house/auto-kyc/${companyId}?force=1`, {});
      return res.json();
    },
    onSuccess: (out: any) => {
      // Build a step-by-step trace so the user can see WHY each resolve
      // landed (or failed). Without this the button is a black box and
      // every wrong outcome looks identical.
      const trace = Array.isArray(out?.diagnostics)
        ? out.diagnostics.map((d: any) => `• ${d.step}: ${d.outcome}${d.detail ? ` — ${d.detail}` : ""}`).join("\n")
        : "";
      if (out?.kycStatus === "not_found") {
        toast({
          title: "No match found",
          description: (out.message || "Couldn't resolve a CH entity from the website.") + (trace ? `\n\n${trace}` : ""),
          variant: "destructive",
          duration: 30_000,
        });
        // Surface the inline help form so the user can paste the T&Cs URL or
        // enter the entity name / CH number directly. We always show it on
        // not_found, not just when the server flags needsHelp — gives the
        // user agency on every failure.
        setHelpForm({ tcsUrl: "", entityName: "", chNumber: "" });
      } else {
        const via = out?.resolvedFrom === "website" ? "website / Perplexity"
          : out?.resolvedFrom === "ai_picker" ? "AI picker"
          : out?.resolvedFrom === "name_match" ? "name match (no website hit)"
          : "stored";
        toast({
          title: `KYC re-resolved · CH ${out?.companyNumber || "?"} (${via})`,
          description: trace || `${out?.kycStatus || "?"}`,
          duration: 30_000,
        });
      }
      // Surface the full trace in the console so it's also reproducible
      // without taking a screenshot of an ephemeral toast.
      // eslint-disable-next-line no-console
      console.log("[re-resolve KYC]", out);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", companyId] });
    },
    onError: (e: any) => toast({ title: "Re-resolve failed", description: e.message, variant: "destructive" }),
  });

  // Replays the resolver with user-supplied overrides (T&Cs URL / entity
  // name / CH number). Same endpoint as auto-resolve — server picks the
  // highest-confidence override available.
  const manualResolveMutation = useMutation({
    mutationFn: async (override: { tcsUrl?: string; entityName?: string; chNumber?: string }) => {
      const res = await apiRequest("POST", `/api/companies-house/auto-kyc/${companyId}?force=1`, override);
      return res.json();
    },
    onSuccess: (out: any) => {
      const trace = Array.isArray(out?.diagnostics)
        ? out.diagnostics.map((d: any) => `• ${d.step}: ${d.outcome}${d.detail ? ` — ${d.detail}` : ""}`).join("\n")
        : "";
      if (out?.kycStatus === "not_found") {
        toast({
          title: "Still no match",
          description: (out.message || "Manual override didn't resolve.") + (trace ? `\n\n${trace}` : ""),
          variant: "destructive",
          duration: 30_000,
        });
      } else {
        toast({
          title: `KYC resolved · CH ${out?.companyNumber || "?"}`,
          description: trace || "Resolved from manual input.",
          duration: 30_000,
        });
        setHelpForm(null);
      }
      // eslint-disable-next-line no-console
      console.log("[manual-resolve KYC]", out);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", companyId] });
    },
    onError: (e: any) => toast({ title: "Manual resolve failed", description: e.message, variant: "destructive" }),
  });

  const researchStoresMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/brand/${companyId}/research-stores`);
      return res.json();
    },
    onSuccess: (out: any) => {
      // Surface the server-side diagnostic summary when the search returned
      // nothing — turns "0 stores found" into something actionable
      // (quota issue vs. all-filtered vs. empty queries).
      const summary = Array.isArray(out?.diagnostics)
        ? out.diagnostics.find((d: any) => d.step === "places_summary")?.detail
        : null;
      toast({
        title: "Store search complete",
        description: out.found
          ? `${out.found} stores found`
          : summary || "0 stores found",
      });
      if (Array.isArray(out?.diagnostics)) {
        // Full trace to console for debugging — too long for a toast.
        console.log("[research-stores] diagnostics:", out.diagnostics);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Store search failed", description: e.message, variant: "destructive" }),
  });

  // All companies — used by the representation picker AND the backer linkifier
  // so any mentioned company name gets a link to its profile.
  const { data: allCompaniesForPicker = [] } = useQuery<Array<{ id: string; name: string; agent_type: string | null; is_tracked_brand: boolean }>>({
    queryKey: ["/api/crm/companies"],
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

  const createBackerMutation = useMutation({
    mutationFn: async (vars: { name: string; type?: string; description?: string }) => {
      const description = [vars.type?.replace(/_/g, " "), vars.description].filter(Boolean).join(" — ") || undefined;
      const res = await apiRequest("POST", `/api/crm/companies`, { name: vars.name, description });
      return res.json() as Promise<{ id: string; name: string }>;
    },
    onSuccess: (created) => {
      toast({ title: `Created ${created.name}`, description: "Now linked from the Backers list." });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
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

  const refreshIntelMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/refresh-intel`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ added: number; signalsLinked: number; warning?: string }>;
    },
    onSuccess: (out) => {
      const msg = out.added > 0
        ? `${out.added} new article${out.added === 1 ? "" : "s"}, ${out.signalsLinked} signal${out.signalsLinked === 1 ? "" : "s"} linked`
        : "No new articles found";
      toast({ title: "Intel refreshed", description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Intel refresh failed", description: e.message, variant: "destructive" }),
  });

  const perplexityRefreshMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/perplexity-refresh`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ signalsAdded: number; analysisUpdated: boolean; error?: string }>;
    },
    onSuccess: (out) => {
      if (out.error) {
        toast({ title: "Perplexity refresh failed", description: out.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Perplexity refreshed",
        description: `${out.signalsAdded} new signal${out.signalsAdded === 1 ? "" : "s"}${out.analysisUpdated ? ", analysis updated" : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Perplexity refresh failed", description: e.message, variant: "destructive" }),
  });

  const scrapeWebsiteMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/scrape`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ pagesChecked: number; signalsAdded: number; error?: string }>;
    },
    onSuccess: (out) => {
      if (out.error) {
        toast({ title: "Scrape failed", description: out.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Website scraped",
        description: `${out.pagesChecked} page${out.pagesChecked === 1 ? "" : "s"} checked, ${out.signalsAdded} new signal${out.signalsAdded === 1 ? "" : "s"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Scrape failed", description: e.message, variant: "destructive" }),
  });

  const addSignalMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/brand/signals", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          brandCompanyId: companyId,
          signalType: newSignal.signal_type,
          headline: newSignal.headline,
          source: newSignal.source || null,
          signalDate: newSignal.signal_date || null,
          sentiment: newSignal.sentiment,
          magnitude: "medium",
          aiGenerated: false,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Signal logged" });
      setNewSignal({ headline: "", signal_type: "opening", sentiment: "positive", source: "", signal_date: "" });
      setAddSignalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Failed to log signal", description: e.message, variant: "destructive" }),
  });

  const deleteSignalMutation = useMutation({
    mutationFn: async (signalId: string) => {
      const r = await fetch(`/api/brand/signals/${signalId}`, {
        method: "DELETE",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      toast({ title: "Signal removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Hunter score (computed score + flags from brand_signals + stock)
  const { data: hunter } = useQuery<{ expansionScore: number; expansionFlags: string[] }>({
    queryKey: ["/api/brand", companyId, "hunter-score"],
    queryFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/hunter-score`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  // Stock snapshot + 90d history (only fetched if brand has a ticker)
  const { data: stockData } = useQuery<{
    snapshot: {
      ticker: string; price: number | null; currency: string | null;
      marketCap: number | null; marketCapGBP: number | null;
      fiftyTwoWeekHigh: number | null; fiftyTwoWeekLow: number | null;
      fiftyTwoWeekChange: number | null; peRatio: number | null;
      exchange: string | null; shortName: string | null;
    } | null;
    history: Array<{ date: string; close: number }>;
  }>({
    queryKey: ["/api/brand", companyId, "stock"],
    queryFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/stock`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) return { snapshot: null, history: [] };
      return r.json();
    },
    enabled: !!data?.company?.stock_ticker,
    staleTime: 15 * 60 * 1000,
    retry: false,
  });

  // BGP portfolio units that could be pitched to this brand
  const { data: suggestedUnits } = useQuery<Array<{
    id: string; unit_name: string | null; sqft: number | null; rent_pa: number | null;
    status: string | null; zone: string | null; property_id: string;
    property_name: string; property_address: string | null; asset_class: string | null;
    matchScore: number;
  }>>({
    queryKey: ["/api/brand", companyId, "suggested-units"],
    queryFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/suggested-units`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 15 * 60 * 1000,
    retry: false,
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
      tiktok_handle: c.tiktok_handle || "",
      dept_store_presence: c.dept_store_presence || "",
      franchise_activity: c.franchise_activity || "",
      hunter_flag: c.hunter_flag ?? false,
      stock_ticker: c.stock_ticker || "",
      uk_entity_name: c.uk_entity_name || "",
      tracking_reason: c.tracking_reason || "",
      agent_type: c.agent_type || "",
      is_tracked_brand: c.is_tracked_brand,
    });
    setEditing(true);
  };

  return (
    <Card data-testid="brand-profile-panel">
      <CardHeader className="p-3 pb-2 flex flex-row items-start justify-between sticky top-0 z-20 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 border-b border-border/40">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
          Brand Profile
          {c.is_tracked_brand && <Badge className="bg-purple-100 text-purple-700 border-purple-300 text-[10px]">Tracked brand</Badge>}
          {c.hunter_flag && <Badge className="bg-amber-50 text-amber-700 border-purple-200 text-[10px]"><Flame className="w-2.5 h-2.5 mr-0.5" />Hunter pick</Badge>}
          {hunter && hunter.expansionScore >= 40 && (
            <Badge
              className={
                hunter.expansionScore >= 75 ? "bg-orange-50 text-orange-700 border-purple-200 text-[10px]" :
                hunter.expansionScore >= 55 ? "bg-amber-50 text-amber-700 border-purple-200 text-[10px]" :
                "bg-zinc-50 text-zinc-700 border-purple-200 text-[10px]"
              }
              title={hunter.expansionFlags.join(" · ")}
            >
              Hunter {hunter.expansionScore}/100
            </Badge>
          )}
          {c.agent_type && <Badge className="bg-blue-50 text-blue-700 border-purple-200 text-[10px]">{c.agent_type.replace(/_/g, " ")}</Badge>}
          {covenant && (
            <Badge className={
              covenant.trafficLight === "green" ? "bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]" :
              covenant.trafficLight === "amber" ? "bg-amber-100 text-amber-700 border-amber-200 text-[10px]" :
              "bg-red-100 text-red-700 border-red-200 text-[10px]"
            }>
              Covenant: {covenant.trafficLight === "green" ? "Strong" : covenant.trafficLight === "amber" ? "Verify" : "At risk"}
            </Badge>
          )}
          {c.kyc_status === "pass" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">KYC Passed</Badge>}
          {c.kyc_status === "warning" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">KYC Review</Badge>}
          {c.kyc_status === "fail" && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">KYC Failed</Badge>}
          {(() => {
            const lastContactedAt = data.contacts.map((ct: any) => ct.last_contacted_at).filter(Boolean).sort().reverse()[0] as string | undefined;
            const lastContactor = lastContactedAt ? data.contacts.find((ct: any) => ct.last_contacted_at === lastContactedAt) : null;
            if (!lastContactedAt) return null;
            const days = Math.floor((Date.now() - new Date(lastContactedAt).getTime()) / 864e5);
            return (
              <span className="text-xs font-normal text-muted-foreground flex items-center gap-0.5">
                · <Clock className="w-2.5 h-2.5" /> {days}d{lastContactor?.name ? ` · ${lastContactor.name.split(" ")[0]}` : ""}
              </span>
            );
          })()}
          {c.rollout_status && c.rollout_status !== "none" && <RolloutBadge status={c.rollout_status} />}
        </CardTitle>
        {(c.industry || (c.employee_count && c.employee_count > 0) || c.founded_year || data.parentGroup || c.backers) && (
          <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
            {c.industry && <span>{c.industry}</span>}
            {c.employee_count && c.employee_count > 0 && (
              <span>· {c.employee_count >= 10000
                ? `~${Math.round(c.employee_count / 1000)}k employees`
                : c.employee_count >= 1000
                  ? `~${(c.employee_count / 1000).toFixed(1)}k employees`
                  : `${c.employee_count} employees`}</span>
            )}
            {c.founded_year && <span>· Est. {c.founded_year}</span>}
            {data.parentGroup && (
              <span>· Part of <Link href={`/companies/${data.parentGroup.id}`} className="text-primary hover:underline">{data.parentGroup.name}</Link></span>
            )}
          </div>
        )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Instagram handle</Label>
                <Input value={(form.instagram_handle as string) || ""} onChange={(e) => setForm({ ...form, instagram_handle: e.target.value })} placeholder="@brandname" />
              </div>
              <div>
                <Label className="text-xs">TikTok handle</Label>
                <Input value={(form.tiktok_handle as string) || ""} onChange={(e) => setForm({ ...form, tiktok_handle: e.target.value })} placeholder="@brandname" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Dept store presence</Label>
              <Input value={(form.dept_store_presence as string) || ""} onChange={(e) => setForm({ ...form, dept_store_presence: e.target.value })} placeholder="e.g. Selfridges (popup 2024), Harvey Nichols concession" />
            </div>
            <div>
              <Label className="text-xs">Franchise activity abroad</Label>
              <Input value={(form.franchise_activity as string) || ""} onChange={(e) => setForm({ ...form, franchise_activity: e.target.value })} placeholder="e.g. UAE master franchise 2023, France 2024" />
            </div>
            <div>
              <Label className="text-xs">UK contracting entity</Label>
              <Input
                value={(form.uk_entity_name as string) || ""}
                onChange={(e) => setForm({ ...form, uk_entity_name: e.target.value })}
                placeholder="e.g. AFH Stores UK Limited, Next Retail Ltd"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                The legal entity that signs UK leases — often differs from the brand name.
                Used to search Companies House correctly.
              </p>
            </div>
            <div>
              <Label className="text-xs">Stock ticker (if listed)</Label>
              <Input
                value={(form.stock_ticker as string) || ""}
                onChange={(e) => setForm({ ...form, stock_ticker: e.target.value.toUpperCase() })}
                placeholder="e.g. JD.L, NXT.L, NKE, LULU"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Yahoo Finance ticker — LSE suffix with .L (JD.L, MKS.L), US no suffix (NKE, LULU), Paris .PA (MC.PA).
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="hunter_flag"
                checked={!!(form.hunter_flag)}
                onChange={(e) => setForm({ ...form, hunter_flag: e.target.checked })}
                className="rounded"
              />
              <Label htmlFor="hunter_flag" className="text-xs cursor-pointer">Flag as Hunter Pick (manual watchlist)</Label>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button size="sm" onClick={() => patchMutation.mutate(form)} disabled={patchMutation.isPending}>
                <Check className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col">
            {/* Outreach strip — quick-action buttons */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2 order-1">
              {(c.domain_url || c.domain) && (
                <a
                  href={c.domain_url || `https://${c.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors"
                  data-testid="link-website"
                >
                  <Globe className="w-3 h-3" /> Website
                </a>
              )}
              {c.linkedin_url && (
                <a
                  href={c.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors"
                  data-testid="link-linkedin"
                >
                  <Linkedin className="w-3 h-3" /> LinkedIn
                </a>
              )}
              {c.instagram_handle && (
                <a
                  href={`https://instagram.com/${c.instagram_handle.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors"
                  data-testid="link-instagram"
                >
                  <Instagram className="w-3 h-3" /> Instagram
                </a>
              )}
              {c.phone && (
                <a
                  href={`tel:${c.phone}`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors"
                  data-testid="link-phone"
                >
                  <Phone className="w-3 h-3" /> {c.phone}
                </a>
              )}
              {c.domain && (
                <a
                  href={`https://${c.domain}/press`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors"
                  title="Brand newsroom"
                >
                  <Newspaper className="w-3 h-3" /> Press
                </a>
              )}
              {c.domain && (
                <a
                  href={`https://${c.domain}/careers`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors"
                  title="Brand careers page"
                >
                  <Briefcase className="w-3 h-3" /> Careers
                </a>
              )}
              {data.contacts.find((ct: any) => ct.email) && (
                <a
                  href={`mailto:${data.contacts.find((ct: any) => ct.email)?.email}`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors"
                  title="Email primary contact"
                >
                  <Phone className="w-3 h-3" /> Email
                </a>
              )}
              <button
                type="button"
                onClick={() => runContactDiscovery()}
                disabled={contactsFinding}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 text-xs font-medium transition-colors disabled:opacity-50"
                data-testid="button-apollo-quick"
              >
                <Sparkles className="w-3 h-3" /> {contactsFinding ? "Finding…" : "Refresh contacts"}
              </button>
              {c.stock_ticker && (
                <a
                  href={`https://finance.yahoo.com/quote/${encodeURIComponent(c.stock_ticker)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors"
                >
                  <TrendingUp className="w-3 h-3" /> {c.stock_ticker}
                </a>
              )}
              <button
                type="button"
                onClick={() => navigate("/deals")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium transition-colors"
                title="Go to Deals to add this brand to a deal"
              >
                <Plus className="w-3 h-3" /> Add to deal
              </button>
              <button
                type="button"
                onClick={() => navigate("/available")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium transition-colors"
                title="Browse available units to pitch to this brand"
              >
                <Building2 className="w-3 h-3" /> Pitch property
              </button>
            </div>

            {/* Single BGP AI take + Ask ChatBGP question runner — sits above all zones */}
            <div className="mt-2 order-2 space-y-3">
              <BgpTakeStrip companyId={companyId} tab="brand" />
              {(() => {
                const questions: string[] = [
                  `Tell me everything BGP needs to know about ${c.name} before a first call`,
                  `What's ${c.name}'s covenant risk? How should we position this to a landlord?`,
                  `What are the key signals about ${c.name} right now and what should BGP do?`,
                  `Who should BGP contact at ${c.name} and what's the best approach?`,
                  `What space would ${c.name} want and what BGP properties could work?`,
                  `Walk me through ${c.name}'s UK financials and what they mean for rent affordability`,
                  `Should BGP be pitching ${c.name} new space — if so, where and why?`,
                  `Draft a brief introductory pitch email from BGP to ${c.name}`,
                ];
                return (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-foreground mb-1.5 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-purple-500" /> Ask ChatBGP
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {questions.map(q => (
                        <button
                          key={q}
                          onClick={() => { setChatInput(q); window.dispatchEvent(new CustomEvent("open-ai-chat-with-prompt")); }}
                          className="text-xs px-2.5 py-1 rounded-full border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950 transition-colors flex items-center gap-1 leading-tight"
                        >
                          <Sparkles className="w-3 h-3 shrink-0" />{q}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Zone 1: Global Brand ─────────────────────── */}
            <div className="border-t border-border/40 mt-3 pt-2 order-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Store className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">Global Brand</span>
            </div>
            <div className="space-y-2.5">

            {/* Visual brand banner — street view + first gallery image */}
            {(() => {
              const hasStreetView = stores.some((s: any) => typeof s.lat === "number" && typeof s.lng === "number");
              const firstImg = data.images[0];
              if (!hasStreetView && !firstImg) return null;
              return (
                <div className={`grid gap-1.5 rounded-md overflow-hidden ${hasStreetView && firstImg ? "grid-cols-2" : "grid-cols-1"}`} style={{ height: 220 }}>
                  {hasStreetView && (
                    <div className="overflow-hidden rounded-md bg-muted/40">
                      <img
                        src={`/api/brand/${companyId}/flagship-image`}
                        alt="Flagship store street view"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                      />
                    </div>
                  )}
                  {firstImg && (
                    <div className="overflow-hidden rounded-md bg-muted/40">
                      <img
                        src={firstImg.thumbnail_data
                          ? `data:${firstImg.mime_type || "image/jpeg"};base64,${firstImg.thumbnail_data}`
                          : `/api/brand/gallery-image/${firstImg.id}`}
                        alt="Brand visual"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Stock card — only when brand has a ticker */}
            {c.stock_ticker && stockData?.snapshot && (() => {
              const s = stockData.snapshot;
              const history = stockData.history || [];
              const change = s.fiftyTwoWeekChange;
              const changeColor = change == null ? "text-muted-foreground" : change >= 0 ? "text-emerald-700" : "text-red-600";
              const changePct = change != null ? `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%` : "—";
              const fmtCap = (v: number | null) => {
                if (v == null) return "—";
                if (v >= 1e9) return `£${(v / 1e9).toFixed(2)}B`;
                if (v >= 1e6) return `£${(v / 1e6).toFixed(0)}M`;
                return `£${(v / 1e3).toFixed(0)}K`;
              };
              const curr = s.currency === "USD" ? "$" : s.currency === "EUR" ? "€" : "£";
              return (
                <div className="rounded-md border border-border bg-gradient-to-br from-slate-50 to-zinc-50 dark:from-slate-950 dark:to-zinc-950 p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      <Coins className="w-3.5 h-3.5 text-amber-600" />
                      <span className="text-xs font-semibold">{s.ticker}</span>
                      {s.exchange && <span className="text-[10px] text-muted-foreground">{s.exchange}</span>}
                      {s.shortName && <span className="text-[10px] text-muted-foreground truncate">· {s.shortName}</span>}
                    </div>
                    <a href={`https://finance.yahoo.com/quote/${encodeURIComponent(s.ticker)}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-0.5">
                      Yahoo <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Price</div>
                      <div className="font-bold">{s.price != null ? `${curr}${s.price.toFixed(2)}` : "—"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">52w</div>
                      <div className={`font-semibold ${changeColor} flex items-center gap-1`}>
                        {change != null && (change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />)}
                        {changePct}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Mkt cap</div>
                      <div className="font-semibold">{fmtCap(s.marketCapGBP)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">P/E</div>
                      <div className="font-semibold">{s.peRatio != null ? s.peRatio.toFixed(1) : "—"}</div>
                    </div>
                  </div>
                  {history.length > 5 && (
                    <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">90-day price</span>
                      <Sparkline values={history.map(h => h.close)} width={140} height={24} />
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Global brand ─────────────────────────────────────────── */}
            <div className="space-y-2">
              {/* Single description — prefer brand_analysis (more detailed), fall back to description */}
              {(c.brand_analysis || c.description) ? (
                <div>
                  {c.brand_analysis ? (
                    <div className="rounded-md border border-purple-200 dark:border-purple-900 bg-purple-50/60 dark:bg-purple-950/30 p-2">
                      <div className="flex items-center gap-1 text-xs text-purple-700 dark:text-purple-300 mb-1">
                        <Sparkles className="w-3 h-3" /> Global overview
                        {c.brand_analysis_at && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(c.brand_analysis_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs leading-snug text-foreground/90">{c.brand_analysis}</p>
                    </div>
                  ) : (
                    <p className="text-sm leading-snug text-foreground/85">{c.description}</p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-muted-foreground/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-2">No brand summary yet</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => enrichMutation.mutate()}
                    disabled={enrichMutation.isPending}
                  >
                    <Sparkles className={`w-3 h-3 mr-1 text-purple-500 ${enrichMutation.isPending ? "animate-pulse" : ""}`} />
                    {enrichMutation.isPending ? "Generating…" : "Auto-generate summary"}
                  </Button>
                </div>
              )}

              {/* Meta row — basic facts (outreach links live in the prominent strip above tabs) */}
              {(c.founded_year || c.employee_count || c.industry) && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {c.founded_year && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Est. {c.founded_year}</span>}
                  {c.employee_count && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {c.employee_count >= 10000 ? `${Math.round(c.employee_count / 1000)}k+ employees`
                        : c.employee_count >= 1000 ? `${(c.employee_count / 1000).toFixed(1)}k employees`
                        : `${c.employee_count} employees`}
                    </span>
                  )}
                  {c.industry && <span className="flex items-center gap-1"><BadgeInfo className="w-3 h-3" /> {c.industry}</span>}
                </div>
              )}
            </div>

            {/* BGP pitch — only shown if distinct from description */}
            {c.concept_pitch && c.concept_pitch !== c.description && (
              <div className="border-l-2 border-blue-300 dark:border-blue-700 pl-2">
                <div className="flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-400 mb-0.5 font-medium uppercase tracking-wide">
                  <FileText className="w-2.5 h-2.5" /> BGP pitch {aiFields.concept_pitch && <AiChip />}
                </div>
                <p className="text-xs leading-snug">{c.concept_pitch}</p>
              </div>
            )}

            {/* Key facts row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              {c.store_count != null && (
                <div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
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
                  <div className="text-xs text-muted-foreground mb-1">Rollout {aiFields.rollout_status && <AiChip />}</div>
                  <RolloutBadge status={c.rollout_status} />
                </div>
              )}
              {c.backers && (
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <Coins className="w-3 h-3" /> Backers {aiFields.backers && <AiChip />}
                  </div>
                  {(() => {
                    // Build a name → company-id map from every known CRM company,
                    // plus the parent group + siblings as priority hits, so any
                    // backer / brand mention that resolves to a tracked company
                    // becomes a link to its profile. Case-insensitive, word-boundary.
                    const linkMap = new Map<string, string>();
                    for (const co of allCompaniesForPicker) {
                      if (co.id === companyId) continue;       // don't self-link
                      if (co.name && co.name.length >= 3) linkMap.set(co.name.toLowerCase(), co.id);
                    }
                    if (parentGroup) linkMap.set(parentGroup.name.toLowerCase(), parentGroup.id);
                    for (const s of siblingBrands) linkMap.set(s.name.toLowerCase(), s.id);
                    const linkFor = (name: string): string | null => linkMap.get(name.trim().toLowerCase()) || null;
                    // Linkify any of those known names found inside a free-text string
                    const linkifyText = (text: string) => {
                      if (linkMap.size === 0) return text;
                      const names = Array.from(linkMap.keys()).sort((a, b) => b.length - a.length);
                      const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
                      const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
                      const parts: Array<string | { id: string; label: string }> = [];
                      let last = 0;
                      let m: RegExpExecArray | null;
                      while ((m = re.exec(text)) !== null) {
                        if (m.index > last) parts.push(text.slice(last, m.index));
                        const id = linkMap.get(m[1].toLowerCase());
                        if (id) parts.push({ id, label: m[1] });
                        else parts.push(m[1]);
                        last = m.index + m[1].length;
                      }
                      if (last < text.length) parts.push(text.slice(last));
                      return parts.map((p, i) => typeof p === "string"
                        ? <span key={i}>{p}</span>
                        : <Link key={i} href={`/companies/${p.id}`} className="text-primary hover:underline">{p.label}</Link>
                      );
                    };
                    if (Array.isArray(aiFields.backers_detail) && aiFields.backers_detail.length > 0) {
                      return (
                        <div className="space-y-1">
                          {(aiFields.backers_detail as Array<{ name: string; type?: string; description?: string }>).map((b, i) => {
                            const id = linkFor(b.name);
                            return (
                              <div key={i} className="flex items-start gap-1.5 text-sm">
                                <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
                                <div className="min-w-0">
                                  {id ? (
                                    <Link href={`/companies/${id}`} className="font-medium text-primary hover:underline">{b.name}</Link>
                                  ) : (
                                    <>
                                      <span className="font-medium">{b.name}</span>
                                      <button
                                        type="button"
                                        onClick={() => createBackerMutation.mutate({ name: b.name, type: b.type, description: b.description })}
                                        disabled={createBackerMutation.isPending}
                                        className="ml-1.5 text-[10px] text-purple-600 hover:text-purple-700 underline decoration-dotted disabled:opacity-50"
                                      >
                                        {createBackerMutation.isPending && createBackerMutation.variables?.name === b.name ? "Creating…" : "+ Create"}
                                      </button>
                                    </>
                                  )}
                                  {b.type && <Badge variant="outline" className="ml-1.5 text-[10px] py-0">{b.type.replace(/_/g, " ")}</Badge>}
                                  {b.description && <p className="text-xs text-muted-foreground leading-snug">{linkifyText(b.description)}</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    return <div className="text-sm">{linkifyText(c.backers || "")}</div>;
                  })()}
                </div>
              )}
              {c.instagram_handle && (() => {
                const ig = data.socialStats?.find((s: any) => s.platform === "instagram");
                return (
                  <div>
                    <a
                      href={`https://instagram.com/${c.instagram_handle.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      <Instagram className="w-3 h-3" /> {c.instagram_handle}
                      {ig?.followers != null && (
                        <span className="text-[10px] text-muted-foreground ml-0.5">· {fmtFollowers(ig.followers)}</span>
                      )}
                    </a>
                  </div>
                );
              })()}
              {c.tiktok_handle && (() => {
                const tk = data.socialStats?.find((s: any) => s.platform === "tiktok");
                return (
                  <div>
                    <a
                      href={`https://tiktok.com/@${c.tiktok_handle.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.86 4.86 0 01-1.07-.1z" /></svg>
                      {c.tiktok_handle}
                      {tk?.followers != null && (
                        <span className="text-[10px] text-muted-foreground ml-0.5">· {fmtFollowers(tk.followers)}</span>
                      )}
                    </a>
                  </div>
                );
              })()}
              {c.dept_store_presence && (
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <Building2 className="w-3 h-3" /> Dept store presence
                  </div>
                  <div className="text-sm">{c.dept_store_presence}</div>
                </div>
              )}
              {c.franchise_activity && (
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <MapPin className="w-3 h-3" /> Franchise activity
                  </div>
                  <div className="text-sm">{c.franchise_activity}</div>
                </div>
              )}
              {c.annual_revenue && c.annual_revenue > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <PoundSterling className="w-3 h-3" /> Revenue
                  </div>
                  <div className="font-semibold">
                    {c.annual_revenue >= 1_000_000_000
                      ? `$${(c.annual_revenue / 1_000_000_000).toFixed(1)}B`
                      : `$${(c.annual_revenue / 1_000_000).toFixed(0)}M`}
                  </div>
                </div>
              )}
              {c.hunter_flag && (
                <div className="col-span-2">
                  <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[10px] flex items-center gap-1 w-fit">
                    <Flame className="w-2.5 h-2.5" /> Hunter Pick
                  </Badge>
                </div>
              )}
              {c.stock_ticker ? (
                <div className="col-span-2">
                  <StockSnapshotCard companyId={c.id} ticker={c.stock_ticker} />
                </div>
              ) : c.is_tracked_brand ? (
                <div className="col-span-2">
                  <TickerSuggestPicker
                    companyId={c.id}
                    onSelect={(ticker) => patchMutation.mutate({ stock_ticker: ticker })}
                  />
                </div>
              ) : null}
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
                <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
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
                <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
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
            </div>
            </div>

            {/* ── Zone 2: UK Presence ──────────────────────── */}
            <div className="border-t border-border/40 mt-3 pt-2 order-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">UK &amp; Covenant</span>
            </div>
            <div className="space-y-2.5">
            {/* Covenant strip — CH financials + traffic light */}
            {covenant && (
              <div className="border-t pt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Activity className="w-3 h-3" /> UK entity &amp; covenant
                  </div>
                  <Badge className={
                    covenant.trafficLight === "green" ? "bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]" :
                    covenant.trafficLight === "amber" ? "bg-amber-100 text-amber-700 border-amber-200 text-[10px]" :
                    "bg-red-100 text-red-700 border-red-200 text-[10px]"
                  }>
                    {covenant.trafficLight === "green" ? "Strong" : covenant.trafficLight === "amber" ? "Verify" : "At risk"}
                  </Badge>
                </div>
                {/* UK entity name + registered address + CH number */}
                {(c.uk_entity_name || c.companies_house_number || covenant.registeredAddress) && (
                  <div className="mb-2 text-xs text-muted-foreground space-y-0.5">
                    {c.uk_entity_name && (
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3 h-3 shrink-0" />
                        <span className="font-medium text-foreground/80">{c.uk_entity_name}</span>
                        <a
                          href={`https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(c.uk_entity_name)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-primary hover:underline ml-auto"
                          title="Search Companies House"
                        >
                          CH search →
                        </a>
                        {!c.companies_house_number && (
                          <button
                            type="button"
                            onClick={() => reResolveKycMutation.mutate()}
                            disabled={reResolveKycMutation.isPending}
                            className="text-[10px] text-muted-foreground hover:text-primary hover:underline disabled:opacity-50"
                            title="Re-derive Companies House match from the brand's website"
                          >
                            {reResolveKycMutation.isPending ? "Resolving…" : "Wrong company?"}
                          </button>
                        )}
                      </div>
                    )}
                    {c.companies_house_number && (
                      <div className="flex items-center gap-1.5">
                        {!c.uk_entity_name && <Building2 className="w-3 h-3 shrink-0" />}
                        {c.uk_entity_name && <span className="w-3 h-3 shrink-0" />}
                        <span className="text-foreground/70">Reg no.</span>
                        <a
                          href={`https://find-and-update.company-information.service.gov.uk/company/${c.companies_house_number}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-primary hover:underline"
                        >
                          {c.companies_house_number}
                        </a>
                        <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
                        <button
                          type="button"
                          onClick={() => reResolveKycMutation.mutate()}
                          disabled={reResolveKycMutation.isPending}
                          className="ml-auto text-[10px] text-muted-foreground hover:text-primary hover:underline disabled:opacity-50"
                          title="Re-derive Companies House match from the brand's website"
                        >
                          {reResolveKycMutation.isPending ? "Re-resolving…" : "Wrong company?"}
                        </button>
                      </div>
                    )}
                    {covenant.registeredAddress && (
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>{covenant.registeredAddress}</span>
                      </div>
                    )}
                    {!c.uk_entity_name && !c.companies_house_number && !helpForm && (
                      <button
                        type="button"
                        onClick={startEdit}
                        className="text-[10px] text-amber-600 hover:text-amber-700 hover:underline"
                      >
                        + Add UK contracting entity name
                      </button>
                    )}
                    {helpForm && (
                      <div className="mt-2 p-2.5 rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 space-y-2">
                        <div className="flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-100">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>
                            Couldn't find {c.name}'s UK trading entity automatically. Under the Companies Act 2006 it must be on their website — usually in the T&amp;Cs. Help us find it (any one of the three is enough):
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          <div>
                            <label className="text-[10px] text-muted-foreground">T&amp;Cs URL (we'll scrape it)</label>
                            <Input
                              type="url"
                              placeholder="https://uk.brand.com/pages/terms"
                              value={helpForm.tcsUrl}
                              onChange={(e) => setHelpForm({ ...helpForm, tcsUrl: e.target.value })}
                              className="h-7 text-xs"
                              disabled={manualResolveMutation.isPending}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">UK entity name (we'll search Companies House)</label>
                            <Input
                              type="text"
                              placeholder="e.g. ALLSAINTS RETAIL LIMITED"
                              value={helpForm.entityName}
                              onChange={(e) => setHelpForm({ ...helpForm, entityName: e.target.value })}
                              className="h-7 text-xs"
                              disabled={manualResolveMutation.isPending}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">Companies House number (we'll verify)</label>
                            <Input
                              type="text"
                              placeholder="e.g. 04096157"
                              value={helpForm.chNumber}
                              onChange={(e) => setHelpForm({ ...helpForm, chNumber: e.target.value })}
                              className="h-7 text-xs font-mono"
                              disabled={manualResolveMutation.isPending}
                            />
                          </div>
                          <div className="flex gap-1.5 pt-1">
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                const override: { tcsUrl?: string; entityName?: string; chNumber?: string } = {};
                                if (helpForm.chNumber.trim()) override.chNumber = helpForm.chNumber.trim();
                                else if (helpForm.entityName.trim()) override.entityName = helpForm.entityName.trim();
                                else if (helpForm.tcsUrl.trim()) override.tcsUrl = helpForm.tcsUrl.trim();
                                if (Object.keys(override).length === 0) {
                                  toast({ title: "Nothing to submit", description: "Fill in at least one field.", variant: "destructive" });
                                  return;
                                }
                                manualResolveMutation.mutate(override);
                              }}
                              disabled={manualResolveMutation.isPending || (!helpForm.tcsUrl.trim() && !helpForm.entityName.trim() && !helpForm.chNumber.trim())}
                            >
                              {manualResolveMutation.isPending ? "Resolving…" : "Try this"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setHelpForm(null)}
                              disabled={manualResolveMutation.isPending}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Status</div>
                    <div className="font-medium capitalize">{covenant.companyStatus || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Last accounts</div>
                    <div className={`font-medium ${covenant.accountsOverdue ? "text-red-600" : ""}`}>
                      {covenant.lastAccountsMadeUpTo ? new Date(covenant.lastAccountsMadeUpTo).toLocaleDateString("en-GB") : "—"}
                      {covenant.accountsOverdue && <span className="ml-1 text-[10px] text-red-600 font-semibold">OVERDUE</span>}
                    </div>
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
                {!covenant.experian && kycRunning && (
                  <div className="mt-2 pt-2 border-t">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1 animate-pulse">
                      <BadgeInfo className="w-3 h-3" /> Running Experian credit check…
                    </div>
                  </div>
                )}
                {covenant.experian && (
                  <div className="mt-2 pt-2 border-t">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                      <BadgeInfo className="w-3 h-3" /> Experian credit report
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {covenant.experian.creditScore != null && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">Credit score</div>
                          <div className={`font-semibold ${covenant.experian.creditScore >= 70 ? "text-emerald-700" : covenant.experian.creditScore >= 40 ? "text-amber-600" : "text-red-600"}`}>
                            {covenant.experian.creditScore}/100
                          </div>
                        </div>
                      )}
                      {covenant.experian.creditBand && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">Band</div>
                          <div className="font-semibold">{covenant.experian.creditBand}</div>
                        </div>
                      )}
                      {covenant.experian.riskIndicator && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">Risk</div>
                          <div className="font-semibold">{covenant.experian.riskIndicator}</div>
                        </div>
                      )}
                      {covenant.experian.creditLimit != null && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">Credit limit</div>
                          <div className="font-semibold">£{Number(covenant.experian.creditLimit).toLocaleString()}</div>
                        </div>
                      )}
                      {covenant.experian.ccj != null && covenant.experian.ccj > 0 && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">CCJs</div>
                          <div className="font-semibold text-red-600">
                            {covenant.experian.ccj} CCJ{covenant.experian.ccj === 1 ? "" : "s"}
                            {covenant.experian.ccjTotalValue ? ` · £${Number(covenant.experian.ccjTotalValue).toLocaleString()}` : ""}
                          </div>
                        </div>
                      )}
                      {covenant.experian.turnover != null && covenant.experian.turnover > 0 && (
                        <div>
                          <div className="text-[10px] text-muted-foreground">Turnover (Experian)</div>
                          <div className="font-semibold">£{(Number(covenant.experian.turnover) / 1_000_000).toFixed(1)}m</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {covenant.officers && covenant.officers.length > 0 && (
                  <div className="mt-2 pt-2 border-t">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Officers</div>
                    <div className="space-y-1">
                      {covenant.officers.map((o, i) => {
                        const a = officerApollo[o.name];
                        const lookup = async () => {
                          setOfficerApollo(prev => ({ ...prev, [o.name]: { loading: true, match: null } }));
                          try {
                            const r = await fetch(`/api/brand/${companyId}/apollo/find-officer`, {
                              method: "POST",
                              credentials: "include",
                              headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                              body: JSON.stringify({ name: o.name }),
                            });
                            const out = await r.json();
                            if (!r.ok) throw new Error(out?.error || "Apollo lookup failed");
                            setOfficerApollo(prev => ({ ...prev, [o.name]: { loading: false, match: out.match } }));
                            if (!out.match) toast({ title: "No Apollo match", description: o.name });
                          } catch (e: any) {
                            setOfficerApollo(prev => ({ ...prev, [o.name]: { loading: false, match: null, error: e.message } }));
                            toast({ title: "Lookup failed", description: e.message, variant: "destructive" });
                          }
                        };
                        return (
                          <div key={i} className="text-xs">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-medium text-foreground/90 truncate">{o.name}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-muted-foreground whitespace-nowrap capitalize">
                                  {o.role?.replace(/-/g, " ") || "Officer"}
                                  {o.appointedOn && <span className="ml-1 text-[10px]">· {new Date(o.appointedOn).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>}
                                </span>
                                {!a?.match && (
                                  <button
                                    onClick={lookup}
                                    disabled={a?.loading}
                                    className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                    title="Find this officer on Apollo"
                                  >
                                    {a?.loading ? "…" : "Apollo"}
                                  </button>
                                )}
                              </div>
                            </div>
                            {a?.match && (
                              <div className="mt-1 pl-2 ml-1 border-l-2 border-blue-200 text-[10px] space-y-0.5">
                                {a.match.title && <div className="text-foreground/80">{a.match.title}</div>}
                                <div className="flex gap-2 flex-wrap">
                                  {a.match.email && <a href={`mailto:${a.match.email}`} className="text-blue-700 hover:underline">{a.match.email}</a>}
                                  {a.match.linkedin_url && <a href={a.match.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline flex items-center gap-0.5"><Linkedin className="w-2.5 h-2.5" />LinkedIn</a>}
                                  {a.match.location && <span className="text-muted-foreground">{a.match.location}</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {covenant.companyStatus && covenant.companyStatus !== "active" && (
                  <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      Linked CH entity is <b>{covenant.companyStatus}</b>. This may be an old holding company.
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-auto px-1 py-0 text-xs text-amber-700 underline"
                        onClick={() => findUkEntityMutation.mutate()}
                        disabled={findUkEntityMutation.isPending}
                      >
                        Find active UK entity
                      </Button>
                    </div>
                  </div>
                )}
                {turnover.filter((t: any) => t.turnover && t.turnover > 0).length > 0 && (() => {
                  const validTurnover = turnover.filter((t: any) => t.turnover && t.turnover > 0);
                  return (
                    <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
                      <PoundSterling className="w-3 h-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Turnover trend:</span>
                      {validTurnover.slice(0, 3).reverse().map((t: any) => (
                        <Badge key={t.period} variant="outline" className="text-[10px]">
                          {t.period}: £{(t.turnover / 1_000_000).toFixed(1)}m
                        </Badge>
                      ))}
                      <Sparkline values={validTurnover.slice().reverse().map((t: any) => Number(t.turnover))} />
                    </div>
                  );
                })()}
                {/* Rollout velocity — 12-month bar chart */}
                {rolloutVelocity && rolloutVelocity.monthly && rolloutVelocity.monthly.some((m: any) => m.openings > 0 || m.closures > 0) && (
                  <div className="mt-2 pt-2 border-t">
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Rollout velocity (last 12m)
                      <span className="ml-auto font-medium">
                        <span className="text-emerald-700">+{rolloutVelocity.openings12m}</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-red-600">-{rolloutVelocity.closures12m}</span>
                        <span className="text-muted-foreground"> · net </span>
                        <span className={rolloutVelocity.net12m > 0 ? "text-emerald-700" : rolloutVelocity.net12m < 0 ? "text-red-600" : ""}>{rolloutVelocity.net12m > 0 ? "+" : ""}{rolloutVelocity.net12m}</span>
                      </span>
                    </div>
                    <RolloutBarChart monthly={rolloutVelocity.monthly} />
                  </div>
                )}
                {/* Store spread map + list side-by-side */}
                <div className="mt-2 pt-2 border-t">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> UK stores ({stores.length}{c.store_count && c.store_count > 0 && stores.length !== c.store_count ? ` of ${c.store_count} global` : ""}{stores.filter((s: any) => s.status === "open").length > 0 && stores.filter((s: any) => s.status === "open").length !== stores.length ? ` · ${stores.filter((s: any) => s.status === "open").length} open` : ""})
                    </span>
                    <button
                      onClick={() => researchStoresMutation.mutate()}
                      disabled={researchStoresMutation.isPending}
                      className="text-[10px] text-primary hover:underline disabled:opacity-50 flex items-center gap-0.5"
                      title="Research stores via Google Places"
                    >
                      <Search className={`w-2.5 h-2.5 ${researchStoresMutation.isPending ? "animate-spin" : ""}`} />
                      {stores.length === 0 ? "Find stores" : "Re-scan"}
                    </button>
                  </div>
                  {stores.filter((s: any) => typeof s.lat === "number" && typeof s.lng === "number").length > 0 ? (
                    <div className="space-y-0.5 max-h-[260px] overflow-y-auto pr-1">
                      {stores.slice(0, 30).map((s: any) => (
                        <div key={s.id} className="text-xs flex items-start gap-1.5 px-1 py-0.5">
                          <MapPin className={`w-3 h-3 shrink-0 mt-0.5 ${s.status === "closed" ? "text-red-500" : s.status === "open" ? "text-emerald-500" : "text-muted-foreground"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="truncate flex-1 font-medium">{s.name}</span>
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
                            {s.address && <div className="text-[10px] text-muted-foreground truncate">{s.address}</div>}
                          </div>
                        </div>
                      ))}
                      {stores.length > 30 && (
                        <p className="text-[10px] text-muted-foreground pl-1">+{stores.length - 30} more stores</p>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground px-1 py-1">
                      {researchStoresMutation.isPending ? (
                        <span className="italic">Searching Google Places…</span>
                      ) : c.store_count && c.store_count > 0 ? (
                        <span>Brand has ~{c.store_count.toLocaleString()} stores globally. Click Find stores to pull UK locations from Google Places.</span>
                      ) : (
                        <span className="italic">No stores researched yet. Click Find stores to search now.</span>
                      )}
                    </div>
                  )}
                </div>
                {rentAffordability && rentAffordability.rentToTurnoverPct != null && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs pt-2 border-t">
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
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <PoundSterling className="w-3 h-3" /> Recent deal comps ({rentComps.length})
                    </div>
                    <div className="space-y-0.5">
                      {rentComps.slice(0, 5).map((rc) => {
                        const psf = rc.rent_psf_overall ?? rc.rent_psf_nia ?? rc.zone_a_rate;
                        return (
                          <Link key={rc.id} href={`/comps/${rc.id}`}>
                            <div className="flex items-center justify-between text-xs hover:bg-muted/40 rounded px-1 py-0.5 cursor-pointer">
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
            </div>
            </div>

            {/* ── Zone 4: BGP Relationship ──────────────────── */}
            <div className="border-t border-border/40 mt-3 pt-2 order-6">
            <div className="flex items-center gap-1.5 mb-2">
              <Handshake className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">BGP Relationship</span>
            </div>
            <div className="space-y-2.5">
            {/* BGP coverage — who covers this brand internally */}
            {data.coverers && data.coverers.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap border-t pt-2">
                <span className="text-[10px] text-muted-foreground font-medium">Coverage:</span>
                {data.coverers.map((cov: any) => (
                  <span key={cov.id} className="inline-flex items-center gap-1 text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5">
                    <Users className="w-2.5 h-2.5" /> {cov.name}
                  </span>
                ))}
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
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
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

            {/* Decision-makers — tiered: Store Dev → C-suite → Other → Apollo */}
            <div className="border-t pt-2">
              <div className="text-xs text-muted-foreground mb-1.5 flex items-center justify-between gap-1">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Key contacts</span>
                {contactsFinding && (
                  <span className="text-[10px] text-purple-500 flex items-center gap-0.5 animate-pulse">
                    <Sparkles className="w-2.5 h-2.5" /> Finding…
                  </span>
                )}
              </div>
              {/* UK registered address as contact detail */}
              {covenant?.registeredAddress && (
                <div className="text-xs text-muted-foreground flex items-start gap-1 mb-1.5 bg-blue-50/60 dark:bg-blue-950/20 rounded px-1.5 py-1">
                  <MapPin className="w-3 h-3 shrink-0 mt-0.5 text-blue-600" />
                  <span><span className="text-blue-700 dark:text-blue-400 font-medium">UK office:</span> {covenant.registeredAddress}</span>
                </div>
              )}
              {decisionMakers.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {contactsFinding ? "Searching Apollo & RocketReach…" : "No contacts found."}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {/* Tier 1 — Store development / property / UK */}
                  {decisionMakers.filter(d => d.tier === 1).length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <Store className="w-2.5 h-2.5" /> Store development &amp; property
                      </div>
                      <div className="space-y-0.5">
                        {decisionMakers.filter(d => d.tier === 1).map(dm => (
                          <ContactRow key={dm.id} dm={dm} />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Tier 2 — C-suite */}
                  {decisionMakers.filter(d => d.tier === 2).length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">C-suite &amp; leadership</div>
                      <div className="space-y-0.5">
                        {decisionMakers.filter(d => d.tier === 2).map(dm => (
                          <ContactRow key={dm.id} dm={dm} />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Tier 3 — Directors / VP */}
                  {decisionMakers.filter(d => d.tier === 3).length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Directors &amp; VPs</div>
                      <div className="space-y-0.5">
                        {decisionMakers.filter(d => d.tier === 3).slice(0, 4).map(dm => (
                          <ContactRow key={dm.id} dm={dm} />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Tier 4 — other contacts, scrollable */}
                  {decisionMakers.filter(d => d.tier === 4).length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Other contacts</div>
                      <div className="max-h-28 overflow-y-auto space-y-0.5 pr-1">
                        {decisionMakers.filter(d => d.tier === 4).map(dm => (
                          <ContactRow key={dm.id} dm={dm} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* BGP deal history — comprehensive interactions live in the timeline below */}
            {bgpSummary && bgpSummary.totalDeals > 0 && (
              <div className="border-t pt-2">
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Briefcase className="w-3 h-3" /> BGP deals with this brand
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
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
                  {bgpSummary.team.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">BGP team</div>
                      <div className="font-medium truncate text-xs">{bgpSummary.team.slice(0, 3).join(", ")}{bgpSummary.team.length > 3 ? ` +${bgpSummary.team.length - 3}` : ""}</div>
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

            {/* Interactions timeline — last 12 BGP touchpoints */}
            {data.interactions && data.interactions.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Recent interactions ({data.interactions.length})
                </div>
                <div className="space-y-1 border-l-2 border-purple-200 dark:border-purple-900 pl-2.5">
                  {data.interactions.slice(0, 8).map((it: any) => {
                    const days = Math.floor((Date.now() - new Date(it.interaction_date).getTime()) / 864e5);
                    const ago = days < 1 ? "today" : days < 7 ? `${days}d` : days < 30 ? `${Math.floor(days / 7)}w` : days < 365 ? `${Math.floor(days / 30)}mo` : `${Math.floor(days / 365)}y`;
                    const typeColor: Record<string, string> = {
                      email: "bg-blue-50 text-blue-700 border-blue-200",
                      call: "bg-emerald-50 text-emerald-700 border-emerald-200",
                      meeting: "bg-purple-50 text-purple-700 border-purple-200",
                      note: "bg-zinc-50 text-zinc-700 border-zinc-200",
                    };
                    return (
                      <div key={it.id} className="text-xs flex gap-1.5 items-start">
                        <span className={`text-[10px] font-medium px-1 py-0.5 rounded border shrink-0 ${typeColor[it.type] || "bg-zinc-50 text-zinc-700 border-zinc-200"}`}>{it.type}</span>
                        <div className="flex-1 min-w-0">
                          {it.subject && <div className="font-medium truncate">{it.subject}</div>}
                          {it.preview && <div className="text-[10px] text-muted-foreground truncate">{it.preview}</div>}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{it.bgp_user || ""} · {ago}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Lease-expiry radar — tenant's upcoming lease events on our schedule */}
            {leaseEvents.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
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
                          <span className="font-medium tabular-nums text-xs shrink-0">{nextEvent?.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>
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
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
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
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
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
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
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
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
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
                <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
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
                    const useClass = r.use?.[0] || null;
                    const size = r.size?.length ? r.size.join(", ") : null;
                    const locations = r.requirement_locations?.length ? r.requirement_locations.join(", ") : null;
                    return (
                      <Link
                        key={r.id}
                        href={`/requirements?companyId=${c.id}`}
                        className="text-xs flex items-center gap-1.5 hover:bg-muted/50 rounded px-1 py-0.5"
                      >
                        {useClass && <Badge variant="outline" className="text-[10px] shrink-0">{useClass}</Badge>}
                        {size && <span className="font-medium shrink-0">{size}</span>}
                        {locations && <span className="truncate text-muted-foreground">{locations}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pitched-to history */}
            {pitchedTo.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
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

            {/* Suggested BGP units — available portfolio units not yet pitched to this brand */}
            {suggestedUnits && suggestedUnits.length > 0 && (
              <div className="border-t pt-2">
                <div className="text-xs font-medium text-foreground/70 mb-1 flex items-center gap-1">
                  <Building2 className="w-3 h-3 text-emerald-600" />
                  <span>BGP portfolio — potential pitches ({suggestedUnits.length})</span>
                </div>
                <div className="space-y-1">
                  {suggestedUnits.map((u) => (
                    <Link key={u.id} href={`/properties/${u.property_id}`} className="flex items-center gap-2 text-xs hover:bg-muted/40 rounded px-1 py-1 -mx-1 transition-colors group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium truncate">{u.property_name}</span>
                          {u.unit_name && <span className="text-[10px] text-muted-foreground shrink-0">{u.unit_name}</span>}
                          {u.zone && <Badge variant="outline" className="text-[10px] shrink-0">{u.zone}</Badge>}
                        </div>
                        {u.property_address && <div className="text-[10px] text-muted-foreground truncate">{u.property_address}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        {u.rent_pa != null && <div className="font-semibold text-xs">£{Math.round(u.rent_pa / 1000)}k pa</div>}
                        {u.sqft != null && <div className="text-[10px] text-muted-foreground">{Math.round(u.sqft).toLocaleString()} sqft</div>}
                      </div>
                      <ExternalLink className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* UK store map — full-width footer of the BGP Relationship zone */}
            {stores.filter((s: any) => typeof s.lat === "number" && typeof s.lng === "number").length > 0 && (
              <div className="border-t pt-2">
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> UK store map ({stores.filter((s: any) => typeof s.lat === "number" && typeof s.lng === "number").length} located)
                </div>
                <BrandPortfolioMap stores={stores as any} height={420} />
              </div>
            )}

            </div>
            </div>

            {/* ── Zone 3: Hunter Intel ──────────────────────── */}
            <div className="border-t border-border/40 mt-3 pt-2 order-5">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Flame className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground">Hunter Intel</span>
                {hunter && hunter.expansionScore != null && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      hunter.expansionScore >= 75 ? "bg-orange-50 text-orange-700 border-orange-200" :
                      hunter.expansionScore >= 55 ? "bg-amber-50 text-amber-700 border-amber-200" :
                      hunter.expansionScore >= 40 ? "bg-zinc-50 text-zinc-700 border-zinc-200" :
                      "bg-zinc-50 text-zinc-500 border-zinc-200"
                    }`}
                    title={hunter.expansionFlags?.join(" · ") || ""}
                  >
                    Score {hunter.expansionScore}/100
                  </Badge>
                )}
                {c.hunter_flag && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">Watch</Badge>}
                <Link
                  href={`/hunter?companyId=${companyId}`}
                  className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                  title="Open in Hunter dashboard"
                >
                  Open in Hunter <ExternalLink className="w-2.5 h-2.5" />
                </Link>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1 text-muted-foreground"
                  onClick={() => refreshIntelMutation.mutate()}
                  disabled={refreshIntelMutation.isPending}
                  title="Fetch latest Google News for this brand + re-link signals"
                >
                  <Search className={`w-3 h-3 ${refreshIntelMutation.isPending ? "animate-spin" : ""}`} />
                  {refreshIntelMutation.isPending ? "Fetching…" : "News"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1 text-muted-foreground"
                  onClick={() => perplexityRefreshMutation.mutate()}
                  disabled={perplexityRefreshMutation.isPending}
                  title="Ask Perplexity for last 30 days of UK-relevant news and extract signals"
                >
                  <Sparkles className={`w-3 h-3 ${perplexityRefreshMutation.isPending ? "animate-spin" : ""}`} />
                  {perplexityRefreshMutation.isPending ? "Thinking…" : "Perplexity"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1 text-muted-foreground"
                  onClick={() => scrapeWebsiteMutation.mutate()}
                  disabled={scrapeWebsiteMutation.isPending || !c.domain}
                  title={c.domain ? "Scrape careers/press pages for expansion signals" : "No domain set"}
                >
                  <Globe className={`w-3 h-3 ${scrapeWebsiteMutation.isPending ? "animate-spin" : ""}`} />
                  {scrapeWebsiteMutation.isPending ? "Scraping…" : "Scrape"}
                </Button>
              </div>
            </div>
            <div className="space-y-2.5">
            {/* Expansion flags driving the Hunter score */}
            {hunter && hunter.expansionFlags && hunter.expansionFlags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {hunter.expansionFlags.map((flag) => (
                  <Badge key={flag} variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                    {flag}
                  </Badge>
                ))}
              </div>
            )}
            {/* Signals feed */}
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between gap-1">
                <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Signals ({data.signals.length})</span>
                <button
                  onClick={() => setAddSignalOpen(v => !v)}
                  className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-2.5 h-2.5" /> Log intel
                </button>
              </div>

              {addSignalOpen && (
                <div className="mb-2 p-2 rounded-md border border-dashed border-border bg-muted/30 space-y-1.5">
                  <Input
                    placeholder="Headline (e.g. H&M opening Oxford Street flagship)"
                    value={newSignal.headline}
                    onChange={e => setNewSignal(v => ({ ...v, headline: e.target.value }))}
                    className="h-7 text-xs"
                  />
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={newSignal.signal_type}
                      onChange={e => setNewSignal(v => ({ ...v, signal_type: e.target.value }))}
                      className="h-7 text-xs rounded-md border border-input bg-background px-2"
                    >
                      {["opening","closure","funding","exec_change","sector_move","rumour","news"].map(t => (
                        <option key={t} value={t}>{t.replace(/_/g," ")}</option>
                      ))}
                    </select>
                    <select
                      value={newSignal.sentiment}
                      onChange={e => setNewSignal(v => ({ ...v, sentiment: e.target.value }))}
                      className="h-7 text-xs rounded-md border border-input bg-background px-2"
                    >
                      <option value="positive">Positive</option>
                      <option value="neutral">Neutral</option>
                      <option value="negative">Negative</option>
                    </select>
                    <input
                      type="date"
                      value={newSignal.signal_date}
                      onChange={e => setNewSignal(v => ({ ...v, signal_date: e.target.value }))}
                      className="h-7 text-xs rounded-md border border-input bg-background px-2"
                    />
                  </div>
                  <Input
                    placeholder="Source URL (optional)"
                    value={newSignal.source}
                    onChange={e => setNewSignal(v => ({ ...v, source: e.target.value }))}
                    className="h-7 text-xs"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-6 text-[10px] px-2"
                      onClick={() => addSignalMutation.mutate()}
                      disabled={!newSignal.headline || addSignalMutation.isPending}
                    >
                      {addSignalMutation.isPending ? "Saving…" : "Save signal"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setAddSignalOpen(false)}>Cancel</Button>
                  </div>
                </div>
              )}

              {data.signals.length > 0 && (
                <div className="space-y-1">
                  {(signalsShowAll ? data.signals : data.signals.slice(0, 6)).map((s: any) => {
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
                      <div key={s.id} className={`text-xs flex items-start gap-2 border-l-2 pl-2 group ${sentCls[s.sentiment] || "border-l-muted"}`}>
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
                        <button
                          onClick={() => deleteSignalMutation.mutate(s.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                          title="Remove signal"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {data.signals.length > 6 && (
                <button
                  onClick={() => setSignalsShowAll(v => !v)}
                  className="mt-1.5 text-[10px] text-primary hover:underline"
                >
                  {signalsShowAll ? "Show less" : `Show ${data.signals.length - 6} more signal${data.signals.length - 6 === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
            {c.last_enriched_at && (
              <div className="text-[10px] text-muted-foreground pt-1 border-t flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" /> Last enriched {new Date(c.last_enriched_at).toLocaleString("en-GB")}
              </div>
            )}
            </div>
            </div>

            {/* ── Zone 5: News & Media ──────────────────────── */}
            <div className="border-t border-border/40 mt-3 pt-2 order-7">
            <div className="flex items-center gap-1.5 mb-2">
              <Newspaper className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">News &amp; Media</span>
            </div>
            <div className="space-y-2.5">

            {/* News articles mentioning this brand */}
            {data.news && data.news.length > 0 && (() => {
              const newsSourceColor = (name: string | null): string => {
                if (!name) return "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";
                const n = name.toLowerCase();
                if (n.includes("drapers")) return "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800";
                if (n.includes("retail week")) return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800";
                if (n.includes("property week") || n.includes("estates gazette") || n.includes("eg ")) return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800";
                if (n.includes("financial times") || n === "ft") return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800";
                if (n.includes("reuters")) return "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800";
                if (n.includes("vogue") || n.includes("business of fashion")) return "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800";
                if (n.includes("bbc")) return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800";
                if (n.includes("guardian") || n.includes("times") || n.includes("telegraph")) return "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800";
                return "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";
              };
              const relDate = (d: string | null): string => {
                if (!d) return "";
                const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
                if (days === 0) return "Today";
                if (days === 1) return "Yesterday";
                if (days < 7) return `${days}d ago`;
                if (days < 30) return `${Math.floor(days / 7)}w ago`;
                if (days < 365) return `${Math.floor(days / 30)}mo ago`;
                return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
              };
              // Press releases = signals with ai_generated=true (scraped from brand site) or source matching brand domain
              const brandDomain = c.domain ? c.domain.replace(/^www\./, "") : null;
              const pressSignals = data.signals.filter((s: any) =>
                s.ai_generated && s.source && brandDomain && (s.source.includes(brandDomain) || s.source === "perplexity")
              );
              const allSources = [...new Set(
                data.news
                  .map((a: any) => a.source_name)
                  .filter((s: any): s is string => !!s && !/^google( news)?$/i.test(s))
              )];
              const filtered = newsTab === "press"
                ? data.news.filter((a: any) => brandDomain && (a.url?.includes(brandDomain) || a.source_name?.toLowerCase().includes(c.name.toLowerCase().split(" ")[0])))
                : newsTab === "linkedin"
                  ? data.news.filter((a: any) => a.url?.includes("linkedin.com") || a.source_name?.toLowerCase().includes("linkedin"))
                  : (newsSourceFilter ? data.news.filter((a: any) => a.source_name === newsSourceFilter) : data.news);
              const visible = newsShowAll ? filtered : filtered.slice(0, 6);
              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1">
                      <Newspaper className="w-3 h-3 text-muted-foreground" />
                      <div className="flex gap-0.5">
                        {(["industry", "press", "linkedin"] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => { setNewsTab(t); setNewsShowAll(false); setNewsSourceFilter(null); }}
                            className={`text-[10px] font-medium px-2 py-0.5 rounded transition-colors ${newsTab === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            {t === "industry" ? `Industry (${data.news.length})` : t === "press" ? "Press releases" : "LinkedIn"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {newsTab === "industry" && allSources.length > 1 && (
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        {newsSourceFilter && (
                          <button onClick={() => setNewsSourceFilter(null)} className="text-[10px] text-muted-foreground hover:text-foreground underline">All</button>
                        )}
                        {allSources.slice(0, 5).map(s => (
                          <button
                            key={s}
                            onClick={() => setNewsSourceFilter(s === newsSourceFilter ? null : s)}
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors ${newsSourceFilter === s ? newsSourceColor(s) : "border-border text-muted-foreground hover:bg-muted"}`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {newsTab === "press" && pressSignals.length === 0 && filtered.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No press releases scraped yet — run "Scrape" from Hunter Intel zone.</p>
                  )}
                  {newsTab === "linkedin" && filtered.length === 0 && (
                    <div className="text-xs text-muted-foreground italic flex items-center gap-1.5 py-2">
                      <Linkedin className="w-3 h-3" />
                      No LinkedIn posts captured yet.{c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-primary hover:underline not-italic">Visit page →</a>}
                    </div>
                  )}
                  <div className="space-y-2">
                    {visible.map((article) => {
                      const isGoogleProxy = /google\.com|gstatic\.com|googleusercontent\.com/i.test(article.image_url || "");
                      const hasRealImage = !!(article.image_url && !isGoogleProxy);
                      const domain = (() => { try { return new URL(article.url).hostname.replace(/^www\./, ""); } catch { return null; } })();
                      // Suppress generic "Google" / "Google News" labels — use the actual publisher domain instead
                      const sourceLabel = article.source_name && /^google( news)?$/i.test(article.source_name)
                        ? (domain || null)
                        : article.source_name;
                      const displayText = article.ai_summary || article.summary;
                      return (
                        <a
                          key={article.id}
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex gap-2.5 group hover:bg-muted/40 rounded-lg p-2 -mx-2 transition-colors border border-transparent hover:border-border/50"
                        >
                          <div className="shrink-0">
                            {hasRealImage ? (
                              <img
                                src={article.image_url!}
                                alt=""
                                className="w-20 h-14 rounded-md object-cover border"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                                {domain ? (
                                  <img
                                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                    alt=""
                                    className="w-5 h-5 object-contain"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                ) : (
                                  <span className="text-sm font-bold text-muted-foreground">{(article.source_name || "?")[0].toUpperCase()}</span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              {sourceLabel && (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${newsSourceColor(sourceLabel)}`}>
                                  {sourceLabel}
                                </span>
                              )}
                              {article.category && article.category !== "general" && (
                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{article.category}</span>
                              )}
                              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{relDate(article.published_at)}</span>
                            </div>
                            <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">{article.title}</p>
                            {displayText && (
                              <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2 mt-0.5">{displayText}</p>
                            )}
                          </div>
                        </a>
                      );
                    })}
                  </div>
                  {filtered.length > 6 && (
                    <button
                      onClick={() => setNewsShowAll(v => !v)}
                      className="mt-2 text-[10px] text-primary hover:underline"
                    >
                      {newsShowAll ? "Show less" : `Show ${filtered.length - 6} more article${filtered.length - 6 === 1 ? "" : "s"}`}
                    </button>
                  )}
                </div>
              );
            })()}

            </div>
            </div>

            {/* ── Zone 6: Documents & Gallery ──────────────── */}
            <div className="border-t border-border/40 mt-3 pt-2 order-8">
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">Documents &amp; Gallery</span>
            </div>
            <div className="space-y-2.5">
              {/* SharePoint folder link */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  onClick={() => {
                    fetch(`/api/microsoft/company-folders/browse?company=${encodeURIComponent(c.name)}`, { credentials: "include" })
                      .then(r => r.json())
                      .then(d => {
                        const url = d.items?.[0]?.webUrl
                          ? d.items[0].webUrl.replace(/\/[^/]+$/, "") // strip filename, go to folder
                          : `https://bgp.sharepoint.com`;
                        window.open(url, "_blank");
                      })
                      .catch(() => window.open(`https://bgp.sharepoint.com`, "_blank"));
                  }}
                >
                  <FileText className="w-3 h-3" /> Open {c.name} folder on SharePoint →
                </button>
              </div>
              {/* Image gallery */}
              {data.images.length > 1 && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1.5">{data.images.length} image{data.images.length === 1 ? "" : "s"} in gallery</div>
                  <div className="grid grid-cols-4 gap-1">
                    {data.images.slice(0, 8).map((img: any) => (
                      <div key={img.id} className="aspect-square rounded border border-border/60 overflow-hidden bg-muted">
                        <img
                          src={img.thumbnail_data
                            ? `data:${img.mime_type || "image/jpeg"};base64,${img.thumbnail_data}`
                            : `/api/brand/gallery-image/${img.id}`}
                          alt={img.file_name}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>
          </div>
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

// ─── Mini SVG price chart ────────────────────────────────────────────────
function MiniPriceChart({ points, width = 280, height = 56 }: { points: Array<{ close: number }>; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const closes = points.map(p => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const step = w / (closes.length - 1);
  const toX = (i: number) => pad + i * step;
  const toY = (v: number) => pad + h - ((v - min) / span) * h;
  const pathD = closes.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L ${toX(closes.length - 1).toFixed(1)} ${(pad + h).toFixed(1)} L ${pad} ${(pad + h).toFixed(1)} Z`;
  const isUp = closes[closes.length - 1] >= closes[0];
  const stroke = isUp ? "#10b981" : "#ef4444";
  const fillStart = isUp ? "#10b98122" : "#ef444422";

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillStart} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#chart-fill)" />
      <path d={pathD} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Contact row ──────────────────────────────────────────────────────────
function ContactRow({ dm }: { dm: { id: string; name: string; role: string | null; email: string | null; phone: string | null; linkedin_url: string | null; avatar_url: string | null; enrichment_source: string | null } }) {
  return (
    <Link href={`/contacts/${dm.id}`}>
      <div className="flex items-center gap-1.5 text-xs rounded px-1.5 py-1 hover:bg-muted/50 cursor-pointer group">
        {dm.avatar_url ? (
          <img src={dm.avatar_url} alt={dm.name} className="w-6 h-6 rounded-full bg-muted shrink-0 object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-teal-100 dark:bg-teal-900 flex items-center justify-center text-[10px] font-semibold text-teal-700 dark:text-teal-300 shrink-0">
            {dm.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate group-hover:text-primary transition-colors">{dm.name}</div>
          {dm.role && <div className="text-[10px] text-muted-foreground truncate">{dm.role}</div>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {dm.enrichment_source === "apollo-search" && (
            <span title="Found via Apollo" className="text-[10px] text-purple-500 font-medium">A</span>
          )}
          {dm.phone && (
            <a href={`tel:${dm.phone}`} onClick={e => e.stopPropagation()} title={dm.phone}
              className="text-muted-foreground hover:text-primary">
              <Phone className="w-2.5 h-2.5" />
            </a>
          )}
          {dm.linkedin_url && (
            <a href={dm.linkedin_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              className="text-muted-foreground hover:text-primary">
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Stock snapshot card (Yahoo Finance) with price chart ────────────────
function StockSnapshotCard({ companyId, ticker }: { companyId: string; ticker: string }) {
  const { data, isLoading } = useQuery<{ snapshot: any | null; history: Array<{ date: string; close: number }> }>({
    queryKey: ["/api/brand", companyId, "stock"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/brand/${companyId}/stock`);
      return res.json();
    },
    staleTime: 4 * 60 * 60 * 1000,
  });

  const s = data?.snapshot;
  const history = data?.history ?? [];

  if (isLoading || !s) {
    return (
      <div className="rounded border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-1 animate-pulse">
        <TrendingUp className="w-3 h-3" /> {ticker} — fetching…
      </div>
    );
  }

  const chg = s.fiftyTwoWeekChange != null ? s.fiftyTwoWeekChange * 100 : null;
  const chgColor = chg == null ? "text-muted-foreground" : chg >= 20 ? "text-emerald-600" : chg >= 0 ? "text-green-600" : "text-red-600";
  const capLabel = s.marketCapGBP == null ? null
    : s.marketCapGBP >= 1_000_000_000 ? `£${(s.marketCapGBP / 1_000_000_000).toFixed(1)}bn`
    : s.marketCapGBP >= 1_000_000 ? `£${(s.marketCapGBP / 1_000_000).toFixed(0)}m`
    : `£${(s.marketCapGBP / 1_000).toFixed(0)}k`;
  const currencySymbol = s.currency === "GBp" ? "p" : s.currency === "GBP" ? "£" : s.currency === "USD" ? "$" : s.currency === "EUR" ? "€" : "";
  const priceLabel = s.price != null ? `${currencySymbol}${s.price.toFixed(2)}` : "—";

  return (
    <div className="rounded border bg-muted/30 overflow-hidden text-xs">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <TrendingUp className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="font-mono font-semibold">{s.ticker}</span>
          {s.exchange && <span className="text-[10px] text-muted-foreground truncate">· {s.exchange}</span>}
        </div>
        <span className="font-semibold tabular-nums">{priceLabel}</span>
      </div>
      {/* Stats row */}
      <div className="flex items-center gap-3 px-2.5 pb-1.5 text-xs">
        {chg != null && (
          <span className={`font-medium ${chgColor}`}>
            {chg >= 0 ? "+" : ""}{chg.toFixed(1)}% YoY
          </span>
        )}
        {capLabel && <span className="text-muted-foreground">Cap {capLabel}</span>}
        {typeof s.peRatio === "number" && <span className="text-muted-foreground">P/E {s.peRatio.toFixed(1)}</span>}
        {s.fiftyTwoWeekHigh != null && s.fiftyTwoWeekLow != null && (
          <span className="text-muted-foreground ml-auto text-[10px]">
            {currencySymbol}{s.fiftyTwoWeekLow.toFixed(0)}–{currencySymbol}{s.fiftyTwoWeekHigh.toFixed(0)} 52w
          </span>
        )}
      </div>
      {/* Price chart */}
      {history.length >= 5 && (
        <div className="px-1 pb-1">
          <MiniPriceChart points={history} height={52} />
          <div className="flex justify-between text-[10px] text-muted-foreground px-1 mt-0.5">
            <span>{history[0]?.date?.slice(5)}</span>
            <span>3 months</span>
            <span>{history[history.length - 1]?.date?.slice(5)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Ticker auto-suggest picker ───────────────────────────────────────────
function TickerSuggestPicker({ companyId, onSelect }: { companyId: string; onSelect: (ticker: string) => void }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{ suggestions: Array<{ symbol: string; shortName: string | null; exchange: string | null }> }>({
    queryKey: ["/api/brand", companyId, "ticker-suggest"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/brand/${companyId}/ticker-suggest`);
      return res.json();
    },
    enabled: open,
    staleTime: 30 * 60 * 1000,
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 underline-offset-2 hover:underline"
      >
        <Search className="w-2.5 h-2.5" /> Find stock ticker
      </button>
    );
  }

  return (
    <div className="rounded border bg-background shadow-sm p-1.5 space-y-0.5">
      <div className="text-[10px] text-muted-foreground px-1 pb-0.5">Select the correct listing:</div>
      {isLoading && <div className="text-xs text-muted-foreground px-1 py-0.5 animate-pulse">Searching Yahoo Finance…</div>}
      {!isLoading && data?.suggestions?.length === 0 && (
        <div className="text-xs text-muted-foreground px-1 italic">No public listings found</div>
      )}
      {data?.suggestions?.map((s) => (
        <button
          key={s.symbol}
          type="button"
          onClick={() => { onSelect(s.symbol); setOpen(false); }}
          className="w-full text-left flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted text-xs"
        >
          <span className="font-mono font-semibold text-primary">{s.symbol}</span>
          <span className="truncate text-muted-foreground flex-1">{s.shortName}</span>
          {s.exchange && <span className="text-[10px] text-muted-foreground shrink-0">{s.exchange}</span>}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[10px] text-muted-foreground hover:text-foreground px-1 pt-0.5"
      >
        Cancel
      </button>
    </div>
  );
}
