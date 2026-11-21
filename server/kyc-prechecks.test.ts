// BGP's checks before asking (17 November 2026). Woody: "we need to do
// everyhting we can before we ask questions on someone"; he chose a web
// search with sources for public roles and adverse media, and to ask the
// client only what is left. The rules are shared/kyc-prechecks.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  askInputFrom, checkWebAnswer, chooseScreened, companyNamesMatch, controlWords, idCheckIsThePerson, isOffshoreCountry, isRegisterDirector, listingFromExemptions, verifiedPersonName,
  ownerControlLine, ownerKind, personNamesMatch, precheckAsks, precheckCardLines, precheckNamesakes, precheckNote, precheckRedFlags, providerMatchFlags,
  precheckSanctionsMatch, sanctionsLine, statementIsConcern, statementWords,
  type KycPrecheckResult, type ListEntry, type PrecheckAskInput,
  precheckCompany, precheckUnfinished,
} from "../shared/kyc-prechecks";
import { partyRedFlags } from "../shared/kyc-red-flags";
import { kycFinishedEmail, kycRequestEmail, kycSteps } from "../shared/kyc-request";

const TODAY = new Date("2026-11-17T12:00:00Z");

test("a listed company is read from Companies House's PSC exemptions, current ones only", () => {
  assert.deepEqual(listingFromExemptions({ exemptions: { psc_exempt_as_trading_on_uk_regulated_market: { items: [{ exempt_from: "2016-06-30" }] } } }, TODAY),
    { market: "uk_regulated", since: "2016-06-30" });
  assert.deepEqual(listingFromExemptions({ exemptions: { disclosure_transparency_rules_chapter_five_applies: { items: [{ exempt_from: "2017-01-01" }] } } }, TODAY),
    { market: "dtr5", since: "2017-01-01" });
  assert.deepEqual(listingFromExemptions({ exemptions: { psc_exempt_as_shares_admitted_on_market: { items: [{ exempt_from: "2018-03-01", exempt_to: "2030-01-01" }] } } }, TODAY),
    { market: "listed_market", since: "2018-03-01" });
  // A period that has ended (delisted) is not a listing.
  assert.equal(listingFromExemptions({ exemptions: { psc_exempt_as_trading_on_uk_regulated_market: { items: [{ exempt_from: "2016-06-30", exempt_to: "2020-05-01" }] } } }, TODAY), null);
  assert.equal(listingFromExemptions({}, TODAY), null);
  assert.equal(listingFromExemptions(null, TODAY), null);
});

