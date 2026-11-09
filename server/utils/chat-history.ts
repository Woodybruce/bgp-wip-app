export interface ChatHistorySelection {
  messages: any[];
  omittedMessages: number;
  estimatedCharacters: number;
  overBudget: boolean;
  notice: string;
}

export const CHAT_HISTORY_CHARACTER_BUDGET = 128_000;

function isToolResult(message: any): boolean {
  return message.role === "tool" || (message.role === "user" &&
    Array.isArray(message.content) && message.content.some((part: any) => part.type === "tool_result"));
}

function isUserRequest(message: any): boolean {
  return message.role === "user" && !isToolResult(message);
}

function messageSize(message: any): number {
  // Include provider replay state, images and tool results, not just visible text.
  return JSON.stringify(message).length;
}

/**
 * Keep a bounded, chronological selection of this conversation only. Short
 * histories (including many small turns) remain complete. Under pressure the
 * opening brief and current request take precedence, followed by verbatim older
 * user requirements and recent whole turns. No keyword classifier, generated
 * summary, cross-thread memory or additional model call is involved.
 *
 * During overflow recovery, completed tool exchanges can be dropped together,
 * but calls/results and opaque provider reasoning are never split or rewritten.
 * Mandatory opening/current messages and the active exchange are a documented
 * soft-budget exception: silently cutting those would corrupt the request.
 */
export function selectChatHistory(messages: any[], options: {
  maxChars?: number;
  recovery?: boolean;
} = {}): ChatHistorySelection {
  const maxChars = Math.max(1, options.maxChars ?? CHAT_HISTORY_CHARACTER_BUDGET);
  const sizes = messages.map(messageSize);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const selected = new Set<number>();
  const groups: number[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "system") {
      selected.add(index);
      continue;
    }
    // Normal turns begin with a real user request. On overflow, each assistant
    // response + all following tool results is an indivisible smaller unit.
    if (!groups.length || (options.recovery ? !isToolResult(message) : isUserRequest(message))) {
      groups.push([]);
    }
    groups[groups.length - 1].push(index);
  }
  if (total <= maxChars) {
    return { messages: [...messages], omittedMessages: 0, estimatedCharacters: total, overBudget: false, notice: "" };
  }

  const userIndices = messages.flatMap((message, index) => isUserRequest(message) ? [index] : []);
  for (const index of groups[groups.length - 1] || []) selected.add(index);
  if (userIndices.length) {
    selected.add(userIndices[0]);
    selected.add(userIndices[userIndices.length - 1]);
  }
  let used = [...selected].reduce((sum, index) => sum + sizes[index], 0);

  // Give older user requirements a share of the budget without promoting them
  // into system instructions or pretending they are a complete conversation.
  // Newer corrections get priority, and output always preserves source order.
  let requirementsBudget = Math.min(Math.max(0, maxChars - used), Math.floor(maxChars * 0.3));
  for (const index of [...userIndices].reverse()) {
    if (selected.has(index) || sizes[index] > requirementsBudget) continue;
    selected.add(index);
    used += sizes[index];
    requirementsBudget -= sizes[index];
  }
  for (const group of [...groups].reverse()) {
    const missing = group.filter(index => !selected.has(index));
    const cost = missing.reduce((sum, index) => sum + sizes[index], 0);
    if (used + cost > maxChars) continue;
    for (const index of missing) selected.add(index);
    used += cost;
  }

  const retained = messages.filter((_message, index) => selected.has(index));
  const omittedMessages = messages.length - retained.length;
  const notice = omittedMessages ?
    `Conversation context is incomplete: ${omittedMessages} earlier messages were omitted to fit the context budget. ` +
    "Retained messages remain in chronological order. Some older user requests are preserved verbatim without their assistant replies; these are requirements, not a complete transcript. " +
    "Follow the latest user corrections when they supersede earlier instructions. Do not claim to remember omitted details; use search_chat_history for missing thread details when available, or ask a focused question if they are needed." : "";
  return { messages: retained, omittedMessages, estimatedCharacters: used, overBudget: used > maxChars, notice };
}

/** A smaller selection for a provider context-length retry, preserving exchanges. */
export function trimChatHistory(messages: any[]): ChatHistorySelection {
  const total = messages.reduce((sum, message) => sum + messageSize(message), 0);
  return selectChatHistory(messages, {
    maxChars: Math.min(64_000, Math.max(8_000, Math.floor(total / 2))),
    recovery: true,
  });
}

export function documentExcerpt(text: string, filename: string, maxChars = 15_000): string {
  const excerpt = text.slice(0, maxChars);
  if (text.length <= maxChars) return excerpt;
  return `${excerpt}\n\n${documentTruncationNotice(filename, maxChars, text.length)}`;
}

export function documentTruncationNotice(filename: string, shownChars: number, totalChars?: number): string {
  return `[Document excerpt only: showing the first ${shownChars.toLocaleString("en-GB")}${totalChars == null ? "" : ` of ${totalChars.toLocaleString("en-GB")}`} characters. ` +
    `The rest was omitted, not read. Use read_document with chatMediaFilename=${JSON.stringify(filename)} and a larger maxTextChars for the missing text; ` +
    "use includePageImages=true when page layout or scanned material matters. Do not describe this excerpt as the complete document.]";
}
