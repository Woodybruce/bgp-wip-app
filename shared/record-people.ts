// The people on a record, and what each login is sent about them
// (docs/contacts-board-plan-2026-11-13.md). The property page's People tab is
// the first board to read it: server/property-people.ts builds the entries and
// passes every one through recordPersonForViewer before it is sent.
//
// recordPersonForViewer is the one client rule: it builds each person afresh
// from an allow-list and never copies its input, so a field added to the feed
// reaches nobody until it is named here.

// The property board's groups, in the order a person is placed: a person sits
// in the first group any of their relationships puts them in.
export const PEOPLE_GROUPS = [
  { key: "bgp", label: "BGP team" },
  { key: "client", label: "Client's team" },
  { key: "owner", label: "Landlord and owner" },
  { key: "units", label: "Tenants and agents, by unit" },
  { key: "deals", label: "Others on deals" },
  { key: "advisers", label: "Advisers" },
  { key: "added", label: "Added by the team" },
] as const;
export type PeopleGroup = (typeof PEOPLE_GROUPS)[number]["key"];

// A person's role at one property (crm_property_clients.role), set by BGP staff
// for the owner's own people only.
export const PROPERTY_CLIENT_ROLES = [
  "Landlord Contact",
  "Asset Manager",
  "Property Manager",
  "Surveyor",
  "Legal",
  "Accounts",
  "Director",
  "Consultant",
  "Other",
] as const;

export type RoleSource = "set" | "derived";
export type RecordSide = "bgp" | "client" | "other";
export type RecordRef = { id: string; name: string };

export interface RecordRelationship {
  group: PeopleGroup;
  role: string;
  roleSource: RoleSource;
  // "staff": BGP staff only (viewings, offers, "In touch with BGP").
  visibility?: "all" | "staff";
  source?: string | null;
  deal?: RecordRef | null;
  scheduleRowId?: string | null;
  trackerId?: string | null;
  unitName?: string | null;
  status?: string | null;
}

// What the CRM plan holds for the person's company (server/crm-engagement.ts
// planForCompanies). BGP staff only.
export interface RecordPlan {
  openCount: number;
  hereCount: number;
  next: { id: string; title: string; dueAt: string | null; ownerName: string | null; here: boolean } | null;
  strategies: Array<{ id: string; name: string; contactIds: string[] }>;
}

export interface RecordPerson {
  // "contact:<id>", "user:<id>", "company:<id>", "tenancy:<schedule row id>" or "brief:<brief person id>".
  // A client login gets "company-entry:<n>" for a company it may not open.
  id: string;
  kind: "person" | "company";
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  // A client login is sent it only for a contact it may open.
  contactId?: string | null;
  // A client login is sent the id only for a company it may open.
  company: { id?: string; name: string } | null;
  group: PeopleGroup;
  side: RecordSide;
  roleOnRecord: string;
  roleSource: RoleSource;
  relationships: RecordRelationship[];
  // BGP staff only: the key is absent from a client login's reply.
  companyKind?: "landlord" | "brand" | "other";
  ownerPerson?: boolean;
  source?: "assigned" | "deals" | "account" | "brief" | "evidence";
  via?: string | null;
  lastContactAt?: string | null;
  lastContactPerson?: RecordRef | null;
  plan?: RecordPlan | null;
  addedBy?: string | null;
  leftAt?: string | null;
}

// The entry as the feed builds it, before the rule: whether a client login may
// open the contact and the company (the portfolio board's slice rule).
export type RecordPersonSource = Omit<RecordPerson, "company"> & {
  company: { id: string | null; name: string } | null;
  canOpenContact: boolean;
  canOpenCompany: boolean;
};

export interface RecordPeopleViewer {
  staff: boolean;
  canSetRoles: boolean;
  canAddActions: boolean;
  canPinHide: boolean;
}

export interface RecordPeopleReply {
  people: RecordPerson[];
  hiddenCount: number;
  viewer: RecordPeopleViewer;
  // BGP staff only: "unavailable" when the CRM plan could not be read.
  plan?: "ok" | "unavailable";
}

export const recordViewer = (staff: boolean): RecordPeopleViewer =>
  ({ staff, canSetRoles: staff, canAddActions: staff, canPinHide: true });

const groupRank = (group: string) => {
  const i = PEOPLE_GROUPS.findIndex(g => g.key === group);
  return i < 0 ? PEOPLE_GROUPS.length : i;
};

export function groupOf(rels: Array<Pick<RecordRelationship, "group">>): PeopleGroup {
  let best: PeopleGroup = "added";
  for (const rel of rels) if (groupRank(rel.group) < groupRank(best)) best = rel.group;
  return best;
}

// The first role someone set, in group order; else the derived role of the
// relationship that decided the group.
export function roleOnRecord(rels: Array<Pick<RecordRelationship, "group" | "role" | "roleSource">>): { role: string; roleSource: RoleSource } {
  const ordered = [...rels].sort((a, b) => groupRank(a.group) - groupRank(b.group));
  const set = ordered.find(r => r.roleSource === "set" && r.role);
  if (set) return { role: set.role, roleSource: "set" };
  return { role: ordered[0]?.role || "", roleSource: "derived" };
}

