// Emails as a source of requirement suggestions (Woody, 2026-11-15).
//   node --import tsx --test server/requirement-email-feed.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { emailWorthReading, ownWords, queueRequirementEmail, readQueuedRequirementEmails, type QueuedRequirementEmail } from "./requirement-email-feed";
import { PRIVATE_MAILBOX } from "./private-mail";

const contact = { id: "c1", name: "Priya Shah", email: "priya@brand.example", companyId: "co1" };
const msg = (over: any = {}) => ({
  id: "m1", subject: "Our requirements for 2027", bodyPreview: "We are looking for 2,000 to 3,000 sq ft in Leeds and York.",
  receivedDateTime: "2026-11-14T09:00:00Z", from: { emailAddress: { address: "priya@brand.example", name: "Priya Shah" } }, ...over,
});

test("an email is read only when the contact wrote it and it reads like a requirement", () => {
  assert.equal(emailWorthReading(msg(), contact), true);
  assert.equal(emailWorthReading(msg({ from: { emailAddress: { address: "someone@else.example" } } }), contact), false, "the contact was only copied");
  assert.equal(emailWorthReading(msg({ subject: "Lunch on Friday?", bodyPreview: "Are you free at 1?" }), contact), false);
  assert.equal(emailWorthReading(msg({ subject: "Newsletter: new sites this month", bodyPreview: "Unsubscribe here" }), contact), false);
  assert.equal(emailWorthReading(msg(), { ...contact, companyId: null }), false, "no company on the contact");
  assert.equal(emailWorthReading(msg({ from: { emailAddress: { address: "no-reply@brand.example" } } }), { ...contact, email: "no-reply@brand.example" }), false, "a machine's address");
  assert.equal(emailWorthReading(msg({ from: { emailAddress: { address: "acquisitions@brand.example" } } }), { ...contact, email: "acquisitions@brand.example" }), true, "a brand's acquisitions mailbox is a fair source");
});

test("only the writer's own words are read: the quoted thread and the footer are cut off", () => {
  const body = [
    "Hi Tom,", "", "We are looking for 2,000 to 3,000 sq ft in Leeds and York next year.", "", "Priya",
    "______________________________", "This email and any attachments are confidential.",
    "", "From: Tom Reed", "Sent: 12 November 2026 10:00", "To: Priya Shah", "Subject: RE: Sites", "", "BGP is asking £120,000 a year for the Leeds unit.",
  ].join("\n");
  const words = ownWords({ from: { emailAddress: { address: "priya@brand.example", name: "Priya Shah" } }, body: { content: body } });
  assert.match(words, /2,000 to 3,000 sq ft in Leeds and York/);
  assert.doesNotMatch(words, /£120,000|confidential/);
});

const queued = (m = msg()): Map<string, QueuedRequirementEmail> => {
  const q = new Map<string, QueuedRequirementEmail>();
  queueRequirementEmail(q, m, contact);
  return q;
};
const full = (text: string, over: any = {}) => ({ ...msg(), body: { content: text }, toRecipients: [{ emailAddress: { address: "agent@bgp.example" } }], ccRecipients: [], ...over });
const found = [{ brand: "Brand", quote: "looking for 2,000 to 3,000 sq ft in Leeds and York", sites: null, size: "2,000 to 3,000 sq ft", locations: ["Leeds", "York"], use: null, timing: null, confidence: "high" as const }];

test("a brand's own email raises one suggestion for that brand, read from its own words", async () => {
  const reads: any[] = [], raised: any[] = [];
  const out = await readQueuedRequirementEmails(async () => full("We are looking for 2,000 to 3,000 sq ft in Leeds and York next year, ideally by the summer."), "agent@bgp.example", queued(), {
    mailboxName: "Tom Reed",
    company: async () => ({ id: "co1", name: "Brand", kind: "brand" }),
    read: async input => { reads.push(input); return found; },
    suggest: async (r, source) => { raised.push({ r, source }); return true; },
  });
  assert.deepEqual(out, { read: 1, suggestions: 1 });
  assert.deepEqual(reads[0].brands, ["Brand"], "only the writer's own brand may be reported");
  assert.match(reads[0].what, /^email from Priya Shah of Brand to BGP, 2026-11-14$/);
  assert.equal(raised[0].source.mailboxName, "Tom Reed");
});

