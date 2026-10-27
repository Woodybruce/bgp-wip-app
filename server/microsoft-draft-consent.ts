import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthorizationCodeRequest, AuthorizationUrlRequest } from "@azure/msal-node";
import type { Request, Response } from "express";
import { delegatedAccountBelongsToUser } from "./microsoft-delegated-account";

export const MICROSOFT_DRAFT_SCOPES = ["User.Read", "Mail.ReadWrite"];
export const MICROSOFT_DRAFT_STATE_PREFIX = "chat-drafts.";
const FLOW_LIFETIME_MS = 10 * 60 * 1000;
type StaffIdentity = { email?: unknown; role?: unknown; is_active?: unknown };
export interface MicrosoftDraftConsentState {
  purpose: "chat-drafts";
  state: string;
  userId: string;
  email: string;
  createdAt: number;
  redirectUri: string;
  codeVerifier: string;
}
declare module "express-session" {
  interface SessionData { msDraftOAuth?: MicrosoftDraftConsentState }
}
interface DraftConsentClient {
  getAuthCodeUrl(request: AuthorizationUrlRequest): Promise<string>;
  acquireTokenByCode(request: AuthorizationCodeRequest): Promise<{
    accessToken?: string; scopes?: string[];
    account?: { username?: string; homeAccountId?: string } | null;
  } | null>;
  getTokenCache(): { serialize(): string };
}
export interface MicrosoftDraftConsentDependencies {
  getUser(userId: string): Promise<StaffIdentity | null>;
  createClient(): DraftConsentClient;
  saveCache(userId: string, homeAccountId: string, cacheData: string): Promise<void>;
  getRedirectUri(req: Request): string;
  now?: () => number;
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}
function isActiveStaff(user: StaffIdentity | null): boolean {
  return delegatedAccountBelongsToUser(user, { username: user?.email });
}
function sameState(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  const received = Buffer.from(actual), stored = Buffer.from(expected);
  return received.length === stored.length && timingSafeEqual(received, stored);
}

/** Consume before exchanging a code, including on error, expiry or mismatch. */
export function consumeMicrosoftDraftConsent(
  session: { userId?: string; msDraftOAuth?: MicrosoftDraftConsentState }, state: unknown, now = Date.now(),
): MicrosoftDraftConsentState | null {
  const pending = session.msDraftOAuth;
  delete session.msDraftOAuth;
  if (!pending || pending.purpose !== "chat-drafts" || pending.userId !== session.userId ||
    !Number.isFinite(pending.createdAt) || now < pending.createdAt || now - pending.createdAt > FLOW_LIFETIME_MS ||
    !sameState(state, pending.state)) return null;
  return pending;
}

export function isMicrosoftDraftCallback(req: Request): boolean {
  return typeof req.query.state === "string" && req.query.state.startsWith(MICROSOFT_DRAFT_STATE_PREFIX) ||
    !!req.session.msDraftOAuth && !req.query.state;
}

