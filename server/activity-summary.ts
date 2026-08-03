// The canonical activity feed — data behind ActivitySummary, fourth of the
// summary family (tracker / deals / properties / activity). One endpoint,
// two sections from the two tables everything already writes to:
//
//   upcoming — future team_events (synced BGP team diaries), noise-filtered
//              and deduped the same way the client portfolio does
//   recent   — past crm_interactions (emails / calls / meetings from the
//              M365 sync), sanitised one-line summaries only — the viewer
//              sees that a touch happened, never the message content
//
// Scopes: ?propertyId= (property page), ?companyId= (brand / landlord
// profile), none (dashboard: staff see the whole book, client logins are
// forced to their own company scope). Property scoping reuses the
// asset-brief resolution: interactions on a deal at the property plus
// interactions with the owner company's contacts by the property's agents.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { resolveCompanyScope, isPropertyInScope } from "./company-scope";
import { legacyToCode, DEAL_STATUS_LABELS } from "@shared/deal-status";

const router = Router();

const EVENT_NOISE = `title NOT ILIKE 'cancelled:%'
  AND title NOT ILIKE '%team meeting (%'
  AND title NOT ILIKE '%weekly call%'
  AND title NOT ILIKE '%padel%'`;

function summarise(a: any): string {
  const who = a.contact_name || a.company_name || "contact";
  const by = a.bgp_user ? `${String(a.bgp_user).split(" ")[0]} ` : "";
  const verb = a.type === "email"
    ? (a.direction === "outbound" ? "emailed" : "got an email from")
    : a.type === "call" ? "called"
    : a.type === "meeting" ? "met with"
    : "logged a touch with";
  const dealRef = a.deal_name ? ` re ${a.deal_name}` : "";
  return `${by}${verb} ${who}${dealRef}`.trim();
}

