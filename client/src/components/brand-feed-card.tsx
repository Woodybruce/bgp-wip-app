// One card for everything a brand says on its own channels — Instagram, its
// website's openings and news pages, its jobs page and LinkedIn — as tabs,
// with a short AI "what's new" read on top (Woody, 2026-09-24: "combined in
// the Instagram page maybe as tabs … then some AI commentary").
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Instagram, Loader2, Rss, Sparkles, ExternalLink, RefreshCw } from "lucide-react";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill, PillCount } from "@/components/ui/pill";
import { AiCommentary } from "@/components/ai-commentary";
import { BandHeading } from "@/components/brand-page/brand-top";
import { LandlordInstagramPreview, landlordInstagramUsername } from "@/components/landlord-instagram-preview";
import { mergeLandlordNewsTabs, type FeedItem, type FeedTab, type LandlordNewsArticle } from "@/lib/landlord-news-feed";
import { canReadLandlordIndustryNews, type LandlordIndustryNews } from "@shared/landlord-news";

type FeedResponse = { tabs: FeedTab[]; read: { text: string; at: string } | null; stale: boolean; latest: string | null };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmt = (n: number | null | undefined) => n == null ? null : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
const realImage = (url: string | null) => !!url && !/favicon|google\.com\/s2|gstatic/i.test(url);

