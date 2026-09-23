import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Globe, MapPin, RefreshCw, Search, ShieldCheck, Store } from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BrandPortfolioMap } from "@/components/brand-portfolio-map";

type BrandIdentity = { status?: string; domain?: string | null; verifiedAt?: string };
const domainHost = (value?: string | null) => {
  try { return new URL(/^https?:\/\//i.test(value || "") ? value! : `https://${value || ""}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
};
const shortDate = (value: string | number | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export function BrandPreparationStatus({ companyId, refreshedAt }: { companyId: string; refreshedAt: string | null }) {
  const { data } = useQuery<{
    ready: boolean;
    preparedSections: number;
    totalSections: number;
    contactReviewRequired: boolean;
    factReviewRequired: boolean;
    officialProfileReady?: boolean;
    identity: { status: string; domain?: string; reason?: string };
    stages: Array<{ stage: string; status: string; lastSuccessAt?: string | null; reason?: string; lastError?: string; source?: string | null }>;
  }>({
    queryKey: ["/api/brand", companyId, "preparation"],
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/preparation`)).json(),
    staleTime: 60_000,
    refetchInterval: query => query.state.data?.stages.some(stage => stage.status === "running") ? 10_000 : false,
    retry: false,
  });
  const stages = data?.stages || [];
  const coreStages = stages.filter(stage => stage.stage === "identity" || stage.stage === "profile");
  const needsReview = data?.factReviewRequired || data?.identity?.status === "review" || coreStages.some(stage => stage.status === "needs_review");
  const running = coreStages.some(stage => stage.status === "running");
  const label = data?.officialProfileReady && data.factReviewRequired ? "Official profile prepared" : data?.ready ? "Core facts prepared" : needsReview ? "Core facts need review" : running ? "Preparing core facts" : coreStages.some(stage => ["error", "no_match", "unavailable"].includes(stage.status)) ? "Core preparation needs attention" : "Core preparation pending";
  const stageLabels: Record<string, string> = { identity: "Official identity", profile: "Core facts", apollo: "Company data", rocketreach: "Company match", stores: "Store locations", images: "Brand image", logo: "Brand logo", brief: "BGP action brief", contacts: "Contacts", portfolio: "Portfolio discovery", financials: "Market data" };
  const statusLabels: Record<string, string> = { pending: "Queued", running: "Preparing", ready: "Prepared", no_match: "No match found", error: "Retry needed", needs_review: "Needs review", unavailable: "Unavailable" };
  return (
    <details className="text-[11px] text-muted-foreground" data-testid="brand-preparation-status">
      <summary className="cursor-pointer min-h-11 sm:min-h-0 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{data ? label : "Saved profile"}</span>
        {data?.contactReviewRequired && <span>· Contacts need review</span>}
        {shortDate(refreshedAt) && <span>· {data?.factReviewRequired ? "Research updated" : "Facts refreshed"} {shortDate(refreshedAt)}</span>}
        <span className="underline underline-offset-2">Details</span>
      </summary>
      <div className="mt-2 space-y-1 rounded-md border border-border bg-background p-2 text-xs">
        <p>Saved information opens immediately. The official profile uses the confirmed company identity and sourced facts; other sections show their own progress below.</p>
        {data?.factReviewRequired && <p>{data.officialProfileReady ? "The official profile is prepared and can support a new BGP brief. Older retained description, industry, head office and LinkedIn fields still need a separate review." : "Review the description, industry, head office and LinkedIn kept from the previous identity before relying on those retained fields."}</p>}
        {data && <p><span className="font-mono tabular-nums">{data.preparedSections} of {data.totalSections}</span> automatic sections prepared. Contact review is separate and does not hold up the factual profile.</p>}
        {stages.map(stage => <div key={stage.stage} className="border-t border-border pt-2">
          <p className="flex flex-wrap justify-between gap-x-3"><span>{stageLabels[stage.stage] || stage.stage}</span><span>{stage.stage === "profile" && data?.factReviewRequired ? data.officialProfileReady ? "Official profile prepared · Retained fields need review" : "Facts need review" : statusLabels[stage.status] || "Pending"}{shortDate(stage.lastSuccessAt) ? ` · ${shortDate(stage.lastSuccessAt)}` : ""}{stage.source ? ` · ${stage.source}` : ""}</span></p>
          {(stage.reason || stage.lastError) && <p className="mt-1 break-words">{stage.stage === "contacts" && stage.reason?.includes("before marking this section complete") ? "Linked contacts are available. Check who currently handles property matters before contacting them; background preparation does not verify people." : stage.reason || stage.lastError}</p>}
        </div>)}
        {needsReview && <p>{data?.identity?.status === "review" ? "Confirm the brand’s official website or review its conflicting identity details." : "Open the section details above to see what needs attention. Other sections can continue preparing."}</p>}
      </div>
    </details>
  );
}

function BrandRetainedFactsReview({ companyId, identityVerified }: { companyId: string; identityVerified: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState({ description: "", industry: "", linkedin: "", street: "", city: "", region: "", postcode: "", country: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useQuery<{
    factReview?: { required: boolean; token: string; facts: { description: string | null; industry: string | null; linkedin_url: string | null; head_office_address: any } };
  }>({
    queryKey: ["/api/brand", companyId, "preparation"],
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/preparation`)).json(),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const review = data?.factReview;
  useEffect(() => {
    if (!open || !review) return;
    const facts = review.facts;
    const a = facts.head_office_address;
    const address = a && typeof a === "object" ? a : {};
    const line = typeof a === "string" ? a : address.street || address.line1 || (typeof address.address === "string" ? address.address : address.address?.street || address.address?.line1) || address.formatted || "";
    setDraft({ description: facts.description || "", industry: facts.industry || "", linkedin: facts.linkedin_url || "", street: line,
      city: address.city || "", region: address.region || "", postcode: address.postcode || "", country: address.country || "" });
    setConfirmed(false);
  }, [open, review?.token]);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/brand/${companyId}`, { factReview: {
      token: review?.token, confirmed, description: draft.description, industry: draft.industry, linkedin_url: draft.linkedin,
      head_office_address: { street: draft.street, city: draft.city, region: draft.region, postcode: draft.postcode, country: draft.country },
    } })).json(),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", companyId] });
      toast({ title: "Reviewed facts saved", description: "Your corrections are saved. The BGP brief is queued to use the reviewed profile." });
    },
    onError: (error: Error) => toast({ title: "Facts could not be saved", description: error.message, variant: "destructive" }),
  });
  const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
  return <div className="space-y-3">
    <Button type="button" variant="outline" size="sm" disabled={!identityVerified} onClick={() => setOpen(value => !value)} aria-expanded={open} data-testid="brand-fact-review-toggle">{open ? "Cancel fact review" : "Review retained facts"}</Button>
    {open && (isLoading ? <p className="text-sm text-muted-foreground" role="status">Loading saved facts…</p>
      : isError || !review ? <div className="space-y-2"><p className="text-sm">The facts could not be loaded.</p><Button type="button" variant="outline" size="sm" onClick={() => refetch()}>Try again</Button></div>
        : <form className="space-y-3 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); save.mutate(); }} data-testid="brand-fact-review-form">
          <p className="text-sm text-muted-foreground">Check these retained facts against the official brand. Clear an unconfirmed LinkedIn page or address. Legal and KYC records require their own review.</p>
          <div className="space-y-1"><Label className={labelClass} htmlFor={`review-description-${companyId}`}>Description</Label><Textarea id={`review-description-${companyId}`} required maxLength={4000} value={draft.description} rows={3} onChange={event => setDraft({ ...draft, description: event.target.value })} /></div>
          <div className="space-y-1"><Label className={labelClass} htmlFor={`review-industry-${companyId}`}>Industry</Label><Input id={`review-industry-${companyId}`} required maxLength={300} value={draft.industry} onChange={event => setDraft({ ...draft, industry: event.target.value })} /></div>
          <div className="space-y-1"><Label className={labelClass} htmlFor={`review-linkedin-${companyId}`}>LinkedIn company page · optional</Label><Input id={`review-linkedin-${companyId}`} type="url" maxLength={1000} value={draft.linkedin} placeholder="https://www.linkedin.com/company/…" onChange={event => setDraft({ ...draft, linkedin: event.target.value })} /></div>
          <fieldset className="space-y-2"><legend className={labelClass}>Head office · optional</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{([ ["street", "Address"], ["city", "Town or city"], ["region", "County or region"], ["postcode", "Postcode"], ["country", "Country"] ] as const).map(([field, label]) => <div key={field} className={`space-y-1 ${field === "street" ? "sm:col-span-2" : ""}`}><Label className={labelClass} htmlFor={`review-${field}-${companyId}`}>{label}</Label><Input id={`review-${field}-${companyId}`} maxLength={500} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></div>)}</div>
          </fieldset>
          <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={save.isPending} />I have checked these facts against the confirmed brand.</label>
          <div className="flex justify-end"><Button type="submit" size="sm" disabled={!confirmed || !draft.description.trim() || !draft.industry.trim() || save.isPending}>{save.isPending ? "Saving…" : "Save reviewed facts"}</Button></div>
        </form>)}
  </div>;
}

export function BrandIdentityControl({ companyId, domain, identity, savedAliases = [], previousFactsNeedReview, canConfirm, suggestedDomain }: {
  companyId: string; domain: string | null; identity?: BrandIdentity | null; savedAliases?: string[]; previousFactsNeedReview?: boolean; canConfirm: boolean;
  suggestedDomain?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const suggestion = !domain && suggestedDomain ? suggestedDomain : null;
  const [draft, setDraft] = useState(domain || suggestion || "");
  const aliasesText = (Array.isArray(savedAliases) ? savedAliases : []).filter(name => typeof name === "string").join("\n");
  const [draftAliases, setDraftAliases] = useState(aliasesText);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => { setDraft(domain || suggestion || ""); setDraftAliases(aliasesText); setOpen(false); }, [companyId, domain, suggestion, aliasesText]);
  const verified = identity?.status === "verified" && !!domainHost(domain) && domainHost(identity.domain) === domainHost(domain);
  const confirm = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/brand/${companyId}/identity`, { domain: draft.trim(),
      ...(draftAliases !== aliasesText ? { aliases: draftAliases.split(/\r?\n/).map(name => name.trim()).filter(Boolean) } : {}) })).json(),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", companyId] });
      toast({ title: "Official website confirmed", description: "Automated information will be checked against this brand." });
    },
    onError: (error: Error) => toast({ title: "Website could not be confirmed", description: error.message, variant: "destructive" }),
  });
  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-2" data-testid="brand-identity-control">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 text-sm">
          {verified ? <ShieldCheck className="w-4 h-4 shrink-0 text-primary" /> : <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <span>{verified ? "Official website confirmed" : "Official website needs confirmation"}</span>
        </div>
        {canConfirm && <Button type="button" size="sm" variant="outline" onClick={() => setOpen(value => !value)} aria-expanded={open}>
          {open ? "Cancel" : verified ? "Review website" : "Confirm official website"}
        </Button>}
      </div>
      {!verified && <p className="text-xs text-muted-foreground">Company information from outside sources is held for review until the brand’s identity is confirmed.</p>}
      {!verified && suggestion && <p className="text-xs text-muted-foreground" data-testid="brand-website-suggestion">Likely website found: <span className="font-medium text-foreground">{suggestion}</span>{canConfirm ? " — check it and confirm." : "."}</p>}
      {previousFactsNeedReview && <p className="text-xs text-muted-foreground">Previously recorded facts have been kept and still need review.</p>}
      {previousFactsNeedReview && canConfirm && <BrandRetainedFactsReview key={companyId} companyId={companyId} identityVerified={verified} />}
      {open && <form className="space-y-2 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); confirm.mutate(); }}>
        <Label htmlFor={`official-brand-website-${companyId}`} className="text-[11px] uppercase tracking-wider text-muted-foreground">Brand’s official website</Label>
        <Input id={`official-brand-website-${companyId}`} value={draft} onChange={event => setDraft(event.target.value)} placeholder="brand.co.uk" autoComplete="url" />
        <Label htmlFor={`official-brand-names-${companyId}`} className="text-[11px] uppercase tracking-wider text-muted-foreground">Trading or legal names · optional</Label>
        <Textarea id={`official-brand-names-${companyId}`} value={draftAliases} onChange={event => setDraftAliases(event.target.value)} placeholder="One approved name per line" rows={3} />
        <p className="text-xs text-muted-foreground">Add a different name only when it belongs to the same brand, such as its legal trading company.</p>
        <p className="text-xs text-muted-foreground">Use the brand’s own website. Changing this identity retires automated information from the previous match; staff-entered facts are kept.</p>
        <Button type="submit" size="sm" disabled={!draft.trim() || confirm.isPending}><Check className="w-4 h-4" />{confirm.isPending ? "Confirming…" : "Confirm website"}</Button>
      </form>}
    </div>
  );
}

