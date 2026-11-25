// Folders shared with a client (Woody, 24 November 2026: decision 6 of
// docs/folders-review-2026-11-20.md, "let BGP staff share chosen folders with
// a client"). BGP staff signed in as themselves share a folder linked to a
// property, a transaction or a company with the client company whose logins
// can open that record: for a property (or a transaction, through its
// property) its landlord or a company linked to it, the companies
// isPropertyInScope gives the property to; for a company, the company itself.
// Never any other company, and only a company with client logins. The folder
// must be one the person can open on their own Microsoft 365, in BGP's
// SharePoint library, and never a library's top or the whole of BGP - Share
// Drive. Sharing or not changes nothing in SharePoint: the client reads it in
// the app (server/client-sharepoint.ts, on the app's token), read only. Each
// change is a row of folder_actions (share_client, unshare_client).
import { linkTopProblem, type FolderLinkView, type RecordFoldersView } from "@shared/folders";
import {
  isShareableRecordType, sharedLinkVisible, type ClientSharedFolder, type ShareOptions, type ShareableRecordType, type SharedWith,
} from "@shared/folder-share";
import { bgpLibrary, itemForChange } from "./graph";
import { folderRefusal, logFolderAction, type FolderActor } from "./links";
import type { Db } from "./access";

export interface ShareDeps {
  /** The company a client login's team stands for (company-scope.ts's getCompanyIdForClientTeam). */
  teamCompany?: (team: string) => Promise<string | null>;
}

interface ShareLinkRow {
  id: string; record_type: string; record_id: string; drive_id: string; item_id: string; label: string;
  shared_with_company_id: string | null; shared_name: string | null;
}

async function liveLink(db: Db, linkId: string): Promise<ShareLinkRow | null> {
  if (!linkId || linkId.length > 100) return null;
  return (await db.query(
    `SELECT rf.id, rf.record_type, rf.record_id, rf.drive_id, rf.item_id, rf.label, rf.shared_with_company_id, c.name AS shared_name
       FROM record_folders rf LEFT JOIN crm_companies c ON c.id = rf.shared_with_company_id
      WHERE rf.id = $1 AND rf.removed_at IS NULL`, [linkId],
  )).rows[0] || null;
}

/** The companies with client logins: each active client login's team, as the company it stands for. */
export async function clientCompanyIds(db: Db, deps: ShareDeps = {}): Promise<Set<string>> {
  const teamCompany = deps.teamCompany ?? (async (team: string) => (await import("../company-scope")).getCompanyIdForClientTeam(team));
  const teams = (await db.query(
    `SELECT DISTINCT trim(team) AS team FROM users
      WHERE COALESCE(is_active, true) AND COALESCE(trim(team), '') <> ''
        AND (role = 'Client' OR (COALESCE(email, '') <> '' AND lower(email) NOT LIKE '%@brucegillinghampollard.com'))`,
  )).rows.map((r: any) => String(r.team));
  const out = new Set<string>();
  for (const team of teams) {
    const id = await teamCompany(team).catch(() => null);
    if (id) out.add(String(id));
  }
  return out;
}

/** Who a link may be shared with, and why nobody when nobody. */
async function candidatesFor(db: Db, link: ShareLinkRow, deps: ShareDeps): Promise<{ candidates: SharedWith[]; why: string | null }> {
  if (!isShareableRecordType(link.record_type)) return { candidates: [], why: "Only folders on a property, a transaction or a company can be shared with a client." };
  if (link.record_type === "company") {
    const company = (await db.query(`SELECT id, name FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL`, [link.record_id])).rows[0];
    if (!company) return { candidates: [], why: "That company has gone." };
    return (await clientCompanyIds(db, deps)).has(String(company.id))
      ? { candidates: [{ id: String(company.id), name: String(company.name || "") }], why: null }
      : { candidates: [], why: `${company.name || "That company"} has no client logins, so nobody would see it.` };
  }
  const propertyId = link.record_type === "property" ? link.record_id
    : (await db.query(`SELECT property_id FROM crm_deals WHERE id = $1`, [link.record_id])).rows[0]?.property_id || null;
  if (!propertyId) return { candidates: [], why: "Link this transaction to a property first: a folder is shared with the client whose property it is." };
  const tied = (await db.query(
    `SELECT c.id, c.name FROM crm_companies c
      WHERE c.merged_into_id IS NULL AND c.id IN (
        SELECT landlord_id FROM crm_properties WHERE id = $1 AND landlord_id IS NOT NULL
        UNION SELECT company_id FROM crm_company_properties WHERE property_id = $1)
      ORDER BY c.name, c.id`, [String(propertyId)],
  )).rows;
  const clients = tied.length ? await clientCompanyIds(db, deps) : new Set<string>();
  const candidates = tied.filter((c: any) => clients.has(String(c.id))).map((c: any) => ({ id: String(c.id), name: String(c.name || "") }));
  return { candidates, why: candidates.length ? null : "No client with logins in the app owns or is linked to this property." };
}

