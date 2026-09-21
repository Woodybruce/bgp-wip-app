/**
 * signature-contact-sync.test.ts — Delivery 4 Task 3: signature → CRM people.
 *
 * Runs decideContactFill pure and applySignatureToCrmContact /
 * syncSignaturesToCrmContacts against a mock pool (lazy-pool pattern, no
 * live database). Covers: fill-missing matrix per field; never-overwrite
 * (manual name, manual phone survive); placeholder-name replacement only for
 * auto sources; generic mailbox skipped; LinkedIn normalisation + garbage
 * dropped; no-match email → no writes; idempotency; the UPDATE's still-blank
 * guard; pool spy asserts the sync never INSERTs.
 *
 * Run with: node --import tsx --test server/signature-contact-sync.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Querier } from "./account-resolver";

let mod: typeof import("./signature-contact-sync");
before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  mod = await import("./signature-contact-sync");
});

const SIG = {
  email: "nick.smith@landsec.com",
  full_name: "Nicholas Smith",
  title: "Portfolio Director",
  phone: "+44 20 7000 0000",
  mobile: "+44 7700 900000",
  linkedin: "https://www.linkedin.com/in/nicksmith/",
};

function contact(overrides: Partial<import("./signature-contact-sync").CrmContactRow> = {}): import("./signature-contact-sync").CrmContactRow {
  return {
    id: "C1", name: "Nick Smith", role: null, phone: null, phone_mobile: null,
    linkedin_url: null, email: "nick.smith@landsec.com", enrichment_source: "promoted-from-email",
    ...overrides,
  };
}

describe("decideContactFill", () => {
  it("fills every blank field from the signature", () => {
    const fill = mod.decideContactFill(contact(), SIG);
    assert.equal(fill.role, "Portfolio Director");
    assert.equal(fill.phone, "+44 20 7000 0000");
    assert.equal(fill.phone_mobile, "+44 7700 900000");
    assert.equal(fill.linkedin_url, "linkedin.com/in/nicksmith");
    assert.equal(fill.name, "Nicholas Smith"); // placeholder + auto source
  });

  it("never overwrites existing values — manual or automatic", () => {
    const fill = mod.decideContactFill(contact({
      role: "Centre Manager", phone: "020 1111 1111", phone_mobile: "07700 111111",
      linkedin_url: "linkedin.com/in/manual", enrichment_source: null,
    }), SIG);
    assert.deepEqual(fill, {});
  });

  it("fills only the blank fields when some are set", () => {
    const fill = mod.decideContactFill(contact({ role: "Director" }), SIG);
    assert.equal(fill.role, undefined);
    assert.equal(fill.phone, "+44 20 7000 0000");
  });

  it("replaces the placeholder name only for automatic sources", () => {
    assert.equal(mod.decideContactFill(contact({ enrichment_source: "apollo" }), SIG).name, "Nicholas Smith");
    assert.equal(mod.decideContactFill(contact({ enrichment_source: "rocketreach" }), SIG).name, "Nicholas Smith");
    // Manual contact (NULL source) with a placeholder-shaped name: untouched.
    assert.equal(mod.decideContactFill(contact({ enrichment_source: null }), SIG).name, undefined);
    assert.equal(mod.decideContactFill(contact({ enrichment_source: "manual" }), SIG).name, undefined);
    // Auto contact whose name a human already corrected: untouched.
    assert.equal(mod.decideContactFill(contact({ name: "Nicky Smith" }), SIG).name, undefined);
  });

  it("recognises both placeholder generator shapes", () => {
    // email-processor / promote-sender shape (no digit strip)
    assert.equal(mod.decideContactFill(contact({ name: "Nick2 Smith", email: "nick2.smith@landsec.com" }), { ...SIG, email: "nick2.smith@landsec.com" }).name, "Nicholas Smith");
    // contacts-discovery shape (digits stripped)
    assert.equal(mod.decideContactFill(contact({ name: "Nick Smith", email: "nick2.smith@landsec.com" }), { ...SIG, email: "nick2.smith@landsec.com" }).name, "Nicholas Smith");
  });

  it("fills nothing for a generic mailbox", () => {
    const fill = mod.decideContactFill(contact({ email: "info@landsec.com", name: "Info" }), { ...SIG, email: "info@landsec.com" });
    assert.deepEqual(fill, {});
  });

  it("normalises LinkedIn and drops garbage", () => {
    assert.equal(mod.normalizeLinkedIn("www.linkedin.com/in/NickSmith"), "linkedin.com/in/nicksmith");
    assert.equal(mod.normalizeLinkedIn("https://uk.linkedin.com/in/nicksmith/"), "linkedin.com/in/nicksmith");
    assert.equal(mod.normalizeLinkedIn("linkedin.com/company/landsec"), null);
    assert.equal(mod.normalizeLinkedIn("not a url at all :::"), null);
    const fill = mod.decideContactFill(contact(), { ...SIG, linkedin: "https://example.com/nick" });
    assert.equal(fill.linkedin_url, undefined);
  });
});

function makePool(opts: { signatures?: any[]; contacts?: any[] } = {}) {
  const calls: Array<{ sql: string; params: unknown }> = [];
  const contacts = (opts.contacts ?? [contact()]).map(c => ({ ...c }));
  const pool: Querier = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (/FROM email_signatures/i.test(sql) && /lower\(email\) = \$1/i.test(sql)) {
        const rows = (opts.signatures ?? [SIG]).filter(s => s.email === params![0]);
        return { rows, rowCount: rows.length };
      }
      if (/FROM email_signatures/i.test(sql)) {
        const rows = opts.signatures ?? [SIG];
        return { rows, rowCount: rows.length };
      }
      if (/FROM crm_contacts/i.test(sql)) {
        const rows = contacts.filter(c => (c.email || "").toLowerCase() === params![0]);
        return { rows, rowCount: rows.length };
      }
      if (/^UPDATE crm_contacts/i.test(sql)) {
        const id = params![0];
        const c = contacts.find(x => x.id === id);
        // Emulate the still-blank guards: apply only when the guard fields
        // are still blank (name guard: unchanged).
        const setMatch = sql.match(/SET (.+?), updated_at/)!;
        const sets = setMatch[1].split(", ").map(s => s.split(" = ")[0]);
        let p = 1; // params[0] is id
        let applies = true;
        for (const field of sets) {
          const value = params![p++];
          if (field === "name") {
            const guard = params![p++];
            if (c!.name !== guard) { applies = false; break; }
          } else if (c![field as keyof typeof c] && String(c![field as keyof typeof c]).trim()) {
            applies = false; break;
          }
          if (applies) (c as any)[field] = value;
        }
        return { rows: [], rowCount: applies ? 1 : 0 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { pool, calls, contacts };
}

describe("applySignatureToCrmContact", () => {
  it("fills blanks on the matching contact and reports the fields", async () => {
    const { pool, contacts } = makePool();
    const r = await mod.applySignatureToCrmContact("Nick.Smith@Landsec.com", { pool });
    assert.equal(r.matched, 1);
    assert.equal(r.updated, 1);
    assert.deepEqual(r.fields.sort(), ["linkedin_url", "name", "phone", "phone_mobile", "role"]);
    assert.equal(contacts[0].name, "Nicholas Smith");
    assert.equal(contacts[0].role, "Portfolio Director");
  });

  it("no CRM row for the email → no writes", async () => {
    const { pool, calls } = makePool({ contacts: [] });
    const r = await mod.applySignatureToCrmContact("nick.smith@landsec.com", { pool });
    assert.equal(r.matched, 0);
    assert.equal(r.updated, 0);
    assert.ok(!calls.some(c => /^UPDATE/i.test(c.sql.trim())));
  });

  it("no signature cached → no writes", async () => {
    const { pool, calls } = makePool({ signatures: [] });
    const r = await mod.applySignatureToCrmContact("nick.smith@landsec.com", { pool });
    assert.equal(r.matched, 0);
    assert.ok(!calls.some(c => /crm_contacts/i.test(c.sql)));
  });

  it("generic mailbox → no reads, no writes", async () => {
    const { pool, calls } = makePool({ signatures: [{ ...SIG, email: "info@landsec.com" }], contacts: [contact({ email: "info@landsec.com" })] });
    const r = await mod.applySignatureToCrmContact("info@landsec.com", { pool });
    assert.deepEqual(r, { matched: 0, updated: 0, fields: [] });
    assert.equal(calls.length, 0);
  });

  it("is idempotent — a second run computes zero updates", async () => {
    const { pool } = makePool();
    const first = await mod.applySignatureToCrmContact("nick.smith@landsec.com", { pool });
    assert.equal(first.updated, 1);
    const second = await mod.applySignatureToCrmContact("nick.smith@landsec.com", { pool });
    assert.equal(second.updated, 0);
    assert.deepEqual(second.fields, []);
  });

  it("UPDATE carries a still-blank guard per filled field", async () => {
    const { pool, calls } = makePool();
    await mod.applySignatureToCrmContact("nick.smith@landsec.com", { pool });
    const update = calls.find(c => /^UPDATE/i.test(c.sql.trim()))!;
    assert.match(update.sql, /\(role IS NULL OR btrim\(role\) = ''\)/);
    assert.match(update.sql, /\(phone IS NULL OR btrim\(phone\) = ''\)/);
    assert.match(update.sql, /\(phone_mobile IS NULL OR btrim\(phone_mobile\) = ''\)/);
    assert.match(update.sql, /\(linkedin_url IS NULL OR btrim\(linkedin_url\) = ''\)/);
    assert.match(update.sql, /AND name = \$\d+/);
  });

  it("never INSERTs — this path creates nobody", async () => {
    const { pool, calls } = makePool();
    await mod.applySignatureToCrmContact("nick.smith@landsec.com", { pool });
    assert.ok(!calls.some(c => /^\s*(INSERT|DELETE)/i.test(c.sql)), calls.map(c => c.sql).join("\n"));
  });
});

describe("syncSignaturesToCrmContacts", () => {
  it("batches over recently-enriched signatures and aggregates", async () => {
    const { pool } = makePool({
      signatures: [SIG, { ...SIG, email: "ada.wong@landsec.com", full_name: "Ada Wong" }],
      contacts: [contact(), contact({ id: "C2", email: "ada.wong@landsec.com", name: "Ada Wong" })],
    });
    const r = await mod.syncSignaturesToCrmContacts({ limit: 10 }, { pool });
    assert.equal(r.scanned, 2);
    assert.equal(r.matched, 2);
    assert.equal(r.updated, 2);
  });
});
