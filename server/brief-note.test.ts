// A plain note read into a unit's Targeting Brief (Woody, 2026-11-19: "brief
// form needs our type and populate tool").
//   node --import tsx --test server/brief-note.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { checkBriefNote, countFromNote, figureFromNote, moneyFigures, textFromNote, categoryOnList } from "../shared/brief-note";
import { readBriefNote, BriefNoteReaderError, briefNoteTool, briefNotePrompt } from "./brief-note-reader";

const today = "2026-11-19";
const taxonomy = ["Tenant - Restaurant", "Tenant - Leisure", "Tenant - Coffee", "Tenant - Fashion"];
const note = "Hammerson want a restaurant or leisure operator for Unit E01Y, no extract. Instructed 17 November. "
  + "Quoting £90k pa on a 10 year lease with a tenant break at year 5, up to 6 months rent free and a capital contribution of £50,000. "
  + "Turnover top-up at 8% of sales. Five targets, two of them priority A, by 5 December; meetings with the priority A operators by 19 December. "
  + "Success is a signed HOTs before Christmas.";

const answer = {
  title: "Restaurant or leisure operator for Unit E01Y",
  clientCompany: "Hammerson",
  objective: "Hammerson want a restaurant or leisure operator for Unit E01Y, no extract.",
  successMeasures: "Success is a signed HOTs before Christmas.",
  deadline1Deliverables: "Five targets, two of them priority A",
  deadline2Deliverables: "meetings with the priority A operators",
  priorityCategories: [{ name: "Tenant - Restaurant", quote: "restaurant" }, { name: "Leisure", quote: "leisure operator" }],
  instructedDate: { date: "2026-11-17", quote: "Instructed 17 November" },
  deadline1Date: { date: "2026-12-05", quote: "by 5 December" },
  deadline2Date: { date: "2026-12-19", quote: "by 19 December" },
  minTargets: { value: 5, quote: "Five targets" },
  priorityTargets: { value: 2, quote: "two of them priority A" },
  commercials: {
    quotingRentPa: { value: 90000, quote: "Quoting £90k pa" },
    leaseTermYears: { value: 10, quote: "10 year lease" },
    breakOption: "a tenant break at year 5",
    rentFreeMonthsMax: { value: 6, quote: "up to 6 months rent free" },
    capitalContributionMax: { value: 50000, quote: "a capital contribution of £50,000" },
    turnoverRentPct: { value: 8, quote: "8% of sales" },
  },
};

test("a brief note fills every box it states, the commercials included", () => {
  const r = checkBriefNote(answer, { text: note, today, taxonomy });
  assert.deepEqual(r.fields, {
    title: "Restaurant or leisure operator for Unit E01Y",
    clientCompany: "Hammerson",
    objective: "Hammerson want a restaurant or leisure operator for Unit E01Y, no extract.",
    successMeasures: "Success is a signed HOTs before Christmas.",
    deadline1Deliverables: "Five targets, two of them priority A",
    deadline2Deliverables: "meetings with the priority A operators",
    instructedDate: "2026-11-17",
    deadline1Date: "2026-12-05",
    deadline2Date: "2026-12-19",
    minTargets: "5",
    priorityTargets: "2",
  });
  assert.deepEqual(r.categories, ["Tenant - Restaurant", "Tenant - Leisure"], "a category named by its short form is the list's entry");
  assert.deepEqual(r.commercials, { quotingRentPa: "90000", rentFreeMonthsMax: "6", capitalContributionMax: "50000", leaseTermYears: "10", breakOption: "a tenant break at year 5", turnoverRentPct: "8" });
  assert.deepEqual(r.filledCommercials, ["Quoting rent", "Rent free, up to", "Capital contribution, up to", "Lease term", "Break", "Turnover rent"]);
  assert.deepEqual(r.notPlaced, []);
  assert.equal(r.filled[0], "Title");
});

test("nothing the note does not say reaches a box: each is listed back with its reason", () => {
  const r = checkBriefNote({
    title: "Luxury fashion flagship programme for the West End",
    clientCompany: "Landsec",
    objective: "Secure a best-in-class anchor that elevates the scheme's luxury positioning nationally.",
    priorityCategories: [{ name: "Tenant - Fashion", quote: "fashion flagship" }, { name: "Tenant - Cinema", quote: "cinema" }],
    deadline1Date: { date: "2026-12-12", quote: "by 5 December" },
    minTargets: { value: 8, quote: "Five targets" },
    commercials: {
      quotingRentPa: { value: 120000, quote: "Quoting £90k pa" },
      ervPa: { value: 100000, quote: "an ERV of £100k" },
      rentFreeMonthsMax: { value: 9, quote: "up to 6 months rent free" },
    },
  }, { text: note, today, taxonomy });
  assert.deepEqual(r.fields, {});
  assert.deepEqual(r.categories, []);
  assert.deepEqual(r.commercials, {});
  assert.deepEqual(r.notPlaced, [
    "Title: its words are not the note's",
    "Client: “Landsec” is not how the note names them",
    "Objective: not in the note's own words",
    "Priority category: Fashion: the note does not ask for it",
    "Priority category: “Tenant - Cinema” is not on this brief's category list",
    "Deadline 1: “by 5 December” does not give that date",
    "Targets wanted: “Five targets” does not give that number",
    "Quoting rent: “Quoting £90k pa” does not hold 120,000",
    "ERV: the words it was read from are not in the note",
    "Rent free, up to: “up to 6 months rent free” does not give 9 months",
  ]);
});

