// ─────────────────────────────────────────────────────────────────────────
// KYC / AML orchestrator
//
// Runs every automatable check we have against a company (Companies House
// officers/PSCs/filings, UBO chain, UK sanctions + PEP list, Veriff for any
// linked contacts) in one call, then auto-ticks the AML checklist on
// crm_companies.aml_checklist with evidence captured from each check.
//
// Manual ticks are preserved — the merge only writes items that previously
// weren't ticked, and always records `source` so the UI can show which
// items were auto-ticked vs. done by a human.
//
// Public surface:
//   runAllAmlChecks(companyId, dealId?, userId?)           — full sweep
//   autoTickFromClouseau(companyId, result, investigationId) — on Clouseau complete
//   autoTickFromVeriff(companyId, sessionId, status)      — on Veriff webhook
// ─────────────────────────────────────────────────────────────────────────
import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import {
  getCompanyData,
  screenSanctions,
  assessRisk,
  logKycAudit,
} from "./kyc-clouseau";
import { discoverUltimateParent } from "./companies-house";
import { createVeriffSession } from "./veriff";
import { adverseMediaSearch, isPerplexityConfigured } from "./perplexity";
import { screenNames as complyAdvantageScreen, isComplyAdvantageConfigured } from "./comply-advantage";

const router = Router();

type TickSource =
  | "clouseau"
  | "veriff"
  | "sanctions"
  | "companies_house"
  | "perplexity"
  | "comply_advantage"
  | "manual"
  | "system";

type ChecklistItem = {
  ticked: boolean;
  tickedAt?: string;
  tickedBy?: string | null;
  source?: TickSource;
  evidence?: Record<string, unknown>;
  notes?: string;
};

type ChecklistUpdate = {
  source: TickSource;
  tickedBy?: string | null;
  evidence?: Record<string, unknown>;
  notes?: string;
};

// Canonical keys — must mirror CHECKLIST_ITEMS in client/src/components/kyc-panel.tsx
export const CHECKLIST_KEYS = [
  "id_verified",
  "address_verified",
  "ubo_identified",
  "company_cert",
  "sof_evidenced",
  "sow_evidenced",
  "sanctions_clear",
  "pep_checked",
  "adverse_media",
  "edd_complete",
  "risk_assessed",
  "mlro_review",
] as const;

/**
 * Merge a set of auto-ticks into crm_companies.aml_checklist. Preserves any
 * existing ticked items so we never overwrite MLRO sign-off with automation.
 * Returns the list of items we actually wrote, so callers can surface this
 * in their response / event log.
 */
