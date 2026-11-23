// A plain note read into a CRM strategy, action or event form (Woody, 2026-11-15).
//   node --import tsx --test server/crm-note.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { checkCrmAnswer, dateFromNote, ownerFromNote, timeFromNote, titleFromNote } from "../shared/crm-note";
import { readCrmNote, CrmNoteReaderError } from "./crm-note-reader";

const staff = [{ id: "u1", name: "Charlotte Roberts" }, { id: "u2", name: "Rupert Bentley-Smith" }, { id: "u3", name: "Charlotte Hill" }, { id: "u4", name: "Emily Stone" }];
const companies = [{ id: "c1", name: "Landsec" }, { id: "c2", name: "British Land Company PLC" }, { id: "c3", name: "Wingstop" }, { id: "c4", name: "Wingstop UK Holdings" }];
const today = "2026-11-15";

const note = "Win more food and beverage leasing from Landsec and British Land. Emily to own. Start in January, review at the end of June. With Landsec we want the Bluewater leisure instruction.";
const answer = {
  title: "Food and beverage leasing with Landsec and British Land",
  text: "Win more food and beverage leasing from Landsec and British Land.",
  owner: "Emily", team: null,
  startsOn: { date: "2027-01-01", quote: "Start in January" },
  endsOn: { date: "2027-06-30", quote: "review at the end of June" },
  companies: [{ name: "Landsec", reason: "With Landsec we want the Bluewater leisure instruction." }, { name: "British Land", reason: "" }, { name: "Hammerson", reason: "" }],
};

test("a strategy note fills the name, objective, owner, dates and companies it states", () => {
  const r = checkCrmAnswer(answer, { form: "strategy", text: note, today, staff, companies });
  assert.equal(r.fields.title, "Food and beverage leasing with Landsec and British Land");
  assert.equal(r.fields.text, "Win more food and beverage leasing from Landsec and British Land.");
  assert.equal(r.fields.ownerId, "u4");
  assert.equal(r.fields.startsOn, "2027-01-01");
  assert.equal(r.fields.endsOn, "2027-06-30");
  assert.deepEqual(r.companies, [
    { id: "c1", name: "Landsec", reason: "With Landsec we want the Bluewater leisure instruction." },
    { id: "c2", name: "British Land Company PLC", reason: "" },
  ]);
  assert.deepEqual(r.notFound, [], "a company the note does not name is not listed either");
  assert.deepEqual(r.filled, ["Strategy name", "Objective", "BGP owner", "Start date", "Review / end date", "2 companies"]);
});

test("nothing the note does not say reaches a box", () => {
  const r = checkCrmAnswer({
    title: "Luxury fashion expansion programme across Europe", text: "Grow luxury fashion lettings.",
    owner: "Woody", team: "Investment",
    startsOn: { date: "2027-03-01", quote: "Start in January" }, endsOn: { date: "2027-06-30", quote: "by the summer of next year" },
    companies: [{ name: "Hammerson", reason: "" }, { name: "Landsec", reason: "They are our biggest client." }],
  }, { form: "strategy", text: note, today, staff, companies });
  assert.equal(r.fields.title, undefined, "a title in words the note does not use");
  assert.equal(r.fields.text, note, "an objective that is not a span of the note: the whole note stands in");
  assert.equal(r.fields.ownerId, undefined);
  assert.match(r.check.join(" "), /BGP owner: "Woody" did not pick out one person/);
  assert.equal(r.fields.team, undefined);
  assert.equal(r.fields.startsOn, undefined, "March from words that say January");
  assert.equal(r.fields.endsOn, undefined, "words that are not in the note");
  assert.deepEqual(r.companies, [{ id: "c1", name: "Landsec", reason: "" }], "a reason that is not the note's words is dropped; a company not named is not added");
});

test("an owner is one BGP person the note names; a first name two people share picks nobody", () => {
  assert.deepEqual(ownerFromNote("Emily", "Emily to own", staff), { id: "u4", name: "Emily Stone" });
  assert.equal(ownerFromNote("Charlotte", "Charlotte to own", staff), null);
  assert.deepEqual(ownerFromNote("Charlotte Hill", "Charlotte Hill to own", staff), { id: "u3", name: "Charlotte Hill" });
  assert.equal(ownerFromNote("Emily", "Rupert to own", staff), null, "the name must be in the note");
});

test("a company name is matched to one record or listed back, never guessed", () => {
  const r = checkCrmAnswer({ title: "Send Wingstop the particulars", companies: [{ name: "Wingstop" }, { name: "Popeyes" }] },
    { form: "action", text: "Emily to send Wingstop and Popeyes the Trinity Leeds particulars by Friday.", today, staff, companies });
  assert.deepEqual(r.companies, [{ id: "c3", name: "Wingstop", reason: "" }], "the exact name wins over a longer one");
  assert.deepEqual(r.notFound, ["Popeyes"]);
  const two = checkCrmAnswer({ companies: [{ name: "Wing" }] }, { form: "action", text: "Call Wing about it tomorrow", today, staff, companies: [{ id: "a", name: "Wing Yip" }, { id: "b", name: "Wing Stop" }] });
  assert.deepEqual(two.companies, []);
  assert.deepEqual(two.notFound, ["Wing (2 records share that name)"]);
});

