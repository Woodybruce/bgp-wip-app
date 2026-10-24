import dns from "node:dns/promises";
import net from "node:net";

// Server-side fetch of model- or user-supplied URLs. Blocks loopback,
// private, link-local and cloud-metadata targets (SSRF), follows redirects
// manually so every hop is re-validated and re-matched for subscriber
// cookies, and caps how much of a body may be buffered (zip bombs and
// multi-GB downloads otherwise OOM the whole app).

const MAX_REDIRECTS = 5;
export const MAX_INGEST_BYTES = 50 * 1024 * 1024;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 127 || a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127);
  }
  const low = ip.toLowerCase();
  if (low.startsWith("::ffff:")) return isPrivateIp(low.slice(7));
  return low === "::1" || low === "::"
    || low.startsWith("fc") || low.startsWith("fd")
    || low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb");
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing to fetch a ${url.protocol.replace(":", "")} URL`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`Refusing to fetch private address ${host}`);
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`Refusing to fetch internal hostname ${host}`);
  }
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve ${host}`);
  }
  for (const record of records) {
    if (isPrivateIp(record.address)) throw new Error(`Refusing to fetch ${host} — it resolves to a private address`);
  }
}

export async function safePublicFetch(
  rawUrl: string,
  init: RequestInit & { headersForUrl?: (url: string) => Record<string, string> } = {},
): Promise<globalThis.Response> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new Error("Not a valid URL");
  }
  const { headersForUrl, ...rest } = init;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current);
    const response = await fetch(current.toString(), {
      ...rest,
      headers: { ...(rest.headers as Record<string, string> | undefined), ...(headersForUrl ? headersForUrl(current.toString()) : {}) },
      redirect: "manual",
      signal: rest.signal ?? AbortSignal.timeout(60_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      try { await response.body?.cancel(); } catch {}
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}

export async function readBodyCapped(response: globalThis.Response, maxBytes = MAX_INGEST_BYTES): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) throw new Error(`Response too large (${Math.round(declared / 1048576)}MB; cap ${Math.round(maxBytes / 1048576)}MB)`);
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      throw new Error(`Response exceeded the ${Math.round(maxBytes / 1048576)}MB cap`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
