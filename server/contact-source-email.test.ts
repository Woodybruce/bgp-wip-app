import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FiledRow } from "./contact-source-email";

// The module reaches ./db through an import; nothing here connects to it.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
const { parseAutoMarker, sourceEmailCandidates, findContactSourceEmail } = await import("./contact-source-email");

const CHARLOTTE = "charlotte@brucegillinghampollard.com";
const row = (id: string, extra: Partial<FiledRow> = {}): FiledRow => ({
  microsoft_id: `email_${id}`, bgp_user: CHARLOTTE, mailbox_name: "Charlotte Roberts", subject: "City Tower - Retail Units",
  interaction_date: "2026-10-06T21:51:00Z", created_at: "2026-10-06T22:25:07.496Z",
  participants: ["priya.shah@kanepartners.co.uk", CHARLOTTE, "toby.whitehead@bakehouse.co.uk"], ...extra,
});

test("the note the sync writes is read back", () => {
  // The same wording as autoMarker() in email-auto-contacts.ts (that file opens the database, so it is read, not imported).
  const src = readFileSync(new URL("./email-auto-contacts.ts", import.meta.url), "utf8");
  assert.ok(src.includes("return `Auto-added from email — ${staffName}, ${date.toISOString().slice(0, 10)}`;"));
  assert.deepEqual(parseAutoMarker("Auto-added from email — Charlotte Roberts, 2026-10-06"), { staffName: "Charlotte Roberts", date: "2026-10-06" });
  assert.deepEqual(parseAutoMarker("Auto-added from email — Smith, Jo, 2026-01-02\nJob title read from…"), { staffName: "Smith, Jo", date: "2026-01-02" });
  assert.equal(parseAutoMarker("Met at MAPIC.\nAuto-added from email — X, 2026-10-06"), null, "only the first line counts");
  assert.equal(parseAutoMarker(null), null);
});

test("the email filed as the contact was created, on the note's date, in that person's mailbox, comes first", () => {
  const rows = [
    row("reply", { interaction_date: "2026-10-07T09:28:00Z", created_at: "2026-10-07T10:00:00Z" }),
    row("moved-copy", { created_at: "2026-10-07T02:25:00Z" }),
    row("first"),
    row("other-mailbox", { bgp_user: "lucy@brucegillinghampollard.com", mailbox_name: "Lucy Gardiner", created_at: "2026-10-06T22:25:07.450Z" }),
    row("private", { bgp_user: "equity@brucegillinghampollard.com", mailbox_name: "Equity" }),
    { ...row("x"), microsoft_id: "cal_meeting" },
  ];
  const marker = { staffName: "Charlotte Roberts", date: "2026-10-06" };
  const order = sourceEmailCandidates(rows, marker, "2026-10-06T22:25:07.419Z").map(r => r.microsoft_id);
  assert.deepEqual(order, ["email_first", "email_moved-copy", "email_other-mailbox"]);
  // Nothing on the note's date: the first email filed.
  assert.equal(sourceEmailCandidates([rows[0]], marker, "2026-10-06T22:25:07.419Z")[0].microsoft_id, "email_reply");
});

const db = (contact: any, rows: FiledRow[]) => ({
  async query(sql: string) { return { rows: sql.includes("FROM crm_contacts") ? (contact ? [contact] : []) : rows }; },
});
const contact = { id: "c1", email: "Toby.Whitehead@bakehouse.co.uk", notes: "Auto-added from email — Charlotte Roberts, 2026-10-06", created_at: "2026-10-06T22:25:07.419Z" };

test("the answer names the message the viewer can open, trying each id on file", async () => {
  const asked: string[] = [];
  const answer = await findContactSourceEmail(db(contact, [row("old"), row("new", { created_at: "2026-10-07T02:25:00Z" })]), async (path) => {
    asked.push(path);
    if (path.includes("/messages/old")) throw new Error("Graph API 404: ErrorItemNotFound");
    return { id: "new", subject: "City Tower - Retail Units", receivedDateTime: "2026-10-06T21:51:00Z" };
  }, "c1");
  assert.deepEqual(answer, { found: true, msgId: "new", mailboxEmail: CHARLOTTE, mailboxName: "Charlotte Roberts",
    subject: "City Tower - Retail Units", date: "2026-10-06T21:51:00Z", wrote: false });
  assert.equal(asked.length, 2);
  assert.ok(asked.every(p => p.includes("$select=id,subject,receivedDateTime") && !p.includes("body")), "only the heading is fetched here");
});

test("it says plainly when the email cannot be found, and why", async () => {
  const gone = await findContactSourceEmail(db(contact, [row("old")]), async (path) => {
    if (path.includes("/messages/")) throw new Error("Graph API 404: ErrorItemNotFound");
    return { value: [] };
  }, "c1");
  assert.deepEqual(gone, { found: false, reason: "gone", mailboxName: "Charlotte Roberts", subject: "City Tower - Retail Units", date: "2026-10-06T21:51:00.000Z" });
  const down = await findContactSourceEmail(db(contact, [row("old")]), async () => { throw new Error("Microsoft credentials are not configured"); }, "c1");
  assert.equal(down && !down.found && down.reason, "unavailable");
  assert.deepEqual(await findContactSourceEmail(db(contact, []), async () => ({}), "c1"), { found: false, reason: "no_record", mailboxName: "Charlotte Roberts" });
  assert.deepEqual(await findContactSourceEmail(db({ ...contact, notes: "Met at MAPIC" }, [row("old")]), async () => ({}), "c1"), { found: false, reason: "not_from_email" });
  assert.equal(await findContactSourceEmail(db(null, []), async () => ({}), "nope"), null);
});
