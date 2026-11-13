// "Drop a note in, fill the form" (shared/letting-note.ts): the shorthand
// rules, the checks on what an AI reader proposes, and the reader with the
// provider replaced. No test here touches a database or an AI provider.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTE_KINDS, type NoteKind } from "../shared/letting-note";
import { VIEWING_OUTCOMES } from "../shared/viewing-workflow";
import {
  NOTE_KIND_FIELDS, NOTE_OUTCOMES, buildReading, exactNameMatch, figuresIn, findTimes, mergeReadings, normaliseCandidate,
  outcomeFromWords, readLooseDate, readShorthand,
} from "../shared/letting-note-parse";
import { NOTE_UNREAD_REASON, noteReaderPrompt, noteReaderTool, readLettingNote, readNoteBody, type NoteReaderDeps } from "./unit-note-reader";

const TODAY = "2026-11-13";   // a Friday
const OWNER = "Ben Sykes 9 Nov Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF";
const short = (text: string, kind: NoteKind = "offer", extra: Record<string, unknown> = {}) => readShorthand(text, { kind, today: TODAY, ...extra });
const read = (text: string, kind: NoteKind = "offer", extra: Record<string, unknown> = {}) => buildReading({ kind, text, today: TODAY, ...extra });
const check = (note: string, candidate: unknown, kind: NoteKind = "offer", extra: Record<string, unknown> = {}) =>
  normaliseCandidate(note, candidate, { kind, today: TODAY, ...extra });
const reasonFor = (r: { dropped: { field: string; reason: string }[] }, field: string) => r.dropped.find(d => d.field === field)?.reason;

// ── The owner's example ────────────────────────────────────────────────────

test("the owner's example fills an offer with no AI", () => {
  const r = read(OWNER);
  assert.deepEqual(r.fields, { rentFreeMonths: 6, turnoverRentPct: 9, rentPa: 120000, termYears: 15, date: "2026-11-09" });
  assert.equal(r.saidBy, "Ben Sykes");
  assert.equal(r.fields.contactName, undefined);
  assert.equal(r.usedAi, false);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(short(OWNER).leftover, []);
});

test("each value in the owner's example comes with the exact words it was read from", () => {
  const r = read(OWNER);
  assert.deepEqual(r.quotes, { rentFreeMonths: "6 MRF", turnoverRentPct: "9% t/o", rentPa: "Rent £120kpax", termYears: "15 year lease", date: "9 Nov" });
  for (const quote of Object.values(r.quotes)) assert.ok(OWNER.includes(quote as string), `${quote} is in the note`);
});

test("the owner's example as a negotiation round carries only the stated terms", () => {
  const r = read(OWNER, "round");
  assert.deepEqual(r.fields, { rentFreeMonths: 6, turnoverRentPct: 9, rentPa: 120000, termYears: 15, date: "2026-11-09" });
  assert.equal(r.usedAi, false);
});

test("the stored comment, without the tracker's name and date, reads the same terms and no date", () => {
  const r = read("Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF");
  assert.deepEqual(r.fields, { rentFreeMonths: 6, turnoverRentPct: 9, rentPa: 120000, termYears: 15 });
  assert.equal(r.saidBy, null);
});

test("9 Nov read before 9 November this year is last year's", () => {
  assert.equal(buildReading({ kind: "offer", text: OWNER, today: "2026-11-05" }).fields.date, "2025-11-09");
  assert.equal(buildReading({ kind: "offer", text: OWNER, today: "2026-11-09" }).fields.date, "2026-11-09");
});

// ── Rent ───────────────────────────────────────────────────────────────────

test("rent: the ways a yearly figure is written", () => {
  const cases: [string, number][] = [
    ["£120kpax", 120000], ["£120,000 pa", 120000], ["rent 120k", 120000], ["£95k per annum exclusive", 95000],
    ["Rent: £87,500 p.a.x.", 87500], ["rent of £1.2m pa", 1200000], ["120k pax", 120000], ["rent is 95000", 95000],
    ["£60k p.a.", 60000], ["£110k rent", 110000], ["base rent £75,000", 75000],
  ];
  for (const [text, rent] of cases) assert.equal(short(text).fields.rentPa, rent, text);
});

test("rent: the quote keeps the per annum words", () => {
  assert.equal(short("They offered £95k per annum exclusive on Tuesday").quotes.rentPa, "£95k per annum exclusive");
});

test("rent per square foot is refused, not guessed", () => {
  for (const text of ["rent £45 psf", "£45 per sq ft", "Rent of £52.50 per square foot", "£60/sq ft"]) {
    const r = read(text);
    assert.equal(r.fields.rentPa, undefined, text);
    assert.match(reasonFor(r, "rentPa") || "", /not a yearly figure/, text);
  }
});

test("a monthly or weekly rent is refused, not multiplied up", () => {
  for (const text of ["rent £10k pcm", "£8,000 per month", "rent 2,500 monthly", "£1,200 per week"]) {
    const r = read(text);
    assert.equal(r.fields.rentPa, undefined, text);
    assert.match(reasonFor(r, "rentPa") || "", /not a yearly figure/, text);
  }
});

