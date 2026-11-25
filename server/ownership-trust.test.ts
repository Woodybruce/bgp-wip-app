import { test } from "node:test";
import assert from "node:assert/strict";
import { ownershipTrustFrom, ownershipTrustGapWords } from "../shared/ownership-trust";

const ch = (owners: any[], up: any[] = []) => ({ companiesHouse: { name: "PIE RETAIL LIMITED", owners, peopleUpChain: up } } as any);

test("a trust up the chain is found, trustees and controllers apart", () => {
  const held = ownershipTrustFrom(ch([{ name: "Beauty Pie Limited", kind: "corporate", controls: ["Ownership of shares – 75% or more"] }], [
    { name: "Anne Mansbridge", foundAt: "BEAUTY PIE LIMITED", controls: ["Ownership of shares – More than 50% but less than 75% with control over the trustees of a trust"] },
    { name: "Alan Milgate", foundAt: "BEAUTY PIE LIMITED", controls: ["Has significant influence or control over the trustees of a trust"] },
  ]));
  assert.equal(held?.heldAt, "BEAUTY PIE LIMITED");
  assert.deepEqual(held?.people, [{ name: "Anne Mansbridge", role: "trustee" }, { name: "Alan Milgate", role: "controller" }]);
});

test("no trust, nothing", () => {
  assert.equal(ownershipTrustFrom(ch([{ name: "Jane Doe", kind: "individual", controls: ["Ownership of shares – 75% or more"] }])), null);
  assert.equal(ownershipTrustFrom(null), null);
});

test("a trust holding the party itself", () => {
  const held = ownershipTrustFrom(ch([{ name: "John Smith", kind: "individual", controls: ["Ownership of shares – 75% or more as a trust"] }]));
  assert.equal(held?.heldAt, "PIE RETAIL LIMITED");
});

test("gap words", () => {
  const held = { heldAt: "BEAUTY PIE LIMITED", people: [] };
  assert.deepEqual(ownershipTrustGapWords(held, false, []), ["record the trust that holds BEAUTY PIE LIMITED and ask for its information"]);
  assert.deepEqual(ownershipTrustGapWords(held, true, ["Add the settlor."]), ["the trust that holds BEAUTY PIE LIMITED: Add the settlor"]);
});
