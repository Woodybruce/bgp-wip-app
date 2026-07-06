import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type Tag = {
  id: string;
  name: string;
  label: string;
  active: boolean;
  sortOrder: number;
};

// Editable controlled vocabulary the AI scorer uses to tag news articles.
// Open to any logged-in user (no admin gate) — anyone in the company can
// curate the tagging taxonomy for their team's news view.
export function NewsTagsManager({ className }: { className?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState("");

  const { data: tags = [], isLoading } = useQuery<Tag[]>({
    queryKey: ["/api/news-feed/tags"],
    queryFn: async () => {
      const r = await fetch("/api/news-feed/tags", { headers: getAuthHeaders() });
      if (!r.ok) throw new Error("Failed to load tags");
      return r.json();
    },
  });

  const addMut = useMutation({
    mutationFn: async (raw: string) => {
      const name = raw.trim().toLowerCase();
      if (!name) throw new Error("Empty tag");
      const label = raw.trim().replace(/\b\w/g, c => c.toUpperCase());
      const r = await apiRequest("POST", "/api/news-feed/tags", { name, label });
      return r.json();
    },
    onSuccess: () => {
      setAdding("");
      qc.invalidateQueries({ queryKey: ["/api/news-feed/tags"] });
      toast({ title: "Tag added" });
    },
    onError: (e: any) => toast({ title: "Couldn't add tag", description: e?.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async (t: Tag) => {
      const r = await apiRequest("PATCH", `/api/news-feed/tags/${t.id}`, { active: !t.active });
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/news-feed/tags"] }),
  });

  const delMut = useMutation({
    mutationFn: async (t: Tag) => {
      await apiRequest("DELETE", `/api/news-feed/tags/${t.id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/news-feed/tags"] });
      toast({ title: "Tag removed" });
    },
  });

  const retagMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/news-feed/retag", { limit: 500 });
      return r.json();
    },
    onSuccess: (data: any) => toast({
      title: "Retagging started",
      description: `${data?.marked ?? 0} articles queued — they'll re-score on the next cron run (within ~10 min).`,
    }),
  });

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h3 className="text-sm font-semibold">Article tags</h3>
        <p className="text-xs text-muted-foreground">
          The AI tagger only uses tags from this list. Any logged-in user can edit. After adding a tag, click "Re-tag backlog" to apply it to recent articles.
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (adding.trim()) addMut.mutate(adding); }}
        className="flex gap-2"
      >
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Add tag (e.g. luxury, popups, e-commerce)"
          className="text-sm"
          data-testid="input-add-news-tag"
        />
        <Button type="submit" size="sm" disabled={!adding.trim() || addMut.isPending} data-testid="btn-add-news-tag">
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </form>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading tags…</p>
      ) : tags.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tags yet — add one above.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <div
              key={t.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                t.active ? "bg-background" : "bg-muted/50 text-muted-foreground"
              )}
              data-testid={`news-tag-${t.name}`}
            >
              <span>{t.label}</span>
              <button
                type="button"
                onClick={() => toggleMut.mutate(t)}
                className="opacity-60 hover:opacity-100"
                title={t.active ? "Disable tag" : "Enable tag"}
              >
                {t.active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => { if (confirm(`Delete tag "${t.label}"?`)) delMut.mutate(t); }}
                className="opacity-60 hover:opacity-100 hover:text-rose-600"
                title="Delete tag"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => retagMut.mutate()}
        disabled={retagMut.isPending}
        data-testid="btn-retag-news"
      >
        Re-tag recent backlog
      </Button>
    </div>
  );
}

// Filter chip strip — for use on news page + brand profile news widget.
// Pass selected tags and onChange handler; uses the same /api/news-feed/tags
// list so chips always reflect the editable vocabulary.
export function NewsTagFilterChips({
  selected,
  onChange,
  className,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  className?: string;
}) {
  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ["/api/news-feed/tags"],
    queryFn: async () => {
      const r = await fetch("/api/news-feed/tags", { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const activeTags = tags.filter(t => t.active);
  if (activeTags.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {activeTags.map((t) => {
        const on = selected.has(t.name);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              const next = new Set(selected);
              if (on) next.delete(t.name); else next.add(t.name);
              onChange(next);
            }}
            data-testid={`chip-news-tag-${t.name}`}
          >
            <Badge
              variant={on ? "default" : "outline"}
              className={cn("cursor-pointer hover:bg-accent transition-colors", on && "bg-foreground text-background")}
            >
              {t.label}
            </Badge>
          </button>
        );
      })}
      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className="text-xs text-muted-foreground hover:text-foreground underline self-center ml-1"
        >
          Clear
        </button>
      )}
    </div>
  );
}