test("a refused figure stays in the notes so it is not lost", () => {
  assert.equal(read("rent £45 psf, 10 years").fields.note, "rent £45 psf");
});

test("a rent with no pound sign, no k and under 1,000 is left alone", () => {
  const r = short("rent 120, to be confirmed");
  assert.equal(r.fields.rentPa, undefined);
  assert.ok(r.leftover.length > 0);
});

test("a service charge, a quoting rent and a turnover figure are not the rent", () => {
  assert.equal(short("service charge £20k pa").fields.rentPa, undefined);
  assert.equal(short("quoting rent £150k pa").fields.rentPa, undefined);
  assert.equal(short("turnover £2m pa").fields.rentPa, undefined);
  assert.equal(short("£120,000 pa, service charge £20k pa").fields.rentPa, 120000);
});

test("a bare sum with no 'rent' and no 'pa' is not taken as rent", () => {
  const r = short("They offered £120k");
  assert.equal(r.fields.rentPa, undefined);
  assert.deepEqual(r.leftover, ["£120k"]);
});

// ── Term, rent free, turnover ──────────────────────────────────────────────

test("term: lease lengths", () => {
  const cases: [string, number][] = [["15 year lease", 15], ["10yr term", 10], ["term 10 years", 10], ["lease for 5 years", 5], ["10 years", 10], ["Term: 25", 25], ["a 20-year lease", 20]];
  for (const [text, years] of cases) assert.equal(short(text).fields.termYears, years, text);
});

test("term: two lengths in years with nothing to tell them apart are not guessed", () => {
  const r = short("10 years or 15 years");
  assert.equal(r.fields.termYears, undefined);
  assert.match(reasonFor(r, "termYears") || "", /more than one length/);
});

test("term: a break year or a review cycle is not the term", () => {
  assert.equal(short("break at year 5").fields.termYears, undefined);
  assert.equal(short("5 yearly rent reviews").fields.termYears, undefined);
  assert.equal(short("15 year lease with a 5 year break").fields.termYears, 15);
});

test("rent free: months", () => {
  const cases: [string, number][] = [["6 MRF", 6], ["6 months rent free", 6], ["9m RF", 9], ["rent free 12 months", 12], ["3 months free", 3],
    ["6 months' rent-free", 6], ["4.5 months rent free", 4.5], ["1 year rent free", 12], ["18mths rent free", 18]];
  for (const [text, months] of cases) assert.equal(short(text).fields.rentFreeMonths, months, text);
});

test("rent free: more than 600 months is refused", () => {
  const r = short("700 months rent free");
  assert.equal(r.fields.rentFreeMonths, undefined);
  assert.ok(reasonFor(r, "rentFreeMonths"));
});

test("turnover rent", () => {
  const cases: [string, number][] = [["9% t/o", 9], ["turnover 8%", 8], ["8% turnover rent", 8], ["t/o at 7.5%", 7.5], ["10% of turnover", 10], ["turnover rent of 12 per cent", 12]];
  for (const [text, pct] of cases) assert.equal(short(text).fields.turnoverRentPct, pct, text);
});

test("turnover rent over 100% is refused", () => {
  const r = short("150% t/o");
  assert.equal(r.fields.turnoverRentPct, undefined);
  assert.ok(reasonFor(r, "turnoverRentPct"));
});

// ── Break, premium, contribution, review, deposit ──────────────────────────

test("break options", () => {
  const cases: [string, string][] = [
    ["break at year 5", "Break at year 5"], ["TBO yr 5", "Tenant break at year 5"], ["tenant break at 5th", "Tenant break at year 5"],
    ["LBO at year 3", "Landlord break at year 3"], ["mutual break in year 10", "Mutual break at year 10"], ["5 year tenant break", "Tenant break at year 5"],
    ["tenant-only break option at the 5th anniversary", "Tenant break at year 5"], ["no break", "No break"],
  ];
  for (const [text, value] of cases) assert.equal(short(text).fields.breakOption, value, text);
});

test("premium", () => {
  assert.equal(short("premium of £25,000").fields.premium, 25000);
  assert.equal(short("£50k premium").fields.premium, 50000);
  assert.equal(short("key money £10k").fields.premium, 10000);
  assert.equal(short("reverse premium of £100k").fields.premium, undefined, "a reverse premium is an incentive");
});

test("fit-out or capital contribution", () => {
  const cases: [string, number][] = [["£50k CC", 50000], ["fit out contribution £50,000", 50000], ["capital contribution of £250k", 250000],
    ["cap con 75k", 75000], ["landlord contribution of £1.5m", 1500000], ["£100,000 towards the fit-out", 100000]];
  for (const [text, sum] of cases) assert.equal(short(text).fields.fittingOutContribution, sum, text);
});

test("a contribution per square foot is refused", () => {
  const r = short("fit out contribution £40 psf");
  assert.equal(r.fields.fittingOutContribution, undefined);
  assert.ok(reasonFor(r, "fittingOutContribution"));
});

