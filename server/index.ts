import express, { type Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception — shutting down:", err);
  setTimeout(() => process.exit(1), 1000);
});
import { registerRoutes } from "./routes";
import { setupAuth } from "./auth";
import { setupMicrosoftRoutes } from "./microsoft";
import { setupMondayRoutes } from "./monday";
import { setupWhatsAppRoutes } from "./whatsapp";
import { setupChatBGPRoutes } from "./chatbgp";
import { setupNewsIntelligenceRoutes } from "./news-intelligence";
import { setupNewsFeedRoutes } from "./news-feeds";
import { setupModelsRoutes } from "./models";
import { setupDocumentTemplateRoutes } from "./document-templates";
import { setupCanvaRoutes } from "./canva";
import { setupXeroRoutes } from "./xero";
import { registerLandRegistryRoutes } from "./land-registry";
// Simple request queue for AI endpoints
const activeRequests = new Set<string>();
const requestQueue: Array<{ req: Request; res: Response; next: NextFunction }> = [];
const MAX_CONCURRENT_AI_REQUESTS = 3;
import { registerVoaRoutes } from "./voa";
import { registerLegalDDRoutes } from "./legal-dd";
import { setupSharedMailboxRoutes } from "./shared-mailbox";
import { registerInteractionRoutes } from "./interactions";
import { setupCrmRoutes, startAutoEnrichment } from "./crm";
import { setupMondayImportRoutes } from "./monday-import";
import companiesHouseRouter from "./companies-house";
import sanctionsRouter from "./sanctions-screening";
import kycClouseauRouter, { runMonthlyReScreening } from "./kyc-clouseau";
import leasingScheduleRouter from "./leasing-schedule";
import tenancyScheduleRouter from "./tenancy-schedule";
import turnoverRouter from "./turnover";
import { serveStatic } from "./static";
import { registerEmailProcessorRoutes, startEmailProcessor } from "./email-processor";
import { registerHealthCheckRoutes, startHealthCheck } from "./health-check";
import { setupArchivistRoutes, startArchivist } from "./archivist";
import { registerAIIntelligenceRoutes } from "./ai-intelligence";
import { setupLeadsRoutes } from "./leads";
import { registerMcpRoutes } from "./mcp-server";
import { setupWebSocket } from "./websocket";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

// Railway health check — unauthenticated, before all middleware
app.get("/api/ping", (_req, res) => res.json({ status: "ok" }));

const MAINTENANCE_MODE = false;
const MAINTENANCE_ALLOWED_EMAILS = new Set([
  "woody@brucegillinghampollard.com",
]);

app.use(async (req: any, res, next) => {
  if (!MAINTENANCE_MODE) return next();
  // Always allow auth routes so login still works
  if (req.path.startsWith("/api/auth") || req.path.startsWith("/api/branding")) return next();
  // Allow static assets (JS/CSS/images) so the login page renders on mobile
  if (req.path.match(/\.(js|css|png|jpg|svg|ico|woff|woff2|ttf|webp|map)$/)) return next();

  // Check if this user's session email is in the allowed list
  const userId = req.session?.userId;
  if (userId) {
    try {
      const row = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
      const email = row.rows[0]?.email?.toLowerCase().trim();
      if (email && MAINTENANCE_ALLOWED_EMAILS.has(email)) return next();
    } catch {}
  }

  // Block API calls with JSON
  if (req.path.startsWith("/api/")) {
    return res.status(503).json({ error: "maintenance", message: "Dashboard is temporarily down for maintenance." });
  }

  // Block everyone else with the maintenance page (works on mobile too)
  res.status(503).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BGP Dashboard — Maintenance</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}.container{max-width:480px;padding:40px}h1{font-size:28px;margin-bottom:12px;color:#c9a96e}p{font-size:16px;line-height:1.6;color:#aab;margin-bottom:8px}.logo{font-size:14px;letter-spacing:3px;color:#888;margin-bottom:32px}</style></head><body><div class="container"><div class="logo">BRUCE GILLINGHAM POLLARD</div><h1>Scheduled Maintenance</h1><p>We're making some improvements. The dashboard will be back shortly.</p><p style="margin-top:24px;font-size:13px;color:#667">If you need urgent assistance, please contact the team directly.</p></div></body></html>`);
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
});
app.use("/api/login", loginLimiter);
app.use("/api/auth/microsoft", loginLimiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const p = req.originalUrl || req.path;
    return (
      p.startsWith("/api/chat") ||
      p.startsWith("/api/ai/") ||
      p.startsWith("/api/chatbgp")
    );
  },
  message: { message: "Too many requests. Please slow down and try again." },
});
app.use("/api/", apiLimiter);

