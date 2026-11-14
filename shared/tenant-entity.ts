// The tenant on a tenancy schedule row: the brand (tenant_company_id), the
// company on the lease (tenant_entity_id, a crm_trading_entities row under
// that brand), the lease name (tenant_name) and the trading name
// (trading_name). Woody, 2026-11-13: the trading-as name is linked to the
// brand, and "their actual AML contracted company name is often different and
// should be a sub company within the brands". The build plan is
// docs/property-page-rebuild-2026-11-13.md.
//
// planTenantWrite is the ONE decision for a write to those four columns. It
// takes the row as it is, what the person sent and facts the server read in
// one query, and answers what to store, or why not. server/tenancy-tenant.ts
// is the only code that acts on it. The lease name is the landlord's text and
// the trading name is what people typed: neither is ever overwritten from the
// brand or the company. The Tenant column used to be picker-only ("Free-text
// input is intentionally not offered"); that is reversed: the CRM links are
// the brand line and the company line, set by a person.
import { namedTenant } from "./property-units";

export type TenantViewer = "staff" | "client";

export interface TenantRowState {
  tenant_name: string | null;
  trading_name: string | null;
  tenant_company_id: string | null;
  tenant_entity_id: string | null;
}

/** What a person sent. A field left out is unchanged; null clears it. */
export interface TenantWriteInput {
  companyId?: string | null;
  tradingName?: string | null;
  tenantName?: string | null;
  entityId?: string | null;
  createEntity?: { name: string; companiesHouseNumber?: string | null };
}

/** Read by the server in one query (keys through brandNameKeySql). */
export interface TenantWriteFacts {
  /** The brand in input.companyId: survivor is the live brand it was merged into. Null when there is no such company. */
  pickedBrand: { id: string; mergedInto: string | null; survivor: string | null } | null;
  /** The company in input.entityId, its brand merge-resolved (null when that brand is itself merged away or missing). */
  entity: { id: string; parentId: string | null } | null;
  /** The company already on the row, its brand merge-resolved. */
  currentEntity: { id: string; parentId: string | null } | null;
  oldLeaseKey: string;
  newLeaseKey: string;
  oldTradingKey: string;
  newTradingKey: string;
  /** The name key of the company already on the row. */
  entityKey: string;
  /** The old trading or lease key is the stored brand's name key or one of its trading-entity alias keys. */
  storedBrandMatchesOldNames: boolean;
  /** The same for the new names. */
  storedBrandMatchesNewNames: boolean;
  /** The one brand the new trading name matches, or the new lease name when there is no trading name; null on none or a tie. */
  nameMatch: string | null;
  /** The brand already on the row was merged into another record. */
  storedBrandMerged: boolean;
}

export type TenantRefusalCode =
  | "ROW_NOT_FOUND" | "ADD_TO_SCHEDULE_FIRST" | "BRAND_NOT_FOUND" | "BRAND_MERGED" | "BRAND_NOT_IN_LIST"
  | "ENTITY_NOT_FOUND" | "ENTITY_NOT_UNDER_BRAND" | "BRAND_FIRST" | "ENTITY_NAME_REQUIRED"
  | "STAFF_ONLY";

export const TENANT_ENTITY_REFUSALS: Record<TenantRefusalCode, { status: number; message: string }> = {
  ROW_NOT_FOUND: { status: 404, message: "This schedule row was not found." },
  ADD_TO_SCHEDULE_FIRST: { status: 400, message: "Add this unit to the schedule first." },
  BRAND_NOT_FOUND: { status: 404, message: "That brand was not found." },
  BRAND_MERGED: { status: 409, message: "That brand was merged into another record that is no longer live. Pick the brand again." },
  BRAND_NOT_IN_LIST: { status: 403, message: "That brand is not in your brand list." },
  ENTITY_NOT_FOUND: { status: 404, message: "That company was not found." },
  ENTITY_NOT_UNDER_BRAND: { status: 409, message: "That company belongs to a different brand." },
  BRAND_FIRST: { status: 409, message: "Set the brand first, then the company on the lease." },
  ENTITY_NAME_REQUIRED: { status: 400, message: "Give the company's name." },
  STAFF_ONLY: { status: 403, message: "Only BGP can set the company on the lease." },
};

/** What the write did, for the reply and the audit note. */
export type TenantWriteNote =
  | "brand_cleared_vacated" | "entity_cleared_vacated"
  | "brand_picked" | "brand_cleared"
  | "entity_picked" | "entity_unlinked" | "entity_created"
  | "entity_cleared_lease_name_changed" | "entity_cleared_brand_changed"
  | "brand_from_name" | "brand_moved_to_name_match" | "brand_name_differs";

export interface TenantWritePlan {
  /** The four columns as they are to be stored. tenant_entity_id is null while create is pending. */
  set: TenantRowState;
  notes: TenantWriteNote[];
  /** A company to make under the brand and link (staff only, a person's createEntity). */
  create?: { parentCompanyId: string; name: string; companiesHouseNumber: string | null };
  refusal?: TenantRefusalCode;
}

/** R1: a typed name, trimmed; an empty one is no name. */
export const cleanName = (value: string | null | undefined): string | null => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

/** The two names after this write (R1), which the facts query keys. */
export function nextTenantText(current: Pick<TenantRowState, "tenant_name" | "trading_name">, input: TenantWriteInput) {
  return {
    tenant_name: "tenantName" in input ? cleanName(input.tenantName) : current.tenant_name,
    trading_name: "tradingName" in input ? cleanName(input.tradingName) : current.trading_name,
  };
}

