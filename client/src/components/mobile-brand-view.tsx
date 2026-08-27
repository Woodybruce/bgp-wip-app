import { useState, useEffect, useRef } from "react";
// Phone-fit brand / landlord profile — the mobile answer to the desktop
// BrandProfilePanel, which rendered effectively blank at phone widths
// (Woody, 2026-08-04: "how the brands reflect" on the phone app). Stacked
// cards reusing the canonical components: chat, contacts board, covenant,
// compliance, menu, portfolio activity — so the phone shows the SAME
// intelligence as desktop, one structure everywhere.
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { getAuthHeaders, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, TrendingUp, ClipboardList, Instagram, Store, Swords, ExternalLink, Globe, Newspaper } from "lucide-react";
import {
  CompanyMiniChat, MenuIntelCard, PortfolioActivityBlock, BrandComplianceCard, BrandInstagramCard,
  AskChatBGPInline, PipnetRequirementsRow, StockSnapshotCard, ApolloIntelCard,
} from "@/components/brand-profile-panel";
import { BgpTakeStrip } from "@/components/bgp-take-strip";
import { CompanyContactsBoard } from "@/components/company-contacts-board";
import { CovenantBadge, CovenantCommentary } from "@/components/covenant-badge";
import { BrandPortfolioMap } from "@/components/brand-portfolio-map";
import { ActivitySummary } from "@/components/activity-summary";