function trackAndProcessRequest(requestId: string, res: import("express").Response, next: import("express").NextFunction) {
  activeRequests.add(requestId);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    activeRequests.delete(requestId);
    while (requestQueue.length > 0) {
      const queued = requestQueue.shift();
      if (queued && !queued.res.headersSent && !queued.res.destroyed && !queued.res.writableEnded) {
        const nextId = `queued-${Date.now()}-${Math.random()}`;
        setImmediate(() => trackAndProcessRequest(nextId, queued.res, queued.next));
        return;
      }
    }
  };
  res.on('finish', cleanup);
  res.on('close', cleanup);
  next();
}

app.use((req, res, next) => {
  const isAiRoute = req.path.startsWith('/api/chatbgp/chat') ||
    req.path.startsWith('/api/ai/') ||
    req.path.includes('/visual-auto-design') ||
    req.path.includes('/visual-design-chat') ||
    req.path.startsWith('/api/models/');
  if (!isAiRoute) {
    return next();
  }
  if (activeRequests.size < MAX_CONCURRENT_AI_REQUESTS) {
    const requestId = `${req.ip}-${Date.now()}-${Math.random()}`;
    return trackAndProcessRequest(requestId, res, next);
  }
  if (requestQueue.length >= 10) {
    return res.status(503).json({ error: 'Server too busy', message: 'Too many requests. Please try again in a few moments.' });
  }
  requestQueue.push({ req, res, next });
});

app.use((req, res, next) => {
  let timeoutMs = 45000;
  if (req.path.includes('/doc-templates/upload')) {
    timeoutMs = 240000;
  } else if (req.path.includes('/chatbgp/chat')) {
    timeoutMs = 300000;
  } else if (req.path.startsWith('/api/chat') || req.path.startsWith('/api/ai/') || req.path.includes('/visual-auto-design') || req.path.includes('/visual-design-chat') || req.path.startsWith('/api/models/') || req.path.includes('/kyc-clouseau/investigate')) {
    timeoutMs = 120000;
  }
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout', message: 'The server took too long to respond. Please try again.' });
    }
  }, timeoutMs);
  res.on('finish', () => clearTimeout(timeout));
  res.on('close', () => clearTimeout(timeout));
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      const safeToLogRoutes = ["/api/config/", "/api/push/", "/api/heartbeat"];
      const isSafeToLog = safeToLogRoutes.some(r => path.startsWith(r));
      if (capturedJsonResponse && isSafeToLog) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

app.use("/api/branding/fonts", express.static(
  process.cwd() + "/server/assets/branding/fonts",
  { maxAge: "7d", immutable: true }
));

app.use("/api/branding/assets", express.static(
  process.cwd() + "/server/assets/branding",
  { maxAge: "7d", immutable: true }
));