export type OverviewStore = {
  id: string; name: string; address: unknown; lat: number | null; lng: number | null;
  country?: string | null; researched_at?: string | null; source_type?: string | null; status?: string | null;
};
const storeAddress = (value: unknown) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const address = value as Record<string, unknown>;
  return [address.street, address.city, address.postcode, address.country].filter(Boolean).join(", ");
};
export function BrandStoresBoard({ companyId, stores, reportedTotal, canRefresh, refreshing, diagnostic, onRefresh }: {
  companyId: string; stores: OverviewStore[]; reportedTotal: number | null; canRefresh: boolean; refreshing: boolean;
  diagnostic: string | null; onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => { setSearch(""); setPage(0); }, [companyId]);
  const locations = useMemo(() => stores.filter(store => !store.country || store.country === "GB")
    .sort((a, b) => storeAddress(a.address).localeCompare(storeAddress(b.address)) || a.name.localeCompare(b.name)), [stores]);
  const filtered = useMemo(() => locations.filter(store => `${store.name} ${storeAddress(store.address)}`.toLowerCase().includes(search.trim().toLowerCase())), [locations, search]);
  const pageSize = 8;
  const maxPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, maxPage);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const mapped = locations.filter(store => typeof store.lat === "number" && Number.isFinite(store.lat) && typeof store.lng === "number" && Number.isFinite(store.lng));
  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-3" data-testid="brand-stores-board">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Store className="w-4 h-4" />Store locations</h3>
          <p className="text-sm mt-1"><span className="font-mono tabular-nums">{locations.length}</span> saved · <span className="font-mono tabular-nums">{mapped.length}</span> mapped{reportedTotal != null ? <> · <span className="font-mono tabular-nums">{reportedTotal.toLocaleString()}</span> reported total</> : null}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{locations.filter(store => store.country === "GB").length} UK locations{locations.some(store => !store.country) ? ` · ${locations.filter(store => !store.country).length} countries unconfirmed` : ""}. The reported total may cover a wider footprint.</p>
        </div>
        {canRefresh && <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={onRefresh} data-testid="btn-research-stores-uk"><RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "Refreshing…" : "Refresh stores"}</Button>}
      </div>
      {locations.length ? <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] gap-3">
        <BrandPortfolioMap stores={filtered as any} height={360} />
        <div className="space-y-3 min-w-0">
          <div className="relative"><Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search store locations" placeholder="Find a town, store or postcode" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {visible.map(store => <div key={store.id} className="rounded-lg border border-border p-2.5 text-sm">
              <p className="font-medium break-words">{store.name}</p>
              {store.status === "closed" && <p className="text-xs text-muted-foreground">Closed</p>}
              <p className="text-[11px] text-muted-foreground mt-1 break-words">{storeAddress(store.address) || "Address not recorded"}</p>
              {store.lat != null && store.lng != null && <a className="inline-flex items-center gap-1 text-[11px] text-primary mt-1" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.lat},${store.lng}`)}`} target="_blank" rel="noreferrer"><MapPin className="w-3 h-3" />Open location</a>}
            </div>)}
            {!filtered.length && <p className="text-sm text-muted-foreground">No saved locations match that search.</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground font-mono tabular-nums">{filtered.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)} of ${filtered.length}` : "0 results"}</span>
            <div className="flex gap-1"><Button type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
          </div>
        </div>
      </div> : <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4">{refreshing ? "Preparing store locations…" : "No store locations have been prepared yet."}{diagnostic && <span className="block mt-1">{diagnostic}</span>}</p>}
    </section>
  );
}

