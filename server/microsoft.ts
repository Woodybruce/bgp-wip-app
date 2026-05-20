import { ConfidentialClientApplication } from "@azure/msal-node";
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import multer from "multer";
import { pool } from "./db";
import { requireAuth } from "./auth";

const SCOPES = [
  "User.Read",
  "Files.Read",
  "Files.Read.All",
  "Files.ReadWrite.All",
  "Sites.Read.All",
  "Sites.ReadWrite.All",
  "Calendars.Read",
  "Calendars.Read.Shared",
  "Mail.Read",
  "Mail.Read.Shared",
  "Mail.Send",
  "Notes.Read",
  "Notes.Read.All",
  "Notes.ReadWrite.All",
];

const SHAREPOINT_HOST = "brucegillinghampollardlimited.sharepoint.com";
const SHAREPOINT_SITE_PATH = "/sites/BGP";
const SHAREPOINT_ROOT_FOLDER = "BGP share drive";

export { SHAREPOINT_HOST, SHAREPOINT_SITE_PATH, SHAREPOINT_ROOT_FOLDER };

let msalClient: ConfidentialClientApplication | null = null;
let msalCacheLock: Promise<void> | null = null;

async function withMsalCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  while (msalCacheLock) {
    await msalCacheLock;
  }
  let resolve: () => void;
  msalCacheLock = new Promise<void>(r => { resolve = r; });
  try {
    return await fn();
  } finally {
    msalCacheLock = null;
    resolve!();
  }
}

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = (process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET)?.trim();
    const tenantId = process.env.AZURE_TENANT_ID;

    if (!clientId || !clientSecret || !tenantId) {
      throw new Error("Azure credentials not configured");
    }

    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }
  return msalClient;
}

