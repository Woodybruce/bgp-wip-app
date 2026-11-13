// The tenant rules for a schedule row (shared/tenant-entity.ts). No database:
// the facts the server reads are handed in.
//   node --import tsx --test shared/tenant-entity.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { leaseCompanyState, planTenantWrite, TENANT_ENTITY_REFUSALS, type TenantRowState, type TenantWriteFacts } from "./tenant-entity";

const row = (over: Partial<TenantRowState> = {}): TenantRowState => ({
  tenant_name: "ITX UK Limited", trading_name: "Zara", tenant_company_id: "zara", tenant_entity_id: null, ...over,
});
const facts = (over: Partial<TenantWriteFacts> = {}): TenantWriteFacts => ({
  pickedBrand: null, entity: null, currentEntity: null,
  oldLeaseKey: "itx", newLeaseKey: "itx", oldTradingKey: "zara", newTradingKey: "zara",
  entityKey: "", storedBrandMatchesOldNames: true, storedBrandMatchesNewNames: true, nameMatch: null, storedBrandMerged: false, ...over,
});
const linked = (over: Partial<TenantRowState> = {}) => row({ tenant_entity_id: "itx-uk", ...over });
const linkedFacts = (over: Partial<TenantWriteFacts> = {}) => facts({ currentEntity: { id: "itx-uk", parentId: "zara" }, entityKey: "itx", ...over });

test("a name edit that matches nothing keeps the brand (defect 2)", () => {
  const plan = planTenantWrite(row(), { tradingName: "Zara Home" }, facts({ newTradingKey: "zara home", storedBrandMatchesNewNames: false, nameMatch: null }), "staff");
  assert.equal(plan.refusal, undefined);
  assert.equal(plan.set.tenant_company_id, "zara");
  assert.equal(plan.set.trading_name, "Zara Home");
  assert.deepEqual(plan.notes, ["brand_name_differs"]);
});

test("a tie keeps the stored brand, or leaves none (defect 3)", () => {
  const kept = planTenantWrite(row(), { tradingName: "Shared" }, facts({ newTradingKey: "shared", storedBrandMatchesNewNames: false, nameMatch: null }), "staff");
  assert.equal(kept.set.tenant_company_id, "zara");
  const none = planTenantWrite(row({ tenant_company_id: null }), { tradingName: "Shared" }, facts({ newTradingKey: "shared", storedBrandMatchesOldNames: false, nameMatch: null }), "staff");
  assert.equal(none.set.tenant_company_id, null);
});

test("a NULL brand is filled from the one brand the names match", () => {
  const plan = planTenantWrite(row({ tenant_company_id: null }), { tradingName: "Zara" }, facts({ nameMatch: "zara" }), "staff");
  assert.equal(plan.set.tenant_company_id, "zara");
  assert.deepEqual(plan.notes, ["brand_from_name"]);
});

test("VACANT clears the brand and the company", () => {
  for (const name of ["VACANT", "", "  ", "-"]) {
    const plan = planTenantWrite(linked({ trading_name: null }), { tenantName: name }, linkedFacts({ newLeaseKey: "vacant" }), "staff");
    assert.equal(plan.set.tenant_company_id, null, name);
    assert.equal(plan.set.tenant_entity_id, null, name);
    assert.ok(plan.notes.includes("entity_cleared_vacated"));
  }
  assert.equal(planTenantWrite(row(), { tenantName: "" }, facts(), "staff").set.tenant_name, null, "an empty name is stored as no name");
});

test("a picked brand wins, merged brands resolve to their survivor", () => {
  const picked = planTenantWrite(row(), { companyId: "next" }, facts({ pickedBrand: { id: "next", mergedInto: null, survivor: null }, nameMatch: "zara" }), "staff");
  assert.equal(picked.set.tenant_company_id, "next");
  const merged = planTenantWrite(row(), { companyId: "old" }, facts({ pickedBrand: { id: "old", mergedInto: "new", survivor: "new" } }), "staff");
  assert.equal(merged.set.tenant_company_id, "new");
  assert.equal(planTenantWrite(row(), { companyId: "old" }, facts({ pickedBrand: { id: "old", mergedInto: "gone", survivor: null } }), "staff").refusal, "BRAND_MERGED");
  assert.equal(planTenantWrite(row(), { companyId: "nope" }, facts(), "staff").refusal, "BRAND_NOT_FOUND");
  const cleared = planTenantWrite(row(), { companyId: null }, facts(), "staff");
  assert.equal(cleared.set.tenant_company_id, null);
});

test("a picked brand on a vacant row is kept", () => {
  const plan = planTenantWrite(row({ tenant_name: null, trading_name: null, tenant_company_id: null }), { companyId: "zara", tradingName: "" }, facts({ pickedBrand: { id: "zara", mergedInto: null, survivor: null } }), "staff");
  assert.equal(plan.set.tenant_company_id, "zara");
});

