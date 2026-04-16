import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import crypto from "crypto";

const EVERNOTE_AUTH_URL = "https://app.evernote.com/OAuth.action";
const EVERNOTE_TOKEN_URL = "https://app.evernote.com/oauth2/token";
const EVERNOTE_API_BASE = "https://api.evernote.com";

declare module "express-session" {
  interface SessionData {
    evernoteTokens?: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: number;
    };
    evernoteOAuthState?: string;
  }
}

function getRedirectUri(req: Request): string {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}/api/evernote/callback`;
}

async function refreshEvernoteToken(session: any): Promise<string | null> {
  if (!session.evernoteTokens) return null;

  // If token hasn't expired yet, return it
  if (Date.now() < session.evernoteTokens.expiresAt - 60000) {
    return session.evernoteTokens.accessToken;
  }

  // Evernote tokens are long-lived; if expired and no refresh token, user must re-auth
  if (!session.evernoteTokens.refreshToken) {
    session.evernoteTokens = undefined;
    return null;
  }

  const clientId = process.env.EVERNOTE_CLIENT_ID;
  const clientSecret = process.env.EVERNOTE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(EVERNOTE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.evernoteTokens.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) {
      console.error("Evernote token refresh failed:", await res.text());
      session.evernoteTokens = undefined;
      return null;
    }

    const data = await res.json();
    session.evernoteTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || session.evernoteTokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 31536000) * 1000,
    };
    return data.access_token;
  } catch (err) {
    console.error("Evernote token refresh error:", err);
    session.evernoteTokens = undefined;
    return null;
  }
}

export async function evernoteApi(session: any, path: string, options: RequestInit = {}): Promise<any> {
  const token = await refreshEvernoteToken(session);
  if (!token) throw new Error("Not connected to Evernote");

  const url = `${EVERNOTE_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Evernote API error ${res.status}:`, errText.slice(0, 300));
    throw new Error(`Evernote API error: ${res.status}`);
  }

  return res.json();
}

export function setupEvernoteRoutes(app: Express) {
  app.get("/api/evernote/status", requireAuth, async (req: Request, res: Response) => {
    const token = await refreshEvernoteToken(req.session);
    res.json({ connected: !!token });
  });

  app.get("/api/evernote/auth", requireAuth, async (req: Request, res: Response) => {
    const clientId = process.env.EVERNOTE_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ message: "Evernote Client ID not configured" });
    }

    const state = crypto.randomBytes(32).toString("hex");
    req.session.evernoteOAuthState = state;

    const redirectUri = getRedirectUri(req);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });

    req.session.save((err) => {
      if (err) console.error("[Evernote] Session save error:", err);
      res.json({ url: `${EVERNOTE_AUTH_URL}?${params.toString()}` });
    });
  });

  app.get("/api/evernote/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    if (error) {
      console.error("[Evernote] Authorization error:", error);
      return res.redirect(`/tasks?evernote_error=${encodeURIComponent(String(error))}`);
    }

    if (!code) {
      return res.redirect("/tasks?evernote_error=no_code_received");
    }

    if (!state || state !== req.session.evernoteOAuthState) {
      return res.redirect("/tasks?evernote_error=invalid_state");
    }

    const clientId = process.env.EVERNOTE_CLIENT_ID;
    const clientSecret = process.env.EVERNOTE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.redirect("/tasks?evernote_error=not_configured");
    }

    try {
      const tokenRes = await fetch(EVERNOTE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: getRedirectUri(req),
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("[Evernote] Token exchange failed:", errText);
        return res.redirect("/tasks?evernote_error=token_exchange_failed");
      }

      const data = await tokenRes.json();
      req.session.evernoteTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in || 31536000) * 1000,
      };
      req.session.evernoteOAuthState = undefined;

      req.session.save((err) => {
        if (err) console.error("[Evernote] Session save error:", err);
        res.redirect("/tasks?evernote=connected");
      });
    } catch (err: any) {
      console.error("[Evernote] Callback error:", err.message);
      res.redirect(`/tasks?evernote_error=${encodeURIComponent(err.message)}`);
    }
  });

  app.post("/api/evernote/disconnect", requireAuth, async (req: Request, res: Response) => {
    req.session.evernoteTokens = undefined;
    res.json({ success: true });
  });

  // List notebooks
  app.get("/api/evernote/notebooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await evernoteApi(req.session, "/v3/notebooks");
      const notebooks = (data.notebooks || data || []).map((nb: any) => ({
        id: nb.id || nb.guid,
        name: nb.name || nb.displayName,
      }));
      res.json(notebooks);
    } catch (e: any) {
      if (e.message.includes("Not connected")) return res.status(401).json({ error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // List notes in a notebook
  app.get("/api/evernote/notebooks/:notebookId/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await evernoteApi(req.session, `/v3/notebooks/${req.params.notebookId}/notes?maxNotes=50`);
      const notes = (data.notes || data || []).map((n: any) => ({
        id: n.id || n.guid,
        title: n.title,
        updated: n.updated || n.lastModified,
      }));
      res.json(notes);
    } catch (e: any) {
      if (e.message.includes("Not connected")) return res.status(401).json({ error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // Get note content
  app.get("/api/evernote/notes/:noteId", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await evernoteApi(req.session, `/v3/notes/${req.params.noteId}?includeContent=true`);
      res.json({
        id: data.id || data.guid,
        title: data.title,
        content: data.content,
        webUrl: data.webUrl || data.noteStoreUrl ? `https://www.evernote.com/shard/s1/nl/${data.id || data.guid}` : null,
      });
    } catch (e: any) {
      if (e.message.includes("Not connected")) return res.status(401).json({ error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // Create a note (for exporting tasks)
  app.post("/api/evernote/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const { notebookId, title, content } = req.body;
      if (!notebookId || !title) return res.status(400).json({ error: "notebookId and title required" });

      const enmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>${(content || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</en-note>`;

      const data = await evernoteApi(req.session, `/v3/notebooks/${notebookId}/notes`, {
        method: "POST",
        body: JSON.stringify({ title, content: enmlContent }),
      });

      res.json({
        id: data.id || data.guid,
        title: data.title,
        webUrl: data.webUrl || null,
      });
    } catch (e: any) {
      if (e.message.includes("Not connected")) return res.status(401).json({ error: e.message });
      res.status(500).json({ error: e.message });
    }
  });
}
