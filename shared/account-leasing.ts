export interface AccountLeasingUnit {
  id: string;
  name: string;
  status: string | null;
  href: string;
  dealHref: string | null;
}
export interface AccountLeasingProperty {
  id: string;
  name: string;
  href: string;
  trackerHref: string;
  viewingsHref: string;
  units: AccountLeasingUnit[];
}
export interface AccountLeasingAgent {
  userId: string;
  name: string;
  contexts: Array<{
    propertyId: string | null;
    propertyName: string | null;
    role: string;
    basis: "saved_role" | "property_team" | "deal_record";
    href: string;
    label: string;
  }>;
}
export interface AccountLeasingViewing {
  id: string;
  propertyId: string;
  propertyName: string;
  unitId: string | null;
  unitName: string;
  brandId: string | null;
  brandName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  date: string;
  time: string | null;
  status: string;
  outcome: string | null;
  detailsConfirmed: boolean;
  nextAction: string | null;
  followUpDate: string | null;
  href: string;
  propertyHref: string;
  trackerHref: string;
}
export interface AccountLeasingAction {
  taskId: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  ownerId: string;
  ownerName: string | null;
  viewingId: string;
  propertyId: string;
  propertyName: string;
  href: string;
  propertyHref: string;
  trackerHref: string;
}
export interface AccountLeasingData {
  checkedAt: string;
  properties: AccountLeasingProperty[];
  agents: AccountLeasingAgent[];
  upcomingViewings: AccountLeasingViewing[];
  recentViewings: AccountLeasingViewing[];
  nextActions: AccountLeasingAction[];
  issues: string[];
}