export function createMicrosoftDraftConsentHandlers(deps: MicrosoftDraftConsentDependencies) {
  const now = deps.now ?? Date.now;
  const headers = (res: Response) => res.set({ "Cache-Control": "private, no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  const failureMessages: Record<string, string> = {
    draft_consent_invalid_or_expired: "This connection attempt is invalid or has expired. Return to ChatBGP and choose Connect Outlook drafts again.",
    draft_consent_account_changed: "Your signed-in account changed during this connection. Return to ChatBGP and sign in again.",
    draft_consent_cancelled: "Microsoft permission was cancelled. You can return to ChatBGP and connect Outlook drafts when you are ready.",
    draft_consent_missing_code: "Microsoft did not complete this connection. Return to ChatBGP and try again.",
    draft_consent_wrong_account: "Use the Microsoft account that matches your BGP login. Return to ChatBGP and connect with that account.",
    draft_consent_permission_required: "Microsoft did not grant permission to create drafts. Your Microsoft administrator may need to approve Mail.ReadWrite.",
    draft_consent_failed: "The Outlook draft connection could not be completed. Return to ChatBGP and try again.",
  };
  const failed = (res: Response, code: string, validated?: MicrosoftDraftConsentState) => {
    const message = failureMessages[code] ?? failureMessages.draft_consent_failed;
    // Only a state-validated callback can signal the original opener. Invalid
    // callbacks still get a readable page, never a reflected provider error.
    const notification = validated ? `if(window.opener){window.opener.postMessage({type:"microsoft_draft_connection_failed",code:${JSON.stringify(code)}},${JSON.stringify(new URL(validated.redirectUri).origin).replace(/</g, "\\u003c")});window.close();}` : "";
    return res.status(400).type("html").send(`<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>Outlook drafts connection</title></head><body>
      <h1>Outlook drafts are not connected</h1><p>${message}</p><p><a href="/chatbgp">Return to ChatBGP</a></p><button type="button" onclick="window.close()">Close this window</button>
      <script>${notification}</script></body></html>`);
  };
  return {
    async start(req: Request, res: Response) {
      headers(res);
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ message: "Sign in before connecting Outlook drafts" });
      const bearer = !!(req as any).tokenUserId && /^Bearer\s+\S+/i.test(req.get("authorization") ?? "");
      const site = req.get("sec-fetch-site"), origin = req.get("origin");
      if (!bearer && (site === "cross-site" || site === "same-site" || origin && origin !== `${req.protocol}://${req.get("host")}`)) {
        return res.status(403).json({ message: "Connect Outlook drafts from this application" });
      }
      try {
        const user = await deps.getUser(userId);
        if (!isActiveStaff(user)) return res.status(403).json({ message: "Outlook drafts are available to active BGP staff only" });
        const redirectUri = deps.getRedirectUri(req);
        const email = String(user!.email).trim().toLowerCase();
        const pending: MicrosoftDraftConsentState = {
          purpose: "chat-drafts", userId, email, redirectUri, createdAt: now(),
          state: MICROSOFT_DRAFT_STATE_PREFIX + randomBytes(32).toString("hex"),
          codeVerifier: randomBytes(32).toString("base64url"),
        };
        const authUrl = await deps.createClient().getAuthCodeUrl({
          scopes: [...MICROSOFT_DRAFT_SCOPES], redirectUri, prompt: "consent", state: pending.state,
          loginHint: email, codeChallengeMethod: "S256",
          codeChallenge: createHash("sha256").update(pending.codeVerifier).digest("base64url"),
        });
        req.session.msDraftOAuth = pending;
        await saveSession(req);
        return res.json({ authUrl, redirectUri });
      } catch {
        delete req.session.msDraftOAuth;
        return res.status(500).json({ message: "Unable to start the Outlook draft connection" });
      }
    },
    async callback(req: Request, res: Response) {
      headers(res);
      const pending = consumeMicrosoftDraftConsent(req.session, req.query.state, now());
      try {
        // Persist one-shot consumption before any provider call or response.
        await saveSession(req);
        if (!pending) return failed(res, "draft_consent_invalid_or_expired");
        const user = await deps.getUser(pending.userId);
        if (!isActiveStaff(user) || String(user!.email).trim().toLowerCase() !== pending.email) {
          return failed(res, "draft_consent_account_changed", pending);
        }
        if (req.query.error) return failed(res, req.query.error === "access_denied" ? "draft_consent_cancelled" : "draft_consent_failed", pending);
        if (typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 8192) return failed(res, "draft_consent_missing_code", pending);
        // A separate client ensures another user's global MSAL cache cannot be
        // mixed into the cache persisted by this explicit connection flow.
        const client = deps.createClient();
        const result = await client.acquireTokenByCode({
          code: req.query.code, scopes: [...MICROSOFT_DRAFT_SCOPES], redirectUri: pending.redirectUri,
          codeVerifier: pending.codeVerifier,
        });
        if (!result?.accessToken || !result.account?.homeAccountId || !delegatedAccountBelongsToUser(user, result.account)) {
          return failed(res, "draft_consent_wrong_account", pending);
        }
        const scopes = new Set((result.scopes ?? []).map(scope => scope.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase()));
        if (!scopes.has("mail.readwrite")) return failed(res, "draft_consent_permission_required", pending);
        await deps.saveCache(pending.userId, result.account.homeAccountId, client.getTokenCache().serialize());
        req.session.msAccountHomeId = result.account.homeAccountId;
        // The general session token may belong to a legacy fallback account;
        // never replace it with a narrow mail-only token for files/calendar.
        delete req.session.msTokens;
        await saveSession(req);
        const targetOrigin = JSON.stringify(new URL(pending.redirectUri).origin).replace(/</g, "\\u003c");
        return res.type("html").send(`<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>Outlook drafts connected</title></head><body>
          <p>Outlook drafts connected. You can return to ChatBGP and create your draft.</p><p><a href="/chatbgp?microsoft_connected=chat-drafts">Return to ChatBGP</a></p>
          <script>if(window.opener){window.opener.postMessage({type:"microsoft_connected",purpose:"chat-drafts"},${targetOrigin});window.close();}else{window.location.replace("/chatbgp?microsoft_connected=chat-drafts");}</script>
          </body></html>`);
      } catch {
        // Provider exception messages can include codes/identifiers. Do not
        // log or reflect them into the callback page, redirect or browser.
        return failed(res, "draft_consent_failed", pending ?? undefined);
      }
    },
  };
}
