// Companies owned from abroad (Woody, 21 November 2026: "let's make sure all
// of that is built"): the parent note in the UK company's accounts, the GLEIF
// chain, and the client's structure chart against what the app found. The
// rules are shared/foreign-owners.ts. LEGO's note is LEGO Company Limited's
// (00368236) accounts to 31 December 2025, note 26, as filed; KIRKBI A/S's
// GLEIF record is as GLEIF gave it on 21 November 2026.
import test from "node:test";
import assert from "node:assert/strict";
import {
  abroadStatus, checkParentNoteAnswer, cleanChartReading, compareChart, countryCode, foreignParentsIn, gleifEntityFrom,
  gleifTop, gleifTraceWords, parentKind, parentLineWords, pickGleifRecord, readParentNote, recordsFor, sameCompany, strictCompanyKey,
  type AbroadRecord, type AccountsParentNote, type GleifEntity, type PrecheckAbroad,
} from "../shared/foreign-owners";

const LEGO_NOTE = "The receivable is unsecured and no guarantees have been received. 26 Parent and ultimate parent undertaking The ultimate parent undertaking and largest group to consolidate these financial statements is KIRKBI A/S, incorporated in Denmark. Copies of the KIRKBI A/S consolidated financial statements can be obtained from the following address: Koldingvej 2, 7190 Billund, Denmark The parent undertaking of the smallest to consolidate these financial statements is LEGO A/S, incorporated in Denmark. Copies of the LEGO A/S consolidated financial statements can be obtained from the following address: Aastvej 1, 7190 Billund, Denmark 27 Post Balance Sheet Events";

test("LEGO's note: KIRKBI A/S is the ultimate parent, LEGO A/S the smallest group, both in Denmark, each in its own words", () => {
  const lines = readParentNote(LEGO_NOTE);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    roles: ["ultimate", "largest_group"], name: "KIRKBI A/S", kind: "company", country: "Denmark", page: null,
    words: "The ultimate parent undertaking and largest group to consolidate these financial statements is KIRKBI A/S, incorporated in Denmark.",
  });
  assert.equal(lines[1].name, "LEGO A/S");
  assert.deepEqual(lines[1].roles, ["smallest_group"]);
  assert.equal(lines[1].words, "The parent undertaking of the smallest to consolidate these financial statements is LEGO A/S, incorporated in Denmark.");
  assert.equal(parentLineWords(lines[0]), "KIRKBI A/S (Denmark): the ultimate parent and parent of the largest group that consolidates it");
});

test("other wordings: immediate and ultimate parents, a subsidiary of, the group headed by, legal forms with stops", () => {
  const one = (text: string) => readParentNote(text).map(l => `${l.roles.join("+")}|${l.name}|${l.country ?? ""}|${l.kind}`);
  assert.deepEqual(one("The immediate parent undertaking is Bidco Limited, a company registered in England and Wales. The ultimate parent undertaking and controlling party is Topco S.à r.l., a company incorporated in Luxembourg."),
    ["ultimate+controlling_party|Topco S.à r.l.|Luxembourg|company", "immediate|Bidco Limited|England and Wales|company"]);
  assert.deepEqual(one("The company is a wholly owned subsidiary of Zara Holding B.V., incorporated in the Netherlands."), ["parent|Zara Holding B.V.|Netherlands|company"]);
  assert.deepEqual(one("The largest and smallest group of undertakings for which group financial statements have been drawn up is that headed by Siemens AG, incorporated in Germany."),
    ["largest_group+smallest_group|Siemens AG|Germany|company"]);
  assert.deepEqual(one("The company's immediate and ultimate parent company is Nestlé S.A., a company incorporated in Switzerland."), ["ultimate+immediate|Nestlé S.A.|Switzerland|company"]);
  assert.deepEqual(one("The ultimate parent company is IKEA Holding B.V. (incorporated in the Netherlands). The ultimate controlling party is Stichting INGKA Foundation."),
    ["ultimate|IKEA Holding B.V.|Netherlands|company", "controlling_party|Stichting INGKA Foundation||company"]);
  assert.deepEqual(one("The Company's ultimate parent and controlling party is ABC Holdings Limited, by virtue of its 100% shareholding."), ["ultimate+controlling_party|ABC Holdings Limited||company"]);
  assert.deepEqual(one("The immediate parent company is XYZ Ltd. The company has no employees."), ["immediate|XYZ Ltd.||company"]);
  assert.equal(readParentNote("The immediate parent company is XYZ Ltd. The company has no employees.")[0].words, "The immediate parent company is XYZ Ltd.");
});

