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

// The client Agents page in three sections (Woody, 2026-11-12: "its Joint
// agents ie us and then the other joint agents and then the rest are tenant
// rep agents"): GET /api/client/agents-overview.
export interface ClientAgentScheme {
  key: string;
  name: string;
  group: string;
}

// A BGP person on the account. Every field comes from HR (users +
// staff_profiles); the personnel sheet only says who is on which scheme.
export interface ClientBgpPerson {
  key: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  lead: string[];      // Landsec: scheme keys they lead
  support: string[];   // Landsec: scheme keys they support
  isLead: boolean;     // other clients: marked lead on the client's team board
  covers: string[];    // other clients: the client's properties they work on
}

// How a joint agency firm's name was established: the joint-agent login's
// firm, the CRM company of the matching contact, or the scheme's named
// joint agency on the instruction.
export type ClientJointFirmSource = "login" | "crm" | "scheme";

export interface ClientJointAgentPerson {
  key: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  schemes: string[];
  // Where the email / phone came from; null = none recorded.
  detailSource: "crm" | "login" | null;
  // What places this person at the firm; empty under "firm not confirmed".
  firmSources: ClientJointFirmSource[];
}

export interface ClientJointAgentFirm {
  key: string;
  name: string | null; // null = firm not confirmed
  firmSources: ClientJointFirmSource[];
  schemes: string[];
  people: ClientJointAgentPerson[];
}

export interface ClientAgentsOverview {
  viewer: "landsec" | "client";
  schemes: ClientAgentScheme[];        // Landsec only
  bgp: ClientBgpPerson[];
  jointAgents: ClientJointAgentFirm[]; // Landsec only
  tenantReps: ClientAgentDirectoryEntry[];
  // Landsec only: brand id → the scheme keys the brand is being targeted at,
  // for the brands in tenantReps. The scheme filter narrows tenant reps by it.
  brandSchemes: Record<string, string[]>;
}