test("rent review", () => {
  assert.equal(short("5 yearly rent reviews to OMV").fields.rentReview, "5 yearly rent reviews to OMV");
  assert.equal(short("rent review at year 5").fields.rentReview, "Rent review at year 5");
  assert.equal(short("RR yr 5 upwards only").fields.rentReview, "RR yr 5 upwards only");
  assert.equal(short("rent review to be discussed").fields.rentReview, undefined, "no detail, nothing to record");
});

test("rent deposit", () => {
  assert.equal(short("6 months deposit").fields.rentDeposit, "6 months");
  assert.equal(short("rent deposit of 3 months").fields.rentDeposit, "3 months");
  assert.equal(short("1 month's rent deposit").fields.rentDeposit, "1 month");
  assert.equal(short("deposit £30,000").fields.rentDeposit, "£30,000");
  assert.equal(short("no deposit").fields.rentDeposit, "No deposit");
  assert.equal(short("6 months deposit").fields.rentFreeMonths, undefined);
});

test("a full set of terms in one line", () => {
  const r = short("10yr term, £95k per annum exclusive, 9m RF, TBO yr 5, £50k CC, 6 months deposit, 5 yearly rent reviews to OMV, premium of £25,000");
  assert.deepEqual(r.fields, { rentDeposit: "6 months", rentFreeMonths: 9, breakOption: "Tenant break at year 5", rentReview: "5 yearly rent reviews to OMV",
    fittingOutContribution: 50000, premium: 25000, rentPa: 95000, termYears: 10 });
  assert.deepEqual(r.leftover, []);
});

// ── Dates and times ────────────────────────────────────────────────────────

test("dates: the ways a day is written", () => {
  const cases: [string, string][] = [
    ["9 Nov", "2026-11-09"], ["9th November 2026", "2026-11-09"], ["09/11/26", "2026-11-09"], ["09/11/2026", "2026-11-09"], ["9.11.2026", "2026-11-09"],
    ["2026-11-09", "2026-11-09"], ["November 9th", "2026-11-09"], ["Nov 9, 2025", "2025-11-09"], ["yesterday", "2026-11-12"], ["today", "2026-11-13"],
    ["9/11", "2026-11-09"], ["1st of December", "2025-12-01"], ["last Tuesday", "2026-11-10"], ["Last Friday", "2026-11-06"],
  ];
  for (const [text, day] of cases) assert.equal(readLooseDate(text, TODAY), day, text);
});

test("dates: a day and month with no year is the most recent one, never a future one", () => {
  assert.equal(readLooseDate("20 Nov", TODAY), "2025-11-20");
  assert.equal(readLooseDate("13 Nov", TODAY), "2026-11-13");
  assert.equal(readLooseDate("29 Feb", TODAY), "2024-02-29");
});

test("dates: a viewing may be booked ahead, a follow-up is always ahead", () => {
  assert.equal(readLooseDate("20 Nov", TODAY, "nearest"), "2026-11-20");
  assert.equal(readLooseDate("9 Nov", TODAY, "nearest"), "2026-11-09");
  assert.equal(readLooseDate("9 Nov", TODAY, "future"), "2027-11-09");
  assert.equal(readLooseDate("next Monday", TODAY), "2026-11-16");
});

test("dates: things that are not dates", () => {
  assert.equal(readLooseDate("31/02/2026", TODAY), null, "not a calendar date");
  assert.equal(readLooseDate("50/50 split", TODAY), null);
  assert.equal(readLooseDate("open 24/7", TODAY), null);
  assert.equal(readLooseDate("in November 15 year lease offered", TODAY), null);
  assert.equal(readLooseDate("9 may be too many", TODAY), null);
  assert.equal(readLooseDate("9 Nov 15 year lease", TODAY), "2026-11-09", "15 is the term, not the year");
  assert.equal(readLooseDate("on Monday", TODAY), null, "last Monday or next Monday: not guessed");
  assert.equal(read("No show. Rebooked for Tuesday.", "viewing_outcome").fields.date, undefined);
  assert.equal(readLooseDate("chase Friday", TODAY, "future"), "2026-11-13", "a follow-up is always ahead");
});

test("times", () => {
  const cases: [string, string][] = [["2pm", "14:00"], ["14:30", "14:30"], ["9.30am", "09:30"], ["12pm", "12:00"], ["12am", "00:00"], ["noon", "12:00"], ["at 10:15 am", "10:15"]];
  for (const [text, time] of cases) assert.equal(findTimes(text)[0]?.value, time, text);
  assert.deepEqual(findTimes("9% t/o, 6 MRF"), []);
});

// ── Who wrote it ───────────────────────────────────────────────────────────

test("a leading name and date is who wrote the note and when, not the brand's contact", () => {
  const r = read("Ben Sykes 9 Nov spoke to their agent, rent 120k");
  assert.equal(r.saidBy, "Ben Sykes");
  assert.equal(r.fields.date, "2026-11-09");
  assert.equal(r.fields.contactName, undefined);
  assert.equal(r.fields.brandName, undefined);
});

test("a date in the body wins over the date in the author stamp", () => {
  const r = read("Ben Sykes 12 Nov Offer received 9 Nov: rent 120k");
  assert.equal(r.fields.date, "2026-11-09");
  assert.equal(r.saidBy, "Ben Sykes");
});

