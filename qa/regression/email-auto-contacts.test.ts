// Email → CRM contacts (Woody, 2026-09-29): external people on real
// correspondence become contacts filed under their company; bulk, automated,
// BCC and distribution mail never does. Run with:
//   node --import tsx --test qa/regression/email-auto-contacts.test.ts
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

let m: typeof import("../../server/email-auto-contacts");
before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  m = await import("../../server/email-auto-contacts");
});

const addr = (address: string, name = "") => ({ emailAddress: { address, name } });
const JACK = "jack@brucegillinghampollard.com";
const staff = new Set([JACK, "woody@brucegillinghampollard.com"]);

describe("which messages and people qualify", () => {
  it("outbound mail to an unknown firm makes its people candidates; known and internal are left out", () => {
    const plan = m.planMessage({
      id: "1", subject: "Royal Exchange — model", from: addr(JACK, "Jack"),
      toRecipients: [addr("Mat.Shulman@aresmgmt.com", "Shulman, Mat"), addr("known@appley.net")],
      ccRecipients: [addr("woody@bucegillinghampollard.com"), addr("web@bgp.uk.com"), addr("noreply@aresmgmt.com")],
    }, { isKnown: e => e === "known@appley.net", staffEmails: staff });
    assert.equal(plan.eligible, true);
    assert.equal(plan.inbound, false);
    assert.deepEqual(plan.unknown.map(p => p.email), ["mat.shulman@aresmgmt.com"]);
    assert.deepEqual(plan.externals.map(p => p.email).sort(), ["known@appley.net", "mat.shulman@aresmgmt.com", "noreply@aresmgmt.com"]);
  });

  it("inbound mail from a person addressed to BGP qualifies, info@ at a small firm included", () => {
    const plan = m.planMessage({
      id: "2", subject: "Re: unit 4", from: addr("info@smallfirm.co.uk", "Smith & Co"),
      toRecipients: [addr(JACK)],
    }, { isKnown: () => false, staffEmails: staff });
    assert.equal(plan.eligible, true);
    assert.equal(plan.inbound, true);
    assert.deepEqual(plan.unknown.map(p => p.email), ["info@smallfirm.co.uk"]);
  });

  it("BCC / list delivery, big distributions, automated senders, calendar, drafts and junk are skipped", () => {
    const ctx = { isKnown: () => false, staffEmails: staff, junkFolderId: "JUNK" };
    const bcc = m.planMessage({ id: "3", from: addr("agent@cbre.com"), toRecipients: [addr("agent@cbre.com")] }, ctx);
    assert.equal(bcc.eligible, false);
    assert.match(bcc.reason!, /BCC/);
    const many = Array.from({ length: 16 }, (_, i) => addr(`p${i}@firm${i}.com`));
    const dist = m.planMessage({ id: "4", from: addr(JACK), toRecipients: many }, ctx);
    assert.equal(dist.eligible, false);
    assert.match(dist.reason!, /distribution/);
    assert.equal(m.planMessage({ id: "5", from: addr("no-reply@docusign.net"), toRecipients: [addr(JACK)] }, ctx).eligible, false);
    assert.equal(m.planMessage({ id: "6", subject: "Accepted: Site visit", from: addr("a@b.com"), toRecipients: [addr(JACK)] }, ctx).eligible, false);
    assert.equal(m.planMessage({ id: "7", "@odata.type": "#microsoft.graph.eventMessageRequest", from: addr("a@b.com"), toRecipients: [addr(JACK)] }, ctx).eligible, false);
    assert.equal(m.planMessage({ id: "8", isDraft: true, from: addr(JACK), toRecipients: [addr("a@b.com")] }, ctx).eligible, false);
    assert.equal(m.planMessage({ id: "9", parentFolderId: "JUNK", from: addr("a@b.com"), toRecipients: [addr(JACK)] }, ctx).eligible, false);
  });

  it("classifies automated addresses without catching people", () => {
    for (const e of ["noreply@x.com", "no-reply@x.com", "donotreply@x.com", "notifications@x.com", "mailer-daemon@x.com",
      "bounce+abc@x.com", "news@retailweek.com", "newsletter@x.com", "alerts@costar.com", "someone@mailchimp.com",
      "hello@email.brand.com", "invitations@linkedin.com", "msprvs1=abc@x.com"]) {
      assert.ok(m.automatedAddressReason(e), e);
    }
    for (const e of ["jack.smith@aresmgmt.com", "info@smallfirm.co.uk", "hello@studio.com", "alex@eur.cushwake.com", "newton@firm.com"]) {
      assert.equal(m.automatedAddressReason(e), null, e);
    }
  });

  it("reads bulk / automated mail from its headers", () => {
    const h = (name: string, value: string) => [{ name: "Received", value: "x" }, { name, value }];
    assert.ok(m.bulkHeaderReason(h("List-Unsubscribe", "<mailto:u@x.com>")));
    assert.ok(m.bulkHeaderReason(h("List-Id", "<news.x.com>")));
    assert.ok(m.bulkHeaderReason(h("Precedence", "bulk")));
    assert.ok(m.bulkHeaderReason(h("Auto-Submitted", "auto-replied")));
    assert.ok(m.bulkHeaderReason(h("X-Auto-Response-Suppress", "All")));
    assert.ok(m.bulkHeaderReason(h("X-SG-EID", "abc")));
    assert.ok(m.bulkHeaderReason(h("X-Mailer", "MailChimp Mailer")));
    assert.equal(m.bulkHeaderReason(h("Auto-Submitted", "no")), null);
    assert.equal(m.bulkHeaderReason(h("X-Mailer", "Microsoft Outlook 16.0")), null);
    assert.equal(m.bulkHeaderReason([]), null);
  });
});

