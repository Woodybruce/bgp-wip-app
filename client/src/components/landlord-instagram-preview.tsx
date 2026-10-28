import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

type InstagramPost = { url: string; title?: string; imageUrl?: string | null; publishedAt?: string | null };
type InstagramFeed = { status: string; posts: InstagramPost[] };

export function landlordInstagramUsername(value?: string | null): string | null {
  const handle = String(value || "").trim();
  let username = handle.replace(/^@/, "");
  if (/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i.test(handle)) {
    try {
      const url = new URL(/^https?:\/\//i.test(handle) ? handle : `https://${handle}`);
      const segments = url.pathname.split("/").filter(Boolean);
      if (!/^(?:www\.)?instagram\.com$/i.test(url.hostname) || segments.length !== 1) return null;
      username = segments[0];
    } catch { return null; }
  }
  return /^[a-zA-Z0-9._]{1,30}$/.test(username) ? username : null;
}

export function LandlordInstagramPreview({ companyId, handle, canSetUp }: { companyId: string; handle: string; canSetUp: boolean }) {
  const username = landlordInstagramUsername(handle);
  const { data, isLoading, isError, isFetching, refetch } = useQuery<InstagramFeed>({
    queryKey: ["/api/brand", companyId, "instagram", "landlord", username, canSetUp],
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/instagram${canSetUp ? "?landlord=1" : ""}`)).json(),
    enabled: !!username,
    staleTime: 60_000,
    retry: false,
  });
  if (!username) return null;
  const posts = (data?.posts || []).filter(post => {
    try { const url = new URL(post.url); return /^https?:$/.test(url.protocol) && /(^|\.)instagram\.com$/i.test(url.hostname); } catch { return false; }
  }).slice(0, 6);
  return <section id={`landlord-instagram-${companyId}`} className="space-y-2 rounded-lg border border-border bg-background p-2.5" aria-label="Instagram feed">
    <div className="flex items-center justify-between gap-2 text-xs">
      <a href={`https://www.instagram.com/${username}/`} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">@{username}</a>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh Instagram feed"><RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
    </div>
    {isLoading ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading Instagram…</p>
      : posts.length ? <div className="grid grid-cols-3 gap-1.5">{posts.map(post => <a key={post.url} href={post.url} target="_blank" rel="noopener noreferrer" title={post.title || "Open Instagram post"} aria-label={post.title || "Open Instagram post"} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
        <span className="absolute inset-0 overflow-hidden p-2 text-xs leading-snug text-muted-foreground">{post.title || "View post"}</span>
        {post.imageUrl && <img src={`/api/ig-image?u=${encodeURIComponent(post.imageUrl)}`} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.style.display = "none"; }} />}
      </a>)}</div>
        : <p className="text-xs text-muted-foreground">{isError || data?.status === "feed_error" || data?.status === "not_configured" ? "The feed is unavailable here. Open the Instagram profile above." : "No posts are available here yet. You can open the Instagram profile above."}</p>}
  </section>;
}