test("a person, a family, no controlling party, and wordings that name no one", () => {
  const person = readParentNote("In the opinion of the directors the ultimate controlling party is Mr J. Smith. The company");
  assert.equal(person[0].name, "Mr J. Smith");
  assert.equal(person[0].kind, "person");
  const family = readParentNote("The ultimate controlling party is the Kirk Kristiansen family.");
  assert.equal(family[0].name, "Kirk Kristiansen family");
  assert.equal(family[0].kind, "people");
  const none = readParentNote("In the opinion of the directors there is no ultimate controlling party.");
  assert.equal(none.length, 1);
  assert.equal(none[0].none, true);
  assert.equal(parentLineWords(none[0]), "The accounts say there is no ultimate controlling party");
  assert.deepEqual(readParentNote("The company's ultimate parent undertaking is not known. The largest customer is Tesco PLC."), []);
  assert.deepEqual(readParentNote("The company is controlled by its directors."), []);
  assert.deepEqual(readParentNote(""), []);
});

test("parentKind: titles are people, company words are companies, a bare controlling party of two to four words is a person", () => {
  assert.equal(parentKind("Dr Anne Bloggs", "ultimate"), "person");
  assert.equal(parentKind("The Trustees of the Smith Settlement", "controlling_party"), "people");
  assert.equal(parentKind("Anne Bloggs", "controlling_party"), "person");
  assert.equal(parentKind("Anne Bloggs", "ultimate"), "company");
  assert.equal(parentKind("K2 Fonden af 2023", "controlling_party"), "company");
});

test("foreignParentsIn: only companies a note places outside the UK", () => {
  const note: AccountsParentNote = {
    documentId: "d1", chDocumentId: "c1", madeUpTo: "2025-12-31", via: "text", status: "found", unread: null, readAt: "2026-11-21T00:00:00Z",
    lines: [
      ...readParentNote(LEGO_NOTE),
      ...readParentNote("The immediate parent undertaking is Bidco Limited, a company registered in England and Wales."),
      ...readParentNote("The ultimate controlling party is Mr J. Smith."),
    ],
  };
  assert.deepEqual(foreignParentsIn(note).map(l => l.name), ["KIRKBI A/S", "LEGO A/S"]);
  assert.deepEqual(foreignParentsIn(null), []);
});

test("countryCode: GLEIF's codes for the places registers and notes give", () => {
  assert.equal(countryCode("Denmark"), "DK");
  assert.equal(countryCode("DENMARK"), "DK");
  assert.equal(countryCode("Kingdom Of Denmark"), "DK");
  assert.equal(countryCode("the Netherlands"), "NL");
  assert.equal(countryCode("Grand Duchy of Luxembourg"), "LU");
  assert.equal(countryCode("Delaware, United States"), "US");
  assert.equal(countryCode("Monaco"), "MC");
  assert.equal(countryCode("British Virgin Islands"), "VG");
  assert.equal(countryCode("England and Wales"), "GB");
  assert.equal(countryCode("Atlantis"), null);
  assert.equal(countryCode(""), null);
});

const KIRKBI_RECORD = {
  id: "5493005XXPWUMR2E5305",
  attributes: {
    lei: "5493005XXPWUMR2E5305",
    entity: { legalName: { name: "KIRKBI A/S" }, jurisdiction: "DK", registeredAs: "18591235", status: "ACTIVE", legalAddress: { country: "DK" } },
    registration: { status: "ISSUED", lastUpdateDate: "2026-06-30T10:00:00Z" },
  },
};
const ent = (over: Partial<GleifEntity>): GleifEntity => ({ lei: "X".repeat(20), name: "", jurisdiction: "DK", country: "DK", registeredAs: null, status: "ACTIVE", leiStatus: "ISSUED", lastUpdate: null, ...over });

test("gleifEntityFrom keeps what the app shows; a record with no LEI is nothing", () => {
  assert.deepEqual(gleifEntityFrom(KIRKBI_RECORD), {
    lei: "5493005XXPWUMR2E5305", name: "KIRKBI A/S", jurisdiction: "DK", country: "DK", registeredAs: "18591235",
    // The register it is on (since 21 November 2026); this record names none.
    registeredAt: null,
    status: "ACTIVE", leiStatus: "ISSUED", lastUpdate: "2026-06-30",
  });
  assert.equal(gleifEntityFrom({ attributes: {} }), null);
});

