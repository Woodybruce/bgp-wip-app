export type PortfolioContactGroup = "internal" | "deals" | "tenants" | "consultants";

export interface PortfolioRecordRef {
  id: string;
  name: string;
}

export interface PortfolioContactRelationship {
  group: PortfolioContactGroup;
  source: string;
  property: PortfolioRecordRef | null;
  deal?: PortfolioRecordRef | null;
  // A property_units ID, when resolved. Tracker IDs are separate records.
  unit?: PortfolioRecordRef | null;
  trackerId?: string | null;
  unitName?: string | null;
  status?: string | null;
  confirmed: boolean;
}

export interface PortfolioContactEntry {
  id: string;
  kind: "person" | "company" | "unit";
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  contactId: string | null;
  company: PortfolioRecordRef | null;
  canOpenContact: boolean;
  canOpenCompany: boolean;
  side?: "bgp" | "client";
  relationships: PortfolioContactRelationship[];
}

export interface PortfolioContactsResponse {
  entries: PortfolioContactEntry[];
  properties: PortfolioRecordRef[];
}
