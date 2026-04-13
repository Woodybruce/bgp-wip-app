import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, copyFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import pg from "pg";

async function runPreMigrations() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const pool = new pg.Pool({ connectionString: dbUrl });
  try {
    const websiteCol = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'crm_properties' AND column_name = 'website'
    `);
    if (websiteCol.rows.length === 0) {
      console.log("Pre-migration: adding website column...");
      await pool.query(`ALTER TABLE crm_properties ADD COLUMN website text`);
    }

    const billingCol = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'crm_properties' AND column_name = 'billing_entity_id'
    `);
    if (billingCol.rows.length === 0) {
      console.log("Pre-migration: adding billing_entity_id column...");
      await pool.query(`ALTER TABLE crm_properties ADD COLUMN billing_entity_id varchar`);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_property_clients (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id varchar NOT NULL,
        contact_id varchar NOT NULL,
        role text,
        created_at timestamp DEFAULT now(),
        UNIQUE(property_id, contact_id)
      )
    `);
  } catch (err: any) {
    console.error("Pre-migration error:", err?.message);
  } finally {
    await pool.end();
  }
}

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "agentmail",
  "axios",
  "connect-pg-simple",
  "cors",
  "csv-parse",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "exceljs",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "mammoth",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "p-limit",
  "p-retry",
  "socket.io",
  "stripe",
  "uuid",
  "web-push",
  "ws",
  "xlsx",
  "xlsx-js-style",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await runPreMigrations();
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  if (existsSync("server/seed-data.sql.gz")) {
    await copyFile("server/seed-data.sql.gz", "dist/seed-data.sql.gz");
    console.log("copied seed-data.sql.gz to dist/");
  }

  if (existsSync("server/seed-investment-tracker.sql.gz")) {
    await copyFile("server/seed-investment-tracker.sql.gz", "dist/seed-investment-tracker.sql.gz");
    console.log("copied seed-investment-tracker.sql.gz to dist/");
  }

  if (existsSync("server/seed-letting-tracker.sql.gz")) {
    await copyFile("server/seed-letting-tracker.sql.gz", "dist/seed-letting-tracker.sql.gz");
    console.log("copied seed-letting-tracker.sql.gz to dist/");
  }

  if (existsSync("server/investment_tracker_seed.json")) {
    await copyFile("server/investment_tracker_seed.json", "dist/investment_tracker_seed.json");
    console.log("copied investment_tracker_seed.json to dist/");
  }

  if (existsSync("server/seed-leasing-schedule.sql.gz")) {
    await copyFile("server/seed-leasing-schedule.sql.gz", "dist/seed-leasing-schedule.sql.gz");
    console.log("copied seed-leasing-schedule.sql.gz to dist/");
  }

  if (existsSync("server/seed-properties.sql.gz")) {
    await copyFile("server/seed-properties.sql.gz", "dist/seed-properties.sql.gz");
    console.log("copied seed-properties.sql.gz to dist/");
  }

  if (existsSync("server/seed-companies.sql.gz")) {
    await copyFile("server/seed-companies.sql.gz", "dist/seed-companies.sql.gz");
    console.log("copied seed-companies.sql.gz to dist/");
  }

  if (existsSync("server/seed-company-deals.sql.gz")) {
    await copyFile("server/seed-company-deals.sql.gz", "dist/seed-company-deals.sql.gz");
    console.log("copied seed-company-deals.sql.gz to dist/");
  }

  // Copy brand assets used by server-side Excel/PDF builders
  if (existsSync("server/assets")) {
    await mkdir("dist/server/assets", { recursive: true });
    for (const f of ["BGP_BlackHolder.png", "BGP_WhiteHolder.png"]) {
      if (existsSync(`server/assets/${f}`)) {
        await copyFile(`server/assets/${f}`, `dist/server/assets/${f}`);
        console.log(`copied server/assets/${f} to dist/server/assets/`);
      }
    }
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
