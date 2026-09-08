import assert from "node:assert/strict";

// Run only against a freshly created disposable PostgreSQL database:
// SQL_REGRESSION_DATABASE_URL='postgresql:///bgp_sql_regression?host=/tmp/bgp-sql-regression-socket&user=bgp_sql_regression&port=55440' node --import tsx qa/regression/sql-tools-postgres.mjs
// The separate variable and Unix-socket restriction prevent accidental use
// of the application's configured database. No .env file is loaded.
const supplied = process.env.SQL_REGRESSION_DATABASE_URL;
if (!supplied) throw new Error("SQL_REGRESSION_DATABASE_URL must identify the disposable test database");
const url = new URL(supplied);
if (url.hostname || url.pathname !== "/bgp_sql_regression"
    || !/^\/(?:private\/)?tmp\/bgp-sql-regression-[a-zA-Z0-9_-]+$/.test(url.searchParams.get("host") || "")) {
  throw new Error("Refusing a database outside the disposable SQL regression Unix socket");
}
process.env.DATABASE_URL = supplied;
process.env.PGSSLMODE = "disable";
const { pool } = await import("../../server/db.ts");
const { executeSqlQuery, executeSqlWrite, executeDescribeSchema, getSchemaDigest } = await import("../../server/sql-tools.ts");

try {
  await pool.query("CREATE TABLE sql_regression_probe (id integer PRIMARY KEY, value text)");
  await pool.query("INSERT INTO sql_regression_probe VALUES (1, 'unchanged')");
  await pool.query("CREATE TABLE auth_tokens (token text)");
  await pool.query("INSERT INTO auth_tokens VALUES ('synthetic-token')");

  const mode = await executeSqlQuery("SELECT current_setting('transaction_read_only') AS readonly, current_setting('statement_timeout') AS timeout");
  assert.equal(mode.success, true);
  assert.equal(mode.rows[0].readonly, "on");
  assert.equal(mode.rows[0].timeout, "1min");

  const mutation = await executeSqlQuery(
    `WITH changed AS (UPDATE "sql_regression_probe" SET value = 'changed' WHERE id = 1 RETURNING id) SELECT id FROM changed`,
  );
  assert.equal(mutation.success, false);
  assert.match(mutation.error, /read-only transaction/i);
  assert.equal((await pool.query("SELECT value FROM sql_regression_probe WHERE id = 1")).rows[0].value, "unchanged");

  // This comment form evades the old semicolon regex. Extended protocol
  // must reject the entire batch before COMMIT can escape the transaction.
  const multiple = await executeSqlQuery("SELECT 1; /* gap */ COMMIT; /* gap */ SELECT 2");
  assert.equal(multiple.success, false);
  assert.match(multiple.error, /multiple commands|prepared statement/i);

  for (const table of ["users", "session", "auth_tokens", "sso_exchange_codes", "system_settings", "msal_token_cache"]) {
    assert.equal((await executeSqlQuery(`SELECT * FROM public."${table}"`)).success, false);
    assert.equal((await executeSqlWrite({ table, op: "delete", where: { id: "synthetic" } })).success, false);
    assert.equal(executeDescribeSchema(table).success, false);
    assert.ok(!getSchemaDigest().some(entry => entry.name === table));
  }

  assert.equal((await executeSqlQuery("SELECT 1 / 0")).success, false);
  assert.equal((await executeSqlQuery("SELECT value FROM sql_regression_probe")).rows[0].value, "unchanged");
  // A later ordinary pool write must not inherit a leaked read-only or
  // aborted transaction from either successful or failed tool requests.
  await pool.query("UPDATE sql_regression_probe SET value = 'ordinary-write' WHERE id = 1");
  assert.equal((await pool.query("SELECT value FROM sql_regression_probe WHERE id = 1")).rows[0].value, "ordinary-write");
  console.log("PASS: PostgreSQL read-only enforcement, transaction timeout, one-statement protocol, sensitive policy, and pool reuse");
} finally {
  await pool.end();
}
