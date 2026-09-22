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

import fs from "node:fs";

// The model used for all HTML design. One constant so a bump is one line.
// Fable 5 — the most design-sensitive output in the product (Why Buy decks,
// document briefs, designed PDFs) gets the strongest model.
export const DESIGN_MODEL = "claude-fable-5";

// House brand cues, injected into every design prompt. Single source of
// truth — was previously duplicated verbatim in three files.
export const BGP_BRAND = `
BGP brand (2026 rebrand, v19 — the ONLY palette allowed):
- Bordeaux #6E0C25 — THE brand colour: titles, key rules, stat blocks, cover/divider backgrounds (white text on it).
- Ink #1D1D1B for body text. Cream #FCF8F4 or white grounds. Blush #E4D8D3 for panels and hairline dividers.
- Nectar #FC9F8D — one warm highlight per spread at most. Stone #C2BAA3 for muted supporting tints.
- FORBIDDEN: teal, green, orange, gold, navy, black backgrounds. Never invent a logo, monogram, "BGP" box or letter-mark.
- Logo: the real BGP wordmark image, and only this. On light grounds: <img src="__BGP_LOGO_DARK__" alt="Bruce Gillingham Pollard" style="height:34px"> ; on bordeaux/dark grounds: <img src="__BGP_LOGO_LIGHT__" alt="Bruce Gillingham Pollard" style="height:34px">. Keep the placeholder tokens EXACTLY as written — they are swapped for the image at render time. Small, top-left of the cover and in the running footer; never stretched, never recoloured, never accompanied by the firm name typed out as a second wordmark.
- Typography: serif display (Georgia / Lora) in sentence case, sans-serif body (Lato / Helvetica). Tight tracking on headlines; small caps labels letter-spaced.
- Tone: confident, evidence-led, never hyperbolic. UK property language ('instructions', 'completions', 'lease events').
- Layout: generous whitespace, clear sections, big numbers, supporting evidence underneath.
`;

// The real BGP wordmark PNGs (server/assets) as data URIs, swapped in for the
// __BGP_LOGO_*__ tokens at render time so every design path ships the actual
// logo rather than whatever the model draws.
let _logoCache: { dark: string; light: string } | null = null;
export function bgpLogoDataUris(): { dark: string; light: string } {
  if (_logoCache) return _logoCache;
  const read = (file: string): string => {
    for (const p of [`${process.cwd()}/server/assets/${file}`, `${process.cwd()}/dist/server/assets/${file}`]) {
      try {
        if (fs.existsSync(p)) return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
      } catch {}
    }
    return "";
  };
  _logoCache = { dark: read("BGP_BlackHolder.png"), light: read("BGP_WhiteHolder.png") };
  return _logoCache;
}

export function injectBgpLogos(html: string): string {
  if (!html.includes("__BGP_LOGO_")) return html;
  const { dark, light } = bgpLogoDataUris();
  return html.replaceAll("__BGP_LOGO_DARK__", dark).replaceAll("__BGP_LOGO_LIGHT__", light);
}

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
  const model = opts.model || DESIGN_MODEL;
  const params: any = {
    model,
    max_tokens: opts.maxTokens ?? 16000,
    messages: [{ role: "user", content: prompt }],
  };
  // Fable's safety classifiers can decline — the server-side fallback
  // re-serves a false positive on Opus 4.8 within the same call.
  const isFable = model.startsWith("claude-fable");
  if (isFable) {
    params.betas = ["server-side-fallback-2026-06-01"];
    params.fallbacks = [{ model: "claude-opus-4-8" }];
  }
  const msg: any = isFable
    ? await (client as any).beta.messages.create(params)
    : await client.messages.create(params);
  if (msg?.stop_reason === "refusal") {
    throw new Error("Design model declined the request (safety refusal) — adjust the brief and retry");
  }
  const textBlock = (msg?.content || []).find((b: any) => b.type === "text");
  const raw = textBlock?.text || "";
  if (!raw.trim()) throw new Error("Design model returned no content");
  return safeHtml(stripCodeFences(raw));
}