test("pickGleifRecord: the registration number first, then exactly the name in that country; never a guess between two", () => {
  const kirkbi = gleifEntityFrom(KIRKBI_RECORD)!;
  const climate = ent({ lei: "636700BFY5C96VXHWP94", name: "KIRKBI Climate A/S", registeredAs: "45222853" });
  const legoSystem = ent({ lei: "UGKYQUOFW6QSIS3P4P93", name: "LEGO SYSTEM A/S", registeredAs: "47458714" });
  assert.equal(pickGleifRecord({ name: "Kirkbi A/S", country: "Denmark", registrationNumber: "18591235" }, [climate, kirkbi]).pick?.lei, kirkbi.lei);
  assert.equal(pickGleifRecord({ name: "Kirkbi A/S", country: "Denmark", registrationNumber: null }, [climate, kirkbi]).pick?.lei, kirkbi.lei);
  // LEGO A/S has no LEI: GLEIF's name search gives LEGO System A/S, which is another company.
  assert.deepEqual(pickGleifRecord({ name: "LEGO A/S", country: "Denmark", registrationNumber: null }, [legoSystem]), { pick: null, status: "not_found", candidates: 0 });
  // The same name in another country is not it.
  assert.equal(pickGleifRecord({ name: "KIRKBI A/S", country: "Germany", registrationNumber: null }, [kirkbi]).pick, null);
  const twin = ent({ lei: "Y".repeat(20), name: "KIRKBI A/S", registeredAs: "999" });
  assert.deepEqual(pickGleifRecord({ name: "KIRKBI A/S", country: "Denmark", registrationNumber: null }, [kirkbi, twin]), { pick: null, status: "ambiguous", candidates: 2 });
});

test("gleifTop and the trace's words: owned by individuals, a parent found, no record", () => {
  const people = gleifTop(null, "NATURAL_PERSONS");
  assert.equal(people.kind, "people");
  assert.equal(people.words, "owned or controlled by individuals; GLEIF does not name them");
  assert.equal(gleifTop(null, "NON_CONSOLIDATING").kind, "not_consolidated");
  assert.equal(gleifTop(null, "LEGAL_OBSTACLES").kind, "undisclosed");
  assert.equal(gleifTop(null, null).kind, "unknown");
  const kirkbi = gleifEntityFrom(KIRKBI_RECORD)!;
  assert.equal(gleifTop(kirkbi, null).words, "its ultimate parent in GLEIF is KIRKBI A/S (DK)");
  assert.equal(
    gleifTraceWords({ name: "KIRKBI A/S", country: "Denmark", gleif: { status: "found", entity: kirkbi, parents: [], top: people, candidates: 1, error: null } }),
    "KIRKBI A/S (Denmark): in GLEIF as KIRKBI A/S, LEI 5493005XXPWUMR2E5305; at the top, owned or controlled by individuals; GLEIF does not name them");
  assert.equal(
    gleifTraceWords({ name: "LEGO A/S", country: "Denmark", gleif: { status: "not_found", entity: null, parents: [], top: null, candidates: 0, error: null } }),
    "LEGO A/S (Denmark): not in GLEIF (no LEI under that name or number)");
  const lapsed = { ...kirkbi, leiStatus: "LAPSED", lastUpdate: "2023-01-02" };
  assert.match(gleifTraceWords({ name: "KIRKBI A/S", country: "Denmark", gleif: { status: "found", entity: lapsed, parents: [], top: people, candidates: 1, error: null } }), /LEI lapsed, last updated 2023-01-02/);
});

test("checkParentNoteAnswer: a scanned filing's reading is kept only where the name is in its own words", () => {
  const raw = { lines: [
    { roles: ["ultimate", "largest_group"], name: "KIRKBI A/S", country: "Denmark", page: 41, words: "The ultimate parent undertaking and largest group to consolidate these financial statements is KIRKBI A/S, incorporated in Denmark." },
    // A name its words do not hold is dropped.
    { roles: ["immediate"], name: "LEGO Holding Ltd", country: "Denmark", page: 41, words: "The parent undertaking of the smallest to consolidate these financial statements is LEGO A/S, incorporated in Denmark." },
    // A country its words do not name is left out; a page it was not sent is null.
    { roles: ["smallest_group"], name: "LEGO A/S", country: "Sweden", page: 99, words: "The parent undertaking of the smallest to consolidate these financial statements is LEGO A/S, incorporated in Denmark." },
    { roles: ["made_up"], name: "Nobody", words: "Nobody" },
    { roles: ["controlling_party"], none: true, words: "There is no ultimate controlling party." },
  ] };
  const lines = checkParentNoteAnswer(raw, [38, 39, 40, 41]);
  assert.deepEqual(lines.map(l => [l.name, l.country, l.page]), [["KIRKBI A/S", "Denmark", 41], ["LEGO A/S", null, null], ["", null, null]]);
  assert.equal(lines[2].none, true);
  assert.deepEqual(checkParentNoteAnswer(null, [1]), []);
});

const rec = (over: Partial<AbroadRecord>): AbroadRecord => ({ id: "r1", ownerName: "KIRKBI A/S", ownerCountry: "Denmark", kind: "note", documentId: null, sourceUrl: null, note: null, person: null, by: "Jack Barratt", at: "2026-11-21T12:00:00Z", ...over });

