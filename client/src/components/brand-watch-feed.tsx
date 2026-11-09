// News → Brand watch: what brands are saying on their own channels (openings
// pages, website news, jobs, LinkedIn) beside London openings sites and
// landlord press — one stream with an AI note on top. Staff only.
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { AiCommentary } from "@/components/ai-commentary";

type WatchItem = { id: string; title: string; summary: string | null; url: string; image_url: string | null; at: string; type: string; label: string; source: string; brand_id: string | null; brand: string | null };
type WatchResponse = { filters: Array<{ key: string; label: string }>; items: WatchItem[]; read: { text: string; at: string; latest: string | null } | null };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const realImage = (url: string | null) => !!url && !/favicon|google\.com\/s2|gstatic/i.test(url);

export function BrandWatchFeed() {
  const [filter, setFilter] = useState("all");
  const key = ["/api/news/brand-watch", filter];
  const { data, isLoading, isError } = useQuery<WatchResponse>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/news/brand-watch?filter=${filter}`)).json(),
    staleTime: 5 * 60_000,
  });
  const read = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/news/brand-watch/read")).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/news/brand-watch"] }),
  });
  // Write the note once there's something newer than the saved one.
  useEffect(() => {
    if (!data?.items.length || read.isPending || read.isSuccess || read.isError) return;
    const newest = data.items[0]?.at ? new Date(data.items[0].at).getTime() : 0;
    if (!data.read || (data.read.latest && new Date(data.read.latest).getTime() < newest - 60_000)) read.mutate();
  }, [data]);

  return (
    <div className="space-y-3" data-testid="brand-watch-feed">
      <Card>
        <CardContent className="p-4 space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" />Brand watch — the last two weeks</h3>
          {data?.read ? <AiCommentary text={data.read.text} size="sm" />
            : read.isPending ? <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Reading brands' channels and London openings…</p>
            : <p className="text-sm text-muted-foreground">The note appears once brand channels have posted.</p>}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-1.5">
        {(data?.filters || [{ key: "all", label: "All" }]).map(f => <Pill key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`brand-watch-filter-${f.key}`}>{f.label}</Pill>)}
      </div>
      {isLoading ? <Skeleton className="h-64 w-full" />
        : isError ? <p className="text-sm text-muted-foreground">Brand watch is available in the staff view.</p>
        : !data?.items.length ? <p className="text-sm text-muted-foreground">Nothing in the last 60 days yet.</p>
        : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {data.items.map(item => (
                  <li key={item.id} className="p-3 flex gap-3 min-w-0" data-testid="brand-watch-item">
                    {realImage(item.image_url) && <img src={item.image_url!} alt="" className="w-14 h-14 rounded object-cover shrink-0 bg-muted" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border px-1.5 py-px">{item.label}</span>
                        {item.brand_id ? <Link href={`/companies/${item.brand_id}`} className="font-medium text-foreground hover:underline">{item.brand}</Link> : <span className="font-medium text-foreground">{item.source}</span>}
                        <span className="tabular-nums">{day(item.at)}</span>
                      </div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline break-words">{item.title}</a>
                      {item.summary && <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