export function MobileBrandView({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery<any>({
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
  const [section, setSection] = useState<"chat" | "contacts" | "intel" | "stores" | "social" | "compliance">("chat");
  const [signalsShowAll, setSignalsShowAll] = useState(false);
  const [newsShowAllM, setNewsShowAllM] = useState(false);
  const [storesShowAll, setStoresShowAll] = useState(false);
  const sec = (k: typeof section) => (section === k ? "space-y-3" : "hidden");
  const { toast } = useToast();
  const { data: mbvUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientViewer = mbvUser?.role === "Client" || !!mbvUser?.companyScopeId;
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
    mutationFn: async () => {
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
    onSuccess: (out: any) => {
      toast({ title: "Store search complete", description: out?.found ? `${out.found} stores found` : "0 stores found" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Store search failed", description: e.message, variant: "destructive" }),
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
  // Auto-fire on first open when a brand has no stores at all — same as
  // desktop, so the map fills itself instead of waiting for a tap
  // (Woody, 2026-08-25: "I don't want to ask, I need everything automated").
  const autoScanFired = useRef(false);
  useEffect(() => {
    if (autoScanFired.current || !data?.company || isClientViewer) return;
    const co = data.company;
    if (/landlord|client/i.test(co.company_type || "")) return;
    if ((data.stores || []).length > 0) return;
    autoScanFired.current = true;
    storeScan.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isClientViewer]);

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
  const isLandlord = /landlord|client/i.test(c.company_type || "");
  // Same hero cascade as the desktop banner: pinned "brand-hero" tag →
  // flagship street view (when stores have coords) → first gallery image.
  const srcFor = (img: any) => img.thumbnail_data
    ? (img.thumbnail_data.startsWith("data:") ? img.thumbnail_data : `data:${img.mime_type || "image/jpeg"};base64,${img.thumbnail_data}`)
    : `/api/brand/gallery-image/${img.id}`;
  const heroTagged = (data.images || []).find((i: any) => Array.isArray(i.tags) && i.tags.includes("brand-hero"));
  const hasStreetView = (data.stores || []).some((s: any) => typeof s.lat === "number" && typeof s.lng === "number");
  const firstImg = (data.images || [])[0];
  const heroSrc = heroTagged
    ? srcFor(heroTagged)
    : hasStreetView
      ? `/api/brand/${companyId}/flagship-image${firstImg ? `?exclude=${encodeURIComponent(firstImg.id)}` : ""}`
      : firstImg ? srcFor(firstImg) : null;
  const trackerComments: any[] = trackerData?.comments || [];

  // Same dedupe as the desktop Signals feed — Instagram + Google News often
  // land the same story twice; first occurrence (newest) wins.
  const signals: any[] = (() => {
    const seen = new Set<string>();
    const norm = (h: string) => (h || "").toLowerCase().replace(/[^a-z0-9£$ ]+/g, " ").replace(/\s+/g, " ").trim();
    return ((data.signals || []) as any[]).filter(s => {
      const n = norm(s.headline);
      if (!n || seen.has(n)) return !n;
      seen.add(n);
      return true;
    });
  })();
  // Same UK slice as the desktop Stores section — the map only earns its
  // place once at least one store is geocoded.
  const ukStores: any[] = (data.stores || []).filter((s: any) => !s.country || s.country === "GB");
  const mappableStores = ukStores.filter((s: any) => typeof s.lat === "number" && typeof s.lng === "number");
  const similarTenants: any[] = (data.competitors || []).slice(0, 8);
  const similarNames = new Set(similarTenants.map((t: any) => String(t.name).toLowerCase().trim()));
  const aiCompetitors: any[] = ((c.ai_competitors as any[]) || []).filter(
    (comp: any) => !similarNames.has(String(comp.name).toLowerCase().trim())
  );

  return (
    <div className="p-4 space-y-3 pb-6">
      {/* Hero + identity */}
      {heroSrc && (
        <div className="h-44 rounded-xl overflow-hidden bg-muted">
          <img src={heroSrc} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {c.company_type && <Badge variant="outline" className="text-[11px]">{String(c.company_type).replace(/\s*-\s*/g, " · ")}</Badge>}
        {c.industry && <Badge variant="outline" className="text-[11px]">{c.industry}</Badge>}
        {c.store_count != null && <Badge variant="outline" className="text-[11px] tabular-nums">{c.store_count} stores</Badge>}
        {(c as any).companies_house_number && <CovenantBadge companyNumber={(c as any).companies_house_number} />}
        {(c.domain_url || c.domain) && (
          <a
            href={(c.domain_url || `https://${c.domain}`).startsWith("http") ? (c.domain_url || `https://${c.domain}`) : `https://${c.domain_url || c.domain}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground"
          >
            <Globe className="w-3 h-3" /> {String(c.domain || c.domain_url).replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="company-phone-sections">
        <Pill active={section === "chat"} onClick={() => setSection("chat")} data-testid="company-section-chat">Chat</Pill>
        <Pill active={section === "contacts"} onClick={() => setSection("contacts")} data-testid="company-section-contacts">Contacts</Pill>
        <Pill active={section === "intel"} onClick={() => setSection("intel")} data-testid="company-section-intel">Intel</Pill>
        {!isLandlord && <Pill active={section === "stores"} onClick={() => setSection("stores")} data-testid="company-section-stores">Stores</Pill>}
        {!isLandlord && <Pill active={section === "social"} onClick={() => setSection("social")} data-testid="company-section-social">Social</Pill>}
        <Pill active={section === "compliance"} onClick={() => setSection("compliance")} data-testid="company-section-compliance">Compliance</Pill>
      </div>

      <div className={sec("chat")}>
      {/* Who they are + BGP take in ONE card (description as the opening
          paragraph, the AI read under it) — they read as one brief, not two
          blocks (Woody, 2026-08-25). */}
      <BgpTakeStrip companyId={companyId} tab="brand" intro={c.description} />
      <AskChatBGPInline brandName={c.name} />
      {/* Chat — same thread as desktop and the main chat panel */}
      <div className="h-[320px]">
        <CompanyMiniChat companyId={companyId} companyName={c.name} fill />
      </div>
      </div>

      <div className={sec("contacts")}>
      {/* Key contacts — canonical board */}
      <CompanyContactsBoard
        companyId={companyId}
        companyName={c.name}
        contacts={data.contacts || []}
        pendingSenders={data.pendingContactSuggestions || []}
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
                <div className="text-sm font-mono tabular-nums">{data.bgpSummary.totalDeals}{data.bgpSummary.completedDeals ? <span className="text-muted-foreground text-[11px]"> · {data.bgpSummary.completedDeals} done</span> : null}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Touches</div>
                <div className="text-sm font-mono tabular-nums">{data.bgpSummary.interactionsTotal}<span className="text-muted-foreground text-[11px]"> · {data.bgpSummary.interactionsLast90d} in 90d</span></div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Last touch</div>
                <div className="text-sm font-mono tabular-nums">{data.bgpSummary.lastInteractionAt ? new Date(data.bgpSummary.lastInteractionAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</div>
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
      {/* Covenant */}
      <Card>
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
      </Card>

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
              <Badge variant="outline" className="text-[10px]">{trackerComments.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1.5 max-h-[300px] overflow-y-auto">
            {trackerComments.map((cm: any, i: number) => (
              <div key={i} className="text-xs rounded-lg border border-border/50 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                  <span className="font-medium text-foreground/80">{cm.userName}</span>
                  {cm.at && <span>{new Date(cm.at).toLocaleDateString("en-GB")}</span>}
                </div>
                <p className="whitespace-pre-wrap break-words">{cm.text}</p>
                <Link href={`/properties/${cm.propertyId}`} className="text-[11px] text-primary hover:underline">
                  {cm.propertyName}{cm.unitName ? ` · ${cm.unitName}` : ""}
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Expansion — score, live requirements, Pipnet asks (phone twin of
          desktop's Expansion intelligence zone). */}
      {!isLandlord && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5" /> Expansion
              {hunter?.expansionScore != null && (
                <Badge variant="outline" className={`text-[10px] font-mono tabular-nums ${
                  hunter.expansionScore >= 75 ? "bg-orange-50 text-orange-700 border-orange-200" :
                  hunter.expansionScore >= 55 ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-zinc-50 text-zinc-600 border-zinc-200"}`}>
                  {hunter.expansionScore}/100
                </Badge>
              )}
              {c.rollout_status && <Badge variant="outline" className="text-[10px]">{String(c.rollout_status).replace(/_/g, " ")}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {hunter?.subScores && (
              <div className="grid grid-cols-4 gap-1 text-center">
                {[["UK momentum", hunter.subScores.ukMomentum], ["Capacity", hunter.subScores.capacity], ["Intent", hunter.subScores.intent], ["Engagement", hunter.subScores.engagement]].map(([label, v]: any) => (
                  <div key={label} className="rounded border border-border/60 px-1 py-1">
                    <div className="text-sm font-mono tabular-nums">{v ?? "—"}</div>
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-tight">{label}</div>
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
                      {r.status && <Badge variant="outline" className="text-[10px]">{r.status}</Badge>}
                      {(r.size || []).length > 0 && <span className="font-mono tabular-nums text-[11px]">{r.size.join(" / ")}</span>}
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
            {c.backers && <div className="text-xs"><span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1.5">Backers</span>{c.backers}</div>}
            {c.franchise_activity && <div className="text-xs"><span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1.5">Franchise</span>{c.franchise_activity}</div>}
            {c.dept_store_presence && <div className="text-xs"><span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1.5">Dept stores</span>{c.dept_store_presence}</div>}
            {c.stock_ticker && <StockSnapshotCard companyId={companyId} ticker={c.stock_ticker} />}
          </CardContent>
        </Card>
      )}
      {!isLandlord && !isClientViewer && <ApolloIntelCard companyId={companyId} companyName={c.name} />}

      {/* Portfolio activity — tenant at / targeted / pitched / suggested */}
      <PortfolioActivityBlock companyId={companyId} />

      {/* Signals — phone twin of the desktop feed: semantic type pill +
          mono date on a meta row, clamped headline underneath, sentiment
          as the left border (docs/DESIGN.md §7). */}
      {signals.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5" /> Signals
              <Badge variant="outline" className="text-[10px] font-mono tabular-nums">{signals.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2.5">
            {(signalsShowAll ? signals : signals.slice(0, 4)).map((s: any) => {
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
              const body = (
                <>
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${typeCls[s.signal_type] || typeCls.news}`}>
                      {(s.signal_type || "news").replace(/_/g, " ")}
                    </Badge>
                    {s.signal_date && (
                      <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                        {new Date(s.signal_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    )}
                    {s.source && s.source.startsWith("http") && <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />}
                  </div>
                  <p className="text-xs leading-snug line-clamp-2">{s.headline}</p>
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
      {!isLandlord && (
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
              <Badge variant="outline" className="text-[10px] tabular-nums">{similarTenants.length + aiCompetitors.length}</Badge>
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
      {/* News & Media — same feed the desktop sidebar shows */}
      {(data.news || []).length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <Newspaper className="w-3.5 h-3.5" /> News & media
              <Badge variant="outline" className="text-[10px] font-mono tabular-nums">{data.news.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {(newsShowAllM ? data.news : data.news.slice(0, 5)).map((n: any) => (
              <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer" className="flex gap-2.5 min-w-0 group">
                {n.image_url && (
                  <img src={n.image_url} alt="" loading="lazy" className="w-14 h-14 rounded object-cover shrink-0 bg-muted" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:underline">{n.title}</p>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {[n.source_name, n.published_at ? new Date(n.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </a>
            ))}
            {data.news.length > 5 && (
              <button onClick={() => setNewsShowAllM(v => !v)} className="text-[11px] text-primary hover:underline">
                {newsShowAllM ? "Show less" : `Show all ${data.news.length}`}
              </button>
            )}
          </CardContent>
        </Card>
      )}
      </div>

      <div className={sec("stores")}>
      {/* UK stores — same data as the desktop Stores section, map first.
          Staff see the card even at 0 stores with the same research
          trigger desktop has; clients only once stores exist. */}
      {!isLandlord && (mappableStores.length > 0 || ukStores.length > 0 || !isClientViewer) && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <Store className="w-3.5 h-3.5" /> UK stores
              <Badge variant="outline" className="text-[10px] font-mono tabular-nums">{ukStores.length}</Badge>
              {!isClientViewer && !storeScan.isPending && (
                <button
                  onClick={() => storeScan.mutate()}
                  className="ml-auto text-[10px] px-2 py-0.5 rounded-full border bg-card hover:bg-muted normal-case tracking-normal"
                  data-testid="btn-mobile-research-stores"
                >
                  {ukStores.length ? "Refresh" : "Find stores"}
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {storeScan.isPending ? (
              <div className="text-xs text-muted-foreground border border-dashed rounded-lg px-3 py-6 text-center">
                Researching UK stores — the map appears here when the scan finishes (can take a couple of minutes)…
              </div>
            ) : ukStores.length > 0 ? (
              <div className="space-y-2">
                {mappableStores.length > 0 && (
                  <div className="rounded-lg overflow-hidden border border-border/50">
                    <BrandPortfolioMap stores={mappableStores as any} height={240} />
                  </div>
                )}
                {/* List under the map — every store, addressable and scannable
                    (Woody, 2026-08-25: "can you do list as well as map"). */}
                <div className="divide-y divide-border/60">
                  {(storesShowAll ? ukStores : ukStores.slice(0, 5)).map((s: any) => (
                    <div key={s.id} className="text-xs py-1.5 min-w-0 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{s.name}</div>
                        {s.address && <div className="text-[11px] text-muted-foreground truncate">{s.address}</div>}
                      </div>
                      {s.status === "closed" && (
                        <Badge variant="outline" className="text-[9px] shrink-0 text-red-600 border-red-200">Closed</Badge>
                      )}
                    </div>
                  ))}
                </div>
                {ukStores.length > 5 && !storesShowAll && (
                  <button
                    onClick={() => setStoresShowAll(true)}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    data-testid="btn-stores-show-all"
                  >
                    Show all {ukStores.length}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No store locations on file yet — Find stores researches them from Google Places and lights up the map.
              </p>
            )}
          </CardContent>
        </Card>
      )}


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
      <BrandInstagramCard companyId={companyId} />
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
              <Badge variant="outline" className="text-[10px]">{data.liveLocations.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1">
            {data.liveLocations.map((p: any) => (
              <Link key={p.id} href={`/properties/${p.id}`} className="flex items-center justify-between gap-2 p-1.5 rounded border bg-card min-w-0">
                <span className="text-xs font-medium truncate">{p.name}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">{p.units} unit{Number(p.units) === 1 ? "" : "s"}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
