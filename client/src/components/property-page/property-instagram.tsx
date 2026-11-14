import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Instagram, Loader2, Pencil } from "lucide-react";

type Post = { url: string; title?: string | null; imageUrl?: string | null };
type Feed = { status: "no_handle" | "pending" | "not_configured" | "feed"; handle: string | null; posts: Post[] };

// The property's own Instagram (BGP staff only), shown above its news.
export function PropertyInstagram({ propertyId }: { propertyId: string }) {
  const key = ["/api/properties", propertyId, "instagram"];
  const { data, isLoading, isError } = useQuery<Feed>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/properties/${propertyId}/instagram`)).json(),
    staleTime: 60_000,
    retry: false,
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: async (handle: string) => (await apiRequest("PUT", `/api/properties/${propertyId}/instagram`, { handle })).json(),
    onSuccess: () => { setEditing(false); queryClient.invalidateQueries({ queryKey: key }); },
  });
  if (isLoading || isError) return null;
  const handle = data?.handle || null;
  const posts = (data?.posts || []).filter(p => { try { return /(^|\.)instagram\.com$/i.test(new URL(p.url).hostname); } catch { return false; } }).slice(0, 6);

  if (editing || !handle) {
    return (
      <form className="flex items-center gap-2 rounded-lg border border-border p-2.5" data-testid="property-instagram-form"
        onSubmit={e => { e.preventDefault(); save.mutate(value); }}>
        <Instagram className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Input value={value} onChange={e => setValue(e.target.value)} placeholder="Centre's Instagram, e.g. @bluewateruk" className="h-8 text-xs" data-testid="input-property-instagram" />
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={save.isPending || (!value.trim() && !handle)}>
          {save.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
        </Button>
        {editing && <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(false)}>Cancel</Button>}
        {save.isError && <span className="text-xs text-destructive">{(save.error as Error)?.message?.replace(/^\d+:\s*/, "")}</span>}
      </form>
    );
  }

  return (
    <section className="space-y-2 rounded-lg border border-border p-2.5" aria-label="Instagram" data-testid="property-instagram">
      <div className="flex items-center justify-between gap-2 text-xs">
        <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2">
          <Instagram className="w-3.5 h-3.5" />@{handle}
        </a>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setValue(handle); setEditing(true); }} aria-label="Change Instagram handle">
          <Pencil className="w-3 h-3" />Change
        </Button>
      </div>
      {posts.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {posts.map(post => (
            <a key={post.url} href={post.url} target="_blank" rel="noopener noreferrer" title={post.title || "Open Instagram post"}
              className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
              <span className="absolute inset-0 overflow-hidden p-2 text-xs leading-snug text-muted-foreground">{post.title || "View post"}</span>
              {post.imageUrl && <img src={`/api/ig-image?u=${encodeURIComponent(post.imageUrl)}`} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = "none"; }} />}
            </a>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {data?.status === "not_configured" ? "The Instagram feed is not set up on this server. Open the profile above."
            : "Posts are being fetched. They will show here shortly; meanwhile open the profile above."}
        </p>
      )}
    </section>
  );
}