describe("names and companies", () => {
  it("names the person from the display name, else the address", () => {
    assert.equal(m.contactNameFor("Shulman, Mat", "mshulman@aresmgmt.com"), "Mat Shulman");
    assert.equal(m.contactNameFor("\"JOHN SMITH\"", "js@firm.com"), "John Smith");
    assert.equal(m.contactNameFor("", "john.smith@firm.com"), "John Smith");
    assert.equal(m.contactNameFor("john.smith@firm.com", "john.smith@firm.com"), "John Smith");
    assert.equal(m.contactNameFor("Mat", "mshulman@aresmgmt.com"), "Mat");
    assert.equal(m.contactNameFor("Smith & Co", "info@smallfirm.co.uk"), "Smith & Co");
    assert.equal(m.contactNameFor("", "info@smallfirm.co.uk"), "Smallfirm (info@)");
  });

  it("derives the registrable domain and a placeholder firm name", () => {
    assert.equal(m.registrableDomain("eur.cushwake.com"), "cushwake.com");
    assert.equal(m.registrableDomain("mail.shw.co.uk"), "shw.co.uk");
    assert.equal(m.registrableDomain("contoso.onmicrosoft.com"), "contoso.onmicrosoft.com");
    assert.equal(m.companyNameFromDomain("aresmgmt.com"), "Aresmgmt");
    assert.equal(m.companyNameFromDomain("hondo-enterprises.com"), "Hondo Enterprises");
    assert.equal(m.companyNameFromDomain("jll.com"), "JLL");
    assert.equal(m.companyNameFromDomain("eur.cushwake.com"), "Cushwake");
    assert.ok(m.isFreeMailDomain("gmail.com") && m.isFreeMailDomain("btinternet.com") && m.isFreeMailDomain("icloud.com"));
    assert.equal(m.isFreeMailDomain("aresmgmt.com"), false);
  });
});

