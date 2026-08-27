// HM Land Registry Business Gateway client (mutual-TLS).
//
// Per-title Official Copy / Search services, authenticated with our issued
// client certificate over mutual TLS. Distinct from the PropertyData REST
// integration (see companies-house.ts / land-registry.ts) — this is the direct
// HM Land Registry per-title SOAP gateway, using BGP's own issued certificate
// (CN "Bruce Gillingham Pollard Limited").
//
// Cert material is held as base64-encoded PEM in Railway secrets:
//   LR_BG_CERT_B64 (client cert), LR_BG_KEY_B64 (private key), LR_BG_CA_B64 (CA chain)
//   LR_BG_LIVE_CERT_B64 / LR_BG_LIVE_KEY_B64 — the live-environment pair; used
//     instead of the plain vars when LR_BG_ENV=live (test keeps the BGTest pair)
//   LR_BG_ENV = "test" | "live"
//   LR_BG_USERNAME / LR_BG_PASSWORD (Business Gateway portal account)
import https from "https";
import { randomUUID } from "crypto";
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { saveFile, getFile } from "./file-storage";

const decode = (b64?: string): string | null => (b64 ? Buffer.from(b64, "base64").toString("utf8") : null);

function bgIsLive(): boolean {
  return (process.env.LR_BG_ENV || "test").toLowerCase() === "live";
}

function bgCertMaterial(): { cert?: string; key?: string } {
  if (bgIsLive() && process.env.LR_BG_LIVE_CERT_B64 && process.env.LR_BG_LIVE_KEY_B64) {
    return { cert: process.env.LR_BG_LIVE_CERT_B64, key: process.env.LR_BG_LIVE_KEY_B64 };
  }
  return { cert: process.env.LR_BG_CERT_B64, key: process.env.LR_BG_KEY_B64 };
}

export function bgConfigured(): boolean {
  const m = bgCertMaterial();
  return !!(m.cert && m.key);
}

// The cert authenticates the channel (mutual TLS); the SOAP WS-Security header
// authenticates the Business Gateway portal account. Both are required to fire
// a real operation — the connectivity check only needs the cert.
export function bgCredentials(): { username: string; password: string } | null {
  const username = process.env.LR_BG_USERNAME, password = process.env.LR_BG_PASSWORD;
  return username && password ? { username, password } : null;
}

export function bgBaseUrl(): string {
  return bgIsLive()
    ? "https://businessgateway.landregistry.gov.uk"
    : "https://bgtest.landregistry.gov.uk";
}

// SOAP engine base path differs between environments (stub vs live engine).
// Each operation lives at a named web-service appended to this base.
export function bgSoapPath(): string {
  return bgIsLive() ? "/b2b/BGSoapEngine" : "/b2b/ECBG_StubService";
}

// Official Copy "Title Known" (OC1) SOAP service endpoint.
export function bgOfficialCopyPath(): string {
  return `${bgSoapPath()}/OfficialCopyTitleKnownV2_1WebService`;
}

let _agent: https.Agent | null = null;
function bgAgent(): https.Agent | null {
  if (!bgConfigured()) return null;
  if (_agent) return _agent;
  const m = bgCertMaterial();
  const cert = decode(m.cert), key = decode(m.key), ca = decode(process.env.LR_BG_CA_B64);
  if (!cert || !key) return null;
  _agent = new https.Agent({ cert, key, ca: ca || undefined, keepAlive: true });
  return _agent;
}

