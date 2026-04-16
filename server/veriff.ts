import crypto from "crypto";
import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { sendFromSharedMailbox } from "./shared-mailbox";
import { getWhatsAppConfig, sendWhatsAppText } from "./whatsapp";

// Veriff Station API — https://developers.veriff.com/
// We never echo the API key; it's read from Railway env on each request.
const VERIFF_BASE = process.env.VERIFF_BASE_URL || "https://stationapi.veriff.com";

function getCreds() {
  // Veriff's dashboard confusingly labels the public key differently in
  // different places ("Public key" / "API Key" / "Integration ID"). Accept
  // any of the common names so Railway config isn't brittle.
  const apiKey = (
    process.env.VERIFF_API_KEY ||
    process.env.VERIFF_PUBLIC_KEY ||
    process.env.VERIFF_KEY ||
    process.env.VERIFF_INTEGRATION_ID ||
    ""
  ).trim();
  const secret = (
    process.env.VERIFF_SECRET ||
    process.env.VERIFF_PRIVATE_KEY ||
    process.env.VERIFF_SHARED_SECRET ||
    ""
  ).trim();
  return { apiKey, secret };
}

function signPayload(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function signToken(secret: string, sessionId: string): string {
  return crypto.createHmac("sha256", secret).update(sessionId).digest("hex");
}

/**
 * Create a Veriff session and return the hosted verification URL.
 * Veriff calls our /api/veriff/webhook when the check completes.
 */
export async function createVeriffSession(params: {
  firstName: string;
  lastName: string;
  email?: string;
  companyId?: string;
  contactId?: string;
  dealId?: string;
  userId?: string;
}): Promise<{ sessionId: string; verificationUrl: string; status: string }> {
  const { apiKey, secret } = getCreds();
  if (!apiKey || !secret) {
    throw new Error("Veriff API key or secret not configured on server");
  }

  // Our opaque vendorData links back to the company/contact/deal on webhook
  const vendorData = JSON.stringify({
    companyId: params.companyId || null,
    contactId: params.contactId || null,
    dealId: params.dealId || null,
    userId: params.userId || null,
  });

  const body = {
    verification: {
      callback: "", // we use webhook, not redirect callback
      person: {
        firstName: params.firstName,
        lastName: params.lastName,
      },
      vendorData,
      timestamp: new Date().toISOString(),
    },
  };
  const payloadStr = JSON.stringify(body);
  const signature = signPayload(secret, payloadStr);

  const res = await fetch(`${VERIFF_BASE}/v1/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-CLIENT": apiKey,
      "X-HMAC-SIGNATURE": signature,
    },
    body: payloadStr,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Veriff session create failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const sessionId = data?.verification?.id;
  const verificationUrl = data?.verification?.url;
  const status = data?.verification?.status || "created";
  if (!sessionId || !verificationUrl) {
    throw new Error("Veriff response missing session id or url");
  }
  return { sessionId, verificationUrl, status };
}

/**
 * Fetch the verdict for a completed session (defensive — webhook is primary).
 */
export async function getVeriffDecision(sessionId: string): Promise<any> {
  const { apiKey, secret } = getCreds();
  if (!apiKey || !secret) throw new Error("Veriff not configured");
  const signature = signToken(secret, sessionId);
  const res = await fetch(`${VERIFF_BASE}/v1/sessions/${sessionId}/decision`, {
    method: "GET",
    headers: {
      "X-AUTH-CLIENT": apiKey,
      "X-HMAC-SIGNATURE": signature,
    },
  });
  if (!res.ok) throw new Error(`Veriff decision fetch failed: ${res.status}`);
  return res.json();
}

export const veriffRouter = Router();

// Admin: is Veriff configured?
veriffRouter.get("/api/veriff/status", requireAuth, (_req: Request, res: Response) => {
  const { apiKey, secret } = getCreds();
  res.json({ configured: !!(apiKey && secret) });
});

// ─── Self-test: exercises both sides of the Veriff integration ────────────
// Run this from the browser at /api/veriff/diagnostic while signed in.
// Step 1 proves the API key + secret are accepted by Veriff.
// Step 2 proves our webhook handler + HMAC verification works end-to-end.
// If both pass, the only remaining variable is whether Veriff's dashboard
// actually delivers webhooks to our URL — which is a dashboard-side toggle.
veriffRouter.get("/api/veriff/diagnostic", requireAuth, async (req: Request, res: Response) => {
  const report: any = { createdSession: null, webhookLoopback: null, summary: "" };
  const { apiKey, secret } = getCreds();

  // Step 0 — config check
  if (!apiKey || !secret) {
    return res.json({
      ok: false,
      report: { config: { apiKey: !!apiKey, secret: !!secret } },
      summary: "VERIFF_API_KEY and/or VERIFF_SECRET not set on Railway.",
    });
  }

  // Step 1 — create a real test session against stationapi.veriff.com
  try {
    const session = await createVeriffSession({
      firstName: "BGP",
      lastName: "Self-Test",
      email: "self-test@brucegillinghampollard.com",
    });
    report.createdSession = {
      ok: true,
      sessionId: session.sessionId,
      verificationUrl: session.verificationUrl,
      status: session.status,
      note: "Veriff accepted our signed request. Open the URL to complete a real check if you want to test end-to-end, or ignore — it will expire in 7 days.",
    };
  } catch (e: any) {
    report.createdSession = { ok: false, error: e?.message };
  }

  // Step 2 — loopback POST a valid signed fake decision to our own webhook
  try {
    const fakeSessionId = `selftest-${Date.now()}`;
    // Insert a throwaway row so the webhook has something to update
    await pool.query(
      `INSERT INTO veriff_sessions (session_id, first_name, last_name, status, requested_by)
       VALUES ($1, 'BGP', 'Self-Test-Loopback', 'created', $2)
       ON CONFLICT (session_id) DO NOTHING`,
      [fakeSessionId, (req as any).user?.id || (req.session as any)?.userId || null]
    );

    const payload = {
      verification: {
        id: fakeSessionId,
        status: "approved",
        code: 9001,
        reason: "Self-test — signature loopback only",
        person: { firstName: "BGP", lastName: "Self-Test-Loopback" },
        document: null,
      },
    };
    const bodyStr = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");

    // Resolve our own host from the incoming request, so we call ourselves
    const host = req.headers.host;
    const proto = (req.headers["x-forwarded-proto"] as string) || (req.secure ? "https" : "http");
    const selfUrl = `${proto}://${host}/api/veriff/webhook`;

    const webhookRes = await fetch(selfUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hmac-signature": signature,
      },
      body: bodyStr,
    });
    const webhookBody = await webhookRes.text().catch(() => "");

    // Check the row got updated
    const check = await pool.query(`SELECT status, decision_reason FROM veriff_sessions WHERE session_id = $1`, [fakeSessionId]);
    report.webhookLoopback = {
      ok: webhookRes.status === 200 && check.rows[0]?.status === "approved",
      httpStatus: webhookRes.status,
      response: webhookBody.slice(0, 200),
      resultingRow: check.rows[0] || null,
      note: webhookRes.status === 200
        ? "Our webhook accepted the signed payload. HMAC verification is working."
        : "Our webhook rejected the test. Check VERIFF_SECRET is set correctly on Railway.",
    };

    // Clean up the loopback row
    await pool.query(`DELETE FROM veriff_sessions WHERE session_id = $1`, [fakeSessionId]).catch(() => {});
  } catch (e: any) {
    report.webhookLoopback = { ok: false, error: e?.message };
  }

  const overallOk = !!(report.createdSession?.ok && report.webhookLoopback?.ok);
  report.summary = overallOk
    ? "Both tests passed. Veriff is fully wired — if real webhooks still aren't arriving, it's a dashboard routing issue, not a code/credential issue."
    : "One or more tests failed — see details above.";

  res.json({ ok: overallOk, ...report });
});

