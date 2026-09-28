// One-off: 367 of 490 diary viewings had neither unit nor brand, and
// inspections were saved as viewings (Woody, 2026-09-28). Re-run the current
// brand/property matching over unconfirmed diary rows from their stored
// invitation details (no Graph calls), then retitle/resolve their tasks.
import { pool } from "./db";
import { viewingMissingDetails } from "@shared/viewing-workflow";
import { isNonLeasingVisit } from "./viewing-matching";
import { brandIssueLabels, loadViewingMatchContext, matchViewingEvent, NOT_LEASING_ISSUE } from "./viewing-sync";
import { reconcileViewingFollowup } from "./viewing-followups";

const KEY = "migration:viewing_rematch_v1";
const UNIT_ISSUE = /tracker unit|units are being viewed|confirm the property/i;
const BRAND_ISSUE = /brand|attendee/i;

export async function runViewingRematch(): Promise<void> {
  if ((await pool.query(`SELECT 1 FROM system_settings WHERE key = $1`, [KEY])).rows.length) return;
  const context = await loadViewingMatchContext();
  const rows = (await pool.query(
    `SELECT id, booking_id, unit_id, company_id, contact_id, agent_contact_id, owner_user_id, viewing_date, viewing_time, source_details
       FROM unit_viewings
      WHERE source = 'diary' AND deleted_at IS NULL AND status = 'scheduled' AND details_confirmed_at IS NULL
        AND outcome_recorded_at IS NULL AND NULLIF(TRIM(COALESCE(outcome, '')), '') IS NULL
      ORDER BY created_at`)).rows;
  const counts = { scanned: rows.length, notLeasing: 0, units: 0, brands: 0, properties: 0, tasksResolved: 0, tasksUpdated: 0, failed: 0 };
  for (const row of rows) {
    try {
      const details = row.source_details || {};
      const subject = String(details.subject || ""), location = String(details.location || "");
      if (!subject && !location) continue;
      // Guards on the values read, so a sync or an edit in between wins.
      const guard = `AND status = 'scheduled' AND details_confirmed_at IS NULL AND unit_id IS NOT DISTINCT FROM $2 AND company_id IS NOT DISTINCT FROM $3`;
      // Categories were not stored, so only the exclusion words count here
      // (a "viewing" category is assumed); a subject lacking the word
      // "viewing" alone is left for the next diary sync to judge.
      if (isNonLeasingVisit(subject) && !details.autoNotLeasing) {
        const r = await pool.query(`UPDATE unit_viewings SET status = 'not_leasing', updated_at = NOW(),
            source_details = COALESCE(source_details, '{}'::jsonb) || '{"autoNotLeasing":true}'::jsonb
          WHERE id = $1 ${guard}`, [row.id, row.unit_id, row.company_id]);
        counts.notLeasing += r.rowCount || 0;
      } else {
        const participants = (Array.isArray(details.participants) ? details.participants : [])
          .filter((person: any) => typeof person?.email === "string").map((person: any) => ({ email: person.email.trim().toLowerCase() }));
        const { brand, brandReason, unitMatch } = await matchViewingEvent({ subject, location, participants }, context);
        let unitId = row.unit_id || (unitMatch.units.length === 1 ? unitMatch.units[0].id : null);
        // A multi-unit booking already holding that unit on another row keeps it there.
        if (unitId && unitId !== row.unit_id && row.booking_id && (await pool.query(
          `SELECT 1 FROM unit_viewings WHERE booking_id = $1 AND unit_id = $2 AND id <> $3 AND deleted_at IS NULL LIMIT 1`,
          [row.booking_id, unitId, row.id])).rows.length) unitId = row.unit_id;
        const fillBrand = !row.company_id && !!brand.brandId;
        const property = unitMatch.property;
        if (unitId !== row.unit_id || fillBrand || (property && property.id !== details.sourcePropertyId)) {
          const values = {
            unitId, companyId: fillBrand ? brand.brandId : row.company_id,
            contactId: row.contact_id || (fillBrand ? brand.contactId : null),
            agentContactId: row.agent_contact_id || (fillBrand ? brand.agentContactId : null),
            ownerUserId: row.owner_user_id, viewingDate: row.viewing_date, viewingTime: row.viewing_time,
          };
          const kept = (Array.isArray(details.issues) ? details.issues as string[] : [])
            .filter(issue => !(unitId && UNIT_ISSUE.test(issue)) && !(fillBrand && BRAND_ISSUE.test(issue)) && issue !== NOT_LEASING_ISSUE);
          const issues = [...new Set([...kept, ...(fillBrand ? brand.reasons.map(reason => brandIssueLabels[reason] || reason) : []), ...viewingMissingDetails(values)])];
          const patch = { issues, ...(property ? { sourcePropertyId: property.id, sourcePropertyName: property.name } : {}), ...(fillBrand ? { sourceCompanyId: brand.brandId, brandReason } : {}) };
          const r = await pool.query(`UPDATE unit_viewings SET unit_id = $4, company_id = $5, company_name = COALESCE($6, company_name),
              contact_id = $7, agent_contact_id = $8, contact_name = COALESCE(contact_name, $9), requirement_id = COALESCE(requirement_id, $10),
              source_details = COALESCE(source_details, '{}'::jsonb) || $11::jsonb, updated_at = NOW()
            WHERE id = $1 ${guard}`,
          [row.id, row.unit_id, row.company_id, unitId, values.companyId, fillBrand ? brand.brandName : null,
            values.contactId, values.agentContactId, fillBrand ? brand.contactName : null, fillBrand ? brand.requirementId : null, JSON.stringify(patch)]);
          if (r.rowCount) {
            if (unitId !== row.unit_id) counts.units++;
            if (fillBrand) counts.brands++;
            if (property && property.id !== details.sourcePropertyId) counts.properties++;
          }
        }
      }
      const result = await reconcileViewingFollowup(row.id);
      counts.tasksResolved += result.resolved;
      counts.tasksUpdated += result.updated + result.created;
    } catch (e: any) {
      counts.failed++;
      console.error(`[viewing-rematch] ${row.id} failed:`, e?.message);
    }
  }
  console.log(`[viewing-rematch] ${JSON.stringify(counts)}`);
  await pool.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
    [KEY, JSON.stringify({ ...counts, at: new Date().toISOString() })]);
}
