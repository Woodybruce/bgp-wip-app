// ─────────────────────────────────────────────────────────────────────────
// Diary → Letting Tracker viewings sync.
//
// The hourly interactions sync (server/interactions.ts) already pulls every
// BGP mailbox's calendar. This module takes those same events and, for any
// that look like a viewing AND can be anchored to a Letting Tracker unit,
// upserts a unit_viewings row — so a viewing booked in Outlook shows up on
// the tracker automatically within the hour.
//
// Matching, in order:
//   1. Classifier — "viewing" in the subject or Outlook categories (same
//      regex the calendar page uses client-side for colour-coding).
//   2. Property — a crm_properties name (≥5 chars) in subject/location/body.
//   3. Unit — an available_units.unit_name at that property in the text;
//      if none named and the property has exactly one tracker unit, use it.
//      No unit anchor → skipped (a viewing row needs a unit).
//   4. Tenant — first non-BGP attendee matched to crm_contacts by email.
//
// Dedupe: Graph iCalUId (stable across every attendee's copy of the same
// meeting) unique-indexed on unit_viewings.calendar_event_id, so re-runs and
// multi-mailbox sweeps update in place instead of duplicating. Rows carry
// source='diary' and stay editable/deletable like manual entries.
// ─────────────────────────────────────────────────────────────────────────
import { pool } from "./db";

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

function londonDateTime(start: { dateTime: string; timeZone: string }): { date: string; time: string } {
  const d = start.timeZone === "UTC" ? new Date(start.dateTime + "Z") : new Date(start.dateTime);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

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
  if (!prop) return null;

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
    } catch { /* tiebreak is best-effort */ }
  }
  return null;
}

export async function syncDiaryViewings(events: DiaryEvent[], mailboxEmail: string): Promise<number> {
  const candidates = events.filter(e =>
    !e.isCancelled && e.start?.dateTime && looksLikeViewing(e.subject, e.categories)
  );
  if (candidates.length === 0) return 0;

  const units = await loadTrackerUnits();
  if (units.length === 0) return 0;
  let upserted = 0;

  for (const event of candidates) {
    try {
      const hay = norm(`${event.subject || ""} ${event.location?.displayName || ""} ${event.bodyPreview || ""}`);

      // External attendees → tenant contact/company. Resolved BEFORE the
      // unit so the company can break ties on multi-unit properties.
      const external = [
        event.organizer?.emailAddress,
        ...(event.attendees || []).map(a => a?.emailAddress),
      ].filter((a): a is { name?: string; address?: string } =>
        !!a?.address && !a.address.toLowerCase().endsWith(BGP_DOMAIN)
      );
      let contact: { id: string; name: string; companyId: string | null; companyName: string | null } | null = null;
      if (external.length > 0) {
        const emails = [...new Set(external.map(a => a.address!.toLowerCase()))];
        const r = await pool.query(
          `SELECT ct.id, ct.name, ct.company_id, co.name AS company_name
             FROM crm_contacts ct
             LEFT JOIN crm_companies co ON co.id = ct.company_id
            WHERE LOWER(ct.email) = ANY($1) LIMIT 1`,
          [emails]
        );
        if (r.rows.length) {
          contact = {
            id: r.rows[0].id, name: r.rows[0].name,
            companyId: r.rows[0].company_id, companyName: r.rows[0].company_name,
          };
        }
      }

      const unit = await resolveUnit(hay, units, contact?.companyId);
      if (!unit) continue;

      const { date, time } = londonDateTime(event.start!);
      const attendeeText = external
        .map(a => a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address)
        .join(", ") || null;
      const calendarEventId = event.iCalUId || `cal_${event.id}`;

      const res = await pool.query(
        `INSERT INTO unit_viewings
           (unit_id, company_name, contact_name, contact_id, company_id,
            viewing_date, viewing_time, attendees, notes, source, calendar_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'diary', $10)
         ON CONFLICT (calendar_event_id) WHERE calendar_event_id IS NOT NULL
         DO UPDATE SET viewing_date = EXCLUDED.viewing_date,
                       viewing_time = EXCLUDED.viewing_time,
                       attendees = COALESCE(EXCLUDED.attendees, unit_viewings.attendees),
                       company_name = COALESCE(unit_viewings.company_name, EXCLUDED.company_name),
                       contact_name = COALESCE(unit_viewings.contact_name, EXCLUDED.contact_name),
                       contact_id = COALESCE(unit_viewings.contact_id, EXCLUDED.contact_id),
                       company_id = COALESCE(unit_viewings.company_id, EXCLUDED.company_id)
         RETURNING (xmax = 0) AS inserted`,
        [
          unit.id, contact?.companyName || null, contact?.name || null,
          contact?.id || null, contact?.companyId || null,
          date, time, attendeeText,
          `Synced from ${mailboxEmail}'s Outlook diary: "${event.subject || ""}"`,
          calendarEventId,
        ]
      );
      if (res.rows[0]?.inserted) upserted++;
    } catch (e: any) {
      console.error("[viewing-sync] upsert failed:", e?.message);
    }
  }

  if (upserted > 0) console.log(`[viewing-sync] ${mailboxEmail}: ${upserted} viewing(s) from diary`);
  return upserted;
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
      const contactRes = await pool.query(
        `SELECT ct.id, ct.name, ct.company_id, co.name AS company_name
           FROM crm_contacts ct
           LEFT JOIN crm_companies co ON co.id = ct.company_id
          WHERE LOWER(ct.email) = ANY($1) LIMIT 1`,
        [emails]
      );
      if (!contactRes.rows.length) continue;
      const contact = contactRes.rows[0];

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
