import { test } from "node:test";
import assert from "node:assert/strict";
import { researchSectorFor } from "../shared/research-sector";

test("the file name decides when it is clear", () => {
  assert.equal(researchSectorFor("Q3_London_Office_Market.pdf"), "Office London");
  assert.equal(researchSectorFor("Regional Offices Q2 2026.pdf"), "Office National");
  assert.equal(researchSectorFor("UK Retail Parks Update.pdf"), "Retail Parks");
  assert.equal(researchSectorFor("Industrial & Logistics Snapshot.pdf"), "Industrial");
  assert.equal(researchSectorFor("BTR investment report.pdf"), "Residential");
  assert.equal(researchSectorFor("Hotels and leisure outlook.pdf"), "Leisure Schemes");
  assert.equal(researchSectorFor("Restaurant market review.pdf"), "F&B - High Street");
  assert.equal(researchSectorFor("Mixed-use regeneration.pdf"), "Mixed Use");
  assert.equal(researchSectorFor("Portfolio sales 2026.xlsx"), "Portfolios");
  assert.equal(researchSectorFor("Healthcare and education investment.pdf"), "Educational/Social");
});

test("retail is split by place and kind", () => {
  assert.equal(researchSectorFor("West End Retail Q3.pdf"), "Retail - London");
  assert.equal(researchSectorFor("London shopping centres.pdf"), "London Shopping Centre");
  assert.equal(researchSectorFor("Shopping Centre Investment Q2.pdf"), "Retail - Shopping Centre");
  assert.equal(researchSectorFor("UK High Street Retail.pdf"), "Retail - High Street");
});

test("the text files a plainly named document", () => {
  const text = "The London office market saw take-up of 2.1m sq ft. Grade A offices in the City of London and the West End ... office demand";
  assert.equal(researchSectorFor("Report 0412.pdf", text), "Office London");
  const parks = "Retail warehouse yields held. Retail parks investment volumes ... out-of-town retail parks remain popular";
  assert.equal(researchSectorFor("scan.pdf", parks), "Retail Parks");
});

test("mixed or unclear goes to General", () => {
  assert.equal(researchSectorFor("Q3 market outlook.pdf"), "General");
  assert.equal(researchSectorFor("Office and industrial review.pdf"), "General");
  assert.equal(researchSectorFor("Office market.pdf"), "General");
  assert.equal(researchSectorFor("notes.txt", "A portfolio of assets."), "General");
});

import { researchPublishedOn, pdfInfoDate } from "../shared/research-date";
const today = new Date(Date.UTC(2026, 10, 17));
const ym = (d: Date | null) => d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null;

test("the publication date: name first, then the PDF's own date, then rough names, then the cover", () => {
  assert.equal(ym(researchPublishedOn("London Office Nov 2026.pdf", null, null, today)), "2026-11");
  assert.equal(ym(researchPublishedOn("report_2026-03-14.pdf", null, null, today)), "2026-03");
  assert.equal(ym(researchPublishedOn("Retail Parks Q2 2026.pdf", null, null, today)), "2026-06");
  assert.equal(ym(researchPublishedOn("Retail Parks Q2 2026.pdf", null, new Date(Date.UTC(2026, 6, 20)), today)), "2026-07");
  assert.equal(ym(researchPublishedOn("Outlook H1-25.pdf", null, null, today)), "2025-06");
  assert.equal(ym(researchPublishedOn("scan.pdf", "UK Investment\nSeptember 2025\nContents", null, today)), "2025-09");
  assert.equal(ym(researchPublishedOn("Market 2024.pdf", null, null, today)), "2024-01");
  assert.equal(researchPublishedOn("notes.pdf", "No dates here", null, today), null);
  assert.equal(researchPublishedOn("Plan 2030.pdf", null, null, today), null);
});

test("pdfinfo's creation date is read", () => {
  assert.equal(ym(pdfInfoDate("Title: x\nCreationDate:    Tue Nov  3 10:12:00 2026 GMT\nPages: 4")), "2026-11");
  assert.equal(pdfInfoDate("Pages: 4"), null);
});
