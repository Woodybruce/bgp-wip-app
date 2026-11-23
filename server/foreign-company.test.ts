// Companies registered abroad, all in the app (Woody, 23 November 2026:
// "No external ... to all happen in the app including translation").
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  REGISTER_EXTRACT_MAX_DAYS, abroadCompanyInput, checkRegisterExtract, needsRegisterExtract, registerLink, registerStatusClosed, registrationNumberKey,
} from "../shared/foreign-company";
import { checkKycDocument, cleanKycDocumentReading, type KycDocumentReading } from "../shared/kyc-documents";
import { registerExtractDenial, signOffDenial, type SignOffFacts } from "../shared/party-kyc";
import { amlStillNeeded } from "../shared/aml-file";
import { TRANSLATION_NOTE, cleanTranslation, translateFile } from "./kyc-translation";

test("a company registered abroad typed as the one that signs", () => {
  const ok = abroadCompanyInput({ brandId: "b1", abroad: { name: " Acme  Immobilien GmbH ", country: "Germany", registrationNumber: "HRB 123456", registerUrl: "https://www.handelsregister.de/x" } });
  assert.deepEqual(ok, { brandId: "b1", abroad: { name: "Acme Immobilien GmbH", country: "Germany", registrationNumber: "HRB 123456", registerUrl: "https://www.handelsregister.de/x" } });
  assert.deepEqual(abroadCompanyInput({ brandId: "b1", abroad: { name: "Acme S.à r.l.", country: "Luxembourg" } }), { brandId: "b1", abroad: { name: "Acme S.à r.l.", country: "Luxembourg", registrationNumber: null, registerUrl: null } });
  assert.match((abroadCompanyInput({ abroad: { name: "Acme", country: "Germany" } }) as any).problem, /landlord or brand/);
  assert.match((abroadCompanyInput({ brandId: "b1", abroad: { name: "Acme Ltd", country: "United Kingdom" } }) as any).problem, /Companies House/);
  assert.match((abroadCompanyInput({ brandId: "b1", abroad: { name: "Acme Ltd", country: "England" } }) as any).problem, /Companies House/);
  assert.match((abroadCompanyInput({ brandId: "b1", abroad: { name: "A", country: "France" } }) as any).problem, /name/);
  assert.match((abroadCompanyInput({ brandId: "b1", abroad: { name: "Acme SA", country: "" } }) as any).problem, /country/);
  assert.match((abroadCompanyInput({ brandId: "b1", abroad: { name: "Acme SA", country: "France", registrationNumber: "<script>" } }) as any).problem, /registration number/);
  assert.match((abroadCompanyInput({ brandId: "b1", abroad: { name: "Acme SA", country: "France", registerUrl: "http://example.com" } }) as any).problem, /https/);
  assert.equal(registerLink("javascript:alert(1)"), null);
  assert.equal(registerLink("https://kvk.nl/x"), "https://kvk.nl/x");
});

test("a register number as one key", () => {
  assert.equal(registrationNumberKey("HRB 123 456"), "HRB123456");
  assert.equal(registrationNumberKey("B 123.456"), "B123456");
  assert.equal(registrationNumberKey(null), "");
});

const reading = (over: Partial<KycDocumentReading> = {}): KycDocumentReading => ({
  ...cleanKycDocumentReading({ kind: "register_extract", names: [], certified: false, language: "German", english: false }, "2026-11-20T10:00:00Z"),
  company: { name: "ACME IMMOBILIEN GMBH", registrationNumber: "HRB 123456", legalForm: "GmbH", country: "Germany", register: "Handelsregister München", address: null, status: "active", incorporated: "2015-02-01", extractDate: "2026-11-01" },
  directors: [{ name: "Max Mustermann", role: "managing director", born: "1970-05" }],
  owners: [{ name: "Erika Mustermann", person: true, share: "100%", country: "Germany" }],
  ...over,
});
const subject = { name: "Acme Immobilien GmbH", registrationNumber: "HRB 123456", country: "Germany" };

