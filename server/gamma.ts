// Minimal Gamma REST API wrapper.
//
// Docs: https://developers.gamma.app/llms-full.txt
// Endpoints used:
//   POST /v1.0/generations         — kick off a generation from text
//   GET  /v1.0/generations/{id}    — poll status; returns gammaUrl + exportUrl
//
// Requires GAMMA_API_KEY (Pro/Ultra/Teams/Business plans).

const GAMMA_BASE = "https://public-api.gamma.app/v1.0";

export type GammaFormat = "presentation" | "document" | "social" | "webpage";
export type GammaExportAs = "pdf" | "pptx";

export interface GammaGenerateArgs {
  inputText: string;                    // up to 400K chars; markdown headings auto-card
  format?: GammaFormat;                 // default: "document"
  exportAs?: GammaExportAs;             // default: "pdf"
  numCards?: number;                    // let Gamma decide if undefined
  themeName?: string;                   // see GET /themes
  textMode?: "generate" | "condense" | "preserve";
  additionalInstructions?: string;      // brand/tone steer
  imageOptions?: {
    source?: "aiGenerated" | "pictographic" | "unsplash" | "noImages";
    // See error response for the canonical list. Defaults used: imagen-3-pro.
    imageModel?:
      | "dall-e-3"
      | "imagen-3-flash" | "imagen-3-pro"
      | "imagen-4-pro" | "imagen-4-ultra"
      | "ideogram-v3" | "ideogram-v3-turbo" | "ideogram-v3-quality" | "ideogram-v3-flash"
      | "flux-1-pro" | "flux-1-quick" | "flux-1-ultra"
      | "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-fast"
      | "leonardo-phoenix" | string;
  };
  cardOptions?: {
    dimensions?: "default" | "fluid" | "a4" | "letter" | "16x9" | "4x3";
  };
}

export interface GammaGeneration {
  generationId: string;
  status?: "pending" | "completed" | "failed";
  gammaUrl?: string;
  exportUrl?: string;                   // signed URL to the PDF/PPTX
  credits?: { deducted?: number };
}

function apiKey(): string {
  const k = process.env.GAMMA_API_KEY;
  if (!k) throw new Error("GAMMA_API_KEY not configured");
  return k;
}

export async function gammaGenerate(args: GammaGenerateArgs): Promise<{ generationId: string }> {
  const body: any = {
    inputText: args.inputText,
    format: args.format || "document",
    exportAs: args.exportAs || "pdf",
  };
  if (args.numCards) body.numCards = args.numCards;
  if (args.themeName) body.themeName = args.themeName;
  if (args.textMode) body.textMode = args.textMode;
  if (args.additionalInstructions) body.additionalInstructions = args.additionalInstructions;
  if (args.imageOptions) {
    // Gamma's Generate API rejects `imageModel` inside imageOptions ("property
    // imageModel should not exist"). Strip it defensively so old callers don't
    // break until they're updated.
    const { imageModel: _drop, ...safe } = args.imageOptions as any;
    if (Object.keys(safe).length) body.imageOptions = safe;
  }
  if (args.cardOptions) body.cardOptions = args.cardOptions;

  const res = await fetch(`${GAMMA_BASE}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gamma generate failed: ${res.status} ${text.slice(0, 400)}`);
  }
  const data = await res.json() as { generationId?: string };
  if (!data.generationId) throw new Error("Gamma response missing generationId");
  return { generationId: data.generationId };
}

export async function gammaGetGeneration(id: string): Promise<GammaGeneration> {
  const res = await fetch(`${GAMMA_BASE}/generations/${encodeURIComponent(id)}`, {
    headers: { "X-API-KEY": apiKey() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gamma poll failed: ${res.status} ${text.slice(0, 400)}`);
  }
  return await res.json() as GammaGeneration;
}

/** Poll until completed/failed or timeout (default 4 min). */
export async function gammaWaitFor(id: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<GammaGeneration> {
  const interval = opts.intervalMs ?? 4000;
  const deadline = Date.now() + (opts.timeoutMs ?? 4 * 60 * 1000);
  while (Date.now() < deadline) {
    const g = await gammaGetGeneration(id);
    if (g.status === "completed") return g;
    if (g.status === "failed") throw new Error(`Gamma generation failed (id ${id})`);
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Gamma generation timed out (id ${id})`);
}

export async function gammaDownloadExport(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Export download failed: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