test("a hand-picked brand with a company survives a trading-name edit that matches another brand", () => {
  const plan = planTenantWrite(linked(), { tradingName: "Bershka" }, linkedFacts({ newTradingKey: "bershka", storedBrandMatchesNewNames: false, nameMatch: "bershka" }), "staff");
  assert.equal(plan.set.tenant_company_id, "zara");
  assert.equal(plan.set.tenant_entity_id, "itx-uk");
  assert.deepEqual(plan.notes, ["brand_name_differs"]);
});

test("a machine-made brand with no company follows a new unique match; a hand-set one does not", () => {
  const moved = planTenantWrite(row(), { tradingName: "Bershka" }, facts({ newTradingKey: "bershka", storedBrandMatchesNewNames: false, nameMatch: "bershka" }), "staff");
  assert.equal(moved.set.tenant_company_id, "bershka");
  assert.deepEqual(moved.notes, ["brand_moved_to_name_match"]);
  const handSet = planTenantWrite(row(), { tradingName: "Bershka" }, facts({ newTradingKey: "bershka", storedBrandMatchesOldNames: false, storedBrandMatchesNewNames: false, nameMatch: "bershka" }), "staff");
  assert.equal(handSet.set.tenant_company_id, "zara");
  const unchanged = planTenantWrite(row(), { tradingName: "ZARA " }, facts({ nameMatch: "other" }), "staff");
  assert.equal(unchanged.set.tenant_company_id, "zara", "a formatting edit never moves the brand");
  assert.equal(unchanged.set.trading_name, "ZARA");
});

test("a lease-name edit to a new key clears the company; the same key keeps it", () => {
  const cleared = planTenantWrite(linked(), { tenantName: "H&M Hennes Ltd" }, linkedFacts({ newLeaseKey: "h m hennes" }), "staff");
  assert.equal(cleared.set.tenant_entity_id, null);
  assert.equal(cleared.set.tenant_company_id, "zara");
  assert.ok(cleared.notes.includes("entity_cleared_lease_name_changed"));
  const kept = planTenantWrite(linked(), { tenantName: "ITX UK LTD" }, linkedFacts(), "staff");
  assert.equal(kept.set.tenant_entity_id, "itx-uk");
  const toEntityName = planTenantWrite(linked({ tenant_name: "Zara" }), { tenantName: "ITX UK Limited" }, linkedFacts({ oldLeaseKey: "zara", newLeaseKey: "itx" }), "staff");
  assert.equal(toEntityName.set.tenant_entity_id, "itx-uk", "typing the company's own name keeps it");
});

test("a brand change clears a company not under the new brand, keeps one that is", () => {
  const plan = planTenantWrite(linked(), { companyId: "next" }, linkedFacts({ pickedBrand: { id: "next", mergedInto: null, survivor: null } }), "staff");
  assert.equal(plan.set.tenant_company_id, "next");
  assert.equal(plan.set.tenant_entity_id, null);
  assert.ok(plan.notes.includes("entity_cleared_brand_changed"));
  const survivor = planTenantWrite(linked({ tenant_company_id: "zara-old" }), { companyId: "zara" }, linkedFacts({ pickedBrand: { id: "zara", mergedInto: null, survivor: null } }), "staff");
  assert.equal(survivor.set.tenant_entity_id, "itx-uk", "the company's brand, merge-resolved, is the new brand");
});

test("a company under another brand is refused; one on a brandless row sets the brand", () => {
  assert.equal(planTenantWrite(row(), { entityId: "hm" }, facts({ entity: { id: "hm", parentId: "hm-brand" } }), "staff").refusal, "ENTITY_NOT_UNDER_BRAND");
  const set = planTenantWrite(row({ tenant_company_id: null }), { entityId: "itx-uk" }, facts({ entity: { id: "itx-uk", parentId: "zara" } }), "staff");
  assert.equal(set.set.tenant_company_id, "zara");
  assert.equal(set.set.tenant_entity_id, "itx-uk");
  assert.equal(planTenantWrite(row(), { entityId: "nope" }, facts(), "staff").refusal, "ENTITY_NOT_FOUND");
  assert.equal(planTenantWrite(row(), { entityId: "orphan" }, facts({ entity: { id: "orphan", parentId: null } }), "staff").refusal, "BRAND_MERGED");
  const unlinked = planTenantWrite(linked(), { entityId: null }, linkedFacts(), "staff");
  assert.equal(unlinked.set.tenant_entity_id, null);
  assert.equal(unlinked.set.tenant_company_id, "zara");
});

