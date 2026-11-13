import test from "node:test";
import assert from "node:assert/strict";
import type { GraphGet, QueuedRead } from "./email-contact-details";
import type { ContactReaderDeps } from "./email-contact-reader";

// The module reaches ./db through an import; nothing here connects to it.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
const {
  decideDetailFill, provenanceLine, applyDetailsToContact, findStoredEmail, emailsToReRead, peopleOnMessage,
  queueDetailRead, readQueuedMessages, runContactDetailsBacklog, contactDetailsProgress, newContactDetailsRun,
} = await import("./email-contact-details");

const noModel: ContactReaderDeps = { hasKey: () => false, claim: async () => false, call: async () => { throw new Error("no model in tests"); }, log: () => {} };
const blankish = (v: unknown) => !String(v ?? "").trim();

// A small stand-in for Postgres: the handful of statements the module runs.
function fakeDb(init: { contacts: any[]; filed?: any[] }) {
  const contacts = init.contacts.map(c => ({ role: null, phone: null, phone_mobile: null, company_id: null, company_name: null, notes: null, enrichment_source: "email-sync", ...c }));
  const filed = init.filed || [];
  const settings = new Map<string, any>();
  const waiting = (c: any) => c.enrichment_source === "email-sync" && c.email && (blankish(c.role) || (blankish(c.phone) && blankish(c.phone_mobile)));
  const after = (c: any, at: string | null, id: string) => !at || c.created_at > at || (c.created_at === at && c.id > id);
  const q = {
    updates: 0,
    async query(sql: string, params: any[] = []) {
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("FROM system_settings")) return { rows: settings.has(params[0]) ? [{ value: settings.get(params[0]) }] : [] };
      if (s.includes("INSERT INTO system_settings")) { settings.set(params[0], JSON.parse(params[1])); return { rows: [], rowCount: 1 }; }
      if (s.includes("count(*)::int AS n FROM crm_contacts")) return { rows: [{ n: contacts.filter(c => waiting(c) && after(c, params[0], params[1])).length }] };
      if (s.startsWith("SELECT id, name, lower(btrim(email)) AS email")) {
        const rows = contacts.filter(c => waiting(c) && after(c, params[0], params[1]))
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(0, params[2])
          .map(c => ({ id: c.id, name: c.name, email: c.email.toLowerCase(), at: c.created_at }));
        return { rows };
      }
      if (s.includes("FROM crm_interactions")) return { rows: filed.filter(f => f.contact_id === params[0]) };
      if (s.startsWith("SELECT id, role, phone, phone_mobile, company_id, company_name FROM crm_contacts")) {
        return { rows: contacts.filter(c => c.email.toLowerCase() === params[0]) };
      }
      if (s.includes("bool_or(")) {
        return { rows: contacts.filter(c => blankish(c.role) || (blankish(c.phone) && blankish(c.phone_mobile)))
          .map(c => ({ email: c.email.toLowerCase(), title: blankish(c.role), phone: blankish(c.phone) && blankish(c.phone_mobile) })) };
      }
      if (s.startsWith("UPDATE crm_contacts")) {
        const c = contacts.find(x => x.id === params[0]);
        const sets = [...s.matchAll(/(role|phone_mobile|phone) = \$(\d+)/g)].map(m => [m[1], params[Number(m[2]) - 1]] as const);
        if (!c || sets.some(([k]) => !blankish(c[k]))) return { rows: [], rowCount: 0 };
        for (const [k, v] of sets) c[k] = v;
        c.notes = blankish(c.notes) ? params[1] : `${c.notes}\n${params[1]}`;
        q.updates++;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`fakeDb: unexpected statement: ${s.slice(0, 90)}`);
    },
  };
  return { q, contacts, settings };
}