(async () => {
  setupAuth(app);
  setupMicrosoftRoutes(app);
  setupMondayRoutes(app);
  setupWhatsAppRoutes(app);
  setupChatBGPRoutes(app);
  setupArchivistRoutes(app);
  setupNewsIntelligenceRoutes(app);
  setupNewsFeedRoutes(app);
  setupModelsRoutes(app);
  setupDocumentTemplateRoutes(app);
  setupCanvaRoutes(app);
  setupXeroRoutes(app);
  registerLandRegistryRoutes(app);
  registerVoaRoutes(app);
  registerLegalDDRoutes(app);
  setupSharedMailboxRoutes(app);
  registerInteractionRoutes(app);

  registerEmailProcessorRoutes(app);
  registerHealthCheckRoutes(app);
  registerAIIntelligenceRoutes(app);
  setupLeadsRoutes(app);
  registerMcpRoutes(app);
  setupCrmRoutes(app);
  setupMondayImportRoutes(app);
  app.use(companiesHouseRouter);
  app.use(leasingScheduleRouter);
  app.use(tenancyScheduleRouter);
  app.use(turnoverRouter);
  app.use(sanctionsRouter);
  app.use(kycClouseauRouter);

  await registerRoutes(httpServer, app);
  setupWebSocket(httpServer);

  app.all("/api/{*path}", (_req: Request, res: Response) => {
    res.status(404).json({ message: "Not found" });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
      // startEmailProcessor(); // DISABLED - maintenance mode
      setTimeout(() => startHealthCheck(), 10000);
      setTimeout(() => startAutoEnrichment(), 30000);
      setTimeout(async () => {
        try {
          const { startImageSync } = await import("./image-studio");
          startImageSync();
        } catch (e: any) {
          console.error("[image-sync] Failed to start:", e.message);
        }
      }, 60000);
      setTimeout(() => startArchivist(), 300000);
      // KYC monthly re-screening cron (check daily, run on 1st of month)
      setInterval(() => {
        const now = new Date();
        if (now.getDate() === 1 && now.getHours() === 3) {
          runMonthlyReScreening().catch(err =>
            console.error("[kyc-cron] Monthly re-screening failed:", err?.message)
          );
        }
      }, 60 * 60 * 1000); // Check every hour
      setTimeout(async () => {
        try {
          const { db } = await import("./db");
          const { sql } = await import("drizzle-orm");
          const addColIfMissing = async (table: string, col: string, colType: string) => {
            const check = await db.execute(sql`
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = ${table} AND column_name = ${col}
            `);
            if ((check as any).rows?.length === 0) {
              console.log(`Adding ${col} to ${table}...`);
              await db.execute(sql.raw(`ALTER TABLE "${table}" ADD COLUMN "${col}" ${colType}`));
            }
          };
          await addColIfMissing("crm_requirements_leasing", "bgp_contact_user_ids", "text[]");
          await addColIfMissing("crm_requirements_investment", "bgp_contact_user_ids", "text[]");
          await addColIfMissing("crm_properties", "website", "text");
          await addColIfMissing("crm_properties", "billing_entity_id", "varchar");
          await addColIfMissing("investment_tracker", "client_id", "varchar");
          await addColIfMissing("investment_tracker", "client_contact_id", "varchar");
          await addColIfMissing("investment_tracker", "vendor_id", "varchar");
          await addColIfMissing("investment_tracker", "vendor_agent_id", "varchar");
          await addColIfMissing("crm_contacts", "last_enriched_at", "timestamp");
          await addColIfMissing("crm_contacts", "enrichment_source", "text");
          await addColIfMissing("crm_companies", "last_enriched_at", "timestamp");
          await addColIfMissing("crm_companies", "enrichment_source", "text");
          await addColIfMissing("users", "additional_teams", "text[]");

          await db.execute(sql.raw(`
            UPDATE users SET additional_teams = ARRAY['Landsec']
            WHERE LOWER(email) IN (
              'emily@brucegillinghampollard.com',
              'emilyc@brucegillinghampollard.com',
              'lucyg@brucegillinghampollard.com',
              'luke@brucegillinghampollard.com',
              'rob@brucegillinghampollard.com',
              'tom@brucegillinghampollard.com'
            ) AND (additional_teams IS NULL OR additional_teams = '{}')
          `));

          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS crm_property_clients (
              id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
              property_id varchar NOT NULL,
              contact_id varchar NOT NULL,
              role text,
              created_at timestamp DEFAULT now(),
              UNIQUE(property_id, contact_id)
            )
          `));

          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS target_tenants (
              id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
              unit_id varchar NOT NULL,
              property_id varchar NOT NULL,
              company_id varchar,
              brand_name text NOT NULL,
              rationale text,
              quality_rating text NOT NULL DEFAULT 'amber',
              status text NOT NULL DEFAULT 'suggested',
              suggested_by text NOT NULL DEFAULT 'ai',
              approved_by varchar,
              outcome text,
              created_at timestamp DEFAULT now(),
              updated_at timestamp DEFAULT now()
            )
          `));
        } catch (err: any) {
          console.error("Startup migration error:", err?.message);
        }

        try {
          const { seedDatabase } = await import("./seed");
          await seedDatabase();
        } catch (err: any) {
          console.error("Seed error:", err);
        }

        // Ensure all team members exist (catches new additions that seed skips)
        try {
          const { pool: dbPool } = await import("./db");
          const { hashPassword } = await import("./auth");
          const newMembers = [
            { username: "johnny@brucegillinghampollard.com", name: "Johnny", email: "johnny@brucegillinghampollard.com" },
            { username: "daisy@brucegillinghampollard.com", name: "Daisy Driscoll", email: "daisy@brucegillinghampollard.com" },
          ];
          for (const m of newMembers) {
            const exists = await dbPool.query(`SELECT 1 FROM users WHERE username = $1 OR email = $2`, [m.username, m.email]);
            if (exists.rows.length === 0) {
              const hashed = await hashPassword("B@nd0077!");
              await dbPool.query(
                `INSERT INTO users (id, username, password, name, email, is_admin) VALUES (gen_random_uuid(), $1, $2, $3, $4, false)`,
                [m.username, hashed, m.name, m.email]
              );
              console.log(`[seed] Created user account: ${m.name} (${m.username})`);
            }
          }
        } catch (err: any) {
          console.error("User creation error:", err?.message);
        }

        try {
          const { seedInvestmentRequirements } = await import("./seed-invest-reqs");
          await seedInvestmentRequirements();
        } catch (err: any) {
          console.error("Investment requirements seed error:", err?.message);
        }

        // Seed properties if production has fewer than dev
        try {
          const { pool: dbPool } = await import("./db");
          const propCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_properties`);
          if (parseInt(propCount.rows[0].cnt) < 800) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-properties.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-properties.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding properties from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); seeded++; } catch (_) {}
              }
              console.log(`[seed] Seeded ${seeded} properties`);
            }
          }
        } catch (err: any) {
          console.error("Properties seed error:", err?.message);
        }

        // Seed companies if production has fewer than dev
        try {
          const { pool: dbPool } = await import("./db");
          const compCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_companies`);
          if (parseInt(compCount.rows[0].cnt) < 3600) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-companies.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-companies.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding companies from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); seeded++; } catch (_) {}
              }
              console.log(`[seed] Seeded ${seeded} companies`);
            }
          }
        } catch (err: any) {
          console.error("Companies seed error:", err?.message);
        }

        // Seed company-property links
        try {
          const { pool: dbPool } = await import("./db");
          const cpCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_company_properties`);
          if (parseInt(cpCount.rows[0].cnt) < 460) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-company-properties.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-company-properties.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding company-property links from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); seeded++; } catch (_) {}
              }
              console.log(`[seed] Seeded ${seeded} company-property links`);
            }
          }
        } catch (err: any) {
          console.error("Company-property links seed error:", err?.message);
        }

        // Sync deal company/property references from dev
        try {
          const { pool: dbPool } = await import("./db");
          const checkSync = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_deals WHERE landlord_id = '8f24f46b-77f9-4b32-bb30-63ee1c6cafb7'`);
          if (parseInt(checkSync.rows[0].cnt) < 80) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-deal-links.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-deal-links.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Syncing deal company/property references from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("UPDATE"));
              let synced = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); synced++; } catch (_) {}
              }
              console.log(`[seed] Synced ${synced} deal references`);
            }
          }
        } catch (err: any) {
          console.error("Deal links sync error:", err?.message);
        }

        // Seed company-deal links
        try {
          const { pool: dbPool } = await import("./db");
          const linkCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_company_deals`);
          if (parseInt(linkCount.rows[0].cnt) < 880) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-company-deals.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-company-deals.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding company-deal links from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); seeded++; } catch (_) {}
              }
              console.log(`[seed] Seeded ${seeded} company-deal links`);
            }
          }
        } catch (err: any) {
          console.error("Company-deals seed error:", err?.message);
        }

        try {
          const { pool: dbPool } = await import("./db");
          const leasingCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM leasing_schedule_units`);
          if (parseInt(leasingCount.rows[0].cnt) < 500) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-leasing-schedule.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-leasing-schedule.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding leasing schedule data from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try {
                  await dbPool.query(stmt);
                  seeded++;
                } catch (seedErr: any) {
                  /* skip duplicates */
                }
              }
              console.log(`[seed] Seeded ${seeded} leasing schedule units`);
            }
          }
        } catch (err: any) {
          console.error("Leasing schedule seed error:", err?.message);
        }

        try {
          const { pool: dbPool } = await import("./db");
          const dupLandsec = await dbPool.query(`SELECT id FROM crm_companies WHERE LOWER(name) = 'land sec' AND id != '8f24f46b-77f9-4b32-bb30-63ee1c6cafb7'`);
          if (dupLandsec.rows.length > 0) {
            const dupId = dupLandsec.rows[0].id;
            const mainId = '8f24f46b-77f9-4b32-bb30-63ee1c6cafb7';
            const moveDeals = await dbPool.query(`UPDATE crm_deals SET landlord_id = $1 WHERE landlord_id = $2`, [mainId, dupId]);
            const moveContacts = await dbPool.query(`UPDATE crm_contacts SET company_id = $1 WHERE company_id = $2`, [mainId, dupId]);
            const moveProps = await dbPool.query(`UPDATE crm_properties SET landlord_id = $1 WHERE landlord_id = $2`, [mainId, dupId]);
            const moveCompanyDeals = await dbPool.query(`UPDATE crm_company_deals SET company_id = $1 WHERE company_id = $2`, [mainId, dupId]);
            await dbPool.query(`DELETE FROM crm_companies WHERE id = $1`, [dupId]);
            console.log(`[data-merge] Merged duplicate 'Land Sec' (${dupId}) into LandSec: ${moveDeals.rowCount} deals, ${moveContacts.rowCount} contacts, ${moveProps.rowCount} properties, ${moveCompanyDeals.rowCount} company-deal links`);
          }
        } catch (err: any) {
          console.error("[data-merge] Landsec merge error:", err?.message);
        }

        try {
          const { pool: dbPool } = await import("./db");
          const junkDel = await dbPool.query(`DELETE FROM wip_entries WHERE (ref = 'Total' OR ref LIKE 'Applied filters%') OR (deal_status IS NULL AND group_name IS NULL AND project IS NULL)`);
          if (junkDel.rowCount && junkDel.rowCount > 0) {
            console.log(`[wip-cleanup] Removed ${junkDel.rowCount} junk WIP rows`);
          }
          const statusFix1 = await dbPool.query(`UPDATE crm_deals SET status = 'SOLs' WHERE status = 'Solicitors'`);
          const statusFix2 = await dbPool.query(`UPDATE crm_deals SET status = 'Live' WHERE status = 'Active'`);
          if ((statusFix1.rowCount || 0) + (statusFix2.rowCount || 0) > 0) {
            console.log(`[status-fix] Updated ${(statusFix1.rowCount || 0) + (statusFix2.rowCount || 0)} deal statuses`);
          }
        } catch (err: any) {
          console.error("WIP cleanup error:", err?.message);
        }

        try {
          const { pool: dbPool } = await import("./db");
          const { rows: wipCount } = await dbPool.query(`SELECT COUNT(*) as c FROM wip_entries`);
          const { rows: dealCount } = await dbPool.query(`SELECT COUNT(*) as c FROM crm_deals`);
          if (parseInt(wipCount[0]?.c || "0") > 0 && parseInt(dealCount[0]?.c || "0") === 0) {
            console.log(`[wip-sync] WIP entries found but no CRM deals — running auto-sync...`);
            const { syncWipToCrmDeals } = await import("./crm");
            await syncWipToCrmDeals(dbPool);
            console.log(`[wip-sync] Auto-sync complete`);
          }
        } catch (err: any) {
          console.error("[wip-sync] error:", err?.message);
        }
      }, 1000);
    },
  );
})();
