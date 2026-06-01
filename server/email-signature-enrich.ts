// ─────────────────────────────────────────────────────────────────────────
// Email signature enrichment.
//
// The BGP email archaeology endpoint surfaces every external address
// we've emailed at a brand's domain. The data we have on each contact
// from interactions alone is thin (email + last touch + senders). But
// every email these contacts have sent us carries their FULL signature
// at the bottom — phone, mobile, exact job title, sometimes mailing
// address and LinkedIn URL. That data is gold and it's sitting in our
// shared Microsoft 365 mailbox waiting to be parsed.
//
// This module:
//   1. Fetches the most recent INBOUND message from each external
//      address via Graph (using the system/app token, no per-user auth).
//   2. Strips HTML, isolates the signature block (heuristic: last 12
//      lines after a sign-off or `-- ` delimiter, or the last ~600 chars).
//   3. Asks Claude Haiku to extract { fullName, title, phone, mobile,
//      address, linkedin } as structured JSON.
//   4. Caches results in email_signatures table keyed by email so
//      subsequent archaeology calls hit the cache instantly.
//
// The cache TTL is 30 days — contacts change roles, the table refreshes
// itself. Called fire-and-forget from contacts-discovery.ts so the
// first archaeology call returns fast and the second one has data.
// ─────────────────────────────────────────────────────────────────────────
import { pool } from "./db";
import { graphRequest } from "./shared-mailbox";
import Anthropic from "@anthropic-ai/sdk";

export interface EmailSignature {
  email: string;
  fullName: string | null;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  linkedin: string | null;
  lastSeenAt: string | null;
  enrichedAt: string | null;
}

