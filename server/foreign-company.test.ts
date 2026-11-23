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
