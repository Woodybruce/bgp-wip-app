import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { pool } from "./db";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import mammoth from "mammoth";
import Anthropic from "@anthropic-ai/sdk";
import { callClaude, CHATBGP_HELPER_MODEL } from "./utils/anthropic-client";

// Document Studio uses the best available Opus model for all generations.
// Try 4.7 (Claude Design model) first; fall back to 4.6 if not yet API-accessible.
const DOC_OPUS_PRIMARY = "claude-opus-4-7";
const DOC_OPUS_FALLBACK = "claude-opus-4-6";

async function callDocOpus(opts: Parameters<typeof callClaude>[0]): Promise<ReturnType<typeof callClaude>> {
  try {
    return await callClaude({ ...opts, model: DOC_OPUS_PRIMARY });
  } catch (err: any) {
    if (/model|not found|invalid/i.test(err?.message || "")) {
      console.log(`[doc-studio] ${DOC_OPUS_PRIMARY} not available, falling back to ${DOC_OPUS_FALLBACK}`);
      return callClaude({ ...opts, model: DOC_OPUS_FALLBACK });
    }
    throw err;
  }
}

// Build a structured slide plan from document content using Opus.
// Returns an array of slide objects; falls back to null on error.
async function buildSlidePlan(content: string, title: string, documentType?: string): Promise<any[] | null> {
  const prompt = `You are a professional presentation designer for Bruce Gillingham Pollard, a premier London commercial property agency.

Convert the document content below into a structured slide plan for a polished PPTX deck.

Return a JSON object with a "slides" array. Each slide must be one of these exact types:

{"type":"cover","title":"...","subtitle":"..."} — opening title slide
{"type":"section","title":"SECTION NAME IN CAPS"} — dark divider slide between major sections
{"type":"content","sectionLabel":"SHORT LABEL","heading":"Slide heading (4-7 words)","bullets":["concise bullet","concise bullet","max 6"]} — standard content slide
{"type":"twocol","sectionLabel":"SHORT LABEL","heading":"Heading","leftBullets":["..."],"rightBullets":["..."]} — two-column layout for comparisons
{"type":"stat","sectionLabel":"SHORT LABEL","heading":"What this means","stats":[{"value":"£X.Xm","label":"Headline Rent"},{"value":"X%","label":"Yield"},{"value":"X,XXX sq ft","label":"Area"}]} — key numbers slide (max 4 stats)
{"type":"quote","text":"The quote text here","attribution":"SOURCE OR PERSON"} — pull-quote or key statement
{"type":"end"} — closing thank you slide

RULES:
- One story per slide — split any section with >6 bullets into two content slides
- Section labels are SHORT UPPERCASE abbreviations (3-4 words max): "INVESTMENT OVERVIEW", "MARKET DATA"
- Headings: sentence case, punchy, 4-7 words
- Bullets: factual, max 12 words each, no filler words
- Use twocol for before/after, pros/cons, or two-location comparisons
- Use stat slides for pages with 3-4 key numbers
- Use quote slides for testimonials, headlines, or dramatic single facts
- Add section dividers between major topic changes
- Always start with cover, always end with end

Document title: ${title}
Document type: ${documentType || "General"}

CONTENT:
${content.slice(0, 12000)}

Return ONLY the JSON object. No explanation.`;

  try {
    const completion = await callDocOpus({
      model: DOC_OPUS_PRIMARY,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_completion_tokens: 4096,
    });
    const raw = completion.choices[0]?.message?.content || "{}";
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(jsonStr);
    const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
    return slides.length > 0 ? slides : null;
  } catch (err: any) {
    console.log("[doc-studio] Slide plan generation failed, using markdown fallback:", err?.message?.slice(0, 100));
    return null;
  }
}
import { GoogleGenAI } from "@google/genai";

const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const CANVA_API_BASE = "https://api.canva.com/rest/v1";

