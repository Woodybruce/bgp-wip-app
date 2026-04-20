/**
 * Building contacts extractor — who should BGP talk to to buy this property?
 *
 * Three buckets, all derived from data Stage 1 already collected (email sweep,
 * Land Registry ownership, CRM hits) plus a light Companies House lookup:
 *
 *   1. Agents   — anyone from a known commercial-agency domain who's been in
 *                 threads about this address. Ranked by message volume + recency.
 *   2. Landlord — CH directors of the proprietor entity + email senders whose
 *                 domain resembles the proprietor + CRM contacts linked to it.
 *   3. Asset Mgr — heuristic: email signatures / preview text containing
 *                 "Asset Manager" / "Managing Agent" / "on behalf of {owner}",
 *                 plus senders from big property-management arms (CBRE AS,
 *                 Savills PM, Colliers PM).
 *
 * Called from Stage 2 (first pass, Stage 1 data only) and Stage 5 (refresh
 * with anything Stage 2/3/4 has added). Same output shape both times so the
 * UI just reads `stage2.buildingContacts` and doesn't care which stage wrote
 * it last — `updatedBy` tells you.
 */

import { db } from "./db";
import { crmContacts, crmCompanies } from "@shared/schema";
import { eq, ilike } from "drizzle-orm";

// Agency domain → firm display name. Biased toward the London commercial
// agents BGP actually runs into (retail, office, mixed-use West End + City).
// Keep this list tight — an unknown-agent bucket is better than a bad match.
const AGENCY_DOMAINS: Record<string, string> = {
  "cbre.com": "CBRE",
  "cbre.co.uk": "CBRE",
  "knightfrank.com": "Knight Frank",
  "knightfrank.co.uk": "Knight Frank",
  "savills.com": "Savills",
  "savills.co.uk": "Savills",
  "colliers.com": "Colliers",
  "jll.com": "JLL",
  "jll.co.uk": "JLL",
  "cushwake.com": "Cushman & Wakefield",
  "cushmanwakefield.com": "Cushman & Wakefield",
  "realestate.bnpparibas": "BNP Paribas Real Estate",
  "bnpparibas.com": "BNP Paribas",
  "avisonyoung.com": "Avison Young",
  "avisonyoung.co.uk": "Avison Young",
  "montagu-evans.co.uk": "Montagu Evans",
  "geraldeve.com": "Gerald Eve",
  "gerald-eve.com": "Gerald Eve",
  "bidwells.co.uk": "Bidwells",
  "dtre.com": "DTRE",
  "hanover-green.com": "Hanover Green",
  "tudortoone.com": "Tudor Toone",
  "tudor-toone.com": "Tudor Toone",
  "levyrealestate.co.uk": "Levy Real Estate",
  "allsop.co.uk": "Allsop",
  "lsh.co.uk": "Lambert Smith Hampton",
  "daniel-watney.com": "Daniel Watney",
  "daniel-watney.co.uk": "Daniel Watney",
  "nashbond.co.uk": "Nash Bond",
  "shelley-sandzer.co.uk": "Shelley Sandzer",
  "davis-coffer-lyons.com": "Davis Coffer Lyons",
  "dclpeople.com": "Davis Coffer Lyons",
  "restaurant-property.co.uk": "Restaurant Property",
  "harper-dennis-hobbs.com": "Harper Dennis Hobbs",
  "compton.co.uk": "Compton",
  "cradick.co.uk": "Cradick Retail",
  "dowleygerrard.co.uk": "Dowley Gerrard",
  "edward-charles.co.uk": "Edward Charles Partners",
  "morgan-pryce.co.uk": "Morgan Pryce",
  "kalmars.com": "Kalmars",
  "kalmars.co.uk": "Kalmars",
  "dynamis.co.uk": "Dynamis",
  "crossland.co.uk": "Crossland",
  "hartnells.co.uk": "Hartnells",
};

// Property-management / asset-management arms. When a sender is from one of
// these it gets flagged as a potential asset manager even without a signature
// phrase hit. Some overlap with agents (CBRE, Savills run both).
const PM_DOMAIN_HINTS = [
  "cbre-assetservices",
  "assetservices",
  "savills-pm",
  "propertymanagement",
  "estatemanagement",
  "colliers-pm",
];

// Signature phrases that strongly suggest the sender IS the asset manager or
// a representative acting on the landlord's behalf.
const ASSET_MANAGER_PHRASES = [
  "asset manager",
  "asset management",
  "managing agent",
  "property manager",
  "property management",
  "portfolio manager",
  "on behalf of",
  "instructed by",
];

export interface AgentContact {
  name: string;
  email: string;
  domain: string;
  firm: string;
  messageCount: number;
  lastSeen: string;
  crmContactId?: string;
  knownToUs: boolean;
}

export interface LandlordContact {
  name: string;
  email?: string;
  role: "director" | "officer" | "crm_contact" | "email_sender";
  officerRole?: string; // "director", "company-secretary" etc from CH
  appointedOn?: string;
  resignedOn?: string;
  crmContactId?: string;
  confidence: "high" | "medium" | "low";
}

