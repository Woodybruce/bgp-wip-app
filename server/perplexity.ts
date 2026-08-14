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

type AskOpts = {
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** Restrict web search to these domains (≤20 on Agent, ≤10 on Sonar). */
  searchDomains?: string[];
  /** Only consider results this fresh. */
  searchRecency?: "hour" | "day" | "week" | "month" | "year";
  /** Enforce structured output — the answer comes back as schema-valid JSON. */
  jsonSchema?: { name: string; schema: any };
  /** Extra Agent tools, e.g. [{ type: "people_search" }]. Agent-only —
   *  the Sonar fallback silently degrades to plain web search. */
  extraTools?: any[];
};

// Sonar model → Agent API preset, per Perplexity's migration table
// (docs.perplexity.ai/docs/agent-api/migrate-from-sonar). Callers can also
// pass a preset name directly as `model`.
const AGENT_PRESETS = new Set(["fast", "low", "medium", "high", "xhigh"]);
const SONAR_TO_PRESET: Record<string, string> = {
  "sonar": "fast",
  "sonar-pro": "low",
  "sonar-reasoning": "medium",
  "sonar-reasoning-pro": "medium",
  "sonar-deep-research": "high",
};

// Legacy Sonar chat/completions — kept as the automatic fallback while the
// Agent API beds in (Perplexity supports both; Agent is faster + cheaper).
async function askPerplexitySonar(prompt: string, opts: AskOpts, key: string): Promise<PerplexityResponse> {
  const model = opts.model && !AGENT_PRESETS.has(opts.model) ? opts.model : DEFAULT_MODEL;
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
    method: "POST",
    // Perplexity had no timeout — a hang here stalled every Promise.allSettled
    // that awaited it (Stage 1 market intel, the investigator's web_search).
    signal: AbortSignal.timeout(45_000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.2,
      // Best-effort parity with the Agent path — Sonar supports these natively.
      ...(opts.searchDomains?.length ? { search_domain_filter: opts.searchDomains.slice(0, 10) } : {}),
      ...(opts.searchRecency ? { search_recency_filter: opts.searchRecency } : {}),
      ...(opts.jsonSchema ? { response_format: { type: "json_schema", json_schema: { schema: opts.jsonSchema.schema } } } : {}),
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

// New Agent API (POST /v1/agent) — Perplexity's recommended replacement for
// Sonar chat/completions: same key, typed `output` array in the response.
async function askPerplexityAgent(prompt: string, opts: AskOpts, key: string): Promise<PerplexityResponse> {
  const requested = opts.model || DEFAULT_MODEL;
  const preset = AGENT_PRESETS.has(requested) ? requested : (SONAR_TO_PRESET[requested] || "fast");

  const body: any = { preset, input: prompt };
  if (opts.systemPrompt) body.instructions = opts.systemPrompt;
  if (opts.maxTokens ?? 800) body.max_output_tokens = opts.maxTokens ?? 800;
  if (opts.temperature != null) body.temperature = opts.temperature;
  // Search scoping + extra tools. Declaring web_search explicitly (to carry
  // the filters) replaces the preset's implicit search config, so only add
  // it when a filter is actually requested.
  const tools: any[] = [];
  if (opts.searchDomains?.length || opts.searchRecency) {
    tools.push({
      type: "web_search",
      ...(opts.searchDomains?.length ? { filters: { search_domain_filter: opts.searchDomains.slice(0, 20), ...(opts.searchRecency ? { search_recency_filter: opts.searchRecency } : {}) } }
        : { filters: { search_recency_filter: opts.searchRecency } }),
    });
  }
  if (opts.extraTools?.length) tools.push(...opts.extraTools);
  if (tools.length) body.tools = tools;
  if (opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64) || "output", schema: opts.jsonSchema.schema, strict: true },
    };
  }

  const res = await fetch(`${PERPLEXITY_BASE}/v1/agent`, {
    method: "POST",
    // Agent runs are multi-step; give them a little longer than Sonar had.
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Perplexity Agent ${res.status}: ${errBody.slice(0, 240)}`);
  }

  const data = await res.json();
  const output: any[] = Array.isArray(data?.output) ? data.output : [];

  // Answer text: concatenate output_text content from message items (the
  // final message is the answer; earlier ones are intermediate steps).
  const messageItems = output.filter((o) => o?.type === "message");
  const answer = messageItems
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c: any) => c?.type === "output_text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n")
    .trim();

  // Citations: search_results steps + any URL annotations on the message.
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const o of output) {
    // search_results, people_search_results, finance_search_results — all
    // carry a results[] of {url,title,...}.
    if (typeof o?.type === "string" && o.type.includes("search") && Array.isArray(o.results)) {
      for (const r of o.results) {
        if (r?.url && !seen.has(r.url)) { seen.add(r.url); citations.push({ url: r.url, title: r.title }); }
      }
    }
  }
  for (const m of messageItems) {
    for (const c of (Array.isArray(m.content) ? m.content : [])) {
      for (const a of (Array.isArray(c?.annotations) ? c.annotations : [])) {
        const url = a?.url || a?.url_citation?.url;
        if (url && !seen.has(url)) { seen.add(url); citations.push({ url, title: a?.title || a?.url_citation?.title }); }
      }
    }
  }

  if (!answer) throw new Error("Perplexity Agent returned no message text");
  return { answer, citations, model: `agent:${preset}`, raw: data };
}

let agentFallbackWarned = false;

/**
 * Core client — every Perplexity consumer in the app goes through here.
 * Tries the Agent API first (Perplexity's recommended, cheaper path), and
 * falls back to the legacy Sonar chat/completions on any failure so a
 * rollout hiccup can't take out market intel / AML screening / brand
 * research. Set PERPLEXITY_FORCE_SONAR=1 to pin the legacy path.
 */
export async function askPerplexity(prompt: string, opts: AskOpts = {}): Promise<PerplexityResponse> {
  const key = getPerplexityKey();
  if (!key) throw new Error("Perplexity not configured (set PERPLEXITY_API_KEY on Railway)");

  if (process.env.PERPLEXITY_FORCE_SONAR === "1") {
    return askPerplexitySonar(prompt, opts, key);
  }
  try {
    return await askPerplexityAgent(prompt, opts, key);
  } catch (err: any) {
    if (!agentFallbackWarned) {
      agentFallbackWarned = true;
      console.warn(`[perplexity] Agent API failed (${err?.message}) — falling back to Sonar chat/completions. Further fallbacks logged silently.`);
    }
    return askPerplexitySonar(prompt, opts, key);
  }
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
    const r = await askPerplexity(userPrompt, {
      systemPrompt,
      maxTokens: 900,
      temperature: 0.1,
      // (No recency filter — the screen looks back 5 years per the prompt.)
      // Schema-enforced verdict — no more "review" defaults caused by the
      // model wrapping its JSON in prose. The fence-strip parsing below
      // stays as the belt-and-braces for the Sonar fallback path.
      jsonSchema: {
        name: "adverse_media_verdict",
        schema: {
          type: "object",
          required: ["verdict", "summary", "findings"],
          properties: {
            verdict: { type: "string", enum: ["clear", "review", "adverse"] },
            summary: { type: "string" },
            findings: {
              type: "array",
              items: {
                type: "object",
                required: ["headline"],
                properties: {
                  headline: { type: "string" },
                  source: { type: "string" },
                  url: { type: "string" },
                  category: { type: "string" },
                },
              },
            },
          },
        },
      },
    });
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
