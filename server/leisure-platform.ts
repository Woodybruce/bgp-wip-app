// Leisure Platform dashboard (/leisure-platform) — the L&G Leisure Fund deep
// dive and the branded leisure-park platform target list, with the live
// layers the app already has: Land Registry CCOD titles held by the fund's
// nominee companies, Companies House accounts for the cinema and leisure
// operators, and the data room of source documents under
// docs/leisure-platform/data-room/.
import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { getTitlesForCompany } from "./land-registry-ccod";
import { findProprietorsByAddress, isHmlrProprietorsAvailable } from "./hmlr-direct";
import { renderLeisurePlatformPage, publicToken } from "./leisure-platform-public";
import { researchHtml } from "./leisure-platform-research";
import {
  LEISURE_FUND,
  LEISURE_SITES,
  LEISURE_OPERATORS,
  LEISURE_TARGETS,
  DATA_ROOM,
} from "./leisure-platform-data";

const DATA_ROOM_DIR = path.resolve(process.cwd(), "docs", "leisure-platform", "data-room");

// Proprietor names on the fund's titles. CCOD rows carry the company number
// too, but the older registrations only match on name.
const NOMINEE_NAME_RE = /LEGAL\s*&\s*GENERAL\s+(PROPERTY\s+PARTNERS\s*\(LEISURE\)|LEISURE\s+FUND\s+TRUSTEE)/i;

type OperatorAccounts = {
  crmCompanyId: string | null;
  lastAccountsDocId: string | null;
  extracted: Record<string, string | null> | null;
};

async function operatorAccountsByChNumber(chNumbers: string[]): Promise<Record<string, OperatorAccounts>> {
  const out: Record<string, OperatorAccounts> = {};
  if (!chNumbers.length) return out;
  try {
    const { rows } = await pool.query<{
      id: string;
      companies_house_number: string;
      last_accounts_doc_id: string | null;
      companies_house_data: any;
    }>(
      `SELECT id, companies_house_number, last_accounts_doc_id, companies_house_data
         FROM crm_companies
        WHERE UPPER(companies_house_number) = ANY($1)`,
      [chNumbers.map((n) => n.toUpperCase())],
    );
    for (const r of rows) {
      const extracted = r.companies_house_data?.latestAccountsExtracted || null;
      if (extracted) delete extracted.rawText;
      out[r.companies_house_number.toUpperCase()] = {
        crmCompanyId: r.id,
        lastAccountsDocId: r.last_accounts_doc_id,
        extracted,
      };
    }
  } catch (err: any) {
    console.warn("[leisure-platform] operator accounts lookup failed:", err?.message);
  }
  return out;
}

