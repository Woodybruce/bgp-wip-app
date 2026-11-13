import test from "node:test";
import assert from "node:assert/strict";
import {
  readEmailContactDetails, splitThread, emailBodyText, nameIsPerson, checkModelAnswer,
  type ContactReaderDeps,
} from "./email-contact-reader";

// No model: the rules alone. A test that needs the model passes its own deps.
const noModel: ContactReaderDeps = {
  hasKey: () => false,
  claim: async () => { throw new Error("the model must not be claimed"); },
  call: async () => { throw new Error("the model must not be called"); },
  log: () => {},
};

const AGENT = { email: "priya.shah@kanepartners.co.uk", name: "Priya Shah" };
const LANDLORD = { email: "omar.reid@northgate-estates.co.uk", name: "Omar Reid" };
const BGP = { email: "charlotte@brucegillinghampollard.com", name: "Charlotte Roberts" };
const TOM = { email: "tom.ward@bakehouse.co.uk", name: "Tom Ward" };
const SAM = { email: "sam.jones@bakehouse.co.uk", name: "Sam Jones" };

test("a plain signature on the email itself is read by rules", async () => {
  const body = [
    "Hi Charlotte,",
    "",
    "Please see the unit addresses attached.",
    "",
    "Kind regards,",
    "",
    "Priya Shah",
    "Senior Surveyor",
    "Kane Partners LLP",
    "T: 020 7946 0143",
    "M: 07700 900123",
    "priya.shah@kanepartners.co.uk",
    "",
    "This email and any attachments are confidential.",
  ].join("\n");
  const out = await readEmailContactDetails({ body, from: AGENT, people: [AGENT, BGP, TOM] }, noModel);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    email: AGENT.email, title: "Senior Surveyor", phone: "020 7946 0143", mobile: "07700 900123",
    company: "Kane Partners LLP", where: "message", how: "rules",
  });
});

test("a signature only in the quoted part goes to the person who wrote that quoted message", async () => {
  const body = [
    "Thanks Tom, bringing Charlotte in.",
    "",
    "Priya",
    "",
    "From: Tom Ward <tom.ward@bakehouse.co.uk>",
    "Sent: 05 October 2026 16:02",
    "To: Priya Shah <priya.shah@kanepartners.co.uk>",
    "Cc: Sam Jones <sam.jones@bakehouse.co.uk>",
    "Subject: RE: City Tower - Retail Units",
    "",
    "Priya, the addresses we hold are below.",
    "",
    "Regards",
    "Tom Ward",
    "Group Property Manager",
    "Bakehouse Ltd",
    "Direct: 0191 496 0101",
    "Mobile: 07700 900456",
  ].join("\n");
  const out = await readEmailContactDetails({ body, from: AGENT, people: [AGENT, BGP, TOM, SAM] }, noModel);
  assert.equal(out.length, 1, "only the quoted writer has a signature");
  assert.deepEqual(out[0], {
    email: TOM.email, title: "Group Property Manager", phone: "0191 496 0101", mobile: "07700 900456",
    company: "Bakehouse Ltd", where: "quoted", how: "rules",
  });
});

test("two people in one thread each keep their own details", async () => {
  const body = [
    "<html><body><div>Charlotte, see below.</div>",
    "<div>Kind regards,</div>",
    "<div>Omar Reid</div><div>Asset Manager</div><div>Northgate Estates Limited</div>",
    "<div>D: +44 (0)20 7946 0888 | M: +44 7700 900777</div>",
    "<hr>",
    "<div><b>From:</b> Tom Ward &lt;tom.ward@bakehouse.co.uk&gt;<br>",
    "<b>Sent:</b> Monday, October 5, 2026 9:15 AM<br>",
    "<b>To:</b> Omar Reid &lt;omar.reid@northgate-estates.co.uk&gt;<br>",
    "<b>Subject:</b> City Tower</div>",
    "<div>Omar, we are keen on unit 4.</div>",
    "<div>Thanks,</div>",
    "<div>Tom Ward | Group Property Manager</div>",
    "<div>Tel: 0191 496 0101</div>",
    "</body></html>",
  ].join("\n");
  const out = await readEmailContactDetails({ body, from: LANDLORD, people: [LANDLORD, BGP, TOM, SAM] }, noModel);
  const omar = out.find(p => p.email === LANDLORD.email);
  const tom = out.find(p => p.email === TOM.email);
  assert.equal(out.length, 2);
  assert.equal(omar?.title, "Asset Manager");
  assert.equal(omar?.phone, "+44 (0)20 7946 0888");
  assert.equal(omar?.mobile, "+44 7700 900777");
  assert.equal(omar?.where, "message");
  assert.equal(tom?.title, "Group Property Manager");
  assert.equal(tom?.phone, "0191 496 0101");
  assert.equal(tom?.mobile, null, "Omar's mobile is never given to Tom");
  assert.equal(tom?.where, "quoted");
});

