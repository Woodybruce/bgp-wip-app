/**
 * Supersession helper for chatbgp_learnings.
 *
 * Problem we're solving: ChatBGP's saved-learning bank had no concept of
 * "this fact is now obsolete." When a property's verified proprietor
 * changed (e.g. today's Haymarket dig: legacy record said Sugar/Amsprop,
 * HMLR-CCOD verified Al-Mana), both learnings would sit in the bank
 * and resurface in future answers — the stale one alongside the truth.
 *
 * Fix: when a HMLR-verified landlord lands on a property, any saved
 * learning tagged with that same subjectPropertyId BUT a different
 * subjectCompanyNumber gets marked superseded (active=false +
 * supersededAt + supersededReason). The dedup/read filter already
 * gates on active=true so the stale learnings stop feeding context.
 */

import { pool } from "./db";

export interface SupersessionResult {
  superseded: number;
  reason: string;
}

/**
 * Run after Stage 4 stamps a verified landlord on a property. Marks
 * any pre-existing learnings on that property whose
 * subjectCompanyNumber differs from the new verified landlord's CH
 * number as superseded.
 *
 * Conservative on purpose — we only touch learnings that:
 *   1. Have subjectPropertyId set to this property
 *   2. Have subjectCompanyNumber set (i.e. were tagged with a specific
 *      company at save time)
 *   3. Have a different subjectCompanyNumber than the new verified one
 *   4. Are still active (haven't been superseded by something earlier)
 *
 * Learnings without subjectCompanyNumber (free-form text only) are NOT
 * touched here — too easy to false-positive on a name mention. A future
 * Claude-based contradiction sweep can handle those.
 */
export async function supersedeContradictingLearnings(opts: {
  propertyId: string;
  newCompanyNumber: string;
  newCompanyName: string | null;
  source: string;
}): Promise<SupersessionResult> {
  const newCh = opts.newCompanyNumber.trim().toUpperCase();
  if (!opts.propertyId || !newCh) return { superseded: 0, reason: "no-op (missing inputs)" };

  const reasonText = `Superseded by ${opts.source} verification: ${opts.newCompanyName || newCh} (CH ${newCh})`;

  // Find candidates first so we can log them — helps debug false
  // positives in the early days.
  const candidates = await pool.query<{ id: number; learning: string; subject_company_number: string | null }>(
    `SELECT id, learning, subject_company_number
       FROM chatbgp_learnings
      WHERE subject_property_id = $1
        AND active = true
        AND superseded_at IS NULL
        AND subject_company_number IS NOT NULL
        AND UPPER(subject_company_number) <> $2`,
    [opts.propertyId, newCh],
  );
  if (candidates.rows.length === 0) return { superseded: 0, reason: "no contradicting learnings" };

  const ids = candidates.rows.map((r) => r.id);
  await pool.query(
    `UPDATE chatbgp_learnings
        SET active = false,
            superseded_at = NOW(),
            superseded_reason = $1
      WHERE id = ANY($2::int[])`,
    [reasonText, ids],
  );

  for (const c of candidates.rows) {
    console.log(`[learnings-supersede] superseded #${c.id} (was CH ${c.subject_company_number}): "${c.learning.slice(0, 80)}…"`);
  }
  return { superseded: candidates.rows.length, reason: reasonText };
}
