// ─────────────────────────────────────────────────────────────────────────
// Pending contact suggestions for the company profile ("From BGP inboxes").
// The SQL below expands crm_interactions.participants (a jsonb column,
// shared/schema.ts crmInteractions) with jsonb_array_elements_text —
// unnest() only works on Postgres arrays and throws on jsonb, which the
// old bare catch {} swallowed, leaving suggestions permanently empty.
// ─────────────────────────────────────────────────────────────────────────

// JS twin of the SQL expansion: crm_interactions.participants is jsonb and
// legacy rows may hold a bare string or null instead of an array. Returns
// trimmed, lowercased, de-duplicated addresses; anything else → [].
export function expandParticipants(participants: unknown): string[] {
  if (participants == null) return [];
  const raw: unknown[] = Array.isArray(participants)
    ? participants
    : typeof participants === "string"
      ? [participants]
      : [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const email = entry.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

// Email senders we've corresponded with at a company's domain who aren't
// yet CRM contacts. $1 = `%@<domain>` ILIKE pattern, $2 = company id.
// Guards:
// - jsonb_typeof = 'array' skips legacy scalar/null participants rows that
//   jsonb_array_elements_text would reject.
// - LOWER() on both sides of the exclusion so case mismatches can't leak
//   already-known contacts back in as suggestions.
// - interaction_date <= NOW() keeps future-dated rows out of last_touch.
export const PENDING_CONTACT_SUGGESTIONS_SQL = `
  SELECT LOWER(p) AS email,
         COUNT(*)::int AS touches,
         MAX(interaction_date) AS last_touch,
         EXISTS (SELECT 1 FROM crm_contacts c WHERE LOWER(c.email) = LOWER(p)) AS in_crm
    FROM crm_interactions
    CROSS JOIN LATERAL jsonb_array_elements_text(participants) AS p
   WHERE participants IS NOT NULL
     AND jsonb_typeof(participants) = 'array'
     AND interaction_date <= NOW()
     AND p ILIKE $1
     AND p NOT ILIKE '%@brucegillinghampollard.com'
     AND LOWER(p) NOT IN (
       SELECT LOWER(email) FROM crm_contacts
        WHERE company_id = $2 AND email IS NOT NULL
     )
   GROUP BY LOWER(p)
   ORDER BY touches DESC, last_touch DESC
   LIMIT 20`;
