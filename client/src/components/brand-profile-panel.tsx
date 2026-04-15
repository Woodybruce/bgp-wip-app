import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  Instagram, Coins, FileText, AlertCircle, Clock,
} from "lucide-react";

interface BrandProfile {
  company: {
    id: string;
    name: string;
    description: string | null;
    company_type: string | null;
    companies_house_number: string | null;
    domain: string | null;
    domain_url: string | null;
    is_tracked_brand: boolean;
    tracking_reason: string | null;
    brand_group_id: string | null;
    concept_pitch: string | null;
    store_count: number | null;
    rollout_status: string | null;
    backers: string | null;
    instagram_handle: string | null;
    agent_type: string | null;
    ai_generated_fields: Record<string, string> | null;
    last_enriched_at: string | null;
    kyc_status: string | null;
    kyc_expires_at: string | null;
    aml_risk_level: string | null;
    aml_pep_status: string | null;
  };
  signals: Array<any>;
  representedBy: Array<any>;
  representing: Array<any>;
  kyc: { doc_count: number; last_uploaded_at: string | null };
  images: Array<any>;
  deals: Array<any>;
  parentGroup: { id: string; name: string; store_count: number | null } | null;
  siblings: Array<any>;
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

function AiChip() {
  return (
    <span title="AI-generated — any edit makes it ground truth" className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 ml-1">
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

  const { data, isLoading } = useQuery<BrandProfile>({
    queryKey: ["/api/brand", companyId, "profile"],
    queryFn: async () => {
      const res = await fetch(`/api/brand/${companyId}/profile`, { credentials: "include" });
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

  // Only render on companies that are brands, agents, or have any brand data.
  // Gives users an easy "promote this company into the Brand Bible" button if not yet flagged.
  const isBrand = c.is_tracked_brand;
  const isAgent = !!c.agent_type;
  const hasData = isBrand || isAgent || c.concept_pitch || c.store_count || c.rollout_status || c.backers
    || data.representedBy.length > 0 || data.representing.length > 0 || data.signals.length > 0;

  if (!hasData && !editing) {
    return (
      <Card data-testid="brand-profile-empty">
        <CardContent className="p-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            No Brand Bible data yet.
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => patchMutation.mutate({ is_tracked_brand: true } as any)}
              disabled={patchMutation.isPending}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Track as brand
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setForm({ agent_type: "tenant_rep" }); setEditing(true); }}
            >
              <Handshake className="w-3.5 h-3.5 mr-1" /> Mark as agent
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

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
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
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

      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="is_tracked_brand" className="text-xs">Track this as a brand in the Brand Bible</Label>
              <Switch
                id="is_tracked_brand"
                checked={!!form.is_tracked_brand}
                onCheckedChange={(v) => setForm({ ...form, is_tracked_brand: v })}
              />
            </div>
            {form.is_tracked_brand && (
              <div>
                <Label className="text-xs">Why are we tracking this brand?</Label>
                <Input value={(form.tracking_reason as string) || ""} onChange={(e) => setForm({ ...form, tracking_reason: e.target.value })} placeholder="e.g. Client Grosvenor asked about them" />
              </div>
            )}
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
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-0.5">
                  <FileText className="w-3 h-3" /> Concept {aiFields.concept_pitch && <AiChip />}
                </div>
                <p className="text-sm leading-snug">{c.concept_pitch}</p>
              </div>
            )}

            {/* Key facts row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              {c.store_count != null && (
                <div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Store className="w-3 h-3" /> Stores {aiFields.store_count && <AiChip />}
                  </div>
                  <div className="font-semibold">{c.store_count.toLocaleString()}</div>
                </div>
              )}
              {c.rollout_status && (
                <div>
                  <div className="text-[11px] text-muted-foreground mb-0.5">Rollout {aiFields.rollout_status && <AiChip />}</div>
                  <RolloutBadge status={c.rollout_status} />
                </div>
              )}
              {c.backers && (
                <div className="col-span-2">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Coins className="w-3 h-3" /> Backers {aiFields.backers && <AiChip />}
                  </div>
                  <div className="text-sm">{c.backers}</div>
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
                            {co.agent_type && <Badge variant="outline" className="text-[9px] ml-auto">{co.agent_type.replace(/_/g, " ")}</Badge>}
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

            {/* KYC tile */}
            {(c.kyc_status || data.kyc.doc_count > 0 || c.aml_risk_level) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-2">
                <ShieldCheck className="w-3 h-3" />
                {c.kyc_status === "approved" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">KYC approved</Badge>}
                {c.kyc_status === "in_review" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">KYC in review</Badge>}
                {c.kyc_status === "rejected" && <Badge variant="destructive" className="text-[10px]">KYC rejected</Badge>}
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
                  {data.signals.slice(0, 5).map((s: any) => (
                    <div key={s.id} className="text-xs flex items-start gap-2 border-l-2 border-muted pl-2">
                      <Badge variant="outline" className="text-[10px] shrink-0">{s.signal_type.replace(/_/g, " ")}</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{s.headline}</p>
                        {s.signal_date && <span className="text-[10px] text-muted-foreground">{new Date(s.signal_date).toLocaleDateString("en-GB")}</span>}
                      </div>
                    </div>
                  ))}
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
