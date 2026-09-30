// Per-thread model choices follow the configured provider. Legacy Claude
// preferences map to Sol after an OpenAI switch; Astra always needs opt-in.

import { pool } from "./db";
import { chatProvider, mapModelForKimi, openaiChatModel, openaiHelperModel, openaiAdvancedModel } from "./utils/ai-provider";

const SONNET = "claude-sonnet-4-6";
// Opus 5.5 is the default: Sonnet wasn't good enough (Woody, 2026-09-29),
// Fable too expensive. /fable and /sonnet remain per-thread options.
const OPUS_DEFAULT = "claude-opus-5-5";
const OPUS = OPUS_DEFAULT;
const FABLE = "claude-fable-5";

// Opus 5.5 by default (Woody, 2026-09-29: cut AI spend, but "not sonnet").
// Fable is 2.5x Opus 5.5's price; /fable remains available per thread.
const DEFAULTS = {
  default: OPUS,
  fable: FABLE,
  opus: OPUS,
  sonnet: SONNET,
} as const;

export type ModelCommand = "fable" | "opus" | "sonnet" | "sol" | "luna" | "astra";

export function selectChatModel(preference?: string | null): { model: string; label: ModelCommand } {
  if (chatProvider() === "openai") {
    if (preference === "luna") return { model: openaiHelperModel(), label: "luna" };
    if (preference === "astra") return { model: openaiAdvancedModel(), label: "astra" };
    return { model: openaiChatModel(), label: "sol" };
  }
  const label = preference === "fable" || preference === "sonnet" ? preference : "opus";
  const model = DEFAULTS[label];
  return { model: chatProvider() === "kimi" ? mapModelForKimi(model) : model, label };
}

let _columnReady = false;
async function ensureColumn(): Promise<void> {
  if (_columnReady) return;
  try {
    await pool.query(`ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS model_preference TEXT`);
    _columnReady = true;
  } catch (err: any) {
    if (err?.code !== "42P01") console.warn("[chatbgp-model] migration:", err?.message);
  }
}

// Detect `/fable`, `/opus` or `/sonnet` at the start of the message (case
// insensitive, with optional leading whitespace). Returns the command
// (lowercased), the message with the command stripped, and a flag for
// whether the stripped message has any actual content left.
export interface SlashParse {
  command: ModelCommand | null;
  strippedContent: string;
  wasJustCommand: boolean;     // message was ONLY the slash command
}

export function parseSlashCommand(content: string | undefined | null): SlashParse {
  if (!content || typeof content !== "string") {
    return { command: null, strippedContent: content || "", wasJustCommand: false };
  }
  const trimmed = content.trim();
  const m = trimmed.match(/^\/(fable|opus|sonnet|sol|luna|astra)\b\s*(.*)$/is);
  if (!m) return { command: null, strippedContent: content, wasJustCommand: false };
  const command = m[1].toLowerCase() as ModelCommand;
  const rest = (m[2] || "").trim();
  return {
    command,
    strippedContent: rest,
    wasJustCommand: rest.length === 0,
  };
}

// Persist the toggle on the thread row. No-op if threadId is missing.
export async function setThreadModel(threadId: string | null | undefined, preference: ModelCommand): Promise<void> {
  if (!threadId) return;
  await ensureColumn();
  await pool.query(
    `UPDATE chat_threads SET model_preference = $1, updated_at = NOW() WHERE id = $2`,
    [preference, threadId],
  ).catch((err: any) => console.warn("[chatbgp-model] setThreadModel:", err?.message));
}

// Resolve the model id for this thread. Order of precedence:
//   1. explicit override (e.g. a slash command on the current message)
//   2. thread.model_preference from the DB
//   3. default (Opus 5.5) — /fable goes up, /sonnet down
export async function resolveChatModel(args: {
  threadId?: string | null;
  override?: ModelCommand | null;
}): Promise<{ model: string; label: ModelCommand }> {
  if (args.override) return selectChatModel(args.override);
  if (!args.threadId) return selectChatModel();
  await ensureColumn();
  try {
    const { rows } = await pool.query<{ model_preference: string | null }>(
      `SELECT model_preference FROM chat_threads WHERE id = $1 LIMIT 1`,
      [args.threadId],
    );
    return selectChatModel(rows[0]?.model_preference);
  } catch {
    return selectChatModel();
  }
}

// Helper: friendly ack message for the slash command. Used when the
// user typed just the command with no body — we short-circuit the
// Claude call and respond with this.
export function ackMessage(command: ModelCommand): string {
  const { model, label } = selectChatModel(command);
  if (chatProvider() === "openai") {
    const detail = label === "astra" ? "the more expensive option for demanding tasks"
      : label === "luna" ? "the lower-cost option for straightforward tasks" : "the default";
    const mapped = command !== label ? " This app now uses OpenAI, so the old Claude choice maps to Sol." : "";
    return `🔀 Using ${label[0].toUpperCase() + label.slice(1)} for this thread — ${detail}.${mapped} Use \`/sol\`, \`/luna\` or \`/astra\` to change it.`;
  }
  if (chatProvider() === "kimi") return `🔀 Using ${model} for this thread.`;
  return `🔀 Using ${label === "fable" ? "Fable — the more expensive option" : label === "sonnet" ? "Sonnet" : "Opus — the default"} for this thread. Use \`/opus\`, \`/sonnet\` or \`/fable\` to change it.`;
}

// Legacy callers go through provider dispatch, which maps this model to Sol.
export const CHATBGP_DEFAULT_MODEL = OPUS;
export const CHATBGP_OPUS_MODEL = OPUS;
