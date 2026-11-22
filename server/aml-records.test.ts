// The AML items built on 19 November 2026 (Woody: "Go ahead and build"): the
// EU sanctions list, the Register of Overseas Entities, agents on HMRC's
// register, the AML register, training records and the five-year deletion.
// The rules; the source guards are qa/regression/aml-records-guards.test.mjs.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { delimitedRows, loadSanctionsList, loadedSanctionsLists, parseEuSanctionsCsv, screenName } from "./sanctions-screening";
import { odsRowCells, readRegisterRows } from "./hmrc-register";
import { storageKeyFromUrl } from "./aml-records-retention";
import {
  askInputFrom, isOverseasEntityNumber, looksOverseasName, overseasNameKey, pickOverseasEntity, precheckCardLines, precheckCompany, precheckNote,
  precheckRedFlags, precheckSanctionsMatch, precheckUnfinished, sanctionsListCode, sanctionsListName, type KycPrecheckResult,
} from "../shared/kyc-prechecks";
import { agentAmlState, agentSupervisionInput, firmKey, registerMatches, type AgentSupervision, type RegisterEntry } from "../shared/agent-aml";
import { damlDates, registerRaiseInput, registerStatusOf, registerUpdateInput, reporterView } from "../shared/aml-register";
import { CURRENT_POLICY_READ_TITLE, trainingInput, trainingKindWords, trainingStanding } from "../shared/aml-training";
import { dealRetention, parseRetentionItemId, partyRetention, retentionCutoff } from "../shared/aml-retention";

// ── The EU consolidated list ────────────────────────────────────────────────

const EU_HEADER = "fileGenerationDate;Entity_LogicalId;Entity_EU_ReferenceNumber;Entity_SubjectType_ClassificationCode;Entity_Regulation_Programme;Entity_DesignationDate;NameAlias_LastName;NameAlias_FirstName;NameAlias_MiddleName;NameAlias_WholeName;BirthDate_BirthDate;BirthDate_Year;Citizenship_CountryIso2Code;Citizenship_CountryDescription;Entity_Remark";

test("the EU list is read one row at a time, with quoted fields that hold semicolons and line breaks", () => {
  const rows = [...delimitedRows('﻿a;b;c\n1;"two; still two";3\r\n4;"five\nlines";6\n\n7;x "quoted" y;9', ";")];
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "two; still two", "3"], ["4", "five\nlines", "6"], ["7", 'x "quoted" y', "9"]]);
});

test("each EU entity's names become entries carrying all its birth dates and citizenships", () => {
  const csv = [
    EU_HEADER,
    '23/10/2026;13;EU.27.28;person;IRQ;2003-07-08;Hussein Al-Tikriti;Saddam;;Saddam Hussein Al-Tikriti;1937-04-28;1937;IQ;;"(UNSC RESOLUTION 1483); see annex"',
    "23/10/2026;13;EU.27.28;person;IRQ;2003-07-08;;;;Abu Ali;1937-04-28;1937;;Iraq;",
    "23/10/2026;13;EU.27.28;person;IRQ;2003-07-08;;;;Abu Ali;;;;;",
    "23/10/2026;99;EU.99.1;enterprise;RUS;2022-07-21;;;;Example Bank PJSC;;;;;",
  ].join("\n");
  const entries = parseEuSanctionsCsv(csv);
  assert.deepEqual(entries.map(e => e.name), ["Saddam Hussein Al-Tikriti", "Abu Ali", "Example Bank PJSC"]);
  const saddam = entries[0];
  assert.equal(saddam.source, "EU-FSF");
  assert.equal(saddam.designationType, "Individual");
  assert.equal(saddam.nameType, "Primary name");
  assert.equal(saddam.uniqueId, "EU.27.28");
  assert.equal(saddam.dob, "1937-04-28");
  assert.equal(saddam.nationality, "IQ, Iraq");
  assert.equal(entries[1].nameType, "alias");
  assert.equal(entries[2].designationType, "Entity");
  assert.equal(entries[2].regime, "RUS");
  assert.throws(() => parseEuSanctionsCsv(""), /empty/);
});

