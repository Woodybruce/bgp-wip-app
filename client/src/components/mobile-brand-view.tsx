import { formatSizeList } from "@/lib/format-size";
import { aboutText } from "@/lib/about-text";
import { isOwnChannelNews, newsSourceLabel, splitNewsTitle, isOwnBrandSource, dedupeNearNews, ukDate, sentenceCaseShouting, aboutParagraphs, isSocialNews, snippetPublisher, urlPublisher, isSignalNoise, signalKind, accountBoardContacts, propertyUnitText, trackerUnitLabel, displayStoreName } from "@/components/brand-profile-panel";
import { BrandViewingActivity } from "@/components/brand-viewing-activity";
import { BrandFeedCard } from "@/components/brand-feed-card";
import { useBrandProfileRefresh } from "@/hooks/use-brand-profile-refresh";
import { CompanyProfileImage, dedupeGalleryImages } from "@/components/company-profile-image";
import { useState, useEffect, useRef } from "react";
import { BrandIdentityControl, BrandPreparationStatus, BrandStoresBoard, BrandImageRefreshButton } from "@/components/brand-profile-overview";
import { Button } from "@/components/ui/button";
// Phone-fit brand / landlord profile — the mobile answer to the desktop
// BrandProfilePanel, which rendered effectively blank at phone widths
// (Woody, 2026-08-04: "how the brands reflect" on the phone app). Stacked
// cards reusing the canonical components: chat, contacts board, covenant,
// compliance, menu, portfolio activity — so the phone shows the SAME
// intelligence as desktop, one structure everywhere.
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { getAuthHeaders, apiRequest, queryClient } from "@/lib/queryClient";
import { isLandlordCompany } from "@/lib/company-kind";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill, pillMetrics, pillInactive } from "@/components/ui/pill";
import { AgentRelationshipCard } from "@/components/agent-relationship-card";
import { CompanyPropertiesBoard } from "@/components/CompanyPropertiesBoard";
import { AccountDealsBoard } from "@/components/account-deals-board";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, TrendingUp, ClipboardList, Instagram, Store, Swords, ExternalLink, Globe, Newspaper, RefreshCw } from "lucide-react";
import {
  CompanyMiniChat, MenuIntelCard, PortfolioActivityBlock, BrandComplianceCard,
  askTopics, PipnetRequirementsRow, StockSnapshotCard, ApolloDetailChips,
} from "@/components/brand-profile-panel";
import { BgpTakeStrip } from "@/components/bgp-take-strip";
import { CompanyContactsBoard } from "@/components/company-contacts-board";
import { CovenantBadge, CovenantCommentary, useCovenantReport } from "@/components/covenant-badge";
import { ActivitySummary } from "@/components/activity-summary";
import { useAccountWorkspace } from "@/components/account-workspace-cards";

