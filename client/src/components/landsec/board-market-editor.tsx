// The board report's market report (Woody, 2026-11-19: "Me and Mark working
// together to provide overall analysis for him to present each quarter").
//
// One box per section, for the months and schemes picked on the Reports page.
// What is saved here is what the board report prints; a section with nothing
// saved is left out of the PDF. BGP staff can ask for a draft to start from:
// a draft only fills the box, and nothing prints until a person saves it.
// Who may read, save and draft is decided on the server
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
import { BOARD_MARKET_MAX, cleanMarketText, type BoardMarketKey, type BoardMarketReply, type BoardMarketSaved } from "@shared/landsec-board-report";

const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const savedLine = (s: BoardMarketSaved): string => {
  const at = s.savedAt ? new Date(s.savedAt) : null;
  const when = at && !Number.isNaN(at.getTime()) ? at.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";
  return `Saved by ${s.savedBy || "someone"} (${s.savedByFirm})${when ? ` on ${when}` : ""}`;
};

interface Box { text: string; drafted: boolean; check: string[]; sent: { facts: number; signals: number; research: number } | null }

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
      toast({ title: cleanMarketText(text) ? `${title} saved` : `${title} cleared`, description: cleanMarketText(text) ? "It will print in the board report." : "It will not print in the board report." });
    } catch (e) {
      toast({ title: `${title} was not saved`, description: (e as Error).message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: [url] });
    } finally { setBusy(null); }
  };

  const draft = async (key: BoardMarketKey, title: string, held: string) => {
    setBusy(`draft:${key}`);
    try {
      const res = await apiRequest("POST", "/api/landsec/reports/board-report/market/draft", { ...scope, key });
      const reply = await res.json() as { text: string; check: string[]; sent: Box["sent"] };
      set(key, { text: reply.text, drafted: true, check: reply.check || [], sent: reply.sent || null }, held);
    } catch (e) {
      toast({ title: `No draft for ${title}`, description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col gap-0 p-0 sm:h-auto sm:max-h-[88vh]" data-testid="board-market-editor">
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left sm:px-6">
          <DialogTitle className="text-lg font-semibold">Market report</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground" data-testid="board-market-scope">
            {data ? <>{data.period.label} · <span className="font-mono tabular-nums">{data.schemes.length}</span> {data.schemes.length === 1 ? "scheme" : "schemes"}. </> : null}
            What you save prints in the board report. A section with nothing saved is left out.
          </DialogDescription>
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
                    {section.saved ? savedLine(section.saved) : "Nothing saved: this section will not print"}
                  </p>
                </div>
                <Textarea
                  id={`board-market-text-${section.key}`} value={text} maxLength={BOARD_MARKET_MAX} rows={6}
                  className="min-h-[132px] text-base leading-relaxed md:text-sm"
                  placeholder={section.key === "overall" ? "The market as a whole this period, in your own words." : `What happened in ${section.title.toLowerCase()} this period, in your own words.`}
                  onChange={e => set(section.key, { text: e.target.value }, held)}
                  data-testid={`board-market-text-${section.key}`}
                />
                {box?.drafted && (
                  <div className="space-y-0.5 text-[11px] text-muted-foreground" role="status" data-testid={`board-market-draft-${section.key}`}>
                    <p>
                      A draft, not saved. It was written only from this report's figures
                      {box.sent ? <> (<span className="font-mono tabular-nums">{box.sent.facts}</span> lines), <span className="font-mono tabular-nums">{box.sent.signals}</span> public brand signals and <span className="font-mono tabular-nums">{box.sent.research}</span> competing-centre items</> : null}.
                      Check it, make it yours, then save.
                    </p>
                    {box.check.length > 0 && <p className="text-foreground">Check these figures, which were not in what it was written from: <span className="font-mono tabular-nums">{box.check.join(", ")}</span></p>}
                  </div>
                )}
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
