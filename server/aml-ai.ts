// AI-powered AML augments — drives the changes that let BGP run KYC in-house
// rather than paying a third-party (KYC4U etc.) for what we can do with our
// existing Companies House + Veriff + Comply Advantage + Perplexity stack
// plus Claude on top.
//
//   1. assessMlrScope            — is this deal even in scope of MLR 2017?
//   2. evaluateAutoEdd            — rule-based EDD trigger from gathered signals
//   3. runAiTriage                — Claude verdict at the end of an AML sweep
//   4. analyseSourceOfFundsDoc    — Claude extracts numbers + flags from a SoF
//                                   bank statement / tax return / payslip
//
// Each helper returns a JSON-serialisable shape that the calling endpoint
// can stash on `crm_deals` (jsonb columns aml_sof_analysis / aml_ai_triage)
// and / or surface back to the client.

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TRIAGE_MODEL = "claude-sonnet-4-6";
const SOF_MODEL = "claude-sonnet-4-6";

// ── 1. MLR 2017 scope determination ──────────────────────────────────────────
// Letting agents are only in scope if the monthly rent ≥ €10,000 (~£8,500).
// Sales + commercial purchases are always in scope. We expose a `hint` so the
// MLRO can override after reviewing — never auto-decide unilaterally.

export type MlrScope = "in_scope" | "out_of_scope_below_threshold" | "simplified_dd";

export function assessMlrScope(deal: {
  dealType?: string | null;
  fee?: number | null;
  monthlyRent?: number | null;
  annualRent?: number | null;
  buyerType?: string | null;
}): { suggestedScope: MlrScope; reason: string } {
  const dt = (deal.dealType || "").toLowerCase();
  const annualRent = deal.annualRent ?? (deal.monthlyRent ? deal.monthlyRent * 12 : null);

  // Lettings under £100k pa fall outside MLR 2017's letting agency definition.
  // £100k = €10,000/month at the conservative end of typical FX. This matches
  // HMRC's published guidance on AML supervision for letting agency businesses.
  if ((dt.includes("letting") || dt.includes("rent")) && annualRent != null && annualRent < 100_000) {
    return {
      suggestedScope: "out_of_scope_below_threshold",
      reason: `Letting at £${annualRent.toLocaleString()}/year is below the €10,000/month MLR 2017 letting-agent threshold. CDD not legally required.`,
    };
  }

  // Listed company / public body / regulated firm counterparty → SDD allowed.
  if (deal.buyerType && ["listed", "public_body", "regulated_firm"].includes(deal.buyerType.toLowerCase())) {
    return {
      suggestedScope: "simplified_dd",
      reason: `Counterparty type "${deal.buyerType}" qualifies for Simplified Due Diligence under MLR 2017 Reg 37.`,
    };
  }

  return {
    suggestedScope: "in_scope",
    reason: "Standard CDD required under MLR 2017.",
  };
}

// ── 2. Auto-EDD trigger rules ────────────────────────────────────────────────
// Evaluates the gathered signals from runAllAmlChecks and returns whether
// EDD must be flipped on, with a documented reason. The orchestrator writes
// crm_deals.aml_edd_required = true when this returns required: true.

export interface AutoEddSignals {
  sanctionsMatch?: boolean;
  pepStatus?: string | null;          // none | pep | rca | unknown
  riskLevel?: string | null;          // low | medium | high
  riskScore?: number | null;          // 0-100
  jurisdictions?: string[];           // ISO codes from UBO chain
  dealValuePence?: number | null;
  uboChainDepth?: number | null;      // levels deep in PSC walk
  adverseMediaVerdict?: string | null;// clear | review | adverse
}

// Conservative high-risk list (FATF + EU + UK Treasury). Hardcoded for v1;
// could be moved to a config table if it needs frequent updates.
const HIGH_RISK_JURISDICTIONS = new Set(["IR", "KP", "MM", "BY", "RU", "AF", "SY", "CU", "VE", "YE"]);

