/**
 * AI Activity Curator
 * ===================
 *
 * Subject-agnostic activity curation. Given any subject (a deal, a brand, a
 * landlord, a contact, or a property), this module asks ChatBGP to:
 *   1. Search across all 31 BGP mailboxes for relevant emails
 *   2. Search calendars for relevant meetings
 *   3. Filter aggressively (drop newsletters, unrelated noise)
 *   4. Group by topic / thread chronologically
 *   5. Produce a curated markdown narrative with [E#] / [M#] citations
 *   6. Return a structured `<email-refs>` + `<meeting-refs>` appendix
 *
 * Why this exists: this is the same pattern the property-pathway Stage 1
 * email triage already uses. Lifting it into a shared module so we can
 * reuse it on deal pages, brand profiles, contact pages, hunters, etc.
 *
 * The output isn't a list of emails — it's a curated analyst-quality
 * narrative ("## March: tenant negotiations stalled. [E3] Aurora pushed
 * back on rent free…") with clickable citations.
 *
 * Each call is a full ChatBGP turn (50k+ tokens, 30s+ latency). Always
 * cache results — see crm_activity_cache table.
 */
import type { Request } from "express";
import { askChatBgp } from "./chatbgp-internal";

export type ActivitySubject =
  | {
      type: "deal";
      id: string;
      name?: string | null;
      address?: string | null;
      postcode?: string | null;
      tenantName?: string | null;
      landlordName?: string | null;
      vendorName?: string | null;
      purchaserName?: string | null;
      contactNames?: string[];
      agentNames?: string[];
    }
  | {
      type: "brand";
      id: string;
      name: string;
      aliases?: string[];
      contactNames?: string[];
    }
  | {
      type: "landlord";
      id: string;
      name: string;
      aliases?: string[];
      addresses?: string[];
      contactNames?: string[];
    }
  | {
      type: "contact";
      id: string;
      name: string;
      email?: string | null;
      companyName?: string | null;
    }
  | {
      type: "property";
      id: string;
      address: string;
      postcode?: string | null;
    };

export interface EmailRef {
  msgId: string;
  mailboxEmail?: string;
  subject: string;
  from: string;
  date: string;
  preview?: string;
  hasAttachments?: boolean;
}

export interface MeetingRef {
  eventId: string;
  mailboxEmail?: string;
  subject: string;
  organiser: string;
  start: string;
  attendees?: string[];
}

export interface CuratedActivity {
  markdown: string;
  emailHits: EmailRef[];
  meetingHits: MeetingRef[];
  generatedAt: string;
  latestActivityDate: string | null;
}

/**
 * Build a subject-scoped natural-language question for ChatBGP. Each
 * subject type has its own seed terms — for a deal we hand over property
 * + tenant + landlord + contacts; for a brand just the name + aliases.
 *
 * The shared rules (filter aggressively, group chronologically, cite
 * inline, demand a structured appendix) are identical across subjects so
 * downstream parsing is uniform.
 */
