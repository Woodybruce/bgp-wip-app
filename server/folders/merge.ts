// A company merged into another takes its folders with it (Woody, 24
// November 2026; docs/folders-review-2026-11-20.md, 4.2): the merged
// company's folder links (record_folders, record type company) move to the
// keeper, as server/property-merge.ts moves a property's, and a folder shared
// with the merged company is shared with the keeper. A folder the keeper
// already links is unlinked on the merged one, not doubled; the keeper's link
// takes the merged one's client share when it has none. Inside the merge's
// own transaction (server/brand-dedupe.ts, mergeCompanyInto). Undoing the
// merge leaves the folders on the keeper.

/** Moves them, and says how many live links and shares moved. A database without the folder tables (or the share columns) moves nothing. */
export async function moveCompanyFolders(q: { query: Function }, fromId: string, toId: string): Promise<Record<string, number>> {
  await q.query("SAVEPOINT company_folders");
  try {
    await q.query(
      `UPDATE record_folders k SET shared_with_company_id = d.shared_with_company_id, shared_by = d.shared_by, shared_at = d.shared_at
         FROM record_folders d
        WHERE k.record_type = 'company' AND k.record_id = $2 AND k.removed_at IS NULL AND k.shared_with_company_id IS NULL
          AND d.record_type = 'company' AND d.record_id = $1 AND d.removed_at IS NULL AND d.shared_with_company_id IS NOT NULL
          AND d.drive_id = k.drive_id AND d.item_id = k.item_id`, [fromId, toId]);
    await q.query(
      `UPDATE record_folders d SET removed_at = now()
        WHERE d.record_type = 'company' AND d.record_id = $1 AND d.removed_at IS NULL
          AND EXISTS (SELECT 1 FROM record_folders k WHERE k.record_type = 'company' AND k.record_id = $2
                        AND k.removed_at IS NULL AND k.drive_id = d.drive_id AND k.item_id = d.item_id)`, [fromId, toId]);
    const links = (await q.query(`UPDATE record_folders SET record_id = $2 WHERE record_type = 'company' AND record_id = $1 RETURNING (removed_at IS NULL) AS live`, [fromId, toId])).rows;
    const shares = (await q.query(`UPDATE record_folders SET shared_with_company_id = $2 WHERE shared_with_company_id = $1 RETURNING (removed_at IS NULL) AS live`, [fromId, toId])).rows;
    await q.query("RELEASE SAVEPOINT company_folders");
    const moved: Record<string, number> = {};
    const live = (rows: any[]) => rows.filter(r => r.live).length;
    if (live(links)) moved["record_folders.record_id"] = live(links);
    if (live(shares)) moved["record_folders.shared_with_company_id"] = live(shares);
    return moved;
  } catch (e: any) {
    await q.query("ROLLBACK TO SAVEPOINT company_folders");
    // 42P01: no record_folders table; 42703: no share columns yet (boot adds them).
    if (e?.code === "42P01" || e?.code === "42703") return {};
    throw e;
  }
}
