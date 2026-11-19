// The agents on PIPnet's requirement flyers (19 November 2026). Woody: "All
// agents who put up a flyer should be added to our tenant rep agent CRM".
// Pure rules: how a flyer's agent firm is matched to a CRM company, and the
// words the import writes on what it makes. The writes are in server/pipnet.ts
// (upsertPipnetAgent, recordPipnetTenantRep).

// Legal endings that do not tell two firms apart: "CBRE Ltd" is CBRE.
const LEGAL_ENDINGS = new Set(["ltd", "limited", "llp", "plc", "lp", "llc", "inc"]);

// The words of a firm's name as the match reads them: lower case, "&" as
// "and", punctuation and a bracketed part ("(UK)", "(SCA)") left out, a
// leading "The" and the legal endings dropped.
export function agentFirmWords(name: string | null | undefined): string[] {
  const words = String(name || "").toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && words[0] === "the") words.shift();
  while (words.length > 1 && LEGAL_ENDINGS.has(words[words.length - 1])) words.pop();
  return words;
}

// "CBRE Ltd", "CBRE" and "C.B.R.E." are one firm; so are "Cushman & Wakefield
// LLP" and "Cushman and Wakefield".
export function agentFirmKey(name: string | null | undefined): string {
  return agentFirmWords(name).join("");
}

// The word a database search narrows the candidates by: the longest word of
// the name, so "The Retail Partnership" finds rows stored with or without "The".
export function agentFirmSearchWord(name: string | null | undefined): string | null {
  const words = agentFirmWords(name);
  if (!words.length) return null;
  return words.reduce((best, word) => (word.length > best.length ? word : best), words[0]);
}

export type AgentFirmCandidate = { id: string; name: string; companyType: string | null; createdAt?: Date | string | null };

export const isAgentFirmType = (type: string | null | undefined) => /^agent(?:\s|-|$)/i.test(type || "");

// The CRM company a flyer's firm is: one recorded as an agent firm whose name
// matches, else one recorded as nothing at all (the import then records it as
// an agent firm, as it always did). Never a brand, landlord or any other kind
// of company that shares the name: the import makes a new agent firm instead.
// Of several, the one spelt exactly as the flyer spells it, then the oldest.
export function pickAgentFirm<T extends AgentFirmCandidate>(candidates: T[], name: string): { firm: T; setType: boolean } | null {
  const key = agentFirmKey(name);
  if (!key) return null;
  const spelt = name.trim().toLowerCase();
  const order = (a: T, b: T) =>
    Number(b.name.trim().toLowerCase() === spelt) - Number(a.name.trim().toLowerCase() === spelt)
    || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    || a.id.localeCompare(b.id);
  const same = candidates.filter(c => agentFirmKey(c.name) === key);
  const agent = same.filter(c => isAgentFirmType(c.companyType)).sort(order)[0];
  if (agent) return { firm: agent, setType: false };
  const untyped = same.filter(c => !String(c.companyType || "").trim()).sort(order)[0];
  if (untyped) return { firm: untyped, setType: true };
  return null;
}

// What the import writes on the records it makes, so the team can tell them
// from ones a person added (the review's decision C: "From PIPnet").
export const PIPNET_SOURCE = "pipnet";
export const sourceWords = (source: string | null | undefined): string | null =>
  source === PIPNET_SOURCE ? "From PIPnet" : source || null;

// The first line of a contact the import makes, as the email sync writes
// "Auto-added from email — <name>, <date>". listedOn is yyyy-mm-dd.
export function pipnetContactNote(brand: string | null, listedOn: string | null): string {
  const about = brand ? `the agent on ${brand}'s requirement` : "the agent on a requirement that names no client";
  return `Added from PIPnet — ${about}${listedOn ? `, listed ${listedOn}` : ""}`;
}

// The note on the tenant rep link a flyer makes.
export function pipnetTenantRepNote(brand: string, listedOn: string | null, ref: string | null): string {
  return `Named as the agent on ${brand}'s PIPnet requirement${listedOn ? `, listed ${listedOn}` : ""}${ref ? ` (PIPnet ref ${ref})` : ""}.`;
}