export function buildActivityQuestion(subject: ActivitySubject): string {
  const seedLines: string[] = [];
  let label = "";

  switch (subject.type) {
    case "deal": {
      label = subject.name || subject.address || `deal ${subject.id}`;
      seedLines.push(`Deal: ${label}`);
      if (subject.address) seedLines.push(`Property address: ${subject.address}${subject.postcode ? `, ${subject.postcode}` : ""}`);
      if (subject.tenantName) seedLines.push(`Tenant: ${subject.tenantName}`);
      if (subject.landlordName) seedLines.push(`Landlord: ${subject.landlordName}`);
      if (subject.vendorName) seedLines.push(`Vendor: ${subject.vendorName}`);
      if (subject.purchaserName) seedLines.push(`Purchaser: ${subject.purchaserName}`);
      if (subject.contactNames?.length) seedLines.push(`Contacts: ${subject.contactNames.join(", ")}`);
      if (subject.agentNames?.length) seedLines.push(`Other-side agents: ${subject.agentNames.join(", ")}`);
      break;
    }
    case "brand":
    case "landlord": {
      label = subject.name;
      seedLines.push(`${subject.type === "brand" ? "Brand" : "Landlord"}: ${subject.name}`);
      if (subject.aliases?.length) seedLines.push(`Aliases / parent: ${subject.aliases.join(", ")}`);
      if (subject.type === "landlord" && subject.addresses?.length) seedLines.push(`Properties: ${subject.addresses.slice(0, 8).join("; ")}`);
      if (subject.contactNames?.length) seedLines.push(`Known contacts: ${subject.contactNames.join(", ")}`);
      break;
    }
    case "contact": {
      label = subject.name;
      seedLines.push(`Contact: ${subject.name}`);
      if (subject.email) seedLines.push(`Email: ${subject.email}`);
      if (subject.companyName) seedLines.push(`Company: ${subject.companyName}`);
      break;
    }
    case "property": {
      label = subject.address;
      seedLines.push(`Property: ${subject.address}${subject.postcode ? `, ${subject.postcode}` : ""}`);
      break;
    }
  }

  return [
    `What recent emails AND calendar meetings do we have in the BGP mailboxes about this subject?`,
    ``,
    seedLines.join("\n"),
    ``,
    `Search across all 31 inboxes plus shared calendars. Pick smart distinctive terms — name, brand, address, contact emails, postcode. Don't just search the literal subject string.`,
    ``,
    `Filter aggressively — drop newsletters, unrelated subjects, and items that just happen to mention a word in common. Group genuine hits chronologically by phase / topic with ## headers. For each item give one line: date, sender / organiser, what it reveals.`,
    ``,
    `Cite emails inline using [E1], [E2], … and meetings using [M1], [M2], … in the order you introduce them. End with a short "## Next steps" section (1-2 actions).`,
    ``,
    `Be concise — under 400 words for the prose.`,
    ``,
    `If after filtering NONE of the items are relevant, just write:`,
    `> No emails or meetings in the BGP system are relevant to this ${subject.type}.`,
    ``,
    `IMPORTANT — at the very end of your response, after a blank line, output two structured appendices wrapping JSON arrays. Use these exact fenced markers so the UI can parse them:`,
    ``,
    `<email-refs>`,
    `[`,
    `  {"id":"E1","msgId":"<message id from search_emails>","mailbox":"<mailbox email>","subject":"<subject>","from":"<from name>","date":"<ISO or human date>"},`,
    `  {"id":"E2", ...}`,
    `]`,
    `</email-refs>`,
    ``,
    `<meeting-refs>`,
    `[`,
    `  {"id":"M1","eventId":"<event id from calendar search>","mailbox":"<mailbox email>","subject":"<subject>","organiser":"<organiser name>","start":"<ISO date>"},`,
    `  {"id":"M2", ...}`,
    `]`,
    `</meeting-refs>`,
    ``,
    `One object per [E#] or [M#] cited in the prose. Use the exact msgId / eventId / mailboxEmail values returned by the tools — required for the deep-link to work. If you didn't cite any, output \`[]\` between the tags.`,
  ].join("\n");
}

/**
 * Backwards-compatible wrapper: property-pathway.ts has been calling this
 * shape since Stage 1. New callers should use buildActivityQuestion with
 * `{ type: "property", ... }`.
 */
export function buildEmailQuestion(address: string, postcode?: string | null): string {
  return buildActivityQuestion({ type: "property", id: address, address, postcode: postcode || undefined });
}

/**
 * Parse ChatBGP's response into clean markdown + structured email +
 * meeting refs. Strips the appendices from the visible markdown. Tolerant
 * of formatting drift — falls back to empty refs if the JSON is malformed.
 */
