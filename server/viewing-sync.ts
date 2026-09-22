// Calendar candidates and tracker viewings share the same records. Unclear
// invites remain in Needs details rather than disappearing or guessing a tenant.
import { pool } from "./db";
import { createHash } from "node:crypto";
import { viewingMissingDetails } from "@shared/viewing-workflow";
import { isLeasingViewing, londonViewingDateTime, matchViewingBrand, matchViewingUnits, normalizeViewingEmail, parseGraphDateTime,
  type ViewingBrandLink, type ViewingBrandMatch, type ViewingContact } from "./viewing-matching";

export interface DiaryEvent {
  id: string;
  iCalUId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  location?: { displayName?: string | null } | null;
  categories?: string[] | null;
  isCancelled?: boolean | null;
  start?: { dateTime: string; timeZone: string } | null;
  organizer?: { emailAddress?: { name?: string; address?: string } } | null;
  attendees?: { emailAddress?: { name?: string; address?: string } }[] | null;
}

const BGP_DOMAIN = "@brucegillinghampollard.com";

export function looksLikeViewing(subject: string | null | undefined, categories?: string[] | null): boolean {
  const s = (subject || "").toLowerCase();
  if ((categories || []).some(c => (c || "").toLowerCase().includes("viewing"))) return true;
  // Site tours, walk-arounds and inspections ARE viewings — same rule the
  // dashboard Team Calendar uses (Woody, 2026-08-04: inspection = viewing).
  return /\bview(ing)?\b|\bsite tour\b|\bwalk ?(a)?round\b|\binspection\b/.test(s);
}

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase();
}

const londonDateTime = londonViewingDateTime;

interface TrackerUnit { id: string; unitName: string; propertyId: string; propertyName: string }