test("dates and times are kept only with words from the note that carry them", () => {
  const n = "Lunch with the Landsec leasing team at The Ivy on 12 December at 1pm, Lucy hosting.";
  assert.equal(dateFromNote("2026-12-12", "on 12 December", n, today), "2026-12-12");
  assert.equal(dateFromNote("2026-12-13", "on 12 December", n, today), null, "the 13th from words that say the 12th");
  assert.equal(dateFromNote("2026-11-12", "on 12 November", n, today), null, "the quote is not in the note");
  assert.equal(dateFromNote("2029-12-12", "on 12 December", n, today), "2029-12-12");
  assert.equal(dateFromNote("2040-12-12", "on 12 December", n, today), null, "too far ahead");
  assert.equal(dateFromNote("2026-11-17", "on Tuesday", "Call them on Tuesday", today), "2026-11-17");
  assert.equal(dateFromNote("2026-11-17", "Call them", "Call them on Tuesday", today), null, "words that carry no date");
  assert.equal(timeFromNote("13:00", "at 1pm", n), "13:00");
  assert.equal(timeFromNote("13:00", "Lucy hosting", n), null);
});

test("an event takes its start, place and type; a date with no time says the time was assumed", () => {
  const n = "Lunch with the Landsec leasing team at The Ivy on 12 December at 1pm, Rupert hosting. To talk through next year's instructions.";
  const r = checkCrmAnswer({
    title: "Lunch with the Landsec leasing team", text: "To talk through next year's instructions.", kind: "bgp", owner: "Rupert",
    startsAt: { date: "2026-12-12", time: "13:00", quote: "on 12 December at 1pm" }, endsAt: null, location: "The Ivy",
    companies: [{ name: "Landsec", reason: "" }],
  }, { form: "event", text: n, today, staff, companies });
  assert.equal(r.fields.startsAt, "2026-12-12T13:00");
  assert.equal(r.fields.location, "The Ivy");
  assert.equal(r.fields.eventKind, "bgp");
  assert.equal(r.fields.ownerId, "u2");
  assert.deepEqual(r.check, []);
  const due = checkCrmAnswer({ title: "Call Landsec about the pitch", owner: "Rupert", dueAt: { date: "2026-11-17", time: null, quote: "on Tuesday" }, companies: [{ name: "Landsec" }] },
    { form: "action", text: "Rupert to call Landsec about the pitch on Tuesday", today, staff, companies });
  assert.equal(due.fields.dueAt, "2026-11-17T17:00");
  assert.deepEqual(due.check, ["Due: no time in the note, set to 17:00"]);
});

test("a title keeps the reader's wording only when most of its words are the note's", () => {
  assert.equal(titleFromNote("Call Landsec about the Bluewater pitch", "Rupert to call Landsec about the Bluewater leisure pitch"), "Call Landsec about the Bluewater pitch");
  assert.equal(titleFromNote("Strategic occupier engagement initiative", "Rupert to call Landsec about the Bluewater leisure pitch"), null);
});

test("the reader matches companies on the server, is capped, and refuses a note with nothing in it", async () => {
  const queries: any[] = [];
  const q = { query: async (text: string, values?: any[]) => { queries.push({ text, values }); return { rows: [{ id: "c1", name: "Landsec" }, { id: "c2", name: "British Land Company PLC" }] }; } };
  const r = await readCrmNote(q, { form: "strategy", kind: "landlord", text: note, staff }, { hasKey: () => true, claim: async () => true, today: () => today, ask: async () => ({ text: `Here you go: ${JSON.stringify(answer)}`, model: "test" }) });
  assert.equal(r.companies.length, 2);
  assert.deepEqual(queries[0].values, [["landsec%", "british land%", "hammerson%"]], "only the names in the note are looked up, as prefixes");
  assert.match(queries[0].text, /NOT LIKE 'tenant%'/, "the landlord view never searches brands");
  await readCrmNote(q, { form: "strategy", kind: "brand", text: note, staff }, { hasKey: () => true, claim: async () => true, today: () => today, ask: async () => ({ text: JSON.stringify(answer), model: "test" }) });
  assert.match(queries[1].text, /''\)\) LIKE 'tenant%'/);
  assert.doesNotMatch(queries[1].text, /NOT LIKE 'tenant%'/, "the brand view searches brands only");
  const refused = (work: Promise<unknown>, status: number) => assert.rejects(work, (e: any) => e instanceof CrmNoteReaderError && e.status === status);
  await refused(readCrmNote(q, { form: "action", kind: "landlord", text: "Call", staff }, { hasKey: () => true, claim: async () => true }), 400);
  await refused(readCrmNote(q, { form: "action", kind: "landlord", text: note, staff }, { hasKey: () => false }), 503);
  await refused(readCrmNote(q, { form: "action", kind: "landlord", text: note, staff }, { hasKey: () => true, claim: async () => false }), 429);
  await refused(readCrmNote(q, { form: "action", kind: "landlord", text: note, staff }, { hasKey: () => true, claim: async () => true, ask: async () => ({ text: "I cannot help with that", model: "test" }) }), 502);
});

// Woody, 2026-11-23: "Forge agency" in a note missed the record "forge".
test("a company named with a word saying what kind of firm it is matches the record without it", () => {
  const reading = checkCrmAnswer({ title: "Ongoing relationship with Forge agency", text: "jack wants an ongoing relationship with Forge agency",
    companies: [{ name: "Forge agency", reason: "quarterly meetings with the investment team" }] },
    { form: "strategy", text: "jack wants an ongoing relationship with Forge agency to include quarterly meetings with the investment team", today: "2026-11-23", staff: [],
      companies: [{ id: "f1", name: "forge" }, { id: "f2", name: "Forge Global Holdings Inc" }] });
  assert.deepEqual(reading.companies, [{ id: "f1", name: "forge", reason: "quarterly meetings with the investment team" }]);
  assert.deepEqual(reading.notFound, []);
});