/** Who a link is shared with now, who it may be shared with, and why nobody when nobody. */
export async function shareOptions(db: Db, linkId: string, deps: ShareDeps = {}): Promise<ShareOptions> {
  const link = await liveLink(db, linkId);
  if (!link) throw folderRefusal(404, "That link has gone.");
  const { candidates, why } = await candidatesFor(db, link, deps);
  return {
    sharedWith: link.shared_with_company_id ? { id: link.shared_with_company_id, name: link.shared_name || "a client" } : null,
    candidates,
    why,
  };
}

export const SHARE_CONNECT_FIRST = "Connect your own Microsoft 365 first, on the SharePoint page: a folder is shared only once you have opened it as yourself.";

/**
 * Share a link's folder with a client company, or stop (companyId null). The
 * company must be one the record may be shared with; the folder is read again
 * on the person's own Microsoft 365 first. Stopping needs no Microsoft 365.
 */
export async function shareFolderLink(db: Db, actor: FolderActor & { token: string | null }, linkId: string, companyId: unknown, deps: ShareDeps = {}): Promise<ShareOptions> {
  const link = await liveLink(db, linkId);
  if (!link) throw folderRefusal(404, "That link has gone.");
  const entry = { recordType: link.record_type, recordId: link.record_id, driveId: link.drive_id, itemId: link.item_id, nameBefore: link.label };
  if (companyId === null || companyId === "") {
    if (link.shared_with_company_id) {
      await db.query(`UPDATE record_folders SET shared_with_company_id = NULL, shared_by = $2, shared_at = now() WHERE id = $1`, [link.id, actor.userId]);
      await logFolderAction(db, actor, { action: "unshare_client", ...entry, detail: { companyId: link.shared_with_company_id, companyName: link.shared_name } });
    }
    return shareOptions(db, linkId, deps);
  }
  if (typeof companyId !== "string" || companyId.length > 100) throw folderRefusal(400, "Which client?");
  const { candidates, why } = await candidatesFor(db, link, deps);
  const company = candidates.find(c => c.id === companyId);
  if (!company) throw folderRefusal(400, why || "That client can't open this record, so it can't be shared with them.");
  if (!actor.token) throw folderRefusal(428, SHARE_CONNECT_FIRST);
  try {
    const it = await itemForChange(actor.token, link.drive_id, link.item_id);
    if (!it.entry.isFolder) throw folderRefusal(400, "That is a file, not a folder.");
    const library = await bgpLibrary(actor.token);
    const top = linkTopProblem({ name: it.entry.name, driveId: link.drive_id, driveKind: it.entry.driveKind, isRoot: it.isRoot, parentId: it.parentId }, library);
    if (top) throw folderRefusal(400, top);
    if (link.drive_id !== library.driveId) throw folderRefusal(400, "Only a folder in BGP's SharePoint library can be shared with a client, not one in a OneDrive or on another site.");
  } catch (e: any) {
    await logFolderAction(db, actor, { action: "share_client", ...entry, ok: false, error: e?.message || "not shared", detail: { companyId: company.id, companyName: company.name } });
    throw e;
  }
  if (link.shared_with_company_id !== company.id) {
    await db.query(`UPDATE record_folders SET shared_with_company_id = $2, shared_by = $3, shared_at = now() WHERE id = $1 AND removed_at IS NULL`, [link.id, company.id, actor.userId]);
    await logFolderAction(db, actor, {
      action: "share_client", ...entry,
      detail: { companyId: company.id, companyName: company.name, ...(link.shared_with_company_id ? { replaced: link.shared_with_company_id } : {}) },
    });
  }
  return shareOptions(db, linkId, deps);
}

