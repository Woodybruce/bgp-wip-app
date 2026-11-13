// "Drop a note in, fill the form" (shared/letting-note.ts): the shorthand
// rules, the checks on what an AI reader proposes, and the reader with the
// provider replaced. No test here touches a database or an AI provider.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTE_KINDS, type NoteKind } from "../shared/letting-note";
import { VIEWING_OUTCOMES } from "../shared/viewing-workflow";
import {
  NOTE_KIND_FIELDS, NOTE_OUTCOMES, buildReading, cleanNote, exactNameMatch, figuresIn, findTimes, mergeReadings, normaliseCandidate,
  outcomeFromWords, readLooseDate, readShorthand,
} from "../shared/letting-note-parse";
import {
  NOTE_UNREAD_REASON, claimNoteRead, noteReaderPrompt, noteReaderTool, noteReaderUserUsageKey, readLettingNote, readNoteBody, teamNamesFor,
  type NoteReaderDeps,
} from "./unit-note-reader";

const TODAY = "2026-11-13";   // a Friday
const OWNER = "Ben Sykes 9 Nov Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF";
const short = (text: string, kind: NoteKind = "offer", extra: Record<string, unknown> = {}) => readShorthand(text, { kind, today: TODAY, ...extra });
const read = (text: string, kind: NoteKind = "offer", extra: Record<string, unknown> = {}) => buildReading({ kind, text, today: TODAY, ...extra });
const check = (note: string, candidate: unknown, kind: NoteKind = "offer", extra: Record<string, unknown> = {}) =>
  normaliseCandidate(note, candidate, { kind, today: TODAY, ...extra });
const readerSource = readFileSync(new URL("./unit-note-reader.ts", import.meta.url), "utf8");
const readerCode = readerSource.replace(/\/\/.*$/gm, "");
const reasonFor = (r: { dropped: { field: string; reason: string }[] }, field: string) => r.dropped.find(d => d.field === field)?.reason;
// The boxes a reading filled, less the notes box.
const boxes = (r: { fields: Record<string, unknown> }) => { const { note, ...rest } = r.fields; return rest; };

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

test("9 Nov is the most recent 9 November; read a few days before it, the date is left for the person", () => {
  assert.equal(buildReading({ kind: "offer", text: OWNER, today: "2026-11-09" }).fields.date, "2026-11-09");
  assert.equal(buildReading({ kind: "offer", text: OWNER, today: "2027-03-01" }).fields.date, "2026-11-09");
  // On 5 November "9 Nov" may be four days ahead or a year old: neither is guessed.
  const early = buildReading({ kind: "offer", text: OWNER, today: "2026-11-05" });
  assert.equal(early.fields.date, undefined);
  assert.match(reasonFor(early, "date") || "", /still to come/);
  assert.equal(early.fields.rentPa, 120000);
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
  assert.deepEqual(r.leftover, ["They offered £120k"], "the whole sentence, not a fragment");
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
    ["9/11", "2026-11-09"], ["1st of October", "2026-10-01"], ["last Tuesday", "2026-11-10"], ["Last Friday", "2026-11-06"],
  ];
  for (const [text, day] of cases) assert.equal(readLooseDate(text, TODAY), day, text);
});

test("dates: a day and month with no year is the most recent one, never a future one and never a guess", () => {
  assert.equal(readLooseDate("13 Nov", TODAY), "2026-11-13");
  assert.equal(readLooseDate("20 Sep", TODAY), "2026-09-20");
  assert.equal(readLooseDate("15 Jan", TODAY), "2026-01-15");
  // Still to come in the next few weeks, or last year's: not placed.
  for (const text of ["20 Nov", "1 Dec", "1st of December", "25 Dec", "14 Jan", "tomorrow", "next Monday"]) assert.equal(readLooseDate(text, TODAY), null, text);
  assert.equal(readLooseDate("29 Feb", TODAY), null, "the last 29 February was years back");
});

