/**
 * Generic CRM REST endpoints — schema-aware read / update / bulk-update.
 *
 *   GET    /api/generic/:table/:id
 *   GET    /api/generic/:table              (list with simple filters)
 *   PATCH  /api/generic/:table/:id
 *   POST   /api/generic/:table/bulk-update
 *   GET    /api/generic/tables              (list whitelisted tables)
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import {
  readRecord,
  listRecords,
  updateRecord,
  bulkUpdateRecords,
  listAllowedTables,
} from "./generic-crm";

export function registerGenericCrmRoutes(app: Express) {
  app.get("/api/generic/tables", requireAuth, (_req, res: Response) => {
    res.json({ tables: listAllowedTables() });
  });

  app.get("/api/generic/:table", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(String(req.query.limit || "50"), 10);
      const offset = parseInt(String(req.query.offset || "0"), 10);
      const filters: Record<string, any> = {};
      for (const [k, v] of Object.entries(req.query)) {
        if (k === "limit" || k === "offset") continue;
        filters[k] = v;
      }
      const rows = await listRecords({ table: String(req.params.table), filters, limit, offset });
      res.json({ rows });
    } catch (err: any) { res.status(400).json({ error: err?.message }); }
  });

  app.get("/api/generic/:table/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const row = await readRecord(String(req.params.table), String(req.params.id));
      if (!row) return res.status(404).json({ error: "not found" });
      res.json(row);
    } catch (err: any) { res.status(400).json({ error: err?.message }); }
  });

  app.patch("/api/generic/:table/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any)?.user?.id || "system";
      const userName = (req as any)?.user?.name || "User";
      const result = await updateRecord({
        table: String(req.params.table),
        id: String(req.params.id),
        fields: req.body || {},
        userId, userName,
      });
      res.json(result);
    } catch (err: any) { res.status(400).json({ error: err?.message }); }
  });

  app.post("/api/generic/:table/bulk-update", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any)?.user?.id || "system";
      const userName = (req as any)?.user?.name || "User";
      const { filter, fields } = req.body || {};
      if (!filter || !fields) return res.status(400).json({ error: "filter + fields required" });
      const result = await bulkUpdateRecords({
        table: String(req.params.table), filter, fields, userId, userName,
      });
      res.json(result);
    } catch (err: any) { res.status(400).json({ error: err?.message }); }
  });
}
