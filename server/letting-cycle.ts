// A unit that goes back on the market starts a NEW letting: a new deal, and
// nothing carried over from the one before. The Heads of Terms flow and the
// negotiation log sit on the tracker unit, not the deal, so without this the
// earlier letting's signed and issued HOTs, its final file and its agreed
// offer would still be "live" on the new deal, which could then be converted
// to Solicitors on the old tenant's terms (review, 2026-11-12).
//
// The earlier letting stays on the record: its deal keeps its terms, the
// final HOTs file stays under the unit's files, and its offers stay listed,
// marked Closed, with their negotiation logs.
type Db = { query: (sql: string, params?: any[]) => Promise<any> };

export async function closePreviousLetting(db: Db, unitId: string, actor: { userId?: string | null; name?: string | null } = {}): Promise<void> {
  try {
    const cleared = await db.query(
      `UPDATE available_units
          SET hots_content = NULL, hots_updated_at = NULL, hots_version = 0, hots_offer_id = NULL, hots_agreed_at = NULL,
              hots_issued_at = NULL, hots_issued_by_name = NULL, hots_final_file_id = NULL, hots_final_at = NULL, hots_final_by_name = NULL
        WHERE id = $1 AND (COALESCE(hots_content, '') <> '' OR hots_issued_at IS NOT NULL OR hots_final_file_id IS NOT NULL OR hots_offer_id IS NOT NULL)
        RETURNING id`, [unitId]);
    await db.query(`DELETE FROM unit_hots_signoffs WHERE unit_id = $1`, [unitId]);
    if (cleared.rows.length) {
      // Who put it back on the market: the login's name, and for a joint
      // agent the firm they act for.
      let name = actor.name || null;
      let role: string | null = null;
      if (actor.userId) {
        const who = (await db.query(
          `SELECT u.name, u.email, a.landsec_role, a.firm FROM users u LEFT JOIN landsec_access a ON a.user_id = u.id WHERE u.id = $1`, [actor.userId])).rows[0];
        if (who) {
          name = name || who.name || who.email || null;
          if (who.landsec_role === "joint_agent") role = who.firm ? `Joint agent · ${who.firm}` : "Joint agent";
        }
      }
      await db.query(
        `INSERT INTO unit_hots_events (unit_id, kind, body, version, author_user_id, author_name, author_role) VALUES ($1, 'new_letting', $2, 0, $3, $4, $5)`,
        [unitId, "put the unit back on the market. The earlier letting's Heads of Terms were cleared for the new one; its final agreed file stays under the unit's files", actor.userId || null, name || "The tracker", role]);
    }
    await db.query(
      `UPDATE unit_offers SET status = 'Closed', updated_at = NOW()
        WHERE unit_id = $1 AND (status IS NULL OR status IN ('Pending', 'Negotiating', 'Agreed', 'Accepted'))`, [unitId]);
    // The new letting starts with no "waiting on" link: a deal clock that
    // pointed at one of the earlier letting's checklist items keeps its words
    // and loses the link (migration 0058).
    await db.query(`UPDATE landsec_deal_clock SET checklist_item_id = NULL WHERE checklist_item_id IN (SELECT id FROM deal_checklist_items WHERE unit_id = $1)`, [unitId]);
  } catch (e: any) {
    console.warn("[letting-cycle] could not close the previous letting:", e?.message);
  }
}
