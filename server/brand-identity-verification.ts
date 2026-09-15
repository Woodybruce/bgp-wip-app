import { request } from "node:https";
import { lookup } from "node:dns";
import { getBrandIdentity, normalizeBrandDomain } from "./brand-identity";
import { prepareBrandIdentityUpdate, quarantineBrandIdentityDependents } from "./brand-publishing";

const legalName = (value: unknown) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/&/g, " and ").replace(/\blimited\b/g, "ltd").replace(/[^a-z0-9]+/g, " ").trim();
const registrationNumber = (value: unknown) => {
  const raw = String(value || "").replace(/\s/g, "").toUpperCase();
  return /^\d{1,8}$/.test(raw) ? raw.padStart(8, "0") : /^[A-Z]{2}\d{6}$/.test(raw) ? raw : null;
};
export function knownBrandLegalIdentity(company: any): { domain: string; name: string; number: string } | null {
  const profile = company?.companies_house_data?.profile;
  const number = registrationNumber(company?.companies_house_number);
  const registered = registrationNumber(profile?.companyNumber || profile?.company_number);
  const name = profile?.companyName || profile?.company_name;
  const status = profile?.companyStatus || profile?.company_status;
  const domains = [...new Set([company?.domain, company?.domain_url, company?.website].map(normalizeBrandDomain).filter(Boolean))];
  if (!number || number !== registered || !name || status !== "active" || domains.length !== 1) return null;
  if (![company?.uk_entity_name, company?.name].some(value => value && legalName(value) === legalName(name))) return null;
  return { domain: domains[0]!, name, number };
}

function visibleText(html: string) {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|quot|apos);/gi, entity => ({ "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'" }[entity.toLowerCase()] || " "))
    .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : " ").replace(/\s+/g, " ");
}

export function websiteSupportsBrandLegalIdentity(html: string, known: { name: string; number: string }): boolean {
  const text = visibleText(html);
  // A product mention is not proof of the site operator. Require the same
  // small legal notice to contain the full legal name and a registration label.
  const re = /(?:company\s+(?:registration\s+|registered\s+)?(?:number|no\.?)|registered\s+(?:company\s+)?(?:number|no\.?)|registered\s+in\s+[a-z ,&]+?\s+(?:(?:under|with)\s+)?(?:(?:company|registration)\s+)?(?:number|no\.?))\s*[:.#]?\s*([a-z]{2}\s*\d{6}|\d{1,8})\b/gi;
  for (const match of text.matchAll(re)) {
    if (registrationNumber(match[1]) !== known.number) continue;
    const nearby = legalName(text.slice(Math.max(0, (match.index || 0) - 400), (match.index || 0) + match[0].length + 200));
    if (` ${nearby} `.includes(` ${legalName(known.name)} `)) return true;
  }
  return false;
}

function privateAddress(address: string): boolean {
  if (address.includes(":")) return /^(?:::|fc|fd|fe[89ab])/i.test(address) || /^::ffff:/i.test(address);
  const parts = address.split(".").map(Number);
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224
    || parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
    || parts[0] === 192 && parts[1] === 168 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

async function readOfficialPage(url: string, domain: string, redirects = 0): Promise<{ html: string; url: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || normalizeBrandDomain(url) !== domain) throw new Error("Official-site check cannot follow a different website");
  return new Promise((resolve, reject) => {
    const req = request(parsed, {
      headers: { "User-Agent": "BGP-Dashboard/1.0 (company identity verification)", Accept: "text/html" },
      lookup: (hostname, options, done) => lookup(hostname, { all: true }, (error, addresses) => {
        if (error) return done(error, "", 4);
        if (!addresses.length || addresses.some(row => privateAddress(row.address))) return done(new Error("Official-site check requires a public website"), "", 4);
        const address = addresses[0];
        if (typeof options === "object" && options.all) (done as any)(null, addresses);
        else done(null, address.address, address.family);
      }),
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.resume();
        if (redirects >= 2 || !response.headers.location) return reject(new Error("Too many official-site redirects"));
        readOfficialPage(new URL(response.headers.location, parsed).toString(), domain, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200 || !/text\/html|application\/xhtml\+xml/i.test(String(response.headers["content-type"]))) {
        response.resume(); reject(new Error(`Official website did not return a readable page (${response.statusCode})`)); return;
      }
      let size = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512 * 1024) { req.destroy(new Error("Official website page exceeds the verification size limit")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8"), url: parsed.toString() }));
      response.on("error", reject);
    });
    const timeout = setTimeout(() => req.destroy(new Error("Official website verification timed out")), 8000);
    req.on("close", () => clearTimeout(timeout)); req.on("error", reject); req.end();
  });
}

export async function verifyBrandIdentityFromOfficialSite(
  db: { query: Function; connect: Function }, company: any,
  fetchPage: (url: string, domain: string) => Promise<{ html: string; url: string }> = readOfficialPage,
): Promise<{ status: "ready" | "no_match" | "needs_review"; reason?: string }> {
  if (getBrandIdentity(company).status === "verified") return { status: "ready" };
  const known = knownBrandLegalIdentity(company);
  if (!known) return { status: "needs_review", reason: "Confirm the official website; a matching active Companies House legal identity is not available" };
  const first = await fetchPage(`https://${known.domain}/`, known.domain);
  let proof = websiteSupportsBrandLegalIdentity(first.html, known) ? first : null;
  if (!proof) {
    const links: string[] = [];
    for (const match of first.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (!/terms|legal|privacy|about|company information/i.test(`${match[1]} ${visibleText(match[2])}`)) continue;
      try { const link = new URL(match[1].replace(/&amp;/g, "&"), first.url); if (link.protocol === "https:" && normalizeBrandDomain(link.toString()) === known.domain && !link.hash) links.push(link.toString()); } catch {}
      if (links.length >= 10) break;
    }
    const next = links.find(url => /terms|legal/i.test(url)) || links[0];
    if (next && next !== first.url) { const page = await fetchPage(next, known.domain); if (websiteSupportsBrandLegalIdentity(page.html, known)) proof = page; }
  }
  if (!proof) return { status: "no_match", reason: "The website did not corroborate both the registered company number and legal name; confirm the brand manually" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query("SELECT * FROM crm_companies WHERE id=$1 FOR UPDATE", [company.id])).rows[0];
    if (!current || getBrandIdentity(current).fingerprint !== getBrandIdentity(company).fingerprint || JSON.stringify(knownBrandLegalIdentity(current)) !== JSON.stringify(known)) {
      throw new Error("The brand identity changed during website verification; the result was not applied");
    }
    const actor = "official-website-register-match";
    const prepared = prepareBrandIdentityUpdate(current, { domain: known.domain, aliases: [known.name], country: "gb" }, actor);
    prepared.fields.ai_generated_fields.brand_identity.source = { url: proof.url, companyNumber: known.number, legalName: known.name, method: actor };
    if (prepared.identityChanged) await quarantineBrandIdentityDependents(client, current, actor);
    const fields = Object.entries(prepared.fields);
    await client.query(`UPDATE crm_companies SET ${fields.map(([key], index) => `${key}=$${index + 2}`).join(",")},updated_at=now() WHERE id=$1`,
      [company.id, ...fields.map(([key, value]) => key === "ai_generated_fields" ? JSON.stringify(value) : value)]);
    await client.query("COMMIT");
    return { status: "ready" };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
