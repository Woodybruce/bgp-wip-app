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
import { FileText, Loader2, Filter, Sparkles, Download, ExternalLink, Printer, Wand2 } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PropertyResolverBar } from "@/components/property-resolver-bar";
// The other two authoring tools fold IN as tabs of this one Studio (rather
// than separate pages), so this is the single cockpit: ready briefs, the
// original template generator, and the card-deck builder.
import DocumentTemplates from "@/pages/document-templates";
import DecksPage from "@/pages/decks";

type StudioTab = "ready" | "templates" | "decks";

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
  const [iteratePrompt, setIteratePrompt] = useState("");
  const [iterating, setIterating] = useState(false);
  const [tab, setTab] = useState<StudioTab>("ready");

  // Context deep-link — this is the "one location fed from different
  // locations" hook. Any page (a property, a deal, a PLA matter, a Pathway
  // run, ChatBGP) can open the Studio pre-loaded by passing the property in
  // the URL and optionally narrowing to a doc type, e.g.
  //   /document-briefs?propertyId=abc&propertyName=12%20Hanover%20Sq&postcode=W1S&brief=brochure
  // We pre-resolve the property and pre-filter the catalogue; the user still
  // clicks Render (so we never spend an AI call on a stray navigation).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("propertyId");
    if (pid) {
      setProperty({
        id: pid,
        name: params.get("propertyName") || "Selected property",
        postcode: params.get("postcode"),
      });
    }
    const brief = params.get("brief") || params.get("briefId");
    if (brief) setSearch(brief);
    const t = params.get("tab");
    if (t === "ready" || t === "templates" || t === "decks") setTab(t);
  }, []);

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
      // Match name, description OR id — so a deep-link passing the brief id
      // (?brief=why-buy-memo) narrows the catalogue to that document.
      if (!b.name.toLowerCase().includes(q) && !b.description.toLowerCase().includes(q) && !b.id.toLowerCase().includes(q)) return false;
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

  const saveToSharePoint = async (format: "html" | "pdf" = "html") => {
    if (!renderedBriefId || !property) return;
    setSaving(true);
    try {
      const endpoint = format === "pdf" ? "save-pdf" : "save-html";
      const r = await fetch(`/api/document-briefs/${renderedBriefId}/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ propertyId: property.id }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => null);
        toast({
          title: format === "pdf" ? "PDF unavailable" : "Save failed",
          description: e?.fallback || e?.detail || e?.error || `${r.status}`,
          variant: "destructive",
        });
        return;
      }
      const data = await r.json();
      setSavedUrl(data.sharepointUrl);
      toast({ title: `Saved as ${format.toUpperCase()}`, description: data.filename });
    } finally {
      setSaving(false);
    }
  };

  const iterate = async () => {
    if (!renderedHtml || !iteratePrompt.trim()) return;
    setIterating(true);
    try {
      const r = await fetch("/api/document-briefs/iterate", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ baseHtml: renderedHtml, prompt: iteratePrompt }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => null);
        toast({ title: "Iterate failed", description: e?.error || `${r.status}`, variant: "destructive" });
        return;
      }
      const data = await r.json();
      setRenderedHtml(data.html);
      setSavedUrl(null); // user must save again
      setIteratePrompt("");
      toast({ title: "Updated", description: "Iframe refreshed with the new version" });
    } finally {
      setIterating(false);
    }
  };

  const printAsPdf = () => {
    if (!renderedHtml) return;
    // Open the HTML in a new window and trigger print. The HTML's CSS is
    // already @page A4 print-ready, so Save-as-PDF in the browser produces
    // a clean document. Native server-side PDF needs a headless renderer
    // (puppeteer / @sparticuz/chromium) — separate work item.
    const w = window.open("", "_blank");
    if (!w) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print, or use Download HTML and open it manually.", variant: "destructive" });
      return;
    }
    w.document.write(renderedHtml);
    w.document.close();
    setTimeout(() => {
      try { w.focus(); w.print(); } catch {}
    }, 300);
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="border-b bg-background sticky top-0 z-10 px-4 lg:px-6 py-3">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Document Studio</h1>
          <Badge variant="outline" className="text-xs gap-1">
            <Sparkles className="h-3 w-3" /> Claude design
          </Badge>
        </div>
        {/* One cockpit, three tools — ready briefs, the original template
            generator, and the card-deck builder, all in one place. */}
        <div className="flex items-center gap-1 border-b border-border -mb-px">
          {([
            { v: "ready", label: "Ready documents" },
            { v: "templates", label: "Your templates" },
            { v: "decks", label: "Decks" },
          ] as { v: StudioTab; label: string }[]).map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.v ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              data-testid={`studio-tab-${t.v}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "ready" && (
        <PropertyResolverBar
          current={property}
          onResolve={(id, prop) => setProperty({ id, name: prop.name, postcode: prop.postcode })}
        />
        )}
        {tab === "ready" && (
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
        )}
      </div>

      {tab === "ready" && (
      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
        {!property && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex items-start gap-2">
            <span className="font-medium shrink-0">Pick a property first</span>
            <span className="text-muted-foreground">— search an address, postcode or title number in the bar above and hit Resolve. The Run brief / Render buttons unlock once a property is set.</span>
          </div>
        )}
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
                <div className="flex items-center gap-2 flex-wrap">
                  {savedUrl && (
                    <a href={savedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" /> Open in SharePoint
                    </a>
                  )}
                  <Button size="sm" variant="ghost" onClick={printAsPdf} className="gap-1">
                    <Printer className="h-3 w-3" /> Print / Save as PDF
                  </Button>
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
                    variant="outline"
                    onClick={() => saveToSharePoint("html")}
                    disabled={saving}
                    className="gap-1"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Save HTML
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveToSharePoint("pdf")}
                    disabled={saving}
                    className="gap-1"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Save PDF
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
                Native PDF needs a chromium binary on the server (PUPPETEER_EXECUTABLE_PATH or SPARTICUZ_CHROMIUM_URL). If unavailable, Save HTML and use browser Print → Save as PDF.
              </div>
              <div className="px-2 py-2 border-t mt-2">
                <div className="text-xs font-medium mb-1.5 flex items-center gap-1">
                  <Wand2 className="h-3 w-3 text-muted-foreground" /> Iterate
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={iteratePrompt}
                    onChange={(e) => setIteratePrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && iteratePrompt.trim() && !iterating && iterate()}
                    placeholder='e.g. "make the cover punchier", "drop the risks section", "use BGP teal for accents"'
                    disabled={iterating}
                    className="text-sm"
                  />
                  <Button size="sm" onClick={iterate} disabled={!iteratePrompt.trim() || iterating} className="gap-1">
                    {iterating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Apply
                  </Button>
                </div>
                <div className="text-[10px] text-muted-foreground italic mt-1">
                  Each iteration replaces the preview. Save to SharePoint after the version you want lands.
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      )}

      {tab === "templates" && (
        <div className="flex-1 overflow-auto">
          <DocumentTemplates />
        </div>
      )}
      {tab === "decks" && (
        <div className="flex-1 overflow-auto">
          <DecksPage />
        </div>
      )}
    </div>
  );
}