export const sideOf = (group: PeopleGroup): RecordSide =>
  group === "bgp" ? "bgp" : group === "client" || group === "owner" ? "client" : "other";

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const ref = (value: RecordRef | null | undefined): RecordRef | null =>
  value && typeof value.id === "string" && typeof value.name === "string" ? { id: value.id, name: value.name } : null;

function relationshipFor(rel: RecordRelationship, staff: boolean): RecordRelationship {
  if (!staff && rel.group === "bgp") return { group: rel.group, role: rel.role, roleSource: rel.roleSource };
  const out: RecordRelationship = {
    group: rel.group, role: rel.role, roleSource: rel.roleSource,
    deal: ref(rel.deal), scheduleRowId: str(rel.scheduleRowId), trackerId: str(rel.trackerId),
    unitName: str(rel.unitName), status: str(rel.status),
  };
  if (staff) {
    out.visibility = rel.visibility === "staff" ? "staff" : "all";
    out.source = str(rel.source);
  }
  return out;
}

// The one rule for what a login is sent about a person. Returns null when a
// client login may see none of the person's relationships.
export function recordPersonForViewer(p: RecordPersonSource, viewer: { staff: boolean }): RecordPerson | null {
  const staff = viewer.staff === true;
  const rels = (p.relationships || [])
    .filter(rel => staff || rel.visibility === "all")
    .map(rel => relationshipFor(rel, staff));
  if (!rels.length) return null;
  const group = groupOf(rels);
  const role = roleOnRecord(rels);
  const company = p.company
    ? ((staff || p.canOpenCompany) && str(p.company.id) ? { id: p.company.id as string, name: p.company.name } : { name: p.company.name })
    : null;
  const out: RecordPerson = {
    id: p.id, kind: p.kind, name: p.name, jobTitle: str(p.jobTitle), email: str(p.email), phone: str(p.phone),
    company, group, side: sideOf(group), roleOnRecord: role.role, roleSource: role.roleSource, relationships: rels,
  };
  if (staff) out.contactId = str(p.contactId);
  else if (p.canOpenContact && str(p.contactId)) out.contactId = str(p.contactId);
  if (!staff) return out;
  out.companyKind = p.companyKind === "landlord" || p.companyKind === "brand" ? p.companyKind : "other";
  out.ownerPerson = p.ownerPerson === true;
  out.source = p.source;
  out.via = str(p.via);
  out.lastContactAt = str(p.lastContactAt);
  out.lastContactPerson = ref(p.lastContactPerson);
  out.plan = p.plan ? {
    openCount: p.plan.openCount, hereCount: p.plan.hereCount,
    next: p.plan.next ? { id: p.plan.next.id, title: p.plan.next.title, dueAt: p.plan.next.dueAt, ownerName: p.plan.next.ownerName, here: p.plan.next.here } : null,
    strategies: p.plan.strategies.map(s => ({ id: s.id, name: s.name, contactIds: [...s.contactIds] })),
  } : null;
  out.addedBy = str(p.addedBy);
  out.leftAt = str(p.leftAt);
  return out;
}

const compare = (a: string, b: string) => a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true }) || a.localeCompare(b, "en-GB");

// Within a group: set roles first, then names A to Z. Never by recency.
export function sortRecordPeople<T extends Pick<RecordPerson, "group" | "roleSource" | "name" | "id">>(people: T[]): T[] {
  return [...people].sort((a, b) => groupRank(a.group) - groupRank(b.group)
    || Number(b.roleSource === "set") - Number(a.roleSource === "set")
    || compare(a.name, b.name) || compare(a.id, b.id));
}

type UnitKey = { scheduleRowId?: string | null; trackerId?: string | null };
const onUnit = (rel: UnitKey, unit: UnitKey) =>
  (!!rel.scheduleRowId && rel.scheduleRowId === unit.scheduleRowId) || (!!rel.trackerId && rel.trackerId === unit.trackerId);

// The people with a relationship on this unit, matched by schedule row or
// tracker row, never by name.
export function peopleOnUnit<T extends Pick<RecordPerson, "relationships">>(people: T[], unit: UnitKey): T[] {
  return people.filter(p => p.relationships.some(rel => onUnit(rel, unit)));
}

// The people on none of these units ("Not tied to a unit").
export function unplaced<T extends Pick<RecordPerson, "relationships">>(people: T[], units: UnitKey[]): T[] {
  return people.filter(p => !p.relationships.some(rel => units.some(unit => onUnit(rel, unit))));
}

// Where an action added from a person sits on the CRM plan. Only a brand
// action at a property one of the share partners has as a scheme carries a
// place (as the action form would show it); a landlord action never does.
export function actionPlaceFor(
  propertyId: string, scheduleRowId: string | null,
  sharePartners: Array<{ schemes: Array<{ propertyIds: string[] }> }> | null | undefined,
  kind: "landlord" | "brand",
): { propertyId: string | null; tenancyUnitId: string | null } {
  const atScheme = kind === "brand" && (sharePartners || []).some(partner => partner.schemes.some(s => s.propertyIds.includes(propertyId)));
  return atScheme ? { propertyId, tenancyUnitId: scheduleRowId || null } : { propertyId: null, tenancyUnitId: null };
}
