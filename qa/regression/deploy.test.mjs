import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../../server/auto-deploy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const testedSha = "a".repeat(40);
const oldSha = "b".repeat(40);

function writeRelease(dir, label) {
  fs.mkdirSync(path.join(dir, "public", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.cjs"), label);
  fs.writeFileSync(path.join(dir, "public", "index.html"), label);
  fs.writeFileSync(path.join(dir, "public", "assets", `${label}.js`), label);
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bgp-deploy-regression-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeRelease(path.join(root, "dist"), "old");
  fs.writeFileSync(path.join(root, ".deployed-sha"), oldSha);
  const calls = [];
  const routes = new Map();
  const state = { head: testedSha, dirty: "", ...options };
  const exports = {};
  const fakeRun = async (command, args, config) => {
    calls.push({ command, args, config });
    if (command === "git") {
      let stdout = "";
      if (args[0] === "status") stdout = state.dirty;
      else if (args[0] === "rev-parse") stdout = args[1] === "--abbrev-ref" ? "test-branch" : args[1] === "FETCH_HEAD" ? state.remote || testedSha : state.head;
      else if (args[0] === "rev-list") stdout = state.ahead || "0";
      else if (args[0] === "diff") stdout = state.dependenciesChanged || "";
      else if (args[0] === "merge") state.head = args[2];
      else assert.equal(args[0], "fetch");
      return { stdout };
    }
    assert.equal(command, "npm");
    if (args.includes("--migrate-only")) {
      assert.equal(args.join(" "), "run build -- --migrate-only");
      assert.equal(config.env.DATABASE_URL, "synthetic-not-for-build");
      assert.ok(calls.some(call => call.command === "npm" && !call.args.includes("--migrate-only")));
      if (state.migrate) await state.migrate(state);
      return { stdout: "synthetic migration" };
    }
    assert.equal(args.join(" "), "run build");
    assert.equal(config.env.DATABASE_URL, undefined);
    assert.equal(config.env.BGP_BUILD_SHA, testedSha);
    assert.notEqual(config.env.BGP_BUILD_OUTPUT_DIR, path.join(root, "dist"));
    if (state.build) await state.build(config.env.BGP_BUILD_OUTPUT_DIR, state);
    else writeRelease(config.env.BGP_BUILD_OUTPUT_DIR, "new");
    return { stdout: "synthetic build" };
  };
  vm.runInNewContext(compiled, {
    exports,
    console: { error() {} },
    process: {
      cwd: () => root,
      env: { DEPLOY_WEBHOOK_SECRET: "synthetic-secret", BGP_BUILD_SHA: state.runningSha || oldSha, DATABASE_URL: "synthetic-not-for-build" },
      kill(pid, signal) { calls.push({ command: "restart", pid, signal }); },
    },
    require(name) {
      if (name === "node:child_process") return { execFile() {} };
      if (name === "node:util") return { promisify: () => fakeRun };
      if (name === "node:fs") return state.fs || fs;
      if (name === "node:path") return path;
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  exports.registerAutoDeployRoutes({
    get(route, fn) { routes.set(`GET ${route}`, fn); },
    post(route, fn) { routes.set(`POST ${route}`, fn); },
  });
  async function request(method, sha = testedSha) {
    const res = { code: 200, body: null, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.get(`${method} /api/admin/deploy${method === "GET" ? "/status" : ""}`)({
      header: name => name === "x-deploy-secret" ? "synthetic-secret" : sha,
    }, res);
    return res;
  }
  async function waitFor(status) {
    for (let i = 0; i < 200; i++) {
      const result = await request("GET");
      if (result.body.status === status) return result.body;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Deployment did not reach ${status}`);
  }
  return { root, calls, state, exports, request, waitFor };
}

test("reject missing tested SHA, stale remote, local edits, diverged commits, and changed dependencies before building", async t => {
  for (const options of [{ noSha: true }, { remote: "c".repeat(40) }, { dirty: " M server/example.ts" }, { ahead: "1" }, { dependenciesChanged: "package-lock.json" }]) {
    const f = fixture(t, options);
    const res = await f.request("POST", options.noSha ? "" : testedSha);
    assert.equal(res.code, options.noSha ? 400 : 409);
    assert.equal(fs.readFileSync(path.join(f.root, "dist", "index.cjs"), "utf8"), "old");
    assert.ok(!f.calls.some(call => call.command === "npm" || call.args?.[0] === "merge"));
    assert.ok(!f.calls.some(call => ["push", "pull", "rebase"].includes(call.args?.[0])));
  }
});

test("a pending or failed child build leaves live files intact and status requests responsive", async t => {
  let rejectBuild;
  const f = fixture(t, { build: () => new Promise((_resolve, reject) => { rejectBuild = reject; }) });
  assert.equal((await f.request("POST")).code, 202);
  await f.waitFor("building");
  while (!rejectBuild) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.request("GET")).body.status, "building");
  assert.equal(fs.readFileSync(path.join(f.root, "dist", "public", "index.html"), "utf8"), "old");
  rejectBuild(new Error("synthetic build failure"));
  await f.waitFor("failed");
  assert.equal(fs.readFileSync(path.join(f.root, "dist", "index.cjs"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(f.root, ".deployed-sha"), "utf8"), oldSha);
  assert.ok(!f.calls.some(call => call.command === "restart"));
  assert.ok(!f.calls.some(call => call.args?.includes("--migrate-only")));
});

test("checkout drift during a build prevents release promotion", async t => {
  const f = fixture(t, { build: async (dir, state) => { writeRelease(dir, "new"); state.head = oldSha; } });
  await f.request("POST");
  await f.waitFor("failed");
  assert.equal(fs.readFileSync(path.join(f.root, "dist", "index.cjs"), "utf8"), "old");
  assert.ok(!f.calls.some(call => call.command === "restart"));
  assert.ok(!f.calls.some(call => call.args?.includes("--migrate-only")));
});

test("an incomplete build never runs migrations; a failed migration never promotes the staged release", async t => {
  for (const options of [
    { build: async () => {} },
    { migrate: async () => { throw new Error("synthetic migration failure"); } },
  ]) {
    const f = fixture(t, options);
    assert.equal((await f.request("POST")).code, 202);
    await f.waitFor("failed");
    assert.equal(fs.readFileSync(path.join(f.root, "dist", "index.cjs"), "utf8"), "old");
    assert.equal(fs.readFileSync(path.join(f.root, ".deployed-sha"), "utf8"), oldSha);
    assert.ok(!f.calls.some(call => call.command === "restart"));
    assert.equal(f.calls.filter(call => call.args?.includes("--migrate-only")).length, options.migrate ? 1 : 0);
  }
});

test("complete builds promote together, retain old chunks and release, and restart only the tested SHA", async t => {
  const f = fixture(t, { head: oldSha });
  assert.equal((await f.request("POST")).code, 202);
  await f.waitFor("restarting");
  assert.equal(fs.readFileSync(path.join(f.root, "dist", "index.cjs"), "utf8"), "new");
  assert.equal(fs.readFileSync(path.join(f.root, "dist", "public", "index.html"), "utf8"), "new");
  assert.equal(fs.readFileSync(path.join(f.root, "dist", "public", "assets", "old.js"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(f.root, ".deployed-sha"), "utf8"), testedSha);
  const previous = fs.readdirSync(path.join(f.root, "node_modules", ".cache")).find(name => name.endsWith(".previous"));
  assert.ok(previous);
  assert.equal(fs.readFileSync(path.join(f.root, "node_modules", ".cache", previous, "index.cjs"), "utf8"), "old");
  assert.ok(f.calls.some(call => call.command === "restart" && call.pid === 1 && call.signal === "SIGUSR2"));
  assert.ok(f.calls.some(call => call.args?.join(" ") === `merge --ff-only ${testedSha}`));
  assert.equal(f.calls.filter(call => call.args?.includes("--migrate-only")).length, 1);
  const restarted = fixture(t, { runningSha: testedSha });
  assert.equal((await restarted.request("GET")).body.sha, testedSha);
  assert.equal((await restarted.request("GET")).body.status, "deployed");
});

test("incomplete build and failed rename both preserve the live release", t => {
  const f = fixture(t);
  const staged = path.join(f.root, "staged");
  const live = path.join(f.root, "dist");
  const previous = path.join(f.root, "previous");
  fs.mkdirSync(staged);
  assert.throws(() => f.exports.promoteBuiltRelease(staged, live, previous));
  assert.equal(fs.readFileSync(path.join(live, "index.cjs"), "utf8"), "old");
  writeRelease(staged, "new");
  const broken = fixture(t, { fs: { ...fs, renameSync(from, to) {
    if (from === staged) throw new Error("synthetic rename failure");
    return fs.renameSync(from, to);
  } } });
  assert.throws(() => broken.exports.promoteBuiltRelease(staged, live, previous), /rename failure/);
  assert.equal(fs.readFileSync(path.join(live, "index.cjs"), "utf8"), "old");
});
