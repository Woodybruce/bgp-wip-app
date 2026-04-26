import type { Request } from "express";

/**
 * Ask ChatBGP a question programmatically and get back the final markdown
 * answer. Internally POSTs to the same `/api/chatbgp/chat` endpoint that
 * the browser chat panel uses (streaming SSE), forwards the caller's
 * session cookie so requireAuth passes, and parses the SSE stream to
 * assemble the final answer text.
 *
 * Why this exists: ChatBGP already has the right brain for things like
 * "find all the emails about this property" — it picks smart search terms
 * (tenant brand names, owner names, postcode), uses the full 70-tool
 * surface, and produces the analyst-quality grouped narrative we want.
 * Replicating that intelligence in a sidecar agent (the previous
 * email-investigator approach) keeps falling behind the real ChatBGP.
 * Better to call the real thing.
 *
 * Tradeoffs vs a sidecar agent:
 *   + Always matches ChatBGP's output quality — same prompt, same tools.
 *   + Picks up improvements when ChatBGP's prompt / tools change.
 *   - Higher latency / cost per call (full 70-tool surface, more turns).
 *   - Slightly fragile: depends on the SSE event shape ChatBGP emits.
 *
 * Usage from server-side code (e.g. Stage 1 of the property pathway):
 *   const md = await askChatBgp(
 *     "Pull all relevant emails for 18-22 Haymarket SW1Y 4DG. Group by phase, cite each email.",
 *     req
 *   );
 *
 * Returns null on any failure (auth, network, empty response). Never
 * throws — caller can fall through to whatever fallback they like.
 */
export async function askChatBgp(question: string, req: Request, opts?: { timeoutMs?: number }): Promise<string | null> {
  if (!question?.trim()) return null;

  const port = process.env.PORT || "5000";
  const url = `http://127.0.0.1:${port}/api/chatbgp/chat`;
  // Forward the original request's auth so requireAuth passes inside the
  // chat handler. Either the session cookie (browser flow) or the bearer
  // token (mobile / API flow) works; we forward whichever is present.
  const cookie = (req.headers?.cookie as string) || "";
  const auth = (req.headers?.authorization as string) || "";

  const timeoutMs = opts?.timeoutMs ?? 5 * 60 * 1000; // 5 min default
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: question }],
      }),
      signal: controller.signal,
    });

    if (!resp.ok || !resp.body) {
      console.warn(`[chatbgp-internal] HTTP ${resp.status} from /api/chatbgp/chat`);
      return null;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assembled = "";
    let sawAnyDelta = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Process complete lines; keep the trailing partial line in buffer.
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          // ChatBGP's chat endpoint emits { delta: "<token>" } for text
          // chunks, plus other event shapes (progress, tool_use, etc.).
          // We only care about the assembled markdown answer.
          if (typeof parsed.delta === "string") {
            assembled += parsed.delta;
            sawAnyDelta = true;
          }
        } catch {
          // Non-JSON SSE line — heartbeat or comment. Ignore.
        }
      }
    }

    const trimmed = assembled.trim();
    if (!trimmed) {
      console.warn(`[chatbgp-internal] empty response (sawAnyDelta=${sawAnyDelta})`);
      return null;
    }
    return trimmed;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.warn(`[chatbgp-internal] timed out after ${timeoutMs}ms`);
    } else {
      console.warn(`[chatbgp-internal] error: ${err?.message || "unknown"}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
