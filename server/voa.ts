import type { Express } from "express";
import { requireAuth } from "./auth";
import { db, pool } from "./db";
import { voaRatings } from "@shared/schema";
import { eq, ilike, and, or, sql, desc, asc } from "drizzle-orm";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

// Display-only lookup: BA code → human name. Only Inner London boroughs +
// City + Westminster have verified codes here — outer London codes get
// discovered + auto-named from `scan-authorities` below, then merged at
// lookup time via BA_NAMES_RUNTIME. If a BA code has no name we fall back
// to "BA {code}" in the UI.
const BA_NAMES: Record<string, string> = {
  "5990": "City of Westminster",
  "5600": "Royal Borough of Kensington and Chelsea",
  "5210": "Camden",
  "5390": "Hammersmith and Fulham",
  "5150": "City of London",
  "5420": "Islington",
  "5510": "Lambeth",
  "5660": "Southwark",
  "5720": "Tower Hamlets",
  "5750": "Wandsworth",
};

// Populated by scan-authorities at runtime — maps BA code → most-common town
// observed in the CSV, as a readable stand-in until we confirm the official
// name. Merged into BA_NAMES for responses.
const BA_NAMES_RUNTIME: Record<string, string> = {};

function nameForBa(code: string): string {
  return BA_NAMES[code] || BA_NAMES_RUNTIME[code] || `BA ${code}`;
}

// Greater London postcode areas. Rows whose postcode begins with any of these
// (followed by a digit) are considered "in London" for the wholesale import.
// EC / WC / NW / SE / SW / W / N / E cover inner London; the two-letter outer
// areas are included because entire London boroughs sit inside them.
const LONDON_POSTCODE_AREAS = [
  "EC", "WC", "NW", "SE", "SW", "W", "N", "E",
  "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB",
];

// London + Home Counties postcode areas for the auto-seed.
// Covers: all London plus Surrey (GU, RH), Kent (ME, TN, CT), Essex (SS, CM, CO),
// Hertfordshire (AL, SG, WD, HP), Buckinghamshire (MK, HP, SL), Berkshire (RG, SL),
// Hampshire (SO, PO, GU), East/West Sussex (BN, RH, PO), Oxfordshire (OX).
const LONDON_AND_HOME_COUNTIES_POSTCODE_AREAS = [
  // London
  "EC", "WC", "NW", "SE", "SW", "W", "N", "E",
  "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB",
  // Home counties ring
  "AL", "CB", "CM", "CO", "CT", "GU", "HP", "LU", "ME", "MK", "OX",
  "PO", "RG", "RH", "SG", "SL", "SO", "SS", "TN", "WD", "BN",
];

function postcodeMatchesAreas(postcode: string, areas: string[]): boolean {
  if (!postcode) return false;
  const pc = postcode.toUpperCase().replace(/\s+/g, "");
  // Sort by length desc so "WC" / "EC" match before "W" / "E"
  const sorted = [...areas].sort((a, b) => b.length - a.length);
  for (const a of sorted) {
    if (pc.startsWith(a)) {
      const next = pc[a.length];
      if (next && next >= "0" && next <= "9") return true;
    }
  }
  return false;
}

const DOWNLOAD_URLS: Record<string, string> = {
  "2023": "https://voaratinglists.blob.core.windows.net/downloads/uk-englandwales-ndr-2023-listentries-compiled-epoch-0019-baseline-csv.zip",
  "2026": "https://voaratinglists.blob.core.windows.net/downloads/uk-englandwales-ndr-2026-draft-listentries-epoch-0002-baseline-csv.zip",
};