async function getCanvaToken(session: any): Promise<string | null> {
  if (!session.canvaTokens) return null;
  if (Date.now() < session.canvaTokens.expiresAt - 60000) {
    return session.canvaTokens.accessToken;
  }
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(CANVA_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.canvaTokens.refreshToken,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    session.canvaTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || session.canvaTokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

async function createCanvaDesignFromContent(
  session: any,
  title: string,
  _content: string,
  _documentType?: string,
): Promise<{ designId: string; editUrl: string | null; viewUrl: string | null } | null> {
  const token = await getCanvaToken(session);
  if (!token) return null;

  const res = await fetch(`${CANVA_API_BASE}/designs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      design_type: { type: "custom", width: 595, height: 842 },
      title: title,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Canva design creation failed:", errText);
    return null;
  }

  const result = await res.json();
  console.log("[canva] Design creation response:", JSON.stringify(result, null, 2));
  const design = result.design || result;

  return {
    designId: design.id,
    editUrl: design.urls?.edit_url || design.edit_url || null,
    viewUrl: design.urls?.view_url || design.view_url || null,
  };
}

const BGP_BRANDING_GUIDELINES = `
BRUCE GILLINGHAM POLLARD (BGP) — Official Style Guide & Template Instructions (December 2019, updated)
Source: BGP Style Guide PDF — the authoritative brand reference for all BGP documents and presentations.

Company: Bruce Gillingham Pollard — a boutique property consultancy specialising in prime central London (Belgravia, Mayfair, Chelsea, Knightsbridge) and major mixed-use developments nationally.

BRAND IDENTITY:
- Premium, understated luxury. Traditional English estate agency meets modern professionalism.
- Tone: authoritative, measured, discreet. Never flashy or informal.
- Main principle: "No brand colour — colour comes from content."
- The BGP look is bold typography with large amounts of negative space — dramatic, confident, editorial.

LOGO:
- Exclusion zone: maintain clear space around the logo equal to the height of the "B" in "Bruce".
- Logo in holder: used on dark backgrounds or over images. White wordmark sits within a dark rectangle.
- Colourways: Black wordmark on light backgrounds, white wordmark on dark backgrounds. Never alter, stretch, or recolour.
- Always include BGP logo on formal documents (letters, reports, proposals, memos).
- Logo position: Top-left for letters, top-right for presentation decks (in holder with decorative bars).
- Omit logo for internal notes, quick memos, or casual documents.

COLOUR & MATERIALITY (from official style guide):
Main colours (monochrome base):
- BGP Slate: #232323 (R23 G23 B23) — primary dark, headings, key text, accent elements, cover backgrounds
- BGP Warm Grey: #E8E6DF (R232 G230 B223) — secondary background, panels, section backgrounds
- BGP Cool Grey: #596264 (R89 G98 B100) — mid-grey for body text, captions, secondary text
- White: #FFFFFF — clean white backgrounds, text on dark backgrounds
- Body text: Black (#000000) or near-black (#232323)
- Divider grey: #DDDFE0 or #E8E6DF — for thin rule lines between sections

Secondary colour palettes (for digital decks only, used sparingly):
- BGP Lime: R221 G237 B227
- BGP Ice: R221 G229 B237
- BGP Teal: R143 G198 B204
- BGP Pink: R209 G175 B168
- BGP Green: R35 G70 B47
- BGP Navy: R0 G33 B56
- BGP Highlight Orange: reserved (use very sparingly if at all)
- BGP Highlight Mustard: R255 G185 B55
- BGP Highlight Cyan: R58 G119 B255

Print detailing: Copper (foil/emboss for physical print only, not digital).
IMPORTANT: Default documents should be strictly monochrome (slate, warm grey, cool grey, white). Secondary palettes may only be used in digital presentation decks when specifically requested.

TYPOGRAPHY (from official style guide — Work Sans is the BGP brand font):
- Primary font: WORK SANS — available via Adobe Fonts or Google Fonts.
- Work Sans Medium — used for section labels, captions, uppercase headings.
- Work Sans Regular — used for body text, descriptions, longer content.
- Headings in documents: "Grotta, Work Sans, Arial, sans-serif" — BGP's primary heading font. Used BOLD, often UPPERCASE or split across 2-3 lines for dramatic effect.
- Subheadings/section labels: "Neue Machina, Work Sans, Arial, sans-serif" — modern, geometric. Used for "SECTION TITLE" labels, always UPPERCASE, small size (9-11pt), letter-spaced.
- Body text: "Work Sans, Arial, sans-serif" for most documents. "MinionPro, Times New Roman, serif" for formal/legal documents.
- Fallback: Work Sans, Arial, Arial Narrow (always available web-safe).
- Font sizes: Main titles 24-36pt bold, section labels 9-11pt medium uppercase, body 10-12pt regular. Never smaller than 9pt.
- Title hierarchy from BGP decks: Small "SECTION TITLE" label (9pt, uppercase, medium weight, letter-spaced) → Large "Title of page\\ntwo lines" heading (22-36pt) → Body text.

PRESENTATION DECK PRINCIPLES (from official style guide):
- Digital only format.
- Move away from editorial style layouts and "blocks" of text.
- Move away from "spreads" and juxtapositions.
- Be more singular — a slide should tell one story.
- Reduce text — don't write what you will say and vice versa.
- Be more confident — do not repeat content at beginning and end.
- Template set up at 1920×1080px (16:9 widescreen) for presenting on screens.
- Two versions of each text slide: "Presented deck" (minimal text, for speaking over) and "Sent deck" (more detailed, for reading).

PRESENTATION SLIDE TYPES (from official style guide template library):

Cover slides (4 variants):
1. BGP logo/title — Dark background, logo in holder top-right with decorative bars, project name bottom-left, "PREPARED FOR XX PERSON, MONTH YYYY" subtitle.
2. BGP block/title — Similar but with white rectangular blocks pattern.
3. Image/logo/title — Background image with logo in holder and title overlay.
4. Multi-image/logo/title — Multiple numbered images with logo and title.

Breaker/section pages (4 variants):
1. Plain section break — Dark background, "3 LINE TITLE OF SECTION" in large bold type.
2. Text section break — Dark background with section title plus introduction text for sent decks.
3. Image section break — Dark background with section title and numbered image.
4. Quotes — Quote text with "PERSON WHO SAID IT" attribution.

Text templates (4 variants for both presented and sent versions):
1. Key text pages — "SECTION TITLE" label, "Title of page two lines" heading, body paragraph.
2. Text — Two-column text layout with section title and heading.
3. Numbered — Numbered list (1-12) with section title and heading.
4. Bulleted — Em-dash (—) prefixed bullet points in two columns.

Text + graphic templates:
1. Timeline — Horizontal timeline with milestone markers, dates, and descriptions.
2. Graph — Chart/graph area with percentage axis and data.
3. Rent table — Table with columns: Use Class, Approx area, £ psf, Rent (£pa), Incentives, Yield %.

Image pages (multiple variants):
- Full-bleed single image with caption.
- 2-image split with captions.
- 3-image grid (2+1) with numbered images and captions.
- 4-image grid (2×2) with titles and description text.
- Image with sidebar text and description.
- Image with branded overlay text.

People pages:
- 4-person grid: Photo, name, role, bullet biography for each.
- 2-person detailed: Larger photos with extended biography text.
- Single person feature: Full-width with detailed biography.

Logo/client grid pages:
- Grid of 9-18 client/tenant logos arranged in rows.
- Can include unit sizes (sq m / sq ft) below each.

Floor plan pages:
- Large floor plan image with numbered unit labels.
- Accompanying text with unit descriptions or schedule.

Strategy/concept pages:
- Tenant mix categories with named tenants.
- Strategy text with supporting images and data.

Thank you/end page:
- Dark background, "Thank you" or closing text, contact information, website.

PAGE LAYOUT PATTERNS (for A4 documents):

1. COVER PAGE: Full-bleed hero image or dark (#232323) background. Project name in large bold (28-36pt) positioned bottom-left or centre. "PREPARED FOR [NAME], [MONTH YEAR]" subtitle (10pt). Logo small in corner.

2. SECTION DIVIDER: Dark (#232323) or image background. 3-line dramatic title in very large bold (36-48pt), stacked left-aligned with generous line height. Small "SECTION TITLE" label above. Maximum visual impact with minimal text.

3. CONTENT PAGE: Small "SECTION TITLE" label top-left (9pt, uppercase). Main heading "Title of page two lines" below (24-28pt, bold). Body text in left column (55-60% width). Supporting content in right column.

4. QUOTE PAGE: Large pull quote centred or left-aligned with generous margins. Attribution below: "PERSON WHO SAID IT" in small caps.

5. TABLE/DATA PAGE: "SECTION TITLE" label + heading. Clean table with thin borders (#E8E6DF), header row in darker background. Footnotes at bottom.

6. IMAGE GRID PAGE: 2-6 images in grid layout with captions (8-9pt, uppercase). Images should fill their frames.

7. TEAM PAGE: Side-by-side team member blocks. Name in bold uppercase (14pt), job title below (11pt), then bio paragraph (10pt). Typically 2-4 people per page.

8. TIMELINE PAGE: Horizontal timeline bar with milestone markers. Dates/labels in medium weight. Supporting text below.

9. BULLET LIST PAGE: "SECTION TITLE" + heading. Two-column layout of em-dash (—) prefixed bullet points.

10. NUMBERED LIST PAGE: "SECTION TITLE" + heading. Bold numbers (1-12) with accompanying text. Can be two-column.

LAYOUT GENERAL RULES:
- Formal letters: Letterhead style with logo top-left, narrow margins, single or 1.15 line spacing
- Reports/proposals: Logo top-centre, normal margins, 1.5 line spacing, section headings in bold uppercase
- Pitch decks/presentations: Follow slide patterns above with dramatic typography and generous whitespace
- Legal documents: No logo, wide margins, 1.5 line spacing, serif body font
- Internal memos: No letterhead, narrow margins, sans-serif throughout, compact layout
- Schedules/tables: No letterhead, narrow margins, sans-serif, tight spacing
- Always use GENEROUS whitespace — BGP style favours dramatic negative space over dense content

BORDERS & DIVIDERS:
- Thin rectangle dividers (#E8E6DF grey or #232323 black) between major sections
- Formal reports: thin bottom border on letterhead
- Legal documents: none
- Letters: none or thin top border
- Internal: none

FOOTER:
- Formal documents: "Bruce Gillingham Pollard — Confidential" or company address "55 Wells Street, London W1T 3PT | Tel: 020 7436 1212"
- Pitch decks: "www.brucegillinghampollard.com" or omit
- Internal: omit or minimal

INSTAGRAM & SOCIAL MEDIA (from style guide):
- Social media icon: Export as PNG at 96dpi. Use across all channels.
- Brand posts: Place images into blue placeholder shapes. Export PNG at 96dpi.
- Graphic/photo templates: Images in blue shapes, tones can hold same image offset for "refraction" technique.
- Moving templates (After Effects): Block video, 3 strand video, Lens video.
- Story templates: Text/quote templates with swipe-up links.
- Social templates folder on SharePoint: https://brucegillinghampollardlimited-my.sharepoint.com/:f:/g/personal/woody_brucegillinghampollard_com/IgCTJYuaGm0DTbC8XiUYTI4hAXnXbYVhODJE7IwkPLi5sRs?e=a22Cxk
- Social media visual style: Monochrome base with BGP branded overlays, clean typography (Work Sans), consistent image framing. Use the "refraction" technique (same image offset in tonal shapes) for graphic impact.
- Instagram grid: Brand posts alternate between image posts and graphic/quote posts for visual rhythm.
- Story format: 1080×1920px vertical. Use text overlay templates or quote templates. Always include "brucegillinghampollard" handle.
- Post format: 1080×1080px square. Place imagery within BGP-branded frame shapes. Export PNG at 96dpi.
- Reels/video: Use After Effects moving templates (block video, 3-strand, lens). H.264 export format.

EXPORTING GUIDELINES (from style guide):
- For presenting: Adobe PDF (print), smallest file size (forces RGB), image resolution 144dpi (retina).
- For sending: Keep under 10MB, Adobe PDF (print), smallest file size, image resolution 72dpi.
- Paragraph styles are pre-set for consistency.
- Colour palettes: Master, Alternate Palette A, Alternate Palette B available as InDesign swatches.
`;

async function autoDesignWithClaude(templateContent: string, templateName: string, description: string | null): Promise<Record<string, any>> {
  const contentPreview = templateContent.slice(0, 3000);

  const prompt = [
    "You are a document design specialist for Bruce Gillingham Pollard (BGP), a premium London property consultancy.",
    "",
    "Based on the branding guidelines below and the template content provided, generate the optimal visual design settings for this document.",
    "",
    BGP_BRANDING_GUIDELINES,
    "",
    "TEMPLATE NAME: " + templateName,
    "DESCRIPTION: " + (description || "Not provided"),
    "TEMPLATE CONTENT (preview):",
    contentPreview,
    "",
    "Analyse the document type (letter, report, proposal, legal, memo, schedule, etc.) and return a JSON object with these exact keys:",
    '{',
    '  "fontFamily": "font-family CSS value for body text",',
    '  "fontSize": "size in pt (e.g. 11pt)",',
    '  "headingFont": "font-family CSS value for headings",',
    '  "headingSize": "size in pt (e.g. 16pt)",',
    '  "headingColor": "hex colour for headings",',
    '  "bodyColor": "hex colour for body text",',
    '  "accentColor": "hex colour for accents/borders",',
    '  "showLogo": true or false,',
    '  "logoPosition": "top-left" or "top-center" or "top-right",',
    '  "headerText": "text for header area (company name or empty)",',
    '  "footerText": "text for footer area or empty string",',
    '  "pageMargin": "narrow" or "normal" or "wide",',
    '  "lineSpacing": "1" or "1.15" or "1.5" or "1.75" or "2",',
    '  "letterhead": true or false,',
    '  "borderStyle": "none" or "thin" or "double" or "thick",',
    '  "borderColor": "hex colour for border"',
    '}',
    "",
    "Apply BGP brand precisely. Choose settings appropriate for this specific document type. Return ONLY the JSON object, no other text.",
  ].join("\n");

  let text = "";
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const geminiResponse = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 2048, temperature: 0.2 },
      });
      text = geminiResponse.text || "";
      console.log("[auto-design] Gemini response length:", text.length);
    } catch (geminiErr: any) {
      console.log("[auto-design] Gemini failed, falling back to Claude Sonnet:", geminiErr?.message);
    }
  }
  if (!text) {
    try {
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
      });
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      text = response.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      console.log("[auto-design] Claude response length:", text.length);
    } catch (claudeErr: any) {
      console.log("[auto-design] Claude also failed:", claudeErr?.message);
    }
  }

  const BGP_DEFAULT_DESIGN = {
    fontFamily: "Work Sans, Arial, sans-serif",
    fontSize: "11pt",
    headingFont: "Grotta, Work Sans, Arial, sans-serif",
    headingSize: "18pt",
    headingColor: "#232323",
    bodyColor: "#000000",
    accentColor: "#232323",
    showLogo: true,
    logoPosition: "top-left",
    headerText: "Bruce Gillingham Pollard",
    footerText: "Bruce Gillingham Pollard — Confidential",
    pageMargin: "normal",
    lineSpacing: "1.15",
    letterhead: true,
    borderStyle: "thin",
    borderColor: "#E8E6DF",
  };

  if (!text) {
    console.log("[auto-design] Both AI providers returned empty text, using BGP brand defaults");
    return BGP_DEFAULT_DESIGN;
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log("[auto-design] Could not find JSON in response, preview:", text.slice(0, 300));
    return BGP_DEFAULT_DESIGN;
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (parseErr: any) {
    console.log("[auto-design] JSON parse failed:", parseErr?.message, "raw:", jsonMatch[0].slice(0, 200));
    return BGP_DEFAULT_DESIGN;
  }
}

const GEMINI_IMAGE_MODELS = ["gemini-2.5-flash-preview-image", "gemini-2.5-flash-image", "gemini-2.0-flash-exp"];

async function generateImageWithGemini(element: any): Promise<void> {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) throw new Error("Gemini not configured");

  const { GoogleGenAI, Modality } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  const fullPrompt = `Professional, high quality, ${element.generatePrompt}. Suitable for premium London property documents. 4K resolution, clean modern design.`;

  const IMAGE_TIMEOUT_MS = 60000;

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      console.log(`[gemini-img] Trying model: ${model}`);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), IMAGE_TIMEOUT_MS));
      const genPromise = ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
      });
      const response = await Promise.race([genPromise, timeoutPromise]);
      if (response && typeof response === "object" && "candidates" in response) {
        const candidate = (response as any).candidates?.[0];
        const imagePart = candidate?.content?.parts?.find((part: any) => part.inlineData);
        if (imagePart?.inlineData?.data) {
          const mimeType = imagePart.inlineData.mimeType || "image/png";
          element.src = `data:${mimeType};base64,${imagePart.inlineData.data}`;
          console.log(`[gemini-img] Success with model: ${model}`);
          return;
        }
      }
      console.log(`[gemini-img] Model ${model} returned no image data`);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("UNSUPPORTED_MODEL") || msg.includes("not supported") || msg.includes("not found")) {
        console.log(`[gemini-img] Model ${model} not available, trying next...`);
        continue;
      }
      throw err;
    }
  }
  throw new Error("No Gemini image model available");
}

async function generateImageWithImagineArt(element: any): Promise<void> {
  const token = process.env.IMAGINE_TOKEN;
  if (!token) throw new Error("Imagine Art token not configured");

  const fullPrompt = `Professional, high quality, ${element.generatePrompt}. Suitable for premium London commercial property documents. Clean, modern, architectural photography style.`;
  console.log("[imagine-art] Generating:", fullPrompt.substring(0, 80));

  const FormData = (await import("form-data")).default;
  const authToken = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  const IMAGE_TIMEOUT_MS = 60000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

  try {
    const form = new FormData();
    form.append("prompt", fullPrompt);
    form.append("style_id", "29");
    form.append("aspect_ratio", "16:9");
    form.append("model", "V5");
    form.append("negative_prompt", "blurry, low quality, distorted, watermark");

    const response = await fetch("https://api.vyro.ai/v1/imagine/api/generations", {
      method: "POST",
      headers: {
        "Authorization": authToken,
        ...form.getHeaders(),
      },
      body: form.getBuffer(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.log("[imagine-art] v1 API error:", response.status, errText.substring(0, 200));
      const form2 = new FormData();
      form2.append("prompt", fullPrompt);
      form2.append("style", "realistic");
      form2.append("aspect_ratio", "1:1");
      form2.append("variation", "1");

      const response2 = await fetch("https://api.vyro.ai/v2/image/generations", {
        method: "POST",
        headers: {
          "Authorization": authToken,
          ...form2.getHeaders(),
        },
        body: form2.getBuffer(),
        signal: controller.signal,
      });

      if (!response2.ok) {
        const errText2 = await response2.text().catch(() => "");
        throw new Error(`Imagine Art API error ${response2.status}: ${errText2.substring(0, 200)}`);
      }

      const arrayBuffer = await response2.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");
      const contentType = response2.headers.get("content-type") || "image/png";
      element.src = `data:${contentType};base64,${base64}`;
      console.log("[imagine-art] Success (v2), size:", Math.round(buffer.length / 1024), "KB");
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");
    const contentType = response.headers.get("content-type") || "image/png";
    element.src = `data:${contentType};base64,${base64}`;
    console.log("[imagine-art] Success (v1), size:", Math.round(buffer.length / 1024), "KB");
  } finally {
    clearTimeout(timeout);
  }
}

async function generateSingleImage(element: any): Promise<void> {
  try {
    await generateImageWithGemini(element);
  } catch (geminiErr: any) {
    console.log("[img-gen] Gemini image failed, falling back to Imagine Art:", geminiErr?.message);
    try {
      await generateImageWithImagineArt(element);
    } catch (imagineErr: any) {
      console.log("[img-gen] Imagine Art also failed:", imagineErr?.message);
    }
  }
}

async function generateImagesForDesign(visualDesign: any): Promise<void> {
  if (!visualDesign?.pages) return;

  const imageElements: Array<{ element: any; pageIdx: number; elIdx: number }> = [];
  for (let pi = 0; pi < visualDesign.pages.length; pi++) {
    const page = visualDesign.pages[pi];
    if (!page.elements) continue;
    for (let ei = 0; ei < page.elements.length; ei++) {
      const el = page.elements[ei];
      if (el.type === "image" && el.generatePrompt && !el.src) {
        imageElements.push({ element: el, pageIdx: pi, elIdx: ei });
      }
    }
  }

  if (imageElements.length === 0) {
    console.log("[img-gen] No image elements with generatePrompt found in design");
    return;
  }

  const maxImages = Math.min(imageElements.length, 4);
  const selected = imageElements.slice(0, maxImages);
  console.log(`[img-gen] Found ${imageElements.length} image(s), generating ${selected.length} (Gemini Pro Image → Imagine Art fallback)`);

  await Promise.allSettled(
    selected.map(({ element }) => generateSingleImage(element))
  );

  for (const { element } of imageElements) {
    delete element.generatePrompt;
  }
}

// --- DALL-E 3 image generation for document embedding (PPTX, DOCX, PDF) ---
const IMAGE_DOCUMENT_TYPES = ["Pitch Deck", "Pitch Presentation", "Marketing Particulars", "Investment Deck", "Property Tour", "Case Study", "Leasing Deck", "Board Report", "Client Report"];

function shouldGenerateDocImages(documentType?: string): boolean {
  if (!documentType) return false;
  return IMAGE_DOCUMENT_TYPES.some(t => documentType.toLowerCase().includes(t.toLowerCase()));
}

async function generateImageForDocument(prompt: string): Promise<string | null> {
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log(`[doc-images] Generating image: "${prompt.slice(0, 80)}..."`);
    const resp = await openai.images.generate({
      model: "dall-e-3",
      prompt: `${prompt}. Professional commercial property photography style, high quality, clean composition.`,
      n: 1,
      size: "1792x1024",
      quality: "hd",
      response_format: "b64_json",
    });
    const b64 = resp.data[0]?.b64_json || null;
    if (b64) {
      console.log(`[doc-images] Image generated successfully (${Math.round(b64.length / 1024)}KB base64)`);
    }
    return b64;
  } catch (e: any) {
    console.warn("[doc-images] Generation failed:", e.message);
    return null;
  }
}

const UPLOADS_DIR = path.join(process.cwd(), "ChatBGP", "doc-templates");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
});

async function renderPdfPagesToImages(filePath: string, maxPages: number = 12, _scale: number = 1.5): Promise<string[]> {
  try {
    const { execSync } = await import("child_process");
    const tmpDir = path.join(os.tmpdir(), `pdf-render-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const prefix = path.join(tmpDir, "page");
    const cmd = `pdftoppm -png -r 150 -l ${maxPages} "${filePath}" "${prefix}"`;
    console.log(`[pdf-render] Running: ${cmd}`);
    execSync(cmd, { timeout: 60000 });

    const files = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith(".png"))
      .sort();

    const images: string[] = [];
    for (const file of files) {
      const fullPath = path.join(tmpDir, file);
      const pngBuffer = fs.readFileSync(fullPath);
      const base64 = pngBuffer.toString("base64");
      images.push(`data:image/png;base64,${base64}`);
      console.log(`[pdf-render] ${file} rendered (${Math.round(pngBuffer.length / 1024)}KB)`);
      fs.unlinkSync(fullPath);
    }

    try { fs.rmdirSync(tmpDir); } catch {}
    console.log(`[pdf-render] Rendered ${images.length} pages total`);
    return images;
  } catch (err: any) {
    console.error("[pdf-render] PDF rendering failed:", err.message);
    return [];
  }
}

async function extractTextFromFile(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === ".pdf") {
    const pdfModule = await import("pdf-parse");
    const PDFParseClass = (pdfModule as any).PDFParse || (pdfModule as any).default;
    const buffer = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(buffer);
    const parser = new PDFParseClass(uint8);
    const data = await parser.getText();
    return typeof data === "string" ? data : (data as any).text || String(data);
  }

  if (ext === ".pptx") {
    try {
      const JSZip = (await import("jszip")).default;
      const buffer = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(buffer);
      const texts: string[] = [];
      const slideFiles = Object.keys(zip.files)
        .filter(name => name.match(/^ppt\/slides\/slide\d+\.xml$/))
        .sort();
      for (const slideFile of slideFiles) {
        const xml = await zip.files[slideFile].async("text");
        const textContent = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (textContent) texts.push(textContent);
      }
      return texts.length > 0 ? texts.join("\n\n") : `[PowerPoint file with no extractable text: ${originalName}]`;
    } catch {
      return `[PowerPoint file: ${originalName}]`;
    }
  }

  if (ext === ".xlsx" || ext === ".xls") {
    try {
      const XLSX = (await import("xlsx")).default;
      const wb = XLSX.readFile(filePath);
      const lines: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
        if (csv.trim()) {
          lines.push(`--- Sheet: ${sheetName} ---`);
          lines.push(csv);
        }
      }
      return lines.join("\n") || `[Empty spreadsheet: ${originalName}]`;
    } catch {
      return `[Spreadsheet file: ${originalName}]`;
    }
  }

  if (ext === ".txt" || ext === ".doc" || ext === ".md" || ext === ".csv" || ext === ".json" || ext === ".xml" || ext === ".html" || ext === ".htm" || ext === ".rtf") {
    return fs.readFileSync(filePath, "utf-8");
  }

  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return `[Binary file: ${originalName}]`;
  }
}

async function analyzeDocumentWithAI(text: string, fileName: string): Promise<{
  name: string;
  description: string;
  templateContent: string;
  fields: Array<{ id: string; label: string; type: string; placeholder: string; section: string }>;
}> {
  const response = await callClaude({
    model: CHATBGP_HELPER_MODEL,
    messages: [
      {
        role: "system",
        content: `You are an expert at analysing property documents and creating reusable templates. 
You will receive the text content of a property document and must:
1. Identify the document type and purpose
2. Create a reusable template by replacing specific details with placeholder fields
3. Identify all variable fields that should be fillable when using this template

For each field, provide:
- id: a unique camelCase identifier (e.g., "propertyAddress", "tenantName")
- label: a human-readable label (e.g., "Property Address", "Tenant Name")
- type: one of "text", "textarea", "number", "date", "currency", "list" (list for comma-separated items)
- placeholder: an example value from the original document
- section: which section of the document this field belongs to

For the template content, use {{fieldId}} syntax for placeholders, e.g., {{propertyAddress}}.
Keep the overall structure, headings, and professional language of the original document.
Make the template comprehensive but practical - include fields for all variable data while keeping standard language intact.

Return valid JSON only with this structure:
{
  "name": "Template name",
  "description": "Brief description of what this template is for",
  "templateContent": "The full template text with {{placeholders}}",
  "fields": [{ "id": "...", "label": "...", "type": "...", "placeholder": "...", "section": "..." }]
}`
      },
      {
        role: "user",
        content: `Please analyse this document and create a reusable template from it.\n\nFile name: ${fileName}\n\nDocument content:\n\n${text.slice(0, 15000)}`
      }
    ],
    max_completion_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI did not return a response");

  const { safeParseJSON } = await import("./utils/anthropic-client");
  return safeParseJSON(content);
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "", baseUrl },
  });
}

async function analyzeDocumentWithGemini(text: string, fileName: string): Promise<{
  name: string;
  description: string;
  templateContent: string;
  fields: Array<{ id: string; label: string; type: string; placeholder: string; section: string }>;
}> {
  const ai = getGeminiClient();
  if (!ai) throw new Error("Gemini AI not configured");

  const systemPrompt = `You are an expert at analysing property documents and creating reusable templates for Bruce Gillingham Pollard (BGP), a prestigious London property consultancy.

You will receive the text content of a property document and must:
1. Identify the document type and purpose
2. Create a reusable template by replacing specific details with placeholder fields
3. Identify all variable fields that should be fillable when using this template

For each field, provide:
- id: a unique camelCase identifier (e.g., "propertyAddress", "tenantName")
- label: a human-readable label (e.g., "Property Address", "Tenant Name")
- type: one of "text", "textarea", "number", "date", "currency", "list" (list for comma-separated items)
- placeholder: an example value from the original document
- section: which section of the document this field belongs to

For the template content, use {{fieldId}} syntax for placeholders, e.g., {{propertyAddress}}.
Keep the overall structure, headings, and professional language of the original document.
Make the template comprehensive but practical - include fields for all variable data while keeping standard language intact.

Return ONLY valid JSON with this structure:
{
  "name": "Template name",
  "description": "Brief description of what this template is for",
  "templateContent": "The full template text with {{placeholders}}",
  "fields": [{ "id": "...", "label": "...", "type": "...", "placeholder": "...", "section": "..." }]
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: `${systemPrompt}\n\nPlease analyse this document and create a reusable template from it.\n\nFile name: ${fileName}\n\nDocument content:\n\n${text.slice(0, 30000)}` }],
      },
    ],
    config: { maxOutputTokens: 8192 },
  });

  const raw = response.text || "";
  const { safeParseJSON } = await import("./utils/anthropic-client");
  return safeParseJSON(raw);
}

async function extractFieldsWithGemini(
  documentTexts: { name: string; text: string }[],
  templateName: string,
  templateDescription: string | null,
  fieldsDescription: string
): Promise<Record<string, string>> {
  const ai = getGeminiClient();
  if (!ai) throw new Error("Gemini AI not configured");

  const combinedText = documentTexts
    .map((doc) => `=== DOCUMENT: ${doc.name} ===\n${doc.text.slice(0, 20000)}`)
    .join("\n\n");

  const systemPrompt = `You are a property document specialist at Bruce Gillingham Pollard (BGP), a London-based property consultancy operating in Belgravia, Mayfair, and Chelsea.

You will be given source documents (tenancy schedules, brochures, marketing materials, etc.) and a list of template fields that need to be filled in.

Your job is to extract the relevant information from the source documents and provide values for each template field.

Template: "${templateName}"
Description: ${templateDescription || "N/A"}

Fields to fill:
${fieldsDescription}

Instructions:
- Extract values from the source documents that best match each field
- For "text" fields, provide concise text
- For "textarea" fields, provide detailed professional text in BGP's style - confident, knowledgeable, sophisticated, authoritative
- For "number" and "currency" fields, provide just the number
- For "date" fields, use DD/MM/YYYY format
- For "list" fields, provide comma-separated values
- If you cannot find information for a field, use a reasonable professional default or mark as "TBC"
- Write in BGP's professional tone: authoritative, knowledgeable, London prime property focus
- Use British English spelling and conventions

Return ONLY a valid JSON object where keys are field IDs and values are the extracted/generated text.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: `${systemPrompt}\n\nPlease extract data from these documents to fill the template fields:\n\n${combinedText}` }],
      },
    ],
    config: { maxOutputTokens: 8192 },
  });

  const raw = response.text || "";
  const { safeParseJSON } = await import("./utils/anthropic-client");
  return safeParseJSON(raw);
}


export async function generateAutonomousDocument(
  description: string,
  documentType?: string,
  sourceTexts?: { name: string; text: string }[]
): Promise<{ content: string; name: string; runId: string }> {
  const sourceContext = sourceTexts?.map(s => `--- ${s.name} ---\n${s.text}`).join("\n\n") || "";

  const systemPrompt = `You are a document generation assistant for Bruce Gillingham Pollard (BGP), a premium commercial property consultancy operating across London and nationally, with particular strength in Belgravia, Mayfair, Chelsea, Knightsbridge, and major mixed-use developments.

${BGP_BRANDING_GUIDELINES}

BGP SERVICE LINES:
- Leasing, Investment, Development, Acquisitions / Brand Representation, Lease Consultancy

Generate professional property documents based on the request. Mark unknown specifics as [TO BE CONFIRMED].
Use formal British English. Section headings in UPPERCASE.
Use PLAIN TEXT with simple markdown: **bold**, bullets with "- ", numbered lists with "1. ".
Do NOT include HTML tags, CSS, or placeholder text like "[BGP LOGO]".`;

  const userPrompt = `${documentType ? `Document type: ${documentType}\n` : ""}Instructions: ${description}${sourceContext ? `\n\nSource documents:\n${sourceContext}` : ""}\n\nGenerate the complete document now.`;

  let content = "";
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const geminiResponse = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        config: { maxOutputTokens: 8192, temperature: 0.3 },
      });
      content = geminiResponse.text || "";
    } catch (err: any) {
      console.log("[doc-generate] Gemini failed, using Claude:", err?.message);
    }
  }
  if (!content) {
    // Document Studio always uses Opus for highest quality output (Claude Design model)
    console.log(`[doc-generate] Using Opus for type: ${documentType || "unspecified"}`);
    const completion = await callDocOpus({
      model: DOC_OPUS_PRIMARY,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_completion_tokens: 16384,
    });
    content = completion.choices[0]?.message?.content || "No content generated.";
  }

  const docName = documentType || "Generated Document";
  const run = await storage.createDocumentRun({
    name: docName,
    documentType: documentType || undefined,
    description: description || undefined,
    content,
  });

  return { content, name: docName, runId: run.id };
}

