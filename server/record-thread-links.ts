// What happens to a property's shared conversation (server/record-conversation.ts)
// when the property itself goes: deleted, or merged into another record.
// Until 15 November 2026 nothing did, so the conversation stayed in every
// member's Messages list pointing at a property that no longer existed, and
// nobody could remove it (a shared conversation has no owner).
//
// A delete removes it with the property (storage.deleteCrmProperty). A merge
// keeps what was said (below, inside the merge's own transaction). And the
// thread list (GET /api/chat/threads) leaves out one whose property is
// already gone, for the records removed some other way. Only the SHARED conversation is touched: a person's
// own thread that happens to be linked to the property is theirs.
export const RECORD_THREAD_CREATOR = "__record__";

type Run = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

const SHARED = `created_by = $1 AND linked_type = 'property' AND linked_id = $2`;

/**
 * One property is being merged into another: nothing said is lost. With no
 * shared conversation on the kept property the merged one's moves across;
 * with one on each, the messages and the people join the kept property's.
 */
export async function mergeSharedPropertyThreads(run: Run, keepId: string, mergeId: string, keepName: string): Promise<"none" | "moved" | "joined"> {
  const from = (await run(`SELECT id FROM chat_threads WHERE ${SHARED} ORDER BY created_at`, [RECORD_THREAD_CREATOR, mergeId])).rows.map(r => String(r.id));
  if (!from.length) return "none";
  let to: string | null = (await run(`SELECT id FROM chat_threads WHERE ${SHARED} ORDER BY created_at LIMIT 1`, [RECORD_THREAD_CREATOR, keepId])).rows[0]?.id ?? null;
  let outcome: "moved" | "joined" = "joined";
  if (!to) {
    to = from.shift()!;
    outcome = "moved";
    const name = keepName || "Property";
    await run(
      `UPDATE chat_threads SET linked_id = $2, property_id = $2, linked_name = $3, property_name = $3, title = $4 WHERE id = $1`,
      [to, keepId, name, `${name} — conversation`]);
  }
  for (const id of from) {
    await run(`UPDATE chat_messages SET thread_id = $1 WHERE thread_id = $2`, [to, id]);
    // A person in both keeps one membership; anyone unread in either stays unread.
    await run(
      `UPDATE chat_thread_members k SET seen = false
         FROM chat_thread_members m
        WHERE k.thread_id = $1 AND m.thread_id = $2 AND m.user_id = k.user_id AND m.seen IS NOT TRUE`, [to, id]);
    await run(
      `UPDATE chat_thread_members SET thread_id = $1
        WHERE thread_id = $2 AND user_id NOT IN (SELECT user_id FROM chat_thread_members WHERE thread_id = $1)`, [to, id]);
    await run(`DELETE FROM chat_thread_members WHERE thread_id = $1`, [id]);
    await run(`DELETE FROM chat_threads WHERE id = $1`, [id]);
  }
  return outcome;
}
