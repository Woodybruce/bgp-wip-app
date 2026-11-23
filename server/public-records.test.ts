// Verified from public sources: the search and its suggestion (Woody, 23
// November 2026: "should search and pull out what it can to actually verify
// for public records ... make a suggestion if thats a reasonable amount or
// have to ask for further info"). Rules: shared/public-records.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { checkPublicRecordsAnswer, factNamesCompany, publicRecordsNote, publicRecordsSuggestion, yearOfBirthIn } from "../shared/public-records";
import { searchPublicRecords } from "./public-records";

const TODAY = new Date("2026-11-23T12:00:00Z");
const answer = {
  profile: "high",
  facts: [
    { kind: "role", fact: "Claude Bosi is the founder and chef-patron of Brasserie Bordelaise.", url: "https://www.brasseriebordelaise.co.uk/about", source: "Brasserie Bordelaise" },
    { kind: "age", fact: "Claude Bosi, born in 1972, is a French chef.", url: "https://en.wikipedia.org/wiki/Claude_Bosi", source: "Wikipedia" },
    { kind: "company", fact: "Bosi opened Brasserie Bordelaise in Chelsea in 2025.", url: "https://www.standard.co.uk/going-out/restaurants/bosi", source: "Evening Standard" },
    { kind: "other", fact: "A chef of the same name won an award in 1990.", url: "https://example.org/award", sameIdentity: "unsure" },
    { kind: "other", fact: "Said without a source the search read.", url: "https://made-up.example/page" },
  ],
};
const citations = ["https://www.brasseriebordelaise.co.uk/about", "https://en.wikipedia.org/wiki/Claude_Bosi", "https://www.standard.co.uk/going-out/restaurants/bosi", "https://example.org/award"];

test("only facts whose page the search read are kept", () => {
  const r = checkPublicRecordsAnswer(answer, citations);
  assert.equal(r.facts.length, 4);
  assert.equal(r.unsourced, 1);
  assert.equal(r.profile, "high");
  assert.equal(checkPublicRecordsAnswer({ profile: "high", facts: [] }, []).profile, "none", "nothing read is no profile");
});

test("enough: two or more sites about them, one tying them to the company, and no other age than the register's", () => {
  const r = checkPublicRecordsAnswer(answer, citations);
  const s = publicRecordsSuggestion(r, { name: "Claude Bosi", dob: { year: 1972 } }, "BRASSERIE BORDELAISE LIMITED", TODAY);
  assert.equal(s.enough, true, s.reasons.join("; "));
  assert.match(s.words, /^Enough to verify from public sources: 3 sources tie Claude Bosi to BRASSERIE BORDELAISE LIMITED\.$/);
  assert.match(publicRecordsNote(r, "Claude Bosi"), /^Claude Bosi: Claude Bosi is the founder and chef-patron of Brasserie Bordelaise \(Brasserie Bordelaise\); /);
});

test("ask for their ID: one source, nothing tying them to the company, another age, or nothing found", () => {
  const one = checkPublicRecordsAnswer({ profile: "some", facts: [answer.facts[0]] }, citations);
  const a = publicRecordsSuggestion(one, { name: "Claude Bosi", dob: { year: 1972 } }, "BRASSERIE BORDELAISE LIMITED", TODAY);
  assert.equal(a.enough, false);
  assert.match(a.words, /^Ask for their ID/);
  assert.match(a.reasons.join(" "), /Only one source is about them/);
  const r = checkPublicRecordsAnswer(answer, citations);
  assert.match(publicRecordsSuggestion(r, { name: "Claude Bosi", dob: { year: 1972 } }, "Burger Brothers Limited", TODAY).reasons.join(" "), /No source ties them to Burger Brothers Limited/);
  assert.match(publicRecordsSuggestion(r, { name: "Claude Bosi", dob: { year: 1985 } }, "BRASSERIE BORDELAISE LIMITED", TODAY).reasons.join(" "), /does not match the register's \(born 1985\)/);
  assert.match(publicRecordsSuggestion(checkPublicRecordsAnswer({ profile: "none", facts: [] }, []), { name: "X Y" }, "Acme Ltd", TODAY).reasons[0], /Nothing reliable was found/);
});

test("a fact names a company by its telling words; a year of birth read from 'born' or an age", () => {
  assert.equal(factNamesCompany("He runs Brasserie Bordelaise in Chelsea", "BRASSERIE BORDELAISE LIMITED"), true);
  assert.equal(factNamesCompany("He runs a brasserie", "BRASSERIE BORDELAISE LIMITED"), false);
  assert.equal(yearOfBirthIn("Claude Bosi, born in 1972, is a chef", TODAY), 1972);
  assert.equal(yearOfBirthIn("the 54-year-old chef", TODAY), 1972);
  assert.equal(yearOfBirthIn("opened in 2025", TODAY), null);
});

test("the search says why it did not run, and keeps only what it read", async () => {
  const off = await searchPublicRecords({ name: "Claude Bosi", born: "1972", roles: ["owner"], company: "BRASSERIE BORDELAISE LIMITED", brand: null }, { configured: () => false });
  assert.match("error" in off ? off.error : "", /not set up/);
  const spent = await searchPublicRecords({ name: "Claude Bosi", born: null, roles: [], company: "X", brand: null }, { configured: () => true, claim: async () => false });
  assert.match("error" in spent ? spent.error : "", /allowance/);
  let prompt = "";
  const ran = await searchPublicRecords({ name: "Claude <Bosi>", born: "March 1972", roles: ["owner"], company: "BRASSERIE BORDELAISE LIMITED", brand: "Brasserie Bordelaise" }, {
    configured: () => true, claim: async () => true,
    ask: async p => { prompt = p; return { answer: JSON.stringify(answer), citations }; },
  });
  assert.ok(!("error" in ran));
  assert.equal("facts" in ran ? ran.facts.length : 0, 4);
  assert.doesNotMatch(prompt, /[<>]/, "what is sent is plain text");
  assert.match(prompt, /owner at BRASSERIE BORDELAISE LIMITED \(trading as Brasserie Bordelaise\); born March 1972/);
});
