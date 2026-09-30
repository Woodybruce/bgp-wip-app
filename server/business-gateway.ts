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
import { randomUUID, createPrivateKey, createPublicKey, createHash, X509Certificate } from "crypto";
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { saveFile, getFile } from "./file-storage";

const decode = (b64?: string): string | null => (b64 ? Buffer.from(b64, "base64").toString("utf8") : null);

function bgIsLive(): boolean {
  return (process.env.LR_BG_ENV || "test").trim().toLowerCase() === "live";
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
          if (next.origin !== startUrl.origin) return resolve({ status, body: "", location });
          return resolve(doRequest(next, hops - 1));
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", reject);
        res.on("aborted", () => reject(new Error("Business Gateway response was interrupted")));
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
  const env = bgIsLive() ? "live" : "test";
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

export interface BgAvailabilityResult {
  ok: boolean;
  env: string;
  titleNumber: string;
  authentication: "verified" | "rejected" | "forbidden" | "unverified" | "not_configured";
  status?: number;
  availability?: unknown;
  titleStatus?: string;
  titleStatusDescription?: string;
  registerAvailability?: string;
  registerBackdated?: boolean;
  continuedUnderTitleNumber?: string;
  error?: string;
  code?: string;
  traceId?: string;
  note: string;
}

// This read-only REST service checks account access as well as the certificate.
// Unlike ordering an OC1, checking document availability cannot buy a copy.
// https://landregistry.github.io/bgtechdoc/services/official_copy_document_availability_v2/
export async function bgOfficialCopyAvailability(titleNumber: string): Promise<BgAvailabilityResult> {
  const title = String(titleNumber || "").trim().toUpperCase().replace(/\s+/g, "");
  const base = { env: bgIsLive() ? "live" : "test", titleNumber: title,
    note: "Document availability check only. No documents ordered or fees incurred." };
  if (!/^[A-Z]{0,3}\d{1,8}$/.test(title)) {
    return { ...base, ok: false, authentication: "unverified", error: "A valid title number is required." };
  }
  const creds = bgCredentials();
  if (!bgConfigured() || !creds) {
    return { ...base, ok: false, authentication: "not_configured", error: "Business Gateway certificate or account credentials are not configured on this server." };
  }
  try {
    const result = await bgRequest({
      path: `${bgIsLive() ? "/bg2" : "/bg2test"}/api/v2/titles/${encodeURIComponent(title)}/official-copies/availability`,
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}` },
      timeoutMs: 20000,
    });
    let payload: any = null;
    try { payload = JSON.parse(result.body); } catch { /* Not a valid provider JSON response. */ }
    const error = Array.isArray(payload?.errors) ? payload.errors[0] : payload;
    const safeText = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").slice(0, 500) : undefined;
    const details = { code: safeText(error?.error_code || error?.code), traceId: safeText(payload?.trace_id || error?.trace_id) };
    if (result.status >= 200 && result.status < 300 && payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data) && !payload.errors) {
      const data = payload.data;
      return { ...base, ...details, ok: true, status: result.status, authentication: "verified", availability: payload,
        titleStatus: safeText(data.title_status_code), titleStatusDescription: safeText(data.title_status),
        registerAvailability: safeText(data.register?.availability_code),
        registerBackdated: typeof data.register?.backdated === "boolean" ? data.register.backdated : undefined,
        continuedUnderTitleNumber: safeText(data.continued_under_title_number) };
    }
    const authentication = result.status === 401 ? "rejected" : result.status === 403 ? "forbidden" : "unverified";
    const fallback = result.status === 401 ? "HM Land Registry rejected the configured account credentials."
      : result.status === 403 ? "HM Land Registry has not permitted this account role or organisation to use the service."
      : result.status === 404 ? "HM Land Registry could not find this title."
      : `HM Land Registry document availability check failed (HTTP ${result.status}).`;
    return { ...base, ...details, ok: false, status: result.status, authentication,
      error: safeText(error?.error_message || error?.message || error?.detail) || fallback };
  } catch (e: any) {
    return { ...base, ok: false, authentication: "unverified", error: e?.message || "Business Gateway availability check failed." };
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
  messageId?: string;           // retained for recovery; reuse only for the same request
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
  const messageId = opts.messageId || `BGP${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  if (!/^[A-Za-z0-9_-]{5,25}$/.test(messageId)) throw new Error("Invalid Business Gateway message ID");
  const extRef = (opts.externalReference || messageId).slice(0, 25);
  const custRef = (opts.customerReference || extRef).slice(0, 25);
  const title = xmlEscape(opts.titleNumber.trim().toUpperCase());
  const desc = xmlEscape(opts.propertyDescription || "Subject property");
  const name = xmlEscape(opts.contactName || "Bruce Gillingham Pollard");
  const phone = xmlEscape(opts.contactPhone || "00000000");
  const price = Number.isFinite(opts.expectedPrice as number) ? Math.max(0, Math.floor((opts.expectedPrice as number) * 100) / 100) : 7;
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
            <ns1:ContinueIfActualFeeExceedsExpectedFeeIndicator>false</ns1:ContinueIfActualFeeExceedsExpectedFeeIndicator>
          </ns1:TitleKnownOfficialCopy>
        </ns1:Product>
      </arg0>
    </ns3:performTitleKnownSearch>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export interface OcSummary {
  fault?: string; reference?: string; externalReference?: string; messageId?: string;
  typeCode?: string; actualPrice?: string; documentFormat?: string; hasDocument?: boolean;
  code?: string; reason?: string; message?: string; expectedResponseDateTime?: string;
  uniqueId?: string; resultTypeCode?: string;
}

// Read the small, known response fields; never evaluate DTDs/entities or expose
// the SOAP body (which may contain the complete register) in diagnostics.
function ocXmlElement(body: string, tag: string): string | undefined {
  const prefix = "(?:[A-Za-z_][\\w.-]*:)?";
  return body.match(new RegExp(`<${prefix}${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}${tag}\\s*>`, "i"))?.[1];
}
function ocXmlText(value?: string): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, code: string) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}
export function summariseOcResponse(body: string): OcSummary {
  const out: OcSummary = {};
  const read = (tag: string, source = body) => ocXmlText(ocXmlElement(source, tag));
  out.fault = read("faultstring");
  // HMLRReference contains Reference; the first Reference in a successful
  // response is normally our own ExternalReference, not HMLR's order reference.
  const hmlrRef = ocXmlElement(body, "HMLRReference");
  out.reference = hmlrRef ? read("Reference", hmlrRef) || ocXmlText(hmlrRef) : read("LandRegistryReference");
  const externalRef = ocXmlElement(body, "ExternalReference");
  out.externalReference = externalRef ? read("Reference", externalRef) : undefined;
  out.messageId = read("MessageID");
  out.typeCode = read("TypeCode");
  out.resultTypeCode = read("ResultTypeCode");
  out.actualPrice = read("GrossPriceAmount");
  const rejection = ocXmlElement(body, "RejectionResponse") || ocXmlElement(body, "Fault") || body;
  out.code = read("Code", rejection) || read("faultcode");
  out.reason = read("Reason", rejection);
  out.message = read("MessageDescription") || read("OtherDescription", rejection)
    || read("Description", ocXmlElement(body, "MessageDetails") || "");
  out.expectedResponseDateTime = read("ExpectedResponseDateTime");
  out.uniqueId = read("UniqueID");
  if (out.typeCode === "20" && !out.fault) out.fault = out.reason || out.message || out.code || "HM Land Registry rejected this request.";
  const doc = extractOcDocument(body);
  if (doc) { out.documentFormat = doc.format; out.hasDocument = true; }
  return out;
}

// Extract the embedded register document (base64) from a successful response.
export function extractOcDocument(body: string): { format: string; base64: string } | null {
  const m = body.match(/<(?:[A-Za-z_][\w.-]*:)?EmbeddedFileBinaryObject\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?EmbeddedFileBinaryObject\s*>/i);
  if (!m) return null;
  const base64 = m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const buffer = Buffer.from(base64, "base64");
  // OC1 register callers only support PDFs. Attribute 'format' is optional in
  // HMLR's XSD, so trust the file signature rather than requiring that attribute.
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return null;
  return { format: "pdf", base64 };
}

export type OfficialCopyOutcome = "delivered" | "pending" | "rejected" | "failed" | "unknown";
export function classifyOfficialCopyResponse(status: number, summary: OcSummary, hasDocument: boolean): OfficialCopyOutcome {
  if (summary.fault || summary.typeCode === "20") return "rejected";
  if (status < 200 || status >= 300) return "failed";
  if (summary.typeCode === "10") return "pending";
  if (summary.typeCode === "30" && hasDocument) return "delivered";
  return "failed";
}

// Fire an Official Copy of Register request for a title number.
export async function officialCopyByTitle(opts: OfficialCopyOpts): Promise<{ ok: boolean; outcome: OfficialCopyOutcome; requestMessageId: string; status: number; summary: OcSummary; body: string; location?: string; document: { format: string; base64: string } | null }> {
  if (!bgConfigured()) throw new Error("Business Gateway certificate not configured");
  const creds = bgCredentials();
  if (!creds) throw new Error("Business Gateway account credentials not configured (LR_BG_USERNAME / LR_BG_PASSWORD)");
  const requestMessageId = opts.messageId || `BGP${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const envelope = buildOfficialCopyEnvelope({ ...opts, messageId: requestMessageId }, creds);
  let r: Awaited<ReturnType<typeof bgRequest>>;
  try {
    r = await bgRequest({
      path: bgOfficialCopyPath(),
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
      body: envelope,
      timeoutMs: 30000,
    });
  } catch (e: any) {
    return { ok: false, outcome: "unknown", requestMessageId, status: 0, body: "", document: null,
      summary: { messageId: requestMessageId, message: `${e?.message || "Business Gateway request failed"}. The order outcome is unknown; do not submit a new order automatically.` } };
  }
  const summary = summariseOcResponse(r.body);
  summary.messageId ||= requestMessageId;
  const document = extractOcDocument(r.body);
  const outcome = classifyOfficialCopyResponse(r.status, summary, !!document);
  return { ok: outcome === "delivered", outcome, requestMessageId, status: r.status, summary, body: r.body, location: r.location, document };
}

// Storage key for a title's Official Copy PDF in file_storage.
export function ocStorageKey(titleUpper: string): string {
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
  const keyPub = createHash("sha256").update(Buffer.from(forge.asn1.toDer(forge.pki.publicKeyToAsn1(csr.publicKey)).getBytes(), "binary")).digest("hex");
  return { csr: forge.pki.certificationRequestToPem(csr), keyPubSha256: keyPub };
}

export function setupBusinessGatewayRoutes(app: Express) {
  app.get("/api/lr-bg/status", requireAuth, async (_req: Request, res: Response) => {
    const conn = await bgConnectivity();
    res.json({ ...conn, certificateConnection: conn.ok, credentials: bgCredentials() ? "set" : "missing",
      credentialsVerification: "not_checked", note: "This checks the certificate connection only. Account access and ordering have not been verified. Use a document availability check to verify account access without ordering.",
      officialCopyPath: bgOfficialCopyPath(), fingerprints: bgKeyFingerprints() });
  });

  app.get("/api/lr-bg/availability/:titleNumber", requireAuth, async (req: Request, res: Response) => {
    const result = await bgOfficialCopyAvailability(String(req.params.titleNumber || ""));
    res.json(result);
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
    const titleNumber = String(req.body?.titleNumber || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z]{0,3}\d{1,8}$/.test(titleNumber)) return res.status(400).json({ error: "A valid titleNumber is required" });
    if (!bgConfigured()) return res.status(400).json({ error: "Business Gateway certificate not configured" });
    if (!bgCredentials()) {
      return res.status(400).json({ error: "Business Gateway account credentials not configured (LR_BG_USERNAME / LR_BG_PASSWORD)" });
    }
    try {
      // This route is specifically the £7 OC1 register quoted by the button.
      // Other product codes or higher caller-provided fees must not override it.
      const result = await officialCopyByTitle({ titleNumber, expectedPrice: 7,
        externalReference: typeof req.body?.externalReference === "string" ? req.body.externalReference : undefined,
        customerReference: typeof req.body?.customerReference === "string" ? req.body.customerReference : undefined,
        propertyDescription: typeof req.body?.propertyDescription === "string" ? req.body.propertyDescription : undefined,
        contactName: typeof req.body?.contactName === "string" ? req.body.contactName : undefined,
        contactPhone: typeof req.body?.contactPhone === "string" ? req.body.contactPhone : undefined });
      let saved: { registerUrl: string } | null = null;
      let error: string | undefined;
      if (result.ok && result.document?.base64) {
        const userId = (req as any).session?.userId || (req as any).tokenUserId || (req as any).user?.id || null;
        try {
          saved = await persistOfficialCopy({ titleNumber, base64: result.document.base64, summary: result.summary, userId });
        } catch (e: any) {
          console.error("[lr-bg] persist official copy failed:", e?.message);
          error = "HMLR returned the register, but it could not be saved. Do not place another paid order; ask support to recover this response.";
        }
      }
      // Don't ship the multi-MB base64 back to the browser — the saved URL is
      // the way to view it. Keep summary (fee, reference) for the UI.
      res.status(result.outcome === "pending" ? 202 : result.ok && saved ? 200 : 502).json({
        ok: result.ok && !!saved, outcome: result.outcome, requestMessageId: result.requestMessageId,
        status: result.status, summary: result.summary, error,
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
