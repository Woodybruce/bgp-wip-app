import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { db } from "./db";
import { pool } from "./db";
import {
  crmDeals,
  crmContacts,
  crmCompanies,
  crmProperties,
  investmentTracker,
  availableUnits,
  crmComps,
  excelTemplates,
  excelModelRuns,
} from "@shared/schema";
import { ilike, or, eq, desc, sql } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { getAppToken } from "./shared-mailbox";
import {
  browseSharePointFolder,
  getSharePointDriveId,
} from "./utils/sharepoint-operations";

function buildFuzzyOr(cols: any[], query: string) {
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  const exactQ = `%${query}%`;
  const wordPatterns = words.map((w) => `%${w}%`);
  const conditions: any[] = [];
  for (const col of cols) {
    conditions.push(ilike(col, exactQ));
    for (const wp of wordPatterns) conditions.push(ilike(col, wp));
  }
  return or(...conditions);
}

function createBgpMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "BGP Dashboard",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.tool(
    "search_crm",
    "Search across the BGP CRM — finds deals, contacts, companies, properties, investment tracker items, available units, requirements, and comps by keyword. Uses fuzzy matching.",
    {
      query: z.string().describe("Search term (minimum 2 characters)"),
      entityType: z
        .enum([
          "all",
          "deals",
          "contacts",
          "companies",
          "properties",
          "investment",
          "units",
          "requirements",
          "comps",
        ])
        .optional()
        .default("all")
        .describe("Filter to a specific entity type, or search all"),
    },
    async ({ query, entityType }) => {
      if (query.trim().length < 2) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Search term too short — please use at least 2 characters.",
            },
          ],
        };
      }
      const rawQuery = query.trim();
      const results: any = {};

      if (entityType === "all" || entityType === "deals") {
        results.deals = await db
          .select({
            id: crmDeals.id,
            name: crmDeals.name,
            groupName: crmDeals.groupName,
            status: crmDeals.status,
          })
          .from(crmDeals)
          .where(buildFuzzyOr([crmDeals.name, crmDeals.comments], rawQuery))
          .limit(15);
      }
      if (entityType === "all" || entityType === "contacts") {
        results.contacts = await db
          .select({
            id: crmContacts.id,
            name: crmContacts.name,
            email: crmContacts.email,
            role: crmContacts.role,
          })
          .from(crmContacts)
          .where(
            buildFuzzyOr([crmContacts.name, crmContacts.email], rawQuery)
          )
          .limit(15);
      }
      if (entityType === "all" || entityType === "companies") {
        results.companies = await db
          .select({
            id: crmCompanies.id,
            name: crmCompanies.name,
            companyType: crmCompanies.companyType,
          })
          .from(crmCompanies)
          .where(buildFuzzyOr([crmCompanies.name], rawQuery))
          .limit(15);
      }
      if (entityType === "all" || entityType === "properties") {
        const addressText = sql`${crmProperties.address}::text`;
        const words = rawQuery
          .split(/\s+/)
          .filter((w) => w.length >= 2);
        const exactQ = `%${rawQuery}%`;
        const wordPatterns = words.map((w) => `%${w}%`);
        const propConditions: any[] = [];
        propConditions.push(ilike(crmProperties.name, exactQ));
        for (const wp of wordPatterns)
          propConditions.push(ilike(crmProperties.name, wp));
        propConditions.push(sql`${addressText} ILIKE ${exactQ}`);
        for (const wp of wordPatterns)
          propConditions.push(sql`${addressText} ILIKE ${wp}`);
        results.properties = await db
          .select({
            id: crmProperties.id,
            name: crmProperties.name,
            status: crmProperties.status,
            address: crmProperties.address,
          })
          .from(crmProperties)
          .where(or(...propConditions))
          .limit(15);
      }
      if (entityType === "all" || entityType === "investment") {
        results.investmentTracker = await db
          .select({
            id: investmentTracker.id,
            assetName: investmentTracker.assetName,
            address: investmentTracker.address,
            status: investmentTracker.status,
            boardType: investmentTracker.boardType,
            client: investmentTracker.client,
          })
          .from(investmentTracker)
          .where(
            buildFuzzyOr(
              [
                investmentTracker.assetName,
                investmentTracker.address,
                investmentTracker.client,
                investmentTracker.vendor,
              ],
              rawQuery
            )
          )
          .limit(15);
      }
      if (entityType === "all" || entityType === "units") {
        results.availableUnits = await db
          .select({
            id: availableUnits.id,
            unitName: availableUnits.unitName,
            marketingStatus: availableUnits.marketingStatus,
            propertyId: availableUnits.propertyId,
          })
          .from(availableUnits)
          .where(buildFuzzyOr([availableUnits.unitName], rawQuery))
          .limit(15);
      }
      if (entityType === "all" || entityType === "comps") {
        results.comps = await db
          .select({
            id: crmComps.id,
            name: crmComps.name,
            tenant: crmComps.tenant,
            landlord: crmComps.landlord,
            dealType: crmComps.dealType,
            headlineRent: crmComps.headlineRent,
            completionDate: crmComps.completionDate,
          })
          .from(crmComps)
          .where(
            buildFuzzyOr(
              [crmComps.name, crmComps.tenant, crmComps.landlord],
              rawQuery
            )
          )
          .limit(15);
      }
      if (entityType === "all" || entityType === "requirements") {
        const exactQ = `%${rawQuery}%`;
        const words = rawQuery
          .split(/\s+/)
          .filter((w) => w.length >= 2);
        const wordPatterns = words.map((w) => `%${w}%`);
        const allPatterns = [exactQ, ...wordPatterns];
        const reqConds = allPatterns.map(
          (_: string, i: number) =>
            `(company_name ILIKE $${i + 1} OR contact_name ILIKE $${i + 1} OR location ILIKE $${i + 1} OR notes ILIKE $${i + 1})`
        );
        const reqResult = await pool.query(
          `SELECT id, category, company_name AS "companyName", contact_name AS "contactName", location, status, priority FROM requirements WHERE ${reqConds.join(" OR ")} LIMIT 15`,
          allPatterns
        );
        results.requirements = reqResult.rows;
      }

      const totalFound = Object.values(results).reduce(
        (sum: number, arr: any) => sum + (arr?.length || 0),
        0
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { query: rawQuery, totalFound, results },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_deal_details",
    "Get full details for a specific CRM deal by ID, including linked contacts, properties, and fee allocations.",
    {
      dealId: z.string().describe("The deal ID"),
    },
    async ({ dealId }) => {
      const deal = await db
        .select()
        .from(crmDeals)
        .where(eq(crmDeals.id, dealId))
        .limit(1);
      if (!deal.length) {
        return {
          content: [
            { type: "text" as const, text: `No deal found with ID ${dealId}` },
          ],
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(deal[0], null, 2) },
        ],
      };
    }
  );

  server.tool(
    "get_contact_details",
    "Get full details for a specific CRM contact by ID.",
    {
      contactId: z.string().describe("The contact ID"),
    },
    async ({ contactId }) => {
      const contact = await db
        .select()
        .from(crmContacts)
        .where(eq(crmContacts.id, contactId))
        .limit(1);
      if (!contact.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No contact found with ID ${contactId}`,
            },
          ],
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(contact[0], null, 2) },
        ],
      };
    }
  );

  server.tool(
    "get_company_details",
    "Get full details for a specific CRM company by ID.",
    {
      companyId: z.string().describe("The company ID"),
    },
    async ({ companyId }) => {
      const company = await db
        .select()
        .from(crmCompanies)
        .where(eq(crmCompanies.id, companyId))
        .limit(1);
      if (!company.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No company found with ID ${companyId}`,
            },
          ],
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(company[0], null, 2) },
        ],
      };
    }
  );

  server.tool(
    "get_property_details",
    "Get full details for a specific property by ID, including all available units.",
    {
      propertyId: z.string().describe("The property ID"),
    },
    async ({ propertyId }) => {
      const property = await db
        .select()
        .from(crmProperties)
        .where(eq(crmProperties.id, propertyId))
        .limit(1);
      if (!property.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No property found with ID ${propertyId}`,
            },
          ],
        };
      }
      const units = await db
        .select()
        .from(availableUnits)
        .where(eq(availableUnits.propertyId, propertyId));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { property: property[0], availableUnits: units },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_investment_tracker",
    "Get all investment tracker items, optionally filtered by status or board type.",
    {
      status: z
        .string()
        .optional()
        .describe("Filter by status (e.g. Active, Completed, Under Offer)"),
      boardType: z
        .string()
        .optional()
        .describe("Filter by board type (e.g. Acquisition, Disposal)"),
    },
    async ({ status, boardType }) => {
      let query = db
        .select({
          id: investmentTracker.id,
          assetName: investmentTracker.assetName,
          address: investmentTracker.address,
          status: investmentTracker.status,
          boardType: investmentTracker.boardType,
          client: investmentTracker.client,
          vendor: investmentTracker.vendor,
          askingPrice: investmentTracker.askingPrice,
          agreedPrice: investmentTracker.agreedPrice,
          niy: investmentTracker.niy,
          bgpFee: investmentTracker.bgpFee,
        })
        .from(investmentTracker)
        .$dynamic();

      const conditions: any[] = [];
      if (status)
        conditions.push(eq(investmentTracker.status, status));
      if (boardType)
        conditions.push(eq(investmentTracker.boardType, boardType));

      if (conditions.length === 1) {
        query = query.where(conditions[0]);
      } else if (conditions.length > 1) {
        const { and } = await import("drizzle-orm");
        query = query.where(and(...conditions));
      }

      const items = await query.limit(50);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: items.length, items },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_wip_report",
    "Get the WIP (Work In Progress) pipeline report showing active deals with fee allocations.",
    {},
    async () => {
      const deals = await db
        .select({
          id: crmDeals.id,
          name: crmDeals.name,
          groupName: crmDeals.groupName,
          status: crmDeals.status,
          quotedfee: crmDeals.quotedfee,
          dealType: crmDeals.dealType,
          agentFees: crmDeals.agentFees,
        })
        .from(crmDeals)
        .where(
          or(
            eq(crmDeals.status, "Active"),
            eq(crmDeals.status, "Under Offer"),
            eq(crmDeals.status, "Exchanged")
          )
        )
        .limit(100);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: deals.length, deals },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_comps",
    "Get completed deal comparables (comps) — leasing and investment transactions.",
    {
      dealType: z
        .string()
        .optional()
        .describe("Filter by deal type (e.g. Letting, Investment)"),
      limit: z.number().optional().default(20).describe("Max results"),
    },
    async ({ dealType, limit }) => {
      let query = db
        .select({
          id: crmComps.id,
          name: crmComps.name,
          tenant: crmComps.tenant,
          landlord: crmComps.landlord,
          dealType: crmComps.dealType,
          headlineRent: crmComps.headlineRent,
          netEffectiveRent: crmComps.netEffectiveRent,
          sqft: crmComps.sqft,
          completionDate: crmComps.completionDate,
          address: crmComps.address,
        })
        .from(crmComps)
        .$dynamic();

      if (dealType) {
        query = query.where(eq(crmComps.dealType, dealType));
      }
      const comps = await query
        .orderBy(desc(crmComps.completionDate))
        .limit(limit || 20);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: comps.length, comps },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_available_units",
    "Get available units across all properties, optionally filtered by marketing status.",
    {
      marketingStatus: z
        .string()
        .optional()
        .describe("Filter by status (e.g. Available, Under Offer, Let)"),
    },
    async ({ marketingStatus }) => {
      let query = db
        .select({
          id: availableUnits.id,
          unitName: availableUnits.unitName,
          propertyId: availableUnits.propertyId,
          marketingStatus: availableUnits.marketingStatus,
          useType: availableUnits.useType,
          floor: availableUnits.floor,
          sqft: availableUnits.sqft,
          rent: availableUnits.rent,
          rates: availableUnits.rates,
          serviceCharge: availableUnits.serviceCharge,
        })
        .from(availableUnits)
        .$dynamic();

      if (marketingStatus) {
        query = query.where(
          eq(availableUnits.marketingStatus, marketingStatus)
        );
      }
      const units = await query.limit(100);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: units.length, units },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "browse_sharepoint_folder",
    "Browse the BGP SharePoint filing system. List files and subfolders at a given path. Use '/' or empty for the root of the BGP shared drive. Use folder paths like 'BGP share drive/Investment' to navigate deeper.",
    {
      path: z
        .string()
        .optional()
        .default("/")
        .describe("Folder path in SharePoint (e.g. '/' for root, 'BGP share drive/Investment' for investment folder)"),
    },
    async ({ path: folderPath }) => {
      try {
        const safePath = folderPath || "/";
        if (safePath.includes("sharepoint.com") || safePath.includes("onedrive.com") || safePath.includes("personal/")) {
          return {
            content: [
              { type: "text" as const, text: "Only folder paths within the BGP shared drive are allowed (e.g. '/' or 'BGP share drive/Investment'). Direct SharePoint/OneDrive URLs are not supported via MCP." },
            ],
          };
        }
        const token = await getAppToken();
        const result = await browseSharePointFolder(safePath, token);
        const summary = {
          path: folderPath || "/",
          folderCount: result.folders.length,
          fileCount: result.files.length,
          totalSizeMB: Math.round(result.totalSize / 1024 / 1024 * 100) / 100,
          folders: result.folders.map((f: any) => ({
            name: f.name,
            childCount: f.childCount,
            modified: f.modified,
          })),
          files: result.files.map((f: any) => ({
            name: f.name,
            sizeMB: Math.round(f.size / 1024 / 1024 * 100) / 100,
            modified: f.modified,
            type: f.mimeType,
            webUrl: f.webUrl,
          })),
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(summary, null, 2) },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error browsing SharePoint: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "search_sharepoint_files",
    "Search for files across the entire BGP SharePoint site by name or keyword.",
    {
      query: z.string().describe("Search query — file name or keyword"),
    },
    async ({ query }) => {
      try {
        const token = await getAppToken();
        const driveId = await getSharePointDriveId(token);
        if (!driveId) {
          return {
            content: [
              { type: "text" as const, text: "Could not access SharePoint drive." },
            ],
          };
        }
        const searchUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/search(q='${encodeURIComponent(query)}')`;
        const resp = await fetch(searchUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          return {
            content: [
              { type: "text" as const, text: `Search failed: ${await resp.text()}` },
            ],
          };
        }
        const data = await resp.json();
        const results = (data.value || []).slice(0, 30).map((item: any) => ({
          name: item.name,
          path: item.parentReference?.path?.replace(/\/drive\/root:/, "") || "",
          sizeMB: Math.round((item.size || 0) / 1024 / 1024 * 100) / 100,
          modified: item.lastModifiedDateTime,
          webUrl: item.webUrl,
          type: item.file?.mimeType || (item.folder ? "folder" : "unknown"),
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { query, resultCount: results.length, results },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Search error: ${err.message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "get_sharepoint_file_content",
    "Get metadata and content of a file from the BGP SharePoint shared drive. Returns text content for plain text files (txt, csv, json, md, etc.) and metadata with webUrl link for binary files (Word, Excel, PDF, etc.).",
    {
      filePath: z.string().describe("File path in SharePoint (e.g. 'BGP share drive/Investment/Report.docx')"),
    },
    async ({ filePath }) => {
      try {
        if (filePath.includes("sharepoint.com") || filePath.includes("onedrive.com") || filePath.includes("personal/")) {
          return {
            content: [
              { type: "text" as const, text: "Only file paths within the BGP shared drive are allowed (e.g. 'BGP share drive/Investment/Report.docx'). Direct SharePoint/OneDrive URLs are not supported via MCP." },
            ],
          };
        }
        const token = await getAppToken();
        const driveId = await getSharePointDriveId(token);
        if (!driveId) {
          return {
            content: [
              { type: "text" as const, text: "Could not access SharePoint drive." },
            ],
          };
        }
        const encoded = encodeURIComponent(filePath);
        const metaResp = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!metaResp.ok) {
          return {
            content: [
              { type: "text" as const, text: `File not found: ${filePath}` },
            ],
          };
        }
        const meta = await metaResp.json();
        const name = meta.name || filePath;
        const ext = name.split(".").pop()?.toLowerCase() || "";

        if (["xlsx", "xls", "docx", "doc", "pptx", "ppt"].includes(ext)) {
          const previewResp = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${meta.id}/content`,
            { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" }
          );
          if (!previewResp.ok) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    file: name,
                    sizeMB: Math.round((meta.size || 0) / 1024 / 1024 * 100) / 100,
                    webUrl: meta.webUrl,
                    note: "File found but content extraction requires download. Open it via the webUrl link.",
                  }, null, 2),
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  file: name,
                  sizeMB: Math.round((meta.size || 0) / 1024 / 1024 * 100) / 100,
                  webUrl: meta.webUrl,
                  note: "Binary file — open via webUrl to view contents.",
                }, null, 2),
              },
            ],
          };
        }

        if (["txt", "csv", "json", "md", "log", "xml", "html", "css", "js", "ts"].includes(ext)) {
          const contentResp = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${meta.id}/content`,
            { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" }
          );
          if (contentResp.ok) {
            const text = await contentResp.text();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    file: name,
                    content: text.slice(0, 50000),
                    truncated: text.length > 50000,
                  }, null, 2),
                },
              ],
            };
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                file: name,
                sizeMB: Math.round((meta.size || 0) / 1024 / 1024 * 100) / 100,
                modified: meta.lastModifiedDateTime,
                webUrl: meta.webUrl,
                type: meta.file?.mimeType || "unknown",
              }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error reading file: ${err.message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "list_model_templates",
    "List all available financial model templates (Excel-based). Each template has input fields and output calculations for property analysis (IRR, yields, MOIC, etc.).",
    {},
    async () => {
      try {
        const templates = await db
          .select()
          .from(excelTemplates)
          .orderBy(desc(excelTemplates.createdAt));
        const result = templates.map((t) => {
          const inputs = JSON.parse(t.inputMapping || "{}");
          const outputs = JSON.parse(t.outputMapping || "{}");
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            version: t.version,
            propertyId: t.propertyId,
            inputFields: Object.entries(inputs).map(([key, m]: [string, any]) => ({
              key,
              label: m.label || key,
              type: m.type || "text",
              sheet: m.sheet,
            })),
            outputFields: Object.entries(outputs).map(([key, m]: [string, any]) => ({
              key,
              label: m.label || key,
              format: m.format || "text",
              sheet: m.sheet,
            })),
            createdAt: t.createdAt,
          };
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { templateCount: result.length, templates: result },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error listing templates: ${err.message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "run_financial_model",
    "Run a financial model template with given input values. Returns calculated outputs (IRR, yields, MOIC, etc.). Use list_model_templates first to see available templates and their required inputs.",
    {
      templateId: z.string().describe("The template ID (from list_model_templates)"),
      name: z.string().describe("A name for this model run (e.g. '42 Sloane Street - Scenario A')"),
      inputValues: z.record(z.string(), z.union([z.string(), z.number()])).describe("Input values keyed by field name (from the template's inputFields)"),
    },
    async ({ templateId, name, inputValues }) => {
      try {
        const { storage } = await import("./storage");
        const template = await storage.getExcelTemplate(templateId);
        if (!template) {
          return {
            content: [
              { type: "text" as const, text: `Template not found: ${templateId}` },
            ],
          };
        }

        const XLSX = (await import("xlsx")).default;
        const fs = (await import("node:fs")).default;
        const pathMod = (await import("node:path")).default;

        const wb = XLSX.readFile(template.filePath);
        const inputMapping = JSON.parse(template.inputMapping || "{}");
        const outputMapping = JSON.parse(template.outputMapping || "{}");

        for (const [key, value] of Object.entries(inputValues)) {
          const mapping = inputMapping[key];
          if (mapping) {
            const ws = wb.Sheets[mapping.sheet];
            if (ws) {
              const numVal = Number(value);
              if (mapping.type === "percent") {
                ws[mapping.cell] = { t: "n", v: isNaN(numVal) ? 0 : numVal / 100 };
              } else if (mapping.type === "number" && !isNaN(numVal)) {
                ws[mapping.cell] = { t: "n", v: numVal };
              } else {
                ws[mapping.cell] = { t: "s", v: String(value) };
              }
            }
          }
        }

        const RUNS_DIR = pathMod.join(process.cwd(), "ChatBGP", "runs");
        if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
        const runFileName = `run-${Date.now()}-${name.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
        const runFilePath = pathMod.join(RUNS_DIR, runFileName);
        XLSX.writeFile(wb, runFilePath);

        const reloadedWb = XLSX.readFile(runFilePath);
        const outputs: Record<string, string> = {};
        for (const [key, mapping] of Object.entries(outputMapping) as any[]) {
          const ws = reloadedWb.Sheets[mapping.sheet];
          if (ws && ws[mapping.cell]) {
            const raw = ws[mapping.cell].v;
            if (mapping.format === "percent") {
              outputs[key] = typeof raw === "number" ? (raw * 100).toFixed(2) + "%" : String(raw);
            } else if (mapping.format === "number2") {
              outputs[key] = typeof raw === "number" ? raw.toFixed(2) : String(raw);
            } else if (mapping.format === "number0") {
              outputs[key] = typeof raw === "number" ? Math.round(raw).toLocaleString() : String(raw);
            } else {
              outputs[key] = String(raw);
            }
          }
        }

        const run = await storage.createExcelModelRun({
          templateId,
          name,
          inputValues: JSON.stringify(inputValues),
          outputValues: JSON.stringify(outputs),
          generatedFilePath: runFilePath,
          status: "completed",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  runId: run.id,
                  name,
                  templateName: template.name,
                  inputs: inputValues,
                  outputs,
                  status: "completed",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error running model: ${err.message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "get_model_runs",
    "Get past financial model runs, optionally filtered by template. Shows inputs, calculated outputs, and run dates.",
    {
      templateId: z
        .string()
        .optional()
        .describe("Filter by template ID (optional — omit to see all runs)"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Max runs to return (default 20)"),
    },
    async ({ templateId, limit }) => {
      try {
        let runs;
        if (templateId) {
          runs = await db
            .select()
            .from(excelModelRuns)
            .where(eq(excelModelRuns.templateId, templateId))
            .orderBy(desc(excelModelRuns.createdAt))
            .limit(limit || 20);
        } else {
          runs = await db
            .select()
            .from(excelModelRuns)
            .orderBy(desc(excelModelRuns.createdAt))
            .limit(limit || 20);
        }

        const templates = await db.select().from(excelTemplates);
        const templateMap = Object.fromEntries(templates.map((t) => [t.id, t.name]));

        const result = runs.map((r) => ({
          id: r.id,
          name: r.name,
          templateName: templateMap[r.templateId] || r.templateId,
          inputs: JSON.parse(r.inputValues || "{}"),
          outputs: JSON.parse(r.outputValues || "{}"),
          status: r.status,
          propertyId: r.propertyId,
          createdAt: r.createdAt,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { runCount: result.length, runs: result },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text" as const, text: `Error fetching runs: ${err.message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "search_knowledge_base",
    "Full-text search the BGP memory bank — archived SharePoint files, team emails, Dropbox documents, and AI-indexed notes with summaries, tags, and extracted content. The primary long-term memory for the dashboard. Use whenever a user asks about a document, email, memo, report, or historical information.",
    {
      query: z.string().describe("Natural-language search query. Supports phrases, quotes, AND/OR (websearch-style)."),
      source: z
        .enum(["sharepoint", "email", "dropbox", "note"])
        .optional()
        .describe("Optional: filter to a single source type."),
      category: z.string().optional().describe("Optional: filter by AI-assigned category."),
      limit: z.number().optional().default(10).describe("Max results (default 10, max 50)."),
    },
    async ({ query, source, category, limit }) => {
      const rawQuery = (query || "").trim();
      if (!rawQuery) {
        return { content: [{ type: "text" as const, text: "Query is required." }] };
      }
      const cappedLimit = Math.min(50, Math.max(1, limit || 10));
      const params: any[] = [rawQuery];
      const whereClauses: string[] = [];
      const tsExpr = "to_tsvector('english', coalesce(file_name,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'') || ' ' || coalesce(array_to_string(ai_tags, ' '),'') || ' ' || coalesce(category,''))";
      whereClauses.push(`${tsExpr} @@ websearch_to_tsquery('english', $1)`);
      if (source) { params.push(source); whereClauses.push(`source = $${params.length}`); }
      if (category) { params.push(category); whereClauses.push(`category = $${params.length}`); }
      params.push(cappedLimit);
      try {
        const sqlText = `
          SELECT id, file_name, summary, content, source, category, file_url, ai_tags, last_modified,
                 ts_rank(${tsExpr}, websearch_to_tsquery('english', $1)) AS rank
            FROM knowledge_base
           WHERE ${whereClauses.join(" AND ")}
           ORDER BY rank DESC, last_modified DESC NULLS LAST
           LIMIT $${params.length}
        `;
        const result = await pool.query(sqlText, params);
        const rows = result.rows.map((r: any) => ({
          id: r.id,
          fileName: r.file_name,
          summary: r.summary,
          snippet: r.content ? String(r.content).slice(0, 400) : null,
          source: r.source || "sharepoint",
          category: r.category,
          fileUrl: r.file_url,
          aiTags: r.ai_tags || [],
          lastModified: r.last_modified,
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ query: rawQuery, totalResults: rows.length, results: rows }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Knowledge base search error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "search_chat_history",
    "Full-text search across past ChatBGP conversations. Use to recall something discussed in prior chat threads.",
    {
      query: z.string().describe("Search query over chat message content."),
      limit: z.number().optional().default(10).describe("Max results (default 10, max 50)."),
    },
    async ({ query, limit }) => {
      const rawQuery = (query || "").trim();
      if (!rawQuery) {
        return { content: [{ type: "text" as const, text: "Query is required." }] };
      }
      const cappedLimit = Math.min(50, Math.max(1, limit || 10));
      try {
        const sqlText = `
          SELECT id, thread_id, role, content, created_at,
                 ts_rank(to_tsvector('english', coalesce(content,'')), websearch_to_tsquery('english', $1)) AS rank
            FROM chat_messages
           WHERE to_tsvector('english', coalesce(content,'')) @@ websearch_to_tsquery('english', $1)
           ORDER BY rank DESC, created_at DESC
           LIMIT $2
        `;
        const result = await pool.query(sqlText, [rawQuery, cappedLimit]);
        const rows = result.rows.map((r: any) => ({
          id: r.id,
          threadId: r.thread_id,
          role: r.role,
          snippet: r.content ? String(r.content).slice(0, 500) : null,
          createdAt: r.created_at,
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ query: rawQuery, totalResults: rows.length, results: rows }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Chat history search error: ${err.message}` }] };
      }
    }
  );

  return server;
}

export function registerMcpRoutes(app: Express) {
  const mcpApiKey = process.env.MCP_API_KEY || process.env.SESSION_SECRET;
  if (!mcpApiKey) {
    console.warn("[mcp] WARNING: No MCP_API_KEY or SESSION_SECRET set — MCP server disabled");
    return;
  }

  function validateMcpAuth(req: Request, res: Response): boolean {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: "Missing Authorization header. Use: Authorization: Bearer <API_KEY>" });
      return false;
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token !== mcpApiKey) {
      res.status(403).json({ error: "Invalid API key" });
      return false;
    }
    return true;
  }

  app.post("/mcp", async (req: Request, res: Response) => {
    if (!validateMcpAuth(req, res)) return;

    try {
      const server = createBgpMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      console.error("[mcp] Error handling request:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "MCP server error" });
      }
    }
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    if (!validateMcpAuth(req, res)) return;
    res.status(405).json({ error: "SSE not supported in stateless mode. Use POST requests." });
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    if (!validateMcpAuth(req, res)) return;
    res.status(405).json({ error: "Session deletion not supported in stateless mode." });
  });

  app.get("/mcp/info", (_req: Request, res: Response) => {
    res.json({
      name: "BGP Dashboard MCP Server",
      description: "Access BGP CRM data, SharePoint filing system, and financial models from Claude — search deals, contacts, companies, properties, investment tracker, comps, browse/search SharePoint files, and run property financial models.",
      version: "1.3.0",
      tools: [
        "search_crm",
        "get_deal_details",
        "get_contact_details",
        "get_company_details",
        "get_property_details",
        "get_investment_tracker",
        "get_wip_report",
        "get_comps",
        "get_available_units",
        "browse_sharepoint_folder",
        "search_sharepoint_files",
        "get_sharepoint_file_content",
        "list_model_templates",
        "run_financial_model",
        "get_model_runs",
        "search_knowledge_base",
        "search_chat_history",
      ],
      auth: "Bearer token required (Authorization header)",
    });
  });

  console.log("[mcp] MCP server registered at /mcp");
}
