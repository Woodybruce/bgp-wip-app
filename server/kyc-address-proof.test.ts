// A proof of address read and set against the person it is for (Woody,
// 20 November 2026: "with the proof of address is the app checking its
// actually for that person and acceptable? linking it from a name
// perspective?"). Rules: shared/kyc-address-proof.ts; reader:
// server/kyc-address-proof.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  addressNameMatches, addressProofExpiry, checkAddressProof, cleanAddressProofReading, unreadableAddressProof, type AddressProofReading,
} from "../shared/kyc-address-proof";
import { addressProofParts, readAddressProof } from "./kyc-address-proof";

const bill = (over: Partial<AddressProofReading> = {}): AddressProofReading => ({
  readAt: "2026-11-20T09:00:05Z", read: true, unreadable: null, kind: "utility_bill", kindWords: "British Gas electricity bill", issuer: "British Gas",
  names: ["MR H MIRHADIYEV"], date: "2026-10-12", address: "1 Example Road, London W1", certified: null, ...over,
});
const SENT = "2026-11-20T09:00:00Z";

test("a name on a document is the person's: the register's way, or the same surname with their forenames or initials", () => {
  assert.equal(addressNameMatches("MR H MIRHADIYEV", "MIRHADIYEV, Huseyn"), true);
  assert.equal(addressNameMatches("Huseyn Mirhadiyev", "Mr Huseyn Mirhadiyev"), true);
  assert.equal(addressNameMatches("MR WOODY BRUCE", "BRUCE, Woody"), true);
  assert.equal(addressNameMatches("Mr J A Smith", "SMITH, John Andrew"), true);
  assert.equal(addressNameMatches("CHARLOTTE C ROBERTS", "ROBERTS, Charlotte Caroline"), true);
  // A surname alone, another forename, another initial or another surname is not them.
  assert.equal(addressNameMatches("MR MIRHADIYEV", "MIRHADIYEV, Huseyn"), false);
  assert.equal(addressNameMatches("Jane Smith", "SMITH, John"), false);
  assert.equal(addressNameMatches("Mr K Smith", "SMITH, John"), false);
  assert.equal(addressNameMatches("Mr J Brown", "SMITH, John"), false);
  assert.equal(addressNameMatches("", "SMITH, John"), false);
});

test("the verdict: their name, dated in the last three months, a kind the policy accepts", () => {
  assert.deepEqual(checkAddressProof(bill(), "MIRHADIYEV, Huseyn", SENT),
    { ok: true, reasons: [], summary: "British Gas electricity bill, 12 Oct 2026, in the name of MR H MIRHADIYEV" });
  // Joint names: theirs is named in the summary.
  assert.equal(checkAddressProof(bill({ names: ["MRS A MIRHADIYEVA", "MR H MIRHADIYEV"] }), "MIRHADIYEV, Huseyn", SENT).summary,
    "British Gas electricity bill, 12 Oct 2026, in the name of MR H MIRHADIYEV");
  assert.deepEqual(checkAddressProof(bill({ names: ["Jane Smith"] }), "MIRHADIYEV, Huseyn", SENT).reasons, ["In the name of Jane Smith, not Huseyn Mirhadiyev"]);
  assert.deepEqual(checkAddressProof(bill({ names: [] }), "MIRHADIYEV, Huseyn", SENT).reasons, ["No name found on it"]);
  assert.deepEqual(checkAddressProof(bill({ date: "2026-08-01" }), "MIRHADIYEV, Huseyn", SENT).reasons, ["Dated 1 Aug 2026, more than three months before it was sent"]);
  assert.deepEqual(checkAddressProof(bill({ date: null }), "MIRHADIYEV, Huseyn", SENT).reasons, ["No date found on it"]);
  assert.deepEqual(checkAddressProof(bill({ date: "2026-12-25" }), "MIRHADIYEV, Huseyn", SENT).reasons, ["Dated 25 Dec 2026, after it was sent"]);
  // Three months is 92 days: 20 August counts on 20 November, 19 August does not.
  assert.equal(checkAddressProof(bill({ date: "2026-08-20" }), "MIRHADIYEV, Huseyn", SENT).ok, true);
  assert.equal(checkAddressProof(bill({ date: "2026-08-19" }), "MIRHADIYEV, Huseyn", SENT).ok, false);
  // This year's council tax bill counts though it came in March.
  assert.equal(checkAddressProof(bill({ kind: "council_tax_bill", kindWords: "Council Tax bill 2026/27", date: "2026-03-10" }), "MIRHADIYEV, Huseyn", SENT).ok, true);
  assert.equal(checkAddressProof(bill({ kind: "council_tax_bill", kindWords: null, date: "2025-03-10" }), "MIRHADIYEV, Huseyn", SENT).reasons[0],
    "Dated 10 Mar 2025, more than a year before it was sent");
  // A photocard driving licence showing the address counts while in date
  // (HMRC AMLG11400 14.2: ID evidence, one document or more; 25 November 2026).
  assert.equal(checkAddressProof(bill({ kind: "driving_licence", kindWords: "DVLA licence", date: "2018-01-01", expires: "2028-01-01" }), "MIRHADIYEV, Huseyn", SENT).ok, true);
  assert.deepEqual(checkAddressProof(bill({ kind: "driving_licence", kindWords: "DVLA licence" }), "MIRHADIYEV, Huseyn", SENT).reasons, ["No expiry date found: check it is in date"]);
  assert.deepEqual(checkAddressProof(bill({ kind: "driving_licence", kindWords: "DVLA licence", expires: "2026-11-01" }), "MIRHADIYEV, Huseyn", SENT).reasons, ["It expired on 1 Nov 2026"]);
  // Not on the list.
  assert.deepEqual(checkAddressProof(bill({ kind: "other", kindWords: "Tenancy agreement" }), "MIRHADIYEV, Huseyn", SENT).reasons, ["Not one of the documents the policy accepts (Tenancy agreement)"]);
  // Not read, or not readable.
  assert.deepEqual(checkAddressProof(null, "MIRHADIYEV, Huseyn", SENT), { ok: false, reasons: ["Not read yet"], summary: "Not read yet" });
  assert.deepEqual(checkAddressProof(unreadableAddressProof("the file is empty", SENT), "MIRHADIYEV, Huseyn", SENT).reasons, ["Could not be read: the file is empty"]);
});

