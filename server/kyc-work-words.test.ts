// What a client checks request says about the work (Woody, 25 November 2026,
// on Tunsgate Quarter: our client told why we check them and that it is done
// once, with the town; the other side told the transaction spelt out; a public
// body never asked about owners or directors). Rules: shared/kyc-work-words.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { kycPlace, kycWorkFor, kycWorkOpening, kycWorkReminder, partsText } from "../shared/kyc-work-words";
import { kycRequestEmail, kycReminderEmail, kycSteps, type KycEmailContext } from "../shared/kyc-request";

const WIRRAL = "Wirral Metropolitan Borough Council (as administering authority for Merseyside Pension Fund)";
const tunsgate = (partyRole: string, over: Partial<Parameters<typeof kycWorkFor>[0]> = {}) => kycWorkFor({
  dealType: "New Letting", unitName: "98-100 High Street", propertyName: "Tunsgate Quarter", propertyAddress: "Tunsgate, Guildford GU1 3QT, UK",
  parties: { landlord: WIRRAL, tenant: "Rodd & Gunn" }, clientRole: "landlord", clientName: WIRRAL, partyRole, dealName: "Tunsgate Quarter", ...over,
});

const ctx = (over: Partial<KycEmailContext> = {}): KycEmailContext => ({
  recipientName: "jack Sullivan", partyName: WIRRAL, kind: "company", dealName: "Tunsgate Quarter",
  ref: "7K2Q9M", link: "https://chatbgp.app/kyc-upload/abc", expiresAt: new Date("2026-12-01T12:00:00Z"),
  needsIdCheck: false, docs: ["authority"], note: null, askPep: true,
  agents: [{ name: "Jack Barratt", email: "jack@brucegillinghampollard.com", phone: null }], sentFrom: "kyc@brucegillinghampollard.com", ...over,
});
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");

test("the place is the property and its town, once", () => {
  assert.equal(kycPlace("Tunsgate Quarter", "Tunsgate, Guildford GU1 3QT, UK"), "Tunsgate Quarter, Guildford");
  assert.equal(kycPlace("Guildford High Street", "Guildford GU1 3AA"), "Guildford High Street", "the name already says the town");
  assert.equal(kycPlace("Tunsgate Quarter", null), "Tunsgate Quarter");
  assert.equal(kycPlace(null, null), null);
});