test("an extract is checked against the company it should be about", () => {
  const ok = checkRegisterExtract(reading(), subject, { uploadedAt: "2026-11-20T10:00:00Z" });
  assert.equal(ok.ok, true);
  assert.equal(ok.sameCompany, true);
  assert.match(ok.summary, /ACME IMMOBILIEN GMBH, HRB 123456, dated 1 Nov 2026, in German, 1 director, 1 owner/);
  // The legal form aside: "Acme Immobilien" is the same company; the number alone is enough.
  assert.equal(checkRegisterExtract(reading(), { name: "Acme Immobilien" }, { uploadedAt: "2026-11-20T10:00:00Z" }).sameCompany, true);
  assert.equal(checkRegisterExtract(reading({ company: { ...reading().company!, name: "Something Else GmbH" } }), subject, { uploadedAt: "2026-11-20T10:00:00Z" }).sameCompany, true);
  // A different number is never the same company, whatever the name.
  const other = checkRegisterExtract(reading({ company: { ...reading().company!, registrationNumber: "HRB 999" } }), subject, { uploadedAt: "2026-11-20T10:00:00Z" });
  assert.equal(other.ok, false);
  assert.match(other.reasons[0], /HRB 999, not HRB 123456/);
  const stranger = checkRegisterExtract(reading({ company: { ...reading().company!, name: "Beta SARL", registrationNumber: null } }), subject, { uploadedAt: "2026-11-20T10:00:00Z" });
  assert.match(stranger.reasons[0], /It is about Beta SARL, not Acme Immobilien GmbH/);
});

test("an extract must be recent and the company not closed", () => {
  const old = checkRegisterExtract(reading({ company: { ...reading().company!, extractDate: "2026-07-01" } }), subject, { uploadedAt: "2026-11-20T10:00:00Z" });
  assert.equal(old.ok, false);
  assert.match(old.reasons.join(" "), /more than three months old/);
  assert.ok(REGISTER_EXTRACT_MAX_DAYS >= 90);
  assert.match(checkRegisterExtract(reading({ company: { ...reading().company!, extractDate: "2026-12-30" } }), subject, { uploadedAt: "2026-11-20T10:00:00Z" }).reasons.join(" "), /after it was uploaded/);
  assert.match(checkRegisterExtract(reading({ company: { ...reading().company!, extractDate: null }, date: null, issued: null }), subject, { uploadedAt: "2026-11-20T10:00:00Z" }).reasons.join(" "), /No date found/);
  assert.match(checkRegisterExtract(reading({ company: { ...reading().company!, status: "in liquidation" } }), subject, { uploadedAt: "2026-11-20T10:00:00Z" }).reasons.join(" "), /in liquidation/);
  assert.equal(registerStatusClosed("dissolved"), true);
  assert.equal(registerStatusClosed("active"), false);
  assert.equal(checkRegisterExtract(null, subject, { uploadedAt: "2026-11-20T10:00:00Z" }).ok, false);
});

test("the upload check uses the extract rule when it knows the company", () => {
  const check = checkKycDocument(reading(), [], { uploadedAt: "2026-11-20T10:00:00Z", seenOriginal: false, today: new Date("2026-11-20"), company: subject });
  assert.equal(check.use, "company");
  assert.equal(check.ok, true);
  const bad = checkKycDocument(reading({ company: { ...reading().company!, extractDate: "2025-01-01" } }), [], { uploadedAt: "2026-11-20T10:00:00Z", seenOriginal: false, today: new Date("2026-11-20"), company: subject });
  assert.equal(bad.ok, false);
  // Without a company to check against, a company document is kept as before.
  assert.equal(checkKycDocument(reading(), [], { uploadedAt: "2026-11-20T10:00:00Z", seenOriginal: false, today: new Date("2026-11-20") }).ok, true);
});

