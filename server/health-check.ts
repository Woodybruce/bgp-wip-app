import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";

const TWELVE_HOURS = 12 * 60 * 60 * 1000;
let healthCheckInterval: NodeJS.Timeout | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let isRunning = false;
let lastRunAt: Date | null = null;
let lastReport: HealthReport | null = null;

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface HealthReport {
  timestamp: string;
  durationMs: number;
  checks: CheckResult[];
  summary: { pass: number; warn: number; fail: number };
}

async function checkDatabaseConnectivity(): Promise<CheckResult> {
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    const ms = Date.now() - start;
    if (ms > 2000) {
      return { name: "Database connectivity", status: "warn", detail: `Connected but slow (${ms}ms)` };
    }
    return { name: "Database connectivity", status: "pass", detail: `OK (${ms}ms)` };
  } catch (e: any) {
    return { name: "Database connectivity", status: "fail", detail: e.message };
  }
}

async function checkDatabasePool(): Promise<CheckResult> {
  try {
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const waiting = pool.waitingCount;
    if (waiting > 5) {
      return { name: "Database pool", status: "warn", detail: `${waiting} queries waiting (total=${total}, idle=${idle})` };
    }
    return { name: "Database pool", status: "pass", detail: `total=${total}, idle=${idle}, waiting=${waiting}` };
  } catch (e: any) {
    return { name: "Database pool", status: "fail", detail: e.message };
  }
}

async function checkMemoryUsage(): Promise<CheckResult> {
  const usage = process.memoryUsage();
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(usage.rss / 1024 / 1024);
  const pct = Math.round((usage.heapUsed / usage.heapTotal) * 100);

  if (rssMB > 1500) {
    return { name: "Memory usage", status: "warn", detail: `RSS=${rssMB}MB, Heap=${heapUsedMB}/${heapTotalMB}MB (${pct}%)` };
  }
  return { name: "Memory usage", status: "pass", detail: `RSS=${rssMB}MB, Heap=${heapUsedMB}/${heapTotalMB}MB (${pct}%)` };
}

async function checkTableCounts(): Promise<CheckResult> {
  try {
    const tables = ["users", "crm_companies", "crm_contacts", "crm_properties", "crm_deals", "chat_messages", "news_articles"];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const r = await pool.query(`SELECT COUNT(*)::int as c FROM "${t}"`);
      counts[t] = r.rows[0].c;
    }
    const detail = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ");
    return { name: "Table row counts", status: "pass", detail };
  } catch (e: any) {
    return { name: "Table row counts", status: "fail", detail: e.message };
  }
}

async function checkOrphanedRecords(): Promise<CheckResult> {
  try {
    const warnings: string[] = [];

    const orphanedDeals = await pool.query(
      `SELECT COUNT(*)::int as c FROM crm_deals d WHERE d.property_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_properties p WHERE p.id = d.property_id)`
    );
    if (orphanedDeals.rows[0].c > 0) {
      warnings.push(`${orphanedDeals.rows[0].c} deals reference missing properties`);
    }

    const orphanedContacts = await pool.query(
      `SELECT COUNT(*)::int as c FROM crm_contacts c WHERE c.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_companies co WHERE co.id = c.company_id)`
    );
    if (orphanedContacts.rows[0].c > 0) {
      warnings.push(`${orphanedContacts.rows[0].c} contacts reference missing companies`);
    }

    const orphanedMessages = await pool.query(
      `SELECT COUNT(*)::int as c FROM chat_messages m WHERE NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = m.thread_id)`
    );
    if (orphanedMessages.rows[0].c > 0) {
      warnings.push(`${orphanedMessages.rows[0].c} chat messages reference missing threads`);
    }

    if (warnings.length > 0) {
      return { name: "Orphaned records", status: "warn", detail: warnings.join("; ") };
    }
    return { name: "Orphaned records", status: "pass", detail: "No orphaned records found" };
  } catch (e: any) {
    return { name: "Orphaned records", status: "fail", detail: e.message };
  }
}

async function checkExpiredSessions(): Promise<CheckResult> {
  try {
    const expired = await pool.query(
      `SELECT COUNT(*)::int as c FROM session WHERE expire < NOW()`
    );
    const count = expired.rows[0].c;
    if (count > 1000) {
      return { name: "Expired sessions", status: "warn", detail: `${count} expired sessions (consider cleanup)` };
    }
    return { name: "Expired sessions", status: "pass", detail: `${count} expired sessions` };
  } catch (e: any) {
    return { name: "Expired sessions", status: "warn", detail: `Session table check failed: ${e.message}` };
  }
}

