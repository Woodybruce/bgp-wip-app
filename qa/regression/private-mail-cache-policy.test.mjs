import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { PRIVATE_MAIL_POLICY_VERSION } from "../../server/private-mail.ts";

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require("./source-harness.cjs");
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const activityCode = ["activityCacheId", "readCache", "writeCache", "clientRefAllowed"]
  .map(name => fn("server/activity-routes.ts", name)).join("\n")
  + "\nexport { readCache, writeCache };";

function activityHarness() {
  const rows = new Map();
  const calls = [];
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.startsWith("INSERT INTO crm_activity_cache")) {
      const [type, id, markdown, email, meeting, latest, generated] = values;
      rows.set(`${type}:${id}`, { markdown, email_refs: JSON.parse(email), meeting_refs: JSON.parse(meeting), latest_at: latest, generated_at: generated });
      return { rows: [] };
    }
    if (sql.includes("subject_type = $1 AND subject_id = $2")) {
      const row = rows.get(`${values[0]}:${values[1]}`);
      return { rows: row ? [row] : [] };
    }
    // Execute the bound policy-prefix + client-suffix lookup over synthetic rows.
    assert.match(sql, /subject_id LIKE \$2 \|\| '%@client:' \|\| \$1/);
    return { rows: [...rows].filter(([key]) => key.slice(key.indexOf(":") + 1).startsWith(values[1]) && key.endsWith(`@client:${values[0]}`)).map(([, row]) => row) };
  } };
  return { ...evaluate(activityCode, { pool, PRIVATE_MAIL_POLICY_VERSION }), rows, calls };
}

const curated = { markdown: "Current allowed evidence", emailHits: [{ msgId: "allowed-email" }], meetingHits: [{ eventId: "allowed-meeting" }], latestActivityDate: "2026-10-27", generatedAt: "2026-10-27T12:00:00Z" };

test("activity reads and writes isolate legacy cache rows even if an old worker writes again", async () => {
  const h = activityHarness();
  h.rows.set("landlord:aew", { markdown: "Legacy evidence", email_refs: [{ msgId: "old-email" }] });
  assert.equal(await h.readCache("landlord", "aew"), null);
  await h.writeCache("landlord", "aew", curated);
  assert.equal(h.calls.at(-1).values[1], `${PRIVATE_MAIL_POLICY_VERSION}:aew`);
  assert.equal((await h.readCache("landlord", "aew")).markdown, curated.markdown);
  h.rows.set("landlord:aew", { markdown: "Old worker finished after deployment" });
  assert.equal((await h.readCache("landlord", "aew")).markdown, curated.markdown);
});

test("client raw references require the current privacy namespace and the same client", async () => {
  const h = activityHarness();
  h.rows.set("landlord:aew@client:client-a", { email_refs: [{ msgId: "old-email" }], meeting_refs: [{ eventId: "old-meeting" }] });
  assert.equal(await h.clientRefAllowed("client-a", "email", "old-email"), false);
  assert.equal(await h.clientRefAllowed("client-a", "meeting", "old-meeting"), false);
  await h.writeCache("landlord", "aew@client:client-a", curated);
  assert.equal(await h.clientRefAllowed("client-a", "email", "allowed-email"), true);
  assert.equal(await h.clientRefAllowed("client-a", "meeting", "allowed-meeting"), true);
  assert.equal(await h.clientRefAllowed("client-b", "email", "allowed-email"), false);
  assert.equal(await h.clientRefAllowed("client-a", "email", "old-email"), false);
  assert.equal((await h.readCache("landlord", "aew@client:client-a")).markdown, curated.markdown);
  assert.equal(await h.readCache("landlord", "aew"), null);
});

const takeCode = ["preparedTakePolicyVersion", "readPreparedBrandAiTake", "prepareBrandAiTake"]
  .map(name => fn("server/brand-ai-take.ts", name)).join("\n");

function takeHarness(companyType, tab, policyVersion) {
  const company = { id: "company-1", company_type: companyType, brief_revision: "revision-1" };
  let saved = { text: "Old evidence", policyVersion, fingerprint: "identity-1", dataHash: "hash-1", generatedAt: Date.now(), expiresAt: Date.now() + 100_000 };
  const writes = [];
  const client = {
    async query(sql, values) {
      if (sql.includes("FOR UPDATE")) return { rows: [company] };
      if (sql.startsWith("INSERT INTO system_settings")) { saved = JSON.parse(values[1]); writes.push(saved); }
      return { rows: [] };
    }, release() {},
  };
  const pool = {
    async query(sql) { return { rows: sql.includes("FROM crm_companies") ? [company] : [{ value: saved }] }; },
    async connect() { return client; },
  };
  const slice = { source: "allowed evidence" };
  const api = evaluate(takeCode, {
    pool, PRIVATE_MAIL_POLICY_VERSION, BRAND_BRIEF_POLICY_VERSION: "evidence-v1", CACHE_TTL_MS: 100_000,
    getBrandIdentity: () => ({ status: "verified", fingerprint: "identity-1" }),
    currentOfficialProfileEvidence: () => true, takeKey: (id, t) => `brand-prepared-take:${id}:${t}`,
    loadBrandSlice: async () => slice, loadUkSlice: async () => slice, loadActivitySlice: async () => slice, loadIntelSlice: async () => slice,
    brandPrompt: () => "Prompt", landlordPrompt: () => "Prompt", ukPrompt: () => "Prompt", activityPrompt: () => "Prompt", intelPrompt: () => "Prompt",
    dataHash: () => "hash-1", brandBriefWithoutEvidence: () => "New allowed evidence", landlordBriefFromRecords: () => "New allowed evidence",
    callClaude: async () => "New allowed evidence",
  });
  return { ...api, writes, replaceSaved: value => { saved = value; }, getSaved: () => saved, company, tab };
}

test("every prepared-take tab rejects pre-policy caches and stamps fresh writes", async () => {
  for (const companyType of ["Tenant", "Landlord"]) for (const tab of ["brand", "uk", "activity", "intel"]) {
    const priorPolicy = "evidence-v1" + (companyType === "Landlord" && tab === "brand" ? ":landlord-records-1" : "");
    const h = takeHarness(companyType, tab, priorPolicy);
    const legacy = h.getSaved();
    const oldRead = await h.readPreparedBrandAiTake(h.company.id, tab);
    assert.equal(oldRead.pending, true, `${companyType}/${tab} legacy cache must be hidden`);
    assert.equal(oldRead.text, "");
    const fresh = await h.prepareBrandAiTake(h.company.id, tab);
    assert.equal(fresh.cached, false);
    assert.equal(fresh.text, "New allowed evidence");
    assert.equal(h.writes[0].policyVersion, `${priorPolicy}:${PRIVATE_MAIL_POLICY_VERSION}`);
    assert.equal((await h.readPreparedBrandAiTake(h.company.id, tab)).text, fresh.text);
    assert.equal((await h.prepareBrandAiTake(h.company.id, tab)).cached, true);
    assert.equal(h.writes.length, 1);
    // A worker on the previous version can overwrite the same key during rollout.
    // The new reader must reject that payload rather than expose it until refresh.
    h.replaceSaved(legacy);
    assert.equal((await h.readPreparedBrandAiTake(h.company.id, tab)).pending, true);
  }
});
