const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Extract only the real route callback; never initialize the app, DB or network.
const source = fs.readFileSync(process.env.MAPS_ROUTE_SOURCE || path.join(__dirname, "routes.ts"), "utf8");
const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
const registrations = [];
function visit(node) {
  if (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(ast) === "app" &&
      node.expression.name.text === "get" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "/api/config/maps-key") registrations.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(registrations.length, 1, "one maps-key GET route must exist");
const registration = registrations[0];
const callback = registration.arguments[2];
assert.ok(ts.isArrowFunction(callback), "extract the actual route handler");
const js = ts.transpileModule("const handler = " + callback.getText(ast) + "; handler;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function configuredKey(env) {
  const handler = vm.runInNewContext(js, { process: { env: { ...env } } });
  let payload;
  handler({}, { json(value) { payload = value; } });
  assert.equal(typeof payload.key, "string");
  assert.deepEqual(Object.keys(payload), ["key"]);
  return payload.key;
}

test("maps-key route retains authentication middleware", () => {
  assert.equal(registration.arguments.length, 3);
  assert.equal(registration.arguments[1].getText(ast), "requireAuth");
});
test("dedicated browser key is returned", () => {
  assert.equal(configuredKey({ VITE_GOOGLE_MAPS_API_KEY: "browser-fixture" }), "browser-fixture");
});
test("general server key is never a browser fallback", () => {
  assert.equal(configuredKey({ GOOGLE_API_KEY: "server-fixture" }), "");
});
test("server Maps key is never a browser fallback", () => {
  assert.equal(configuredKey({ GOOGLE_MAPS_API_KEY: "maps-server-fixture" }), "");
});
test("both server keys still fail closed without a browser key", () => {
  assert.equal(configuredKey({ GOOGLE_API_KEY: "server-fixture", GOOGLE_MAPS_API_KEY: "maps-server-fixture" }), "");
});
test("browser key wins when all key variables are configured", () => {
  assert.equal(configuredKey({
    GOOGLE_API_KEY: "server-fixture",
    GOOGLE_MAPS_API_KEY: "maps-server-fixture",
    VITE_GOOGLE_MAPS_API_KEY: "browser-fixture",
  }), "browser-fixture");
});
test("missing configuration returns no key", () => {
  assert.equal(configuredKey({}), "");
});
test("empty browser configuration never exposes a server fallback", () => {
  assert.equal(configuredKey({ VITE_GOOGLE_MAPS_API_KEY: "", GOOGLE_API_KEY: "server-fixture" }), "");
});