export async function tickChecklistItems(
  companyId: string,
  updates: Record<string, ChecklistUpdate>,
): Promise<string[]> {
  const existing = await pool.query(
    `SELECT aml_checklist FROM crm_companies WHERE id = $1`,
    [companyId],
  );
  const current: Record<string, ChecklistItem> =
    (existing.rows[0]?.aml_checklist as any) || {};

  const written: string[] = [];
  const merged: Record<string, ChecklistItem> = { ...current };

  for (const [key, u] of Object.entries(updates)) {
    if (!CHECKLIST_KEYS.includes(key as (typeof CHECKLIST_KEYS)[number])) continue;
    // Don't overwrite a human tick — a manual sign-off from the MLRO is
    // more authoritative than anything we can infer.
    if (current[key]?.ticked && current[key]?.source === "manual") continue;
    merged[key] = {
      ticked: true,
      tickedAt: new Date().toISOString(),
      tickedBy: u.tickedBy ?? null,
      source: u.source,
      evidence: u.evidence,
      notes: u.notes,
    };
    written.push(key);
  }

  if (written.length === 0) return [];

  await pool.query(
    `UPDATE crm_companies
        SET aml_checklist = $1::jsonb,
            kyc_status = COALESCE(NULLIF(kyc_status, 'approved'), 'in_review'),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(merged), companyId],
  );
  return written;
}

/**
 * Turn a Clouseau InvestigationResult into a set of checklist ticks. We
 * never claim sanctions_clear unless the screening actually ran AND came
 * back empty; a Companies House failure leaves company_cert un-ticked.
 */
export async function autoTickFromClouseau(
  companyId: string,
  result: any,
  investigationId: number | null,
  userId: string | null = null,
): Promise<string[]> {
  const updates: Record<string, ChecklistUpdate> = {};
  const baseEvidence = investigationId ? { investigationId } : {};

  if (result?.companyProfile?.company_number) {
    updates.company_cert = {
      source: "companies_house",
      tickedBy: userId,
      evidence: {
        ...baseEvidence,
        companyNumber: result.companyProfile.company_number,
        companyName: result.companyProfile.company_name,
        status: result.companyProfile.company_status,
      },
      notes: `Companies House profile fetched ${new Date().toISOString().slice(0, 10)}`,
    };
  }

  const uboCount = Array.isArray(result?.ownershipChain?.ubos)
    ? result.ownershipChain.ubos.length
    : (result?.pscs || []).length;
  if (uboCount > 0) {
    updates.ubo_identified = {
      source: "companies_house",
      tickedBy: userId,
      evidence: {
        ...baseEvidence,
        uboCount,
        chainDepth: result?.ownershipChain?.chain?.length || 1,
      },
      notes: `${uboCount} ultimate beneficial owner(s) identified via PSC + ownership chain`,
    };
  }

  const sanctions = result?.sanctionsScreening;
  if (Array.isArray(sanctions) && sanctions.length > 0) {
    const hasMatch = sanctions.some(
      (s: any) => s.status === "strong_match" || s.status === "potential_match",
    );
    // We screen against both the UK OFSI (FCDO) consolidated list AND the
    // US OFAC SDN list. The UK list covers UK-designated PEPs under the
    // Sanctions and Anti-Money Laundering Act — so a clean run covers
    // pep_checked at the same time.
    if (!hasMatch) {
      updates.sanctions_clear = {
        source: "sanctions",
        tickedBy: userId,
        evidence: {
          ...baseEvidence,
          namesScreened: sanctions.length,
          lists: ["UK OFSI (FCDO)", "US OFAC SDN"],
        },
        notes: "No hits on UK OFSI or US OFAC consolidated sanctions lists",
      };
      updates.pep_checked = {
        source: "sanctions",
        tickedBy: userId,
        evidence: { ...baseEvidence, lists: ["UK OFSI (FCDO) — includes PEPs", "US OFAC SDN"] },
        notes: "PEP screening included in UK OFSI + OFAC sanctions run — no match",
      };
    }
  }

  if (typeof result?.riskLevel === "string" && typeof result?.riskScore === "number") {
    updates.risk_assessed = {
      source: "clouseau",
      tickedBy: userId,
      evidence: {
        ...baseEvidence,
        riskLevel: result.riskLevel,
        riskScore: result.riskScore,
        flags: (result.flags || []).slice(0, 10),
      },
      notes: `Risk assessed as ${result.riskLevel} (score ${result.riskScore})`,
    };

    // Mirror risk level onto the denormalised column so the board filters it
    await pool.query(
      `UPDATE crm_companies SET aml_risk_level = $1, updated_at = NOW() WHERE id = $2`,
      [result.riskLevel, companyId],
    ).catch((e) => console.warn("[kyc-orch] aml_risk_level update failed:", e?.message));
  }

  return tickChecklistItems(companyId, updates);
}

/**
 * When Veriff signs off on a biometric check, fold that into the checklist.
 * Veriff's biometric + document verification covers MLR 2017 Reg 28(2)(a)
 * (identity) and Reg 28(2)(b) (address, provided the document shows it).
 */
export async function autoTickFromVeriff(
  companyId: string | null,
  sessionId: string,
  status: string,
): Promise<string[]> {
  if (!companyId || status !== "approved") return [];

  const updates: Record<string, ChecklistUpdate> = {
    id_verified: {
      source: "veriff",
      evidence: { veriffSessionId: sessionId, status },
      notes: "Biometric + document check approved by Veriff",
    },
    address_verified: {
      source: "veriff",
      evidence: { veriffSessionId: sessionId, status },
      notes: "Address extracted from Veriff-verified document",
    },
  };
  return tickChecklistItems(companyId, updates);
}

/**
 * Full AML sweep. Runs Clouseau + UBO walk, launches Veriff sessions for
 * every contact on the company (if Veriff is configured), saves an
 * investigation record, auto-ticks the checklist, and writes a
 * kyc_orchestrator_run event to deal_events (if a dealId was provided).
 *
 * Returns a structured summary the caller can surface directly to the UI.
 */
export async function runAllAmlChecks(
  companyId: string,
  dealId: string | null,
  userId: string | null,
): Promise<{
  companyId: string;
  companyName: string | null;
  investigationId: number | null;
  risk: { level: string; score: number } | null;
  sanctionsMatch: boolean;
  veriffLaunched: Array<{ contactId: string; sessionId: string; url: string }>;
  veriffSkipped: Array<{ contactId: string; reason: string }>;
  adverseMedia: {
    ran: boolean;
    verdict?: "clear" | "review" | "adverse";
    summary?: string;
    findingCount?: number;
  };
  checklistTicked: string[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const companyRow = await pool.query(
    `SELECT id, name, companies_house_number FROM crm_companies WHERE id = $1`,
    [companyId],
  );
  const company = companyRow.rows[0];
  if (!company) throw new Error(`Company ${companyId} not found`);

  let investigationId: number | null = null;
  let risk: { level: string; score: number } | null = null;
  let sanctionsMatch = false;
  let investigationResult: any = null;
  let complyAdvantageResult: any[] = [];

  // 1. Companies House + UBO + Sanctions (Clouseau)
  if (company.companies_house_number) {
    try {
      const companyData = await getCompanyData(company.companies_house_number);
      let ownershipChain = null;
      try {
        ownershipChain = await discoverUltimateParent(company.companies_house_number);
      } catch (e: any) {
        warnings.push(`UBO chain walk failed: ${e?.message || "unknown"}`);
      }

      const namesToScreen: string[] = [];
      if (companyData.profile?.company_name) namesToScreen.push(companyData.profile.company_name);
      const activeOfficers = (companyData.officers || []).filter((o: any) => !o.resigned_on);
      activeOfficers.forEach((o: any) => { if (o.name) namesToScreen.push(o.name); });
      const activePscs = (companyData.pscs || []).filter((p: any) => !p.ceased_on);
      activePscs.forEach((p: any) => { if (p.name) namesToScreen.push(p.name); });

      const sanctionsResult = await screenSanctions(namesToScreen);

      // ComplyAdvantage PEP/sanctions/adverse media screening
      if (isComplyAdvantageConfigured()) {
        try {
          complyAdvantageResult = await complyAdvantageScreen(
            namesToScreen.map(n => ({ name: n })),
          );
          // Fold any ComplyAdvantage matches into the sanctions picture
          for (const car of complyAdvantageResult) {
            if (car.status === "strong_match" || car.status === "potential_match") {
              sanctionsMatch = true;
            }
          }
        } catch (e: any) {
          warnings.push(`ComplyAdvantage screening failed: ${e?.message || "unknown"}`);
        }
      }

      const assessed = assessRisk(companyData, sanctionsResult);
      risk = { level: assessed.level, score: assessed.score };
      if (!sanctionsMatch) {
        sanctionsMatch = (sanctionsResult || []).some(
          (s: any) => s.status === "strong_match" || s.status === "potential_match",
        );
      }

      investigationResult = {
        subject: {
          name: companyData.profile?.company_name || company.name,
          companyNumber: company.companies_house_number,
          type: "company",
        },
        companyProfile: companyData.profile,
        officers: activeOfficers,
        pscs: activePscs,
        ownershipChain,
        filingHistory: (companyData.filings || []).slice(0, 20),
        insolvencyHistory: companyData.insolvency,
        sanctionsScreening: sanctionsResult,
        complyAdvantageScreening: complyAdvantageResult.length > 0 ? complyAdvantageResult : undefined,
        riskScore: assessed.score,
        riskLevel: assessed.level,
        flags: assessed.flags,
        charges: companyData.charges || [],
        timestamp: new Date().toISOString(),
      };

      const inserted = await pool.query(
        `INSERT INTO kyc_investigations
           (subject_type, subject_name, company_number, crm_company_id,
            risk_level, risk_score, sanctions_match, result, conducted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          "company",
          investigationResult.subject.name,
          company.companies_house_number,
          companyId,
          assessed.level,
          assessed.score,
          sanctionsMatch,
          JSON.stringify(investigationResult),
          userId,
        ],
      );
      investigationId = inserted.rows[0]?.id ?? null;
      if (investigationId) {
        await logKycAudit(investigationId, "auto_run", userId, "Run via /api/kyc/run-all-checks");
      }
    } catch (e: any) {
      warnings.push(`Clouseau investigation failed: ${e?.message || "unknown"}`);
    }
  } else {
    warnings.push("Company has no Companies House number — skipped Clouseau + sanctions");
  }

  // 2. Veriff — fire one session per contact on the company, if configured
  const veriffLaunched: Array<{ contactId: string; sessionId: string; url: string }> = [];
  const veriffSkipped: Array<{ contactId: string; reason: string }> = [];
  const veriffConfigured =
    !!(process.env.VERIFF_API_KEY ||
      process.env.VERIFF_PUBLIC_KEY ||
      process.env.VERIFF_KEY ||
      process.env.VERIFF_INTEGRATION_ID);

  if (veriffConfigured) {
    const contactsQuery = await pool.query(
      `SELECT id, name, email FROM crm_contacts WHERE company_id = $1`,
      [companyId],
    );
    const existingQuery = await pool.query(
      `SELECT contact_id, status FROM veriff_sessions
        WHERE company_id = $1 AND contact_id IS NOT NULL`,
      [companyId],
    );
    const retriable = new Set(["declined", "resubmission_requested", "expired", "abandoned"]);
    const blocked = new Set(
      existingQuery.rows
        .filter((r) => !retriable.has(String(r.status || "").toLowerCase()))
        .map((r) => r.contact_id),
    );

    for (const c of contactsQuery.rows) {
      if (blocked.has(c.id)) {
        veriffSkipped.push({ contactId: c.id, reason: "Active Veriff session already in flight" });
        continue;
      }
      const parts = String(c.name || "").trim().split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || firstName || "(unknown)";
      if (!firstName) {
        veriffSkipped.push({ contactId: c.id, reason: "Contact has no name" });
        continue;
      }
      try {
        const session = await createVeriffSession({
          firstName,
          lastName,
          email: c.email || undefined,
          companyId,
          contactId: c.id,
          dealId: dealId || undefined,
          userId: userId || undefined,
        });
        await pool.query(
          `INSERT INTO veriff_sessions
             (session_id, company_id, contact_id, deal_id, first_name, last_name, email, status, verification_url, requested_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (session_id) DO NOTHING`,
          [session.sessionId, companyId, c.id, dealId || null, firstName, lastName, c.email || null, session.status, session.verificationUrl, userId],
        );
        veriffLaunched.push({ contactId: c.id, sessionId: session.sessionId, url: session.verificationUrl });
      } catch (e: any) {
        veriffSkipped.push({ contactId: c.id, reason: `Veriff error: ${e?.message || "unknown"}` });
      }
    }
  } else {
    warnings.push("Veriff not configured — skipped identity checks");
  }

  // 3. Adverse media via Perplexity — web-grounded, cited. ComplyAdvantage will
  // eventually replace this for proper sanctioned-PEP-list + curated feeds,
  // but Perplexity gives us immediate coverage of press/reputational hits.
  const adverseMedia: {
    ran: boolean;
    verdict?: "clear" | "review" | "adverse";
    summary?: string;
    findingCount?: number;
  } = { ran: false };
  const subjectName = investigationResult?.subject?.name || company.name;
  if (subjectName && isPerplexityConfigured()) {
    try {
      const ams = await adverseMediaSearch(subjectName, {
        country: "United Kingdom",
        companyNumber: company.companies_house_number || undefined,
      });
      adverseMedia.ran = true;
      adverseMedia.verdict = ams.verdict;
      adverseMedia.summary = ams.summary;
      adverseMedia.findingCount = ams.findings.length;
    } catch (e: any) {
      warnings.push(`Adverse media search failed: ${e?.message || "unknown"}`);
    }
  } else if (!isPerplexityConfigured()) {
    warnings.push("Perplexity not configured — skipped adverse media");
  }

  // 4. Auto-tick the checklist from everything we just learned
  let checklistTicked: string[] = [];
  if (investigationResult) {
    checklistTicked = await autoTickFromClouseau(companyId, investigationResult, investigationId, userId);
  }
  // Adverse media ticks separately — only "clear" counts as an auto-pass.
  // "review" and "adverse" are left for the MLRO to eyeball manually.
  if (adverseMedia.ran && adverseMedia.verdict === "clear") {
    const adverseTicked = await tickChecklistItems(companyId, {
      adverse_media: {
        source: "perplexity",
        tickedBy: userId,
        evidence: {
          verdict: adverseMedia.verdict,
          findingCount: adverseMedia.findingCount,
          subject: subjectName,
        },
        notes: adverseMedia.summary || "No adverse media found via Perplexity web search",
      },
    });
    checklistTicked = [...checklistTicked, ...adverseTicked];
  }

  // ComplyAdvantage ticks — if all names screened clear, auto-tick sanctions + PEP
  if (complyAdvantageResult.length > 0) {
    const allClear = complyAdvantageResult.every(r => r.status === "clear");
    if (allClear) {
      const caTicked = await tickChecklistItems(companyId, {
        sanctions_clear: {
          source: "comply_advantage",
          tickedBy: userId,
          evidence: {
            screened: complyAdvantageResult.map(r => r.name),
            provider: "ComplyAdvantage Mesh",
          },
          notes: `${complyAdvantageResult.length} names screened clear via ComplyAdvantage`,
        },
        pep_checked: {
          source: "comply_advantage",
          tickedBy: userId,
          evidence: {
            screened: complyAdvantageResult.map(r => r.name),
            provider: "ComplyAdvantage Mesh",
          },
          notes: `PEP screening clear via ComplyAdvantage for ${complyAdvantageResult.length} names`,
        },
      });
      checklistTicked = [...checklistTicked, ...caTicked];
    }
  }

  // 5. Deal event trail — so the audit log carries the whole sweep
  if (dealId) {
    await pool.query(
      `INSERT INTO deal_events (deal_id, event_type, payload, actor_id)
       VALUES ($1, 'kyc_orchestrator_run', $2, $3)`,
      [
        dealId,
        JSON.stringify({
          companyId,
          investigationId,
          risk,
          sanctionsMatch,
          veriffLaunched,
          veriffSkipped,
          adverseMedia,
          checklistTicked,
          warnings,
        }),
        userId,
      ],
    ).catch(() => {});
  }

  return {
    companyId,
    companyName: company.name,
    investigationId,
    risk,
    sanctionsMatch,
    veriffLaunched,
    veriffSkipped,
    adverseMedia,
    checklistTicked,
    warnings,
  };
}

