// Agents and HMRC's register (Woody, 19 November 2026: build what BGP's AML
// policy needs). The policy, "Working with joint agents" and "Outsourcing of
// agency activities": BGP may not enter a commercial relationship with an
// agent that is not registered with HMRC for anti-money laundering
// supervision. Where BGP has a contract or financial agreement with an agent
// (a fee shared, a sub-agency), it verifies with HMRC that the agent is
// registered and has an agreement setting out who does the client due
// diligence; an agent found unregistered is reported to HMRC and the
// relationship ceased. Its counterparty questions also ask whether the other
// side's agent is registered with HMRC.
//
// HMRC publishes the Supervised Business Register on GOV.UK as a spreadsheet
// (registration number, business name, trading name, the first part of the
// postcode, the date supervised, the sectors); server/hmrc-register.ts reads
// it. These are the rules and the words.

export const AGENT_SUPERVISION_STATUSES = ["registered", "not_registered", "other_supervisor"] as const;
export type AgentSupervisionStatus = typeof AGENT_SUPERVISION_STATUSES[number];
export const isAgentSupervisionStatus = (v: unknown): v is AgentSupervisionStatus =>
  typeof v === "string" && (AGENT_SUPERVISION_STATUSES as readonly string[]).includes(v);

// One row of HMRC's register, as the app keeps it (estate and letting agency
// rows only).
export interface RegisterEntry {
  number: string;
  businessName: string;
  tradingName: string;
  postcode: string;
  // HMRC's own status column ("Approved", "Applied" and so on).
  status: string;
  estateAgency: boolean;
  lettingAgency: boolean;
  since: string | null;
}

// What BGP recorded about an agent firm's supervision.
export interface AgentSupervision {
  companyId: string;
  status: AgentSupervisionStatus;
  registrationNumber: string | null;
  registerName: string | null;
  registerPostcode: string | null;
  registerStatus: string | null;
  // For other_supervisor: the professional body that supervises the firm.
  supervisor: string | null;
  // An agreement with the firm setting out who does the client due diligence.
  agreementInPlace: boolean | null;
  agreementNote: string | null;
  notes: string | null;
  checkedAt: string | null;
  checkedByName: string | null;
  // "register": picked from HMRC's register in the app; "manual": typed.
  source: "register" | "manual";
  // The date of the register file the check read.
  registerDate: string | null;
}

// A registration is checked again after a year: registrations lapse.
export const AGENT_RECHECK_MONTHS = 12;

const AGENT_LEGAL_ENDING = /\b(limited|ltd|llp|plc|lp|limited liability partnership|public limited company|co|company|uk|group|holdings)\b/g;

/** A firm's name as one key for the register: case, punctuation, "&", a leading "The" and legal endings gone. */
export function firmKey(name: string): string {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/^\s*the\s+/, " ")
    .replace(AGENT_LEGAL_ENDING, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Entries on HMRC's register for a firm: the business or trading name with
 * the same key first; then names holding every word of the firm's name (two
 * words or more, or one word of five letters or more), so "Savills" finds
 * "Savills (UK) Limited". One registration can appear on many rows (one per
 * office): each registration is listed once.
 */
export function registerMatches(name: string, entries: RegisterEntry[], limit = 12): { exact: RegisterEntry[]; near: RegisterEntry[] } {
  const key = firmKey(name);
  if (!key) return { exact: [], near: [] };
  const words = key.split(" ");
  const strongEnough = words.length >= 2 || (words[0] || "").length >= 5;
  const exact: RegisterEntry[] = [];
  const near: RegisterEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const keys = [firmKey(e.businessName), firmKey(e.tradingName)].filter(Boolean);
    if (keys.includes(key)) {
      if (!seen.has(e.number)) { seen.add(e.number); exact.push(e); }
    }
  }
  if (strongEnough) {
    for (const e of entries) {
      if (seen.has(e.number)) continue;
      const keys = [firmKey(e.businessName), firmKey(e.tradingName)];
      if (keys.some(k => { const have = new Set(k.split(" ")); return words.every(w => have.has(w)); })) {
        seen.add(e.number);
        near.push(e);
        if (near.length >= limit) break;
      }
    }
  }
  return { exact: exact.slice(0, limit), near };
}