// Make a mutual-TLS request to the Business Gateway. Returns status + body.
// SOAP operations build on this; for now it powers the connectivity check.
// 307/308 redirects are followed (re-sending the same method + body + client
// cert) — the SOAP engine answers on a canonical URL and bounces us there.
export function bgRequest(opts: { path?: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<{ status: number; body: string; location?: string }> {
  const agent = bgAgent();
  if (!agent) return Promise.reject(new Error("Business Gateway certificate not configured"));
  const startUrl = new URL((opts.path || "/"), bgBaseUrl());
  const doRequest = (url: URL, hops: number): Promise<{ status: number; body: string; location?: string }> =>
    new Promise((resolve, reject) => {
      const req = https.request(url, { agent, method: opts.method || "GET", headers: opts.headers, timeout: opts.timeoutMs || 25000 }, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if ((status === 307 || status === 308) && location && hops > 0) {
          res.resume(); // drain
          const next = new URL(location, url);
          // Only follow within the Business Gateway host — never off-domain.
          if (next.host !== startUrl.host) return resolve({ status, body: "", location });
          return resolve(doRequest(next, hops - 1));
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8"), location }));
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Business Gateway request timed out")); });
      if (opts.body) req.write(opts.body);
      req.end();
    });
  return doRequest(startUrl, 3);
}

// Confirms the client certificate authenticates (mutual-TLS handshake succeeds).
export async function bgConnectivity(): Promise<{ ok: boolean; env: string; endpoint: string; status?: number; error?: string }> {
  const env = (process.env.LR_BG_ENV || "test").toLowerCase();
  const endpoint = bgBaseUrl();
  if (!bgConfigured()) return { ok: false, env, endpoint, error: "Certificate not configured (LR_BG_CERT_B64 / LR_BG_KEY_B64)" };
  try {
    const r = await bgRequest({ path: "/", timeoutMs: 20000 });
    // Any HTTP response means the mutual-TLS handshake (client cert) succeeded.
    return { ok: r.status > 0 && r.status < 500, env, endpoint, status: r.status };
  } catch (e: any) {
    return { ok: false, env, endpoint, error: e?.message || "request failed" };
  }
}

// ---------------------------------------------------------------------------
// Official Copy of Register by title number  (OC1, "Title Known")
// ---------------------------------------------------------------------------
// Mirrors Land Registry's published example for the performTitleKnownSearch
// operation (request_title_known_official_copy_v2_1.xsd). Code 10/10 = an
// official copy (OC1) of the register for a known title number.
//   https://landregistry.github.io/bgtechdoc/services/official_copy_title_known/

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export interface OfficialCopyOpts {
  titleNumber: string;
  externalReference?: string;   // your own reference for the request
  customerReference?: string;   // reference for the end client
  propertyDescription?: string;
  contactName?: string;
  contactPhone?: string;
  expectedPrice?: number;       // £, fee you expect (gateway proceeds if actual ≤ this, see indicator)
  requestedOfficialCopyCode?: string; // 10 = register (default)
  officialCopyTypeCode?: string;       // 10 = OC1 official copy (default)
}

// Build the full SOAP envelope (WS-Security UsernameToken + i18n locale header
// + performTitleKnownSearch body) for an Official Copy request.
export function buildOfficialCopyEnvelope(opts: OfficialCopyOpts, creds: { username: string; password: string }): string {
  // Reference / message IDs are limited to 25 chars (ReferenceTextContentType).
  const messageId = `BGP${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const extRef = (opts.externalReference || messageId).slice(0, 25);
  const custRef = (opts.customerReference || extRef).slice(0, 25);
  const title = xmlEscape(opts.titleNumber.trim().toUpperCase());
  const desc = xmlEscape(opts.propertyDescription || "Subject property");
  const name = xmlEscape(opts.contactName || "Bruce Gillingham Pollard");
  const phone = xmlEscape(opts.contactPhone || "00000000");
  const price = Number.isFinite(opts.expectedPrice as number) ? Math.max(0, Math.round(opts.expectedPrice as number)) : 10;
  const reqCode = xmlEscape(opts.requestedOfficialCopyCode || "10");
  const typeCode = xmlEscape(opts.officialCopyTypeCode || "10");
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${xmlEscape(creds.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${xmlEscape(creds.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
    <i18n:international xmlns:i18n="http://www.w3.org/2005/09/ws-i18n">
      <i18n:locale>en</i18n:locale>
    </i18n:international>
  </soapenv:Header>
  <soapenv:Body>
    <ns3:performTitleKnownSearch xmlns:ns1="http://www.oscre.org/ns/eReg-Final/2011/RequestTitleKnownOfficialCopyV2_1" xmlns:ns3="http://officialcopyv2_1.ws.bg.lr.gov/">
      <arg0>
        <ns1:ID>
          <ns1:MessageID>${xmlEscape(messageId)}</ns1:MessageID>
        </ns1:ID>
        <ns1:Product>
          <ns1:ExternalReference>
            <ns1:Reference>${xmlEscape(extRef)}</ns1:Reference>
          </ns1:ExternalReference>
          <ns1:CustomerReference>
            <ns1:Reference>${xmlEscape(custRef)}</ns1:Reference>
          </ns1:CustomerReference>
          <ns1:SubjectProperty>
            <ns1:TitleNumber>${title}</ns1:TitleNumber>
          </ns1:SubjectProperty>
          <ns1:ExpectedPrice>
            <ns1:GrossPriceAmount>${price}</ns1:GrossPriceAmount>
          </ns1:ExpectedPrice>
          <ns1:Contact>
            <ns1:Name>${name}</ns1:Name>
            <ns1:Communication>
              <ns1:Telephone>${phone}</ns1:Telephone>
            </ns1:Communication>
          </ns1:Contact>
          <ns1:TitleKnownOfficialCopy>
            <ns1:RequestedOfficialCopyCode>${reqCode}</ns1:RequestedOfficialCopyCode>
            <ns1:PropertyDescription>${desc}</ns1:PropertyDescription>
            <ns1:OfficialCopyTypeCode>${typeCode}</ns1:OfficialCopyTypeCode>
            <ns1:ContinueIfTitleIsClosedAndContinuedIndicator>false</ns1:ContinueIfTitleIsClosedAndContinuedIndicator>
            <ns1:NotifyIfPendingFirstRegistrationIndicator>false</ns1:NotifyIfPendingFirstRegistrationIndicator>
            <ns1:NotifyIfPendingApplicationIndicator>false</ns1:NotifyIfPendingApplicationIndicator>
            <ns1:SendBackDatedIndicator>false</ns1:SendBackDatedIndicator>
            <ns1:ContinueIfActualFeeExceedsExpectedFeeIndicator>true</ns1:ContinueIfActualFeeExceedsExpectedFeeIndicator>
          </ns1:TitleKnownOfficialCopy>
        </ns1:Product>
      </arg0>
    </ns3:performTitleKnownSearch>
  </soapenv:Body>
</soapenv:Envelope>`;
}

interface OcSummary { fault?: string; reference?: string; messageId?: string; typeCode?: string; actualPrice?: string; documentFormat?: string; hasDocument?: boolean }

// Pull the useful fields out of the SOAP response without a full XML parser —
// fault, references, fee, and whether a document came back.
function summariseOcResponse(body: string): OcSummary {
  const out: OcSummary = {};
  const fault = body.match(/<(?:\w+:)?faultstring>([\s\S]*?)<\/(?:\w+:)?faultstring>/i);
  if (fault) out.fault = fault[1].trim();
  const ref = body.match(/<(?:\w+:)?(?:LandRegistryReference|Reference)>([\s\S]*?)<\/(?:\w+:)?(?:LandRegistryReference|Reference)>/i);
  if (ref) out.reference = ref[1].trim();
  const mid = body.match(/<(?:\w+:)?MessageID>([\s\S]*?)<\/(?:\w+:)?MessageID>/i);
  if (mid) out.messageId = mid[1].trim();
  const type = body.match(/<(?:\w+:)?TypeCode>([\s\S]*?)<\/(?:\w+:)?TypeCode>/i);
  if (type) out.typeCode = type[1].trim();
  const price = body.match(/<(?:\w+:)?GrossPriceAmount>([\s\S]*?)<\/(?:\w+:)?GrossPriceAmount>/i);
  if (price) out.actualPrice = price[1].trim();
  const doc = extractOcDocument(body);
  if (doc) { out.documentFormat = doc.format; out.hasDocument = true; }
  return out;
}

// Extract the embedded register document (base64) from a successful response.
export function extractOcDocument(body: string): { format: string; base64: string } | null {
  const m = body.match(/<(?:\w+:)?EmbeddedFileBinaryObject[^>]*?(?:format|:format)="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?EmbeddedFileBinaryObject>/i);
  if (!m) return null;
  return { format: m[1].trim(), base64: m[2].replace(/\s+/g, "") };
}

// Fire an Official Copy of Register request for a title number.
export async function officialCopyByTitle(opts: OfficialCopyOpts): Promise<{ ok: boolean; status: number; summary: ReturnType<typeof summariseOcResponse>; body: string; location?: string; document: { format: string; base64: string } | null }> {
  if (!bgConfigured()) throw new Error("Business Gateway certificate not configured");
  const creds = bgCredentials();
  if (!creds) throw new Error("Business Gateway account credentials not configured (LR_BG_USERNAME / LR_BG_PASSWORD)");
  const envelope = buildOfficialCopyEnvelope(opts, creds);
  const r = await bgRequest({
    path: bgOfficialCopyPath(),
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body: envelope,
    timeoutMs: 30000,
  });
  const summary = summariseOcResponse(r.body);
  const document = extractOcDocument(r.body);
  return { ok: r.status >= 200 && r.status < 300 && !summary.fault, status: r.status, summary, body: r.body, location: r.location, document };
}

// Storage key for a title's Official Copy PDF in file_storage.
function ocStorageKey(titleUpper: string): string {
  return `lr-bg/${titleUpper}-OC1-Register.pdf`;
}

// Persist a fetched Official Copy PDF into file_storage and badge the title on
// the Land Registry board as owned (reuses the existing purchases table the LR
// UI already reads). Returns the in-app URL to view the register.
export async function persistOfficialCopy(opts: {
  titleNumber: string; base64: string; summary: OcSummary; userId: string | null;
}): Promise<{ registerUrl: string }> {
  const titleUpper = opts.titleNumber.trim().toUpperCase();
  const buffer = Buffer.from(opts.base64, "base64");
  const storageKey = ocStorageKey(titleUpper);
  await saveFile(storageKey, buffer, "application/pdf", `${titleUpper}-OC1-Register.pdf`);
  const registerUrl = `/api/lr-bg/register/${encodeURIComponent(titleUpper)}`;
  const feeNum = opts.summary.actualPrice ? Number(opts.summary.actualPrice) : null;
  try {
    await pool.query(
      `INSERT INTO land_registry_title_purchases
         (title_number, documents, register_url, plan_url, proprietor_data, raw_response, cost_gbp, requested_by)
       VALUES ($1, 'register', $2, NULL, NULL, $3, $4, $5)
       ON CONFLICT (title_number, documents) DO UPDATE SET
         register_url = EXCLUDED.register_url,
         raw_response = EXCLUDED.raw_response,
         cost_gbp = EXCLUDED.cost_gbp,
         requested_by = EXCLUDED.requested_by,
         created_at = NOW()`,
      [titleUpper, registerUrl, { source: "hmlr_business_gateway", ...opts.summary }, feeNum, opts.userId]
    );
  } catch (e: any) {
    console.warn("[lr-bg] purchases badge upsert failed:", e?.message);
  }
  return { registerUrl };
}

// Public-key SHA-256 fingerprints for BOTH stored pairs (test vars and
// LIVE vars) — fingerprints ONLY, never key material. This is how a "key
// values mismatch" (cert minted from a different CSR than the key we hold)
// is diagnosed from logs without touching either key.
type PairAudit = { key?: string; cert?: string; certCn?: string; certExpiry?: string; match?: boolean; error?: string };
function auditPair(keyB64?: string, certB64?: string): PairAudit {
  const out: PairAudit = {};
  const { createPrivateKey, createPublicKey, createHash, X509Certificate } = require("crypto") as typeof import("crypto");
  try {
    const keyPem = decode(keyB64);
    if (keyPem) {
      const pub = createPublicKey(createPrivateKey(keyPem));
      out.key = createHash("sha256").update(pub.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
    }
    const certPem = decode(certB64);
    if (certPem) {
      const cert = new X509Certificate(certPem);
      out.cert = createHash("sha256").update(cert.publicKey.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
      out.certCn = (cert.subject.match(/CN=([^\n]+)/) || [])[1];
      out.certExpiry = cert.validTo;
    }
    if (out.key && out.cert) out.match = out.key === out.cert;
  } catch (e: any) {
    out.error = e?.message;
  }
  return out;
}
export function bgKeyFingerprints(): { test: PairAudit; live: PairAudit } {
  return {
    test: auditPair(process.env.LR_BG_KEY_B64, process.env.LR_BG_CERT_B64),
    live: auditPair(process.env.LR_BG_LIVE_KEY_B64, process.env.LR_BG_LIVE_CERT_B64),
  };
}

// Generate a fresh CSR from the STORED private key (which never leaves the
// server) so Land Registry can reissue the certificate against the key we
// actually hold. CSRs contain only public information — safe to return.
export async function bgGenerateCsr(): Promise<{ csr: string; keyPubSha256: string }> {
  const keyPem = decode(process.env.LR_BG_KEY_B64);
  if (!keyPem) throw new Error("LR_BG_KEY_B64 not configured");
  const forge = await import("node-forge");
  const key = forge.pki.privateKeyFromPem(keyPem);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  // Subject mirrors the issued certificate's — HMLR key the request off the CN.
  csr.setSubject([
    { name: "countryName", value: "gb" },
    { name: "organizationName", value: "Bruce Gillingham Pollard Limited [226225]" },
    { shortName: "OU", value: "devices" },
    { name: "commonName", value: "Bruce Gillingham Pollard Limited [226225]" },
  ]);
  csr.sign(key, forge.md.sha256.create());
  const { createHash } = require("crypto") as typeof import("crypto");
  const keyPub = createHash("sha256").update(Buffer.from(forge.asn1.toDer(forge.pki.publicKeyToAsn1(csr.publicKey)).getBytes(), "binary")).digest("hex");
  return { csr: forge.pki.certificationRequestToPem(csr), keyPubSha256: keyPub };
}

export function setupBusinessGatewayRoutes(app: Express) {
  app.get("/api/lr-bg/status", requireAuth, async (_req: Request, res: Response) => {
    const conn = await bgConnectivity();
    res.json({ ...conn, credentials: bgCredentials() ? "set" : "missing", officialCopyPath: bgOfficialCopyPath(), fingerprints: bgKeyFingerprints() });
  });

  // CSR for certificate reissue — returns the PEM text (public info only).
  app.get("/api/lr-bg/csr", requireAuth, async (_req: Request, res: Response) => {
    try {
      const out = await bgGenerateCsr();
      res.type("text/plain").send(out.csr);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "CSR generation failed" });
    }
  });

  // Official Copy of Register (OC1) by title number.
  // Body: { titleNumber, externalReference?, customerReference?, propertyDescription?,
  //         contactName?, contactPhone?, expectedPrice?, requestedOfficialCopyCode?, officialCopyTypeCode? }
  app.post("/api/lr-bg/official-copy", requireAuth, async (req: Request, res: Response) => {
    const titleNumber = String(req.body?.titleNumber || "").trim();
    if (!titleNumber) return res.status(400).json({ error: "titleNumber is required" });
    if (!bgConfigured()) return res.status(400).json({ error: "Business Gateway certificate not configured" });
    if (!bgCredentials()) {
      return res.status(400).json({ error: "Business Gateway account credentials not configured (LR_BG_USERNAME / LR_BG_PASSWORD)" });
    }
    try {
      const result = await officialCopyByTitle({ ...req.body, titleNumber });
      let saved: { registerUrl: string } | null = null;
      if (result.ok && result.document?.base64) {
        const userId = (req as any).session?.userId || (req as any).tokenUserId || (req as any).user?.id || null;
        try {
          saved = await persistOfficialCopy({ titleNumber, base64: result.document.base64, summary: result.summary, userId });
        } catch (e: any) {
          console.error("[lr-bg] persist official copy failed:", e?.message);
        }
      }
      // Don't ship the multi-MB base64 back to the browser — the saved URL is
      // the way to view it. Keep summary (fee, reference) for the UI.
      res.status(result.ok ? 200 : 502).json({
        ok: result.ok, status: result.status, summary: result.summary,
        fault: result.summary?.fault, fee: result.summary?.actualPrice,
        reference: result.summary?.reference, saved,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Official Copy request failed" });
    }
  });

  // Serve a stored Official Copy register PDF (inline). Auth-gated; scoped to
  // the lr-bg/ storage prefix so only official copies are reachable here.
  app.get("/api/lr-bg/register/:titleNumber", requireAuth, async (req: Request, res: Response) => {
    const titleUpper = String(req.params.titleNumber || "").trim().toUpperCase();
    if (!titleUpper) return res.status(400).json({ error: "titleNumber required" });
    const file = await getFile(ocStorageKey(titleUpper));
    if (!file) return res.status(404).json({ error: "No Official Copy stored for this title — order one first" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${titleUpper}-OC1-Register.pdf"`);
    res.send(file.data);
  });
}