// ── A fake Postgres: crm_contacts / crm_companies rows, real advisory-lock
// semantics (one holder per key until COMMIT / ROLLBACK). ─────────────────
function fakeDb(seed: { contacts?: any[]; companies?: any[] } = {}) {
  const contacts: any[] = (seed.contacts || []).map((c, i) => ({ id: `ct${i}`, created_at: i, ...c }));
  const companies: any[] = (seed.companies || []).map((c, i) => ({ id: `co${i}`, created_at: i, merged_into_id: null, parent_company_id: null, ...c }));
  const locks = new Map<string, Promise<void>>();
  const log: string[] = [];
  let seq = 100;
  const norm = (v: any) => String(v || "").trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").replace(/[/?#:].*$/, "");
  const query = async (sql: string, params: any[] = [], held?: { keys: string[] }) => {
    const s = sql.replace(/\s+/g, " ").trim();
    log.push(s.slice(0, 40));
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [] };
    if (s.includes("pg_advisory_xact_lock")) {
      const key = params[0];
      while (locks.has(key)) await locks.get(key);
      let release!: () => void;
      locks.set(key, new Promise<void>(r => { release = r; }));
      held!.keys.push(key);
      (held as any)[key] = release;
      return { rows: [] };
    }
    if (s.startsWith("SELECT id, name, email, company_id, company_name FROM crm_contacts")) {
      await new Promise(r => setTimeout(r, 5));
      return { rows: contacts.filter(c => String(c.email || "").trim().toLowerCase() === params[0]) };
    }
    if (s.startsWith("INSERT INTO crm_contacts")) {
      const row = { id: `ct${seq++}`, name: params[0], email: params[1], company_id: params[2], company_name: params[3], notes: params[4], enrichment_source: params[5], created_at: seq };
      contacts.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (s.startsWith("SELECT id, name FROM crm_companies")) {
      const cands: string[] = params[0];
      const hits = companies.filter(c => !c.merged_into_id && [c.domain, c.domain_url, c.website].some(v => cands.includes(norm(v))));
      return { rows: hits.slice(0, 1) };
    }
    if (s.startsWith("SELECT c.company_id AS id")) {
      const cands: string[] = params[0];
      const counts = new Map<string, number>();
      for (const c of contacts) {
        const d = String(c.email || "").split("@")[1]?.toLowerCase();
        if (c.company_id && d && cands.includes(d)) counts.set(c.company_id, (counts.get(c.company_id) || 0) + 1);
      }
      const rows = [...counts].map(([id, n]) => ({ id, name: companies.find(c => c.id === id)?.name, n })).sort((a, b) => b.n - a.n);
      return { rows: rows.slice(0, 2) };
    }
    if (s.startsWith("INSERT INTO crm_companies")) {
      const row = { id: `co${seq++}`, name: params[0], domain: params[1], description: params[2], enrichment_source: params[3], merged_into_id: null, parent_company_id: null, created_at: seq };
      companies.push(row);
      return { rows: [{ id: row.id, name: row.name }] };
    }
    throw new Error(`unexpected SQL: ${s.slice(0, 80)}`);
  };
  const pool = {
    query: (sql: string, params?: any[]) => query(sql, params),
    async connect() {
      const held: any = { keys: [] };
      return {
        query: async (sql: string, params?: any[]) => {
          const r = await query(sql, params, held);
          if (/^\s*(COMMIT|ROLLBACK)/.test(sql)) for (const k of held.keys.splice(0)) { locks.delete(k); held[k](); }
          return r;
        },
        release() {},
      };
    },
  };
  return { pool: pool as any, contacts, companies, log };
}

describe("creating contacts and companies", () => {
  it("dedupes by email case-insensitively and never double-creates on concurrent syncs", async () => {
    const db = fakeDb({ contacts: [{ name: "Known", email: " Known@Appley.net " }] });
    const found = await m.ensureContactForEmail(db.pool, { email: "known@appley.net", name: "X", companyId: null, companyName: null, notes: "n" });
    assert.equal(found.created, false);
    const input = { email: "Mat.Shulman@aresmgmt.com", name: "Mat Shulman", companyId: "co9", companyName: "Aresmgmt", notes: "Auto-added from email — Jack, 2026-09-01" };
    const [a, b] = await Promise.all([m.ensureContactForEmail(db.pool, input), m.ensureContactForEmail(db.pool, input)]);
    assert.equal(a.id, b.id);
    assert.equal([a.created, b.created].filter(Boolean).length, 1);
    const saved = db.contacts.filter(c => c.email === "mat.shulman@aresmgmt.com");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].enrichment_source, "email-sync");
    assert.equal(saved[0].company_id, "co9");
  });

  it("files under an existing company by domain / website, or by a clear majority of its people", async () => {
    const db = fakeDb({
      companies: [{ name: "Cushman & Wakefield", website: "https://www.cushmanwakefield.com/en-gb" }, { name: "Appley", domain: "appley.net" }, { name: "Honest Greens", domain: null }],
      contacts: [{ email: "a@honestgreens.com", company_id: "co2" }, { email: "b@honestgreens.com", company_id: "co2" }],
    });
    assert.equal((await m.ensureCompanyForDomain(db.pool, "cushmanwakefield.com", "m")).name, "Cushman & Wakefield");
    assert.equal((await m.ensureCompanyForDomain(db.pool, "uk.appley.net", "m")).name, "Appley");
    const hg = await m.ensureCompanyForDomain(db.pool, "honestgreens.com", "m");
    assert.equal(hg.name, "Honest Greens");
    assert.equal(hg.created, false);
    assert.equal(db.companies.length, 3);
  });

  it("creates one clearly-marked company for an unknown business domain, even concurrently", async () => {
    const db = fakeDb();
    const marker = "Auto-added from email — Jack Barratt, 2026-09-01";
    const [a, b] = await Promise.all([m.ensureCompanyForDomain(db.pool, "aresmgmt.com", marker), m.ensureCompanyForDomain(db.pool, "aresmgmt.com", marker)]);
    assert.equal(a.id, b.id);
    assert.equal(db.companies.length, 1);
    const co = db.companies[0];
    assert.equal(co.name, "Aresmgmt");
    assert.equal(co.domain, "aresmgmt.com");
    assert.equal(co.enrichment_source, "email-sync");
    assert.match(co.description, /^Auto-added from email — Jack Barratt, 2026-09-01\. Named from its aresmgmt\.com email address/);
  });
});