// Idempotent boot-DDL — the table is created on first use rather than
// requiring a manual migration. Indexed on email for the cache lookup.
let ensuredTable = false;
async function ensureTable() {
  if (ensuredTable) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_signatures (
      email TEXT PRIMARY KEY,
      full_name TEXT,
      title TEXT,
      phone TEXT,
      mobile TEXT,
      address TEXT,
      linkedin TEXT,
      last_seen_at TIMESTAMPTZ,
      enriched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      raw_signature TEXT,
      source_message_id TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS email_signatures_enriched_idx ON email_signatures (enriched_at)`);
  ensuredTable = true;
}

// Read cached signatures for a batch of emails. Returns a Map keyed by
// email address for O(1) lookup in the archaeology mapping step.
export async function getCachedSignatures(emails: string[]): Promise<Map<string, EmailSignature>> {
  if (emails.length === 0) return new Map();
  try {
    await ensureTable();
    const { rows } = await pool.query<any>(
      `SELECT email, full_name, title, phone, mobile, address, linkedin,
              to_char(last_seen_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS last_seen_at,
              to_char(enriched_at,  'YYYY-MM-DD"T"HH24:MI:SS') AS enriched_at
         FROM email_signatures
        WHERE lower(email) = ANY($1::text[])
          AND enriched_at > now() - interval '30 days'`,
      [emails.map((e) => e.toLowerCase())],
    );
    const m = new Map<string, EmailSignature>();
    for (const r of rows) {
      m.set(r.email.toLowerCase(), {
        email: r.email,
        fullName: r.full_name,
        title: r.title,
        phone: r.phone,
        mobile: r.mobile,
        address: r.address,
        linkedin: r.linkedin,
        lastSeenAt: r.last_seen_at,
        enrichedAt: r.enriched_at,
      });
    }
    return m;
  } catch (e: any) {
    console.warn("[email-signature] cache read failed:", e?.message);
    return new Map();
  }
}

// Search the system mailbox for the most recent INBOUND message from
// `fromEmail`. Inbound means someone at the external company sent it
// TO a BGP user — so the body carries their signature.
//
// CRITICAL: the BGP user who corresponds with this contact varies per
// contact (Luke emails the Outlets people, Rob emails Bluewater, Tom
// emails Leisure Parks). Hardcoding one mailbox misses 90% of the
// signatures. We resolve the right mailbox from crm_interactions:
// the bgp_user on the most recent interaction touching this address.
async function fetchLatestInboundFrom(fromEmail: string): Promise<{ body: string; id: string; receivedAt: string } | null> {
  // Find the BGP user(s) who've corresponded with this external address
  // most often — try each mailbox until Graph returns an inbound match.
  const { rows: bgpUsers } = await pool.query<{ bgp_user: string }>(
    `SELECT bgp_user
       FROM crm_interactions
      WHERE bgp_user IS NOT NULL
        AND participants IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(participants) AS p(addr)
          WHERE lower(addr) = $1
        )
      GROUP BY bgp_user
      ORDER BY COUNT(*) DESC
      LIMIT 4`,
    [fromEmail.toLowerCase()],
  );

  // Fall back to a known senior mailbox if no candidates — shouldn't
  // happen in practice but keeps the function safe.
  const candidates = bgpUsers.length > 0
    ? bgpUsers.map((r) => r.bgp_user)
    : ["woody@brucegillinghampollard.com"];

  for (const userEmail of candidates) {
    try {
      const escaped = fromEmail.replace(/'/g, "''");
      const url = `/users/${encodeURIComponent(userEmail)}/messages?$top=1&$orderby=receivedDateTime desc&$filter=from/emailAddress/address eq '${encodeURIComponent(escaped)}'&$select=id,body,receivedDateTime`;
      const data = await graphRequest(url);
      const msg = (data?.value || [])[0];
      if (msg) {
        return {
          body: msg.body?.content || "",
          id: msg.id,
          receivedAt: msg.receivedDateTime,
        };
      }
    } catch (e: any) {
      // This user's mailbox isn't accessible / Graph errored — try the next.
      continue;
    }
  }
  return null;
}

// Strip HTML, isolate the signature block. Heuristic: signatures sit
// below a sign-off ("Best", "Kind regards", "Thanks") or after a
// `-- ` delimiter, or in the last ~600 characters of plain text. We
// always pass at least 600 chars so a missing sign-off doesn't lose
// the whole signature.
function isolateSignatureText(htmlBody: string): string {
  const plain = htmlBody
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Try to cut at the first sign-off. Common variants — order matters
  // (most specific first) so "Many thanks" doesn't trigger off "Thanks".
  const signOffs = [
    /\n(--+\s*\n)/i,
    /\n(many thanks,?\s*\n)/i,
    /\n(kind regards,?\s*\n)/i,
    /\n(best regards,?\s*\n)/i,
    /\n(warm regards,?\s*\n)/i,
    /\n(regards,?\s*\n)/i,
    /\n(thanks,?\s*\n)/i,
    /\n(cheers,?\s*\n)/i,
    /\n(yours,?\s*\n)/i,
    /\n(sincerely,?\s*\n)/i,
  ];
  for (const re of signOffs) {
    const idx = plain.search(re);
    if (idx >= 0) {
      // Take from the sign-off through to end of email, capped at 800.
      return plain.slice(idx).slice(0, 800).trim();
    }
  }
  // No sign-off — return last 600 chars; signatures almost always
  // sit at the very bottom of the email.
  return plain.slice(-600).trim();
}

// Extract structured fields from a signature block using Claude Haiku.
// Returns null on parse failure — the caller logs and moves on.
async function extractFieldsFromSignature(signatureText: string, email: string): Promise<Partial<EmailSignature> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const client = new Anthropic({ apiKey: key });
  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0,
      system:
        `You extract contact details from email signature blocks. Output ONLY a JSON object with these keys: ` +
        `fullName (string or null), title (string or null — exact job title), phone (string or null — direct office line), ` +
        `mobile (string or null), address (string or null — full postal address as one line), linkedin (URL or null). ` +
        `Set a field to null if not present. Do NOT include the email address. Do NOT invent values. No prose, no markdown.`,
      messages: [
        {
          role: "user",
          content: `Email address: ${email}\n\nSignature block:\n${signatureText}`,
        },
      ],
    });
    const text = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return {
      fullName: parsed.fullName || null,
      title: parsed.title || null,
      phone: parsed.phone || null,
      mobile: parsed.mobile || null,
      address: parsed.address || null,
      linkedin: parsed.linkedin || null,
    };
  } catch (e: any) {
    console.warn(`[email-signature] Haiku extract failed for ${email}:`, e?.message);
    return null;
  }
}

// Enrich a batch of email addresses at the same domain. Fire-and-forget
// from the archaeology endpoint — the first call returns a fast skeleton
// answer and queues this; the second call hits the populated cache.
//
// In-flight set prevents duplicate enrichment when the brand profile
// hits the endpoint twice in quick succession (React StrictMode, etc).
const inFlight = new Set<string>();
export async function enrichSignaturesForDomain(domain: string, emails: string[]): Promise<void> {
  if (!domain || emails.length === 0) return;
  await ensureTable();
  const keyId = `${domain}:${emails.sort().join(",")}`;
  if (inFlight.has(keyId)) return;
  inFlight.add(keyId);
  try {
    for (const email of emails) {
      // Skip if cached + fresh.
      const { rows: existing } = await pool.query<{ enriched_at: string }>(
        `SELECT enriched_at FROM email_signatures WHERE lower(email) = $1 AND enriched_at > now() - interval '30 days' LIMIT 1`,
        [email.toLowerCase()],
      );
      if (existing[0]) continue;

      const msg = await fetchLatestInboundFrom(email);
      if (!msg) {
        console.log(`[email-signature] no inbound found for ${email}`);
        continue;
      }
      const sigText = isolateSignatureText(msg.body);
      if (sigText.length < 30) {
        console.log(`[email-signature] signature too short for ${email} (${sigText.length} chars)`);
        continue;
      }
      const fields = await extractFieldsFromSignature(sigText, email);
      if (!fields) {
        console.log(`[email-signature] Haiku extract failed for ${email}`);
        continue;
      }
      console.log(`[email-signature] enriched ${email} → ${fields.title || "no title"} · ${fields.phone || fields.mobile || "no phone"}`);

      await pool.query(
        `INSERT INTO email_signatures (email, full_name, title, phone, mobile, address, linkedin, last_seen_at, enriched_at, raw_signature, source_message_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10)
         ON CONFLICT (email) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               title = EXCLUDED.title,
               phone = EXCLUDED.phone,
               mobile = EXCLUDED.mobile,
               address = EXCLUDED.address,
               linkedin = EXCLUDED.linkedin,
               last_seen_at = EXCLUDED.last_seen_at,
               enriched_at = now(),
               raw_signature = EXCLUDED.raw_signature,
               source_message_id = EXCLUDED.source_message_id`,
        [
          email.toLowerCase(),
          fields.fullName,
          fields.title,
          fields.phone,
          fields.mobile,
          fields.address,
          fields.linkedin,
          msg.receivedAt,
          sigText,
          msg.id,
        ],
      );
    }
  } finally {
    inFlight.delete(keyId);
  }
}
