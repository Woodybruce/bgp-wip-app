// Setting up a new property: its folder tree in the BGP Share Drive (Woody, 23
// November 2026: "where do we want the files options are existing folder with a
// pop out to the BGP share drive and ability to go in and pick a folder. or
// create new folder tree").
//
//   POST /api/properties/:id/folders/tree  { driveId, parentId, structure }
//     makes "<property name>" inside the folder the person picked, then the
//     template's sub-folders inside it (a folder already there is reused), and
//     links the property to it (sharepoint_folder_url).
//
// BGP staff signed in as themselves, on their own Microsoft 365 connection,
// so a person can only make folders where they may. Rules: shared/property-setup.ts.
import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { bgpSharePointUrl, folderTreeOrder, folderTreePaths, safeFolderName } from "@shared/folders";

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const GRAPH_ID = /^[A-Za-z0-9!_\-.]{1,200}$/;

async function staffMe(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) } : null;
}

const router = Router();

router.post("/api/properties/:id/folders/tree", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const driveId = text(body.driveId), parentId = text(body.parentId);
    if (!GRAPH_ID.test(driveId) || !GRAPH_ID.test(parentId)) return res.status(400).json({ message: "Pick the folder to make it in." });
    const tree = folderTreePaths(body.structure ?? []);
    if ("problem" in tree) return res.status(400).json({ message: tree.problem });
    const property = (await pool.query(`SELECT id, name FROM crm_properties WHERE id = $1`, [String(req.params.id)])).rows[0];
    if (!property) return res.status(404).json({ message: "Property not found." });
    const rootName = safeFolderName(property.name) || "Property";

    const { getValidMsToken } = await import("./microsoft");
    const token = await getValidMsToken(req);
    if (!token) return res.status(401).json({ message: "Connect your Microsoft 365 account first (the SharePoint page)." });
    const { createFolderInItem } = await import("./sharepoint-graph");
    const root = await createFolderInItem(token, driveId, parentId, rootName);
    if (!root.success || !root.item) return res.status(502).json({ message: `SharePoint did not make the folder: ${root.error || "no answer"}.` });

    const ids = new Map<string, string>([["", root.item.id]]);
    const errors: string[] = [];
    let folders = 1;
    for (const parts of folderTreeOrder(tree.paths)) {
      const parent = ids.get(parts.slice(0, -1).join("/"));
      if (!parent) continue; // its parent failed: said below
      const made = await createFolderInItem(token, driveId, parent, parts[parts.length - 1]);
      if (made.success && made.item) { ids.set(parts.join("/"), made.item.id); folders++; }
      else errors.push(`${parts.join(" / ")}: ${made.error || "not made"}`);
    }

    // Link the property to the new folder (the Folders button opens it).
    const webUrl = root.item.webUrl;
    if (webUrl && bgpSharePointUrl(webUrl)) {
      await pool.query(`UPDATE crm_properties SET sharepoint_folder_url = $2, updated_at = now() WHERE id = $1`, [property.id, webUrl]);
    }
    console.log(`[property-setup] ${me.name} made ${folders} folder(s) for property ${property.id}${errors.length ? `, ${errors.length} failed` : ""}`);
    res.json({ webUrl, name: rootName, folders, errors });
  } catch (e: any) {
    console.error("[property-setup] folder tree failed:", e?.message);
    res.status(500).json({ message: "The folders could not be made." });
  }
});

export default router;
