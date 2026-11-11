// Investment Tracker — presentation pop-out (Jack, 2026-11-10). Opened
// from the Present button on the tracker as its own resizable window: the
// board on its own, no app chrome, for showing the team on a screen. It is
// the same board — every cell edits exactly as it does in the app — with
// a zoom control so it reads from across a room. Listed by class with a
// section break per class, then upload date (client/src/lib/tracker-class.ts).
// On a phone it is a simpler look-only list instead — PhonePresentation.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InvestmentTracker } from "@shared/schema";
import { DEAL_STATUS_LABELS, legacyToCode } from "@shared/deal-status";
import { Pill } from "@/components/ui/pill";
import { ImageIcon, Minus, Plus } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTrackerHeroes, heroThumbUrl } from "@/components/tracker-hero-image";
import { TRACKER_CLASSES, trackerClass, compareByClassThenUpload } from "@/lib/tracker-class";
import InvestmentTrackerPage from "@/pages/investment-tracker";

const ZOOMS = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75];

const money = (n: number | null | undefined) => (n == null ? null : `£${n.toLocaleString("en-GB")}`);

// On a phone the presentation is a clean, look-only list (Jack,
// 2026-11-11): the photo, the name and the headline numbers under class
// headings — no filters, no Add Asset, and nothing that edits, because a
// stray tap on a small screen changes things. The only controls are the
// Purchases / Sales switch.
function PhonePresentation() {
  const initial = new URLSearchParams(window.location.search).get("board");
  const [board, setBoard] = useState<"Purchases" | "Sales">(initial === "Sales" ? "Sales" : "Purchases");
  const { data: items = [], isLoading } = useQuery<InvestmentTracker[]>({ queryKey: ["/api/investment-tracker"], refetchInterval: 60_000 });
  const { data: heroes = {} } = useTrackerHeroes();
  const sections = useMemo(() => {
    const rows = items
      .filter(i => (i.boardType || "Purchases") === board && !(i as any).soldCompId)
      .sort(compareByClassThenUpload);
    return TRACKER_CLASSES.map(cls => ({ cls, rows: rows.filter(r => trackerClass(r).cls === cls) })).filter(s => s.rows.length > 0);
  }, [items, board]);
  const total = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="tracker-present-phone">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pb-2.5 backdrop-blur" style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-serif text-xl font-semibold leading-none">Investment Tracker</h1>
          <div className="flex gap-1.5">
            {(["Purchases", "Sales"] as const).map(b => (
              <Pill key={b} active={board === b} onClick={() => setBoard(b)} data-testid={`present-phone-board-${b}`}>{b}</Pill>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{total} asset{total === 1 ? "" : "s"} · view only</p>
      </header>

      {isLoading && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading the tracker…</p>}
      {!isLoading && total === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No {board.toLowerCase()} on the tracker.</p>}

      <div style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
        {sections.map(section => (
          <section key={section.cls} data-testid={`present-phone-section-${section.cls}`}>
            <h2 className="sticky z-[5] bg-foreground px-4 py-1.5 text-background" style={{ top: "calc(4.4rem + env(safe-area-inset-top))" }}>
              <span className="font-serif text-sm font-semibold tracking-wide">{section.cls}</span>
              <span className="ml-2 text-[11px] opacity-75">{section.rows.length}</span>
            </h2>
            <ul className="divide-y">
              {section.rows.map(item => {
                const hero = item.propertyId ? heroes[item.propertyId] : undefined;
                const status = legacyToCode(item.status);
                const figures = [
                  money(item.guidePrice),
                  item.niy != null ? `${item.niy.toFixed(2)}%` : null,
                  item.sqft != null ? `${item.sqft.toLocaleString("en-GB")} sq ft` : null,
                ].filter(Boolean);
                return (
                  <li key={item.id} className="flex gap-3 px-4 py-3">
                    <div className="h-[72px] w-[108px] shrink-0 rounded-md border bg-card p-[3px] shadow-sm">
                      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[4px] bg-muted text-muted-foreground">
                        {hero?.imageStudioId
                          ? <img src={heroThumbUrl(hero.imageStudioId, hero.crop)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          : <ImageIcon className="h-4 w-4" />}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug">{item.assetName}</p>
                        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{(status && DEAL_STATUS_LABELS[status]) || item.status || "—"}</span>
                      </div>
                      {item.address && <p className="truncate text-xs text-muted-foreground">{item.address}</p>}
                      {figures.length > 0 && <p className="mt-1 text-xs font-medium tabular-nums">{figures.join("  ·  ")}</p>}
                      {(item.client || item.vendor) && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {[item.client ? `Client: ${item.client}` : null, item.vendor ? `Vendor: ${item.vendor}` : null].filter(Boolean).join("  ·  ")}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function InvestmentTrackerPresent() {
  const isMobile = useIsMobile();
  return isMobile ? <PhonePresentation /> : <DesktopPresentation />;
}

function DesktopPresentation() {
  const [zoom, setZoom] = useState(() => {
    try { const z = Number(localStorage.getItem("bgp_tracker_present_zoom")); return ZOOMS.includes(z) ? z : 1; } catch { return 1; }
  });
  useEffect(() => { try { localStorage.setItem("bgp_tracker_present_zoom", String(zoom)); } catch { /* private mode */ } }, [zoom]);
  useEffect(() => { document.title = "Investment Tracker — presentation"; }, []);
  const step = (d: number) => setZoom(z => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(z) + d))] ?? 1);

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col" data-testid="tracker-present">
      <div className="shrink-0 flex items-center justify-end gap-1.5 border-b px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">Size {Math.round(zoom * 100)}%</span>
        <Pill onClick={() => step(-1)} aria-label="Smaller" disabled={zoom === ZOOMS[0]} data-testid="present-zoom-out"><Minus className="h-3 w-3" /></Pill>
        <Pill onClick={() => step(1)} aria-label="Larger" disabled={zoom === ZOOMS[ZOOMS.length - 1]} data-testid="present-zoom-in"><Plus className="h-3 w-3" /></Pill>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* CSS zoom scales the layout, so the board is given the un-zoomed
            share of the height to fill the window exactly. */}
        <div style={{ zoom, height: `${100 / zoom}%` }}>
          <InvestmentTrackerPage present />
        </div>
      </div>
    </div>
  );
}