const refuse = (current: TenantRowState, refusal: TenantRefusalCode): TenantWritePlan => ({ set: { ...current }, notes: [], refusal });

export function planTenantWrite(current: TenantRowState, input: TenantWriteInput, facts: TenantWriteFacts, viewer: TenantViewer): TenantWritePlan {
  const notes: TenantWriteNote[] = [];
  const nameSent = "tenantName" in input || "tradingName" in input;
  const brandSent = "companyId" in input;
  const entitySent = "entityId" in input;
  const createSent = input.createEntity !== undefined;
  const picked = brandSent || entitySent || createSent;

  // R8: the company on the lease is BGP's to set. A client's change of brand,
  // vacancy or lease name still takes it off by R2, R5 and R7 (Woody, 2026-11-13: "let it through").
  if (viewer === "client" && (entitySent || createSent)) return refuse(current, "STAFF_ONLY");

  // R1 Text.
  const text = nextTenantText(current, input);
  let brand = current.tenant_company_id;
  let entity = current.tenant_entity_id;
  let create: TenantWritePlan["create"];

  // R2 Vacated: no tenant named any more, and no brand picked.
  if (nameSent && !brandSent && !namedTenant(text.trading_name, text.tenant_name)) {
    if (brand) notes.push("brand_cleared_vacated");
    if (entity) notes.push("entity_cleared_vacated");
    brand = null;
    entity = null;
  }

  // R3 Picked brand.
  if (brandSent) {
    if (input.companyId == null) {
      if (brand) notes.push("brand_cleared");
      brand = null;
    } else {
      const pb = facts.pickedBrand;
      if (!pb) return refuse(current, "BRAND_NOT_FOUND");
      if (pb.mergedInto && !pb.survivor) return refuse(current, "BRAND_MERGED");
      brand = pb.mergedInto ? pb.survivor : pb.id;
      notes.push("brand_picked");
    }
  }

  // R4 Picked entity, or one to create. Never under a stored brand that was merged away.
  if (!brandSent && brand && facts.storedBrandMerged && ((entitySent && input.entityId != null) || createSent)) return refuse(current, "BRAND_MERGED");
  if (entitySent) {
    if (input.entityId == null) {
      if (entity) notes.push("entity_unlinked");
      entity = null;
    } else {
      const fe = facts.entity;
      if (!fe) return refuse(current, "ENTITY_NOT_FOUND");
      if (!fe.parentId) return refuse(current, "BRAND_MERGED");
      if (!brand) brand = fe.parentId;
      else if (fe.parentId !== brand) return refuse(current, "ENTITY_NOT_UNDER_BRAND");
      entity = fe.id;
      notes.push("entity_picked");
    }
  } else if (createSent) {
    const name = cleanName(input.createEntity?.name);
    if (!name) return refuse(current, "ENTITY_NAME_REQUIRED");
    if (!brand) return refuse(current, "BRAND_FIRST");
    create = { parentCompanyId: brand, name, companiesHouseNumber: cleanName(input.createEntity?.companiesHouseNumber) };
    entity = null;
    notes.push("entity_created");
  }

  if (!picked && nameSent) {
    // R5 Lease name changed to another company: a new tenant must not show the old one's covenant.
    if (entity && facts.newLeaseKey !== facts.oldLeaseKey && facts.newLeaseKey !== facts.entityKey) {
      entity = null;
      notes.push("entity_cleared_lease_name_changed");
    }
    // R6 The brand follows a name edit only where a machine made the link.
    const namesChanged = facts.newLeaseKey !== facts.oldLeaseKey || facts.newTradingKey !== facts.oldTradingKey;
    if (!brand && namedTenant(text.trading_name, text.tenant_name)) {
      if (facts.nameMatch) { brand = facts.nameMatch; notes.push("brand_from_name"); }
    } else if (brand && brand === current.tenant_company_id) {
      // Made from the old names by a machine: no company on the row, and the old names matched it.
      const machineMade = !current.tenant_entity_id && facts.storedBrandMatchesOldNames;
      if (machineMade && namesChanged && facts.nameMatch && facts.nameMatch !== brand) {
        brand = facts.nameMatch;
        notes.push("brand_moved_to_name_match");
      } else if (namesChanged && !facts.storedBrandMatchesNewNames) {
        notes.push("brand_name_differs");
      }
    }
  }

  // R7 Brand changed: a company not under the new brand comes off.
  if (entity && entity === current.tenant_entity_id && brand !== current.tenant_company_id) {
    if (!brand || facts.currentEntity?.parentId !== brand) {
      entity = null;
      notes.push("entity_cleared_brand_changed");
    }
  }

  return { set: { ...text, tenant_company_id: brand, tenant_entity_id: entity }, notes, ...(create ? { create } : {}) };
}

export type LeaseCompanyState = "linked" | "none" | "lease_in_brand_name" | "no_brand";

/** Where the row stands on the company on the lease. leaseInBrandName comes from
 *  SQL: no company, and the lease name's key is the brand's or the trading name's. */
export function leaseCompanyState(row: { tenant_entity_id?: string | null; tenant_company_id?: string | null; lease_in_brand_name?: boolean | null }): LeaseCompanyState {
  if (row.tenant_entity_id) return "linked";
  if (!row.tenant_company_id) return "no_brand";
  if (row.lease_in_brand_name) return "lease_in_brand_name";
  return "none";
}
