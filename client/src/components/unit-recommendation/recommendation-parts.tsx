// The read-only blocks of the transaction recommendation workspace: the
// measure against the brief, how the bid moved, and the history.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RecommendationEvent, RecommendationMeasure, RecommendationWorkspace } from "@shared/unit-recommendation";
import { TONE_GOOD, TONE_WARN, fmtDate, fmtWhen } from "@/components/unit-hots/hots-api";
import { FIGURE, SECTION, SECTION_TITLE, money, psf } from "./recommendation-format";

const HISTORY_SHOWN = 6;
const notGiven = <span className="text-muted-foreground">Not provided</span>;

// "92% of ERV" in green at or above 100%, amber below.
function Against({ pct, of, testId }: { pct: number | null; of: string; testId: string }) {
  if (pct === null) return null;
  return <span className={cn("text-xs font-medium", pct >= 100 ? TONE_GOOD : TONE_WARN)} data-testid={testId}>{pct.toLocaleString("en-GB", { maximumFractionDigits: 1 })}% of {of}</span>;
}

export function RecommendationMeasureTable({ measure, rentPa, dirty }: { measure: RecommendationMeasure; rentPa: number | null; dirty: boolean }) {
  const m = measure;
  const rows: { key: string; label: string; figure: string; note?: JSX.Element | null }[] = [
    { key: "quoting", label: "Quoting rent a year", figure: money(m.quotingRentPa) },
    { key: "erv", label: "ERV a year", figure: money(m.ervPa) },
    { key: "headline", label: "Headline rent a year", figure: money(rentPa), note: <Against pct={m.headlineVsErvPct} of="ERV" testId="recommendation-measure-vs-erv" /> },
    { key: "psf", label: "Rent per sq ft", figure: psf(m.headlinePsf) },
    { key: "ner", label: "Net effective rent a year", figure: money(m.nerPa), note: <Against pct={m.nerVsFloorPct} of="the floor" testId="recommendation-measure-vs-floor" /> },
    { key: "ner-fitout", label: "Net effective rent less three months' fit-out", figure: money(m.nerLessFitOutPa) },
    { key: "floor", label: "Net effective rent floor", figure: money(m.nerFloorPa) },
    { key: "occupancy", label: "Total occupational cost a year", figure: money(m.occupancyCostPa),
      note: m.occupancyCostPsf !== null ? <span className="text-xs text-muted-foreground">{psf(m.occupancyCostPsf)} per sq ft</span> : null },
  ];
  const missing = [m.ervPa === null ? "ERV" : "", m.nerFloorPa === null ? "net effective floor" : ""].filter(Boolean);
  return (
    <section className={SECTION} data-testid="recommendation-measure">
      <h3 className={SECTION_TITLE}>Against the brief</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b align-baseline last:border-b-0" data-testid={`recommendation-measure-${r.key}`}>
              <th scope="row" className="py-1.5 pr-3 text-left text-xs font-normal text-muted-foreground sm:text-sm">{r.label}</th>
              <td className="whitespace-nowrap py-1.5 text-right">{r.figure ? <span className={FIGURE}>{r.figure}</span> : notGiven}</td>
              <td className="hidden w-[38%] py-1.5 pl-3 sm:table-cell">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* On a phone the comparisons sit under the table, where there is room. */}
      {(m.headlineVsErvPct !== null || m.nerVsFloorPct !== null) && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs sm:hidden">
          {m.headlineVsErvPct !== null && <span>Headline rent: <Against pct={m.headlineVsErvPct} of="ERV" testId="recommendation-measure-vs-erv-phone" /></span>}
          {m.nerVsFloorPct !== null && <span>Net effective rent: <Against pct={m.nerVsFloorPct} of="the floor" testId="recommendation-measure-vs-floor-phone" /></span>}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Net effective rent is the headline rent less the rent free and the capital contribution, spread over the term. Total occupational cost is rent, service charge, rates and insurance.</p>
      {missing.length > 0 && (
        <p className={cn("text-xs", TONE_WARN)} data-testid="recommendation-measure-brief-gap">
          The brief has no {missing.join(" or ")} yet. Add {missing.length === 1 ? "it" : "them"} on the Targeting Brief under Commercials.
        </p>
      )}
      {dirty && <p className="text-xs text-muted-foreground" data-testid="recommendation-measure-saved-note">These figures are for the saved version. Save your changes to update them.</p>}
    </section>
  );
}

const partyLabel = (p: string): string => (p === "landlord" ? "Landlord" : p === "tenant" ? "Tenant" : p ? `${p.charAt(0).toUpperCase()}${p.slice(1)}` : "");