export function evaluateAutoEdd(signals: AutoEddSignals): { required: boolean; reason: string } {
  if (signals.sanctionsMatch) {
    return { required: true, reason: "Sanctions screening returned a match — EDD mandatory." };
  }
  if (signals.pepStatus && ["pep", "rca"].includes(signals.pepStatus.toLowerCase())) {
    return { required: true, reason: "PEP / Relative or Close Associate identified — EDD mandatory under MLR 2017 Reg 35." };
  }
  if (signals.adverseMediaVerdict === "adverse") {
    return { required: true, reason: "Adverse media identified during AI sweep — EDD recommended." };
  }
  const flaggedJur = (signals.jurisdictions || []).find(j => HIGH_RISK_JURISDICTIONS.has(j.toUpperCase()));
  if (flaggedJur) {
    return { required: true, reason: `UBO chain touches a high-risk jurisdiction (${flaggedJur}) — EDD mandatory under Reg 33.` };
  }
  if (signals.dealValuePence && signals.dealValuePence >= 100_000_000) {
    return { required: true, reason: `Deal value over £1m (£${(signals.dealValuePence / 100).toLocaleString()}) — EDD recommended for high-value transactions.` };
  }
  if ((signals.uboChainDepth ?? 0) >= 3) {
    return { required: true, reason: `UBO chain ${signals.uboChainDepth} levels deep — complex structure, EDD recommended.` };
  }
  if (signals.riskLevel === "high" || (signals.riskScore != null && signals.riskScore >= 70)) {
    return { required: true, reason: `Overall risk assessed as high (score ${signals.riskScore ?? "n/a"}) — EDD recommended.` };
  }
  return { required: false, reason: "" };
}

// ── 3. AI triage / "clear to proceed" verdict ─────────────────────────────────
// At the end of runAllAmlChecks, hand all signals to Claude and get back a
// structured verdict + plain-English MLRO summary. Replaces a paid analyst.

export interface AiTriageInput {
  dealName: string;
  companyName: string;
  signals: AutoEddSignals & {
    investigationId?: number | null;
    veriffSessions?: number;
    checklistTicked?: string[];
    checklistPending?: string[];
    mlrScope?: MlrScope;
    mlrScopeReason?: string;
  };
}

export interface AiTriageOutput {
  verdict: "clear" | "review" | "escalate";
  recommendation: string;       // 2-3 sentence MLRO summary
  rationale: string[];          // bullet list of the strongest signals
  mlroAction: string;           // what the MLRO should do next
  generatedAt: string;
  model: string;
}

export async function runAiTriage(input: AiTriageInput): Promise<AiTriageOutput> {
  const sys = `You are the BGP AML triage assistant. The MLRO is reviewing a deal's KYC/AML evidence. Based on the gathered signals, decide:
  - verdict: "clear" (low risk, all checks passed, MLRO can sign off without further review), "review" (proceed but document something), or "escalate" (genuine concern, needs MLRO action before approving).
  - recommendation: 2-3 plain-English sentences for the MLRO file.
  - rationale: bullet list of the 3-5 strongest signals (good or bad).
  - mlroAction: one concrete next action for the MLRO.

Output strict JSON: { "verdict": "...", "recommendation": "...", "rationale": ["..."], "mlroAction": "..." }
Do not include any commentary outside the JSON.`;

  const userPayload = {
    deal: input.dealName,
    company: input.companyName,
    ...input.signals,
  };

  try {
    const msg = await anthropic.messages.create({
      model: TRIAGE_MODEL,
      max_tokens: 1024,
      system: sys,
      messages: [
        { role: "user", content: `Signals:\n${JSON.stringify(userPayload, null, 2)}` },
      ],
    });
    const text = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      verdict: parsed.verdict || "review",
      recommendation: parsed.recommendation || "",
      rationale: Array.isArray(parsed.rationale) ? parsed.rationale : [],
      mlroAction: parsed.mlroAction || "",
      generatedAt: new Date().toISOString(),
      model: TRIAGE_MODEL,
    };
  } catch (e: any) {
    return {
      verdict: "review",
      recommendation: `AI triage failed (${e?.message || "unknown error"}); MLRO must review manually.`,
      rationale: [],
      mlroAction: "Run the checklist manually and document the decision.",
      generatedAt: new Date().toISOString(),
      model: TRIAGE_MODEL,
    };
  }
}