export interface AssetManagerContact {
  name: string;
  email: string;
  firm: string;
  signaturePhrase?: string;
  messageCount: number;
  lastSeen: string;
  confidence: "high" | "medium" | "low";
}

export interface BuildingContacts {
  agents: AgentContact[];
  landlord: LandlordContact[];
  assetManager: AssetManagerContact[];
  sources: {
    emailsAnalysed: number;
    officersFetched: number;
    crmContactsLinked: number;
  };
  updatedAt: string;
  updatedBy: "stage2" | "stage5";
}

interface EmailHit {
  subject?: string;
  from?: string;
  date?: string;
  preview?: string;
  msgId?: string;
  fromEmail?: string;
}

// Heuristic: pull the display name + email out of whatever shape `from` came
// in as. ChatBGP mapper gave us "Name <addr>"; our pathway shape stores it
// split, but older rows may have the combined form.
function parseSender(hit: EmailHit): { name: string; email: string } {
  const fromEmail = hit.fromEmail || "";
  if (fromEmail && fromEmail.includes("@")) {
    const name = (hit.from || "").replace(/<[^>]+>/, "").trim() || fromEmail.split("@")[0];
    return { name, email: fromEmail.toLowerCase() };
  }
  const combined = hit.from || "";
  const m = combined.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim(), email: m[2].toLowerCase() };
  if (combined.includes("@")) return { name: combined.split("@")[0], email: combined.toLowerCase() };
  return { name: combined || "Unknown", email: "" };
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|holdings|group|investments|investment|properties|property|estates|estate|trust|nominees|holdings|realty)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Extract potential asset-manager signature phrases from a preview snippet.
// Returns the first matched phrase if any, stripped of surrounding context.
function detectAssetMgrPhrase(preview: string, ownerName?: string): string | null {
  const text = preview.toLowerCase();
  for (const phrase of ASSET_MANAGER_PHRASES) {
    if (text.includes(phrase)) {
      // Extract a short window around the match for display
      const idx = text.indexOf(phrase);
      const start = Math.max(0, idx - 20);
      const end = Math.min(text.length, idx + phrase.length + 40);
      return preview.slice(start, end).trim().replace(/\s+/g, " ");
    }
  }
  if (ownerName) {
    const owner = ownerName.toLowerCase();
    if (text.includes(`behalf of ${owner}`) || text.includes(`for ${owner}`)) {
      return `for ${ownerName}`;
    }
  }
  return null;
}

