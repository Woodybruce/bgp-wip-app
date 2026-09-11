// Deterministic check for the O365 → Letting Tracker auto-collection
// (viewings from diary events, offers from inbox email). Runs inside the
// smoke suite via `npx tsx qa/tracker-sync-check.ts` with DATABASE_URL set.
// Seeds its own QA-SMOKE rows and removes them afterwards; exits non-zero
// on any failed assertion.
import { syncDiaryViewings, syncOfferEmails } from "../server/viewing-sync";
import { pool } from "../server/db";

const BLUEWATER = "cccccccc-0000-0000-0000-000000000001";
const STARBUCKS = "11110000-0000-0000-0000-000000000201";
const KNOWN_CONTACT_EMAIL = "tom@starbucks.example"; // fixture contact at Starbucks

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function cleanup() {
  await pool.query(`DELETE FROM unit_viewings WHERE calendar_event_id LIKE 'qa-smoke-%'`);
  await pool.query(`DELETE FROM unit_offers WHERE email_conversation_id LIKE 'conv_qa-smoke-%' OR email_conversation_id LIKE 'msg_qa-smoke-%'`);
  await pool.query(`DELETE FROM available_units WHERE unit_name LIKE 'QA-SMOKE%'`);
  await pool.query(`DELETE FROM crm_deals WHERE name LIKE 'QA-SMOKE%'`);
}

const event = (id: string, subject: string, location = "", organizer = KNOWN_CONTACT_EMAIL) => ({
  id, iCalUId: `qa-smoke-${id}`,
  subject, bodyPreview: "",
  location: { displayName: location },
  categories: [], isCancelled: false,
  start: { dateTime: "2026-08-06T10:00:00", timeZone: "UTC" },
  organizer: { emailAddress: { name: "Tom Barista", address: organizer } },
  attendees: [{ emailAddress: { name: "Victoria", address: "victoria@brucegillinghampollard.com" } }],
});

const email = (id: string, subject: string, body = "") => ({
  id: `qa-smoke-${id}`, conversationId: `qa-smoke-${id}`,
  subject, bodyPreview: body,
  receivedDateTime: "2026-08-06T09:00:00Z",
  from: { emailAddress: { name: "Tom Barista", address: KNOWN_CONTACT_EMAIL } },
  toRecipients: [{ emailAddress: { address: "victoria@brucegillinghampollard.com" } }],
  ccRecipients: [],
});

try {
  await cleanup();

  // Seed a deal-linked tracker unit so the company tiebreak has a target:
  // Starbucks has ONE deal-linked unit at Bluewater → property-only events
  // with a Starbucks attendee anchor there.
  const deal = await pool.query(
    `INSERT INTO crm_deals (name, deal_type, status, property_id, tenant_id)
     VALUES ('QA-SMOKE tiebreak letting', 'New Letting', 'AVA', $1, $2) RETURNING id`,
    [BLUEWATER, STARBUCKS]
  );
  const unit = await pool.query(
    `INSERT INTO available_units (unit_name, property_id, deal_id, marketing_status)
     VALUES ('QA-SMOKE-U77, Bluewater, Bluewater', $1, $2, 'AVA') RETURNING id`,
    [BLUEWATER, deal.rows[0].id]
  );
  const qaUnitId = unit.rows[0].id;

  // 1. Named unit: the first comma segment of a stored unit name matches.
  const n1 = await syncDiaryViewings([event("v1", "Viewing QA-SMOKE-U77 at Bluewater") as any], "qa@bgp");
  check("viewing lands when the unit is named", n1 === 1, `upserted ${n1}`);

  // 2. Dedupe: the same iCalUId again updates in place, no second row.
  const n2 = await syncDiaryViewings([event("v1", "Viewing QA-SMOKE-U77 at Bluewater") as any], "qa@bgp");
  const rows = await pool.query(`SELECT count(*)::int AS n FROM unit_viewings WHERE calendar_event_id = 'qa-smoke-v1'`);
  check("re-sync dedupes on iCalUId", n2 === 0 && rows.rows[0].n === 1, `${rows.rows[0].n} row(s)`);

  // 3. Company tiebreak: property named, unit NOT named, known attendee —
  //    anchors to the attendee company's deal-linked unit.
  const n3 = await syncDiaryViewings([event("v2", "Viewing at Bluewater with Starbucks") as any], "qa@bgp");
  const v2 = await pool.query(`SELECT unit_id FROM unit_viewings WHERE calendar_event_id = 'qa-smoke-v2'`);
  check("company tiebreak anchors property-only viewings", n3 === 1 && v2.rows[0]?.unit_id === qaUnitId);

  // 4. Site tours classify as viewings.
  const n4 = await syncDiaryViewings([event("v3", "Site tour - QA-SMOKE-U77 Bluewater") as any], "qa@bgp");
  check("site tour classifies as a viewing", n4 === 1);

  // 5. Unknown-word events never match.
  const n5 = await syncDiaryViewings([event("v4", "Padel with the team") as any], "qa@bgp");
  check("non-viewing events are ignored", n5 === 0);

  // 6. Offer email from a known contact, unit named → pending offer row.
  const o1 = await syncOfferEmails([email("o1", "Offer for QA-SMOKE-U77 Bluewater", "our offer of £120,000 pa") as any], "qa@bgp");
  check("offer email creates a pending offer", o1 === 1);

  // 7. Offer dedupe on the email thread.
  const o2 = await syncOfferEmails([email("o1", "RE: Offer for QA-SMOKE-U77 Bluewater") as any], "qa@bgp");
  check("offer re-sync dedupes on conversation id", o2 === 0);
} catch (e: any) {
  console.error("  FAIL tracker-sync-check crashed:", e?.message);
  failures++;
} finally {
  await cleanup();
  await pool.end();
}

console.log(`tracker-sync-check: ${failures === 0 ? "all green" : failures + " failure(s)"}`);
process.exit(failures === 0 ? 0 : 1);
