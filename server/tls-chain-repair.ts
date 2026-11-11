/**
 * Fetch that tolerates a server which sends only its own certificate and
 * not the intermediate that links it to a trusted root — publicaccess.
 * stroud.gov.uk does this (8 Nov 2026), and a browser hides the fault by
 * downloading the missing intermediate from the "CA Issuers" address inside
 * the certificate (RFC 5280 AIA). Node's fetch does not, so the site fails
 * with "unable to verify the first certificate" and ChatBGP reported
 * "Failed to fetch". This does what the browser does: on that one error,
 * read the server's leaf certificate, download the issuers it names, check
 * each really signed the one below it, and retry with those added to the
 * trust list. The chain is still fully verified; nothing is skipped.
 */

import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";

const CHAIN_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
]);
const MAX_CHAIN_HOPS = 4;
const RETRY_FAILED_AFTER_MS = 10 * 60 * 1000;

export function isIncompleteChainError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as any;
  const code = e.cause?.code || e.code || "";
  if (CHAIN_ERROR_CODES.has(code)) return true;
  const msg = String(e.cause?.message || e.message || "").toLowerCase();
  return msg.includes("unable to verify the first certificate") || msg.includes("unable to get local issuer certificate");
}

let _rootFingerprints: Set<string> | null = null;
function rootFingerprints(): Set<string> {
  if (_rootFingerprints) return _rootFingerprints;
  _rootFingerprints = new Set();
  for (const pem of tls.rootCertificates) {
    try { _rootFingerprints.add(new X509Certificate(pem).fingerprint256); } catch { /* skip unparseable */ }
  }
  return _rootFingerprints;
}

export function peerLeafCertificate(host: string, port = 443): Promise<X509Certificate | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (cert: X509Certificate | null) => { if (!settled) { settled = true; resolve(cert); } };
    try {
      const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
        const cert = socket.getPeerX509Certificate() ?? null;
        socket.destroy();
        done(cert);
      });
      socket.on("error", () => done(null));
      socket.on("timeout", () => { socket.destroy(); done(null); });
    } catch {
      done(null);
    }
  });
}

// Walk up from the leaf via each certificate's "CA Issuers" URL until the
// issuer is a root Node already trusts (or is self-signed). Every download
// must actually have signed the certificate below it, so a bad or hijacked
// AIA address cannot smuggle in a trust anchor.
export async function downloadIssuerChain(leaf: X509Certificate): Promise<string[]> {
  const pems: string[] = [];
  const roots = rootFingerprints();
  let current = leaf;
  for (let hop = 0; hop < MAX_CHAIN_HOPS; hop++) {
    const m = /CA Issuers - URI:(\S+)/.exec(current.infoAccess || "");
    if (!m || !/^https?:\/\//i.test(m[1])) break;
    let issuer: X509Certificate;
    try {
      const res = await fetch(m[1], { signal: AbortSignal.timeout(8000) });
      if (!res.ok) break;
      issuer = new X509Certificate(Buffer.from(await res.arrayBuffer()));
    } catch {
      break;
    }
    if (!current.checkIssued(issuer)) break;
    if (roots.has(issuer.fingerprint256)) break;
    pems.push(issuer.toString());
    if (issuer.checkIssued(issuer)) break;
    current = issuer;
  }
  return pems;
}

type Repair = { at: number; pems: string[] };
const repairs = new Map<string, Repair>();
const agents = new Map<string, Agent>();

async function repairHost(host: string): Promise<string[]> {
  const known = repairs.get(host);
  if (known && (known.pems.length > 0 || Date.now() - known.at < RETRY_FAILED_AFTER_MS)) return known.pems;
  const leaf = await peerLeafCertificate(host);
  const pems = leaf ? await downloadIssuerChain(leaf) : [];
  repairs.set(host, { at: Date.now(), pems });
  if (pems.length) console.log(`[tls-chain] ${host} sends an incomplete certificate chain — added ${pems.length} downloaded issuer(s) for it`);
  else console.warn(`[tls-chain] ${host}: could not complete its certificate chain from the certificate's CA Issuers address`);
  return pems;
}

function agentFor(host: string, pems: string[], connect: Record<string, unknown>, key: string): Agent {
  const id = `${host}|${key}`;
  let agent = agents.get(id);
  if (!agent) {
    agent = new Agent({ connect: { ...connect, ca: [...tls.rootCertificates, ...pems] } });
    agents.set(id, agent);
  }
  return agent;
}

/**
 * Drop-in for fetch(). `connect` is merged into the repaired agent's connect
 * options (callers that pin DNS pass their lookup here, keyed by `connectKey`).
 * The first request to a broken host pays one extra TLS handshake and the
 * issuer download; later requests to it go straight to the repaired agent.
 */
export async function fetchWithChainRepair(
  url: string,
  init: Record<string, any> = {},
  connect: Record<string, unknown> = {},
  connectKey = "plain",
): Promise<globalThis.Response> {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* let fetch raise the URL error */ }
  const known = host ? repairs.get(host) : undefined;
  if (known && known.pems.length) {
    const { dispatcher: _ignored, ...rest } = init;
    return (await (undiciFetch as any)(url, { ...rest, dispatcher: agentFor(host, known.pems, connect, connectKey) })) as unknown as globalThis.Response;
  }
  try {
    // A dispatcher built by the undici package only works with that
    // package's own fetch: handed to Node's built-in fetch it is refused
    // ("UND_ERR_INVALID_ARG: invalid onRequestStart method" — every
    // safePublicFetch call was failing this way, 2026-11-11).
    return init.dispatcher
      ? ((await (undiciFetch as any)(url, init)) as unknown as globalThis.Response)
      : await fetch(url, init as any);
  } catch (err) {
    if (!host || !isIncompleteChainError(err)) throw err;
    const pems = await repairHost(host);
    if (!pems.length) throw err;
    const { dispatcher: _ignored, ...rest } = init;
    return (await (undiciFetch as any)(url, { ...rest, dispatcher: agentFor(host, pems, connect, connectKey) })) as unknown as globalThis.Response;
  }
}