test("a list's code and name: the EU list is never named as the UK list", () => {
  assert.equal(sanctionsListCode("EU-FSF"), "EU");
  assert.equal(sanctionsListCode("US-OFAC"), "US");
  assert.equal(sanctionsListCode("UK-OFSI"), "UK");
  assert.equal(sanctionsListName("EU"), "EU consolidated list");
  assert.equal(sanctionsListName("US"), "US OFAC list");
  assert.equal(sanctionsListName("UK"), "UK Sanctions List");
});

// ── The Register of Overseas Entities ───────────────────────────────────────

test("an overseas entity is found only when exactly one of that name is on the register", () => {
  assert.ok(isOverseasEntityNumber("OE012345") && !isOverseasEntityNumber("12345678") && !isOverseasEntityNumber("FC012345"));
  const items = [
    { company_number: "OE012345", title: "ACME PROPERTY S.À R.L.", company_type: "registered-overseas-entity", company_status: "registered" },
    { company_number: "12345678", title: "ACME PROPERTY LIMITED", company_type: "ltd" },
    { company_number: "OE099999", title: "ACME PROPERTY HOLDINGS S.À R.L.", company_type: "registered-overseas-entity" },
  ];
  assert.deepEqual(pickOverseasEntity("Acme Property S.à r.l.", items).found, { number: "OE012345", name: "ACME PROPERTY S.À R.L.", status: "registered" });
  // The record without its legal form still finds it; never the Holdings company.
  assert.equal(pickOverseasEntity("Acme Property", items).found?.number, "OE012345");
  assert.equal(pickOverseasEntity("Acme", [{ company_number: "OE000001", title: "ACME SA" }, { company_number: "OE000002", title: "ACME LLC" }]).candidates, 2);
  assert.equal(overseasNameKey("Smith & Sons (Jersey) Limited"), overseasNameKey("SMITH AND SONS"));
});

test("a name reads as overseas only from a foreign legal form at its end", () => {
  for (const n of ["Hammerson SA", "Foo GmbH", "Bar B.V.", "Baz LLC", "Qux Inc.", "Quux Pte Ltd", "Corge (Jersey) Limited", "Acme S.à r.l.", "URW SE"]) assert.ok(looksOverseasName(n), n);
  for (const n of ["Tesco PLC", "Landsec Limited", "Waitrose & Partners", "Moss Bros AG Holdings Ltd", "The Ag Group", "Smith & Co"]) assert.ok(!looksOverseasName(n), n);
});

const precheck = (over: Partial<KycPrecheckResult> = {}): KycPrecheckResult => ({
  kind: "precheck", version: 1, ranAt: "2026-11-19T12:00:00.000Z",
  party: { companyId: "c1", name: "Acme Property SA", subjectKind: "company", contactName: null },
  companiesHouse: null, notAtCompaniesHouse: "No Companies House number on the record.",
  sanctions: { ran: true, lists: ["the UK Sanctions List", "the EU consolidated list"], lines: [], error: null },
  web: { ran: false, lines: [], skipped: "off" }, complyAdvantage: { ran: false, lines: [], skipped: "off" },
  errors: [], ...over,
});
const oeRegister = (owners: any[]): NonNullable<KycPrecheckResult["companiesHouse"]> => ({
  number: "OE012345", name: "ACME PROPERTY SA", status: "registered", type: "registered-overseas-entity", incorporatedOn: "2023-01-31",
  registeredOffice: "1 Rue Exemple, Luxembourg", jurisdiction: null, sicCodes: [], accountsOverdue: false, confirmationOverdue: false,
  lastAccountsMadeUpTo: null, lastAccountsType: null, hasInsolvencyHistory: false, insolvencyCases: 0, officers: [], owners,
  statements: [], listing: null, chain: [], peopleUpChain: [], offshoreOwners: [], disqualified: [], covenant: null, documents: [],
});

