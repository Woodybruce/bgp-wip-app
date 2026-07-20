import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import path from "node:path";
import { db, pool } from "./db";
import { requireAuth } from "./auth";
import { systemSettings, crmRequirementsLeasing } from "@shared/schema";
import { eq } from "drizzle-orm";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";
import { findOrCreateCompany, findOrCreateContact, requirementExists, mapSizeToBuckets, mapPitchToRequirementType } from "./crm";
import { graphRequest } from "./shared-mailbox";
import { saveFile } from "./file-storage";

const SHARED_MAILBOX = "chatbgp@brucegillinghampollard.com";
const INGEST_INTERVAL_HOURS = 6;
const DEFAULT_LOOKBACK_DAYS = 14;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_MAILBOX = 4;
const MAX_REQUIREMENTS_PER_EMAIL = 3;
const MAX_FLYER_BYTES = 15 * 1024 * 1024;

// Sender/subject/body substrings that mark an email as a PIP mailout candidate.
// The AI extraction step is the real filter — this just keeps the AI spend down.
const PIP_MARKERS = (process.env.PIP_MAILOUT_MARKERS || "pipnet")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

let ingestRunning = false;
let ingestProgress = "";

async function getSetting(key: string): Promise<any> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: any): Promise<void> {
  await db.insert(systemSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
}

function htmlToText(html: string): string {
  return (html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isPipCandidate(msg: any, bodyText: string): boolean {
  const from = msg.from?.emailAddress?.address?.toLowerCase() || "";
  const haystack = `${from} ${(msg.subject || "").toLowerCase()} ${bodyText.slice(0, 2000).toLowerCase()}`;
  return PIP_MARKERS.some((m) => haystack.includes(m));
}

function messageKey(msg: any): string {
  if (msg.internetMessageId) return msg.internetMessageId;
  const from = msg.from?.emailAddress?.address || "unknown";
  return `${from}|${msg.subject || ""}|${(msg.receivedDateTime || "").slice(0, 10)}`;
}

interface ExtractedRequirement {
  clientName: string;
  agentCompany?: string | null;
  agentContactName?: string | null;
  agentContactEmail?: string | null;
  agentContactPhone?: string | null;
  sizeText?: string | null;
  locations?: string[] | null;
  useClass?: string | null;
  pitch?: string | null;
  tenure?: string | null;
  notes?: string | null;
}

async function extractRequirements(subject: string, bodyText: string): Promise<{ isMailout: boolean; requirements: ExtractedRequirement[] }> {
  const prompt = `You are parsing an email received by a UK retail property consultancy. Decide whether it is a PIP/PIPnet property REQUIREMENT mailout (an occupier or their agent circulating what premises a named retail/leisure brand is looking for). Newsletters, availability/disposal mailouts, invoices, and general correspondence are NOT requirement mailouts.

Subject: ${subject}

Body:
${bodyText.slice(0, 6000)}

Reply with ONLY a JSON object, no prose:
{
  "isRequirementMailout": true/false,
  "requirements": [
    {
      "clientName": "the occupier/brand seeking space (required)",
      "agentCompany": "retained agent firm or null",
      "agentContactName": "agent contact person or null",
      "agentContactEmail": "agent email or null",
      "agentContactPhone": "agent phone or null",
      "sizeText": "size requirement as stated, e.g. '2,000 - 5,000 sq ft', or null",
      "locations": ["target locations"] or null,
      "useClass": "use class or use type if stated, or null",
      "pitch": "pitch/location type wording e.g. 'high street', 'shopping centre', or null",
      "tenure": "tenure if stated, or null",
      "notes": "one-line summary of anything else material, or null"
    }
  ]
}
If it is not a requirement mailout, return {"isRequirementMailout": false, "requirements": []}.`;

  const response = await callClaude({
    model: CHATBGP_HELPER_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 1500,
    temperature: 0,
  });
  const raw = response?.choices?.[0]?.message?.content || "";
  const parsed = safeParseJSON(raw);
  const requirements = Array.isArray(parsed?.requirements)
    ? parsed.requirements.filter((r: any) => r?.clientName && typeof r.clientName === "string").slice(0, MAX_REQUIREMENTS_PER_EMAIL)
    : [];
  return { isMailout: !!parsed?.isRequirementMailout && requirements.length > 0, requirements };
}

async function attachFlyer(mailbox: string, messageId: string, requirementId: string): Promise<boolean> {
  const list = await graphRequest(
    `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments?$select=id,name,contentType,size,isInline`
  );
  const candidates = (list?.value || []).filter(
    (a: any) => !a.isInline && a["@odata.type"] !== "#microsoft.graph.itemAttachment" && (a.size || 0) <= MAX_FLYER_BYTES
  );
  if (candidates.length === 0) return false;
  const pdf = candidates.find((a: any) => (a.contentType || "").includes("pdf") || /\.pdf$/i.test(a.name || ""));
  const chosen = pdf || candidates.sort((a: any, b: any) => (b.size || 0) - (a.size || 0))[0];

  const full = await graphRequest(
    `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments/${chosen.id}`
  );
  if (!full?.contentBytes) return false;

  const buffer = Buffer.from(full.contentBytes, "base64");
  const ext = path.extname(full.name || "").toLowerCase() || ".pdf";
  const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  await saveFile(`landlord-packs/${uniqueName}`, buffer, full.contentType || "application/pdf", full.name || `flyer${ext}`);

  const landlordPack = JSON.stringify({
    url: `/api/crm/landlord-packs/${uniqueName}`,
    name: full.name || `flyer${ext}`,
    size: buffer.length,
  });
  await db.update(crmRequirementsLeasing).set({ landlordPack }).where(eq(crmRequirementsLeasing.id, requirementId));
  return true;
}

async function alreadyIngested(key: string): Promise<boolean> {
  const res = await pool.query("SELECT 1 FROM pip_ingested_emails WHERE message_key = $1 LIMIT 1", [key]);
  return res.rows.length > 0;
}

async function recordIngest(row: {
  key: string; mailbox: string; subject: string; from: string;
  requirementId?: string | null; status: string; detail?: string | null; receivedAt?: Date | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO pip_ingested_emails (message_key, mailbox, subject, from_address, requirement_id, status, detail, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (message_key) DO NOTHING`,
    [row.key, row.mailbox, row.subject, row.from, row.requirementId || null, row.status, row.detail || null, row.receivedAt || null]
  );
}

async function processMessage(mailbox: string, msg: any): Promise<{ status: string; created: number }> {
  const key = messageKey(msg);
  const subject = msg.subject || "(no subject)";
  const fromAddress = msg.from?.emailAddress?.address || "unknown";
  const receivedAt = msg.receivedDateTime ? new Date(msg.receivedDateTime) : null;
  const bodyText = htmlToText(msg.body?.content || msg.bodyPreview || "");

  let extraction: { isMailout: boolean; requirements: ExtractedRequirement[] };
  try {
    extraction = await extractRequirements(subject, bodyText);
  } catch (err: any) {
    await recordIngest({ key, mailbox, subject, from: fromAddress, status: "parse_failed", detail: err?.message?.slice(0, 500), receivedAt });
    return { status: "parse_failed", created: 0 };
  }

  if (!extraction.isMailout) {
    await recordIngest({ key, mailbox, subject, from: fromAddress, status: "not_requirement", receivedAt });
    return { status: "not_requirement", created: 0 };
  }

  let created = 0;
  let firstRequirementId: string | null = null;
  let duplicates = 0;

  for (const req of extraction.requirements) {
    const clientName = req.clientName.trim();
    if (!clientName || clientName === "[No Client Quoted]") continue;

    const companyId = await findOrCreateCompany(clientName);
    if (await requirementExists(clientName, companyId)) {
      duplicates++;
      continue;
    }

    let agentContactId: string | null = null;
    if (req.agentCompany) {
      const agentCompanyId = await findOrCreateCompany(req.agentCompany, { companyType: "Agent" });
      if (req.agentContactName) {
        agentContactId = await findOrCreateContact(req.agentContactName, {
          email: req.agentContactEmail || null,
          phone: req.agentContactPhone || null,
          companyId: agentCompanyId,
          companyName: req.agentCompany,
          contactType: "Agent",
          agentSpecialty: "Leasing",
        });
      }
    } else if (req.agentContactName) {
      agentContactId = await findOrCreateContact(req.agentContactName, {
        email: req.agentContactEmail || null,
        phone: req.agentContactPhone || null,
        contactType: "Agent",
        agentSpecialty: "Leasing",
      });
    }

    const sizeBuckets = req.sizeText ? mapSizeToBuckets(req.sizeText) : [];
    const reqType = mapPitchToRequirementType(req.pitch || null, req.notes || null);
    const requirementDate = receivedAt ? receivedAt.toISOString().slice(0, 10) : null;

    const [inserted] = await db.insert(crmRequirementsLeasing).values({
      name: clientName,
      companyId,
      principalContactId: null,
      agentContactId,
      use: req.useClass ? [req.useClass] : null,
      requirementType: reqType.length > 0 ? reqType : null,
      size: sizeBuckets.length > 0 ? sizeBuckets : null,
      requirementLocations: req.locations && req.locations.length > 0 ? req.locations : null,
      requirementDate,
      comments: [
        req.agentCompany ? `Agent: ${req.agentCompany}` : null,
        req.sizeText ? `Size: ${req.sizeText}` : null,
        req.tenure ? `Tenure: ${req.tenure}` : null,
        req.notes || null,
        `Source: PIP mailout — "${subject}"`,
      ].filter(Boolean).join("\n"),
      status: "Active",
    }).returning({ id: crmRequirementsLeasing.id });

    created++;
    if (!firstRequirementId) firstRequirementId = inserted.id;
  }

  if (created > 0 && firstRequirementId && msg.hasAttachments) {
    try {
      await attachFlyer(mailbox, msg.id, firstRequirementId);
    } catch (err: any) {
      console.warn(`[pip-ingest] Flyer attach failed for "${subject}": ${err?.message}`);
    }
  }

  const status = created > 0 ? "created" : duplicates > 0 ? "duplicate_requirement" : "not_requirement";
  await recordIngest({
    key, mailbox, subject, from: fromAddress,
    requirementId: firstRequirementId, status,
    detail: created > 0 ? `${created} requirement(s) created` : duplicates > 0 ? "Requirement already on the board" : null,
    receivedAt,
  });
  return { status, created };
}

async function scanMailbox(mailbox: string, cutoffISO: string, seenThisRun: Set<string>): Promise<{ scanned: number; created: number; duplicates: number; errors: number }> {
  let scanned = 0, created = 0, duplicates = 0, errors = 0;
  let nextUrl: string | null =
    `/users/${encodeURIComponent(mailbox)}/messages?$top=${PAGE_SIZE}&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${cutoffISO}&$select=id,subject,bodyPreview,body,from,receivedDateTime,hasAttachments,internetMessageId`;
  let pages = 0;

  while (nextUrl && pages < MAX_PAGES_PER_MAILBOX) {
    pages++;
    let data: any;
    try {
      data = await graphRequest(nextUrl);
    } catch (err: any) {
      // 403/404 = mailbox not accessible to the app registration — skip quietly
      if (/Graph API (403|404)/.test(err?.message || "")) return { scanned, created, duplicates, errors };
      throw err;
    }
    const messages = data?.value || [];
    if (messages.length === 0) break;

    for (const msg of messages) {
      const bodyText = htmlToText(msg.body?.content || msg.bodyPreview || "");
      if (!isPipCandidate(msg, bodyText)) continue;

      const key = messageKey(msg);
      if (seenThisRun.has(key)) continue;
      seenThisRun.add(key);
      if (await alreadyIngested(key)) continue;

      scanned++;
      try {
        const result = await processMessage(mailbox, msg);
        if (result.status === "created") created += result.created;
        if (result.status === "duplicate_requirement") duplicates++;
      } catch (err: any) {
        errors++;
        console.error(`[pip-ingest] Error processing "${msg.subject}" in ${mailbox}: ${err?.message}`);
      }
    }

    nextUrl = data["@odata.nextLink"] || null;
  }

  return { scanned, created, duplicates, errors };
}

export async function runPipEmailIngest(opts?: { lookbackDays?: number }): Promise<{ mailboxes: number; scanned: number; created: number; duplicates: number; errors: number }> {
  if (ingestRunning) {
    console.log("[pip-ingest] Already running, skipping");
    return { mailboxes: 0, scanned: 0, created: 0, duplicates: 0, errors: 0 };
  }
  ingestRunning = true;
  const startedAt = Date.now();
  const totals = { mailboxes: 0, scanned: 0, created: 0, duplicates: 0, errors: 0 };

  try {
    const lookbackDays = Math.min(90, Math.max(1, opts?.lookbackDays || DEFAULT_LOOKBACK_DAYS));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffISO = cutoff.toISOString();

    const userRows = await pool.query(
      "SELECT DISTINCT email FROM users WHERE email LIKE '%@brucegillinghampollard.com' ORDER BY email"
    );
    const mailboxes = Array.from(new Set([
      SHARED_MAILBOX,
      ...userRows.rows.map((r: any) => (r.email || "").toLowerCase()).filter(Boolean),
    ]));

    console.log(`[pip-ingest] Scanning ${mailboxes.length} mailboxes for PIP mailouts (last ${lookbackDays} days)`);
    // The same mailout lands in several mailboxes — internetMessageId is shared
    // across copies, so this set (plus the pip_ingested_emails table) dedupes them.
    const seenThisRun = new Set<string>();

    for (const mailbox of mailboxes) {
      ingestProgress = `Scanning ${mailbox}`;
      try {
        const result = await scanMailbox(mailbox, cutoffISO, seenThisRun);
        totals.mailboxes++;
        totals.scanned += result.scanned;
        totals.created += result.created;
        totals.duplicates += result.duplicates;
        totals.errors += result.errors;
      } catch (err: any) {
        totals.errors++;
        console.error(`[pip-ingest] Mailbox ${mailbox} failed: ${err?.message}`);
      }
    }

    await setSetting("pip_ingest_last_run", {
      timestamp: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      lookbackDays,
      ...totals,
    });

    if (totals.created > 0) {
      try {
        const { logActivity } = await import("./activity-logger");
        await logActivity("pip-ingest", "requirements_created", `${totals.created} requirement(s) filed from PIP mailouts`, totals.created);
      } catch {}
    }

    console.log(`[pip-ingest] Done: mailboxes=${totals.mailboxes}, mailouts=${totals.scanned}, created=${totals.created}, duplicates=${totals.duplicates}, errors=${totals.errors}`);
    return totals;
  } finally {
    ingestRunning = false;
    ingestProgress = "";
  }
}

export function startPipEmailIngest() {
  console.log(`[pip-ingest] Auto-ingest enabled — running every ${INGEST_INTERVAL_HOURS} hours`);
  setTimeout(() => {
    runPipEmailIngest().catch((err) => console.error("[pip-ingest] Initial run error:", err?.message));
  }, 60_000);
  setInterval(() => {
    runPipEmailIngest().catch((err) => console.error("[pip-ingest] Scheduled run error:", err?.message));
  }, INGEST_INTERVAL_HOURS * 60 * 60 * 1000);
}

export function setupPipEmailIngestRoutes(app: Express) {
  app.post("/api/pip-email-ingest/run", requireAuth, async (req: Request, res: Response) => {
    if (ingestRunning) return res.status(409).json({ running: true, message: "PIP email ingest is already running" });
    const lookbackDays = parseInt(req.body?.lookbackDays) || undefined;
    runPipEmailIngest({ lookbackDays }).catch((err) => console.error("[pip-ingest] Manual run error:", err?.message));
    res.json({ started: true, message: "PIP email ingest started — check /api/pip-email-ingest/status for progress" });
  });

  app.get("/api/pip-email-ingest/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      const counts = await pool.query(
        "SELECT status, COUNT(*)::int AS count FROM pip_ingested_emails GROUP BY status"
      );
      const recent = await pool.query(
        `SELECT subject, from_address, mailbox, status, detail, requirement_id, received_at, created_at
           FROM pip_ingested_emails ORDER BY created_at DESC LIMIT 20`
      );
      res.json({
        running: ingestRunning,
        progress: ingestProgress,
        lastRun: await getSetting("pip_ingest_last_run"),
        countsByStatus: Object.fromEntries(counts.rows.map((r: any) => [r.status, r.count])),
        recent: recent.rows,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });
}
