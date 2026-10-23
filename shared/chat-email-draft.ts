export interface ChatEmailDraft {
  subject: string;
  bodyMarkdown: string;
  before: string;
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
  if (!subject || subject.length > 200 || !/^(?:Dear|Hi|Hello|Good morning|Good afternoon|To whom it may concern)\b/i.test(bodyMarkdown)) return null;
  if (bodyMarkdown.length < 30) return null;
  return { subject, bodyMarkdown, before: text.slice(0, start).trim() };
}
