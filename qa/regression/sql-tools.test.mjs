import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as schema from "../../shared/schema.ts";

// Run with: node --import tsx --test qa/regression/sql-tools.test.mjs
// Load the real module against a synthetic pool; importing server/db would
// unnecessarily require a database for policy and connection-lifecycle checks.
const source = readFileSync(new URL("../../server/sql-tools.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadTools(pool) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    console,
    require(name) {
      if (name === "./db") return { pool };
      if (name === "@shared/schema") return schema;
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return exports;
}

const secretTables = [
  "users", "session", "sessions", "auth_tokens", "sso_exchange_codes",
  "system_settings", "msal_token_cache", "user_sessions", "api_keys",
  "kyc_upload_tokens", "kyc_upload_files", "staff_benefit_credentials",
];

test("secret tables are unavailable for reads, writes, and every schema surface", async () => {
  const tools = loadTools({
    connect() { assert.fail("Denied reads must not acquire a connection"); },
    query() { assert.fail("Denied writes must not touch the database"); },
  });
  for (const table of secretTables) {
    for (const query of [`SELECT * FROM ${table}`, `SELECT * FROM public."${table}"`]) {
      assert.equal((await tools.executeSqlQuery(query)).success, false, query);
    }
    for (const op of ["insert", "update", "delete"]) {
      assert.equal((await tools.executeSqlWrite({ table, op, data: { id: "probe" }, where: { id: "probe" } })).success, false);
      assert.equal((await tools.executeSqlWrite({ table: table.toUpperCase(), op, data: { id: "probe" }, where: { id: "probe" } })).success, false);
    }
    assert.equal(tools.executeDescribeSchema(table).success, false);
    assert.ok(!tools.getSchemaDigest().some(entry => entry.name === table));
    assert.ok(!tools.executeDescribeSchema().tables.includes(table));
    assert.ok(!tools.getSchemaToc().includes(`- ${table} (`));
  }
  assert.equal(tools.executeDescribeSchema("crm_deals").success, true);
  assert.equal(tools.executeDescribeSchema("document_design_preferences").success, true);
});

test("encoded identifiers and indirect SQL/configuration helpers are rejected", async () => {
  const tools = loadTools({ connect() { assert.fail("Unsafe SQL must not reach the pool"); } });
  for (const query of [
    String.raw`SELECT * FROM U&"auth\005ftokens"`,
    "SELECT set_config/**/('transaction_read_only', 'off', true)",
    "SELECT query_to_xml/**/('SELECT 1', true, false, '')",
    "SELECT dblink_connect('unused')",
    "SELECT table_name, column_name FROM information_schema.columns",
  ]) assert.equal((await tools.executeSqlQuery(query)).success, false, query);
});

test("reads have a real read-only transaction and roll back before pool reuse", async () => {
  const calls = [];
  const tools = loadTools({
    async connect() {
      return {
        async query(query) {
          calls.push(query);
          return { rows: [{ value: "synthetic" }], rowCount: 1 };
        },
        release(error) { calls.push({ release: true, error }); },
      };
    },
  });
  const result = await tools.executeSqlQuery("SELECT name FROM crm_companies");
  assert.equal(result.success, true);
  assert.equal(result.rows[0].value, "synthetic");
  assert.equal(calls[0], "BEGIN READ ONLY");
  assert.match(calls[1], /^SET LOCAL statement_timeout = \d+$/);
  assert.equal(calls[2].queryMode, "extended");
  assert.match(calls[2].text, /SELECT name FROM crm_companies/);
  assert.equal(calls[3], "ROLLBACK");
  assert.equal(calls[4].release, true);
  assert.equal(calls[4].error, undefined);
});

test("query errors roll back and failed rollback discards the connection", async () => {
  for (const rollbackFails of [false, true]) {
    const calls = [];
    let released;
    const tools = loadTools({
      async connect() {
        return {
          async query(query) {
            calls.push(query);
            if (typeof query === "object") throw new Error("synthetic query failure");
            if (query === "ROLLBACK" && rollbackFails) throw new Error("synthetic connection loss");
          },
          release(error) { released = { error }; },
        };
      },
    });
    assert.equal((await tools.executeSqlQuery("SELECT 1")).success, false);
    assert.equal(calls.at(-1), "ROLLBACK");
    assert.ok(released);
    assert.equal(Boolean(released.error), rollbackFails);
  }
});

test("connection failures return the tool error contract", async () => {
  const tools = loadTools({ async connect() { throw new Error("synthetic unavailable database"); } });
  const result = await tools.executeSqlQuery("SELECT 1");
  assert.equal(result.success, false);
  assert.match(result.error, /unavailable database/);
});

test("operational CRM and document preference writes remain available and audited", async () => {
  const calls = [];
  const tools = loadTools({
    async query(query, values) {
      calls.push({ query, values });
      return { rows: [{ id: "synthetic" }], rowCount: 1 };
    },
  });
  const result = await tools.executeSqlWrite({
    table: "crm_companies", op: "update", data: { name: "Synthetic brand" }, where: { id: "synthetic" },
  }, { userId: "synthetic-staff", threadId: "synthetic-thread" });
  assert.equal(result.success, true);
  assert.equal(result.affected, 1);
  assert.ok(calls.some(call => call.query.startsWith("UPDATE crm_companies")));
  assert.ok(calls.some(call => call.query.includes("INSERT INTO ai_write_audit") && call.values.includes("synthetic-staff")));
  const preference = await tools.executeSqlWrite({
    table: "document_design_preferences", op: "insert", data: { scope: "why_buy", preference: "Synthetic preference" },
  });
  assert.equal(preference.success, true);
  assert.ok(calls.some(call => call.query.startsWith("INSERT INTO document_design_preferences")));
});