test("an overseas-looking company with no Overseas Entity ID found is a factor; a beneficial owner declared sanctioned is a red flag", () => {
  const missing = precheck({ overseasEntity: { searched: true, number: null, name: null, status: null, candidates: 0, looksOverseas: true, error: null } });
  const flags = precheckRedFlags(missing, { sanctionsCurrent: true });
  const roe = flags.find(f => f.kind === "overseas_entity_missing");
  assert.ok(roe && roe.factor === true && /Register of Overseas Entities/.test(roe.detail || ""));
  // A UK-looking name, or one found, raises nothing.
  assert.equal(precheckRedFlags(precheck({ overseasEntity: { searched: true, number: null, name: null, status: null, candidates: 0, looksOverseas: false, error: null } }), { sanctionsCurrent: true }).length, 0);
  assert.ok(precheckCardLines(missing).some(l => l.key === "overseas_entity" && l.state === "attention"));
  assert.match(precheckNote(missing, "done"), /- Register of Overseas Entities: no entity of this name\./);

  const owner = { name: "Ivan Example", kind: "individual" as const, controls: [], notifiedOn: null, sanctioned: true };
  const found = precheck({ companiesHouse: oeRegister([owner]), notAtCompaniesHouse: null, overseasEntity: { searched: true, number: "OE012345", name: "ACME PROPERTY SA", status: "registered", candidates: 1, looksOverseas: true, error: null } });
  const sanctioned = precheckRedFlags(found, { sanctionsCurrent: true }).find(f => f.key.startsWith("roe:sanctioned:"));
  assert.ok(sanctioned && sanctioned.kind === "sanctions" && !sanctioned.factor);
  assert.equal(precheckSanctionsMatch(found), true);
  // Its home register's extract is still asked for, and the facts say how it was found.
  assert.equal(askInputFrom(found)?.ukRegistered, false);
  assert.match(precheckCompany(found)?.overseasEntity || "", /found by its name/);
  assert.match(precheckCardLines(found)[0].label, /^Register of Overseas Entities: /);
  assert.match(precheckNote(found, "done"), /- Register of Overseas Entities: ACME PROPERTY SA \(OE012345\)[^\n]*please confirm it is the same company/);
});

test("a busy register during the overseas search leaves the check unfinished, to run again", () => {
  assert.match(precheckUnfinished(precheck({ errors: ["The Register of Overseas Entities: Companies House API error 503: busy"] })) || "", /Overseas/);
  assert.equal(precheckUnfinished(precheck({ errors: ["The Register of Overseas Entities: not found"] })), null);
});

// ── Agents on HMRC's register ───────────────────────────────────────────────

const entry = (over: Partial<RegisterEntry>): RegisterEntry => ({ number: "XJML00000138016", businessName: "Bruce Gillingham Pollard Limited", tradingName: "Bruce Gillingham Pollard Ltd", postcode: "W1T", status: "Approved", estateAgency: true, lettingAgency: false, since: null, ...over });

test("a firm is found on HMRC's register by its name, each registration once", () => {
  assert.equal(firmKey("The Knight Frank LLP"), firmKey("Knight Frank"));
  assert.equal(firmKey("Cushman & Wakefield"), "cushman and wakefield");
  const entries = [
    entry({}),
    entry({ number: "XNML00000197646", businessName: "Savills (Uk) Limited", tradingName: "Savills (Uk) Limited" }),
    entry({ number: "XNML00000197646", businessName: "Savills (Uk) Limited", tradingName: "Savills Mayfair", postcode: "W1K" }),
    entry({ number: "XSML00000195442", businessName: "Knight Frank Llp", tradingName: "Knight Frank Llp" }),
    entry({ number: "XQML00000000001", businessName: "Knight Frank Harrogate Limited", tradingName: "Knight Frank Harrogate" }),
  ];
  assert.deepEqual(registerMatches("Bruce Gillingham Pollard", entries).exact.map(e => e.number), ["XJML00000138016"]);
  assert.deepEqual(registerMatches("Savills", entries).exact.map(e => e.number), ["XNML00000197646"]);
  const kf = registerMatches("Knight Frank", entries);
  assert.deepEqual([kf.exact.map(e => e.number), kf.near.map(e => e.number)], [["XSML00000195442"], ["XQML00000000001"]]);
  assert.deepEqual(registerMatches("JLL", entries), { exact: [], near: [] });
});

