// One card for everything a brand says on its own channels — Instagram, its
// website's openings and news pages, its jobs page and LinkedIn — as tabs,
// with a short AI "what's new" read on top (Woody, 2026-09-24: "combined in
// the Instagram page maybe as tabs … then some AI commentary").
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Instagram, Loader2, Rss, Sparkles, ExternalLink } from "lucide-react";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill, PillCount } from "@/components/ui/pill";
import { AiCommentary } from "@/components/ai-commentary";

type FeedItem = { id: string; title: string; summary: string | null; url: string; image_url: string | null; at: string; type: string; baseline?: boolean; followed_at?: string | null };
type FeedTab = { type: string; label: string; sourceUrl: string | null; items: FeedItem[] };
type FeedResponse = { tabs: FeedTab[]; read: { text: string; at: string } | null; stale: boolean; latest: string | null };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmt = (n: number | null | undefined) => n == null ? null : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
const realImage = (url: string | null) => !!url && !/favicon|google\.com\/s2|gstatic/i.test(url);

// Opening a brand also asks for its Instagram, which creates the feed for a
// deal brand that has none yet (server side) — so the card always loads it.
function useInstagram(companyId: string) {
  return useQuery<any>({
    queryKey: ["/api/brand", companyId, "instagram"],
    queryFn: async () => { const r = await fetch(`/api/brand/${companyId}/instagram`, { headers: getAuthHeaders() }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
    staleTime: 15 * 60_000,
  });
}

function InstagramGrid({ companyId }: { companyId: string }) {
  const { data } = useInstagram(companyId);
  if (!data?.posts?.length) return <p className="text-xs text-muted-foreground">No Instagram posts synced yet.</p>;
  return (
    <div className="space-y-2">
      {fmt(data.followers) && <p className="text-[11px] text-muted-foreground"><strong className="text-foreground">{fmt(data.followers)}</strong> followers</p>}
      {/* Instagram's CDN rejects hotlinks — images go through our proxy. */}
      <div className="grid grid-cols-3 gap-1 max-h-[520px] overflow-y-auto pb-1">
        {data.posts.map((p: any, i: number) => (
          <a key={p.url || i} href={p.url} target="_blank" rel="noreferrer" title={p.title || ""} className="aspect-square w-full rounded border border-border/60 overflow-hidden bg-muted relative group block">
            <div className="absolute inset-0 p-1.5 text-[9px] leading-tight text-muted-foreground overflow-hidden">{(p.title || "").slice(0, 90)}</div>
            {p.imageUrl && <img src={`/api/ig-image?u=${encodeURIComponent(p.imageUrl)}`} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-end p-1.5 opacity-0 group-hover:opacity-100"><span className="text-white text-[9px] leading-tight line-clamp-3">{p.title}</span></div>
          </a>
        ))}
      </div>
    </div>
  );
}

function ItemList({ items }: { items: FeedItem[] }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">Nothing new on this page yet — new items appear as the brand posts them.</p>;
  const followed = items.find(item => item.baseline)?.followed_at;
  return (
    <div className="space-y-1.5">
    {/* The first read of a page is what was already there (existing sites,
        standing roles); anything added since is marked New. */}
    {followed && <p className="text-[11px] text-muted-foreground">Listed on the brand's page when BGP started following on {day(followed)} — anything added since is marked <span className="font-medium text-foreground">New</span>.</p>}
    <ul className="divide-y divide-border max-h-[520px] overflow-y-auto">
      {items.map(item => (
        <li key={item.id} className="py-2 flex gap-2.5 min-w-0">
          {realImage(item.image_url) && <img src={item.image_url!} alt="" className="w-12 h-12 rounded object-cover shrink-0 bg-muted" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
          <div className="min-w-0 flex-1">
            <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline break-words">{item.title}</a>
            <div className="text-[11px] text-muted-foreground tabular-nums flex items-center gap-1.5">
              {followed && !item.baseline && <span className="rounded-full bg-foreground text-background px-1.5 py-px text-[10px] font-semibold">New</span>}
              {!item.baseline && day(item.at)}
            </div>
            {item.summary && <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>}
          </div>
        </li>
      ))}
    </ul>
    </div>
  );
}

export function BrandFeedCard({ companyId, canSetUp = false }: { companyId: string; canSetUp?: boolean }) {
  const { toast } = useToast();
  const key = ["/api/brand", companyId, "feed"];
  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/feed`)).json(),
    staleTime: 10 * 60_000,
  });
  useInstagram(companyId);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => setActive(null), [companyId]);
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
      await apiRequest("POST", `/api/brand/${companyId}/feed/setup`, {});
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const job = await (await apiRequest("GET", `/api/brand/${companyId}/feed/setup`)).json();
        if (job.state === "done") return job.result;
        if (job.state === "error") throw new Error(job.error || "Setup failed");
      }
      throw new Error("Still working — check back in a minute");
    },
    onSuccess: (out: { results: Array<{ kind: string; status: string }> }) => {
      const made = out.results.filter(r => r.status === "created").map(r => r.kind);
      toast({ title: made.length ? `Following ${made.join(", ")}` : "Nothing new to follow", description: made.length ? "Items appear here now and update as the brand posts." : "No openings, news, jobs or LinkedIn page could be followed on this brand's site." });
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast({ title: "Couldn't set up feeds", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return null;
  const tabs = data.tabs;
  const webTabs = tabs.filter(tab => tab.type !== "rssapp_instagram");
  if (!tabs.length && !canSetUp) return null;
  const current = tabs.find(tab => tab.type === active) || tabs.find(tab => tab.items.length) || tabs[0];

  return (
    <Card data-testid="brand-feed-card">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Rss className="w-3.5 h-3.5" /> Brand feed
          {current?.sourceUrl && <a href={current.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto text-[10px] normal-case font-normal hover:text-foreground inline-flex items-center gap-1">Open page <ExternalLink className="w-3 h-3" /></a>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {hasItems && (
          <section className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1" data-testid="brand-feed-read">
            <h4 className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-primary" />What's new</h4>
            {data.read ? <AiCommentary text={data.read.text} />
              : read.isPending ? <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading the brand's channels…</p>
              : <p className="text-xs text-muted-foreground">The read isn't available right now.</p>}
          </section>
        )}
        {tabs.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {tabs.map(tab => (
              <Pill key={tab.type} active={current?.type === tab.type} onClick={() => setActive(tab.type)} data-testid={`brand-feed-tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {tab.type === "rssapp_instagram" && <Instagram className="w-3 h-3" />}{tab.label}{tab.items.length > 0 && <PillCount n={tab.items.length} active={current?.type === tab.type} />}
              </Pill>
            ))}
          </div>
        )}
        {current && (current.type === "rssapp_instagram" ? <InstagramGrid companyId={companyId} /> : <ItemList items={current.items} />)}
        {canSetUp && !webTabs.length && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
            <p className="text-xs text-muted-foreground">Follow this brand's openings page, website news, jobs and LinkedIn.</p>
            <Button size="sm" variant="outline" disabled={setup.isPending} onClick={() => setup.mutate()} data-testid="button-brand-feed-setup">
              {setup.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}{setup.isPending ? "Finding pages…" : "Follow brand channels"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
