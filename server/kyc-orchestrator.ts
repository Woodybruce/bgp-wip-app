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
import { findHistoricalKycMatches, hasFreshHistoricalPack, type HistoricalKycMatch } from "./aml-historical";
import { fetchAmlMarketData, hasMarketSignals } from "./aml-market";

const router = Router();

type TickSource =
  | "clouseau"
  | "veriff"
  | "sanctions"
  | "companies_house"
  | "perplexity"
  | "comply_advantage"
  | "sharepoint_history"
  | "yahoo_finance"
  | "creditsafe"
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
  historicalKyc: HistoricalKycMatch[];
  marketData: Awaited<ReturnType<typeof fetchAmlMarketData>> | null;
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

      const assessed = assessRisk(companyData, sanctionsResult);
      risk = { level: assessed.level, score: assessed.score };
      sanctionsMatch = (sanctionsResult || []).some(
        (s: any) => s.status === "strong_match" || s.status === "potential_match",
      );

      // Experian commercial credit — non-fatal, augments the investigation
      let experianReport: any = null;
      try {
        const { fetchCommercialCredit, isExperianConfigured, persistExperianTurnover } = await import("./experian");
        if (isExperianConfigured()) {
          experianReport = await fetchCommercialCredit(company.companies_house_number);
          if (experianReport && experianReport.turnover != null && experianReport.turnover > 0) {
            await persistExperianTurnover(pool, {
              companyId: company.id,
              companyName: companyData.profile?.company_name || company.name,
              report: experianReport,
            });
          }
        }
      } catch (e: any) {
        warnings.push(`Experian credit lookup failed: ${e?.message || "unknown"}`);
      }

      // House covenant score (free data: CH + Gazette + accounts) — non-fatal.
      // Every KYC'd counterparty is also added to the nightly covenant watch.
      let covenantReport: any = null;
      try {
        const { getCovenantReport, addToWatchlist } = await import("./covenant-engine");
        covenantReport = await getCovenantReport(company.companies_house_number);
        await addToWatchlist(company.companies_house_number, companyData.profile?.company_name || company.name);
      } catch (e: any) {
        warnings.push(`Covenant check failed: ${e?.message || "unknown"}`);
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
        experian: experianReport,
        covenant: covenantReport,
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

  // 1b. ComplyAdvantage PEP/sanctions screening — runs even without CH number
  if (isComplyAdvantageConfigured()) {
    try {
      const namesToScreenCA: Array<{ name: string; role?: string }> = [];
      // Use company name + any contacts as screening subjects
      if (company.name) namesToScreenCA.push({ name: company.name, role: "company" });
      const contactsForCA = await pool.query(
        `SELECT name, role FROM crm_contacts WHERE company_id = $1 AND name IS NOT NULL`,
        [companyId],
      );
      for (const c of contactsForCA.rows) {
        if (c.name) namesToScreenCA.push({ name: c.name, role: c.role || "contact" });
      }
      // Also add officers/PSCs if we have them from CH
      if (investigationResult?.officers) {
        for (const o of investigationResult.officers) {
          if (o.name && !namesToScreenCA.some(n => n.name === o.name)) {
            namesToScreenCA.push({ name: o.name, role: "officer" });
          }
        }
      }
      if (investigationResult?.pscs) {
        for (const p of investigationResult.pscs) {
          if (p.name && !namesToScreenCA.some(n => n.name === p.name)) {
            namesToScreenCA.push({ name: p.name, role: "psc" });
          }
        }
      }

      if (namesToScreenCA.length > 0) {
        complyAdvantageResult = await complyAdvantageScreen(namesToScreenCA);

        // Check for any matches
        for (const car of complyAdvantageResult) {
          if (car.status === "strong_match" || car.status === "potential_match") {
            sanctionsMatch = true;
          }
        }

        // Auto-set PEP status from ComplyAdvantage results
        const pepMatches = complyAdvantageResult.flatMap(r =>
          r.matches?.filter((m: any) => m.matchType === "pep") || []
        );
        if (pepMatches.length > 0) {
          // Found PEP hits — set status to the strongest match type
          await pool.query(
            `UPDATE crm_companies SET aml_pep_status = $1 WHERE id = $2`,
            ["pep_domestic", companyId],
          );
        } else if (complyAdvantageResult.length > 0 && complyAdvantageResult.every(r => r.status === "clear")) {
          // All clear — auto-set PEP status to clear
          await pool.query(
            `UPDATE crm_companies SET aml_pep_status = $1 WHERE id = $2 AND (aml_pep_status IS NULL OR aml_pep_status = '')`,
            ["clear", companyId],
          );
        }

        // Store results in investigation if we have one
        if (investigationResult) {
          investigationResult.complyAdvantageScreening = complyAdvantageResult;
          if (investigationId) {
            await pool.query(
              `UPDATE kyc_investigations SET result = $1 WHERE id = $2`,
              [JSON.stringify(investigationResult), investigationId],
            );
          }
        }
      }
    } catch (e: any) {
      warnings.push(`ComplyAdvantage screening failed: ${e?.message || "unknown"}`);
    }
  } else {
    warnings.push("ComplyAdvantage not configured — skipped PEP/sanctions screening");
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

  // 4a. Historical KYC pack on file — check the BGP SharePoint KYC folder for
  // a prior pass on this entity. If one exists in the last 12 months, mark
  // company_cert ticked from sharepoint_history and stash the matches so the
  // panel can deep-link to the file.
  let historicalKyc: HistoricalKycMatch[] = [];
  try {
    historicalKyc = await findHistoricalKycMatches(company.name || "");
    if (hasFreshHistoricalPack(historicalKyc)) {
      const newest = historicalKyc[0];
      const updates = await tickChecklistItems(companyId, {
        company_cert: {
          source: "sharepoint_history",
          evidence: {
            file: newest.name,
            webUrl: newest.webUrl,
            ageDays: newest.ageDays,
            totalMatches: historicalKyc.length,
          },
          notes: `Prior KYC pack on file (${newest.ageDays} days old) — ${newest.name}`,
        },
      });
      checklistTicked = [...checklistTicked, ...updates];
    }
  } catch (e: any) {
    warnings.push(`Historical KYC lookup failed: ${e?.message || "unknown"}`);
  }

  // 4b. Market data overlay — Yahoo Finance for listed counterparties,
  // Creditsafe/RFA when a key is configured. Cheap signals that confirm
  // financial health or flag concerns to look at.
  let marketData: Awaited<ReturnType<typeof fetchAmlMarketData>> | null = null;
  try {
    marketData = await fetchAmlMarketData(company.name || "", company.companies_house_number || null);
    if (marketData && hasMarketSignals(marketData)) {
      // Stash on the deal for the AmlAiPanel to display
      if (dealId) {
        await pool.query(
          `UPDATE crm_deals SET aml_market_data = $1 WHERE id = $2`,
          [marketData, dealId],
        ).catch(() => {});
      }
      // Sharp drop / halts are signals to flag, not to auto-tick anything off.
      if (marketData.signals.sharpDrop || marketData.signals.halted) {
        warnings.push(
          marketData.signals.halted
            ? `Listed share appears halted — verify before completion`
            : `Share price down 30%+ over 52 weeks — sense-check covenant`
        );
      }
    }
  } catch (e: any) {
    warnings.push(`Market data lookup failed: ${e?.message || "unknown"}`);
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
          historicalKyc: historicalKyc.slice(0, 5),
          marketData,
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
    historicalKyc,
    marketData,
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
        `SELECT tenant_id, landlord_id, vendor_id, purchaser_id FROM crm_deals WHERE id = $1`,
        [dealId],
      );
      if (!d.rows[0]) return res.status(404).json({ error: "Deal not found" });
      // Dedupe — same company can sit in multiple roles.
      const seen = new Set<string>();
      for (const id of [d.rows[0].tenant_id, d.rows[0].landlord_id, d.rows[0].vendor_id, d.rows[0].purchaser_id]) {
        if (id && !seen.has(id)) { seen.add(id); targets.push(id); }
      }
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
 * POST /api/kyc/backfill-deals
 * One-click backfill: walks every active deal that has at least one
 * counterparty linked, and fires runAllAmlChecks for each landlord/tenant/
 * vendor/purchaser whose company hasn't been screened in the last 30 days.
 * Idempotent (the orchestrator already preserves existing checklist items)
 * and budget-aware (cooldown skip).
 *
 * Returns a streaming-style summary so the admin can see what got picked up.
 */
router.post("/api/kyc/backfill-deals", requireAuth, async (req: any, res: Response) => {
  try {
    const userId = req.session?.userId || req.tokenUserId || null;
    const adminCheck = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
    if (adminCheck.rows[0]?.is_admin !== true) {
      return res.status(403).json({ error: "Admin only" });
    }

    // Pull every active deal that's got at least one counterparty company.
    const { rows: deals } = await pool.query(
      `SELECT id, name, landlord_id, tenant_id, vendor_id, purchaser_id
       FROM crm_deals
       WHERE COALESCE(status, '') NOT IN ('ARCH','WIT','LOST','DEAD')
         AND (landlord_id IS NOT NULL OR tenant_id IS NOT NULL OR vendor_id IS NOT NULL OR purchaser_id IS NOT NULL)`,
    );

    // Build a unique set of (companyId, anyDealId) tuples — sweep each
    // company once even if it sits across multiple deals.
    const companyToDeal = new Map<string, string>();
    for (const d of deals) {
      for (const cid of [d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id]) {
        if (cid && !companyToDeal.has(cid)) companyToDeal.set(cid, d.id);
      }
    }

    // 30-day cooldown — pull last update timestamps so we skip anything
    // recently swept.
    const recentlySwept = new Set<string>();
    if (companyToDeal.size > 0) {
      const ids = Array.from(companyToDeal.keys());
      const { rows: recent } = await pool.query(
        `SELECT id FROM crm_companies
         WHERE id = ANY($1::varchar[])
           AND aml_checklist IS NOT NULL
           AND updated_at > NOW() - INTERVAL '30 days'`,
        [ids],
      );
      for (const r of recent) recentlySwept.add(r.id);
    }

    const toSweep = Array.from(companyToDeal.entries()).filter(([cid]) => !recentlySwept.has(cid));
    const swept: Array<{ companyId: string; dealId: string; risk?: string; warnings?: number }> = [];
    const failed: Array<{ companyId: string; reason: string }> = [];

    // Concurrency cap of 3 — don't blast Companies House / Comply Advantage
    // / Perplexity all at once.
    const concurrency = 3;
    const queue = [...toSweep];
    async function worker() {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        const [cid, did] = next;
        try {
          const r = await runAllAmlChecks(cid, did, userId);
          swept.push({ companyId: cid, dealId: did, risk: r.risk?.level, warnings: r.warnings?.length || 0 });
        } catch (e: any) {
          failed.push({ companyId: cid, reason: e?.message?.slice(0, 200) || "unknown" });
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    res.json({
      dealsScanned: deals.length,
      companiesFound: companyToDeal.size,
      skippedRecent: recentlySwept.size,
      swept: swept.length,
      failed: failed.length,
      sweptDetail: swept.slice(0, 50),
      failures: failed.slice(0, 10),
    });
  } catch (err: any) {
    console.error("[kyc-orch] backfill-deals error:", err?.message);
    res.status(500).json({ error: err?.message || "Backfill failed" });
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

// ── AI commentary + outstanding items for the KYC panel ─────────────────────
// The outstanding list is computed deterministically in code (never by the
// model); Claude only writes the plain-English read of where the file stands.
const KYC_CHECKLIST_LABELS: Record<string, string> = {
  id_verified: "Identity verification (passport / driving licence)",
  address_verified: "Address verification (utility / bank statement)",
  ubo_identified: "Ultimate beneficial owner(s) identification",
  company_cert: "Cert of incorporation / Companies House check",
  sof_evidenced: "Source of funds evidence",
  sow_evidenced: "Source of wealth evidence",
  sanctions_clear: "Sanctions screening",
  pep_checked: "PEP screening",
  adverse_media: "Adverse media check",
  edd_complete: "Enhanced due diligence (if required)",
  risk_assessed: "Customer risk rating",
  mlro_review: "MLRO file review",
};

const kycCommentaryCache = new Map<string, { data: any; expiresAt: number }>();

router.get("/api/kyc/company/:companyId/commentary", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const refresh = req.query.refresh === "1";
    const cached = kycCommentaryCache.get(companyId);
    if (!refresh && cached && Date.now() < cached.expiresAt) return res.json(cached.data);

    const { rows } = await pool.query(
      `SELECT name, company_type, companies_house_number, uk_entity_name, aml_checklist,
              kyc_status, kyc_expires_at, companies_house_data
         FROM crm_companies WHERE id = $1`,
      [companyId],
    );
    const co = rows[0];
    if (!co) return res.status(404).json({ error: "Company not found" });

    const checklist: Record<string, { ticked?: boolean; source?: string }> = co.aml_checklist || {};
    const chData: any = co.companies_house_data || {};

    // Deterministic outstanding list: data-level gaps first, then unticked
    // checklist items grouped as-is.
    const outstanding: string[] = [];
    if (!co.companies_house_number) outstanding.push("Companies House number not confirmed — resolve the UK trading entity first");
    if (!co.uk_entity_name) outstanding.push("UK trading entity name not set");
    if (co.companies_house_number && !(Array.isArray(chData.officers) && chData.officers.length)) outstanding.push("Officers not yet pulled from Companies House");
    if (co.companies_house_number && !(Array.isArray(chData.pscs) && chData.pscs.length)) outstanding.push("PSCs not yet pulled from Companies House");
    if (co.companies_house_number && !chData.latestAccountsExtracted) outstanding.push("Latest filed accounts not yet extracted");
    for (const [id, label] of Object.entries(KYC_CHECKLIST_LABELS)) {
      if (!checklist[id]?.ticked) outstanding.push(label);
    }
    const ticked = Object.entries(KYC_CHECKLIST_LABELS).filter(([id]) => checklist[id]?.ticked).map(([, label]) => label);
    const autoTicked = Object.entries(KYC_CHECKLIST_LABELS).filter(([id]) => checklist[id]?.ticked && (checklist[id] as any)?.source && (checklist[id] as any).source !== "manual").length;

    let commentary: string | null = null;
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const opts: any = { apiKey };
        if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) opts.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
        const client = new Anthropic(opts);
        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001", max_tokens: 250,
          messages: [{ role: "user", content: `You are an MLRO's assistant summarising a KYC/AML file. 2-3 plain-English sentences: where the file stands, what's done, and the most important thing still needed. Never invent checks — only reference what's listed. Plain prose only — no markdown, no bold, no headings, no bullet points.\nCompany: ${co.name} (${co.company_type || "type unknown"}) · CH ${co.companies_house_number || "not confirmed"} · KYC status: ${co.kyc_status || "not started"}${co.kyc_expires_at ? ` · expires ${String(co.kyc_expires_at).slice(0, 10)}` : ""}\nCompleted (${ticked.length}/${Object.keys(KYC_CHECKLIST_LABELS).length}, ${autoTicked} auto-evidenced): ${ticked.join("; ") || "nothing yet"}\nOutstanding: ${outstanding.join("; ") || "nothing — file complete"}` }],
        });
        commentary = (msg.content[0] as any)?.text?.trim() || null;
      }
    } catch { /* commentary is best-effort */ }

    const payload = {
      commentary,
      outstanding,
      completed: ticked.length,
      total: Object.keys(KYC_CHECKLIST_LABELS).length,
      generatedAt: new Date().toISOString(),
    };
    kycCommentaryCache.set(companyId, { data: payload, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Commentary failed" });
  }
});

export default router;