const addr = (address: string, name = "") => ({ emailAddress: { address, name } });
const CHARLOTTE = "charlotte@brucegillinghampollard.com";
const staffNames = new Map([[CHARLOTTE, "Charlotte Roberts"]]);
const quotedThread = (from: string, extra = "") => ({
  id: "graph-1", subject: "City Tower - Retail Units", receivedDateTime: "2026-10-06T21:51:00Z",
  from: addr(from, "Priya Shah"),
  toRecipients: [addr(CHARLOTTE, "Charlotte Roberts")],
  ccRecipients: [addr("Toby.Whitehead@bakehouse.co.uk", "Toby Whitehead"), addr("steven.jones@bakehouse.co.uk", "Steven Jones")],
  body: { contentType: "text", content: [
    "Charlotte, bringing in the Bakehouse team by CC.", "", "Priya", "",
    "From: Toby Whitehead <toby.whitehead@bakehouse.co.uk>",
    "Sent: 05 October 2026 16:02",
    "To: Priya Shah <priya.shah@kanepartners.co.uk>",
    "Subject: City Tower - Retail Units",
    "", "Priya, addresses below.", "", "Regards", "Toby Whitehead", "Property Manager", "Bakehouse Ltd", "Direct: 0191 496 0101", "Mobile: 07700 900456", extra,
  ].join("\n") },
});

test("only blank fields are filled; an existing value is never overwritten", () => {
  const found = { title: "Property Manager", phone: "0191 496 0101", mobile: "07700 900456" };
  assert.deepEqual(decideDetailFill({ id: "1", role: null, phone: "", phone_mobile: null }, found),
    { role: "Property Manager", phone: "0191 496 0101", phone_mobile: "07700 900456" });
  assert.deepEqual(decideDetailFill({ id: "1", role: "Head of Property", phone: "0191 000 0000", phone_mobile: null }, found),
    { phone_mobile: "07700 900456" });
  assert.deepEqual(decideDetailFill({ id: "1", role: "Head of Property", phone: "0191 000 0000", phone_mobile: "07000 000000" }, found), {});
  // The same number is not written into the second phone field.
  assert.deepEqual(decideDetailFill({ id: "1", role: "x", phone: "+44 7700 900456", phone_mobile: null }, found), {});
});

test("the note says which fields were read, from which email, and where in it", () => {
  const line = provenanceLine({ role: "Property Manager", phone_mobile: "07700 900456" },
    { subject: "City Tower - Retail Units", date: "2026-10-06T21:51:00Z", mailboxName: "Charlotte Roberts", where: "quoted" });
  assert.equal(line, 'Job title and mobile read from their signature in an earlier message quoted in the email "City Tower - Retail Units" (6 Oct 2026, Charlotte Roberts\'s mailbox).');
  assert.match(provenanceLine({ phone: "1" }, { subject: null, date: null, mailboxName: null, where: "message" }, "Bakehouse Ltd"),
    /^Phone read from their signature in the email\. The signature names Bakehouse Ltd\.$/);
});

test("saving re-checks the field is still blank and keeps the first line of the notes", async () => {
  const { q, contacts } = fakeDb({ contacts: [
    { id: "c1", name: "Toby Whitehead", email: "toby.whitehead@bakehouse.co.uk", company_id: "co1", notes: "Auto-added from email — Charlotte Roberts, 2026-10-06", created_at: "2026-10-06T22:25:07.419000" },
    { id: "c2", name: "T Whitehead", email: "Toby.Whitehead@bakehouse.co.uk", company_id: "co1", role: "Estates Lead", phone: "0191 111 1111", created_at: "2026-10-07T00:00:00.000000" },
  ] });
  const fields = await applyDetailsToContact(q as any,
    { email: "toby.whitehead@bakehouse.co.uk", title: "Property Manager", phone: "0191 496 0101", mobile: "07700 900456", company: "Bakehouse Ltd", where: "quoted", how: "rules" },
    { subject: "City Tower", date: "2026-10-06T21:51:00Z", mailboxName: "Charlotte Roberts", where: "quoted" });
  assert.deepEqual(fields.sort(), ["phone", "phone_mobile", "role"]);
  assert.equal(contacts[0].role, "Property Manager");
  assert.equal(contacts[0].notes.split("\n")[0], "Auto-added from email — Charlotte Roberts, 2026-10-06");
  assert.match(contacts[0].notes.split("\n")[1], /^Job title, phone and mobile read from their signature in an earlier message quoted/);
  assert.ok(!/signature names/.test(contacts[0].notes), "a person with a company on record gets no employer line");
  assert.equal(contacts[1].role, "Estates Lead", "a typed job title stays");
  assert.equal(contacts[1].phone, "0191 111 1111", "a typed phone stays");
  assert.equal(contacts[1].phone_mobile, "07700 900456");
  assert.equal(contacts[0].company_id, "co1", "the company is never touched");
});