function getRedirectUri(req: Request): string {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}/api/microsoft/callback`;
}

export async function uploadFileToSharePoint(
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
  folderPath?: string
): Promise<{ id: string; name: string; webUrl: string }> {
  const client = getMsalClient();
  const tokenResult = await client.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!tokenResult?.accessToken) throw new Error("Failed to acquire SharePoint app token");
  const token = tokenResult.accessToken;

  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`;
  const siteRes = await fetch(siteUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!siteRes.ok) throw new Error("Could not find BGP SharePoint site");
  const site = await siteRes.json();

  const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!drivesRes.ok) throw new Error("Could not list SharePoint drives");
  const drives = await drivesRes.json();
  const drive = drives.value?.[0];
  if (!drive) throw new Error("No SharePoint drive found");

  const targetFolder = folderPath || `${SHAREPOINT_ROOT_FOLDER}/ChatBGP Documents`;
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${drive.id}/root:/${encodeURIComponent(targetFolder)}/${encodeURIComponent(filename)}:/content`;

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`SharePoint upload failed: ${err.slice(0, 200)}`);
  }

  const result = await uploadRes.json();
  return { id: result.id, name: result.name, webUrl: result.webUrl };
}


async function saveMsalCache(userId: string, homeAccountId: string | null) {
  try {
    const client = getMsalClient();
    const cacheData = client.getTokenCache().serialize();
    const existing = await pool.query(
      "SELECT id FROM msal_token_cache WHERE user_id = $1",
      [userId]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        "UPDATE msal_token_cache SET cache_data = $1, home_account_id = $2, updated_at = NOW() WHERE user_id = $3",
        [cacheData, homeAccountId, userId]
      );
    } else {
      await pool.query(
        "INSERT INTO msal_token_cache (user_id, home_account_id, cache_data) VALUES ($1, $2, $3)",
        [userId, homeAccountId, cacheData]
      );
    }
  } catch (err: any) {
    console.error("Failed to save MSAL cache:", err.message);
  }
}

async function loadMsalCache(userId: string): Promise<string | null> {
  try {
    const result = await pool.query(
      "SELECT cache_data, home_account_id FROM msal_token_cache WHERE user_id = $1",
      [userId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].cache_data;
    }
  } catch (err: any) {
    console.error("Failed to load MSAL cache:", err.message);
  }
  return null;
}

async function getHomeAccountId(userId: string): Promise<string | null> {
  try {
    const result = await pool.query(
      "SELECT home_account_id FROM msal_token_cache WHERE user_id = $1",
      [userId]
    );
    return result.rows[0]?.home_account_id || null;
  } catch (err: any) {
    console.error("[microsoft] getHomeAccountId error:", err?.message);
    return null;
  }
}

export async function getValidMsToken(req: Request): Promise<string | null> {
  const expiresOn = req.session.msTokens?.expiresOn;
  const token = req.session.msTokens?.accessToken;
  const isExpired = !expiresOn || new Date(expiresOn) < new Date(Date.now() + 5 * 60 * 1000);

  if (token && !isExpired) {
    return token;
  }

  const userId = req.session.userId || (req as any).tokenUserId;
  if (!userId) return null;

  return withMsalCacheLock(async () => {
    try {
      const client = getMsalClient();
      let cacheData = await loadMsalCache(String(userId));
      let homeAccountId = req.session.msAccountHomeId || await getHomeAccountId(String(userId));

      if (!cacheData || !homeAccountId) {
        const fallback = await pool.query(
          "SELECT user_id, cache_data, home_account_id FROM msal_token_cache WHERE cache_data IS NOT NULL AND home_account_id IS NOT NULL ORDER BY updated_at DESC NULLS LAST LIMIT 1"
        );
        if (fallback.rows.length > 0) {
          cacheData = fallback.rows[0].cache_data;
          homeAccountId = fallback.rows[0].home_account_id;
          console.log("[microsoft] No MS token for user", userId, "— using org fallback from user", fallback.rows[0].user_id);
        }
      }

      if (!cacheData || !homeAccountId) return null;

      client.getTokenCache().deserialize(cacheData);

      const accounts = await client.getTokenCache().getAllAccounts();
      const account = accounts.find(a => a.homeAccountId === homeAccountId);
      if (!account) {
        console.log("MSAL silent refresh: account not found in cache for user", userId);
        return null;
      }

      const result = await client.acquireTokenSilent({
        scopes: SCOPES,
        account,
      });

      if (result?.accessToken) {
        req.session.msTokens = {
          accessToken: result.accessToken,
          expiresOn: result.expiresOn?.toISOString() || "",
        };
        req.session.msAccountHomeId = homeAccountId;
        // Persist updated cache — silent refresh may rotate the refresh token
        await saveMsalCache(String(userId), homeAccountId);
        return result.accessToken;
      }
    } catch (err: any) {
      console.log("MSAL silent token refresh failed for user", userId, ":", err.message);
    }

    return null;
  });
}

declare module "express-session" {
  interface SessionData {
    msTokens?: {
      accessToken: string;
      expiresOn: string;
    };
    msAccountHomeId?: string;
    msOAuthState?: string;
  }
}

export function setupMicrosoftRoutes(app: Express) {
  app.get("/api/microsoft/auth", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const client = getMsalClient();
      const redirectUri = getRedirectUri(req);
      const state = crypto.randomBytes(32).toString("hex");
      req.session.msOAuthState = state;

      console.log("Microsoft auth: redirect URI =", redirectUri);

      const authUrl = await client.getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri,
        prompt: "consent",
        state,
      });

      res.json({ authUrl, redirectUri });
    } catch (err: any) {
      console.error("Microsoft auth error:", err);
      res.status(500).json({ message: "Failed to start Microsoft auth" });
    }
  });

  app.get("/api/microsoft/callback", async (req: Request, res: Response) => {
    console.log("Microsoft OAuth callback received:", {
      hasCode: !!req.query.code,
      hasError: !!req.query.error,
      errorDesc: req.query.error_description || null,
      hasSession: !!req.session.userId,
    });

    if (!req.session.userId) {
      console.error("Microsoft callback: no session userId - user not authenticated");
      return res.redirect("/?microsoft_error=not_authenticated");
    }

    const { code, error, error_description, state } = req.query;

    if (error) {
      console.error("Microsoft callback error from Azure:", error, error_description);
      const msg = (error_description as string) || (error as string);
      return res.redirect("/?microsoft_error=" + encodeURIComponent(msg));
    }

    if (!code) {
      return res.redirect("/?microsoft_error=no_code");
    }

    const expectedState = req.session.msOAuthState;
    if (!expectedState || state !== expectedState) {
      console.error("Microsoft callback: state mismatch", { expected: !!expectedState, got: !!state });
      return res.redirect("/?microsoft_error=invalid_state");
    }
    delete req.session.msOAuthState;

    try {
      const client = getMsalClient();
      const redirectUri = getRedirectUri(req);
      console.log("Microsoft callback: exchanging code for token, redirectUri:", redirectUri);

      const result = await client.acquireTokenByCode({
        code: code as string,
        scopes: SCOPES,
        redirectUri,
      });

      if (result?.accessToken) {
        req.session.msTokens = {
          accessToken: result.accessToken,
          expiresOn: result.expiresOn?.toISOString() || "",
        };
        const homeAccountId = result.account?.homeAccountId || null;
        if (homeAccountId) {
          req.session.msAccountHomeId = homeAccountId;
        }
        console.log("Microsoft OAuth: token acquired successfully, expires:", result.expiresOn);

        await saveMsalCache(req.session.userId!, homeAccountId);
        console.log("MSAL cache saved to database for user", req.session.userId);
      }

      res.send(`<html><body><script>
        if (window.opener) { window.opener.postMessage({ type: "microsoft_connected" }, "*"); window.close(); }
        else { window.location.href = "/sharepoint"; }
      </script></body></html>`);
    } catch (err: any) {
      console.error("Microsoft callback token exchange error:", err.message || err);
      res.redirect("/?microsoft_error=" + encodeURIComponent(err.message || "token_exchange_failed"));
    }
  });

  app.get("/api/microsoft/status", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const token = await getValidMsToken(req);
    res.json({ connected: !!token });
  });

  app.post("/api/microsoft/disconnect", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    delete req.session.msTokens;
    delete req.session.msAccountHomeId;
    try {
      await pool.query("DELETE FROM msal_token_cache WHERE user_id = $1", [req.session.userId]);
    } catch {}
    res.json({ message: "Disconnected from Microsoft 365" });
  });

  app.get("/api/microsoft/shared-folder-probe", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }
    try {
      const shareUrl = req.query.url as string;
      if (!shareUrl) return res.status(400).json({ message: "url query param required" });
      const encoded = Buffer.from(shareUrl).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const shareToken = "u!" + encoded;
      const driveItemUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem?$expand=children`;
      console.log("[SharePoint Probe] Accessing shared link:", driveItemUrl.substring(0, 120));
      const r = await fetch(driveItemUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const errText = await r.text();
        console.log("[SharePoint Probe] Error:", r.status, errText.substring(0, 300));
        return res.status(r.status).json({ error: errText });
      }
      const data = await r.json();
      console.log("[SharePoint Probe] Success! Folder:", data.name, "Children:", data.children?.length);
      const summary = {
        name: data.name,
        id: data.id,
        driveId: data.parentReference?.driveId,
        childCount: data.folder?.childCount,
        children: data.children?.map((c: any) => ({ name: c.name, size: c.size, folder: !!c.folder, childCount: c.folder?.childCount })),
      };
      return res.json(summary);
    } catch (err: any) {
      console.error("[SharePoint Probe] Error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/microsoft/files", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const folderId = req.query.folderId as string | undefined;
      const driveId = req.query.driveId as string | undefined;

      let url: string = "https://graph.microsoft.com/v1.0/me/drive/root/children";

      if (driveId && folderId) {
        url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children`;
      } else if (driveId) {
        url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
      } else if (folderId) {
        url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`;
      } else {
        let foundDrive = false;

        // Try 1: Direct site path lookup
        const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`;
        console.log("[SharePoint] Trying site lookup:", siteUrl);
        const siteRes = await fetch(siteUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (siteRes.ok) {
          const site = await siteRes.json();
          console.log("[SharePoint] Found site:", site.id, site.displayName);
          const drivesUrl = `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`;
          const drivesRes = await fetch(drivesUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (drivesRes.ok) {
            const drivesData = await drivesRes.json();
            console.log("[SharePoint] Found drives:", drivesData.value?.length, drivesData.value?.map((d: any) => d.name));
            const docsDrive = drivesData.value?.find((d: any) => d.name === "Documents" || d.name === "Shared Documents") || drivesData.value?.[0];
            if (docsDrive) {
              url = `https://graph.microsoft.com/v1.0/drives/${docsDrive.id}/root/children`;
              foundDrive = true;
              console.log("[SharePoint] Using drive:", docsDrive.name, docsDrive.id);
            }
          } else {
            console.error("[SharePoint] Drives error:", drivesRes.status, await drivesRes.text());
          }
        } else {
          const errText = await siteRes.text();
          console.error("[SharePoint] Site lookup error:", siteRes.status, errText);
        }

        // Try 2: Search for the BGP site
        if (!foundDrive) {
          console.log("[SharePoint] Trying search-based site discovery...");
          const searchUrl = `https://graph.microsoft.com/v1.0/sites?search=BGP`;
          const searchRes = await fetch(searchUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (searchRes.ok) {
            const searchData = await searchRes.json();
            console.log("[SharePoint] Search found sites:", searchData.value?.length, searchData.value?.map((s: any) => `${s.displayName} (${s.webUrl})`));
            const bgpSite = searchData.value?.find((s: any) =>
              s.webUrl?.includes("/s/BGP") || s.displayName?.includes("BGP")
            );
            if (bgpSite) {
              console.log("[SharePoint] Found BGP site via search:", bgpSite.id, bgpSite.displayName);
              const drivesUrl = `https://graph.microsoft.com/v1.0/sites/${bgpSite.id}/drives`;
              const drivesRes = await fetch(drivesUrl, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (drivesRes.ok) {
                const drivesData = await drivesRes.json();
                const docsDrive = drivesData.value?.find((d: any) => d.name === "Documents" || d.name === "Shared Documents") || drivesData.value?.[0];
                if (docsDrive) {
                  url = `https://graph.microsoft.com/v1.0/drives/${docsDrive.id}/root/children`;
                  foundDrive = true;
                  console.log("[SharePoint] Using drive from search:", docsDrive.name, docsDrive.id);
                }
              }
            }
          } else {
            console.error("[SharePoint] Search error:", searchRes.status, await searchRes.text());
          }
        }

        // Fallback to personal OneDrive
        if (!foundDrive) {
          console.log("[SharePoint] All lookups failed, falling back to personal OneDrive");
          url = "https://graph.microsoft.com/v1.0/me/drive/root/children";
        }
      }

      const response = await fetch(url + "?$top=100&$orderby=name&$select=id,name,size,lastModifiedDateTime,webUrl,folder,file,parentReference&$expand=thumbnails", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        throw new Error(`Graph API error: ${response.status}`);
      }

      const data = await response.json();
      const items = data.value || [];
      if (items.length > 0 && items[0].parentReference?.driveId) {
        res.json({ items, driveId: items[0].parentReference.driveId });
      } else {
        res.json({ items, driveId: driveId || null });
      }
    } catch (err: any) {
      console.error("Files error:", err);
      res.status(500).json({ message: "Failed to fetch files" });
    }
  });

  app.get("/api/microsoft/files/content", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }
    try {
      const driveId = req.query.driveId as string;
      const itemId = req.query.itemId as string;
      if (!driveId || !itemId) return res.status(400).json({ message: "driveId and itemId required" });
      const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
      if (!r.ok) {
        return res.status(r.status).json({ error: `Graph API error: ${r.status}` });
      }
      const contentType = r.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      const fileName = req.query.fileName as string;
      if (fileName) {
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      }
      const buffer = Buffer.from(await r.arrayBuffer());
      res.send(buffer);
    } catch (err: any) {
      console.error("File content error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/microsoft/files/thumbnail", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }
    try {
      const driveId = req.query.driveId as string;
      const itemId = req.query.itemId as string;
      const size = (req.query.size as string) || "large";
      if (!driveId || !itemId) return res.status(400).json({ message: "driveId and itemId required" });
      const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/thumbnails/0/${size}/content`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
      if (!r.ok) {
        return res.status(r.status).json({ error: `Thumbnail not available` });
      }
      const contentType = r.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=300");
      const buffer = Buffer.from(await r.arrayBuffer());
      res.send(buffer);
    } catch (err: any) {
      console.error("Thumbnail error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/microsoft/sharepoint/debug", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const results: any = {};

      const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`;
      const siteRes = await fetch(siteUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      results.siteUrl = siteUrl;
      results.siteStatus = siteRes.status;
      results.siteData = await siteRes.json();

      if (siteRes.ok) {
        const drivesUrl = `https://graph.microsoft.com/v1.0/sites/${results.siteData.id}/drives`;
        const drivesRes = await fetch(drivesUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        results.drivesStatus = drivesRes.status;
        results.drivesData = await drivesRes.json();
      }

      const searchUrl = `https://graph.microsoft.com/v1.0/sites?search=BGP`;
      const searchRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      results.searchStatus = searchRes.status;
      results.searchData = await searchRes.json();

      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/microsoft/sharepoint/sites", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const search = req.query.search as string || "";
      let url = "https://graph.microsoft.com/v1.0/sites?search=*";
      if (search) {
        url = `https://graph.microsoft.com/v1.0/sites?search=${encodeURIComponent(search)}`;
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        const errorText = await response.text();
        console.error("SharePoint sites error:", errorText);
        return res.json([]);
      }

      const data = await response.json();
      res.json(data.value || []);
    } catch (err: any) {
      console.error("SharePoint sites error:", err);
      res.json([]);
    }
  });

  app.get("/api/microsoft/calendar", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      // Start from Monday of the current week so the diary shows the full work week
      const now = new Date();
      const mondayStart = new Date(now);
      mondayStart.setHours(0, 0, 0, 0);
      const dow = mondayStart.getDay();
      mondayStart.setDate(mondayStart.getDate() - ((dow + 6) % 7));
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + 14);

      const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${mondayStart.toISOString()}&endDateTime=${endDate.toISOString()}&$top=50&$orderby=start/dateTime&$select=subject,start,end,location,organizer,isOnlineMeeting,onlineMeetingUrl,onlineMeeting,attendees,bodyPreview,isAllDay,showAs,categories`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="Europe/London"',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        throw new Error(`Calendar API error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data.value || []);
    } catch (err: any) {
      console.error("Calendar error:", err);
      res.status(500).json({ message: "Failed to fetch calendar" });
    }
  });

  app.get("/api/microsoft/team-calendar", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const { db } = await import("./db");
      const { users } = await import("@shared/schema");
      const teamFilter = req.query.team as string | undefined;

      let teamMembers = await db.select().from(users);
      if (teamFilter && teamFilter !== "All") {
        teamMembers = teamMembers.filter(u => u.team === teamFilter || (u.additionalTeams && u.additionalTeams.includes(teamFilter)));
      }

      const emails = teamMembers
        .filter(u => u.email && u.email.includes("@brucegillinghampollard.com"))
        .map(u => ({ email: u.email!, name: u.name, team: u.team || "Unknown" }));

      if (emails.length === 0) {
        return res.json([]);
      }

      const now = new Date();
      // Start from Monday of the current week so past days' events are visible
      const mondayStart = new Date(now);
      mondayStart.setHours(0, 0, 0, 0);
      const dow = mondayStart.getDay();
      mondayStart.setDate(mondayStart.getDate() - ((dow + 6) % 7));
      const endDate = new Date(mondayStart);
      const daysParam = parseInt(req.query.days as string) || 7;
      endDate.setDate(endDate.getDate() + daysParam);

      const scheduleRes = await fetch("https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: 'outlook.timezone="Europe/London"',
        },
        body: JSON.stringify({
          schedules: emails.map(e => e.email),
          startTime: { dateTime: mondayStart.toISOString(), timeZone: "Europe/London" },
          endTime: { dateTime: endDate.toISOString(), timeZone: "Europe/London" },
          availabilityViewInterval: 30,
        }),
      });

      if (!scheduleRes.ok) {
        if (scheduleRes.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        const errText = await scheduleRes.text();
        console.error("Team schedule error:", errText);
        throw new Error(`Schedule API error: ${scheduleRes.status}`);
      }

      const scheduleData = await scheduleRes.json();

      const PERSONAL_PATTERNS_TEAM = [
        /\blunch\b/i, /\bbreakfast\b/i, /\bdinner\b/i, /\bgym\b/i, /\bworkout\b/i,
        /\bdentist\b/i, /\bdoctor\b/i, /\bhairdress/i, /\bhair\s*cut/i, /\bbarber/i,
        /\bschool\s*(run|pick|drop)/i, /\bkids?\b/i, /\bchildr/i, /\bnursery\b/i,
        /\bvet\b/i, /\bdog\s*walk/i, /\bwalk\s*(the\s*)?dog/i, /\bpersonal\b/i,
        /\bbirthday\b/i, /\banniversary\b/i, /\bholiday\b/i, /\bday\s*off\b/i,
        /\bleave\b/i, /\bannual\s*leave\b/i, /\btime\s*off\b/i, /\bwfh\b/i,
        /\bwork\s*from\s*home\b/i, /\breminder\b/i, /\bfocus\s*time\b/i,
        /\bblock(ed)?\s*(out|time)?\b/i, /\bno\s*meetings?\b/i, /\btravel\s*time\b/i,
        /\bcommute\b/i, /\bpick\s*up\b/i, /\bdrop\s*off\b/i, /\bappointment\b/i,
        /\bpharmacy\b/i, /\boptician/i, /\bphysio/i, /\btherapy\b/i, /\bmedical\b/i,
        /\byoga\b/i, /\bpilates\b/i, /\bmeditation\b/i, /\bprivate\b/i,
        /\bdo\s*not\s*book\b/i, /\bdnd\b/i, /\bout\s*of\s*office\b/i, /\booo\b/i,
        /\bsick\b/i, /\btrain\b/i, /\bflight\b/i, /\buber\b/i, /\btaxi\b/i,
      ];

      const result = (scheduleData.value || []).map((schedule: any, idx: number) => {
        const member = emails.find(e => e.email.toLowerCase() === schedule.scheduleId?.toLowerCase()) || emails[idx];
        const allItems = (schedule.scheduleItems || []).map((item: any) => ({
          status: item.status,
          subject: item.subject || "Busy",
          location: item.location || "",
          start: item.start,
          end: item.end,
          isPrivate: item.isPrivate || false,
        }));
        const filteredItems = allItems.filter((item: any) => {
          if (item.isPrivate) return false;
          if (item.status === "free" || item.status === "unknown") return false;
          const subj = (item.subject || "").trim();
          if (!subj || subj === "Busy" || subj === "No subject") return false;
          if (PERSONAL_PATTERNS_TEAM.some(p => p.test(subj))) return false;
          return true;
        });
        return {
          email: schedule.scheduleId || member?.email,
          name: member?.name || schedule.scheduleId,
          team: member?.team || "Unknown",
          availabilityView: schedule.availabilityView,
          scheduleItems: filteredItems,
        };
      });

      res.json(result);
    } catch (err: any) {
      console.error("Team calendar error:", err);
      res.status(500).json({ message: "Failed to fetch team calendar" });
    }
  });

  app.get("/api/microsoft/calendar/insights", async (req: Request, res: Response) => {
    try {
      const insights: { type: string; title: string; detail: string; priority: number }[] = [];

      const dealsResult = await pool.query(`
        SELECT d.name, d.status, d.created_at, d.internal_agent, d.fee, d.rent_pa,
               d.pricing, d.deal_type, p.name as property_name
        FROM crm_deals d
        LEFT JOIN crm_properties p ON d.property_id = p.id
        WHERE d.status NOT IN ('WIT', 'COM', 'INV')
        ORDER BY d.created_at DESC
      `);
      const activeDealRows = dealsResult.rows;

      const eventsResult = await pool.query(`
        SELECT te.title, te.event_type, te.start_time, te.property_name, te.company_name,
               te.created_by, te.attendees
        FROM team_events te
        WHERE te.start_time >= NOW() - INTERVAL '30 days'
        ORDER BY te.start_time DESC
      `);
      const recentEvents = eventsResult.rows;

      const propertiesResult = await pool.query(`
        SELECT p.name, p.address, p.status, p.asset_class
        FROM crm_properties p
        ORDER BY p.created_at DESC
      `);

      const viewingsByProp = new Map<string, number>();
      const viewingsByCompany = new Map<string, number>();
      const meetingsByAgent = new Map<string, number>();
      const eventsByDay = new Map<string, number>();
      const viewingsThisWeek: any[] = [];
      const viewingsLastWeek: any[] = [];
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);

      recentEvents.forEach((e: any) => {
        const d = new Date(e.start_time);
        const dayKey = d.toLocaleDateString("en-GB", { weekday: "short" });
        eventsByDay.set(dayKey, (eventsByDay.get(dayKey) || 0) + 1);

        if (e.event_type === "viewing") {
          if (e.property_name) viewingsByProp.set(e.property_name, (viewingsByProp.get(e.property_name) || 0) + 1);
          if (e.company_name) viewingsByCompany.set(e.company_name, (viewingsByCompany.get(e.company_name) || 0) + 1);
          if (d >= weekAgo) viewingsThisWeek.push(e);
          else if (d >= twoWeeksAgo) viewingsLastWeek.push(e);
        }
        if (e.created_by) meetingsByAgent.set(e.created_by, (meetingsByAgent.get(e.created_by) || 0) + 1);
      });

      if (viewingsByProp.size > 0) {
        const sorted = Array.from(viewingsByProp.entries()).sort((a, b) => b[1] - a[1]);
        const top = sorted[0];
        insights.push({
          type: "hotProperty",
          title: "Hottest Property",
          detail: `${top[0]} — ${top[1]} viewings in 30 days${sorted.length > 1 ? `, followed by ${sorted[1][0]} (${sorted[1][1]})` : ""}`,
          priority: 10,
        });
      }

      if (viewingsThisWeek.length > 0 || viewingsLastWeek.length > 0) {
        const thisW = viewingsThisWeek.length;
        const lastW = viewingsLastWeek.length;
        const trend = lastW > 0 ? Math.round(((thisW - lastW) / lastW) * 100) : (thisW > 0 ? 100 : 0);
        insights.push({
          type: "viewingTrend",
          title: "Viewing Momentum",
          detail: `${thisW} viewings this week${lastW > 0 ? ` (${trend > 0 ? "↑" : trend < 0 ? "↓" : "→"} ${Math.abs(trend)}% vs last week)` : ""}`,
          priority: 9,
        });
      }

      if (viewingsByCompany.size > 0) {
        const sorted = Array.from(viewingsByCompany.entries()).sort((a, b) => b[1] - a[1]);
        const top = sorted[0];
        insights.push({
          type: "activeTenant",
          title: "Most Active Tenant",
          detail: `${top[0]} — ${top[1]} viewings booked`,
          priority: 8,
        });
      }

      if (meetingsByAgent.size > 0) {
        const sorted = Array.from(meetingsByAgent.entries()).sort((a, b) => b[1] - a[1]);
        const top = sorted[0];
        insights.push({
          type: "busiestAgent",
          title: "Busiest Agent",
          detail: `${top[0]} — ${top[1]} events in 30 days`,
          priority: 7,
        });
      }

      const negotiatingDeals = activeDealRows.filter((d: any) => 
        ["Negotiating", "Under Offer", "HOTs Agreed", "SOLs", "Exchanged"].includes(d.status)
      );
      if (negotiatingDeals.length > 0) {
        const totalFees = negotiatingDeals.reduce((sum: number, d: any) => sum + (parseFloat(d.fee) || 0), 0);
        insights.push({
          type: "pipeline",
          title: "Deal Pipeline",
          detail: `${negotiatingDeals.length} active deal${negotiatingDeals.length > 1 ? "s" : ""}${totalFees > 0 ? ` — £${Math.round(totalFees).toLocaleString()} potential fees` : ""}`,
          priority: 6,
        });
      }

      const allProps = propertiesResult.rows;
      const availableProps = allProps.filter((p: any) => 
        p.status && (p.status.toLowerCase().includes("available") || p.status.toLowerCase().includes("to let"))
      );
      const propsWithNoViewings = availableProps.filter((p: any) => !viewingsByProp.has(p.name));
      if (propsWithNoViewings.length > 0 && propsWithNoViewings.length <= 5) {
        insights.push({
          type: "coldProperty",
          title: "Needs Attention",
          detail: `${propsWithNoViewings.length} available propert${propsWithNoViewings.length > 1 ? "ies" : "y"} with no viewings: ${propsWithNoViewings.slice(0, 3).map((p: any) => p.name).join(", ")}`,
          priority: 5,
        });
      } else if (propsWithNoViewings.length > 5) {
        insights.push({
          type: "coldProperty",
          title: "Needs Attention",
          detail: `${propsWithNoViewings.length} available properties with no recent viewings`,
          priority: 5,
        });
      }

      if (eventsByDay.size > 0) {
        const sorted = Array.from(eventsByDay.entries()).sort((a, b) => b[1] - a[1]);
        insights.push({
          type: "busiestDay",
          title: "Busiest Day",
          detail: `${sorted[0][0]} — ${sorted[0][1]} events this month`,
          priority: 4,
        });
      }

      if (activeDealRows.length > 0) {
        insights.push({
          type: "pipeline",
          title: "CRM Deals",
          detail: `${activeDealRows.length} active deals across ${new Set(activeDealRows.map((d: any) => d.deal_type).filter(Boolean)).size} categories`,
          priority: 3,
        });
      }

      if (allProps.length > 0) {
        insights.push({
          type: "busiestDay",
          title: "Portfolio",
          detail: `${allProps.length} properties tracked, ${availableProps.length} currently available`,
          priority: 2,
        });
      }

      const todayEvents = recentEvents.filter((e: any) => {
        const d = new Date(e.start_time);
        return d.toDateString() === now.toDateString();
      });
      const todayViewings = todayEvents.filter((e: any) => e.event_type === "viewing");
      const todayMeetings = todayEvents.filter((e: any) => e.event_type === "meeting");
      if (todayEvents.length > 0) {
        const parts = [];
        if (todayViewings.length > 0) parts.push(`${todayViewings.length} viewing${todayViewings.length > 1 ? "s" : ""}`);
        if (todayMeetings.length > 0) parts.push(`${todayMeetings.length} meeting${todayMeetings.length > 1 ? "s" : ""}`);
        const otherCount = todayEvents.length - todayViewings.length - todayMeetings.length;
        if (otherCount > 0) parts.push(`${otherCount} other`);
        insights.push({
          type: "todaySummary",
          title: "Today",
          detail: parts.join(", ") || `${todayEvents.length} events`,
          priority: 11,
        });
      }

      insights.sort((a, b) => b.priority - a.priority);

      res.json({ insights: insights.slice(0, 8) });
    } catch (err: any) {
      console.error("Calendar insights error:", err);
      res.status(500).json({ message: "Failed to generate insights" });
    }
  });

  app.post("/api/microsoft/calendar/briefing", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const { subject, attendees, propertyName, companyName, location, startTime, endTime, bodyPreview, eventType } = req.body;

      if (!subject) {
        return res.status(400).json({ message: "Event subject is required" });
      }

      const attendeeEmails = (attendees || [])
        .map((a: any) => a.emailAddress?.address?.toLowerCase())
        .filter(Boolean);
      const externalEmails = attendeeEmails.filter((e: string) => !e.includes("brucegillinghampollard"));
      const bgpEmails = attendeeEmails.filter((e: string) => e.includes("brucegillinghampollard"));

      const contactsResult = await pool.query(`
        SELECT c.id, c.name, c.email, c.phone, c.job_title, c.notes, c.contact_type,
               comp.name as company_name, comp.id as company_id
        FROM crm_contacts c
        LEFT JOIN crm_companies comp ON c.company_id = comp.id
        WHERE LOWER(c.email) = ANY($1)
      `, [externalEmails]);
      const matchedContacts = contactsResult.rows;

      const matchedCompanyIds = matchedContacts
        .map((c: any) => c.company_id)
        .filter(Boolean);

      let companyDetails: any[] = [];
      if (matchedCompanyIds.length > 0) {
        const compResult = await pool.query(`
          SELECT id, name, sector, notes, website
          FROM crm_companies
          WHERE id = ANY($1)
        `, [matchedCompanyIds]);
        companyDetails = compResult.rows;
      }

      if (companyName && companyDetails.length === 0) {
        const compByName = await pool.query(`
          SELECT id, name, sector, notes, website
          FROM crm_companies
          WHERE LOWER(name) LIKE $1
          LIMIT 3
        `, [`%${companyName.toLowerCase()}%`]);
        companyDetails = compByName.rows;
      }

      const allCompanyIds = [...new Set([...matchedCompanyIds, ...companyDetails.map((c: any) => c.id)])];

      let relatedDeals: any[] = [];
      if (allCompanyIds.length > 0) {
        const dealsResult = await pool.query(`
          SELECT d.id, d.name, d.status, d.deal_type, d.fee, d.rent_pa, d.pricing,
                 d.internal_agent, d.notes,
                 p.name as property_name, p.address as property_address
          FROM crm_deals d
          LEFT JOIN crm_properties p ON d.property_id = p.id
          WHERE d.company_id = ANY($1) AND d.status NOT IN ('WIT')
          ORDER BY d.created_at DESC
          LIMIT 10
        `, [allCompanyIds]);
        relatedDeals = dealsResult.rows;
      }

      let relatedProperties: any[] = [];
      if (propertyName) {
        const propResult = await pool.query(`
          SELECT p.id, p.name, p.address, p.status, p.asset_class, p.area_sq_ft,
                 p.asking_rent, p.service_charge, p.rates_payable, p.floor_count, p.notes
          FROM crm_properties p
          WHERE LOWER(p.name) LIKE $1 OR LOWER(p.address) LIKE $1
          LIMIT 5
        `, [`%${propertyName.toLowerCase()}%`]);
        relatedProperties = propResult.rows;
      }

      if (relatedProperties.length === 0 && relatedDeals.length > 0) {
        const propNames = relatedDeals.map((d: any) => d.property_name).filter(Boolean);
        if (propNames.length > 0) {
          const propResult = await pool.query(`
            SELECT p.id, p.name, p.address, p.status, p.asset_class, p.area_sq_ft,
                   p.asking_rent, p.service_charge, p.rates_payable, p.floor_count, p.notes
            FROM crm_properties p
            WHERE LOWER(p.name) = ANY($1)
            LIMIT 5
          `, [propNames.map((n: string) => n.toLowerCase())]);
          relatedProperties = propResult.rows;
        }
      }

      const recentInteractions = await pool.query(`
        SELECT te.title, te.event_type, te.start_time, te.property_name, te.company_name, te.notes
        FROM team_events te
        WHERE (
          LOWER(te.company_name) = ANY($1)
          OR LOWER(te.property_name) = ANY($2)
        )
        AND te.start_time >= NOW() - INTERVAL '90 days'
        AND te.start_time < NOW()
        ORDER BY te.start_time DESC
        LIMIT 10
      `, [
        companyDetails.map((c: any) => c.name.toLowerCase()),
        relatedProperties.map((p: any) => p.name.toLowerCase()),
      ]);

      const crmContext = {
        contacts: matchedContacts.map((c: any) => ({
          name: c.name,
          email: c.email,
          phone: c.phone,
          jobTitle: c.job_title,
          company: c.company_name,
          contactType: c.contact_type,
          notes: c.notes,
        })),
        companies: companyDetails.map((c: any) => ({
          name: c.name,
          sector: c.sector,
          website: c.website,
          notes: c.notes,
        })),
        deals: relatedDeals.map((d: any) => ({
          name: d.name,
          status: d.status,
          dealType: d.deal_type,
          property: d.property_name,
          fee: d.fee,
          rentPA: d.rent_pa,
          agent: d.internal_agent,
        })),
        properties: relatedProperties.map((p: any) => ({
          name: p.name,
          address: p.address,
          status: p.status,
          assetClass: p.asset_class,
          areaSqFt: p.area_sq_ft,
          askingRent: p.asking_rent,
          serviceCharge: p.service_charge,
        })),
        recentHistory: recentInteractions.rows.map((e: any) => ({
          title: e.title,
          type: e.event_type,
          date: new Date(e.start_time).toLocaleDateString("en-GB"),
          property: e.property_name,
          company: e.company_name,
        })),
      };

      const hasContext = crmContext.contacts.length > 0 || crmContext.companies.length > 0 ||
                         crmContext.deals.length > 0 || crmContext.properties.length > 0;

      let aiBriefing = null;
      try {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const anthropic = new Anthropic({
          apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
          ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
            ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
            : {}),
        });

        const bgpNames = (attendees || [])
          .filter((a: any) => a.emailAddress?.address?.toLowerCase().includes("brucegillinghampollard"))
          .map((a: any) => a.emailAddress?.name)
          .filter(Boolean);
        const externalNames = (attendees || [])
          .filter((a: any) => a.emailAddress?.address && !a.emailAddress.address.toLowerCase().includes("brucegillinghampollard"))
          .map((a: any) => `${a.emailAddress.name}${a.emailAddress.address ? ` (${a.emailAddress.address})` : ""}`)
          .filter(Boolean);

        const prompt = `You are an AI assistant for BGP (Bruce Gillingham Pollard), a London commercial property agency.

Generate a concise meeting preparation briefing for the following event. Return valid JSON only.

EVENT:
- Subject: ${subject}
- Type: ${eventType || "meeting"}
- Time: ${startTime ? new Date(startTime).toLocaleString("en-GB") : "Not specified"} to ${endTime ? new Date(endTime).toLocaleString("en-GB") : "Not specified"}
- Location: ${location || "Not specified"}
- Property: ${propertyName || "Not specified"}
- Company: ${companyName || "Not specified"}
- BGP Team: ${bgpNames.join(", ") || "Not specified"}
- External Attendees: ${externalNames.join(", ") || "None"}
- Notes: ${bodyPreview || "None"}

CRM DATA:
${hasContext ? JSON.stringify(crmContext, null, 2) : "No CRM data found for this meeting's attendees or properties."}

Return JSON with these fields:
{
  "summary": "1-2 sentence overview of what this meeting is about and its strategic importance",
  "talkingPoints": ["point 1", "point 2", "point 3"],
  "preparation": ["prep item 1", "prep item 2"],
  "attendeeInsights": [{"name": "Person Name", "insight": "Brief relevant context about this person from CRM"}],
  "dealContext": "Brief summary of any active deals or negotiations relevant to this meeting, or null",
  "propertyContext": "Brief property summary if relevant, or null",
  "riskFlags": ["any risk or concern to be aware of"],
  "followUpSuggestions": ["suggested follow-up action 1"]
}

Be specific and actionable. Reference real CRM data where available. If no CRM data exists, base the briefing on the event details alone. Keep each talking point to one sentence. Maximum 4 talking points, 3 preparation items, and 2 follow-up suggestions.`;

        const aiRes = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
        });

        const aiText = aiRes.content[0]?.type === "text" ? aiRes.content[0].text : "";
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiBriefing = JSON.parse(jsonMatch[0]);
        }
      } catch (aiErr: any) {
        console.error("AI briefing generation error:", aiErr.message);
      }

      res.json({
        crmContext,
        briefing: aiBriefing || {
          summary: hasContext
            ? `Meeting regarding ${subject}. ${crmContext.contacts.length} known contact(s) attending.`
            : `Meeting: ${subject}. No CRM data found for attendees.`,
          talkingPoints: [],
          preparation: [],
          attendeeInsights: [],
          dealContext: null,
          propertyContext: null,
          riskFlags: [],
          followUpSuggestions: [],
        },
      });
    } catch (err: any) {
      console.error("Calendar briefing error:", err);
      res.status(500).json({ message: "Failed to generate briefing" });
    }
  });

  app.get("/api/microsoft/calendar/summary", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${endOfDay.toISOString()}&$top=50&$orderby=start/dateTime&$select=subject,start,end,location,organizer,attendees,isOnlineMeeting,bodyPreview`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="Europe/London"',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired" });
        }
        throw new Error(`Calendar summary error: ${response.status}`);
      }

      const data = await response.json();
      const allEvents = data.value || [];

      const PERSONAL_PATTERNS = [
        /\blunch\b/i, /\bbreakfast\b/i, /\bdinner\b/i, /\bgym\b/i, /\bworkout\b/i,
        /\bdentist\b/i, /\bdoctor\b/i, /\bhairdress/i, /\bhair\s*cut/i, /\bbarber/i,
        /\bschool\s*(run|pick|drop)/i, /\bkids?\b/i, /\bchildr/i, /\bnursery\b/i,
        /\bvet\b/i, /\bdog\s*walk/i, /\bwalk\s*(the\s*)?dog/i, /\bpersonal\b/i,
        /\bbirthday\b/i, /\banniversary\b/i, /\bholiday\b/i, /\bday\s*off\b/i,
        /\bleave\b/i, /\bannual\s*leave\b/i, /\btime\s*off\b/i, /\bwfh\b/i,
        /\bwork\s*from\s*home\b/i, /\breminder\b/i, /\bfocus\s*time\b/i,
        /\bblock(ed)?\s*(out|time)?\b/i, /\bno\s*meetings?\b/i, /\btravel\s*time\b/i,
        /\bcommute\b/i, /\bpick\s*up\b/i, /\bdrop\s*off\b/i, /\bappointment\b/i,
        /\bpharmacy\b/i, /\boptician/i, /\bphysio/i, /\btherapy\b/i, /\bmedical\b/i,
      ];

      function isPersonalEvent(event: any): boolean {
        const subject = (event.subject || "").toLowerCase();
        if (PERSONAL_PATTERNS.some(p => p.test(subject))) return true;
        if (event.showAs === "free" || event.showAs === "workingElsewhere") return true;
        const attendees = event.attendees || [];
        if (attendees.length === 0 && !event.isOnlineMeeting && !event.location?.displayName) {
          if (PERSONAL_PATTERNS.some(p => p.test(subject))) return true;
        }
        return false;
      }

      const events = allEvents.filter((e: any) => !isPersonalEvent(e));
      const personalCount = allEvents.length - events.length;

      if (events.length === 0) {
        const msg = personalCount > 0
          ? `No business meetings scheduled for the rest of today (${personalCount} personal item${personalCount !== 1 ? "s" : ""} filtered out).`
          : "No meetings scheduled for today.";
        return res.json({ summary: msg, events: [], totalMeetings: 0 });
      }

      let aiSummary = "";

      if (events.length > 0) {
        const { callClaude: callClaudeAI, CHATBGP_HELPER_MODEL: helperModel } = await import("./utils/anthropic-client");

        const eventList = events.map((e: any, i: number) => {
          const start = new Date(e.start.dateTime);
          const end = new Date(e.end.dateTime);
          const timeStr = `${start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}-${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
          const bgpAttendees = (e.attendees || [])
            .filter((a: any) => a.emailAddress?.address?.includes("brucegillinghampollard"))
            .map((a: any) => a.emailAddress.name);
          const externalAttendees = (e.attendees || [])
            .filter((a: any) => a.emailAddress?.address && !a.emailAddress.address.includes("brucegillinghampollard"))
            .map((a: any) => `${a.emailAddress.name} (${a.emailAddress.address})`);
          const bgpStr = bgpAttendees.length > 0 ? ` BGP team: ${bgpAttendees.join(", ")}` : "";
          const extStr = externalAttendees.length > 0 ? ` External: ${externalAttendees.join(", ")}` : "";
          return `${i + 1}. ${timeStr}: ${e.subject}${e.location?.displayName ? ` at ${e.location.displayName}` : ""}${bgpStr}${extStr}${e.isOnlineMeeting ? " [Online]" : ""}`;
        }).join("\n");

        try {
          const completion = await callClaudeAI({
            model: helperModel,
            messages: [
              {
                role: "system",
                content: "You are an executive assistant for BGP (Bruce Gillingham Pollard), a London property consultancy. Provide a brief, professional summary of today's BUSINESS diary only. Personal items (lunch, gym, school runs, appointments, etc.) have already been filtered out — do not mention them. Focus exclusively on business-relevant meetings: client meetings, viewings, team catch-ups, calls with agents/tenants/landlords, legal meetings, and deal-related activity. Highlight key meetings, who they're with, and any scheduling clashes. Keep it to 2-3 sentences maximum. Use a warm but professional tone. IMPORTANT: Identify any meetings that appear to be with occupiers, tenants, retailers, or external clients (i.e. not internal BGP meetings). Flag these as 'Occupier/Tenant meetings' and name them specifically. For the London F&B and London Retail teams this is especially important - highlight any leasing meetings, viewings, or tenant discussions.",
              },
              {
                role: "user",
                content: `Today's business meetings (${personalCount} personal/irrelevant items already excluded):\n${eventList}`,
              },
            ],
            max_completion_tokens: 200,
          });
          aiSummary = completion.choices[0]?.message?.content || "";
        } catch (err: any) {
          console.error("AI summary error:", err?.message);
        }
      }

      const meetingsWithBGP = events.filter((e: any) =>
        (e.attendees || []).some((a: any) => a.emailAddress?.address?.includes("brucegillinghampollard"))
      );

      res.json({
        summary: aiSummary || `You have ${events.length} meeting${events.length > 1 ? "s" : ""} today.`,
        events,
        totalMeetings: events.length,
        internalMeetings: meetingsWithBGP.length,
        externalMeetings: events.length - meetingsWithBGP.length,
      });
    } catch (err: any) {
      console.error("Calendar summary error:", err);
      res.status(500).json({ message: "Failed to generate calendar summary" });
    }
  });

  app.get("/api/microsoft/team-intelligence", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const { db } = await import("./db");
      const { users } = await import("@shared/schema");

      const teamMembers = await db.select().from(users);
      const emails = teamMembers
        .filter(u => u.email && u.email.includes("@brucegillinghampollard.com"))
        .map(u => ({ email: u.email!, name: u.name, team: u.team || "Unknown" }));

      if (emails.length === 0) {
        return res.json({ summary: "No team members found.", connections: [], schedules: [] });
      }

      const period = (req.query.period as string) || "week";
      const now = new Date();
      const endDate = new Date(now);
      if (period === "day") {
        endDate.setHours(23, 59, 59, 999);
      } else if (period === "month") {
        endDate.setDate(endDate.getDate() + 30);
      } else {
        endDate.setDate(endDate.getDate() + 7);
      }

      const scheduleRes = await fetch("https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: 'outlook.timezone="Europe/London"',
        },
        body: JSON.stringify({
          schedules: emails.map(e => e.email),
          startTime: { dateTime: now.toISOString(), timeZone: "Europe/London" },
          endTime: { dateTime: endDate.toISOString(), timeZone: "Europe/London" },
          availabilityViewInterval: 30,
        }),
      });

      if (!scheduleRes.ok) {
        if (scheduleRes.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired" });
        }
        throw new Error(`Schedule API error: ${scheduleRes.status}`);
      }

      const scheduleData = await scheduleRes.json();

      const PERSONAL_PATTERNS = /^(lunch|gym|dentist|doctor|haircut|pick up|drop off|school run|commute|walk|yoga|pilates|meditation|therapy|birthday|anniversary|personal|private|blocked|focus time|do not book|dnd|out of office|ooo|leave|holiday|annual leave|sick|wfh|working from home|travel|train|flight|uber|taxi|standup|stand-up|daily sync|daily catch-up|weekly sync|1:1|1-1|one-to-one|check.?in|team huddle|morning huddle|end of day|eod|wrap.?up)$/i;
      const RECURRING_ADMIN_PATTERNS = /^(standup|stand-up|daily sync|daily catch-up|weekly sync|team sync|team meeting|1:1|1-1|one-to-one|check.?in|sprint planning|sprint review|retro|retrospective|scrum|morning huddle|team huddle|weekly catch.?up|bi-weekly|fortnightly)$/i;

      const isSkippableEvent = (item: any) => {
        if (item.isPrivate) return true;
        if (item.status === "free" || item.status === "unknown") return true;
        const subj = (item.subject || "").trim();
        if (!subj || subj === "Busy" || subj === "No subject") return true;
        if (PERSONAL_PATTERNS.test(subj)) return true;
        if (RECURRING_ADMIN_PATTERNS.test(subj)) return true;
        return false;
      };

      const schedules = (scheduleData.value || []).map((schedule: any, idx: number) => {
        const member = emails.find(e => e.email.toLowerCase() === schedule.scheduleId?.toLowerCase()) || emails[idx];
        const allItems = (schedule.scheduleItems || []).map((item: any) => ({
          status: item.status,
          subject: item.subject || "Busy",
          location: item.location || "",
          start: item.start,
          end: item.end,
          isPrivate: item.isPrivate || false,
        }));
        return {
          email: schedule.scheduleId || member?.email,
          name: member?.name || schedule.scheduleId,
          team: member?.team || "Unknown",
          scheduleItems: allItems,
          workItems: allItems.filter((item: any) => !isSkippableEvent(item)),
        };
      });

      const externalContacts: Record<string, string[]> = {};
      const memberMeetings: Record<string, { subject: string; time: string }[]> = {};

      for (const sched of schedules) {
        memberMeetings[sched.name] = sched.workItems
          .map((item: any) => ({
            subject: item.subject,
            time: new Date(item.start?.dateTime || "").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
          }));
      }

      const connections: { members: string[]; commonSubjects: string[] }[] = [];
      const subjectsByMember: Record<string, Set<string>> = {};
      for (const sched of schedules) {
        subjectsByMember[sched.name] = new Set(
          sched.workItems
            .map((item: any) => item.subject)
        );
      }

      const memberNames = Object.keys(subjectsByMember);
      for (let i = 0; i < memberNames.length; i++) {
        for (let j = i + 1; j < memberNames.length; j++) {
          const common = Array.from(subjectsByMember[memberNames[i]]).filter(s =>
            subjectsByMember[memberNames[j]].has(s)
          );
          if (common.length > 0) {
            connections.push({
              members: [memberNames[i], memberNames[j]],
              commonSubjects: common.slice(0, 5),
            });
          }
        }
      }

      let aiSummary = "";

      {
        const { callClaude: callClaudeAI, CHATBGP_HELPER_MODEL: helperModel } = await import("./utils/anthropic-client");

        const periodLabel = period === "day" ? "today" : period === "month" ? "this month" : "this week";
        const meetingSummaries = schedules
          .filter((s: any) => s.workItems.length > 0)
          .map((s: any) => {
            const items = s.workItems
              .slice(0, 8)
              .map((item: any) => item.subject)
              .join(", ");
            return `${s.name} (${s.team}): ${s.workItems.length} work meetings${items ? ` — ${items}` : ""}`;
          })
          .join("\n");

        const connectionSummaries = connections
          .slice(0, 10)
          .map(c => `${c.members.join(" & ")}: ${c.commonSubjects.join(", ")}`)
          .join("\n");

        try {
          const completion = await callClaudeAI({
            model: helperModel,
            messages: [
              {
                role: "system",
                content: `You are an executive assistant for BGP (Bruce Gillingham Pollard), a London property consultancy. Give a very brief team diary summary for ${periodLabel}. Rules:
- The data below has already been pre-filtered to remove personal events, cancelled meetings, and recurring admin meetings. Only meaningful work meetings are included.
- Focus ONLY on significant client-facing work: external meetings, property viewings, pitches, deal negotiations, tenant meetings, investor calls, and site visits.
- IGNORE any remaining internal admin that slipped through: team syncs, 1:1s, standups, catch-ups, training sessions, IT meetings, or anything without a clear external client/deal context.
- IGNORE "Busy" blocks, annual leave, birthdays, personal appointments.
- Write 2-3 short bullet points maximum, each one line.
- Name the person, the meeting, and why it matters (e.g. "Rupert has a viewing at 45 Jermyn St with Watches of Switzerland — potential new tenant").
- If there are genuinely no significant work meetings, just say "Quiet day — no notable client or deal meetings scheduled."
- Never pad with filler. Be direct and useful.`,
              },
              {
                role: "user",
                content: `Team schedules ${periodLabel}:\n${meetingSummaries || "No meetings scheduled."}\n\nShared meetings (members attending the same events):\n${connectionSummaries || "No cross-team connections found."}`,
              },
            ],
            max_completion_tokens: 200,
          });
          aiSummary = completion.choices[0]?.message?.content || "";
        } catch (err: any) {
          console.error("Team intelligence AI error:", err?.message);
        }
      }

      const totalMeetings = schedules.reduce((sum: number, s: any) => sum + s.workItems.length, 0);
      const busiestMember = schedules.reduce((max: any, s: any) =>
        s.workItems.length > (max?.workItems?.length || 0) ? s : max
      , schedules[0]);

      res.json({
        summary: aiSummary || `${schedules.length} team members have ${totalMeetings} meetings ${period === "day" ? "today" : period === "month" ? "this month" : "this week"}.`,
        connections: connections.slice(0, 20),
        schedules: schedules.map((s: any) => ({
          name: s.name,
          team: s.team,
          email: s.email,
          meetingCount: s.scheduleItems.length,
          items: s.scheduleItems.slice(0, 10),
        })),
        stats: {
          totalMembers: schedules.length,
          totalMeetings,
          busiestMember: busiestMember ? { name: busiestMember.name, count: busiestMember.workItems.length } : null,
          crossTeamConnections: connections.length,
        },
        period,
      });
    } catch (err: any) {
      console.error("Team intelligence error:", err);
      res.status(500).json({ message: "Failed to generate team intelligence" });
    }
  });

  app.get("/api/microsoft/mail/folders", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const url = "https://graph.microsoft.com/v1.0/me/mailFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount,parentFolderId";
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        throw new Error(`Mail folders API error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data.value || []);
    } catch (err: any) {
      console.error("Mail folders error:", err);
      res.status(500).json({ message: "Failed to fetch mail folders" });
    }
  });

  app.get("/api/microsoft/mail/folders/:folderId/children", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const { folderId } = req.params;
      const url = `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/childFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount,parentFolderId`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        throw new Error(`Mail child folders API error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data.value || []);
    } catch (err: any) {
      console.error("Mail child folders error:", err);
      res.status(500).json({ message: "Failed to fetch child folders" });
    }
  });

  app.get("/api/microsoft/mail", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const folderId = req.query.folderId as string | undefined;
      const top = parseInt(req.query.top as string) || 50;
      const skip = parseInt(req.query.skip as string) || 0;
      let url: string;
      const select = "id,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments,importance,toRecipients,ccRecipients";
      if (folderId) {
        url = `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$top=${top}&$skip=${skip}&$orderby=receivedDateTime desc&$select=${select}`;
      } else {
        url = `https://graph.microsoft.com/v1.0/me/messages?$top=${top}&$skip=${skip}&$orderby=receivedDateTime desc&$select=${select}`;
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        throw new Error(`Mail API error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data.value || []);
    } catch (err: any) {
      console.error("Mail error:", err);
      res.status(500).json({ message: "Failed to fetch mail" });
    }
  });

  app.post("/api/microsoft/send-mail", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const { recipients, subject, body, ccRecipients, bccRecipients } = req.body;

      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ message: "At least one recipient is required" });
      }
      if (!subject || typeof subject !== "string") {
        return res.status(400).json({ message: "Subject is required" });
      }
      if (!body || typeof body !== "string") {
        return res.status(400).json({ message: "Body is required" });
      }

      const toRecipients = recipients.map((email: string) => ({
        emailAddress: { address: email.trim() },
      }));

      const cc = (ccRecipients || []).map((email: string) => ({
        emailAddress: { address: email.trim() },
      }));

      const bcc = (bccRecipients || []).map((email: string) => ({
        emailAddress: { address: email.trim() },
      }));

      const message: any = {
        subject,
        body: {
          contentType: "HTML",
          content: body,
        },
        toRecipients,
      };

      if (cc.length > 0) message.ccRecipients = cc;
      if (bcc.length > 0) message.bccRecipients = bcc;

      const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        const errorText = await response.text();
        console.error("Send mail error:", response.status, errorText);
        throw new Error(`Failed to send mail: ${response.status}`);
      }

      res.json({ success: true, message: `Email sent to ${recipients.length} recipient(s)` });
    } catch (err: any) {
      console.error("Send mail error:", err);
      res.status(500).json({ message: err.message || "Failed to send email" });
    }
  });

  app.get("/api/microsoft/mail/:messageId", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) return res.status(401).json({ message: "Not connected to Microsoft 365" });
    try {
      const url = `https://graph.microsoft.com/v1.0/me/messages/${req.params.messageId}?$select=id,subject,body,bodyPreview,from,receivedDateTime,isRead,hasAttachments,importance,toRecipients,ccRecipients`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        if (response.status === 401) { delete req.session.msTokens; return res.status(401).json({ message: "Token expired" }); }
        throw new Error(`Mail API error: ${response.status}`);
      }
      res.json(await response.json());
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch message" });
    }
  });

  app.patch("/api/microsoft/mail/:messageId/read", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) return res.status(401).json({ message: "Not connected to Microsoft 365" });
    try {
      const isRead = req.body.isRead !== undefined ? req.body.isRead : true;
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${req.params.messageId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isRead }),
      });
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update message" });
    }
  });

  app.delete("/api/microsoft/mail/:messageId", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) return res.status(401).json({ message: "Not connected to Microsoft 365" });
    try {
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${req.params.messageId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  async function getSharePointDriveId(token: string): Promise<{ driveId: string; siteId: string } | null> {
    const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`;
    const siteRes = await fetch(siteUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!siteRes.ok) return null;
    const site = await siteRes.json();

    const drivesUrl = `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`;
    const drivesRes = await fetch(drivesUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!drivesRes.ok) return null;
    const drivesData = await drivesRes.json();
    const docsDrive = drivesData.value?.find((d: any) => d.name === "Documents" || d.name === "Shared Documents") || drivesData.value?.[0];
    if (!docsDrive) return null;
    return { driveId: docsDrive.id, siteId: site.id };
  }

  app.post("/api/microsoft/folders", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const { name, parentId, driveId: reqDriveId } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Folder name is required" });
      }

      let driveId = reqDriveId;
      if (!driveId) {
        const spInfo = await getSharePointDriveId(token);
        if (!spInfo) {
          return res.status(404).json({ message: "Could not find SharePoint drive" });
        }
        driveId = spInfo.driveId;
      }

      const parentPath = parentId
        ? `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}/children`
        : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;

      const response = await fetch(parentPath, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          delete req.session.msTokens;
          return res.status(401).json({ message: "Microsoft token expired. Please reconnect." });
        }
        if (response.status === 409) {
          return res.status(409).json({ message: `Folder "${name}" already exists` });
        }
        const errText = await response.text();
        console.error("Create folder error:", response.status, errText);
        throw new Error(`Failed to create folder: ${response.status}`);
      }

      const folder = await response.json();
      res.json(folder);
    } catch (err: any) {
      console.error("Create folder error:", err);
      res.status(500).json({ message: err.message || "Failed to create folder" });
    }
  });

  const TEAM_FOLDERS = ["Investment", "London F&B", "London Retail", "Lease Advisory", "National Leasing", "Tenant Rep", "Development", "Office / Corporate"];

  const TEAM_FOLDER_TREES: Record<string, string[]> = {
    "Investment": [
      "Financial Analysis",
      "Financial Analysis/Cashflow Models",
      "Financial Analysis/Valuations",
      "Financial Analysis/Comparable Evidence",
      "Due Diligence",
      "Due Diligence/Title",
      "Due Diligence/Surveys",
      "Due Diligence/Environmental",
      "Due Diligence/Planning",
      "Legal",
      "Legal/Heads of Terms",
      "Legal/Contracts",
      "Legal/Searches",
      "Marketing",
      "Marketing/Brochure",
      "Marketing/Photography",
      "Marketing/Floorplans",
      "Correspondence",
      "Client Reporting",
    ],
    "London F&B": [
      "Marketing",
      "Marketing/Brochure",
      "Marketing/Photography",
      "Marketing/Floorplans",
      "Marketing/Window Cards",
      "Marketing/Social Media",
      "Heads of Terms",
      "Legal",
      "Legal/Lease Drafts",
      "Legal/Licence for Works",
      "Inspections",
      "Inspections/Measured Survey",
      "Inspections/Schedule of Condition",
      "Tenant Information",
      "Tenant Information/References",
      "Tenant Information/Accounts",
      "Comparable Evidence",
      "Correspondence",
      "Rent Review",
    ],
    "London Retail": [
      "Marketing",
      "Marketing/Brochure",
      "Marketing/Photography",
      "Marketing/Floorplans",
      "Marketing/Window Cards",
      "Marketing/Social Media",
      "Heads of Terms",
      "Legal",
      "Legal/Lease Drafts",
      "Legal/Licence for Works",
      "Inspections",
      "Inspections/Measured Survey",
      "Inspections/Schedule of Condition",
      "Tenant Information",
      "Tenant Information/References",
      "Tenant Information/Accounts",
      "Comparable Evidence",
      "Correspondence",
      "Rent Review",
    ],
    "Lease Advisory": [
      "Lease Documents",
      "Lease Documents/Current Lease",
      "Lease Documents/Supplements",
      "Lease Documents/Licences",
      "Rent Review",
      "Rent Review/Comparable Evidence",
      "Rent Review/Valuation",
      "Rent Review/Representations",
      "Rent Review/Determination",
      "Lease Renewal",
      "Lease Renewal/Section 25 Notice",
      "Lease Renewal/Counter Notice",
      "Lease Renewal/Heads of Terms",
      "Dilapidations",
      "Dilapidations/Schedule",
      "Dilapidations/Costings",
      "Dilapidations/Scott Schedule",
      "Service Charge",
      "Correspondence",
      "Legal",
    ],
    "National Leasing": [
      "Unit Plans",
      "Heads of Terms",
      "Target Lists",
      "Photos",
      "Supporting Documents",
    ],
    "Tenant Rep": [
      "Brief",
      "Brief/Requirements Schedule",
      "Brief/Budget Analysis",
      "Search",
      "Search/Long List",
      "Search/Short List",
      "Search/Viewing Notes",
      "Heads of Terms",
      "Legal",
      "Legal/Agreement for Lease",
      "Legal/Lease",
      "Fit-Out",
      "Fit-Out/Specifications",
      "Fit-Out/Tenders",
      "Fit-Out/Programme",
      "Comparable Evidence",
      "Correspondence",
      "Client Reporting",
    ],
    "Development": [
      "Project Folder",
      "Project Folder/Correspondence",
      "Project Folder/Clients",
      "Project Folder/Fees",
      "Project Folder/Original Pitch",
      "Project Folder/Reports",
      "Marketing Overview",
      "Marketing Overview/Brochure",
      "Marketing Overview/Plans (CADs & Specification)",
      "Marketing Overview/Service Charge",
      "Marketing Overview/Rent",
      "Marketing Overview/Goads",
      "Marketing Overview/Photos & CGIs",
      "Marketing Overview/Rateable Values & Rates",
      "Tenants & Leasing Schedules",
      "Tenants & Leasing Schedules/Target Tenants",
      "Tenants & Leasing Schedules/Client Update Schedules",
      "Heads of Terms",
      "Heads of Terms/Standard Draft HOTs",
      "Heads of Terms/Per Unit",
    ],
    "Office / Corporate": [
      "Legal",
      "Financials",
      "Marketing",
      "Correspondence",
      "Reports",
    ],
  };

  const COMPANY_FOLDER_TREES: Record<string, string[]> = {
    "Leasing": [
      "Crib Sheets",
      "Brochures",
      "Leasing Plans",
      "Fee Agreement",
      "General Landsec Documents",
      "Monthly Trading Updates",
    ],
    "Investment": [
      "Investment Memos",
      "Financial Analysis",
      "Due Diligence",
      "Correspondence",
      "Client Reporting",
    ],
    "Tenant Rep": [
      "Brief",
      "Search Reports",
      "Heads of Terms",
      "Legal",
      "Correspondence",
    ],
    "Development": [
      "Project Folder",
      "Project Folder/Correspondence",
      "Project Folder/Clients",
      "Project Folder/Fees",
      "Project Folder/Original Pitch",
      "Project Folder/Reports",
      "Marketing Overview",
      "Marketing Overview/Brochure",
      "Marketing Overview/Plans (CADs & Specification)",
      "Marketing Overview/Service Charge",
      "Marketing Overview/Rent",
      "Marketing Overview/Goads",
      "Marketing Overview/Photos & CGIs",
      "Marketing Overview/Rateable Values & Rates",
      "Tenants & Leasing Schedules",
      "Tenants & Leasing Schedules/Target Tenants",
      "Tenants & Leasing Schedules/Client Update Schedules",
      "Heads of Terms",
      "Heads of Terms/Standard Draft HOTs",
      "Heads of Terms/Per Unit",
    ],
  };

  async function createFolderByPath(token: string, driveId: string, parentPath: string, folderName: string): Promise<{ success: boolean; name: string; error?: string }> {
    let createUrl: string;
    if (!parentPath || parentPath === "/") {
      createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
    } else {
      const cleanPath = parentPath.replace(/^\/+|\/+$/g, "");
      createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}:/children`;
    }

    const response = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });

    if (response.ok || response.status === 409) {
      return { success: true, name: folderName };
    }
    const errText = await response.text();
    return { success: false, name: folderName, error: `${response.status}: ${errText.slice(0, 100)}` };
  }

  app.post("/api/microsoft/property-folders", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const { propertyName, team } = req.body;
      if (!propertyName || !team) {
        return res.status(400).json({ message: "propertyName and team are required" });
      }

      const folderTree = TEAM_FOLDER_TREES[team];
      if (!folderTree) {
        return res.status(400).json({ message: `Unknown team: ${team}. Valid teams: ${Object.keys(TEAM_FOLDER_TREES).join(", ")}` });
      }

      const spInfo = await getSharePointDriveId(token);
      if (!spInfo) {
        return res.status(404).json({ message: "Could not find BGP SharePoint site" });
      }

      const teamFolder = `${SHAREPOINT_ROOT_FOLDER}/${team}`;
      const propertyRoot = `${teamFolder}/${propertyName}`;

      const rootResult = await createFolderByPath(token, spInfo.driveId, teamFolder, propertyName);
      if (!rootResult.success) {
        return res.status(500).json({ message: `Failed to create property folder: ${rootResult.error}` });
      }

      const results: { path: string; success: boolean; error?: string }[] = [
        { path: propertyRoot, success: true },
      ];

      for (const subPath of folderTree) {
        const parts = subPath.split("/");
        const folderName = parts[parts.length - 1];
        const parentParts = parts.slice(0, -1);
        const parentPath = parentParts.length > 0
          ? `${propertyRoot}/${parentParts.join("/")}`
          : propertyRoot;

        const result = await createFolderByPath(token, spInfo.driveId, parentPath, folderName);
        results.push({
          path: `${propertyRoot}/${subPath}`,
          success: result.success,
          error: result.error,
        });
      }

      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      res.json({
        propertyName,
        team,
        rootPath: propertyRoot,
        totalFolders: results.length,
        created: successCount,
        errors: errorCount,
        details: results,
      });
    } catch (err: any) {
      console.error("Property folders error:", err);
      res.status(500).json({ message: "Failed to create property folder structure" });
    }
  });

  app.get("/api/microsoft/folder-templates", requireAuth, async (_req: Request, res: Response) => {
    const templates = Object.entries(TEAM_FOLDER_TREES).map(([team, paths]) => ({
      team,
      folderCount: paths.length + 1,
      structure: paths,
    }));
    res.json(templates);
  });

  app.get("/api/microsoft/company-folder-templates", requireAuth, async (_req: Request, res: Response) => {
    const templates = Object.entries(COMPANY_FOLDER_TREES).map(([template, paths]) => ({
      template,
      folderCount: paths.length + 1,
      structure: paths,
    }));
    res.json(templates);
  });

  app.post("/api/microsoft/company-folders", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      let { companyName, template } = req.body;
      if (!companyName || !template) {
        return res.status(400).json({ message: "companyName and template are required" });
      }
      companyName = String(companyName).trim().replace(/[\/\\<>:"|?*]/g, "_");
      if (!companyName) {
        return res.status(400).json({ message: "Invalid company name" });
      }

      const folderTree = COMPANY_FOLDER_TREES[template];
      if (!folderTree) {
        return res.status(400).json({ message: `Unknown template: ${template}. Valid templates: ${Object.keys(COMPANY_FOLDER_TREES).join(", ")}` });
      }

      const spInfo = await getSharePointDriveId(token);
      if (!spInfo) {
        return res.status(404).json({ message: "Could not find BGP SharePoint site" });
      }

      const companiesFolder = `${SHAREPOINT_ROOT_FOLDER}/Companies`;
      const companyRoot = `${companiesFolder}/${companyName}`;

      const parentResult = await createFolderByPath(token, spInfo.driveId, SHAREPOINT_ROOT_FOLDER, "Companies");
      if (!parentResult.success) {
        return res.status(500).json({ message: `Failed to create Companies folder: ${parentResult.error}` });
      }

      const rootResult = await createFolderByPath(token, spInfo.driveId, companiesFolder, companyName);
      if (!rootResult.success) {
        return res.status(500).json({ message: `Failed to create company folder: ${rootResult.error}` });
      }

      const results: { path: string; success: boolean; error?: string }[] = [
        { path: companyRoot, success: true },
      ];

      for (const subPath of folderTree) {
        const parts = subPath.split("/");
        const folderName = parts[parts.length - 1];
        const parentParts = parts.slice(0, -1);
        const parentPath = parentParts.length > 0
          ? `${companyRoot}/${parentParts.join("/")}`
          : companyRoot;

        const result = await createFolderByPath(token, spInfo.driveId, parentPath, folderName);
        results.push({
          path: `${companyRoot}/${subPath}`,
          success: result.success,
          error: result.error,
        });
      }

      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      res.json({
        companyName,
        template,
        rootPath: companyRoot,
        totalFolders: results.length,
        created: successCount,
        errors: errorCount,
        details: results,
      });
    } catch (err: any) {
      console.error("Company folders error:", err);
      res.status(500).json({ message: "Failed to create company folder structure" });
    }
  });

  app.post("/api/microsoft/team-folders/setup", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const spInfo = await getSharePointDriveId(token);
      if (!spInfo) {
        return res.status(404).json({ message: "Could not find BGP SharePoint site. Make sure you have access." });
      }

      const results: { name: string; status: string; id?: string; webUrl?: string }[] = [];

      for (const teamName of TEAM_FOLDERS) {
        try {
          const cleanParent = SHAREPOINT_ROOT_FOLDER.replace(/^\/+|\/+$/g, "");
          const createUrl = `https://graph.microsoft.com/v1.0/drives/${spInfo.driveId}/root:/${encodeURIComponent(cleanParent).replace(/%2F/g, "/")}:/children`;
          const createRes = await fetch(
            createUrl,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: teamName,
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail",
              }),
            }
          );

          if (createRes.ok) {
            const folder = await createRes.json();
            results.push({ name: teamName, status: "created", id: folder.id, webUrl: folder.webUrl });
          } else if (createRes.status === 409) {
            const teamPath = `${SHAREPOINT_ROOT_FOLDER}/${teamName}`;
            const existingRes = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${spInfo.driveId}/root:/${encodeURIComponent(teamPath).replace(/%2F/g, "/")}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (existingRes.ok) {
              const existing = await existingRes.json();
              results.push({ name: teamName, status: "exists", id: existing.id, webUrl: existing.webUrl });
            } else {
              results.push({ name: teamName, status: "exists" });
            }
          } else {
            const errText = await createRes.text();
            console.error(`Failed to create ${teamName} folder:`, createRes.status, errText);
            results.push({ name: teamName, status: "error" });
          }
        } catch (folderErr: any) {
          console.error(`Error creating ${teamName} folder:`, folderErr);
          results.push({ name: teamName, status: "error" });
        }
      }

      res.json({ folders: results, driveId: spInfo.driveId });
    } catch (err: any) {
      console.error("Team folders setup error:", err);
      res.status(500).json({ message: "Failed to set up team folders" });
    }
  });

  app.get("/api/microsoft/property-folders/:team/:propertyName", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const { team, propertyName } = req.params;
      const subPath = req.query.path as string || "";
      const folderUrl = (req.query.folderUrl as string || "").trim();

      // If the caller has a stored SharePoint folder URL on the CRM property
      // (crm_properties.sharepoint_folder_url) prefer that — it always
      // resolves to the real folder regardless of whether the CRM record's
      // `name` matches the on-disk folder name. Falls back to path
      // synthesis (BGP share drive/{team}/{propertyName}) if no URL.
      if (folderUrl) {
        const encoded = Buffer.from(folderUrl).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const driveItemRes = await fetch(`https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!driveItemRes.ok) {
          if (driveItemRes.status === 404) return res.json({ exists: false, folders: [] });
          throw new Error(`Failed to resolve folder URL: ${driveItemRes.status}`);
        }
        const driveItem = await driveItemRes.json();
        const driveId = driveItem.parentReference?.driveId;
        let itemId = driveItem.id;
        // Walk into subPath if requested.
        if (subPath && driveId) {
          const encodedSub = subPath.split("/").map(s => encodeURIComponent(s)).join("/");
          const subRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}:/${encodedSub}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!subRes.ok) {
            if (subRes.status === 404) return res.json({ exists: false, folders: [] });
            throw new Error(`Failed to walk into subPath: ${subRes.status}`);
          }
          const subItem = await subRes.json();
          itemId = subItem.id;
        }
        const childrenRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=100`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!childrenRes.ok) throw new Error(`Failed to list children: ${childrenRes.status}`);
        const childrenData = await childrenRes.json();
        const items = (childrenData.value || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          isFolder: !!item.folder,
          childCount: item.folder?.childCount || 0,
          size: item.size || 0,
          webUrl: item.webUrl,
          lastModified: item.lastModifiedDateTime,
        }));
        return res.json({ exists: true, folders: items, path: driveItem.name, webUrl: driveItem.webUrl, source: "url" });
      }

      const spInfo = await getSharePointDriveId(token);
      if (!spInfo) {
        return res.status(404).json({ message: "Could not find BGP SharePoint site" });
      }

      let folderPath = `${SHAREPOINT_ROOT_FOLDER}/${team}/${propertyName}`;
      if (subPath) folderPath = `${folderPath}/${subPath}`;
      const encodedPath = folderPath.split("/").map(s => encodeURIComponent(s)).join("/");
      const url = `https://graph.microsoft.com/v1.0/drives/${spInfo.driveId}/root:/${encodedPath}:/children?$top=100`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return res.json({ exists: false, folders: [] });
        }
        throw new Error(`Failed to list folders: ${response.status}`);
      }

      const data = await response.json();
      const items = (data.value || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        isFolder: !!item.folder,
        childCount: item.folder?.childCount || 0,
        size: item.size || 0,
        webUrl: item.webUrl,
        lastModified: item.lastModifiedDateTime,
      }));

      res.json({ exists: true, folders: items, path: folderPath, source: "path" });
    } catch (err: any) {
      console.error("Property folders list error:", err);
      res.status(500).json({ message: "Failed to list property folders" });
    }
  });

  app.get("/api/microsoft/team-folders", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const spInfo = await getSharePointDriveId(token);
      if (!spInfo) {
        return res.status(404).json({ message: "Could not find BGP SharePoint site" });
      }

      const folders: { name: string; id: string; webUrl: string; childCount: number }[] = [];

      for (const teamName of TEAM_FOLDERS) {
        try {
          const res = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${spInfo.driveId}/root:/${encodeURIComponent(teamName)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (res.ok) {
            const item = await res.json();
            if (item.folder) {
              folders.push({
                name: item.name,
                id: item.id,
                webUrl: item.webUrl,
                childCount: item.folder.childCount || 0,
              });
            }
          }
        } catch {}
      }

      res.json({ folders, driveId: spInfo.driveId });
    } catch (err: any) {
      console.error("Team folders error:", err);
      res.status(500).json({ message: "Failed to fetch team folders" });
    }
  });

  app.get("/api/microsoft/company-folders/browse", async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const companyName = req.query.company as string;
      const subPath = req.query.path as string || "";
      if (!companyName) {
        return res.status(400).json({ message: "company query param is required" });
      }

      const spInfo = await getSharePointDriveId(token);
      if (!spInfo) {
        return res.status(404).json({ message: "Could not find BGP SharePoint site" });
      }

      let folderPath = `${SHAREPOINT_ROOT_FOLDER}/Companies/${companyName}`;
      if (subPath) {
        folderPath = `${folderPath}/${subPath}`;
      }

      const encodedPath = folderPath.split("/").map(s => encodeURIComponent(s)).join("/");
      const url = `https://graph.microsoft.com/v1.0/drives/${spInfo.driveId}/root:/${encodedPath}:/children?$top=200&$orderby=name`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return res.json({ exists: false, items: [], path: folderPath });
        }
        throw new Error(`Failed to browse: ${response.status}`);
      }

      const data = await response.json();
      const items = (data.value || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        isFolder: !!item.folder,
        childCount: item.folder?.childCount || 0,
        size: item.size || 0,
        webUrl: item.webUrl,
        lastModified: item.lastModifiedDateTime,
        mimeType: item.file?.mimeType,
      }));

      res.json({ exists: true, items, path: folderPath });
    } catch (err: any) {
      console.error("Company folder browse error:", err);
      res.status(500).json({ message: "Failed to browse company folders" });
    }
  });

  const fileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.post("/api/microsoft/files/upload", fileUpload.single("file"), async (req: Request, res: Response) => {
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file provided" });

      const driveId = req.body.driveId as string;
      const folderId = req.body.folderId as string;
      const folderPath = req.body.folderPath as string;

      if (!driveId && !folderPath) {
        const spInfo = await getSharePointDriveId(token);
        if (!spInfo) return res.status(404).json({ message: "Could not find SharePoint site" });

        const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${spInfo.driveId}/root:/${encodeURIComponent(SHAREPOINT_ROOT_FOLDER)}/${encodeURIComponent(file.originalname)}:/content`;
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": file.mimetype || "application/octet-stream",
          },
          body: file.buffer,
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.text();
          return res.status(uploadRes.status).json({ message: `Upload failed: ${err.slice(0, 200)}` });
        }

        const result = await uploadRes.json();
        return res.json({ id: result.id, name: result.name, webUrl: result.webUrl, size: result.size });
      }

      let uploadUrl: string;
      if (folderId) {
        uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(file.originalname)}:/content`;
      } else if (folderPath) {
        const spInfo = await getSharePointDriveId(token);
        const drive = driveId || spInfo?.driveId;
        if (!drive) return res.status(404).json({ message: "Could not find SharePoint drive" });
        const cleanPath = folderPath.replace(/^\/+|\/+$/g, "");
        uploadUrl = `https://graph.microsoft.com/v1.0/drives/${drive}/root:/${cleanPath}/${encodeURIComponent(file.originalname)}:/content`;
      } else {
        uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(file.originalname)}:/content`;
      }

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": file.mimetype || "application/octet-stream",
        },
        body: file.buffer,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return res.status(uploadRes.status).json({ message: `Upload failed: ${err.slice(0, 200)}` });
      }

      const result = await uploadRes.json();
      res.json({ id: result.id, name: result.name, webUrl: result.webUrl, size: result.size });
    } catch (err: any) {
      console.error("File upload error:", err);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });
}