test("a leading phrase that is not a person's name is not an author", () => {
  assert.equal(read("Offer Received 9 Nov: rent 120k").saidBy, null);
  assert.equal(read("Dishoom 9 Nov offered rent 120k").saidBy, null, "one word and a date is more likely a brand");
  assert.equal(read("Jersey Mike's 9 Nov offered rent 120k").saidBy, null);
  assert.equal(read("Honest Burgers 9 Nov offered rent 120k", "offer", { brandNames: ["Honest Burgers"] }).saidBy, null, "a brand on the unit");
  assert.equal(read("Victoria 9 Nov rent 120k", "offer", { staffNames: ["Victoria"] }).saidBy, "Victoria", "a known colleague, even by one name");
});

// ── Whose position, outcomes, labels, brands ───────────────────────────────

test("whose position a round is", () => {
  assert.equal(short("We countered at rent 130k", "round").fields.party, "landlord");
  assert.equal(short("Landlord counter: 12 months rent free", "round").fields.party, "landlord");
  assert.equal(short("They offered rent 110k", "round").fields.party, "tenant");
  assert.equal(short("Tenant offered 6 MRF", "round").fields.party, "tenant");
  assert.equal(short("Rent 120k, 6 MRF", "round").fields.party, undefined, "not stated, left for the person");
  assert.equal(short("We countered at rent 130k", "offer").fields.party, undefined, "an offer form has no such box");
});

test("a note with both sides' positions does not pick one", () => {
  const r = short("They offered rent 100k, we countered at 120k", "round");
  assert.equal(r.fields.party, undefined);
  assert.match(reasonFor(r, "party") || "", /both sides/);
});

test("viewing outcomes map onto the app's list, plus No Show", () => {
  const cases: [string, string][] = [
    ["not interested, too small", "Not Interested"], ["very keen on the unit", "Interested"], ["they loved it", "Interested"], ["no show", "No Show"],
    ["didn't turn up", "No Show"], ["offer expected next week", "Offer Expected"], ["offer received this morning", "Offer Received"],
    ["want a second viewing with the board", "Second Viewing"], ["will follow up with ops", "Follow Up"], ["they have passed", "Not Interested"],
  ];
  for (const [text, outcome] of cases) {
    assert.equal(short(text, "viewing_outcome").fields.outcome, outcome, text);
    assert.ok(NOTE_OUTCOMES.includes(outcome));
  }
  for (const o of VIEWING_OUTCOMES) assert.equal(outcomeFromWords(o)?.outcome, o);
  assert.equal(outcomeFromWords("measured the unit"), null);
});

test("a viewing note: date, time, outcome, follow-up and next action", () => {
  const r = read("Viewed yesterday at 2pm. Very keen. Follow up by 20 Nov. Next action: send floor plans.", "viewing_outcome");
  assert.deepEqual(r.fields, { nextAction: "send floor plans", date: "2026-11-12", followUpDate: "2026-11-20", time: "14:00", outcome: "Interested" });
});

test("a booked viewing takes the coming date and has no outcome", () => {
  const r = read("Dishoom viewing 20 Nov 2pm", "viewing", { brandNames: ["Dishoom", "Wagamama"] });
  assert.deepEqual(r.fields, { date: "2026-11-20", time: "14:00", brandName: "Dishoom" });
});

test("an outcome on a viewing still to come is refused", () => {
  const r = read("Viewing 20 Nov, they are very keen", "viewing");
  assert.equal(r.fields.date, "2026-11-20");
  assert.equal(r.fields.outcome, undefined);
  assert.match(reasonFor(r, "outcome") || "", /future/);
});

test("labelled lines", () => {
  const r = short("Brand: Dishoom. Contact: Sam Hart. Agent: Jo Lee, rent 120k");
  assert.equal(r.fields.brandName, "Dishoom");
  assert.equal(r.fields.contactName, "Sam Hart");
  assert.equal(r.fields.agentName, "Jo Lee");
  assert.equal(short("Attended by Sam Hart and Jo Lee. Keen.", "viewing_outcome").fields.attendees, "Sam Hart and Jo Lee");
});

test("a brand already on the unit is found in the note; an ordinary word is not", () => {
  assert.equal(short("Dishoom offered rent 120k", "offer", { brandNames: ["Dishoom", "Next"] }).fields.brandName, "Dishoom");
  assert.equal(short("dishoom offered rent 120k", "offer", { brandNames: ["Dishoom"] }).fields.brandName, "Dishoom", "a note typed all in lower case");
  assert.equal(short("Rent 120k, decision next week", "offer", { brandNames: ["Next"] }).fields.brandName, undefined);
  assert.equal(short("Dishoom and Wagamama both offered", "offer", { brandNames: ["Dishoom", "Wagamama"] }).fields.brandName, undefined, "two brands, one offer: not guessed");
});

test("interest from one agent for several brands", () => {
  const r = short("Savills called for Dishoom and Wagamama on 09/11/26", "interest", { brandNames: ["Dishoom", "Wagamama"] });
  assert.equal(r.fields.brandName, "Dishoom");
  assert.deepEqual(r.fields.moreBrands, [{ name: "Wagamama" }]);
  assert.equal(r.fields.date, "2026-11-09");
});