test("a stored email is found by id, then by its time and subject, and says when it is gone", async () => {
  const calls: string[] = [];
  const gone = new Error('Graph API 404: {"error":{"code":"ErrorItemNotFound"}}');
  const byTime: GraphGet = async (path) => {
    calls.push(path);
    if (path.includes("/messages/")) throw gone;
    return { value: [{ id: "other", subject: "Lunch" }, { id: "new-id", subject: "RE: City Tower" }] };
  };
  const ref = { mailbox: CHARLOTTE, ids: ["old-1", "old-2"], subject: "City Tower", date: "2026-10-06T21:51:00Z" };
  const hit = await findStoredEmail(byTime, ref);
  assert.equal(hit.message?.id, "new-id");
  assert.equal(calls.length, 3);
  assert.ok(calls[2].includes("receivedDateTime ge 2026-10-06T21:50:58.000Z and receivedDateTime le 2026-10-06T21:51:02.000Z"));

  assert.deepEqual(await findStoredEmail(async (path) => { if (path.includes("/messages/")) throw gone; return { value: [] }; }, ref), { message: null, reason: "gone" });
  assert.deepEqual(await findStoredEmail(async () => { throw new Error("Graph API 503: busy"); }, ref), { message: null, reason: "unavailable" });
  assert.equal((await findStoredEmail(async () => ({ id: "old-1", subject: "City Tower" }), ref)).message.id, "old-1");
  // A search Microsoft refuses (400) says nothing about the email: never "gone",
  // and the permanent id is still tried after it.
  const refuse = () => { throw new Error('Graph API error 400: {"error":{"code":"BadRequest"}}'); };
  assert.deepEqual(await findStoredEmail(async (path) => { if (path.includes("/messages/")) throw gone; return refuse(); }, ref), { message: null, reason: "unavailable" });
  const afterRefusal = await findStoredEmail(async (path, headers) => {
    if (!path.includes("/messages/")) return refuse();
    if (headers?.Prefer !== 'IdType="ImmutableId"') throw gone;
    return { id: "old-2", subject: "City Tower" };
  }, ref);
  assert.equal(afterRefusal.message?.id, "old-2");
  // An id that only answers as a permanent id is tried last.
  const asPermanent = await findStoredEmail(async (path, headers) => {
    if (!path.includes("/messages/")) return { value: [] };
    if (headers?.Prefer !== 'IdType="ImmutableId"') throw gone;
    return { id: "old-1", subject: "City Tower" };
  }, ref);
  assert.equal(asPermanent.message?.id, "old-1");
});

