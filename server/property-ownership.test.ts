// The Ownership & KYC tab's rules (shared/property-ownership.ts; Woody,
// 23 November 2026: "the landreg search should really feed the inital KYC").
import test from "node:test";
import assert from "node:assert/strict";
import {
  addressNumberAndStreet, buildingNameKey, ownershipKycWords, sameRegisteredCompany, titleFit, titleUsePlan, titleUseWords,
} from "../shared/property-ownership";

test("the building's number and street, as Land Registry files an address", () => {
  assert.deepEqual(addressNumberAndStreet({ street: "Millennium Bridge House, 2 Lambeth Hill, City of London EC4V 4GG" }), { number: "2", street: "Lambeth Hill" });
  assert.deepEqual(addressNumberAndStreet("35-37 Dover Street, London W1S 4NJ"), { number: "35-37", street: "Dover Street" });
  assert.deepEqual(addressNumberAndStreet({ streetNumber: "65A", street: "Granville Arcade" }), { number: "65a", street: "Granville Arcade" });
  assert.deepEqual(addressNumberAndStreet("Unit 7a, 12 High Street, Brixton"), { number: "12", street: "High Street" });
  // A postcode or a name with no numbered street gives nothing.
  assert.equal(addressNumberAndStreet("City of London EC4V 4GG"), null);
  assert.equal(addressNumberAndStreet("Bluewater Shopping Centre, Greenhithe"), null);
  assert.equal(addressNumberAndStreet(null), null);
});

test("a title is the building's when its address names the number on the street, or the building's name", () => {
  const place = { name: "Millennium Bridge House", number: "2", street: "Lambeth Hill" };
  assert.equal(titleFit("Millennium Bridge House, 2 Lambeth Hill, London (EC4V 4AG)", place), "address");
  assert.equal(titleFit("2-6 Lambeth Hill, London", place), "address");
  assert.equal(titleFit("1 to 3 Lambeth Hill, London", place), "address");
  assert.equal(titleFit("Millennium Bridge House, Lambeth Hill", { ...place, number: null }), "name");
  // The next door building, and a number on another street, are not it.
  assert.equal(titleFit("4 Lambeth Hill, London", place), null);
  assert.equal(titleFit("2 Queen Victoria Street, London", place), null);
  // A range on the property's side: 35-37 is covered by 37.
  assert.equal(titleFit("37 Dover Street, London", { name: "35-37 Dover Street", number: "35-37", street: "Dover Street" }), "address");
  // A name that is only a street address says nothing about the building.
  assert.equal(buildingNameKey("2 Lambeth Hill"), null);
  assert.equal(buildingNameKey("Bluewater"), null);
  assert.equal(buildingNameKey("Millennium Bridge House"), "millennium bridge house");
});

test("the same company: the same number, else the same registered name", () => {
  assert.equal(sameRegisteredCompany({ name: "AG MILLENNIUM PROPCO LIMITED", number: "1234567" }, { name: "Something else", number: "01234567" }), true);
  assert.equal(sameRegisteredCompany({ name: "AG Millennium Propco Ltd", number: null }, { name: "AG MILLENNIUM PROPCO LIMITED", number: null }), true);
  assert.equal(sameRegisteredCompany({ name: "AG Millennium Propco Ltd", number: "1" }, { name: "AG Millennium Propco Ltd", number: "2" }), false);
  assert.equal(sameRegisteredCompany({ name: "Braeburn Estates Limited" }, { name: "Braeburn Estates (Holdings) Limited" }), false);
});

test("what Use does: a freehold sets up the owner; a leasehold only the empty Long leaseholder", () => {
  const roles = { freeholderId: null, longLeaseholderId: null };
  // Millennium Bridge House: TPG is Owner and Freeholder; the SPV is filed under TPG.
  assert.deepEqual(titleUsePlan({ onRecord: false, tenure: "Freehold", owner: { id: "tpg" }, proprietor: { filed: false, crm: null }, roles: { freeholderId: "tpg", longLeaseholderId: null } }),
    { kind: "owner", records: true, owner: "keep", files: true, freeholder: false });
  // No Owner yet: the CRM company already holding it, else a new one; an empty Freeholder follows the Owner.
  assert.deepEqual(titleUsePlan({ onRecord: false, tenure: "Freehold", owner: null, proprietor: { filed: false, crm: { id: "c" } }, roles }),
    { kind: "owner", records: true, owner: "existing", files: true, freeholder: true });
  assert.equal((titleUsePlan({ onRecord: false, tenure: null, owner: null, proprietor: { filed: false, crm: null }, roles }) as any)?.owner, "create");
  // A long lease's owner is another company: never filed under the Owner, only the empty Long leaseholder.
  assert.deepEqual(titleUsePlan({ onRecord: false, tenure: "Leasehold", owner: { id: "o" }, proprietor: { filed: false, crm: null }, roles }), { kind: "long_leaseholder", company: "create" });
  assert.deepEqual(titleUsePlan({ onRecord: false, tenure: "Leasehold", owner: null, proprietor: { filed: false, crm: { id: "c" } }, roles }), { kind: "long_leaseholder", company: "existing" });
  // A role a person set is never changed.
  assert.equal(titleUsePlan({ onRecord: false, tenure: "Leasehold", owner: { id: "o" }, proprietor: { filed: false, crm: null }, roles: { freeholderId: null, longLeaseholderId: "x" } }), null);
  // All done: nothing to offer.
  assert.equal(titleUsePlan({ onRecord: true, tenure: "Freehold", owner: { id: "tpg" }, proprietor: { filed: true, crm: null }, roles: { freeholderId: "tpg", longLeaseholderId: null } }), null);
  assert.equal(titleUseWords({ kind: "owner", records: true, owner: "keep", files: true, freeholder: false }, { titleNumber: "NGL1", ownerName: "TPG Angelo Gordon", proprietorName: "AG MILLENNIUM PROPCO LIMITED" }),
    "Records title NGL1 on the building, files AG MILLENNIUM PROPCO LIMITED under TPG Angelo Gordon for the AML.");
  assert.equal(titleUseWords({ kind: "owner", records: true, owner: "keep", files: false, freeholder: false }, { titleNumber: "NGL2", ownerName: "TPG", proprietorName: "X", storedTitle: "NGL1" }),
    "Records title NGL2 on the building in place of NGL1.");
  assert.equal(titleUseWords({ kind: "long_leaseholder", company: "create" }, { titleNumber: "NGL3", ownerName: "TPG", proprietorName: "QA OVERSEAS SARL" }),
    "Adds QA OVERSEAS SARL to the CRM and sets it as the Long leaseholder.");
});

test("a company's KYC in the transaction's words", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  assert.equal(ownershipKycWords({ status: "approved", expiresAt: "2029-11-23T00:00:00Z" }, now).words, "KYC approved until 23 Nov 2029");
  assert.equal(ownershipKycWords({ status: "approved", expiresAt: "2026-01-01T00:00:00Z" }, now).words, "KYC expired: check again");
  assert.equal(ownershipKycWords({ status: "in_review" }, now).words, "Not signed off yet");
  assert.equal(ownershipKycWords(null, now).words, "Not signed off yet");
});
