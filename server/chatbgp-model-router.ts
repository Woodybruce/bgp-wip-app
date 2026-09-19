// Per-thread model toggle for ChatBGP.
//
// Default is Fable 5 (Anthropic's most capable model — the main chat is as
// powerful as Claude out of the box). Users can switch a specific thread with
// slash commands: `/opus` (heavy, cheaper than Fable), `/sonnet` (fastest +
// cheapest), `/fable` (back to the default). The choice is remembered per chat
// thread in chat_threads.model_preference until the user flips it again.
//
// Slash command alone (e.g. just "/sonnet") → return ack, don't call
// Claude at all. Slash command followed by content (e.g. "/sonnet draft
// the Why Buy") → strip the command, switch model, continue normally.

import { pool } from "./db";

const SONNET = "claude-sonnet-4-6";
const OPUS = "claude-opus-4-8";
const FABLE = "claude-fable-5";

const DEFAULTS = {
  default: FABLE,
  fable: FABLE,
  opus: OPUS,
  sonnet: SONNET,
} as const;

export type ModelCommand = "fable" | "opus" | "sonnet";

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
  const m = trimmed.match(/^\/(fable|opus|sonnet)\b\s*(.*)$/is);
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
//   3. default (Fable 5) — only an explicit /opus or /sonnet drops down
export async function resolveChatModel(args: {
  threadId?: string | null;
  override?: ModelCommand | null;
}): Promise<{ model: string; label: ModelCommand }> {
  if (args.override) return { model: DEFAULTS[args.override], label: args.override };
  if (!args.threadId) return { model: DEFAULTS.default, label: "fable" };
  await ensureColumn();
  try {
    const { rows } = await pool.query<{ model_preference: string | null }>(
      `SELECT model_preference FROM chat_threads WHERE id = $1 LIMIT 1`,
      [args.threadId],
    );
    const pref = rows[0]?.model_preference;
    if (pref === "sonnet") return { model: SONNET, label: "sonnet" };
    if (pref === "opus") return { model: OPUS, label: "opus" };
    return { model: FABLE, label: "fable" };
  } catch {
    return { model: DEFAULTS.default, label: "fable" };
  }
}

// Helper: friendly ack message for the slash command. Used when the
// user typed just the command with no body — we short-circuit the
// Claude call and respond with this.
export function ackMessage(command: ModelCommand): string {
  if (command === "fable") {
    return "🔀 Switched to Fable for this thread — the most capable model and the default. Type `/opus` or `/sonnet` for cheaper options.";
  }
  return command === "opus"
    ? "🔀 Switched to Opus for this thread. Type `/fable` for the most capable default, or `/sonnet` for the fastest, cheapest model."
    : "🔀 Switched to Sonnet for this thread — fastest + cheapest. Type `/fable` to switch back to the default.";
}

export const CHATBGP_DEFAULT_MODEL = FABLE;
export const CHATBGP_OPUS_MODEL = OPUS;
