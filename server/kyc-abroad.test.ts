// Companies owned from abroad, traced in the app (Woody, 21 November 2026):
// the accounts' parent note read once per filing, the foreign parent it names
// joining the owners abroad only when the register names no owner, and GLEIF
// followed up the chain. GLEIF and the reader are stubbed: nothing here goes
// to the network. LEGO Company Limited (00368236) is the case: its register
// says no one has significant control, its accounts (a scan) name KIRKBI A/S.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";

process.env.GLEIF_GAP_MS = "0";

const { readAccountsParentNote, traceAbroad } = await import("./kyc-abroad");
const { traceGleif } = await import("./gleif");
const { gleifTop } = await import("../shared/foreign-owners");

const LEGO_NOTE_WORDS = "The ultimate parent undertaking and largest group to consolidate these financial statements is KIRKBI A/S, incorporated in Denmark.";
const lego = (over: Record<string, unknown> = {}): any => ({
  number: "00368236", name: "LEGO COMPANY LIMITED", status: "active", type: "ltd", incorporatedOn: "1941-07-19", registeredOffice: null, jurisdiction: "england-wales",
  sicCodes: ["46499"], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: "2025-12-31", lastAccountsType: "full",
  hasInsolvencyHistory: false, insolvencyCases: 0, officers: [], owners: [],
  statements: [{ statement: "no-individual-or-entity-with-signficant-control", words: "The company says no one has significant control over it", concern: false, notifiedOn: null }],
  listing: null, chain: [], peopleUpChain: [], offshoreOwners: [], ownersAbroad: [], disqualified: [], covenant: null,
  documents: [{ kind: "accounts", title: "LEGO accounts", filedOn: "2026-09-15", madeUpTo: "2025-12-31", kycDocumentId: "doc-acc", error: null }],
  ...over,
});
const scanReader = (calls: { n: number }) => async () => ({ input: { lines: [{ roles: ["ultimate", "largest_group"], name: "KIRKBI A/S", country: "Denmark", words: LEGO_NOTE_WORDS, page: 41 }] }, model: "test" });

test("a scanned filing is read from its pages when the register names no owner, and the reading is kept for that filing", async () => {
  const calls = { n: 0 };
  const deps = {
    file: async () => ({ data: Buffer.from("%PDF-1.4 scan") }), pdfText: async () => "", hasKey: () => true, claim: async () => { calls.n++; return true; },
    ask: scanReader(calls),
  };
  // The page subset needs a real PDF: give the reader the pages it was "sent" directly.
  const { readAccountsParentNote: read } = await import("./kyc-abroad");
  const note = await read({ documentId: "doc-acc", madeUpTo: "2025-12-31", mayScan: true, previous: null }, { ...deps, file: async () => ({ data: await tinyPdf(41) }) });
  assert.equal(note.status, "found");
  assert.equal(note.via, "scan");
  assert.equal(note.lines[0].name, "KIRKBI A/S");
  assert.equal(note.lines[0].page, 41);
  assert.equal(calls.n, 1);
  // The same filing is not read again.
  const again = await read({ documentId: "doc-acc", madeUpTo: "2025-12-31", mayScan: true, previous: note }, { ...deps, ask: async () => { throw new Error("read again"); } });
  assert.equal(again, note);
});

test("a scan is not read when the register names the owners; text is read by rules whatever the register says", async () => {
  const skipped = await readAccountsParentNote({ documentId: "d", madeUpTo: null, mayScan: false, previous: null },
    { file: async () => ({ data: Buffer.from("x") }), pdfText: async () => "", ask: async () => { throw new Error("no"); } });
  assert.equal(skipped.status, "unread");
  assert.match(skipped.unread!, /names no owner/);
  const text = await readAccountsParentNote({ documentId: "d", madeUpTo: null, mayScan: false, previous: null },
    { file: async () => ({ data: Buffer.from("x") }), pdfText: async () => `${"Notes to the accounts. ".repeat(30)}${LEGO_NOTE_WORDS}` });
  assert.equal(text.via, "text");
  assert.equal(text.lines[0].name, "KIRKBI A/S");
  const none = await readAccountsParentNote({ documentId: "d", madeUpTo: null, mayScan: true, previous: null },
    { file: async () => ({ data: Buffer.from("x") }), pdfText: async () => "Notes to the accounts. ".repeat(40) });
  assert.equal(none.status, "none");
  const capped = await readAccountsParentNote({ documentId: "d", madeUpTo: null, mayScan: true, previous: null },
    { file: async () => ({ data: await tinyPdf(3) }), pdfText: async () => "", hasKey: () => true, claim: async () => false });
  assert.match(capped.unread!, /allowance/);
});

