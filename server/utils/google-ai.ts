// Gemini direct client for document analysis and other tasks
import { isLandsecLocked } from "./ai-provider";
export function getGeminiClient() {
  // Landsec AI lock: Gemini reads as not configured inside it.
  if (isLandsecLocked()) return null;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

export async function callGemini(params: { model?: string; prompt: string; maxTokens?: number }): Promise<string | null> {
  if (isLandsecLocked()) return null;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: params.model || "gemini-2.5-flash",
      contents: params.prompt,
    });
    return response.text || null;
  } catch (e: any) {
    console.warn("[gemini] Call failed:", e.message);
    return null;
  }
}
