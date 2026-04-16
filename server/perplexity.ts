// ─────────────────────────────────────────────────────────────────────────
// Perplexity client + adverse-media wrapper.
//
// Two use cases today:
//   1. Ad-hoc research (POST /api/perplexity/ask) — used by ChatBGP + the
//      research drawer when the team wants fresh, cited web results.
//   2. Adverse-media screening during AML — askPerplexity wrapped around a
//      strict prompt that looks for fraud / sanctions / insolvency hits on
//      a named subject, and returns a structured verdict that the KYC
//      orchestrator uses to tick `adverse_media` automatically.
//
// Env var resolution matches server/integrations-status.ts exactly:
//   PERPLEXITY_API_KEY → PERPLEXITY_API → "PERPLEXITY API" (Woody's Railway
//   has a space in the var name) → PERPLEXITY.
// ─────────────────────────────────────────────────────────────────────────
import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";

const PERPLEXITY_BASE = "https://api.perplexity.ai";
const DEFAULT_MODEL = "sonar"; // cheap web-grounded model with citations

function getPerplexityKey(): string {
  return (
    process.env.PERPLEXITY_API_KEY ||
    process.env.PERPLEXITY_API ||
    process.env["PERPLEXITY API"] ||
    process.env.PERPLEXITY ||
    ""
  ).trim();
}

export function isPerplexityConfigured(): boolean {
  return getPerplexityKey().length > 0;
}

type Citation = { url: string; title?: string };

export type PerplexityResponse = {
  answer: string;
  citations: Citation[];
  model: string;
  raw?: any;
};

/**
 * Core client. OpenAI-compatible chat/completions schema.
 * Throws if Perplexity isn't configured or returns non-2xx.
 */
export async function askPerplexity(
  prompt: string,
  opts: {
    model?: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  } = {},
): Promise<PerplexityResponse> {
  const key = getPerplexityKey();
  if (!key) throw new Error("Perplexity not configured (set PERPLEXITY_API_KEY on Railway)");

  const model = opts.model || DEFAULT_MODEL;
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.2,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Perplexity ${res.status}: ${errBody.slice(0, 240)}`);
  }

  const data = await res.json();
  const answer: string = data?.choices?.[0]?.message?.content || "";
  // Perplexity returns citations either as `citations: string[]` (older) or
  // as `search_results: [{url,title}]` (newer sonar). Normalise both.
  const rawCites: any[] =
    (Array.isArray(data?.search_results) && data.search_results) ||
    (Array.isArray(data?.citations) && data.citations) ||
    [];
  const citations: Citation[] = rawCites.map((c: any) =>
    typeof c === "string" ? { url: c } : { url: c.url, title: c.title },
  );

  return { answer, citations, model, raw: data };
}

export type AdverseMediaResult = {
  hasAdverse: boolean;
  summary: string;
  findings: Array<{ headline: string; source?: string; url?: string; category?: string }>;
  citations: Citation[];
  verdict: "clear" | "review" | "adverse";
  rawAnswer: string;
};

/**
 * Adverse-media screen for a named subject (person or company).
 * Returns a structured verdict we can fold into the AML checklist.
 *
 * Design notes:
 *  - We force a JSON output format so downstream code isn't parsing prose.
 *  - We cap the search to the last 5 years (Perplexity honours freshness
 *    hints in the prompt).
 *  - "review" is the safe default if Perplexity isn't confident — the MLRO
 *    still has to manually sign off in that case.
 */
export async function adverseMediaSearch(
  subjectName: string,
  contextHints: { country?: string; companyNumber?: string; dob?: string } = {},
): Promise<AdverseMediaResult> {
  const hints: string[] = [];
  if (contextHints.country) hints.push(`Country: ${contextHints.country}`);
  if (contextHints.companyNumber) hints.push(`Companies House number: ${contextHints.companyNumber}`);
  if (contextHints.dob) hints.push(`Date of birth: ${contextHints.dob}`);
  const hintLine = hints.length ? `\nContext: ${hints.join(" · ")}` : "";

  const systemPrompt =
    "You are an AML analyst. Search the public web for adverse media on the named subject: " +
    "fraud, financial crime, sanctions, money laundering, bribery, terrorism financing, " +
    "insolvency/bankruptcy, serious regulatory action, organised crime, or significant " +
    "ongoing litigation. Ignore positive/neutral coverage. Focus on the last 5 years. " +
    "Respond ONLY with a JSON object, no prose around it, using this schema: " +
    `{"verdict": "clear" | "review" | "adverse", ` +
    `"summary": "one sentence summary", ` +
    `"findings": [{"headline": "...", "source": "publisher", "url": "...", "category": "fraud|sanctions|insolvency|litigation|other"}]} ` +
    `Use "clear" only if you found no adverse coverage after a genuine search. ` +
    `Use "adverse" if you found credible, specific negative coverage. ` +
    `Use "review" for ambiguous hits (common name, unclear match, uncorroborated allegations).`;

  const userPrompt = `Subject: ${subjectName}${hintLine}\n\nReturn the JSON object now.`;

  let verdict: AdverseMediaResult["verdict"] = "review";
  let summary = "";
  let findings: AdverseMediaResult["findings"] = [];
  let rawAnswer = "";
  let citations: Citation[] = [];

  try {
    const r = await askPerplexity(userPrompt, { systemPrompt, maxTokens: 900, temperature: 0.1 });
    rawAnswer = r.answer;
    citations = r.citations;

    // Perplexity often wraps JSON in ```json fences; strip them.
    const cleaned = r.answer
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    // If there's prose before/after, try to isolate the outermost JSON object.
    const braceStart = cleaned.indexOf("{");
    const braceEnd = cleaned.lastIndexOf("}");
    const jsonStr = braceStart >= 0 && braceEnd > braceStart ? cleaned.slice(braceStart, braceEnd + 1) : cleaned;

    const parsed = JSON.parse(jsonStr);
    if (parsed.verdict === "clear" || parsed.verdict === "adverse" || parsed.verdict === "review") {
      verdict = parsed.verdict;
    }
    if (typeof parsed.summary === "string") summary = parsed.summary;
    if (Array.isArray(parsed.findings)) {
      findings = parsed.findings
        .filter((f: any) => f && typeof f.headline === "string")
        .map((f: any) => ({
          headline: String(f.headline),
          source: f.source ? String(f.source) : undefined,
          url: f.url ? String(f.url) : undefined,
          category: f.category ? String(f.category) : undefined,
        }));
    }
  } catch (e: any) {
    // Parse failure → treat as review (safe default)
    verdict = "review";
    summary = `Adverse media search inconclusive: ${e?.message || "unknown error"}`;
  }

  return {
    hasAdverse: verdict === "adverse",
    summary,
    findings,
    citations,
    verdict,
    rawAnswer,
  };
}

// ─── HTTP surface ────────────────────────────────────────────────────────

const router = Router();

router.post("/api/perplexity/ask", requireAuth, async (req: Request, res: Response) => {
  try {
    const { prompt, model, systemPrompt, maxTokens, temperature } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt (string) required" });
    }
    const result = await askPerplexity(prompt, { model, systemPrompt, maxTokens, temperature });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Perplexity request failed" });
  }
});

router.post("/api/perplexity/adverse-media", requireAuth, async (req: Request, res: Response) => {
  try {
    const { subject, country, companyNumber, dob } = req.body || {};
    if (!subject || typeof subject !== "string") {
      return res.status(400).json({ error: "subject (string) required" });
    }
    const result = await adverseMediaSearch(subject, { country, companyNumber, dob });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Adverse media search failed" });
  }
});

export default router;
