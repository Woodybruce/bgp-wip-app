const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

// Revolut's published Business API vector; this is public test data.
// https://developer.revolut.com/docs/guides/manage-accounts/webhooks/verify-the-payload-signature
const timestamp = "1683650202360";
const publicTestSecret = "wsk_r59a4HfWVAKycbCaNO1RvgCJec02gRd8";
const rawBody = '{"data":{"id":"645a7696-22f3-aa47-9c74-cbae0449cc46","new_state":"completed","old_state":"pending","request_id":"app_charges-9f5d5eb3-1e06-46c5-b1c0-3914763e0bcb"},"event":"TransactionStateChanged","timestamp":"2023-05-09T16:36:38.028960Z"}';
const publishedSignature = "v1=bca326fb378d0da7f7c490ad584a8106bab9723d8d9cdd0d50b4c5b3be3837c0";

// Load only the actual verifier from the source AST. Importing revolut.ts
// would initialise the database and unrelated integrations. This test needs
// no application environment, database, provider credentials or network.
const sourcePath = path.join(__dirname, "revolut.ts");
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === "verifyWebhookSignature"
);
assert.ok(declaration, "The webhook signature verifier must exist");
const verifierJavaScript = ts.transpileModule(declaration.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function verifier(now = Number(timestamp)) {
  class TestDate extends Date {
    static now() { return now; }
  }
  return vm.runInNewContext(verifierJavaScript + "\nverifyWebhookSignature", {
    Buffer,
    crypto,
    Date: TestDate,
    console: { warn() {} },
  });
}

function request(overrides = {}) {
  return {
    headers: {
      "revolut-signature": publishedSignature,
      "revolut-request-timestamp": timestamp,
    },
    rawBody: Buffer.from(rawBody, "utf8"),
    body: JSON.parse(rawBody),
    ...overrides,
  };
}
const config = { webhookSecret: publicTestSecret };

test("accepts Revolut's published v1 signature for the exact raw buffer", () => {
  assert.equal(verifier()(request(), config), true);
});

test("accepts the same unmodified raw body as a string", () => {
  assert.equal(verifier()(request({ rawBody }), config), true);
});

test("rejects a modified payload even when parsed body is unchanged", () => {
  assert.equal(verifier()(request({ rawBody: Buffer.from(rawBody + " ") }), config), false);
});

test("rejects a signature created with the wrong webhook secret", () => {
  assert.equal(verifier()(request(), { webhookSecret: "wrong-public-test-secret" }), false);
});

test("rejects the old unversioned signing formula", () => {
  const oldSignature = crypto.createHmac("sha256", publicTestSecret)
    .update(timestamp + "." + rawBody).digest("hex");
  const req = request();
  req.headers["revolut-signature"] = "v1=" + oldSignature;
  assert.equal(verifier()(req, config), false);
});

test("accepts one valid signature among rotated-secret signatures", () => {
  const req = request();
  req.headers["revolut-signature"] = "v1=" + "0".repeat(64) + ", " + publishedSignature;
  assert.equal(verifier()(req, config), true);
});

test("rejects otherwise valid deliveries more than five minutes old or ahead", () => {
  assert.equal(verifier(Number(timestamp) + 300001)(request(), config), false);
  assert.equal(verifier(Number(timestamp) - 300001)(request(), config), false);
});

test("rejects missing signing configuration or required headers", () => {
  assert.equal(verifier()(request(), { webhookSecret: null }), false);
  const missingSignature = request();
  delete missingSignature.headers["revolut-signature"];
  assert.equal(verifier()(missingSignature, config), false);
  const missingTimestamp = request();
  delete missingTimestamp.headers["revolut-request-timestamp"];
  assert.equal(verifier()(missingTimestamp, config), false);
});

test("rejects unsupported signature versions and invalid timestamps", () => {
  const wrongVersion = request();
  wrongVersion.headers["revolut-signature"] = publishedSignature.replace("v1=", "v2=");
  assert.equal(verifier()(wrongVersion, config), false);
  const invalidTimestamp = request();
  invalidTimestamp.headers["revolut-request-timestamp"] = "not-a-timestamp";
  assert.equal(verifier()(invalidTimestamp, config), false);
});
