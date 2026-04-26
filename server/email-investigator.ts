import type { Request } from "express";
import { runSearchEmailsTool } from "./chatbgp";

/**
 * Focused email-investigator for the property pathway. Runs a small Claude
 * agent loop with `search_emails` as the only tool and produces a grouped
 * narrative with [E#] citations that the client renders as clickable
 * deep-links into the in-app email viewer.
 *
 * Why this exists: Stage 1's old keyword sweep was mechanical — it built
 * search phrases from the address and returned 80+ noisy hits where the
 * AI relevance pass couldn't separate signal from noise. ChatBGP gets
 * dramatically better results from the SAME mailboxes because it lets
 * Claude pick the queries (e.g. it knows to also search "Dover Street
 * Market" and "DSM" not just "Haymarket"). This helper makes that
 * intelligence available to the pathway too.
 *
 * Returns:
 *   - markdown:    Claude's grouped narrative with inline [E1], [E2]…
 *                  citations. Caller saves this to stage1.emailCommentary.
 *   - emailHits:   the dedup'd union of all messages Claude saw across its
 *                  search_emails calls, in citation order. Caller saves to
 *                  stage1.emailHits — [E5] in the markdown maps to
 *                  emailHits[4] (1-based citations, 0-based array).
 *
 * Cost / time: 1 Claude Sonnet call across ~3-6 turns + ~3-6 search_emails
 * calls (~1s each via Graph). Total ~5-15s, ~$0.05 per pathway run.
 */
export interface EmailInvestigatorInput {
  address: string;
  postcode?: string;
  /** Stage-1 context that helps Claude pick smart search terms. */
  hints?: {
    tenant?: string;
    owner?: string;
    proprietorCompany?: string;
    aliases?: string[];
  };
  req: Request;
}

export interface EmailInvestigatorEmail {
  msgId: string;
  mailboxEmail?: string;
  subject: string;
  from: string;
  date: string;
  preview: string;
  hasAttachments: boolean;
}

export interface EmailInvestigatorResult {
  markdown: string;
  emailHits: EmailInvestigatorEmail[];
}

const MAX_AGENT_TURNS = 8;
const MAX_TOTAL_HITS = 60;
const MAX_HITS_PER_QUERY = 12;

const SYSTEM_PROMPT = `You are an email investigator for Bruce Gillingham Pollard, a London commercial property firm.

Your job: pull the actual emails relevant to a specific property out of BGP's 31 inboxes and produce a grouped, chronological narrative for the analyst.

Available tool: \`search_emails\` (fans out across every active BGP mailbox). Use it 2-6 times with smart queries. Don't search for the literal full address — pick distinctive terms.

GOOD QUERIES:
- The street/building name on its own ("Haymarket", "Dover Street Market")
- Tenant brand names ("DSM", "Comme des Garçons")
- The postcode in quotes ("SW1Y 4DQ")
- Owner / proprietor company names if you have them
- Adjacent-building references the analyst told you about

BAD QUERIES:
- The full address verbatim ($search treats quoted phrases as exact-match)
- Generic words like "property" or "investment"

After searching, write a markdown narrative for the analyst. Rules:

1. **Cite emails inline using [E#] notation** (e.g. "[E5]"). I'll number every email you saw as E1, E2, … in the order I return them. Use those numbers EXACTLY. This is critical — the UI uses [E#] tokens to deep-link to the source email.
2. **Filter aggressively.** Newsletter forwards, generic firm-wide alerts, emails about other properties — drop them entirely. Don't mention emails just because they came back from a search.
3. **Group by phase / topic, ordered chronologically.** Use ## headers for each phase ("Genesis 2014-15", "Goldenberg relaunch Jan 2024", etc.).
4. **One line per email** — date, who-from, what-it-reveals — not the whole subject line.
5. **Note what's MISSING** in passing if the index has obvious gaps.
6. **End with 1-2 next steps** in a "## Next steps" section.
7. **Be concise — under 400 words total.** Skip preamble; just write the commentary.

If after searching nothing genuinely relevant turns up, output one line:
> No emails in the BGP inboxes are about this property.

Don't apologise or hedge.`;

