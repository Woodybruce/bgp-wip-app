// Tokenised KYC upload portal + outbound KYC email helpers + inbound email
// ingestion. Replaces the manual "email Charlotte for the KYC docs" loop
// with a self-service flow:
//
//   1. MLRO clicks "Send KYC request" on a deal → server creates a token,
//      sends the deal contact a branded email from the firm-wide AML mailbox
//      with a link like https://app.bgp.com/kyc-upload/<token>
//   2. Contact opens the link (no BGP login), drops their passport / bank
//      statement / utility bill, server saves it to SP, runs SoF analysis
//      via aml-ai.analyseSourceOfFundsDoc
//   3. If they reply to the email with the docs attached instead of using
//      the portal, ingestKycEmail() picks it up by parsing the [BGP-DEAL-...]
//      tag in the subject and routes the attachments the same way.
//
// The shared mailbox identity (e.g. kyc@brucegillinghampollard.com) is set
// via env BGP_AML_MAILBOX. Woody creates the mailbox in the M365 admin
// portal — that part can't be done from code.

import crypto from "crypto";
import { pool } from "./db";
import { graphRequest } from "./shared-mailbox";

const AML_MAILBOX = process.env.BGP_AML_MAILBOX || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || "https://app.brucegillinghampollard.com";
const TOKEN_TTL_DAYS = 14;

// ── Token issuance ───────────────────────────────────────────────────────────
// Random 32-byte URL-safe token. Stored in kyc_upload_tokens with a 14-day
// TTL by default. Admins can revoke from the deal AML panel.

export async function issueUploadToken(args: {
  dealId: string;
  contactEmail?: string | null;
  contactName?: string | null;
  createdBy: string;
  ttlDays?: number;
}): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const ttl = args.ttlDays ?? TOKEN_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttl * 86400000);
  await pool.query(
    `INSERT INTO kyc_upload_tokens (token, deal_id, contact_email, contact_name, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [token, args.dealId, args.contactEmail || null, args.contactName || null, args.createdBy, expiresAt],
  );
  return { token, url: `${PUBLIC_BASE_URL}/kyc-upload/${token}`, expiresAt };
}

export async function validateUploadToken(token: string): Promise<{
  valid: boolean;
  reason?: string;
  deal?: { id: string; name: string };
} > {
  const r = await pool.query(`SELECT * FROM kyc_upload_tokens WHERE token = $1`, [token]);
  const row = r.rows[0];
  if (!row) return { valid: false, reason: "Unknown link." };
  if (row.revoked_at) return { valid: false, reason: "This link has been revoked." };
  if (new Date(row.expires_at) < new Date()) return { valid: false, reason: "This link has expired." };
  const deal = await pool.query(`SELECT id, name FROM crm_deals WHERE id = $1`, [row.deal_id]);
  if (!deal.rows[0]) return { valid: false, reason: "Deal not found." };
  return { valid: true, deal: { id: deal.rows[0].id, name: deal.rows[0].name } };
}

export async function recordUploadTokenUse(token: string) {
  await pool.query(
    `UPDATE kyc_upload_tokens SET last_used_at = now(), use_count = use_count + 1 WHERE token = $1`,
    [token],
  );
}

export async function revokeUploadToken(token: string) {
  await pool.query(`UPDATE kyc_upload_tokens SET revoked_at = now() WHERE token = $1`, [token]);
}

export async function listUploadTokensForDeal(dealId: string) {
  const r = await pool.query(
    `SELECT token, contact_email, contact_name, created_at, expires_at, revoked_at, last_used_at, use_count
     FROM kyc_upload_tokens WHERE deal_id = $1 ORDER BY created_at DESC`,
    [dealId],
  );
  return r.rows.map((row: any) => ({
    ...row,
    url: `${PUBLIC_BASE_URL}/kyc-upload/${row.token}`,
  }));
}

// ── Outbound email ──────────────────────────────────────────────────────────
// Sends from the shared AML mailbox via Graph. Subject prefix is what tells
// our inbound poller which deal a reply belongs to.

export async function sendKycRequestEmail(args: {
  dealId: string;
  dealName: string;
  recipientEmail: string;
  recipientName: string;
  uploadUrl: string;
  expiresAt: Date;
  customNote?: string;
  cc?: string[];
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!AML_MAILBOX) return { ok: false, error: "BGP_AML_MAILBOX env not configured" };

  const expiresStr = args.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const subject = `[BGP-DEAL-${args.dealId}] KYC documents request — ${args.dealName}`;
  const html = `
    <p>Hi ${args.recipientName || ""},</p>
    <p>To complete the AML/KYC checks for <strong>${args.dealName}</strong>, please upload your supporting documents using the secure link below.</p>
    ${args.customNote ? `<p>${args.customNote}</p>` : ""}
    <p style="margin: 24px 0;"><a href="${args.uploadUrl}" style="background:#10b981;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Upload KYC documents</a></p>
    <p>The link expires on <strong>${expiresStr}</strong>. We'll need:</p>
    <ul>
      <li>Photo ID — passport or driving licence</li>
      <li>Proof of address — recent utility bill, bank statement or council tax letter (within 3 months)</li>
      <li>Proof of source of funds — bank statement, payslip, or confirmation from your accountant / lender</li>
    </ul>
    <p>Alternatively, you can reply to this email with the documents attached — please keep the subject line as it is so we can route the reply to the right file.</p>
    <p>Any questions, just reply.</p>
    <p>— Bruce Gillingham Pollard</p>
  `;

  try {
    await graphRequest(`/users/${encodeURIComponent(AML_MAILBOX)}/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: args.recipientEmail, name: args.recipientName || "" } }],
          ccRecipients: (args.cc || []).map(a => ({ emailAddress: { address: a } })),
        },
        saveToSentItems: true,
      }),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "sendMail failed" };
  }
}

