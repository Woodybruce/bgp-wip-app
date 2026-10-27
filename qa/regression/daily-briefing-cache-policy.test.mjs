import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { isPrivateMailboxAddress, isPrivateEmailRecord, PRIVATE_MAIL_POLICY_VERSION } from "../../server/private-mail.ts";

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require("./source-harness.cjs");
const fn = name => find("server/daily-briefing.ts", node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const cacheCode = ["briefingCacheUserId", "readCached", "store", "getOrCreateTodaysBriefing"].map(fn).join("\n")
  + "\nexport { readCached, store };";

function harness() {
  const rows = new Map();
  const calls = [];
  const generations = [];
  const emails = new Map();
  const dateKey = "2026-10-27";
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql === "SELECT email FROM users WHERE id = $1") return { rows: [{ email: emails.get(values[0]) || "staff@brucegillinghampollard.com" }] };
    const key = `${values[0]}:${values[1]}`;
    if (sql.startsWith("INSERT INTO daily_briefings")) {
      rows.set(key, { briefing: values[2], stats: JSON.parse(values[3]), generated_at: values[4] });
      return { rows: [] };
    }
    assert.match(sql, /WHERE user_id = \$1 AND briefing_date = \$2/);
    return { rows: rows.has(key) ? [rows.get(key)] : [] };
  } };
  const api = evaluate(cacheCode, {
    pool, isPrivateMailboxAddress, PRIVATE_MAIL_POLICY_VERSION, ensureTable: async () => {}, londonDateKey: () => dateKey,
    generateBriefing: async (userId, msToken) => {
      generations.push({ userId, msToken });
      return { briefing: `Current briefing ${generations.length}`, stats: { openTasks: 2 }, generatedAt: "2026-10-27T12:00:00Z" };
    },
  });
  return { ...api, rows, calls, generations, emails, dateKey };
}

test("daily briefing ignores legacy worker writes while preserving the real user generation and cached result", async () => {
  const h = harness();
  const legacyKey = `staff-1:${h.dateKey}`;
  h.rows.set(legacyKey, { briefing: "Old evidence", stats: {}, generated_at: "2026-10-27T11:00:00Z" });
  h.rows.set(`${PRIVATE_MAIL_POLICY_VERSION}:staff-1:${h.dateKey}`, { briefing: "Old recipient-unchecked evidence", stats: {}, generated_at: "2026-10-27T11:30:00Z" });
  const first = await h.getOrCreateTodaysBriefing("staff-1", "synthetic-token");
  assert.equal(first.briefing, "Current briefing 1");
  assert.deepEqual(h.generations, [{ userId: "staff-1", msToken: "synthetic-token" }]);
  assert.ok(h.rows.has(`${PRIVATE_MAIL_POLICY_VERSION}:source-v2:staff-1:${h.dateKey}`));
  h.rows.set(legacyKey, { briefing: "Old worker completed after deployment", stats: {}, generated_at: "2026-10-27T12:01:00Z" });
  assert.equal((await h.getOrCreateTodaysBriefing("staff-1", null)).briefing, first.briefing);
  assert.equal(h.generations.length, 1);
});

test("daily briefing forced refresh and user/date separation retain normal behaviour", async () => {
  const h = harness();
  await h.getOrCreateTodaysBriefing("staff-1", null);
  const refreshed = await h.getOrCreateTodaysBriefing("staff-1", null, { force: true });
  assert.equal(refreshed.briefing, "Current briefing 2");
  assert.equal((await h.readCached("staff-1", h.dateKey)).briefing, refreshed.briefing);
  assert.equal(await h.readCached("staff-2", h.dateKey), null);
  assert.equal(await h.readCached("staff-1", "2026-10-28"), null);
  const other = await h.getOrCreateTodaysBriefing("staff-2", null);
  assert.equal(other.briefing, "Current briefing 3");
  assert.equal((await h.readCached("staff-1", h.dateKey)).briefing, refreshed.briefing);
  assert.deepEqual(h.generations.map(row => row.userId), ["staff-1", "staff-1", "staff-2"]);
});