export function BrandImageRefreshButton({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const requestedCompany = useRef<string | null>(null);
  const handledCompletion = useRef("");
  type ImageJob = { companyId: string; state: "running" | "done" | "error" | "idle"; error?: string; startedAt?: number; finishedAt?: number; result?: { imported?: number; skipped?: string | boolean; reason?: string } };
  const queryKey = ["/api/brand", companyId, "refresh-images", "status"];
  const statusQuery = useQuery<ImageJob>({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/brand/${companyId}/refresh-images/status`, { credentials: "include", headers: getAuthHeaders(), signal });
      if (!response.ok) throw new Error("Image progress could not be checked. Please try again.");
      const status = await response.json();
      const previous = queryClient.getQueryData<ImageJob>(queryKey);
      if (status.state === "idle" && previous?.companyId === companyId) {
        if (previous.state === "running") return { companyId, state: "error" as const, error: "The image search stopped before reporting a result. Please try again." };
        if (previous.state === "done" || previous.state === "error") return previous;
      }
      return { ...status, companyId };
    },
    staleTime: 5_000,
    refetchOnMount: "always",
    retry: false,
    refetchInterval: query => query.state.status !== "error" && query.state.data?.state === "running" ? 5_000 : false,
  });
  const refresh = useMutation({
    onMutate: async (targetCompanyId: string) => {
      requestedCompany.current = targetCompanyId;
      const targetKey = ["/api/brand", targetCompanyId, "refresh-images", "status"];
      await queryClient.cancelQueries({ queryKey: targetKey });
      queryClient.setQueryData(targetKey, { companyId: targetCompanyId, state: "running", startedAt: Date.now() });
    },
    mutationFn: async (targetCompanyId: string) => (await apiRequest("POST", `/api/brand/${targetCompanyId}/refresh-images`, { force: true })).json(),
    onSuccess: (_out, targetCompanyId) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/brand", targetCompanyId, "refresh-images", "status"] });
    },
    onError: (error: Error, targetCompanyId) => {
      queryClient.setQueryData(["/api/brand", targetCompanyId, "refresh-images", "status"], { companyId: targetCompanyId, state: "error", error: error.message || "Image refresh failed" });
    },
  });
  const status = statusQuery.data?.companyId === companyId ? statusQuery.data : undefined;
  useEffect(() => {
    if (!status || status.state === "idle") return;
    if (status.state === "running") { handledCompletion.current = ""; return; }
    const completion = JSON.stringify(status);
    if (handledCompletion.current === completion) return;
    handledCompletion.current = completion;
    void queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "preparation"] });
    if (requestedCompany.current === companyId) {
      requestedCompany.current = null;
      toast(status.state === "done" ? brandImageRefreshFeedback(status.result || {}) : { title: "Images could not be refreshed", description: status.error || "Image refresh failed", variant: "destructive" });
    }
  }, [companyId, queryClient, status, toast]);
  const busy = (refresh.isPending && refresh.variables === companyId) || (!statusQuery.isError && status?.state === "running");
  const feedback = statusQuery.isError ? { title: "Image progress unavailable", description: (statusQuery.error as Error).message }
    : status?.state === "done" ? brandImageRefreshFeedback(status.result || {})
    : status?.state === "error" ? { title: "Images could not be refreshed", description: status.error || "Image refresh failed" }
    : status?.state === "running" ? { title: "Searching for suitable photos", description: "You can leave this page and return to check the result." } : null;
  return <div className="min-w-0 space-y-2">
    <Button type="button" variant="outline" size="sm" onClick={() => refresh.mutate(companyId)} disabled={busy} data-testid="button-brand-refresh-images"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Refreshing images…" : "Refresh images"}</Button>
    {feedback && <p role="status" aria-live="polite" className="max-w-prose text-[11px] text-muted-foreground break-words" data-testid="brand-image-refresh-status"><span className="font-semibold">{feedback.title}.</span> {feedback.description}</p>}
  </div>;
}

export function brandImageRefreshFeedback(result: { imported?: number; skipped?: string | boolean; reason?: string }) {
  const imported = Number(result.imported) || 0;
  const detail = result.reason || (typeof result.skipped === "string" ? result.skipped : "");
  return imported > 0
    ? { title: "Photos added", description: `${imported} new photo${imported === 1 ? "" : "s"} added.${detail ? ` ${detail}` : ""}` }
    : { title: "No new photos added", description: detail || "No suitable new photos were found. Your saved images have been kept." };
}