export function registerLeisurePlatformRoutes(app: Express) {
  // Everything the page needs in one call: the static research snapshot
  // plus Companies House figures already banked against the operators.
  app.get("/api/leisure-platform/overview", requireAuth, async (_req: Request, res: Response) => {
    try {
      const accounts = await operatorAccountsByChNumber(LEISURE_OPERATORS.map((o) => o.chNumber));
      res.json({
        fund: LEISURE_FUND,
        sites: LEISURE_SITES,
        operators: LEISURE_OPERATORS.map((o) => ({ ...o, accounts: accounts[o.chNumber.toUpperCase()] || null })),
        targets: LEISURE_TARGETS,
        dataRoom: DATA_ROOM.map((d) => ({
          ...d,
          fileAvailable: !!d.file && fs.existsSync(path.join(DATA_ROOM_DIR, d.file)),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "overview failed" });
    }
  });

  // The written paper, one HTML fragment per tab (rendered from the same
  // markdown the public page uses).
  app.get("/api/leisure-platform/research", requireAuth, (_req: Request, res: Response) => {
    res.json(researchHtml());
  });

  // Land Registry: every title the two nominee companies hold (CCOD, keyed
  // by Companies House number) plus a per-site postcode sweep so each park
  // shows its title numbers, tenure and price paid where the ingest has them.
  app.get("/api/leisure-platform/titles", requireAuth, async (_req: Request, res: Response) => {
    try {
      const byCompany: Record<string, any[]> = {};
      for (const nominee of LEISURE_FUND.nomineeCompanies) {
        if (!/^\d+$/.test(nominee.number)) continue;
        byCompany[nominee.number] = await getTitlesForCompany(nominee.number, 500);
      }

      const hmlrLive = await isHmlrProprietorsAvailable();
      const bySite: Record<string, any[]> = {};
      if (hmlrLive) {
        for (const site of LEISURE_SITES) {
          try {
            const matches = await findProprietorsByAddress(site.postcode, null);
            bySite[site.key] = matches
              .filter((m) => m.proprietors.some((p) => NOMINEE_NAME_RE.test(p.proprietorName || "")))
              .map((m) => ({
                titleNumber: m.titleNumber,
                tenure: m.tenure,
                propertyAddress: m.propertyAddress,
                pricePaid: m.pricePaid,
                dateProprietorAdded: m.dateProprietorAdded,
                proprietors: m.proprietors.map((p) => p.proprietorName).filter(Boolean),
              }));
          } catch (err: any) {
            bySite[site.key] = [];
          }
        }
      }

      res.json({
        hmlrLive,
        ccodTitlesLoaded: Object.values(byCompany).some((t) => t.length > 0),
        byCompany,
        bySite,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "titles failed" });
    }
  });

  // Companies House: pull (or refresh) the latest filed accounts for one
  // operator and read the headline figures. Creates the CRM company row if
  // the operator is not in the CRM yet, the same way ChatBGP's
  // get_company_accounts tool does.
  app.post("/api/leisure-platform/operators/:chNumber/fetch-accounts", requireAuth, async (req: Request, res: Response) => {
    try {
      const chNumber = String(req.params.chNumber || "").trim().toUpperCase();
      const op = LEISURE_OPERATORS.find((o) => o.chNumber.toUpperCase() === chNumber);
      if (!op) return res.status(404).json({ error: "Operator not on the leisure platform list" });

      let cid: string | undefined;
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM crm_companies WHERE UPPER(companies_house_number) = $1 LIMIT 1`,
        [chNumber],
      );
      cid = rows[0]?.id;
      if (!cid) {
        const { rows: created } = await pool.query<{ id: string }>(
          `INSERT INTO crm_companies (name, companies_house_number) VALUES ($1, $2) RETURNING id`,
          [op.name, chNumber],
        );
        cid = created[0]?.id;
      }
      if (!cid) return res.status(500).json({ error: "Could not resolve a CRM company for the operator" });

      const { fetchLatestAccountsForCompany, extractAccountsFigures } = await import("./ch-accounts");
      let fetchStatus: string;
      try {
        fetchStatus = (await fetchLatestAccountsForCompany(cid)).status;
      } catch (err: any) {
        fetchStatus = `fetch_error: ${err?.message || err}`;
      }
      const figures = await extractAccountsFigures(cid);
      if (!figures) return res.json({ companyId: cid, fetchStatus, extracted: null });
      const { rawText, ...extracted } = figures;
      res.json({ companyId: cid, fetchStatus, extracted });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "fetch-accounts failed" });
    }
  });

  // Data room files (the PDFs committed under docs/leisure-platform/data-room).
  app.get("/api/leisure-platform/data-room/:file", requireAuth, (req: Request, res: Response) => {
    const name = String(req.params.file || "");
    const entry = DATA_ROOM.find((d) => d.file === name);
    if (!entry || !/^[a-z0-9-]+\.pdf$/i.test(name)) return res.status(404).json({ error: "Not in the data room" });
    const full = path.join(DATA_ROOM_DIR, name);
    if (!fs.existsSync(full)) return res.status(404).json({ error: "File missing from the deploy" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    fs.createReadStream(full).pipe(res);
  });

  // Public, read-only copy of the research for people outside the app
  // (unguessable token in the path; no login). Same seed data as the
  // dashboard, rendered server-side; data-room PDFs served under it too.
  app.get("/public/leisure-platform/:token", (req: Request, res: Response) => {
    if (!publicToken() || req.params.token !== publicToken()) return res.status(404).send("Not found");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.send(renderLeisurePlatformPage({ dataRoomBase: `/public/leisure-platform/${req.params.token}/data-room`, fullDocument: true }));
  });
  app.get("/public/leisure-platform/:token/data-room/:file", (req: Request, res: Response) => {
    if (!publicToken() || req.params.token !== publicToken()) return res.status(404).send("Not found");
    const name = String(req.params.file || "");
    const entry = DATA_ROOM.find((d) => d.file === name);
    if (!entry || !/^[a-z0-9-]+\.pdf$/i.test(name)) return res.status(404).send("Not found");
    const full = path.join(DATA_ROOM_DIR, name);
    if (!fs.existsSync(full)) return res.status(404).send("Not found");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    fs.createReadStream(full).pipe(res);
  });
}
