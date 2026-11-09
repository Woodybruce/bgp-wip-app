import test from "node:test";
import assert from "node:assert/strict";
import {
  getCompanyFinancingEvidence, readFinancingInstrument, normalizeFinancingCompanyNumber,
  financingFilingPath, financingCreationFiling, financingDocumentId, allowedFinancingDocumentUrl,
  fetchFinancingPdf, financingSecurityKinds, transcribeFinancingPages, type FinancingDependencies,
} from "../../server/company-financing";

const number = "11473397";
const title = "NGL813653";
const pdf = Buffer.from("%PDF-fixture");
const quote = "Facility Agreement dated 30 April 2026: a loan facility in a maximum aggregate amount of £8,300,000. This is the facility limit, not the amount currently drawn.";
const property = "Assignment of Insurances. Property means Royal Exchange, London registered under title number NGL813653. Borrower: Royex Real Estate Investments Ltd. Lender: Example Lending SARL.";
function charge(index: number, overrides: any = {}) {
  return {
    charge_code: `${number}${String(index).padStart(4, "0")}`, status: "outstanding", created_on: "2026-04-30",
    links: { self: `/company/${number}/charges/charge-${index}` },
    persons_entitled: [{ name: "Example Lending SARL" }],
    transactions: [
      { filing_type: "satisfy-charge", links: { filing: `/company/${number}/filing-history/release-${index}` } },
      { filing_type: "create-charge-with-deed", links: { filing: `/company/${number}/filing-history/filing-${index}` } },
    ], ...overrides,
  };
}
function fixture(options: { count?: number; pageCount?: number; ocrFailure?: boolean; wrongCompany?: boolean; amounts?: boolean; longText?: boolean } = {}) {
  const cache = new Map<string, Buffer>();
  const calls: any[] = [];
  let status = "outstanding";
  const count = options.count ?? 2;
  const deps: FinancingDependencies = {
    async api(path) {
      calls.push(["api", path]);
      if (path === `/company/${number}`) return { company_number: options.wrongCompany ? "99999999" : number, company_name: "Royex Real Estate Investments Ltd", company_status: "active" };
      if (path.includes("/charges?")) {
        const start = Number(new URL(`https://example.invalid${path}`).searchParams.get("start_index"));
        return { total_count: count, items: Array.from({ length: Math.min(100, count - start) }, (_, i) => charge(start + i + 1, { status })) };
      }
      if (path.includes("/filing-history/filing-")) return { links: { document_metadata: `https://frontend-doc-api.company-information.service.gov.uk/document/doc-${path.match(/filing-(\d+)$/)?.[1]}` } };
      throw new Error(`Unexpected path ${path}`);
    },
    async pdf(id) { calls.push(["pdf", id]); return pdf; },
    async text() {
      const pageCount = options.pageCount ?? 8;
      return { pageCount, pages: Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, text: i === 0 ? "Companies House registration of charge. ".repeat(8) : "" })) };
    },
    async vision(_bytes, pages) {
      calls.push(["vision", pages]);
      if (options.ocrFailure) throw new Error("Provider unavailable");
      return pages.map(page => ({ page, text: page === 5 ? quote : page === 6 ? property : options.longText ? "Security definitions and supporting terms. ".repeat(250) : "" }));
    },
    async cacheGet(key) { return cache.get(key) || null; },
    async cachePut(key, value) { cache.set(key, value); },
    now: () => Date.parse("2026-09-30T12:00:00Z"),
  };
  return { deps, calls, cache, setStatus(value: string) { status = value; } };
}