function parseVoaLine(line: string): {
  uarn: string;
  baCode: string;
  baRef: string;
  scatCode: string;
  descriptionCode: string;
  descriptionText: string;
  firmName: string;
  numberOrName: string;
  street: string;
  town: string;
  locality: string;
  county: string;
  postcode: string;
  effectiveDate: string;
  rateableValue: number | null;
  listAlterationDate: string;
  compositeBillingAuthority: string;
} | null {
  const fields = line.split("*");
  if (fields.length < 22) return null;

  const baCode = fields[1]?.trim();
  const uarn = fields[6]?.trim();
  if (!uarn || !baCode) return null;

  const rv = fields[17]?.trim();

  return {
    uarn,
    baCode,
    baRef: fields[3]?.trim() || "",
    scatCode: fields[2]?.trim() || "",
    descriptionCode: fields[4]?.trim() || "",
    descriptionText: fields[5]?.trim() || "",
    firmName: fields[7]?.trim() || "",
    numberOrName: fields[9]?.trim() || "",
    street: fields[10]?.trim() || "",
    town: fields[11]?.trim() || "",
    locality: fields[12]?.trim() || "",
    county: fields[13]?.trim() || "",
    postcode: fields[14]?.trim() || "",
    effectiveDate: fields[15]?.trim() || "",
    rateableValue: rv ? parseInt(rv, 10) || null : null,
    listAlterationDate: fields[20]?.trim() || "",
    compositeBillingAuthority: fields[21]?.trim() || "",
  };
}