// Reminder email — same template, briefer.
export async function sendKycReminderEmail(args: {
  dealId: string;
  dealName: string;
  recipientEmail: string;
  recipientName: string;
  uploadUrl: string;
  expiresAt: Date;
}): Promise<{ ok: boolean; error?: string }> {
  if (!AML_MAILBOX) return { ok: false, error: "BGP_AML_MAILBOX env not configured" };
  const subject = `[BGP-DEAL-${args.dealId}] Reminder: KYC docs still needed — ${args.dealName}`;
  const html = `
    <p>Hi ${args.recipientName || ""},</p>
    <p>Just a quick nudge — we still need your KYC documents to progress <strong>${args.dealName}</strong>.</p>
    <p style="margin: 24px 0;"><a href="${args.uploadUrl}" style="background:#10b981;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Upload now</a></p>
    <p>Or reply to this email with the docs attached.</p>
    <p>— Bruce Gillingham Pollard</p>
  `;
  try {
    await graphRequest(`/users/${encodeURIComponent(AML_MAILBOX)}/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: args.recipientEmail, name: args.recipientName || "" } }],
        },
        saveToSentItems: true,
      }),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

// ── Inbound poller ──────────────────────────────────────────────────────────
// Run on a cron (every 5 min). Reads the AML mailbox, looks for unprocessed
// emails, parses [BGP-DEAL-<id>] from the subject, downloads attachments,
// runs aml-ai analysis, attaches to the deal. Also tries Claude triage on
// the body when no token is present.

const DEAL_TAG_RE = /\[BGP-DEAL-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/i;

export async function pollAmlMailbox(): Promise<{
  scanned: number;
  processed: number;
  attachments: number;
  warnings: string[];
}> {
  if (!AML_MAILBOX) return { scanned: 0, processed: 0, attachments: 0, warnings: ["BGP_AML_MAILBOX env not configured"] };
  const warnings: string[] = [];
  let scanned = 0, processed = 0, attachments = 0;

  try {
    // Pull unread inbox messages with attachments. Categories used as a
    // poor-man's processed flag: we tag with "BGP-AML-Processed" once done.
    const data: any = await graphRequest(
      `/users/${encodeURIComponent(AML_MAILBOX)}/mailFolders/Inbox/messages?$filter=hasAttachments eq true&$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,categories,receivedDateTime,bodyPreview`,
    );
    const messages = data?.value || [];
    scanned = messages.length;

    for (const msg of messages) {
      try {
        if ((msg.categories || []).includes("BGP-AML-Processed")) continue;
        const dealMatch = (msg.subject || "").match(DEAL_TAG_RE);
        if (!dealMatch) {
          warnings.push(`Skipped "${msg.subject}" — no [BGP-DEAL-<id>] tag`);
          continue;
        }
        const dealId = dealMatch[1];
        const dealRow = await pool.query(`SELECT id, name, aml_source_of_funds FROM crm_deals WHERE id = $1`, [dealId]);
        if (!dealRow.rows[0]) {
          warnings.push(`Deal ${dealId} not found`);
          continue;
        }

        const attachListData: any = await graphRequest(
          `/users/${encodeURIComponent(AML_MAILBOX)}/messages/${msg.id}/attachments?$select=id,name,contentType,size`,
        );
        const list = attachListData?.value || [];
        for (const a of list) {
          if (a.size > 25 * 1024 * 1024) { warnings.push(`Attachment ${a.name} too large`); continue; }
          // Pull contentBytes (one-by-one — Graph won't return bytes in the list)
          const att: any = await graphRequest(
            `/users/${encodeURIComponent(AML_MAILBOX)}/messages/${msg.id}/attachments/${a.id}`,
          );
          if (!att?.contentBytes) continue;
          const buf = Buffer.from(att.contentBytes, "base64");
          await processInboundKycFile({
            dealId,
            dealName: dealRow.rows[0].name,
            declaredSource: dealRow.rows[0].aml_source_of_funds,
            filename: a.name,
            contentType: a.contentType,
            buffer: buf,
            sourceLabel: `email from ${msg.from?.emailAddress?.address || "unknown"} on ${msg.receivedDateTime?.slice(0,10)}`,
          });
          attachments++;
        }

        // Mark processed via category so we don't re-ingest.
        await graphRequest(
          `/users/${encodeURIComponent(AML_MAILBOX)}/messages/${msg.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ categories: [...(msg.categories || []), "BGP-AML-Processed"] }),
          },
        );
        processed++;
      } catch (e: any) {
        warnings.push(`${msg.subject}: ${e?.message?.slice(0, 200)}`);
      }
    }
  } catch (e: any) {
    warnings.push(`mailbox poll failed: ${e?.message}`);
  }

  return { scanned, processed, attachments, warnings };
}

