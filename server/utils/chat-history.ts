// Keep complete tool exchanges (including provider replay metadata) when
// recovering from an oversized prompt. Never orphan a result or duplicate IDs.
export function trimChatHistory(messages: any[], tailSize = 12): any[] {
  const ordinary = messages.filter(message => message.role !== "system");
  let start = Math.max(0, ordinary.length - tailSize);
  while (start > 0 && ordinary[start]?.role === "tool") start--;
  const firstUser = ordinary.findIndex(message => message.role === "user");
  return [
    ...messages.filter(message => message.role === "system"),
    ...(firstUser >= 0 && firstUser < start ? [ordinary[firstUser]] : []),
    ...ordinary.slice(start),
  ];
}