async function loadTrackerUnits(): Promise<TrackerUnit[]> {
  const r = await pool.query(
    `SELECT au.id, COALESCE(au.unit_name, '') AS unit_name, au.property_id, p.name AS property_name
       FROM available_units au
       JOIN crm_properties p ON p.id = au.property_id`
  );
  return r.rows.map((row: any) => ({
    id: row.id, unitName: row.unit_name, propertyId: row.property_id, propertyName: row.property_name || "",
  }));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Resolve the tracker unit an event refers to, or null if it can't be
// anchored confidently. companyId (the matched external contact's company)
// breaks ties on multi-unit properties: if that company has exactly one
// live deal-linked unit at the property, that's the unit being viewed.
async function resolveUnit(hay: string, units: TrackerUnit[], companyId?: string | null): Promise<TrackerUnit | null> {
  // Property first — longest matching name wins (≥5 chars, comma-tail
  // stripped, same rule as the client team-events sync). Full names rarely
  // appear verbatim in diary subjects ("Bluewater" not "Bluewater Shopping
  // Centre"), so a distinctive first word (≥6 chars, unique across
  // properties) matches too.
  const byProperty = new Map<string, { name: string; units: TrackerUnit[] }>();
  for (const u of units) {
    if (!byProperty.has(u.propertyId)) byProperty.set(u.propertyId, { name: u.propertyName, units: [] });
    byProperty.get(u.propertyId)!.units.push(u);
  }
  const firstWordCounts = new Map<string, number>();
  for (const p of byProperty.values()) {
    const w = norm(p.name).split(/[\s,]+/)[0] || "";
    firstWordCounts.set(w, (firstWordCounts.get(w) || 0) + 1);
  }
  let prop: { id: string; name: string; units: TrackerUnit[] } | null = null;
  let bestLen = 0;
  for (const [pid, p] of byProperty.entries()) {
    const needle = norm(p.name.replace(/,.*$/, "").trim());
    if (needle.length >= 5 && hay.includes(needle) && needle.length > bestLen) {
      prop = { id: pid, ...p }; bestLen = needle.length;
      continue;
    }
    const firstWord = norm(p.name).split(/[\s,]+/)[0] || "";
    if (
      firstWord.length >= 6 &&
      firstWordCounts.get(firstWord) === 1 &&
      new RegExp(`\\b${escapeRe(firstWord)}\\b`).test(hay) &&
      firstWord.length > bestLen
    ) {
      prop = { id: pid, ...p }; bestLen = firstWord.length;
    }
  }
  // No property named — fall back to a distinctive unit name alone
  // ("Little Bao Boy viewing - Arch 11" carries no property but the arch
  // number is unique across the tracker).
  if (!prop) return resolveUnitByNameOnly(hay, units);

  // Unit name within the property — unit names are stored with the scheme
  // appended ("MSU9, Bluewater, Bluewater"), so match on the first comma
  // segment, word-bounded ("U1" must not hit "U124"). Longest match wins.
  let unit: TrackerUnit | null = null;
  let bestUnitLen = 0;
  for (const u of prop.units) {
    const needle = norm((u.unitName.split(",")[0] || "").trim());
    if (needle.length >= 2 && new RegExp(`\\b${escapeRe(needle)}\\b`).test(hay) && needle.length > bestUnitLen) {
      unit = u; bestUnitLen = needle.length;
    }
  }
  if (unit) return unit;
  // No unit named but the property only has one tracker unit → unambiguous.
  if (prop.units.length === 1) return prop.units[0];
  // Multi-unit property: anchor via the attendee's company — the unit whose
  // linked deal has that company as tenant, when there's exactly one.
  if (companyId) {
    try {
      const r = await pool.query(
        `SELECT au.id FROM available_units au
           JOIN crm_deals d ON d.id = au.deal_id
          WHERE au.property_id = $1 AND d.tenant_id = $2
          LIMIT 2`,
        [prop.id, companyId]
      );
      if (r.rows.length === 1) {
        return prop.units.find(u => u.id === r.rows[0].id) || null;
      }
      // History tiebreak — the company already has activity (a viewing,
      // offer or interest row) on exactly one unit at this property; a new
      // mention is near-certainly about the same unit.
      const h = await pool.query(
        `SELECT DISTINCT a.unit_id FROM (
           SELECT v.unit_id, v.company_id FROM unit_viewings v
           UNION ALL SELECT o.unit_id, o.company_id FROM unit_offers o
           UNION ALL SELECT i.unit_id, i.company_id FROM unit_interest i
         ) a JOIN available_units au ON au.id = a.unit_id
         WHERE au.property_id = $1 AND a.company_id = $2 LIMIT 2`,
        [prop.id, companyId]
      );
      if (h.rows.length === 1) {
        return prop.units.find(u => u.id === h.rows[0].unit_id) || null;
      }
    } catch { /* tiebreak is best-effort */ }
  }
  return null;
}

// Fallback when NO property name appears in the text: a distinctive tracker
// unit name alone can anchor ("Arch 12a", "MSU9", "Unit 3.12"). Only fires
// when the (word-bounded) unit token matches exactly one unit across the
// whole tracker, and the token is specific enough to trust: it must carry a
// digit (bare "Unit"/"Kiosk" never anchors) and be ≥4 chars, or be an
// unusual ≥8-char name.
function resolveUnitByNameOnly(hay: string, units: TrackerUnit[]): TrackerUnit | null {
  let match: TrackerUnit | null = null;
  let matchCount = 0;
  let bestLen = 0;
  for (const u of units) {
    const needle = norm((u.unitName.split(",")[0] || "").trim());
    // "Unit 2" / "Kiosk 3" style names repeat across schemes — never let
    // them anchor without a property. "Arch 12a" / "MSU9" / "U052B" can.
    const generic = /^(unit|kiosk|shop|suite|store|room)\s*\d{1,3}[a-z]?$/.test(needle);
    const distinctive = !generic && ((needle.length >= 4 && /\d/.test(needle)) || needle.length >= 8);
    if (!distinctive) continue;
    if (new RegExp(`\\b${escapeRe(needle)}\\b`).test(hay)) {
      if (needle.length > bestLen) { match = u; bestLen = needle.length; matchCount = 1; }
      else if (needle.length === bestLen && match?.id !== u.id) matchCount++;
    }
  }
  return matchCount === 1 ? match : null;
}

async function loadViewingPeople(emails: string[], db: Pick<import("pg").PoolClient, "query"> = pool): Promise<ViewingBrandMatch> {
  const normalized = [...new Set(emails.map(normalizeViewingEmail))];
  if (!normalized.length) return matchViewingBrand([], [], []);
  const contacts = await db.query<ViewingContact>(
    `SELECT ct.id, ct.name, ct.email, ct.company_id AS "companyId",
            co.name AS "companyName", co.company_type AS "companyType"
       FROM crm_contacts ct LEFT JOIN crm_companies co ON co.id = ct.company_id AND co.merged_into_id IS NULL
      WHERE LOWER(TRIM(ct.email)) = ANY($1)`, [normalized]);
  const contactIds = contacts.rows.map(contact => contact.id);
  const links = await db.query<ViewingBrandLink>(
    `SELECT r.primary_contact_id AS "contactId", b.id AS "brandId", b.name AS "brandName",
            NULL::varchar AS "requirementId", 'agent'::text AS kind
       FROM brand_agent_representations r JOIN crm_companies b ON b.id = r.brand_company_id
      WHERE r.primary_contact_id = ANY($1) AND r.agent_type = 'tenant_rep'
        AND r.end_date IS NULL AND (r.start_date IS NULL OR r.start_date <= NOW())
        AND b.merged_into_id IS NULL AND b.company_type ILIKE 'Tenant%'
      UNION ALL
     SELECT q.agent_contact_id, b.id, b.name, q.id, 'agent'::text
       FROM crm_requirements_leasing q JOIN crm_companies b ON b.id = q.company_id
      WHERE q.agent_contact_id = ANY($1) AND LOWER(TRIM(COALESCE(q.status, ''))) IN ('', 'active')
        AND b.merged_into_id IS NULL AND b.company_type ILIKE 'Tenant%'
      UNION ALL
     SELECT q.principal_contact_id, b.id, b.name, q.id, 'principal'::text
       FROM crm_requirements_leasing q JOIN crm_companies b ON b.id = q.company_id
      WHERE q.principal_contact_id = ANY($1) AND LOWER(TRIM(COALESCE(q.status, ''))) IN ('', 'active')
        AND b.merged_into_id IS NULL AND b.company_type ILIKE 'Tenant%'`, [contactIds]);
  return matchViewingBrand(normalized, contacts.rows, links.rows);
}

const brandIssueLabels: Record<string, string> = {
  duplicate_contact_email: "Resolve duplicate CRM contacts using this attendee email",
  unmatched_attendee: "Identify the external attendees not found in the CRM",
  unconfirmed_attendee_role: "Confirm which attendee represents the viewing brand",
  missing_external_contact: "Add a brand contact or representing agent",
  ambiguous_brand: "Confirm the brand: attendee links identify more than one possibility",
  missing_brand: "Confirm the brand being represented",
};

export async function syncDiaryViewings(events: DiaryEvent[], mailboxEmail: string, window?: { complete: boolean; start: string; end: string }): Promise<number> {
  // Include cancellations even after the title has changed, so old bookings
  // cannot stay scheduled simply because a cancelled invite no longer matches.
  const eventKeys = events.map(event => event.iCalUId || `cal_${event.id}`);
  const captured = await pool.query<{ booking_id: string | null; calendar_event_id: string }>(
    `SELECT booking_id, calendar_event_id FROM unit_viewings WHERE booking_id = ANY($1) OR calendar_event_id = ANY($1)`, [eventKeys]);
  const capturedKeys = new Set(captured.rows.map(row => row.booking_id || row.calendar_event_id));
  const candidates = events.filter(event => event.isCancelled || looksLikeViewing(event.subject, event.categories) || capturedKeys.has(event.iCalUId || `cal_${event.id}`));
  const units = await loadTrackerUnits();
  const owners = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE LOWER(email) LIKE '%@brucegillinghampollard.com'
      AND COALESCE(is_active, true) = true AND COALESCE(client_view_mode, false) = false`);
  let created = 0;
  const failures: string[] = [];
  for (const event of candidates) {
    const bookingId = event.iCalUId || `cal_${event.id}`;
    const client = await pool.connect();
    let bookingCreated = 0;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`viewing:${bookingId}`]);
      const existing = await client.query(
        `SELECT * FROM unit_viewings WHERE booking_id = $1 OR calendar_event_id = $1 FOR UPDATE`, [bookingId]);
      if (event.isCancelled) {
        await client.query(`UPDATE unit_viewings SET booking_id = $1, status = 'cancelled', updated_at = NOW()
          WHERE (booking_id = $1 OR calendar_event_id = $1) AND deleted_at IS NULL`, [bookingId]);
        await client.query("COMMIT");
        continue;
      }
      // A deliberate deletion is a durable tombstone, including the base row
      // that would otherwise be recreated by another attendee's calendar.
      if (existing.rows.some(row => row.calendar_event_id === bookingId && row.deleted_at)) {
        await client.query("COMMIT");
        continue;
      }
      const participants = [event.organizer?.emailAddress, ...(event.attendees || []).map(attendee => attendee.emailAddress)]
        .filter((person): person is { name?: string; address: string } => !!person?.address)
        .map(person => ({ name: person.name || "", email: normalizeViewingEmail(person.address) }));
      const external = participants.filter(person => !person.email.endsWith(BGP_DOMAIN));
      const brand = await loadViewingPeople(external.map(person => person.email), client);
      const unitMatch = matchViewingUnits(`${event.subject || ""} ${event.location?.displayName || ""}`, units);
      const organizer = normalizeViewingEmail(event.organizer?.emailAddress?.address || "");
      const owner = owners.rows.find(user => normalizeViewingEmail(user.email) === organizer)
        || owners.rows.find(user => normalizeViewingEmail(user.email) === normalizeViewingEmail(mailboxEmail));
      let date = "", time: string | null = null;
      let sourceStartAt: string | null = null;
      const issues = [...unitMatch.issues, ...brand.reasons.map(reason => brandIssueLabels[reason] || reason)];
      if (!isLeasingViewing(event.subject, event.categories)) issues.push("Confirm that this is a leasing viewing, not an inspection or contractor visit");
      try {
        if (event.start) {
          ({ date, time } = londonViewingDateTime(event.start));
          sourceStartAt = parseGraphDateTime(event.start).toISOString();
        }
      } catch { issues.push("Confirm the calendar date and time"); }
      const sourceFingerprint = createHash("sha256").update(JSON.stringify({
        subject: (event.subject || "").trim(), location: (event.location?.displayName || "").trim(),
        organizer, participants: [...new Set(external.map(person => person.email))].sort(), date, time,
      })).digest("hex");
      const sourceDetails = {
        subject: event.subject || "", location: event.location?.displayName || "", organizer,
        mailbox: mailboxEmail, participants, issues, sourceStartAt,
        sourceUnitIds: unitMatch.units.map(unit => unit.id), sourceCompanyId: brand.brandId,
        candidateBrandIds: brand.candidateBrandIds, sourceFingerprint,
      };
      const changeIssue = "Calendar invitation changed: review the unit, brand and time";
      const sourceChanged = existing.rows.some(row => (row.source_details?.sourceFingerprint && row.source_details.sourceFingerprint !== sourceFingerprint)
        || (!row.details_confirmed_at && row.source_details?.issues?.includes(changeIssue)));
      // A changed invitation asks for review of existing links; it never
      // silently moves a manually confirmed booking to a new brand or unit.
      const protectLinks = existing.rows.some(row => row.details_confirmed_at || row.outcome_recorded_at || row.outcome || row.status !== "scheduled");
      const targets: Array<{ row?: any; unitId: string | null; key: string }> = [];
      if (existing.rows.length) {
        for (const row of existing.rows) if (!row.deleted_at) targets.push({ row, unitId: row.unit_id, key: row.calendar_event_id });
      }
      if (!protectLinks && !sourceChanged) {
        const assigned = new Set(targets.map(target => target.unitId));
        for (const unit of unitMatch.units) {
          if (assigned.has(unit.id)) continue;
          const empty = targets.find(target => !target.unitId);
          if (empty) empty.unitId = unit.id;
          else targets.push({ unitId: unit.id, key: targets.length ? `${bookingId}::unit:${unit.id}` : bookingId });
          assigned.add(unit.id);
        }
      }
      if (!targets.length && !existing.rows.length) targets.push({ unitId: null, key: bookingId });
      for (const target of targets) {
        const row = target.row;
        const preserve = !!row && (protectLinks || sourceChanged);
        const values = {
          unitId: target.unitId, companyId: preserve ? row.company_id : brand.brandId,
          companyName: preserve ? row.company_name : brand.brandName,
          contactId: preserve ? row.contact_id : brand.contactId, contactName: preserve ? row.contact_name : brand.contactId ? brand.contactName : null,
          agentContactId: preserve ? row.agent_contact_id : brand.agentContactId,
          ownerUserId: preserve ? row.owner_user_id : owner?.id || null,
          requirementId: preserve ? row.requirement_id : brand.requirementId,
          viewingDate: row && (row.outcome_recorded_at || row.outcome || row.status !== "scheduled") ? row.viewing_date : date,
          viewingTime: row && (row.outcome_recorded_at || row.outcome || row.status !== "scheduled") ? row.viewing_time : time,
        };
        const rowIssues = row?.details_confirmed_at && !sourceChanged ? []
          : [...new Set([...issues, ...viewingMissingDetails(values), ...(sourceChanged ? [changeIssue] : [])])];
        const confirmed = row?.details_confirmed_at && !sourceChanged ? row.details_confirmed_at : (!preserve && !rowIssues.length ? new Date() : null);
        const details = { ...sourceDetails, ownerMailbox: owners.rows.find(user => user.id === values.ownerUserId)?.email?.toLowerCase() || null, issues: rowIssues };
        const args = [values.unitId, values.companyName, values.contactName, values.contactId, values.companyId,
          values.viewingDate, values.viewingTime, external.map(person => person.name ? `${person.name} <${person.email}>` : person.email).join(", ") || null,
          values.agentContactId, values.ownerUserId, values.requirementId, confirmed, JSON.stringify(details), bookingId];
        if (row) {
          await client.query(`UPDATE unit_viewings SET unit_id=$1, company_name=$2, contact_name=$3, contact_id=$4, company_id=$5,
            viewing_date=$6, viewing_time=$7, attendees=$8, agent_contact_id=$9, owner_user_id=$10, requirement_id=$11,
            details_confirmed_at=$12, source_details=$13, booking_id=$14, updated_at=NOW() WHERE id=$15 AND deleted_at IS NULL`, [...args, row.id]);
        } else {
          const inserted = await client.query(`INSERT INTO unit_viewings
            (unit_id,company_name,contact_name,contact_id,company_id,viewing_date,viewing_time,attendees,agent_contact_id,
             owner_user_id,requirement_id,details_confirmed_at,source_details,booking_id,calendar_event_id,source,notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'diary',$16)
            ON CONFLICT (calendar_event_id) WHERE calendar_event_id IS NOT NULL DO NOTHING RETURNING id`,
          [...args, target.key, "Synced from Outlook"]);
          bookingCreated += inserted.rows.length;
        }
      }
      await client.query("COMMIT");
      created += bookingCreated;
    } catch (error: any) {
      await client.query("ROLLBACK");
      failures.push(error?.message || "Unknown viewing capture error");
    } finally { client.release(); }
  }
  if (failures.length) throw new Error(`${failures.length} calendar booking(s) could not be saved: ${failures[0]}`);
  if (window?.complete) {
    // Only a fully fetched snapshot can establish absence. Ask the owner to
    // review it; an invitation removed from Outlook is not proof of a no-show.
    await pool.query(`UPDATE unit_viewings SET details_confirmed_at=NULL, updated_at=NOW(),
      source_details=jsonb_set(source_details,'{issues}',COALESCE(source_details->'issues','[]'::jsonb) || to_jsonb($5::text))
      WHERE source='diary' AND deleted_at IS NULL AND status='scheduled' AND outcome_recorded_at IS NULL
        AND NULLIF(TRIM(COALESCE(outcome,'')),'') IS NULL
        AND LOWER(source_details->>'ownerMailbox')=$1
        AND source_details->>'sourceStartAt' >= $3 AND source_details->>'sourceStartAt' <= $4
        AND NOT (COALESCE(booking_id,calendar_event_id)=ANY($2::text[]))
        AND NOT (COALESCE(source_details->'issues','[]'::jsonb) ? $5)`,
      [normalizeViewingEmail(mailboxEmail), eventKeys, window.start, window.end, "No longer in the owner's calendar: confirm whether this viewing was cancelled"]);
  }
  return created;
}

// ─── Diary → interest (UX #71, Woody: "automated too from diaries") ──────
// A diary call/meeting that names a tracker unit and involves a known
// external tenant contact is an interest signal even when it isn't a
// viewing — "Call with Honi Poke re L015" should land on the Interest
// strip without anyone typing it in. Same anchors as the email leg
// (contact + unit), viewings are excluded (they already sync as viewings),
// and the 90-day already-engaged check stops duplicates.
export async function syncDiaryInterest(events: DiaryEvent[], mailboxEmail: string): Promise<number> {
  const candidates = events.filter(e =>
    !e.isCancelled && e.start?.dateTime &&
    !looksLikeViewing(e.subject, e.categories) &&
    /\b(call|catch[- ]?up|meeting|intro|enquir|interest|discuss|chat|follow[- ]?up)\b/i.test(
      `${e.subject || ""} ${e.bodyPreview || ""}`
    )
  );
  if (candidates.length === 0) return 0;

  const units = await loadTrackerUnits();
  if (units.length === 0) return 0;
  let created = 0;

  for (const event of candidates) {
    try {
      const hay = norm(`${event.subject || ""} ${event.location?.displayName || ""} ${event.bodyPreview || ""}`);
      const external = [
        event.organizer?.emailAddress,
        ...(event.attendees || []).map(a => a?.emailAddress),
      ].filter((a): a is { name?: string; address?: string } =>
        !!a?.address && !a.address.toLowerCase().endsWith(BGP_DOMAIN)
      );
      if (external.length === 0) continue;
      const emails = [...new Set(external.map(a => a.address!.toLowerCase()))];
      const brand = await loadViewingPeople(emails);
      if (!brand.brandId || brand.reasons.length) continue;
      const contact = { id: brand.contactId || brand.agentContactId, name: brand.contactName,
        company_id: brand.brandId, company_name: brand.brandName };

      const unit = await resolveUnit(hay, units, contact.company_id);
      if (!unit) continue;

      if (contact.company_id) {
        const existing = await pool.query(
          `SELECT 1 FROM (
             SELECT unit_id, company_id, created_at FROM unit_interest
             UNION ALL SELECT unit_id, company_id, created_at FROM unit_viewings
             UNION ALL SELECT unit_id, company_id, created_at FROM unit_offers
           ) a WHERE a.unit_id = $1 AND a.company_id = $2
             AND a.created_at >= NOW() - INTERVAL '90 days' LIMIT 1`,
          [unit.id, contact.company_id]
        );
        if (existing.rows.length) continue;
      }

      const { date } = londonDateTime(event.start!);
      const calKey = `cal_${event.iCalUId || event.id}`;

      const res = await pool.query(
        `INSERT INTO unit_interest
           (unit_id, company_name, contact_name, contact_id, company_id,
            interest_date, notes, source, email_conversation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'diary', $8)
         ON CONFLICT (email_conversation_id) WHERE email_conversation_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          unit.id, contact.company_name || null, contact.name || null,
          contact.id, contact.company_id || null, date,
          `Synced from ${mailboxEmail}'s Outlook diary: "${event.subject || ""}"`,
          calKey,
        ]
      );
      if (res.rows.length) created++;
    } catch (e: any) {
      console.error("[interest-sync] diary upsert failed:", e?.message);
    }
  }

  if (created > 0) console.log(`[interest-sync] ${mailboxEmail}: ${created} interest row(s) from diary`);
  return created;
}

