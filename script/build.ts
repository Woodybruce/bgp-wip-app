import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, copyFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import pg from "pg";
import sharp from "sharp";

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

    // KYC documents — proof of funds, certified passport, etc.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kyc_documents (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id varchar,
        contact_id varchar,
        deal_id varchar,
        doc_type text NOT NULL,
        file_url text NOT NULL,
        file_name text NOT NULL,
        file_size integer,
        mime_type text,
        certified_by text,
        certified_at timestamp,
        expires_at timestamp,
        notes text,
        uploaded_by varchar,
        uploaded_at timestamp DEFAULT now(),
        deleted_at timestamp
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kyc_documents_company_id ON kyc_documents(company_id) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kyc_documents_contact_id ON kyc_documents(contact_id) WHERE deleted_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kyc_documents_deal_id ON kyc_documents(deal_id) WHERE deleted_at IS NULL`);

    // Company-level AML approval columns
    const companyAmlCols: Array<[string, string]> = [
      ["kyc_approved_by", "text"],
      ["kyc_expires_at", "timestamp"],
      ["aml_checklist", "jsonb"],
      ["aml_risk_level", "text"],
      ["aml_pep_status", "text"],
      ["aml_source_of_wealth", "text"],
      ["aml_source_of_wealth_notes", "text"],
      ["aml_edd_required", "boolean DEFAULT false"],
      ["aml_edd_reason", "text"],
      ["aml_notes", "text"],
    ];
    for (const [col, type] of companyAmlCols) {
      await pool.query(`ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    }

    // Veriff biometric verification sessions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS veriff_sessions (
        session_id text PRIMARY KEY,
        company_id varchar,
        contact_id varchar,
        deal_id varchar,
        first_name text NOT NULL,
        last_name text NOT NULL,
        email text,
        status text,
        decision_code integer,
        decision_reason text,
        verdict_person jsonb,
        verdict_document jsonb,
        verification_url text,
        requested_by varchar,
        created_at timestamp DEFAULT now(),
        received_at timestamp
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_veriff_sessions_company ON veriff_sessions(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_veriff_sessions_deal ON veriff_sessions(deal_id)`);

    // Firm-wide risk assessment — approval + review-cycle columns
    const amlSettingsCols: Array<[string, string]> = [
      ["firm_risk_assessment_status", "text"],
      ["firm_risk_assessment_approved_at", "timestamp"],
      ["firm_risk_assessment_approved_by", "text"],
      ["firm_risk_assessment_next_review_at", "timestamp"],
    ];
    for (const [col, type] of amlSettingsCols) {
      await pool.query(`ALTER TABLE aml_settings ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    }

    // Training modules — content + quiz + per-user attempts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aml_training_modules (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        title text NOT NULL,
        description text,
        content_markdown text NOT NULL,
        quiz jsonb NOT NULL DEFAULT '[]'::jsonb,
        pass_score integer DEFAULT 80,
        estimated_minutes integer,
        required_for_roles text[],
        active boolean DEFAULT true,
        created_by varchar,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aml_training_attempts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        module_id varchar NOT NULL,
        user_id varchar NOT NULL,
        user_name text,
        answers jsonb NOT NULL,
        score integer NOT NULL,
        passed boolean NOT NULL,
        started_at timestamp DEFAULT now(),
        completed_at timestamp
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_aml_training_attempts_user ON aml_training_attempts(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_aml_training_attempts_module ON aml_training_attempts(module_id)`);
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

  // Generate PNG icons for the Excel add-in manifest. Office requires PNG
  // (not SVG). We derive them from the existing icon.svg at the required sizes.
  const svgSrc = await readFile("client/public/icon.svg");
  for (const size of [16, 32, 64, 80, 128, 192]) {
    const dest = `dist/public/icon-${size}.png`;
    await sharp(svgSrc).resize(size, size).png().toFile(dest);
  }
  console.log("generated PNG icons for Excel add-in manifest");

  // Bump the Service Worker cache name to the build timestamp so old caches
  // (and the stale HTML/asset map they hold) get evicted on next deploy.
  const swPath = "dist/public/sw.js";
  if (existsSync(swPath)) {
    try {
      const buildStamp = `bgp-${Date.now()}`;
      const swSrc = await readFile(swPath, "utf-8");
      const swBumped = swSrc.replace(/var CACHE_NAME = '[^']+';/, `var CACHE_NAME = '${buildStamp}';`);
      if (swBumped !== swSrc) {
        await writeFile(swPath, swBumped);
        console.log(`Service worker cache name bumped to ${buildStamp}`);
      }
    } catch (err: any) {
      console.warn("SW cache bump failed:", err?.message);
    }
  }

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