// Opening a brand also asks for its Instagram, which creates the feed for a
// deal brand that has none yet (server side) — so the card always loads it.
function useInstagram(companyId: string, enabled = true) {
  return useQuery<any>({
    queryKey: ["/api/brand", companyId, "instagram"],
    queryFn: async () => { const r = await fetch(`/api/brand/${companyId}/instagram`, { headers: getAuthHeaders() }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
    staleTime: 15 * 60_000,
    enabled,
  });
}

// dense (the News & social board): smaller tiles, so nine posts sit in two
// rows on a wide board and do not push everything else down the page.
function InstagramGrid({ companyId, dense = false }: { companyId: string; dense?: boolean }) {
  const { data } = useInstagram(companyId);
  if (!data?.posts?.length) return <p className="text-xs text-muted-foreground">No Instagram posts synced yet.</p>;
  return (
    <div className="space-y-2">
      {fmt(data.followers) && <p className="text-[11px] text-muted-foreground"><strong className="text-foreground">{fmt(data.followers)}</strong> followers</p>}
      {/* Instagram's CDN rejects hotlinks — images go through our proxy. */}
      <div className={`grid gap-1 max-h-[520px] overflow-y-auto pb-1 ${dense ? "grid-cols-3 sm:grid-cols-4 [@container(min-width:1100px)]:grid-cols-5" : "grid-cols-3"}`}>
        {data.posts.map((p: any, i: number) => (
          <a key={p.url || i} href={p.url} target="_blank" rel="noreferrer" title={p.title || ""} className="aspect-square w-full rounded border border-border/60 overflow-hidden bg-muted relative group block">
            <div className="absolute inset-0 p-1.5 text-[11px] leading-tight text-muted-foreground overflow-hidden">{(p.title || "").slice(0, 90)}</div>
            {p.imageUrl && <img src={`/api/ig-image?u=${encodeURIComponent(p.imageUrl)}`} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-end p-1.5 opacity-0 group-hover:opacity-100"><span className="text-white text-[11px] leading-tight line-clamp-3">{p.title}</span></div>
          </a>
        ))}
      </div>
    </div>
  );
}

function ItemList({ items, landlord = false }: { items: FeedItem[]; landlord?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [items[0]?.type]);
  if (!items.length) return <p className="text-xs text-muted-foreground">{landlord ? "No updates have been retrieved for this channel yet." : "Nothing new on this page yet — new items appear as the brand posts them."}</p>;
  const followed = items.find(item => item.baseline)?.followed_at;
  const visible = landlord && !showAll ? items.slice(0, 6) : items;
  return (
    <div className="space-y-1.5">
    {/* The first read of a page is what was already there (existing sites,
        standing roles); anything added since is marked New. */}
    {followed && <p className="text-[11px] text-muted-foreground">Listed on {landlord ? "the source" : "the brand's"} page when BGP started following on {day(followed)} — anything added since is marked <span className="font-medium text-foreground">New</span>.</p>}
    <ul className="divide-y divide-border max-h-[520px] overflow-y-auto">
      {visible.map(item => (
        <li key={item.id} className="py-2 flex gap-2.5 min-w-0">
          {realImage(item.image_url) && <img src={item.image_url!} alt="" className="w-12 h-12 rounded object-cover shrink-0 bg-muted" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
          <div className="min-w-0 flex-1">
            <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline break-words">{item.title}</a>
            <div className="text-[11px] text-muted-foreground tabular-nums flex items-center gap-1.5">
              {followed && !item.baseline && <span className="rounded-full bg-foreground text-background px-1.5 py-px text-[11px] font-semibold">New</span>}
              {landlord && item.publisher && <span>{item.publisher}</span>}
              {landlord && item.coverage === "company" && <span className="text-primary">Company coverage</span>}
              {!item.baseline && item.at && !Number.isNaN(Date.parse(item.at)) && day(item.at)}
            </div>
            {item.summary && <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>}
          </div>
        </li>
      ))}
    </ul>
    {landlord && items.length > 6 && <button className="text-xs text-primary hover:underline min-h-8" onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer" : `View all ${items.length} updates`}</button>}
    </div>
  );
}

// board (a brand's page): ONE "News & social" card. The caller's News and
// Media block (newsSlot) is the left column; the brand's own channels, with
// the same tabs, Instagram grid, read and "Follow brand channels" as the
// plain brand card, are the right column. It is not the landlord mode: that
// swaps the news source, the Instagram grid and what can be followed.
// boardNote sits under the columns; emptyNote is what the caller wants drawn
// when there is neither news nor a channel (and nothing staff can set up).
export function BrandFeedCard({ companyId, canSetUp = false, landlord = false, news, companyName = "", domain, instagramHandle, board = false, newsSlot = null, boardNote = null, emptyNote = null }: { companyId: string; canSetUp?: boolean; landlord?: boolean; news?: LandlordNewsArticle[] | null; companyName?: string; domain?: string | null; instagramHandle?: string | null; board?: boolean; newsSlot?: React.ReactNode; boardNote?: React.ReactNode; emptyNote?: React.ReactNode }) {
  const { toast } = useToast();
  const key = ["/api/brand", companyId, "feed"];
  const { data, isLoading, isError, refetch } = useQuery<FeedResponse>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/feed`)).json(),
    staleTime: 10 * 60_000,
  });
  const { data: viewer } = useQuery<any>({ queryKey: ["/api/auth/me"], enabled: landlord });
  const canReadIndustry = landlord && canReadLandlordIndustryNews(viewer);
  const industryKey = ["/api/landlord-relationships", companyId, "news"];
  const industry = useQuery<LandlordIndustryNews>({
    queryKey: industryKey,
    queryFn: async () => (await apiRequest("GET", `/api/landlord-relationships/${companyId}/news`)).json(),
    enabled: canReadIndustry,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const refreshNews = useMutation({
    mutationFn: async (): Promise<LandlordIndustryNews> => (await apiRequest("POST", `/api/landlord-relationships/${companyId}/news/refresh`, {})).json(),
    onSuccess: out => {
      queryClient.setQueryData(industryKey, out);
      toast({ title: "Industry news updated", ...(out.research.status === "unavailable" ? { description: "Saved trade-press stories are available; the live news search is currently unavailable." } : {}) });
    },
    onError: () => toast({ title: "Couldn’t refresh industry news", description: "The saved stories remain available. Try again shortly.", variant: "destructive" }),
  });
  useInstagram(companyId, !landlord);
  const [active, setActive] = useState<string | null>(null);
  const [activeSocial, setActiveSocial] = useState<string | null>(null);
  const missingOfficialKinds = ([['website', 'rssapp_web_news'], ['linkedin', 'rssapp_linkedin']] as const)
    .filter(([, type]) => !data?.tabs.some(tab => tab.type === type && (tab.sourceUrl || tab.items.length)))
    .map(([kind]) => kind);
  useEffect(() => { setActive(null); setActiveSocial(null); }, [companyId]);
  const read = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/brand/${companyId}/feed/read`)).json(),
    onSuccess: (out: { read: FeedResponse["read"] }) => queryClient.setQueryData<FeedResponse>(key, prev => prev ? { ...prev, read: out.read } : prev),
  });
  const hasItems = !!data?.tabs.some(tab => tab.items.length);
  useEffect(() => {
    if (data && !data.read && hasItems && !read.isPending && !read.isError) read.mutate();
  }, [data, hasItems]);
  const setup = useMutation({
    // Background job: reads the website, then checks each feed (about a minute).
    mutationFn: async () => {
      await apiRequest("POST", `/api/brand/${companyId}/feed/setup`, landlord ? { kinds: missingOfficialKinds } : {});
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const job = await (await apiRequest("GET", `/api/brand/${companyId}/feed/setup`)).json();
        if (job.state === "done") return job.result;
        if (job.state === "error") throw new Error(job.error || "Setup failed");
      }
      throw new Error("Still working — check back in a minute");
    },
    onSuccess: (out: { results: Array<{ kind: string; status: string }> }) => {
      const made = out.results.filter(r => r.status === "created" || landlord && r.status === "reconnected").map(r => r.kind);
      toast({ title: made.length ? `Following ${made.join(", ")}` : "Nothing new to follow", description: landlord
        ? made.length ? "Connected sources will appear here as items are retrieved." : "No usable news or LinkedIn feed was found on the confirmed official website."
        : made.length ? "Items appear here now and update as the brand posts." : "No openings, news, jobs or LinkedIn page could be followed on this brand's site." });
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast({ title: "Couldn't set up feeds", description: e.message, variant: "destructive" }),
  });

  if (board && !landlord) {
    const feedTabs = data && !isLoading ? data.tabs : [];
    const channel = feedTabs.find(tab => tab.type === active) || feedTabs.find(tab => tab.items.length) || feedTabs[0];
    const followStrip = canSetUp && !!data && !isLoading && !feedTabs.some(tab => tab.type !== "rssapp_instagram");
    const igHandle = String(instagramHandle || "").replace(/^@+/, "");
    // Nothing to show: a client login gets no card; staff get one quiet line
    // with the action that fills it.
    // The brand's Instagram handle is part of the channels column; with no
    // channel followed it is one quiet link, so it is never a loose line
    // under the card.
    const handleLink = igHandle ? <a href={`https://instagram.com/${igHandle}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline" data-testid="brand-feed-instagram-handle"><Instagram className="w-3 h-3" />@{igHandle}</a> : null;
    const quietLine = "text-[13px] leading-snug text-muted-foreground";
    if (!newsSlot && !feedTabs.length) return followStrip || boardNote || handleLink ? (
      <div className="rounded-xl border border-dashed border-border px-3 py-2.5 flex flex-col gap-1.5 min-w-0" data-testid="brand-news-social-empty">
        {followStrip ? <p className={quietLine}>
          No news or brand channels followed yet · <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={setup.isPending} onClick={() => setup.mutate()} data-testid="button-brand-feed-setup">{setup.isPending ? "Finding pages…" : "Follow brand channels"}</button>{handleLink && <> · {handleLink}</>}
        </p> : handleLink && <p className={quietLine}>{handleLink}</p>}
        {boardNote}
      </div>
    ) : data && !isLoading ? emptyNote : null;
    return (
      <Card className="[container-type:inline-size]" data-testid="brand-news-social">
        {/* No title over the two columns: the pill above already says News
            and media, and each column carries its own ("News", "Brand
            channels"). */}
        <CardContent className="p-3 space-y-3">
          {/* Two columns only when both hold something: with no channel followed
              the news takes the width and staff get one line to follow them. */}
          <div className={`grid gap-x-6 gap-y-4 items-start ${newsSlot && feedTabs.length ? "[@container(min-width:760px)]:grid-cols-2" : "grid-cols-1"}`} data-testid="brand-news-social-spread">
            {newsSlot && <section className="min-w-0" aria-label="News and media">{newsSlot}</section>}
            {feedTabs.length > 0 && (
              <section className="min-w-0 space-y-2.5" aria-label="Brand channels" data-testid="brand-feed-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <BandHeading><Rss className="w-3.5 h-3.5" /> Brand channels</BandHeading>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    {handleLink}
                    {channel?.sourceUrl && <a href={channel.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap">Open page <ExternalLink className="w-3 h-3" /></a>}
                  </span>
                </div>
                {hasItems && (data?.read || read.isPending) && (
                  <section className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1" data-testid="brand-feed-read">
                    <h4 className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-primary" />What's new</h4>
                    {data?.read ? <AiCommentary text={data.read.text} />
                      : <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading the brand's channels…</p>}
                  </section>
                )}
                {feedTabs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Brand channels">
                    {feedTabs.map(tab => (
                      <Pill key={tab.type} active={channel?.type === tab.type} role="tab" aria-selected={channel?.type === tab.type} onClick={() => setActive(tab.type)} data-testid={`brand-feed-tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}>
                        {tab.type === "rssapp_instagram" && <Instagram className="w-3 h-3" />}{tab.label}{/* The bare mono count the News tabs beside it carry: one tab-count style in the card. */}{tab.items.length > 0 && <span className="font-mono tabular-nums">{tab.items.length}</span>}
                      </Pill>
                    ))}
                  </div>
                )}
                {channel && (channel.type === "rssapp_instagram" ? <InstagramGrid companyId={companyId} dense /> : <ItemList items={channel.items} />)}
                {followStrip && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
                    <p className="text-xs text-muted-foreground">Follow this brand's openings page, website news, jobs and LinkedIn.</p>
                    <Button size="sm" variant="outline" disabled={setup.isPending} onClick={() => setup.mutate()} data-testid="button-brand-feed-setup">
                      {setup.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}{setup.isPending ? "Finding pages…" : "Follow brand channels"}
                    </Button>
                  </div>
                )}
              </section>
            )}
          </div>
          {!feedTabs.length && (followStrip ? <p className={quietLine} data-testid="brand-feed-follow-line">
            No brand channels followed yet · <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={setup.isPending} onClick={() => setup.mutate()} data-testid="button-brand-feed-setup">{setup.isPending ? "Finding pages…" : "Follow brand channels"}</button>{handleLink && <> · {handleLink}</>}
          </p> : handleLink && <p className={quietLine} data-testid="brand-feed-follow-line">{handleLink}</p>)}
          {boardNote}
        </CardContent>
      </Card>
    );
  }
  if ((isLoading || !data) && !landlord) return null;
  const tabs = landlord ? mergeLandlordNewsTabs([
    ...(data?.tabs || []), ...(canReadIndustry ? [{ type: "landlord_media", label: "Industry news", sourceUrl: null, items: [] }] : []),
  ], [...(canReadIndustry ? industry.data?.items || [] : []), ...(news || [])], { companyName, domain, instagramHandle }) : data!.tabs;
  const webTabs = (data?.tabs || []).filter(tab => tab.type !== "rssapp_instagram");
  const instagramUsername = landlordInstagramUsername(instagramHandle);
  if (!tabs.length && !canSetUp && !landlord) return null;
  const current = tabs.find(tab => tab.type === active) || tabs.find(tab => tab.items.length) || tabs[0];
  const newsTabs = tabs.filter(tab => !["rssapp_instagram", "rssapp_linkedin"].includes(tab.type));
  const socialTabs = tabs.filter(tab => ["rssapp_instagram", "rssapp_linkedin"].includes(tab.type));
  const newsCurrent = newsTabs.find(tab => tab.type === active) || newsTabs.find(tab => tab.type === "landlord_media" && tab.items.length) || newsTabs.find(tab => tab.items.length) || newsTabs[0];
  const socialCurrent = socialTabs.find(tab => tab.type === activeSocial) || socialTabs.find(tab => tab.type === "rssapp_instagram" && instagramUsername) || socialTabs[0];
  const landlordChannel = (choices: FeedTab[], selected: FeedTab | undefined, select: (type: string) => void, label: string) => <section className="min-w-0 space-y-3" aria-label={label}>
    <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={label}>
      {choices.map(tab => <Pill key={tab.type} active={selected?.type === tab.type} role="tab" aria-selected={selected?.type === tab.type} onClick={() => select(tab.type)} data-testid={`brand-feed-tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}>
        {tab.type === "rssapp_instagram" && <Instagram className="w-3 h-3" />}{tab.label}{tab.items.length > 0 && <PillCount n={tab.items.length} active={selected?.type === tab.type} />}
      </Pill>)}
    </div>
    {selected?.type === "landlord_media" && <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">Trade-press coverage and wider property-market updates. Not every story concerns {companyName || "this landlord"}.</p>
        {canReadIndustry && <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" disabled={refreshNews.isPending} onClick={() => refreshNews.mutate()}><RefreshCw className={`h-3 w-3 ${refreshNews.isPending ? "animate-spin" : ""}`} />{refreshNews.isPending ? "Checking…" : "Refresh news"}</Button>}
      </div>
      {canReadIndustry && industry.data?.research.checkedAt && <p className="text-[11px] text-muted-foreground">Additional news search checked {day(industry.data.research.checkedAt)}.</p>}
      {canReadIndustry && industry.isLoading && <p className="text-xs text-muted-foreground">Loading industry news…</p>}
      {canReadIndustry && industry.isError && <p className="text-xs text-muted-foreground">Industry news could not be loaded. <button className="underline" onClick={() => industry.refetch()}>Try again</button></p>}
    </div>}
    {selected && (selected.type === "rssapp_instagram" && instagramUsername
      ? <LandlordInstagramPreview companyId={companyId} handle={instagramUsername} canSetUp={canSetUp} />
      : <ItemList key={selected.type} items={selected.items} landlord />)}
  </section>;

  return (
    <Card className={landlord ? "[container-type:inline-size]" : undefined} data-testid={landlord ? "landlord-news-social" : "brand-feed-card"}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Rss className="w-3.5 h-3.5" /> {landlord ? "News & social" : "Brand feed"}
          {!landlord && current?.sourceUrl && <a href={current.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] normal-case font-normal hover:text-foreground inline-flex items-center gap-1">Open page <ExternalLink className="w-3 h-3" /></a>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {landlord && (isLoading || isError) && <p className="text-xs text-muted-foreground">{isError ? <>Connected channels could not be loaded. <button className="underline" onClick={() => refetch()}>Try again</button></> : "Loading connected channels…"}</p>}
        {/* No read and none coming → no box; "The read isn't available right
            now" sat on top of the feed as a dead panel. */}
        {hasItems && (data?.read || read.isPending) && (
          <section className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1" data-testid="brand-feed-read">
            <h4 className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-primary" />{landlord ? "Channel summary" : "What's new"}</h4>
            {data?.read ? <AiCommentary text={data.read.text} />
              : read.isPending ? <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />{landlord ? "Reading connected sources…" : "Reading the brand's channels…"}</p>
              : <p className="text-xs text-muted-foreground">The read isn't available right now.</p>}
          </section>
        )}
        {landlord && tabs.length > 0 && <div className={`grid gap-4 ${newsTabs.length && socialTabs.length ? "[@container(min-width:760px)]:grid-cols-2" : "grid-cols-1"}`} data-testid="landlord-news-social-spread">
          {newsTabs.length > 0 && landlordChannel(newsTabs, newsCurrent, setActive, "News and media")}
          {socialTabs.length > 0 && landlordChannel(socialTabs, socialCurrent, setActiveSocial, "Social updates")}
        </div>}
        {!landlord && tabs.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {tabs.map(tab => (
              <Pill key={tab.type} active={current?.type === tab.type} onClick={() => setActive(tab.type)} data-testid={`brand-feed-tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {tab.type === "rssapp_instagram" && <Instagram className="w-3 h-3" />}{tab.label}{tab.items.length > 0 && <PillCount n={tab.items.length} active={current?.type === tab.type} />}
              </Pill>
            ))}
          </div>
        )}
        {!landlord && current && (current.type === "rssapp_instagram" ? <InstagramGrid companyId={companyId} /> : <ItemList items={current.items} />)}
        {landlord && !tabs.length && !isLoading && !isError && <p className="text-sm text-muted-foreground">No news or social feeds are connected yet. Only updates from connected sources will appear here.</p>}
        {canSetUp && (landlord ? missingOfficialKinds.length > 0 : !webTabs.length) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
            <p className="text-xs text-muted-foreground">{landlord ? `Connect ${missingOfficialKinds.map(kind => kind === "website" ? "website news" : "LinkedIn").join(" and ")} from the confirmed official website.` : "Follow this brand's openings page, website news, jobs and LinkedIn."}</p>
            <Button size="sm" variant="outline" disabled={setup.isPending} onClick={() => setup.mutate()} data-testid="button-brand-feed-setup">
              {setup.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}{setup.isPending ? "Finding pages…" : landlord ? "Follow official sources" : "Follow brand channels"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