// ─── Email → offers check ────────────────────────────────────────────────
// Offers arrive by email, not diary. The hourly inbox sweep runs each
// message through this: offer language + a tracker-unit anchor + a known
// external contact ⇒ an unconfirmed offer row (status 'Pending',
// source 'email', figures left blank for a human to confirm). One row per
// email thread via Graph conversationId, and never a second row when an
// offer for the same unit + company was already logged in the last 60
// days — so it flags what's missing from the tracker without duplicating
// what the team already typed in.

export interface InboxMessage {
  id: string;
  conversationId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { name?: string; address?: string } } | null;
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[] | null;
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[] | null;
}

export function looksLikeOffer(subject: string | null | undefined, bodyPreview?: string | null): boolean {
  if (/\boffers?\b/i.test(subject || "")) return true;
  return /\b(our offer|offer of|revised offer|improved offer|offer for|make an offer|submit(ted)? an offer|offer submitted|best and final|heads of terms)\b/i.test(bodyPreview || "");
}

export async function syncOfferEmails(messages: InboxMessage[], mailboxEmail: string): Promise<number> {
  const candidates = messages.filter(m => looksLikeOffer(m.subject, m.bodyPreview));
  if (candidates.length === 0) return 0;

  const units = await loadTrackerUnits();
  if (units.length === 0) return 0;
  let created = 0;

  for (const msg of candidates) {
    try {
      const hay = norm(`${msg.subject || ""} ${msg.bodyPreview || ""}`);

      // The offering party: a non-BGP participant we know in the CRM. No
      // known external contact → too weak a signal, skip (keeps "special
      // offer" newsletters that happen to name a scheme out of the tracker).
      // Resolved BEFORE the unit so the company can break ties on
      // multi-unit properties.
      const external = [
        msg.from?.emailAddress,
        ...(msg.toRecipients || []).map(r => r?.emailAddress),
        ...(msg.ccRecipients || []).map(r => r?.emailAddress),
      ].filter((a): a is { name?: string; address?: string } =>
        !!a?.address && !a.address.toLowerCase().endsWith(BGP_DOMAIN)
      );
      if (external.length === 0) continue;
      const emails = [...new Set(external.map(a => a.address!.toLowerCase()))];
      const brand = await loadViewingPeople(emails);
      if (!brand.brandId || brand.reasons.length) continue;
      const contact = { id: brand.contactId || brand.agentContactId, name: brand.contactName,
        company_id: brand.brandId, company_name: brand.brandName };

      const unit = await resolveUnit(hay, units, contact.company_id);
      if (!unit) continue;

      // Already logged? Same unit + company with an offer in the last 60
      // days (manual or synced) means the tracker is up to date — skip.
      if (contact.company_id) {
        const existing = await pool.query(
          `SELECT 1 FROM unit_offers
            WHERE unit_id = $1 AND company_id = $2
              AND offer_date ~ '^\\d{4}-\\d{2}-\\d{2}'
              AND offer_date::date >= (NOW() - INTERVAL '60 days')::date
            LIMIT 1`,
          [unit.id, contact.company_id]
        );
        if (existing.rows.length) continue;
      }

      const received = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
      const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
      const parts = Object.fromEntries(fmt.formatToParts(received).map(p => [p.type, p.value]));
      const offerDate = `${parts.year}-${parts.month}-${parts.day}`;
      const convKey = msg.conversationId ? `conv_${msg.conversationId}` : `msg_${msg.id}`;

      const res = await pool.query(
        `INSERT INTO unit_offers
           (unit_id, company_name, contact_name, contact_id, company_id,
            offer_date, status, comments, source, email_conversation_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'Pending', $7, 'email', $8)
         ON CONFLICT (email_conversation_id) WHERE email_conversation_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          unit.id, contact.company_name || null, contact.name || null,
          contact.id, contact.company_id || null, offerDate,
          `Detected in ${mailboxEmail}'s inbox: "${msg.subject || ""}" — figures need confirming from the email/heads of terms.`,
          convKey,
        ]
      );
      if (res.rows.length) created++;
    } catch (e: any) {
      console.error("[offer-check] upsert failed:", e?.message);
    }
  }

  if (created > 0) console.log(`[offer-check] ${mailboxEmail}: ${created} unconfirmed offer(s) from inbox`);
  return created;
}