test("a reader's answer is kept only as the fields named, each the right type", () => {
  const clean = cleanAddressProofReading({
    kind: "utility_bill", kindWords: "  British   Gas bill ", names: ["MR H MIRHADIYEV", 7, "", "A", "B", "C", "D"], date: "2026-10-12",
    address: "1 Example Road", certified: "yes", issuer: null, extra: "ignored",
  }, SENT);
  assert.equal(clean.kindWords, "British Gas bill");
  assert.deepEqual(clean.names, ["MR H MIRHADIYEV", "A", "B", "C"]);
  assert.equal(clean.certified, null);
  assert.equal((clean as any).extra, undefined);
  assert.equal(cleanAddressProofReading({ kind: "passport", date: "12/10/2026" }, SENT).kind, null);
  assert.equal(cleanAddressProofReading({ kind: "passport", date: "12/10/2026" }, SENT).date, null);
  assert.equal(cleanAddressProofReading(null, SENT).read, true);
});

test("what the reader is sent: a PDF as a document, a picture as a JPEG, an empty file never", async () => {
  const pdf = await addressProofParts({ buffer: Buffer.from("%PDF-1.4\n%fake"), mime: "application/pdf", name: "bill.pdf" });
  assert.ok("parts" in pdf && pdf.parts[0].type === "document");
  assert.deepEqual(await addressProofParts({ buffer: Buffer.alloc(0), mime: "application/pdf", name: "bill.pdf" }), { unreadable: "the file is empty" });
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const pic = await addressProofParts({ buffer: png, mime: "image/png", name: "bill.png" });
  assert.ok("parts" in pic && pic.parts[0].type === "image" && pic.parts[0].source.media_type === "image/jpeg");
  assert.deepEqual(await addressProofParts({ buffer: Buffer.from("not a picture"), mime: "image/jpeg", name: "bill.jpg" }), { unreadable: "the picture could not be opened" });
});

test("the reader never throws, says why it could not read, and spends only on a file it can read", async () => {
  const file = { buffer: Buffer.from("%PDF-1.4\n%fake"), mime: "application/pdf", name: "bill.pdf" };
  const now = () => new Date(SENT);
  let claims = 0;
  const claim = async () => { claims++; return true; };
  assert.equal((await readAddressProof(file, { hasKey: () => false, claim, now })).unreadable, "the reader is not switched on");
  assert.equal((await readAddressProof({ ...file, buffer: Buffer.alloc(0) }, { hasKey: () => true, claim, now })).unreadable, "the file is empty");
  assert.equal(claims, 0, "nothing claimed for a file that cannot be read");
  assert.match(String((await readAddressProof(file, { hasKey: () => true, claim: async () => false, now })).unreadable), /allowance/);
  let sent: any[] = [];
  const ok = await readAddressProof(file, { hasKey: () => true, claim, now, ask: async (_system, parts) => { sent = parts; return { input: { kind: "utility_bill", names: ["MR H MIRHADIYEV"], date: "2026-10-12" }, model: "m" }; } });
  assert.equal(ok.read, true);
  assert.deepEqual(ok.names, ["MR H MIRHADIYEV"]);
  // The file alone: never the name it is meant to show.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "document");
  assert.equal((await readAddressProof(file, { hasKey: () => true, claim, now, ask: async () => { throw new Error("down"); } })).unreadable, "the reader failed; read it again later");
  assert.equal((await readAddressProof(file, { hasKey: () => true, claim, now, ask: async () => ({ input: null, model: "m" }) })).unreadable, "the reader gave no answer");
});

test("a proof of address goes out of date three months on (a council tax bill a year), a licence when its photocard expires", () => {
  assert.equal(addressProofExpiry(bill({ date: "2026-10-30" })), "2027-01-30");
  assert.equal(addressProofExpiry(bill({ kind: "council_tax_bill", date: "2026-04-01" })), "2027-05-02");
  // A licence's issue date says nothing about the address: the card's own expiry does (25 November 2026).
  assert.equal(addressProofExpiry(bill({ kind: "driving_licence", date: "2019-03-01", expires: "2029-03-01" })), "2029-03-01");
  assert.equal(addressProofExpiry(bill({ kind: "driving_licence", date: "2019-03-01", expires: null })), null);
});