const rec = (over: Partial<AgentSupervision>): AgentSupervision => ({
  companyId: "a1", status: "registered", registrationNumber: "XSML00000195442", registerName: "Knight Frank Llp", registerPostcode: "W1U", registerStatus: "Approved",
  supervisor: null, agreementInPlace: true, agreementNote: null, notes: null, checkedAt: "2026-11-01T10:00:00.000Z", checkedByName: "Woody", source: "register", registerDate: null, ...over,
});
const now = new Date("2026-11-19T12:00:00Z");

test("what the card says about an agent: required only for a joint agent BGP shares the fee with", () => {
  assert.deepEqual([agentAmlState({ role: "joint_agent", feeShared: true, record: null, now }).tone, agentAmlState({ role: "joint_agent", feeShared: true, record: null, now }).required], ["amber", true]);
  assert.equal(agentAmlState({ role: "vendor_agent", feeShared: false, record: null, now }).tone, "info");
  assert.equal(agentAmlState({ role: "joint_agent", feeShared: true, record: rec({}), now }).tone, "ok");
  assert.equal(agentAmlState({ role: "joint_agent", feeShared: true, record: rec({ agreementInPlace: null }), now }).tone, "amber");
  assert.equal(agentAmlState({ role: "joint_agent", feeShared: false, record: rec({ agreementInPlace: null }), now }).tone, "ok");
  assert.equal(agentAmlState({ role: "joint_agent", feeShared: true, record: rec({ checkedAt: "2025-09-01T10:00:00.000Z" }), now }).tone, "amber");
  assert.equal(agentAmlState({ role: "joint_agent", feeShared: true, record: rec({ registerStatus: "Applied" }), now }).tone, "amber");
  assert.equal(agentAmlState({ role: "joint_agent", feeShared: true, record: rec({ registerStatus: "Expired" }), now }).tone, "red");
  const not = agentAmlState({ role: "joint_agent", feeShared: true, record: rec({ status: "not_registered", registrationNumber: null }), now });
  assert.ok(not.tone === "red" && /reported to HMRC/.test(not.words));
});

test("a check is saved only when it says enough", () => {
  assert.equal(agentSupervisionInput({ status: "maybe" }).ok, false);
  assert.equal(agentSupervisionInput({ status: "registered" }).ok, false);
  assert.equal(agentSupervisionInput({ status: "not_registered", notes: "no" }).ok, false);
  assert.equal(agentSupervisionInput({ status: "other_supervisor" }).ok, false);
  const ok = agentSupervisionInput({ status: "registered", registrationNumber: "xjml00000138016", supervisor: "ignored", source: "register" });
  assert.ok(ok.ok && ok.value.registrationNumber === "XJML00000138016" && ok.value.supervisor === null && ok.value.source === "register");
});