// `embedded`: inside a deal's Brand tab, which has its own KYC tab — no
// second Compliance pill there (Woody, 2026-09-28).
export function MobileBrandView({ companyId, embedded = false, lenderSlot }: { companyId: string; embedded?: boolean; lenderSlot?: React.ReactNode }) {
  const { data, isLoading, isError, refetch: reloadSavedProfile } = useQuery<any>({
    queryKey: ["/api/brand", companyId, "profile"],
    queryFn: async () => {
      const res = await fetch(`/api/brand/${companyId}/profile`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const { data: trackerData } = useQuery<any>({
    queryKey: ["/api/brands", companyId, "tracker-comments"],
    queryFn: async () => {
      const res = await fetch(`/api/brands/${companyId}/tracker-comments`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return { comments: [] };
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  // Phone section switcher (docs/DESIGN.md §16) — this view is phone-only
  // and ran 8+ boards deep in one scroll. Hook sits above the early return.
  const [section, setSection] = useState<"chat" | "portfolio" | "lending" | "contacts" | "intel" | "stores" | "social" | "compliance">("chat");
  const [signalsShowAll, setSignalsShowAll] = useState(false);
  const [newsShowAllM, setNewsShowAllM] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  useEffect(() => setConversationOpen(false), [companyId]);
  const sec = (k: typeof section) => (section === k ? "space-y-3" : "hidden");
  const { toast } = useToast();
  const { data: mbvUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientViewer = !mbvUser || mbvUser.role === "Client" || !!mbvUser.companyScopeId;
  // Clients come here for "who are they / who do I call" — land them on
  // Contacts; Chat reads as an internal BGP tool (UX #95/#75). Staff keep
  // Chat-first. One-shot when the user row arrives, so pill taps stick.
  const clientLanded = useRef(false);
  useEffect(() => {
    if (clientLanded.current || !mbvUser) return;
    clientLanded.current = true;
    if (isClientViewer) setSection("contacts");
  }, [mbvUser, isClientViewer]);
  // Same research trigger as the desktop Stores section — POST kicks the
  // background job, then poll /status until done (big brands take minutes).
  const storeScan = useMutation({
    mutationFn: async (_vars?: { auto?: boolean }) => {
      const res = await apiRequest("POST", `/api/brand/${companyId}/research-stores`, { scope: "uk" });
      if (!res.ok && res.status !== 202) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `HTTP ${res.status}`);
      }
      const started = Date.now();
      return await new Promise<any>((resolve, reject) => {
        const poll = async () => {
          if (Date.now() - started > 5 * 60_000) return reject(new Error("Store research is taking longer than 5 minutes — try again in a moment"));
          try {
            const st = await fetch(`/api/brand/${companyId}/research-stores/status?scope=uk`, { headers: getAuthHeaders(), credentials: "include" });
            if (st.ok) {
              const j = await st.json();
              if (j.state === "done") return resolve(j.result || {});
              if (j.state === "error") return reject(new Error(j.error || "Store research failed"));
            }
          } catch {}
          setTimeout(poll, 5000);
        };
        setTimeout(poll, 5000);
      });
    },
    onSuccess: (out: any, vars: any) => {
      // UX #152 — auto-fired background scans don't toast.
      if (!vars?.auto) toast({ title: "Store search complete", description: out?.found ? `${out.found} stores found` : "0 stores found" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any, vars: any) => {
      if (!vars?.auto) toast({ title: "Store search failed", description: e.message, variant: "destructive" });
    },
  });
  // Expansion score — same endpoint as desktop's Expansion intelligence.
  const { data: hunter } = useQuery<any>({
    queryKey: ["/api/brand", companyId, "hunter-score"],
    queryFn: async () => {
      const r = await fetch(`/api/brand/${companyId}/hunter-score`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const refreshProfile = useBrandProfileRefresh(companyId, !isClientViewer);
  // Same contact source as the desktop landlord board (Woody, 2026-09-28).
  const accountWorkspace = useAccountWorkspace(data?.company && isLandlordCompany(data.company.company_type, data.isLandlord) ? companyId : undefined)?.data;
  const covenantReport = useCovenantReport(data?.company?.companies_house_number);

  if (isError) return <Card className="p-4 space-y-3"><p className="text-sm text-muted-foreground">The saved brand profile could not be loaded.</p><Button size="sm" variant="outline" onClick={() => reloadSavedProfile()}>Try again</Button></Card>;
  if (isLoading || !data?.company) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const c = data.company;
  // Same shared rule as the desktop panel (server flag first, type heuristic
  // fallback) — mobile used its own /landlord|client/i regex and disagreed
  // with desktop for investor/developer/reit/fund types.
  const isLandlord = isLandlordCompany(c.company_type, (data as any).isLandlord);
  const trackerComments: any[] = trackerData?.comments || [];

  // Same dedupe as the desktop Signals feed — Instagram + Google News often
  // land the same story twice; first occurrence (newest) wins.
  const signals: any[] = (() => {
    const seen = new Set<string>();
    const norm = (h: string) => (h || "").toLowerCase().replace(/[^a-z0-9£$ ]+/g, " ").replace(/\s+/g, " ").trim();
    return ((data.signals || []) as any[]).filter(s => {
      if (isSignalNoise(s)) return false;
      const n = norm(s.headline);
      if (!n || seen.has(n)) return !n;
      seen.add(n);
      return true;
    });
  })();
  const similarTenants: any[] = (data.competitors || []).slice(0, 8);
  const similarNames = new Set(similarTenants.map((t: any) => String(t.name).toLowerCase().trim()));
  const aiCompetitors: any[] = ((c.ai_competitors as any[]) || []).filter(
    (comp: any) => !similarNames.has(String(comp.name).toLowerCase().trim())
  );

  // Agent firms get the brand shell but none of the brand-only parts (stores,
  // social, covenant chip) — Savills showed "43 reported stores".
  const isAgentFirm = !isLandlord && (/^agent/i.test(c.company_type || "") || !!c.agent_type);
  // Lenders: the shell's sections plus a Lending one; no stores / social.
  const isLender = !!lenderSlot;
  return (
    <div className="p-4 space-y-3 pb-6">
      {/* Hero + identity */}
      <CompanyProfileImage companyId={companyId} companyName={c.name} companyType={c.company_type} images={dedupeGalleryImages(data.images || [])} />
      <div className="flex flex-wrap items-center gap-2">
        {/* With an industry chip the type keeps only its kind ("Tenant") —
            "Tenant · Restaurant" beside "Casual dining restaurant" said it
            twice (Woody, 2026-09-28). */}
        {c.company_type && <Pill className="max-w-full"><span className="truncate">{c.industry ? String(c.company_type).split(/\s*-\s*/)[0] : String(c.company_type).replace(/\s*-\s*/g, " · ")}</span></Pill>}
        {c.industry && <Pill className="max-w-full"><span className="truncate">{c.industry}</span></Pill>}
        {!isLandlord && !isAgentFirm && !isLender && c.store_count != null && <Pill><span className="font-mono tabular-nums">{c.store_count}</span> reported stores</Pill>}
        {!isAgentFirm && (c as any).companies_house_number && <CovenantBadge companyNumber={(c as any).companies_house_number} />}
      </div>
      {/* Status and refresh on one quiet line — a full-width button above the
          tabs pushed the content down the phone (Woody, 2026-09-27). */}
      <div className="flex items-center justify-between gap-2">
        <BrandPreparationStatus companyId={companyId} refreshedAt={c.last_enriched_at} />
        {!isClientViewer && <Button variant="ghost" size="sm" className="h-8 px-2 text-xs shrink-0" onClick={() => refreshProfile.mutate()} disabled={refreshProfile.isPending} data-testid="button-brand-refresh"><RefreshCw className={`w-3.5 h-3.5 mr-1 ${refreshProfile.isPending ? "animate-spin" : ""}`} />{refreshProfile.isPending ? "Refreshing…" : "Refresh"}</Button>}
      </div>
      {/* Success commentary is dropped (Woody, 2026-09-23 — "we don't need the commentary"); progress and problems still show. */}
        {!isClientViewer && refreshProfile.message && !/^Profile (refreshed|checked)\./.test(refreshProfile.message) && <p role="status" aria-live="polite" className="text-sm text-muted-foreground" data-testid="brand-profile-refresh-status">{refreshProfile.message}</p>}
      <div className="flex flex-wrap gap-1.5" data-testid="company-phone-sections">
        <Pill active={section === "chat"} onClick={() => setSection("chat")} data-testid="company-section-chat">Overview</Pill>
        {/* Landlords: their properties and deals lead the desktop page and
            were missing on the phone. */}
        {isLandlord && !isLender && <Pill active={section === "portfolio"} onClick={() => setSection("portfolio")} data-testid="company-section-portfolio">Portfolio</Pill>}
        {isLender && <Pill active={section === "lending"} onClick={() => setSection("lending")} data-testid="company-section-lending">Lending</Pill>}
        <Pill active={section === "contacts"} onClick={() => setSection("contacts")} data-testid="company-section-contacts">Contacts</Pill>
        <Pill active={section === "intel"} onClick={() => setSection("intel")} data-testid="company-section-intel">Intel</Pill>
        {!isLandlord && !isAgentFirm && !isLender && <Pill active={section === "stores"} onClick={() => setSection("stores")} data-testid="company-section-stores">Stores</Pill>}
        {!isLandlord && !isAgentFirm && !isLender && <Pill active={section === "social"} onClick={() => setSection("social")} data-testid="company-section-social">Social</Pill>}
        {/* Agents have no KYC panel on desktop either; a deal's Brand tab has
            the deal's own KYC tab (Woody, 2026-09-28). */}
        {!isAgentFirm && !embedded && <Pill active={section === "compliance"} onClick={() => setSection("compliance")} data-testid="company-section-compliance">Compliance</Pill>}
      </div>

      <div className={sec("chat")}>
      {/* One website line: the identity line plus an open-site icon — a
          separate Website button repeated it (Woody, 2026-09-28). */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><BrandIdentityControl companyId={companyId} domain={c.domain || c.domain_url} identity={data.identity} savedAliases={c.ai_generated_fields?.brand_identity?.aliases} previousFactsNeedReview={c.ai_generated_fields?.brand_identity?.previousFactsNeedReview} canConfirm={!isClientViewer} suggestedDomain={c.ai_generated_fields?.website_suggestion?.domain} /></div>
        {(c.domain_url || c.domain) && (
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" asChild>
            <a href={(c.domain_url || `https://${c.domain}`).startsWith("http") ? (c.domain_url || `https://${c.domain}`) : `https://${c.domain_url || c.domain}`} target="_blank" rel="noreferrer" aria-label={`Open ${c.name} website`}>
              <Globe className="w-4 h-4" />
            </a>
          </Button>
        )}
      </div>
      {/* Image search is a staff tool for brands — agent firms and
          landlords showed it too (Woody, 2026-09-27). */}
      {!isClientViewer && !isAgentFirm && !isLandlord && !isLender && <BrandImageRefreshButton companyId={companyId} />}
      {aboutText(c.description) && <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">About {c.name}</h3>
        {/* First paragraph clamped on its own; the rest only when expanded. */}
        {(() => {
          const { summary, notes } = aboutParagraphs(c.description, c.store_count);
          const clamped = !aboutOpen && aboutText(c.description).length > 220;
          return <>
            {(clamped ? summary.slice(0, 1) : summary).map((para, i) => (
              <p key={i} className={`text-sm leading-relaxed whitespace-pre-line ${clamped ? "line-clamp-5" : ""}`}>{para}</p>
            ))}
            {!clamped && notes.map((n, i) => (
              <p key={`note-${i}`} className="text-[11px] leading-snug text-muted-foreground line-clamp-4"><span className="font-medium">Source note · {n.label}</span> — {n.text}</p>
            ))}
          </>;
        })()}
        {aboutText(c.description).length > 220 && <button type="button" onClick={() => setAboutOpen(v => !v)} className="text-xs text-primary hover:underline">{aboutOpen ? "Show less" : "Read more"}</button>}
      </div>}
      {/* Landlords and agent firms have no BGP take on desktop either. */}
      {!isLandlord && !isAgentFirm && !isLender && <BgpTakeStrip companyId={companyId} tab="brand" hideWhenEmpty />}
      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <Button variant="outline" size="sm" onClick={() => setConversationOpen(value => !value)} aria-expanded={conversationOpen} data-testid="button-brand-conversation">{conversationOpen ? "Close conversation" : "Open conversation"}</Button>
        {conversationOpen && <div className="h-96"><CompanyMiniChat companyId={companyId} companyName={c.name} fill starters={askTopics(c.name, isLandlord, isAgentFirm, isLender)} /></div>}
      </div>
      </div>

      {isLandlord && !isLender && section === "portfolio" && <div className="space-y-3" data-testid="company-phone-portfolio">
        <CompanyPropertiesBoard companyId={companyId} kind="landlord" tabbed />
        <AccountDealsBoard companyId={companyId} />
      </div>}
      {isLender && <div className={sec("lending")} data-testid="company-phone-lending">{lenderSlot}</div>}

      <div className={sec("contacts")}>
      {/* Agent firms: who they are to BGP and who they act for — desktop's
          two agent boards were missing on the phone. */}
      {isAgentFirm && !isClientViewer && <AgentRelationshipCard companyId={companyId} />}
      {isAgentFirm && (data.representing || []).length > 0 && (
        <Card data-testid="company-phone-representing">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Currently representing <span className="font-mono tabular-nums normal-case tracking-normal">{data.representing.length}</span></CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 flex flex-wrap gap-1.5">
            {data.representing.slice(0, 12).map((r: any) => (
              <Link key={r.id} href={`/companies/${r.brand_company_id}`} className={`${pillMetrics} ${pillInactive} normal-case tracking-normal text-foreground`}>{r.brand_name}</Link>
            ))}
            {data.representing.length > 12 && <span className="text-[11px] text-muted-foreground self-center">+{data.representing.length - 12} more</span>}
          </CardContent>
        </Card>
      )}
      {(data.representedBy || []).length > 0 && (
        <Card data-testid="company-phone-represented-by">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Represented by</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {data.representedBy.map((representation: any) => (
              <div key={representation.id} className="rounded-lg border border-border px-3 pt-2.5 pb-1 space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill>{String(representation.agent_type || "Agent").replace(/_/g, " ")}</Pill>
                  {representation.region && <span className="text-[11px] text-muted-foreground break-words">{String(representation.region).replace(/_/g, " ")}</span>}
                </div>
                {/* Person and firm on one line (two 44px link rows left a
                    tall, mostly empty card). */}
                <div className="flex flex-wrap items-center gap-x-2 min-w-0">
                {representation.contact_name && (representation.primary_contact_id
                  ? <Link href={`/contacts/${representation.primary_contact_id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary break-words hover:underline">{representation.contact_name}</Link>
                  : <span className="text-sm font-semibold break-words">{representation.contact_name}</span>)}
                {representation.contact_name && <span className="text-muted-foreground" aria-hidden="true">·</span>}
                {representation.agent_company_id && representation.agent_name
                  ? <Link href={`/companies/${representation.agent_company_id}`} className="inline-flex min-h-11 items-center text-sm text-primary break-words hover:underline">{representation.agent_name}</Link>
                  : <span className="text-[11px] text-muted-foreground">Firm unconfirmed</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {/* Key contacts — canonical board */}
      <CompanyContactsBoard
        companyId={companyId}
        companyName={c.name}
        contacts={isLandlord && accountWorkspace ? accountBoardContacts(accountWorkspace) : data.contacts || []}
        pendingSenders={data.pendingContactSuggestions || []}
        isLandlord={isLandlord}
      />

      {/* BGP engagement — how much history the firm has with this brand
          (Woody, 2026-08-25: "missing the summary of engagement"). */}
      {data.bgpSummary && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <ClipboardList className="w-3.5 h-3.5" /> BGP engagement
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Deals</div>
                <div className="text-sm font-mono tabular-nums">{data.bgpSummary.totalDeals}</div>
                {data.bgpSummary.completedDeals ? <div className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{data.bgpSummary.completedDeals}</span> done</div> : null}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Touches</div>
                <div className="text-sm font-mono tabular-nums">{data.bgpSummary.interactionsTotal}</div>
                <div className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{data.bgpSummary.interactionsLast90d}</span> in 90 days</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Last touch</div>
                <div className="text-sm font-mono tabular-nums">{data.bgpSummary.lastInteractionAt ? ukDate(data.bgpSummary.lastInteractionAt, { day: "numeric", month: "short" }) : "—"}</div>
              </div>
            </div>
            {(data.bgpSummary.team || []).length > 0 && (
              <div className="text-[11px] text-muted-foreground truncate">BGP side: {data.bgpSummary.team.slice(0, 4).join(", ")}</div>
            )}
            {/* The activity feed is staff-only for brands that aren't the
                viewer's own company — the API 403s otherwise (r377). */}
            {(!isClientViewer || mbvUser?.companyScopeId === companyId) && (
              <div className="max-h-[300px] overflow-y-auto pr-1">
                <ActivitySummary companyId={companyId} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>

      <div className={sec("compliance")}>
      {/* Covenant — tenants only; an agent firm's lease covenant means nothing. */}
      {/* A CH number with no grade yet was a bare "COVENANT" heading —
          skeleton while it loads, then only a card with a grade
          (Woody, 2026-09-28). */}
      {!isAgentFirm && (c as any).companies_house_number && covenantReport.isLoading && <Skeleton className="h-24 w-full rounded-xl" />}
      {!isAgentFirm && !((c as any).companies_house_number && !covenantReport.data?.grade) && <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            Covenant
            {(c as any).companies_house_number && <CovenantBadge companyNumber={(c as any).companies_house_number} />}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {(c as any).companies_house_number ? (
            <div className="max-h-[260px] overflow-y-auto pr-1">
              <CovenantCommentary companyNumber={(c as any).companies_house_number} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Waiting for the UK trading entity — the covenant engine unlocks once a Companies House match is set.
            </p>
          )}
        </CardContent>
      </Card>}

      {/* Compliance & KYC — same board as desktop (staff actions hide for clients inside) */}
      <BrandComplianceCard companyId={companyId} company={c} />
      </div>

      <div className={sec("intel")}>

      {/* Tracker comments */}
      {trackerComments.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <ClipboardList className="w-3.5 h-3.5" /> Tracker updates
              <span className="font-mono tabular-nums normal-case tracking-normal">{trackerComments.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1.5 max-h-[300px] overflow-y-auto">
            {trackerComments.map((cm: any, i: number) => (
              <div key={i} className="text-xs rounded-lg border border-border/50 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                  <span className="font-medium text-foreground/80">{cm.userName}</span>
                  {cm.at && <span>{ukDate(cm.at)}</span>}
                </div>
                <p className="whitespace-pre-wrap break-words">{cm.text}</p>
                <Link href={`/properties/${cm.propertyId}`} className="text-[11px] text-primary hover:underline">
                  {propertyUnitText(cm.propertyName, trackerUnitLabel(cm))}
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/^tenant(?:\s|-|$)/i.test(c.company_type || "") && <BrandViewingActivity companyId={companyId} />}
      {/* Expansion — score, live requirements, Pipnet asks (phone twin of
          desktop's Expansion intelligence zone). */}
      {!isLandlord && !isAgentFirm && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5" /> Expansion
              {hunter?.expansionScore != null && (
                <Badge variant="outline" className={`text-[11px] font-mono tabular-nums ${
                  hunter.expansionScore >= 30 ? "bg-orange-50 text-orange-700 border-orange-200" :
                  hunter.expansionScore >= 20 ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-zinc-50 text-zinc-600 border-zinc-200"}`}>
                  {hunter.expansionScore}/100
                </Badge>
              )}
              {!isLandlord && !isAgentFirm && !isLender && c.rollout_status && <Badge variant="outline" className="text-[11px]">{String(c.rollout_status).replace(/_/g, " ")}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {hunter?.subScores && (
              <div className="grid grid-cols-4 gap-1 text-center">
                {[["UK momentum", hunter.subScores.ukMomentum], ["Capacity", hunter.subScores.capacity], ["Intent", hunter.subScores.intent], ["Engagement", hunter.subScores.engagement]].map(([label, v]: any) => (
                  <div key={label} className="rounded border border-border/60 px-1 py-1">
                    <div className="text-sm font-mono tabular-nums">{v ?? "—"}</div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground leading-tight">{label}</div>
                  </div>
                ))}
              </div>
            )}
            {(data.requirements || []).length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live requirements</div>
                {(data.requirements || []).slice(0, 5).map((r: any) => (
                  <div key={r.id} className={`text-xs border-l-2 pl-2 ${String(r.status || "").toLowerCase() === "active" ? "border-l-emerald-400" : "border-l-muted"}`}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {r.status && <Badge variant="outline" className="text-[11px]">{r.status}</Badge>}
                      {(r.size || []).length > 0 && <span className="font-mono tabular-nums text-[11px]">{formatSizeList(r.size)}</span>}
                    </div>
                    {(r.requirement_locations || []).length > 0 && (
                      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{r.requirement_locations.join(", ")}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">No live requirements on our books.</p>
            )}
            <PipnetRequirementsRow companyId={companyId} brandName={c.name} isClient={isClientViewer} />
          </CardContent>
        </Card>
      )}

      {/* Key facts — rollout, backers, franchise, dept stores + stock/momentum */}
      {!isLandlord && (c.backers || c.franchise_activity || c.dept_store_presence || c.stock_ticker) && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <ClipboardList className="w-3.5 h-3.5" /> Key facts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1.5">
            {!isLandlord && <div className="flex flex-wrap gap-x-3"><ApolloDetailChips companyId={companyId} /></div>}
            {c.backers && <div className="text-xs"><span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1.5">Backers</span>{c.backers}</div>}
            {c.franchise_activity && <div className="text-xs"><span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1.5">Franchise</span>{c.franchise_activity}</div>}
            {c.dept_store_presence && <div className="text-xs"><span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1.5">Dept stores</span>{c.dept_store_presence}</div>}
            {c.stock_ticker && <StockSnapshotCard companyId={companyId} ticker={c.stock_ticker} />}
          </CardContent>
        </Card>
      )}

      {/* Portfolio activity — tenant at / targeted / pitched / suggested */}
      {!isAgentFirm && <PortfolioActivityBlock companyId={companyId} liveTenancies={(data as any).liveLocations || []} />}

      {/* Signals — phone twin of the desktop feed: semantic type pill +
          mono date on a meta row, clamped headline underneath, sentiment
          as the left border (docs/DESIGN.md §7). */}
      {signals.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5" /> Signals
              <span className="font-mono tabular-nums normal-case tracking-normal">{signals.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2.5">
            {(signalsShowAll ? signals : signals.slice(0, 4)).map((s: any) => {
              const typeCls: Record<string, string> = {
                opening:     "bg-emerald-50 text-emerald-700 border-emerald-200",
                hiring:      "bg-teal-50 text-teal-700 border-teal-200",
                headcount_down: "bg-amber-50 text-amber-700 border-amber-200",
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
              const body = (
                <>
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="outline" className={`text-[11px] shrink-0 ${typeCls[signalKind(s)] || typeCls.news}`}>
                      {signalKind(s).replace(/_/g, " ")}
                    </Badge>
                    {s.signal_date && (
                      <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                        {ukDate(s.signal_date, { day: "numeric", month: "short" })}
                      </span>
                    )}
                    {s.source && s.source.startsWith("http") && <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />}
                  </div>
                  <p className="text-xs leading-snug line-clamp-2">{sentenceCaseShouting(s.headline)}</p>
                </>
              );
              return s.source && s.source.startsWith("http") ? (
                <a key={s.id} href={s.source} target="_blank" rel="noopener noreferrer" className={`block border-l-2 pl-2.5 ${sentCls[s.sentiment] || "border-l-muted"}`}>
                  {body}
                </a>
              ) : (
                <div key={s.id} className={`border-l-2 pl-2.5 ${sentCls[s.sentiment] || "border-l-muted"}`}>
                  {body}
                </div>
              );
            })}
            {signals.length > 4 && (
              <button onClick={() => setSignalsShowAll(v => !v)} className="text-[11px] text-primary hover:underline">
                {signalsShowAll ? "Show less" : `Show all ${signals.length}`}
              </button>
            )}
          </CardContent>
        </Card>
      )}


      {/* Menu / best sellers (brands only) */}
      {!isLandlord && !isAgentFirm && (
        <MenuIntelCard
          companyId={companyId}
          companyName={c.name}
          industry={c.industry}
          companyType={c.company_type}
          intel={c.menu_intel}
          refreshedAt={c.menu_intel_at}
        />
      )}

      {/* Competition — CRM similar tenants (linkable) + AI competitor set */}
      {!isLandlord && (similarTenants.length > 0 || aiCompetitors.length > 0) && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <Swords className="w-3.5 h-3.5" /> Competition
              <span className="font-mono tabular-nums normal-case tracking-normal">{similarTenants.length + aiCompetitors.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {similarTenants.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {similarTenants.map((t: any) => (
                  <Link key={t.id} href={`/companies/${t.id}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-card hover:bg-muted">
                    {t.name}
                    {t.store_count != null && <span className="text-muted-foreground tabular-nums">{t.store_count}</span>}
                  </Link>
                ))}
              </div>
            )}
            {aiCompetitors.slice(0, 6).map((comp: any, i: number) => (
              <div key={i} className="text-xs border-l-2 border-l-muted pl-2">
                <span className="font-medium">{comp.name}</span>
                {comp.segment && <span className="text-muted-foreground"> · {comp.segment}</span>}
                {comp.reason && <p className="text-[11px] text-muted-foreground leading-snug">{comp.reason}</p>}
              </div>
            ))}
            {aiCompetitors.length > 6 && (
              <p className="text-[11px] text-muted-foreground">
                +{aiCompetitors.length - 6} more in the competitor set
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {/* News & Media — same feed (and clean-up) as the desktop Industry
          tab: the brand's own Instagram / jobs posts are in Social, sources
          like "Crisis (Google News)" give way to the title's publisher
          (Woody, 2026-09-27). */}
      {(() => {
        // Same Industry rules as desktop: the brand's own posts out, one row
        // per story, nothing over two years old (Woody, 2026-09-28).
        const staleCut = Date.now() - 730 * 86400000;
        const industry = (data.news || []).filter((n: any) => !isOwnChannelNews(n.source_name) && !isSocialNews(n)
          && !isOwnBrandSource(splitNewsTitle(n.title).publisher, c.name)
          && !(!/\(Google News\)\s*$/i.test(n.source_name || "") && isOwnBrandSource(n.source_name, c.name))
          && (!n.published_at || new Date(n.published_at).getTime() >= staleCut));
        if (industry.length === 0) return null;
        const newsM = dedupeNearNews(industry, c.name);
        return (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <Newspaper className="w-3.5 h-3.5" /> News & media
              <span className="font-mono tabular-nums normal-case tracking-normal">{newsM.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {(newsShowAllM ? newsM : newsM.slice(0, 5)).map((n: any) => (
              <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer" className="flex gap-2.5 min-w-0 group">
                {n.image_url && (
                  <img src={n.image_url} alt="" loading="lazy" className="w-14 h-14 rounded object-cover shrink-0 bg-muted" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:underline">{sentenceCaseShouting(splitNewsTitle(n.title).title)}</p>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {[newsSourceLabel(n.source_name, n.title, c.name) || snippetPublisher(n.title, n.summary) || urlPublisher(n.url), n.published_at ? ukDate(n.published_at, { day: "numeric", month: "short" }) : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </a>
            ))}
            {newsM.length > 5 && (
              <button onClick={() => setNewsShowAllM(v => !v)} className="text-[11px] text-primary hover:underline">
                {newsShowAllM ? "Show less" : `Show all ${newsM.length}`}
              </button>
            )}
          </CardContent>
        </Card>
        );
      })()}
      </div>

      <div className={sec("stores")}>
      {!isLandlord && ((data.stores || []).length > 0 || !isClientViewer) && <BrandStoresBoard
        companyId={companyId} stores={(data.stores || []).map((st: any) => ({ ...st, name: displayStoreName(st.name, c.name, st.address) }))} reportedTotal={c.store_count} canRefresh={!isClientViewer}
        refreshing={storeScan.isPending} diagnostic={storeScan.error instanceof Error ? storeScan.error.message : null}
        onRefresh={() => storeScan.mutate({})}
      />}
      </div>

      <div className={sec("social")}>
      {/* Instagram board — same card as desktop (posts + follower stats).
          The card returns null without a handle, which left this pill a
          blank screen on the phone (r379) — show why instead. */}
      {!c.instagram_handle && (
        <div className="text-xs text-muted-foreground border border-dashed rounded-lg px-3 py-6 text-center">
          No social feed yet — no Instagram handle on file for {c.name}.
        </div>
      )}
      <BrandFeedCard companyId={companyId} />
      {c.instagram_handle && (
        <a
          href={`https://instagram.com/${c.instagram_handle}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground px-1"
        >
          <Instagram className="w-4 h-4" /> @{c.instagram_handle}
        </a>
      )}

      </div>

      <div className={sec("stores")}>
      {/* Live tenancies */}
      {(data.liveLocations || []).length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <Building2 className="w-3.5 h-3.5" /> Live tenancies
              <span className="font-mono tabular-nums normal-case tracking-normal">{data.liveLocations.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1">
            {data.liveLocations.map((p: any) => (
              <Link key={p.id} href={`/properties/${p.id}`} className="flex items-center justify-between gap-2 p-1.5 rounded border bg-card min-w-0">
                <span className="text-xs font-medium truncate">{p.name}</span>
                <Badge variant="outline" className="text-[11px] shrink-0">{p.units} unit{Number(p.units) === 1 ? "" : "s"}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