// Run the VOA CSV import in-process using native fetch + jszip (no curl/unzip
// dependencies — Railway containers may not have them). If baCodes provided,
// filters by BA code; if postcodeAreas provided, filters by postcode area;
// otherwise defaults to London + home counties postcode areas.
async function runVoaImportInProcess(opts: { baCodes?: string[]; listYear?: string; postcodeAreas?: string[] }): Promise<{ imported: number; skipped: number; message?: string }> {
  const year = opts.listYear || "2023";
  const zipUrl = DOWNLOAD_URLS[year];
  if (!zipUrl) throw new Error(`No download URL for list year ${year}`);

  const usePostcodeFilter = (!opts.baCodes || opts.baCodes.length === 0);
  const targetPostcodeAreas = (opts.postcodeAreas && opts.postcodeAreas.length > 0)
    ? opts.postcodeAreas.map((a) => a.toUpperCase())
    : LONDON_AND_HOME_COUNTIES_POSTCODE_AREAS;
  const targetBaCodes = opts.baCodes && opts.baCodes.length > 0 ? opts.baCodes : [];

  const tmpDir = "/tmp/voa-import";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, `voa-${year}.zip`);

  // Known minimum size for a legitimate VOA 2023 list download.
  // Full ZIP is ~450 MB. If we have anything less than 400 MB on disk, it's
  // almost certainly a truncated / partial download from a previous crash.
  const MIN_LEGIT_ZIP_MB = 400;

  // === Download via streaming fetch → file (keeps memory low) ===
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < MIN_LEGIT_ZIP_MB * 1024 * 1024) {
    // Delete any corrupted partial download before re-trying
    if (fs.existsSync(zipPath)) {
      console.log(`[VOA auto] Deleting corrupted/incomplete ZIP at ${zipPath}`);
      fs.unlinkSync(zipPath);
    }
    console.log(`[VOA auto] Downloading ${year} rating list from ${zipUrl}...`);
    const resp = await fetch(zipUrl);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
    if (!resp.body) throw new Error("No response body");
    const contentLength = Number(resp.headers.get("content-length") || 0);
    const fileStream = fs.createWriteStream(zipPath);
    const { Readable } = await import("stream");
    const { pipeline } = await import("stream/promises");
    await pipeline(Readable.fromWeb(resp.body as any), fileStream);
    const size = fs.statSync(zipPath).size;
    // Sanity check: if declared Content-Length exists, size must match
    if (contentLength > 0 && size !== contentLength) {
      fs.unlinkSync(zipPath);
      throw new Error(`Download truncated — got ${size} bytes, expected ${contentLength}`);
    }
    if (size < MIN_LEGIT_ZIP_MB * 1024 * 1024) {
      fs.unlinkSync(zipPath);
      throw new Error(`Downloaded file too small (${(size / 1024 / 1024).toFixed(1)} MB) — expected >${MIN_LEGIT_ZIP_MB} MB`);
    }
    console.log(`[VOA auto] Downloaded ${(size / 1024 / 1024).toFixed(1)} MB to ${zipPath}`);
  }

  // === Stream the CSV directly out of the ZIP (never fully in memory) ===
  // @ts-ignore - unzipper has no types
  const unzipper = (await import("unzipper")).default || (await import("unzipper"));
  const directory: any = await unzipper.Open.file(zipPath);
  const csvEntry: any = directory.files.find((f: any) =>
    !f.type?.includes("Directory") && /\.csv$/i.test(f.path) && /baseline|listentries|compiled/i.test(f.path)
  );
  if (!csvEntry) {
    const names = directory.files.slice(0, 20).map((f: any) => f.path).join(", ");
    throw new Error(`No CSV file found in ZIP. Contents: ${names}`);
  }
  console.log(`[VOA auto] Streaming ${csvEntry.path} out of ZIP...`);
  const csvStream = csvEntry.stream();

  // === Clear existing rows for this scope ===
  if (targetBaCodes.length > 0) {
    await db.delete(voaRatings).where(
      and(
        sql`${voaRatings.baCode} IN (${sql.join(targetBaCodes.map(c => sql`${c}`), sql`, `)})`,
        eq(voaRatings.listYear, year)
      )
    );
  } else {
    // Clear all rows for the year (postcode-area import is wholesale)
    await db.delete(voaRatings).where(eq(voaRatings.listYear, year));
  }

  // === Parse + insert (streaming from ZIP entry, never buffers full CSV) ===
  let imported = 0;
  let skipped = 0;
  let batch: any[] = [];
  const BATCH_SIZE = 500;

  csvStream.setEncoding("utf-8");
  const rl = createInterface({
    input: csvStream,
    crlfDelay: Infinity,
  });

  // Yield to the event loop periodically so user requests aren't blocked.
  const yieldToEventLoop = () => new Promise((r) => setImmediate(r));

  for await (const line of rl) {
    if (!line.trim()) continue;
    const parsed = parseVoaLine(line);
    if (!parsed) { skipped++; continue; }

    // Filter: BA codes take priority, else postcode area
    if (targetBaCodes.length > 0) {
      if (!targetBaCodes.includes(parsed.baCode)) { skipped++; continue; }
    } else if (usePostcodeFilter) {
      if (!postcodeMatchesAreas(parsed.postcode, targetPostcodeAreas)) { skipped++; continue; }
    }

    batch.push({ ...parsed, listYear: year });
    if (batch.length >= BATCH_SIZE) {
      await db.insert(voaRatings).values(batch);
      imported += batch.length;
      batch = [];
      // Give user requests a chance to run between batches
      await yieldToEventLoop();
    }
  }
  if (batch.length > 0) {
    await db.insert(voaRatings).values(batch);
    imported += batch.length;
  }
  return { imported, skipped, message: `Scope: ${targetBaCodes.length > 0 ? `BA codes [${targetBaCodes.join(", ")}]` : `postcode areas [${targetPostcodeAreas.join(", ")}]`}` };
}