// ── 4. Source-of-Funds document analyser ──────────────────────────────────────
// Drag a bank statement / tax return / payslip onto the deal — Claude
// extracts the figures, summarises the income picture, flags inconsistencies
// vs the deal's expected SoF declaration. Output stashed on
// crm_deals.aml_sof_analysis as JSONB.

export interface SofAnalysisInput {
  dealName: string;
  declaredSource?: string | null;     // e.g. "salary income at firm X"
  declaredAmountPence?: number | null;
  documentText: string;               // text-extracted from the file
  documentType?: string;              // e.g. "bank_statement" | "tax_return" | "payslip"
  filename?: string;
}

export interface SofAnalysisOutput {
  documentType: string;               // AI's classification
  summary: string;                    // 2-3 sentences
  declaredSourceMatchesDocument: boolean | null;
  inferredAnnualIncomePence: number | null;
  redFlags: string[];                 // each is a short string
  evidence: string[];                 // direct quotes from the document
  generatedAt: string;
  model: string;
}

export async function analyseSourceOfFundsDoc(input: SofAnalysisInput): Promise<SofAnalysisOutput> {
  const sys = `You are the BGP AML Source-of-Funds analyst. The MLRO has uploaded a customer document supporting their declared SoF for a property deal. Extract:
  - documentType: bank_statement | tax_return | payslip | other
  - summary: 2-3 sentences plain-English
  - declaredSourceMatchesDocument: true if the document supports the declared source (or null if not provided)
  - inferredAnnualIncomePence: best estimate of customer's annual income from this document, in pence (or null if not deducible)
  - redFlags: any unusual patterns — large unexplained deposits, structuring, inconsistencies with declared income, gambling activity, crypto cashouts, missing pages, etc.
  - evidence: 2-4 short direct quotes from the document text supporting your conclusions

Output strict JSON only. Be precise about figures — if you can't be sure, set null.`;

  const userPayload = {
    deal: input.dealName,
    declared: input.declaredSource ? { source: input.declaredSource, amountPence: input.declaredAmountPence } : null,
    file: input.filename,
    text: input.documentText.slice(0, 25_000),
  };

  try {
    const msg = await anthropic.messages.create({
      model: SOF_MODEL,
      max_tokens: 2048,
      system: sys,
      messages: [
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    });
    const text = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      documentType: parsed.documentType || input.documentType || "other",
      summary: parsed.summary || "",
      declaredSourceMatchesDocument: typeof parsed.declaredSourceMatchesDocument === "boolean" ? parsed.declaredSourceMatchesDocument : null,
      inferredAnnualIncomePence: typeof parsed.inferredAnnualIncomePence === "number" ? parsed.inferredAnnualIncomePence : null,
      redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      generatedAt: new Date().toISOString(),
      model: SOF_MODEL,
    };
  } catch (e: any) {
    return {
      documentType: input.documentType || "other",
      summary: `AI analysis failed (${e?.message || "unknown error"}). Manual review required.`,
      declaredSourceMatchesDocument: null,
      inferredAnnualIncomePence: null,
      redFlags: [],
      evidence: [],
      generatedAt: new Date().toISOString(),
      model: SOF_MODEL,
    };
  }
}

// Convenience: persist a SoF analysis onto the deal record.
export async function saveSofAnalysis(dealId: string, analysis: SofAnalysisOutput, declaredSource?: string | null) {
  // Append to the existing analysis array (deals can have multiple SoF docs).
  const existing = await pool.query(`SELECT aml_sof_analysis FROM crm_deals WHERE id = $1`, [dealId]);
  const current = (existing.rows[0]?.aml_sof_analysis as { items?: any[] } | null)?.items || [];
  const next = { items: [...current, analysis], lastRunAt: new Date().toISOString() };
  await pool.query(
    `UPDATE crm_deals SET aml_sof_analysis = $1, aml_source_of_funds = COALESCE(aml_source_of_funds, $2) WHERE id = $3`,
    [next, declaredSource || null, dealId]
  );
}

// Convenience: persist an AI triage result onto the deal record.
export async function saveAiTriage(dealId: string, triage: AiTriageOutput) {
  await pool.query(`UPDATE crm_deals SET aml_ai_triage = $1 WHERE id = $2`, [triage, dealId]);
}