export async function exportDocumentToPdf(content: string, title: string): Promise<Buffer> {
  const docTitle = (title || "BGP Document").slice(0, 200);
  const logoPath = path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark.png");
  const logoExists = fs.existsSync(logoPath);

  function cleanContent(raw: string): string {
    let text = raw;
    text = text.replace(/\*\*DOCUMENT SPECIFICATION:\*\*[\s\S]*?(?=\n\n\*\*|$)/i, "");
    text = text.replace(/DOCUMENT SPECIFICATION:[\s\S]*?(?=\n\n[A-Z\*]|$)/i, "");
    text = text.replace(/<[^>]+>/g, "");
    text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    text = text.replace(/\[BGP LOGO\]/g, "");
    text = text.replace(/\n{4,}/g, "\n\n\n");
    return text.trim();
  }

  function stripMd(text: string): string {
    return text.replace(/\*\*\*(.*?)\*\*\*/g, "$1").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/^#+\s*/gm, "");
  }

  function classifyLine(trimmed: string): "blank" | "heading" | "bullet" | "numbered" | "blockquote" | "hr" | "body" {
    if (!trimmed) return "blank";
    if (/^---+$|^___+$|^\*\*\*+$/.test(trimmed)) return "hr";
    if (/^>\s/.test(trimmed)) return "blockquote";
    const plain = stripMd(trimmed);
    if (/^\d+\.\s/.test(plain) && plain === plain.toUpperCase() && plain.length > 5) return "heading";
    if (plain === plain.toUpperCase() && plain.length > 3 && /[A-Z]/.test(plain) && !/^[-•*]/.test(plain)) return "heading";
    if (/^#+\s/.test(trimmed)) return "heading";
    if (/^[-•*]\s/.test(plain)) return "bullet";
    if (/^\d+[\.\)]\s/.test(plain)) return "numbered";
    return "body";
  }

  interface TextSegment { text: string; bold: boolean; italic: boolean; }
  function parseInlineFormatting(text: string): TextSegment[] {
    const segments: TextSegment[] = [];
    const regex = /(\*\*\*(.*?)\*\*\*|\*\*(.*?)\*\*|\*(.*?)\*)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), bold: false, italic: false });
      if (match[2] !== undefined) segments.push({ text: match[2], bold: true, italic: true });
      else if (match[3] !== undefined) segments.push({ text: match[3], bold: true, italic: false });
      else if (match[4] !== undefined) segments.push({ text: match[4], bold: false, italic: true });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), bold: false, italic: false });
    return segments.length > 0 ? segments : [{ text, bold: false, italic: false }];
  }

  const cleaned = cleanContent(content);
  const lines = cleaned.split("\n");

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 80, bottom: 80, left: 60, right: 60 },
    info: { Title: docTitle, Author: "Bruce Gillingham Pollard", Creator: "BGP Dashboard" },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const pageW = 475;
  const leftM = 60;
  const rightEdge = leftM + pageW;
  const bgpGreen = "#2E5E3F";
  const bgpDarkGreen = "#1A3A28";
  const generatedDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  function drawHeader() {
    doc.rect(0, 0, 595, 8).fill(bgpGreen);
    if (logoExists) { try { doc.image(logoPath, leftM, 14, { width: 80 }); } catch {} }
    doc.fontSize(7).fillColor("#FFFFFF").font("Helvetica-Bold")
      .text("BRUCE GILLINGHAM POLLARD", leftM, 10, { align: "right", width: pageW });
    doc.moveTo(leftM, 50).lineTo(rightEdge, 50).strokeColor(bgpGreen).lineWidth(0.5).stroke();
  }

  function newPage() { doc.addPage(); drawHeader(); return 72; }

  drawHeader();
  let y = 72;
  let foundTitle = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const lineType = classifyLine(trimmed);
    const plain = stripMd(trimmed);

    if (lineType === "blank") { y += 10; continue; }
    if (y > 710) y = newPage();

    if (lineType === "hr") {
      y += 6;
      doc.moveTo(leftM, y).lineTo(rightEdge, y).strokeColor(bgpGreen).lineWidth(0.5).stroke();
      y += 10;
    } else if (lineType === "heading" && !foundTitle) {
      foundTitle = true;
      // BGP green bar above title
      doc.rect(leftM, y - 2, pageW, 3).fill(bgpGreen);
      y += 10;
      doc.font("Helvetica-Bold").fontSize(20).fillColor(bgpDarkGreen)
        .text(plain, leftM, y, { align: "center", width: pageW });
      y = doc.y + 18;
    } else if (lineType === "heading") {
      y += 12;
      if (y > 710) y = newPage();
      const isSubSection = /^\d+\.\d+/.test(plain);
      doc.font("Helvetica-Bold").fontSize(isSubSection ? 11 : 14).fillColor(isSubSection ? "#444444" : bgpGreen)
        .text(plain, leftM, y, { width: pageW });
      y = doc.y + 6;
    } else if (lineType === "bullet") {
      const bulletText = stripMd(plain.replace(/^[-•*]\s*/, ""));
      doc.font("Times-Roman").fontSize(10.5).fillColor("#333333")
        .text(`  •  ${bulletText}`, leftM + 12, y, { width: pageW - 12 });
      y = doc.y + 3;
    } else if (lineType === "numbered") {
      doc.font("Times-Roman").fontSize(10.5).fillColor("#333333")
        .text(plain, leftM + 12, y, { width: pageW - 12 });
      y = doc.y + 3;
    } else if (lineType === "blockquote") {
      const quoteText = stripMd(trimmed.replace(/^>\s*/, ""));
      doc.save();
      doc.moveTo(leftM + 20, y).lineTo(leftM + 20, y + 14).strokeColor(bgpGreen).lineWidth(2).stroke();
      doc.restore();
      doc.font("Times-Italic").fontSize(10).fillColor("#555555")
        .text(quoteText, leftM + 30, y, { width: pageW - 30 });
      y = doc.y + 4;
    } else {
      const segs = parseInlineFormatting(trimmed);
      if (segs.length === 1 && !segs[0].bold && !segs[0].italic) {
        doc.font("Times-Roman").fontSize(10.5).fillColor("#333333")
          .text(segs[0].text, leftM, y, { width: pageW, align: "justify" });
      } else {
        doc.fontSize(10.5).fillColor("#333333");
        let first = true;
        for (const seg of segs) {
          const fontName = seg.bold && seg.italic ? "Times-BoldItalic" : seg.bold ? "Times-Bold" : seg.italic ? "Times-Italic" : "Times-Roman";
          doc.font(fontName);
          if (first) {
            doc.text(seg.text, leftM, y, { width: pageW, align: "justify", continued: segs.indexOf(seg) < segs.length - 1 });
            first = false;
          } else {
            doc.text(seg.text, { continued: segs.indexOf(seg) < segs.length - 1 });
          }
        }
      }
      y = doc.y + 4;
    }
  }

  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // BGP green header bar
    doc.rect(0, 0, 595, 8).fill(bgpGreen);
    doc.fontSize(7).fillColor("#FFFFFF").font("Helvetica-Bold")
      .text("BRUCE GILLINGHAM POLLARD", leftM, 10, { align: "right", width: pageW });
    // Footer separator
    doc.moveTo(leftM, 770).lineTo(rightEdge, 770).strokeColor(bgpGreen).lineWidth(0.5).stroke();
    // Footer: date left, confidentiality center, page right
    doc.fontSize(7).fillColor("#888888").font("Helvetica");
    doc.text(generatedDate, leftM, 776, { width: 150, align: "left" });
    doc.text("Bruce Gillingham Pollard — Confidential", leftM + 130, 776, { width: 220, align: "center" });
    doc.text(`Page ${i - range.start + 1} of ${totalPages}`, rightEdge - 80, 776, { width: 80, align: "right" });
  }

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
}