test("one email per thread is re-read: the person's own message first, then the newest, three at most", () => {
  const p = (first: string) => JSON.stringify([first, CHARLOTTE, "toby.whitehead@bakehouse.co.uk"]);
  const rows = [
    { microsoft_id: "email_a1", bgp_user: CHARLOTTE, subject: "City Tower", interaction_date: "2026-10-06T21:51:00Z", participants: p("priya@kane.co.uk") },
    { microsoft_id: "email_a1moved", bgp_user: CHARLOTTE, subject: "City Tower", interaction_date: "2026-10-06T21:51:00Z", participants: p("priya@kane.co.uk") },
    { microsoft_id: "email_a2", bgp_user: CHARLOTTE, subject: "RE: City Tower", interaction_date: "2026-10-07T09:28:00Z", participants: p("omar@gpe.co.uk") },
    { microsoft_id: "email_b1", bgp_user: CHARLOTTE, subject: "Unit 4 terms", interaction_date: "2026-09-01T09:00:00Z", participants: p("toby.whitehead@bakehouse.co.uk") },
    { microsoft_id: "email_b2", bgp_user: CHARLOTTE, subject: "RE: Unit 4 terms", interaction_date: "2026-09-02T09:00:00Z", participants: p(CHARLOTTE) },
    { microsoft_id: "email_c1", bgp_user: CHARLOTTE, subject: "Lunch", interaction_date: "2026-08-01T09:00:00Z", participants: p("x@y.com") },
    { microsoft_id: "email_d1", bgp_user: CHARLOTTE, subject: "Older", interaction_date: "2026-07-01T09:00:00Z", participants: p("x@y.com") },
    { microsoft_id: "cal_e1", bgp_user: CHARLOTTE, subject: "Meeting", interaction_date: "2026-11-01T09:00:00Z", participants: p("x@y.com") },
    { microsoft_id: "email_p1", bgp_user: "equity@brucegillinghampollard.com", subject: "Private", interaction_date: "2026-11-02T09:00:00Z", participants: p("x@y.com") },
  ];
  const refs = emailsToReRead(rows as any, "Toby.Whitehead@bakehouse.co.uk");
  assert.deepEqual(refs.map(r => r.ids), [["b1"], ["a2"], ["c1"]]);
  const moved = emailsToReRead(rows.filter(r => r.microsoft_id !== "email_a2") as any, "toby.whitehead@bakehouse.co.uk");
  assert.deepEqual(moved[1].ids, ["a1", "a1moved"], "both ids on file for one email are tried");
});

