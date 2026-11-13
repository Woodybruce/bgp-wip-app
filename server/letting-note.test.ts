// "Drop a note in, fill the form" (shared/letting-note.ts): the shorthand
// rules, the checks on what an AI reader proposes, and the reader with the
// provider replaced. No test here touches a database or an AI provider.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTE_KINDS, type NoteKind } from "../shared/letting-note";
import { VIEWING_OUTCOMES } from "../shared/viewing-workflow";
import {
  NOTE_KIND_FIELDS, NOTE_OUTCOMES, buildReading, cleanNote, exactNameMatch, figuresIn, findTimes, guardReading, mergeReadings, normaliseCandidate,
  outcomeFromWords, readLooseDate, readShorthand, sureWhen, tightNote,
} from "../shared/letting-note-parse";
import {
  NOTE_CHECKED_REASON, NOTE_NOT_TIGHT_REASON, claimNoteRead, commentDayFor, noteReaderPrompt, noteReaderTool, noteReaderUserUsageKey, openerAsBrand, readLettingNote, readNoteBody, teamNamesFor,
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
  const r = read(OWNER, "offer", { staffNames: ["Ben Sykes"] });
  assert.deepEqual(r.fields, { rentFreeMonths: 6, turnoverRentPct: 9, rentPa: 120000, termYears: 15, date: "2026-11-09" });
  assert.equal(r.saidBy, "Ben Sykes");
  assert.equal(r.fields.contactName, undefined);
  assert.equal(r.usedAi, false);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(short(OWNER).leftover, []);
});