test("each form only gets its own boxes", () => {
  const interest = read("Dishoom interested, thinking rent 120k and 6 MRF", "interest", { brandNames: ["Dishoom"] });
  assert.equal(interest.fields.rentPa, undefined);
  assert.equal(interest.fields.rentFreeMonths, undefined);
  assert.match(interest.fields.note || "", /rent 120k/);
  for (const kind of NOTE_KINDS) {
    const r = read(`${OWNER}. Very keen. We countered. Contact: Sam Hart. 2pm`, kind);
    for (const key of Object.keys(r.fields)) assert.ok((NOTE_KIND_FIELDS[kind] as readonly string[]).includes(key), `${key} on ${kind}`);
  }
});

test("no reading ever holds a null, so a round's unstated terms carry over", () => {
  for (const kind of NOTE_KINDS) for (const text of [OWNER, "rent £45 psf", "called, no news", "We countered at 130k"]) {
    const r = read(text, kind);
    for (const [key, value] of Object.entries(r.fields)) assert.notEqual(value, null, `${key} on ${kind}`);
  }
});

// ── Checking what an AI reader proposed ────────────────────────────────────

const NOTE = "Spoke to Sam Hart at Dishoom on 9 Nov. They offered £120k pax on a 15 year lease, six months rent free, tenant break at year 5. Service charge cap wanted.";
const good = {
  brandName: { value: "Dishoom", quote: "Sam Hart at Dishoom" },
  contactName: { value: "Sam Hart", quote: "Spoke to Sam Hart" },
  date: { value: "2026-11-09", quote: "on 9 Nov" },
  rentPa: { value: 120000, quote: "£120k pax" },
  termYears: { value: 15, quote: "15 year lease" },
  rentFreeMonths: { value: 6, quote: "six months rent free" },
  breakOption: { value: "Tenant break at year 5", quote: "tenant break at year 5" },
  unplaced: ["Service charge cap wanted"],
};

test("a checked AI reading keeps what the note states", () => {
  const r = check(NOTE, good);
  assert.deepEqual(r.fields, { brandName: "Dishoom", contactName: "Sam Hart", date: "2026-11-09", rentPa: 120000, termYears: 15, rentFreeMonths: 6, breakOption: "Tenant break at year 5" });
  assert.deepEqual(r.unplaced, ["Service charge cap wanted"]);
  assert.deepEqual(r.dropped, []);
});

test("a value is dropped when its quote is not in the note", () => {
  const r = check(NOTE, { ...good, premium: { value: 50000, quote: "£50k premium" } });
  assert.equal(r.fields.premium, undefined);
  assert.match(reasonFor(r, "premium") || "", /not in the note/);
});

test("a figure is dropped when it is not in its own quote", () => {
  const r = check(NOTE, { rentPa: { value: 125000, quote: "£120k pax" }, termYears: { value: 10, quote: "15 year lease" }, turnoverRentPct: { value: 9, quote: "They offered" } });
  assert.deepEqual(r.fields, {});
  assert.deepEqual(r.dropped.map(d => d.field).sort(), ["rentPa", "termYears", "turnoverRentPct"]);
});

test("a yearly rent worked out from a monthly or per square foot figure is dropped", () => {
  const note = "They offered £10k pcm, or £45 psf on 2,000 sq ft";
  assert.match(reasonFor(check(note, { rentPa: { value: 120000, quote: "£10k pcm" } }), "rentPa") || "", /not in the words/);
  assert.match(reasonFor(check(note, { rentPa: { value: 10000, quote: "£10k pcm" } }), "rentPa") || "", /not a yearly figure/);
  assert.match(reasonFor(check(note, { rentPa: { value: 10000, quote: "£10k" } }), "rentPa") || "", /not a yearly figure/, "the unit sits just after the quote");
  assert.ok(reasonFor(check(note, { rentPa: { value: 45, quote: "£45 psf" } }), "rentPa"));
});

test("figures are held to the save routes' ranges", () => {
  const note = "700 months rent free, 1500 year lease, 150% turnover, rent £5 pa, premium £900m";
  const r = check(note, {
    rentFreeMonths: { value: 700, quote: "700 months rent free" }, termYears: { value: 1500, quote: "1500 year lease" },
    turnoverRentPct: { value: 150, quote: "150% turnover" }, rentPa: { value: 5, quote: "rent £5 pa" }, premium: { value: 900000000, quote: "premium £900m" },
  });
  assert.deepEqual(r.fields, {});
  assert.equal(r.dropped.length, 5);
});

test("an AI date is worked out again from the writer's own words, never taken on trust", () => {
  assert.equal(check(NOTE, { date: { value: "2026-12-25", quote: "on 9 Nov" } }).fields.date, "2026-11-09");
  const vague = check("They came back last week with rent 120k", { date: { value: "2026-11-06", quote: "last week" } });
  assert.equal(vague.fields.date, undefined);
  assert.match(reasonFor(vague, "date") || "", /could not be worked out/);
});