test("the sync reads a new email once for the people who still need details, and fills from the quoted part", async () => {
  const { q, contacts } = fakeDb({ contacts: [
    { id: "c1", name: "Toby Whitehead", email: "toby.whitehead@bakehouse.co.uk", notes: "Auto-added from email — Charlotte Roberts, 2026-10-06", created_at: "2026-10-06T22:25:07.419000" },
    { id: "c2", name: "Steven Jones", email: "steven.jones@bakehouse.co.uk", notes: "Auto-added from email — Charlotte Roberts, 2026-10-06", created_at: "2026-10-06T22:25:07.443000" },
    { id: "c3", name: "Priya Shah", email: "priya.shah@kanepartners.co.uk", role: "Senior Surveyor", phone: "020 7946 0143", created_at: "2026-01-01T00:00:00.000000" },
  ] });
  const run = await newContactDetailsRun(q as any, staffNames, 10);
  run.readerDeps = noModel;
  assert.deepEqual([...run.needs.keys()].sort(), ["steven.jones@bakehouse.co.uk", "toby.whitehead@bakehouse.co.uk"]);
  const msg = quotedThread("priya.shah@kanepartners.co.uk");
  const queue = new Map<string, QueuedRead>();
  for (const e of ["toby.whitehead@bakehouse.co.uk", "steven.jones@bakehouse.co.uk", "priya.shah@kanepartners.co.uk", "info@bakehouse.co.uk"]) queueDetailRead(run, queue, msg, e);
  assert.deepEqual([...queue.get("graph-1")!.wanted].sort(), ["steven.jones@bakehouse.co.uk", "toby.whitehead@bakehouse.co.uk"], "a person with everything, and a shared mailbox, are not read for");
  const paths: Array<[string, any]> = [];
  await readQueuedMessages(run, async (path, headers) => { paths.push([path, headers]); return msg; }, CHARLOTTE, queue);
  assert.equal(paths.length, 1);
  assert.ok(paths[0][0].includes("$select=id,subject,receivedDateTime,from,toRecipients,ccRecipients,body"));
  assert.deepEqual(paths[0][1], { Prefer: 'IdType="ImmutableId"' });
  assert.equal(contacts[0].role, "Property Manager");
  assert.equal(contacts[0].phone, "0191 496 0101");
  assert.equal(contacts[0].phone_mobile, "07700 900456");
  assert.match(contacts[0].notes, /Charlotte Roberts's mailbox/);
  assert.equal(contacts[1].role, null, "Steven Jones was only copied: nothing is filled");
  assert.equal(contacts[1].phone_mobile, null);
  assert.equal(contacts[1].notes, "Auto-added from email — Charlotte Roberts, 2026-10-06");
  assert.equal(run.needs.has("toby.whitehead@bakehouse.co.uk"), false);
  assert.equal(run.stats.contactsFilled, 1);
});

test("the run stops fetching at its limit and reads at most three emails for one person", async () => {
  const { q } = fakeDb({ contacts: [{ id: "c2", name: "Steven Jones", email: "steven.jones@bakehouse.co.uk", created_at: "2026-10-06T22:25:07.443000" }] });
  const run = await newContactDetailsRun(q as any, staffNames, 10);
  run.readerDeps = noModel;
  const queue = new Map<string, QueuedRead>();
  for (let i = 0; i < 6; i++) queueDetailRead(run, queue, { ...quotedThread("priya.shah@kanepartners.co.uk"), id: `m${i}` }, "steven.jones@bakehouse.co.uk");
  let fetched = 0;
  await readQueuedMessages(run, async () => { fetched++; return quotedThread("priya.shah@kanepartners.co.uk"); }, CHARLOTTE, queue);
  assert.equal(fetched, 3);
  const off = await newContactDetailsRun(q as any, staffNames, 0);
  const none = new Map<string, QueuedRead>();
  queueDetailRead(off, none, quotedThread("a@b.co.uk"), "steven.jones@bakehouse.co.uk", true);
  assert.equal(none.size, 0, "0 switches the reading off");
});

test("the backlog takes a few people an hour, oldest first, each once, and keeps its place", async () => {
  const filedFor = (id: string) => ({ contact_id: id, microsoft_id: `email_${id}`, bgp_user: CHARLOTTE, subject: "City Tower - Retail Units", interaction_date: "2026-10-06T21:51:00Z",
    participants: ["priya.shah@kanepartners.co.uk", CHARLOTTE, "toby.whitehead@bakehouse.co.uk", "steven.jones@bakehouse.co.uk"] });
  const { q, contacts, settings } = fakeDb({
    contacts: [
      { id: "c1", name: "Toby Whitehead", email: "toby.whitehead@bakehouse.co.uk", notes: "Auto-added from email — Charlotte Roberts, 2026-10-06", created_at: "2026-10-06T22:25:07.419000" },
      { id: "c2", name: "Steven Jones", email: "steven.jones@bakehouse.co.uk", notes: "Auto-added from email — Charlotte Roberts, 2026-10-06", created_at: "2026-10-06T22:25:07.443000" },
      { id: "c3", name: "Typed By Hand", email: "typed@bakehouse.co.uk", enrichment_source: null, created_at: "2026-01-01T00:00:00.000000" },
      { id: "c4", name: "Later Person", email: "later.person@bakehouse.co.uk", created_at: "2026-10-08T00:00:00.000000" },
    ],
    filed: [filedFor("c1"), filedFor("c2"), filedFor("c4")],
  });
  let fetched = 0;
  const get: GraphGet = async () => { fetched++; return quotedThread("priya.shah@kanepartners.co.uk"); };
  const first = await runContactDetailsBacklog({ q: q as any, get, staffNames, limit: 2, readerDeps: noModel });
  assert.deepEqual(first, { tried: 2, filled: 1, waiting: 1, stopped: undefined });
  assert.equal(contacts[0].role, "Property Manager");
  assert.equal(contacts[1].role, null, "copied only: tried, nothing filled, not tried again");
  assert.equal(fetched, 2);

  const second = await runContactDetailsBacklog({ q: q as any, get, staffNames, limit: 2, readerDeps: noModel });
  assert.deepEqual([second.tried, second.filled, second.waiting], [1, 0, 0]);
  const third = await runContactDetailsBacklog({ q: q as any, get, staffNames, limit: 2, readerDeps: noModel, newMail: { read: 4, filled: 3 } });
  assert.deepEqual([third.tried, third.waiting], [0, 0], "nobody is read twice");
  assert.equal(fetched, 3);
  assert.equal(contacts[2].role, null, "a contact a person typed is not part of the backlog");

  const progress = await contactDetailsProgress(q as any);
  assert.deepEqual({ ...progress, lastRunAt: null }, { waiting: 0, backlogTried: 3, backlogFilled: 1, newMailRead: 4, newMailFilled: 3, lastRunAt: null });
  assert.ok(settings.get("contact_details_from_email").cursor.id === "c4");
});

test("when Microsoft cannot be reached the backlog waits instead of using up a person's one try", async () => {
  const { q, settings } = fakeDb({
    contacts: [{ id: "c1", name: "Toby Whitehead", email: "toby.whitehead@bakehouse.co.uk", created_at: "2026-10-06T22:25:07.419000" }],
    filed: [{ contact_id: "c1", microsoft_id: "email_x", bgp_user: CHARLOTTE, subject: "City Tower", interaction_date: "2026-10-06T21:51:00Z", participants: [] }],
  });
  const down: GraphGet = async () => { throw new Error("Graph API 503: busy"); };
  for (const expected of [0, 0, 1]) {
    const r = await runContactDetailsBacklog({ q: q as any, get: down, staffNames, limit: 5, readerDeps: noModel });
    assert.equal(r.tried, expected);
  }
  assert.equal(settings.get("contact_details_from_email").cursor.id, "c1", "after three failed hours it moves on");
});

test("the people on a message are read from its headers once each", () => {
  const { from, people } = peopleOnMessage(quotedThread("Priya.Shah@kanepartners.co.uk"));
  assert.equal(from?.email, "priya.shah@kanepartners.co.uk");
  assert.deepEqual(people.map(p => p.email), ["priya.shah@kanepartners.co.uk", CHARLOTTE, "toby.whitehead@bakehouse.co.uk", "steven.jones@bakehouse.co.uk"]);
});

test("guards: Anthropic only, nothing of the email is stored, the catch-up leaves reading to the backlog", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const reader = read("./email-contact-reader.ts"), details = read("./email-contact-details.ts"), sync = read("./interactions.ts");
  assert.ok(!/openai|gemini|callClaude|ai-provider/i.test(reader.replace(/\/\/.*$/gm, "")), "the reader calls Anthropic directly");
  assert.match(reader, /CONTACT_DETAILS_READER_DAILY_CAP/);
  assert.match(reader, /feature: "contact-details"/);
  // The only writes are the contact's blank fields plus the note, and the progress row.
  const writes = details.match(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+[a-z]+_\w+/g) || [];
  assert.deepEqual([...new Set(writes)].sort(), ["INSERT INTO system_settings", "UPDATE crm_contacts"]);
  assert.ok(!/raw_signature|email_signatures|preview\s*=/.test(details), "no copy of the email's text is kept");
  assert.ok(!/company_id\s*=\s*\$|company_name\s*=\s*\$/.test(details), "an employer is never set");
  assert.match(sync, /autoContactCap: 3000,\s*readContactDetails: false/);
  assert.ok(!/setInterval|setTimeout\(/.test(details), "no timer of its own: it runs inside the hourly sync");
});

test("someone whose emails keep giving nothing is left alone, and people just added have their own allowance", async () => {
  const { q } = fakeDb({ contacts: [{ id: "c9", name: "No Signature", email: "no.signature@bakehouse.co.uk", created_at: "2026-10-06T22:25:07.443000" }] });
  const plain = { ...quotedThread("priya.shah@kanepartners.co.uk"), ccRecipients: [addr("no.signature@bakehouse.co.uk", "No Signature")] };
  let fetched = 0;
  for (let hour = 0; hour < 4; hour++) {
    const run = await newContactDetailsRun(q as any, staffNames, 10);
    run.readerDeps = noModel;
    const queue = new Map<string, QueuedRead>();
    for (let i = 0; i < 3; i++) queueDetailRead(run, queue, { ...plain, id: `h${hour}m${i}` }, "no.signature@bakehouse.co.uk");
    await readQueuedMessages(run, async () => { fetched++; return plain; }, CHARLOTTE, queue);
  }
  assert.equal(fetched, 6, "three in the first hour, three in the second (the fifth miss starts the rest), none after");

  const run = await newContactDetailsRun(q as any, staffNames, 1);
  run.readerDeps = noModel;
  const queue = new Map<string, QueuedRead>();
  queueDetailRead(run, queue, { ...plain, id: "old-1" }, "priya.shah@kanepartners.co.uk");
  run.needs.set("priya.shah@kanepartners.co.uk", { title: true, phone: true });
  queueDetailRead(run, queue, { ...plain, id: "old-1" }, "priya.shah@kanepartners.co.uk");
  queueDetailRead(run, queue, { ...plain, id: "old-2" }, "priya.shah@kanepartners.co.uk");
  queueDetailRead(run, queue, { ...plain, id: "new-1" }, "just.added@bakehouse.co.uk", true);
  const order: string[] = [];
  await readQueuedMessages(run, async (path) => { order.push(path.match(/messages\/([^?]+)/)![1]); return plain; }, CHARLOTTE, queue);
  assert.deepEqual(order, ["new-1", "old-1"], "the person just added is read first and does not use the ordinary allowance");
});

test("a refused search holds the backlog on that person instead of counting them as tried", async () => {
  const { q, settings } = fakeDb({
    contacts: [{ id: "c1", name: "Toby Whitehead", email: "toby.whitehead@bakehouse.co.uk", created_at: "2026-10-06T22:25:07.419000" }],
    filed: [{ contact_id: "c1", microsoft_id: "email_x", bgp_user: CHARLOTTE, subject: "City Tower", interaction_date: "2026-10-06T21:51:00Z", participants: [] }],
  });
  const moved: GraphGet = async (path) => {
    if (path.includes("/messages/")) throw new Error('Graph API error 404: {"error":{"code":"ErrorItemNotFound"}}');
    throw new Error('Graph API error 400: {"error":{"code":"BadRequest"}}');
  };
  const r = await runContactDetailsBacklog({ q: q as any, get: moved, staffNames, limit: 5, readerDeps: noModel });
  assert.deepEqual([r.tried, r.waiting, r.stopped], [0, 1, "Microsoft could not be reached"]);
  assert.equal(settings.get("contact_details_from_email").cursor, null);
});

test("a person just added is passed over by the backlog only once their email was fetched", async () => {
  const filedFor = (id: string, graphId: string) => ({ contact_id: id, microsoft_id: `email_${graphId}`, bgp_user: CHARLOTTE, subject: "City Tower - Retail Units", interaction_date: "2026-10-06T21:51:00Z",
    participants: ["priya.shah@kanepartners.co.uk", CHARLOTTE, "toby.whitehead@bakehouse.co.uk", "steven.jones@bakehouse.co.uk"] });
  const { q, contacts } = fakeDb({
    contacts: [
      { id: "c1", name: "Steven Jones", email: "steven.jones@bakehouse.co.uk", created_at: "2026-10-06T22:25:07.419000" },
      { id: "c2", name: "Toby Whitehead", email: "toby.whitehead@bakehouse.co.uk", created_at: "2026-10-06T22:25:07.443000" },
    ],
    filed: [filedFor("c1", "ok-1"), filedFor("c2", "bad-1")],
  });
  const msg = quotedThread("priya.shah@kanepartners.co.uk");
  const run = await newContactDetailsRun(q as any, staffNames, 10);
  run.readerDeps = noModel;
  const queue = new Map<string, QueuedRead>();
  queueDetailRead(run, queue, { ...msg, id: "ok-1" }, "steven.jones@bakehouse.co.uk", true);
  queueDetailRead(run, queue, { ...msg, id: "bad-1" }, "toby.whitehead@bakehouse.co.uk", true);
  await readQueuedMessages(run, async (path) => { if (path.includes("bad-1")) throw new Error("Graph API error 503: busy"); return msg; }, CHARLOTTE, queue);
  assert.equal(run.stats.errors, 1);
  assert.equal(contacts[1].role, null, "his email could not be fetched as he was added");

  const fetched: string[] = [];
  const r = await runContactDetailsBacklog({ q: q as any, get: async (path) => { fetched.push(path); return msg; }, staffNames, limit: 5, readerDeps: noModel });
  assert.equal(fetched.length, 1, "the one already read is passed over; the one whose read failed is fetched");
  assert.ok(fetched[0].includes("bad-1"));
  assert.equal(contacts[1].role, "Property Manager");
  assert.deepEqual([r.tried, r.filled], [1, 1]);
});
