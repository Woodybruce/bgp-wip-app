// Chat for a Landsec joint agent (Woody, 13 November 2026: "yes go ahead").
// The pure rules: what a tag in a message may show a joint agent, and which
// conversations a joint agent may hold. The server side is
// server/chat-joint-agent.ts (messaging) and server/chatbgp-joint-agent.ts
// (ChatBGP). Tested in shared/chat-joint-agent.test.ts.

// A tag is written into a message as @[Name](tag:type/id). Any type is
// matched here, so a type added later is redacted until this file names it.
const TAG_ANY = /@\[([^\]]*)\]\(tag:([a-z_]+)\/([^)\s]*)\)/gi;
// What is left of a tag that was cut short or mistyped: the id must go.
const TAG_LEFTOVER = /(@\[[^\]\n]*\])?\(tag:[a-z_]*\/?[^)\s]*\)?/gi;
const TAG_OPENING = /@\[[^\]\n]*(\]\(?(t(a(g(:[a-z_]*)?)?)?)?)?$/i;

export interface JointAgentTagAllow {
  memberIds: Set<string>;
  unitIds: Set<string>;
  dealIds: Set<string>;
}

const NEUTRAL: Record<string, string> = {
  user: "[someone]",
  unit: "[another unit]",
  deal: "[another deal]",
  company: "[a company]",
  contact: "[a contact]",
  property: "[a property]",
  folder: "[a folder]",
};

// A message as a joint agent may read it. A tag for a person in the
// conversation, or a unit or a live deal at its schemes, is kept whole.
// Every other tag becomes a neutral word with no id and no name. Plain typed
// words are the writer's own and are not changed.
export function redactChatText(text: unknown, allow: JointAgentTagAllow): string {
  if (typeof text !== "string") return "";
  const kept: string[] = [];
  const hold = (whole: string) => { kept.push(whole); return `\u0000${kept.length - 1}\u0000`; };
  let out = text.replace(/\u0000/g, "").replace(TAG_ANY, (whole, _name: string, type: string, id: string) => {
    const t = String(type).toLowerCase();
    if (t === "user" && allow.memberIds.has(id)) return hold(whole);
    if (t === "unit" && allow.unitIds.has(id)) return hold(whole);
    if (t === "deal" && allow.dealIds.has(id)) return hold(whole);
    return NEUTRAL[t] || "[a record]";
  });
  out = out.replace(TAG_LEFTOVER, "");
  // A tag cut before its "(tag:" (by a length limit) still holds a name.
  out = out.replace(TAG_OPENING, "");
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)] || "");
}

// The short line shown in a list or a notification. Redacted first, cut
// second: cutting first can leave half a tag, with its id, in the line.
export function previewFor(text: unknown, allow: JointAgentTagAllow, n = 80): string {
  const clean = redactChatText(text, allow);
  if (clean.length <= n) return clean;
  // The cut itself must not leave half of a kept tag.
  return redactChatText(clean.slice(0, n), allow).trimEnd() + "...";
}

export function tagIdsIn(text: unknown): { units: string[]; deals: string[]; users: string[]; other: Array<{ type: string; id: string }> } {
  const out = { units: [] as string[], deals: [] as string[], users: [] as string[], other: [] as Array<{ type: string; id: string }> };
  if (typeof text !== "string") return out;
  for (const m of text.matchAll(TAG_ANY)) {
    const type = String(m[2]).toLowerCase();
    const id = m[3];
    if (type === "unit") out.units.push(id);
    else if (type === "deal") out.deals.push(id);
    else if (type === "user") out.users.push(id);
    else out.other.push({ type, id });
  }
  return out;
}

// Anything in the text that looks like a tag but is not a whole one.
export function hasBrokenTag(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return text.replace(TAG_ANY, "").includes("(tag:");
}

export interface JointAgentThreadLike {
  createdBy?: string | null;
  isAiChat?: boolean | null;
  hasAiMember?: boolean | null;
  propertyId?: string | null;
  linkedType?: string | null;
  linkedId?: string | null;
}

// The two kinds of conversation a joint agent may hold, and nothing else:
// "team"   a conversation between people, not linked to any record (a
//          property, a deal, a brand, a channel). ChatBGP may be in it
//          (Woody, 13 November 2026: "Relax all of those"); it then answers
//          there only as the joint agents in it may read
//          (runSharedJointAgentChat in server/chatbgp-joint-agent.ts);
// "own_ai" its own ChatBGP chat, with nobody else in it.
export function jointAgentThreadKind(thread: JointAgentThreadLike | null | undefined, memberIds: Iterable<string>, userId: string): "team" | "own_ai" | null {
  if (!thread || !userId) return null;
  const members = new Set<string>();
  for (const id of memberIds) if (id) members.add(String(id));
  if (thread.isAiChat === true) {
    if (thread.createdBy !== userId) return null;
    for (const id of members) if (id !== userId) return null;
    return "own_ai";
  }
  if (thread.isAiChat !== false) return null;
  if (thread.propertyId || thread.linkedType || thread.linkedId) return null;
  if (thread.createdBy !== userId && !members.has(userId)) return null;
  return "team";
}