// Main extractor. `stage` controls whether CH officer lookup is allowed —
// keeping Stage 2 fast means we optionally skip CH when we already have
// the officers from Stage 4, and always skip when there's no CH number.
export async function buildBuildingContacts(opts: {
  emailHits: EmailHit[];
  ownership?: { proprietorName?: string; proprietorCompanyNumber?: string; [k: string]: any } | null;
  existingOfficers?: Array<{ name: string; role?: string; officerRole?: string; appointedOn?: string; resignedOn?: string }>;
  stage: "stage2" | "stage5";
}): Promise<BuildingContacts> {
  const { emailHits = [], ownership, existingOfficers, stage } = opts;
  const ownerName = ownership?.proprietorName || undefined;
  const ownerCompanyNumber = ownership?.proprietorCompanyNumber || undefined;

  // --- AGENTS: group by email, match domain against agency list -----------
  const agentBySender = new Map<string, AgentContact>();
  for (const hit of emailHits) {
    const { name, email } = parseSender(hit);
    if (!email) continue;
    const domain = domainOf(email);
    if (!domain || domain.endsWith("brucegillinghampollard.com")) continue;
    // Try exact then parent-domain match (e.g. "london.cbre.com" → "cbre.com")
    let firm = AGENCY_DOMAINS[domain];
    if (!firm) {
      const parts = domain.split(".");
      for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join(".");
        if (AGENCY_DOMAINS[parent]) { firm = AGENCY_DOMAINS[parent]; break; }
      }
    }
    if (!firm) continue;
    const existing = agentBySender.get(email);
    const date = hit.date || "";
    if (existing) {
      existing.messageCount += 1;
      if (date > existing.lastSeen) existing.lastSeen = date;
    } else {
      agentBySender.set(email, { name, email, domain, firm, messageCount: 1, lastSeen: date, knownToUs: false });
    }
  }

  // Link agent emails to CRM contacts for the "known to us" flag.
  const agents = Array.from(agentBySender.values());
  let crmContactsLinked = 0;
  if (agents.length > 0) {
    try {
      for (const a of agents) {
        const rows = await db
          .select({ id: crmContacts.id })
          .from(crmContacts)
          .where(ilike(crmContacts.email, a.email))
          .limit(1);
        if (rows[0]?.id) {
          a.crmContactId = rows[0].id;
          a.knownToUs = true;
          crmContactsLinked += 1;
        }
      }
    } catch (err: any) {
      console.warn("[pathway contacts] CRM agent-link lookup failed:", err?.message);
    }
  }
  agents.sort((a, b) => {
    if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount;
    return (b.lastSeen || "").localeCompare(a.lastSeen || "");
  });

  // --- LANDLORD: CH directors + CRM contacts linked to owner + domain-match
  const landlord: LandlordContact[] = [];
  let officersFetched = 0;
  let officers = existingOfficers || [];
  if (officers.length === 0 && ownerCompanyNumber && stage === "stage2") {
    // Stage 2 does a light CH lookup so the card isn't empty on first view.
    // Stage 5 will overwrite this with whatever Stage 4 built up.
    try {
      const { chFetch } = await import("./companies-house");
      const data: any = await chFetch(`/company/${encodeURIComponent(ownerCompanyNumber)}/officers?items_per_page=20`);
      officers = (data?.items || []).map((o: any) => ({
        name: o.name,
        officerRole: o.officer_role,
        appointedOn: o.appointed_on,
        resignedOn: o.resigned_on,
      }));
      officersFetched = officers.length;
    } catch (err: any) {
      console.warn("[pathway contacts] CH officers fetch failed:", err?.message);
    }
  } else {
    officersFetched = officers.length;
  }
  for (const o of officers) {
    if (o.resignedOn) continue; // active only
    landlord.push({
      name: o.name,
      role: "director",
      officerRole: (o as any).officerRole || (o as any).role,
      appointedOn: o.appointedOn,
      confidence: "high",
    });
  }

  // CRM contacts linked to the owner company (by name match).
  if (ownerName) {
    try {
      const companyRow = await db
        .select({ id: crmCompanies.id })
        .from(crmCompanies)
        .where(ilike(crmCompanies.name, ownerName))
        .limit(1);
      const companyId = companyRow[0]?.id;
      if (companyId) {
        const contacts = await db
          .select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email })
          .from(crmContacts)
          .where(eq(crmContacts.companyId, companyId))
          .limit(20);
        for (const c of contacts) {
          if (!c.name) continue;
          // Don't duplicate someone already listed as a director
          if (landlord.some((l) => l.name.toLowerCase() === c.name.toLowerCase())) continue;
          landlord.push({
            name: c.name,
            email: c.email || undefined,
            role: "crm_contact",
            crmContactId: c.id,
            confidence: "high",
          });
        }
      }
    } catch (err: any) {
      console.warn("[pathway contacts] CRM landlord lookup failed:", err?.message);
    }
  }

  // Email senders whose domain resembles the owner entity. Defensive — only
  // fire if we have a plausible owner name and the sender's domain (minus
  // suffix) contains the owner's normalised core.
  if (ownerName) {
    const ownerCore = normaliseCompanyName(ownerName);
    if (ownerCore.length >= 4) {
      const seenEmails = new Set(landlord.filter((l) => l.email).map((l) => l.email!.toLowerCase()));
      const domainMatches = new Map<string, LandlordContact>();
      for (const hit of emailHits) {
        const { name, email } = parseSender(hit);
        if (!email) continue;
        if (seenEmails.has(email)) continue;
        const dom = domainOf(email);
        if (!dom || dom.endsWith("brucegillinghampollard.com")) continue;
        if (AGENCY_DOMAINS[dom]) continue; // that's an agent, not a landlord
        const domCore = dom.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
        if (!domCore.includes(ownerCore)) continue;
        if (!domainMatches.has(email)) {
          domainMatches.set(email, {
            name,
            email,
            role: "email_sender",
            confidence: "medium",
          });
        }
      }
      for (const c of domainMatches.values()) landlord.push(c);
    }
  }

  // --- ASSET MANAGER: signature phrase + PM-domain hints ------------------
  const assetMgrBySender = new Map<string, AssetManagerContact>();
  for (const hit of emailHits) {
    const { name, email } = parseSender(hit);
    if (!email) continue;
    const dom = domainOf(email);
    if (!dom || dom.endsWith("brucegillinghampollard.com")) continue;
    const preview = hit.preview || "";
    const phrase = detectAssetMgrPhrase(preview, ownerName);
    const pmHint = PM_DOMAIN_HINTS.some((h) => dom.includes(h));
    if (!phrase && !pmHint) continue;
    const firm = AGENCY_DOMAINS[dom] || (dom.split(".")[0] || "Unknown");
    const date = hit.date || "";
    const existing = assetMgrBySender.get(email);
    if (existing) {
      existing.messageCount += 1;
      if (date > existing.lastSeen) existing.lastSeen = date;
      if (!existing.signaturePhrase && phrase) existing.signaturePhrase = phrase;
    } else {
      assetMgrBySender.set(email, {
        name,
        email,
        firm,
        signaturePhrase: phrase || undefined,
        messageCount: 1,
        lastSeen: date,
        confidence: phrase && pmHint ? "high" : phrase || pmHint ? "medium" : "low",
      });
    }
  }
  const assetManager = Array.from(assetMgrBySender.values()).sort((a, b) => b.messageCount - a.messageCount);

  return {
    agents,
    landlord,
    assetManager,
    sources: {
      emailsAnalysed: emailHits.length,
      officersFetched,
      crmContactsLinked,
    },
    updatedAt: new Date().toISOString(),
    updatedBy: stage,
  };
}