test("HMRC's spreadsheet is read row by row, the blank runs expanded and only agency rows kept", async () => {
  assert.deepEqual(odsRowCells('<table:table-row><table:table-cell office:value-type="string"><text:p>A &amp; B</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"/><table:table-cell><text:p>x<text:s text:c="2"/>y</text:p></table:table-cell></table:table-row>', 6), ["A & B", "", "", "x y"]);
  const header = ["MLR Registration Number", "Business Start Date", "Business Name", "Agent Start Date", "Trading Name", "Postcode", "Estate Agency Business", "Letting Agency Businesses", "Status"];
  const row = (cells: string[]) => `<table:table-row>${cells.map(c => c ? `<table:table-cell office:value-type="string"><text:p>${c}</text:p></table:table-cell>` : "<table:table-cell/>").join("")}</table:table-row>`;
  const xml = `<office:document-content><table:table>${row(header)}${row(["XJML00000138016", "01/06/2002", "Bruce Gillingham Pollard Limited", "No Data", "Bruce Gillingham Pollard Ltd", "W1T", "Yes", "No Data", "Approved"])}${row(["12137104", "01/06/2002", "Post Office Limited", "", "Abbey Road", "FY4", "No Data", "No Data", "Approved"])}<table:table-row table:number-rows-repeated="99"><table:table-cell table:number-columns-repeated="9"/></table:table-row></table:table></office:document-content>`;
  // In awkward chunks, splitting rows and tags.
  async function* chunks() { for (let i = 0; i < xml.length; i += 37) yield xml.slice(i, i + 37); }
  const { entries, rows } = await readRegisterRows(chunks());
  assert.equal(rows, 2);
  assert.deepEqual(entries.map(e => [e.number, e.businessName, e.postcode, e.estateAgency, e.status]), [["XJML00000138016", "Bruce Gillingham Pollard Limited", "W1T", true, "Approved"]]);
});

// ── The AML register ────────────────────────────────────────────────────────

test("staff raise a suspicion, a sanctions concern or an unregistered agent; the officers raise any kind", () => {
  assert.equal(registerRaiseInput({ kind: "suspicion", concern: "too short" }, { officer: false }).ok, false);
  assert.equal(registerRaiseInput({ kind: "psc_discrepancy", concern: "The register lists a different owner from the client's." }, { officer: false }).ok, false);
  assert.equal(registerRaiseInput({ kind: "psc_discrepancy", concern: "The register lists a different owner from the client's." }, { officer: true }).ok, true);
  const s = registerRaiseInput({ kind: "nonsense", concern: "Cash offered for the deposit, from a third party abroad.", role: "landlord", dealId: "d1" }, { officer: false });
  assert.ok(s.ok && s.value.kind === "suspicion" && s.value.role === "landlord" && s.value.dealId === "d1");
});

test("an officer's record holds together: dates given, reasons given, legal advice before continuing, nothing in the future", () => {
  const today = "2026-11-19";
  assert.equal(registerUpdateInput({ status: "reported" }, "suspicion", today).ok, false);
  assert.equal(registerUpdateInput({ status: "no_report", reason: "fine" }, "suspicion", today).ok, false);
  assert.equal(registerUpdateInput({ status: "reported", reportedOn: "2026-11-20" }, "sanctions", today).ok, false);
  assert.equal(registerUpdateInput({ status: "open", details: { outcome: "continue" } }, "sanctions", today).ok, false);
  assert.equal(registerUpdateInput({ status: "open", details: { damlOutcome: "granted", damlRequestedOn: "2026-11-10" } }, "suspicion", today).ok, false);
  const ok = registerUpdateInput({ status: "reported", reportedOn: "2026-11-18", reference: "SAR-1", details: { damlRequestedOn: "2026-11-18", damlOutcome: "deemed", fundsHeld: "ignored here" } }, "suspicion", today);
  assert.ok(ok.ok && ok.value.details.damlOutcome === "deemed" && !("fundsHeld" in ok.value.details));
});

test("consent timings count seven working days, past weekends and bank holidays", () => {
  // Thursday 17 Dec 2026: Fri 18, Mon 21, Tue 22, Wed 23, Thu 24, (Fri 25, Mon 28 holidays) Tue 29, Wed 30.
  assert.equal(damlDates("2026-12-17", null, null).noticeEnds, "2026-12-30");
  assert.equal(damlDates("2026-11-19", null, null).noticeEnds, "2026-11-30");
  assert.equal(damlDates("2026-11-19", "refused", "2026-11-25").moratoriumEnds, "2026-12-25");
  assert.deepEqual(damlDates(null, null, null), { noticeEnds: null, moratoriumEnds: null });
});

