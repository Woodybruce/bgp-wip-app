import test from "node:test";
import assert from "node:assert/strict";
import { redactChatText, previewFor, tagIdsIn, hasBrokenTag, jointAgentThreadKind } from "./chat-joint-agent";

const ME = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const UNIT = "44444444-4444-4444-8444-444444444444";
const OTHER_UNIT = "55555555-5555-4555-8555-555555555555";
const DEAL = "66666666-6666-4666-8666-666666666666";
const CLOSED_DEAL = "77777777-7777-4777-8777-777777777777";
const BRAND = "88888888-8888-4888-8888-888888888888";
const allow = { memberIds: new Set([ME, STAFF]), unitIds: new Set([UNIT]), dealIds: new Set([DEAL]) };
const tag = (name: string, type: string, id: string) => `@[${name}](tag:${type}/${id})`;

test("a tag for a member, an own unit and a live deal is kept byte for byte", () => {
  const text = `Hi ${tag("Victoria", "user", STAFF)} see ${tag("RU9 · Westgate", "unit", UNIT)} and ${tag("Deal 12", "deal", DEAL)} today`;
  assert.equal(redactChatText(text, allow), text);
});

test("every other tag becomes a neutral word with neither its id nor its name", () => {
  const cases: Array<[string, string, string, string]> = [
    ["Dan Outsider", "user", OUTSIDER, "[someone]"],
    ["Jersey Mikes", "company", BRAND, "[a company]"],
    ["Pat Contact", "contact", BRAND, "[a contact]"],
    ["Bluewater", "property", BRAND, "[a property]"],
    ["Secret Folder", "folder", "aHR0cHM6Ly9zaGFyZXBvaW50", "[a folder]"],
    ["Unit Elsewhere", "unit", OTHER_UNIT, "[another unit]"],
    ["Old Deal", "deal", CLOSED_DEAL, "[another deal]"],
    ["Invoice Nine", "invoice", "1", "[a record]"],
    ["ChatBGP", "user", "__chatbgp__", "[someone]"],
  ];
  for (const [name, type, id, word] of cases) {
    const out = redactChatText(`before ${tag(name, type, id)} after`, allow);
    assert.equal(out, `before ${word} after`, `${type}`);
    assert.ok(!out.includes(id) && !out.includes(name), `${type} leaks`);
  }
});

test("an upper-case or mixed type is still a tag", () => {
  const out = redactChatText(`x @[Brand Co](TAG:Company/${BRAND}) y`, allow);
  assert.ok(!out.includes(BRAND) && !out.includes("Brand Co"), out);
});

test("a cut-off or mistyped tag leaves no id and no '(tag:' behind", () => {
  for (const broken of [
    `see @[Brand Co](tag:company/${BRAND}`,
    `see @[Brand Co](tag:company/${BRAND.slice(0, 9)}`,
    `see (tag:company/${BRAND}) there`,
    `see @[Brand Co](tag:company/`,
    `see @[Brand Co](tag:`,
  ]) {
    const out = redactChatText(broken, allow);
    assert.ok(!out.includes("(tag:"), out);
    assert.ok(!out.includes(BRAND.slice(0, 9)), out);
    assert.ok(!out.includes("Brand Co"), out);
  }
});

test("plain typed words are not changed, and a non-string gives nothing", () => {
  assert.equal(redactChatText("Rent is £120k, email me at a@b.com (see above)", allow), "Rent is £120k, email me at a@b.com (see above)");
  for (const v of [null, undefined, 5, {}, ["x"]]) assert.equal(redactChatText(v, allow), "");
});

test("the preview is redacted before it is cut", () => {
  for (let start = 40; start <= 79; start++) {
    const text = "x".repeat(start) + tag("Jersey Mikes Subs Limited", "company", BRAND) + " and more words after it";
    const out = previewFor(text, allow);
    assert.ok(!out.includes("(tag:") && !out.includes("tag:") && !out.includes(BRAND.slice(0, 6)) && !out.includes("Jersey"), `${start}: ${out}`);
  }
  // A kept tag that the cut would split is dropped whole, never left as half.
  for (let start = 30; start <= 79; start++) {
    const text = "y".repeat(start) + tag("RU9", "unit", UNIT) + " tail";
    const out = previewFor(text, allow);
    assert.ok(out.includes(tag("RU9", "unit", UNIT)) || (!out.includes("(tag") && !out.includes("@[") && !out.includes(UNIT.slice(0, 6))), `${start}: ${out}`);
  }
  assert.equal(previewFor("short", allow), "short");
  assert.equal(previewFor(null, allow), "");
});

test("the ids in a message, by kind", () => {
  const ids = tagIdsIn(`${tag("A", "user", STAFF)} ${tag("B", "unit", UNIT)} ${tag("C", "deal", DEAL)} ${tag("D", "company", BRAND)} ${tag("E", "invoice", "9")}`);
  assert.deepEqual(ids.users, [STAFF]);
  assert.deepEqual(ids.units, [UNIT]);
  assert.deepEqual(ids.deals, [DEAL]);
  assert.deepEqual(ids.other, [{ type: "company", id: BRAND }, { type: "invoice", id: "9" }]);
  assert.equal(hasBrokenTag(`@[x](tag:company/${BRAND}`), true);
  assert.equal(hasBrokenTag(`fine ${tag("B", "unit", UNIT)}`), false);
});

test("the two kinds of conversation a joint agent may hold", () => {
  const team = { createdBy: STAFF, isAiChat: false, hasAiMember: false, propertyId: null, linkedType: null, linkedId: null };
  assert.equal(jointAgentThreadKind(team, [STAFF, ME], ME), "team");
  assert.equal(jointAgentThreadKind({ ...team, createdBy: ME }, [], ME), "team");
  // Woody, 13 November 2026 ("Relax all of those"): ChatBGP may be in a
  // conversation with a joint agent; it answers there as the joint agent.
  assert.equal(jointAgentThreadKind({ ...team, hasAiMember: true }, [STAFF, ME], ME), "team");
  assert.equal(jointAgentThreadKind({ ...team, hasAiMember: true, propertyId: "p1" }, [STAFF, ME], ME), null);
  assert.equal(jointAgentThreadKind({ ...team, propertyId: "p1" }, [STAFF, ME], ME), null);
  assert.equal(jointAgentThreadKind({ ...team, linkedType: "deal" }, [STAFF, ME], ME), null);
  assert.equal(jointAgentThreadKind({ ...team, linkedId: "x" }, [STAFF, ME], ME), null);
  assert.equal(jointAgentThreadKind({ ...team, linkedType: "channel", linkedId: "gossip" }, [STAFF, ME], ME), null);
  assert.equal(jointAgentThreadKind(team, [STAFF], ME), null, "not a member");
  assert.equal(jointAgentThreadKind({ ...team, isAiChat: null }, [STAFF, ME], ME), null, "kind unknown");
  const ai = { createdBy: ME, isAiChat: true, hasAiMember: false };
  assert.equal(jointAgentThreadKind(ai, [], ME), "own_ai");
  assert.equal(jointAgentThreadKind(ai, [ME], ME), "own_ai");
  assert.equal(jointAgentThreadKind(ai, [ME, STAFF], ME), null, "somebody else is in it");
  assert.equal(jointAgentThreadKind({ ...ai, createdBy: STAFF }, [ME], ME), null, "somebody else's chat");
  assert.equal(jointAgentThreadKind(null, [], ME), null);
  assert.equal(jointAgentThreadKind(team, [ME], ""), null);
});