test("an agent's email names the brand itself; the agent's own firm is never the brand", async () => {
  const reads: any[] = [], raised: string[] = [];
  await readQueuedRequirementEmails(async () => full("My client Wingstop is looking for 2,500 sq ft in Reading and Oxford. We at Agent LLP are also looking for a new office."), "agent@bgp.example", queued(), {
    company: async () => ({ id: "co9", name: "Agent LLP", kind: "agent" }),
    read: async input => { reads.push(input); return [{ ...found[0], brand: "Wingstop" }, { ...found[0], brand: "Agent LLP" }]; },
    suggest: async r => { raised.push(r.brand); return true; },
  });
  assert.equal(reads[0].brands, null);
  assert.deepEqual(raised, ["Wingstop"]);
});

test("nothing is read for a landlord, a private email, a short email, or with no allowance", async () => {
  const never = async () => { throw new Error("read"); };
  const base = { read: never as any, suggest: never as any };
  assert.deepEqual(await readQueuedRequirementEmails(async () => full("x".repeat(200)), "a@bgp.example", queued(), { ...base, company: async () => null }), { read: 0, suggestions: 0 });
  assert.deepEqual(await readQueuedRequirementEmails(async () => full("Thanks."), "a@bgp.example", queued(), { ...base, company: async () => ({ id: "co1", name: "Brand", kind: "brand" }) }), { read: 0, suggestions: 0 });
  // The private side of the mail boundary: the mailbox itself, or the address anywhere on the email.
  const brand = async () => ({ id: "co1", name: "Brand", kind: "brand" as const });
  const requirement = "We are looking for 2,000 to 3,000 sq ft in Leeds and York next year.";
  assert.deepEqual(await readQueuedRequirementEmails(async () => full(requirement), PRIVATE_MAILBOX, queued(), { ...base, company: brand }), { read: 0, suggestions: 0 });
  assert.deepEqual(await readQueuedRequirementEmails(async () => full(requirement, { ccRecipients: [{ emailAddress: { address: PRIVATE_MAILBOX } }] }), "a@bgp.example", queued(), { ...base, company: brand }), { read: 0, suggestions: 0 });
  // The reader answers null when today's allowance is used: the run stops there.
  let calls = 0;
  const two = queued();
  queueRequirementEmail(two, msg({ id: "m2" }), contact);
  const out = await readQueuedRequirementEmails(async () => full("We are looking for 2,000 to 3,000 sq ft in Leeds and York next year."), "a@bgp.example", two, {
    company: async () => ({ id: "co1", name: "Brand", kind: "brand" }), read: async () => { calls++; return null; }, suggest: never as any,
  });
  assert.deepEqual(out, { read: 0, suggestions: 0 });
  assert.equal(calls, 1);
});

test("a failed fetch of one email does not stop the rest, and nothing throws", async () => {
  const two = queued();
  queueRequirementEmail(two, msg({ id: "m2", receivedDateTime: "2026-11-13T09:00:00Z" }), contact);
  let n = 0;
  const out = await readQueuedRequirementEmails(async () => { if (n++ === 0) throw new Error("Graph API 503"); return full("We are looking for 2,000 to 3,000 sq ft in Leeds and York next year."); }, "a@bgp.example", two, {
    company: async () => ({ id: "co1", name: "Brand", kind: "brand" }), read: async () => found, suggest: async () => true,
  });
  assert.deepEqual(out, { read: 1, suggestions: 1 });
});