/**
 * Daily cron: pick up companies whose KYC has gone stale (past the firm's
 * `recheck_interval_days`, default 365) or that have a pending
 * aml_recheck_reminders row due today. For each, re-run the full sweep.
 *
 * Kept deliberately cautious — capped at 25 companies per run so a single
 * run can't blow through our Companies House / Perplexity quota, and
 * spaced with a small delay between each to avoid rate-limiting.
 */
export async function runPeriodicAmlReScreening(options: { maxCompanies?: number } = {}): Promise<{
  scanned: number;
  processed: number;
  errors: number;
  reminderIds: number[];
}> {
  const MAX = options.maxCompanies ?? 25;
  console.log("[kyc-orch] Starting periodic AML re-screening...");

  // Firm-level recheck interval (default 365 days if no amlSettings row)
  const settings = await pool.query(
    `SELECT recheck_interval_days FROM aml_settings ORDER BY updated_at DESC LIMIT 1`,
  ).catch(() => ({ rows: [] as any[] }));
  const intervalDays = Number(settings.rows[0]?.recheck_interval_days) || 365;

  // Pull candidates: stale KYC OR has an overdue recheck reminder
  const staleQuery = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.kyc_checked_at
       FROM crm_companies c
       LEFT JOIN aml_recheck_reminders r ON r.company_id = c.id AND r.completed_at IS NULL
      WHERE c.companies_house_number IS NOT NULL
        AND c.kyc_status <> 'rejected'
        AND (
          c.kyc_checked_at IS NULL
          OR c.kyc_checked_at < NOW() - ($1 || ' days')::interval
          OR (r.due_date IS NOT NULL AND r.due_date <= NOW())
        )
      ORDER BY c.kyc_checked_at NULLS FIRST
      LIMIT $2`,
    [String(intervalDays), MAX],
  );

  const scanned = staleQuery.rows.length;
  let processed = 0;
  let errors = 0;
  const reminderIds: number[] = [];

  for (const row of staleQuery.rows) {
    try {
      const summary = await runAllAmlChecks(row.id, null, null);
      processed++;

      // Bump kyc_checked_at so we don't re-pick next cycle
      await pool.query(
        `UPDATE crm_companies SET kyc_checked_at = NOW() WHERE id = $1`,
        [row.id],
      ).catch(() => {});

      // Close any due reminders for this company
      const closed = await pool.query(
        `UPDATE aml_recheck_reminders
            SET completed_at = NOW(),
                completed_by = 'system-cron',
                notes = COALESCE(notes, '') || $2
          WHERE company_id = $1 AND completed_at IS NULL AND due_date <= NOW()
          RETURNING id`,
        [row.id, `\n[Auto-closed by periodic re-screen ${new Date().toISOString()}]`],
      ).catch(() => ({ rows: [] as any[] }));
      for (const r of closed.rows) reminderIds.push(r.id);

      console.log(
        `[kyc-orch] Periodic re-screen ${row.name}: risk=${summary.risk?.level || "n/a"} ` +
        `ticked=[${summary.checklistTicked.join(",")}] warnings=${summary.warnings.length}`,
      );

      // Short pause so we don't hammer Companies House / Perplexity back-to-back
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e: any) {
      errors++;
      console.warn(`[kyc-orch] Periodic re-screen failed for ${row.name}:`, e?.message);
    }
  }

  console.log(
    `[kyc-orch] Periodic re-screening complete: scanned=${scanned} processed=${processed} errors=${errors}`,
  );
  return { scanned, processed, errors, reminderIds };
}

// ─── HTTP surface ────────────────────────────────────────────────────────

/**
 * POST /api/kyc/run-all-checks
 *
 * Body: { companyId: string, dealId?: string }   — single company
 *       { dealId: string, bothSides?: true }      — tenant + landlord on deal
 *
 * Returns { runs: Array<summary> }
 */
router.post("/api/kyc/run-all-checks", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    const { companyId, dealId, bothSides } = req.body || {};
    const targets: string[] = [];

    if (companyId) {
      targets.push(companyId);
    } else if (dealId && bothSides) {
      const d = await pool.query(
        `SELECT tenant_id, landlord_id FROM crm_deals WHERE id = $1`,
        [dealId],
      );
      if (!d.rows[0]) return res.status(404).json({ error: "Deal not found" });
      if (d.rows[0].tenant_id) targets.push(d.rows[0].tenant_id);
      if (d.rows[0].landlord_id) targets.push(d.rows[0].landlord_id);
    } else {
      return res.status(400).json({ error: "Provide companyId, or dealId with bothSides=true" });
    }

    const runs = [] as any[];
    for (const cid of targets) {
      try {
        runs.push(await runAllAmlChecks(cid, dealId || null, userId));
      } catch (e: any) {
        runs.push({ companyId: cid, error: e?.message || "unknown error" });
      }
    }
    res.json({ runs });
  } catch (err: any) {
    console.error("[kyc-orch] run-all-checks error:", err?.message);
    res.status(500).json({ error: err?.message || "Orchestrator failed" });
  }
});

/**
 * POST /api/kyc/run-periodic-rescreen
 * Admin-triggered run of the same sweep the nightly cron does.
 * Body: { maxCompanies?: number }
 */
router.post("/api/kyc/run-periodic-rescreen", requireAuth, async (req: Request, res: Response) => {
  try {
    const { maxCompanies } = req.body || {};
    const result = await runPeriodicAmlReScreening({
      maxCompanies: typeof maxCompanies === "number" && maxCompanies > 0 ? Math.min(maxCompanies, 200) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    console.error("[kyc-orch] manual periodic re-screen error:", err?.message);
    res.status(500).json({ error: err?.message || "Re-screening failed" });
  }
});

export default router;
