// Signed, no-auth download links for generated files.
//
// The chat-media route is session-gated, so a bare /api/chat-media/<file> link
// 401s when tapped on a phone or opened from email. A signed `?dl=` token lets
// the route serve that one file without a session: it's an HMAC over the
// filename + expiry, so it can't be guessed or reused for another file, and it
// expires. Convenience for sharing a single generated deliverable — same trust
// model as emailing the file itself.
import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "bgp-dev-fallback-secret";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function signDownloadToken(filename: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac("sha256", SECRET).update(`${filename}.${exp}`).digest("base64url");
  return Buffer.from(`${exp}.${sig}`).toString("base64url");
}

export function verifyDownloadToken(filename: string, token: string): boolean {
  try {
    const [expStr, sig] = Buffer.from(token, "base64url").toString().split(".");
    const exp = parseInt(expStr, 10);
    if (!exp || Date.now() > exp || !sig) return false;
    const expected = crypto.createHmac("sha256", SECRET).update(`${filename}.${exp}`).digest("base64url");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Build an absolute, tappable, no-auth download URL for a chat-media file.
export function publicDownloadUrl(req: { headers: Record<string, any>; protocol?: string; get?: (h: string) => string | undefined }, filename: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.get ? req.get("host") : req.headers["host"]) || "";
  return `${proto}://${host}/api/chat-media/${filename}?dl=${signDownloadToken(filename)}`;
}