export type AgentRole = "joint_agent" | "vendor_agent" | "purchaser_agent" | "acquisition_agent" | "leasing_agent";
export const AGENT_ROLE_WORDS: Record<AgentRole, string> = {
  joint_agent: "Joint agent",
  vendor_agent: "Seller's agent",
  purchaser_agent: "Buyer's agent",
  acquisition_agent: "Acquiring agent",
  leasing_agent: "Letting agent",
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");

/**
 * What the deal card says about one agent firm. Required: a joint agent BGP
 * shares the fee with (a financial agreement, so the policy needs HMRC
 * registration verified and an agreement in place). Every other agent on the
 * deal is the policy's counterparty question: worth knowing, not a must.
 */
export function agentAmlState(input: { role: AgentRole; feeShared: boolean; record: AgentSupervision | null; now?: Date }): { tone: "ok" | "amber" | "red" | "info"; words: string; required: boolean } {
  const required = input.role === "joint_agent" && input.feeShared;
  const r = input.record;
  const now = input.now || new Date();
  if (!r) {
    return required
      ? { tone: "amber", required, words: "HMRC registration not checked. BGP shares the fee, so the AML policy needs it verified on HMRC's register, with an agreement saying who does the client due diligence." }
      : { tone: "info", required, words: input.role === "joint_agent"
          ? "HMRC registration not checked. If BGP shares the fee or has an agreement with them, the AML policy needs it verified."
          : "HMRC registration not checked (the policy's counterparty question)." };
  }
  if (r.status === "not_registered") {
    return { tone: "red", required, words: required
      ? `Not on HMRC's register (checked ${day(r.checkedAt)}${r.checkedByName ? ` by ${r.checkedByName}` : ""}). The AML policy says the arrangement stops and the firm is reported to HMRC: tell the Nominated Officer.`
      : `Not on HMRC's register (checked ${day(r.checkedAt)}). Tell the Nominated Officer: an unregistered agent is reported to HMRC.` };
  }
  if (r.status === "other_supervisor") {
    return { tone: "ok", required, words: `Supervised by ${r.supervisor || "a professional body"}, not HMRC (recorded ${day(r.checkedAt)}${r.checkedByName ? ` by ${r.checkedByName}` : ""}).` };
  }
  if (r.registerStatus && /expired|cancel|refus|revok/i.test(r.registerStatus)) {
    return { tone: "red", required, words: `HMRC's register shows the registration${r.registrationNumber ? ` ${r.registrationNumber}` : ""} as ${r.registerStatus.toLowerCase()} (checked ${day(r.checkedAt)}). Treat the firm as not registered: tell the Nominated Officer.` };
  }
  const checked = r.checkedAt ? new Date(r.checkedAt) : null;
  const stale = !checked || (now.getTime() - checked.getTime()) > AGENT_RECHECK_MONTHS * 30.44 * 86400000;
  const base = `Registered with HMRC${r.registrationNumber ? `, ${r.registrationNumber}` : ""}${r.registerStatus && !/^approved$/i.test(r.registerStatus) ? ` (${r.registerStatus.toLowerCase()} on HMRC's register)` : ""}, checked ${day(r.checkedAt)}${r.checkedByName ? ` by ${r.checkedByName}` : ""}.`;
  if (stale) return { tone: "amber", required, words: `${base} More than a year ago: check the register again.` };
  if (r.registerStatus && !/^approved$/i.test(r.registerStatus)) return { tone: "amber", required, words: `${base} HMRC has not approved it yet: check again before relying on it.` };
  if (required && r.agreementInPlace !== true) return { tone: "amber", required, words: `${base} No agreement recorded saying who does the client due diligence.` };
  return { tone: "ok", required, words: base };
}

// What a save may carry, checked.
export interface AgentSupervisionInput {
  status: AgentSupervisionStatus;
  registrationNumber: string | null;
  registerName: string | null;
  registerPostcode: string | null;
  registerStatus: string | null;
  supervisor: string | null;
  agreementInPlace: boolean | null;
  agreementNote: string | null;
  notes: string | null;
  source: "register" | "manual";
  registerDate: string | null;
}

const clip = (v: unknown, n: number): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, n) : null;
};

// HMRC's MLR registration numbers: eight digits for older ones, else two
// letters, "ML", two more letters or digits and digits (XDML00000216675).
export const isHmrcRegistrationNumber = (v: unknown): boolean => /^(\d{8}|[A-Z]{2}ML\d{11}|[A-Z0-9]{4,20})$/.test(String(v || "").trim().toUpperCase());

export function agentSupervisionInput(body: any): { ok: true; value: AgentSupervisionInput } | { ok: false; error: string } {
  const status = body?.status;
  if (!isAgentSupervisionStatus(status)) return { ok: false, error: "Say whether the firm is registered with HMRC, not registered, or supervised by a professional body." };
  const registrationNumber = clip(body?.registrationNumber, 30)?.toUpperCase() || null;
  if (status === "registered" && !registrationNumber) return { ok: false, error: "Give the firm's HMRC registration number, or pick its entry on HMRC's register." };
  if (registrationNumber && !isHmrcRegistrationNumber(registrationNumber)) return { ok: false, error: "That does not read as an HMRC registration number." };
  const supervisor = clip(body?.supervisor, 120);
  if (status === "other_supervisor" && !supervisor) return { ok: false, error: "Name the professional body that supervises the firm." };
  const notes = clip(body?.notes, 1000);
  if (status === "not_registered" && (!notes || notes.length < 10)) return { ok: false, error: "Say how you checked (at least a sentence): it is reported to HMRC." };
  return {
    ok: true,
    value: {
      status,
      registrationNumber: status === "registered" ? registrationNumber : null,
      registerName: status === "registered" ? clip(body?.registerName, 200) : null,
      registerPostcode: status === "registered" ? clip(body?.registerPostcode, 12) : null,
      registerStatus: status === "registered" ? clip(body?.registerStatus, 40) : null,
      supervisor: status === "other_supervisor" ? supervisor : null,
      agreementInPlace: typeof body?.agreementInPlace === "boolean" ? body.agreementInPlace : null,
      agreementNote: clip(body?.agreementNote, 500),
      notes,
      source: body?.source === "register" ? "register" : "manual",
      registerDate: clip(body?.registerDate, 40),
    },
  };
}
