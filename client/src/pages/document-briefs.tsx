/**
 * Document Briefs — catalog page.
 *
 * Single entry point for "what document do I want to make?" — pick a brief,
 * resolve a property, optionally link a matter / deal / Pathway run, then
 * run + render + save. Same machinery the matter-detail "Generate document"
 * dialog uses; this page is the standalone variant accessible from the
 * sidebar.
 *
 * Long-term the legacy /templates Document Studio page converges into this
 * (or this expands into it) — the brief registry is the single source of
 * truth either way.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Loader2, Filter, Sparkles, Download, ExternalLink } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PropertyResolverBar } from "@/components/property-resolver-bar";

type BriefMeta = {
  id: string;
  name: string;
  description: string;
  category: string;
  scope: string;
  requiredImagery: string[];
  optionalImagery: string[];
};

const CATEGORY_COLOR: Record<string, string> = {
  investment: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  letting: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  advisory: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  marketing: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "client-reporting": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
};

export default function DocumentBriefsPage() {
  const { toast } = useToast();
  const [property, setProperty] = useState<{ id: string; name: string; postcode: string | null } | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [running, setRunning] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [renderedBriefId, setRenderedBriefId] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [output, setOutput] = useState<any | null>(null);

  const { data: briefs = [], isLoading } = useQuery<BriefMeta[]>({
    queryKey: ["/api/document-briefs"],
    queryFn: async () => {
      const r = await fetch("/api/document-briefs", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const filtered = briefs.filter((b) => {
    if (categoryFilter !== "all" && b.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!b.name.toLowerCase().includes(q) && !b.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const categories = Array.from(new Set(briefs.map((b) => b.category))).sort();

  const run = async (briefId: string, withRender: boolean) => {
    if (!property) {
      toast({ title: "Resolve a property first", variant: "destructive" });
      return;
    }
    setRunning(briefId);
    setOutput(null);
    setRenderedHtml(null);
    setRenderedBriefId(null);
    setSavedUrl(null);
    if (withRender) setRendering(true);
    try {
      const endpoint = withRender ? "render" : "run";
      const res = await fetch(`/api/document-briefs/${briefId}/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ propertyId: property.id }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        toast({ title: "Failed", description: e?.error || `${res.status}`, variant: "destructive" });
        return;
      }
      const data = await res.json();
      const briefData = withRender ? data.brief : data;
      setOutput(briefData);
      if (withRender && data.html) {
        setRenderedHtml(data.html);
        setRenderedBriefId(briefId);
      }
      toast({
        title: `${briefData.briefName} ${withRender ? "rendered" : "ready"}`,
        description: property.name,
      });
    } finally {
      setRunning(null);
      setRendering(false);
    }
  };

  const saveToSharePoint = async () => {
    if (!renderedBriefId || !property) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/document-briefs/${renderedBriefId}/save-html`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ propertyId: property.id }),
      });
      if (!r.ok) {
        toast({ title: "Save failed", variant: "destructive" });
        return;
      }
      const data = await r.json();
      setSavedUrl(data.sharepointUrl);
      toast({ title: "Saved to SharePoint", description: data.filename });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="border-b bg-background sticky top-0 z-10 px-4 lg:px-6 py-3">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Document Briefs</h1>
          <Badge variant="outline" className="text-xs gap-1">
            <Sparkles className="h-3 w-3" /> Claude design
          </Badge>
        </div>
        <PropertyResolverBar
          current={property}
          onResolve={(id, prop) => setProperty({ id, name: prop.name, postcode: prop.postcode })}
        />
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search briefs…"
            className="max-w-xs"
          />
          <div className="flex items-center gap-1">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            {[
              { v: "all", label: "All" },
              ...categories.map((c) => ({ v: c, label: c.replace("-", " ") })),
            ].map((c) => (
              <Button
                key={c.v}
                variant={categoryFilter === c.v ? "default" : "ghost"}
                size="sm"
                onClick={() => setCategoryFilter(c.v)}
                className="h-7 text-xs capitalize"
              >
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((b) => (
              <Card key={b.id} className={`transition ${property ? "hover:border-primary/40" : "opacity-70"}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{b.name}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge className={CATEGORY_COLOR[b.category] || "bg-muted"} variant="secondary">{b.category.replace("-", " ")}</Badge>
                        <Badge variant="outline" className="text-[10px]">scope: {b.scope}</Badge>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{b.description}</p>
                  {b.requiredImagery.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Imagery:</span> {b.requiredImagery.map((k) => k.replace(/_/g, " ")).join(" · ")}
                    </p>
                  )}
                  <div className="flex justify-end gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => run(b.id, false)}
                      disabled={!property || running !== null}
                    >
                      {running === b.id && !rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run brief"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => run(b.id, true)}
                      disabled={!property || running !== null}
                      className="gap-1"
                    >
                      {running === b.id && rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Render
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {filtered.length === 0 && (
              <Card className="md:col-span-2"><CardContent className="p-8 text-center text-muted-foreground text-sm">
                No briefs match — try a different filter or search.
              </CardContent></Card>
            )}
          </div>
        )}

        {output && !renderedHtml && (
          <Card className="bg-muted/40">
            <CardContent className="p-4 space-y-2">
              <div className="font-medium text-sm">{output.title}</div>
              {output.subtitle && <div className="text-xs text-muted-foreground">{output.subtitle}</div>}
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Sections:</span> {output.sections.map((s: any) => s.heading).join(" · ")}
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Imagery resolved:</span>{" "}
                {Object.entries(output.imageryProvenance || {})
                  .map(([k, p]) => `${k.replace(/_/g, " ")} (${p})`)
                  .join(" · ")}
              </div>
            </CardContent>
          </Card>
        )}

        {renderedHtml && (
          <Card>
            <CardContent className="p-2">
              <div className="flex items-center justify-between px-2 py-1 gap-2 flex-wrap">
                <div className="text-xs font-medium">
                  Claude design preview · {output?.briefName}
                </div>
                <div className="flex items-center gap-2">
                  {savedUrl && (
                    <a href={savedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" /> Open in SharePoint
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const blob = new Blob([renderedHtml], { type: "text/html" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${(output?.briefName || "document").replace(/[^a-z0-9]+/gi, "-")}.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="gap-1"
                  >
                    <Download className="h-3 w-3" /> Download
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveToSharePoint}
                    disabled={saving}
                    className="gap-1"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Save to SharePoint
                  </Button>
                </div>
              </div>
              <iframe
                srcDoc={renderedHtml}
                className="w-full h-[60vh] border rounded"
                title="Claude design rendered output"
                sandbox="allow-same-origin"
              />
              <div className="text-[10px] text-muted-foreground italic px-2 py-1">
                HTML saves to the canonical SharePoint folder per brief category. PDF export via Cmd/Ctrl+P → Save as PDF in any browser; native PDF export lands when we wire a headless renderer.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
