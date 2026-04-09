import type { Express } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { voaRatings } from "@shared/schema";
import { eq, ilike, and, or, sql, desc, asc } from "drizzle-orm";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

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

export function registerVoaRoutes(app: Express) {
  app.get("/api/voa/ratings", requireAuth, async (req, res) => {
    try {
      const { search, baCode, descriptionCode, postcode, minRv, maxRv, sortBy, sortDir, page, limit: limitParam } = req.query;
      const pageNum = Math.max(1, Number(page) || 1);
      const limit = Math.min(100, Math.max(1, Number(limitParam) || 50));
      const offset = (pageNum - 1) * limit;

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
        baNames: BA_NAMES,
      });
    } catch (err: any) {
      console.error("VOA ratings query error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/voa/stats", requireAuth, async (_req, res) => {
    try {
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
        byAuthority: stats.map(s => ({ ...s, name: BA_NAMES[s.baCode] || s.baCode })),
        byType: descStats,
        baNames: BA_NAMES,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/voa/description-codes", requireAuth, async (_req, res) => {
    try {
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
      const { baCodes, listYear } = req.body;
      const year = listYear || "2023";
      const targetBaCodes: string[] = baCodes || ["5990", "5600"];

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

      await db.delete(voaRatings).where(
        and(
          sql`${voaRatings.baCode} IN (${sql.join(targetBaCodes.map(c => sql`${c}`), sql`, `)})`,
          eq(voaRatings.listYear, year)
        )
      );

      let imported = 0;
      let skipped = 0;
      let batch: any[] = [];
      const BATCH_SIZE = 500;

      const rl = createInterface({
        input: createReadStream(csvPath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        const parsed = parseVoaLine(line);
        if (!parsed) { skipped++; continue; }
        if (!targetBaCodes.includes(parsed.baCode)) continue;

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

      console.log(`[VOA] Import complete: ${imported} records for BA codes ${targetBaCodes.join(", ")}`);
      res.json({ imported, skipped, baCodes: targetBaCodes, listYear: year });
    } catch (err: any) {
      console.error("[VOA] Import error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/voa/available-authorities", requireAuth, async (_req, res) => {
    res.json(BA_NAMES);
  });
}