test("createEntity asks for a company under the resulting brand; with no brand, brand first", () => {
  const plan = planTenantWrite(row(), { createEntity: { name: " ITX UK Limited ", companiesHouseNumber: "01234567" } }, facts(), "staff");
  assert.deepEqual(plan.create, { parentCompanyId: "zara", name: "ITX UK Limited", companiesHouseNumber: "01234567" });
  assert.equal(planTenantWrite(row({ tenant_company_id: null }), { createEntity: { name: "ITX" } }, facts(), "staff").refusal, "BRAND_FIRST");
  assert.equal(planTenantWrite(row(), { createEntity: { name: " " } }, facts(), "staff").refusal, "ENTITY_NAME_REQUIRED");
  // Never under a stored brand that was merged away; picking the brand again first is fine.
  assert.equal(planTenantWrite(row(), { createEntity: { name: "ITX" } }, facts({ storedBrandMerged: true }), "staff").refusal, "BRAND_MERGED");
  assert.equal(planTenantWrite(row(), { entityId: "itx-uk" }, facts({ storedBrandMerged: true, entity: { id: "itx-uk", parentId: "zara" } }), "staff").refusal, "BRAND_MERGED");
  const repicked = planTenantWrite(row(), { companyId: "zara", createEntity: { name: "ITX" } }, facts({ storedBrandMerged: true, pickedBrand: { id: "zara", mergedInto: null, survivor: null } }), "staff");
  assert.equal(repicked.refusal, undefined);
});

test("a client may not pick or create the company on the lease", () => {
  assert.equal(planTenantWrite(row(), { entityId: "itx-uk" }, facts({ entity: { id: "itx-uk", parentId: "zara" } }), "client").refusal, "STAFF_ONLY");
  assert.equal(planTenantWrite(row(), { createEntity: { name: "ITX" } }, facts(), "client").refusal, "STAFF_ONLY");
  assert.equal(TENANT_ENTITY_REFUSALS.STAFF_ONLY.status, 403);
});

test("a client's vacate, re-brand or lease rename on a row BGP linked goes through and takes the company off", () => {
  const vacated = planTenantWrite(linked({ trading_name: null }), { tenantName: "VACANT" }, linkedFacts({ newLeaseKey: "vacant" }), "client");
  assert.equal(vacated.refusal, undefined);
  assert.equal(vacated.set.tenant_entity_id, null);
  assert.equal(vacated.set.tenant_company_id, null);
  assert.ok(vacated.notes.includes("entity_cleared_vacated"));
  const rebranded = planTenantWrite(linked(), { companyId: "next" }, linkedFacts({ pickedBrand: { id: "next", mergedInto: null, survivor: null } }), "client");
  assert.equal(rebranded.refusal, undefined);
  assert.equal(rebranded.set.tenant_company_id, "next");
  assert.equal(rebranded.set.tenant_entity_id, null);
  assert.ok(rebranded.notes.includes("entity_cleared_brand_changed"));
  const renamed = planTenantWrite(linked(), { tenantName: "H&M Hennes Ltd" }, linkedFacts({ newLeaseKey: "h m hennes" }), "client");
  assert.equal(renamed.refusal, undefined);
  assert.equal(renamed.set.tenant_entity_id, null);
  assert.ok(renamed.notes.includes("entity_cleared_lease_name_changed"));
  assert.equal("ENTITY_SET_BY_BGP" in TENANT_ENTITY_REFUSALS, false);
  // A change that leaves the company where it belongs keeps it.
  assert.equal(planTenantWrite(linked(), { tradingName: "Zara Home" }, linkedFacts({ newTradingKey: "zara home" }), "client").set.tenant_entity_id, "itx-uk");
  assert.equal(planTenantWrite(linked(), { tenantName: "ITX UK LTD" }, linkedFacts(), "client").set.tenant_entity_id, "itx-uk");
  assert.equal(planTenantWrite(row(), { companyId: "next" }, facts({ pickedBrand: { id: "next", mergedInto: null, survivor: null } }), "client").set.tenant_company_id, "next");
});

test("leaseCompanyState, all four states", () => {
  assert.equal(leaseCompanyState({ tenant_entity_id: "e", tenant_company_id: "b" }), "linked");
  assert.equal(leaseCompanyState({ tenant_entity_id: null, tenant_company_id: null }), "no_brand");
  assert.equal(leaseCompanyState({ tenant_entity_id: null, tenant_company_id: "b", lease_in_brand_name: true }), "lease_in_brand_name");
  assert.equal(leaseCompanyState({ tenant_entity_id: null, tenant_company_id: "b", lease_in_brand_name: false }), "none");
});

test("refusal wording is plain sentence case with no arrows", () => {
  for (const { message } of Object.values(TENANT_ENTITY_REFUSALS)) {
    assert.match(message, /^[A-Z][^→<>]*\.$/);
  }
});
