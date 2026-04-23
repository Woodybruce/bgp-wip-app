/**
 * Webshare residential proxy fetch (undici ProxyAgent).
 *
 * Used as Tier 2 when direct fetch is TCP-blocked by a council's
 * firewall (Westminster, RBKC etc block Railway's egress IP).
 *
 * Env vars (set in Railway):
 *   WEBSHARE_PROXY_USERNAME
 *   WEBSHARE_PROXY_PASSWORD
 *   WEBSHARE_PROXY_ENDPOINT  (default: p.webshare.io:80)
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";

let _agent: ProxyAgent | null = null;
let _built = false;

function getAgent(): ProxyAgent | null {
  if (_built) return _agent;
  _built = true;
  const user = process.env.WEBSHARE_PROXY_USERNAME;
  const pass = process.env.WEBSHARE_PROXY_PASSWORD;
  const endpoint = process.env.WEBSHARE_PROXY_ENDPOINT || "p.webshare.io:80";
  if (!user || !pass) return null;
  _agent = new ProxyAgent(
    `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${endpoint}`,
  );
  return _agent;
}

export function isProxyConfigured(): boolean {
  return !!(process.env.WEBSHARE_PROXY_USERNAME && process.env.WEBSHARE_PROXY_PASSWORD);
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function webshareF(url: string, init: RequestInit = {}): Promise<Response> {
  const agent = getAgent();
  if (!agent) throw new Error("Webshare proxy not configured (WEBSHARE_PROXY_USERNAME/PASSWORD missing)");
  const res = await (undiciFetch as any)(url, {
    method: init.method || "GET",
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    redirect: init.redirect || "follow",
    dispatcher: agent,
  });
  return res as unknown as Response;
}

// Returns true for connection-level errors (TCP blocked / timed out / refused)
// that warrant escalating to the next tier.
export function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as any;
  const msg = (e.message || "").toLowerCase();
  const code = e.cause?.code || e.code || e.cause?.errno || "";
  if (/UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ETIMEDOUT|ECONNREFUSED|ECONNRESET/.test(code)) return true;
  if (/connect.?timeout|connection.?timeout|socket hang up|network error|econnrefused|etimedout/.test(msg)) return true;
  if (e.name === "TimeoutError") return true;
  return false;
}
