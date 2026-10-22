const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function extractFunction(filename, name) {
  const source = fs.readFileSync(filename, "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const found = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(found.length, 1, "one " + name + " function must exist");
  return found[0].getText(ast);
}
function compile(fns, expression, globals) {
  const output = ts.transpileModule(fns.join("\n") + "\n" + expression, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(output, { URL, Buffer, AbortSignal, Date, ...globals });
}
const pathwayPath = path.join(__dirname, "property-pathway.ts");
const rebindSource = extractFunction(pathwayPath, "rebindPropertyImageKeys");
const pptxPath = process.env.PPTX_MAP_SOURCE || path.join(__dirname, "claude-designed-pptx.ts");
const pptxSource = extractFunction(pptxPath, "fetchStaticMapData");
function rebinder(env) {
  return compile([rebindSource], "rebindPropertyImageKeys;", { process: { env: { ...env } } });
}
function runWith(streetViewUrl, aerialUrl) {
  return {
    id: "run-fixture", address: "Example Street", postcode: "EX1 1AA",
    stageResults: {
      stage1: { summary: "Keep this", propertyImage: {
        streetViewUrl, aerialUrl, googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=example",
      } },
      stage2: { company: { name: "Keep company" } },
    },
  };
}
const street = "https://maps.googleapis.com/maps/api/streetview?location=Example+Street&size=640x400&key=old-fixture";
const aerial = "https://maps.googleapis.com/maps/api/staticmap?center=Example+Street&markers=one&markers=two&key=old-fixture";
const current = { GOOGLE_MAPS_API_KEY: "current-map-fixture", VITE_GOOGLE_MAPS_API_KEY: "browser-fixture", GOOGLE_API_KEY: "never-public-fixture" };

test("saved Street View and aerial URLs use the current Maps key without changing their query", () => {
  const input = runWith(street, aerial);
  const result = rebinder(current)(input);
  for (const field of ["streetViewUrl", "aerialUrl"]) {
    const before = new URL(input.stageResults.stage1.propertyImage[field]);
    const after = new URL(result.stageResults.stage1.propertyImage[field]);
    assert.equal(after.searchParams.get("key"), current.VITE_GOOGLE_MAPS_API_KEY);
    before.searchParams.delete("key");
    after.searchParams.delete("key");
    assert.equal(after.toString(), before.toString());
  }
});
test("rebinding preserves unrelated fields and does not mutate the saved run", () => {
  const input = runWith(street, aerial);
  const snapshot = JSON.stringify(input);
  Object.freeze(input.stageResults.stage1.propertyImage);
  Object.freeze(input.stageResults.stage1);
  Object.freeze(input.stageResults);
  Object.freeze(input);
  const result = rebinder(current)(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(result.id, input.id);
  assert.equal(result.address, input.address);
  assert.equal(result.stageResults.stage1.summary, "Keep this");
  assert.equal(result.stageResults.stage2, input.stageResults.stage2);
  assert.equal(result.stageResults.stage1.propertyImage.googleMapsUrl, input.stageResults.stage1.propertyImage.googleMapsUrl);
});
test("dedicated browser Maps key is sufficient", () => {
  const result = rebinder({ VITE_GOOGLE_MAPS_API_KEY: "browser-fixture" })(runWith(street, aerial));
  assert.equal(new URL(result.stageResults.stage1.propertyImage.streetViewUrl).searchParams.get("key"), "browser-fixture");
});
test("missing public keys removes stale keys and never falls back to the general key", () => {
  for (const env of [{}, { GOOGLE_API_KEY: "never-public-fixture", GOOGLE_MAPS_API_KEY: "never-fallback-fixture" }]) {
    const result = rebinder(env)(runWith(street, aerial));
    assert.equal(new URL(result.stageResults.stage1.propertyImage.streetViewUrl).searchParams.has("key"), false);
    assert.equal(new URL(result.stageResults.stage1.propertyImage.aerialUrl).searchParams.has("key"), false);
  }
});
test("runs without property images are unchanged", () => {
  for (const input of [{ id: "a", stageResults: null }, { id: "b", stageResults: {} }, { id: "c", stageResults: { stage1: {} } }]) {
    assert.equal(rebinder(current)(input), input);
  }
});
const invalidStreetUrls = [
  ["foreign host", "https://example.com/maps/api/streetview?key=old"],
  ["hostname suffix", "https://maps.googleapis.com.example.com/maps/api/streetview?key=old"],
  ["hostname prefix", "https://notmaps.googleapis.com/maps/api/streetview?key=old"],
  ["HTTP", "http://maps.googleapis.com/maps/api/streetview?key=old"],
  ["userinfo", "https://name:pass@maps.googleapis.com/maps/api/streetview?key=old"],
  ["nondefault port", "https://maps.googleapis.com:8443/maps/api/streetview?key=old"],
  ["other Maps API", "https://maps.googleapis.com/maps/api/place/details/json?key=old"],
  ["wrong image type", "https://maps.googleapis.com/maps/api/staticmap?key=old"],
  ["invalid URL", "not a URL"],
];
for (const [label, url] of invalidStreetUrls) {
  test("image rebinder does not inject keys into " + label, () => {
    const result = rebinder(current)(runWith(url, aerial));
    assert.equal(result.stageResults.stage1.propertyImage.streetViewUrl, url);
  });
}
test("getRun rebinds a DB-read snapshot without writing to the DB", async () => {
  const saved = runWith(street, aerial);
  let writes = 0;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [saved] }) }) }),
    update: () => { writes++; throw new Error("unexpected write"); },
  };
  const get = compile([rebindSource, extractFunction(pathwayPath, "getRun")], "getRun;", {
    process: { env: current }, db, propertyPathwayRuns: { id: "id" }, eq: () => true,
  });
  const result = await get("run-fixture");
  assert.equal(new URL(result.stageResults.stage1.propertyImage.aerialUrl).searchParams.get("key"), current.VITE_GOOGLE_MAPS_API_KEY);
  assert.equal(saved.stageResults.stage1.propertyImage.aerialUrl, aerial);
  assert.equal(writes, 0);
});
test("updateRun returns fresh image keys without adding image rewrites to the requested update", async () => {
  let updatePayload;
  const saved = runWith(street, aerial);
  const db = { update: () => ({ set: payload => {
    updatePayload = payload;
    return { where: () => ({ returning: async () => [saved] }) };
  } }) };
  const update = compile([rebindSource, extractFunction(pathwayPath, "updateRun")], "updateRun;", {
    process: { env: current }, db, propertyPathwayRuns: { id: "id" }, eq: () => true,
  });
  const result = await update("run-fixture", { propertyId: "property-fixture" });
  assert.equal(updatePayload.propertyId, "property-fixture");
  assert.equal(Object.hasOwn(updatePayload, "stageResults"), false);
  assert.equal(new URL(result.stageResults.stage1.propertyImage.streetViewUrl).searchParams.get("key"), current.VITE_GOOGLE_MAPS_API_KEY);
});

