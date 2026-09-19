import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../../script/build.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const head = "a".repeat(40);

// Exercise the actual build command's phase selection without compiling
// bundles, opening a database connection, or writing the real output tree.
async function runBuild({ env = {}, migrateOnly = false, noGit = false } = {}) {
  const calls = { pool: 0, query: 0, end: 0, rm: [], vite: [], bundles: [], errors: [], exit: null };
  const image = { resize() { return this; }, png() { return this; }, async toFile() {} };
  vm.runInNewContext(compiled, {
    exports: {},
    console: { log() {}, warn() {}, error(error) { calls.errors.push(String(error)); } },
    process: {
      cwd: () => "/tmp/synthetic-build-project",
      env: { BGP_BUILD_OUTPUT_DIR: "/tmp/synthetic-build-stage", ...env },
      argv: migrateOnly ? ["node", "build.ts", "--migrate-only"] : ["node", "build.ts"],
      exit(code) { calls.exit = code; },
    },
    require(name) {
      if (name === "esbuild") return { build: async config => { calls.bundles.push(config); } };
      if (name === "vite") return { build: async config => { calls.vite.push(config); } };
      if (name === "fs/promises") return {
        rm: async dir => { calls.rm.push(dir); },
        readFile: async file => file === "package.json" ? "{}" : "synthetic icon",
        writeFile: async () => {}, copyFile: async () => {}, mkdir: async () => {},
      };
      if (name === "fs") return { existsSync: () => false };
      if (name === "pg") return { default: { Pool: class {
        constructor() { calls.pool++; }
        async query() { calls.query++; throw new Error("synthetic migration failure"); }
        async end() { calls.end++; }
      } } };
      if (name === "sharp") return { default: () => image };
      if (name === "node:path") return { default: path };
      if (name === "node:child_process") return { execFile() {} };
      if (name === "node:util") return { promisify: () => async (command, args) => {
        assert.equal(command, "git");
        assert.equal(args.join(" "), "rev-parse HEAD");
        if (noGit) throw new Error("source archive has no git repository");
        return { stdout: head };
      } };
      throw new Error(`Unexpected build dependency ${name}`);
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return calls;
}

test("ordinary builds stage outputs and stamp git HEAD without opening a database", async () => {
  const calls = await runBuild({ env: { DATABASE_URL: "synthetic-unused" } });
  assert.equal(calls.exit, null);
  assert.equal(calls.pool, 0);
  assert.equal(calls.rm.join(), "/tmp/synthetic-build-stage");
  assert.equal(calls.vite[0].build.outDir, "/tmp/synthetic-build-stage/public");
  assert.equal(calls.bundles[0].outfile, "/tmp/synthetic-build-stage/index.cjs");
  assert.equal(calls.bundles[0].define["process.env.BGP_BUILD_SHA"], JSON.stringify(head));
});

test("native archives use the provider commit; explicit SHA mismatch stops before output removal", async () => {
  const providerSha = "b".repeat(40);
  const native = await runBuild({ noGit: true, env: { RAILWAY_GIT_COMMIT_SHA: providerSha } });
  assert.equal(native.exit, null);
  assert.equal(native.bundles[0].define["process.env.BGP_BUILD_SHA"], JSON.stringify(providerSha));
  const mismatch = await runBuild({ env: { BGP_BUILD_SHA: providerSha } });
  assert.equal(mismatch.exit, 1);
  assert.equal(mismatch.rm.length, 0);
  assert.equal(mismatch.bundles.length, 0);
});

test("explicit migration errors fail the command and close the pool without compiling", async () => {
  const failure = await runBuild({ migrateOnly: true, env: { DATABASE_URL: "synthetic-not-connected" } });
  assert.equal(failure.exit, 1);
  assert.equal(failure.query, 1);
  assert.equal(failure.end, 1);
  assert.ok(failure.errors.some(error => error.includes("synthetic migration failure")));
  assert.equal(failure.bundles.length, 0);
  assert.equal(failure.rm.length, 0);
  const missing = await runBuild({ migrateOnly: true });
  assert.equal(missing.exit, 1);
  assert.equal(missing.pool, 0);
  assert.ok(missing.errors.some(error => error.includes("DATABASE_URL is required")));
});