test("a future date is refused on an offer and a round, allowed on a viewing", () => {
  const text = "Offer dated 20/11/2026, rent 120k";
  for (const kind of ["offer", "round", "interest"] as const) {
    const r = read(text, kind);
    assert.equal(r.fields.date, undefined, kind);
    assert.match(reasonFor(r, "date") || "", /future/, kind);
  }
  assert.equal(read("viewing on 20/11/2026", "viewing").fields.date, "2026-11-20");
  assert.equal(read("Offer dated 14/11/2026, rent 120k").fields.date, "2026-11-14", "tomorrow is allowed, as the round route allows it");
});

test("the contact is dropped when it is the note's author or one of the letting team", () => {
  const stamped = buildReading({ kind: "offer", today: TODAY, text: "Ben Sykes 9 Nov rent 120k", candidate: { contactName: { value: "Ben Sykes", quote: "Ben Sykes" } }, usedAi: true });
  assert.equal(stamped.fields.contactName, undefined);
  assert.equal(stamped.saidBy, "Ben Sykes");
  const team = buildReading({ kind: "offer", today: TODAY, text: "Victoria Hale spoke to Sam Hart, rent 120k", staffNames: ["victoria hale"],
    candidate: { contactName: { value: "Victoria Hale", quote: "Victoria Hale spoke" }, agentName: { value: "Sam Hart", quote: "Sam Hart" } }, usedAi: true });
  assert.equal(team.fields.contactName, undefined);
  assert.equal(team.fields.agentName, "Sam Hart");
  const source = buildReading({ kind: "offer", today: TODAY, text: "Contact: Ben Sykes. rent 120k", author: "Ben Sykes" });
  assert.equal(source.fields.contactName, undefined);
  assert.ok(reasonFor(source, "contactName"));
});

test("a name is the note's own spelling: a completed or tidied name is dropped", () => {
  const r = check(NOTE, { brandName: { value: "Dishoom Limited", quote: "Dishoom" }, contactName: { value: "Samuel Hart", quote: "Sam Hart" } });
  assert.deepEqual(r.fields, {});
  assert.equal(r.dropped.length, 2);
});

test("an AI reading never supplies an id", () => {
  const r = check(NOTE, { brandId: { value: "abc", quote: "Dishoom" }, agentCompanyId: { value: "def", quote: "Dishoom" }, contactId: { value: "ghi", quote: "Sam Hart" } }, "interest");
  assert.deepEqual(r.fields, {});
});

test("for a round an unstated term is never sent as null", () => {
  const r = check(NOTE, { rentPa: { value: 120000, quote: "£120k pax" }, premium: { value: null, quote: "" }, rentReview: { value: null, quote: "" }, incentives: { value: "", quote: "" }, party: { value: null, quote: "" } }, "round");
  assert.deepEqual(r.fields, { rentPa: 120000 });
  assert.deepEqual(Object.keys(r.fields), ["rentPa"]);
  assert.deepEqual(r.dropped, []);
});

test("what fits no box on this form goes to unplaced", () => {
  const r = check(NOTE, { ...good, outcome: { value: "Interested", quote: "They offered" } }, "interest");
  assert.equal(r.fields.rentPa, undefined);
  assert.equal(r.fields.outcome, undefined);
  assert.ok(r.unplaced.includes("£120k pax") && r.unplaced.includes("15 year lease") && r.unplaced.includes("They offered"));
  assert.equal(check(NOTE, { unplaced: ["an invented sentence"] }).unplaced.length, 0, "unplaced text must be in the note too");
});

test("text is trimmed to the save routes' limits", () => {
  const long = "x".repeat(900);
  const note = `break ${long}. next ${"y".repeat(2500)}`;
  const r = check(note, { breakOption: { value: `break ${long}`, quote: "break" }, nextAction: { value: `next ${"y".repeat(2500)}`, quote: "next" } }, "viewing_outcome");
  assert.equal(r.fields.breakOption, undefined, "a viewing has no break box");
  assert.equal(r.fields.nextAction?.length, 2000);
  assert.equal(check(note, { breakOption: { value: `break ${long}`, quote: "break" } }).fields.breakOption?.length, 500);
});

test("outcome and whose position must be one of the choices", () => {
  const note = "Viewed today, they were lukewarm. We countered.";
  assert.match(reasonFor(check(note, { outcome: { value: "Lukewarm", quote: "they were lukewarm" } }, "viewing_outcome"), "outcome") || "", /not one of the viewing outcomes/);
  assert.equal(check(note, { outcome: { value: "follow up", quote: "they were lukewarm" } }, "viewing_outcome").fields.outcome, "Follow Up");
  assert.ok(reasonFor(check(note, { party: { value: "agent", quote: "We countered" } }, "round"), "party"));
  assert.equal(check(note, { party: { value: "landlord", quote: "We countered" } }, "round").fields.party, "landlord");
});

test("anything that is not a reading is read as nothing", () => {
  for (const bad of [null, "rent 120k", 42, [], [good]]) assert.deepEqual(check(NOTE, bad).fields, {});
});