test("the reading keeps only well-formed company fields", () => {
  const r = cleanKycDocumentReading({
    kind: "register_extract", names: [], certified: false, language: "French", english: false,
    company: { name: "ACME SARL", registrationNumber: "B 123", status: "active", extractDate: "2026-11-01", incorporated: "nope" },
    directors: [{ name: "Jean Dupont", role: "gérant", born: "1980-13" }, { name: "" }, "x"],
    owners: [{ name: "ACME Holding SA", person: false, share: "100%" }],
  }, "2026-11-20T10:00:00Z");
  assert.equal(r.language, "French");
  assert.equal(r.english, false);
  assert.equal(r.company?.incorporated, null);
  assert.deepEqual(r.directors, [{ name: "Jean Dupont", role: "gérant", born: null }]);
  assert.deepEqual(r.owners, [{ name: "ACME Holding SA", person: false, share: "100%", country: null }]);
  // An English language word reads as English when the flag is missing.
  assert.equal(cleanKycDocumentReading({ kind: "passport", names: ["A B"], certified: false, language: "English" }, "2026-11-20T10:00:00Z").english, true);
});

test("which parties need their own register's extract", () => {
  assert.equal(needsRegisterExtract({ kind: "company", country: "Germany" }), true);
  assert.equal(needsRegisterExtract({ kind: "company", ukNumber: "OE002654" }), true);
  assert.equal(needsRegisterExtract({ kind: "company", ukNumber: null, abroadParty: true }), true);
  assert.equal(needsRegisterExtract({ kind: "company", ukNumber: "12345678" }), false);
  assert.equal(needsRegisterExtract({ kind: "company", country: "Germany", sanctionsOnly: true }), false);
  assert.equal(needsRegisterExtract({ kind: "individual", country: "Germany" }), false);
  assert.equal(needsRegisterExtract({ kind: "company", country: "United Kingdom" }), false);
});

const facts = (over: Partial<SignOffFacts> = {}): SignOffFacts => ({
  rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: new Date().toISOString() }, precheckRunning: false, clientChecksFinished: true, note: "", ...over,
});