test("a person who was only copied, with no signature anywhere, gets nothing", async () => {
  const body = [
    "Hi Charlotte, I have copied Sam Jones and Tom Ward at Bakehouse so they can confirm.",
    "Sam Jones is their estates lead. Call me on 020 7946 0143.",
    "",
    "Kind regards,",
    "Priya Shah",
    "Senior Surveyor",
    "T: 020 7946 0143",
  ].join("\n");
  const out = await readEmailContactDetails({ body, from: AGENT, people: [AGENT, BGP, TOM, SAM], wanted: [SAM.email, TOM.email] }, noModel);
  assert.deepEqual(out, []);
});

test("a quoted message whose writer is not on this email, or cannot be told apart, is dropped", async () => {
  const body = [
    "See below.",
    "",
    "From: Jones, Sam",
    "Sent: 01 October 2026 10:00",
    "To: Priya Shah",
    "Subject: units",
    "",
    "Regards",
    "Sam Jones",
    "Estates Director",
    "M: 07700 900999",
  ].join("\n");
  const twoSams = [AGENT, BGP, SAM, { email: "sam.jones@otherfirm.com", name: "Sam Jones" }];
  assert.deepEqual(await readEmailContactDetails({ body, from: AGENT, people: twoSams }, noModel), [],
    "two people answer to the name: neither is given the block");
  const one = await readEmailContactDetails({ body, from: AGENT, people: [AGENT, BGP, SAM] }, noModel);
  assert.equal(one.length, 1);
  assert.equal(one[0].email, SAM.email);
  assert.equal(one[0].title, "Estates Director");
  assert.equal(one[0].mobile, "07700 900999");
});

test("Gmail-style quoting and '>' prefixes are split by writer", () => {
  const text = emailBodyText([
    "Fine by me.",
    "",
    "On Mon, 5 Oct 2026 at 09:15, Tom Ward <tom.ward@bakehouse.co.uk> wrote:",
    "> We are keen.",
    "> Thanks,",
    "> Tom Ward",
    "> Group Property Manager",
  ].join("\n"));
  const parts = splitThread(text, AGENT);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].senderEmail, TOM.email);
  assert.equal(parts[1].quoted, true);
  assert.ok(parts[1].lines.includes("Group Property Manager"));
});

test("names are matched to people strictly", () => {
  assert.equal(nameIsPerson("Whitehead, Toby (Greggs)", { email: "toby.whitehead@greggs.co.uk" }), true);
  assert.equal(nameIsPerson("Toby Whitehead", { email: "twhitehead@greggs.co.uk" }), true);
  assert.equal(nameIsPerson("Steven Jones", { email: "toby.whitehead@greggs.co.uk", name: "Toby Whitehead" }), false);
  assert.equal(nameIsPerson("Toby", { email: "toby.whitehead@greggs.co.uk" }), false);
});

test("the model reads a block the rules could not, and only values in that person's own block are kept", async () => {
  const body = [
    "All noted.",
    "",
    "Best",
    "Tom Ward",
    "Looking after property across the North East",
    "Bakehouse",
    "Reach me: 0191 496 0101",
  ].join("\n");
  let asked = "";
  const deps: ContactReaderDeps = {
    hasKey: () => true,
    claim: async () => true,
    call: async (_system, user) => {
      asked = user;
      return {
        model: "test-model",
        text: JSON.stringify([
          { email: TOM.email, title: "Looking after property across the North East", phone: "0191 496 0101", mobile: "07700 900000", company: "Greggs plc" },
          { email: SAM.email, title: "Estates Director", phone: "0191 496 0101", mobile: null, company: null },
        ]),
      };
    },
    log: () => {},
  };
  const out = await readEmailContactDetails({ body, from: TOM, people: [TOM, BGP, SAM] }, deps);
  assert.ok(asked.includes("Reach me: 0191 496 0101"));
  assert.ok(!asked.includes("All noted"), "the model is given the signature text, not the message");
  assert.equal(out.length, 1, "nothing is kept for a person with no block of their own");
  assert.equal(out[0].email, TOM.email);
  assert.equal(out[0].title, "Looking after property across the North East");
  assert.equal(out[0].phone, "0191 496 0101");
  assert.equal(out[0].mobile, null, "a number that is not in the block is dropped");
  assert.notEqual(out[0].company, "Greggs plc", "an employer that is not in the block is dropped");
});