test("excluded mailbox accounts cannot read even a current-policy cache after an account change", async () => {
  const h = harness();
  await h.getOrCreateTodaysBriefing("staff-1", null);
  h.emails.set("staff-1", "Equity@brucegillinghampollard.com");
  const before = h.calls.length;
  assert.equal(await h.readCached("staff-1", h.dateKey), null);
  assert.equal(h.calls.length, before + 1, "excluded account must not even query stored briefing text");
  const fresh = await h.getOrCreateTodaysBriefing("staff-1", null);
  assert.equal(fresh.briefing, "Current briefing 2");
});

test("excluded mailbox briefing generation omits calendar and inbox but keeps ordinary task/deal briefing", async () => {
  let prompt;
  const { generateBriefing } = evaluate(fn("generateBriefing"), {
    isPrivateMailboxAddress, isPrivateEmailRecord, CLOSED_STATUSES: [], statusSpellingsFor: () => [], londonDateKey: () => "2026-10-27",
    pool: { async query(sql) {
      if (sql.startsWith("SELECT name, team, email, role FROM users")) return { rows: [{ name: "Private mailbox", team: "London Retail", email: "equity@brucegillinghampollard.com", role: "Staff" }] };
      return { rows: [] };
    } },
    fetch: () => assert.fail("excluded mailbox must not reach Graph via /me"),
    require(name) {
      if (name === "./insights-feed") return { latestInsightsForEmail: async () => [] };
      if (name === "./utils/anthropic-client") return { callClaude: async args => {
        prompt = args.messages[0].content;
        return { choices: [{ message: { content: "Safe task and deal briefing" } }] };
      } };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  const result = await generateBriefing("equity-account", "synthetic-token");
  assert.equal(result.briefing, "Safe task and deal briefing");
  assert.match(prompt, /No calendar data available/);
  assert.match(prompt, /No email data available/);
  assert.match(prompt, /ACTIVE DEALS/);
  assert.equal(result.stats.unreadEmails, 0);
});

test("staff briefings exclude messages and invitations copied to the private account", async () => {
  let prompt;
  const person = address => ({emailAddress:{address}});
  const safeEmail = {subject:"Ordinary leasing update",from:{emailAddress:{name:"Public sender",address:"person@example.test"}},bodyPreview:"Safe update",isRead:false};
  const privateEmails = ["toRecipients","ccRecipients","bccRecipients"].map(field => ({...safeEmail,subject:`Excluded ${field}`,bodyPreview:"PRIVATE MESSAGE",[field]:[person("equity@brucegillinghampollard.com")]}));
  const {generateBriefing} = evaluate(fn("generateBriefing"), {
    isPrivateMailboxAddress,isPrivateEmailRecord,CLOSED_STATUSES:[],statusSpellingsFor:()=>[],londonDateKey:()=>"2026-10-27",
    pool:{async query(sql){return {rows:sql.startsWith("SELECT name, team, email, role FROM users")?[{name:"Staff",team:"Retail",email:"staff@brucegillinghampollard.com",role:"Staff"}]:[]};}},
    fetch:async url=>{
      if(url.includes("/me/messages")){assert.match(url,/toRecipients,ccRecipients,bccRecipients/);return {ok:true,json:async()=>({value:[safeEmail,...privateEmails]})};}
      assert.match(url,/organizer,attendees/);
      return {ok:true,json:async()=>({value:[{subject:"Ordinary meeting",start:{dateTime:"2026-10-27T11:00:00"},attendees:[person("person@example.test")]},{subject:"PRIVATE INVITATION",start:{dateTime:"2026-10-27T12:00:00"},attendees:[person("equity@brucegillinghampollard.com")]}]})};
    },
    require(name){
      if(name==="./insights-feed")return {latestInsightsForEmail:async()=>[]};
      if(name==="./utils/anthropic-client")return {callClaude:async args=>{prompt=args.messages[0].content;return {choices:[{message:{content:"Safe briefing"}}]};}};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const result=await generateBriefing("staff-1","synthetic-token");
  assert.match(prompt,/Ordinary leasing update/);assert.match(prompt,/Ordinary meeting/);
  assert.doesNotMatch(prompt,/PRIVATE|Excluded/);assert.equal(result.stats.unreadEmails,1);
});
