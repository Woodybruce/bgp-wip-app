// Investment Tracker — presentation pop-out (Jack, 2026-11-10). Opened
// from the Present button on the tracker as its own resizable window: the
// board on its own, no app chrome, for showing the team on a screen. It is
// the same board — every cell edits exactly as it does in the app — with
// a zoom control so it reads from across a room. Listed by class with a
// section break per class, then upload date (client/src/lib/tracker-class.ts).
import { useEffect, useState } from "react";
import { Pill } from "@/components/ui/pill";
import { Minus, Plus } from "lucide-react";
import InvestmentTrackerPage from "@/pages/investment-tracker";

const ZOOMS = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75];

export default function InvestmentTrackerPresent() {
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
