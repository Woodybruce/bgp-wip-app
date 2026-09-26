// The roles a third-party agent plays relative to BGP (Woody, 2026-09-26).
// A role belongs to a relationship, not a firm — the same firm can be BGP's
// competitor on one scheme, the other side on another and a joint agent on
// a third — so a firm's roles are derived from its actual relationships.
// Older fields are mapped in: representation / company agent_type
// (tenant_rep | landlord_rep | investment) and contact agent_specialty
// (Leasing | Investment | Tenant Rep | Lease Advisory).
export type AgentRole = "letting" | "tenant_rep" | "investment_sell" | "investment_buy" | "lease_advisory" | "joint_agent";

export const AGENT_ROLES: Array<{ role: AgentRole; label: string; short: string; description: string }> = [
  { role: "letting", label: "Letting agent", short: "Letting", description: "Acts for landlords letting space — competitor for instructions, the other side when BGP acts for a tenant." },
  { role: "tenant_rep", label: "Tenant rep", short: "Tenant rep", description: "Acts for brands finding space — sends requirements and brings tenants to BGP's units." },
  { role: "investment_sell", label: "Investment (selling)", short: "Sell-side", description: "Acts for vendors — competitor for sale instructions, the other side when BGP buys." },
  { role: "investment_buy", label: "Investment (buying)", short: "Buy-side", description: "Acts for purchasers — brings bidders to BGP's sales." },
  { role: "lease_advisory", label: "Other-side surveyor", short: "Lease advisory", description: "The opposite surveyor on rent reviews and renewals." },
  { role: "joint_agent", label: "Joint agent", short: "Joint agent", description: "Shares an instruction with BGP." },
];

export const agentRoleLabel = (role: AgentRole) => AGENT_ROLES.find(r => r.role === role)?.label || role;

// Representation / company agent_type → role.
export function roleFromAgentType(agentType: string | null | undefined): AgentRole | null {
  switch ((agentType || "").toLowerCase()) {
    case "tenant_rep": return "tenant_rep";
    case "landlord_rep": return "letting";
    case "investment": return "investment_sell";
    default: return null;
  }
}

// Contact agent_specialty → role.
export function roleFromSpecialty(specialty: string | null | undefined): AgentRole | null {
  switch ((specialty || "").toLowerCase()) {
    case "leasing": return "letting";
    case "tenant rep": return "tenant_rep";
    case "investment": return "investment_sell";
    case "lease advisory": return "lease_advisory";
    default: return null;
  }
}

// Deal agent column → role.
export const DEAL_AGENT_ROLES: Array<{ column: string; contactColumn: string; role: AgentRole; label: string }> = [
  { column: "leasing_agent_id", contactColumn: "leasing_agent_contact_id", role: "letting", label: "Leasing agent" },
  { column: "acquisition_agent_id", contactColumn: "acquisition_agent_contact_id", role: "tenant_rep", label: "Acquisition agent" },
  { column: "vendor_agent_id", contactColumn: "vendor_agent_contact_id", role: "investment_sell", label: "Vendor agent" },
  { column: "purchaser_agent_id", contactColumn: "purchaser_agent_contact_id", role: "investment_buy", label: "Purchaser agent" },
  { column: "joint_agent_id", contactColumn: "joint_agent_contact_id", role: "joint_agent", label: "Joint agent" },
];