export async function runEmailInvestigator(input: EmailInvestigatorInput): Promise<EmailInvestigatorResult | null> {
  // Match the rest of the codebase: prefer the integration key (Railway's
  // canonical env var) and fall back to the direct key. Without this, the
  // Anthropic client constructed below got `undefined` for apiKey on Railway
  // and silently failed every Claude call → null → the pathway fell through
  // to runEmailSort on the legacy 80-email keyword sweep, which is the
  // "None of the 80 indexed emails relate…" output users were seeing.
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[email-investigator] no Anthropic key configured — skipping");
    return null;
  }

  const { address, postcode, hints, req } = input;

  // Ordered, dedup'd union of every message Claude has seen via search_emails.
  // The 1-based index in this array is what `[E#]` citations refer to.
  const emailHits: EmailInvestigatorEmail[] = [];
  const seenIds = new Set<string>();
  const indexById = new Map<string, number>(); // msgId -> 1-based citation index

  const recordHits = (messages: any[]): { newCount: number; firstIdx: number } => {
    let firstIdx = -1;
    let newCount = 0;
    for (const m of messages) {
      if (!m?.msgId || seenIds.has(m.msgId)) continue;
      if (emailHits.length >= MAX_TOTAL_HITS) break;
      seenIds.add(m.msgId);
      emailHits.push({
        msgId: m.msgId,
        mailboxEmail: m.mailboxEmail,
        subject: m.subject || "",
        from: m.from || "",
        date: m.date || "",
        preview: m.preview || "",
        hasAttachments: !!m.hasAttachments,
      });
      const oneBased = emailHits.length;
      indexById.set(m.msgId, oneBased);
      if (firstIdx === -1) firstIdx = oneBased;
      newCount++;
    }
    return { newCount, firstIdx };
  };

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const clientOpts: any = { apiKey };
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    clientOpts.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  }
  const client = new Anthropic(clientOpts);

  const tools = [{
    name: "search_emails",
    description: "Search across all 31 BGP mailboxes. Picks distinctive terms — single words match case-insensitively, quoted multi-word strings are exact-match.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Single distinctive word OR a quoted exact-match phrase (e.g. 'Haymarket' or '\"SW1Y 4DQ\"')." },
        top: { type: "number", description: "Max results per mailbox. Default 10. Max 25." },
      },
      required: ["query"],
    },
  }];

  const userBrief = [
    `Property under investigation: **${address}**${postcode ? ` (${postcode})` : ""}`,
    hints?.tenant ? `Known tenant / occupier: ${hints.tenant}` : null,
    hints?.owner ? `Known owner: ${hints.owner}` : null,
    hints?.proprietorCompany ? `Owner company: ${hints.proprietorCompany}` : null,
    hints?.aliases?.length ? `Other names this property is known by: ${hints.aliases.join(", ")}` : null,
    "",
    "Run 2-6 search_emails calls with distinctive terms, then write the grouped narrative.",
  ].filter(Boolean).join("\n");

  const messages: any[] = [{ role: "user", content: userBrief }];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    let resp;
    try {
      resp = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1800,
        system: SYSTEM_PROMPT,
        tools: tools as any,
        messages,
      });
    } catch (err: any) {
      console.warn("[email-investigator] Claude call failed:", err?.message);
      return null;
    }

    // If the model produced text-only output, this is the final answer.
    if (resp.stop_reason === "end_turn" || !resp.content.some((b: any) => b.type === "tool_use")) {
      const textBlocks = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text || "").join("\n").trim();
      if (!textBlocks) return null;
      // Cull emailHits to only those actually cited so the saved emailHits
      // array doesn't include unused search results that bloat the run row.
      const citedIdxs = new Set<number>();
      const re = /\[E(\d+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(textBlocks)) !== null) {
        citedIdxs.add(parseInt(m[1], 10));
      }
      // We also keep all hits (even non-cited) so the "raw list" expander
      // remains useful — but cap at MAX_TOTAL_HITS to keep the row size sane.
      return { markdown: textBlocks, emailHits };
    }

    // Otherwise the model is asking us to run search_emails. Execute every
    // tool_use block before the next turn.
    messages.push({ role: "assistant", content: resp.content });
    const toolResults: any[] = [];
    for (const block of resp.content) {
      if ((block as any).type !== "tool_use") continue;
      const toolUse = block as any;
      if (toolUse.name === "search_emails") {
        const query = String(toolUse.input?.query || "").trim();
        const top = Math.min(Math.max(parseInt(toolUse.input?.top, 10) || 10, 1), 25);
        if (!query) {
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: "Empty query — provide a distinctive term." });
          continue;
        }
        try {
          const r = await runSearchEmailsTool({ query, top, mailbox: "all", req });
          if ("error" in r) {
            toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Search error: ${r.error}` });
            continue;
          }
          const trimmed = r.messages.slice(0, MAX_HITS_PER_QUERY);
          const { newCount, firstIdx } = recordHits(trimmed);
          // Format results for Claude with citation indices so it cites correctly.
          const formatted = trimmed.length === 0
            ? `(no results for "${query}")`
            : trimmed.map((msg: any) => {
                const idx = indexById.get(msg.msgId);
                const date = msg.date ? new Date(msg.date).toLocaleDateString("en-GB") : "?";
                return `E${idx}. [${date}] From: ${msg.from} | Subject: ${msg.subject} | Preview: ${(msg.preview || "").slice(0, 140)}`;
              }).join("\n");
          const summary = `Query "${query}" → ${trimmed.length} hits across ${r.scope}, ${newCount} new (cited E${firstIdx > 0 ? firstIdx : "?"}+)`;
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `${summary}\n\n${formatted}`,
          });
        } catch (err: any) {
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Tool error: ${err?.message || "unknown"}` });
        }
      } else {
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Unknown tool: ${toolUse.name}` });
      }
    }
    messages.push({ role: "user", content: toolResults });

    if (emailHits.length >= MAX_TOTAL_HITS) {
      // Don't let Claude keep searching beyond our cap — push a nudge to wrap up.
      messages.push({ role: "user", content: `You've now seen ${emailHits.length} emails across your searches. Stop searching and write the grouped narrative now.` });
    }
  }

  // Ran out of turns without a final answer. Return what we've got so the
  // pathway still has the raw hits even if commentary isn't ready.
  console.warn(`[email-investigator] no final answer after ${MAX_AGENT_TURNS} turns — returning ${emailHits.length} raw hits without commentary`);
  return { markdown: "Email investigation didn't complete cleanly — try Re-analyse.", emailHits };
}