// Shared by the upload portal and the email poller — runs the AI analysis,
// stashes the file metadata in kyc_upload_files, and writes the structured
// SoF analysis to crm_deals.aml_sof_analysis when applicable.
export async function processInboundKycFile(args: {
  dealId: string;
  dealName: string;
  declaredSource?: string | null;
  filename: string;
  contentType: string;
  buffer: Buffer;
  token?: string;
  sourceLabel?: string;
}): Promise<{ classification: any; analysis?: any }> {
  const { extractTextFromFile } = await import("./utils/file-extractor");
  const { analyseSourceOfFundsDoc, saveSofAnalysis } = await import("./aml-ai");
  const fs = await import("fs");
  const path = await import("path");
  const os = await import("os");

  // Persist to a tmp file so the existing extractor can read it (it expects a path).
  const tmp = path.join(os.tmpdir(), `bgp_kyc_${Date.now()}_${args.filename}`);
  fs.writeFileSync(tmp, args.buffer);
  let analysis: any = null;
  try {
    const text = await extractTextFromFile(tmp, args.filename);
    if (text && text.length > 30) {
      analysis = await analyseSourceOfFundsDoc({
        dealName: args.dealName,
        declaredSource: args.declaredSource,
        documentText: text,
        filename: args.filename,
      });
      // Only persist as a SoF entry if Claude classified it as a financial doc
      // (bank_statement, payslip, tax_return). For ID / utility bills we still
      // keep the kyc_upload_files row but don't pollute the SoF list.
      if (["bank_statement", "payslip", "tax_return"].includes(String(analysis.documentType))) {
        await saveSofAnalysis(args.dealId, analysis, args.declaredSource);
      }
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }

  await pool.query(
    `INSERT INTO kyc_upload_files (token, deal_id, original_filename, content_type, size_bytes, ai_classification)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [args.token || "email", args.dealId, args.filename, args.contentType || null, args.buffer.length, analysis || null],
  );
  return { classification: analysis, analysis };
}
