-- Migration 0026 — replace UUIDs in crm_deals.internal_agent with display names
--
-- Background: four server endpoints (backfill-tracker-deals, the
-- investment-tracker POST, and the tracker → deal converter) were
-- writing the raw `agent_user_ids` array into `internal_agent`. The
-- column stores display NAMES (the chip render + the BGP-Contact
-- dropdown both look up by name), so every deal that came through
-- those paths surfaced a UUID in the Edit Deal dialog.
--
-- The four code paths now resolve IDs → names via resolveAgentNames();
-- this migration heals the existing data. Anything that doesn't match
-- a users.id (e.g. a name that was correctly stored before) is left
-- alone.

WITH heal AS (
  SELECT d.id AS deal_id,
         array_agg(COALESCE(u.name, a.elem) ORDER BY a.ord) AS new_agents
    FROM crm_deals d
         CROSS JOIN LATERAL unnest(d.internal_agent)
              WITH ORDINALITY AS a(elem, ord)
         LEFT JOIN users u ON u.id = a.elem
   WHERE d.internal_agent IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM unnest(d.internal_agent) AS e
        WHERE e ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     )
   GROUP BY d.id
)
UPDATE crm_deals d
   SET internal_agent = h.new_agents
  FROM heal h
 WHERE d.id = h.deal_id;
