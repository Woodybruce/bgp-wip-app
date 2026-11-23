// The SRA's own data on law firms (Woody's key, 21 November 2026): reading an
// entry, finding the firm a name means, and the SRA register's words for each
// kind of entry. The fixtures copy real entries from the SRA's answer of that
// day (names, numbers, types), trimmed to what each test needs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSraIndex, companyNumberOf, domainOf, findSraFirm, readSraFirm, sraChoice, sraNumberIn, sraStatus, type SraFirm,
} from "../shared/sra-register";
import { registerFromSra, solicitorCheckWords, type SolicitorCheck } from "../shared/solicitor-aml";

const office = (o: Record<string, unknown> = {}) => ({
  OfficeId: 1, Name: "x", Address1: null, Address2: null, Address3: null, Address4: null, Town: "LONDON", County: null,
  Postcode: null, Country: "England", PhoneNumber: null, Email: null, Website: null, OfficeType: "HO", ...o,
});
const AUTH = { AuthorisationStatus: "YES", OrganisationType: "FIRMSRA", Regulator: "SRA" };
const UNREG = { AuthorisationType: "NOTSRA-F", AuthorisationStatus: null, OrganisationType: "ORG", Regulator: null, Type: "UnregulatedPracticeNotSraAuthorised" };
const org = (o: Record<string, unknown>) => ({
  Id: 1, AuthorisationDate: null, AuthorisationStatusDate: null, FreelanceBasis: null, TradingNames: null, PreviousNames: null,
  WorkArea: null, Websites: null, ReservedActivites: null, CompanyRegNo: null, Constitution: "ILLP", NoOfOffices: 1, Offices: [office()], ...o,
});