// Auto-seed the VOA table on server startup. Runs ONCE per server boot if the
// table is under-populated. Does NOT retry on the same boot — if it fails,
// admin should investigate (check /api/voa/status with ?import=1).
// Re-checks after 30 days for VOA list updates.
// Scope: London + home counties postcode areas (wholesale import).
export function startVoaAutoImport() {
  if (process.env.DISABLE_VOA_AUTO_IMPORT === "1") {
    console.log("[VOA auto] Disabled via env var");
    return;
  }
  const CHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const MIN_ROWS_THRESHOLD = 30000;
  let ranThisBoot = false;

  const maybeImport = async () => {
    if (ranThisBoot) {
      console.log("[VOA auto] Already attempted this boot — skipping (restart server to retry)");
      return;
    }
    ranThisBoot = true;
    try {
      const [{ c }] = await db.select({ c: sql<number>`COUNT(*)::int` }).from(voaRatings)
        .where(eq(voaRatings.listYear, "2023"));
      if ((c || 0) >= MIN_ROWS_THRESHOLD) {
        console.log(`[VOA auto] Already have ${c} rows for 2023 list — skipping.`);
        return;
      }
      console.log(`[VOA auto] Only ${c || 0} rows — running London + home counties import...`);
      const { imported, skipped, message } = await runVoaImportInProcess({});
      console.log(`[VOA auto] Imported ${imported} rows (${skipped} skipped). ${message || ""}`);
    } catch (err: any) {
      console.error("[VOA auto] Auto-import error (will NOT retry this boot):", err?.message || err);
      console.error("[VOA auto] To retry, restart the server or hit /api/voa/status?import=1");
    }
  };

  // Delay to 15 min post-boot so it doesn't fight with early user requests
  setTimeout(maybeImport, 15 * 60 * 1000);
  // Re-check every 30 days (resets ranThisBoot since that's process-local,
  // but this interval only fires while the server stays up)
  setInterval(() => { ranThisBoot = false; maybeImport(); }, CHECK_INTERVAL_MS);
}