test("the person who raised an entry sees that it reached the officers, never what they decided", () => {
  assert.equal(registerStatusOf("reported_nca"), "reported");
  assert.equal(registerStatusOf("reported_ch"), "reported");
  assert.equal(registerStatusOf("whatever"), "open");
  const view = reporterView({ id: 4, kind: "suspicion", concern: "x", created_at: "2026-11-19T10:00:00Z", status: "reported_nca" });
  assert.deepEqual(Object.keys(view).sort(), ["concern", "id", "kind", "kindWords", "raisedAt", "where"]);
  assert.equal(view.where, "Dealt with by the Nominated Officer");
});

// ── Training ────────────────────────────────────────────────────────────────

test("training is recorded with a date, what it covered and who did it", () => {
  const today = "2026-11-19";
  assert.equal(trainingInput({ title: "Refresher", trainedOn: "2026-11-20", topics: ["risks"], userIds: ["u1"] }, today).ok, false);
  assert.equal(trainingInput({ title: "Refresher", trainedOn: "2026-11-18", topics: ["nonsense"], userIds: ["u1"] }, today).ok, false);
  assert.equal(trainingInput({ title: "Refresher", trainedOn: "2026-11-18", topics: ["risks"], userIds: [] }, today).ok, false);
  const ok = trainingInput({ title: "Refresher", kind: "informal", trainedOn: "2026-11-18", topics: ["risks", "risks", "procedures"], userIds: ["u1", "u1", "u2"] }, today);
  assert.ok(ok.ok && ok.value.kind === "informal" && ok.value.topics.length === 2 && ok.value.userIds.length === 2);
  assert.equal(trainingKindWords("annual_refresh"), "Annual refresher");
});

test("someone with nothing in a year is due, and reading the current policy is its own record", () => {
  const n = new Date("2026-11-19T12:00:00Z");
  assert.deepEqual(trainingStanding([], n), { lastTrainedOn: null, due: true, readPolicy: false });
  assert.equal(trainingStanding([{ kind: "formal", title: "x", trainedOn: "2025-10-01" }], n).due, true);
  const s = trainingStanding([{ kind: "formal", title: "x", trainedOn: "2026-03-01" }, { kind: "policy_read", title: CURRENT_POLICY_READ_TITLE, trainedOn: "2026-11-19" }], n);
  assert.deepEqual(s, { lastTrainedOn: "2026-11-19", due: false, readPolicy: true });
});

// ── The five-year deletion ──────────────────────────────────────────────────

test("five years back, by London's date", () => {
  assert.equal(retentionCutoff(new Date("2026-11-19T12:00:00Z")), "2021-11-19");
  assert.equal(retentionCutoff(new Date("2028-02-29T12:00:00Z")), "2023-03-01");
});

test("a party is due only when its last check and its last deal are both over five years old", () => {
  const cut = "2021-11-19";
  const base = { liveDeals: 0, lastDealEndedAt: "2020-01-01", latestRecordAt: "2020-06-01", openRegisterEntries: 0 };
  assert.equal(partyRetention(base, cut).due, true);
  assert.equal(partyRetention({ ...base, liveDeals: 1 }, cut).due, false);
  assert.equal(partyRetention({ ...base, openRegisterEntries: 1 }, cut).due, false);
  assert.equal(partyRetention({ ...base, latestRecordAt: "2022-01-01" }, cut).due, false);
  assert.equal(partyRetention({ ...base, lastDealEndedAt: "2023-01-01" }, cut).due, false);
  assert.equal(partyRetention({ ...base, latestRecordAt: null }, cut).due, false);
  assert.equal(partyRetention({ ...base, lastDealEndedAt: null }, cut).due, true);
  assert.equal(dealRetention({ closed: false, endedAt: "2019-01-01" }, cut).due, false);
  assert.equal(dealRetention({ closed: true, endedAt: "2019-01-01" }, cut).due, true);
  assert.equal(dealRetention({ closed: true, endedAt: null }, cut).due, false);
});