test("merge: the shorthand value wins where both found a field, the AI fills the rest", () => {
  const mine = short("Dishoom: rent 120k, 6 MRF");
  const ai = check("Dishoom: rent 120k, 6 MRF", { rentPa: { value: 120, quote: "rent 120k" }, rentFreeMonths: { value: 6, quote: "6 MRF" }, brandName: { value: "Dishoom", quote: "Dishoom" } });
  const merged = mergeReadings(mine, ai);
  assert.deepEqual(merged.fields, { rentPa: 120000, rentFreeMonths: 6, brandName: "Dishoom" });
  assert.equal(merged.quotes.rentPa, "rent 120k");
  assert.deepEqual(merged.dropped, [], "the AI's refused rent is no news when the shorthand read it");
});

test("figures a phrase states", () => {
  assert.deepEqual(figuresIn("£120kpax").sort((a, b) => a - b), [120, 120000]);
  assert.deepEqual(figuresIn("six months rent free"), [6]);
  assert.deepEqual(figuresIn("£87,500 p.a."), [87500]);
});

test("a brand links to a record only on one exact match", () => {
  const brands = [{ id: "1", name: "Dishoom" }, { id: "2", name: "Pret A Manger" }, { id: "3", name: "Leon" }, { id: "4", name: "LEON" }];
  assert.equal(exactNameMatch("dishoom", brands)?.id, "1");
  assert.equal(exactNameMatch("  Pret  a manger ", brands)?.id, "2");
  assert.equal(exactNameMatch("Pret", brands), null, "part of a name is not a match");
  assert.equal(exactNameMatch("Leon", brands), null, "two records, so neither");
  assert.equal(exactNameMatch("", brands), null);
});

// ── The reader with the provider replaced ──────────────────────────────────

const input = (text: string, kind: NoteKind = "offer") => ({ kind, text, today: TODAY, unitName: "KLG07", propertyName: "St David's", brandNames: ["Dishoom"], pickableBrandNames: ["Dishoom"], staffNames: ["Victoria Hale"] });
function fake(over: Partial<NoteReaderDeps> = {}, reply: unknown = good) {
  const seen = { calls: 0, claims: 0, logged: 0, system: "", user: "", tool: null as any };
  const deps: NoteReaderDeps = {
    hasKey: () => true,
    claim: async () => { seen.claims++; return true; },
    call: async (system, user, tool) => { seen.calls++; seen.system = system; seen.user = user; seen.tool = tool; return { input: reply, model: "test-model", usage: { input_tokens: 500, output_tokens: 90 } }; },
    log: () => { seen.logged++; },
    ...over,
  };
  return { deps, seen };
}

test("the owner's example never reaches the provider", async () => {
  const { deps, seen } = fake();
  const r = await readLettingNote(input(OWNER), deps);
  assert.equal(r.usedAi, false);
  assert.deepEqual([seen.claims, seen.calls], [0, 0]);
  assert.equal(r.fields.rentPa, 120000);
});

test("words the shorthand rules cannot place go to the AI reader, and its answer is checked", async () => {
  const { deps, seen } = fake({}, { ...good, rentFreeMonths: { value: 9, quote: "six months rent free" } });
  const r = await readLettingNote(input(NOTE), deps);
  assert.equal(r.usedAi, true);
  assert.deepEqual([seen.claims, seen.calls, seen.logged], [1, 1, 1]);
  assert.equal(r.fields.contactName, "Sam Hart");
  assert.equal(r.fields.rentPa, 120000);
  assert.equal(r.fields.rentFreeMonths, undefined, "9 is not in 'six months rent free'");
  assert.equal(r.fields.brandName, "Dishoom");
  assert.equal(seen.tool.name, "record_note");
});

test("with no key the shorthand reading still comes back, with a line saying the rest was not read", async () => {
  const { deps, seen } = fake({ hasKey: () => false });
  const r = await readLettingNote(input(NOTE), deps);
  assert.equal(r.usedAi, false);
  assert.equal(seen.calls, 0);
  assert.equal(r.fields.termYears, 15);
  assert.equal(r.fields.breakOption, "Tenant break at year 5");
  assert.equal(reasonFor(r, "note"), NOTE_UNREAD_REASON);
  assert.match(r.fields.note || "", /Sam Hart/, "the unread words are kept for the notes box");
});

test("a failed, refused, cut-off or over-allowance call falls back to the shorthand reading and never throws", async () => {
  const variants: Partial<NoteReaderDeps>[] = [
    { call: async () => { throw new Error("529 overloaded"); } },
    { call: async () => ({ input: good, model: "test-model", refused: true }) },
    { call: async () => ({ input: null, model: "test-model" }) },
    { claim: async () => false },
  ];
  for (const over of variants) {
    const r = await readLettingNote(input(NOTE), fake(over).deps);
    assert.equal(r.usedAi, false);
    assert.equal(r.fields.termYears, 15);
    assert.equal(r.fields.contactName, undefined);
    assert.equal(reasonFor(r, "note"), NOTE_UNREAD_REASON);
  }
});