test("scanned pages 5–6 are read despite a digital registration cover; figures and exact title retain PDF page citations", async () => {
  const f = fixture();
  const result = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  assert.equal(result.company.number, number);
  assert.equal(result.coverage.documentsRead, 2);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.outstandingBalance, null);
  for (const item of result.charges) {
    assert.equal(item.instrument.propertyTitleMatch, "explicit_title_in_instrument");
    assert.deepEqual(item.instrument.propertyTitlePages, [6]);
    assert.equal(item.instrument.evidence.find((p: any) => p.page === 5).text, quote);
    assert.ok(item.securityKinds.includes("insurance"));
    assert.equal(item.outstandingBalance, null);
    assert.match(item.instrument.filingUrl, /\/document\?format=pdf&download=0$/);
  }
  assert.ok(!f.calls.some(call => String(call[1]).includes("release-")), "Must read the creation deed, not its later satisfaction filing");
  assert.match(result.warnings.join(" "), /do not add facility amounts together/);
  assert.match(result.warnings.join(" "), /does not establish a registered mortgage/);
});

test("single-image OCR assigns PDF page 5/6 on the server and ignores printed or model-returned page 3/4", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const result = await transcribeFinancingPages(pdf, [5, 6, 7, 8], {
    async render(_bytes, page) { return `data:image/jpeg;base64,page-${page}`; },
    async complete(content) {
      assert.equal(content.filter(part => part.type === "image_url").length, 1);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      const inputPage = Number(content[1].image_url.url.match(/page-(\d+)$/)[1]);
      return JSON.stringify({ page: inputPage - 2, text: inputPage === 5 ? quote : inputPage === 6 ? property : "" });
    },
  });
  assert.deepEqual(result, [{ page: 5, text: quote }, { page: 6, text: property }, { page: 7, text: "" }, { page: 8, text: "" }]);
  assert.equal(maxInFlight, 2);
});

test("one failed page cannot discard successful sibling evidence or masquerade as an empty page", async () => {
  const f = fixture({ count: 1 });
  f.deps.vision = async (bytes, pages) => transcribeFinancingPages(bytes, pages, {
    async render(_bytes, page) { return `page-${page}`; },
    async complete(content) {
      if (content[1].image_url.url === "page-5") throw new Error("OCR timeout");
      return JSON.stringify({ page: 99, text: content[1].image_url.url === "page-6" ? property : "" });
    },
  });
  const result = await readFinancingInstrument(pdf, f.deps);
  assert.deepEqual(result.unreadPages, [5]);
  assert.equal(result.retryable, true);
  assert.equal(result.pages.find(page => page.page === 6)?.text, property);
});

test("v1 OCR with unreliable model-supplied page numbers is not reused", async () => {
  const f = fixture({ count: 1 });
  const cacheRoot = `ch-financing/${number}/doc-1`;
  f.cache.set(`${cacheRoot}-v1.json`, Buffer.from(JSON.stringify({
    version: "v1", companyNumber: number, documentId: "doc-1",
    read: { pageCount: 8, pages: [{ page: 3, text: quote, method: "vision" }, { page: 4, text: property, method: "vision" }], unreadPages: [], retryable: false },
  })));
  const result = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  assert.equal(result.charges[0].instrument.cached, false);
  assert.deepEqual(result.charges[0].instrument.propertyTitlePages, [6]);
  assert.equal(result.charges[0].instrument.evidence.find((page: any) => page.text === quote).page, 5);
  assert.ok(f.cache.has(`${cacheRoot}-v2.json`));
});

test("immutable document evidence is reused but charge status is fetched fresh for every colleague", async () => {
  const f = fixture();
  await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  const paidModelCalls = f.calls.filter(c => c[0] === "vision").length;
  f.setStatus("fully-satisfied");
  const result = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: "NGL814693" }, f.deps);
  assert.equal(f.calls.filter(c => c[0] === "vision").length, paidModelCalls);
  assert.equal(f.calls.filter(c => c[0] === "pdf").length, 2);
  assert.equal(result.charges[0].status, "fully-satisfied");
  assert.equal(result.charges[0].instrument.cached, true);
  assert.equal(result.charges[0].instrument.propertyTitleMatch, "not_found_in_read_pages");
});

