// BGP Document Engine — the shared core every document generator renders
// through. Extracted from the Why Buy designer (server/why-buy-design.ts),
// which is the best of the bunch: Claude authors self-contained, print-ready
// HTML in the BGP house style, headless Chrome renders the PDF.
//
// Before this, the same ~30 lines (BGP brand cues, the Claude call, fence
// stripping, HTML sanitising) were copy-pasted across why-buy-design.ts,
// claude-designed-pdf.ts and document-briefs.ts. They all now import from
// here, so there is ONE engine and one place to improve the house style /
// model / safety rules.
//
// Layering:
//   - this file        → the design call (prompt → safe HTML) + house brand
//   - document-briefs  → htmlToPdf* (the single puppeteer/chromium renderer)
//   - document-preferences → house-style preferences (scope-keyed) injected
//                            into the prompt by each caller
//
// Keep it deliberately small: a brand constant, sanitisers, and one
// renderHtmlWithClaude(). Doc-type structure lives in the registry/briefs.

// The model used for all HTML design. One constant so a bump is one line.
export const DESIGN_MODEL = "claude-sonnet-4-6";

// House brand cues, injected into every design prompt. Single source of
// truth — was previously duplicated verbatim in three files.
export const BGP_BRAND = `
BGP brand cues:
- Primary teal: #15616D
- Cream: #FBF5DF
- Charcoal: #001524
- Accent gold: #FF7D00
- Typography: serif headlines (display), sans-serif body. Tight tracking on headlines.
- Tone: confident, evidence-led, never hyperbolic. UK property language ('instructions', 'completions', 'lease events').
- Layout: generous whitespace, clear sections, big numbers, supporting evidence underneath.
`;

// Strip a leading ```html fence / trailing ``` if Claude wrapped the output.
export function stripCodeFences(raw: string): string {
  return raw.replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim();
}

// Make Claude's HTML safe to embed in the sandboxed preview iframe and to
// render headless. Starts the document at <!DOCTYPE> (drops any prose
// preamble) and removes executable / embedding tags + inline event handlers.
// This is the union of the two slightly different sanitisers that existed
// before — strictly the safer of the two.
export function safeHtml(s: string): string {
  const idx = s.indexOf("<!DOCTYPE");
  const body = idx >= 0 ? s.slice(idx) : s;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/on[a-z]+="[^"]*"/gi, "")
    .replace(/on[a-z]+='[^']*'/gi, "");
}

export interface RenderHtmlOptions {
  maxTokens?: number;
  model?: string;
}

/**
 * The one design call: send a fully-composed prompt to Claude and get back
 * sanitised, fence-free HTML ready to preview or render to PDF. Honours the
 * AI_INTEGRATIONS_ANTHROPIC_* gateway override when both env vars are set
 * (same behaviour document-briefs relied on), otherwise the direct key.
 */
export async function renderHtmlWithClaude(prompt: string, opts: RenderHtmlOptions = {}): Promise<string> {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
    ? process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
    : undefined;
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const msg = await client.messages.create({
    model: opts.model || DESIGN_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = msg.content?.[0]?.type === "text" ? (msg.content[0] as any).text : "";
  return safeHtml(stripCodeFences(raw));
}
