export type ClientAgentSource = "representation" | "requirement";

export interface ClientAgentBrand {
  brandId: string;
  brandName: string;
  sources: ClientAgentSource[];
  regions: string[];
}

export interface ClientAgentContact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  specialty: string | null;
  represents: ClientAgentBrand[];
}

export interface ClientAgentDirectoryEntry {
  id: string;
  name: string;
  domain: string | null;
  companyType: string | null;
  kind: "firm" | "contact";
  companyId: string | null;
  contacts: ClientAgentContact[];
  represents: ClientAgentBrand[];
}
