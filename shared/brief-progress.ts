// The success monitor on the Letting Tracker (Woody, 2026-11-12: "we need a
// success monitor in the letting tracker main table to show how close we are
// to hitting the brief").
//
// A unit's Targeting Brief says who to go after, by when and on what terms.
// "Hitting the brief" is the letting completing on those terms, so progress
// is a fixed ladder of steps from the brief being agreed to the lease
// completing. Each step is worked out from what the tracker already holds
// (the brief's sign-off and targets, the viewings, the offers, the unit's
// deal status); nothing is typed.
import { roundNetEffectiveRent } from "./unit-negotiation";

export interface BriefProgressInput {
  today: string;                       // yyyy-mm-dd
  statusCode: string | null;           // the unit's deal status as a code: AVA, NEG, HOT, SOL, EXC, COM, INV, WIT
  brief: {
    signoff?: { total: number; agreed: number; complete?: boolean } | null;
    minTargets?: number | null;        // how many target operators the brief asks for
    priorityTargets?: number | null;   // how many of them Priority A
    deadline1Date?: string | null;
    deadline2Date?: string | null;
    commercials?: { quotingRentPa?: number | null; nerFloorPa?: number | null } | null;
    targets?: { status?: string | null; priority?: string | null }[] | null;
  } | null;
  // The letting transaction recommendation, when BGP has written one: the
  // client's approval is then a step of its own.
  recommendation?: { stage: string; approved: number; total: number } | null;
  viewings: { status?: string | null; viewingDate?: string | null }[];
  offers: {
    status?: string | null; companyName?: string | null; rentPa?: number | null; rentFreeMonths?: number | null;
    termYears?: number | null; fittingOutContribution?: number | null;
  }[];
}

export interface BriefProgressStep {
  key: "agreed" | "targets" | "approached" | "viewing" | "offer" | "onBrief" | "terms" | "hots" | "clientApproval" | "solicitors" | "exchanged" | "completed";
  label: string;
  done: boolean;
  detail: string;        // where it stands, in words
  implied?: boolean;     // counted as done because the deal is past it, with nothing recorded
}

export interface BriefProgress {
  state: "no_brief" | "withdrawn" | "in_progress" | "complete";
  steps: BriefProgressStep[];
  done: number;
  total: number;
  percent: number;
  outcome: "hit" | "below" | "unmeasured" | null;   // for a completed letting: did it meet the brief's figure
  next: string | null;   // the next step still to do, as an instruction
  deadline: { label: string; date: string; days: number; overdue: boolean } | null;
}