test("owners and statements are put in words", () => {
  assert.equal(ownerKind("individual-person-with-significant-control"), "individual");
  assert.equal(ownerKind("corporate-entity-person-with-significant-control"), "company");
  assert.equal(ownerKind("legal-person-person-with-significant-control"), "legal_person");
  assert.equal(ownerKind("super-secure-person-with-significant-control"), "protected");
  assert.equal(controlWords("ownership-of-shares-75-to-100-percent"), "more than 75% of the shares");
  assert.equal(controlWords("voting-rights-25-to-50-percent-as-trust"), "more than 25% and up to 50% of the votes (as a trustee)");
  assert.equal(controlWords("right-to-appoint-and-remove-directors"), "can appoint or remove most of the directors");
  assert.equal(ownerControlLine({ controls: ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent"] }), "more than 75% of the shares; more than 75% of the votes");
  // Companies House spells "signficant" without the second i.
  assert.equal(statementWords("no-individual-or-entity-with-signficant-control"), "The company says no one has significant control over it");
  assert.equal(statementIsConcern("no-individual-or-entity-with-signficant-control"), false);
  assert.equal(statementIsConcern("psc-exists-but-not-identified"), true);
  assert.equal(statementIsConcern("psc-contacted-but-no-response-partnership"), true);
});

test("names match when one holds every word of the other, two words at least", () => {
  assert.equal(personNamesMatch("SMITH, John David", "John Smith"), true);
  assert.equal(personNamesMatch("Mohammad Ali Khan", "Mohammed Ali Khan"), true);
  assert.equal(personNamesMatch("J Smith", "John Smith"), false);
  assert.equal(personNamesMatch("John Smithson", "John Smith"), false);
  assert.equal(personNamesMatch("Smith", "Smith"), false);
  assert.equal(companyNamesMatch("ACME LIMITED", "Acme Ltd"), true);
  assert.equal(companyNamesMatch("Tesco", "Tesco Stores Limited"), false);
  assert.equal(companyNamesMatch("Bank Melli Iran", "BANK MELLI IRAN"), true);
  assert.equal(isRegisterDirector("Jane Doe", ["DOE, Jane Elizabeth", "SMITH, John"]), true);
  assert.equal(isRegisterDirector("Jane Doe", ["DOE, John"]), false);
  assert.equal(isRegisterDirector(null, ["DOE, Jane"]), false);
});

const entry = (over: Partial<ListEntry>): ListEntry => ({ name: "", source: "UK", regime: "Russia", designationType: "Individual", dob: "", nationality: "", ...over });

test("a sanctions name match is possible unless both dates of birth disagree", () => {
  const possible = sanctionsLine({ name: "PETROV, Ivan Sergeyevich", role: "director", person: true, dobYear: 1970 }, [entry({ name: "Ivan PETROV", dob: "12/03/1970" })]);
  assert.equal(possible.outcome, "possible");
  assert.match(possible.matches[0].why, /year of birth matches/);
  const noDob = sanctionsLine({ name: "Ivan Petrov", role: "director", person: true, dobYear: 1970 }, [entry({ name: "Ivan PETROV" })]);
  assert.equal(noDob.outcome, "possible");
  assert.match(noDob.matches[0].why, /no date of birth/);
  const discounted = sanctionsLine({ name: "Ivan Petrov", role: "director", person: true, dobYear: 1985 }, [entry({ name: "Ivan PETROV", dob: "00/00/1952" })]);
  assert.equal(discounted.outcome, "discounted");
  assert.match(discounted.matches[0].why, /1952.*1985/);
  // A listed company, ship or partial name is never a person's match.
  assert.equal(sanctionsLine({ name: "Ivan Petrov", role: "owner", person: true, dobYear: null }, [entry({ name: "Ivan Petrov", designationType: "Entity" })]).outcome, "clear");
  assert.equal(sanctionsLine({ name: "Ivan Petrov", role: "owner", person: true, dobYear: null }, [entry({ name: "Ivan Petrov", designationType: "Ship" })]).outcome, "clear");
  assert.equal(sanctionsLine({ name: "Ivan Petrovsky", role: "owner", person: true, dobYear: null }, [entry({ name: "Ivan Petrov" })]).outcome, "clear");
  const company = sanctionsLine({ name: "BANK MELLI IRAN LIMITED", role: "the company", person: false, dobYear: null }, [entry({ name: "Bank Melli Iran", designationType: "Entity", source: "US" })]);
  assert.equal(company.outcome, "possible");
  assert.equal(sanctionsLine({ name: "Ivan Petrov Ltd", role: "the company", person: false, dobYear: null }, [entry({ name: "Ivan Petrov" })]).outcome, "clear");
});

test("a web finding is kept only with a source the search actually read", () => {
  const cited = [{ url: "https://www.bbc.co.uk/news/123" }, { url: "https://www.gov.uk/government/people/x" }];
  const r = checkWebAnswer({
    publicRole: { status: "found", findings: [{ summary: "Minister for Trade until 2026", url: "https://www.gov.uk/government/people/x", source: "GOV.UK", sameIdentity: "likely" }] },
    adverseMedia: { status: "possible", findings: [
      { summary: "Charged with fraud", url: "https://made-up.example/story", source: "Nowhere" },
      { summary: "Fined by the FCA", url: "https://bbc.co.uk/news/123", sameIdentity: "unsure", category: "regulatory" },
    ] },
  }, cited);
  assert.equal(r.publicRole, "found");
  assert.equal(r.adverseMedia, "possible");
  assert.equal(r.findings.length, 2);
  assert.equal(r.findings[1].unsureIdentity, true);
  assert.equal(r.unsourced, 1);
  // Said but not sourced: nothing found, counted.
  const bare = checkWebAnswer({ publicRole: { status: "found", findings: [] }, adverseMedia: { status: "none_found", findings: [] } }, cited);
  assert.deepEqual([bare.publicRole, bare.adverseMedia, bare.findings.length, bare.unsourced], ["none_found", "none_found", 0, 1]);
  // No citations at all: nothing can be checked.
  const none = checkWebAnswer({ adverseMedia: { status: "found", findings: [{ summary: "Convicted", url: "https://bbc.co.uk/x" }] } }, []);
  assert.deepEqual([none.adverseMedia, none.findings.length, none.unsourced], ["none_found", 0, 1]);
  assert.deepEqual(checkWebAnswer("nonsense", cited), { publicRole: "none_found", adverseMedia: "none_found", findings: [], unsourced: 0 });
});

const input = (over: Partial<PrecheckAskInput> = {}): PrecheckAskInput => ({
  subjectKind: "company", ukRegistered: true, listing: null, owners: [], peopleUpChain: [], directors: [], accounts: null, ...over,
});

test("a listed company is not asked for an owners chart or owner IDs", () => {
  const asks = precheckAsks(input({ listing: { market: "uk_regulated", since: "2016-06-30", company: "BIG PLC", companyNumber: "00000001", viaParent: false } }),
    { kind: "company", role: "tenant", idCheck: true, contactName: null, today: TODAY });
  assert.deepEqual(asks.docs, ["proof_of_address", "authority", "source_of_funds"]);
  assert.deepEqual(asks.notAsked.map(n => n.key), ["ownership", "owner_ids"]);
  assert.match(asks.notAsked[0].reason, /UK regulated market.*since 2016-06-30.*reg 28\(5\)/);
  assert.equal(asks.confirmOwners, null);
  // Through a parent, and a market abroad: KYC4U to confirm the market.
  const viaParent = precheckAsks(input({ listing: { market: "listed_market", since: null, company: "BIG INC", companyNumber: "FC000001", viaParent: true } }),
    { kind: "company", role: "landlord", idCheck: true, contactName: null, today: TODAY });
  assert.deepEqual(viaParent.notAsked.map(n => n.key), ["ownership", "owner_ids"]);
  assert.match(viaParent.notAsked[0].reason, /Owned through one company at each level by BIG INC.*KYC4U to confirm/);
});

test("owners on the register are confirmed, not drawn; a director is not asked for authority", () => {
  const asks = precheckAsks(input({
    owners: [
      { name: "Jane DOE", kind: "individual", controls: ["ownership-of-shares-50-to-75-percent"], notifiedOn: null },
      { name: "HOLDCO LIMITED", kind: "company", controls: ["ownership-of-shares-25-to-50-percent"], notifiedOn: null },
    ],
    peopleUpChain: [{ name: "John SMITH", foundAt: "HOLDCO LIMITED", controls: [] }],
    directors: ["DOE, Jane"],
  }), { kind: "company", role: "landlord", idCheck: true, contactName: "Jane Doe", today: TODAY });
  // Each owner has a link of their own (19 November 2026): the one asked is an
  // owner, so only the other owner is named.
  assert.deepEqual(asks.docs, ["proof_of_address"]);
  assert.deepEqual(asks.notAsked.map(n => n.key), ["ownership", "owner_ids", "authority"]);
  assert.match(asks.notAsked[1].reason, /^Each owner gets a link of their own for their identity check and proof of address: John Smith\./);
  assert.deepEqual(asks.confirmOwners, [
    { name: "Jane DOE", detail: "more than 50% and up to 75% of the shares" },
    { name: "HOLDCO LIMITED", detail: "more than 25% and up to 50% of the shares" },
  ]);
  assert.deepEqual(asks.ownerNames, ["Jane DOE", "John SMITH"]);
  // Someone who is not a director still confirms their authority.
  assert.ok(precheckAsks(input({ directors: ["DOE, Jane"] }), { kind: "company", role: "landlord", idCheck: true, contactName: "Sam Lee", today: TODAY }).docs.includes("authority"));
});

test("a tenant company's recent accounts on file stand for where the money comes from", () => {
  const recent = input({ accounts: { madeUpTo: "2026-03-31", dormant: false } });
  const tenant = precheckAsks(recent, { kind: "company", role: "tenant", idCheck: true, contactName: null, today: TODAY });
  assert.ok(!tenant.docs.includes("source_of_funds"));
  assert.match(tenant.notAsked.find(n => n.key === "source_of_funds")!.reason, /2026-03-31/);
  // A buyer's money for a purchase is not shown by its accounts.
  assert.ok(precheckAsks(recent, { kind: "company", role: "purchaser", idCheck: true, contactName: null, today: TODAY }).docs.includes("source_of_funds"));
  assert.ok(precheckAsks(input({ accounts: { madeUpTo: "2026-03-31", dormant: true } }), { kind: "company", role: "tenant", idCheck: true, contactName: null, today: TODAY }).docs.includes("source_of_funds"));
  assert.ok(precheckAsks(input({ accounts: { madeUpTo: "2023-03-31", dormant: false } }), { kind: "company", role: "tenant", idCheck: true, contactName: null, today: TODAY }).docs.includes("source_of_funds"));
});

test("with nothing found, or for a private individual, the usual list is asked", () => {
  assert.deepEqual(precheckAsks(null, { kind: "company", role: "tenant", idCheck: true, contactName: null }).docs, ["proof_of_address", "ownership", "owner_ids", "authority", "source_of_funds"]);
  assert.deepEqual(precheckAsks(input({ subjectKind: "individual", ukRegistered: false }), { kind: "individual", role: "purchaser", idCheck: false, contactName: null }).docs, ["photo_id", "proof_of_address", "source_of_funds"]);
  // Not at Companies House: the overseas register extract is asked for.
  assert.ok(precheckAsks(input({ ukRegistered: false }), { kind: "company", role: "landlord", idCheck: true, contactName: null, today: TODAY }).docs.includes("company_documents"));
});

const result = (over: Partial<KycPrecheckResult> = {}): KycPrecheckResult => ({
  kind: "precheck", version: 1, ranAt: "2026-11-17T12:00:00.000Z",
  party: { companyId: "c1", name: "ACME LIMITED", subjectKind: "company", contactName: "Jane Doe" },
  companiesHouse: {
    number: "01234567", name: "ACME LIMITED", status: "active", type: "ltd", incorporatedOn: "2001-05-03", registeredOffice: "1 High St, London",
    jurisdiction: "england-wales", sicCodes: ["68209"], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: "2026-03-31",
    lastAccountsType: "full", hasInsolvencyHistory: false, insolvencyCases: 0,
    officers: [{ name: "DOE, Jane", role: "director", appointedOn: "2001-05-03", dob: { month: 3, year: 1970 }, nationality: "British" }],
    owners: [{ name: "Jane DOE", kind: "individual", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: "2016-06-30" }],
    statements: [], listing: null, chain: [], peopleUpChain: [], offshoreOwners: [], disqualified: [],
    covenant: { grade: "B", score: 72, flags: [], gazette: [] },
    documents: [
      { kind: "accounts", title: "ACME LIMITED accounts made up to 31 March 2026", filedOn: null, madeUpTo: "2026-03-31", kycDocumentId: "d1", error: null },
      { kind: "incorporation", title: "Certificate of incorporation", filedOn: null, madeUpTo: null, kycDocumentId: null, error: "none filed" },
    ],
  },
  notAtCompaniesHouse: null,
  sanctions: { ran: true, lists: ["the UK Sanctions List", "the US OFAC list"], lines: [{ name: "ACME LIMITED", role: "the company", outcome: "clear", matches: [] }], error: null },
  web: { ran: true, lines: [{ name: "Jane Doe", role: "the deal's contact", ran: true, publicRole: "none_found", adverseMedia: "none_found", findings: [], unsourced: 0 }], skipped: null },
  complyAdvantage: { ran: false, lines: [], skipped: "ComplyAdvantage refused BGP's login" },
  errors: [],
  ...over,
});

test("a clean run raises no red flags; findings raise them with their source", () => {
  assert.deepEqual(precheckRedFlags(result(), { sanctionsCurrent: true }), []);
  const ch = result().companiesHouse!;
  const flagged = result({
    companiesHouse: {
      ...ch, status: "liquidation", insolvencyCases: 1, hasInsolvencyHistory: true,
      statements: [{ statement: "psc-exists-but-not-identified", words: statementWords("psc-exists-but-not-identified"), concern: true, notifiedOn: "2026-01-01" }],
      offshoreOwners: [{ name: "SHELL CO", country: "British Virgin Islands" }],
      disqualified: [
        { officer: "DOE, Jane", match: "Jane DOE", dobMatches: true, url: "https://find-and-update.company-information.service.gov.uk/disqualified-officers/natural/x" },
        { officer: "DOE, Jane", match: "Jane Doe", dobMatches: false, url: null },
      ],
    },
    sanctions: { ran: true, lists: ["the UK Sanctions List"], lines: [{ name: "Jane DOE", role: "owner", outcome: "possible", matches: [{ ...entry({ name: "Jane DOE" }), why: "The name matches the listing." }] }], error: null },
    web: { ran: true, lines: [{ name: "Jane Doe", role: "owner", ran: true, publicRole: "found", adverseMedia: "none_found", unsourced: 0,
      findings: [{ kind: "public_role", summary: "Member of the Ruritanian parliament", url: "https://parliament.example/jane", source: "Parliament", date: null, category: null, unsureIdentity: false }] }], skipped: null },
  });
  const kinds = precheckRedFlags(flagged, { sanctionsCurrent: true }).map(f => f.kind);
  assert.deepEqual(kinds.sort(), ["company_status", "disqualified", "insolvency", "offshore_owner", "ownership_unclear", "sanctions", "web_pep"].sort());
  const pep = precheckRedFlags(flagged, { sanctionsCurrent: true }).find(f => f.kind === "web_pep")!;
  assert.match(pep.source, /parliament\.example\/jane/);
  assert.equal(pep.label, "Possible public role for Jane Doe");
  // A later screening replaces the run's sanctions lines.
  assert.ok(!precheckRedFlags(flagged, { sanctionsCurrent: false }).some(f => f.kind === "sanctions"));
});

test("the party's flags take the run's own sanctions lines in place of the general one", () => {
  const ch = result().companiesHouse!;
  const run = result({ sanctions: { ran: true, lists: ["the UK Sanctions List"], lines: [{ name: "Jane DOE", role: "owner", outcome: "possible", matches: [{ ...entry({ name: "Jane DOE" }), why: "The name matches the listing." }] }], error: null }, companiesHouse: ch });
  const flags = partyRedFlags({ company: null, latestInvestigation: { sanctions_match: true, conducted_at: run.ranAt, precheck: true }, precheck: { result: run, current: true }, requests: [], idChecks: [] });
  assert.equal(flags.filter(f => f.kind === "sanctions").length, 1);
  assert.match(flags[0].label, /Jane DOE/);
  // An older screening that is not a pre-check keeps the general line.
  const older = partyRedFlags({ company: null, latestInvestigation: { sanctions_match: true, conducted_at: run.ranAt }, requests: [], idChecks: [] });
  assert.equal(older[0].label, "Possible match on the UK Sanctions List");
  // The client saying the register's owners are wrong is a flag.
  const differ = partyRedFlags({ company: null, latestInvestigation: null, idChecks: [],
    requests: [{ ref: "7K2Q9M", answers: null, ownersAnswer: { answer: "no", detail: "Sold to Bob Ltd in October", answeredAt: "2026-11-17T10:00:00Z" } }] });
  assert.equal(differ[0].kind, "owners_differ");
  assert.equal(differ[0].detail, "Sold to Bob Ltd in October");
});

test("the sanctions column reads null when the lists could not be screened", () => {
  assert.equal(precheckSanctionsMatch(result()), false);
  assert.equal(precheckSanctionsMatch(result({ sanctions: { ran: false, lists: [], lines: [], error: "down" } })), null);
  assert.equal(precheckSanctionsMatch(result({ complyAdvantage: { ran: true, lines: [{ name: "Jane Doe", status: "possible", types: ["sanction"], detail: null }], skipped: null } })), true);
});

test("KYC4U's note says what was checked, and that a run was still going", () => {
  const note = precheckNote(result(), "done");
  assert.match(note, /^What BGP checked before asking \(17 Nov 2026\):/);
  assert.match(note, /Companies House: ACME LIMITED \(01234567\), active/);
  assert.match(note, /Owners on the register: Jane DOE \(more than 75% of the shares\)/);
  assert.match(note, /Downloaded from Companies House and attached: ACME LIMITED accounts made up to 31 March 2026\./);
  assert.match(note, /Sanctions: 1 names screened against the UK Sanctions List and the US OFAC list: no match/);
  assert.match(note, /web search with sources, 1 searched\): nothing found/);
  assert.match(note, /ComplyAdvantage: not used/);
  assert.match(precheckNote(null, "running"), /still running/);
  assert.equal(precheckNote(null, "none"), "");
  assert.ok(note.length <= 2800);
});

test("the deal card lists each check with its state", () => {
  const lines = precheckCardLines(result());
  assert.deepEqual(lines.map(l => [l.key, l.state]), [
    ["companies_house", "ok"], ["documents", "ok"], ["owners", "ok"], ["directors", "ok"], ["sanctions", "ok"], ["web", "ok"], ["comply_advantage", "not_run"],
  ]);
  assert.match(lines[1].detail!, /Not downloaded: certificate of incorporation \(none filed\)/);
  assert.equal(askInputFrom(result())!.accounts!.madeUpTo, "2026-03-31");
  assert.equal(askInputFrom(null), null);
});

test("offshore places are the secrecy and call-for-action ones", () => {
  assert.equal(isOffshoreCountry("British Virgin Islands"), true);
  assert.equal(isOffshoreCountry("Cayman Islands"), true);
  assert.equal(isOffshoreCountry("Iran"), true);
  assert.equal(isOffshoreCountry("Luxembourg"), false);
  assert.equal(isOffshoreCountry("England"), false);
  assert.equal(isOffshoreCountry(null), false);
});

test("the client is asked to confirm the owners before sending their IDs, by name", () => {
  const ctx = { needsIdCheck: true, docs: ["owner_ids" as const, "authority" as const], askPep: true, kind: "company" as const,
    confirmOwners: [{ name: "Jane DOE", detail: "more than 75% of the shares" }], ownerNames: ["Jane DOE", "John SMITH"] };
  const steps = kycSteps(ctx);
  assert.deepEqual(steps.map(s => s.title), ["A quick identity check", "Confirm who owns the company", "ID for each of those owners", "Confirmation you can act for the company", "One question about public roles"]);
  assert.match(steps[2].detail, /^For Jane DOE and John SMITH: a passport/);
  const email = kycRequestEmail({ ...ctx, recipientName: "Jane", partyName: "ACME LIMITED", dealName: "1 High St", ref: "7K2Q9M", link: "https://chatbgp.app/kyc-upload/x", expiresAt: TODAY, agents: [], sentFrom: "kyc@chatbgp.app" });
  assert.match(email.html, /Confirm who owns the company/);
  const finished = kycFinishedEmail({ recipientName: "Jane", partyName: "ACME LIMITED", dealName: "1 High St", ref: "7K2Q9M", dealLink: "https://chatbgp.app/deals/d1",
    idState: "approved", files: [], missing: [], sentFrom: "kyc@chatbgp.app", kind: "company",
    owners: { list: ctx.confirmOwners, reply: { answer: "no", detail: "Sold in October", answeredAt: "2026-11-17T10:00:00Z" } } });
  assert.match(finished.html, /Said the owners on the register are not right<\/strong>: Sold in October/);
  assert.match(finished.html, /report the difference to Companies House/);
});

// ── 19 November 2026: Woody on the AML box ─────────────────────────────────

test("a check Companies House was too busy for is not finished; a number it does not know is an answer", () => {
  const busy = result({ companiesHouse: null, notAtCompaniesHouse: "Companies House could not be read (Companies House API error 429:).", errors: ["Companies House: Companies House API error 429:"] });
  assert.match(precheckUnfinished(busy)!, /429/);
  const slow = result({ companiesHouse: null, notAtCompaniesHouse: "Companies House could not be read (Companies House took longer than 20 seconds)." });
  assert.ok(precheckUnfinished(slow));
  const unknown = result({ companiesHouse: null, notAtCompaniesHouse: "Companies House could not be read (Companies House API error 404: not found)." });
  assert.equal(precheckUnfinished(unknown), null);
  assert.equal(precheckUnfinished(result()), null);
  const finding = result({ companiesHouse: null, notAtCompaniesHouse: "No Companies House number on the record and none found for the name.", errors: ["Finding the company at Companies House: Companies House API error 429:"] });
  assert.match(precheckUnfinished(finding)!, /^Finding the company/);
});

test("the AML box shows what the register says about the company checked", () => {
  const c = precheckCompany(result())!;
  assert.equal(c.name, "ACME LIMITED");
  assert.equal(c.type, "Private limited company");
  assert.equal(c.status, "Active");
  assert.deepEqual(c.business, ["68209 Other letting and operating of own or leased real estate"]);
  assert.deepEqual(c.directors, ["DOE, Jane"]);
  assert.deepEqual(c.owners, [{ name: "Jane DOE", control: "more than 75% of the shares" }]);
  assert.equal(c.listing, null);
  assert.match(c.accounts!, /2026-03-31/);
  assert.deepEqual(c.documents.filter(d => d.onFile).map(d => d.title), ["ACME LIMITED accounts made up to 31 March 2026"]);
  assert.match(c.registerUrl, /\/company\/01234567$/);
  // A listed plc: no owners to identify, the company itself still verified.
  const ch = result().companiesHouse!;
  const plc = precheckCompany(result({ companiesHouse: { ...ch, type: "plc", owners: [], listing: { market: "uk_regulated", since: "2016-06-30", company: "ACME PLC", companyNumber: "01234567", viaParent: false } } }))!;
  assert.equal(plc.type, "Public limited company");
  assert.match(plc.listing!, /^Listed on a UK regulated market/);
  assert.match(plc.listingNote!, /reg 28\(5\)/);
  assert.match(plc.listingNote!, /simplified due diligence/);
  assert.equal(plc.ownerNote, null);
  assert.equal(precheckCompany(result({ companiesHouse: null })), null);
});

test("each flag from a check has a key that holds from one run to the next, and its evidence", () => {
  const ch = result().companiesHouse!;
  const run = (url: string) => result({
    companiesHouse: { ...ch, status: "liquidation" },
    web: { ran: true, lines: [{ name: "ACME LIMITED", role: "the company", ran: true, publicRole: "none_found", adverseMedia: "found", unsourced: 0,
      findings: [{ kind: "adverse_media", summary: "Fined by a regulator", url, source: "News", date: "2025-01-02", category: null, unsureIdentity: false }] }], skipped: null },
    complyAdvantage: { ran: true, skipped: null, lines: [{ name: "ACME LIMITED", status: "possible", types: ["adverse_media", "warning"], detail: null }] },
  });
  const a = precheckRedFlags(run("https://news.example/1"), { sanctionsCurrent: true });
  const b = precheckRedFlags(run("https://news.example/2"), { sanctionsCurrent: true });
  const web = (flags: typeof a) => flags.find(f => f.kind === "web_adverse")!;
  assert.equal(web(a).key, web(b).key);
  assert.deepEqual(web(a).evidence, ["url:https://news.example/1"]);
  assert.notDeepEqual(web(a).evidence, web(b).evidence);
  assert.ok(web(a).facts!.some(f => f.url === "https://news.example/1"));
  const ca = a.find(f => f.kind === "provider_screen")!;
  assert.equal(ca.key, "ca:acme limited");
  assert.deepEqual(ca.evidence, ["type:adverse_media", "type:warning"]);
  assert.equal(ca.detail, "adverse media, warning list");
  // An older check kept only the kinds: the facts say so.
  assert.ok(ca.facts!.some(f => /kept only the kinds/.test(f.value)));
  assert.equal(a.find(f => f.kind === "company_status")!.key, "ch:status");
});

test("ComplyAdvantage's matched profiles are the flag's facts and its evidence", () => {
  const flags = precheckRedFlags(result({
    complyAdvantage: { ran: true, skipped: null, lines: [{
      name: "ACME LIMITED", status: "possible", types: ["adverse_media"], detail: null, customerId: "bgp-c-1",
      matches: [{ name: "Acme Ltd", kind: "adverse_media", source: "Adverse media", score: 0.91, profileId: "P1", media: [{ title: "Acme fined", url: "https://news.example/acme", date: "2024-05-01" }] }],
    }] },
  }), { sanctionsCurrent: true });
  const ca = flags.find(f => f.kind === "provider_screen")!;
  assert.deepEqual(ca.evidence, ["profile:P1", "type:adverse_media"]);
  assert.ok(ca.facts!.some(f => /Acme Ltd/.test(f.value) && /91%/.test(f.value)));
  assert.ok(ca.facts!.some(f => f.label === "Article" && f.url === "https://news.example/acme"));
  assert.ok(ca.facts!.some(f => f.value === "bgp-c-1"));
});

// Woody, 19 November 2026 ("Tighten"): a bare-name match too often finds someone else of the same name.
const caLine = (name: string, matches: any[]) => ({ name, status: "possible" as const, types: [...new Set(matches.map(m => m.kind))], detail: null, matches });
const caMatch = (over: Record<string, any>) => ({ name: "Jane Doe", kind: "pep", source: null, score: null, profileId: "p1", media: [], ...over });

test("which ComplyAdvantage matches are red flags: sanctions always, the rest over the bars or on an agreeing birth year", () => {
  assert.equal(providerMatchFlags(caMatch({ kind: "sanctions", score: 0.1 })), true, "sanctions, whatever the score");
  assert.equal(providerMatchFlags(caMatch({ kind: "warning", score: null })), true, "a warning list, whatever the score");
  assert.equal(providerMatchFlags(caMatch({ kind: "pep", score: 0.59 })), false);
  assert.equal(providerMatchFlags(caMatch({ kind: "pep", score: 0.6 })), true, "60% for a public role");
  assert.equal(providerMatchFlags(caMatch({ kind: "adverse_media", score: 0.89 })), false);
  assert.equal(providerMatchFlags(caMatch({ kind: "adverse_media", score: 0.9 })), true, "90% for anything else");
  assert.equal(providerMatchFlags(caMatch({ kind: "fitness_probity", score: 0.75 })), false);
  assert.equal(providerMatchFlags(caMatch({ kind: "adverse_media", score: null })), false, "no score and no birth year: a possible namesake");
  assert.equal(providerMatchFlags(caMatch({ kind: "adverse_media", score: 0.2, birthYearAgrees: true })), true, "the birth year agrees");
  assert.equal(providerMatchFlags(caMatch({ kind: "pep", unread: true, profileId: null })), true, "profiles that could not be read stay a flag");
  assert.equal(providerMatchFlags(caMatch({ kind: "pep", profileId: null })), true, "an older match with no profile behind it");
});

// Woody, later on 19 November 2026: "comply advantage not picking up DOB which can get from companies house
// for everyone ... red flags for random people with similar names? whats the fix?" On deal #4491 the flags
// were 70% name matches ("rupert smith" for Rupert Bentley-Smith) with no date of birth on the profile.
test("a person screened with their date of birth is flagged only on a profile whose date of birth agrees", () => {
  const dated = { person: true, dobKnown: true };
  assert.equal(providerMatchFlags(caMatch({ kind: "pep", score: 0.7 }), dated), false, "a 70% name match with no date of birth: a possible namesake");
  assert.equal(providerMatchFlags(caMatch({ kind: "warning", score: 0.7 }), dated), false, "a warning list the same");
  assert.equal(providerMatchFlags(caMatch({ kind: "adverse_media", score: 1 }), dated), false, "even the whole name");
  assert.equal(providerMatchFlags(caMatch({ kind: "pep", score: 0.2, birthYearAgrees: true }), dated), true, "the date of birth agrees");
  assert.equal(providerMatchFlags(caMatch({ kind: "sanctions", score: 0.2 }), dated), true, "sanctions stay a red flag");
  assert.equal(providerMatchFlags(caMatch({ kind: "pep", unread: true, profileId: null }), dated), true, "profiles that could not be read stay a flag");
  // A person with no date of birth keeps the bars, a warning list at 90%.
  const undated = { person: true, dobKnown: false };
  assert.equal(providerMatchFlags(caMatch({ kind: "pep", score: 0.7 }), undated), true);
  assert.equal(providerMatchFlags(caMatch({ kind: "warning", score: 0.7 }), undated), false);
  assert.equal(providerMatchFlags(caMatch({ kind: "warning", score: 0.9 }), undated), true);
  // A company, and a check from before this change, keep the earlier rule.
  assert.equal(providerMatchFlags(caMatch({ kind: "warning", score: 0.2 }), { person: false, dobKnown: false }), true);
  assert.equal(providerMatchFlags(caMatch({ kind: "warning", score: 0.2 })), true);
  const run = result({ complyAdvantage: { ran: true, skipped: null, lines: [
    { ...caLine("BENTLEY-SMITH, Rupert", [caMatch({ name: "rupert smith", kind: "pep", score: 0.7, profileId: "p-rs" })]), ...dated },
    { ...caLine("Mr David Bruce", [caMatch({ name: "david g bruce", kind: "warning", score: 0.7, profileId: "p-db" }), caMatch({ name: "david bruce", kind: "adverse_media", score: 0.7, profileId: "p-db2", birthYearAgrees: true })]), ...dated },
  ] } });
  const labels = precheckRedFlags(run, { sanctionsCurrent: true }).map(f => f.label);
  assert.deepEqual(labels, ["ComplyAdvantage match for Mr David Bruce"], "only the profile whose date of birth agrees");
  const namesakes = precheckNamesakes(run);
  assert.equal(namesakes.length, 2);
  assert.match(namesakes[0].what, /no date of birth on the profile/);
});

test("whose identity check it was: the name Veriff read set against the person the request was for", () => {
  assert.equal(verifiedPersonName({ firstName: "WOODY", lastName: "BRUCE" }), "WOODY BRUCE");
  assert.equal(verifiedPersonName({ fullName: "Jane  Doe" }), "Jane Doe");
  assert.equal(verifiedPersonName(null), null);
  assert.equal(idCheckIsThePerson("jack Barrat", "WOODY BRUCE"), false);
  assert.equal(idCheckIsThePerson("jack Barrat", "JACK BARRATT"), true, "one letter out in a long word: a typo on the deal");
  assert.equal(idCheckIsThePerson("Charlotte Roberts", "CHARLOTTE CAROLINE ROBERTS"), true, "a middle name on the document");
  assert.equal(idCheckIsThePerson("Jack", "JACK BARRATT"), true, "a first name alone on the request");
  assert.equal(idCheckIsThePerson("Jack", "WOODY BRUCE"), false);
  assert.equal(idCheckIsThePerson(null, "WOODY BRUCE"), null);
  assert.equal(idCheckIsThePerson("jack Barrat", null), null, "no decision yet: not known");
});

test("who is screened for public roles and adverse media: the company and its beneficial owners", () => {
  const c = (name: string, role: string, person = true, owner = false) => ({ name, role, person, owner });
  const bgp = [
    c("BRUCE GILLINGHAM POLLARD LIMITED", "the company", false), c("jack Barrat", "the deal's contact"),
    c("Bgp Real Estate Limited", "owning company", false), c("Mr Woody Bruce", "owner of Thames Commercial Properties Limited, director", true, true),
    c("Mr Huseyn Mirhadiyev", "owner of Thames Commercial Properties Limited", true, true),
    c("BARRATT, Jack", "director"), c("ROBERTS, Charlotte Caroline", "director"), c("SMITH, Ann", "secretary"),
  ];
  const owners = chooseScreened(bgp, { individual: false, listed: false, maxPeople: 10 });
  assert.equal(owners.basis, "owners");
  assert.deepEqual(owners.full.map(s => s.name), ["BRUCE GILLINGHAM POLLARD LIMITED", "Mr Woody Bruce", "Mr Huseyn Mirhadiyev"]);
  assert.deepEqual(owners.sanctionsOnly.map(s => s.name), ["jack Barrat", "BARRATT, Jack", "ROBERTS, Charlotte Caroline", "SMITH, Ann"]);
  // No one to name as an owner: the directors stand in (reg 28(6)); a listed company has none to identify (reg 28(5)).
  const noOwners = bgp.filter(s => !s.owner);
  assert.equal(chooseScreened(noOwners, { individual: false, listed: false, maxPeople: 10 }).basis, "managers");
  assert.deepEqual(chooseScreened(noOwners, { individual: false, listed: false, maxPeople: 10 }).full.map(s => s.name), ["BRUCE GILLINGHAM POLLARD LIMITED", "BARRATT, Jack", "ROBERTS, Charlotte Caroline"]);
  const listed = chooseScreened(noOwners, { individual: false, listed: true, maxPeople: 10 });
  assert.equal(listed.basis, "listed");
  assert.deepEqual(listed.full.map(s => s.name), ["BRUCE GILLINGHAM POLLARD LIMITED"]);
  assert.equal(chooseScreened([c("ACME LIMITED", "the company", false)], { individual: false, listed: false, maxPeople: 10 }).basis, "company");
  const person = chooseScreened([c("Jane Doe", "the party"), c("John Roe", "the deal's contact")], { individual: true, listed: false, maxPeople: 10 });
  assert.deepEqual([person.basis, person.full.map(s => s.name), person.sanctionsOnly.map(s => s.name)], ["individual", ["Jane Doe"], ["John Roe"]]);
  // The card and KYC4U's note say who was screened and who for sanctions only.
  const run = result({ screened: { basis: "owners", people: ["Mr Woody Bruce"], sanctionsOnly: ["BARRATT, Jack"] } });
  const line = precheckCardLines(run).find(l => l.key === "who_screened")!;
  assert.equal(line.label, "Screened for public roles and adverse media: Mr Woody Bruce");
  assert.match(line.detail!, /beneficial owners.*Sanctions lists only: BARRATT, Jack\./);
  assert.match(precheckNote(run, "done"), /Screened for public roles and adverse media \(ComplyAdvantage and a web search\): the company and the people who own or control it/);
});

test("possible namesakes are listed on the card and in KYC4U's note, never as red flags", () => {
  const run = result({
    complyAdvantage: { ran: true, skipped: null, lines: [
      caLine("BARRATT, Jack", [caMatch({ name: "Jack Barratt", kind: "adverse_media", score: null, profileId: "p-jb" })]),
      caLine("ROBERTS, Charlotte", [caMatch({ name: "Charlotte Roberts", kind: "pep", score: 0.92, profileId: "p-cr" })]),
      { name: "Old Line", status: "possible", types: ["pep"], detail: null },
    ] },
    web: { ran: true, skipped: null, lines: [
      { name: "BARRATT, Jack", role: "director", person: true, ran: true, publicRole: "none_found", adverseMedia: "possible", unsourced: 0,
        findings: [{ kind: "adverse_media", summary: "A footballer of the same name was banned", url: "https://news.example/jb", source: "News", date: null, category: null, unsureIdentity: true }] },
    ] },
  });
  const flags = precheckRedFlags(run, { sanctionsCurrent: true });
  const labels = flags.map(f => f.label);
  assert.ok(labels.includes("ComplyAdvantage match for ROBERTS, Charlotte"), "a public role at 92%");
  assert.ok(labels.includes("ComplyAdvantage match for Old Line"), "an older check kept only the kinds: still a flag");
  assert.ok(!labels.some(l => /BARRATT/.test(l)), "a namesake is never a red flag");
  const namesakes = precheckNamesakes(run);
  assert.deepEqual(namesakes.map(n => [n.name, n.via]), [["BARRATT, Jack", "ComplyAdvantage"], ["BARRATT, Jack", "web search"]]);
  assert.match(namesakes[0].what, /adverse media, profile "Jack Barratt", no match score/);
  const card = precheckCardLines(run).find(l => l.key === "namesakes")!;
  assert.equal(card.label, "Possible namesakes to check: 2");
  assert.equal(card.state, "info");
  assert.deepEqual(card.links.map(l => l.url), ["https://news.example/jb"]);
  const ca = precheckCardLines(run).find(l => l.key === "comply_advantage")!;
  assert.equal(ca.label, "ComplyAdvantage: 2 to review");
  assert.match(precheckNote(run, "done"), /Possible namesakes, not treated as red flags/);
});

test("web results: one flag per person and kind with every source, and a company's public role worded as ownership", () => {
  const f = (summary: string, url: string, unsureIdentity = false) => ({ kind: "public_role" as const, summary, url, source: "Site", date: null, category: null, unsureIdentity });
  const run = result({
    web: { ran: true, skipped: null, lines: [
      { name: "BRUCE GILLINGHAM POLLARD LIMITED", role: "the company", person: false, ran: true, publicRole: "possible", adverseMedia: "none_found", unsourced: 0,
        findings: [f("Advises a public body", "https://a.example/1"), f("Listed with a council", "https://b.example/2")] },
      { name: "Acme Holdings Limited", role: "the company", ran: true, publicRole: "possible", adverseMedia: "none_found", unsourced: 0,
        findings: [f("A state fund holds shares", "https://c.example/3")] },
    ] },
  });
  const web = precheckRedFlags(run, { sanctionsCurrent: true }).filter(x => x.kind === "web_pep");
  assert.equal(web.length, 2, "one flag for the two sources about the same company");
  assert.equal(web[0].label, "Possibly owned or controlled by the state or a public figure: BRUCE GILLINGHAM POLLARD LIMITED");
  assert.deepEqual(web[0].evidence, ["url:https://a.example/1", "url:https://b.example/2"]);
  assert.equal(web[0].facts.filter(x => x.label === "Source").length, 2);
  assert.match(web[1].label, /^Possibly owned or controlled by the state or a public figure: Acme Holdings Limited$/, "an older line is read from the name");
});

// Owners behind a company registered abroad (Woody, 20 November 2026, on
// Tureddi Group Limited, owned 75%+ by a Monaco société civile: "the app hasn't
// flagged this as an issue but the holding company for this business is in
// Monaco..? What do you think?").
test("a company registered abroad that owns the party: asked for, not stood in for, and Monaco flagged", async () => {
  const { ownerRegister, ownersAbroadOf, offshoreOwnersOf } = await import("../shared/kyc-prechecks");
  const { kycDocDetail } = await import("../shared/kyc-request");
  for (const uk of ["England", "United Kingdom", "England And Wales", "Scotland", "Companies House", "Registrar Of Companies For England And Wales", "UK"]) assert.equal(ownerRegister(uk), "uk", uk);
  for (const abroad of ["Monaco", "Registre Du Commerce Et De L'Industrie, Monaco", "Jersey", "Isle Of Man", "Luxembourg", "Delaware, United States", "New South Wales"]) assert.equal(ownerRegister(abroad), "abroad", abroad);
  assert.equal(ownerRegister(""), null);
  assert.equal(ownerRegister("Registrar of Companies"), null, "could be either");

  const ch = result().companiesHouse!;
  const tureddi = result({
    party: { companyId: "c1", name: "TUREDDI GROUP LIMITED", subjectKind: "company", contactName: null },
    companiesHouse: {
      ...ch, number: "15210693", name: "TUREDDI GROUP LIMITED",
      officers: ["A, One", "B, Two", "C, Three", "D, Four"].map(n => ({ name: n, role: "director", appointedOn: null, dob: { month: 1, year: 1980 }, nationality: "Italian" })),
      owners: [{ name: "Scp Aaa Invest", kind: "company", controls: ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent"], notifiedOn: "2023-10-20", country: "Monaco", registrationNumber: "25sc38568" }],
      // An older check, stored before the flag existed.
      offshoreOwners: [],
    },
  });
  assert.deepEqual(ownersAbroadOf(tureddi.companiesHouse).map(o => [o.name, o.country]), [["Scp Aaa Invest", "Monaco"]]);
  const flags = precheckRedFlags(tureddi, { sanctionsCurrent: true });
  const monaco = flags.find(f => f.kind === "offshore_owner");
  assert.ok(monaco, "the stored check is flagged on read, with no new run");
  assert.equal(monaco!.label, "Owned through Scp Aaa Invest, registered in Monaco");
  assert.match(monaco!.detail || "", /grey list.*EU's list of high-risk third countries/);
  assert.equal(offshoreOwnersOf(tureddi.companiesHouse).length, 1);
  // A UK owner is not abroad, and not flagged.
  const ukOwned = result({ companiesHouse: { ...ch, owners: [{ name: "HOLDCO LIMITED", kind: "company", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: null, country: "England", registrationNumber: "01234568" }] } });
  assert.deepEqual(ownersAbroadOf(ukOwned.companiesHouse), []);
  assert.equal(precheckRedFlags(ukOwned, { sanctionsCurrent: true }).filter(f => f.kind === "offshore_owner").length, 0);
  // Jersey is abroad (the client is asked) but not a red flag by itself.
  const jersey = result({ companiesHouse: { ...ch, owners: [{ name: "ISLAND HOLDINGS LIMITED", kind: "company", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: null, country: "Jersey", registrationNumber: "123456" }] } });
  assert.equal(ownersAbroadOf(jersey.companiesHouse).length, 1);
  assert.equal(precheckRedFlags(jersey, { sanctionsCurrent: true }).filter(f => f.kind === "offshore_owner").length, 0);

  // The structure chart and the owners' IDs are still asked for, naming the company abroad.
  const asks = precheckAsks(askInputFrom(tureddi), { kind: "company", role: "tenant", idCheck: true, contactName: null, today: TODAY });
  assert.ok(asks.docs.includes("ownership") && asks.docs.includes("owner_ids"), "not dropped: the register does not name the people");
  assert.deepEqual(asks.ownersAbroad, [{ name: "Scp Aaa Invest", country: "Monaco" }]);
  assert.match(kycDocDetail("ownership", [], asks.ownersAbroad), /Companies House shows Scp Aaa Invest \(Monaco\) owns the company.*register/);
  // The card says so, and KYC4U's note.
  assert.equal(precheckCardLines(tureddi).find(l => l.key === "owners")?.state, "attention");
  assert.match(precheckNote(tureddi, "done"), /Owned through a company registered abroad: Scp Aaa Invest \(Monaco\)/);

  // Screening: the company abroad in full; the directors meanwhile, and the basis says why (not reg 28(6)).
  const screen = chooseScreened([
    { name: "TUREDDI GROUP LIMITED", role: "the company", person: false },
    { name: "Scp Aaa Invest", role: "owning company", person: false, abroad: true },
    { name: "A, One", role: "director", person: true },
  ], { individual: false, listed: false, maxPeople: 10 });
  assert.equal(screen.basis, "owners_abroad");
  assert.deepEqual(screen.full.map(c => c.name), ["TUREDDI GROUP LIMITED", "Scp Aaa Invest", "A, One"]);
});

// ── Identity verification at Companies House, trading status, owners abroad (21 November 2026)

test("identity verification at Companies House is read from the register's details", async () => {
  const { idvOf, idvState } = await import("../shared/kyc-prechecks");
  assert.equal(idvOf(undefined), null);
  assert.equal(idvOf({}), null);
  assert.deepEqual(idvOf({ identity_verified_on: "2025-12-03", appointment_verification_start_on: "2025-12-04" }),
    { verifiedOn: "2025-12-03", statementOn: "2025-12-04", dueOn: null, endedOn: null });
  const today = new Date("2026-11-21T12:00:00Z");
  assert.equal(idvState({ verifiedOn: "2025-12-03", statementOn: null, dueOn: null, endedOn: null }, today).state, "verified");
  // A statement supplied and not removed reads as verified (most verified appointments carry no identity_verified_on).
  assert.equal(idvState({ verifiedOn: null, statementOn: "2026-02-01", dueOn: null, endedOn: null }, today).state, "verified");
  assert.equal(idvState({ verifiedOn: null, statementOn: "2026-02-01", dueOn: null, endedOn: "2026-03-01" }, today).state, "not_shown");
  assert.deepEqual(idvState({ verifiedOn: null, statementOn: null, dueOn: "2026-12-12", endedOn: null }, today),
    { state: "due", words: "identity verification due at Companies House by 12 Dec 2026" });
  assert.equal(idvState({ verifiedOn: null, statementOn: null, dueOn: "2026-11-01", endedOn: null }, today).state, "overdue");
  assert.equal(idvState(null, today).state, "not_shown");
});

test("the company summary lists each director's and owner's verification, and an overdue one is a warning", async () => {
  const { precheckIdentity } = await import("../shared/kyc-prechecks");
  const ch = result().companiesHouse!;
  const withIdv = result({ companiesHouse: {
    ...ch,
    officers: [
      { ...ch.officers[0], idv: { verifiedOn: null, statementOn: "2026-01-10", dueOn: null, endedOn: null } },
      { name: "ROE, Richard", role: "director", appointedOn: "2010-01-01", dob: null, nationality: "British", idv: { verifiedOn: null, statementOn: null, dueOn: "2026-01-01", endedOn: null } },
    ],
    owners: [{ ...ch.owners[0], idv: null }],
  } });
  const identity = precheckIdentity(withIdv.companiesHouse, new Date("2026-11-21T12:00:00Z"));
  assert.deepEqual(identity.map(i => [i.name, i.state]), [["DOE, Jane", "verified"], ["ROE, Richard", "overdue"]], "Jane Doe the owner is the director already listed");
  const c = precheckCompany(withIdv)!;
  assert.ok(c.warnings.some(w => /Identity verification overdue at Companies House: ROE, Richard/.test(w)));
  assert.ok(precheckCardLines(withIdv).some(l => l.key === "identity_verification" && l.state === "attention"));
  assert.match(precheckNote(withIdv, "done"), /Identity verification at Companies House: DOE, Jane, identity verified/);
  // A check from before this was read says nothing about it.
  assert.equal(precheckIdentity(result().companiesHouse).length, 0);
  assert.ok(!precheckCardLines(result()).some(l => l.key === "identity_verification"));
});

test("a dormant, non-trading or newly formed company is a warning to weigh", async () => {
  const { tradingState } = await import("../shared/kyc-prechecks");
  const { policyFactorsToWeigh } = await import("../shared/aml-policy");
  const ch = result().companiesHouse!;
  const today = new Date("2026-11-21T12:00:00Z");
  assert.deepEqual(tradingState(ch, today), { trading: true, kind: null, words: null });
  assert.equal(tradingState({ ...ch, lastAccountsType: "dormant" }, today).kind, "dormant");
  assert.equal(tradingState({ ...ch, sicCodes: ["99999"] }, today).kind, "dormant");
  assert.equal(tradingState({ ...ch, sicCodes: ["74990"] }, today).kind, "non_trading");
  const fresh = tradingState({ ...ch, incorporatedOn: "2026-06-01", lastAccountsMadeUpTo: null, lastAccountsType: null }, today);
  assert.equal(fresh.kind, "new");
  assert.match(fresh.words!, /incorporated on 2026-06-01, no accounts filed yet/);
  assert.equal(tradingState({ ...ch, incorporatedOn: "2020-06-01", lastAccountsMadeUpTo: null, lastAccountsType: null }, today).kind, null, "an old company with no accounts read is not called new");
  const dormant = result({ companiesHouse: { ...ch, lastAccountsType: "dormant" } });
  assert.ok(precheckCompany(dormant)!.warnings.some(w => /^Dormant: its latest accounts/.test(w)));
  assert.ok(precheckCardLines(dormant).some(l => l.key === "trading" && l.state === "attention"));
  assert.ok(policyFactorsToWeigh({ precheck: dormant }).some(w => /^Dormant/.test(w)));
  assert.deepEqual(precheckRedFlags(dormant, { sanctionsCurrent: true }), [], "a warning, never a red flag");
});

test("a company owned through one registered abroad goes to KYC4U", () => {
  const ch = result().companiesHouse!;
  const abroad = result({ companiesHouse: { ...ch, owners: [{ name: "EXAMPLE HOLDING A/S", kind: "company", controls: ["ownership-of-shares-75-to-100-percent"], notifiedOn: "2016-06-30", country: "Denmark" }] } });
  assert.deepEqual(precheckCompany(abroad)!.ownersAbroad, [{ name: "EXAMPLE HOLDING A/S", country: "Denmark", foundAt: null }]);
  assert.match(precheckNote(abroad, "done"), /BGP does not read foreign registers: please identify the beneficial owners behind it/);
  assert.match(precheckCardLines(abroad).find(l => l.key === "owners")!.detail || "", /It goes to KYC4U to find the people behind it/);
  assert.deepEqual(precheckCompany(result())!.ownersAbroad, []);
});
