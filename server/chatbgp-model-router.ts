// Per-thread model toggle for ChatBGP.
//
// Default is Sonnet 4.6 (fast + cheap). Users can flip to Opus 4.7 on
// a specific thread when they want the heavy model — type `/opus` (or
// `/sonnet` to switch back) at the start of any message. The choice is
// remembered per chat thread in chat_threads.model_preference until
// the user flips it again.
//
// Slash command alone (e.g. just "/opus") → return ack, don't call
// Claude at all. Slash command followed by content (e.g. "/opus draft
// the Why Buy") → strip the command, switch model, continue normally.

import { pool } from "./db";

const SONNET = "claude-sonnet-4-6";
const OPUS = "claude-opus-4-7";

const DEFAULTS = {
  default: SONNET,
  opus: OPUS,
  sonnet: SONNET,
} as const;

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

// Detect `/opus` or `/sonnet` at the start of the message (case
// insensitive, with optional leading whitespace). Returns the command
// (lowercased), the message with the command stripped, and a flag for
// whether the stripped message has any actual content left.
export interface SlashParse {
  command: "opus" | "sonnet" | null;
  strippedContent: string;
  wasJustCommand: boolean;     // message was ONLY the slash command
}

export function parseSlashCommand(content: string | undefined | null): SlashParse {
  if (!content || typeof content !== "string") {
    return { command: null, strippedContent: content || "", wasJustCommand: false };
  }
  const trimmed = content.trim();
  const m = trimmed.match(/^\/(opus|sonnet)\b\s*(.*)$/is);
  if (!m) return { command: null, strippedContent: content, wasJustCommand: false };
  const command = m[1].toLowerCase() as "opus" | "sonnet";
  const rest = (m[2] || "").trim();
  return {
    command,
    strippedContent: rest,
    wasJustCommand: rest.length === 0,
  };
}

// Persist the toggle on the thread row. No-op if threadId is missing.
export async function setThreadModel(threadId: string | null | undefined, preference: "opus" | "sonnet"): Promise<void> {
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
//   3. default (Sonnet)
export async function resolveChatModel(args: {
  threadId?: string | null;
  override?: "opus" | "sonnet" | null;
}): Promise<{ model: string; label: "opus" | "sonnet" }> {
  if (args.override) return { model: DEFAULTS[args.override], label: args.override };
  if (!args.threadId) return { model: DEFAULTS.default, label: "sonnet" };
  await ensureColumn();
  try {
    const { rows } = await pool.query<{ model_preference: string | null }>(
      `SELECT model_preference FROM chat_threads WHERE id = $1 LIMIT 1`,
      [args.threadId],
    );
    const pref = rows[0]?.model_preference;
    if (pref === "opus") return { model: OPUS, label: "opus" };
    return { model: SONNET, label: "sonnet" };
  } catch {
    return { model: DEFAULTS.default, label: "sonnet" };
  }
}

// Helper: friendly ack message for the slash command. Used when the
// user typed just the command with no body — we short-circuit the
// Claude call and respond with this.
export function ackMessage(command: "opus" | "sonnet"): string {
  return command === "opus"
    ? "🔀 Switched to Opus for this thread — slower but heavier reasoning. Type `/sonnet` to switch back."
    : "🔀 Switched to Sonnet for this thread — faster + cheaper default. Type `/opus` for the heavy model.";
}

export const CHATBGP_DEFAULT_MODEL = SONNET;
export const CHATBGP_OPUS_MODEL = OPUS;
