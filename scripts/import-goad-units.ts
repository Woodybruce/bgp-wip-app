/**
 * Import occupier units into goad_units from a newline-delimited JSON file
 * produced by scripts/goad-shp-to-ndjson.py (Experian Goad shapefile export).
 *
 *   pip install pyshp
 *   python3 scripts/goad-shp-to-ndjson.py /path/to/unzipped-goad > goad-units.ndjson
 *   tsx scripts/import-goad-units.ts goad-units.ndjson
 *
 * Idempotent — re-running updates existing rows (upsert on external_key).
 */
import { readFileSync } from "fs";
import { upsertGoadUnits, normaliseCategory, type NormalisedUnit } from "../server/goad-units";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx scripts/import-goad-units.ts <file.ndjson>");
    process.exit(1);
  }
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const units: NormalisedUnit[] = [];
  for (const line of lines) {
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec.geometry) continue;
    const floor = rec.floorLevel || "GF";
    const key = rec.goadNumber
      ? `experian:${floor}:${rec.goadNumber}`
      : `experian:${floor}:${rec.streetNum || ""}:${rec.streetName || ""}:${rec.occupierName || ""}`;
    units.push({
      externalKey: key,
      source: "experian",
      toid: null,
      goadNumber: rec.goadNumber ?? null,
      centreCode: rec.centreCode ?? null,
      floorLevel: floor,
      occupierName: rec.occupierName ?? null,
      classification: rec.classification ?? "unknown",
      category: rec.category ?? null,
      categoryGroup: normaliseCategory({
        occupierName: rec.occupierName,
        rawCategory: rec.category,
        classification: rec.classification,
      }),
      useClass: rec.useClass ?? null,
      tradeType: rec.tradeType ?? null,
      streetNum: rec.streetNum ?? null,
      streetName: rec.streetName ?? null,
      postcode: rec.postcode ?? null,
      precName: rec.precName ?? null,
      areaFt2: rec.areaFt2 ?? null,
      areaM2: rec.areaM2 ?? null,
      geometry: rec.geometry,
      surveyDate: rec.surveyDate ?? null,
      pubDate: rec.pubDate ?? null,
      rawProps: null,
    });
  }
  console.log(`Parsed ${units.length} units; upserting…`);
  const CHUNK = 1000;
  let total = 0;
  for (let i = 0; i < units.length; i += CHUNK) {
    total += await upsertGoadUnits(units.slice(i, i + CHUNK));
    process.stdout.write(`\r  ${Math.min(i + CHUNK, units.length)}/${units.length}`);
  }
  console.log(`\nDone. ${total} rows written.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