export function setupDocumentTemplateRoutes(app: Express) {
  app.get("/api/doc-templates", requireAuth, async (_req: Request, res: Response) => {
    try {
      const templates = await storage.getDocumentTemplates();
      const parsed = templates.map((t) => {
        const { pageImages, ...rest } = t;
        const imgs = (() => { try { return JSON.parse(pageImages || "[]"); } catch { return []; } })();
        return {
          ...rest,
          fields: JSON.parse(t.fields || "[]"),
          hasPageImages: imgs.length > 0,
          pageImageCount: imgs.length,
        };
      });
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get("/api/doc-templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      const { pageImages, ...rest } = template;
      const imgs = (() => { try { return JSON.parse(pageImages || "[]"); } catch { return []; } })();
      res.json({
        ...rest,
        fields: JSON.parse(template.fields || "[]"),
        hasPageImages: imgs.length > 0,
        pageImageCount: imgs.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  app.get("/api/doc-templates/:id/page-images", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      const images = (() => { try { return JSON.parse(template.pageImages || "[]"); } catch { return []; } })();
      res.json({ images, count: images.length });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch page images" });
    }
  });

  app.post("/api/doc-templates/:id/re-render-pages", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const ext = path.extname(template.sourceFileName || "").toLowerCase();
      if (ext !== ".pdf") return res.status(400).json({ message: "Page rendering is only supported for PDF templates" });

      const filePath = template.sourceFilePath;
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(400).json({ message: "Source PDF file is no longer available. Please delete this template and re-upload the PDF." });
      }

      console.log(`[doc-template] Re-rendering pages for template ${id} from ${filePath}`);
      const images = await renderPdfPagesToImages(filePath, 12, 1.5);
      console.log(`[doc-template] Re-rendered ${images.length} pages`);

      await storage.updateDocumentTemplate(id, {
        pageImages: JSON.stringify(images),
      });

      res.json({ images, count: images.length });
    } catch (err: any) {
      console.error("[doc-template] Re-render failed:", err);
      res.status(500).json({ message: "Failed to re-render page images" });
    }
  });

  app.post("/api/doc-templates/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    const uploadedPath = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      let text: string;
      try {
        text = await extractTextFromFile(req.file.path, req.file.originalname);
      } catch (parseErr: any) {
        if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        return res.status(400).json({ message: "Could not read the document. Please try a different file format." });
      }

      if (!text || text.trim().length < 50) {
        if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        return res.status(400).json({ message: "Could not extract enough text from the document. Please try a different file." });
      }

      let analysis;
      try {
        if (getGeminiClient()) {
          analysis = await analyzeDocumentWithGemini(text, req.file.originalname);
        } else {
          analysis = await analyzeDocumentWithAI(text, req.file.originalname);
        }
      } catch (aiErr: any) {
        try {
          analysis = await analyzeDocumentWithAI(text, req.file.originalname);
        } catch (fallbackErr: any) {
          if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
          return res.status(500).json({ message: "AI could not analyse this document. Please try again or try a simpler document." });
        }
      }

      if (!analysis.templateContent || !Array.isArray(analysis.fields)) {
        if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        return res.status(500).json({ message: "AI returned an incomplete template. Please try uploading again." });
      }

      let designJson = "{}";
      let pageImages: string[] = [];

      const ext = path.extname(req.file.originalname).toLowerCase();
      const isPdf = ext === ".pdf";

      const [designResult, renderedImages] = await Promise.allSettled([
        autoDesignWithClaude(analysis.templateContent, analysis.name, analysis.description).catch((err: any) => {
          console.error("Auto-design failed, using defaults:", err.message);
          return null;
        }),
        isPdf ? renderPdfPagesToImages(req.file.path, 12, 1.5) : Promise.resolve([]),
      ]);

      if (designResult.status === "fulfilled" && designResult.value) {
        designJson = JSON.stringify(designResult.value);
      }
      if (renderedImages.status === "fulfilled" && renderedImages.value.length > 0) {
        pageImages = renderedImages.value;
        console.log(`[doc-template-upload] Rendered ${pageImages.length} page images from PDF`);
      }

      let canvaDesignId: string | null = null;
      let canvaEditUrl: string | null = null;
      let canvaViewUrl: string | null = null;

      try {
        const canvaToken = await getCanvaToken(req.session);
        if (canvaToken) {
          const canvaResult = await createCanvaDesignFromContent(
            req.session,
            `Template: ${analysis.name}`,
            analysis.templateContent,
          );
          if (canvaResult) {
            canvaDesignId = canvaResult.designId;
            canvaEditUrl = canvaResult.editUrl;
            canvaViewUrl = canvaResult.viewUrl;
          }
        }
      } catch (canvaErr: any) {
        console.log("[doc-template-upload] Canva design creation skipped:", canvaErr?.message);
      }

      const template = await storage.createDocumentTemplate({
        name: analysis.name,
        description: analysis.description,
        sourceFileName: req.file.originalname,
        sourceFilePath: req.file.path,
        templateContent: analysis.templateContent,
        fields: JSON.stringify(analysis.fields),
        status: "draft",
        design: designJson,
        canvaDesignId: canvaDesignId || undefined,
        canvaEditUrl: canvaEditUrl || undefined,
        canvaViewUrl: canvaViewUrl || undefined,
        pageImages: JSON.stringify(pageImages),
      });

      if (!res.headersSent) {
        const { pageImages: _pi, ...templateWithoutImages } = template;
        res.json({
          ...templateWithoutImages,
          fields: analysis.fields,
          hasPageImages: pageImages.length > 0,
          pageImageCount: pageImages.length,
        });
      }
    } catch (err: any) {
      console.error("Doc template upload error:", err);
      if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
      if (!res.headersSent) {
        res.status(500).json({ message: err.message || "Failed to process document" });
      }
    }
  });

  app.put("/api/doc-templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const updates: any = {};
      if (typeof req.body.name === "string") updates.name = req.body.name;
      if (typeof req.body.description === "string") updates.description = req.body.description;
      if (typeof req.body.templateContent === "string") updates.templateContent = req.body.templateContent;
      if (Array.isArray(req.body.fields)) updates.fields = JSON.stringify(req.body.fields);
      if (typeof req.body.status === "string" && ["draft", "approved"].includes(req.body.status)) updates.status = req.body.status;
      if (typeof req.body.design === "string") updates.design = req.body.design;

      const updated = await storage.updateDocumentTemplate(id, updates);
      res.json({
        ...updated,
        fields: JSON.parse(updated.fields || "[]"),
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update template" });
    }
  });

  app.post("/api/doc-templates/:id/canva-design", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const canvaToken = await getCanvaToken(req.session);
      if (!canvaToken) return res.status(400).json({ message: "Canva not connected. Please connect Canva first." });

      const designResult = await createCanvaDesignFromContent(
        req.session,
        `Template: ${template.name}`,
        template.templateContent,
      );
      if (!designResult) return res.status(500).json({ message: "Failed to create Canva design" });

      const updated = await storage.updateDocumentTemplate(id, {
        canvaDesignId: designResult.designId,
        canvaEditUrl: designResult.editUrl || undefined,
        canvaViewUrl: designResult.viewUrl || undefined,
      });
      res.json({
        ...updated,
        fields: JSON.parse(updated.fields || "[]"),
      });
    } catch (err: any) {
      console.error("Canva design creation error:", err);
      res.status(500).json({ message: err.message || "Failed to create Canva design" });
    }
  });

  app.post("/api/doc-templates/:id/visual-auto-design", requireAuth, async (req: Request, res: Response) => {
    req.setTimeout(180000);
    res.setTimeout(180000);
    try {
      const id = req.params.id as string;
      const isDocRun = id.startsWith("run-");

      let templateName: string;
      let templateContent: string;
      let templateId: string = id;

      if (isDocRun) {
        const runId = id.replace("run-", "");
        const docRun = await storage.getDocumentRun(runId);
        if (!docRun) return res.status(404).json({ message: "Document run not found" });
        templateName = docRun.name;
        templateContent = docRun.content;
      } else {
        const template = await storage.getDocumentTemplate(id);
        if (!template) return res.status(404).json({ message: "Template not found" });
        templateName = template.name;
        templateContent = template.templateContent;
      }

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
      });

      const contentPreview = templateContent.slice(0, 2000);

      const sections: string[] = [];
      const lines = templateContent.split("\n").filter(l => l.trim());
      let currentSection = "";
      for (const line of lines) {
        if (line === line.toUpperCase() && line.trim().length > 2 && line.trim().length < 60) {
          if (currentSection) sections.push(currentSection.trim());
          currentSection = line.trim();
        } else {
          currentSection += " " + line.trim();
        }
      }
      if (currentSection) sections.push(currentSection.trim());
      const sectionSummary = sections.slice(0, 12).map((s, i) => `${i + 1}. ${s.slice(0, 80)}`).join("\n");

      const prompt = `You are a document designer for BGP (Bruce Gillingham Pollard), a premium London property firm. Design a visual layout for an A4 document (595x842pt).

TEMPLATE: ${templateName}
KEY SECTIONS:
${sectionSummary}

Create 8-14 elements (keep it concise — fewer elements, more impact). Each element: {id, type:"text"|"shape"|"image", x, y, width, height, rotation:0, zIndex, opacity:1}
Text elements add: content, fontSize, fontFamily, fontWeight, fontStyle:"normal", textDecoration:"none", textAlign, color, backgroundColor:"transparent", borderWidth:0, borderColor:"transparent", borderRadius:0
Shape elements add: shapeType:"rectangle"|"line", backgroundColor, borderColor, borderWidth, borderRadius
Image elements add: generatePrompt (a detailed text description of what the image should show — it will be AI-generated automatically)

IMPORTANT: Keep each text element's content field SHORT (under 80 chars). Use section headings and key data points only — the full content will be in the exported document. This is a VISUAL LAYOUT preview, not the full document.

BGP BRAND RULES (from official BGP Visual & Deck Templates — follow precisely):

TYPOGRAPHY HIERARCHY (this defines the BGP look — Work Sans is the PowerPoint equivalent):
1. Section label: fontFamily:"Neue Machina, Work Sans, Arial, sans-serif", fontSize:9, fontWeight:"bold", UPPERCASE, color:#232323 — placed ABOVE the main heading as a small category label
2. Main heading: fontFamily:"Grotta, Work Sans, Arial, sans-serif", fontSize:28-36, fontWeight:"bold", color:#232323 — can split across 2-3 lines for dramatic effect with generous line height
3. Body text: fontFamily:"Work Sans, Arial, sans-serif" for most documents, fontFamily:"MinionPro, Times New Roman, serif" for formal letters, fontSize:10-11, color:#000000
4. Footer: fontFamily:"Work Sans, Arial, sans-serif", fontSize:9, color:#333333

COLOUR PALETTE (strictly monochrome — NO orange):
- Headings: #232323 (near-black)
- Body: #000000
- Accent: #232323 (black) — for divider lines, callout borders, key data highlights
- Page background: #FFFFFF (white)
- Panel/card backgrounds: #F5F4F0 (light warm grey)
- Dark backgrounds: #232323 — for cover pages or dramatic section headers with white (#FFFFFF) text
- FORBIDDEN: No orange (#FF6900), no bright colours — strictly monochrome

PAGE STRUCTURE (match BGP deck template patterns):
- Start with small "SECTION TITLE" label (Neue Machina, 9pt, uppercase) near top-left
- Below it, a large dramatic heading (Grotta, 28-36pt, bold) — can wrap to 2-3 lines
- Body content in columns: main text left (55-60%), supporting content/data right
- Thin rectangle shape dividers between major sections (#E8E6DF grey or #232323 black) — never orange
- "Bruce Gillingham Pollard" or address footer at bottom
- Use GENEROUS whitespace — BGP style favours dramatic negative space over dense content
- Use the FULL page height, don't cluster everything at the top
- Keep each text element content under 100 characters — use section names and key {{placeholders}} only

IMAGE RULES:
- For marketing brochures, proposals, reports, leasing strategies, pitch decks: ALWAYS include 1-2 image elements with type:"image" and a generatePrompt field (e.g. "Elegant London retail shopfront on a prestigious Belgravia street, modern glass facade, warm evening lighting, premium aesthetic"). Place hero images prominently near top or between sections.
- For purely legal/contractual documents (leases, HOTs, contracts): skip images.

Return ONLY valid JSON:
{"pages":[{"id":"page1","elements":[...],"backgroundColor":"#FFFFFF"}],"pageWidth":595,"pageHeight":842}`;

      let responseText = "";
      const geminiDesign = getGeminiClient();
      if (geminiDesign) {
        try {
          const geminiResponse = await geminiDesign.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { maxOutputTokens: 12000, temperature: 0.2 },
          });
          responseText = geminiResponse.text || "";
          console.log("[visual-design] Gemini response length:", responseText.length);
        } catch (geminiErr: any) {
          console.log("[visual-design] Gemini failed, falling back to Claude Sonnet:", geminiErr?.message);
        }
      }
      if (!responseText) {
        console.log("[visual-design] Using Claude Sonnet fallback");
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 12000,
          messages: [{ role: "user", content: prompt }],
        });
        responseText = response.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
      }

      let jsonStr = responseText;
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ message: "AI did not return valid design JSON" });
      }
      jsonStr = jsonMatch[0];

      let visualDesign: any;
      try {
        visualDesign = JSON.parse(jsonStr);
      } catch {
        let repaired = jsonStr;
        const openBraces = (repaired.match(/\{/g) || []).length;
        const closeBraces = (repaired.match(/\}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/\]/g) || []).length;

        if (repaired.includes('"elements"')) {
          const lastCompleteElement = repaired.lastIndexOf("}");
          if (lastCompleteElement > 0) {
            repaired = repaired.slice(0, lastCompleteElement + 1);
          }
        }

        const missingBrackets = openBrackets - (repaired.match(/\]/g) || []).length;
        const missingBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
        for (let i = 0; i < missingBrackets; i++) repaired += "]";
        for (let i = 0; i < missingBraces; i++) repaired += "}";

        try {
          visualDesign = JSON.parse(repaired);
        } catch {
          const elemsMatch = jsonStr.match(/"elements"\s*:\s*\[([\s\S]*)/);
          if (elemsMatch) {
            const elemsStr = elemsMatch[1];
            const elemParts = elemsStr.match(/\{[^{}]*\}/g) || [];
            const validElems: any[] = [];
            for (const part of elemParts) {
              try { validElems.push(JSON.parse(part)); } catch {}
            }
            if (validElems.length >= 3) {
              visualDesign = {
                pages: [{ id: "page1", elements: validElems, backgroundColor: "#FFFFFF" }],
                pageWidth: 595,
                pageHeight: 842,
              };
            } else {
              return res.status(500).json({ message: "Design response was incomplete. Please try again." });
            }
          } else {
            return res.status(500).json({ message: "Design response was incomplete. Please try again." });
          }
        }
      }

      await generateImagesForDesign(visualDesign);

      if (isDocRun) {
        const runId = id.replace("run-", "");
        await pool.query(`UPDATE document_runs SET design = $1 WHERE id = $2`, [JSON.stringify(visualDesign), runId]);
        res.json({ design: JSON.stringify(visualDesign), name: templateName });
      } else {
        const updated = await storage.updateDocumentTemplate(id, {
          design: JSON.stringify(visualDesign),
        });
        res.json({
          ...updated,
          fields: JSON.parse(updated.fields || "[]"),
        });
      }
    } catch (err: any) {
      console.error("Visual auto-design error:", err);
      res.status(500).json({ message: err.message || "Failed to auto-design template" });
    }
  });

  app.post("/api/doc-templates/:id/visual-design-chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const isDocRun = id.startsWith("run-");
      if (isDocRun) {
        const runId = id.replace("run-", "");
        const docRun = await storage.getDocumentRun(runId);
        if (!docRun) return res.status(404).json({ message: "Document run not found" });
      } else {
        const template = await storage.getDocumentTemplate(id);
        if (!template) return res.status(404).json({ message: "Template not found" });
      }

      const { message, currentDesign, conversationHistory } = req.body;
      if (!message || typeof message !== "string" || message.length > 2000) {
        return res.status(400).json({ message: "message is required and must be under 2000 characters" });
      }
      if (!currentDesign || !currentDesign.pages || !Array.isArray(currentDesign.pages)) {
        return res.status(400).json({ message: "currentDesign with pages array is required" });
      }

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
      });

      const systemPrompt = `You are a document design assistant for BGP (Bruce Gillingham Pollard), a premium London property firm. You help users refine the visual layout of A4 documents (595x842pt) in their document designer.

You receive the current design as JSON and the user's instruction. You must return an updated design JSON that applies the requested changes.

DESIGN FORMAT:
{"pages":[{"id":"page1","elements":[...],"backgroundColor":"#FFFFFF"}],"pageWidth":595,"pageHeight":842}

ELEMENT FORMAT:
Each element has: id, type:"text"|"shape"|"image", x, y, width, height, rotation, zIndex, opacity
Text elements also have: content, fontSize, fontFamily, fontWeight, fontStyle, textDecoration, textAlign, color, backgroundColor, borderColor, borderWidth, borderRadius
Shape elements also have: shapeType:"rectangle"|"circle"|"line", backgroundColor, borderColor, borderWidth, borderRadius
Image elements also have: either src (existing data URL) or generatePrompt (text description — the image will be AI-generated automatically using Nano Banana)

BGP BRAND GUIDELINES (from official BGP Visual & Deck Templates):
TYPOGRAPHY HIERARCHY (this defines the BGP look):
1. Section label: "Neue Machina, Work Sans, Arial, sans-serif" — 9pt, bold, UPPERCASE, #232323 — placed ABOVE main headings as a small category label
2. Main heading: "Grotta, Work Sans, Arial, sans-serif" — 28-36pt, bold, #232323 — can split across 2-3 lines for dramatic effect
3. Body text: "Work Sans, Arial, sans-serif" for most documents, "MinionPro, Times New Roman, serif" for formal letters — 10-11pt, #000000
4. Footer: "Work Sans, Arial, sans-serif" — 9pt, #333333

COLOURS (strictly monochrome — NO orange): Headings #232323, body #000000, accent #232323 (black), background #FFFFFF (white), panels #F5F4F0 (warm grey), dark backgrounds #232323 with white text for covers/dividers. FORBIDDEN: No orange (#FF6900) anywhere.

LAYOUT: Small "SECTION TITLE" Neue Machina label → large Grotta heading → body content in columns. Generous whitespace, thin dividers (#E8E6DF or #232323). BGP favours dramatic negative space, bold typography, editorial confidence.

IMPORTANT RULES:
- Always preserve existing element IDs when modifying them
- Only modify what the user asks for — don't redesign everything unless asked
- When adding new elements, generate unique IDs (8 char alphanumeric)
- Keep text content concise (under 100 chars per element)
- Respect the A4 page bounds (595x842pt)
- If the user asks for a generated image (e.g. property photo, illustration, header graphic), add an image element with type:"image" and a generatePrompt field describing the image — it will be AI-generated automatically using Nano Banana

You MUST respond with valid JSON in this exact format:
{"reply":"<your brief explanation of what you changed>","design":<the complete updated design JSON>}

Keep your reply concise (1-2 sentences). Always return the COMPLETE design, not just the changed parts.`;

      const designCompact = JSON.stringify(currentDesign, (key, value) => {
        if (key === "src" && typeof value === "string" && value.startsWith("data:")) {
          return "[image-data]";
        }
        return value;
      });

      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

      if (conversationHistory && Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory.slice(-6)) {
          messages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: msg.content,
          });
        }
      }

      messages.push({
        role: "user",
        content: `Current design:\n${designCompact}\n\nUser request: ${message}`,
      });

      let responseText = "";
      const geminiChat = getGeminiClient();
      if (geminiChat) {
        try {
          const geminiContents: any[] = [];
          let lastRole = "";
          for (const m of messages) {
            const role = m.role === "assistant" ? "model" : "user";
            if (role === lastRole && geminiContents.length > 0) {
              geminiContents[geminiContents.length - 1].parts[0].text += "\n\n" + m.content;
            } else {
              geminiContents.push({ role, parts: [{ text: m.content }] });
            }
            lastRole = role;
          }
          console.log("[design-assistant] Using Gemini 3.1 Pro");
          const geminiResponse = await geminiChat.models.generateContent({
            model: "gemini-2.5-flash",
            contents: geminiContents,
            config: { maxOutputTokens: 8000, temperature: 0.3, systemInstruction: systemPrompt },
          });
          responseText = geminiResponse.text || "";
        } catch (geminiErr: any) {
          console.log("[design-assistant] Gemini failed, falling back to Claude Sonnet:", geminiErr?.message);
        }
      }
      if (!responseText) {
        console.log("[design-assistant] Using Claude Sonnet fallback");
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          system: systemPrompt,
          messages,
        });
        responseText = response.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
      }

      let result: any;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found");
        result = JSON.parse(jsonMatch[0]);
      } catch {
        let repaired = responseText;
        const jsonMatch = repaired.match(/\{[\s\S]*/);
        if (jsonMatch) {
          repaired = jsonMatch[0];
          const openBraces = (repaired.match(/\{/g) || []).length;
          const closeBraces = (repaired.match(/\}/g) || []).length;
          const openBrackets = (repaired.match(/\[/g) || []).length;
          const closeBrackets = (repaired.match(/\]/g) || []).length;
          for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
          for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
          try {
            result = JSON.parse(repaired);
          } catch {
            return res.status(500).json({ message: "AI response could not be parsed. Please try again." });
          }
        } else {
          return res.status(500).json({ message: "AI did not return a valid response. Please try again." });
        }
      }

      if (!result.design || !result.design.pages || !Array.isArray(result.design.pages)) {
        return res.status(500).json({ message: "AI response was missing the design. Please try again." });
      }

      if (!result.design.pageWidth) result.design.pageWidth = 595;
      if (!result.design.pageHeight) result.design.pageHeight = 842;
      for (const page of result.design.pages) {
        if (!page.id) page.id = "page1";
        if (!Array.isArray(page.elements)) page.elements = [];
        if (!page.backgroundColor) page.backgroundColor = "#FFFFFF";
        page.elements = page.elements.filter((el: any) =>
          el && typeof el.x === "number" && typeof el.y === "number" &&
          typeof el.width === "number" && typeof el.height === "number" &&
          el.type && el.id
        );
      }

      await generateImagesForDesign(result.design);

      if (isDocRun) {
        const runId = id.replace("run-", "");
        await pool.query(`UPDATE document_runs SET design = $1 WHERE id = $2`, [JSON.stringify(result.design), runId]);
      } else {
        await storage.updateDocumentTemplate(id, {
          design: JSON.stringify(result.design),
        });
      }

      res.json({
        reply: result.reply || "Design updated.",
        design: result.design,
      });
    } catch (err: any) {
      console.error("Visual design chat error:", err);
      res.status(500).json({ message: err.message || "Failed to process design request" });
    }
  });

  app.post("/api/doc-templates/:id/auto-design", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const designResult = await autoDesignWithClaude(template.templateContent, template.name, template.description);
      const designJson = JSON.stringify(designResult);

      const updated = await storage.updateDocumentTemplate(id, { design: designJson });
      res.json({
        ...updated,
        fields: JSON.parse(updated.fields || "[]"),
      });
    } catch (err: any) {
      console.error("Auto-design error:", err);
      res.status(500).json({ message: err.message || "Failed to auto-design template" });
    }
  });

  app.post("/api/doc-templates/:id/approve", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const updated = await storage.updateDocumentTemplate(id, { status: "approved" });
      res.json({
        ...updated,
        fields: JSON.parse(updated.fields || "[]"),
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to approve template" });
    }
  });

  app.post("/api/doc-templates/:id/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const fieldValues: Record<string, string> = req.body.fieldValues || {};
      let content = template.templateContent;
      const fields = JSON.parse(template.fields || "[]");

      for (const field of fields) {
        const value = fieldValues[field.id] || field.placeholder || "";
        content = content.replace(new RegExp(`\\{\\{${field.id}\\}\\}`, "g"), value);
      }

      res.json({ content, templateName: template.name });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to generate document" });
    }
  });

  const smartUpload = multer({
    dest: path.join(UPLOADS_DIR, "smart-source"),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  if (!fs.existsSync(path.join(UPLOADS_DIR, "smart-source"))) {
    fs.mkdirSync(path.join(UPLOADS_DIR, "smart-source"), { recursive: true });
  }

  app.post("/api/doc-templates/:id/smart-generate", requireAuth, smartUpload.array("documents", 5), async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No source documents uploaded" });
      }

      const documentTexts: { name: string; text: string }[] = [];
      for (const file of files) {
        try {
          const ext = path.extname(file.originalname).toLowerCase();
          let text: string;
          if ([".xlsx", ".xls"].includes(ext)) {
            const XLSX = (await import("xlsx")).default;
            const wb = XLSX.readFile(file.path);
            const lines: string[] = [];
            for (const sheetName of wb.SheetNames) {
              const ws = wb.Sheets[sheetName];
              const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
              if (csv.trim()) {
                lines.push(`--- Sheet: ${sheetName} ---`);
                lines.push(csv);
              }
            }
            text = lines.join("\n");
          } else if (ext === ".csv") {
            text = fs.readFileSync(file.path, "utf-8");
          } else {
            text = await extractTextFromFile(file.path, file.originalname);
          }
          documentTexts.push({ name: file.originalname, text });
        } catch (err: any) {
          console.error(`Failed to extract text from ${file.originalname}:`, err?.message);
        }
      }

      if (documentTexts.length === 0) {
        return res.status(400).json({ message: "Could not extract text from any uploaded documents" });
      }

      const fields = JSON.parse(template.fields || "[]");
      const fieldsDescription = fields
        .map((f: any) => `- ${f.id} (${f.label}): type=${f.type}, example="${f.placeholder}", section="${f.section}"`)
        .join("\n");

      let fieldValues: Record<string, string>;
      const geminiAvailable = !!getGeminiClient();

      if (geminiAvailable) {
        fieldValues = await extractFieldsWithGemini(documentTexts, template.name, template.description, fieldsDescription);
      } else {
        const combinedText = documentTexts
          .map((doc) => `=== DOCUMENT: ${doc.name} ===\n${doc.text.slice(0, 15000)}`)
          .join("\n\n");

        const response = await callClaude({
          model: CHATBGP_HELPER_MODEL,
          messages: [
            {
              role: "system",
              content: `You are a property document specialist at Bruce Gillingham Pollard (BGP), a London-based property consultancy.

You will be given source documents (tenancy schedules, brochures, marketing materials, etc.) and a list of template fields that need to be filled in.

Template: "${template.name}"
Description: ${template.description || "N/A"}

Fields to fill:
${fieldsDescription}

Instructions:
- Extract values from the source documents that best match each field
- For "text" fields, provide concise text
- For "textarea" fields, provide detailed professional text in BGP's style - confident, knowledgeable, sophisticated
- For "number" and "currency" fields, provide just the number
- For "date" fields, use DD/MM/YYYY format
- For "list" fields, provide comma-separated values
- If you cannot find information for a field, use a reasonable professional default or mark as "TBC"
- Write in BGP's professional tone: authoritative, knowledgeable, London prime property focus

Return ONLY a valid JSON object where keys are field IDs and values are the extracted/generated text.
Do not include any markdown formatting.`
            },
            {
              role: "user",
              content: `Please extract data from these documents to fill the template fields:\n\n${combinedText}`
            }
          ],
          max_completion_tokens: 4000,
        });

        const aiContent = response.choices[0]?.message?.content || "{}";
        const { safeParseJSON } = await import("./utils/anthropic-client");
        fieldValues = safeParseJSON(aiContent);
      }

      let content = template.templateContent;
      for (const field of fields) {
        const value = fieldValues[field.id] || field.placeholder || "TBC";
        content = content.replace(new RegExp(`\\{\\{${field.id}\\}\\}`, "g"), value);
      }

      for (const file of files) {
        try { fs.unlinkSync(file.path); } catch {}
      }

      res.json({
        content,
        fieldValues,
        templateName: template.name,
        documentsProcessed: documentTexts.map((d) => d.name),
      });
    } catch (err: any) {
      console.error("Smart generate error:", err?.message);
      if (files) {
        for (const file of files) {
          try { fs.unlinkSync(file.path); } catch {}
        }
      }
      res.status(500).json({ message: err?.message || "Failed to smart-generate document" });
    }
  });

  app.delete("/api/doc-templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const template = await storage.getDocumentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      if (template.sourceFilePath && fs.existsSync(template.sourceFilePath)) {
        fs.unlinkSync(template.sourceFilePath);
      }
      await storage.deleteDocumentTemplate(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  const generateUpload = multer({
    dest: UPLOADS_DIR,
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.post("/api/doc-templates/generate", requireAuth, generateUpload.array("documents", 10), async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    try {
      const { description, documentType, templateDesign } = req.body;
      if (!description && !documentType) {
        return res.status(400).json({ message: "Please provide a description or document type" });
      }

      let sourceContext = "";
      if (files && files.length > 0) {
        const texts: string[] = [];
        const perFileLimit = Math.min(15000, Math.floor(60000 / files.length));
        for (const file of files) {
          try {
            const text = await extractTextFromFile(file.path, file.originalname);
            if (text) texts.push(`--- ${file.originalname} ---\n${text.slice(0, perFileLimit)}`);
          } catch (extractErr: any) {
            console.log(`[doc-generate] Failed to extract ${file.originalname}: ${extractErr?.message}`);
          }
        }
        sourceContext = texts.join("\n\n");
        console.log(`[doc-generate] Extracted ${texts.length}/${files.length} files, total context: ${sourceContext.length} chars`);
      }

      const systemPrompt = `You are a document generation assistant for Bruce Gillingham Pollard (BGP), a premium commercial property consultancy operating across London and nationally, with particular strength in Belgravia, Mayfair, Chelsea, Knightsbridge, and major mixed-use developments.

${BGP_BRANDING_GUIDELINES}

BGP SERVICE LINES (use these when describing the firm):
- **Leasing**: In-depth knowledge and relationships with retailers and restaurateurs across the UK. Creating sustainable and interesting tenant mixes for landlords.
- **Investment**: Sales, purchasing, and pre-acquisition advice on retail and leisure assets, from standalone units to mixed-use developments.
- **Development**: Design input, specifications, marketing, and tenant demand advice for landlords and developers.
- **Acquisitions / Brand Representation**: Tenant representation advising retail, restaurant, and leisure operators on portfolio expansion.
- **Lease Consultancy**: Rent reviews, lease renewals, re-gears, surrenders, and due diligence.

BGP DOCUMENT STRUCTURE TEMPLATES (follow these structures precisely for each type):

**MARKETING PARTICULARS** (based on BGP marketing details template):
- Title: "[TO LET / FOR SALE] — [Property type]"
- Property image description placeholder
- ACCOMMODATION: Table with floor-by-floor NIA in sq ft and sq m
- RATES: Rateable value, UBR, rates payable
- SERVICE CHARGE: Amount per sq ft per annum
- LOCATION: Detailed area description, transport links, nearby occupiers
- TERMS: Rent (per annum exclusive), lease length, rent review pattern
- EPC: Energy Performance Certificate rating
- VIEWINGS: "All appointments to view must be arranged via sole agents Bruce Gillingham Pollard. Please contact: [Agent name, phone, email]"

**HEADS OF TERMS** (based on BGP HOTs template):
- Header: "Private & Confidential" and "Subject to Contract"
- PROPERTY: Address, NIA, condition/specification
- PARTIES: Landlord, management company, tenant, guarantor (with company reg numbers)
- DEPOSITS: Performance deposit, rent deposit amounts
- TIMING: Exchange deadline, completion date, fit-out period, trading deadline
- CAPITAL CONTRIBUTION: Landlord contribution towards tenant fit-out
- LEGAL DOCUMENTS: List of required documents
- RENT: Base rent per annum, turnover rent %, rent-free period
- TERM: Lease length, break options, renewal rights
- RENT REVIEW: Mechanism (open market, CPI, fixed uplifts)
- REPAIR: Full repairing, internal repairing, or schedule of condition
- PERMITTED USE: Specific use class and restrictions
- SERVICE CHARGE: Cap, contribution basis
- INSURANCE: Contribution basis
- LEGAL COSTS: Each party's responsibility
- Additional clauses as needed

**PITCH PRESENTATION / BRAND BOOK**:
- INTRODUCTION: "We are Bruce Gillingham Pollard" — company overview
- WHAT MAKES US DIFFERENT: Market leaders, strategic approach, innovation, technology, global approach, director-led, long-term relationships, joined-up investment team, collaborative
- OUR SERVICE LINES: Leasing, Investment, Development, Brand Representation, Lease Consultancy
- OUR TRACK RECORD: Named case studies with client names (e.g. "PICCADILLY LIGHTS — Landsec", "CANARY WHARF — Canary Wharf Group")
- OUR CLIENTS: Major landlord/developer clients
- OUR UNIQUE APPROACH: Execution, Global Inspirations, Occupier Trends, Landlord Trends
- TEAM: Relevant team member CVs
- THANK YOU: www.brucegillinghampollard.com

**TEAM CV**:
- Name in UPPERCASE, job title below
- Opening paragraph: role, years of experience, specialisms
- Key instructions and named transactions with client names
- Additional experience and achievements
- Personal interests/approach (brief, professional)

**PRESS RELEASE**:
- Title (bold, descriptive headline)
- Date
- Main body text (3-5 paragraphs)
- Relevant quotes from BGP directors
- BGP AREAS OF EXPERTISE footer: Leasing, Investment, Development, Acquisitions, Lease Consultancy

**CLIENT REPORT**:
- EXECUTIVE SUMMARY
- MARKET OVERVIEW: Trends, comparable transactions
- PROPERTY ANALYSIS: Location, accommodation, condition, planning
- COMPARABLE EVIDENCE: Schedule of relevant transactions
- VALUATION/RECOMMENDATION: ERV, capital value, yield analysis
- SWOT ANALYSIS
- RECOMMENDATIONS & NEXT STEPS
- APPENDICES

**INVESTMENT MEMO**:
- PROPERTY SUMMARY: Address, description, tenure
- TENANCY SCHEDULE: Tenant, demise, term, rent, review dates, break options
- PASSING RENT & WAULT
- MARKET CONTEXT: Area trends, recent transactions
- PRICING ANALYSIS: NIY, reversionary yield, capital value per sq ft
- RECOMMENDATION & RISK FACTORS

**LEASING STRATEGY**:
- SCHEME OVERVIEW & VISION
- CATCHMENT ANALYSIS: Demographics, footfall, spending patterns
- COMPETITOR AUDIT: Nearby schemes, vacancy rates
- TARGET TENANT MIX: By category (retail, F&B, leisure, wellness, services)
- PHASING PLAN: Priority units, launch sequence
- RENTAL EXPECTATIONS: By unit/zone
- MARKETING PLAN & TIMELINE

**REQUIREMENT FLYER**:
- Brand name and concept description
- Target locations and demographics
- Unit size requirements (sq ft range)
- Preferred lease terms
- Contact details for landlord submissions

**PITCH DECK** (widescreen presentation, BGP master deck format):
- COVER SLIDE: "Pitch Presentation" title, prepared for client, date
- 01 INTRODUCTION: Company overview, what makes BGP different, market positioning
- 02 OUR SERVICES: Leasing, Investment, Development, Acquisitions, Lease Consultancy — each with brief description
- IMAGE GRID: Project/property images with captions
- THE TEAM: Team member profiles with biographies
- THANK YOU: Contact details and website

**PROPERTY TOUR DECK** (widescreen presentation):
- COVER SLIDE: Property address title
- HERO IMAGE: Full-width property exterior
- PHOTO GALLERY: 4 property images with captions (exterior, interior, street, detail)
- FLOOR PLANS: Floor plan with accommodation schedule (sq ft by floor)

**MARKET REPORT DECK** (widescreen presentation):
- COVER SLIDE: "Market Report" title, area and quarter
- 01 MARKET OVERVIEW: Key indicators (take-up, availability, prime rent, under offer) with data
- CHART & COMMENTARY: Market trends chart with analytical commentary
- COMPARABLE EVIDENCE: Table of recent transactions

**INVESTMENT DECK** (widescreen presentation):
- COVER SLIDE: "Investment Proposal" title, property address
- PROPERTY OVERVIEW: Hero image with key metrics (passing rent, NIY, rev yield, WAULT, capital value)
- TENANCY SCHEDULE: Table of tenant, demise, rent, expiry

**LEASING DECK** (widescreen presentation):
- COVER SLIDE: "Leasing Strategy" title, scheme name
- 01 VISION & OVERVIEW: Scheme positioning and strategy
- TARGET TENANT MIX: Categories (retail, F&B, leisure, wellness) with phasing timeline

**TEAM DECK** (widescreen presentation):
- COVER SLIDE: "Team Profiles" title
- TEAM OVERVIEW: 4-person grid with photos and bullet biographies
- DETAILED BIO: Single person with full biography

**CASE STUDY DECK** (widescreen presentation):
- COVER SLIDE: "Case Studies" title
- CASE STUDY: Property image, project description, key metrics (size, sector, value)
- PHOTO GRID: 6 property images with captions

**TENANT HANDBOOK** (fit-out guide):
- INTRODUCTION: Property name, address, building overview
- BUILDING MANAGEMENT: Managing agents contact details, emergency contacts, out-of-hours procedures
- FIT-OUT REQUIREMENTS: Specifications, approved contractors, submission process, health & safety during works
- BUILDING ACCESS & SECURITY: Opening hours, key/fob arrangements, visitor management, CCTV
- MECHANICAL & ELECTRICAL: HVAC, lighting, utility meters, BMS
- HEALTH & SAFETY: Fire evacuation procedures, assembly points, first aid, risk assessments
- WASTE MANAGEMENT: Collection schedules, recycling requirements, bin store locations
- SIGNAGE: Approved signage types, planning consent requirements, directory board entries
- GENERAL BUILDING RULES: Noise restrictions, deliveries, communal area use, insurance requirements

**RENT REVIEW MEMO** (internal memorandum):
- PROPERTY: Address, floor/unit, NIA sq ft
- CURRENT TERMS: Passing rent, lease commencement, lease expiry, review pattern
- REVIEW DATE: The specific review date under consideration
- REVIEW MECHANISM: Open market, CPI, fixed uplift, or other basis per lease clause
- COMPARABLE EVIDENCE: Schedule of relevant transactions (address, tenant, rent, date, size, analysis)
- ERV ANALYSIS: Recommended ERV per sq ft, total recommended rent, percentage increase
- NEGOTIATION STRATEGY: Opening position, fall-back, key arguments, timeline
- FEE ESTIMATE: Basis for fee (percentage of rent increase or fixed), estimated fee amount

**INSTRUCTION LETTER** (formal engagement letter):
- ADDRESSEE: Client name, company, address
- RE: Property address and scope
- APPOINTMENT: Confirmation of BGP appointment as agent
- SCOPE OF WORK: Detailed services to be provided (marketing, viewings, negotiations, etc.)
- FEE BASIS: Percentage of rent achieved, or fixed fee, payment triggers, VAT
- TERMS OF ENGAGEMENT: Duration, exclusivity, termination notice period
- CONFLICT OF INTEREST: Disclosure of any conflicts
- REGULATORY: RICS compliance, professional indemnity insurance, complaints procedure
- ANTI-MONEY LAUNDERING: KYC/AML obligations
- SIGNATURE BLOCK: For both BGP director and client countersignature

Generate professional property documents based on the user's request. If source documents are provided, extract relevant data from them to populate the document.

FORMATTING RULES:
- Always produce complete, professional documents ready for use
- Use formal British English throughout
- Include clear section headings in UPPERCASE for formal documents
- Use proper document structure: title, date, parties, sections, signature blocks where appropriate
- Mark unknown specifics as [TO BE CONFIRMED] rather than inventing data
- Write with authority and market knowledge befitting BGP's reputation
- Use real industry terminology: NIA, ERV, NIY, WAULT, UBR, EPC, sq ft, sq m, per annum

CRITICAL OUTPUT FORMAT:
- Do NOT include any HTML tags (<div>, <br>, <hr>, <strong>, etc.)
- Do NOT include any CSS or style attributes
- Do NOT include document specification blocks or meta-commentary about formatting
- Do NOT include placeholder text like "[BGP LOGO]"
- Use PLAIN TEXT with simple markdown: **bold** for emphasis, bullet points with "- ", numbered lists with "1. "
- Section headings should be in UPPERCASE on their own line
- Use "---" for horizontal rules
- Use "> " prefix for blockquotes
- The system handles all document styling (fonts, headers, footers, branding) automatically during export`;

      const userPrompt = `${documentType ? `Document type: ${documentType}\n` : ""}${description ? `Instructions: ${description}\n` : ""}${sourceContext ? `\nSource documents for data extraction:\n${sourceContext}` : ""}

Generate the complete document now.`;

      let content = "";
      const gemini = getGeminiClient();
      if (gemini) {
        try {
          console.log("[doc-generate] Using Gemini 3.1 Pro");
          const geminiResponse = await gemini.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            config: { maxOutputTokens: 8192, temperature: 0.3 },
          });
          content = geminiResponse.text || "";
        } catch (geminiErr: any) {
          console.log("[doc-generate] Gemini 3.1 Pro failed, falling back to GPT-4o:", geminiErr?.message);
        }
      }
      if (!content) {
        // All Document Studio generations use Opus (per the 956dbc9 upgrade).
        // callDocOpus tries 4.7 first and falls back to 4.6 if the newer model
        // isn't yet API-accessible — fixes the 500 from a hardcoded 4.6 string.
        console.log(`[doc-generate] Using Opus for type: ${documentType || "unspecified"}`);
        const completion = await callDocOpus({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_completion_tokens: 16384,
        });
        content = completion.choices[0]?.message?.content || "No content generated.";
      }

      const docName = documentType || "Generated Document";
      const sourceFileNames = files?.map(f => f.originalname) || [];

      const run = await storage.createDocumentRun({
        name: docName,
        documentType: documentType || undefined,
        description: description || undefined,
        content,
        sourceFiles: sourceFileNames.length > 0 ? sourceFileNames : undefined,
        design: templateDesign || undefined,
      });

      res.json({
        content,
        name: docName,
        message: content,
        runId: run.id,
        design: run.design || null,
      });
    } catch (err: any) {
      console.error("[doc-generate]", err?.message);
      res.status(500).json({ message: err?.message || "Failed to generate document" });
    } finally {
      if (files) {
        for (const file of files) {
          try { fs.unlinkSync(file.path); } catch {}
        }
      }
    }
  });

  const askUpload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 50 * 1024 * 1024 } });
  app.post("/api/doc-templates/ask-claude", requireAuth, askUpload.array("documents", 10), async (req: Request, res: Response) => {
    const uploadedFiles = req.files as Express.Multer.File[] | undefined;
    try {
      const { question } = req.body;
      let conversationHistory: any = req.body.conversationHistory;
      if (typeof conversationHistory === "string") {
        try { conversationHistory = JSON.parse(conversationHistory); } catch { conversationHistory = []; }
      }
      if (!question || typeof question !== "string") {
        return res.status(400).json({ message: "Please provide a question" });
      }

      let fileContext = "";
      if (uploadedFiles && uploadedFiles.length > 0) {
        const texts: string[] = [];
        const perFileLimit = Math.min(15000, Math.floor(60000 / uploadedFiles.length));
        for (const file of uploadedFiles) {
          try {
            const text = await extractTextFromFile(file.path, file.originalname);
            if (text) texts.push(`--- ${file.originalname} ---\n${text.slice(0, perFileLimit)}`);
          } catch {}
        }
        if (texts.length > 0) {
          fileContext = `\n\nThe user has attached the following files. Use their contents to answer the question:\n\n${texts.join("\n\n")}`;
        }
        console.log(`[doc-ask] Extracted ${texts.length}/${uploadedFiles.length} files, context: ${fileContext.length} chars`);
      }

      const templates = await storage.getDocumentTemplates();

      const systemPrompt = `You are a document assistant for Bruce Gillingham Pollard (BGP), a premium commercial property consultancy operating across London and nationally. Service lines: Leasing, Investment, Development, Brand Representation/Acquisitions, and Lease Consultancy.

${BGP_BRANDING_GUIDELINES}

You help with:
- Answering questions about document templates and BGP document standards
- Drafting property documents (heads of terms, marketing particulars, client reports, pitch presentations, team CVs, press releases, investment memos, leasing strategies, requirement flyers, tenant handbooks, rent review memos, instruction letters)
- Explaining document contents and requirements
- Suggesting improvements to templates and formatting
- Creating visual content like logos, branding graphics, property photos, headers, illustrations, and marketing visuals
- Use real BGP document structures: HOTs should have Property/Parties/Deposits/Timing/Rent/Term/Rent Review/Repair/Use/Service Charge sections. Marketing Particulars should have Accommodation/Rates/Location/Terms/EPC/Viewings sections. Pitch decks should follow Introduction/What Makes Us Different/Service Lines/Track Record/Approach/Team/Thank You structure.

You have the ability to generate images. When the user asks for any visual content (logos, graphics, images, illustrations, branding concepts, property visualisations, etc.), you MUST respond with a JSON block in this exact format:
\`\`\`json
{"generateImages": [{"prompt": "detailed description of the image to generate", "label": "short label for the image"}]}
\`\`\`
You may include multiple images. Follow the JSON block with your text explanation/commentary about the visuals.

For logo/branding requests, generate 3-4 variations with different styles (minimalist, geometric, typographic, modern, classic). Always describe BGP's premium, understated aesthetic in prompts.

Available templates:
${templates.map(t => `- ${t.name} (${t.status}): ${t.description || "No description"} — ${(t as any).fields?.length || 0} fields`).join("\n")}

CRITICAL OUTPUT FORMAT FOR DOCUMENTS:
- Do NOT include any HTML tags (<div>, <br>, <hr>, <strong>, etc.)
- Do NOT include CSS or style attributes
- Do NOT include document specification blocks or meta-commentary about formatting
- Use PLAIN TEXT with simple markdown: **bold** for emphasis, "- " for bullet points, "1. " for numbered lists
- Section headings should be in UPPERCASE on their own line
- The system handles all document styling automatically during export

Be concise, professional, and use British English. All document advice should align with BGP's brand and standards.`;

      let answer = "";
      const gemini = getGeminiClient();
      if (gemini) {
        try {
          const geminiContents: any[] = [];
          if (conversationHistory && Array.isArray(conversationHistory)) {
            for (const msg of conversationHistory.slice(-10)) {
              geminiContents.push({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.text }],
              });
            }
          }
          geminiContents.push({ role: "user", parts: [{ text: question + fileContext }] });
          const geminiResponse = await gemini.models.generateContent({
            model: "gemini-2.5-flash",
            contents: geminiContents,
            config: {
              maxOutputTokens: 4096,
              temperature: 0.4,
              systemInstruction: systemPrompt,
            },
          });
          answer = geminiResponse.text || "";
        } catch (geminiErr: any) {
          console.log("[doc-ask] Gemini 3.1 Pro failed, falling back to GPT-4o:", geminiErr?.message);
        }
      }
      if (!answer) {
        const messages: any[] = [{ role: "system", content: systemPrompt }];
        if (conversationHistory && Array.isArray(conversationHistory)) {
          for (const msg of conversationHistory.slice(-10)) {
            messages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.text });
          }
        }
        messages.push({ role: "user", content: question + fileContext });
        const completion = await callClaude({
          model: CHATBGP_HELPER_MODEL, messages, temperature: 0.4, max_completion_tokens: 2000,
        });
        answer = completion.choices[0]?.message?.content || "I couldn't generate a response.";
      }

      const generatedImages: Array<{ src: string; label: string }> = [];
      const jsonMatch = answer.match(/```json\s*(\{[\s\S]*?"generateImages"[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (Array.isArray(parsed.generateImages) && parsed.generateImages.length > 0) {
            for (const imgReq of parsed.generateImages.slice(0, 4)) {
              const imgElement = { generatePrompt: imgReq.prompt, src: undefined as string | undefined };
              try {
                await generateSingleImage(imgElement);
                if (imgElement.src) {
                  generatedImages.push({
                    src: imgElement.src,
                    label: imgReq.label || "Generated image",
                  });
                }
              } catch (imgErr: any) {
                console.log("[doc-ask] Image generation skipped:", imgErr?.message);
              }
            }
            answer = answer.replace(/```json\s*\{[\s\S]*?"generateImages"[\s\S]*?\}\s*```/, "").trim();
          }
        } catch (parseErr: any) {
          console.log("[doc-ask] Failed to parse image generation JSON:", parseErr?.message);
        }
      }

      const displayQuestion = uploadedFiles && uploadedFiles.length > 0
        ? `${question} (${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""} attached: ${uploadedFiles.map(f => f.originalname).join(", ")})`
        : question;
      res.json({ question: displayQuestion, answer, images: generatedImages.length > 0 ? generatedImages : undefined });
    } catch (err: any) {
      console.error("[doc-ask-claude]", err?.message);
      res.status(500).json({ message: err?.message || "Failed to get answer" });
    } finally {
      if (uploadedFiles) {
        for (const file of uploadedFiles) {
          try { fs.unlinkSync(file.path); } catch {}
        }
      }
    }
  });

  app.get("/api/doc-runs", requireAuth, async (_req: Request, res: Response) => {
    try {
      const runs = await storage.listDocumentRuns();
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to list document runs" });
    }
  });

  app.get("/api/doc-runs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getDocumentRun(req.params.id);
      if (!run) return res.status(404).json({ message: "Document run not found" });
      res.json(run);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch document run" });
    }
  });

  app.post("/api/doc-runs/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const { content, title, format, documentType } = req.body;
      if (!content || !format) {
        return res.status(400).json({ message: "Content and format are required" });
      }
      if (typeof content !== "string" || content.length > 200000) {
        return res.status(400).json({ message: "Content too large (max 200,000 characters)" });
      }
      if (!["docx", "pdf", "pptx"].includes(format)) {
        return res.status(400).json({ message: "Unsupported format. Use: docx, pdf, or pptx" });
      }

      const docTitle = (title || "BGP Document").slice(0, 200);
      const logoPath = path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark.png");
      const logoExists = fs.existsSync(logoPath);
      const logoBuffer = logoExists ? fs.readFileSync(logoPath) : null;
      const logoBase64 = logoBuffer ? logoBuffer.toString("base64") : null;

      function cleanContent(raw: string): string {
        let text = raw;
        text = text.replace(/\*\*DOCUMENT SPECIFICATION:\*\*[\s\S]*?(?=\n\n\*\*|$)/i, "");
        text = text.replace(/DOCUMENT SPECIFICATION:[\s\S]*?(?=\n\n[A-Z\*]|$)/i, "");
        text = text.replace(/<div[^>]*>/gi, "").replace(/<\/div>/gi, "");
        text = text.replace(/<br\s*\/?>/gi, "");
        text = text.replace(/<hr[^>]*>/gi, "---");
        text = text.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
        text = text.replace(/<em>(.*?)<\/em>/gi, "*$1*");
        text = text.replace(/<[^>]+>/g, "");
        text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
        text = text.replace(/\[BGP LOGO\]/g, "");
        text = text.replace(/^Bruce Gillingham Pollard — Confidential\s*\|?\s*Page\s*\d*\s*$/gm, "");
        text = text.replace(/\n{4,}/g, "\n\n\n");
        return text.trim();
      }

      function stripMd(text: string): string {
        return text.replace(/\*\*\*(.*?)\*\*\*/g, "$1").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/^#+\s*/gm, "");
      }

      interface TextSegment { text: string; bold: boolean; italic: boolean; }
      function parseInlineFormatting(text: string): TextSegment[] {
        const segments: TextSegment[] = [];
        const regex = /(\*\*\*(.*?)\*\*\*|\*\*(.*?)\*\*|\*(.*?)\*)/g;
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            segments.push({ text: text.slice(lastIndex, match.index), bold: false, italic: false });
          }
          if (match[2] !== undefined) {
            segments.push({ text: match[2], bold: true, italic: true });
          } else if (match[3] !== undefined) {
            segments.push({ text: match[3], bold: true, italic: false });
          } else if (match[4] !== undefined) {
            segments.push({ text: match[4], bold: false, italic: true });
          }
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) {
          segments.push({ text: text.slice(lastIndex), bold: false, italic: false });
        }
        return segments.length > 0 ? segments : [{ text, bold: false, italic: false }];
      }

      function classifyLine(trimmed: string): "blank" | "title" | "heading" | "subheading" | "bullet" | "numbered" | "blockquote" | "hr" | "body" {
        if (!trimmed) return "blank";
        if (/^---+$|^___+$|^\*\*\*+$/.test(trimmed)) return "hr";
        if (/^>\s/.test(trimmed)) return "blockquote";
        const plain = stripMd(trimmed);
        if (/^\d+\.\s/.test(plain) && plain === plain.toUpperCase() && plain.length > 5) return "heading";
        if (plain === plain.toUpperCase() && plain.length > 3 && /[A-Z]/.test(plain) && !/^[-•*]/.test(plain)) return "heading";
        if (/^#+\s/.test(trimmed)) return "heading";
        if (/^[-•*]\s/.test(plain)) return "bullet";
        if (/^\d+[\.\)]\s/.test(plain)) return "numbered";
        return "body";
      }

      const cleaned = cleanContent(content);
      const lines = cleaned.split("\n");

      if (format === "docx") {
        const docxModule = await import("docx");
        const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Header, Footer, BorderStyle, PageNumber, ImageRun, SectionType, PageBreak, Tab, TabStopType, TabStopPosition, ShadingType, Table, TableRow, TableCell, WidthType } = docxModule;

        const bgpGreenHex = "2E5E3F";
        const bgpDarkGreenHex = "1A3A28";
        const bgpGoldHex = "C4A35A";
        const generatedDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

        // --- Cover page section ---
        const coverChildren: any[] = [];
        // Spacer for visual centering
        coverChildren.push(new Paragraph({ spacing: { before: 4800 } }));
        // Green accent line
        coverChildren.push(new Paragraph({
          spacing: { after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: bgpGreenHex, space: 4 } },
        }));
        // Document title
        coverChildren.push(new Paragraph({
          children: [new TextRun({ text: docTitle, bold: true, font: "Calibri", size: 52, color: bgpDarkGreenHex })],
          spacing: { after: 200 },
          alignment: AlignmentType.LEFT,
        }));
        // Subtitle line
        coverChildren.push(new Paragraph({
          children: [new TextRun({ text: "BRUCE GILLINGHAM POLLARD", font: "Calibri", size: 20, color: bgpGreenHex, bold: true })],
          spacing: { after: 100 },
        }));
        coverChildren.push(new Paragraph({
          children: [new TextRun({ text: generatedDate, font: "Calibri", size: 18, color: "666666" })],
          spacing: { after: 100 },
        }));
        if (documentType) {
          coverChildren.push(new Paragraph({
            children: [new TextRun({ text: documentType, font: "Calibri", size: 18, color: "888888", italics: true })],
            spacing: { after: 200 },
          }));
        }
        // Gold accent line
        coverChildren.push(new Paragraph({
          spacing: { before: 800 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: bgpGoldHex, space: 4 } },
        }));
        // Confidential notice
        coverChildren.push(new Paragraph({
          children: [new TextRun({ text: "CONFIDENTIAL", font: "Calibri", size: 16, color: "999999", bold: true })],
          spacing: { before: 200 },
        }));

        // --- Table of Contents placeholder ---
        const tocChildren: any[] = [];
        tocChildren.push(new Paragraph({
          children: [new TextRun({ text: "TABLE OF CONTENTS", bold: true, font: "Calibri", size: 24, color: bgpGreenHex })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 300 },
        }));
        tocChildren.push(new Paragraph({
          children: [new TextRun({ text: "[Table of contents will auto-generate when document is opened in Microsoft Word — right-click here and select 'Update Field']", font: "Calibri", size: 20, color: "888888", italics: true })],
          spacing: { after: 400 },
        }));

        // --- Content section ---
        const children: any[] = [];
        let foundTitle = false;

        // Determine if this document type should have generated images in DOCX
        const docxNeedsImages = shouldGenerateDocImages(documentType) && !!process.env.OPENAI_API_KEY;
        let docxImageCount = 0;
        const DOCX_MAX_IMAGES = 2; // Limit to avoid excessive generation time

        for (const line of lines) {
          const trimmed = line.trim();
          const lineType = classifyLine(trimmed);

          if (lineType === "blank") {
            children.push(new Paragraph({ spacing: { after: 80 } }));
            continue;
          }
          if (lineType === "hr") {
            children.push(new Paragraph({ spacing: { before: 160, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: bgpGreenHex, space: 1 } } }));
            continue;
          }

          const plain = stripMd(trimmed);

          if (lineType === "heading" && !foundTitle) {
            foundTitle = true;
            children.push(new Paragraph({
              children: [new TextRun({ text: plain, bold: true, font: "Calibri", size: 36, color: bgpDarkGreenHex })],
              heading: HeadingLevel.TITLE,
              spacing: { after: 240 },
              alignment: AlignmentType.CENTER,
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: bgpGreenHex, space: 6 } },
            }));

            // Generate a hero image after the title for pitch-quality DOCX documents
            if (docxNeedsImages && docxImageCount < DOCX_MAX_IMAGES) {
              console.log(`[doc-images] DOCX: Generating hero image for title...`);
              const heroPrompt = `Professional hero image for a premium property document titled "${plain}". Elegant London commercial property, modern architecture, impressive facade.`;
              const heroB64 = await generateImageForDocument(heroPrompt);
              if (heroB64) {
                const imgBuffer = Buffer.from(heroB64, "base64");
                children.push(new Paragraph({
                  children: [new ImageRun({ data: imgBuffer, transformation: { width: 600, height: 340 }, type: "png" })],
                  spacing: { before: 200, after: 200 },
                  alignment: AlignmentType.CENTER,
                }));
                docxImageCount++;
                console.log(`[doc-images] DOCX: Hero image embedded (${docxImageCount}/${DOCX_MAX_IMAGES})`);
              }
            }
          } else if (lineType === "heading") {
            const isSubSection = /^\d+\.\d+/.test(plain);
            const isH3 = /^\d+\.\d+\.\d+/.test(plain);
            children.push(new Paragraph({
              children: [new TextRun({ text: plain, bold: true, font: "Calibri", size: isH3 ? 20 : isSubSection ? 22 : 26, color: isH3 ? "666666" : isSubSection ? "444444" : bgpGreenHex })],
              heading: isH3 ? HeadingLevel.HEADING_3 : isSubSection ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
              spacing: { before: 320, after: 160 },
            }));

            // Generate images for key sections in pitch-quality DOCX documents
            if (docxNeedsImages && !isSubSection && !isH3 && docxImageCount < DOCX_MAX_IMAGES) {
              const sectionLower = plain.toLowerCase();
              const imageWorthy = ["property", "location", "overview", "market", "portfolio"].some(kw => sectionLower.includes(kw));
              if (imageWorthy) {
                console.log(`[doc-images] DOCX: Generating image for section "${plain}"...`);
                const secPrompt = `Professional commercial property scene for document section "${plain}". Premium London real estate, high quality architectural photography.`;
                const secB64 = await generateImageForDocument(secPrompt);
                if (secB64) {
                  const secImgBuffer = Buffer.from(secB64, "base64");
                  children.push(new Paragraph({
                    children: [new ImageRun({ data: secImgBuffer, transformation: { width: 600, height: 340 }, type: "png" })],
                    spacing: { before: 160, after: 160 },
                    alignment: AlignmentType.CENTER,
                  }));
                  docxImageCount++;
                  console.log(`[doc-images] DOCX: Section image embedded for "${plain}" (${docxImageCount}/${DOCX_MAX_IMAGES})`);
                }
              }
            }
          } else if (lineType === "bullet") {
            const bulletText = plain.replace(/^[-•*]\s*/, "");
            const segs = parseInlineFormatting(bulletText);
            children.push(new Paragraph({
              children: segs.map(s => new TextRun({ text: s.text, bold: s.bold, italics: s.italic, font: "Calibri", size: 22, color: "333333" })),
              bullet: { level: 0 },
              spacing: { after: 60 },
            }));
          } else if (lineType === "numbered") {
            const numMatch = plain.match(/^(\d+[\.\)])\s*(.*)/);
            const num = numMatch?.[1] || "";
            const text = numMatch?.[2] || plain;
            const segs = parseInlineFormatting(text);
            children.push(new Paragraph({
              children: [new TextRun({ text: num + " ", bold: true, font: "Calibri", size: 24, color: bgpGreenHex }), ...segs.map(s => new TextRun({ text: s.text, bold: s.bold, italics: s.italic, font: "Calibri", size: 22, color: "333333" }))],
              spacing: { before: 200, after: 100 },
            }));
          } else if (lineType === "blockquote") {
            const quoteText = trimmed.replace(/^>\s*/, "");
            const segs = parseInlineFormatting(quoteText);
            children.push(new Paragraph({
              children: segs.map(s => new TextRun({ text: s.text, bold: s.bold, italics: true, font: "Calibri", size: 21, color: "555555" })),
              spacing: { after: 80 },
              indent: { left: 480 },
              border: { left: { style: BorderStyle.SINGLE, size: 3, color: bgpGreenHex, space: 12 } },
            }));
          } else {
            const segs = parseInlineFormatting(trimmed);
            children.push(new Paragraph({
              children: segs.map(s => new TextRun({ text: s.text, bold: s.bold, italics: s.italic, font: "Calibri", size: 22, color: "333333" })),
              spacing: { after: 100 },
              alignment: AlignmentType.JUSTIFIED,
            }));
          }
        }

        const doc = new Document({
          creator: "Bruce Gillingham Pollard",
          title: docTitle,
          styles: {
            default: {
              heading1: {
                run: { font: "Calibri", size: 26, bold: true, color: bgpGreenHex },
                paragraph: { spacing: { before: 320, after: 160 } },
              },
              heading2: {
                run: { font: "Calibri", size: 22, bold: true, color: "444444" },
                paragraph: { spacing: { before: 240, after: 120 } },
              },
              heading3: {
                run: { font: "Calibri", size: 20, bold: true, color: "666666" },
                paragraph: { spacing: { before: 200, after: 100 } },
              },
              document: {
                run: { font: "Calibri", size: 22, color: "333333" },
              },
            },
          },
          sections: [
            // Cover page section
            {
              properties: {
                page: { margin: { top: 1440, bottom: 1440, left: 1200, right: 1200 } },
                type: SectionType.NEXT_PAGE,
              },
              headers: {
                default: new Header({
                  children: [new Paragraph({
                    children: [
                      ...(logoBuffer ? [new ImageRun({ data: logoBuffer, transformation: { width: 120, height: 30 }, type: "png" }), new TextRun({ text: "   ", font: "Calibri", size: 16 })] : []),
                    ],
                    alignment: AlignmentType.LEFT,
                  })],
                }),
              },
              children: coverChildren,
            },
            // TOC + Content section
            {
              properties: {
                page: { margin: { top: 1440, bottom: 1440, left: 1200, right: 1200 }, pageNumbers: { start: 1 } },
                type: SectionType.NEXT_PAGE,
              },
              headers: {
                default: new Header({
                  children: [new Paragraph({
                    children: [
                      ...(logoBuffer ? [new ImageRun({ data: logoBuffer, transformation: { width: 120, height: 30 }, type: "png" }), new TextRun({ text: "   ", font: "Calibri", size: 16 })] : []),
                      new TextRun({ text: "BRUCE GILLINGHAM POLLARD", font: "Calibri", size: 16, color: bgpGreenHex, bold: true }),
                    ],
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 200 },
                    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: bgpGreenHex, space: 8 } },
                  })],
                }),
              },
              footers: {
                default: new Footer({
                  children: [new Paragraph({
                    children: [
                      new TextRun({ text: generatedDate, font: "Calibri", size: 14, color: "888888" }),
                      new TextRun({ text: "          Bruce Gillingham Pollard — Confidential          ", font: "Calibri", size: 14, color: "888888" }),
                      new TextRun({ text: "Page ", font: "Calibri", size: 14, color: "888888" }),
                      new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 14, color: "888888" }),
                      new TextRun({ text: " of ", font: "Calibri", size: 14, color: "888888" }),
                      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Calibri", size: 14, color: "888888" }),
                    ],
                    alignment: AlignmentType.CENTER,
                    border: { top: { style: BorderStyle.SINGLE, size: 1, color: bgpGreenHex, space: 8 } },
                  })],
                }),
              },
              children: [...tocChildren, ...children],
            },
          ],
        });

        const buffer = await Packer.toBuffer(doc);
        const filename = `${docTitle.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_")}.docx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(buffer);
      }

      if (format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({
          size: "A4",
          margins: { top: 80, bottom: 80, left: 60, right: 60 },
          info: { Title: docTitle, Author: "Bruce Gillingham Pollard", Creator: "BGP Dashboard" },
          bufferPages: true,
        });

        const chunks: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        const pageW = 475;
        const leftM = 60;
        const rightEdge = leftM + pageW;
        const bgpGreen = "#2E5E3F";
        const bgpDarkGreen = "#1A3A28";
        const generatedDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

        function drawHeader() {
          // BGP green bar at top
          doc.rect(0, 0, 595, 8).fill(bgpGreen);
          if (logoExists) {
            try {
              doc.image(logoPath, leftM, 14, { width: 80 });
            } catch {}
          }
          doc.fontSize(7).fillColor("#FFFFFF").font("Helvetica-Bold")
            .text("BRUCE GILLINGHAM POLLARD", leftM, 10, { align: "right", width: pageW });
          doc.moveTo(leftM, 50).lineTo(rightEdge, 50).strokeColor(bgpGreen).lineWidth(0.5).stroke();
        }

        function newPage() {
          doc.addPage();
          drawHeader();
          return 72;
        }

        // Determine if this document type should have generated images in PDF
        const pdfNeedsImages = shouldGenerateDocImages(documentType) && !!process.env.OPENAI_API_KEY;
        let pdfImageCount = 0;
        const PDF_MAX_IMAGES = 2; // Limit to avoid excessive generation time

        drawHeader();
        let y = 72;
        let foundTitle = false;

        for (const line of lines) {
          const trimmed = line.trim();
          const lineType = classifyLine(trimmed);
          const plain = stripMd(trimmed);

          if (lineType === "blank") { y += 10; continue; }

          if (y > 710) y = newPage();

          if (lineType === "hr") {
            y += 6;
            doc.moveTo(leftM, y).lineTo(rightEdge, y).strokeColor(bgpGreen).lineWidth(0.5).stroke();
            y += 10;
            continue;
          }

          if (lineType === "heading" && !foundTitle) {
            foundTitle = true;
            // BGP green accent bar above title
            doc.rect(leftM, y - 2, pageW, 3).fill(bgpGreen);
            y += 10;
            doc.font("Helvetica-Bold").fontSize(20).fillColor(bgpDarkGreen)
              .text(plain, leftM, y, { align: "center", width: pageW });
            y = doc.y + 18;

            // Generate a hero image for the title section in pitch-quality PDFs
            if (pdfNeedsImages && pdfImageCount < PDF_MAX_IMAGES) {
              console.log(`[doc-images] PDF: Generating hero image for title...`);
              const heroPrompt = `Professional hero image for a premium property document titled "${plain}". Elegant London commercial property, modern architecture, impressive facade or interior.`;
              const heroB64 = await generateImageForDocument(heroPrompt);
              if (heroB64) {
                const imgBuffer = Buffer.from(heroB64, "base64");
                y = newPage();
                doc.image(imgBuffer, leftM, y, { width: pageW, height: 300 });
                y += 310;
                pdfImageCount++;
                console.log(`[doc-images] PDF: Hero image embedded (${pdfImageCount}/${PDF_MAX_IMAGES})`);
              }
            }
          } else if (lineType === "heading") {
            const isSubSection = /^\d+\.\d+/.test(plain);
            y += isSubSection ? 6 : 12;
            if (y > 710) y = newPage();
            doc.font("Helvetica-Bold").fontSize(isSubSection ? 11 : 14).fillColor(isSubSection ? "#444444" : bgpGreen)
              .text(plain, leftM, y, { width: pageW });
            y = doc.y + 6;

            // Generate images for key sections in pitch-quality PDFs
            if (pdfNeedsImages && !isSubSection && pdfImageCount < PDF_MAX_IMAGES) {
              const sectionLower = plain.toLowerCase();
              const imageWorthy = ["property", "location", "overview", "market", "portfolio"].some(kw => sectionLower.includes(kw));
              if (imageWorthy) {
                console.log(`[doc-images] PDF: Generating image for section "${plain}"...`);
                const secPrompt = `Professional commercial property scene for document section "${plain}". Premium London real estate, high quality architectural photography.`;
                const secB64 = await generateImageForDocument(secPrompt);
                if (secB64) {
                  const secImgBuffer = Buffer.from(secB64, "base64");
                  if (y > 450) y = newPage();
                  doc.image(secImgBuffer, leftM, y, { width: pageW, height: 220 });
                  y += 230;
                  pdfImageCount++;
                  console.log(`[doc-images] PDF: Section image embedded for "${plain}" (${pdfImageCount}/${PDF_MAX_IMAGES})`);
                }
              }
            }
          } else if (lineType === "bullet") {
            const bulletText = stripMd(plain.replace(/^[-•*]\s*/, ""));
            doc.font("Times-Roman").fontSize(10.5).fillColor("#333333")
              .text(`  •  ${bulletText}`, leftM + 12, y, { width: pageW - 12 });
            y = doc.y + 3;
          } else if (lineType === "numbered") {
            doc.font("Times-Roman").fontSize(10.5).fillColor("#333333")
              .text(plain, leftM + 12, y, { width: pageW - 12 });
            y = doc.y + 3;
          } else if (lineType === "blockquote") {
            const quoteText = stripMd(trimmed.replace(/^>\s*/, ""));
            doc.save();
            doc.moveTo(leftM + 20, y).lineTo(leftM + 20, y + 14).strokeColor(bgpGreen).lineWidth(2).stroke();
            doc.restore();
            doc.font("Times-Italic").fontSize(10).fillColor("#555555")
              .text(quoteText, leftM + 30, y, { width: pageW - 30 });
            y = doc.y + 4;
          } else {
            const segs = parseInlineFormatting(trimmed);
            if (segs.length === 1 && !segs[0].bold && !segs[0].italic) {
              doc.font("Times-Roman").fontSize(10.5).fillColor("#333333")
                .text(segs[0].text, leftM, y, { width: pageW, align: "justify" });
            } else {
              doc.fontSize(10.5).fillColor("#333333");
              let first = true;
              for (const seg of segs) {
                const fontName = seg.bold && seg.italic ? "Times-BoldItalic" : seg.bold ? "Times-Bold" : seg.italic ? "Times-Italic" : "Times-Roman";
                doc.font(fontName);
                if (first) {
                  doc.text(seg.text, leftM, y, { width: pageW, align: "justify", continued: segs.indexOf(seg) < segs.length - 1 });
                  first = false;
                } else {
                  doc.text(seg.text, { continued: segs.indexOf(seg) < segs.length - 1 });
                }
              }
            }
            y = doc.y + 4;
          }
        }

        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          // Green header bar overlay on each page (already drawn by drawHeader but reinforce for buffered pages)
          doc.rect(0, 0, 595, 8).fill(bgpGreen);
          doc.fontSize(7).fillColor("#FFFFFF").font("Helvetica-Bold")
            .text("BRUCE GILLINGHAM POLLARD", leftM, 10, { align: "right", width: pageW });
          // Footer
          doc.moveTo(leftM, 770).lineTo(rightEdge, 770).strokeColor(bgpGreen).lineWidth(0.5).stroke();
          doc.fontSize(7).fillColor("#888888").font("Helvetica");
          doc.text(generatedDate, leftM, 776, { width: 150, align: "left" });
          doc.text("Bruce Gillingham Pollard — Confidential", leftM + 130, 776, { width: 220, align: "center" });
          doc.text(`Page ${i - range.start + 1} of ${totalPages}`, rightEdge - 80, 776, { width: 80, align: "right" });
        }

        doc.end();
        await new Promise<void>((resolve) => doc.on("end", resolve));
        const buffer = Buffer.concat(chunks);
        const filename = `${docTitle.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(buffer);
      }

      if (format === "pptx") {
        const PptxGenJS = (await import("pptxgenjs")).default;
        const pptx = new PptxGenJS();
        pptx.author = "Bruce Gillingham Pollard";
        pptx.title = docTitle;
        pptx.layout = "LAYOUT_WIDE";

        const brandDark = "232323";
        const brandGreen = "2E5E3F";
        const brandDarkGreen = "1A3A28";
        const brandGold = "C4A35A";
        const brandPanel = "E7E5DF";
        const brandMid = "596264";
        const brandLight = "DDDFE0";
        const brandFont = "Calibri";
        const brandFontAlt = "Arial";

        const whiteLogoPath = path.join(process.cwd(), "server", "assets", "branding", "BGP_WhiteWordmark_trimmed.png");
        const blackLogoPath = path.join(process.cwd(), "server", "assets", "branding", "BGP_BlackWordmark_trimmed.png");
        const whiteLogoExists = fs.existsSync(whiteLogoPath);
        const blackLogoExists = fs.existsSync(blackLogoPath);

        const decorBars = (color: string) => [
          { rect: { x: 11.7, y: 1.08, w: 1.47, h: 0.31, fill: { color } } },
          { rect: { x: 11.7, y: 0.31, w: 1.1, h: 0.31, fill: { color } } },
          { rect: { x: 10.2, y: 0.69, w: 1.97, h: 0.31, fill: { color } } },
        ];

        // BGP green header bar on all slide masters
        const greenHeaderBar = { rect: { x: 0, y: 0, w: 13.34, h: 0.12, fill: { color: brandGreen } } };

        // Slide number placeholder for content/section slides
        const slideNumObj = { text: { text: "SLIDE {slideNumber}", options: { x: 12.0, y: 7.2, w: 1.2, h: 0.28, fontSize: 8, color: "999999", fontFace: brandFont, align: "right" as const } } };

        pptx.defineSlideMaster({
          title: "BGP_COVER",
          background: { color: brandDark },
          objects: [
            greenHeaderBar,
            ...decorBars("FFFFFF"),
          ],
        });

        pptx.defineSlideMaster({
          title: "BGP_SECTION",
          background: { color: brandDark },
          objects: [
            greenHeaderBar,
            ...decorBars("FFFFFF"),
            slideNumObj,
          ],
        });

        pptx.defineSlideMaster({
          title: "BGP_CONTENT",
          background: { color: "FFFFFF" },
          objects: [
            greenHeaderBar,
            ...decorBars(brandPanel),
            slideNumObj,
          ],
        });

        pptx.defineSlideMaster({
          title: "BGP_QUOTE",
          background: { color: brandPanel },
          objects: [
            greenHeaderBar,
            slideNumObj,
          ],
        });

        pptx.defineSlideMaster({
          title: "BGP_END",
          background: { color: brandDark },
          objects: [
            greenHeaderBar,
            ...decorBars("FFFFFF"),
          ],
        });

        // Title slide
        const titleSlide = pptx.addSlide({ masterName: "BGP_COVER" });
        if (whiteLogoExists) {
          titleSlide.addImage({ path: whiteLogoPath, x: 10.4, y: 0.87, w: 2.95, h: 1.04 });
        }
        // Green accent line above title
        titleSlide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 5.2, w: 2.0, h: 0.04, fill: { color: brandGreen } });
        titleSlide.addText(docTitle, {
          x: 0.6, y: 5.4, w: 7.5, h: 1.4,
          fontSize: 50, color: "FFFFFF", fontFace: brandFont, bold: false, valign: "bottom",
        });
        titleSlide.addText(
          `PREPARED FOR CLIENT, ${new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase()}`,
          { x: 0.6, y: 7.2, w: 7.5, h: 0.44, fontSize: 20, color: "FFFFFF", fontFace: brandFont, bold: false, letterSpacing: 2 }
        );
        // Slide number not shown on cover
        titleSlide.addText(
          new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
          { x: 0.6, y: 7.0, w: 4.0, h: 0.24, fontSize: 10, color: brandMid, fontFace: brandFont }
        );

        // ── Two-pass PPTX generation ─────────────────────────────────────────
        // Pass 1: Ask Opus to produce a structured slide plan (JSON).
        // Pass 2: Render each slide type using pptxgenjs primitives.
        // If Pass 1 fails we fall back to the markdown→slides approach.
        // ─────────────────────────────────────────────────────────────────────
        console.log("[doc-studio] Building slide plan with Opus…");
        const slidePlan = await buildSlidePlan(cleaned, docTitle, documentType);

        if (slidePlan && slidePlan.length > 0) {
          console.log(`[doc-studio] Slide plan ready: ${slidePlan.length} slides`);
          // Render from slide plan — skip the cover slide (already rendered above)
          for (const s of slidePlan) {
            if (s.type === "cover") continue; // already rendered
            if (s.type === "end") continue;   // rendered below

            if (s.type === "section") {
              const secSlide = pptx.addSlide({ masterName: "BGP_SECTION" });
              secSlide.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.8, w: 1.5, h: 0.04, fill: { color: brandGreen } });
              secSlide.addText(String(s.title || "").toUpperCase(), {
                x: 0.9, y: 3.0, w: 11.5, h: 2.0,
                fontSize: 44, color: "FFFFFF", fontFace: brandFont, bold: false, valign: "top",
              });

            } else if (s.type === "content" || s.type === "twocol") {
              const slide = pptx.addSlide({ masterName: "BGP_CONTENT" });
              // Section label — small caps above the heading
              if (s.sectionLabel) {
                slide.addText(String(s.sectionLabel).toUpperCase(), {
                  x: 0.5, y: 0.18, w: 12.0, h: 0.32,
                  fontSize: 9, color: brandMid, fontFace: brandFont, bold: false, letterSpacing: 2,
                });
              }
              // Heading
              if (s.heading) {
                slide.addText(String(s.heading), {
                  x: 0.5, y: 0.55, w: 12.0, h: 0.6,
                  fontSize: 26, color: brandDarkGreen, fontFace: brandFont, bold: true,
                });
              }
              // Green divider line under heading
              slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.22, w: 12.34, h: 0.03, fill: { color: brandLight } });

              if (s.type === "twocol") {
                // Two-column layout
                const left = Array.isArray(s.leftBullets) ? s.leftBullets : [];
                const right = Array.isArray(s.rightBullets) ? s.rightBullets : [];
                const leftParts = left.map((b: string) => ({ text: `\u2014  ${b}\n`, options: { fontSize: 14, color: brandDark, fontFace: brandFont } }));
                const rightParts = right.map((b: string) => ({ text: `\u2014  ${b}\n`, options: { fontSize: 14, color: brandDark, fontFace: brandFont } }));
                if (leftParts.length) slide.addText(leftParts, { x: 0.5, y: 1.4, w: 6.0, h: 5.5, valign: "top", paraSpaceAfter: 8 });
                if (rightParts.length) slide.addText(rightParts, { x: 6.8, y: 1.4, w: 6.0, h: 5.5, valign: "top", paraSpaceAfter: 8 });
              } else {
                // Single-column bullets
                const bullets = Array.isArray(s.bullets) ? s.bullets : [];
                const parts = bullets.map((b: string) => ({
                  text: `\u2014  ${b}\n`,
                  options: { fontSize: 16, color: brandDark, fontFace: brandFont, paraSpaceAfter: 10 },
                }));
                if (parts.length) {
                  slide.addText(parts, { x: 0.5, y: 1.4, w: 12.34, h: 5.4, valign: "top" });
                }
              }

            } else if (s.type === "stat") {
              const slide = pptx.addSlide({ masterName: "BGP_CONTENT" });
              if (s.sectionLabel) {
                slide.addText(String(s.sectionLabel).toUpperCase(), {
                  x: 0.5, y: 0.18, w: 12.0, h: 0.32,
                  fontSize: 9, color: brandMid, fontFace: brandFont, bold: false, letterSpacing: 2,
                });
              }
              if (s.heading) {
                slide.addText(String(s.heading), {
                  x: 0.5, y: 0.55, w: 12.0, h: 0.6,
                  fontSize: 26, color: brandDarkGreen, fontFace: brandFont, bold: true,
                });
              }
              slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.22, w: 12.34, h: 0.03, fill: { color: brandLight } });
              // Stat boxes — up to 4 across the slide
              const stats = Array.isArray(s.stats) ? s.stats.slice(0, 4) : [];
              const boxW = stats.length <= 2 ? 5.5 : stats.length === 3 ? 3.8 : 2.9;
              const startX = stats.length <= 2 ? 1.0 : 0.5;
              stats.forEach((stat: any, idx: number) => {
                const x = startX + idx * (boxW + 0.3);
                slide.addShape(pptx.ShapeType.rect, { x, y: 2.2, w: boxW, h: 3.2, fill: { color: "F5F4F0" } });
                slide.addText(String(stat.value || ""), {
                  x, y: 2.5, w: boxW, h: 1.6,
                  fontSize: 48, color: brandGreen, fontFace: brandFont, bold: true, align: "center",
                });
                slide.addText(String(stat.label || "").toUpperCase(), {
                  x, y: 4.3, w: boxW, h: 0.6,
                  fontSize: 11, color: brandMid, fontFace: brandFont, bold: false, align: "center", letterSpacing: 1,
                });
              });

            } else if (s.type === "quote") {
              const quoteSlide = pptx.addSlide({ masterName: "BGP_QUOTE" });
              quoteSlide.addText("\u201C", {
                x: 0.6, y: 1.2, w: 1.0, h: 1.0,
                fontSize: 100, color: brandGreen, fontFace: brandFont, bold: true,
              });
              quoteSlide.addText(String(s.text || ""), {
                x: 1.0, y: 2.0, w: 11.0, h: 3.5,
                fontSize: 36, color: brandDark, fontFace: brandFont, bold: false, italic: true, valign: "middle",
              });
              if (s.attribution) {
                quoteSlide.addShape(pptx.ShapeType.rect, { x: 1.0, y: 5.7, w: 1.5, h: 0.04, fill: { color: brandGreen } });
                quoteSlide.addText(String(s.attribution).toUpperCase(), {
                  x: 1.0, y: 5.9, w: 11.0, h: 0.4,
                  fontSize: 11, color: brandMid, fontFace: brandFont, bold: false, letterSpacing: 2,
                });
              }
            }
          }

        } else {
          // ── Markdown fallback (original loop) ────────────────────────────────
          console.log("[doc-studio] Using markdown fallback for slides");
          const contentGroups: { heading: string; lines: string[]; isQuote: boolean }[] = [];
          let currentHeading = "";
          let currentLines: string[] = [];
          let currentIsQuote = false;

          for (const line of lines) {
            const trimmed = line.trim();
            const lt = classifyLine(trimmed);
            if (lt === "heading" && currentLines.length > 0) {
              contentGroups.push({ heading: currentHeading, lines: [...currentLines], isQuote: currentIsQuote });
              currentLines = [];
              currentIsQuote = false;
            }
            if (lt === "heading") {
              currentHeading = stripMd(trimmed);
            } else {
              if (lt === "blockquote") currentIsQuote = true;
              currentLines.push(line);
            }
          }
          if (currentLines.length > 0 || currentHeading) {
            contentGroups.push({ heading: currentHeading, lines: [...currentLines], isQuote: currentIsQuote });
          }

          let sectionIdx = 0;
          for (const group of contentGroups) {
            if (group.lines.every(l => !l.trim()) && !group.heading) continue;
            sectionIdx++;
            if (group.heading && sectionIdx > 1) {
              const secSlide = pptx.addSlide({ masterName: "BGP_SECTION" });
              secSlide.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.8, w: 1.5, h: 0.04, fill: { color: brandGreen } });
              secSlide.addText(group.heading.toUpperCase(), {
                x: 0.9, y: 3.0, w: 11.5, h: 2.0,
                fontSize: 44, color: "FFFFFF", fontFace: brandFont, bold: false, valign: "top",
              });
            }
            if (group.isQuote && group.lines.length <= 4) {
              const quoteSlide = pptx.addSlide({ masterName: "BGP_QUOTE" });
              const quoteText = group.lines.map(l => stripMd(l.trim().replace(/^>\s*/, ""))).filter(l => l).join(" ");
              quoteSlide.addText("\u201C", { x: 1.5, y: 1.5, w: 1.0, h: 1.0, fontSize: 80, color: brandGreen, fontFace: brandFont, bold: true });
              quoteSlide.addText(quoteText, { x: 2.5, y: 2.5, w: 8.5, h: 2.5, fontSize: 36, color: brandDark, fontFace: brandFont, italic: true, align: "center", valign: "middle" });
              continue;
            }
            const slideLines = [...group.lines];
            while (slideLines.length > 0) {
              const batch = slideLines.splice(0, 10);
              if (batch.every(l => !l.trim())) continue;
              const slide = pptx.addSlide({ masterName: "BGP_CONTENT" });
              if (group.heading) {
                slide.addText(group.heading.toUpperCase(), { x: 0.5, y: 0.18, w: 12.0, h: 0.32, fontSize: 9, color: brandMid, fontFace: brandFont, letterSpacing: 2 });
              }
              const textParts: any[] = [];
              for (const line of batch) {
                const trimmed = line.trim();
                const lt = classifyLine(trimmed);
                const plain = stripMd(trimmed);
                if (lt === "blank") { textParts.push({ text: "\n", options: { fontSize: 5 } }); continue; }
                if (lt === "hr") continue;
                if (lt === "heading") {
                  textParts.push({ text: plain + "\n", options: { fontSize: 22, bold: true, color: brandDarkGreen, fontFace: brandFont } });
                } else if (lt === "bullet") {
                  textParts.push({ text: `\u2014  ${stripMd(plain.replace(/^[-\u2022*]\s*/, ""))}\n`, options: { fontSize: 16, color: brandDark, fontFace: brandFont } });
                } else if (lt === "blockquote") {
                  textParts.push({ text: `\u201C${stripMd(trimmed.replace(/^>\s*/, ""))}\u201D\n`, options: { fontSize: 16, italic: true, color: brandMid, fontFace: brandFont } });
                } else {
                  textParts.push({ text: plain + "\n", options: { fontSize: 16, color: brandDark, fontFace: brandFont } });
                }
              }
              if (textParts.length > 0) {
                slide.addText(textParts, { x: 0.5, y: 0.6, w: 12.34, h: 6.3, valign: "top", paraSpaceAfter: 8 });
              }
            }
          }
        }

        const endSlide = pptx.addSlide({ masterName: "BGP_END" });
        if (whiteLogoExists) {
          endSlide.addImage({ path: whiteLogoPath, x: 10.4, y: 0.87, w: 2.95, h: 1.04 });
        }
        // Green accent line
        endSlide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.2, w: 2.0, h: 0.04, fill: { color: brandGreen } });
        endSlide.addText("Thank you", {
          x: 0.6, y: 4.5, w: 8.0, h: 1.4,
          fontSize: 66, color: "FFFFFF", fontFace: brandFont, bold: false,
        });
        endSlide.addText(
          "If you wish to discuss this further\nplease contact us at brucegillinghampollard.com",
          { x: 0.6, y: 6.2, w: 10.0, h: 1.5, fontSize: 32, color: "FFFFFF", fontFace: brandFont, bold: false }
        );

        const pptxBuffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
        const filename = `${docTitle.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_")}.pptx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(pptxBuffer);
      }

      return res.status(400).json({ message: "Unsupported format. Use: docx, pdf, or pptx" });
    } catch (err: any) {
      console.error("[doc-export]", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to export document" });
    }
  });

  app.patch("/api/doc-runs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, content, status, design } = req.body;
      if (name !== undefined && (typeof name !== "string" || name.length > 500)) {
        return res.status(400).json({ message: "Invalid name (max 500 chars)" });
      }
      if (content !== undefined && (typeof content !== "string" || content.length > 500000)) {
        return res.status(400).json({ message: "Invalid content (max 500,000 chars)" });
      }
      if (status !== undefined && !["completed", "draft", "archived"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      if (design !== undefined && typeof design !== "string") {
        return res.status(400).json({ message: "Invalid design" });
      }
      const updated = await storage.updateDocumentRun(req.params.id, { name, content, status, design });
      if (!updated) return res.status(404).json({ message: "Document run not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update document run" });
    }
  });

  app.post("/api/doc-runs/:id/refine", requireAuth, async (req: Request, res: Response) => {
    try {
      const { message, history } = req.body;
      if (!message || typeof message !== "string" || message.length > 5000) {
        return res.status(400).json({ message: "A valid message is required (max 5,000 chars)" });
      }
      const run = await storage.getDocumentRun(req.params.id);
      if (!run) return res.status(404).json({ message: "Document run not found" });

      const systemPrompt = `You are refining a BGP (Bruce Gillingham Pollard) professional property document.
You are a senior property advisor and document specialist. Make precise, high-quality edits as requested.

RULES:
- Return the COMPLETE updated document — every section, not just the changed parts
- Preserve all existing structure and formatting (headings, bullets, tables)
- Match the professional BGP tone: precise, confident, no filler words
- Keep markdown formatting (# headings, ## subheadings, **bold**, bullet points)
- Only change what the user asked for — don't add unsolicited content
- Document type: ${(run as any).document_type || "General"}`;

      const messages: any[] = [{ role: "system", content: systemPrompt }];

      // Include recent conversation history for context (up to 8 previous turns)
      if (Array.isArray(history)) {
        for (const h of history.slice(-8)) {
          if (h.role === "user" || h.role === "assistant") {
            messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
          }
        }
      }

      messages.push({
        role: "user",
        content: `Here is the current document:\n\n${(run as any).content}\n\n---\n\nPlease make this change: ${message}`,
      });

      const completion = await callDocOpus({ messages, max_completion_tokens: 16384, temperature: 0.2 });
      const newContent = completion.choices[0]?.message?.content;
      if (!newContent) return res.status(500).json({ message: "No content returned from AI" });

      await storage.updateDocumentRun(req.params.id, { content: newContent });
      res.json({ content: newContent });
    } catch (err: any) {
      console.error("[doc-refine]", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to refine document" });
    }
  });

  app.delete("/api/doc-runs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.deleteDocumentRun(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete document run" });
    }
  });

  const COMP_PDF_TEMPLATE_KEY = "comp_pdf_template";
  const LEASE_ADVISORY_TEAMS = ["lease advisory", "london leasing", "national leasing"];

  const DEFAULT_COMP_PDF_TEMPLATE = {
    headerTitle: "BRUCE GILLINGHAM POLLARD",
    headerSubtitle: "Comparable Evidence Schedule",
    footerText: "Bruce Gillingham Pollard | Confidential | brucegillinghampollard.com",
    brandColor: [25, 25, 25],
    accentColor: [0, 82, 136],
    showLogo: true,
    showDate: true,
    showCount: true,
    fields: [
      { key: "tenant", label: "Tenant", enabled: true },
      { key: "landlord", label: "Landlord", enabled: true },
      { key: "areaLocation", label: "Area", enabled: true },
      { key: "headlineRent", label: "Headline Rent", enabled: true },
      { key: "zoneARate", label: "Zone A (psf)", enabled: true },
      { key: "overallRate", label: "Overall (psf)", enabled: true },
      { key: "netEffectiveRent", label: "Net Effective", enabled: true },
      { key: "passingRent", label: "Passing Rent", enabled: true },
      { key: "niaSqft", label: "NIA (sq ft)", enabled: true },
      { key: "itzaSqft", label: "ITZA (sq ft)", enabled: true },
      { key: "term", label: "Term", enabled: true },
      { key: "rentFree", label: "Rent Free", enabled: true },
      { key: "breakClause", label: "Break", enabled: true },
      { key: "ltActStatus", label: "L&T Act", enabled: true },
      { key: "fitoutContribution", label: "Fitout Contrib.", enabled: true },
      { key: "sourceEvidence", label: "Source", enabled: true },
    ],
    showBadges: true,
    showNotes: true,
    showAttachedFiles: true,
    columns: 4,
    lastUpdatedBy: null as string | null,
    lastUpdatedAt: null as string | null,
  };

  app.get("/api/comp-pdf-template", requireAuth, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT value FROM system_settings WHERE key = $1`,
        [COMP_PDF_TEMPLATE_KEY]
      );
      if (result.rows.length > 0 && result.rows[0].value) {
        res.json({ ...DEFAULT_COMP_PDF_TEMPLATE, ...result.rows[0].value });
      } else {
        res.json(DEFAULT_COMP_PDF_TEMPLATE);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/comp-pdf-template", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const userResult = await pool.query(`SELECT name, team, is_admin FROM users WHERE id = $1`, [userId]);
      if (userResult.rows.length === 0) return res.status(404).json({ message: "User not found" });

      const user = userResult.rows[0];
      const userTeam = (user.team || "").toLowerCase();
      const canEdit = user.is_admin || LEASE_ADVISORY_TEAMS.includes(userTeam);

      if (!canEdit) {
        return res.status(403).json({ message: "Only Lease Advisory team members and admins can edit this template" });
      }

      const body = req.body;
      if (typeof body.headerTitle !== "string" || typeof body.headerSubtitle !== "string" || typeof body.footerText !== "string") {
        return res.status(400).json({ message: "headerTitle, headerSubtitle, and footerText must be strings" });
      }
      if (!Array.isArray(body.brandColor) || body.brandColor.length !== 3 || !body.brandColor.every((c: any) => typeof c === "number" && c >= 0 && c <= 255)) {
        return res.status(400).json({ message: "brandColor must be an array of 3 numbers (0-255)" });
      }
      if (!Array.isArray(body.accentColor) || body.accentColor.length !== 3 || !body.accentColor.every((c: any) => typeof c === "number" && c >= 0 && c <= 255)) {
        return res.status(400).json({ message: "accentColor must be an array of 3 numbers (0-255)" });
      }
      if (!Array.isArray(body.fields) || !body.fields.every((f: any) => typeof f.key === "string" && typeof f.label === "string" && typeof f.enabled === "boolean")) {
        return res.status(400).json({ message: "fields must be an array of { key, label, enabled }" });
      }
      const columns = Number(body.columns);
      if (isNaN(columns) || columns < 1 || columns > 8) {
        return res.status(400).json({ message: "columns must be between 1 and 8" });
      }

      const template = {
        headerTitle: String(body.headerTitle).slice(0, 200),
        headerSubtitle: String(body.headerSubtitle).slice(0, 200),
        footerText: String(body.footerText).slice(0, 300),
        brandColor: body.brandColor.map((c: number) => Math.round(c)),
        accentColor: body.accentColor.map((c: number) => Math.round(c)),
        showLogo: !!body.showLogo,
        showDate: !!body.showDate,
        showCount: !!body.showCount,
        showBadges: !!body.showBadges,
        showNotes: !!body.showNotes,
        showAttachedFiles: !!body.showAttachedFiles,
        columns,
        fields: body.fields.slice(0, 30).map((f: any) => ({
          key: String(f.key).slice(0, 50),
          label: String(f.label).slice(0, 50),
          enabled: !!f.enabled,
        })),
        lastUpdatedBy: user.name || "Unknown",
        lastUpdatedAt: new Date().toISOString(),
      };

      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [COMP_PDF_TEMPLATE_KEY, JSON.stringify(template)]
      );

      res.json(template);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Investment-comps PDF template — parallel to the leasing template above but
  // with investment-specific default fields. Editable by admins + Investment team.
  const INVESTMENT_COMP_PDF_TEMPLATE_KEY = "investment_comp_pdf_template";
  const INVESTMENT_TEAMS = ["investment"];

  const DEFAULT_INVESTMENT_COMP_PDF_TEMPLATE = {
    headerTitle: "BRUCE GILLINGHAM POLLARD",
    headerSubtitle: "Investment Comparable Transactions",
    footerText: "Bruce Gillingham Pollard | Confidential | brucegillinghampollard.com",
    brandColor: [25, 25, 25],
    accentColor: [0, 82, 136],
    showLogo: true,
    showDate: true,
    showCount: true,
    fields: [
      { key: "address", label: "Address", enabled: true },
      { key: "city", label: "City", enabled: true },
      { key: "market", label: "Market", enabled: true },
      { key: "transactionDate", label: "Date", enabled: true },
      { key: "price", label: "Price", enabled: true },
      { key: "pricePsf", label: "Price £/sf", enabled: true },
      { key: "capRate", label: "Cap Rate", enabled: true },
      { key: "areaSqft", label: "Area (sqft)", enabled: true },
      { key: "yearBuilt", label: "Year Built", enabled: true },
      { key: "occupancy", label: "Occupancy", enabled: true },
      { key: "buyer", label: "Buyer", enabled: true },
      { key: "seller", label: "Seller", enabled: true },
      { key: "buyerBroker", label: "Buyer Broker", enabled: false },
      { key: "sellerBroker", label: "Seller Broker", enabled: false },
      { key: "lender", label: "Lender", enabled: false },
      { key: "pricePerUnit", label: "£/Unit", enabled: false },
    ],
    showBadges: true,
    showNotes: true,
    showAttachedFiles: false,
    columns: 4,
    lastUpdatedBy: null as string | null,
    lastUpdatedAt: null as string | null,
  };

  app.get("/api/investment-comp-pdf-template", requireAuth, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT value FROM system_settings WHERE key = $1`,
        [INVESTMENT_COMP_PDF_TEMPLATE_KEY]
      );
      if (result.rows.length > 0 && result.rows[0].value) {
        res.json({ ...DEFAULT_INVESTMENT_COMP_PDF_TEMPLATE, ...result.rows[0].value });
      } else {
        res.json(DEFAULT_INVESTMENT_COMP_PDF_TEMPLATE);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/investment-comp-pdf-template", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const userResult = await pool.query(`SELECT name, team, is_admin FROM users WHERE id = $1`, [userId]);
      if (userResult.rows.length === 0) return res.status(404).json({ message: "User not found" });

      const user = userResult.rows[0];
      const userTeam = (user.team || "").toLowerCase();
      const canEdit = user.is_admin || INVESTMENT_TEAMS.includes(userTeam);

      if (!canEdit) {
        return res.status(403).json({ message: "Only Investment team members and admins can edit this template" });
      }

      const body = req.body;
      if (typeof body.headerTitle !== "string" || typeof body.headerSubtitle !== "string" || typeof body.footerText !== "string") {
        return res.status(400).json({ message: "headerTitle, headerSubtitle, and footerText must be strings" });
      }
      if (!Array.isArray(body.brandColor) || body.brandColor.length !== 3 || !body.brandColor.every((c: any) => typeof c === "number" && c >= 0 && c <= 255)) {
        return res.status(400).json({ message: "brandColor must be an array of 3 numbers (0-255)" });
      }
      if (!Array.isArray(body.accentColor) || body.accentColor.length !== 3 || !body.accentColor.every((c: any) => typeof c === "number" && c >= 0 && c <= 255)) {
        return res.status(400).json({ message: "accentColor must be an array of 3 numbers (0-255)" });
      }
      if (!Array.isArray(body.fields) || !body.fields.every((f: any) => typeof f.key === "string" && typeof f.label === "string" && typeof f.enabled === "boolean")) {
        return res.status(400).json({ message: "fields must be an array of { key, label, enabled }" });
      }
      const columns = Number(body.columns);
      if (isNaN(columns) || columns < 1 || columns > 8) {
        return res.status(400).json({ message: "columns must be between 1 and 8" });
      }

      const template = {
        headerTitle: String(body.headerTitle).slice(0, 200),
        headerSubtitle: String(body.headerSubtitle).slice(0, 200),
        footerText: String(body.footerText).slice(0, 300),
        brandColor: body.brandColor.map((c: number) => Math.round(c)),
        accentColor: body.accentColor.map((c: number) => Math.round(c)),
        showLogo: !!body.showLogo,
        showDate: !!body.showDate,
        showCount: !!body.showCount,
        showBadges: !!body.showBadges,
        showNotes: !!body.showNotes,
        showAttachedFiles: !!body.showAttachedFiles,
        columns,
        fields: body.fields.slice(0, 30).map((f: any) => ({
          key: String(f.key).slice(0, 50),
          label: String(f.label).slice(0, 50),
          enabled: !!f.enabled,
        })),
        lastUpdatedBy: user.name || "Unknown",
        lastUpdatedAt: new Date().toISOString(),
      };

      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [INVESTMENT_COMP_PDF_TEMPLATE_KEY, JSON.stringify(template)]
      );

      res.json(template);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