export function parseActivityResponse(raw: string): { markdown: string; emailHits: EmailRef[]; meetingHits: MeetingRef[] } {
  if (!raw) return { markdown: "", emailHits: [], meetingHits: [] };

  let markdown = raw;
  const emailHits: EmailRef[] = [];
  const meetingHits: MeetingRef[] = [];

  const emailMatch = raw.match(/<email-refs>\s*([\s\S]*?)\s*<\/email-refs>/i);
  if (emailMatch) {
    markdown = markdown.replace(emailMatch[0], "").trim();
    try {
      const parsed = JSON.parse(emailMatch[1].trim());
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (!r || !(r.msgId || r.id)) continue;
          if (!r.msgId) continue;
          emailHits.push({
            msgId: String(r.msgId),
            mailboxEmail: r.mailbox || r.mailboxEmail || undefined,
            subject: String(r.subject || ""),
            from: String(r.from || ""),
            date: String(r.date || ""),
            preview: r.preview ? String(r.preview) : undefined,
            hasAttachments: !!r.hasAttachments,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[activity-curator] email-refs JSON parse failed: ${err?.message}`);
    }
  }

  const meetingMatch = markdown.match(/<meeting-refs>\s*([\s\S]*?)\s*<\/meeting-refs>/i);
  if (meetingMatch) {
    markdown = markdown.replace(meetingMatch[0], "").trim();
    try {
      const parsed = JSON.parse(meetingMatch[1].trim());
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (!r || !(r.eventId || r.id)) continue;
          if (!r.eventId) continue;
          meetingHits.push({
            eventId: String(r.eventId),
            mailboxEmail: r.mailbox || r.mailboxEmail || undefined,
            subject: String(r.subject || ""),
            organiser: String(r.organiser || r.organizer || ""),
            start: String(r.start || r.date || ""),
            attendees: Array.isArray(r.attendees) ? r.attendees.map(String) : undefined,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[activity-curator] meeting-refs JSON parse failed: ${err?.message}`);
    }
  }

  return { markdown, emailHits, meetingHits };
}

/**
 * Backwards-compatible wrapper for property-pathway.ts. Drops meeting
 * hits — pathway only consumes emails today.
 */
export function parseEmailChatBgpResponse(raw: string): {
  markdown: string;
  emailHits: Array<{ msgId: string; mailboxEmail?: string; subject: string; from: string; date: string; preview: string; hasAttachments: boolean }>;
} {
  const { markdown, emailHits } = parseActivityResponse(raw);
  return {
    markdown,
    emailHits: emailHits.map((h) => ({
      msgId: h.msgId,
      mailboxEmail: h.mailboxEmail,
      subject: h.subject,
      from: h.from,
      date: h.date,
      preview: h.preview || "",
      hasAttachments: !!h.hasAttachments,
    })),
  };
}

/**
 * Pick the most recent date across email + meeting refs as the "last
 * touch" timestamp for the subject. Used to denormalise a
 * `lastInteraction` column on the underlying record.
 */
export function pickLatestActivity(emailHits: EmailRef[], meetingHits: MeetingRef[]): string | null {
  const dates: number[] = [];
  for (const e of emailHits) {
    const t = Date.parse(e.date);
    if (!isNaN(t)) dates.push(t);
  }
  for (const m of meetingHits) {
    const t = Date.parse(m.start);
    if (!isNaN(t)) dates.push(t);
  }
  if (!dates.length) return null;
  return new Date(Math.max(...dates)).toISOString();
}

/**
 * Top-level entry point. Builds the question, asks ChatBGP, parses,
 * returns curated activity. Returns null if ChatBGP fails completely.
 * Caller is responsible for caching.
 */
export async function curateActivity(subject: ActivitySubject, req: Request, opts?: { timeoutMs?: number }): Promise<CuratedActivity | null> {
  const question = buildActivityQuestion(subject);
  const raw = await askChatBgp(question, req, opts);
  if (!raw) return null;
  const { markdown, emailHits, meetingHits } = parseActivityResponse(raw);
  if (!markdown.trim() && emailHits.length === 0 && meetingHits.length === 0) return null;
  return {
    markdown,
    emailHits,
    meetingHits,
    generatedAt: new Date().toISOString(),
    latestActivityDate: pickLatestActivity(emailHits, meetingHits),
  };
}

/**
 * Fallback Haiku-based sort over a pre-fetched email hit list. Used when
 * ChatBGP is unavailable. Lifted verbatim from property-pathway.ts so
 * Stage 1 keeps working when ChatBGP is down. New callers should prefer
 * curateActivity() above.
 */
export async function runEmailSort(subjectLabel: string, emailHits: any[]): Promise<{ markdown: string } | null> {
  if (!emailHits || emailHits.length === 0) return null;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const clientOpts: any = { apiKey };
    if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
      clientOpts.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    }
    const client = new Anthropic(clientOpts);

    const list = emailHits.slice(0, 80).map((e: any, i: number) => {
      const date = e.date ? new Date(e.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "?";
      return `E${i + 1}. [${date}] From: ${e.from} | Subject: ${String(e.subject || "").replace(" · via .*", "").trim()} | Preview: ${String(e.preview || "").slice(0, 140)}`;
    }).join("\n");

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `You are analysing emails found in a property investment firm's (Bruce Gillingham Pollard) inboxes for: ${subjectLabel || "unknown subject"}.

Here are the ${emailHits.length} email hits indexed E1, E2, …:

${list}

Output **clean markdown commentary** for the analyst. Rules:

1. **Filter aggressively.** Most of these will be unrelated noise — newsletters, emails about *other* subjects that share a word, generic firm-wide alerts. Mention only emails that are genuinely about THIS subject.
2. **Cite emails inline using [E#] notation** (e.g. "[E5]" or "[E12]"), referencing their original index. This is critical — the UI uses these tokens to deep-link to the source email. Cite every email you mention.
3. **Group by topic / thread**, ordered chronologically. Use ## headers for each thread.
4. **Each citation gets a one-line takeaway** — date, who it's from, what it reveals. Don't dump full subject lines.
5. **Note gaps** in passing if obvious (e.g. "no introduction email is in the inbox").
6. **End with 1-2 suggested actions** in a "## Next steps" section.
7. **Be concise — under 350 words total.**

If after filtering NONE of the emails are about this subject, just output:
> No emails in the BGP inboxes are about this subject.

Don't apologise or hedge — just write the commentary.`
      }],
    });

    const markdown = (msg.content[0] as any)?.text || "";
    if (!markdown.trim()) return null;
    return { markdown: markdown.trim() };
  } catch (err: any) {
    console.warn("[activity-curator] runEmailSort fallback failed:", err?.message);
    return null;
  }
}