test("dates: a viewing may be booked ahead, a follow-up is always ahead", () => {
  assert.equal(readLooseDate("20 Nov", TODAY, "nearest"), "2026-11-20");
  assert.equal(readLooseDate("9 Nov", TODAY, "nearest"), "2026-11-09");
  assert.equal(readLooseDate("9 Nov", TODAY, "future"), "2027-11-09");
  assert.equal(readLooseDate("next Monday", TODAY, "nearest"), "2026-11-16");
  assert.equal(readLooseDate("5 Jan", TODAY, "nearest"), "2027-01-05");
  assert.equal(readLooseDate("14 May", TODAY, "nearest"), null, "six months away either way: not guessed");
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
  const r = read("Ben Sykes 9 Nov spoke to their agent, rent 120k", "offer", { staffNames: ["Ben Sykes"] });
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
  const stamped = buildReading({ kind: "offer", today: TODAY, text: "Ben Sykes 9 Nov rent 120k", staffNames: ["Ben Sykes"], candidate: { contactName: { value: "Ben Sykes", quote: "Ben Sykes" } }, usedAi: true });
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


// ── Review round, 13 November 2026: the notes that were misread ────────────
//
// Each test below holds notes a reviewer ran and the reading they must give.
// The house rule throughout: refuse rather than guess. When a note can be read
// two ways nothing is set and `dropped` says why.

test("terms listed one per line are read line by line, never joined across a line end", () => {
  const list = read("Rent: £120,000 pax\nTerm: 15 years\nRent free: 6 months\nDeposit: 3 months\nBreak: tenant, year 10\nTurnover: 9%");
  assert.deepEqual(list.fields, { rentPa: 120000, termYears: 15, rentFreeMonths: 6, rentDeposit: "3 months", breakOption: "Tenant break at year 10", turnoverRentPct: 9 });
  assert.deepEqual(list.quotes, { rentPa: "Rent: £120,000 pax", termYears: "Term: 15 years", rentFreeMonths: "Rent free: 6 months", rentDeposit: "Deposit: 3 months",
    breakOption: "Break: tenant, year 10", turnoverRentPct: "Turnover: 9%" });
  assert.deepEqual(list.dropped, []);
  const cases: [string, Record<string, unknown>][] = [
    ["Term 10 years\nRF 6 months", { termYears: 10, rentFreeMonths: 6 }],
    ["Term: 15 years\nRF: 6 months", { termYears: 15, rentFreeMonths: 6 }],
    ["Lease: 10 years\nRent free: nil", { termYears: 10, rentFreeMonths: 0 }],
    ["Rent free: 9 months\nDeposit: 6 months", { rentFreeMonths: 9, rentDeposit: "6 months" }],
    ["Rent free 9 months\nDeposit 6 months", { rentFreeMonths: 9, rentDeposit: "6 months" }],
    ["9 months rent free\n6 months deposit", { rentFreeMonths: 9, rentDeposit: "6 months" }],
    ["Rent free - 9 months\nRent deposit - 6 months", { rentFreeMonths: 9, rentDeposit: "6 months" }],
    ["Rent free 9 months, deposit 6 months", { rentFreeMonths: 9, rentDeposit: "6 months" }],
    ["RF 9 months deposit 6 months", { rentFreeMonths: 9, rentDeposit: "6 months" }],
    ["Rent free 6 months deposit 3 months rent 100k", { rentFreeMonths: 6, rentDeposit: "3 months", rentPa: 100000 }],
    ["6 months deposit 3 months rent free", { rentDeposit: "6 months", rentFreeMonths: 3 }],
    ["£120k pax, term 10 years rf 6 months", { rentPa: 120000, termYears: 10, rentFreeMonths: 6 }],
    ["Rent £120k pax\nTerm 15 years\nRent free 6 months\nDeposit 3 months", { rentPa: 120000, termYears: 15, rentFreeMonths: 6, rentDeposit: "3 months" }],
    ["Rent: £120k\nTurnover: 9%\nTerm: 15 years\nRF: 6 months", { rentPa: 120000, turnoverRentPct: 9, termYears: 15, rentFreeMonths: 6 }],
    ["Rent: £65,000 pax\nTerm: 10 years\nBreak: 5th anniversary, tenant only\nRent free: 9 months\nDeposit: 6 months\nRent review: 5 yearly, upward only",
      { rentPa: 65000, termYears: 10, breakOption: "Tenant break at year 5", rentFreeMonths: 9, rentDeposit: "6 months", rentReview: "Rent review: 5 yearly, upward only" }],
    ["£120k pax, 15 years, TBO yr 10, 6 MRF, 3m dep", { rentPa: 120000, termYears: 15, breakOption: "Tenant break at year 10", rentFreeMonths: 6, rentDeposit: "3 months" }],
    ["10 years, 12 months rent free. Deposit waived.", { termYears: 10, rentFreeMonths: 12, rentDeposit: "No deposit" }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(boxes(read(text)), expected, text);
  assert.deepEqual(read("Rent free 9 months\nDeposit 6 months", "round").fields, { rentFreeMonths: 9, rentDeposit: "6 months" }, "a round: the deposit is not the rent free figure");
  // A bare "6 months" on its own line belongs to nothing: it is kept for the notes box.
  const bullets = read("- 15 yrs\n- £120k pax\n- 6 months\n- deposit tbc");
  assert.deepEqual(boxes(bullets), { termYears: 15, rentPa: 120000 });
  assert.equal(bullets.fields.note, "6 months. deposit tbc");
});

test("a negative viewing outcome is never read as its opposite", () => {
  const notKeen = ["Not very keen", "weren't interested", "no longer interested", "not really interested", "not that keen", "isn't interested", "didn't like it",
    "No longer keen after seeing the service yard", "Uninterested", "Sam said they were hardly keen at all", "they did not like the unit", "not keen at this stage"];
  for (const text of notKeen) assert.equal(read(text, "viewing_outcome").fields.outcome, "Not Interested", text);
  // Says neither plainly: no outcome, and the words stay in the notes.
  const none = ["Wasn't keen on the frontage", "not sure they are interested", "no offer received yet", "not expecting an offer", "no second viewing needed",
    "no need to follow up", "They are not interested in the upper floor only", "unit has been declined planning", "lukewarm, too big for them", "Haven't ruled it out",
    "He wasn't not interested", "Never been keener", "Viewing cancelled, they've gone cold"];
  for (const text of none) {
    const r = read(text, "viewing_outcome");
    assert.equal(r.fields.outcome, undefined, text);
    assert.equal(r.fields.note, text.replace(/\.$/, ""), text);
  }
  // Says both: refused, with the reason.
  const both = ["They liked the unit but not interested at that rent", "Viewing went well, Sam was not keen on the back of house but overall positive",
    "Not keen on rent, but interested in unit 5 instead", "Dishoom positive about unit; Pho not interested", "Interested but declined to offer",
    "Keen. Not keen on unit 3 though", "Not interested in the unit as too small, but keen on unit 7"];
  for (const text of both) {
    const r = read(text, "viewing_outcome");
    assert.equal(r.fields.outcome, undefined, text);
    assert.match(reasonFor(r, "outcome") || "", /both ways/, text);
  }
  assert.equal(read("Went well, they are positive. Offer to follow next week", "viewing_outcome").fields.outcome, "Offer Expected");
  assert.equal(read("positive covid test, didn't attend", "viewing_outcome").fields.outcome, "No Show");
  assert.equal(read("Not a no show, they turned up late. Very interested", "viewing_outcome").fields.outcome, "Interested");
  assert.equal(read("Really positive viewing, they did not make an offer but will revert", "viewing_outcome").fields.outcome, "Interested");
  assert.equal(outcomeFromWords("Not very keen")?.outcome, "Not Interested");
  assert.equal(outcomeFromWords("no longer interested")?.quote, "no longer interested");
});

test("an AI outcome cannot turn a negative note round", () => {
  const r = buildReading({ kind: "viewing_outcome", today: TODAY, text: "Not very keen", usedAi: true, candidate: { outcome: { value: "Interested", quote: "Not very keen" } } });
  assert.equal(r.fields.outcome, "Not Interested");
  const opposite = check("Sam says the board is not at all keen", { outcome: { value: "Interested", quote: "not at all keen" } }, "viewing_outcome");
  assert.equal(opposite.fields.outcome, undefined);
  assert.ok(reasonFor(opposite, "outcome"));
  const bothWays = buildReading({ kind: "viewing_outcome", today: TODAY, text: "Keen on the unit, not keen on the rent", usedAi: true, candidate: { outcome: { value: "Interested", quote: "Keen on the unit" } } });
  assert.equal(bothWays.fields.outcome, undefined, "the rules refused it, so the AI cannot fill it");
});

test("a yearly figure that is turnover, sales, rates, a service charge or a guide is not the rent", () => {
  const cases: [string, number | undefined][] = [
    ["They turn over £2m a year. Offer £100k pax", 100000],
    ["Site doing £2.5m pa. Offering £150k pax", 150000],
    ["T/O c£2m pa, rent offer £100k pax", 100000],
    ["Sales approx £2m pa. £100k pax", 100000],
    ["Rates approx £45k pa. Offer of £90k.", undefined],
    ["£20k pa service charge, £95k pax", 95000],
    ["£20k pa s/c and £95k pa rent", 95000],
    ["Guide rent £150k pax. Offer £120k pax.", 120000],
    ["Quoting rent £150k pax. They offered £125k pax", 125000],
    ["Rent passing £100k pa. Offer £110k pa.", 110000],
    ["Service charge capped at £12k pa, rent £88k pax, insurance £2k pa", 88000],
    ["turnover last year was £2m pa, offering £100k pa", 100000],
    ["ITZA £250, rent £125k pa", 125000],
    ["They turn over about £2m a year", undefined],
    ["o/a £100k pax", undefined],
    ["Asking £150k pax", undefined],
    ["2 x £50k pa", undefined],
    ["Their best is £120k pax", 120000],
    ["Latest £120k pax, costs £5k", 120000],
    ["rent c.£90k", 90000],
  ];
  for (const [text, rent] of cases) assert.equal(read(text).fields.rentPa, rent, text);
  // The figure that was not the rent stays in the notes box, whole.
  assert.equal(read("They turn over £2m a year. Offer £100k pax").fields.note, "They turn over £2m a year");
});

test("monthly, quarterly, Zone A and per square metre figures are refused, each with a reason", () => {
  const refused = ["Rent £10k p.m.", "Rent £10k p/m", "Rent £10k per mth", "rent £30k pq", "rent £30k per qtr", "Rent £1,200 ITZA", "Rent £1,250 Zone A, 10 yr lease",
    "rent £1,200 per sq m", "Rent £8,500 pcm", "rent £2,000 per week", "£2,000pw", "£95psf", "£95/sq ft", "£95 per square foot", "£95 /sqft overall", "rent £40 psm",
    "rent £30k each quarter", "rent £9k every month", "Rent £300 ZA", "rent £25k p.q."];
  for (const text of refused) {
    const r = read(text);
    assert.equal(r.fields.rentPa, undefined, text);
    assert.match(reasonFor(r, "rentPa") || "", /not a yearly figure/, text);
  }
  assert.equal(read("£120k p/a, 10 yr").fields.rentPa, 120000, "p/a is per annum");
  assert.equal(read("£45 psf overall equating to £112,500 pa").fields.rentPa, 112500, "the yearly figure beside a psf one");
  assert.equal(read("£500 pa").fields.rentPa, undefined);
  assert.match(reasonFor(read("£999,999,999 pa"), "rentPa") || "", /too large/, "left out with a reason, not in silence");
});

test("an AI value never fills a box the rules refused, and its figure is checked against the words around it", () => {
  const ai = (text: string, candidate: unknown, kind: NoteKind = "offer") => buildReading({ kind, today: TODAY, text, candidate, usedAi: true });
  const monthly = ai("Offer is £10k per calendar month", { rentPa: { value: 10000, quote: "£10k" } });
  assert.equal(monthly.fields.rentPa, undefined);
  assert.equal(monthly.dropped.filter(d => d.field === "rentPa").length, 1, "one reason, and no value beside it");
  assert.equal(ai("Offer is £10k p.m. for 5 years", { rentPa: { value: 10000, quote: "£10k" } }).fields.rentPa, undefined);
  assert.equal(ai("They said £30k every quarter in advance", { rentPa: { value: 30000, quote: "£30k" } }).fields.rentPa, undefined);
  // The unit of the figure can sit well after the quote.
  assert.match(reasonFor(check("Offer is £10k per calendar month", { rentPa: { value: 10000, quote: "£10k" } }), "rentPa") || "", /not a yearly figure/);
  // A floor area is not a sum.
  const note = "They want a 10 year lease at 95 psf, about 2,400 sq ft, six months rent free. Sam at Dishoom.";
  assert.match(reasonFor(check(note, { rentPa: { value: 2400, quote: "about 2,400 sq ft" } }), "rentPa") || "", /floor area/);
  assert.match(reasonFor(check(note, { premium: { value: 2400, quote: "2,400 sq ft" } }), "premium") || "", /floor area/);
  assert.match(reasonFor(check(note, { premium: { value: 2400, quote: "2,400" } }), "premium") || "", /floor area/, "the unit sits just after the quote");
  assert.ok(reasonFor(check(note, { fittingOutContribution: { value: 95, quote: "95 psf" } }), "fittingOutContribution"));
  // Turnover and a service charge are not rent for the AI either.
  assert.match(reasonFor(check("They turn over about £2m a year and want the unit", { rentPa: { value: 2000000, quote: "£2m a year" } }), "rentPa") || "", /other than the rent/);
  assert.match(reasonFor(check("They will pay £20k a year service charge", { rentPa: { value: 20000, quote: "£20k a year" } }), "rentPa") || "", /other than the rent/);
  assert.equal(check("Asking £150k, they bid 130", { rentPa: { value: 150000, quote: "£150k" } }).fields.rentPa, undefined);
  // Two rents: the rules refuse, so the AI's choice of one is not used.
  const two = ai("Improved from £100k pax to £115k pax", { rentPa: { value: 115000, quote: "£115k pax" } });
  assert.equal(two.fields.rentPa, undefined);
  assert.equal(reasonFor(two, "rentPa"), "The note gives more than one rent. Type the rent.");
  // A date still to come, and the date of something else.
  assert.match(reasonFor(ai("They offered 100k, dated 20 Nov", { date: { value: "2025-11-20", quote: "20 Nov" } }), "date") || "", /still to come/);
  assert.match(reasonFor(ai("They offered 100k. Completion by 1 Dec 2025", { date: { value: "2025-12-01", quote: "1 Dec 2025" } }), "date") || "", /something else/);
  // mergeReadings itself holds the rule.
  const merged = mergeReadings(short("Rent £10k pcm"), check("Rent £10k pcm, or 9 Nov", { rentPa: { value: 10000, quote: "9 Nov" } }));
  assert.equal(merged.fields.rentPa, undefined);
});

test("two rents, or a range, set no rent and say so", () => {
  const cases = ["Improved from £100k pax to £115k pax", "was £100k pa, now £115k pa", "First offer £100k pax, improved offer £115k pax", "Rent £90-100k pax",
    "£90k - £100k pa, 10-15 years", "Offer increased to £115k pax (previously £100k pax)", "Two offers: Dishoom at £120k pax 15 yrs, Pho at £100k pax 10 yrs",
    "Stepped rent: yr 1 £60k pa, yr 2 £70k pa. 10 years", "They offered £100k pax; we want £120k pax", "Rent £85k pax (they opened at £70k pax)",
    "Net effective rent £95k, headline £120k pax", "£75k pax yr 1-2 then £85k pax", "Rent £1 pa peppercorn for 2 years then £80k pax", "Offer 10yr at 110kpa. Our floor is 120k pa"];
  for (const text of cases) {
    const r = read(text);
    assert.equal(r.fields.rentPa, undefined, text);
    assert.equal(reasonFor(r, "rentPa"), "The note gives more than one rent. Type the rent.", text);
    assert.ok((r.fields.note || "").includes("£") || /110kpa/.test(r.fields.note || ""), `${text}: the figures stay in the notes`);
  }
  for (const text of ["rent £85k rising to £95k yr 3", "Rent £100k pa in year 1-2, £110k thereafter"]) assert.match(reasonFor(read(text), "rentPa") || "", /stepped rent/, text);
  const range = read("£90k - £100k pa, 10-15 years");
  assert.equal(range.fields.termYears, undefined);
  assert.equal(reasonFor(range, "termYears"), "The note gives a range of years. Type the term.");
  assert.equal(read("10-15 year lease").fields.termYears, undefined);
  assert.equal(read("term 10 to 15 years").fields.termYears, undefined);
  // The same figure twice is one rent, and a list set out with dashes is not a range.
  assert.equal(read("Rent £120k pax. To confirm, £120k pax.").fields.rentPa, 120000);
  assert.deepEqual(read("TBO yr 5 - 6 MRF - £120k pax - £50k CC").fields, { breakOption: "Tenant break at year 5", rentFreeMonths: 6, rentPa: 120000, fittingOutContribution: 50000 });
  // A range of months or of a percentage is refused the same way.
  const ranges = read("RF 6-9 months, 8-10% t/o, 3 or 6 months deposit");
  assert.deepEqual(boxes(ranges), {});
  assert.deepEqual(ranges.dropped.map(d => d.field).sort(), ["rentDeposit", "rentFreeMonths", "turnoverRentPct"]);
  assert.equal(read("They want 6-9 months rent free").fields.rentFreeMonths, undefined);
});

test("'3m' before the word rent is three months, not three million pounds", () => {
  assert.deepEqual(boxes(read("3m rent in advance, £100k pax")), { rentPa: 100000 });
  assert.deepEqual(boxes(read("6m half rent then £100k pax")), { rentPa: 100000 });
  assert.equal(read("3m rent in advance").fields.rentPa, undefined);
  assert.equal(read("rent 1.2m, 20 years").fields.rentPa, undefined, "millions need the pound sign or a per-year word");
  assert.equal(read("£3m rent, 20 years").fields.rentPa, 3000000);
  assert.equal(read("rent of 1.2m pa").fields.rentPa, 1200000);
  assert.equal(read("9m RF").fields.rentFreeMonths, 9);
  assert.match(reasonFor(check("3m rent in advance please", { rentPa: { value: 3000000, quote: "3m rent" } }), "rentPa") || "", /not in the words/);
});

test("a date still to come is not moved back a year, and the date of something else is not the offer's date", () => {
  const noDate = ["Offer £100k pax, completion by 1 Dec", "Offer £100k pax, opening 1 March", "Their lease at Bluewater expires 24 June. Offer £100k pax",
    "£100k pax. 20 Nov viewing with their FD", "Rent £100k pa from 25 Dec", "Offer dated 20 Nov: £90k pax", "Lease start 25 March 2027. £100k pax",
    "rent commencement 1 March 2027, £100k pa", "Offer valid until 30 Nov. £90k pax", "Rent £100k pax w.e.f. 1 Jan 2027", "Offer tomorrow expected at £100k pax",
    "£100k pax, start 1 Feb, expiry 31 Jan 2037"];
  for (const text of noDate) {
    const r = read(text);
    assert.equal(r.fields.date, undefined, text);
    assert.ok(r.fields.rentPa, text);
  }
  assert.match(reasonFor(read("Offer dated 20 Nov: £90k pax"), "date") || "", /"20 Nov" looks like a date still to come/);
  for (const [text, kind] of [["Postponed to 20 Nov", "viewing_outcome"], ["Viewing 20 Nov. interested", "viewing_outcome"], ["they want to revisit with the architect on 20 Nov", "viewing_outcome"]] as [string, NoteKind][]) {
    assert.equal(read(text, kind).fields.date, undefined, text);
  }
  assert.match(reasonFor(read("Viewing 20 Nov. interested", "viewing_outcome"), "date") || "", /still to come/);
  assert.equal(reasonFor(read("Postponed to 20 Nov", "viewing_outcome"), "date"), undefined, "a moved viewing's new day is simply not the outcome's date");
  // A booked viewing still takes the coming date; one moved takes the new day.
  assert.equal(read("viewing moved to 20 Nov 2pm", "viewing").fields.date, "2026-11-20");
  assert.equal(read("Viewing w/c 23 Nov tbc", "viewing").fields.date, undefined, "a week commencing is not a day");
  // Dates that are the offer's own.
  assert.equal(read("Offer of £95k pax made 3/11").fields.date, "2026-11-03");
  assert.equal(read("Received 1st Nov, £90k pax").fields.date, "2026-11-01");
  assert.equal(read("Offer 5th Nov '26: £90k pax").fields.date, "2026-11-05");
  // Two different days: neither is guessed.
  for (const [text, kind] of [["Offer 9 Nov following viewing on 5 Nov. £100k pax", "offer"], ["9 Nov: £100k pax. 10 Nov: improved to 10 MRF", "offer"], ["was 18 Nov, now 20 Nov at 10am", "viewing"]] as [string, NoteKind][]) {
    const r = read(text, kind);
    assert.equal(r.fields.date, undefined, text);
    assert.equal(reasonFor(r, "date"), "The note gives more than one date. Set the date by hand.", text);
  }
  const far = read("Viewing 20 May 3pm", "viewing");
  assert.equal(far.fields.date, undefined);
  assert.match(reasonFor(far, "date") || "", /long way off either way/);
  assert.equal(readLooseDate("31/11", TODAY), null);
});

test("a target comment's dates are placed from the day it was written; today still decides the future", () => {
  const from = (kind: NoteKind, text: string, writtenOn: string) => buildReading({ kind, text, today: TODAY, writtenOn });
  assert.equal(from("viewing", "Viewed yesterday, keen", "2026-02-03").fields.date, "2026-02-02");
  assert.equal(read("Viewed yesterday, keen", "viewing").fields.date, "2026-11-12", "a pasted note has no written day: today is used");
  assert.deepEqual(boxes(from("viewing", "viewing booked 12 Jan 10am", "2026-01-05")), { date: "2026-01-12", time: "10:00" });
  assert.equal(from("offer", "Offer 20 Dec: £90k pax", "2025-12-22").fields.date, "2025-12-20");
  assert.equal(from("offer", "Offer last Tuesday £90k pax", "2026-03-13").fields.date, "2026-03-10");
  assert.equal(from("viewing_outcome", "Viewed today. Keen. Chase by 20 Mar", "2026-03-10").fields.followUpDate, "2026-03-20");
  // A written day that is itself in the future, or is not a day, is ignored.
  assert.equal(from("offer", "Offer yesterday £90k pax", "2027-01-01").fields.date, "2026-11-12");
  assert.equal(from("offer", "Offer yesterday £90k pax", "not a day").fields.date, "2026-11-12");
  // The comment was written before the viewing it names: it cannot hold that viewing's outcome.
  const early = from("viewing", "Viewing 20 Mar 2pm, they are keen", "2026-03-10");
  assert.equal(early.fields.date, "2026-03-20");
  assert.equal(early.fields.outcome, undefined);
  assert.match(reasonFor(early, "outcome") || "", /had not happened/);
  // Today, not the written day, is the test of a date in the future.
  assert.match(reasonFor(from("offer", "Offer dated 20/11/2026, rent 120k", "2026-01-05"), "date") || "", /future/);
  // The AI's date quote is placed from the written day too.
  const ai = normaliseCandidate("They rang yesterday about the unit", { date: { value: "2026-11-12", quote: "yesterday" } }, { kind: "interest", today: TODAY, writtenOn: "2026-02-03" });
  assert.equal(ai.fields.date, "2026-02-02");
});

test("the reader passes a comment's own day to the rules", async () => {
  const { deps } = fake({ hasKey: () => false });
  const r = await readLettingNote({ ...input("Viewed yesterday, keen", "viewing"), writtenOn: "2026-02-03" }, deps);
  assert.equal(r.fields.date, "2026-02-02");
  assert.match(readerCode, /writtenOn = fromTarget\?\.day/);
  assert.match(readerCode, /kind, text, today, writtenOn,/);
});

test("fractions and unit numbers are not dates", () => {
  const cases = ["Unit 3/4 - Dishoom offer £120k pax", "Units 1/2: £120k pax", "Offer 1/2 rent for 12 months then £100k pa", "breaks at 5/10", "A1/3 use. £100k pax",
    "TBO 5/10, £120k pax, 15 yr lease", "Unit 12 Nov Street. £50k pa", "Kiosk 2/3 offer £30k pax", "50/50 split of costs, £100k pax", "open 24/7, £100k pax"];
  for (const text of cases) assert.equal(read(text).fields.date, undefined, text);
  assert.equal(read("Unit 3/4 - Dishoom offer £120k pax", "offer", { brandNames: ["Dishoom"] }).fields.brandName, "Dishoom");
  assert.equal(read("TBO 5/10, £120k pax, 15 yr lease").fields.breakOption, undefined, "two break years: left for the person");
  assert.equal(read("Viewing 20/11 at 2.30pm", "viewing").fields.date, "2026-11-20", "a real slash date still reads");
  assert.equal(read("Offer received 09/11: £150k pa").fields.date, "2026-11-09");
});

test("a brand, or the brand's own person, at the start of a pasted note is not taken as its author", () => {
  for (const text of ["Honest Burgers 9 Nov: offered £120k pax", "Pizza Pilgrims 12 Nov offered £120k pax, 10 years", "Sam Hart 12 Nov offered £140k pax",
    "Jane Roe 12/11 - keen on the unit for Honest Burgers", "Honest Burgers 9 Nov Offered £120k pax", "Knight Frank 9 Nov Offered £100k pax", "Five Guys 9 Nov Offered £100k pax"]) {
    assert.equal(read(text).saidBy, null, text);
  }
  // The brand's own person is then free to be the contact, and the agent the agent.
  const contact = buildReading({ kind: "offer", today: TODAY, text: "Sam Hart 12 Nov offered £140k pax", staffNames: ["Ben Sykes"], usedAi: true, candidate: { contactName: { value: "Sam Hart", quote: "Sam Hart" } } });
  assert.equal(contact.fields.contactName, "Sam Hart");
  assert.deepEqual(contact.dropped, []);
  const agent = buildReading({ kind: "interest", today: TODAY, text: "Jane Roe 12/11 - keen on the unit for Honest Burgers", staffNames: ["Ben Sykes"], usedAi: true,
    candidate: { agentName: { value: "Jane Roe", quote: "Jane Roe" }, brandName: { value: "Honest Burgers", quote: "Honest Burgers" } } });
  assert.equal(agent.fields.agentName, "Jane Roe");
  assert.equal(agent.fields.brandName, "Honest Burgers");
  // A known colleague, or the caller, is the author however the note is typed, and is never the contact.
  for (const text of ["Ben Sykes 9 Nov spoke to their agent, rent 120k", "BEN SYKES 9 NOV offered £120k pax", "ben sykes 9 nov offered £120k pax", "Ben Sykes · 9 Nov Offered £120k pax",
    "Ben Sykes, 9 Nov 2025: Offered £120k pax", "Ben Sykes (9 Nov) Offered £120k pax", "Ben Sykes 9 Nov 14:02 Offered £120k pax", "Ben Sykes 09/11/2026 Offered £120k pax"]) {
    assert.equal(read(text, "offer", { staffNames: ["Ben Sykes"] }).saidBy, "Ben Sykes", text);
  }
  // A name the reader does not know is taken as the author only in the tracker's own shape: name, date, then words that begin with a capital.
  assert.equal(read("Ben Sykes 9 Nov Offered: rent 120k").saidBy, "Ben Sykes");
  assert.equal(read("Ben Sykes 9 Nov spoke to their agent, rent 120k").saidBy, null, "it could be the brand's person: left in the notes");
  assert.match(read("Ben Sykes 9 Nov spoke to their agent, rent 120k").fields.note || "", /Ben Sykes/);
  // When such a name is also put in a box, the note reads both ways: neither is set, and the reason is honest.
  const twoWays = buildReading({ kind: "offer", today: TODAY, text: "Sam Hart 12 Nov Offered £140k pax", usedAi: true, candidate: { contactName: { value: "Sam Hart", quote: "Sam Hart" } } });
  assert.equal(twoWays.fields.contactName, undefined);
  assert.equal(twoWays.saidBy, null);
  assert.match(reasonFor(twoWays, "contactName") || "", /could be who wrote it or the brand's contact/);
  const labelled = read("Mark Warne 12 Nov Offered £100k pax. Contact: Mark Warne");
  assert.equal(labelled.fields.contactName, undefined);
  assert.equal(labelled.saidBy, null);
});

test("a brand whose name is ordinary words is found only where the note shows a brand is meant", () => {
  const brand = (text: string, kind: NoteKind, brandNames: string[]) => read(text, kind, { brandNames }).fields;
  const none: [string, NoteKind, string[]][] = [
    ["viewing next week, they are keen", "interest", ["Next", "Office", "Boots"]],
    ["Viewing Next week", "interest", ["Next", "Office", "Boots"]],
    ["spoke to office manager, boots on the ground thursday", "interest", ["Next", "Office", "Boots"]],
    ["next step is their board. £100k pax", "offer", ["Next"]],
    ["Next week they want a second viewing at 2pm", "viewing", ["Next", "Dishoom"]],
    ["Next: chase their agent. Rent £100k pax", "offer", ["Next"]],
    ["Spoke to Leon Smith at Wagamama. Rent £100k pax", "offer", ["Leon"]],
    ["Gap in the market for a coffee operator", "interest", ["Gap"]],
    ["Interest from the works dept", "interest", ["The Works"]],
    ["NEXT WEEK THEY WILL OFFER £100K PAX", "offer", ["Next"]],
  ];
  for (const [text, kind, names] of none) assert.equal(brand(text, kind, names).brandName, undefined, text);
  const works = brand("Dishoom keen, landlord to do the works before handover", "interest", ["The Works", "Dishoom"]);
  assert.equal(works.brandName, "Dishoom");
  assert.equal(works.moreBrands, undefined, "the works are building works");
  assert.equal(brand("To be honest burgers are not what the scheme needs. Dishoom better", "interest", ["Honest Burgers", "Dishoom"]).brandName, "Dishoom");
  const found: [string, NoteKind, string[], string][] = [
    ["offer from Next", "offer", ["Next"], "Next"],
    ["Next have offered £100k pax", "offer", ["Next"], "Next"],
    ["pho offered £80k pax", "offer", ["Pho"], "Pho"],
    ["FIVE GUYS OFFER £100K PAX", "offer", ["Five Guys"], "Five Guys"],
    ["The Works are keen on unit 4", "interest", ["The Works"], "The Works"],
    ["Enquiry from the Works via Savills", "interest", ["The Works"], "The Works"],
    ["Office keen on the first floor", "interest", ["Office"], "Office"],
    ["Three want a kiosk", "interest", ["Three"], "Three"],
    ["Leon called. Leon Smith is the contact", "interest", ["Leon"], "Leon"],
    ["jersey mike's offered £100k pax", "offer", ["Jersey Mike's"], "Jersey Mike's"],
    ["next week Zara will come back", "interest", ["Next", "Zara"], "Zara"],
    ["Enquiry 5 Nov from office of H&M", "interest", ["Office", "H&M"], "H&M"],
  ];
  for (const [text, kind, names, name] of found) assert.equal(brand(text, kind, names).brandName, name, text);
  assert.deepEqual(brand("Interest from Next and Dishoom", "interest", ["Next", "Dishoom"]).moreBrands, [{ name: "Dishoom" }]);
});

test("a labelled line does not take a placeholder or a whole clause as a name", () => {
  assert.deepEqual(read("contact is not known yet", "interest").fields, { note: "contact is not known yet" });
  assert.deepEqual(read("brand: tbc", "interest").fields, { note: "brand: tbc" });
  assert.deepEqual(boxes(read("Contact: n/a. Agent: unknown. Brand: Nando's", "interest")), { brandName: "Nando's" });
  assert.deepEqual(boxes(read("agent is James at CBRE acting for Pho", "interest", { brandNames: ["Pho"] })), { agentName: "James", agentCompanyName: "CBRE", brandName: "Pho" });
  assert.deepEqual(read("Agent: Jane Roe (Savills). Brand: Honest Burgers. Contact: Sam Hart", "interest").fields,
    { agentName: "Jane Roe", agentCompanyName: "Savills", brandName: "Honest Burgers", contactName: "Sam Hart" });
  assert.deepEqual(boxes(read("Agent: Jo Lee from Savills for Itsu", "interest", { brandNames: ["Itsu"] })), { agentName: "Jo Lee", agentCompanyName: "Savills", brandName: "Itsu" });
  assert.equal(read("Contact: Sam Hart at Dishoom. Rent 120k").fields.contactName, "Sam Hart");
  assert.equal(read("Agent: Jane Roe (Savills). Rent 120k").fields.agentCompanyName, undefined, "an offer form has no box for the firm");
  assert.equal(check("Contact tbc. Rent 120k", { contactName: { value: "tbc", quote: "Contact tbc" } }).fields.contactName, undefined);
});

test("the smaller shorthand misreads", () => {
  assert.deepEqual(read("rent £120k, t/o 9%, 15yrs, 6 mth rf, 5yr TBO").fields, { rentPa: 120000, turnoverRentPct: 9, termYears: 15, rentFreeMonths: 6, breakOption: "Tenant break at year 5" });
  assert.deepEqual(read("£120k pax 15 years 6 MRF 9% TO").fields, { rentPa: 120000, termYears: 15, rentFreeMonths: 6, turnoverRentPct: 9 });
  assert.equal(read("We need to talk about 9% to them").fields.turnoverRentPct, undefined, "'to' in small letters is a word");
  const hots = read("HoTs offer: base rent £80k or 10% turnover whichever higher. 10 years. T break yr 5. RF 6 months.");
  assert.deepEqual(boxes(hots), { rentPa: 80000, turnoverRentPct: 10, termYears: 10, breakOption: "Tenant break at year 5", rentFreeMonths: 6 });
  assert.doesNotMatch(hots.fields.note || "", /\bT\b/, "the T is part of the break, not left over");
  const breaks: [string, string | undefined][] = [["LL break at year 3", "Landlord break at year 3"], ["LBO yr 7", "Landlord break at year 7"], ["MBO at year 5", "Mutual break at year 5"],
    ["3yr MBO", "Mutual break at year 3"], ["10 yr lease, break at 5 yrs", "Break at year 5"], ["break at 5", "Break at year 5"], ["Break clause yr 5 (tenant) with 6 months' penalty", "Tenant break at year 5"],
    ["breaks at years 5 and 10", undefined], ["TBO yrs 3 and 6", undefined], ["Break: none", "No break"]];
  for (const [text, value] of breaks) assert.equal(read(text).fields.breakOption, value, text);
  for (const text of ["£20k contribution to legals", "£20k contribution to legal costs", "LL to contribute £5k to legal costs", "£5k towards legal costs"]) {
    assert.equal(read(text).fields.fittingOutContribution, undefined, text);
    assert.equal(read(text).fields.note, text, text);
  }
  assert.equal(read("Works contribution £40k").fields.fittingOutContribution, 40000);
  // How long they have traded, or a period within the lease, is not the term.
  for (const text of ["They've been in Covent Garden 10 years. Offer £100k pa", "been trading for 12 years, offer £100k pax", "Established 25 years. £100k pax", "half rent for 2 years, £100k pax"]) {
    assert.deepEqual(boxes(read(text)), { rentPa: 100000 }, text);
  }
  assert.match(reasonFor(check("They've been in Covent Garden 10 years. Offer £100k pa", { termYears: { value: 10, quote: "10 years" } }), "termYears") || "", /how long they have traded/);
  assert.equal(check("They offered a 10 year lease", { termYears: { value: 10, quote: "10 year lease" } }).fields.termYears, 10);
  // A time range is read as its start; two different times are not guessed.
  const times: [string, string | undefined][] = [["Viewing 2-3pm 20 Nov", "14:00"], ["between 10 and 11am Tuesday 17 Nov", "10:00"], ["Viewing 11-1pm 20 Nov", "11:00"],
    ["Viewing 12-1pm 20 Nov", "12:00"], ["Viewing 10 to 11.30am 20 Nov", "10:00"], ["Viewing Thurs 19th Nov 3.15pm w/ Sam + architect", "15:15"], ["can't make 2pm, moved to 4pm on 18 Nov", undefined]];
  for (const [text, time] of times) assert.equal(read(text, "viewing").fields.time, time, text);
  assert.equal(reasonFor(read("can't make 2pm, moved to 4pm on 18 Nov", "viewing"), "time"), "The note gives more than one time. Set the time by hand.");
  assert.deepEqual(read("between 10 and 11am Tuesday 17 Nov", "viewing").fields, { date: "2026-11-17", time: "10:00" });
});

test("what is left over goes into the notes box as whole sentences, never as fragments", () => {
  const whole = ["Improved from £100k pax to £115k pax", "Two offers: Dishoom at £120k pax 15 yrs, Pho at £100k pax 10 yrs",
    "10 year FRI lease at £65,000 per annum with 5 yearly reviews and a 6 month rent free period", "Rent £100k pa from 25 Dec"];
  for (const text of whole) assert.equal(read(text).fields.note, text, text);
  const cases: [string, string | undefined][] = [
    ["Rent £87,500 p.a.x. Term 10 years. Needs board sign off.", "Needs board sign off"],
    ["Rent 95k p.a. subject to board. 10 yrs.", "Rent 95k p.a. subject to board"],
    ["They want A3 use e.g. a cafe. Rent £50k pax", "They want A3 use e.g. a cafe"],
    ["Offer £120k pax!! Great result. 15 years", "Great result"],
    ["rent £45 psf, 10 years", "rent £45 psf"],
    ["Rent 120k + VAT, s/c £20k, rates £45k", "Rent 120k + VAT, s/c £20k, rates £45k"],
    ["Call 07700 900123. They offer £110k pax, 10 year lease", "Call 07700 900123"],
    ["Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF", undefined],
    ["Rent £100k pax w.e.f. 1 Jan 2027", "Rent £100k pax w.e.f. 1 Jan 2027"],
  ];
  for (const [text, note] of cases) assert.equal(read(text).fields.note, note, text);
  assert.equal(read("Woody Bruce 12 Nov: spoke to Sam, they will go to £140k pax", "offer", { staffNames: ["Woody Bruce"] }).fields.note, "spoke to Sam, they will go to £140k pax", "less the name and date it opens with");
  // With an AI reading: the sentences the AI placed drop out whole; the rest stay whole.
  const ai = buildReading({ kind: "offer", today: TODAY, text: "Dishoom offered £120k. They need an answer fast.", brandNames: ["Dishoom"], usedAi: true, candidate: { rentPa: { value: 120000, quote: "£120k" } } });
  assert.equal(ai.fields.note, "They need an answer fast");
  const mixed = buildReading({ kind: "offer", today: TODAY, text: NOTE, brandNames: ["Dishoom"], usedAi: true,
    candidate: { contactName: { value: "Sam Hart", quote: "Spoke to Sam Hart" }, rentFreeMonths: { value: 6, quote: "six months rent free" }, unplaced: ["Service charge cap wanted"] } });
  assert.equal(mixed.fields.note, "Service charge cap wanted");
  const area = buildReading({ kind: "offer", today: TODAY, text: "They want a 10 year lease at 95 psf, about 2,400 sq ft, six months rent free. Sam at Dishoom.", brandNames: ["Dishoom"], usedAi: true,
    candidate: { contactName: { value: "Sam", quote: "Sam at Dishoom" }, rentFreeMonths: { value: 6, quote: "six months rent free" } } });
  assert.equal(area.fields.note, "They want a 10 year lease at 95 psf, about 2,400 sq ft, six months rent free");
});

// ── Safety ─────────────────────────────────────────────────────────────────

test("long runs of white space are closed up before anything reads the note", () => {
  assert.equal(cleanNote("  Rent   £120k\t\tpax \r\n\r\n\n  15 years \u00a0 6 MRF  "), "Rent £120k pax\n15 years 6 MRF");
  assert.equal(cleanNote("a\u0000b\u2028c"), "a b c");
  assert.equal(cleanNote(null), "");
  const r = read("Rent £120k pax         15 years\t\t6 MRF");
  assert.deepEqual(r.fields, { rentPa: 120000, termYears: 15, rentFreeMonths: 6 });
  assert.equal(r.text, "Rent £120k pax 15 years 6 MRF");
  assert.equal(read(OWNER).text, OWNER, "an ordinary note is read as written");
});

test("a 4,000 character note of spaces, digits, pound signs or repeated words reads in well under a second", async () => {
  const fillers = [" ", "\t", "\n", "1", "£", "a ", "9 Nov ", "A B ", "rent ", "- ", "6 months ", "1/2 ", "not ", "£1,000", "rr ", "x,", ". ", "12 ", "t/o ", "k ", "upwards only rent review "];
  const leads = ["", "5 yearly rent review", "rr", "rent review", "Ben Sykes 9 Nov Offered: rent £120k pax ", "Viewing 2pm not keen ", "Contact: "];
  const { deps } = fake({ hasKey: () => false });
  let worst = 0, slowest = "";
  for (const lead of leads) for (const filler of fillers) {
    const text = `${lead}${filler.repeat(Math.ceil(4000 / filler.length))}`.slice(0, 3999) + "x";
    assert.equal(text.length, 4000);
    assert.ok(readNoteBody.safeParse({ kind: "offer", text }).success);
    for (const kind of NOTE_KINDS) {
      const started = Date.now();
      await readLettingNote({ ...input(text, kind), staffNames: ["Ben Sykes"] }, deps);
      const took = Date.now() - started;
      if (took > worst) { worst = took; slowest = `${kind}: ${JSON.stringify(lead)} then ${JSON.stringify(filler)} repeated`; }
    }
  }
  assert.ok(worst < 750, `slowest read took ${worst} ms (${slowest})`);
  // The reviewer's note: "5 yearly rent review", 3,979 spaces, "x". It took 85 seconds.
  const started = Date.now();
  const r = await readLettingNote(input(`5 yearly rent review${" ".repeat(3979)}x`), deps);
  assert.ok(Date.now() - started < 500);
  assert.equal(r.fields.rentReview, "5 yearly rent review");
  assert.equal(r.text, "5 yearly rent review x");
});

test("the shorthand rules run once for each read", () => {
  const body = readerSource.slice(readerSource.indexOf("export async function readLettingNote"), readerSource.indexOf("// ── The route"));
  assert.equal(body.split("readShorthand(").length - 1, 1);
  assert.equal(body.split("shorthand }").length - 1 + body.split("shorthand,").length - 1, 3, "each buildReading call is handed the reading already made");
});

test("a login that is not BGP staff is never told who is on BGP's staff", () => {
  const staff = ["Jane Staffer", "Ben Sykes", " "];
  assert.deepEqual(teamNamesFor({ isStaff: true, name: "Victoria Hale" }, staff), ["Jane Staffer", "Ben Sykes", "Victoria Hale"]);
  assert.deepEqual(teamNamesFor({ isStaff: false, name: "Jo Agent" }, staff), ["Jo Agent"], "a joint agent or client login: its own name only");
  assert.deepEqual(teamNamesFor({ isStaff: false, name: null }, staff), []);
  // The reply for a typed name is then the same whether or not that name is one of BGP's people.
  const asJointAgent = (name: string) => read(`Contact: ${name}. Rent £100k pax`, "offer", { staffNames: teamNamesFor({ isStaff: false, name: "Jo Agent" }, staff) });
  assert.equal(asJointAgent("Jane Staffer").fields.contactName, "Jane Staffer");
  assert.deepEqual(asJointAgent("Jane Staffer").dropped, []);
  assert.deepEqual(asJointAgent("Jane Staffer").dropped, asJointAgent("Bob Other").dropped);
  assert.equal(read("Jane Staffer 9 Nov spoke to Sam, rent 120k", "offer", { staffNames: ["Jo Agent"] }).saidBy, null, "nor does a leading name confirm it");
  assert.equal(read("Bob Other 9 Nov spoke to Sam, rent 120k", "offer", { staffNames: ["Jo Agent"] }).saidBy, null);
  // The caller's own name still is.
  assert.ok(reasonFor(asJointAgent("Jo Agent"), "contactName"));
  // BGP staff keep the check.
  assert.ok(reasonFor(read("Contact: Jane Staffer. Rent £100k pax", "offer", { staffNames: teamNamesFor({ isStaff: true, name: "Victoria Hale" }, staff) }), "contactName"));
  // The route: the staff list is read for staff only, active logins only, and goes through teamNamesFor.
  assert.match(readerCode, /access\.isStaff\s*\?\s*\(await pool\.query\(`SELECT name FROM users WHERE lower\(email\) LIKE \$1 AND name IS NOT NULL AND is_active IS NOT FALSE`/);
  assert.match(readerCode, /staffNames: teamNamesFor\(access, staff\)/);
  assert.equal(readerCode.split("FROM users").length - 1, 1, "one read of the users table, and it is the guarded one");
});

test("AI reads are capped for each login as well as across the app", async () => {
  const counts = new Map<string, number>();
  const caps = new Map<string, number>();
  const claimOne = async (key: string, cap: number) => {
    caps.set(key, cap);
    if ((counts.get(key) || 0) >= cap) return false;
    counts.set(key, (counts.get(key) || 0) + 1);
    return true;
  };
  const before = { user: process.env.LETTING_NOTE_READER_USER_DAILY_CAP, all: process.env.LETTING_NOTE_READER_DAILY_CAP };
  try {
    process.env.LETTING_NOTE_READER_USER_DAILY_CAP = "3";
    process.env.LETTING_NOTE_READER_DAILY_CAP = "5";
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push(await claimNoteRead("user-a", claimOne));
    assert.deepEqual(results, [true, true, true, false, false, false], "a login stops at its own cap");
    assert.equal(counts.get("letting_note_reader_usage"), 3, "and its refused reads take nothing from the app's allowance");
    assert.equal(await claimNoteRead("user-b", claimOne), true, "another login still reads");
    assert.equal(await claimNoteRead("user-b", claimOne), true);
    assert.equal(await claimNoteRead("user-b", claimOne), false, "the app's cap still holds");
    assert.equal(await claimNoteRead("", claimOne), false, "no login, no AI read");
    assert.equal(await claimNoteRead(null, claimOne), false);
    assert.equal(caps.get("letting_note_reader_usage:user-a"), 3);
    assert.equal(caps.get("letting_note_reader_usage"), 5);
    delete process.env.LETTING_NOTE_READER_USER_DAILY_CAP;
    await claimNoteRead("user-c", claimOne);
    assert.equal(caps.get("letting_note_reader_usage:user-c"), 100, "100 a day for a login unless set otherwise");
  } finally {
    for (const [key, value] of [["LETTING_NOTE_READER_USER_DAILY_CAP", before.user], ["LETTING_NOTE_READER_DAILY_CAP", before.all]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  assert.equal(noteReaderUserUsageKey("u1"), "letting_note_reader_usage:u1");
  assert.equal(noteReaderUserUsageKey(" "), null);
  // The reader hands the login to the claim, and the route hands the login to the reader.
  const seen: unknown[] = [];
  const { deps } = fake({ claim: async userId => { seen.push(userId); return true; } });
  await readLettingNote({ ...input(NOTE), userId: "user-a" }, deps);
  assert.deepEqual(seen, ["user-a"]);
  assert.match(readerCode, /userId: access\.userId/);
  assert.match(readerCode, /claimNoteRead\(userId, claimDailyRead\)/);
});

test("the login a read is counted against and the comment's day never reach the provider", async () => {
  const { deps, seen } = fake();
  await readLettingNote({ ...input(NOTE), userId: "user-secret-id", writtenOn: "2026-02-03", author: "Ben Sykes" }, deps);
  for (const hidden of ["user-secret-id", "2026-02-03", "Victoria Hale"]) assert.ok(!seen.user.includes(hidden) && !seen.system.includes(hidden), hidden);
});

// ── A second round of notes, written to break the fixes ────────────────────

test("second round: offers and rounds", () => {
  const cases: [string, Record<string, unknown>, NoteKind?][] = [
    ["Offer from Wagamama: £185,000 per annum excl. VAT, 15 yrs, TBO at 10th anniversary, 12 months' rent free, 6 months' rent deposit",
      { rentPa: 185000, termYears: 15, breakOption: "Tenant break at year 10", rentFreeMonths: 12, rentDeposit: "6 months" }],
    ["Rent £120k pax subject to 5 yearly OMV reviews, capped 3%", { rentPa: 120000 }],
    ["They'll do £110,000 a year plus 8% of turnover over £1.5m", { rentPa: 110000, turnoverRentPct: 8 }],
    ["Asking £150k, they bid 130", {}],
    ["£65 Zone A equating to circa £140,000 pax", { rentPa: 140000 }],
    ["Counter 2: £130kpa, 10yrs, RF 9mths, TBO 5th yr, CC £60k, dep 3 mths",
      { rentPa: 130000, termYears: 10, rentFreeMonths: 9, breakOption: "Tenant break at year 5", fittingOutContribution: 60000, rentDeposit: "3 months" }, "round"],
    ["9 months' rent free in lieu of CC", { rentFreeMonths: 9 }],
    ["premium £100k payable to outgoing tenant, rent £250k pax", { premium: 100000, rentPa: 250000 }],
    ["Lease to expire 2036, 10 yrs from Jan 2027", { termYears: 10 }],
    ["5+5 lease, £70k pax", { rentPa: 70000 }],
    ["10 year lease (5 year break), 3% fixed uplifts annually", { termYears: 10, breakOption: "Break at year 5" }],
    ["Rent: 8% of turnover, no base", { turnoverRentPct: 8 }],
    ["LL offering £50 psf fit out contribution on 2,000 sq ft = £100k", {}],
    ["£120k pax inclusive of service charge", { rentPa: 120000 }],
    ["12 Nov call with Sam: they can go to 125 pax", { date: "2026-11-12" }],
    ["HoTs agreed 30/10, rent £100k pax", { date: "2026-10-30", rentPa: 100000 }],
    ["£1.5m premium, £400k pax", { premium: 1500000, rentPa: 400000 }],
    ["they turned over £850k last year, offering 10%", {}],
    ["Rent £100k pax, rent reviews 5 yearly to OMV, lease 10 years, LL break year 7",
      { rentPa: 100000, rentReview: "Rent reviews 5 yearly to OMV", termYears: 10, breakOption: "Landlord break at year 7" }],
    ["We said no to 9 months, agreed 6 months rent free and £125k pax", { rentFreeMonths: 6, rentPa: 125000 }, "round"],
    ["Their final: £127.5k pax, 10 yrs, break 5, 9 mths RF, no CC", { rentPa: 127500, termYears: 10, rentFreeMonths: 9 }, "round"],
    ["deposit 6 months rent free 3 months", { rentDeposit: "6 months", rentFreeMonths: 3 }],
    ["Rent free: none. Deposit: none. Premium: nil. Rent: £100,000", { rentFreeMonths: 0, rentDeposit: "No deposit", rentPa: 100000 }],
    ["no CC, no rent free, £130k pax", { rentFreeMonths: 0, rentPa: 130000 }, "round"],
    ["rent £100.000 pa", {}],
    ["Lease from 2027, rent 2026 £100k pa", { rentPa: 100000 }],
    ["Size 2,500 sq ft. Rent £100k", { rentPa: 100000 }],
    ["3,000 sq ft at £35 = £105,000 pa", { rentPa: 105000 }],
  ];
  for (const [text, expected, kind] of cases) assert.deepEqual(boxes(read(text, kind || "offer")), expected, text);
  const multiLine = read("Ben Sykes 9 Nov\nOffered: 15 year lease\nRent £120kpax\n9% t/o\n6 MRF");
  assert.deepEqual(multiLine.fields, { termYears: 15, rentPa: 120000, turnoverRentPct: 9, rentFreeMonths: 6, date: "2026-11-09" });
  assert.equal(multiLine.saidBy, "Ben Sykes");
});

test("second round: viewings, outcomes and interest", () => {
  const viewings: [string, Record<string, unknown>, NoteKind][] = [
    ["Second viewing booked for 2 Dec at 11", { date: "2026-12-02" }, "viewing"],
    ["10am viewing on Wed 18 Nov, Sam Hart (Head of Property) and Jo", { date: "2026-11-18", time: "10:00" }, "viewing"],
    ["viewing 20/11/26 @ 10am w/ Dishoom & Pho", { date: "2026-11-20", time: "10:00" }, "viewing"],
    ["Viewing 3 March 10am", { date: "2027-03-03", time: "10:00" }, "viewing"],
    ["Viewing this Friday 10am", { date: "2026-11-13", time: "10:00" }, "viewing"],
    ["viewing 3pm tomorrow", { date: "2026-11-14", time: "15:00" }, "viewing"],
    ["Viewed 11/11 with ops director, liked it but worried about extraction. Will come back to us by end of month", { date: "2026-11-11", outcome: "Interested" }, "viewing_outcome"],
    ["They didn't show, rearranged for Monday", { outcome: "No Show" }, "viewing_outcome"],
    ["Good viewing 9 Nov. Chase by Monday", { date: "2026-11-09", followUpDate: "2026-11-16", outcome: "Follow Up" }, "viewing_outcome"],
    ["Interested, will revert by 1 Dec", { outcome: "Interested", followUpDate: "2026-12-01" }, "viewing_outcome"],
    ["Offer received after viewing, £100k pax", { outcome: "Offer Received" }, "viewing_outcome"],
  ];
  for (const [text, expected, kind] of viewings) assert.deepEqual(boxes(read(text, kind, { brandNames: ["Dishoom", "Pho"] })), expected, text);
  const brands = ["Dishoom", "Pho", "Itsu", "Nando's", "Wingstop"];
  assert.deepEqual(boxes(read("CBRE (Jo Lee) acting for Nando's and Wingstop, both want 3,000 sq ft", "interest", { brandNames: brands })), { brandName: "Nando's", moreBrands: [{ name: "Wingstop" }] });
  assert.deepEqual(boxes(read("three brands interested: Dishoom, Pho, Itsu", "interest", { brandNames: [...brands, "Three"] })), { brandName: "Dishoom", moreBrands: [{ name: "Pho" }, { name: "Itsu" }] });
  assert.deepEqual(boxes(read("Dishoom interested. Contact: Sam Hart. Agent: CBRE", "interest", { brandNames: brands })), { brandName: "Dishoom", contactName: "Sam Hart", agentName: "CBRE" });
  // On a viewing form, two brands in one note are not guessed between.
  assert.equal(read("viewing 20/11/26 @ 10am w/ Dishoom & Pho", "viewing", { brandNames: brands }).fields.brandName, undefined);
});

test("no reading of any of these notes holds a null, an id or a box its form does not have", () => {
  const notes = ["Rent: £120,000 pax\nTerm: 15 years\nRent free: 6 months", "Improved from £100k pax to £115k pax", "Not very keen", "Viewing 2-3pm 20 Nov", "brand: tbc",
    "Honest Burgers 9 Nov: offered £120k pax", "Unit 3/4 - Dishoom offer £120k pax", "RF 6-9 months, 8-10% t/o", "Offer dated 20 Nov: £90k pax"];
  for (const kind of NOTE_KINDS) for (const text of notes) {
    const r = read(text, kind, { brandNames: ["Dishoom"] });
    for (const [key, value] of Object.entries(r.fields)) {
      assert.notEqual(value, null, `${key} on ${kind}`);
      assert.ok((NOTE_KIND_FIELDS[kind] as readonly string[]).includes(key), `${key} on ${kind}`);
      assert.ok(!/Id$/.test(key), `${key} on ${kind}`);
    }
    for (const d of r.dropped) assert.doesNotMatch(d.reason, /—/, "no em-dash in a reason shown to a person");
  }
});

// ── Source-level guards ────────────────────────────────────────────────────

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