async function checkExpiredTokens(): Promise<CheckResult> {
  try {
    const expired = await pool.query(
      `SELECT COUNT(*)::int as c FROM auth_tokens WHERE expires_at < NOW()`
    );
    const count = expired.rows[0].c;
    if (count > 500) {
      return { name: "Expired auth tokens", status: "warn", detail: `${count} expired tokens (consider cleanup)` };
    }
    return { name: "Expired auth tokens", status: "pass", detail: `${count} expired tokens` };
  } catch (e: any) {
    return { name: "Expired auth tokens", status: "warn", detail: `Token table check failed: ${e.message}` };
  }
}

async function checkDuplicateContacts(): Promise<CheckResult> {
  try {
    const dupes = await pool.query(
      `SELECT LOWER(TRIM(name)) as norm_name, COUNT(*)::int as c FROM crm_contacts GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) > 1 LIMIT 10`
    );
    if (dupes.rows.length > 0) {
      const total = dupes.rows.reduce((sum: number, r: any) => sum + r.c, 0);
      return { name: "Duplicate contacts", status: "warn", detail: `${total} potential duplicates across ${dupes.rows.length}+ names` };
    }
    return { name: "Duplicate contacts", status: "pass", detail: "No duplicate contact names found" };
  } catch (e: any) {
    return { name: "Duplicate contacts", status: "fail", detail: e.message };
  }
}

async function checkServerUptime(): Promise<CheckResult> {
  const uptimeSec = process.uptime();
  const hours = Math.floor(uptimeSec / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  return { name: "Server uptime", status: "pass", detail: `${hours}h ${mins}m` };
}

async function runHealthCheck(): Promise<HealthReport> {
  if (isRunning) {
    if (lastReport) return lastReport;
    return { timestamp: new Date().toISOString(), durationMs: 0, checks: [], summary: { pass: 0, warn: 0, fail: 0 } };
  }

  isRunning = true;
  try {
    const start = Date.now();
    const checks = await Promise.all([
      checkDatabaseConnectivity(),
      checkDatabasePool(),
      checkMemoryUsage(),
      checkServerUptime(),
      checkTableCounts(),
      checkOrphanedRecords(),
      checkExpiredSessions(),
      checkExpiredTokens(),
      checkDuplicateContacts(),
    ]);

    const summary = {
      pass: checks.filter(c => c.status === "pass").length,
      warn: checks.filter(c => c.status === "warn").length,
      fail: checks.filter(c => c.status === "fail").length,
    };

    const report: HealthReport = {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
      checks,
      summary,
    };

    lastRunAt = new Date();
    lastReport = report;

    const icon = summary.fail > 0 ? "❌" : summary.warn > 0 ? "⚠️" : "✅";
    console.log(`[health-check] ${icon} ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail (${report.durationMs}ms)`);

    for (const c of checks) {
      if (c.status !== "pass") {
        console.log(`[health-check]   ${c.status === "fail" ? "FAIL" : "WARN"}: ${c.name} — ${c.detail}`);
      }
    }

    return report;
  } finally {
    isRunning = false;
  }
}

async function isAdmin(req: Request): Promise<boolean> {
  const userId = req.session?.userId || (req as any).tokenUserId;
  if (!userId) return false;
  try {
    const result = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
    return !!result.rows[0]?.is_admin;
  } catch {
    return false;
  }
}

export function startHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  if (startupTimeout) {
    clearTimeout(startupTimeout);
  }

  console.log("[health-check] Scheduled — running every 12 hours");

  startupTimeout = setTimeout(() => {
    startupTimeout = null;
    runHealthCheck().catch(err => console.error("[health-check] Initial run failed:", err.message));
  }, 30_000);

  healthCheckInterval = setInterval(() => {
    runHealthCheck().catch(err => console.error("[health-check] Scheduled run failed:", err.message));
  }, TWELVE_HOURS);
}

export function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  console.log("[health-check] Stopped");
}

export function registerHealthCheckRoutes(app: Express) {
  app.get("/api/health", requireAuth, async (req: Request, res: Response) => {
    if (!(await isAdmin(req))) {
      return res.status(403).json({ message: "Admin access required" });
    }
    try {
      const report = await runHealthCheck();
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/health/last", requireAuth, async (req: Request, res: Response) => {
    if (!(await isAdmin(req))) {
      return res.status(403).json({ message: "Admin access required" });
    }
    res.json({
      lastRunAt: lastRunAt?.toISOString() || null,
      report: lastReport,
    });
  });
}
