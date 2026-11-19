// Who an email the inbox sweep reads as an offer or interest is credited to
// (Woody, 19 November 2026, "Are you fixing it?"): a brand named in the
// subject outranks the people on the email, unless the subject names their
// brand too; with neither, nothing is credited.
import test from "node:test";
import assert from "node:assert/strict";
import { buildViewingBrandIndex, chooseEmailBrand, subjectNamesBrand, type ViewingBrandMatch } from "./viewing-matching";

const index = buildViewingBrandIndex(
  ["Fulai", "Crisp Pizza", "Kakure", "Babila", "Gail's", "Reiss", "Fuel", "Hotpod Yoga", "Feya", "Johnstons of Elgin"]
    .map(name => ({ id: name.toLowerCase().replace(/[^a-z]+/g, "-"), name })),
  ["Pearl Yard", "Bullring", "Cardinal Place"]);
const people = (brandId: string | null, brandName: string | null, over: Partial<ViewingBrandMatch> = {}): ViewingBrandMatch => ({
  brandId, brandName, contactId: brandId ? `contact-${brandId}` : null, contactName: brandId ? `Person at ${brandName}` : null,
  agentContactId: null, requirementId: null, candidateBrandIds: brandId ? [brandId] : [], reasons: [], ...over,
});

test("a brand named in the subject wins over the sender's own company, with no contact carried over", () => {
  assert.deepEqual(chooseEmailBrand("Fw: Offer | 1-4.3 Pearl Yard | Fulai", people("crisp-pizza", "Crisp Pizza"), index),
    { brandId: "fulai", brandName: "Fulai", contactId: null, contactName: null, from: "subject" });
  assert.equal(chooseEmailBrand("Kakure - Heads of Terms - WCs St Christophers Place", people("babila", "Babila"), index)?.brandId, "kakure");
  assert.equal(chooseEmailBrand("RE: K13/14 Bullring - Fuel Juice Bars", people("hotpod-yoga", "Hotpod Yoga"), index)?.brandId, "fuel");
});

test("the sender's brand stays when the subject names it too, apostrophes or not", () => {
  const gails = people("gail-s", "Gail's");
  assert.deepEqual(chooseEmailBrand("Re: Gails X Reiss (Cardinal Place)", gails, index),
    { brandId: "gail-s", brandName: "Gail's", contactId: "contact-gail-s", contactName: "Person at Gail's", from: "people" });
  assert.equal(chooseEmailBrand("Fw: Johnston's of Elgin 203 Sloane Street proposal", people("johnstons-of-elgin", "Johnstons of Elgin"), index)?.from, "people");
  assert.equal(chooseEmailBrand("Kakure - Heads of Terms", people("kakure", "Kakure"), index)?.contactId, "contact-kakure");
});

test("with no brand named, the people on the email decide as before", () => {
  assert.deepEqual(chooseEmailBrand("Re: Satori, Cardinal Place, Victoria - Offer", people("feya", "Feya"), index),
    { brandId: "feya", brandName: "Feya", contactId: "contact-feya", contactName: "Person at Feya", from: "people" });
  // An agent linked to the brand is the contact when nobody at the brand is on the email.
  const viaAgent = people("feya", "Feya", { contactId: null, agentContactId: "agent-1", contactName: "An Agent" });
  assert.equal(chooseEmailBrand("Offer - Cardinal Place", viaAgent, index)?.contactId, "agent-1");
});

test("two brands named is no answer from the subject", () => {
  assert.equal(chooseEmailBrand("Fuel x Reiss - offer", people("crisp-pizza", "Crisp Pizza"), index)?.brandId, "crisp-pizza");
  assert.equal(chooseEmailBrand("Fuel x Reiss - offer", people(null, null, { reasons: ["missing_brand"] }), index), null);
});

test("when the people are unclear, the subject's brand is credited, keeping a contact only from that brand", () => {
  const unclear = people(null, null, { reasons: ["ambiguous_brand"], candidateBrandIds: ["a", "b"] });
  assert.deepEqual(chooseEmailBrand("OFFER: Fuel - Bullring K13", unclear, index),
    { brandId: "fuel", brandName: "Fuel", contactId: null, contactName: null, from: "subject" });
  const sameBrand = people("fuel", "Fuel", { reasons: ["unmatched_attendee"] });
  assert.equal(chooseEmailBrand("OFFER: Fuel - Bullring K13", sameBrand, index)?.contactId, "contact-fuel");
  // The subject names the people's brand and another: no telling which.
  assert.equal(chooseEmailBrand("Re: Gails X Reiss", people("gail-s", "Gail's", { reasons: ["unmatched_attendee"] }), index), null);
  // Neither the people nor the subject: nothing is credited.
  assert.equal(chooseEmailBrand("Offer - Unit 3", people(null, null, { reasons: ["missing_brand"] }), index), null);
  assert.equal(chooseEmailBrand("Offer - Unit 3", people("feya", "Feya", { reasons: ["unmatched_attendee"] }), index), null);
});

test("names are matched whole, ignoring case and apostrophes", () => {
  assert.equal(subjectNamesBrand("re: gails x reiss", "Gail's"), true);
  assert.equal(subjectNamesBrand("Gail’s at Cardinal Place", "Gail's"), true);
  assert.equal(subjectNamesBrand("Refuel the kiosk", "Fuel"), false);
  assert.equal(subjectNamesBrand("Offer", ""), false);
  assert.equal(subjectNamesBrand("Offer", null), false);
});
