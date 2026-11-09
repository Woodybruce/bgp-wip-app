// The capacities a third-party agent acts in relative to BGP (Woody,
// 2026-09-26/27). A firm like Savills does all of them; what does the work
// is a TEAM within the firm (Investment, Tenant Rep, Leasing, Lease
// Advisory — the contact's agent_specialty) and the individual agent acts in
// one capacity on each piece of work. So capacity is recorded per person per
// relationship, a person belongs to a team, and a firm is the sum of its
// teams.
// Older fields are mapped in: representation / company agent_type
// (tenant_rep | landlord_rep | investment) and contact agent_specialty
// (Leasing | Investment | Tenant Rep | Lease Advisory).
export type AgentRole = "letting" | "tenant_rep" | "investment_sell" | "investment_buy" | "lease_advisory" | "joint_agent";

export const AGENT_ROLES: Array<{ role: AgentRole; label: string; short: string; team: AgentTeam | null; description: string }> = [
  { role: "letting", label: "Leasing agent", short: "Leasing agent", team: "Leasing", description: "Acts for a landlord letting space — competitor for instructions, the other side when BGP acts for a tenant." },
  { role: "tenant_rep", label: "Tenant rep", short: "Tenant rep", team: "Tenant Rep", description: "Acts for a brand finding space — sends requirements and brings tenants to BGP's units." },
  { role: "investment_sell", label: "Sale side", short: "Sale side", team: "Investment", description: "Acts for a vendor — competitor for sale instructions, the other side when BGP buys." },
  { role: "investment_buy", label: "Buy side", short: "Buy side", team: "Investment", description: "Acts for a purchaser — brings bidders to BGP's sales." },
  { role: "lease_advisory", label: "Lease advisory (other side)", short: "Lease advisory", team: "Lease Advisory", description: "The opposite surveyor on rent reviews and renewals — acting for the landlord or the tenant, whichever side BGP isn't." },
  { role: "joint_agent", label: "Joint agent", short: "Joint agent", team: "Leasing", description: "Shares a leasing instruction with BGP — a Leasing team capacity, like leasing agent." },
];

// The teams inside an agent firm — the same values as a contact's
// agent_specialty (client/src/lib/crm-options.ts).
export type AgentTeam = "Investment" | "Tenant Rep" | "Leasing" | "Lease Advisory";
export const AGENT_TEAMS: AgentTeam[] = ["Investment", "Tenant Rep", "Leasing", "Lease Advisory"];
export const teamForRole = (role: AgentRole): AgentTeam | null => AGENT_ROLES.find(r => r.role === role)?.team ?? null;
export function teamFromSpecialty(specialty: string | null | undefined): AgentTeam | null {
  const v = (specialty || "").trim().toLowerCase();
  return AGENT_TEAMS.find(t => t.toLowerCase() === v) || null;
}

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
  { column: "acquisition_agent_id", contactColumn: "acquisition_agent_contact_id", role: "tenant_rep", label: "Tenant rep" },
  { column: "vendor_agent_id", contactColumn: "vendor_agent_contact_id", role: "investment_sell", label: "Sale side agent" },
  { column: "purchaser_agent_id", contactColumn: "purchaser_agent_contact_id", role: "investment_buy", label: "Buy side agent" },
  { column: "joint_agent_id", contactColumn: "joint_agent_contact_id", role: "joint_agent", label: "Joint agent" },
];
