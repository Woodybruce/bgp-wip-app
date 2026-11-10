// Investment Tracker — presentation pop-out (Jack, 2026-11-10). Opened
// from the Present button on the tracker as its own resizable window: just
// the table, no app chrome, for showing the board to the team on a screen.
// Read-only. Assets are listed by class (a section break per class), then
// by upload date, newest first; an asset with no class label gets a best
// estimate (client/src/lib/tracker-class.ts), marked "est.".
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InvestmentTracker } from "@shared/schema";
import { DEAL_STATUS_LABELS, legacyToCode } from "@shared/deal-status";
import { Pill } from "@/components/ui/pill";
import { ImageIcon, Minus, Plus } from "lucide-react";
import { useTrackerHeroes } from "@/components/tracker-hero-image";
import { TRACKER_CLASSES, trackerClass, compareByClassThenUpload } from "@/lib/tracker-class";

const BOARDS = ["Purchases", "Sales"] as const;
type Board = typeof BOARDS[number];
const SIZES = [12, 13, 14, 16, 18, 20];

const money = (n: number | null | undefined) => (n == null ? "—" : `£${n.toLocaleString("en-GB")}`);
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-GB"));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)}%`);
const clamp3 = { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden", lineHeight: 1.35, maxHeight: "4.05em" };

export default function InvestmentTrackerPresent() {
  const initial = new URLSearchParams(window.location.search).get("board");
  const [board, setBoard] = useState<Board>(initial === "Sales" ? "Sales" : "Purchases");
  const [size, setSize] = useState(() => {
    try { return Number(localStorage.getItem("bgp_tracker_present_size")) || 14; } catch { return 14; }
  });
  useEffect(() => { try { localStorage.setItem("bgp_tracker_present_size", String(size)); } catch { /* private mode */ } }, [size]);
  useEffect(() => { document.title = `Investment Tracker — ${board}`; }, [board]);

  const { data: items = [], isLoading } = useQuery<InvestmentTracker[]>({ queryKey: ["/api/investment-tracker"], refetchInterval: 60_000 });
  const { data: heroes = {} } = useTrackerHeroes();
  const { data: users = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/users"] });
  const firstName = useMemo(() => new Map(users.map(u => [u.id, (u.name || "").split(" ")[0]])), [users]);

  const sections = useMemo(() => {
    const rows = items.filter(i => (i.boardType || "Purchases") === board).sort(compareByClassThenUpload);
    return TRACKER_CLASSES
      .map(cls => ({ cls, rows: rows.filter(r => trackerClass(r).cls === cls) }))
      .filter(s => s.rows.length > 0);
  }, [items, board]);
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  const sale = board === "Sales";
  const cols = 12;
  const step = (d: number) => setSize(s => SIZES[Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(s) + d))] ?? 14);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground" style={{ fontSize: size }} data-testid="tracker-present">
      <header className="shrink-0 flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <h1 className="font-serif font-semibold leading-none" style={{ fontSize: "1.5em" }}>Investment Tracker</h1>
        <div className="flex gap-1.5">
          {BOARDS.map(b => <Pill key={b} active={board === b} onClick={() => setBoard(b)} data-testid={`present-board-${b}`}>{b}</Pill>)}
        </div>
        <span className="text-muted-foreground" style={{ fontSize: "0.85em" }}>{total} asset{total === 1 ? "" : "s"} · by class, newest first</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-muted-foreground" style={{ fontSize: "0.8em" }}>Text size</span>
          <Pill onClick={() => step(-1)} aria-label="Smaller text" disabled={size === SIZES[0]}><Minus className="h-3 w-3" /></Pill>
          <Pill onClick={() => step(1)} aria-label="Larger text" disabled={size === SIZES[SIZES.length - 1]}><Plus className="h-3 w-3" /></Pill>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold [&>th]:whitespace-nowrap" style={{ fontSize: "0.8em" }}>
              <th>Image</th>
              <th>Property</th>
              <th>Tenure</th>
              <th className="text-right">Guide price</th>
              <th className="text-right">NIY</th>
              <th className="text-right">Sq ft</th>
              <th className="text-right">Rent (pa)</th>
              <th>Client</th>
              <th>{sale ? "Buyer" : "Vendor / agent"}</th>
              <th>Status</th>
              <th>BGP</th>
              <th>Notes</th>
            </tr>
          </thead>
          {isLoading && <tbody><tr><td colSpan={cols} className="px-4 py-10 text-center text-muted-foreground">Loading the tracker…</td></tr></tbody>}
          {!isLoading && total === 0 && <tbody><tr><td colSpan={cols} className="px-4 py-10 text-center text-muted-foreground">No {board.toLowerCase()} on the tracker.</td></tr></tbody>}
          {sections.map(section => {
            const guide = section.rows.reduce((a, r) => a + (r.guidePrice || 0), 0);
            return (
              <tbody key={section.cls} data-testid={`present-section-${section.cls}`}>
                <tr className="bg-foreground text-background">
                  <td colSpan={cols} className="px-4 py-2">
                    <span className="font-serif font-semibold tracking-wide" style={{ fontSize: "1.25em" }}>{section.cls}</span>
                    <span className="ml-3 opacity-75" style={{ fontSize: "0.85em" }}>
                      {section.rows.length} asset{section.rows.length === 1 ? "" : "s"}{guide > 0 ? ` · guide ${money(guide)}` : ""}
                    </span>
                  </td>
                </tr>
                {section.rows.map(item => {
                  const hero = item.propertyId ? heroes[item.propertyId] : undefined;
                  const status = legacyToCode(item.status);
                  const est = trackerClass(item).estimated;
                  const party = sale ? item.buyer : [item.vendor, item.vendorAgent].filter(Boolean).join(" / ");
                  const team = (item.agentUserIds || []).map(id => firstName.get(id)).filter(Boolean).join(", ");
                  return (
                    <tr key={item.id} className="border-b align-middle [&>td]:px-3 [&>td]:py-2">
                      <td style={{ width: "9.5em" }}>
                        <div className="rounded overflow-hidden border bg-muted/60 flex items-center justify-center text-muted-foreground" style={{ width: "9em", height: "6em" }}>
                          {hero?.imageStudioId
                            ? <img src={`/api/image-studio/${hero.imageStudioId}/thumb`} alt={item.assetName} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            : <ImageIcon style={{ width: "1.4em", height: "1.4em" }} />}
                        </div>
                      </td>
                      <td style={{ minWidth: "13em" }}>
                        <div className="font-semibold">{item.assetName}</div>
                        {item.address && <div className="text-muted-foreground" style={{ fontSize: "0.85em" }}>{item.address}</div>}
                        {est && <div className="text-muted-foreground italic" style={{ fontSize: "0.75em" }}>class est.</div>}
                      </td>
                      <td style={{ maxWidth: "12em" }}><div style={clamp3} title={item.tenure || undefined}>{item.tenure || "—"}</div></td>
                      <td className="text-right tabular-nums whitespace-nowrap">{money(item.guidePrice)}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{pct(item.niy)}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{num(item.sqft)}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{money(item.currentRent)}</td>
                      <td>{item.client || "—"}</td>
                      <td>{party || "—"}</td>
                      <td className="whitespace-nowrap">
                        <span className="inline-block rounded-full border px-2 py-0.5" style={{ fontSize: "0.8em" }}>{(status && DEAL_STATUS_LABELS[status]) || item.status || "—"}</span>
                      </td>
                      <td className="whitespace-nowrap">{team || "—"}</td>
                      <td style={{ minWidth: "14em", maxWidth: "24em" }}><div style={clamp3} title={item.notes || undefined}>{item.notes || "—"}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
