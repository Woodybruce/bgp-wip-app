// Who works on each Landsec scheme, from BGP's "Land Securities x BGP"
// personnel model of 2 February 2026 (Woody sent it on 12 November 2026).
// Used ONLY to suggest people when a Targeting Brief is opened on a Landsec
// scheme: each name is a suggestion the person adding them confirms, and the
// server still takes every name and email from the login or CRM record. The
// sheet dates from February 2026, so check it against the team as it is now.
export interface LandsecSchemeTeam {
  key: string;
  match: RegExp;                 // on the property name
  assetManagers: string[];       // Landsec
  leasing: string[];             // Landsec leasing leads
  bgpLead: string[];
  bgpSupport: string[];
  jointAgents: string[];         // the joint agency team, where there is one
}

const RETAIL_LEASING = ["Mark Warne", "Victoria Gould", "George O'Hara", "Heinz Kloihofer", "Jonathan Rushton"];
const LONDON_LEASING = ["Ruth McFetridge", "Jonathan Rushton", "Mark Warne"];
const JOINT_FOUR = ["Nigel Costain", "Tamara Lamb", "George Radford", "Tom Dracup"];

export const LANDSEC_SCHEME_TEAMS: LandsecSchemeTeam[] = [
  { key: "bluewater", match: /bluewater/i, assetManagers: ["Gemma Casey", "Alice Wilkins", "Rebecca Blenkinsop"], leasing: RETAIL_LEASING, bgpLead: ["Emily Dumbell"], bgpSupport: ["Lucy Gardiner", "Rob Barnes"], jointAgents: JOINT_FOUR },
  { key: "liverpool-one", match: /liverpool\s*(one|1)\b/i, assetManagers: ["Rob Deacon", "Nick Cywinski"], leasing: RETAIL_LEASING, bgpLead: ["Lucy Gardiner", "Emily Dumbell"], bgpSupport: ["Rob Barnes", "Luke Donohoe"], jointAgents: ["Sammy Jones", "David Bell"] },
  { key: "buchanan-galleries", match: /buchanan/i, assetManagers: ["Charlie Griffiths", "Ben Doughty", "Colin Kennedy"], leasing: RETAIL_LEASING, bgpLead: ["Victoria Broadhead"], bgpSupport: [], jointAgents: ["James Godfrey", "Alex Culverwell"] },
  { key: "st-davids", match: /st\.?\s*david|queen'?s?\s*arcade/i, assetManagers: ["Charlie Griffiths", "Francesca Moffat", "James Hamilton"], leasing: RETAIL_LEASING, bgpLead: ["Victoria Broadhead"], bgpSupport: ["Rob Barnes", "Luke Donohoe"], jointAgents: JOINT_FOUR },
  { key: "trinity-leeds", match: /\btrinity\b(?!\s*walk)/i, assetManagers: ["Rob Hardie", "Katarina Mercury", "Olivia Dunn"], leasing: RETAIL_LEASING, bgpLead: ["Emily Dumbell"], bgpSupport: ["Lucy Gardiner", "Rob Barnes", "Luke Donohoe"], jointAgents: JOINT_FOUR },
  { key: "white-rose", match: /white\s*rose/i, assetManagers: ["Rob Hardie", "Nadia Loza", "Olivia Dunn"], leasing: RETAIL_LEASING, bgpLead: ["Emily Dumbell"], bgpSupport: ["Lucy Gardiner", "Rob Barnes", "Luke Donohoe"], jointAgents: JOINT_FOUR },
  { key: "westgate-oxford", match: /westgate/i, assetManagers: ["Rob Hardie", "Olivia Dunn", "Claire Figures-Wilson"], leasing: RETAIL_LEASING, bgpLead: ["Victoria Broadhead"], bgpSupport: ["Rob Barnes", "Luke Donohoe"], jointAgents: JOINT_FOUR },
  { key: "southside", match: /southside/i, assetManagers: ["Jonathan Brooks", "James Hiscox"], leasing: RETAIL_LEASING, bgpLead: ["Lucy Gardiner", "Emily Dumbell"], bgpSupport: ["Luke Donohoe"], jointAgents: [] },
  { key: "o2-lewisham", match: /\bo2\b|lewisham/i, assetManagers: ["Will Harvey", "James Hiscox"], leasing: RETAIL_LEASING, bgpLead: ["Victoria Broadhead"], bgpSupport: ["Rob Barnes"], jointAgents: JOINT_FOUR },
  { key: "gunwharf-quays", match: /gunwharf/i, assetManagers: ["Amy de Groot", "Olivia Yeandle"], leasing: RETAIL_LEASING, bgpLead: ["Emily Dumbell"], bgpSupport: ["Victoria Broadhead", "Rob Barnes"], jointAgents: JOINT_FOUR },
  { key: "clarks-village", match: /clarks\s*village/i, assetManagers: ["Amy de Groot", "Handan Guler", "Deborah Adesanya"], leasing: RETAIL_LEASING, bgpLead: ["Victoria Broadhead"], bgpSupport: ["Rob Barnes"], jointAgents: JOINT_FOUR },
  { key: "braintree-village", match: /braintree/i, assetManagers: ["Amy de Groot", "Handan Guler"], leasing: RETAIL_LEASING, bgpLead: ["Victoria Broadhead"], bgpSupport: ["Rob Barnes"], jointAgents: JOINT_FOUR },
  { key: "london-offices", match: /one\s*new\s*change|\bonc\b|new\s*street\s*sq|\blucent\b|piccadilly\s*lights|cardinal\s*place|123\s*victoria|victoria\s*(street|estate)/i, assetManagers: ["Viv Lim"], leasing: LONDON_LEASING, bgpLead: ["Charlotte Roberts"], bgpSupport: ["Emily Dumbell", "Emily Cann"], jointAgents: [] },
  { key: "london-developments", match: /timber\s*square|oval\s*works/i, assetManagers: ["Viv Lim"], leasing: LONDON_LEASING, bgpLead: ["Charlotte Roberts"], bgpSupport: ["Emily Dumbell", "Lucy Gardiner", "Emily Cann"], jointAgents: [] },
];

export function landsecSchemeTeamFor(propertyName: string | null | undefined): LandsecSchemeTeam | null {
  const name = String(propertyName || "");
  return name ? LANDSEC_SCHEME_TEAMS.find(t => t.match.test(name)) || null : null;
}

// The scheme's team as people to suggest on a Targeting Brief, BGP first.
export function landsecTeamSuggestions(propertyName: string | null | undefined): { name: string; role: string; firm: string | null; email: string | null }[] {
  const t = landsecSchemeTeamFor(propertyName);
  if (!t) return [];
  const of = (names: string[], role: string, firm: string | null) => names.map(name => ({ name, role, firm, email: null }));
  return [
    ...of(t.bgpLead, "bgp_agent", "BGP"), ...of(t.bgpSupport, "bgp_agent", "BGP"),
    ...of(t.jointAgents, "joint_agent", null),
    ...of(t.leasing, "client_leasing", "Landsec"),
    ...of(t.assetManagers, "asset_manager", "Landsec"),
  ];
}