test("31-page scanned instruments disclose unread pages and reuse their bounded OCR instead of charging for the same pages again", async () => {
  const f = fixture({ count: 1, pageCount: 31 });
  const first = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  assert.equal(first.coverage.complete, false);
  assert.equal(first.charges[0].instrumentStatus, "partially_read");
  assert.deepEqual(first.charges[0].instrument.unreadPages, Array.from({ length: 18 }, (_, i) => i + 10));
  assert.equal(f.calls.filter(c => c[0] === "vision").length, 3);
  const next = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  assert.equal(next.charges[0].instrument.cached, true);
  assert.equal(next.coverage.complete, false);
  assert.equal(f.calls.filter(c => c[0] === "vision").length, 3);
});

test("bounded OCR reads property schedules at the end of long deeds as well as the facility recitals", async () => {
  const f = fixture({ count: 1, pageCount: 31 });
  f.deps.vision = async (_bytes, pages) => pages.map(page => ({ page, text: page === 31 ? property : page === 5 ? quote : "" }));
  const result = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  assert.deepEqual(result.charges[0].instrument.propertyTitlePages, [31]);
  assert.ok(result.charges[0].instrument.evidence.some((page: any) => page.page === 5 && page.text.includes("£8,300,000")));
  assert.equal(result.coverage.complete, false);
});

test("OCR outages retain cover evidence, report unread pages, and do not persist a failed interpretation", async () => {
  const f = fixture({ count: 1, ocrFailure: true });
  const result = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.charges[0].instrumentStatus, "partially_read");
  assert.equal(result.charges[0].instrument.propertyTitleMatch, "not_found_in_read_pages");
  assert.equal(result.charges[0].instrument.unreadPages.length, 7);
  assert.ok([...f.cache.keys()].every(key => key.endsWith(".pdf")));
  assert.match(result.warnings.join(" "), /must not be reported as evidence of no debt/);
});

test("four-document cap applies to failed attempts as well as successful reads", async () => {
  const f = fixture({ count: 8 });
  f.deps.pdf = async () => { throw new Error("Unavailable"); };
  const result = await getCompanyFinancingEvidence({ companyNumber: number, maxDocuments: 20 }, f.deps);
  assert.equal(result.coverage.documentsAttempted, 4);
  assert.equal(result.coverage.documentsRead, 0);
  assert.equal(result.charges.filter(c => c.instrumentStatus === "limit_reached").length, 4);
});

test("charges are paginated and capped with explicit incomplete coverage", async () => {
  const f = fixture({ count: 305 });
  const result = await getCompanyFinancingEvidence({ companyNumber: number, maxDocuments: 1 }, f.deps);
  assert.equal(result.coverage.totalCharges, 305);
  assert.equal(result.coverage.chargesListed, 300);
  assert.equal(result.coverage.complete, false);
  assert.equal(f.calls.filter(c => c[0] === "api" && c[1].includes("/charges?")).length, 3);
});

test("company and document identity cannot be changed by model-supplied paths", async () => {
  assert.equal(normalizeFinancingCompanyNumber("1234"), "00001234");
  assert.equal(normalizeFinancingCompanyNumber(" sc123456 "), "SC123456");
  for (const value of ["../11473397", "11473397?x=1", "ABC123456", ""]) assert.throws(() => normalizeFinancingCompanyNumber(value));
  const f = fixture({ wrongCompany: true });
  await assert.rejects(getCompanyFinancingEvidence({ companyNumber: number }, f.deps), /different company/);
  assert.equal(f.calls.length, 1);
  assert.equal(financingFilingPath(`/company/99999999/filing-history/id`, number), null);
  assert.equal(financingFilingPath(`https://evil.example/company/${number}/filing-history/id`, number), null);
  assert.equal(financingFilingPath(`/company/${number}/filing-history/id?x=1`, number), null);
  assert.equal(financingDocumentId("https://evil.example/document/id"), null);
  assert.equal(financingDocumentId("https://document-api.company-information.service.gov.uk/document/id/../secret"), null);
  assert.equal(financingDocumentId("https://document-api.company-information.service.gov.uk/document/good-id_1"), "good-id_1");
  assert.equal(financingCreationFiling(charge(1), number), `/company/${number}/filing-history/filing-1`);
});