test("with no key, or the day's allowance used, the model is not called", async () => {
  const body = "Best\nTom Ward\nLooking after property across the North East\nReach me: 0191 496 0101";
  let calls = 0;
  const call = async () => { calls++; return { text: "[]", model: "m" }; };
  await readEmailContactDetails({ body, from: TOM, people: [TOM] }, { hasKey: () => false, claim: async () => true, call, log: () => {} });
  await readEmailContactDetails({ body, from: TOM, people: [TOM] }, { hasKey: () => true, claim: async () => false, call, log: () => {} });
  assert.equal(calls, 0);
});

test("a model answer is checked against the block", () => {
  const block = "Tom Ward\nHead of Estates\nFax: 0191 496 0199\nT 0191 496 0101";
  assert.deepEqual(checkModelAnswer({ title: "Head of Estates", phone: "0191 496 0199", mobile: null, company: "Bakehouse" }, block),
    { title: "Head of Estates", phone: null, mobile: null, company: null });
  assert.equal(checkModelAnswer({ phone: "0191 496 0101" }, block).phone, "0191 496 0101");
});

test("a short first name in the signature is still that person; a colleague signing for them is not", async () => {
  const steven = { email: "steven.jones@bakehouse.co.uk", name: "Steven Jones" };
  const own = "Noted.\n\nRegards\nSteve Jones\nEstates Manager\nM: 07700 900321";
  const a = await readEmailContactDetails({ body: own, from: steven, people: [steven, BGP] }, noModel);
  assert.equal(a[0]?.title, "Estates Manager");
  assert.equal(a[0]?.mobile, "07700 900321");

  const onBehalf = "Noted.\n\nKind regards,\nJane Doe (on behalf of Steven Jones)\nOffice Manager\nT: 0191 496 0555";
  assert.deepEqual(await readEmailContactDetails({ body: onBehalf, from: steven, people: [steven, BGP] }, noModel), [],
    "a block that does not carry the writer's name is not read");

  const noName = "Noted.\n\nRegards\nEstates Manager\nM: 07700 900321";
  assert.deepEqual(await readEmailContactDetails({ body: noName, from: steven, people: [steven, BGP] }, noModel), []);
});

test("a block stops where somebody else's message or name begins", async () => {
  const body = [
    "Agreed.",
    "",
    "Thanks,",
    "Tom Ward",
    "Group Property Manager",
    "",
    "Sam Jones",
    "Estates Director",
    "M: 07700 900999",
  ].join("\n");
  const out = await readEmailContactDetails({ body, from: TOM, people: [TOM, SAM, BGP] }, noModel);
  assert.equal(out.length, 1);
  assert.equal(out[0].email, TOM.email);
  assert.equal(out[0].title, "Group Property Manager");
  assert.equal(out[0].mobile, null, "the number under Sam's name is not Tom's");

  const second = "Ok.\n\nTom Ward\nGroup Property Manager\nBegin forwarded message:\nplease ring\nM: 07700 900111";
  const b = await readEmailContactDetails({ body: second, from: TOM, people: [TOM, BGP] }, noModel);
  assert.equal(b[0]?.mobile, null);
  assert.equal(b[0]?.title, "Group Property Manager");
});

test("rulesOnly keeps a person's block away from the model, and onModel reports who was asked", async () => {
  const body = "Best\nTom Ward\nLooking after property across the North East\nReach me: 0191 496 0101";
  let calls = 0; const asked: string[] = [];
  const deps: ContactReaderDeps = { hasKey: () => true, claim: async () => true, call: async () => { calls++; return { text: "[]", model: "m" }; }, log: () => {} };
  await readEmailContactDetails({ body, from: TOM, people: [TOM], rulesOnly: [TOM.email] }, deps);
  assert.equal(calls, 0);
  await readEmailContactDetails({ body, from: TOM, people: [TOM], onModel: e => asked.push(...e) }, deps);
  assert.equal(calls, 1);
  assert.deepEqual(asked, [TOM.email]);
});