test("abroadStatus: what was found about each company abroad, and the people behind it still to find until someone is recorded", () => {
  const kirkbi = gleifEntityFrom(KIRKBI_RECORD)!;
  const abroad: PrecheckAbroad = {
    checkedAt: "2026-11-21T12:00:00Z",
    accounts: { documentId: "d1", chDocumentId: "c1", madeUpTo: "2025-12-31", via: "scan", status: "found", unread: null, readAt: "2026-11-21T12:00:00Z", lines: readParentNote(LEGO_NOTE) },
    traced: [{ name: "KIRKBI A/S", country: "Denmark", registrationNumber: null, via: "accounts", foundAt: null, gleif: { status: "found", entity: kirkbi, parents: [], top: gleifTop(null, "NATURAL_PERSONS"), candidates: 1, error: null } }],
  };
  const owners = [{ name: "KIRKBI A/S", country: "Denmark", via: "accounts" as const }];
  const before = abroadStatus({ owners, abroad, records: [], chartReceived: false });
  assert.equal(before[0].needs, "the people behind it: from its own register or the client's structure chart");
  assert.deepEqual(before[0].found, ["Named in the accounts as its parent; the register names no owner", "GLEIF: in GLEIF as KIRKBI A/S, LEI 5493005XXPWUMR2E5305; at the top, owned or controlled by individuals; GLEIF does not name them"]);
  const records = [
    rec({ id: "r1", kind: "register_page", documentId: "k1", sourceUrl: "https://datacvr.virk.dk/enhed/virksomhed/18591235" }),
    rec({ id: "r2", kind: "person", ownerName: "Kirkbi A/S", person: { name: "Thomas Kirk Kristiansen", detail: "25–33% of the shares and 33–50% of the votes", nationality: "Danish", dob: null } }),
    rec({ id: "r3", kind: "note", ownerName: "Other Co A/S", note: "Not this company" }),
  ];
  const after = abroadStatus({ owners, abroad, records, chartReceived: false });
  assert.equal(after[0].needs, null);
  assert.deepEqual(after[0].people, ["Thomas Kirk Kristiansen"]);
  assert.equal(after[0].evidence, 1);
  assert.equal(recordsFor("KIRKBI A/S", records).length, 2);
  assert.equal(abroadStatus({ owners, abroad: null, records: [], chartReceived: true })[0].needs, "the people behind it, from the client's structure chart");
});

test("the client's chart: cleaned to what a chart can say, then set against what the app found", () => {
  const reading = cleanChartReading({ entities: [
    { name: "LEGO Company Limited", kind: "company", country: "United Kingdom", owns: [] },
    { name: "LEGO A/S", kind: "company", country: "Denmark", owns: [{ name: "LEGO Company Limited", percent: "100%" }] },
    { name: "KIRKBI A/S", kind: "company", country: "Denmark", owns: [{ name: "LEGO A/S", percent: "75%" }] },
    { name: "LEGO Foundation", kind: "foundation", country: "Denmark", owns: [{ name: "LEGO A/S", percent: "25%" }] },
    { name: "Thomas Kirk Kristiansen", kind: "person", country: "Denmark", owns: [] },
    { name: "", kind: "person" },
    { name: "KIRKBI A/S", kind: "company" },
    { name: "Strange", kind: "dragon" },
  ] }, "2026-11-21T12:00:00Z");
  assert.equal(reading.entities.length, 6);
  assert.equal(reading.entities[5].kind, "other");
  const found = [
    { name: "KIRKBI A/S", person: false, via: "the accounts" },
    { name: "LEGO A/S", person: false, via: "the accounts" },
    { name: "Thomas Kirk Kristiansen", person: true, via: "recorded behind KIRKBI A/S" },
    { name: "K2 Fonden af 2023", person: false, via: "recorded behind KIRKBI A/S" },
  ];
  const c = compareChart(reading.entities, found, "LEGO COMPANY LIMITED");
  assert.deepEqual(c.matched.map(m => m.found), ["LEGO A/S", "KIRKBI A/S", "Thomas Kirk Kristiansen"]);
  assert.deepEqual(c.chartOnly.map(x => x.name), ["LEGO Foundation", "Strange"]);
  assert.deepEqual(c.foundOnly.map(x => x.name), ["K2 Fonden af 2023"]);
});

test("sameCompany: the legal form counts, written either way", () => {
  assert.equal(sameCompany("LEGO A/S", "LEGO Company Limited"), false);
  assert.equal(sameCompany("Kirkbi A/S", "KIRKBI AS"), true);
  assert.equal(sameCompany("Bidco Ltd", "BIDCO LIMITED"), true);
  assert.equal(sameCompany("Zara Holding B.V.", "Zara Holding BV"), true);
  assert.equal(sameCompany("LEGO A/S", "LEGO System A/S"), false);
  assert.equal(strictCompanyKey("The Topco S.à r.l."), "topco sarl");
});