test("the owner's example read by a login that does not know Ben Sykes: the same boxes, and a line that the name could be the brand", () => {
  const r = read(OWNER);
  assert.deepEqual(r.fields, { rentFreeMonths: 6, turnoverRentPct: 9, rentPa: 120000, termYears: 15, date: "2026-11-09" });
  assert.equal(r.saidBy, "Ben Sykes");
  assert.equal(r.fields.contactName, undefined);
  assert.equal(r.fields.brandName, undefined);
  assert.equal(r.usedAi, false);
  assert.deepEqual(r.dropped, [{ field: "brandName", reason: "Ben Sykes opens the note and was read as who wrote it. If it is the brand, type it in the brand box." }]);
  assert.deepEqual(short(OWNER).leftover, []);
  // A round has no brand box, so no such line.
  assert.deepEqual(read(OWNER, "round").dropped, []);
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
  assert.equal(readLooseDate("20 Nov", TODAY, "future"), "2026-11-20");
  assert.equal(readLooseDate("9 Nov", TODAY, "future"), null, "four days gone: not moved on a year");
  assert.equal(readLooseDate("9 Mar", TODAY, "future"), "2027-03-09");
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

test("the owner's example is tight shorthand: read by the rules alone, never sent to the provider", async () => {
  const { deps, seen } = fake();
  const r = await readLettingNote({ ...input(OWNER), staffNames: ["Ben Sykes"] }, deps);
  assert.equal(r.usedAi, false);
  assert.deepEqual([seen.claims, seen.calls], [0, 0]);
  assert.deepEqual(r.fields, { rentFreeMonths: 6, turnoverRentPct: 9, rentPa: 120000, termYears: 15, date: "2026-11-09" });
  assert.equal(r.saidBy, "Ben Sykes");
  assert.equal(r.fields.contactName, undefined);
  assert.equal(r.reason, undefined);
  assert.equal(r.unsure, undefined);
  // Read on 5 November, 9 November may be still to come: the date is left out with the usual reason, and the note is still tight.
  const early = await readLettingNote({ ...input(OWNER), staffNames: ["Ben Sykes"], today: "2026-11-05" }, deps);
  assert.deepEqual(early.fields, { rentFreeMonths: 6, turnoverRentPct: 9, rentPa: 120000, termYears: 15 });
  assert.match(reasonFor(early, "date") || "", /still to come/);
  assert.equal(seen.calls, 0);
  // A login that does not know Ben Sykes cannot tell a stamp from a brand: not tight.
  assert.equal(tightNote(readShorthand(OWNER, { kind: "offer", today: TODAY }), { kind: "offer" }).tight, false);
});

test("a note written out in full goes to the second reader, and only what both readings agree on fills a box", async () => {
  const { deps, seen } = fake({}, { ...good, rentFreeMonths: { value: 9, quote: "six months rent free" } });
  const r = await readLettingNote(input(NOTE), deps);
  assert.equal(r.usedAi, true);
  assert.deepEqual([seen.claims, seen.calls, seen.logged], [1, 1, 1]);
  assert.equal(r.fields.contactName, undefined, "a name the rules did not read is listed, not filled");
  assert.ok(r.unsure?.some(u => u.field === "contactName" && u.value === "Sam Hart"));
  assert.equal(r.fields.rentPa, 120000);
  assert.equal(r.fields.termYears, 15);
  assert.equal(r.fields.breakOption, "Tenant break at year 5");
  assert.equal(r.fields.rentFreeMonths, undefined, "9 is not in 'six months rent free'");
  assert.equal(r.fields.brandName, "Dishoom");
  assert.equal(r.fields.date, undefined, "the date sits in the middle of the note, so it is listed to check");
  assert.ok(r.unsure?.some(u => u.field === "date" && u.value === "2026-11-09"));
  assert.equal(r.reason, NOTE_CHECKED_REASON);
  assert.equal(seen.tool.name, "record_note");
});

test("with no key a note written out in full fills only a brand on the unit, and lists the rest to check", async () => {
  const { deps, seen } = fake({ hasKey: () => false });
  const r = await readLettingNote(input(NOTE), deps);
  assert.equal(r.usedAi, false);
  assert.equal(seen.calls, 0);
  assert.deepEqual(r.fields, { brandName: "Dishoom" });
  assert.equal(r.reason, NOTE_NOT_TIGHT_REASON);
  const listed = Object.fromEntries((r.unsure || []).map(u => [u.field, u.value]));
  assert.deepEqual(listed, { rentPa: 120000, termYears: 15, breakOption: "Tenant break at year 5", date: "2026-11-09" });
  assert.ok((r.unsure || []).every(u => NOTE.includes(u.quote)), "each with the words it came from");
});

test("a failed, refused, cut-off or over-allowance call fills only what is sure and never throws", async () => {
  const variants: Partial<NoteReaderDeps>[] = [
    { call: async () => { throw new Error("529 overloaded"); } },
    { call: async () => ({ input: good, model: "test-model", refused: true }) },
    { call: async () => ({ input: null, model: "test-model" }) },
    { claim: async () => false },
  ];
  for (const over of variants) {
    const r = await readLettingNote(input(NOTE), fake(over).deps);
    assert.equal(r.usedAi, false);
    assert.equal(r.fields.termYears, undefined);
    assert.ok(r.unsure?.some(u => u.field === "termYears" && u.value === 15));
    assert.equal(r.fields.contactName, undefined);
    assert.equal(r.reason, NOTE_NOT_TIGHT_REASON);
  }
});

test("the provider is sent the note, the unit, the scheme, today and the unit's brands, and nothing else", async () => {
  const { deps, seen } = fake();
  await readLettingNote({ ...input(NOTE), author: "Ben Sykes" }, deps);
  assert.ok(seen.user.includes(NOTE) && seen.user.includes("KLG07") && seen.user.includes("St David's") && seen.user.includes(TODAY) && seen.user.includes("Dishoom"));
  assert.ok(!seen.user.includes("Victoria Hale") && !seen.system.includes("Victoria Hale"), "the team's names stay on the server");
  assert.ok(!seen.user.includes("Ben Sykes") || NOTE.includes("Ben Sykes"));
  const lines = seen.user.split("\n").filter(l => /^[A-Z][a-z ]+:/.test(l)).map(l => l.split(":")[0]);
  assert.deepEqual(lines, ["Form", "Unit", "Scheme", "Brands already named on this unit", "The note"]);
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

test("a 4,000 character note of spaces, digits, pound signs or repeated words reads in well under half a second", async () => {
  const fillers = [" ", "\t", "\n", "1", "£", "a ", "9 Nov ", "A B ", "rent ", "- ", "6 months ", "1/2 ", "not ", "£1,000", "rr ", "x,", ". ", "12 ", "t/o ", "k ", "upwards only rent review ",
    // Round three: the words the new rules look for, repeated to the limit.
    "Unit 3 - 10am ", "TBO yr 5 & 10 ", "£100k ", "£100k pax ", "Contact: Sam ", "Brand: Pho ", "6 MRF ", "no to the ", "if interested ", "3/5 Market Place ", "5 Nov 25 ",
    "rent review at year 5 and 10 ", "Year 1 - £80,000; ", "or ", "not agreed ", "break at year 5 and ", "follow up by 10 Nov ", "10 and 11am ", "£50k CC ", "Next: call ", "thereafter ",
    "Dishoom not interested ", "12 weeks rent free ", "10 years ", "| Rent | £1 | ", "they rejected ", "9% t/o up ", "07700 900123 ", "we want they want "];
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
  assert.ok(worst < 500, `slowest read took ${worst} ms (${slowest})`);
  // The reviewer's note: "5 yearly rent review", 3,979 spaces, "x". It took 85 seconds.
  const started = Date.now();
  const r = await readLettingNote(input(`5 yearly rent review${" ".repeat(3979)}x`), deps);
  assert.ok(Date.now() - started < 500);
  assert.equal(r.fields.rentReview, undefined, "an 'x' the shorthand does not cover: not tight, so listed rather than filled");
  assert.ok(r.unsure?.some(u => u.field === "rentReview" && u.value === "5 yearly rent review"));
  assert.equal(r.text, "5 yearly rent review x");
});

test("a whole pasted email repeated to 4,000 characters, with and without an AI reading to check, reads in well under half a second", () => {
  const email = "From: Sam Hart <sam.hart@dishoom.com>\nSent: 10 November 2026 16:42\nSubject: RE: Unit SU12 - offer\nRent: £185,000 per annum exclusive\nTerm: 15 years\nBreak: tenant only at year 10\n"
    + "Rent free: 9 months\nTurnover: 8% of gross sales above £2.3m\nPlease come back to me by Friday 20 November.\nM: 07700 900123 | 22 Kingly Street, London W1B 5QP\n";
  const text = email.repeat(Math.ceil(4000 / email.length)).slice(0, 4000);
  const candidate = { rentPa: { value: 185000, quote: "£185,000 per annum exclusive" }, date: { value: "2026-11-10", quote: "10 November 2026" }, outcome: { value: "Interested", quote: "come back to me" },
    contactName: { value: "Sam Hart", quote: "Sam Hart" }, termYears: { value: 15, quote: "15 years" }, time: { value: "16:42", quote: "16:42" }, premium: { value: 900123, quote: "07700 900123" },
    turnoverRentPct: { value: 8, quote: "8% of gross sales" }, breakOption: { value: "Tenant break at year 10", quote: "tenant only at year 10" }, unplaced: ["Kingly Street"] };
  for (const kind of NOTE_KINDS) for (const withAi of [false, true]) {
    const started = Date.now();
    const r = buildReading({ kind, text, today: TODAY, brandNames: ["Dishoom", "Next"], staffNames: ["Ben Sykes"], ...(withAi ? { candidate, usedAi: true } : {}) });
    const took = Date.now() - started;
    assert.ok(took < 500, `${kind}${withAi ? " with an AI reading" : ""} took ${took} ms`);
    assert.equal(r.fields.premium, undefined);
  }
});

test("the shorthand rules run once for each read", () => {
  const body = readerSource.slice(readerSource.indexOf("export async function readLettingNote"), readerSource.indexOf("// ── The route"));
  assert.equal(body.split("readShorthand(").length - 1, 1);
  assert.equal(body.split("buildReading(").length - 1, 1, "the rules' reading is made once and handed on");
  assert.match(body, /buildReading\(\{ \.\.\.ctx, text, shorthand \}\)/);
  assert.match(body, /normaliseCandidate\(text, reply\.input, ctx, shorthand\)/);
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
  assert.match(readerCode, /const teamNames = teamNamesFor\(access, staff\);/);
  assert.match(readerCode, /staffNames: teamNames,/);
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

// ── Review round three, 13 November 2026 ───────────────────────────────────
//
// The governing rule: a wrong value in a form is worse than an empty box. When
// a note holds more than one candidate for a box, or a value whose meaning
// depends on words the rules do not understand, nothing is set and `dropped`
// says why. The first candidate is never simply taken. Every note below is one
// a reviewer ran; each is held to the reading it must give.

const ai = (text: string, candidate: unknown, kind: NoteKind = "offer", extra: Record<string, unknown> = {}) => buildReading({ kind, today: TODAY, text, candidate, usedAi: true, ...extra });

test("round three: a yearly figure that is not the offer is never saved as the rent when the offer itself has no 'pa'", () => {
  const none = ["Their Westfield store takes £3m pa. Offer £150k.", "Kings Cross site does £6m pa. Offering £200k", "Last tenant was paying £95k pa. Dishoom offering £120k",
    "Previous rent was £95k pa. Dishoom offering £120k", "Unit 14 let at £140k pax last year. Pho offering £125k for this one", "We quoted £150k pax. They offered £120k",
    "LL wants £150k pax, tenant at £120k", "Headline £120k, 12 MRF, NER £95k pa", "They can do £180k pa all in incl SC and rates", "On the market at £150k pax, offer in at £120k",
    "Dishoom pay £95k pa at Bluewater and would pay £120k here", "Jigsaw were on £95k pa. New offer £110k from Pho", "Offer £110k. Their Bluewater store turns over £2m pa",
    "Offer £110k. Bluewater store T/O £2m pa", "Headline rent £150k pax, net effective £120k pax", "Gross rent £150k pa, net £120k pa after incentives", "NER £95k pa"];
  for (const text of none) {
    const r = read(text);
    assert.equal(r.fields.rentPa, undefined, text);
    assert.match(r.fields.note || "", /£/, `${text}: the figures stay in the notes`);
  }
  // Two figures that could each be the rent: refused with the reason.
  for (const text of ["Unit 14 let at £140k pax last year. Pho offering £125k for this one", "LL wants £150k pax, tenant at £120k", "On the market at £150k pax, offer in at £120k",
    "Jigsaw were on £95k pa. New offer £110k from Pho", "Headline rent £150k pax, net effective £120k pax",
    "Gross rent £150k pa, net £120k pa after incentives"]) assert.equal(reasonFor(read(text), "rentPa"), "The note gives more than one rent. Type the rent.", text);
  assert.match(reasonFor(read("Headline £120k, 12 MRF, NER £95k pa"), "rentPa") || "", /more than one figure that could be the rent/);
  assert.equal(read("Headline £120k, 12 MRF, NER £95k pa").fields.rentFreeMonths, 12);
  assert.match(reasonFor(read("NER £95k pa"), "rentPa") || "", /net effective rent, not the rent offered/);
  assert.match(reasonFor(read("First offer £100k, improved to £115k"), "rentPa") || "", /more than one figure that could be the rent/);
  // The figures the words explain are not rivals: the rent still reads.
  const fine: [string, number][] = [["Total occupancy cost £180k pa (rent £120k, SC £35k, rates £25k)", 120000], ["Rent £120k pax. Service charge currently £12 psf (c. £28k pa).", 120000],
    ["£120k pax, legal fees capped at £5k", 120000], ["Rent £100k pax. They will spend £1m on the fit out", 100000], ["£100k pax plus 8% of turnover over £1.5m", 100000],
    ["Offer £100k pax, rent deposit £25,000", 100000], ["£120k pax with a parent guarantee of £500k", 120000]];
  for (const [text, rent] of fine) assert.equal(read(text).fields.rentPa, rent, text);
  // The AI reader cannot pick one of two figures, but may read a lone offer the rules left alone.
  assert.equal(ai("Their Westfield store takes £3m pa. Offer £150k.", { rentPa: { value: 150000, quote: "Offer £150k" } }).fields.rentPa, 150000);
  assert.equal(ai("Their Westfield store takes £3m pa. Offer £150k.", { rentPa: { value: 3000000, quote: "£3m pa" } }).fields.rentPa, undefined);
  assert.equal(ai("We quoted £150k pax. They offered £120k", { rentPa: { value: 120000, quote: "They offered £120k" } }).fields.rentPa, 120000);
  const two = ai("First offer £100k, improved to £115k", { rentPa: { value: 115000, quote: "improved to £115k" } });
  assert.equal(two.fields.rentPa, undefined);
  assert.ok(reasonFor(two, "rentPa"));
  assert.equal(reasonFor(check("Jigsaw were on £95k. New offer £110k from Pho", { rentPa: { value: 110000, quote: "New offer £110k" } }), "rentPa"), "The note gives more than one rent. Type the rent.");
});

test("round three: a viewing time after a unit number is the time, never a range from the unit number", () => {
  const cases: [string, string | undefined][] = [["Unit 3 - 10am viewing", "10:00"], ["Viewing Unit 12 - 2pm", "14:00"], ["SU4 - 3pm Dishoom", "15:00"],
    ["Dishoom, Unit 7 – 11am, Sam attending", "11:00"], ["Kiosk 2 - 4.30pm", "16:30"], ["Unit 12 to view at 2pm", "14:00"], ["Viewing unit 5 & 6 at 3pm", "15:00"],
    ["Meet 10 mins before 2pm at Unit 9 - 2pm start", "14:00"], ["Viewing Unit 12-2pm", "14:00"], ["Shop 4 - 9.15am", "09:15"], ["Units 3, 4 and 5pm"  , undefined],
    ["Units 5 and 6pm viewing on 18 Nov", undefined], ["viewings at 10 and 11am", undefined], ["Viewing 5-2pm", undefined],
    // A real range still reads as its start.
    ["Viewing 2 - 3pm 20 Nov", "14:00"], ["Viewing 2-3pm", "14:00"], ["between 10 and 11am", "10:00"], ["Viewing 11-1pm", "11:00"], ["Viewing 10 to 11.30am", "10:00"]];
  for (const [text, time] of cases) assert.equal(read(text, "viewing").fields.time, time, text);
  assert.equal(reasonFor(read("Units 5 and 6pm viewing on 18 Nov", "viewing"), "time"), "A unit number runs into the time. Set the time by hand.");
  assert.equal(read("Units 5 and 6pm viewing on 18 Nov", "viewing").fields.date, "2026-11-18");
  assert.equal(reasonFor(read("viewings at 10 and 11am", "viewing"), "time"), "The note gives more than one time. Set the time by hand.");
  assert.match(reasonFor(read("Viewing 5-2pm", "viewing"), "time") || "", /two ways/);
  assert.equal(findTimes("Unit 3 - 10am")[0]?.value, "10:00");
  // The AI's time is read with the words before it.
  assert.equal(ai("Meet Sam at Unit 3 - 10am, he will bring the keys", { time: { value: "03:00", quote: "3 - 10am" } }, "viewing").fields.time, "10:00");
});

test("round three: the break box never takes the lease length, a notice period or 'no break penalty', and two breaks set none", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["£120k pax 15 yrs TBO yr 10 6 MRF", { rentPa: 120000, termYears: 15, breakOption: "Tenant break at year 10", rentFreeMonths: 6 }],
    ["10 yrs TBO yr 5 £100k pax", { termYears: 10, breakOption: "Tenant break at year 5", rentPa: 100000 }],
    ["15 yrs TBO 10, £100k pax", { termYears: 15, breakOption: "Tenant break at year 10", rentPa: 100000 }],
    ["TBO on 6 months notice. £100k pax, 10 year lease", { rentPa: 100000, termYears: 10 }],
    ["Rolling MBO 3 months after year 2", {}],
    ["10 yr lease, no break penalty, £100k pax", { termYears: 10, rentPa: 100000 }],
    ["Tenant break at year 5 and year 10, 15 year lease", { termYears: 15 }],
    ["TBO yr 5 & 10, 15 yr lease", { termYears: 15 }],
    ["TBO yr 3, LBO yr 5, £100k pax 10 yrs", { rentPa: 100000, termYears: 10 }],
    ["15 year lease, breaks at 5 and 10, RR 5 yearly OMV upwards only", { termYears: 15, rentReview: "RR 5 yearly OMV upwards only" }],
    ["No break. TBO yr 5. £100k pax", { rentPa: 100000 }],
    // One break still reads, with the terms either side of it.
    ["5yr TBO 6 MRF £100k pax", { breakOption: "Tenant break at year 5", rentFreeMonths: 6, rentPa: 100000 }],
    ["TBO yr 5, 10 yr lease, 6 MRF", { breakOption: "Tenant break at year 5", termYears: 10, rentFreeMonths: 6 }],
    ["10 year lease, no breaks, £100k pax", { termYears: 10, breakOption: "No break", rentPa: 100000 }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(boxes(read(text)), expected, text);
  for (const text of ["Tenant break at year 5 and year 10, 15 year lease", "TBO yr 5 & 10, 15 yr lease", "TBO yr 3, LBO yr 5, £100k pax 10 yrs", "15 year lease, breaks at 5 and 10",
    "No break. TBO yr 5. £100k pax", "breaks at years 5 and 10", "Break: tenant, year 5 and year 10"]) {
    assert.equal(reasonFor(read(text), "breakOption"), "The note gives more than one break. Type the break.", text);
    assert.match(read(text).fields.note || "", /\d/, `${text}: the breaks stay in the notes`);
  }
  assert.equal(read("TBO on 6 months notice. £100k pax, 10 year lease").fields.note, "TBO on 6 months notice");
  assert.equal(read("10 yr lease, no break penalty, £100k pax").fields.note, "no break penalty");
  // The AI reader cannot say "No break" of "no break penalty", nor give a year its words do not hold.
  assert.equal(ai("10 yr lease, no break penalty, please confirm", { breakOption: { value: "No break", quote: "no break penalty" } }).fields.breakOption, undefined);
  assert.equal(ai("They want a tenant break, please confirm", { breakOption: { value: "Tenant break at year 5", quote: "tenant break" } }).fields.breakOption, undefined);
});

test("round three: a stepped rent set out by year sets no rent and says so", () => {
  for (const text of ["Rent: Year 1 - £80,000; Year 2 - £90,000; Year 3 onwards - £100,000 pax", "Yr 1 £80k, yr 2 £90k, thereafter £100k pax. 10 yr lease",
    "Rent £100k pax (yr 1), £110k (yr 2), £120k (yr 3+)", "£100k pax yrs 1-2, stepping to £120k yrs 3-5", "Year 1 rent £80k pax", "£80k pax in year 1"]) {
    const r = read(text);
    assert.equal(r.fields.rentPa, undefined, text);
    assert.equal(reasonFor(r, "rentPa"), "The note gives a stepped rent. Type the rent.", text);
  }
  assert.equal(read("Yr 1 £80k, yr 2 £90k, thereafter £100k pax. 10 yr lease").fields.termYears, 10);
  // A year that belongs to a break or a review is not a step.
  assert.deepEqual(boxes(read("TBO yr 5 £100k pax")), { breakOption: "Tenant break at year 5", rentPa: 100000 });
  assert.deepEqual(boxes(read("RR yr 5 £100k pax")), { rentReview: "RR yr 5", rentPa: 100000 });
});

test("round three: a conditional or doubtful 'interested' is not the outcome Interested", () => {
  const cases: [string, string | undefined][] = [["Will revert if interested", "Follow Up"], ["Said they'd come back to us if interested", "Follow Up"],
    ["Doubt they're keen, too small", undefined], ["Asked whether Landsec would be interested in a pop up instead", undefined], ["Interested parties: none yet", undefined],
    ["More interested in Unit 5 next door", undefined], ["Might be interested", undefined], ["Interested if the rent comes down", undefined], ["Unsure if they are keen", undefined],
    ["If they have passed we go to Pho", undefined], ["Could be keen, hard to tell", undefined],
    // A plain view still reads; "May" with its capital is the month.
    ["Viewed in May and they were keen", "Interested"], ["Keen. If interested in Unit 5 as well we can show both", "Interested"], ["Very interested, subject to board", "Interested"]];
  for (const [text, outcome] of cases) assert.equal(read(text, "viewing_outcome").fields.outcome, outcome, text);
  // The AI reader cannot make a condition an outcome, and its own "Follow Up" agrees with the rules.
  assert.equal(ai("Will revert if interested", { outcome: { value: "Follow Up", quote: "Will revert" } }, "viewing_outcome").fields.outcome, "Follow Up");
  const cond = ai("Sam said only if interested would they call", { outcome: { value: "Interested", quote: "interested" } }, "viewing_outcome");
  assert.equal(cond.fields.outcome, undefined);
  assert.match(reasonFor(cond, "outcome") || "", /does not plainly say Interested/);
});

test("round three: a brand at the start of a note is not taken as its author, and its name is not lost", async () => {
  const brands = ["Krispy Kreme 9 Nov Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF", "Franco Manca 10 Nov Offered £90k pax", "German Doner Kebab 10 Nov Offered £90k pax, 10 yrs",
    "Ted Baker 9 Nov Offer £200k pax", "Slim Chickens 11/11 Offer £110k pax 15 yrs", "Tim Hortons 10 Nov Viewing went well, keen", "Jo Malone 9 Nov Offered £300k pax"];
  for (const text of brands) {
    const r = read(text, text.includes("Viewing") ? "viewing_outcome" : "offer");
    assert.equal(r.saidBy, null, text);
    assert.ok((r.fields.note || "").startsWith(text.split(/ \d/)[0]), `${text}: the name heads the notes`);
  }
  assert.deepEqual(boxes(read(brands[0])), { rentFreeMonths: 6, turnoverRentPct: 9, rentPa: 120000, termYears: 15, date: "2026-11-09" });
  // Not tight (the brand's name is not on the unit), so the provider is asked. Its brand is
  // used only when this login may already pick it, and a term only where the rules agree.
  let calls = 0;
  const reply = { brandName: { value: "Krispy Kreme", quote: "Krispy Kreme" }, rentPa: { value: 120000, quote: "Rent £120kpax" } };
  const { deps } = fake({ call: async () => { calls++; return { input: reply, model: "test-model" }; } });
  const viaAi = await readLettingNote({ ...input(brands[0]), brandNames: [], pickableBrandNames: [], pickBrand: async name => (name === "Krispy Kreme" ? { id: "k1", name } : null) }, deps);
  assert.equal(calls, 1);
  assert.equal(viaAi.fields.brandName, "Krispy Kreme");
  assert.equal(viaAi.saidBy, null);
  assert.equal(viaAi.fields.rentPa, 120000);
  assert.ok(viaAi.unsure?.some(u => u.field === "termYears" && u.value === 15), "the term the provider did not report is listed, not filled");
  const notPickable = await readLettingNote({ ...input(brands[0]), brandNames: [], pickableBrandNames: [] }, fake({}, reply).deps);
  assert.equal(notPickable.fields.brandName, undefined);
  assert.ok(notPickable.unsure?.some(u => u.field === "brandName" && u.value === "Krispy Kreme"));
  // A person's name the reader does not know is still read as who wrote it, with a line saying it could be the brand.
  const person = read("Rob Smith 9 Nov Offered £100k pax");
  assert.equal(person.saidBy, "Rob Smith");
  assert.match(reasonFor(person, "brandName") || "", /Rob Smith opens the note and was read as who wrote it/);
  // The route: a name that is exactly one brand the login may pick is the brand.
  const reading = read("Rob Smith 9 Nov Offered £100k pax");
  assert.equal(openerAsBrand(reading, { id: "b1", name: "Rob Smith" }, ["Victoria Hale"]), true);
  assert.deepEqual([reading.fields.brandName, reading.fields.brandId, reading.saidBy, reading.dropped.length], ["Rob Smith", "b1", null, 0]);
  const known = read("Ben Sykes 9 Nov Offered £100k pax", "offer", { staffNames: ["Ben Sykes"] });
  assert.equal(openerAsBrand(known, { id: "b2", name: "Ben Sykes" }, ["Ben Sykes"]), false, "one of the letting team is never turned into a brand");
  assert.equal(known.saidBy, "Ben Sykes");
  assert.equal(openerAsBrand(read("Rob Smith 9 Nov Offered £100k pax"), null, []), false);
  assert.match(readerCode, /const brand = await resolveBrand\(pool, opener, onUnit, access\);\s*if \(!reading\.reason\) openerAsBrand\(reading, brand, teamNames\);/);
});

test("round three: a follow-up date just passed is not moved on a year, and 'answer on' is not a follow-up", () => {
  const passed = read("Viewed 3 Nov, keen. Follow up by 10 Nov.", "viewing_outcome");
  assert.deepEqual(boxes(passed), { date: "2026-11-03", outcome: "Interested" });
  assert.match(reasonFor(passed, "followUpDate") || "", /"10 Nov" looks like a follow-up date that has passed/);
  assert.deepEqual(boxes(read("Got their answer on 9 Nov: keen, want a second viewing", "viewing_outcome")), { date: "2026-11-09", outcome: "Second Viewing" });
  assert.deepEqual(boxes(read("Their response on 9 Nov was positive", "viewing_outcome")), { date: "2026-11-09", outcome: "Interested" });
  const booked = read("Viewing 18 Nov 2pm. Follow up by 12 Nov with plans", "viewing");
  assert.equal(booked.fields.followUpDate, undefined);
  assert.equal(booked.fields.date, "2026-11-18");
  assert.ok(reasonFor(booked, "followUpDate"));
  // Still read: a follow-up ahead, a decision due, and one with its year.
  assert.equal(read("Keen. Follow up on 20 Nov", "viewing_outcome").fields.followUpDate, "2026-11-20");
  assert.equal(read("Keen. Decision due by 1 Dec", "viewing_outcome").fields.followUpDate, "2026-12-01");
  assert.equal(read("Keen. Answer expected 27 Nov", "viewing_outcome").fields.followUpDate, "2026-11-27");
  assert.match(reasonFor(read("Keen. Follow up by 10 Nov 2026", "viewing_outcome"), "followUpDate") || "", /has passed/);
  assert.match(reasonFor(read("Keen. Chase by 20 Nov, then follow up by 4 Dec", "viewing_outcome"), "followUpDate") || "", /more than one follow-up date/);
  // The AI's follow-up is placed by the same rule.
  assert.match(reasonFor(ai("Sam wants a nudge around 10 Nov", { followUpDate: { value: "2027-11-10", quote: "10 Nov" } }, "viewing_outcome"), "followUpDate") || "", /has passed/);
});

test("round three: the brand's own fit-out cost or a yearly marketing contribution is not the landlord's contribution", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["Tenant fit out £750k, asking for £100k CC", { fittingOutContribution: 100000 }],
    ["Fit out cost £800k. Rent £100k pax", { rentPa: 100000 }],
    ["£1m fit out. £150k pax", { rentPa: 150000 }],
    ["Marketing contribution £5,000 pa, rent £100k pax", { rentPa: 100000 }],
    ["Their fit out budget is £600k, rent £100k pax", { rentPa: 100000 }],
    ["Contribution £10,000 pa, rent £100k pax", { rentPa: 100000 }],
    ["Service charge contribution £8k, rent £100k pax", { rentPa: 100000 }],
    ["LL contribution to fit out £100k, rent £150k pax", { fittingOutContribution: 100000, rentPa: 150000 }],
    ["£100,000 towards the fit-out, rent £150k pax", { fittingOutContribution: 100000, rentPa: 150000 }],
    ["Landlord to pay £75k for fit out works", { fittingOutContribution: 75000 }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(boxes(read(text)), expected, text);
  assert.match(reasonFor(read("Contribution £10,000 pa, rent £100k pax"), "fittingOutContribution") || "", /yearly sum/);
  assert.match(read("Tenant fit out £750k, asking for £100k CC").fields.note || "", /£750k/);
});

test("round three: two rent free periods, contributions, turnover percentages, deposits or premiums set none, and 'no rent free discussed' is not nil", () => {
  const two: [string, string][] = [["6 MRF, improved to 9 MRF. £100k pax", "rentFreeMonths"], ["They asked for 12 months rent free, we offered 6 months rent free. £100k pax", "rentFreeMonths"],
    ["£50k CC increased to £75k CC, £100k pax", "fittingOutContribution"], ["8% t/o for years 1-5 then 10% t/o. £100k pax", "turnoverRentPct"], ["6 + 6 MRF, £100k pax", "rentFreeMonths"],
    ["3 months deposit, later 6 months deposit, £100k pax", "rentDeposit"], ["premium £50k, or premium £75k with a longer rent free, £100k pax", "premium"],
    ["No rent free. 6 MRF. £100k pax", "rentFreeMonths"]];
  for (const [text, field] of two) {
    const r = read(text);
    assert.equal((r.fields as Record<string, unknown>)[field], undefined, text);
    assert.match(reasonFor(r, field) || "", /more than one/, text);
    assert.equal(r.fields.rentPa, 100000, text);
    assert.ok((r.fields.note || "").length > 5, `${text}: the words stay in the notes`);
  }
  // The same value twice is one value.
  assert.equal(read("6 MRF. To confirm, 6 months rent free. £100k pax").fields.rentFreeMonths, 6);
  for (const [text, kind] of [["No rent free discussed yet, rent £100k pax", "offer"], ["Rent free: none agreed yet", "offer"], ["No rent free period has been discussed. Rent £105k pax", "round"],
    ["No rent free mentioned so far. Rent £100k pax", "round"]] as [string, NoteKind][]) {
    const r = read(text, kind);
    assert.equal(r.fields.rentFreeMonths, undefined, text);
    assert.match(r.fields.note || "", /rent free/i, text);
  }
  assert.equal(read("no rent free, £100k pax", "round").fields.rentFreeMonths, 0, "a plain nil still reads");
});

test("round three: a rent free period in weeks is refused, and '3 months free of service charge' is not rent free", () => {
  for (const text of ["RF 12 weeks, £100k pax", "12 weeks rent free, £100k pax", "rent free period of 8 weeks, £100k pax", "rent free 90 days, £100k pax"]) {
    const r = read(text);
    assert.equal(r.fields.rentFreeMonths, undefined, text);
    assert.match(reasonFor(r, "rentFreeMonths") || "", /weeks or days, not months/, text);
    assert.equal(r.fields.rentPa, 100000, text);
  }
  assert.deepEqual(boxes(read("first 3 months free of service charge, £100k pax")), { rentPa: 100000 });
  assert.equal(read("3 months free of rent, £100k pax").fields.rentFreeMonths, 3);
  const weeks = ai("They want 12 weeks rent free", { rentFreeMonths: { value: 12, quote: "12 weeks rent free" } });
  assert.equal(weeks.fields.rentFreeMonths, undefined);
  assert.equal(weeks.dropped.filter(d => d.field === "rentFreeMonths").length, 1);
});

test("round three: term and turnover rent are not read from words about something else", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["Need 3 years accounts. Offer £100k pax", { rentPa: 100000 }],
    ["Need 3 years' audited accounts. Offer £100k pax", { rentPa: 100000 }],
    ["£100k pax, 2 year guarantee from parent", { rentPa: 100000 }],
    ["Term: 5+5 years. Rent £80k pax", { rentPa: 80000 }],
    ["Their t/o 15% up on last year. Offer £100k pax", { rentPa: 100000 }],
    ["Turnover 12% ahead of budget, offer £100k pax", { rentPa: 100000 }],
    ["£120/130k pax, 10 yrs", { termYears: 10 }],
    ["10 year lease, 3 years accounts needed, £100k pax", { termYears: 10, rentPa: 100000 }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(boxes(read(text)), expected, text);
  assert.equal(reasonFor(read("Term: 5+5 years. Rent £80k pax"), "termYears"), "The note gives a term in two parts. Type the term.");
  assert.equal(reasonFor(read("£120/130k pax, 10 yrs"), "rentPa"), "The note gives more than one rent. Type the rent.");
  // A term stated beside another length in years: neither is taken.
  const both = read("15 year lease. They wanted 10 years. £100k pax");
  assert.equal(both.fields.termYears, undefined);
  assert.match(reasonFor(both, "termYears") || "", /more than one length in years/);
});

test("round three: a brand the note says is not interested is not the interested brand, and 'Head Office' is not the brand Office", () => {
  const on = ["Dishoom", "Pho", "Wagamama"];
  assert.deepEqual(boxes(read("Wagamama not interested but Pho and Dishoom want details", "interest", { brandNames: on })), { brandName: "Pho", moreBrands: [{ name: "Dishoom" }] });
  assert.deepEqual(boxes(read("Wagamama have passed. Pho want details", "interest", { brandNames: on })), { brandName: "Pho" });
  assert.deepEqual(boxes(read("Wagamama declined to offer", "offer", { brandNames: on })), {});
  assert.equal(read("Wagamama pulled out. Dishoom offered £100k pax", "offer", { brandNames: on }).fields.brandName, "Dishoom");
  // On a viewing outcome the brand that is not keen is still the viewing's brand.
  assert.deepEqual(boxes(read("Wagamama not interested, too small", "viewing_outcome", { brandNames: on })), { outcome: "Not Interested", brandName: "Wagamama" });
  assert.deepEqual(boxes(read("Head Office approval needed. Dishoom enquired 10 Nov via Savills", "interest", { brandNames: ["Office", "Dishoom"] })), { date: "2026-11-10", brandName: "Dishoom" });
  assert.deepEqual(boxes(read("Good viewing on Tues. Head Office sign-off needed before they offer.", "viewing_outcome", { brandNames: ["Office"] })), {});
  assert.equal(read("Office keen on the first floor", "interest", { brandNames: ["Office"] }).fields.brandName, "Office", "the brand still reads where it is the subject");
  // Two brands on a form that takes one: none, and the reason.
  assert.equal(reasonFor(read("Dishoom and Wagamama both offered", "offer", { brandNames: on }), "brandName"), "The note names more than one brand. Choose the brand.");
});

test("round three: a labelled line does not take a clause, a phone number or an email address as a name", () => {
  const cases: [string, NoteKind, Record<string, unknown>][] = [
    ["The agent is confident they will offer. Dishoom", "interest", {}],
    ["Agent: direct. Brand: Dishoom", "interest", { brandName: "Dishoom" }],
    ["Contact: Sam Hart 07700 900123", "interest", { contactName: "Sam Hart" }],
    ["Contact: sam@dishoom.com", "interest", {}],
    ["Main contact is their property director", "interest", {}],
    ["Agent: in-house", "interest", {}],
    ["Contact is Sam Hart, agent is Jo Lee at CBRE", "interest", { contactName: "Sam Hart", agentName: "Jo Lee", agentCompanyName: "CBRE" }],
    ["At present: no offer. Viewing 20 Nov 2pm", "viewing", { date: "2026-11-20", time: "14:00" }],
    ["Present: Sam Hart and Jo Lee. Viewing 20 Nov 2pm", "viewing", { attendees: "Sam Hart and Jo Lee", date: "2026-11-20", time: "14:00" }],
    ["Attendees: tbc. Viewing 20 Nov 2pm", "viewing", { date: "2026-11-20", time: "14:00" }],
  ];
  for (const [text, kind, expected] of cases) assert.deepEqual(boxes(read(text, kind)), expected, text);
  assert.match(read("Contact: Sam Hart 07700 900123", "interest").fields.note || "", /07700 900123/, "the number stays in the notes");
  // Two different names for one box: neither.
  const twoContacts = read("Contact: Sam Hart. Contact: Jo Lee. Brand: Dishoom", "interest");
  assert.equal(twoContacts.fields.contactName, undefined);
  assert.equal(reasonFor(twoContacts, "contactName"), "The note gives more than one contact. Type the name.");
  assert.equal(ai("Ring Sam Hart 07700 900123 about the unit", { contactName: { value: "Sam Hart 07700 900123", quote: "Sam Hart 07700 900123" } }, "interest").fields.contactName, undefined);
});

test("round three: a street number pair, 'MSU 1/2' or a two-digit year is not misread into the date", () => {
  const none = ["Offer for 3/5 Market Place: £80k pax, 10 years", "MSU 1/2 - Next offer £500k pax", "Offer for 10/12 King Street", "Offer for 3/5 Cheapside £80k pax", "SU 3/4 offer £80k pax",
    "Offer on 1/2 The Broadway, £80k pax", "9/11 High Street offer £80k pax"];
  for (const text of none) assert.equal(read(text).fields.date, undefined, text);
  assert.equal(reasonFor(read("Offer for 10/12 King Street"), "date"), undefined, "an address, so no talk of a date still to come");
  assert.equal(read("Offer for 3/5 Old Jewry £80k pax").fields.date, undefined);
  assert.match(reasonFor(read("Offer for 3/5 Old Jewry £80k pax"), "date") || "", /may not be a date/);
  assert.deepEqual(boxes(read("Offer 5 Nov 25 £100k pax")), { rentPa: 100000, date: "2025-11-05" });
  assert.equal(read("Offer 5 Nov 25: £100k pax").fields.date, "2025-11-05");
  assert.equal(read("Offer 5 Nov 26 £100k pax").fields.date, "2026-11-05");
  assert.equal(read("9 Nov 25 year lease £100k pax").fields.date, "2026-11-09", "25 is the term");
  assert.equal(read("9 Nov 25 year lease £100k pax").fields.termYears, 25);
  assert.match(reasonFor(read("Offer 5 Nov 22 £100k pax"), "date") || "", /year is not clear/);
  // Real slash dates still read.
  assert.equal(read("Offer received 09/11: £150k pa").fields.date, "2026-11-09");
  assert.equal(read("Viewing booked for 20/11 at 2pm", "viewing").fields.date, "2026-11-20");
});

test("round three: Log as offer does not put the comment's day where the rules left the date out", () => {
  const refused = buildReading({ kind: "offer", text: "Offer expected 20 Nov, £100k pax", today: TODAY, writtenOn: "2026-11-13", author: "Ben Sykes" });
  assert.equal(refused.fields.date, undefined);
  assert.match(reasonFor(refused, "date") || "", /still to come/);
  assert.equal(commentDayFor(refused, "2026-11-13", TODAY), null);
  const twoDates = buildReading({ kind: "offer", text: "Offer 3 Nov, improved 5 Nov, £100k pax", today: TODAY, writtenOn: "2026-11-09", author: "Ben Sykes" });
  assert.equal(commentDayFor(twoDates, "2026-11-09", TODAY), null);
  // No date in the comment: the comment's own day.
  const plain = buildReading({ kind: "offer", text: "Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF", today: TODAY, writtenOn: "2026-11-09", author: "Ben Sykes" });
  assert.equal(commentDayFor(plain, "2026-11-09", TODAY), "2026-11-09");
  assert.equal(commentDayFor(plain, "2026-11-20", TODAY), null, "never a day in the future");
  assert.equal(commentDayFor(plain, "not a day", TODAY), null);
  assert.equal(commentDayFor(plain, null, TODAY), null);
  assert.equal(commentDayFor({ fields: { date: "2026-11-01" }, dropped: [] }, "2026-11-09", TODAY), null, "the comment's stated date stands");
  assert.match(readerCode, /commentDayFor\(reading, fromTarget\.day, today\)/);
  assert.doesNotMatch(readerCode, /!fields\.date && day &&/);
});

test("round three: the check on an AI reading refuses a phone number as a sum and figures of the wrong kind", () => {
  const phone = ai("Offer £95k. Call Sam on 07700 900123", { premium: { value: 900123, quote: "07700 900123" } });
  assert.equal(phone.fields.premium, undefined);
  assert.match(reasonFor(phone, "premium") || "", /does not read as a sum of money/);
  assert.equal(ai("Offer £95k. Call Sam on 07700 900123", { fittingOutContribution: { value: 7700, quote: "07700" } }).fields.fittingOutContribution, undefined);
  assert.match(reasonFor(ai("Service charge cap 5%. Offer £100k", { turnoverRentPct: { value: 5, quote: "cap 5%" } }), "turnoverRentPct") || "", /does not read as a turnover rent/);
  assert.equal(ai("Sales are 15% up on last year, turnover strong", { turnoverRentPct: { value: 15, quote: "15% up" } }).fields.turnoverRentPct, undefined);
  assert.match(reasonFor(ai("Offer £100k. Need 3 years accounts", { termYears: { value: 3, quote: "3 years accounts" } }), "termYears") || "", /years of something else/);
  assert.equal(ai("Offer £100k. Need 3 years accounts", { termYears: { value: 3, quote: "3 years" } }).fields.termYears, undefined, "the words after the quote are read too");
  assert.match(reasonFor(ai("Offer £100k for 3/5 Market Place", { date: { value: "2026-05-03", quote: "3/5" } }), "date") || "", /may not be a date/);
  // What is plainly stated is still kept.
  const kept = ai("They said they would go to a premium of 50,000 and ten per cent of turnover on top, for a lease of twelve years",
    { premium: { value: 50000, quote: "premium of 50,000" }, turnoverRentPct: { value: 10, quote: "ten per cent of turnover" }, termYears: { value: 12, quote: "lease of twelve years" } });
  assert.deepEqual(boxes(kept), { premium: 50000, turnoverRentPct: 10, termYears: 12 });
  assert.equal(ai("Sam says they can stretch to 125,000 a year in rent", { rentPa: { value: 125000, quote: "125,000 a year in rent" } }).fields.rentPa, 125000);
});

// ── A third round of notes, written to break the round three fixes ─────────
//
// Whole pasted emails with signatures, tables, two brands, counters and
// re-counters, percentages that are not turnover rent, phone numbers,
// postcodes, unit numbers and dates in every style. Each row is the note, the
// boxes it must fill (the notes box aside) and the boxes it must refuse with a
// reason. An empty box is always acceptable here; a wrong value never is.

const ROUND_THREE_BRANDS = ["Dishoom", "Pho", "Wagamama", "Itsu", "Next", "Five Guys", "Honest Burgers", "Leon", "Gail's", "Office", "Boots", "The Works"];
const ROUND_THREE_NOTES: [NoteKind, string, Record<string, unknown>, string[]][] = [
  ["offer", "From: Sam Hart <sam.hart@dishoom.com>\nSent: 10 November 2026 16:42\nTo: Ben Sykes\nSubject: RE: Unit SU12, Bluewater - offer\n\nBen,\n\nFurther to our call, Dishoom would like to offer the following for Unit SU12:\n\nRent: £185,000 per annum exclusive\nTerm: 15 years\nBreak: tenant only at year 10\nRent free: 9 months\nRent deposit: 6 months\nTurnover: 8% of gross sales above £2.3m\n\nPlease come back to me by Friday 20 November.\n\nKind regards,\nSam Hart\nHead of Property, Dishoom\nM: 07700 900123 | T: 020 7946 0321\n22 Kingly Street, London W1B 5QP", {"rentFreeMonths": 9, "rentDeposit": "6 months", "turnoverRentPct": 8, "breakOption": "Tenant break at year 10", "rentPa": 185000, "termYears": 15, "date": "2026-11-10", "brandName": "Dishoom"}, []],
  ["offer", "Hi Ben - quick one. Pho have come back at £95k (was £90k) and will do 10 years with a break at 5. They still want 12 months rent free. Can we talk tomorrow? Jo\nJo Lee | Director | CBRE\n+44 (0)20 7182 2000\nHenrietta House, Henrietta Place, London W1G 0NB", {"rentFreeMonths": 12, "breakOption": "Break at year 5", "termYears": 10, "brandName": "Pho"}, ["date", "rentPa"]],
  ["offer", "-----Original Message-----\nFrom: jane.roe@savills.com\nDate: Mon, 9 Nov 2026 09:15:03 +0000\nWagamama - revised proposal: £210,000 pax, 15 year lease, TBO yr 10, 12 MRF, £250k CC. Subject to board. Valid for 14 days.\nJane Roe MRICS\nSavills, 33 Margaret Street W1G 0JD\nD: 020 7499 8644", {"rentFreeMonths": 12, "breakOption": "Tenant break at year 10", "fittingOutContribution": 250000, "rentPa": 210000, "termYears": 15, "date": "2026-11-09", "brandName": "Wagamama"}, []],
  ["offer", "Ben, Itsu's FD has signed off: 125k pax, 10 yrs, 6 months RF, deposit 3 months, no break. Lawyers are Fieldfisher (ref 22/1045). Regards Tom. Sent from my iPhone", {"rentFreeMonths": 6, "rentDeposit": "3 months", "breakOption": "No break", "rentPa": 125000, "termYears": 10, "brandName": "Itsu"}, []],
  ["offer", "Offer received by email 11/11/26 at 17:32 from Five Guys' agent (Shelley Sandzer, Nick W, 020 7580 3366): rent £140,000 p.a.x.; 20yr term; breaks at yrs 10 & 15; RF 12m; cap con £300,000; RPI reviews 5 yearly collar 1 cap 3.", {"rentFreeMonths": 12, "fittingOutContribution": 300000, "rentPa": 140000, "termYears": 20, "date": "2026-11-11", "brandName": "Five Guys"}, ["breakOption"]],
  ["offer", "Brand\tRent\tTerm\tRF\nDishoom\t£185k\t15\t9\nPho\t£95k\t10\t12", {}, ["brandName", "rentPa"]],
  ["offer", "| Term | 10 years |\n| Rent | £120,000 pa |\n| Rent free | 6 months |\n| Break | Year 5 (T) |\n| Deposit | 3 months |", {"rentFreeMonths": 6, "rentDeposit": "3 months", "breakOption": "Tenant break at year 5", "rentPa": 120000, "termYears": 10}, []],
  ["offer", "Rent - £120,000 pax\nTerm - 10 yrs\nBreak - yr 5 tenant\nRF - 6 mths\nCC - £50,000\nT/O - 9%", {"rentFreeMonths": 6, "turnoverRentPct": 9, "breakOption": "Tenant break at year 5", "fittingOutContribution": 50000, "rentPa": 120000, "termYears": 10}, []],
  ["offer", "1. Rent £88,000 pax\n2. Term 10 years\n3. Break 5th year (mutual)\n4. Rent free 6 months\n5. Deposit £22,000", {"rentFreeMonths": 6, "rentDeposit": "£22,000", "breakOption": "Mutual break at year 5", "rentPa": 88000, "termYears": 10}, []],
  ["offer", "Tenant: Pho\nRent: £95,000\nLease: 10 years\nBreak: none\nIncentive: 6 months rent free\nAgent: Jo Lee (CBRE)\nContact: Tom Reid", {"brandName": "Pho", "contactName": "Tom Reid", "agentName": "Jo Lee", "rentFreeMonths": 6, "breakOption": "No break", "rentPa": 95000, "termYears": 10}, []],
  ["round", "We countered at £130k pax, 9 MRF. They came back at £125k pax, 10 MRF. We accepted £127.5k and 9 MRF.", {}, ["party", "rentFreeMonths", "rentPa"]],
  ["round", "Our counter: £130k pax, 10 years, 6 MRF, TBO yr 5", {"rentFreeMonths": 6, "breakOption": "Tenant break at year 5", "rentPa": 130000, "termYears": 10, "party": "landlord"}, []],
  ["round", "Their revised offer £122,500 pax (up from £115k), 10 yrs, 9 MRF", {"rentFreeMonths": 9, "termYears": 10}, ["party", "rentPa"]],
  ["round", "Tenant's final position: rent 125k, RF 9, term 10, break 5", {"rentFreeMonths": 9, "rentPa": 125000, "termYears": 10, "party": "tenant"}, []],
  ["round", "LL counter 12/11: 135k pax, no CC, 6 months RF. T to respond by 19/11", {"rentFreeMonths": 6, "rentPa": 135000, "date": "2026-11-12", "party": "landlord"}, []],
  ["round", "Round 3 - they've moved to £128k. We're at £132k. Gap is £4k.", {}, ["party", "rentPa"]],
  ["round", "Agreed terms: £130,000 pax; 10 year lease; tenant break at year 5 on 6 months' notice; 9 months rent free; 3 months deposit; 5 yearly upward only reviews to OMV", {"rentFreeMonths": 9, "rentDeposit": "3 months", "breakOption": "Tenant break at year 5", "rentReview": "5 yearly upward only reviews to OMV", "rentPa": 130000, "termYears": 10}, []],
  ["round", "They rejected our counter of £135k pax and are holding at £125k pax", {}, ["party", "rentPa"]],
  ["round", "We said yes to 10 years and £130k pax but no to the 12 months rent free, offered 9", {"rentPa": 130000, "termYears": 10}, ["rentFreeMonths"]],
  ["offer", "Rent £100k pax. Service charge up 12% this year. Rates relief 75%. VAT 20%.", {"rentPa": 100000}, []],
  ["offer", "£100k pax, 3% fixed uplifts every year, 10 year lease", {"rentPa": 100000, "termYears": 10}, []],
  ["offer", "Offer is 85% of ERV at £100k pax", {}, []],
  ["offer", "£100k pax; 50% rent for first 6 months", {"rentPa": 100000}, []],
  ["offer", "They want a 10% discount on the quoting rent. Offer £108k pax", {"rentPa": 108000}, []],
  ["offer", "Rent £100k pax or 9% of turnover, whichever is the greater, with turnover capped at 110% of base", {"turnoverRentPct": 9, "rentPa": 100000}, []],
  ["offer", "Occupancy cost ratio 14%. Rent £100k pax, t/o rent 8%", {"turnoverRentPct": 8, "rentPa": 100000}, []],
  ["offer", "Footfall up 7% on 2025, conversion 22%, offer £100k pax 10 yrs", {"rentPa": 100000, "termYears": 10}, []],
  ["offer", "Unit 14-16 offer £120k pax 10 yrs, call 0207 123 4567", {"rentPa": 120000, "termYears": 10}, []],
  ["offer", "SU12/13 combined - £250k pax, 15 years. Ref BGP-2026-1145", {"rentPa": 250000, "termYears": 15}, []],
  ["offer", "Offer for Units 3 & 4, EC2M 7PY: 100k pax, 10 years", {"rentPa": 100000, "termYears": 10}, []],
  ["offer", "Unit 5, 2,450 sq ft GF + 1,200 sq ft bsmt, £49 psf = £120,050 pa", {"rentPa": 120050}, []],
  ["offer", "Offer £120k pax. Extension 4521. Mobile 07900 111222. Fax 020 7000 0000", {"rentPa": 120000}, []],
  ["offer", "M25 J2, 13,500 car spaces, 27m visitors a year. Offer £120k pax", {"rentPa": 120000}, []],
  ["offer", "Offer dated 09.11.2026: £120k pax", {"rentPa": 120000, "date": "2026-11-09"}, []],
  ["offer", "Received Mon 9/11 - £120k pax", {"rentPa": 120000, "date": "2026-11-09"}, []],
  ["offer", "9-Nov-25 offer £120k pax", {"rentPa": 120000, "date": "2025-11-09"}, []],
  ["offer", "Offer on the 9th: £120k pax", {"rentPa": 120000}, []],
  ["offer", "Offer w/c 9 Nov £120k pax", {"rentPa": 120000}, []],
  ["offer", "Offer Friday £120k pax", {"rentPa": 120000}, []],
  ["offer", "Q4 2026 opening. Offer 12/11: £120k pax, lease from 25/03/2027, RCD 24/06/2027", {"rentPa": 120000, "date": "2026-11-12"}, []],
  ["offer", "Offer received 31/10 for a 1/1/27 start, £120k pax", {"rentPa": 120000, "date": "2026-10-31"}, []],
  ["offer", "Offer £120k pax (9 November). Board 3 December.", {"rentPa": 120000, "date": "2026-11-09"}, []],
  ["offer", "Offer 11.11 £120k pax", {"rentPa": 120000}, []],
  ["offer", "Rent 120,000 EUR pa", {}, ["rentPa"]],
  ["offer", "Rent $120k pa", {}, ["rentPa"]],
  ["offer", "£120kpa + £20k pa service charge + £45k rates = £185k total", {"rentPa": 120000}, []],
  ["offer", "Assignment: premium £75,000 to outgoing tenant; passing rent £110,000 pa; unexpired term 7 years", {"premium": 75000}, []],
  ["offer", "Sublease at £60k pax for remainder of term (4 yrs), head rent £80k pax", {"termYears": 4}, ["rentPa"]],
  ["offer", "Surrender premium £200k payable by LL. New lease £150k pax 15 yrs", {"rentPa": 150000, "termYears": 15}, []],
  ["offer", "Rent: £10,000 per month (£120,000 pa)", {"rentPa": 120000}, []],
  ["offer", "Capital contribution £150k or 18 months rent free, tenant's choice. £100k pax", {"rentPa": 100000}, ["fittingOutContribution", "rentFreeMonths"]],
  ["offer", "Deposit £25k or 3 months' rent, whichever is greater. £100k pax", {"rentPa": 100000}, ["rentDeposit"]],
  ["offer", "Rent £100k pax. Rent free 6 months plus a further 6 months at half rent.", {"rentFreeMonths": 6, "rentPa": 100000}, []],
  ["offer", "Offer: 100k. Counter: 110k. Agreed: 105k pax.", {}, ["rentPa"]],
  ["offer", "TBO 5th anniversary, 9 months' notice, 3 months' rent penalty. 10 year lease. £100k pax", {"breakOption": "Tenant break at year 5", "rentPa": 100000, "termYears": 10}, []],
  ["offer", "They won't go to £130k pax. Best is £120k pax", {}, ["rentPa"]],
  ["offer", "We can't do 12 MRF, 9 MRF is fine. £100k pax", {"rentPa": 100000}, ["rentFreeMonths"]],
  ["offer", "12 MRF requested, not agreed. £100k pax", {"rentPa": 100000}, ["rentFreeMonths"]],
  ["offer", "Rent £100k pax, they refused the 5 yearly upward only rent review", {"rentPa": 100000}, ["rentReview"]],
  ["offer", "They have 12 stores and 8 years of trading. Offer £100k pax", {"rentPa": 100000}, []],
  ["offer", "Dishoom offer: £185k pax, 15 yrs, TBO yr 10, 9 MRF, £250k CC, 6 months deposit", {"rentFreeMonths": 9, "rentDeposit": "6 months", "breakOption": "Tenant break at year 10", "fittingOutContribution": 250000, "rentPa": 185000, "termYears": 15, "brandName": "Dishoom"}, []],
  ["offer", "No break, no deposit, £100k pax, 10 years, 12 MRF", {"rentFreeMonths": 12, "rentDeposit": "No deposit", "breakOption": "No break", "rentPa": 100000, "termYears": 10}, []],
  ["viewing", "Viewing booked: Thursday 19th November, 10.30am, Unit SU12 Bluewater. Attendees: Sam Hart (Dishoom), Jo Lee (CBRE), Ben Sykes (BGP). Meet at management suite.", {"attendees": "Sam Hart (Dishoom), Jo Lee (CBRE), Ben Sykes (BGP)", "date": "2026-11-19", "time": "10:30"}, []],
  ["viewing", "Dishoom viewing Tues 17/11 @ 14:00 - Units 12 & 14. Sam + 2 from ops. Parking: bay 4.", {"date": "2026-11-17", "time": "14:00", "brandName": "Dishoom"}, []],
  ["viewing", "Viewing 1 Dec 12 noon Pho", {"date": "2026-12-01", "time": "12:00", "brandName": "Pho"}, []],
  ["viewing", "Wagamama want to view Friday 20th at 11 or 11.30", {"brandName": "Wagamama"}, []],
  ["viewing", "Viewing 18.11.26 3pm-4pm, Unit 7 (2,150 sq ft)", {"date": "2026-11-18", "time": "15:00"}, []],
  ["viewing", "Viewing next Tuesday at 3. Leon Smith from Itsu", {"date": "2026-11-17", "brandName": "Itsu"}, []],
  ["viewing", "Viewing rearranged from 17 Nov 2pm to 19 Nov 4pm", {"date": "2026-11-19"}, ["time"]],
  ["viewing", "Viewing 25/11 - 10am Unit 3, 11am Unit 5, Five Guys", {"date": "2026-11-25", "brandName": "Five Guys"}, ["time"]],
  ["viewing", "Viewing at 10am 20 Nov, level 2 entrance, postcode DA9 9ST", {"date": "2026-11-20", "time": "10:00"}, []],
  ["viewing", "Viewing 19 Nov 2pm with Dishoom, Sam called at 9am to confirm", {"date": "2026-11-19", "time": "14:00", "brandName": "Dishoom"}, []],
  ["viewing", "Pho, Unit 3, 10am, 19/11", {"date": "2026-11-19", "time": "10:00", "brandName": "Pho"}, []],
  ["viewing_outcome", "Viewed 11 Nov. Sam liked the frontage but the board are not keen on the rent. Will revert by 20 Nov.", {"followUpDate": "2026-11-20", "date": "2026-11-11", "outcome": "Follow Up"}, []],
  ["viewing_outcome", "Great viewing. They want HoTs asap and will offer this week", {"outcome": "Offer Expected"}, []],
  ["viewing_outcome", "Viewed today with Pho's ops team - too small, they've passed. Suggested Unit 9 instead, they're interested in that.", {"date": "2026-11-13", "brandName": "Pho"}, ["outcome"]],
  ["viewing_outcome", "No show from Wagamama - second time. Not interested in rebooking.", {"outcome": "No Show", "brandName": "Wagamama"}, []],
  ["viewing_outcome", "Not a great viewing - Dishoom didn't like the columns. Interested at the right rent though.", {"brandName": "Dishoom"}, []],
  ["viewing_outcome", "Cancelled by them at 9am, no reason. Will not rebook.", {}, []],
  ["viewing_outcome", "Viewed 10 Nov; 100% keen; offer to follow by 17 Nov; wants 2nd viewing with shopfitter 24 Nov", {"date": "2026-11-10", "outcome": "Offer Expected"}, []],
  ["viewing_outcome", "Leon were positive, Itsu less so.", {}, ["brandName", "outcome"]],
  ["viewing_outcome", "Interested? Hard to say. They asked about service charge (£14 psf) and rates.", {}, []],
  ["viewing_outcome", "Didn't like the unit. Might be interested in Unit 9.", {"outcome": "Not Interested"}, []],
  ["viewing_outcome", "They were keen until they saw the service charge. Now not interested.", {}, ["outcome"]],
  ["viewing_outcome", "They should be keen given the footfall, but said very little", {}, []],
  ["viewing_outcome", "May 2027 opening discussed. Very keen.", {"outcome": "Interested"}, []],
  ["interest", "Jo Lee at CBRE called re Pho and Itsu - both have live requirements for 2,000-3,000 sq ft. Tel 020 7182 2000.", {"brandName": "Pho", "moreBrands": [{"name": "Itsu"}]}, []],
  ["interest", "Enquiry via website 12/11: Gail's Bakery, contact Tom Reid (tom.reid@gails.com, 07700 900456)", {"date": "2026-11-12", "brandName": "Gail's"}, []],
  ["interest", "Savills (Jane Roe) acting for Wagamama. Dishoom ruled out.", {"brandName": "Wagamama"}, []],
  ["interest", "Dishoom's agent is Shelley Sandzer. Contact is Nick Weir.", {"contactName": "Nick Weir", "agentName": "Shelley Sandzer", "brandName": "Dishoom"}, []],
  ["interest", "Itsu (not Wagamama) asked for details on 10 Nov", {"date": "2026-11-10", "brandName": "Itsu"}, []],
  ["interest", "Neither Dishoom nor Pho are interested. Itsu want details.", {"brandName": "Itsu"}, []],
  ["interest", "Brand: Pho. Brand: Itsu. Agent: Jo Lee", {"agentName": "Jo Lee"}, ["brandName"]],
  ["interest", "Next week Office are coming to look. Boots on site Thursday.", {"brandName": "Office"}, []],
  ["interest", "The Works rang on 10 Nov. Wagamama no longer interested.", {"date": "2026-11-10", "brandName": "The Works"}, []],
  ["interest", "Agent: Jo Lee\nFirm: CBRE\nBrand: Itsu\nContact: Tom Reid\nDate: 10/11/2026", {"brandName": "Itsu", "contactName": "Tom Reid", "agentName": "Jo Lee", "date": "2026-11-10"}, []],
  ["interest", "No agent. Contact: the FD, name tbc", {}, []],
];

test("third round: 97 adversarial notes read to exactly these boxes, with a reason for each box refused", () => {
  assert.ok(ROUND_THREE_NOTES.length >= 50);
  for (const [kind, text, expected, refused] of ROUND_THREE_NOTES) {
    const r = read(text, kind, kind === "round" ? {} : { brandNames: ROUND_THREE_BRANDS });
    assert.deepEqual(boxes(r), expected, text);
    assert.deepEqual(r.dropped.map(d => d.field).sort(), refused, text);
    assert.equal(r.saidBy, null, text);
    for (const [key, value] of Object.entries(r.fields)) {
      assert.notEqual(value, null, `${key}: ${text}`);
      assert.ok((NOTE_KIND_FIELDS[kind] as readonly string[]).includes(key), `${key} on ${kind}: ${text}`);
      assert.ok(!/Id$/.test(key), `${key}: ${text}`);
    }
    for (const d of r.dropped) { assert.ok(d.reason.length > 10, text); assert.doesNotMatch(d.reason, /—/, text); }
    // Every value comes with words that are in the note.
    for (const [key, quote] of Object.entries(r.quotes)) for (const part of String(quote).split(", ")) assert.ok(cleanNote(text).includes(part), `${key} quote "${part}": ${text}`);
  }
});

test("third round: the reasons a person is given are plain and specific", () => {
  const why = (text: string, field: string, kind: NoteKind = "offer") => reasonFor(read(text, kind, { brandNames: ROUND_THREE_BRANDS }), field) || "";
  assert.match(why("Rent 120,000 EUR pa", "rentPa"), /is not in pounds/);
  assert.match(why("Rent $120k pa", "rentPa"), /is not in pounds/);
  assert.equal(why("Capital contribution £150k or 18 months rent free, tenant's choice. £100k pax", "rentFreeMonths"), "The note gives a choice between two terms. Fill in the one that applies.");
  assert.equal(why("Deposit £25k or 3 months' rent, whichever is greater. £100k pax", "rentDeposit"), "The note gives a choice between two terms. Fill in the one that applies.");
  assert.match(why("We can't do 12 MRF, 9 MRF is fine. £100k pax", "rentFreeMonths"), /turns "12 MRF" down/);
  assert.match(why("12 MRF requested, not agreed. £100k pax", "rentFreeMonths"), /turns "12 MRF" down/);
  assert.match(why("Rent £100k pax, they refused the 5 yearly upward only rent review", "rentReview"), /turns "5 yearly upward only rent review" down/);
  assert.match(why("No to a 15 year lease, they want 10 years. £100k pax", "termYears"), /turns "15 year lease" down/);
  assert.match(why("They don't want a break at year 5. £100k pax, 10 yr lease", "breakOption"), /turns "break at year 5" down/);
  assert.equal(why("Viewing 25/11 - 10am Unit 3, 11am Unit 5, Five Guys", "time", "viewing"), "The note gives more than one time. Set the time by hand.");
  assert.equal(why("Leon were positive, Itsu less so.", "outcome", "viewing_outcome"), "The note reads both ways (keen and not keen). Choose the outcome.");
  assert.equal(why("Brand: Pho. Brand: Itsu. Agent: Jo Lee", "brandName", "interest"), "The note gives more than one brand. Type the name.");
  assert.equal(why("Deposit: £30,000 or 3 months. Rent: £120k pax", "rentDeposit"), "The note gives a choice between two terms. Fill in the one that applies.");
  assert.equal(read("Deposit: £30,000 or 3 months. Rent: £120k pax").fields.rentPa, 120000);
  assert.equal(why("Offer increased from 8% to 10% turnover, base £90k pax", "turnoverRentPct"), "The note gives more than one turnover percentage. Type it.");
  assert.equal(why("6 months to 9 months rent free, £100k pax", "rentFreeMonths"), "The note gives more than one rent free period. Type the months.");
  assert.deepEqual(boxes(read("£120k pa excl, 10yr lease w/ TBO @ yr 5 & 5 yrly RR, 9mths RF")), { rentPa: 120000, termYears: 10, breakOption: "Tenant break at year 5", rentFreeMonths: 9 });
  assert.equal(ai("Went ok", { outcome: { value: "Interested", quote: "Went ok" } }, "viewing_outcome").fields.outcome, undefined);
  // A base rent "or" a turnover percentage is one rent set two ways: both stay.
  assert.deepEqual(boxes(read("Rent the higher of £100k pax or 10% of turnover")), { rentPa: 100000, turnoverRentPct: 10 });
  // What is refused stays in the notes box, whole.
  assert.equal(read("We can't do 12 MRF, 9 MRF is fine. £100k pax").fields.note, "We can't do 12 MRF, 9 MRF is fine");
  assert.equal(read("Capital contribution £150k or 18 months rent free, tenant's choice. £100k pax").fields.note, "Capital contribution £150k or 18 months rent free, tenant's choice");
  // The numbers of a list are not left over as notes.
  assert.equal(read("1. Rent £88,000 pax\n2. Term 10 years\n3. Break 5th year (mutual)").fields.note, undefined);
  // The same notes with the words the other way round still read.
  assert.deepEqual(boxes(read("They will pay £120k pax")), { rentPa: 120000 });
  assert.deepEqual(boxes(read("No break, no deposit, £100k pax, 10 years, 12 MRF")), { breakOption: "No break", rentDeposit: "No deposit", rentPa: 100000, termYears: 10, rentFreeMonths: 12 });
  assert.deepEqual(boxes(read("In lieu of rent free they want £100k CC. Rent £120k pax")), { fittingOutContribution: 100000, rentPa: 120000 });
  assert.deepEqual(boxes(read("TBO yr 5, 6 MRF, £100k pax, 10 yrs, not agreed yet on deposit")), { breakOption: "Tenant break at year 5", rentFreeMonths: 6, rentPa: 100000, termYears: 10 });
});

test("third round: whose position a round is, when the note names both sides or neither plainly", () => {
  const party = (text: string) => read(text, "round");
  assert.equal(party("We want £130k pax, 10 yrs, 6 MRF").fields.party, "landlord");
  assert.equal(party("They want 12 MRF and a break at year 5").fields.party, "tenant");
  assert.equal(party("They are still at £120k pax").fields.party, "tenant");
  assert.equal(party("We are at £130k pax and 6 MRF").fields.party, "landlord");
  assert.equal(party("LL's final counter: £130k pax").fields.party, "landlord");
  assert.equal(party("Tenant's final position: rent 125k, RF 9, term 10, break 5").fields.party, "tenant");
  for (const text of ["They rejected our counter of £135k pax and are holding at £125k pax", "Round 3 - they've moved to £128k. We're at £132k. Gap is £4k.",
    "We countered at £130k pax, 9 MRF. They came back at £125k pax, 10 MRF. We accepted £127.5k and 9 MRF."]) {
    assert.equal(party(text).fields.party, undefined, text);
    assert.match(reasonFor(party(text), "party") || "", /both sides/, text);
    assert.equal(party(text).fields.rentPa, undefined, text);
  }
  assert.equal(party("Agreed £127,500 pax, 9 MRF, 10 yrs, TBO yr 5").fields.party, undefined, "an agreed position is neither side's");
  // Two rents are two positions, even when the words name one side only.
  const mixed = party("Landlord will accept £115k pax subject to 6 months deposit. Tenant position was £105k pax with 3 months");
  assert.equal(mixed.fields.party, undefined);
  assert.equal(mixed.fields.rentPa, undefined);
  assert.match(reasonFor(mixed, "party") || "", /more than one position/);
  // An outcome that the next words take back is not Interested.
  assert.match(reasonFor(read("They loved it but rent is too high, unlikely to proceed", "viewing_outcome"), "outcome") || "", /both ways/);
  assert.equal(read("Showed them round, no real interest", "viewing_outcome").fields.outcome, "Not Interested");
  assert.deepEqual(boxes(read("Rent - £85,000 pax\nLease - 10 yrs\nTBO - yr 5\nRF - 6 mths")), { rentPa: 85000, termYears: 10, breakOption: "Tenant break at year 5", rentFreeMonths: 6 });
});

test("third round: an AI reading is held to the note the same way", () => {
  const cases: [NoteKind, string, Record<string, unknown>, Record<string, unknown>][] = [
    ["offer", "Sam says the figure is one two zero, call me on 07700 120000", { rentPa: { value: 120000, quote: "07700 120000" } }, {}],
    ["offer", "Unit 120000 is the reference, rent to be confirmed", { rentPa: { value: 120000, quote: "Unit 120000" } }, {}],
    ["offer", "They pay 150k at Westfield and would offer something similar", { rentPa: { value: 150000, quote: "150k at Westfield" } }, {}],
    ["offer", "Lease expires in 2036", { termYears: { value: 10, quote: "expires in 2036" } }, {}],
    ["offer", "They have 12 stores and 8 years of trading", { termYears: { value: 8, quote: "8 years of trading" } }, {}],
    ["viewing", "Meet at Unit 14 at the usual time", { time: { value: "14:00", quote: "Unit 14" } }, {}],
    ["viewing", "Viewing on the 20th", { date: { value: "2026-11-20", quote: "the 20th" } }, {}],
    ["viewing_outcome", "They were lukewarm at best", { outcome: { value: "Interested", quote: "lukewarm at best" } }, {}],
    ["viewing_outcome", "Polite but non-committal throughout", { outcome: { value: "Interested", quote: "Polite but non-committal" } }, {}],
    ["offer", "Break at five", { breakOption: { value: "Tenant break at year 10", quote: "Break at five" } }, {}],
    ["offer", "£100k pax. They also mentioned 5% on sales above target.", { turnoverRentPct: { value: 5, quote: "5% on sales above target" } }, { rentPa: 100000 }],
    ["offer", "Rent 120,000 EUR a year for ten years", { rentPa: { value: 120000, quote: "120,000 EUR a year" }, termYears: { value: 10, quote: "ten years" } }, { termYears: 10 }],
    ["offer", "Either £150k of capital contribution or 18 months rent free", { fittingOutContribution: { value: 150000, quote: "£150k of capital contribution" } }, {}],
    // Kept: what the note plainly states and the rules did not read.
    ["offer", "Deposit is three months, break at five", { rentDeposit: { value: "3 months", quote: "three months" }, breakOption: { value: "Break at year 5", quote: "break at five" } },
      { rentDeposit: "3 months", breakOption: "Break at year 5" }],
    ["offer", "Terms as before but 9 not 6 on the rent free", { rentFreeMonths: { value: 9, quote: "9 not 6 on the rent free" } }, { rentFreeMonths: 9 }],
    ["viewing_outcome", "They loved the space and want to progress", { outcome: { value: "Interested", quote: "They loved the space and want to progress" } }, { outcome: "Interested" }],
  ];
  for (const [kind, text, candidate, expected] of cases) assert.deepEqual(boxes(ai(text, candidate, kind)), expected, text);
  // One of the letting team is never the brand's contact, whatever the reader says.
  const team = ai("Spoke to Ben Sykes at BGP who mentioned Pho", { contactName: { value: "Ben Sykes", quote: "Ben Sykes" }, brandName: { value: "Pho", quote: "Pho" } }, "interest", { staffNames: ["Ben Sykes"] });
  assert.deepEqual(boxes(team), { brandName: "Pho" });
  assert.ok(reasonFor(team, "contactName"));
});