test("traceAbroad: the accounts' ultimate parent joins the owners abroad when the register names no owner, and each is followed in GLEIF", async () => {
  const ch = lego();
  const seen: string[] = [];
  const out = await traceAbroad(ch, null, {
    note: async () => ({ documentId: "doc-acc", chDocumentId: null, madeUpTo: "2025-12-31", via: "scan", status: "found", unread: null, readAt: "2026-11-21T00:00:00Z",
      lines: [
        { roles: ["ultimate", "largest_group"], name: "KIRKBI A/S", kind: "company", country: "Denmark", words: LEGO_NOTE_WORDS, page: 41 },
        { roles: ["smallest_group"], name: "LEGO A/S", kind: "company", country: "Denmark", words: "The parent undertaking of the smallest … is LEGO A/S, incorporated in Denmark.", page: 41 },
      ] }),
    trace: async q => { seen.push(q.name); return { status: "found", entity: null, parents: [], top: gleifTop(null, "NATURAL_PERSONS"), candidates: 1, error: null }; },
  });
  assert.deepEqual(ch.ownersAbroad.map((o: any) => [o.name, o.via]), [["KIRKBI A/S", "accounts"]]);
  assert.deepEqual(seen, ["KIRKBI A/S", "LEGO A/S"]);
  assert.equal(out.traced.length, 2);
  assert.equal(out.accounts?.lines.length, 2);
});

test("traceAbroad: with owners on the register, the accounts' foreign parent is traced but does not become an owner abroad", async () => {
  const ch = lego({ owners: [{ name: "Jane Smith", kind: "individual", controls: [], notifiedOn: null }], statements: [] });
  await traceAbroad(ch, null, {
    note: async () => ({ documentId: "doc-acc", chDocumentId: null, madeUpTo: null, via: "text", status: "found", unread: null, readAt: "x",
      lines: [{ roles: ["ultimate"], name: "KIRKBI A/S", kind: "company", country: "Denmark", words: LEGO_NOTE_WORDS, page: null }] }),
    trace: async () => ({ status: "not_found", entity: null, parents: [], top: null, candidates: 0, error: null }),
  });
  assert.deepEqual(ch.ownersAbroad, []);
});

test("traceGleif follows each direct parent and reads the reason at the top, against a stubbed GLEIF", async () => {
  const rec = (lei: string, name: string, reg: string) => ({ id: lei, attributes: { lei, entity: { legalName: { name }, jurisdiction: "DK", registeredAs: reg, status: "ACTIVE", legalAddress: { country: "DK" } }, registration: { status: "ISSUED" } } });
  const CLIMATE = "636700BFY5C96VXHWP94", KIRKBI = "5493005XXPWUMR2E5305";
  const urls: string[] = [];
  const fetcher = (async (url: string) => {
    urls.push(String(url));
    const u = new URL(String(url));
    const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as any;
    if (u.pathname.endsWith("/lei-records") && u.searchParams.get("filter[entity.registeredAs]") === "45222853") return json({ data: [rec(CLIMATE, "KIRKBI Climate A/S", "45222853")] });
    if (u.pathname.endsWith(`/${CLIMATE}/direct-parent`)) return json({ data: rec(KIRKBI, "KIRKBI A/S", "18591235") });
    if (u.pathname.endsWith(`/${KIRKBI}/direct-parent`)) return json({ errors: [] }, 404);
    if (u.pathname.endsWith(`/${KIRKBI}/direct-parent-reporting-exception`)) return json({ data: { attributes: { reason: "NATURAL_PERSONS", category: "DIRECT_ACCOUNTING_CONSOLIDATION_PARENT" } } });
    return json({ data: [] });
  }) as unknown as typeof fetch;
  const t = await traceGleif({ name: "KIRKBI Climate A/S", country: "Denmark", registrationNumber: "45222853" }, fetcher);
  assert.equal(t.status, "found");
  assert.deepEqual(t.parents.map(p => p.name), ["KIRKBI A/S"]);
  assert.equal(t.top?.kind, "people");
  assert.equal(urls.length, 4);
  const failing = await traceGleif({ name: "X", country: "Denmark", registrationNumber: null }, (async () => ({ ok: false, status: 503, json: async () => ({}) })) as any);
  assert.equal(failing.status, "error");
  assert.match(failing.error!, /503/);
});

async function tinyPdf(pages: number): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}