/** A record's folders with who each is shared with, for staff. A failed read shares nothing it shows. */
export async function withSharing(db: Db, view: RecordFoldersView): Promise<RecordFoldersView> {
  const ids = [...view.folders, ...view.inherited.flatMap(g => g.folders)].filter(f => !f.legacy).map(f => f.id);
  if (!ids.length) return view;
  const rows = (await db.query(
    `SELECT rf.id, rf.shared_with_company_id, c.name FROM record_folders rf LEFT JOIN crm_companies c ON c.id = rf.shared_with_company_id
      WHERE rf.id = ANY($1::text[]) AND rf.shared_with_company_id IS NOT NULL`, [ids],
  ).catch(() => ({ rows: [] as any[] }))).rows;
  const shared = new Map(rows.map((r: any) => [String(r.id), { id: String(r.shared_with_company_id), name: String(r.name || "a client") }]));
  const mark = (f: FolderLinkView): FolderLinkView => (f.legacy ? f : { ...f, sharedWith: shared.get(f.id) || null });
  return { ...view, folders: view.folders.map(mark), inherited: view.inherited.map(g => ({ ...g, folders: g.folders.map(mark) })) };
}

// ── What a client login is shown ────────────────────────────────────────
/** The scope checks for the login asking (company-scope.ts's, scheme limits included). */
export interface ClientShareChecks {
  /** Held to named schemes: a joint agent, or a Landsec login with schemes ticked. */
  limited: boolean;
  propertyInScope: (propertyId: string) => Promise<boolean>;
  dealInScope: (dealId: string) => Promise<boolean>;
}
/** A shared folder a client may open, with the ids the server reads it by (never sent to the client). */
export interface ClientSharedLink { shown: ClientSharedFolder; driveId: string; itemId: string }

/**
 * The folders shared with the caller's company that this login may open: on a
 * property it can open, on a transaction it can open at such a property, or on
 * its own company record (not for a login held to schemes). `linkId` narrows
 * to one link; `propertyId` to a property's (its own and its transactions');
 * `companyOnly` to the company's own.
 */
export async function clientSharedFolders(db: Db, scope: string, checks: ClientShareChecks, only: { linkId?: string | null; propertyId?: string | null; companyOnly?: boolean } = {}): Promise<ClientSharedLink[]> {
  if (!scope) return [];
  const rows = (await db.query(
    `SELECT rf.id, rf.record_type, rf.record_id, rf.drive_id, rf.item_id, rf.label, rf.shared_with_company_id,
            CASE rf.record_type WHEN 'property' THEN rf.record_id WHEN 'deal' THEN d.property_id END AS property_id,
            p.name AS property_name, d.name AS deal_name, co.name AS company_name
       FROM record_folders rf
       LEFT JOIN crm_deals d ON rf.record_type = 'deal' AND d.id = rf.record_id
       LEFT JOIN crm_properties p ON p.id = CASE rf.record_type WHEN 'property' THEN rf.record_id WHEN 'deal' THEN d.property_id END
       LEFT JOIN crm_companies co ON rf.record_type = 'company' AND co.id = rf.record_id
      WHERE rf.removed_at IS NULL AND rf.shared_with_company_id = $1 AND rf.record_type IN ('property', 'deal', 'company')
        AND ($2::text IS NULL OR rf.id = $2::text)
      ORDER BY CASE rf.record_type WHEN 'company' THEN 0 WHEN 'property' THEN 1 ELSE 2 END,
               COALESCE(p.name, co.name, ''), d.name NULLS FIRST, rf.position, rf.linked_at, rf.id`,
    [scope, only.linkId || null],
  )).rows;
  const propertyChecked = new Map<string, Promise<boolean>>();
  const out: ClientSharedLink[] = [];
  for (const r of rows) {
    const propertyId = r.property_id ? String(r.property_id) : null;
    if (only.propertyId && propertyId !== only.propertyId) continue;
    if (only.companyOnly && r.record_type !== "company") continue;
    let propertyInScope = false;
    if (propertyId) {
      if (!propertyChecked.has(propertyId)) propertyChecked.set(propertyId, checks.propertyInScope(propertyId).catch(() => false));
      propertyInScope = await propertyChecked.get(propertyId)!;
    }
    const dealInScope = r.record_type === "deal" && propertyInScope ? await checks.dealInScope(String(r.record_id)).catch(() => false) : false;
    const visible = sharedLinkVisible(
      { recordType: r.record_type, recordId: String(r.record_id), sharedWith: r.shared_with_company_id ? String(r.shared_with_company_id) : null, removed: false, propertyId },
      { scope, limited: checks.limited },
      { propertyInScope, dealInScope },
    );
    if (!visible) continue;
    const recordType = r.record_type as ShareableRecordType;
    out.push({
      shown: {
        id: String(r.id),
        label: String(r.label || ""),
        recordType,
        recordName: String((recordType === "property" ? r.property_name : recordType === "deal" ? r.deal_name : r.company_name) || ""),
        propertyId,
        propertyName: r.property_name ? String(r.property_name) : null,
      },
      driveId: String(r.drive_id),
      itemId: String(r.item_id),
    });
  }
  return out;
}
