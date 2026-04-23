import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Rss, Plus, Trash2, RefreshCw, Zap, AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";

interface NewsSource {
  id: string;
  name: string;
  url: string;
  feedUrl: string | null;
  type: string; // rss | rssapp | google_news
  category: string | null;
  active: boolean;
  lastFetchedAt: string | null;
}

const CATEGORIES = ["Retail", "Hospitality", "Property", "Investment", "Development", "general"];

export function NewsSourcesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Retail");
  const [useRssApp, setUseRssApp] = useState(true);

  const { data: sources = [], isLoading } = useQuery<NewsSource[]>({
    queryKey: ["/api/news-feed/sources"],
  });

  const { data: rssHealth } = useQuery<{ ok: boolean; error?: string; feedCount?: number }>({
    queryKey: ["/api/rssapp/health"],
    retry: false,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (useRssApp) {
        const res = await apiRequest("POST", "/api/news-feed/sources/rssapp", { url, name, category });
        return res.json();
      } else {
        // direct RSS feed URL
        const res = await apiRequest("POST", "/api/news-feed/sources", {
          name: name || url,
          url,
          feedUrl: url,
          type: "rss",
          category,
        });
        return res.json();
      }
    },
    onSuccess: () => {
      toast({ title: "Source added", description: "Polling will pick up new items on the next cycle." });
      setUrl("");
      setName("");
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["/api/news-feed/sources"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add source", description: err?.message || "Unknown error", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/news-feed/sources/${id}`, { active });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/news-feed/sources"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/news-feed/sources/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Source removed" });
      qc.invalidateQueries({ queryKey: ["/api/news-feed/sources"] });
    },
  });

  const ensureBrandFeedsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/news-feed/ensure-brand-feeds");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Brand feeds ensured",
        description: `${data.created} new Google News feeds created (${data.total} tracked brands total).`,
      });
      qc.invalidateQueries({ queryKey: ["/api/news-feed/sources"] });
    },
  });

  const fetchNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/news-feed/fetch");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Fetched", description: data.message });
    },
  });

  const linkBrandsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/news-feed/link-brands?limit=500");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Brand signals updated", description: `Linked ${data.linked} articles across ${data.articles} scanned.` });
    },
  });

  const byType = (t: string) => sources.filter((s) => s.type === t);
  const brandFeeds = sources.filter((s) => s.category?.startsWith("brand:"));
  const genericFeeds = sources.filter((s) => !s.category?.startsWith("brand:"));

  return (
    <div className="space-y-4">
      {/* Health + controls */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Rss className="w-4 h-4" /> News sources
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {rssHealth?.ok ? (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="w-3 h-3 mr-1" /> RSS.app connected ({rssHealth.feedCount ?? 0} feeds)
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                <AlertCircle className="w-3 h-3 mr-1" /> RSS.app {rssHealth?.error ? `error: ${rssHealth.error.slice(0, 50)}` : "not configured"}
              </Badge>
            )}
            <Badge variant="outline">{sources.length} total</Badge>
            <Badge variant="outline">{byType("rss").length} direct RSS</Badge>
            <Badge variant="outline">{byType("rssapp").length} RSS.app</Badge>
            <Badge variant="outline">{byType("google_news").length} Google News</Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setShowAdd((s) => !s)}>
              <Plus className="w-4 h-4 mr-1" /> Add source
            </Button>
            <Button size="sm" variant="outline" onClick={() => ensureBrandFeedsMutation.mutate()} disabled={ensureBrandFeedsMutation.isPending}>
              <Zap className="w-4 h-4 mr-1" /> Ensure brand feeds
            </Button>
            <Button size="sm" variant="outline" onClick={() => fetchNowMutation.mutate()} disabled={fetchNowMutation.isPending}>
              <RefreshCw className={`w-4 h-4 mr-1 ${fetchNowMutation.isPending ? "animate-spin" : ""}`} /> Fetch now
            </Button>
            <Button size="sm" variant="outline" onClick={() => linkBrandsMutation.mutate()} disabled={linkBrandsMutation.isPending}>
              Re-link brands
            </Button>
          </div>

          {showAdd && (
            <div className="border rounded p-3 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2">
                <Switch id="use-rssapp" checked={useRssApp} onCheckedChange={setUseRssApp} />
                <Label htmlFor="use-rssapp" className="text-xs">
                  Auto-generate via RSS.app (for pages without RSS)
                </Label>
              </div>
              <Input
                placeholder={useRssApp ? "Page URL (e.g. https://corporate.marksandspencer.com/media)" : "Direct RSS feed URL"}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Input placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => addMutation.mutate()} disabled={!url || addMutation.isPending}>
                  {addMutation.isPending ? "Adding…" : "Add"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generic feeds table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Trade press &amp; general sources ({genericFeeds.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-1">
              {genericFeeds.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                  <Switch
                    checked={!!s.active}
                    onCheckedChange={(v) => toggleMutation.mutate({ id: s.id, active: v })}
                  />
                  <span className="font-medium truncate flex-1">{s.name}</span>
                  <Badge variant="outline" className="text-[10px]">{s.type}</Badge>
                  <Badge variant="outline" className="text-[10px]">{s.category || "general"}</Badge>
                  {s.feedUrl && (
                    <a href={s.feedUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => {
                    if (confirm(`Delete "${s.name}"?`)) deleteMutation.mutate(s.id);
                  }}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              {genericFeeds.length === 0 && <p className="text-xs text-muted-foreground italic">No sources yet.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Brand feeds — collapsed summary only to keep the list usable */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Per-brand Google News feeds ({brandFeeds.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            One feed per tracked brand, auto-seeded. Articles are linked to <code>brand_signals</code> on each fetch.
            Use <strong>Ensure brand feeds</strong> to add feeds for any newly-tracked brands.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
