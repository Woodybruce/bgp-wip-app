// A private individual's date of birth and nationality, typed in by BGP
// (Woody, 24 November 2026). Rules: shared/kyc-person-details.ts. One row per
// party record in kyc_person_details (boot migration in server/index.ts): the
// brand, with the person who signs when the transaction names one. BGP's
// checks before asking screen the person with them (server/kyc-prechecks.ts),
// and the sanctions-only sign-off of a private individual waits for the date
// (signOffFacts in server/deal-party-aml.ts). The route is there too.
import { pool } from "./db";
import type { PersonDetails } from "@shared/kyc-person-details";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v || ""));
// A date column comes back as a Date at midnight UTC, or as text: either way yyyy-mm-dd.
const ymd = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || "").slice(0, 10));

/** The details held for a party record, or null. */
export async function readPersonDetails(companyId: string, entityId: string | null, db: Db = pool): Promise<PersonDetails | null> {
  const row = (await db.query(
    `SELECT date_of_birth, nationality, recorded_by_name, recorded_at FROM kyc_person_details
      WHERE company_id = $1 AND COALESCE(trading_entity_id, '') = COALESCE($2::varchar, '')`, [companyId, entityId])).rows[0];
  return row ? { dateOfBirth: ymd(row.date_of_birth), nationality: row.nationality || null, recordedBy: row.recorded_by_name || null, recordedAt: iso(row.recorded_at) } : null;
}

/** Save the details (one row per party record), with a line on its KYC history. */
export async function savePersonDetails(companyId: string, entityId: string | null, input: { dateOfBirth: string; nationality: string | null }, me: { id: string; name: string }, db: Db = pool): Promise<PersonDetails> {
  const before = await readPersonDetails(companyId, entityId, db).catch(() => null);
  await db.query(
    `INSERT INTO kyc_person_details (company_id, trading_entity_id, date_of_birth, nationality, recorded_by, recorded_by_name, recorded_at)
     VALUES ($1, $2, $3::date, $4, $5, $6, now())
     ON CONFLICT (company_id, (COALESCE(trading_entity_id, '')))
     DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth, nationality = EXCLUDED.nationality,
                   recorded_by = EXCLUDED.recorded_by, recorded_by_name = EXCLUDED.recorded_by_name, recorded_at = now()`,
    [companyId, entityId, input.dateOfBirth, input.nationality, me.id, me.name]);
  const changed = before ? ` (was ${before.dateOfBirth}${before.nationality ? `, ${before.nationality}` : ""})` : "";
  await db.query(
    `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'person_details', $2, $3, $4, $5)`,
    [companyId, me.name, `Date of birth ${input.dateOfBirth}${input.nationality ? `, nationality ${input.nationality}` : ""}, typed in by BGP${changed}`,
      entityId ? "trading_entity" : null, entityId]).catch(() => undefined);
  return (await readPersonDetails(companyId, entityId, db))!;
}