router.get("/api/activity-summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const scopeCompanyId = await resolveCompanyScope(req);
    let propertyId = req.query.propertyId ? String(req.query.propertyId) : null;
    let companyId = req.query.companyId ? String(req.query.companyId) : null;

    if (scopeCompanyId) {
      // Client logins: a property must sit in their portfolio; a company
      // scope may only be their own; no scope defaults to their company.
      if (propertyId && !(await isPropertyInScope(scopeCompanyId, propertyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (companyId && companyId !== scopeCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!propertyId && !companyId) companyId = scopeCompanyId;
    }

    // ── Upcoming: future diary events in scope, deduped on cleaned title ──
    let upcomingQ;
    if (propertyId) {
      upcomingQ = pool.query(
        `SELECT DISTINCT ON (lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time)
                id, title, event_type, start_time, end_time, location, property_id, property_name, deal_id
           FROM team_events
          WHERE start_time >= NOW() AND (property_id = $1
                OR property_name = (SELECT name FROM crm_properties WHERE id = $1))
            AND ${EVENT_NOISE}
          ORDER BY lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time
          LIMIT 20`,
        [propertyId]
      );
    } else if (companyId) {
      upcomingQ = pool.query(
        `SELECT DISTINCT ON (lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time)
                id, title, event_type, start_time, end_time, location, property_id, property_name, deal_id
           FROM team_events
          WHERE start_time >= NOW()
            AND (company_name = (SELECT name FROM crm_companies WHERE id = $1)
                 OR property_id IN (
                   SELECT id FROM crm_properties WHERE landlord_id = $1
                   UNION SELECT property_id FROM crm_company_properties WHERE company_id = $1))
            AND ${EVENT_NOISE}
          ORDER BY lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time
          LIMIT 20`,
        [companyId]
      );
    } else {
      upcomingQ = pool.query(
        `SELECT DISTINCT ON (lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time)
                id, title, event_type, start_time, end_time, location, property_id, property_name, deal_id
           FROM team_events
          WHERE start_time >= NOW() AND ${EVENT_NOISE}
          ORDER BY lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time
          LIMIT 20`
      );
    }

    // ── Recent: last 14 days of interactions in scope, sanitised ──
    const recentSelect = `SELECT i.id, i.type, i.direction, i.interaction_date,
              COALESCE(bu.name, i.bgp_user) AS bgp_user,
              c.name AS contact_name, c.id AS contact_id,
              co.name AS company_name,
              d.id AS deal_id, d.name AS deal_name
         FROM crm_interactions i
         LEFT JOIN users bu ON lower(bu.email) = lower(i.bgp_user)
         LEFT JOIN crm_contacts c ON c.id = i.contact_id
         LEFT JOIN crm_companies co ON co.id = c.company_id
         LEFT JOIN crm_deals d ON d.id = i.deal_id`;
    let recentQ;
    if (propertyId) {
      recentQ = pool.query(
        `${recentSelect}
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id
        WHERE i.interaction_date > NOW() - INTERVAL '14 days'
          AND (
            (d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1)
            OR (
              c.company_id IN (
                SELECT p2.landlord_id FROM crm_properties p2 WHERE p2.id = $1 AND p2.landlord_id IS NOT NULL
                UNION
                SELECT cp.company_id FROM crm_company_properties cp WHERE cp.property_id = $1
              )
              AND (
                NOT EXISTS (SELECT 1 FROM crm_property_agents pa WHERE pa.property_id = $1)
                OR lower(coalesce(i.bgp_user, '')) IN (
                  SELECT lower(u2.email) FROM crm_property_agents pa
                    JOIN users u2 ON u2.id = pa.user_id
                   WHERE pa.property_id = $1 AND u2.email IS NOT NULL
                )
              )
            )
          )
        ORDER BY i.interaction_date DESC
        LIMIT 30`,
        [propertyId]
      );
    } else if (companyId) {
      recentQ = pool.query(
        `${recentSelect}
        WHERE i.interaction_date > NOW() - INTERVAL '14 days'
          AND (c.company_id = $1 OR i.company_id = $1 OR d.landlord_id = $1 OR d.tenant_id = $1)
        ORDER BY i.interaction_date DESC
        LIMIT 30`,
        [companyId]
      );
    } else {
      recentQ = pool.query(
        `${recentSelect}
        WHERE i.interaction_date > NOW() - INTERVAL '14 days'
        ORDER BY i.interaction_date DESC
        LIMIT 30`
      );
    }

    // ── Deal movements: recently created / status-changed deals in scope —
    //    folds the old "Recent Activity (deal movements)" board into this
    //    feed (Woody, 2026-08-03). Name + canonical status only, no fees. ──
    const movesWhere = propertyId
      ? `AND d.property_id = $1`
      : companyId
        ? `AND (d.landlord_id = $1 OR d.tenant_id = $1 OR p.landlord_id = $1)`
        : "";
    const movesQ = pool.query(
      `SELECT d.id, d.name, d.status, COALESCE(d.updated_at, d.created_at) AS at, p.name AS property_name
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
        WHERE COALESCE(d.updated_at, d.created_at) > NOW() - INTERVAL '14 days'
          ${movesWhere}
        ORDER BY at DESC
        LIMIT 15`,
      propertyId ? [propertyId] : companyId ? [companyId] : []
    );

    const [upcoming, recent, moves] = await Promise.all([upcomingQ, recentQ, movesQ]);
    const moveRows = moves.rows
      .filter((m: any) => legacyToCode(m.status) !== null)
      .map((m: any) => ({
        id: `deal-${m.id}`,
        kind: "deal",
        date: m.at,
        summary: `${m.name} — ${DEAL_STATUS_LABELS[legacyToCode(m.status)!]}${m.property_name ? ` at ${m.property_name}` : ""}`,
        contact_id: null,
        deal_id: m.id,
        deal_name: m.name,
      }));
    res.json({
      upcoming: upcoming.rows
        .sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
        .map((e: any) => ({
          id: e.id, title: e.title, event_type: e.event_type,
          start_time: e.start_time, end_time: e.end_time, location: e.location,
          property_id: e.property_id, property_name: e.property_name, deal_id: e.deal_id,
        })),
      recent: [
        ...recent.rows.map((a: any) => ({
          id: a.id,
          kind: a.type,
          date: a.interaction_date,
          summary: summarise(a),
          contact_id: a.contact_id,
          deal_id: a.deal_id,
          deal_name: a.deal_name,
        })),
        ...moveRows,
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 30),
    });
  } catch (err: any) {
    console.error("[activity-summary]", err?.message);
    res.status(500).json({ message: err?.message || "activity summary failed" });
  }
});

export default router;
