import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import crypto from "crypto";
import { pool } from "./db";

const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const CANVA_API_BASE = "https://api.canva.com/rest/v1";

declare module "express-session" {
  interface SessionData {
    canvaTokens?: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };
    canvaOAuthState?: string;
    canvaCodeVerifier?: string;
  }
}

function getRedirectUri(req: Request): string {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}/api/canva/callback`;
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function refreshCanvaToken(session: any): Promise<string | null> {
  if (!session.canvaTokens) return null;

  if (Date.now() < session.canvaTokens.expiresAt - 60000) {
    return session.canvaTokens.accessToken;
  }

  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(CANVA_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.canvaTokens.refreshToken,
      }),
    });

    if (!res.ok) {
      console.error("Canva token refresh failed:", await res.text());
      session.canvaTokens = undefined;
      return null;
    }

    const data = await res.json();
    session.canvaTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || session.canvaTokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
    return data.access_token;
  } catch (err) {
    console.error("Canva token refresh error:", err);
    session.canvaTokens = undefined;
    return null;
  }
}

async function canvaApi(session: any, path: string, options: RequestInit = {}): Promise<any> {
  const token = await refreshCanvaToken(session);
  if (!token) throw new Error("Not connected to Canva");

  const url = `${CANVA_API_BASE}${path}`;
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
    console.error(`Canva API error ${res.status}:`, errText);
    throw new Error(`Canva API error: ${res.status}`);
  }

  return res.json();
}

export function setupCanvaRoutes(app: Express) {
  app.get("/api/canva/status", requireAuth, async (req: Request, res: Response) => {
    const token = await refreshCanvaToken(req.session);
    res.json({ connected: !!token });
  });

  app.get("/api/canva/auth", requireAuth, async (req: Request, res: Response) => {
    const clientId = process.env.CANVA_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ message: "Canva Client ID not configured" });
    }

    const state = crypto.randomBytes(32).toString("hex");
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());

    req.session.canvaOAuthState = state;
    req.session.canvaCodeVerifier = codeVerifier;

    const redirectUri = getRedirectUri(req);
    console.log("[Canva] Auth redirect_uri:", redirectUri);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: "design:content:read design:content:write design:meta:read asset:read asset:write brandtemplate:content:read brandtemplate:content:write brandtemplate:meta:read",
    });

    req.session.save((err) => {
      if (err) console.error("[Canva] Session save error:", err);
      res.json({ url: `${CANVA_AUTH_URL}?${params.toString()}` });
    });
  });

  app.get("/api/canva/callback", async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;
    console.log("[Canva] Callback received (state present:", !!state, "code present:", !!code, ")");

    if (error) {
      console.error("[Canva] Authorization error:", error, error_description);
      return res.redirect(`/templates?canva_error=${encodeURIComponent(String(error_description || error))}`);
    }

    if (!code) {
      console.error("[Canva] No authorization code received");
      return res.redirect("/templates?canva_error=no_code_received");
    }

    if (!state || state !== req.session.canvaOAuthState) {
      return res.redirect("/templates?canva_error=invalid_state");
    }

    const clientId = process.env.CANVA_CLIENT_ID;
    const clientSecret = process.env.CANVA_CLIENT_SECRET;
    const codeVerifier = req.session.canvaCodeVerifier;

    if (!clientId || !clientSecret || !codeVerifier) {
      return res.redirect("/templates?canva_error=missing_config");
    }

    try {
      const callbackRedirectUri = getRedirectUri(req);
      console.log("[Canva] Callback redirect_uri:", callbackRedirectUri);
      console.log("[Canva] Authorization code received");

      const tokenRes = await fetch(CANVA_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: callbackRedirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("Canva token exchange failed:", errText);
        return res.redirect("/templates?canva_error=token_failed");
      }

      const data = await tokenRes.json();
      req.session.canvaTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      };

      delete req.session.canvaOAuthState;
      delete req.session.canvaCodeVerifier;

      res.redirect("/templates?canva=connected");
    } catch (err: any) {
      console.error("Canva OAuth callback error:", err);
      res.redirect("/templates?canva_error=callback_failed");
    }
  });

  app.post("/api/canva/disconnect", requireAuth, async (req: Request, res: Response) => {
    req.session.canvaTokens = undefined;
    res.json({ success: true });
  });

  app.get("/api/canva/brand-templates", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await canvaApi(req.session, "/brand-templates", { method: "GET" });
      const templates = (data.items || []).map((t: any) => ({
        id: t.id,
        title: t.title || "Untitled",
        thumbnail: t.thumbnail?.url || null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));
      res.json(templates);
    } catch (err: any) {
      if (err.message.includes("Not connected")) {
        return res.status(401).json({ message: "Not connected to Canva" });
      }
      console.error("Canva brand templates error:", err);
      res.status(500).json({ message: "Failed to fetch brand templates" });
    }
  });

  app.get("/api/canva/designs", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await canvaApi(req.session, "/designs", { method: "GET" });
      const designs = (data.items || []).map((d: any) => ({
        id: d.id,
        title: d.title || "Untitled",
        thumbnail: d.thumbnail?.url || null,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        urls: d.urls || {},
      }));
      res.json(designs);
    } catch (err: any) {
      if (err.message.includes("Not connected")) {
        return res.status(401).json({ message: "Not connected to Canva" });
      }
      console.error("Canva designs error:", err);
      res.status(500).json({ message: "Failed to fetch designs" });
    }
  });

  app.post("/api/canva/autofill", requireAuth, async (req: Request, res: Response) => {
    try {
      const { brandTemplateId, data: fillData, title } = req.body;

      if (!brandTemplateId) {
        return res.status(400).json({ message: "Brand template ID is required" });
      }

      const token = await refreshCanvaToken(req.session);
      if (!token) {
        return res.status(401).json({ message: "Not connected to Canva. Please reconnect.", needsAuth: true });
      }

      const datasetRes = await fetch(`${CANVA_API_BASE}/brand-templates/${brandTemplateId}/dataset`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      let availableFields: string[] = [];
      if (datasetRes.ok) {
        const dsData = await datasetRes.json();
        const dataset = dsData.dataset || {};
        availableFields = Object.keys(dataset);
        console.log("[Canva] Template dataset fields:", availableFields);
      } else {
        const dsErr = await datasetRes.text();
        console.warn("[Canva] Dataset fetch failed:", datasetRes.status, dsErr);
        if (datasetRes.status === 404) {
          return res.status(400).json({
            message: "This Canva template has no autofill placeholders. Open the template in Canva, select text elements, and use 'Connect data' to create named placeholders (e.g. title, address, description). Then try again.",
            code: "no_fillable_fields",
          });
        }
      }

      if (availableFields.length === 0) {
        return res.status(400).json({
          message: "This Canva template has no autofill placeholders. Open the template in Canva, select text elements, and use 'Connect data' to create named placeholders (e.g. title, address, description). Then try again.",
          code: "no_fillable_fields",
        });
      }

      const autofillBody: any = {
        brand_template_id: brandTemplateId,
        data: {},
      };

      if (title) {
        autofillBody.title = title;
      }

      if (fillData && typeof fillData === "object") {
        for (const fieldName of availableFields) {
          const value = (fillData as Record<string, any>)[fieldName];
          if (value) {
            if (typeof value === "string") {
              autofillBody.data[fieldName] = { type: "text", text: value };
            } else if (value && typeof value === "object" && (value as any).type === "image") {
              autofillBody.data[fieldName] = { type: "image", asset_id: (value as any).asset_id };
            }
          }
        }
      }

      if (Object.keys(autofillBody.data).length === 0 && fillData && typeof fillData === "object") {
        const allContent = Object.values(fillData)
          .filter((v): v is string => typeof v === "string")
          .join("\n\n");
        for (const fieldName of availableFields) {
          autofillBody.data[fieldName] = { type: "text", text: allContent };
        }
      }

      console.log("[Canva] Autofill request - available fields:", availableFields, "sending fields:", Object.keys(autofillBody.data));

      const apiRes = await fetch(`${CANVA_API_BASE}/autofills`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(autofillBody),
      });

      const responseText = await apiRes.text();
      console.log("[Canva] Autofill response status:", apiRes.status, "body:", responseText.slice(0, 500));

      if (!apiRes.ok) {
        let errorMessage = "Canva autofill failed";
        try {
          const errData = JSON.parse(responseText);
          errorMessage = errData.error?.message || errData.message || `Canva API error ${apiRes.status}`;
        } catch { errorMessage = `Canva API error ${apiRes.status}: ${responseText.slice(0, 200)}`; }
        return res.status(apiRes.status).json({ message: errorMessage });
      }

      const result = JSON.parse(responseText);
      res.json({
        jobId: result.job?.id,
        status: result.job?.status || "in_progress",
        designId: result.job?.result?.design?.id || null,
      });
    } catch (err: any) {
      console.error("Canva autofill error:", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to create autofill job" });
    }
  });

  app.get("/api/canva/property-data/:propertyId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { propertyId } = req.params;

      const propResult = await pool.query(
        `SELECT p.*, c.name as landlord_name, c.email as landlord_email, c.phone as landlord_phone
         FROM crm_properties p
         LEFT JOIN crm_contacts c ON c.id = p.landlord_id
         WHERE p.id = $1`,
        [propertyId]
      );
      const property = propResult.rows[0];
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const dealsResult = await pool.query(
        `SELECT d.*, 
           t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone,
           cc.name as client_contact_name, cc.email as client_contact_email
         FROM crm_deals d
         LEFT JOIN crm_contacts t ON t.id = d.tenant_id
         LEFT JOIN crm_contacts cc ON cc.id = d.client_contact_id
         WHERE d.property_id = $1
         ORDER BY d.created_at DESC
         LIMIT 5`,
        [propertyId]
      );

      const agentsResult = await pool.query(
        `SELECT u.name, u.email FROM users u
         WHERE u.name = ANY(
           SELECT unnest(internal_agent) FROM crm_deals WHERE property_id = $1
         )`,
        [propertyId]
      );

      const address = property.address || {};
      const addressStr = [address.line1, address.line2, address.city, address.postcode]
        .filter(Boolean).join(", ");

      const latestDeal = dealsResult.rows[0];
      const agents = agentsResult.rows;

      const canvaFields: Record<string, string> = {
        property_name: property.name || "",
        property_address: addressStr || property.name || "",
        address_line_1: address.line1 || address.street || property.name || "",
        address_line_2: address.line2 || "",
        city: address.city || "London",
        postcode: address.postcode || "",
        asset_class: property.asset_class || "",
        tenure: property.tenure || "",
        sqft: property.sqft ? `${Number(property.sqft).toLocaleString()} sq ft` : "",
        sqm: property.sqft ? `${Math.round(Number(property.sqft) * 0.0929).toLocaleString()} sq m` : "",
        total_area: property.sqft ? `${Number(property.sqft).toLocaleString()} sq ft (${Math.round(Number(property.sqft) * 0.0929).toLocaleString()} sq m)` : "",
        status: property.status || "",
        landlord_name: property.landlord_name || "",
        landlord_email: property.landlord_email || "",
        landlord_phone: property.landlord_phone || "",
        notes: property.notes || "",
        bgp_engagement: (property.bgp_engagement || []).join(", "),
      };

      if (latestDeal) {
        const d = latestDeal;
        canvaFields.deal_name = d.name || "";
        canvaFields.deal_type = d.deal_type || "";
        canvaFields.deal_status = d.status || "";
        canvaFields.tenant_name = d.tenant_name || "";
        canvaFields.tenant_email = d.tenant_email || "";
        canvaFields.tenant_phone = d.tenant_phone || "";
        canvaFields.client_contact = d.client_contact_name || "";
        canvaFields.client_email = d.client_contact_email || "";
        canvaFields.rent_pa = d.rent_pa ? `£${Number(d.rent_pa).toLocaleString()} per annum` : "";
        canvaFields.rent_amount = d.rent_pa ? `£${Number(d.rent_pa).toLocaleString()}` : "";
        canvaFields.pricing = d.pricing ? `£${Number(d.pricing).toLocaleString()}` : "";
        canvaFields.guide_price = d.pricing ? `£${Number(d.pricing).toLocaleString()}` : "";
        canvaFields.price_psf = d.price_psf ? `£${Number(d.price_psf).toFixed(2)} per sq ft` : "";
        canvaFields.yield_percent = d.yield_percent ? `${Number(d.yield_percent).toFixed(2)}%` : "";
        canvaFields.niy = d.yield_percent ? `${Number(d.yield_percent).toFixed(2)}%` : "";
        canvaFields.lease_length = d.lease_length ? `${d.lease_length} years` : "";
        canvaFields.break_option = d.break_option ? `Year ${d.break_option}` : "";
        canvaFields.rent_free = d.rent_free ? `${d.rent_free} months` : "";
        canvaFields.completion_date = d.completed_at
          ? new Date(d.completed_at).toLocaleDateString("en-GB")
          : (d.target_date ? new Date(d.target_date).toLocaleDateString("en-GB") : "");
        canvaFields.fee = d.fee ? `£${Number(d.fee).toLocaleString()}` : "";
        canvaFields.total_area_sqft = d.total_area_sqft ? `${Number(d.total_area_sqft).toLocaleString()} sq ft` : "";
        canvaFields.gf_area = d.gf_area_sqft ? `${Number(d.gf_area_sqft).toLocaleString()} sq ft` : "";
        canvaFields.basement_area = d.basement_area_sqft ? `${Number(d.basement_area_sqft).toLocaleString()} sq ft` : "";
        canvaFields.ff_area = d.ff_area_sqft ? `${Number(d.ff_area_sqft).toLocaleString()} sq ft` : "";
        canvaFields.ground_floor = d.gf_area_sqft ? `Ground Floor: ${Number(d.gf_area_sqft).toLocaleString()} sq ft (${Math.round(Number(d.gf_area_sqft) * 0.0929).toLocaleString()} sq m)` : "";
        canvaFields.basement = d.basement_area_sqft ? `Basement: ${Number(d.basement_area_sqft).toLocaleString()} sq ft (${Math.round(Number(d.basement_area_sqft) * 0.0929).toLocaleString()} sq m)` : "";
        canvaFields.first_floor = d.ff_area_sqft ? `First Floor: ${Number(d.ff_area_sqft).toLocaleString()} sq ft (${Math.round(Number(d.ff_area_sqft) * 0.0929).toLocaleString()} sq m)` : "";
        canvaFields.capital_contribution = d.capital_contribution ? `£${Number(d.capital_contribution).toLocaleString()}` : "";
        canvaFields.comments = d.comments || "";
      }

      if (agents.length > 0) {
        canvaFields.agent_1_name = agents[0]?.name || "";
        canvaFields.agent_1_email = agents[0]?.email || "";
        canvaFields.agent_2_name = agents[1]?.name || "";
        canvaFields.agent_2_email = agents[1]?.email || "";
        canvaFields.agents = agents.map((a: any) => a.name).join(", ");
      }

      canvaFields.company_name = "Bruce Gillingham Pollard";
      canvaFields.company_website = "www.brucegillinghampollard.com";
      canvaFields.company_phone = "+44 (0)20 7629 4175";
      canvaFields.company_address = "68 Brook Street, Mayfair, London W1K 5NR";

      const cleanFields: Record<string, string> = {};
      for (const [k, v] of Object.entries(canvaFields)) {
        if (v) cleanFields[k] = v;
      }

      res.json({
        property,
        deals: dealsResult.rows,
        agents,
        canvaFields: cleanFields,
      });
    } catch (err: any) {
      console.error("Canva property data error:", err);
      res.status(500).json({ message: "Failed to fetch property data" });
    }
  });

  app.get("/api/canva/properties/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string || "").trim();
      let query = `SELECT id, name, status, sqft, tenure, asset_class, address FROM crm_properties`;
      const params: any[] = [];
      if (q) {
        query += ` WHERE LOWER(name) LIKE $1`;
        params.push(`%${q.toLowerCase()}%`);
      }
      query += ` ORDER BY name LIMIT 20`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err: any) {
      console.error("Property search error:", err);
      res.status(500).json({ message: "Failed to search properties" });
    }
  });

  app.get("/api/canva/autofill/:jobId", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await canvaApi(req.session, `/autofills/${req.params.jobId}`, { method: "GET" });
      res.json({
        jobId: result.job?.id,
        status: result.job?.status || "in_progress",
        designId: result.job?.result?.design?.id || null,
        designUrl: result.job?.result?.design?.urls?.edit_url || null,
        viewUrl: result.job?.result?.design?.urls?.view_url || null,
      });
    } catch (err: any) {
      console.error("Canva autofill status error:", err);
      res.status(500).json({ message: "Failed to check autofill status" });
    }
  });

  app.post("/api/canva/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const { designId, format } = req.body;
      if (!designId) {
        return res.status(400).json({ message: "Design ID is required" });
      }

      const exportBody: any = {
        design_id: designId,
        format: {
          type: format || "pdf",
        },
      };

      if (format === "png" || format === "jpg") {
        exportBody.format.quality = "regular";
        exportBody.format.size = "a4";
      }

      const result = await canvaApi(req.session, "/exports", {
        method: "POST",
        body: JSON.stringify(exportBody),
      });

      res.json({
        jobId: result.job?.id,
        status: result.job?.status || "in_progress",
      });
    } catch (err: any) {
      console.error("Canva export error:", err);
      res.status(500).json({ message: "Failed to export design" });
    }
  });

  app.get("/api/canva/export/:jobId", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await canvaApi(req.session, `/exports/${req.params.jobId}`, { method: "GET" });
      res.json({
        jobId: result.job?.id,
        status: result.job?.status || "in_progress",
        urls: result.job?.result?.urls || [],
      });
    } catch (err: any) {
      console.error("Canva export status error:", err);
      res.status(500).json({ message: "Failed to check export status" });
    }
  });

  app.get("/api/canva/brand-templates/:id/dataset", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await canvaApi(req.session, `/brand-templates/${req.params.id}/dataset`, { method: "GET" });
      res.json(result.dataset || {});
    } catch (err: any) {
      console.error("Canva template dataset error:", err);
      res.status(500).json({ message: "Failed to fetch template dataset" });
    }
  });

  app.post("/api/canva/create-design", requireAuth, async (req: Request, res: Response) => {
    try {
      const { title, content, designType } = req.body;
      if (!title) {
        return res.status(400).json({ message: "Title is required" });
      }

      const token = await refreshCanvaToken(req.session);
      if (!token) {
        return res.status(401).json({ message: "Not connected to Canva. Please connect your Canva account first.", needsAuth: true });
      }

      const sizePresets: Record<string, { width: number; height: number }> = {
        "brochure": { width: 595, height: 842 },
        "marketing": { width: 595, height: 842 },
        "letter": { width: 595, height: 842 },
        "report": { width: 595, height: 842 },
        "presentation": { width: 1920, height: 1080 },
        "social": { width: 1080, height: 1080 },
      };

      const size = sizePresets[designType || "brochure"] || sizePresets["brochure"];

      const designBody: any = {
        design_type: {
          type: "custom_size",
          width: size.width,
          height: size.height,
        },
        title: title,
      };

      const result = await canvaApi(req.session, "/designs", {
        method: "POST",
        body: JSON.stringify(designBody),
      });

      const design = result.design || result;

      res.json({
        designId: design.id,
        title: design.title || title,
        editUrl: design.urls?.edit_url || null,
        viewUrl: design.urls?.view_url || null,
        thumbnailUrl: design.thumbnail?.url || null,
      });
    } catch (err: any) {
      console.error("Canva create design error:", err);
      res.status(500).json({ message: err.message || "Failed to create Canva design" });
    }
  });

  app.post("/api/canva/upload-asset", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, url: assetUrl } = req.body;
      if (!assetUrl) {
        return res.status(400).json({ message: "Asset URL is required" });
      }

      const token = await refreshCanvaToken(req.session);
      if (!token) {
        return res.status(401).json({ message: "Not connected to Canva", needsAuth: true });
      }

      const result = await canvaApi(req.session, "/asset-uploads", {
        method: "POST",
        body: JSON.stringify({
          name_base64: Buffer.from(name || "asset").toString("base64"),
          content_type: "image/png",
          url: assetUrl,
        }),
      });

      res.json({
        jobId: result.job?.id,
        status: result.job?.status || "in_progress",
        assetId: result.job?.result?.asset?.id || null,
      });
    } catch (err: any) {
      console.error("Canva asset upload error:", err);
      res.status(500).json({ message: "Failed to upload asset to Canva" });
    }
  });
}