function mapFetcher(fetchStub) {
  return compile([pptxSource], "fetchStaticMapData;", {
    process: { env: { GOOGLE_API_KEY: "server-fixture", GOOGLE_MAPS_API_KEY: "map-fixture" } },
    fetch: fetchStub,
  });
}
test("PPTX downloads only an exact HTTPS Static Maps URL, injects key server-side and blocks redirects", async () => {
  let request;
  const fetchMap = mapFetcher(async (url, options) => {
    request = { url: new URL(url), options };
    return { ok: true, arrayBuffer: async () => Buffer.from("image-fixture"), headers: { get: () => "image/png" } };
  });
  const result = await fetchMap("https://maps.googleapis.com/maps/api/staticmap?center=Example&amp;key=old-fixture");
  assert.equal(request.url.hostname, "maps.googleapis.com");
  assert.equal(request.url.searchParams.get("key"), "server-fixture");
  assert.equal(request.url.searchParams.get("maptype"), "hybrid");
  assert.equal(request.options.redirect, "error");
  assert.equal(result, "data:image/png;base64," + Buffer.from("image-fixture").toString("base64"));
});
const invalidMapUrls = [
  ["suffix host", "https://maps.googleapis.com.example.com/maps/api/staticmap"],
  ["prefix host", "https://notmaps.googleapis.com/maps/api/staticmap"],
  ["HTTP", "http://maps.googleapis.com/maps/api/staticmap"],
  ["userinfo", "https://name:pass@maps.googleapis.com/maps/api/staticmap"],
  ["port", "https://maps.googleapis.com:8443/maps/api/staticmap"],
  ["other path", "https://maps.googleapis.com/maps/api/place/details/json"],
  ["trailing path", "https://maps.googleapis.com/maps/api/staticmap/extra"],
  ["invalid URL", "not a URL"],
];
for (const [label, url] of invalidMapUrls) {
  test("PPTX never injects a key or fetches a " + label + " URL", async () => {
    let calls = 0;
    const fetchMap = mapFetcher(async () => { calls++; throw new Error("must not fetch"); });
    assert.equal(await fetchMap(url), null);
    assert.equal(calls, 0);
  });
}
test("PPTX failure preserves the existing null fallback", async () => {
  const fetchMap = mapFetcher(async () => { throw new Error("redirect or request rejected"); });
  assert.equal(await fetchMap("https://maps.googleapis.com/maps/api/staticmap?center=Example"), null);
});