export function registerVoaRoutes(app: Express) {
  // Diagnostic: check VOA data status + manually trigger import.
  // Visit /api/voa/status to see row counts per BA code.
  // Add ?import=1 to force an import run inline (may take 1-2 min, returns result).
  app.get("/api/voa/status", requireAuth, async (req, res) => {
    try {
      // Prefer SQLite snapshot if present.
      const { voaSqliteAvailable, voaStatus, voaSqliteInfo } = await import("./voa-sqlite");
      let base: any;
      if (voaSqliteAvailable()) {
        const s = voaStatus();
        const info = voaSqliteInfo();
        base = {
          source: "sqlite",
          sqlitePath: info.path,
          builtAt: info.builtAt,
          areas: info.areas,
          totalRows: s.totalRows,
          byBaCode: s.byBaCode.map((r) => ({ baCode: r.baCode, name: nameForBa(r.baCode), listYear: r.listYear, rows: r.rows })),
        };
      } else {
        const counts: any = await pool.query(
          `SELECT ba_code, list_year, COUNT(*)::int AS rows
             FROM voa_ratings
            GROUP BY ba_code, list_year
            ORDER BY rows DESC`
        );
        const total: any = await pool.query(`SELECT COUNT(*)::int AS total FROM voa_ratings`);
        base = {
          source: "postgres",
          totalRows: total.rows[0]?.total || 0,
          byBaCode: counts.rows.map((r: any) => ({ baCode: r.ba_code, name: nameForBa(r.ba_code), listYear: r.list_year, rows: r.rows })),
        };
      }
      if (req.query.import === "1") {
        try {
          const ba = typeof req.query.baCodes === "string" ? req.query.baCodes.split(",") : ["5990", "5600"];
          const r = await runVoaImportInProcess({ baCodes: ba });
          return res.json({ ...base, importTriggered: { imported: r.imported, skipped: r.skipped, baCodes: ba } });
        } catch (err: any) {
          return res.json({ ...base, importTriggered: { error: String(err?.message || err) } });
        }
      }
      res.json(base);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Unknown" });
    }
  });

  app.get("/api/voa/ratings", requireAuth, async (req, res) => {
    try {
      const { search, baCode, descriptionCode, postcode, minRv, maxRv, sortBy, sortDir, page, limit: limitParam } = req.query;
      const pageNum = Math.max(1, Number(page) || 1);
      const limit = Math.min(100, Math.max(1, Number(limitParam) || 50));
      const offset = (pageNum - 1) * limit;

      // Prefer SQLite.
      const { voaSqliteAvailable, searchVoaRatings } = await import("./voa-sqlite");
      if (voaSqliteAvailable()) {
        const r = searchVoaRatings({
          search: typeof search === "string" ? search : undefined,
          baCode: typeof baCode === "string" ? baCode : undefined,
          descriptionCode: typeof descriptionCode === "string" ? descriptionCode : undefined,
          postcode: typeof postcode === "string" ? postcode : undefined,
          minRv: minRv ? Number(minRv) : undefined,
          maxRv: maxRv ? Number(maxRv) : undefined,
          sortBy: (typeof sortBy === "string" ? sortBy : "rateable_value") as any,
          sortDir: sortDir === "asc" ? "asc" : "desc",
          page: pageNum,
          limit,
        });
        return res.json({ ...r, baNames: { ...BA_NAMES, ...BA_NAMES_RUNTIME } });
      }

      const conditions: any[] = [];
      if (baCode) conditions.push(eq(voaRatings.baCode, String(baCode)));
      if (descriptionCode) conditions.push(eq(voaRatings.descriptionCode, String(descriptionCode)));
      if (postcode) conditions.push(ilike(voaRatings.postcode, `${String(postcode)}%`));
      if (search) {
        const s = `%${String(search)}%`;
        conditions.push(or(
          ilike(voaRatings.firmName, s),
          ilike(voaRatings.street, s),
          ilike(voaRatings.postcode, s),
          ilike(voaRatings.descriptionText, s),
        ));
      }
      if (minRv) conditions.push(sql`${voaRatings.rateableValue} >= ${Number(minRv)}`);
      if (maxRv) conditions.push(sql`${voaRatings.rateableValue} <= ${Number(maxRv)}`);

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const sortColumn = sortBy === "rateableValue" ? voaRatings.rateableValue
        : sortBy === "postcode" ? voaRatings.postcode
        : sortBy === "descriptionText" ? voaRatings.descriptionText
        : sortBy === "street" ? voaRatings.street
        : voaRatings.firmName;
      const orderFn = sortDir === "desc" ? desc : asc;

      const [items, countResult] = await Promise.all([
        db.select().from(voaRatings).where(where).orderBy(orderFn(sortColumn)).limit(limit).offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(voaRatings).where(where),
      ]);

      res.json({
        items,
        total: Number(countResult[0]?.count || 0),
        page: pageNum,
        limit,
        baNames: { ...BA_NAMES, ...BA_NAMES_RUNTIME },
      });
    } catch (err: any) {
      console.error("VOA ratings query error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/voa/stats", requireAuth, async (_req, res) => {
    try {
      const { voaSqliteAvailable, voaStats } = await import("./voa-sqlite");
      if (voaSqliteAvailable()) {
        const s = voaStats();
        return res.json({
          byAuthority: s.byAuthority.map((r: any) => ({ ...r, name: nameForBa(r.baCode) })),
          byType: s.byType,
          baNames: { ...BA_NAMES, ...BA_NAMES_RUNTIME },
        });
      }
      const stats = await db.select({
        baCode: voaRatings.baCode,
        count: sql<number>`count(*)`,
        avgRv: sql<number>`round(avg(${voaRatings.rateableValue}))`,
        totalRv: sql<number>`sum(${voaRatings.rateableValue})`,
        minRv: sql<number>`min(${voaRatings.rateableValue})`,
        maxRv: sql<number>`max(${voaRatings.rateableValue})`,
      }).from(voaRatings).groupBy(voaRatings.baCode);

      const descStats = await db.select({
        descriptionCode: voaRatings.descriptionCode,
        descriptionText: voaRatings.descriptionText,
        count: sql<number>`count(*)`,
        avgRv: sql<number>`round(avg(${voaRatings.rateableValue}))`,
      }).from(voaRatings)
        .groupBy(voaRatings.descriptionCode, voaRatings.descriptionText)
        .orderBy(sql`count(*) desc`)
        .limit(20);

      res.json({
        byAuthority: stats.map(s => ({ ...s, name: nameForBa(s.baCode) })),
        byType: descStats,
        baNames: { ...BA_NAMES, ...BA_NAMES_RUNTIME },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/voa/description-codes", requireAuth, async (_req, res) => {
    try {
      const { voaSqliteAvailable, voaDescriptionCodes } = await import("./voa-sqlite");
      if (voaSqliteAvailable()) {
        return res.json(voaDescriptionCodes());
      }
      const codes = await db.select({
        code: voaRatings.descriptionCode,
        text: voaRatings.descriptionText,
        count: sql<number>`count(*)`,
      }).from(voaRatings)
        .groupBy(voaRatings.descriptionCode, voaRatings.descriptionText)
        .orderBy(sql`count(*) desc`);
      res.json(codes);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/voa/import", requireAuth, async (req, res) => {
    try {
      const { baCodes, listYear, postcodeAreas } = req.body;
      const year = listYear || "2023";
      const targetBaCodes: string[] = baCodes || [];
      const targetPostcodeAreas: string[] = (postcodeAreas || []).map((a: string) => String(a).toUpperCase());
      // Back-compat: if neither filter was given, preserve original default
      if (targetBaCodes.length === 0 && targetPostcodeAreas.length === 0) {
        targetBaCodes.push("5990", "5600");
      }

      const zipUrl = DOWNLOAD_URLS[year];
      if (!zipUrl) return res.status(400).json({ error: `No download URL for list year ${year}` });

      const tmpDir = "/tmp/voa-import";
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      const zipPath = path.join(tmpDir, `voa-${year}.zip`);
      const extractDir = path.join(tmpDir, `voa-${year}-extract`);

      if (!fs.existsSync(zipPath)) {
        console.log(`[VOA] Downloading ${year} rating list...`);
        execSync(`curl -sL "${zipUrl}" -o "${zipPath}"`, { timeout: 120000 });
      }

      if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true });
        console.log(`[VOA] Extracting...`);
        execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { timeout: 120000 });
      }

      const csvFiles = fs.readdirSync(extractDir).filter(f => f.includes("baseline-csv.csv") && !f.includes("historic"));
      if (csvFiles.length === 0) return res.status(500).json({ error: "No CSV file found in extracted data" });

      const csvPath = path.join(extractDir, csvFiles[0]);

      // Clear any existing rows for the target scope so we don't double-insert
      if (targetBaCodes.length > 0) {
        await db.delete(voaRatings).where(
          and(
            sql`${voaRatings.baCode} IN (${sql.join(targetBaCodes.map(c => sql`${c}`), sql`, `)})`,
            eq(voaRatings.listYear, year)
          )
        );
      } else if (targetPostcodeAreas.length > 0) {
        // No reliable way to delete-by-postcode-area in SQL without a scan —
        // just clear all rows for the year before importing.
        await db.delete(voaRatings).where(eq(voaRatings.listYear, year));
      }

      let imported = 0;
      let skipped = 0;
      let batch: any[] = [];
      const BATCH_SIZE = 500;
      const importedBaCodes = new Set<string>();
      const baTownSample: Record<string, Record<string, number>> = {};

      const rl = createInterface({
        input: createReadStream(csvPath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        const parsed = parseVoaLine(line);
        if (!parsed) { skipped++; continue; }

        const matchesBa = targetBaCodes.length > 0 && targetBaCodes.includes(parsed.baCode);
        const matchesPc = targetPostcodeAreas.length > 0 && postcodeMatchesAreas(parsed.postcode, targetPostcodeAreas);
        if (!matchesBa && !matchesPc) continue;

        importedBaCodes.add(parsed.baCode);
        const town = parsed.town || parsed.locality || "";
        if (town) {
          baTownSample[parsed.baCode] ??= {};
          baTownSample[parsed.baCode][town] = (baTownSample[parsed.baCode][town] || 0) + 1;
        }

        batch.push({
          ...parsed,
          listYear: year,
        });

        if (batch.length >= BATCH_SIZE) {
          await db.insert(voaRatings).values(batch);
          imported += batch.length;
          batch = [];
          if (imported % 5000 === 0) console.log(`[VOA] Imported ${imported} records...`);
        }
      }

      if (batch.length > 0) {
        await db.insert(voaRatings).values(batch);
        imported += batch.length;
      }

      // Populate runtime BA name map using the most-common town we saw for
      // each BA code, so newly-discovered outer London boroughs show something
      // readable in the UI even before we've hand-verified their names.
      for (const code of importedBaCodes) {
        if (BA_NAMES[code]) continue;
        const towns = baTownSample[code] || {};
        const top = Object.entries(towns).sort((a, b) => b[1] - a[1])[0];
        if (top) BA_NAMES_RUNTIME[code] = top[0];
      }

      console.log(`[VOA] Import complete: ${imported} records; BA codes ${[...importedBaCodes].join(", ")}`);
      res.json({
        imported,
        skipped,
        baCodes: [...importedBaCodes],
        listYear: year,
        postcodeAreas: targetPostcodeAreas,
        baNames: { ...BA_NAMES, ...BA_NAMES_RUNTIME },
      });
    } catch (err: any) {
      console.error("[VOA] Import error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/voa/available-authorities", requireAuth, async (_req, res) => {
    res.json({ ...BA_NAMES, ...BA_NAMES_RUNTIME });
  });

  // ─── Scan BA codes present in the published rating list ────────────────
  // Reads the already-downloaded CSV for a list year and returns every
  // unique billing-authority code it sees, alongside sample towns and
  // postcode prefixes so you can identify London boroughs without having
  // to know the numeric codes up front. Does not touch the database.
  app.get("/api/voa/scan-authorities", requireAuth, async (req, res) => {
    try {
      const year = String(req.query.listYear || "2023");
      const onlyLondon = String(req.query.onlyLondon || "false") === "true";

      const tmpDir = "/tmp/voa-import";
      const extractDir = path.join(tmpDir, `voa-${year}-extract`);
      if (!fs.existsSync(extractDir)) {
        return res.status(404).json({
          error: `CSV for list year ${year} not present. Run /api/voa/import first (it caches the zip + CSV in /tmp).`,
        });
      }
      const csvFiles = fs.readdirSync(extractDir).filter(f => f.includes("baseline-csv.csv") && !f.includes("historic"));
      if (csvFiles.length === 0) return res.status(500).json({ error: "No CSV file found in extracted data" });
      const csvPath = path.join(extractDir, csvFiles[0]);

      type BaStat = {
        baCode: string;
        count: number;
        towns: Record<string, number>;
        postcodeAreas: Record<string, number>;
      };
      const byBa: Record<string, BaStat> = {};

      const rl = createInterface({
        input: createReadStream(csvPath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        const parsed = parseVoaLine(line);
        if (!parsed) continue;
        if (onlyLondon && !postcodeMatchesAreas(parsed.postcode, LONDON_POSTCODE_AREAS)) continue;
        const s = byBa[parsed.baCode] ??= {
          baCode: parsed.baCode, count: 0, towns: {}, postcodeAreas: {},
        };
        s.count++;
        if (parsed.town) s.towns[parsed.town] = (s.towns[parsed.town] || 0) + 1;
        const pcArea = (parsed.postcode.match(/^[A-Z]+/i) || [""])[0].toUpperCase();
        if (pcArea) s.postcodeAreas[pcArea] = (s.postcodeAreas[pcArea] || 0) + 1;
      }

      const result = Object.values(byBa)
        .sort((a, b) => b.count - a.count)
        .map(s => ({
          baCode: s.baCode,
          knownName: BA_NAMES[s.baCode] || null,
          count: s.count,
          topTowns: Object.entries(s.towns).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, n })),
          postcodeAreas: Object.entries(s.postcodeAreas).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([area, n]) => ({ area, n })),
        }));

      res.json({ listYear: year, onlyLondon, total: result.length, authorities: result });
    } catch (err: any) {
      console.error("[VOA] Scan error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Raw postcode-area list so callers know what "all London" expands to —
  // POST the returned array to /api/voa/import as `postcodeAreas` to import
  // the whole of Greater London in one shot.
  app.get("/api/voa/london-postcode-areas", requireAuth, (_req, res) => {
    res.json({ postcodeAreas: LONDON_POSTCODE_AREAS });
  });
}