test("no sign-off of a company registered abroad without its extract", () => {
  const missing = { needed: true, held: false, company: "Acme Immobilien GmbH", reasons: [] };
  assert.match(signOffDenial(facts({ registerExtract: missing }))!, /registered outside the UK, so its own register's extract is needed first/);
  assert.match(registerExtractDenial({ ...missing, reasons: ["Dated 1 Jan 2025: more than three months old. Ask for a new one"] })!, /did not pass its check \(Dated 1 Jan 2025/);
  assert.equal(signOffDenial(facts({ registerExtract: { ...missing, held: true } })), null);
  assert.equal(signOffDenial(facts({ registerExtract: { ...missing, needed: false } })), null);
  // A sanctions-only letting needs the sanctions checks alone.
  assert.equal(signOffDenial(facts({ sanctionsOnly: true, registerExtract: missing })), null);
});

test("the AML file lists a missing extract", () => {
  const base = { deadline: null, settled: null, needsCompany: true, companySet: true, precheck: "done" as const, flags: [], level: "standard" as const,
    sanctionsOnly: false, peopleOutstanding: [], requests: [], anyRequest: true, jointGaps: [], trustGaps: [] };
  assert.ok(amlStillNeeded({ ...base, registerExtract: { needed: true, held: false, company: "Acme GmbH", reasons: [] } }).some(l => /An extract from Acme GmbH's own register/.test(l)));
  assert.ok(!amlStillNeeded({ ...base, registerExtract: { needed: true, held: true, company: "Acme GmbH", reasons: [] } }).some(l => /register/.test(l)));
});

test("a translation is made safe and labelled as not certified", async () => {
  assert.match(TRANSLATION_NOTE, /Not a certified translation/);
  assert.deepEqual(cleanTranslation({ language: "German", english: false, translation: "Commercial register extract" }, false),
    { language: "German", english: false, translation: "Commercial register extract", cut: false, error: null });
  assert.deepEqual(cleanTranslation({ language: "English", english: true, translation: "" }, true), { language: "English", english: true, translation: null, cut: false, error: null });
  assert.match(cleanTranslation({ language: "German", english: false, translation: "" }, false).error!, /empty/);
  const file = { buffer: Buffer.from("Handelsregisterauszug Amtsgericht München HRB 123456 Acme Immobilien GmbH"), mime: "text/plain", name: "auszug.txt" };
  assert.match((await translateFile(file, { hasKey: () => false })).error!, /not switched on/);
  assert.match((await translateFile(file, { hasKey: () => true, claim: async () => false })).error!, /allowance/);
  const done = await translateFile(file, { hasKey: () => true, claim: async () => true, ask: async () => ({ input: { language: "German", english: false, translation: "Extract from the commercial register" }, model: "x", cut: false }) });
  assert.equal(done.translation, "Extract from the commercial register");
});

// Foreign companies that Companies House holds (Woody, 23 November 2026: "a lot
// of companies that own property in the uk are on companies house but are also
// foreign?"): overseas entities and UK establishments of overseas companies.
import { askInputFrom, countryInSentence, foreignOnCompaniesHouse, homeRegisterFrom, homeRegisterWords } from "../shared/kyc-prechecks";
import { gleifNamesAgree, pickGleifRecord, type GleifEntity } from "../shared/foreign-owners";
import { gleifTraceWords } from "../shared/foreign-owner-words";

test("a company incorporated abroad on Companies House still needs its home register's extract", () => {
  for (const n of ["OE002654", "FC025497", "SF000123", "NF000456", " oe002654 "]) assert.equal(foreignOnCompaniesHouse(n), true, n);
  for (const n of ["12345678", "SC123456", "NI012345", "OC301234", "", null]) assert.equal(foreignOnCompaniesHouse(n), false, String(n));
  assert.equal(needsRegisterExtract({ kind: "company", ukNumber: "FC025497" }), true);
  assert.equal(needsRegisterExtract({ kind: "company", ukNumber: "12345678", homeAbroad: true }), true);
  assert.equal(needsRegisterExtract({ kind: "company", ukNumber: "FC025497", sanctionsOnly: true }), false);
});

test("Companies House's details in the place of incorporation become the home register", () => {
  // As Companies House shows AG HONDO BRIXTON VILLAGE BV (OE002654).
  const h = homeRegisterFrom({ originating_registry: { country: "NETHERLANDS", name: "Netherlands Chamber Of Commerce" }, registration_number: "71168974", legal_form: "Private Limited Liability Company", governed_by: "Netherlands" });
  assert.deepEqual(h, { country: "Netherlands", register: "Netherlands Chamber Of Commerce", registrationNumber: "71168974", legalForm: "Private Limited Liability Company", governedBy: "Netherlands" });
  assert.equal(homeRegisterWords(h), "Registered in the Netherlands (Netherlands Chamber Of Commerce, number 71168974), a private limited liability company.");
  // A UK establishment's details name the legal form as company_type.
  assert.equal(homeRegisterFrom({ originating_registry: { country: "UNITED STATES", name: "Delaware Division of Corporations" }, registration_number: "123", company_type: "Corporation" })?.legalForm, "Corporation");
  assert.equal(homeRegisterFrom(null), null);
  assert.equal(homeRegisterFrom({}), null);
  assert.equal(homeRegisterFrom([1]), null);
  assert.equal(countryInSentence("United States"), "the United States");
  assert.equal(countryInSentence("Cayman Islands"), "the Cayman Islands");
  assert.equal(homeRegisterFrom({ originating_registry: { country: "ISLE OF MAN" } })?.country, "Isle of Man");
  assert.equal(countryInSentence("Germany"), "Germany");
});

test("the extract is checked against the home number, and the hold names the home register", () => {
  // The extract from the Dutch register gives the Dutch number, never OE002654.
  const dutch = reading({ language: "Dutch", company: { name: "AG Hondo Brixton Village B.V.", registrationNumber: "71168974", legalForm: "B.V.", country: "Netherlands", register: "KvK", address: null, status: "active", incorporated: null, extractDate: "2026-11-10" } });
  assert.equal(checkRegisterExtract(dutch, { name: "AG HONDO BRIXTON VILLAGE BV", registrationNumber: "71168974" }, { uploadedAt: "2026-11-20T10:00:00Z" }).ok, true);
  assert.equal(checkRegisterExtract(dutch, { name: "AG HONDO BRIXTON VILLAGE BV", registrationNumber: null }, { uploadedAt: "2026-11-20T10:00:00Z" }).ok, true);
  assert.equal(checkRegisterExtract(dutch, { name: "AG HONDO BRIXTON VILLAGE BV", registrationNumber: "OE002654" }, { uploadedAt: "2026-11-20T10:00:00Z" }).ok, false, "why the OE number is never the subject's");
  assert.equal(registerExtractDenial({ needed: true, held: false, company: "AG HONDO BRIXTON VILLAGE BV", reasons: [], home: { country: "Netherlands", register: "Netherlands Chamber Of Commerce", registrationNumber: "71168974" } }),
    "AG HONDO BRIXTON VILLAGE BV is registered in the Netherlands, so an extract from Netherlands Chamber Of Commerce (number 71168974) is needed first. Ask the client for it, or upload it on Documents: the app reads it in any language.");
});

test("the client checks ask a UK establishment for its home register's extract", () => {
  const base = { party: { companyId: "b1", name: "Acme", subjectKind: "company", contactName: null }, companiesHouse: { number: "FC025497", name: "ACME INC", listing: null, owners: [], peopleUpChain: [], officers: [], documents: [], ownersAbroad: [], lastAccountsMadeUpTo: null, lastAccountsType: null } } as any;
  assert.equal(askInputFrom(base)?.ukRegistered, false);
  assert.equal(askInputFrom({ ...base, companiesHouse: { ...base.companiesHouse, number: "12345678" } })?.ukRegistered, true);
  assert.equal(askInputFrom({ ...base, companiesHouse: { ...base.companiesHouse, number: "12345678", home: { country: "France" } } })?.ukRegistered, false);
});

test("GLEIF by number abroad: the name must agree, as German HRB numbers repeat between local courts", () => {
  const ent = (o: Partial<GleifEntity>): GleifEntity => ({ lei: "L".repeat(20), name: "X", jurisdiction: "DE", country: "DE", registeredAs: null, registeredAt: null, status: "ACTIVE", leiStatus: "ISSUED", lastUpdate: null, ...o } as GleifEntity);
  const hvp = ent({ lei: "529900EF09UQVAJ2DI58", name: "HVP Hanse Vertriebspartner AG", registeredAs: "HRB 123456", registeredAt: "RA000259" });
  const ramen = ent({ lei: "R".repeat(20), name: "Ramen Immobilien GmbH", registeredAs: "HRB 123456", registeredAt: "RA000300" });
  const wrong = pickGleifRecord({ name: "Ramen Immobilien GmbH", country: "Germany", registrationNumber: "HRB 123456" }, [hvp]);
  assert.equal(wrong.pick, null);
  assert.equal(wrong.numberOther, "HVP Hanse Vertriebspartner AG");
  assert.equal(pickGleifRecord({ name: "Ramen Immobilien GmbH", country: "Germany", registrationNumber: "HRB 123456" }, [hvp, ramen]).pick?.lei, ramen.lei);
  assert.equal(gleifNamesAgree("Ramen Immobilien", "RAMEN IMMOBILIEN GMBH"), true);
  assert.equal(gleifNamesAgree("Ramen", "Ramen Immobilien GmbH"), false, "one word is not enough");
  // On a UK register named by the caller the number alone is enough, as before.
  const uk = ent({ name: "SOMETHING ELSE LIMITED", country: "GB", jurisdiction: "GB", registeredAs: "02711000", registeredAt: "RA000585" });
  assert.equal(pickGleifRecord({ name: "THE WELLCOME TRUST LIMITED", country: "GB", registrationNumber: "02711000", authorities: ["RA000585"] }, [uk]).pick?.lei, uk.lei);
  assert.match(gleifTraceWords({ name: "Ramen Immobilien GmbH", country: "Germany", gleif: { status: "not_found", entity: null, parents: [], top: null, candidates: 0, error: null, numberOther: "HVP Hanse Vertriebspartner AG" } }),
    /not in GLEIF under its name; its number there is HVP Hanse Vertriebspartner AG's, another company/);
});