describe("a mailbox sweep", () => {
  it("adds the Ares people from Jack's mail, skips newsletters, and returns what to file", async () => {
    const db = fakeDb({ companies: [{ name: "Appley", domain: "appley.net" }] });
    const realFetch = globalThis.fetch;
    const batches: string[][] = [];
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/mailFolders/junkemail")) return new Response(JSON.stringify({ id: "JUNK" }), { status: 200 });
      if (u.endsWith("/$batch")) {
        const reqs = JSON.parse(init.body).requests;
        batches.push(reqs.map((r: any) => r.url));
        return new Response(JSON.stringify({
          responses: reqs.map((r: any) => ({
            id: r.id, status: 200,
            body: { internetMessageHeaders: r.url.includes("NEWS") ? [{ name: "List-Unsubscribe", value: "<x>" }] : [{ name: "X-Mailer", value: "Outlook" }] },
          })),
        }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as any;
    try {
      const contactsByEmail = new Map<string, any>([["known@appley.net", { id: "k1", name: "Known", email: "known@appley.net", companyId: "co0", companyName: "Appley" }]]);
      const run = m.newAutoContactRun({
        token: "t", pool: db.pool, contactsByEmail, staffEmails: staff,
        creators: new Map([[JACK, "Jack Barratt"]]), capPerMailbox: 50, delayMs: 0,
      });
      const messages = [
        { id: "OUT1", subject: "RE: Royal Exchange", receivedDateTime: "2026-07-14T10:00:00Z", from: addr(JACK), toRecipients: [addr("known@appley.net")], ccRecipients: [addr("mat.shulman@aresmgmt.com", "Shulman, Mat")] },
        { id: "IN1", subject: "RE: Royal Exchange", receivedDateTime: "2026-07-15T10:00:00Z", from: addr("mat.shulman@aresmgmt.com", "Mat Shulman"), toRecipients: [addr(JACK)], ccRecipients: [addr("pat@gmail.com", "Pat Lee")] },
        { id: "NEWS", subject: "Retail weekly", from: addr("editor@retailtimes.co.uk", "Editor"), toRecipients: [addr(JACK)] },
      ];
      const out = await m.resolveAutoContacts(run, JACK, messages);
      assert.equal(run.stats.contactsCreated, 2);
      assert.equal(run.stats.companiesCreated, 1);
      assert.deepEqual(db.contacts.map(c => [c.email, c.name, c.company_name]).sort(), [
        ["mat.shulman@aresmgmt.com", "Mat Shulman", "Aresmgmt"],
        ["pat@gmail.com", "Pat Lee", null],
      ]);
      assert.match(db.contacts[0].notes, /^Auto-added from email — Jack Barratt, 2026-07-1[45]$/);
      assert.deepEqual(out.get("OUT1")!.map(c => c.email), ["mat.shulman@aresmgmt.com"]);
      assert.deepEqual(out.get("IN1")!.map(c => c.email).sort(), ["mat.shulman@aresmgmt.com", "pat@gmail.com"]);
      assert.equal(out.has("NEWS"), false);
      assert.ok(!db.contacts.some(c => c.email.includes("retailtimes")));
      assert.equal(run.stats.skippedMessages["bulk mail"], 1);
      // Headers are only read for inbound mail, and once per message.
      assert.deepEqual(batches.flat().map(u => u.split("/messages/")[1].split("?")[0]).sort(), ["IN1", "NEWS"]);
      assert.ok(contactsByEmail.has("mat.shulman@aresmgmt.com"));

      // Idempotent: the same mail again creates nothing and files nothing new.
      const again = await m.resolveAutoContacts(run, JACK, messages);
      assert.equal(run.stats.contactsCreated, 2);
      assert.equal(again.size, 0);
      assert.equal(batches.length, 1);

      // A client login / non-staff mailbox never creates contacts.
      const clientRun = m.newAutoContactRun({ token: "t", pool: db.pool, contactsByEmail: new Map(), staffEmails: staff, creators: new Map(), capPerMailbox: 50, delayMs: 0 });
      assert.equal((await m.resolveAutoContacts(clientRun, "client@brucegillinghampollard.com", messages)).size, 0);
      assert.equal(clientRun.stats.contactsCreated, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
