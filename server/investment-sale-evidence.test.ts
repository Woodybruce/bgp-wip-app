import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseSaleDate, addressKey, evidenceStatusOf, fileSaleEvidence } from "./investment-sale-evidence";

test("dates keep the precision they were given", () => {
  assert.equal(normaliseSaleDate("June 2026"), "2026-06");
  assert.equal(normaliseSaleDate("2026-07"), "2026-07");
  assert.equal(normaliseSaleDate("2026-02-06"), "2026-02-06");
  assert.equal(normaliseSaleDate("3 March 2025"), "2025-03-03");
  assert.equal(normaliseSaleDate("2024"), "2024");
  assert.equal(normaliseSaleDate("Q3 2026"), null);
  assert.equal(normaliseSaleDate(""), null);
});

test("address keys survive spelling variants", () => {
  assert.equal(addressKey("80-85 Tottenham Court Road, W1"), addressKey("80-85 Tottenham Ct Rd"));
  assert.equal(addressKey("216-219 Tottenham Court Raod"), addressKey("216-219 Tottenham Court Road, London W1T 7PT"));
});

test("evidence status from source wording", () => {
  assert.equal(evidenceStatusOf("Under Offer"), "under offer");
  assert.equal(evidenceStatusOf("Q. £28,000,000"), "quoting");
  assert.equal(evidenceStatusOf("Sold"), "sold");
  assert.equal(evidenceStatusOf("exchanged"), "exchanged");
  assert.equal(evidenceStatusOf("nonsense"), null);
});

// A tiny in-memory investment_comps for the writer's queries.
function fakePool(rows: any[]) {
  const calls: string[] = [];
  return {
    calls,
    rows,
    async query(sql: string, params: any[] = []) {
      calls.push(sql.split(/\s+/).slice(0, 3).join(" "));
      if (/FROM investment_comp_tracker_links/.test(sql) || /rca_deal_id = \$2/.test(sql)) {
        return { rows: rows.filter((r) => r.rca_deal_id === params[1]) };
      }
      if (/^\s*SELECT/.test(sql) && /FROM investment_comps/.test(sql)) {
        const toks: string[] = (params[1] || []).map((x: string) => x.replace(/%/g, "").toLowerCase());
        return { rows: rows.filter((r) => (params[0] && r.property_id === params[0]) || toks.some((tok) => `${r.property_name} ${r.address}`.toLowerCase().includes(tok))) };
      }
      if (/^\s*INSERT INTO investment_comps/.test(sql)) {
        const cols = sql.match(/\(id, rca_deal_id, source, comments, ([^)]+)\)/)![1].split(", ");
        const row: any = { id: `new-${rows.length}`, rca_deal_id: params[0], source: params[1], comments: params[2] };
        cols.forEach((c, i) => (row[c] = params[i + 3]));
        rows.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/^\s*UPDATE investment_comps SET/.test(sql)) {
        const r = rows.find((x) => x.id === params[0]);
        const sets = sql.match(/SET (.+) WHERE/)![1].split(", ").map((x) => x.split(" = ")[0]);
        sets.forEach((c, i) => (r[c] = params[i + 1]));
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test("an RCA comp for the same sale is updated, not duplicated, and a rerun changes nothing", async () => {
  const pool = fakePool([{
    id: "rca-1", rca_deal_id: "4283895", status: "Sale - Pending", property_name: "80-85 Tottenham Court Rd", address: "80-85 Tottenham Court Rd",
    price: 32600000, cap_rate: 0.0521, transaction_date: "2026-02-06", buyer: "BPS London, Purestone Capital", source: "RCA", comments: null,
  }]);
  const input = {
    propertyName: "80-85 Tottenham Court Road", evidenceStatus: "sold" as const, price: 32600000, yieldPct: 5.62, sqft: 43290,
    saleDate: "June 2026", assetClass: "Office London", sourceDocument: "Knight Frank 2–4 Bucknall Street brochure", sourcePage: "PDF p15",
  };
  const r1 = await fileSaleEvidence(input, { pool });
  assert.equal(r1.compId, "rca-1");
  assert.equal(r1.action, "updated");
  assert.equal(pool.rows.length, 1);
  assert.equal(pool.rows[0].status, "Sale");
  assert.equal(pool.rows[0].transaction_date, "2026-06");
  assert.equal(pool.rows[0].buyer, "BPS London, Purestone Capital");
  assert.equal(pool.rows[0].rca_deal_id, "4283895", "the RCA key is kept so the next RCA import still matches");
  const r2 = await fileSaleEvidence(input, { pool });
  assert.equal(r2.action, "unchanged");
  assert.equal(pool.rows.length, 1);
});

test("under offer keeps asking terms and an unknown buyer stays blank", async () => {
  const pool = fakePool([]);
  const r = await fileSaleEvidence({ propertyName: "90 Tottenham Court Road", evidenceStatus: "under offer", price: 28000000, yieldPct: 7.99, buyer: "TBC" }, { pool });
  assert.equal(r.action, "created");
  const row = pool.rows[0];
  assert.equal(row.status, "Under Offer");
  assert.equal(row.price_qualifier, "Quoting");
  assert.equal(row.cap_rate_qualifier, "Quoting");
  assert.equal(row.buyer, null);
  assert.ok(Math.abs(row.cap_rate - 0.0799) < 1e-9);
});

test("a later sale at a different price years apart is a new comp", async () => {
  const pool = fakePool([{ id: "old", status: "Sale", property_name: "21 Stephen Street", address: null, price: 20000000, transaction_date: "2015-03", comments: null }]);
  const r = await fileSaleEvidence({ propertyName: "21 Stephen Street", evidenceStatus: "sold", price: 36050000, saleDate: "July 2026" }, { pool });
  assert.equal(r.action, "created");
  assert.equal(pool.rows.length, 2);
});

test("a disagreeing price on the same sale is reported, not overwritten", async () => {
  const pool = fakePool([{ id: "c", status: "Sale", property_name: "30 Cleveland Street", address: null, price: 70000000, transaction_date: "2026-05", buyer: "Owner Occupier", comments: null }]);
  const r = await fileSaleEvidence({ propertyName: "30 Cleveland Street", evidenceStatus: "sold", price: 64500000, saleDate: "2026-05" }, { pool });
  assert.equal(r.action, "unchanged");
  assert.equal(pool.rows.length, 1);
  assert.equal(pool.rows[0].price, 70000000);
  assert.match(r.conflicts.join(" "), /price/);
});

test("preferSource takes the brochure's figures and keeps the old ones in the notes", async () => {
  const pool = fakePool([{ id: "c", status: "Sale", property_name: "16 Conduit St", address: null, price: 13500000, cap_rate: null, transaction_date: "2025-12-01", comments: null }]);
  const r = await fileSaleEvidence({ propertyName: "16 Conduit Street", evidenceStatus: "sold", price: 13000000, yieldPct: 3.39, pricePsf: 2763, saleDate: "December 2025", preferSource: true }, { pool });
  assert.equal(r.conflicts.length, 0);
  assert.equal(pool.rows[0].price, 13000000);
  assert.equal(pool.rows[0].price_psf, 2763);
  assert.equal(pool.rows[0].transaction_date, "2025-12-01");
  assert.match(pool.rows[0].comments, /price was £13,500,000/);
});
