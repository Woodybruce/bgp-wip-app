import DocumentIntelligence, {
  isUnexpected,
  getLongRunningPoller,
  type AnalyzeOperationOutput,
} from "@azure-rest/ai-document-intelligence";

const OCR_MIN_INTERVAL_MS = 500;
let lastOcrCallAt = 0;

let cachedClient: ReturnType<typeof DocumentIntelligence> | null = null;

function getClient() {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) return null;
  if (!cachedClient) cachedClient = DocumentIntelligence(endpoint, { key });
  return cachedClient;
}

export function isOcrConfigured(): boolean {
  return !!(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY);
}

export async function ocrPdfBuffer(buffer: Buffer, fileName: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const waitMs = OCR_MIN_INTERVAL_MS - (Date.now() - lastOcrCallAt);
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
  lastOcrCallAt = Date.now();

  try {
    const base64Source = buffer.toString("base64");
    const initial = await client
      .path("/documentModels/{modelId}:analyze", "prebuilt-read")
      .post({
        contentType: "application/json",
        body: { base64Source },
      });

    if (isUnexpected(initial)) {
      console.error(`[ocr] ${fileName}: Azure returned ${initial.status} — ${JSON.stringify(initial.body?.error || {}).slice(0, 300)}`);
      return null;
    }

    const poller = getLongRunningPoller(client, initial);
    const result = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;
    const analyze = result.analyzeResult;
    if (!analyze) return null;

    if (typeof analyze.content === "string" && analyze.content.trim().length > 0) {
      return analyze.content;
    }

    const pages = analyze.pages || [];
    const pageText = pages
      .map(p => (p.lines || []).map(l => l.content).filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n\n");
    return pageText || null;
  } catch (err: any) {
    console.error(`[ocr] ${fileName}: exception — ${err?.message || err}`);
    return null;
  }
}
