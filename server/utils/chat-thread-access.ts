/** Shared gate before reading/writing a thread's model preference or context. */
export async function resolveAccessibleChatThread(
  threadId: unknown,
  userId: string | null | undefined,
  dependencies: {
    getThread: (id: string) => Promise<{ createdBy: string | null } | undefined | null>;
    isMember: (threadId: string, userId: string) => Promise<boolean>;
  },
): Promise<{ allowed: boolean; threadId: string | null }> {
  if (threadId == null || threadId === "") return { allowed: true, threadId: null };
  if (typeof threadId !== "string" || !threadId.trim() || !userId) return { allowed: false, threadId: null };
  try {
    const thread = await dependencies.getThread(threadId);
    if (thread && (thread.createdBy === userId || await dependencies.isMember(threadId, userId))) {
      return { allowed: true, threadId };
    }
  } catch { /* Lookup failures cannot authorize a model/context read or write. */ }
  return { allowed: false, threadId: null };
}
