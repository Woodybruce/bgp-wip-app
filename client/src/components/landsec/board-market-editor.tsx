// The market report's words (Woody, 2026-11-19: "Me and Mark working together
// to provide overall analysis for him to present each quarter"; "a
// comprehensive market report broken into sectors").
//
// One box per section, for the months and schemes picked on the Reports page:
// Overall, each sector, and the competition. What is saved here is on a slide
// of the Market report and of the Board report; a section with nothing saved
// shows its items and no words. Under each box is what the section is written
// from: the items the report lists and, for BGP staff, what BGP's own team
// posted about the sector's brands, each with "Add to the report" to put its
// words in the box. BGP staff can ask for a draft of one section or of all of
// them: a draft only fills the box, and nothing is on a slide until a person
// saves it. Who may read, save and draft is decided on the server
// (server/landsec-board-market.ts): this dialog only asks.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BOARD_MARKET_MAX, cleanMarketText, type BoardMarketSaved } from "@shared/landsec-board-report";
import type { MarketTeamPost, MarketWordKey } from "@shared/landsec-market-report";

type BoardMarketKey = MarketWordKey;
interface BoardMarketReply {
  period: { from: string; to: string; label: string };
  schemes: string[];
  sections: Array<{ key: MarketWordKey; title: string; saved: BoardMarketSaved | null }>;
  canDraft: boolean;
}
/** What each section is written from (GET .../market/material). `posts` is empty for anyone but BGP staff. */
interface MarketSheet {
  sections: Array<{ key: MarketWordKey; title: string; facts: string[]; items: string[]; movers: string[]; research: string[]; themes: string[] }>;
  posts: MarketTeamPost[];
}

const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const savedLine = (s: BoardMarketSaved): string => {
  const at = s.savedAt ? new Date(s.savedAt) : null;
  const when = at && !Number.isNaN(at.getTime()) ? at.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";
  return `Saved by ${s.savedBy || "someone"} (${s.savedByFirm})${when ? ` on ${when}` : ""}`;
};

interface Box { text: string; drafted: boolean; check: string[]; sent: { facts: number; items: number; research: number; themes: number; posts: number } | null }

