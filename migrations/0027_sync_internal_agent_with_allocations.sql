-- Migration 0027 — sync crm_deals.internal_agent with fee allocation agents
--
-- Background: the Deals board's BGP Contact column reads
-- crm_deals.internal_agent; the WIP report's Agent column reads from
-- deal_fee_allocations (one entry per allocation). When fee splits
-- captured a name that wasn't already on internal_agent, the two
-- views diverged — e.g. Evie North on the WIP but missing from the
-- deal row.
--
-- The PUT /api/crm/deals/:id/fee-allocations endpoint now merges
-- allocation agents into internal_agent on save. This migration
-- heals every historical row: take the union of the deal's existing
-- internal_agent + the agentName of every non-BGP-House allocation.

WITH alloc_agents AS (
  SELECT deal_id,
         array_agg(DISTINCT TRIM(agent_name) ORDER BY TRIM(agent_name)) AS agents
    FROM deal_fee_allocations
   WHERE COALESCE(is_bgp_house, false) = false
     AND agent_name IS NOT NULL
     AND TRIM(agent_name) <> ''
   GROUP BY deal_id
),
merged AS (
  SELECT d.id AS deal_id,
         (
           SELECT array_agg(DISTINCT x ORDER BY x)
             FROM unnest(COALESCE(d.internal_agent, ARRAY[]::text[]) || COALESCE(a.agents, ARRAY[]::text[])) AS x
            WHERE x IS NOT NULL AND TRIM(x) <> ''
         ) AS new_agents,
         d.internal_agent AS old_agents
    FROM crm_deals d
    JOIN alloc_agents a ON a.deal_id = d.id
)
UPDATE crm_deals d
   SET internal_agent = m.new_agents
  FROM merged m
 WHERE d.id = m.deal_id
   AND m.new_agents IS DISTINCT FROM COALESCE(m.old_agents, ARRAY[]::text[]);