test("money is a year's: a month's or a square foot's figure is sent back, never filled", () => {
  const n = "Quoting £45 psf, or £7,500 pcm on the upper floor. Service charge £12,400 pa. Rates £1.2m.";
  assert.deepEqual(figureFromNote("money", "quotingRentPa", 45, "Quoting £45 psf", n), { ok: false, why: "“Quoting £45 psf” is not a figure for a year: work it out and type it in" });
  assert.equal(figureFromNote("money", "quotingRentPa", 7500, "£7,500 pcm", n).ok, false);
  assert.deepEqual(figureFromNote("money", "serviceChargePa", 12400, "Service charge £12,400 pa", n), { ok: true, value: 12400 });
  assert.deepEqual(figureFromNote("money", "ratesPayablePa", 1200000, "Rates £1.2m", n), { ok: true, value: 1200000 });
  assert.deepEqual(moneyFigures("£95,000pa or 95k"), [95000, 95000]);
});

test("months, years and per cent must stand in the quoted words", () => {
  const n = "6m RF, ten year term, 9% t/o top up";
  assert.deepEqual(figureFromNote("number", "rentFreeMonthsMax", 6, "6m RF", n), { ok: true, value: 6 });
  assert.deepEqual(figureFromNote("number", "leaseTermYears", 10, "ten year term", n), { ok: true, value: 10 });
  assert.deepEqual(figureFromNote("percent", "turnoverRentPct", 9, "9% t/o", n), { ok: true, value: 9 });
  assert.equal(figureFromNote("number", "leaseTermYears", 6, "6m RF", n).ok, false, "six months is not a six year lease");
  assert.equal(figureFromNote("number", "capexEnvelope" as any, 6, "6m RF", n).ok, false);
});

test("a count is a whole word or number of the quote, never part of another", () => {
  assert.equal(countFromNote(5, "five targets", "We need five targets"), 5);
  assert.equal(countFromNote(9, "nineteen targets", "nineteen targets"), null);
  assert.equal(countFromNote(29, "Unit L29A targets", "Unit L29A targets"), null);
  assert.equal(countFromNote(1, "someone to target", "someone to target"), null);
  assert.equal(countFromNote(150, "150 targets", "150 targets"), null, "more than the brief can hold");
});

test("a text box takes the note's words: a span, or wording that is mostly the note's own", () => {
  const n = "The client wants a high volume food operator. No extraction is possible on this unit. Takeaway focus preferred.";
  assert.equal(textFromNote("No extraction is possible on this unit.", n), "No extraction is possible on this unit.");
  assert.equal(textFromNote("High volume food operator, takeaway focus preferred, no extraction possible", n), "High volume food operator, takeaway focus preferred, no extraction possible");
  assert.equal(textFromNote("A premium destination dining concept with strong covenant strength", n), null);
  assert.equal(categoryOnList("restaurant", taxonomy), "Tenant - Restaurant");
  assert.equal(categoryOnList("Bowling", taxonomy), null);
});

test("the reader: refuses without a note, a key or an allowance, and checks what comes back", async () => {
  const deps = { hasKey: () => true, claim: async () => true, today: () => today };
  await assert.rejects(readBriefNote({ text: "hi", taxonomy }, deps), (e: any) => e instanceof BriefNoteReaderError && e.status === 400);
  await assert.rejects(readBriefNote({ text: note, taxonomy }, { ...deps, hasKey: () => false }), (e: any) => e.status === 503);
  await assert.rejects(readBriefNote({ text: note, taxonomy }, { ...deps, claim: async () => false }), (e: any) => e.status === 429);
  await assert.rejects(readBriefNote({ text: note, taxonomy }, { ...deps, ask: async () => ({ input: null, model: "m" }) }), (e: any) => e.status === 502);

  let sent: { system: string; user: string; tool: any } | null = null;
  const r = await readBriefNote({ text: note, unitName: "E01Y", propertyName: "Brent Cross <Shopping> Centre", taxonomy, landsecCategories: false }, {
    ...deps, ask: async (system, user, tool) => { sent = { system, user, tool }; return { input: answer, model: "m" }; },
  });
  assert.equal(r.fields.objective, answer.objective);
  assert.equal(r.commercials.quotingRentPa, "90000");
  assert.ok(sent);
  const s = sent as unknown as { system: string; user: string; tool: any };
  assert.match(s.user, /Unit: E01Y\nScheme: Brent Cross Shopping Centre/, "angle brackets are taken out of what is sent");
  assert.ok(s.user.includes(note), "the note is sent");
  assert.match(s.system, /Today is 2026-11-19/);
  assert.deepEqual(s.tool.input_schema.properties.priorityCategories.items.properties.name.enum, taxonomy, "the categories offered are the unit's list");
  assert.equal(s.tool.name, "fill_brief");
});

test("the prompt and the tool carry the note, the boxes, the list, today and the unit: nothing else", () => {
  const p = briefNotePrompt({ text: note, today, unitName: "E01Y", propertyName: "Brent Cross" });
  assert.doesNotMatch(p.system + p.user, /@|password|fee split|BGP's notes/i);
  const tool = briefNoteTool(taxonomy);
  assert.deepEqual(Object.keys(tool.input_schema.properties).sort(), [
    "agentInstruction", "clientCompany", "commercials", "deadline1Date", "deadline1Deliverables", "deadline2Date", "deadline2Deliverables",
    "instructedDate", "locationContext", "minTargets", "objective", "priorityCategories", "priorityTargets", "successMeasures", "targetCriteria", "title",
  ]);
});
