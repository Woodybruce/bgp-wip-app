// Claude-designed PDF — general-purpose tool that mirrors the Pathway
// Stage 9 Why Buy renderer but is callable directly from ChatBGP for any
// "designed deck / brochure / pitch / playbook / Why Buy memo" request
// where there is no Pathway run to draw from.
//
// Same recipe as `why-buy-design.ts → renderClaudeWhyBuy`:
//   1. Claude generates a self-contained HTML document using BGP brand
//      cues + accumulated document_design_preferences ("house style")
//   2. headless Chrome renders the HTML to a print-ready PDF
//   3. PDF goes to chat-media so the model can hand back a download link
//
// Deliberately one tool, not a wall of constraints — the system prompt
// steers ChatBGP to pick this for any visually polished output. The
// caller passes title + a markdown brief and optionally biases the
// design (scope=why_buy / placemaking / pitch / general).

import { saveFile } from "./file-storage";
import { preferencesPromptFor } from "./document-preferences";
import { htmlToPdfForWhyBuy } from "./document-briefs";
import { BGP_BRAND, renderHtmlWithClaude } from "./doc-engine";
import crypto from "crypto";

const BASE_PROMPT = `You are designing a polished investor / client document for Bruce Gillingham Pollard (BGP), a UK commercial property advisor.

Output a SINGLE self-contained HTML document — no external assets, no scripts, all CSS inline in a <style> tag. Make it print-ready (A4 landscape, one slide per page using @page and page-break-after on each section). It should look like a polished pitch deck or brochure, not a webpage.

${BGP_BRAND}

Default structure (adapt as appropriate to the brief):
1. Cover — title, hero number, instructed-by / generated-for line
2. Executive summary — 3-5 bullet "why this works" items
3. Property / subject — area, location, key stats
4. Tenant / brand / counterparty — covenant strength where relevant
5. Numbers — KPIs, IRR, equity multiple, exit, comps
6. Comparable evidence — comps, market context
7. Risks & mitigants — honest, brief
8. Next steps / asks

Each slide:
- Full-page section with page-break-after: always
- A bold section number top-left, title in serif
- Big hero number or chart-like data viz where relevant
- Supporting data/text below
- BGP footer band on every slide

PAGE DISCIPLINE (critical — the #1 defect to avoid is content bleeding off the page):
- A page is a hard, fixed-height budget. Headless Chrome CLIPS anything that overflows the page bottom mid-sentence — there is no reflow. Nothing may run past the footer band.
- Count your content before laying it out. A sidebar/key/legend column fits roughly 5 card-style entries on A4 landscape — if there are more, switch that content to a compact table, split it into two columns, or continue it on the next page. Never stack a long list into a fixed column and hope.
- Put break-inside: avoid on every card, row and figure so no item is ever split or clipped.
- When content is tight, shrink it (font-size, padding) or add a page — clipping is never acceptable.

MAPS:
- Any embedded Google Static Maps image must use maptype=hybrid (satellite imagery with road labels) — road-map styling only when the brief explicitly asks for it. If the brief supplies a staticmap URL with maptype=roadmap or no maptype parameter, rewrite that one parameter to hybrid and keep the rest of the URL identical.

Return ONLY the HTML, starting with <!DOCTYPE html>. No commentary, no markdown fences.`;

export interface DesignedPdfArgs {
  title: string;
  brief: string;             // markdown / structured content
  scope?: string;            // "why_buy" | "placemaking" | "pitch" | "general" — picks house style
  additionalInstructions?: string;
}

export interface DesignedPdfResult {
  success: true;
  title: string;
  downloadUrl: string;
  chatMediaFilename: string;
  downloadMarkdown: string;
  message: string;
}

export async function generateClaudeDesignedPdf(args: DesignedPdfArgs): Promise<DesignedPdfResult | { error: string }> {
  if (!args.title || !args.brief) return { error: "title and brief are required" };
  if (args.brief.length < 100) return { error: "brief is too short — include at least 100 chars of structured content" };
  if (!process.env.ANTHROPIC_API_KEY) return { error: "ANTHROPIC_API_KEY not configured" };

  // House-style preferences for the chosen scope (default why_buy). If
  // there are no rows for the scope yet, preferencesPromptFor returns
  // empty string and Claude designs from BASE_PROMPT only.
  const scope = args.scope || "why_buy";
  const housePrefs = await preferencesPromptFor(scope).catch(() => "");

  const userPrompt = [
    BASE_PROMPT,
    housePrefs ? `\n${housePrefs}` : "",
    args.additionalInstructions ? `\nAdditional design notes:\n${args.additionalInstructions}` : "",
    `\n--- BRIEF ---\n\n${args.brief}`,
  ].join("");

  const html = await renderHtmlWithClaude(userPrompt);
  if (!html || html.length < 200) return { error: "Claude returned empty or too-short HTML" };

  const pdfBuf = await htmlToPdfForWhyBuy(html);

  const safeTitle = args.title.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80) || "BGP_Designed_PDF";
  const storageFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeTitle}.pdf`;
  const displayName = `${args.title}.pdf`;
  await saveFile(`chat-media/${storageFilename}`, pdfBuf, "application/pdf", displayName);
  const downloadUrl = `/api/chat-media/${storageFilename}`;

  return {
    success: true,
    title: args.title,
    downloadUrl,
    chatMediaFilename: storageFilename,
    downloadMarkdown: `[Download ${displayName}](${downloadUrl})`,
    message: `Designed PDF "${args.title}" generated via Claude (BGP house style).`,
  };
}