// ─── Email → interest check ──────────────────────────────────────────────
// The third signal: a brand/agent expressing interest that isn't yet a
// viewing or an offer ("we'd be interested in", "keen on the unit at…",
// "could you send particulars"). Same anchors as offers — known external
// contact + tracker unit — and offer-language mails are left to the offer
// check so one email never lands in both buckets. One row per thread, and
// nothing new when that company already has interest/viewing/offer activity
// on the unit in the last 90 days.

export function looksLikeInterest(subject: string | null | undefined, bodyPreview?: string | null): boolean {
  const text = `${subject || ""} ${bodyPreview || ""}`;
  return /\b(interested in|interest in|expression of interest|register(ing)? (our |their )?interest|keen on|keen to (view|see|take)|would (love|like) to (view|see)|arrange a viewing|book a viewing|send (over |through )?(the )?(particulars|details|floor ?plans?)|more (details|information) on the (unit|space|site))\b/i.test(text);
}

export async function syncInterestEmails(messages: InboxMessage[], mailboxEmail: string): Promise<number> {
  const candidates = messages.filter(m =>
    looksLikeInterest(m.subject, m.bodyPreview) && !looksLikeOffer(m.subject, m.bodyPreview)
  );
  if (candidates.length === 0) return 0;

  const units = await loadTrackerUnits();
  if (units.length === 0) return 0;
  let created = 0;

  for (const msg of candidates) {
    try {
      const hay = norm(`${msg.subject || ""} ${msg.bodyPreview || ""}`);
      const external = [
        msg.from?.emailAddress,
        ...(msg.toRecipients || []).map(r => r?.emailAddress),
        ...(msg.ccRecipients || []).map(r => r?.emailAddress),
      ].filter((a): a is { name?: string; address?: string } =>
        !!a?.address && !a.address.toLowerCase().endsWith(BGP_DOMAIN)
      );
      if (external.length === 0) continue;
      const emails = [...new Set(external.map(a => a.address!.toLowerCase()))];
      const brand = await loadViewingPeople(emails);
      if (!brand.brandId || brand.reasons.length) continue;
      const contact = { id: brand.contactId || brand.agentContactId, name: brand.contactName,
        company_id: brand.brandId, company_name: brand.brandName };

      const unit = await resolveUnit(hay, units, contact.company_id);
      if (!unit) continue;

      // Already engaged? Any interest/viewing/offer for this company on this
      // unit in the last 90 days means the tracker already knows — skip.
      if (contact.company_id) {
        const existing = await pool.query(
          `SELECT 1 FROM (
             SELECT unit_id, company_id, created_at FROM unit_interest
             UNION ALL SELECT unit_id, company_id, created_at FROM unit_viewings
             UNION ALL SELECT unit_id, company_id, created_at FROM unit_offers
           ) a WHERE a.unit_id = $1 AND a.company_id = $2
             AND a.created_at >= NOW() - INTERVAL '90 days' LIMIT 1`,
          [unit.id, contact.company_id]
        );
        if (existing.rows.length) continue;
      }

      const received = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
      const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
      const parts = Object.fromEntries(fmt.formatToParts(received).map(p => [p.type, p.value]));
      const interestDate = `${parts.year}-${parts.month}-${parts.day}`;
      const convKey = msg.conversationId ? `conv_${msg.conversationId}` : `msg_${msg.id}`;

      const res = await pool.query(
        `INSERT INTO unit_interest
           (unit_id, company_name, contact_name, contact_id, company_id,
            interest_date, notes, source, email_conversation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'email', $8)
         ON CONFLICT (email_conversation_id) WHERE email_conversation_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          unit.id, contact.company_name || null, contact.name || null,
          contact.id, contact.company_id || null, interestDate,
          `Detected in ${mailboxEmail}'s inbox: "${msg.subject || ""}"`,
          convKey,
        ]
      );
      if (res.rows.length) created++;
    } catch (e: any) {
      console.error("[interest-check] upsert failed:", e?.message);
    }
  }

  if (created > 0) console.log(`[interest-check] ${mailboxEmail}: ${created} interest signal(s) from inbox`);
  return created;
}