test("our client: by law, before we can act for you, with the place and town, and only once", () => {
  const work = tunsgate("landlord", { publicBody: true });
  assert.equal(work.client, true);
  const words = kycWorkOpening(work, { name: WIRRAL, kind: "company" }, false).map(partsText);
  assert.equal(words[0], `By law, before we can act for you as estate agents, we have to confirm who we are dealing with. We act for ${WIRRAL} on Tunsgate Quarter, Guildford, so we need a few things from you.`);
  assert.equal(words[1], `We only ask once: it then covers our future work for ${WIRRAL}, until our next review.`);
  const { subject, html } = kycRequestEmail(ctx({ work }));
  const body = text(html);
  assert.match(subject, /Tunsgate Quarter, Guildford \[7K2Q9M\]$/);
  assert.match(body, /Identity checks for Tunsgate Quarter, Guildford/);
  assert.match(body, /By law, before we can act for you as estate agents/);
  assert.match(body, /We only ask once/);
  assert.doesNotMatch(body, /can go ahead/);
  // A council: no owners, no directors, and the question is about the person.
  assert.doesNotMatch(body, /company's owners|directors|anyone who owns/);
  assert.match(body, /Confirmation you can act for the council/);
  assert.match(body, /Whether you hold a prominent public role/);
  assert.doesNotMatch(body, /Companies House record/);
});

test("the other side: the transaction spelt out, who we act for, and both sides checked", () => {
  const work = tunsgate("tenant");
  assert.equal(work.client, false);
  assert.equal(work.what, "the letting of 98-100 High Street, Tunsgate Quarter, Guildford, to Rodd & Gunn");
  assert.equal(work.word, "letting");
  const words = partsText(kycWorkOpening(work, { name: "Rodd & Gunn", kind: "company" }, true)[0]);
  assert.equal(words, `We act for ${WIRRAL}, the landlord, on the letting of 98-100 High Street, Tunsgate Quarter, Guildford, to Rodd & Gunn. Before the letting can go ahead, the law requires us to confirm who is on each side. That's you, for Rodd & Gunn, and the people who own or control it.`);
  // No owners asked: no owners mentioned.
  assert.match(partsText(kycWorkOpening(work, { name: "Rodd & Gunn", kind: "company" }, false)[0]), /That's you, for Rodd & Gunn\.$/);
  const body = text(kycRequestEmail(ctx({ partyName: "Rodd & Gunn", work, docs: ["ownership", "authority"] })).html);
  assert.match(body, /on the letting of 98-100 High Street, Tunsgate Quarter, Guildford, to Rodd & Gunn\. Before the letting can go ahead/);
  assert.match(body, /Confirmation you can act for the company/, "a company keeps the director wording");
  assert.doesNotMatch(body, /We only ask once/);
  // The reminder says the same.
  assert.equal(partsText(kycWorkReminder(work, { name: "Rodd & Gunn", kind: "company" })), "We still need a few things from you before the letting of 98-100 High Street, Tunsgate Quarter, Guildford, to Rodd & Gunn can go ahead.");
  const progress = { idDone: false, docsDone: [], pepAnswered: false, ownersAnswered: false, ownersLinked: false } as any;
  assert.match(text(kycReminderEmail({ ...ctx({ partyName: "Rodd & Gunn", work }), progress }).html), /before the letting of 98-100 High Street/);
});

test("sales and purchases read the right way round; a client file has no place", () => {
  const sale = kycWorkFor({ dealType: "Sale", unitName: null, propertyName: "One Clapham", propertyAddress: "St John's Hill, London SW11 1TN",
    parties: { vendor: "Mount Anvil", purchaser: "Inovalis" }, clientRole: "vendor", clientName: "Mount Anvil", partyRole: "purchaser", dealName: "One Clapham" });
  assert.equal(sale.what, "the sale of One Clapham, London, to Inovalis");
  assert.equal(sale.word, "sale");
  const purchase = kycWorkFor({ dealType: "Purchase", unitName: null, propertyName: "One Clapham", propertyAddress: null,
    parties: { vendor: "Mount Anvil", purchaser: "Inovalis" }, clientRole: "purchaser", clientName: "Inovalis", partyRole: "vendor", dealName: "One Clapham" });
  assert.equal(purchase.what, "the purchase of One Clapham from Mount Anvil");
  const file = kycWorkFor({ dealType: null, unitName: null, propertyName: null, propertyAddress: null, parties: {}, clientRole: "client", clientName: "Hermes",
    partyRole: "client", dealName: "our instruction from Hermes", clientFile: true });
  assert.equal(file.client, true);
  assert.equal(file.place, null);
  assert.equal(partsText(kycWorkOpening(file, { name: "Hermes", kind: "company" }, false)[0]), "By law, before we can act for you as estate agents, we have to confirm who we are dealing with. We act for Hermes, so we need a few things from you.");
  // A private individual is "you".
  assert.match(partsText(kycWorkOpening(tunsgate("landlord"), { name: "Jane Smith", kind: "individual" }, false)[0]), /We act for you on Tunsgate Quarter, Guildford/);
});

test("older requests with no wording keep the old opening", () => {
  const body = text(kycRequestEmail(ctx({ partyName: "Example Trading Ltd", kind: "company", docs: ["ownership"] })).html);
  assert.match(body, /Before Tunsgate Quarter can go ahead/);
  assert.equal(kycSteps({ needsIdCheck: false, docs: ["authority"], askPep: false, kind: "company" })[0].title, "Confirmation you can act for the company");
});