export const DEFAULT_TARGETS_WANTED = 5;
export const DEFAULT_PRIORITY_WANTED = 2;

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const STAGE_ORDER = ["AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"];
const stageAt = (code: string | null, at: string) => {
  const i = STAGE_ORDER.indexOf(String(code || "").toUpperCase());
  return i >= 0 && i >= STAGE_ORDER.indexOf(at);
};
const isAgreedOffer = (s: string | null | undefined) => /^(agreed|accept)/i.test(String(s || ""));
const daysBetween = (from: string, to: string): number => {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`), b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : NaN;
};

const NEXT: Record<BriefProgressStep["key"], string> = {
  agreed: "get the brief agreed by everyone on it",
  targets: "add the target operators the brief asks for",
  approached: "approach the targets",
  viewing: "get a target to view the unit",
  offer: "bring in a first offer",
  onBrief: "move the offer up to the brief's terms",
  terms: "agree the terms",
  hots: "issue Heads of Terms",
  clientApproval: "get the client's decision on the transaction recommendation",
  solicitors: "instruct solicitors",
  exchanged: "exchange",
  completed: "complete the lease",
};

export function briefProgress(input: BriefProgressInput): BriefProgress {
  const code = String(input.statusCode || "").toUpperCase() || null;
  const empty = { steps: [] as BriefProgressStep[], done: 0, total: 0, percent: 0, next: null, deadline: null, outcome: null };
  if (!input.brief) return { state: "no_brief", ...empty };
  if (code === "WIT" || code === "ARCH") return { state: "withdrawn", ...empty };

  const b = input.brief;
  const targets = (b.targets || []).filter(Boolean);
  const live = targets.filter(t => (t.status || "Identified") !== "Passed");
  const wanted = b.minTargets && b.minTargets > 0 ? b.minTargets : DEFAULT_TARGETS_WANTED;
  const wantedA = b.priorityTargets != null && b.priorityTargets >= 0 ? b.priorityTargets : DEFAULT_PRIORITY_WANTED;
  const priorityA = targets.filter(t => t.priority === "A").length;
  const approached = targets.filter(t => (t.status || "Identified") !== "Identified").length;

  const held = input.viewings.filter(v => v.status === "completed").length;
  const booked = input.viewings.filter(v => (v.status || "scheduled") === "scheduled" && String(v.viewingDate || "").slice(0, 10) >= input.today).length;

  // Offers from an earlier letting of the unit ("Closed") are not this one's.
  const thisLetting = input.offers.filter(o => !/^closed/i.test(String(o.status || "")));
  const offers = thisLetting.filter(o => o.rentPa != null && Number(o.rentPa) > 0);
  // Agreed terms count whether or not a rent figure was logged on the offer.
  const agreedOffer = thisLetting.find(o => isAgreedOffer(o.status)) || null;
  const openOffers = offers.filter(o => !/^(rejected|withdrawn)/i.test(String(o.status || "")));
  const floor = Number(b.commercials?.nerFloorPa) > 0 ? Number(b.commercials?.nerFloorPa) : null;
  const quoting = Number(b.commercials?.quotingRentPa) > 0 ? Number(b.commercials?.quotingRentPa) : null;
  // The offer to measure against the brief: the agreed one, else the best
  // still on the table. A rejected or withdrawn offer is never the measure.
  // Like is ranked with like: with a floor set, offers whose net effective
  // rent can be worked out come first, by that figure; otherwise by rent.
  const pool = agreedOffer && Number(agreedOffer.rentPa) > 0 ? [agreedOffer] : openOffers;
  const scored = pool.map(o => ({ o, ner: roundNetEffectiveRent({ rentPa: o.rentPa, rentFreeMonths: o.rentFreeMonths, termYears: o.termYears, fittingOutContribution: o.fittingOutContribution }) }));
  const ranked = floor != null && scored.some(x => x.ner != null)
    ? scored.filter(x => x.ner != null).sort((x, y) => Number(y.ner) - Number(x.ner))
    : scored.sort((x, y) => Number(y.o.rentPa) - Number(x.o.rentPa));
  const best = ranked[0] || null;

  const s = b.signoff;
  const steps: BriefProgressStep[] = [];
  const add = (key: BriefProgressStep["key"], label: string, done: boolean, detail: string, implied = false) =>
    steps.push({ key, label, done, detail, ...(implied ? { implied: true } : {}) });

  add("agreed", "Brief agreed", !!s?.complete,
    s?.complete ? "Everyone on the brief has agreed it" : s && s.total > 0 ? `${s.agreed} of ${s.total} have agreed` : "No one is on the brief yet");
  add("targets", "Targets identified", targets.length >= wanted && priorityA >= wantedA,
    `${targets.length} of ${wanted} wanted${wantedA > 0 ? `, ${priorityA} of ${wantedA} Priority A` : ""}`);
  add("approached", "Targets approached", approached >= wanted,
    `${approached} of ${wanted} approached${live.length < targets.length ? `, ${targets.length - live.length} passed` : ""}`);

  // From here the deal's own stage settles it: a letting at Solicitors has
  // had its offer and its heads of terms whether or not anyone logged them.
  const pastOffer = stageAt(code, "HOT");
  add("viewing", "Viewing held", held > 0 || pastOffer,
    held > 0 ? `${held} held${booked ? `, ${booked} booked` : ""}` : booked ? `${booked} booked, none held yet` : pastOffer ? "None recorded" : "None yet",
    held === 0 && pastOffer);
  add("offer", "Offer received", offers.length > 0 || pastOffer,
    offers.length > 0 ? `${offers.length} ${offers.length === 1 ? "offer" : "offers"}${best ? `, best ${gbp(Number(best.o.rentPa))}${best.o.companyName ? ` from ${best.o.companyName}` : ""}` : ""}` : pastOffer ? "None recorded" : "None yet",
    offers.length === 0 && pastOffer);

  // Only when the brief sets a figure to measure against.
  if (floor != null || quoting != null) {
    let done = false, detail = "No offer to measure yet";
    if (best) {
      if (floor != null && best.ner != null) {
        done = best.ner >= floor;
        detail = `Net effective ${gbp(best.ner)} against a floor of ${gbp(floor)}`;
      } else if (quoting != null) {
        done = Number(best.o.rentPa) >= quoting;
        detail = `${gbp(Number(best.o.rentPa))} against a quoting rent of ${gbp(quoting)} (${Math.round((Number(best.o.rentPa) / quoting) * 100)}%)`;
      } else {
        detail = `${gbp(Number(best.o.rentPa))} offered; add the term to measure it against the floor of ${gbp(floor as number)}`;
      }
    }
    add("onBrief", "Offer meets the brief", done, detail);
  }

  add("terms", "Terms agreed", !!agreedOffer || pastOffer,
    agreedOffer ? `Agreed with ${agreedOffer.companyName || "the tenant"}${Number(agreedOffer.rentPa) > 0 ? ` at ${gbp(Number(agreedOffer.rentPa))}` : ""}` : pastOffer ? "Not recorded on an offer" : "Not yet",
    !agreedOffer && pastOffer);
  add("hots", "Heads of Terms issued", stageAt(code, "HOT"), stageAt(code, "HOT") ? "Issued" : "Not yet");
  if (input.recommendation) {
    const rec = input.recommendation;
    const approved = rec.stage === "approved";
    add("clientApproval", "Client approved the transaction", approved || stageAt(code, "SOL"),
      approved ? "Recommendation approved" : rec.stage === "declined" ? "Recommendation declined"
        : rec.stage === "issued" ? `Recommendation with the client, ${rec.approved} of ${rec.total} approved`
        : stageAt(code, "SOL") ? "Not recorded on the recommendation" : "Recommendation in draft",
      !approved && stageAt(code, "SOL"));
  }
  add("solicitors", "With solicitors", stageAt(code, "SOL"), stageAt(code, "SOL") ? "Instructed" : "Not yet");
  add("exchanged", "Exchanged", stageAt(code, "EXC"), stageAt(code, "EXC") ? "Exchanged" : "Not yet");
  add("completed", "Completed", stageAt(code, "COM"), stageAt(code, "COM") ? "Completed" : "Not yet");

  const done = steps.filter(x => x.done).length;
  const complete = stageAt(code, "COM");
  const firstOpen = steps.find(x => !x.done) || null;

  // The brief's own dates matter until the letting is with solicitors.
  let deadline: BriefProgress["deadline"] = null;
  if (!stageAt(code, "SOL")) {
    const dates = [
      { label: "Deadline 1", date: b.deadline1Date },
      { label: "Deadline 2", date: b.deadline2Date },
    ].filter(d => d.date && /^\d{4}-\d{2}-\d{2}/.test(String(d.date))) as { label: string; date: string }[];
    const withDays = dates.map(d => ({ ...d, date: d.date.slice(0, 10), days: daysBetween(input.today, d.date) })).filter(d => Number.isFinite(d.days));
    const coming = withDays.filter(d => d.days >= 0).sort((x, y) => x.days - y.days)[0];
    const passed = withDays.filter(d => d.days < 0).sort((x, y) => y.days - x.days)[0];
    const pick = coming || passed || null;
    if (pick) deadline = { label: pick.label, date: pick.date, days: Math.abs(pick.days), overdue: pick.days < 0 };
  }

  // A completed letting is finished, but whether it HIT the brief is the
  // "offer meets the brief" step: "hit", "below", or "unmeasured" when the
  // brief set no figure (or no offer was recorded to measure).
  const onBrief = steps.find(x => x.key === "onBrief") || null;
  return {
    state: complete ? "complete" : "in_progress",
    steps, done, total: steps.length,
    percent: Math.round((done / steps.length) * 100),
    next: complete || !firstOpen ? null : NEXT[firstOpen.key],
    deadline,
    outcome: !complete ? null : !onBrief || !best ? "unmeasured" : onBrief.done ? "hit" : "below",
  };
}