export function BoardMarketEditor({ open, onOpenChange, from, to, schemes }: {
  open: boolean; onOpenChange: (open: boolean) => void; from: string; to: string;
  /** The scheme keys ticked; null = every scheme on the login. */
  schemes: string[] | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = new URLSearchParams({ from, to });
  if (schemes) params.set("schemes", schemes.join(","));
  const url = `/api/landsec/reports/board-report/market?${params.toString()}`;
  const { data, isLoading, error } = useQuery<BoardMarketReply>({ queryKey: [url], enabled: open, retry: false, staleTime: 0 });
  // What each section is written from. It reads the whole report, so it is asked for once the dialog is open and kept a few minutes.
  const sheetUrl = `/api/landsec/reports/board-report/market/material?${params.toString()}`;
  const sheet = useQuery<MarketSheet>({ queryKey: [sheetUrl], enabled: open, retry: false, staleTime: 3 * 60 * 1000 });
  const [boxes, setBoxes] = useState<Partial<Record<BoardMarketKey, Box>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // What is typed and not yet saved is kept while the dialog stays on the same period and schemes.
  useEffect(() => { setBoxes({}); }, [url]);

  const scope = { from, to, schemes: schemes ? schemes.join(",") : "" };
  const set = (key: BoardMarketKey, box: Partial<Box>, held: string) =>
    setBoxes(prev => ({ ...prev, [key]: { text: held, drafted: false, check: [], sent: null, ...prev[key], ...box } }));

  const save = async (key: BoardMarketKey, title: string, text: string, loadedAt: string) => {
    setBusy(`save:${key}`);
    try {
      await apiRequest("PUT", "/api/landsec/reports/board-report/market", { ...scope, key, text, loadedAt });
      await queryClient.invalidateQueries({ queryKey: [url] });
      setBoxes(prev => { const next = { ...prev }; delete next[key]; return next; });
      toast({ title: cleanMarketText(text) ? `${title} saved` : `${title} cleared`, description: cleanMarketText(text) ? "It is on a slide of the market report and the board report." : "No words will show for this section." });
    } catch (e) {
      toast({ title: `${title} was not saved`, description: (e as Error).message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: [url] });
    } finally { setBusy(null); }
  };

  const draftOne = async (key: BoardMarketKey, held: string) => {
    const res = await apiRequest("POST", "/api/landsec/reports/board-report/market/draft", { ...scope, key });
    const reply = await res.json() as { text: string; check: string[]; sent: Box["sent"] };
    set(key, { text: reply.text, drafted: true, check: reply.check || [], sent: reply.sent || null }, held);
  };
  const draft = async (key: BoardMarketKey, title: string, held: string) => {
    setBusy(`draft:${key}`);
    try { await draftOne(key, held); }
    catch (e) { toast({ title: `No draft for ${title}`, description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  // A draft for every section that has nothing typed in it, one after the other. Each still has to be saved by a person.
  const draftAll = async () => {
    if (!data) return;
    let made = 0;
    for (const section of data.sections) {
      const held = section.saved?.text || "";
      if (boxes[section.key]?.text.trim() || held) continue;
      setBusy(`draft:${section.key}`);
      try { await draftOne(section.key, held); made += 1; }
      catch (e) { toast({ title: `No draft for ${section.title}`, description: (e as Error).message, variant: "destructive" }); break; }
    }
    setBusy(null);
    toast({ title: made ? `${made} ${made === 1 ? "section" : "sections"} drafted` : "Nothing to draft", description: made ? "Check each one, make it yours, then save it." : "Every section already has words. Clear one to draft it again." });
  };
  // A team post's words into a section's box, for the person to edit and save.
  const addPost = (key: BoardMarketKey, held: string, post: MarketTeamPost) => {
    const now = boxes[key]?.text ?? held;
    const line = `BGP's team reports: ${post.text}`;
    if (now.includes(post.text)) return;
    set(key, { text: [now.trim(), line].filter(Boolean).join("\n\n").slice(0, BOARD_MARKET_MAX) }, held);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col gap-0 p-0 sm:h-auto sm:max-h-[88vh]" data-testid="board-market-editor">
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left sm:px-6">
          <DialogTitle className="text-lg font-semibold">Market report</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground" data-testid="board-market-scope">
            {data ? <>{data.period.label} · <span className="font-mono tabular-nums">{data.schemes.length}</span> {data.schemes.length === 1 ? "scheme" : "schemes"}. </> : null}
            What you save is on a slide of the Market report and of the Board report. A section with nothing saved shows its items and no words.
          </DialogDescription>
          {data?.canDraft && (
            <div className="pt-2">
              <Button type="button" variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" disabled={!!busy} onClick={draftAll} data-testid="board-market-draft-all">
                {busy?.startsWith("draft:") ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                Draft all sections
              </Button>
            </div>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          {isLoading && [0, 1, 2].map(i => <Skeleton key={i} className="h-40 rounded-lg" />)}
          {error && !isLoading && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="board-market-error">
              The market report could not be loaded. {(error as Error).message.replace(/^\d+:\s*/, "")}
            </p>
          )}
          {data?.sections.map(section => {
            const held = section.saved?.text || "";
            const box = boxes[section.key];
            const text = box ? box.text : held;
            const changed = cleanMarketText(text) !== held;
            const saving = busy === `save:${section.key}`, drafting = busy === `draft:${section.key}`;
            return (
              <section key={section.key} className="space-y-1.5" aria-label={section.title} data-testid={`board-market-${section.key}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <label htmlFor={`board-market-text-${section.key}`} className={MICRO_LABEL}>{section.title}</label>
                  <p className="text-[11px] text-muted-foreground" data-testid={`board-market-saved-${section.key}`}>
                    {section.saved ? savedLine(section.saved) : "Nothing saved: no words will show for this section"}
                  </p>
                </div>
                <Textarea
                  id={`board-market-text-${section.key}`} value={text} maxLength={BOARD_MARKET_MAX} rows={6}
                  className="min-h-[132px] text-base leading-relaxed md:text-sm"
                  placeholder={section.key === "overall" ? "The market as a whole this period, in your own words." : section.key === "competition" ? "What other landlords and competing centres did this period, in your own words." : `What happened in ${section.title.toLowerCase()} this period, in your own words.`}
                  onChange={e => set(section.key, { text: e.target.value }, held)}
                  data-testid={`board-market-text-${section.key}`}
                />
                {box?.drafted && (
                  <div className="space-y-0.5 text-[11px] text-muted-foreground" role="status" data-testid={`board-market-draft-${section.key}`}>
                    <p>
                      A draft, not saved. It was written only from this section's material
                      {box.sent ? <> (<span className="font-mono tabular-nums">{box.sent.items}</span> items, <span className="font-mono tabular-nums">{box.sent.facts}</span> figures, <span className="font-mono tabular-nums">{box.sent.research + box.sent.themes}</span> research and theme lines and <span className="font-mono tabular-nums">{box.sent.posts}</span> team posts)</> : null}.
                      Check it, make it yours, then save.
                    </p>
                    {box.check.length > 0 && <p className="text-foreground">Check these figures, which were not in what it was written from: <span className="font-mono tabular-nums">{box.check.join(", ")}</span></p>}
                  </div>
                )}
                {(() => {
                  const from = sheet.data?.sections.find(x => x.key === section.key);
                  const posts = (sheet.data?.posts || []).filter(post => section.key === "overall" || post.section === section.key);
                  if (sheet.isLoading) return <p className="text-[11px] text-muted-foreground">Reading what this section is written from…</p>;
                  if (!from) return null;
                  return (
                    <>
                      <details className="rounded-md border bg-muted/30 text-xs" data-testid={`board-market-items-${section.key}`}>
                        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground sm:min-h-0 [&::-webkit-details-marker]:hidden">
                          Written from <span className="font-mono tabular-nums text-foreground">{from.items.length}</span> {from.items.length === 1 ? "item" : "items"}
                          {from.research.length + from.themes.length > 0 && <>, <span className="font-mono tabular-nums text-foreground">{from.research.length + from.themes.length}</span> research and theme lines</>}
                        </summary>
                        <ul className="max-h-56 space-y-1 overflow-y-auto border-t px-3 py-2">
                          {[...from.facts, ...from.movers.map(m => `Most active: ${m}`), ...from.items, ...from.research, ...from.themes].map((line, i) => <li key={i} className="break-words text-muted-foreground">{line}</li>)}
                          {from.items.length + from.research.length + from.themes.length === 0 && <li className="text-muted-foreground">Nothing is recorded for this section in the period.</li>}
                        </ul>
                      </details>
                      {posts.length > 0 && (
                        <details className="rounded-md border bg-muted/30 text-xs" data-testid={`board-market-posts-${section.key}`}>
                          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground sm:min-h-0 [&::-webkit-details-marker]:hidden">
                            <span className="font-mono tabular-nums text-foreground">{posts.length}</span> {posts.length === 1 ? "post" : "posts"} by BGP's team. Not in the report unless you add one and save.
                          </summary>
                          <ul className="max-h-56 space-y-2 overflow-y-auto border-t px-3 py-2">
                            {posts.map(post => (
                              <li key={post.id} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                <p className="min-w-0 break-words text-muted-foreground"><span className="font-mono tabular-nums">{post.day}</span> · <span className="text-foreground">{post.brands.join(", ")}</span> · {post.text}</p>
                                <Button type="button" variant="outline" size="sm" className="min-h-[44px] shrink-0 sm:min-h-0" disabled={!!busy || text.includes(post.text)} onClick={() => addPost(section.key, held, post)} data-testid={`board-market-add-post-${post.id}`}>
                                  {text.includes(post.text) ? "Added" : "Add to the report"}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  );
                })()}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="mr-auto font-mono text-[11px] tabular-nums text-muted-foreground">{text.length} / {BOARD_MARKET_MAX}</span>
                  {changed && !saving && (
                    <Button type="button" variant="ghost" size="sm" className="min-h-[44px] sm:min-h-0" disabled={!!busy} onClick={() => setBoxes(prev => { const next = { ...prev }; delete next[section.key]; return next; })} data-testid={`board-market-undo-${section.key}`}>
                      Undo changes
                    </Button>
                  )}
                  {data.canDraft && (
                    <Button type="button" variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" disabled={!!busy} onClick={() => draft(section.key, section.title, held)} data-testid={`board-market-draft-button-${section.key}`}>
                      {drafting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                      {drafting ? "Drafting" : "Draft"}
                    </Button>
                  )}
                  <Button type="button" size="sm" className="min-h-[44px] sm:min-h-0" disabled={!changed || !!busy} onClick={() => save(section.key, section.title, text, section.saved?.savedAt || "")} data-testid={`board-market-save-${section.key}`}>
                    {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    {saving ? "Saving" : "Save"}
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