// Create a verification session for a counterparty (company contact)
veriffRouter.post("/api/veriff/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, mobile, companyId, contactId, dealId } = req.body || {};
    if (!firstName || !lastName) return res.status(400).json({ error: "firstName and lastName required" });
    if (!companyId && !contactId) return res.status(400).json({ error: "companyId or contactId required" });
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;

    const session = await createVeriffSession({ firstName, lastName, email, companyId, contactId, dealId, userId });

    // Record it so we can render status before the webhook arrives
    await pool.query(
      `INSERT INTO veriff_sessions (session_id, company_id, contact_id, deal_id, first_name, last_name, email, status, verification_url, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (session_id) DO NOTHING`,
      [session.sessionId, companyId || null, contactId || null, dealId || null, firstName, lastName, email || null, session.status, session.verificationUrl, userId]
    ).catch((e) => console.warn("[veriff] insert session failed:", e?.message));

    // Send verification email to the counterparty if we have their address
    if (email && session.verificationUrl) {
      const fullName = `${firstName} ${lastName}`;
      const emailBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px;">
          <div style="font-size: 13px; font-weight: 600; letter-spacing: 0.02em; margin-bottom: 24px;">BRUCE GILLINGHAM POLLARD</div>
          <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">Identity Verification Required</h2>
          <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0 0 20px;">
            Dear ${fullName},<br/><br/>
            As part of our Anti-Money Laundering (AML) compliance obligations, we need to verify your identity.
            Please click the button below to complete a brief identity check — it takes approximately 2 minutes.
          </p>
          <a href="${session.verificationUrl}" style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 500;">
            Verify My Identity
          </a>
          <p style="font-size: 12px; color: #999; margin-top: 24px; line-height: 1.5;">
            This link is unique to you and will expire after one use.
            If you have any questions, please contact us directly.
          </p>
        </div>`;
      sendFromSharedMailbox([email], "BGP — Identity Verification Required", emailBody).catch(e =>
        console.warn("[veriff] failed to send verification email:", e?.message)
      );
    }

    // Send WhatsApp verification link if mobile number provided
    if (mobile && session.verificationUrl) {
      const waConfig = getWhatsAppConfig();
      if (waConfig.token && waConfig.phoneNumberId) {
        const waNumber = mobile.replace(/[^0-9]/g, "").replace(/^0/, "44"); // UK default
        const fullName = `${firstName} ${lastName}`;
        sendWhatsAppText(waConfig, waNumber,
          `Hi ${fullName},\n\nBruce Gillingham Pollard requires identity verification as part of our AML compliance.\n\nPlease tap the link below to complete a brief identity check (approx. 2 minutes):\n\n${session.verificationUrl}\n\nThe link is unique to you and will expire after one use. Any questions, please contact us directly.`
        ).catch(e => console.warn("[veriff] failed to send WhatsApp verification:", e?.message));
      }
    }

    res.json(session);
  } catch (err: any) {
    console.error("[veriff] create session error:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to create Veriff session" });
  }
});

// List sessions for a company / contact / deal
veriffRouter.get("/api/veriff/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId, contactId, dealId } = req.query;
    const conds: string[] = [];
    const params: any[] = [];
    if (companyId) { params.push(companyId); conds.push(`company_id = $${params.length}`); }
    if (contactId) { params.push(contactId); conds.push(`contact_id = $${params.length}`); }
    if (dealId) { params.push(dealId); conds.push(`deal_id = $${params.length}`); }
    if (conds.length === 0) return res.status(400).json({ error: "companyId, contactId, or dealId required" });
    const result = await pool.query(
      `SELECT * FROM veriff_sessions WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT 50`,
      params
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook — Veriff pushes decisions here. We verify the HMAC signature.
veriffRouter.post("/api/veriff/webhook", async (req: Request, res: Response) => {
  try {
    const { secret } = getCreds();
    if (!secret) return res.status(500).json({ error: "Veriff not configured" });

    const signature = (req.headers["x-hmac-signature"] || req.headers["x-signature"] || "") as string;
    const rawBody: string | Buffer | undefined = (req as any).rawBody;
    // rawBody is populated by our express raw-body middleware on /api/veriff/* (added in server/index.ts)
    let bodyStr: string;
    if (typeof rawBody === "string") bodyStr = rawBody;
    else if (Buffer.isBuffer(rawBody)) bodyStr = rawBody.toString("utf8");
    else bodyStr = JSON.stringify(req.body);

    const expected = signPayload(secret, bodyStr);
    // Constant-time compare
    const ok = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) {
      console.warn("[veriff] webhook signature mismatch");
      return res.status(401).json({ error: "invalid signature" });
    }

    const payload = req.body || {};
    const sessionId: string | undefined = payload?.verification?.id || payload?.id;
    const status: string | undefined = payload?.verification?.status || payload?.status;
    const code: number | undefined = payload?.verification?.code;
    const reason: string | undefined = payload?.verification?.reason;
    const verdictPerson = payload?.verification?.person || null;
    const verdictDocument = payload?.verification?.document || null;

    if (!sessionId) {
      console.warn("[veriff] webhook missing session id");
      return res.status(200).json({ ok: true }); // ack to stop retries
    }

    await pool.query(
      `UPDATE veriff_sessions
       SET status = $1, decision_code = $2, decision_reason = $3,
           verdict_person = $4, verdict_document = $5, received_at = NOW()
       WHERE session_id = $6`,
      [status || null, code || null, reason || null, verdictPerson, verdictDocument, sessionId]
    );

    // If approved, auto-attach a kyc_documents row pointing at the Veriff result
    if (status === "approved") {
      const row = await pool.query(`SELECT * FROM veriff_sessions WHERE session_id = $1`, [sessionId]);
      const s = row.rows[0];
      if (s && (s.company_id || s.contact_id)) {
        const docName = `Veriff verification — ${s.first_name} ${s.last_name}.json`;
        const fileUrl = `/api/veriff/sessions/${sessionId}/report`;
        await pool.query(
          `INSERT INTO kyc_documents (company_id, contact_id, deal_id, doc_type, file_url, file_name, mime_type, certified_by, certified_at, notes, uploaded_by)
           VALUES ($1, $2, $3, 'onfido_report', $4, $5, 'application/json', $6, NOW(), $7, $8)`,
          [
            s.company_id, s.contact_id, s.deal_id,
            fileUrl, docName,
            "Veriff (biometric)",
            `Veriff sessionId ${sessionId} — approved`,
            s.requested_by,
          ]
        ).catch((e) => console.warn("[veriff] kyc_documents insert failed:", e?.message));

        // Auto-tick identity_verified + address_verified on the company's
        // AML checklist — lazy-import the orchestrator to avoid a circular
        // dep between veriff.ts and kyc-orchestrator.ts.
        if (s.company_id) {
          try {
            const { autoTickFromVeriff } = await import("./kyc-orchestrator");
            const ticked = await autoTickFromVeriff(s.company_id, sessionId, status);
            if (ticked.length > 0) {
              console.log(`[veriff] Auto-ticked ${ticked.join(", ")} for company ${s.company_id} from session ${sessionId}`);
            }
          } catch (e: any) {
            console.warn("[veriff] Auto-tick failed:", e?.message);
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[veriff] webhook error:", err?.message);
    res.status(500).json({ error: "webhook processing failed" });
  }
});

// Serve a sanitised JSON report of a session (for audit)
veriffRouter.get("/api/veriff/sessions/:id/report", requireAuth, async (req: Request, res: Response) => {
  try {
    const r = await pool.query(`SELECT * FROM veriff_sessions WHERE session_id = $1`, [req.params.id]);
    const s = r.rows[0];
    if (!s) return res.status(404).json({ error: "Not found" });
    res.json({
      sessionId: s.session_id,
      firstName: s.first_name,
      lastName: s.last_name,
      status: s.status,
      decisionCode: s.decision_code,
      decisionReason: s.decision_reason,
      verdictPerson: s.verdict_person,
      verdictDocument: s.verdict_document,
      createdAt: s.created_at,
      receivedAt: s.received_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default veriffRouter;
