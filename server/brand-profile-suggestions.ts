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
  WITH senders AS (
    SELECT LOWER(p) AS email,
           COUNT(*)::int AS touches,
           MAX(interaction_date) AS last_touch
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
     LIMIT 20)
  -- in_crm is computed after grouping: a correlated subquery on the raw
  -- participant inside the GROUP BY failed the whole query (2026-09-23).
  SELECT s.*, EXISTS (SELECT 1 FROM crm_contacts c WHERE LOWER(c.email) = s.email) AS in_crm
    FROM senders s
   ORDER BY s.touches DESC, s.last_touch DESC`;

// The brand's whole BGP email history — CRM contacts AND inbox senders at
// its domain. The relationship line used to count only not-yet-CRM senders,
// so promoting David Menendez dropped Honest Greens from 49 threads / 69
// days to 3 / 181 (Woody, 2026-09-23). $1 = '%@domain', $2 = company id.
export const RELATIONSHIP_STATS_SQL = `
  WITH hits AS (
    SELECT i.id, i.interaction_date, LOWER(p) AS person
      FROM crm_interactions i
      LEFT JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(i.participants) = 'array' THEN i.participants ELSE '[]'::jsonb END) AS p ON true
     WHERE i.interaction_date <= NOW()
       AND (i.company_id = $2 OR (p ILIKE $1 AND p NOT ILIKE '%@brucegillinghampollard.com'))
  )
  SELECT COUNT(DISTINCT id)::int AS threads,
         COUNT(DISTINCT id) FILTER (WHERE interaction_date > NOW() - interval '90 days')::int AS threads_90d,
         MAX(interaction_date) AS last_touch,
         COUNT(DISTINCT person) FILTER (WHERE person ILIKE $1 AND interaction_date > NOW() - interval '90 days')::int AS people_90d
    FROM hits`;
