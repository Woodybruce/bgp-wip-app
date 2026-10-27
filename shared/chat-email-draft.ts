import { parseRichText, type RichTextToken } from "./chat-rich-text";

export interface ChatEmailDraft {
  subject: string;
  bodyMarkdown: string;
  before: string;
}

// The authenticated draft-edit endpoint appends this existing marker. Keep it
// shared so saved drafts do not depend on their user-edited greeting. It is a
// rendering convention, never a substitute for authorisation checks.
export const EMAIL_DRAFT_EDIT_NOTE = "[Email draft edited by user.]";

export function hasEmailDraftEditNote(before: string): boolean {
  const blocks = parseRichText(before).filter(block => block.type !== "space");
  const last = blocks[blocks.length - 1];
  // Quoted/fenced examples and passing mentions must not act as provenance.
  return last?.type === "paragraph" && last.raw.trim() === EMAIL_DRAFT_EDIT_NOTE;
}

function hasEmailGreeting(body: string): boolean {
  const firstLine = body.split("\n", 1)[0];
  const first = parseRichText(firstLine)[0];
  if (first?.type !== "paragraph" || !Array.isArray(first.tokens)) return false;
  const emphasisText = (tokens: RichTextToken[]): string => tokens.map(token => {
    if (token.type === "text") return token.text;
    if ((token.type === "strong" || token.type === "em") && Array.isArray(token.tokens)) return emphasisText(token.tokens);
    // Only emphasis is transparent: code, links, lists and quotes are examples.
    return "\u0000";
  }).join("");
  return /^(?:Dear|Hi|Hello|Good morning|Good afternoon|To whom it may concern)\b/i.test(emphasisText(first.tokens));
}

/** Recognise a finished email, not a passing mention of an email subject. */
export function extractChatEmailDraft(content: string): ChatEmailDraft | null {
  const text = content.replace(/\r\n?/g, "\n");
  const matches = [...text.matchAll(/^(?:#{1,3}\s+)?(?:\*\*)?Subject\s*:(?:\*\*)?\s*(.+?)\s*$/gim)];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const start = match.index!;
  // Code samples and quoted examples should remain ordinary chat messages.
  let fence: { char: string; length: number } | null = null;
  for (const line of text.slice(0, start).split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!marker) continue;
    if (!fence) fence = { char: marker[1][0], length: marker[1].length };
    else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
  }
  if (fence) return null;
  const subject = match[1].replace(/\*\*$/, "").trim();
  const bodyMarkdown = text.slice(start + match[0].length).trim();
  const before = text.slice(0, start);
  if (!subject || subject.length > 200 || !bodyMarkdown) return null;
  // New model output still needs a complete greeting. Once an authenticated
  // edit has saved a draft, changing/removing its salutation must not discard
  // the email card or prevent another edit on reload.
  if (!hasEmailDraftEditNote(before) && (bodyMarkdown.length < 30 || !hasEmailGreeting(bodyMarkdown))) return null;
  return { subject, bodyMarkdown, before: before.trim() };
}