const RAW = [
  org({ ...AUTH, SraNumber: 400249, PracticeName: "FORSTERS LLP", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised", AuthorisationDate: "2005-03-01T00:00:00",
    CompanyRegNo: "OC306185", NoOfOffices: 2, WorkArea: ["Property - Commercial", "Landlord and Tenant (Commercial and Domestic)"],
    Offices: [office({ Address1: "31 Hill Street", Town: "LONDON", Postcode: "W1J 5LS", PhoneNumber: "020 7863 8333", Email: "mail@forsters.co.uk", Website: "www.forsters.co.uk" }), office({ OfficeType: "BRANCH", Town: "Manchester" })] }),
  org({ ...UNREG, SraNumber: 561221, PracticeName: "EVERSHEDS SUTHERLAND", NoOfOffices: 3 }),
  org({ ...AUTH, SraNumber: 383181, PracticeName: "EVERSHEDS SUTHERLAND (INTERNATIONAL) LLP", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised", TradingNames: ["EVERSHEDS SUTHERLAND", "KONEXO"], NoOfOffices: 16 }),
  org({ ...AUTH, SraNumber: 567215, PracticeName: "EVERSHEDS SUTHERLAND (FRANCE) LLP", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised", TradingNames: ["Eversheds Sutherland"], NoOfOffices: 2 }),
  org({ ...UNREG, SraNumber: 524035, PracticeName: "DLA Piper LLP", Offices: [office({ Town: "Chicago", Country: "United States of America" })] }),
  org({ ...AUTH, SraNumber: 401322, PracticeName: "DLA PIPER UK LLP", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised", NoOfOffices: 17 }),
  org({ ...AUTH, SraNumber: 386993, PracticeName: "DLA PIPER INTERNATIONAL LLP", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised" }),
  org({ ...UNREG, SraNumber: 367734, PracticeName: "TAYLOR WESSING", TradingNames: ["TAYLOR WESSING e/n/w/c"], NoOfOffices: 7, Offices: [office({ Town: "DUSSELDORF", Country: "Germany" })] }),
  org({ SraNumber: 385640, PracticeName: "TAYLOR WESSING SECRETARIES LIMITED", AuthorisationType: "RECBODY", AuthorisationStatus: "REVOKE", Regulator: "SRA", Type: "RecognisedBodyClosureComplete", Constitution: "ICLS" }),
  org({ SraNumber: 539807, PracticeName: "GLEN SOLICITORS LTD", AuthorisationType: "RECBODY", AuthorisationStatus: "INTERVENE", Regulator: "SRA", Type: "RecognisedBodyIntervened",
    AuthorisationStatusDate: "2025-11-24T00:00:00", CompanyRegNo: "7219165", Offices: [office({ Address1: "Building 3, 566 Chiswick High Road", Town: "LONDON", Postcode: "W4 5YA", Email: "navpreet@glensolicitors.com" })] }),
  org({ ...AUTH, SraNumber: 596261, PracticeName: "HCR Legal LLP", AuthorisationType: "LICBODY", Type: "LicensedBodyAuthorised", PreviousNames: ["Hewitsons LLP"], NoOfOffices: 14 }),
  org({ ...AUTH, SraNumber: 634504, PracticeName: "MACS LEGAL SERVICES LTD", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised", PreviousNames: ["CMS LAW LIMITED"] }),
  org({ ...AUTH, SraNumber: 423370, PracticeName: "CMS CAMERON MCKENNA NABARRO OLSWANG LLP", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised", NoOfOffices: 14 }),
  org({ ...UNREG, SraNumber: 8000539, PracticeName: "Ashurst" }),
  org({ ...AUTH, SraNumber: 468653, PracticeName: "Ashurst Perkins Coie UK LLP", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised", NoOfOffices: 16 }),
  org({ ...UNREG, SraNumber: 614870, PracticeName: "HORIZON LAW", Regulator: "CLC" }),
  org({ ...AUTH, SraNumber: 831584, PracticeName: "Horizon Solicitors Limited", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised" }),
  org({ SraNumber: 667279, PracticeName: "Marcus Lindsey Hirst", AuthorisationType: "NOTSRA-F", AuthorisationStatus: null, Regulator: "SRA", Type: "PracticeNotSeparatelyAuthorised", FreelanceBasis: "FSR" }),
  org({ SraNumber: 8007601, PracticeName: "Christopher Quebral", AuthorisationType: "NOTSRA-F", AuthorisationStatus: null, Regulator: null, Type: "UnregulatedPracticeNotSraAuthorised102a", FreelanceBasis: "FSNR" }),
  org({ SraNumber: 208277, PracticeName: "MALLOY & BARRY", AuthorisationType: "RECBODY", AuthorisationStatus: "CEASE", Regulator: "SRA", Type: "RecognisedBodyClosureInProgress", AuthorisationStatusDate: "2026-09-30T00:00:00" }),
  org({ SraNumber: 629799, PracticeName: "ARCHSTONE SOLICITORS LTD", AuthorisationType: "RECBODY", AuthorisationStatus: "CONDITION", Regulator: "SRA", Type: "RecognisedBodyAuthorisedWithConditions" }),
  { Id: 2, SraNumber: null, PracticeName: "No number" },
];
const FIRMS = RAW.map(readSraFirm).filter((f): f is SraFirm => !!f);
const INDEX = buildSraIndex(FIRMS);
const firm = (n: string) => FIRMS.find(f => f.sraNumber === n)!;

test("an entry is read as the SRA gives it, and one with no SRA number is left out", () => {
  assert.equal(FIRMS.length, RAW.length - 1);
  const f = firm("400249");
  assert.equal(f.name, "FORSTERS LLP");
  assert.equal(f.status, "YES");
  assert.equal(f.authorisedOn, "2005-03-01");
  assert.equal(f.companyNumber, "OC306185");
  assert.equal(f.offices, 2);
  assert.equal(f.headOffice?.address, "31 Hill Street, LONDON, W1J 5LS, England");
  assert.equal(f.headOffice?.email, "mail@forsters.co.uk");
  assert.deepEqual(f.domains, ["forsters.co.uk"]);
  assert.equal(firm("539807").companyNumber, "07219165");
  assert.equal(companyNumberOf("OC1234"), "OC001234");
  assert.equal(domainOf("https://www.example-law.co.uk/contact"), "example-law.co.uk");
  assert.equal(domainOf("Jane <jane@example-law.co.uk>".split("<")[1]), "example-law.co.uk");
  assert.equal(domainOf("not a domain"), null);
  assert.equal(sraNumberIn("SRA 400249"), "400249");
  assert.equal(sraNumberIn("SRA no. 400249"), "400249");
  assert.equal(sraNumberIn("Forsters"), null);
});

test("a name finds the firm that stands out, by its name, an SRA number or a web or email address", () => {
  for (const q of ["Forsters", "forsters llp", "FORSTERS L.L.P.", "Forsters LLP (Jane Doe)", "Forsters - property team", "SRA 400249", "400249", "www.forsters.co.uk", "jane@forsters.co.uk"]) {
    const r = findSraFirm(INDEX, q);
    assert.equal(r.firm?.sraNumber, "400249", q);
  }
  assert.equal(findSraFirm(INDEX, "Forsters").how, "name");
  assert.equal(findSraFirm(INDEX, "400249").how, "sra_number");
  assert.equal(findSraFirm(INDEX, "jane@forsters.co.uk").how, "website");
  // A number not on the register finds nothing; it is not read as a name.
  assert.deepEqual([findSraFirm(INDEX, "999999").firm, findSraFirm(INDEX, "999999").candidates.length], [null, 0]);
  // A chosen entry wins over the name.
  assert.equal(findSraFirm(INDEX, "DLA Piper", { sraNumber: "386993" }).firm?.name, "DLA PIPER INTERNATIONAL LLP");
});

test("the one SRA-authorised firm under a name stands out over an international partnership of the same name", () => {
  const es = findSraFirm(INDEX, "Eversheds Sutherland");
  assert.equal(es.firm?.name, "EVERSHEDS SUTHERLAND (INTERNATIONAL) LLP");
  assert.ok(es.candidates.some(c => c.name === "EVERSHEDS SUTHERLAND"), "the international partnership is offered as another entry");
  // Two authorised firms under the name: the person chooses, the firm in England and Wales first.
  const dla = findSraFirm(INDEX, "DLA Piper");
  assert.equal(dla.firm, null);
  assert.deepEqual(dla.candidates.map(c => c.name).slice(0, 3), ["DLA PIPER UK LLP", "DLA PIPER INTERNATIONAL LLP", "DLA Piper LLP"]);
  // The only entry of the name is not regulated and no authorised firm is near: that entry, flagged for a look.
  const tw = findSraFirm(INDEX, "Taylor Wessing");
  assert.equal(tw.firm?.sraNumber, "367734");
  assert.equal(sraStatus(tw.firm!).tone, "info");
  // An entry that is not regulated never stands out over an authorised firm that carries the name.
  const ash = findSraFirm(INDEX, "Ashurst");
  assert.equal(ash.firm, null);
  assert.equal(ash.candidates[0].name, "Ashurst Perkins Coie UK LLP");
  // A firm the SRA closed down is the firm of that name, and says so.
  const glen = findSraFirm(INDEX, "Glen Solicitors");
  assert.equal(glen.firm?.sraNumber, "539807");
  assert.equal(sraStatus(glen.firm!).tone, "attention");
});

test("a name the firm used before, or trades under, finds it; a shared former name leaves the choice to the person", () => {
  const hcr = findSraFirm(INDEX, "Hewitsons");
  assert.equal(hcr.firm?.name, "HCR Legal LLP");
  assert.equal(hcr.how, "other_name");
  assert.equal(sraChoice(hcr.firm!, "Hewitsons").alsoKnownAs, "formerly Hewitsons LLP");
  const cms = findSraFirm(INDEX, "CMS");
  assert.equal(cms.firm, null);
  assert.equal(cms.candidates[0].name, "CMS CAMERON MCKENNA NABARRO OLSWANG LLP");
  assert.ok(cms.candidates.some(c => c.name === "MACS LEGAL SERVICES LTD"));
  assert.deepEqual([findSraFirm(INDEX, "Pemberton Greenish").firm, findSraFirm(INDEX, "Pemberton Greenish").candidates.length], [null, 0]);
});

test("the exact name wins over a looser one, and a closed firm of the exact name is not passed over for another firm", () => {
  // "Horizon Law" is the CLC-regulated firm of that name, not Horizon Solicitors Limited.
  const horizon = findSraFirm(INDEX, "Horizon Law");
  assert.equal(horizon.firm?.sraNumber, "614870");
  assert.ok(horizon.candidates.some(c => c.sraNumber === "831584"));
  // The firm the SRA closed down under the exact name, beside a regulated firm under a looser one: the person chooses.
  const small = buildSraIndex([firm("539807"), readSraFirm(org({ ...AUTH, SraNumber: 900001, PracticeName: "GLEN LAW LTD", AuthorisationType: "RECBODY", Type: "RecognisedBodyAuthorised" }))!]);
  const glen = findSraFirm(small, "Glen Solicitors");
  assert.equal(glen.firm, null);
  assert.deepEqual(glen.candidates.map(c => c.sraNumber), ["900001", "539807"]);
});

test("each kind of entry in the SRA register's own words", () => {
  const words = (n: string) => { const s = sraStatus(firm(n)); return [s.label, s.tone]; };
  assert.deepEqual(words("400249"), ["SRA-regulated firm", "ok"]);
  assert.equal(sraStatus(firm("400249")).line, "an SRA-regulated firm, recognised body since 1 Mar 2005");
  assert.deepEqual(words("596261"), ["SRA-regulated firm", "ok"]);
  assert.deepEqual(words("629799"), ["SRA-regulated firm, conditions apply", "attention"]);
  assert.deepEqual(words("208277"), ["Firm is closing", "info"]);
  assert.deepEqual(words("385640"), ["Firm has closed", "attention"]);
  assert.deepEqual(words("539807"), ["Closed down by the SRA", "attention"]);
  assert.match(sraStatus(firm("539807")).line, /^closed down by the SRA \(an intervention on 24 Nov 2025\)$/);
  assert.deepEqual(words("614870"), ["Regulated by an approved regulator for legal services", "ok"]);
  assert.match(sraStatus(firm("614870")).line, /Council for Licensed Conveyancers/);
  assert.deepEqual(words("667279"), ["SRA-regulated freelance", "ok"]);
  assert.deepEqual(words("8007601"), ["Not an SRA-regulated firm", "info"]);
  assert.deepEqual(words("367734"), ["Not regulated by an approved regulator for legal services", "info"]);
});

const check = (register: SolicitorCheck["register"], findings = 0): SolicitorCheck => ({
  firm: "Forsters", ranAt: "2026-11-21T14:00:00Z", register,
  media: { ran: true, status: findings ? "found" : "none_found", findings: Array.from({ length: findings }, (_, i) => ({ kind: "adverse_media", summary: "x", url: `https://e.example/${i}`, source: "e", date: null, category: null, unsureIdentity: false, person: null } as any)), unsourced: 0 },
  errors: [],
});

test("the solicitors check words a firm from the SRA's data, and says so when the person found none of the entries", () => {
  const readAt = "2026-11-21T14:00:59Z";
  const found = registerFromSra(findSraFirm(INDEX, "Forsters"), readAt);
  assert.deepEqual([found.status, found.source, found.sraNumber, found.url], ["found", "sra_data", "400249", "https://www.sra.org.uk/consumers/register/organisation/?sraNumber=400249"]);
  assert.deepEqual(solicitorCheckWords(check(found)), { tone: "ok", words: "FORSTERS LLP (SRA 400249, 2 offices): an SRA-regulated firm, recognised body since 1 Mar 2005 · no negative media found" });
  assert.equal(solicitorCheckWords(check(found, 1)).tone, "attention");
  const glen = registerFromSra(findSraFirm(INDEX, "Glen Solicitors"), readAt);
  assert.equal(solicitorCheckWords(check(glen)).tone, "attention");
  const tw = registerFromSra(findSraFirm(INDEX, "Taylor Wessing"), readAt);
  assert.equal(solicitorCheckWords(check(tw)).tone, "info");
  const none = registerFromSra(findSraFirm(INDEX, "DLA Piper"), readAt, { declined: true });
  assert.deepEqual([none.status, none.declined], ["not_found", 3]);
  assert.match(solicitorCheckWords(check(none)).words, /^Forsters: none of the 3 entries on the SRA's register under that name is them/);
  assert.equal(solicitorCheckWords(check(none)).tone, "info");
  const missing = registerFromSra(findSraFirm(INDEX, "Pemberton Greenish"), readAt);
  assert.match(solicitorCheckWords(check(missing)).words, /not found on the SRA's register under that name/);
  // Our client's solicitors: the SRA check alone (Woody, 23 November 2026: "dont we just need
  // to check they are an SRA firm?"); a web search an earlier check ran on them is left out.
  assert.deepEqual(solicitorCheckWords({ ...check(found, 1), side: "client" }), { tone: "ok", words: "FORSTERS LLP (SRA 400249, 2 offices): an SRA-regulated firm, recognised body since 1 Mar 2005" });
  assert.equal(solicitorCheckWords({ ...check(found, 1), side: "other" }).tone, "attention");
  assert.equal(solicitorCheckWords({ ...check(glen, 0), side: "client" }).tone, "attention");
});

// Woody, 23 November 2026: "we need our clients solicitors checked at SRA too I think".
// Each check says whose solicitors the firm is; a check from before is our client's
// when it is the firm the transaction records as its solicitors.
test("a solicitors check is our client's or the other side's", async () => {
  const { sameSolicitorFirm, solicitorSideOf, isSolicitorSide } = await import("../shared/solicitor-aml");
  assert.equal(sameSolicitorFirm("Forsters LLP", "forsters"), true);
  assert.equal(sameSolicitorFirm("Taylor Wessing Solicitors", "Taylor Wessing LLP"), true);
  assert.equal(sameSolicitorFirm("Forsters", "Fieldfisher"), false);
  assert.equal(sameSolicitorFirm("", ""), false);
  assert.equal(solicitorSideOf({ firm: "Forsters LLP" }, "Forsters"), "client");
  assert.equal(solicitorSideOf({ firm: "Fieldfisher" }, "Forsters"), "other");
  assert.equal(solicitorSideOf({ firm: "Fieldfisher" }, null), "other");
  assert.equal(solicitorSideOf({ firm: "Forsters LLP", side: "other" }, "Forsters"), "other", "the side asked for stands");
  assert.equal(isSolicitorSide("client"), true);
  assert.equal(isSolicitorSide("landlord"), false);
});