// ─── Backfill from stored interactions ───────────────────────────────────
// The hourly sweep only sees NEW mail, so history from before this module
// (or before a matcher improvement) never gets a second look. This replays
// crm_interactions — which already stores subject/preview + resolved
// contact/company for every synced email — through the same offer/interest
// matchers. Dedupe: interactions carry no Graph conversationId, so the key
// is int_<interaction id>; the 60/90-day already-logged guards do the rest.
export async function backfillActivityFromInteractions(days = 90): Promise<{ offers: number; interest: number }> {
  // Pre-filter candidates in SQL — the offer/interest language regexes cut
  // tens of thousands of emails down to the few thousand worth scoring, so
  // the row-by-row matcher isn't dominated by round-trips on no-hopers.
  const r = await pool.query(
    `SELECT id, subject, preview, contact_id, company_id, participants, interaction_date
       FROM crm_interactions
      WHERE type = 'email' AND interaction_date >= NOW() - ($1 || ' days')::interval
        AND (company_id IS NOT NULL OR contact_id IS NOT NULL)
        AND (subject ~* '\\yoffers?\\y'
          OR preview ~* '\\y(our offer|offer of|revised offer|improved offer|offer for|make an offer|submit(ted)? an offer|offer submitted|best and final|heads of terms)\\y'
          OR (subject || ' ' || COALESCE(preview,'')) ~* '\\y(interested in|interest in|expression of interest|register(ing)? (our |their )?interest|keen on|keen to (view|see|take)|would (love|like) to (view|see)|arrange a viewing|book a viewing|send (over |through )?(the )?(particulars|details|floor ?plans?)|more (details|information) on the (unit|space|site))\\y')
      ORDER BY interaction_date`,
    [String(days)]
  );
  const units = await loadTrackerUnits();
  if (units.length === 0) return { offers: 0, interest: 0 };
  let offers = 0, interest = 0;

  for (const row of r.rows) {
    try {
      const isOffer = looksLikeOffer(row.subject, row.preview);
      const isInterest = !isOffer && looksLikeInterest(row.subject, row.preview);
      if (!isOffer && !isInterest) continue;
      if (!row.company_id && !row.contact_id) continue;

      const contactRes = row.contact_id
        ? await pool.query(`SELECT email FROM crm_contacts WHERE id = $1`, [row.contact_id])
        : { rows: [] as any[] };
      const emails = (row.participants?.length ? row.participants : [contactRes.rows[0]?.email])
        .filter((email: unknown): email is string => typeof email === "string" && !!email && !email.toLowerCase().endsWith(BGP_DOMAIN));
      const brand = await loadViewingPeople(emails);
      if (!brand.brandId || brand.reasons.length) continue;
      const hay = norm(`${row.subject || ""} ${row.preview || ""}`);
      const unit = await resolveUnit(hay, units, brand.brandId);
      if (!unit) continue;
      const contactName = brand.contactName;
      const companyName = brand.brandName;
      const companyId = brand.brandId;
      const contactId = brand.contactId || brand.agentContactId;
      const d = new Date(row.interaction_date);
      const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
      const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
      const dateStr = `${parts.year}-${parts.month}-${parts.day}`;

      if (isOffer) {
        if (companyId) {
          const existing = await pool.query(
            `SELECT 1 FROM unit_offers WHERE unit_id = $1 AND company_id = $2
               AND offer_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND offer_date::date >= ($3::date - 60) LIMIT 1`,
            [unit.id, companyId, dateStr]
          );
          if (existing.rows.length) continue;
        }
        const res = await pool.query(
          `INSERT INTO unit_offers (unit_id, company_name, contact_name, contact_id, company_id,
             offer_date, status, comments, source, email_conversation_id)
           VALUES ($1,$2,$3,$4,$5,$6,'Pending',$7,'email',$8)
           ON CONFLICT (email_conversation_id) WHERE email_conversation_id IS NOT NULL DO NOTHING RETURNING id`,
          [unit.id, companyName, contactName, contactId, companyId, dateStr,
           `Backfilled from synced email: "${row.subject || ""}" — figures need confirming.`, `int_${row.id}`]
        );
        if (res.rows.length) offers++;
      } else {
        if (companyId) {
          const existing = await pool.query(
            `SELECT 1 FROM (
               SELECT unit_id, company_id, created_at FROM unit_interest
               UNION ALL SELECT unit_id, company_id, created_at FROM unit_viewings
               UNION ALL SELECT unit_id, company_id, created_at FROM unit_offers
             ) a WHERE a.unit_id = $1 AND a.company_id = $2 LIMIT 1`,
            [unit.id, companyId]
          );
          if (existing.rows.length) continue;
        }
        const res = await pool.query(
          `INSERT INTO unit_interest (unit_id, company_name, contact_name, contact_id, company_id,
             interest_date, notes, source, email_conversation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'email',$8)
           ON CONFLICT (email_conversation_id) WHERE email_conversation_id IS NOT NULL DO NOTHING RETURNING id`,
          [unit.id, companyName, contactName, contactId, companyId, dateStr,
           `Backfilled from synced email: "${row.subject || ""}"`, `int_${row.id}`]
        );
        if (res.rows.length) interest++;
      }
    } catch (e: any) {
      console.error("[activity-backfill] row failed:", e?.message);
    }
  }
  console.log(`[activity-backfill] ${offers} offer(s), ${interest} interest row(s) from ${r.rows.length} interactions`);
  return { offers, interest };
}