export function RecommendationRounds({ rounds }: { rounds: RecommendationWorkspace["rounds"] }) {
  const dash = <span className="text-muted-foreground">-</span>;
  return (
    <section className={SECTION} data-testid="recommendation-rounds">
      <h3 className={SECTION_TITLE}>How the bid moved</h3>
      {rounds.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="recommendation-rounds-empty">No negotiation rounds are logged for this offer.</p>
      ) : (
        <>
          <div className="hidden md:block">
            <table className="w-full table-fixed text-xs" data-testid="recommendation-rounds-table">
              <thead>
                <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="w-[7%] py-1.5 pr-2 font-semibold">Round</th>
                  <th className="w-[12%] py-1.5 pr-2 font-semibold">Date</th>
                  <th className="w-[10%] py-1.5 pr-2 font-semibold">Who</th>
                  <th className="w-[12%] py-1.5 pr-2 text-right font-semibold">Rent a year</th>
                  <th className="w-[10%] py-1.5 pr-2 text-right font-semibold">Rent free</th>
                  <th className="w-[8%] py-1.5 pr-2 text-right font-semibold">Term</th>
                  <th className="w-[14%] py-1.5 pr-2 text-right font-semibold">Capital contribution</th>
                  <th className="py-1.5 pl-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map(r => (
                  <tr key={r.roundNo} className="border-b align-top last:border-b-0" data-testid={`recommendation-round-${r.roundNo}`}>
                    <td className={cn("py-1.5 pr-2", FIGURE)}>{r.roundNo}</td>
                    <td className="py-1.5 pr-2">{fmtDate(r.roundDate)}</td>
                    <td className="py-1.5 pr-2">{partyLabel(r.party)}</td>
                    <td className={cn("py-1.5 pr-2 text-right", FIGURE)}>{r.rentPa !== null ? money(r.rentPa) : dash}</td>
                    <td className={cn("py-1.5 pr-2 text-right", FIGURE)}>{r.rentFreeMonths !== null ? `${r.rentFreeMonths} mo` : dash}</td>
                    <td className={cn("py-1.5 pr-2 text-right", FIGURE)}>{r.termYears !== null ? `${r.termYears} yr` : dash}</td>
                    <td className={cn("py-1.5 pr-2 text-right", FIGURE)}>{r.capitalContribution !== null ? money(r.capitalContribution) : dash}</td>
                    <td className="break-words py-1.5 pl-2 text-muted-foreground">{r.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ol className="space-y-2 md:hidden" data-testid="recommendation-rounds-cards">
            {rounds.map(r => (
              <li key={r.roundNo} className="space-y-1 rounded-md border p-2.5 text-xs" data-testid={`recommendation-round-card-${r.roundNo}`}>
                <p className="font-medium">Round {r.roundNo} · {fmtDate(r.roundDate)} · {partyLabel(r.party)}</p>
                <p className={FIGURE}>
                  {[r.rentPa !== null ? `${money(r.rentPa)} a year` : "", r.rentFreeMonths !== null ? `${r.rentFreeMonths} months rent free` : "", r.termYears !== null ? `${r.termYears} year term` : "",
                    r.capitalContribution !== null ? `${money(r.capitalContribution)} capital contribution` : ""].filter(Boolean).join(" · ") || "No figures"}
                </p>
                {r.note && <p className="break-words text-muted-foreground">{r.note}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function RecommendationHistory({ events }: { events: RecommendationEvent[] }) {
  const [all, setAll] = useState(false);
  if (events.length === 0) return null;
  // Oldest first; a long history shows its latest lines until asked for all.
  const shown = all || events.length <= HISTORY_SHOWN ? events : events.slice(-HISTORY_SHOWN);
  return (
    <section className={SECTION} data-testid="recommendation-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>History</h3>
        {events.length > HISTORY_SHOWN && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(v => !v)} data-testid="recommendation-history-toggle">
            {all ? "Show latest" : `Show all ${events.length}`}
          </Button>
        )}
      </div>
      <ol className="space-y-2.5">
        {shown.map(e => {
          const body = (e.body || e.kind).trim();
          return (
            <li key={e.id} className="border-l-2 border-border pl-2.5" data-testid={`recommendation-event-${e.id}`}>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{e.authorName || "Someone"}</span>
                {e.authorRole ? ` · ${e.authorRole}` : ""} · {fmtWhen(e.createdAt)}{e.version !== null ? ` · version ${e.version}` : ""}
              </p>
              <p className="whitespace-pre-line break-words text-xs">{body.charAt(0).toUpperCase() + body.slice(1)}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