test("title matching is exact, tolerates OCR whitespace, and does not confuse another title or lender registration number", async () => {
  const f = fixture({ count: 1 });
  f.deps.vision = async (_bytes, pages) => pages.map(page => ({ page, text: page === 6 ? "Lender company B283305. Property title NGL8136533. Facilities available." : "" }));
  const result = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  assert.equal(result.charges[0].instrument.propertyTitleMatch, "not_found_in_read_pages");
  const g = fixture({ count: 1 });
  g.deps.vision = async (_bytes, pages) => pages.map(page => ({ page, text: page === 6 ? "Property title NGL 813653." : "" }));
  const matched = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, g.deps);
  assert.deepEqual(matched.charges[0].instrument.propertyTitlePages, [6]);
});

test("bounded evidence keeps facility recitals and property grounding ahead of repetitive boilerplate", async () => {
  const f = fixture({ count: 1, longText: true });
  const result = await getCompanyFinancingEvidence({ companyNumber: number, titleNumber: title }, f.deps);
  const doc = result.charges[0].instrument;
  assert.ok(doc.evidence.reduce((sum: number, p: any) => sum + p.text.length, 0) <= 12000);
  assert.ok(doc.evidence.some((p: any) => p.text.includes("£8,300,000")));
  assert.ok(doc.evidence.some((p: any) => p.text.includes(title)));
  assert.equal(doc.evidenceTruncated, true);
});

test("security classification does not label insurance or account assignments as a registered land mortgage", () => {
  assert.deepEqual(financingSecurityKinds("Assignment of Insurances"), ["insurance"]);
  assert.deepEqual(financingSecurityKinds("Bank account security in Jersey"), ["bank_account"]);
  assert.deepEqual(financingSecurityKinds("Legal mortgage over the property"), ["land_mortgage_mentioned"]);
});

test("document redirects remain in CH's bucket and strip the API credential from S3", async () => {
  const calls: any[] = [];
  const signed = "https://s3.eu-west-2.amazonaws.com/document-api-images-live.ch.gov.uk/docs/file.pdf?signature=test";
  const transport = async (url: any, init: any) => {
    calls.push({ url, init });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: signed } }) : new Response(pdf, { status: 200 });
  };
  const result = await fetchFinancingPdf("doc-1", "test-key", transport as typeof fetch);
  assert.deepEqual(result, pdf);
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(allowedFinancingDocumentUrl("https://document-api-images-live.ch.gov.uk.s3.eu-west-1.amazonaws.com/file.pdf"), true);
  for (const url of ["http://s3.amazonaws.com/document-api-images-live.ch.gov.uk/file", "https://s3.amazonaws.com/other-bucket/file", "https://evil.example/pdf", "https://127.0.0.1/file", "https://evil.s3.amazonaws.com/file", "https://user:pass@document-api.company-information.service.gov.uk/document/id/content"]) assert.equal(allowedFinancingDocumentUrl(url), false, url);
});

test("download rejects non-PDF responses, oversized documents and hostile redirects", async () => {
  await assert.rejects(fetchFinancingPdf("id", "key", (async () => new Response("<html>not a PDF</html>")) as typeof fetch), /non-PDF/);
  await assert.rejects(fetchFinancingPdf("id", "key", (async () => new Response(pdf, { headers: { "content-length": "999999999" } })) as typeof fetch), /size limit/);
  let calls = 0;
  await assert.rejects(fetchFinancingPdf("id", "key", (async () => { calls++; return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secrets" } }); }) as typeof fetch), /Unrecognised/);
  assert.equal(calls, 1);
});

test("expired read budget preserves available text and reports scanned pages as unread", async () => {
  const f = fixture();
  const result = await readFinancingInstrument(pdf, f.deps, 0);
  assert.equal(result.retryable, true);
  assert.equal(result.pages.length, 1);
  assert.equal(result.unreadPages.length, 7);
  assert.equal(f.calls.length, 0);
});