test("the provider is sent the note, the unit, the scheme, today and the unit's brands, and nothing else", async () => {
  const { deps, seen } = fake();
  await readLettingNote({ ...input(NOTE), author: "Ben Sykes" }, deps);
  assert.ok(seen.user.includes(NOTE) && seen.user.includes("KLG07") && seen.user.includes("St David's") && seen.user.includes(TODAY) && seen.user.includes("Dishoom"));
  assert.ok(!seen.user.includes("Victoria Hale") && !seen.system.includes("Victoria Hale"), "the team's names stay on the server");
  assert.ok(!seen.user.includes("Ben Sykes") || NOTE.includes("Ben Sykes"));
  const lines = seen.user.split("\n").filter(l => /^[A-Z][a-z ]+:/.test(l)).map(l => l.split(":")[0]);
  assert.deepEqual(lines, ["Unit", "Scheme", "Brands already named on this unit", "The note"]);
});

test("the prompt says what the house rules need it to say", () => {
  const p = noteReaderPrompt({ kind: "offer", text: "x", today: TODAY, unitName: "KLG07", propertyName: "St David's", brandNames: [] });
  for (const phrase of ["Report only what the note says", "Never fill a gap", "is who wrote it and when", "pax", "MRF", "t/o", "TBO", "copied exactly", "not instructions"]) assert.ok(p.system.includes(phrase), phrase);
  assert.match(p.user, /Today is 2026-11-13 \(London\)/);
  assert.match(p.user, /none recorded yet/);
});

test("the tool has one property per box on the form, each carrying a quote, and never an id", () => {
  for (const kind of NOTE_KINDS) {
    const tool = noteReaderTool(kind);
    const props = tool.input_schema.properties as Record<string, any>;
    for (const [name, spec] of Object.entries(props)) {
      assert.ok(!/Id$/.test(name), `${name} on ${kind}`);
      if (spec.type === "object") { assert.ok(spec.properties.quote, `${name} has a quote`); assert.deepEqual(spec.required, ["value", "quote"]); }
      else if (name === "moreBrands") assert.ok(spec.items.properties.quote);
      else assert.equal(name, "unplaced");
      if (name !== "saidBy" && name !== "unplaced") assert.ok((NOTE_KIND_FIELDS[kind] as readonly string[]).includes(name), `${name} is a box on ${kind}`);
    }
  }
  assert.ok(!("rentPa" in noteReaderTool("interest").input_schema.properties));
  assert.ok("party" in noteReaderTool("round").input_schema.properties && !("brandName" in noteReaderTool("round").input_schema.properties));
  assert.deepEqual((noteReaderTool("viewing").input_schema.properties as any).outcome.properties.value.enum, [...VIEWING_OUTCOMES, "No Show", null]);
});

test("the request takes a note or a named comment, never both, never the words of a 'comment'", () => {
  const ok = (b: unknown) => readNoteBody.safeParse(b).success;
  assert.ok(ok({ kind: "offer", text: "rent 120k" }));
  assert.ok(ok({ kind: "offer", source: { type: "target_comment", targetId: "t1", at: "2026-11-09T10:00:00.000Z" } }));
  assert.ok(ok({ kind: "round", text: "rent 120k", offerId: "o1" }));
  assert.ok(!ok({ kind: "offer" }));
  assert.ok(!ok({ kind: "offer", text: "rent 120k", source: { type: "target_comment", targetId: "t1", at: "x" } }));
  assert.ok(!ok({ kind: "offer", source: { type: "target_comment", targetId: "t1", at: "x", text: "rent 120k" } }), "a comment's words cannot be sent in");
  assert.ok(!ok({ kind: "offer", source: { type: "brief_comment", targetId: "t1", at: "x" } }));
  assert.ok(!ok({ kind: "deal", text: "rent 120k" }));
  assert.ok(!ok({ kind: "offer", text: "x".repeat(4001) }));
  assert.ok(!ok({ kind: "offer", text: "rent 120k", save: true }));
});

// ── Source-level guards ────────────────────────────────────────────────────

const readerSource = readFileSync(new URL("./unit-note-reader.ts", import.meta.url), "utf8");
const readerCode = readerSource.replace(/\/\/.*$/gm, "");

test("the reader goes to Anthropic directly and to no other provider", () => {
  assert.doesNotMatch(readerCode, /\bcallClaude\s*\(|\bcallAI\s*\(|\bgetAIClient\s*\(|ai-provider|openai|gemini|kimi/i);
  assert.match(readerCode, /getAnthropicClient\(true\)\.messages\.create/);
  assert.match(readerCode, /timeout: READER_TIMEOUT_MS/);
  assert.match(readerCode, /tool_choice: \{ type: "tool"/);
});

test("the reader saves nothing", () => {
  assert.doesNotMatch(readerCode, /\b(?:INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(readerCode, /createTrackerOffer|createTrackerViewing|storage\.|db\.insert|db\.update/);
});

test("the route checks the unit, the scheme and the role before reading, and gates target comments on a BGP login", () => {
  const at = (needle: string) => { const i = readerCode.indexOf(needle); assert.ok(i > 0, needle); return i; };
  const order = [at("FROM available_units"), at("briefAccess(req, unit.property_id)"), at('access.landsecRole === "asset_manager"'), at("readNoteBody.safeParse"),
    at("access.seesBgpNotes && access.isStaff"), at("FROM unit_target_operators"), at("readLettingNote({")];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(readerCode, /contactId|contact_id/, "a contact id is never read or returned");
});