test("only the tool's own items, and only the app's stored files", () => {
  assert.deepEqual(parseRetentionItemId("party:abc-123"), { category: "party", id: "abc-123" });
  assert.equal(parseRetentionItemId("users:1"), null);
  assert.equal(storageKeyFromUrl("/api/chat-media/kyc-1.pdf"), "chat-media/kyc-1.pdf");
  assert.equal(storageKeyFromUrl("https://chatbgp.app/api/chat-media/a%20b.pdf?x=1"), "chat-media/a b.pdf");
  assert.equal(storageKeyFromUrl("https://sharepoint.example/file.pdf"), null);
});

// ── A sanctions list that fails to download (22 November 2026) ──────────────
// After a restart on live the US list failed and a day's screening ran
// without it: a list that fails keeps the copy held before, and all three are
// tried again within 15 minutes.

test("a sanctions list that fails to download keeps its last copy and is tried again within 15 minutes", async () => {
  const UK_CSV = "Report Date: 22/11/2026\nUnique ID,Name 6,Name 1,Name 2,Name type,Regime Name,Designation Type,Sanctions Imposed,Nationality(/ies),D.O.B,Type of entity,Date Designated\nRUS0001,Testov,Ivan,,Primary Name,Russia,Individual,Asset freeze,Russia,01/01/1970,,01/01/2022\n";
  const OFAC_CSV = (name: string) => `1,"${name}","individual","SDGT","","","","","","","",""\n`;
  const EU_CSV = [EU_HEADER, "22/11/2026;99;EU.99.1;enterprise;RUS;2022-07-21;;;;Example Bank PJSC;;;;;"].join("\n");
  let ofac: string | null = null; // null: the US download fails
  let fetches = 0;
  const realFetch = globalThis.fetch, realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  globalThis.fetch = (async (url: any) => {
    fetches++;
    const u = String(url);
    if (/UK-Sanctions-List/i.test(u)) return new Response(UK_CSV, { status: 200 });
    if (/sdn\.csv/i.test(u)) return ofac === null ? new Response("busy", { status: 503 }) : new Response(ofac, { status: 200 });
    return new Response(EU_CSV, { status: 200 });
  }) as typeof fetch;
  try {
    await loadSanctionsList();
    assert.deepEqual(loadedSanctionsLists(), ["the UK Sanctions List", "the EU consolidated list"]);

    // Within 15 minutes nothing is downloaded again; after it, all three are.
    fetches = 0; now += 10 * 60_000;
    await loadSanctionsList();
    assert.equal(fetches, 0);
    ofac = OFAC_CSV("TESTER, Olga"); now += 6 * 60_000;
    await loadSanctionsList();
    assert.equal(fetches, 3);
    assert.deepEqual(loadedSanctionsLists(), ["the UK Sanctions List", "the US OFAC list", "the EU consolidated list"]);
    assert.ok(screenName("Olga Tester").length > 0);

    // A day on, the US download fails: its last copy is kept, and it is tried again soon.
    ofac = null; now += 25 * 3600_000;
    await loadSanctionsList();
    assert.deepEqual(loadedSanctionsLists(), ["the UK Sanctions List", "the US OFAC list", "the EU consolidated list"]);
    assert.ok(screenName("Olga Tester").length > 0);
    ofac = OFAC_CSV("NEWNAME, Petra"); fetches = 0; now += 16 * 60_000;
    await loadSanctionsList();
    assert.equal(fetches, 3);
    assert.ok(screenName("Petra Newname").length > 0);

    // Everything read: the next download is a day away.
    fetches = 0; now += 16 * 60_000;
    await loadSanctionsList();
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});
