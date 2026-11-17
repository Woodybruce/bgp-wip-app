// The app's emails go from chatbgp.app (Woody, 17 November 2026: "just use
// chatbgp.app for all emails now"), and the mailbox readers treat the app's
// own addresses as the app's, never a person or a firm.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { isAppAddress } from "../shared/app-mailbox";
import { APP_MAILBOX, SHARED_MAILBOX, senderOrder, sendFromFirstMailbox } from "./shared-mailbox";
import { INTERNAL_DOMAIN_RE } from "./tracker-correspondence";

test("the app's emails go from chatbgp.app, then the shared mailbox", { skip: !!process.env.APP_MAILBOX }, () => {
  assert.equal(APP_MAILBOX, "chatbgp1@chatbgp.app");
  assert.equal(SHARED_MAILBOX, "chatbgp@brucegillinghampollard.com");
  assert.deepEqual(senderOrder(), ["chatbgp1@chatbgp.app", "chatbgp@brucegillinghampollard.com"]);
  assert.deepEqual(senderOrder(["kyc@chatbgp.app"]), ["kyc@chatbgp.app", "chatbgp1@chatbgp.app", "chatbgp@brucegillinghampollard.com"]);
  assert.deepEqual(senderOrder(["landsec2@chatbgp.app", "", "  "]), ["landsec2@chatbgp.app", "chatbgp1@chatbgp.app", "chatbgp@brucegillinghampollard.com"]);
  // Each address once, whatever its case.
  assert.deepEqual(senderOrder(["ChatBGP1@ChatBGP.app"]), ["ChatBGP1@ChatBGP.app", "chatbgp@brucegillinghampollard.com"]);
});

test("with Microsoft refusing every address, the send fails and names each one", async () => {
  // No Azure credentials here, so every address is refused, and none is
  // marked as refused for the hour: no other address took the email.
  const tried: string[] = [];
  await assert.rejects(
    sendFromFirstMailbox({ mailboxes: ["kyc@chatbgp.app"], to: ["someone@example.com"], build: from => { tried.push(from); return { subject: "Test", html: "<p>Test</p>" }; } }),
    /kyc@chatbgp\.app: .*; .*@chatbgp\.app: .*; chatbgp@brucegillinghampollard\.com: /,
  );
  assert.equal(tried.length, 3);
  assert.deepEqual(senderOrder(["kyc@chatbgp.app"]), tried);
});

test("the app's own addresses are never a person or a firm", () => {
  for (const address of ["chatbgp@chatbgp.app", "kyc@chatbgp.app", "Landsec@ChatBGP.app", "x@mail.chatbgp.app", "chatbgp@brucegillinghampollard.com"]) {
    assert.equal(isAppAddress(address), true, address);
  }
  for (const address of ["woody@brucegillinghampollard.com", "someone@notchatbgp.app", "x@chatbgp.app.example.com", "chatbgp.app", "", null, undefined]) {
    assert.equal(isAppAddress(address), false, String(address));
  }
  assert.equal(INTERNAL_DOMAIN_RE.test("chatbgp.app"), true);
  assert.equal(INTERNAL_DOMAIN_RE.test("mail.chatbgp.app"), true);
  assert.equal(INTERNAL_DOMAIN_RE.test("notchatbgp.app"), false);
  assert.equal(INTERNAL_DOMAIN_RE.test("brucegillinghampollard.com"), true);
  assert.equal(INTERNAL_DOMAIN_RE.test("brucegilinghampollard.com"), true);
  assert.equal(INTERNAL_DOMAIN_RE.test("knightfrank.com"), false);
});
