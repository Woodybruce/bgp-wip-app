# Folders review, 20 November 2026

Woody, 20 November 2026, on a deal page's Files tab, where the "Property
folder" card asks for a folder name and a pasted SharePoint address:

> "this add folder solution needs to actually just link to one drive so can
> find the folder and link or create a new folder? Also its called a property
> folder but probably needs to just be called folders and ability to link more
> than one or create from share drive. Can you consider the folder solution
> across the app and how it works with share point / one drive I think it can
> be more sophisticated and more similar to one drive so can move a folder add
> colour etc ie one drive in the app..? Have a review and make suggestion and
> make sures its a single engine across the app"

Read from the code on 20 November 2026 (commit `1049be85`). Some facts were
read from the live app the same day with the QA login, read only; each says
so. Microsoft's documentation was read the same day; the links are at the end.
Nothing was changed, nothing was checked in a browser, and nothing here is
built until Woody approves.

## The short answer

- There is no folder engine. Folders show in 19 places on screen, about 50
  server routes touch SharePoint folders or files, folder links are kept in ten
  columns and one table in six different forms, and the app gets a Microsoft
  token in five different ways. The same small jobs are written out again and
  again: the BGP library is looked up in 27 places in 11 server files, and a
  pasted address is turned into a folder by 14 separate pieces of code.
- Linking a folder means typing a label and pasting a SharePoint address.
  Nothing in the app lets you find a folder in SharePoint or OneDrive, or
  create a folder and link it in one step.
- A folder linked from a deal page is saved on the property, not the deal. The
  deal's own SharePoint link (`crm_deals.sharepoint_link`) is never shown on
  the deal page.
- The app's folder paths point at the wrong tree. Set Up Folders and the
  Folders panel use `BGP share drive/<team>/<property>`, a near-empty folder of
  8 items, most named after retired teams. The team's own tree, where
  CLAUDE.md says documents live (decided 13 November 2026), is
  `BGP - Share Drive` (17 top-level folders; Tenant Rep alone holds 160
  items). On live, 109 properties name
  team folders that the app finds by that path, and for none of the 20 sampled
  does the folder exist. Only 2 properties hold a stored default link.
- Set Up Folders fails for Shopping Centre, London Estate, High Street and
  City: there is no template for them, so the server answers 400.
- Landsec's data room (what Landsec logins and joint agents see) is
  `BGP share drive/Landsec`, which holds one folder: Bluewater / Occupational
  Costs. None of the 437 folders of the standard client tree is bound, so a
  joint agent sees no folders at all.
- Microsoft Graph can do almost everything Woody asks: search, browse, create,
  rename, move within a library, copy between libraries, delete to the recycle
  bin, upload, share, preview and follow. It cannot read or set OneDrive's
  folder colours: Microsoft documents no property or method for it. A colour in
  the app can only be the app's own.
- Proposal: one table of folder links that stores Microsoft's drive and item
  IDs, so any record can hold several folders and a renamed folder still
  opens; one server module; one `Folders` component with a picker that
  searches, browses and creates. Build first: the picker and the component on
  the deal page's Files pill and the property page.

## 1. What is there today

### 1.1 Where folders show

| # | Place | Code | Server | Who | Can | Cannot |
|---|---|---|---|---|---|---|
| 1 | Deal page, Files pill | `client/src/components/deal-detail.tsx` lines 893–911 (`files`); `UnitFilesCard` line 1145 | `GET /api/available-units/:id/files` (the unit's files, in the app's own store); the property's folder through `PropertyFoldersPanel` (row 4). `server/deal-page.ts` lines 334–349 send the property's `folder_teams` and `sharepoint_folder_url` to BGP staff only | BGP staff. A client login, staff viewing as a client and a joint agent read "Documents are managed by the BGP team." With no property: "Link this deal to a property to see its folders." | the unit's files (a letting); the property's folders, under the heading "Property folder" | link a folder to the deal; show the deal's own `sharepoint_link` |
| 2 | Property page, plan-led | `client/src/components/property-detail.tsx` lines 831–848 (the **Folders** button and its drop-down); Set Up Folders in the More menu, line 863 | as rows 4–6 | staff get the staff panel and `PropertySharepointLink`; a client login and a joint agent get `ClientPropertyFoldersPanel` (row 9) | as rows 4 and 9 | as rows 4 and 9 |
| 3 | Property page, classic | same file lines 1543–1563 ("Files" section); Set Up Folders button line 889 | as rows 4–6 | as row 2; a joint agent gets no Files section | as row 2 | as row 2 |
| 4 | `PropertyFoldersPanel`, the staff panel used by rows 1–3, 7 and 14 | `client/src/pages/properties.tsx` line 1808; tabs from `propertyFolderTabs`, `shared/property-labels.ts` | `GET /api/microsoft/property-folders/:team/:propertyName?folderUrl=&path=` (`server/microsoft.ts` line 2821) turns the stored address into a folder on every open and walks sub-folders by name; links through `GET/PUT /api/crm/properties/:id/sharepoint-folders` (`server/crm.ts` lines 2769–2786; `setPropertyFolderLink`, `server/sharepoint-property-files.ts` line 426) | staff (the link routes refuse client logins; the Microsoft routes give a client no token) | one tab per team folder and per named extra folder; "Link folder for <team>", "Add folder" (a label and a pasted address), Change, Remove; New folder, Upload, Rename, Delete (recycle bin), Share (anonymous view link, else organisation-only, or invite by email), delete a whole team tree, open in SharePoint | find or browse to a folder; create a folder and link it; move, copy, preview, select several, sort, filter, colour. New folder and Rename use the browser's prompt box, Delete and Remove its confirm box. The row menu is invisible until hovered, so it cannot be seen on a phone. Its Chat button never shows: no caller passes `entityType` |
| 5 | `PropertySharepointLink` | `properties.tsx` line 2269 | the general property save (`PUT /api/crm/properties/:id`), which does not check the address | staff | set or clear the property's default link | its placeholder shows a host that is not BGP's (`brucegillinghampollard.sharepoint.com`; BGP's is `brucegillinghampollardlimited`) |
| 6 | Set Up Folders, and the Properties list's Folder tree column | `SetUpFoldersDialog`, `properties.tsx` line 1598; `InlineFolderTree` line 357, column line 6679 | `POST /api/microsoft/property-folders` (`microsoft.ts` line 2488) creates `BGP share drive/<team>/<property>` plus a tree from `TEAM_FOLDER_TREES` (line 2297); the dialog then adds the team to the record's `folder_teams` | staff | create a team tree | store a link (the panel finds the folder again by path); serve the 2026 teams. The dialog offers the 2026 teams and Landsec, but the templates are keyed by the retired names, so for Shopping Centre, London Estate, High Street and City no preview shows and Create answers 400 "Unknown team" (read from the code; not run, because it writes to live SharePoint). Landsec gets the London Retail tree under `BGP share drive/Landsec/<property>` |
| 7 | Landlord page, Files pill | `LandlordSidebarBlock`, `client/src/components/brand-profile-panel.tsx` line 6787; inventory card `AccountFolderTreeCard`, `client/src/components/account-workspace-cards.tsx` line 340 | "<company> property tree": `POST /api/microsoft/client-folders`, a durable job (`server/client-folder-jobs.ts`; tree in `shared/client-folder-tree.ts`; bindings in `account_folder_map`); Set Up Folders in landlord mode creates `BGP share drive/<team>/<company>` with a property template; `GET /api/accounts/:id/folder-inventory` (read only) | staff; a client login gets row 9 | build the standard client tree; browse the company folder | link folders (the panel has no property id, so no link line) |
| 8 | Brand page, Documents & gallery | `brand-profile-panel.tsx` lines 7313–7323 (`openSharePointFolder`) and 7570–7600 | `GET /api/microsoft/company-folders/browse?company=` lists `BGP share drive/Companies/<brand>` | staff | "Open <brand> folder on SharePoint" | open a folder that has no files in it: it then opens `https://bgp.sharepoint.com`, which is not BGP's SharePoint |
| 9 | Client data room | `ClientPropertyFoldersPanel`, `properties.tsx` line 2424; client dashboard, `client/src/pages/dashboard.tsx` line 1785 | `/api/client/sharepoint/root`, `property-root`, `list`, `content` (`server/client-sharepoint.ts` lines 170–284), on the app's own token. The fence is a path check under the client's root (`account_folder_map`, else `crm_companies.sharepoint_folder_url`). The property's folder is its bound folder, else a loose name match marked "unverified match". A joint agent sees bound property folders at its own schemes only (`jointAgentRoots`, line 203) | client logins, staff viewing as a client, joint agents | list, filter, sort, download | upload, link, create |
| 10 | Client "Files" page | `client/src/components/client-sharepoint-browser.tsx`, drawn by `client/src/pages/sharepoint.tsx`; called "Files" on the client side bar (`client/src/components/app-sidebar.tsx` line 612) | as row 9 | client logins | browse the whole data room | as row 9 |
| 11 | The SharePoint page (Microsoft 365 → SharePoint) | `StaffSharePoint`, `client/src/pages/sharepoint.tsx` line 638 | `GET /api/microsoft/files` (the top of the BGP site's library, falling back to the person's own OneDrive), `files/folder`, `files/item` (DELETE), `files/upload`, `files/content`, `files/thumbnail`, `team-folders`, `team-folders/setup` | staff | list or grid, filters, sort, image preview, new folder, delete, several uploads at once | rename, move, share, search beyond the open folder. Its Team Folders list looks for team folders at the top of the library (`GET /api/microsoft/team-folders`, line 2939) but its Set up button creates them inside `BGP share drive` (line 2754), with the retired team names |
| 12 | Dashboard SharePoint widget; Excel add-in | `client/src/components/dashboard/sharepoint-widget.tsx`; `client/src/pages/addin-excel.tsx` | the widget `GET /api/microsoft/files`; the add-in also `files/content` and `files/upload` | staff | the widget browses, opens and sends a file to ChatBGP; the add-in also reads and uploads | as row 11 |
| 13 | SharePoint file finders: brochures, tenancy schedule, plans, leasing minutes | `client/src/components/sharepoint-file-picker.tsx`, used by `property-brochures-panel.tsx`, `PropertyTenancySchedule.tsx`, `property-plan-sources.tsx`, `leasing-minutes-import-dialog.tsx` | `findPropertyFiles` (`server/sharepoint-property-files.ts` line 383): every linked folder walked, a Microsoft 365 search and the archivist's index, on the app's token; the chosen file is copied into the app | staff | find a file and import it | pick a folder |
| 14 | Pathway | `PathwayFoldersPanel`, `client/src/pages/property-pathway.tsx` line 2463; `server/property-pathway.ts` lines 2443–2475 | the property's panel (row 4); the run keeps its own `sharepoint_folder_path` and `sharepoint_folder_url`, looked for at `BGP share drive/Investment/<address>` | staff | as row 4 | the panel shows only when the property has `folder_teams`; a linked address alone is not enough |
| 15 | Lease Advisory matter | `client/src/pages/pla-matters.tsx` lines 628–650; `server/pla-folder-template.ts` | `POST /api/pla/matters/:id/apply-folder-template` creates `BGP share drive/Lease Advisory/<property>` with its own copies of the library lookup and folder create; stores `pla_matters.sharepoint_folder_url` | staff | apply the template, open the link | browse |
| 16 | Schemes inside a property | `client/src/components/property-schemes-panel.tsx` lines 130–136; `server/property-schemes.ts` lines 60–82 | a pasted address per scheme, `property_schemes.sharepoint_folder_url` | staff | paste, open | browse |
| 17 | Document Studio, "File to SharePoint" | `MirrorDialog`, `client/src/pages/document-studio.tsx` line 432 | `GET /api/documents/sp-folders` and `POST /api/documents/:id/mirror` (`server/documents.ts` lines 152, 428 and 444), by path, on the app's token, in the first library the site lists, starting at `BGP share drive` | admins from More on the side bar (the routes take any signed-in staff) | browse folders by path and file a copy there; the copy's address is kept on `studio_documents`. The only place in the app where you browse to a folder and choose it | create, search |
| 18 | ChatBGP page, a property thread's folders | `FolderTreeItem`, `client/src/pages/chatbgp.tsx` line 635 | `GET /api/microsoft/property-folders/:team/:name` by path only | staff | expand team folders | open a linked address |
| 19 | Document Briefs → Your templates → Legal & DD, "Create Project in SharePoint" | `client/src/pages/document-templates.tsx` lines 4541–4560 and 5467–5497, drawn inside `client/src/pages/document-briefs.tsx` line 461 | `POST /api/legal-dd/create-project` (`server/legal-dd.ts` line 908) creates `BGP share drive/<team>/DD - <deal name>` and the sub-folders the analysis suggests, with the person's token and its own copies of the library lookup and folder create | admins from More on the side bar (the route takes any signed-in staff) | create a data room tree after a DD analysis | store the folder anywhere. The team list is the 2026 teams, so the parent folder is new for most of them, and the route answers success whatever each create returned: it does not read the results |

Server-side users of the same folders, with no screen of their own:

- **ChatBGP tools**: create_sharepoint_folder, browse_sharepoint_folder,
  read_sharepoint_file, move_sharepoint_item, upload_to_sharepoint
  (`server/chatbgp.ts`, definitions from line 2868, helpers from line 6169,
  dispatch line 15068), plus copy_dropbox_to_sharepoint and
  download_email_attachment's "save to SharePoint". They run on the person's
  token (`getValidMsToken`, line 14869), work by path under
  `BGP share drive`, and their descriptions still name the retired team
  folders. A second copy of the same helpers is in
  `server/utils/sharepoint-operations.ts`, used by Pathway and others. Chat
  can tag a folder (`client/src/components/chat-tags.tsx`); the folders
  offered come from the archivist's index (`/api/chat/tag-search`,
  `server/routes.ts` line 2413) and the tag carries the encoded address.
- **The MCP server** (`server/mcp-server.ts` lines 552–700): browse, search and
  read by path, on the app's token.
- **Documents the app files by path**: the Targeting Brief PDF
  (`server/unit-brief-doc.ts` lines 256–276, into `BGP share drive/London
  Leasing` or `National Leasing/<scheme>/Targeting Briefs`, through
  `uploadFileToSharePoint`, which takes the first library the site lists),
  Document Briefs, Why Buy, Lease Advisory workbooks, Pathway outputs and
  email attachments the same way.
- **Model Studio** (`server/models.ts`): its assistant
  (`POST /api/models/claude-agent`, actions from line 3458: browse, read a
  file, create a folder, move, upload, import) and Embed Excel
  (`POST /api/models/runs/:id/embed-excel`, line 1827) look the site up again
  each time, with the person's token and their own choice of library. Its
  three save and sync to SharePoint routes (lines 1550, 1769 and 1914) have
  no caller.
- **Image Studio** imports images from two fixed share links at midnight
  (`runImageSync`, `server/image-studio.ts`; scheduled in `server/index.ts`
  lines 6700–6735, with the archivist's index straight after), and renders a
  SharePoint PDF's pages from its drive and item IDs
  (`/api/image-studio/capture-pdf`, line 3840). Its "property folders" are its
  own albums (`image_studio_collections`), not SharePoint.
- **Not SharePoint, but called folders**: Settings → Team Property Folders
  (`TeamFoldersSection`, `client/src/pages/settings.tsx` line 2736;
  `server/routes.ts` lines 10378–10500) keeps files on the server's own disk
  under `ChatBGP/<team>`, not in SharePoint and not in the app's file store. A
  Pathway run's "folder" is a label (`POST /api/property-pathway/:runId/folder`).
- **Kept apart on purpose**: KYC4U's SharePoint (another firm's Microsoft 365,
  `server/kyc4u.ts`) and HR's staff documents and policies (`hr_documents`, the
  `staff_profiles` links, `server/hr-routes.ts`), which have their own access
  rules.

### 1.2 Where links are stored

| Stored in | What it holds | Set by |
|---|---|---|
| `crm_properties.sharepoint_folder_url` | one address, the property's default folder | row 5 (no check) or the client-tree job |
| `crm_properties.sharepoint_team_folders` | JSON `{label: address}`: a folder per team or a named extra folder | "Link folder for", "Add folder" (row 4) |
| `crm_properties.folder_teams` | team names only; the folder is found again by the path `BGP share drive/<team>/<name>` | Set Up Folders (row 6) |
| `crm_companies.sharepoint_folder_url`, `crm_companies.folder_teams` | a client's data-room root; a landlord's folder | the client-tree job; Set Up Folders in landlord mode |
| `crm_deals.sharepoint_link` | free text, not checked | the Deals table's hidden "SharePoint Files" column (`client/src/pages/deals.tsx` lines 8796–8829; off by default, line 6758) |
| `property_schemes.sharepoint_folder_url` | one address per scheme | row 16 |
| `pla_matters.sharepoint_folder_url` | one address | row 15 |
| `property_pathway_runs.sharepoint_folder_path`, `sharepoint_folder_url` | a path and an address | row 14 |
| `account_folder_map` (`migrations/0045_account_folder_map.sql`) | Microsoft's drive and item IDs for each folder of the standard client tree | the client-tree job |
| chat tag ids; `knowledge_base.folder_url` | an encoded address; the archivist's index of crawled files | chat; the archivist |

Ten columns and one table hold folder links; chat tags and the archivist's
index carry more addresses. Between them there are six forms: an address, a
list of addresses keyed by label, a team name the app turns into a path, a
path, Microsoft's IDs, and an encoded address inside a chat message.

Single files are stored the same mixed ways (`studio_documents`,
`image_studio_images`, `hr_documents`, `excel_model_runs`,
`pla_matter_workbooks`, `crm_deals.aml_mlro_report_url`).

Only `account_folder_map` stores Microsoft's stable identity. Every other link
is an address or a path, so renaming or moving the folder breaks it. The code
already shows the cost: the website's image list carries both
`/Bruce Gillingham Pollard - Share Drive/…` and `/BGP - Share Drive/…` for the
same folders, because the top folder was renamed (`server/routes.ts` lines
5244–5273).

### 1.3 How the app gets a Microsoft token

1. **Per person, delegated** (`getValidMsToken`, `server/microsoft.ts` line
   252). Used by the Folders panel, Set Up Folders, the SharePoint page,
   ChatBGP's tools, Legal & DD, Model Studio and Image Studio's PDF capture. A
   client login never gets one. **A staff member with no stored Microsoft
   sign-in is given a colleague's token instead** (the most recently updated
   one, lines 279–292), so their folder actions run, and show in SharePoint,
   as that colleague.
2. **A named person, no fallback** (`getDelegatedGraphTokenForUser`, line 115).
   Background calendar work; no folder use.
3. **The app's own token** (`getAppToken` and `graphRequest`,
   `server/shared-mailbox.ts` lines 49 and 79; `getAppGraphToken`,
   `microsoft.ts` line 95; and a third copy inside `uploadFileToSharePoint`,
   line 152). Used by the client data room, the file finders, Document Studio,
   the MCP tools and the documents the app files.
4. **"Whoever refreshed last"** (`getMsTokenForImageSync`,
   `server/image-studio.ts` line 3989; `getMsTokenForBackground`,
   `server/archivist.ts` line 60). The two night crawls take the most recently
   updated person's token. Unlike (1), they do not skip the private mailbox.
5. **KYC4U's own connection** to its own Microsoft 365.

Delegated scopes the app asks for (`SCOPES`, `microsoft.ts` line 24;
`SSO_SCOPES_FULL`, `server/auth.ts` line 546) include Files.Read,
Files.Read.All, Files.ReadWrite.All, Sites.Read.All and Sites.ReadWrite.All,
all Microsoft Graph scopes. It asks for none of SharePoint's own scopes. The
app signs in on the server (`@azure/msal-node`); no Microsoft library runs in
the browser, and a search of the routes found none that returns a Microsoft
token to it.

**Application permissions on the live app's token** (read on 20 November 2026
from `GET /api/admin/graph-permissions`, which lists the roles in the token):
Files.Read.All, Files.ReadWrite.All, Sites.Read.All, Sites.ReadWrite.All,
Sites.Manage.All, Sites.FullControl.All, Sites.Create.All, Sites.Archive.All,
Sites.Selected, SharePointTenantSettings.ReadWrite.All, and others for mail,
calendars, contacts, notes and users. So the app's own token can read, change
and share every SharePoint site and every OneDrive in BGP's tenant. The client
data room's only fence is the app's own path check.

### 1.4 What the live app shows (20 November 2026, read only)

- **The BGP site's document library** holds five folders at the top:
  `BGP - Share Drive` (17 items), `BGP Archive` (22), `BGP share drive` (8),
  `General` (1) and `Investment` (1).
- **`BGP share drive`** (the app's) holds `BGP share drive` again (4 items: a
  folder inside itself; the cause was not traced), `Companies`, `Development`,
  `Investment` (7), `Landsec`, `London F&B`, `London Retail` (3) and
  `National Leasing`.
- **`BGP - Share Drive`** (the team's) holds `Tenant Rep` (160),
  `Pro Formas & Comps by area` (46), `Investment` (43), `London` (31),
  `Marketing` (24), `International` (22), `Lease Consultancy` (18),
  `BGP Admin` (13), `Reports & Market Updates` (13), `LHG Real Estate` (10),
  `National` (8), `Archive (BGP Share Drive)` (7), `Comparable Evidence` (6),
  `Schedules` (5), `New Business` (3), `Agents 2026` (2) and
  `London-Rupert` (0). Its top level is not organised by the 2026 team names.
- **Properties** (the 705 the staff list returns): 2 hold
  `sharepoint_folder_url`, both inside `BGP share drive`. 109 hold
  `folder_teams` (Investment 71, National Leasing 17, London Retail 9,
  London F&B 8, Development 7, Lease Advisory 5, London Leasing 2,
  London Estate 1). For 20 of the 109, picked at random, the path folder does
  not exist. The extra links (`sharepoint_team_folders`) were not counted: the
  list does not send them.
- **Deals**: 3 of 826 hold their own `sharepoint_link`.
- **Bluewater Shopping Centre**: no link; `folder_teams` is National Leasing;
  the path folder does not exist, so the staff Folders panel says "No folder
  linked yet". The team's `Bluewater` folder is in
  `BGP - Share Drive / National / National / Landsec`.
- **Landsec**: the data-room root is
  `…/Shared Documents/BGP share drive/Landsec` and holds only
  `Bluewater / Occupational Costs`. The folder inventory finds 437 expected
  folders, 0 bound, 1 matched (the root) and 436 missing. The team's Landsec
  folder (`BGP - Share Drive / National / National / Landsec`) holds 36 folders
  and 22 files: a folder per scheme (`Bluewater`, `Liverpool One`, `Trinity`,
  `The O2 Centre` and others) beside `Fee Agreement`,
  `Internal Leasing Schedules` and `Comparables`.

### 1.5 Smaller faults found on the way

1. The four leasing teams cannot set up folders (row 6).
2. The brand page's "Open folder on SharePoint" falls back to
   `https://bgp.sharepoint.com` (row 8).
3. The property link box shows the wrong host and saves any text (row 5).
4. The deal page hides the deal's own SharePoint link (row 1).
5. The SharePoint page's Team Folders list and its Set up button look in
   different places (row 11).
6. The Folders panel uses the browser's prompt and confirm boxes, and its row
   menu cannot be seen on a phone. `docs/DESIGN.md` §11 asks for a dialog on a
   computer and a bottom sheet on a phone.
7. Settings → Team Property Folders writes to the server's disk. Whether
   Railway keeps that disk across a deploy was not checked.
8. A client login sees its data-room folder on the property page but
   "Documents are managed by the BGP team" on the same property's deal page.
9. Nothing in the app records who linked, unlinked, renamed, moved, deleted or
   shared a folder.
10. Dead code: `CompanyFoldersCard` and `PropertyFoldersBrowser`
    (`client/src/pages/companies.tsx` lines 1571–2058, never drawn); the copies
    of `SetUpFoldersDialog` and `PropertyFoldersPanel` in
    `client/src/pages/instructions.tsx` (lines 487 and 684, never drawn);
    `startImageSync` (never called); four routes nothing calls:
    `/api/microsoft/company-folder-templates`, `/shared-folder-probe`,
    `/sharepoint/debug` and `/sharepoint/sites`; and Model Studio's three save
    and sync to SharePoint routes.
11. The image manifest's "SharePoint property folder" step is a stub
    (`server/property-imagery.ts` lines 136–139).
12. Legal & DD's "Create Project in SharePoint" says the folders were created
    whatever SharePoint answered (row 19).
13. `GET /api/microsoft/files` asks Graph to expand thumbnails on a folder
    listing, which Microsoft says does not work in SharePoint (section 3); the
    SharePoint page fetches each picture separately anyway.

## 2. The same job, written many times

| Job | Where it is done |
|---|---|
| Find the BGP site's library | 27 lookups in 11 server files: `server/models.ts` (10), `server/microsoft.ts` (5, two of them a site search for "BGP"), `server/chatbgp.ts` (3), `server/hr-routes.ts` (2), and one each in `sharepoint-graph.ts` (`getSharePointDriveId`, line 15), `utils/sharepoint-operations.ts` (`getSharePointDriveId`, line 32), `pla-folder-template.ts` (`getDriveId`, line 53), `aml-historical.ts` (`getDriveId`, line 25), `documents.ts`, `legal-dd.ts` and `chatbgp-design-tools.ts`; plus a fixed drive ID in `server/routes.ts` line 5273. They pick the library four ways: the one named "Documents" or "Shared Documents", the site's default library, the first one listed (`uploadFileToSharePoint`, Document Studio), or one named "BGP share drive" else "Documents" (Model Studio) |
| Turn an address into a folder (`/shares/u!…`) | 14 encoders: `sharepoint-graph.ts`, `client-sharepoint.ts`, `sharepoint-resolver.ts`, `microsoft.ts` (2), `routes.ts` (2), `image-studio.ts`, `archivist.ts`, `chatbgp.ts` (5) |
| Create a folder | `createFolderByPath` and `createFolderInItem` (`sharepoint-graph.ts`); copies of `createFolderByPath` in `pla-folder-template.ts` and `legal-dd.ts`; `executeCreateSharePointFolder` twice (`chatbgp.ts`, `utils/sharepoint-operations.ts`); `POST /api/microsoft/folders` and `POST /api/microsoft/files/folder`, two routes for one job; the team-folder setup loop |
| List a folder | `GET /api/microsoft/files`; `GET /api/microsoft/property-folders/:team/:name`; `GET /api/microsoft/company-folders/browse`; `GET /api/client/sharepoint/list`; `GET /api/documents/sp-folders`; `browseSharePointFolder` twice; the MCP tool; `walkLinkedFolder`; the inventory walker; the two night crawls |
| Folder templates | `TEAM_FOLDER_TREES` and `COMPANY_FOLDER_TREES` (`microsoft.ts`, keyed by retired team names); `LEASE_ADVISORY_TREE` (a copy, `pla-folder-template.ts`); `CLIENT_FOLDER_TREE` (`shared/client-folder-tree.ts`); `FOLDER_TEMPLATES` (`shared/pathway-folder-templates.ts`); a client-side copy of the company trees in the dead `CompanyFoldersCard` |
| Team folder names | `TEAM_FOLDERS` in `microsoft.ts`; `teamFolderMappings` in `utils/sharepoint-operations.ts` (with "Development & Re-purposing" and "Office - Corporate"); `FOLDER_TEAMS` in `shared/property-labels.ts`; `TEAM_FOLDERS` in `routes.ts` (the server-disk folders); ChatBGP's tool descriptions |
| Decide who may act | `/api/microsoft/*`: only "has a Microsoft token", for any folder in any library the token reaches; the property link routes: staff only; the client data room: a path check; joint agents: bound folders only; the deal page: staff-only fields; Document Studio and Legal & DD: signed in (the client gateway denies clients by default); ChatBGP: its tool gates; MCP: an API key; the night crawls: whoever refreshed last |
| Store a link | the ten columns and one table in 1.2 |
| Show a folder | `PropertyFoldersPanel` and its dead copy, `ClientPropertyFoldersPanel`, `ClientSharePointBrowser`, the SharePoint page, the dashboard widget, the ChatBGP page's tree, Document Studio's dialog, `SharePointFilePicker`, the Excel add-in |

## 3. What Microsoft Graph allows

Each row: the call, Microsoft's own words, and the least permission Microsoft
lists for a person (delegated, work account) and for the app (application).

| Job | Call | Microsoft's words | Delegated | Application |
|---|---|---|---|---|
| Find a folder by name | `GET /drives/{drive-id}/root/search(q='…')` | "Search the hierarchy of items for items matching a query. You can search within a folder hierarchy, a whole drive, or files shared with the current user." The example results include folders (`"folder": {}`). "This method doesn't support the Sites.Selected application permission." | Files.Read | Files.Read.All |
| Search all of SharePoint and OneDrive | `POST /search/query`, entity `driveItem` | "Use the Microsoft Search API in Microsoft Graph to search content stored in OneDrive or SharePoint: files, folders, lists, list items, or sites." `path:"…"` "scopes the query to a particular folder within a site". With `isDocument=true`, "Any container (folder, document library) isn't returned." `region` is "Required for searches that use application permissions." "Users cannot access more items in a search than they can otherwise obtain from a corresponding GET operation with the same permissions and access control." | Files.Read.All or Sites.Read.All (the overview's table for driveItem) | Files.Read.All |
| List a folder | `GET /drives/{drive-id}/items/{item-id}/children` | "If a collection exceeds the default page size (200 items), the @odata.nextLink property is returned" | Files.Read | Files.Read.All |
| Create a folder | `POST /drives/{drive-id}/items/{parent-item-id}/children` with `"folder": {}` | "Create a new folder or DriveItem in a Drive with a specified parent item or path." With `"@microsoft.graph.conflictBehavior": "rename"`, "if an item already exists with the same name, the service should choose a new name" | Files.ReadWrite | Files.ReadWrite.All |
| Rename | `PATCH /drives/{drive-id}/items/{item-id}` with `name` | "Update the metadata for a driveItem by ID or path." If the `if-match` eTag "doesn't match the current eTag on the folder, a `412 Precondition Failed` response is returned" | Files.ReadWrite | Files.ReadWrite.All |
| Move | the same PATCH with `parentReference` | "To move a driveItem to a new parent item, your app requests to update the parentReference of the DriveItem to move." "Items cannot be moved between Drives using this request." | Files.ReadWrite | Files.ReadWrite.All |
| Copy, also to another library or site | `POST /drives/{drive-id}/items/{item-id}/copy` | "Create a copy of a driveItem asynchronously, including child items." "The copy operation is restricted to 30,000 driveItems." "Metadata isn't retained when a driveItem is copied". "Permissions are not retained when a driveItem is copied. The copied driveItem inherits the permissions of the destination folder". It answers 202 with a monitor address | Files.ReadWrite | Files.ReadWrite.All |
| Delete | `DELETE /drives/{drive-id}/items/{item-id}` | "Deleting items using this method moves the items to the recycle bin instead of permanently deleting the item." | Files.ReadWrite | Files.ReadWrite.All |
| Upload, small | `PUT /drives/{drive-id}/items/{parent-id}:/{filename}:/content` | "This method only supports files up to 250 MB in size." | Files.ReadWrite | Files.ReadWrite.All |
| Upload, large | `POST …/items/{parentItemId}:/{fileName}:/createUploadSession` | "Use resumable file transfers for files larger than 10 MiB (10,485,760 bytes)." Each piece "MUST be a multiple of 320 KiB (327,680 bytes)" and under 60 MiB | Files.ReadWrite | Sites.ReadWrite.All (Files.ReadWrite.All is not listed) |
| Sharing link | `POST …/createLink` | "If a sharing link of the specified type already exists for the app, the existing sharing link is returned." Anonymous links: "Anonymous link support may be disabled by an administrator." `password`: "Optional and OneDrive Personal only." "Links created using this action don't expire unless a default expiration policy is enforced for the organization." | Files.ReadWrite | Files.ReadWrite.All |
| Invite people | `POST …/invite` | "A sharing invitation provides permissions to the recipients and, optionally, sends them an email to notify them that the item was shared." "*New* guests can't be invited using app-only access." | Files.ReadWrite | Files.ReadWrite.All |
| Who has access | `GET …/permissions` | "For a non-owner caller, only the sharing permissions that apply to the caller are returned." | Files.Read | Files.Read.All |
| Changes over time | `GET /drives/{drive-id}/root/delta` | "Track changes in a driveItem and its children over time." The v1.0 page lists the drive-root forms only. "When using delta you should always track items by id." | Files.Read | Files.Read.All |
| Thumbnails | `GET …/thumbnails` | small (96), medium (176), large (800) and custom sizes. "In OneDrive for Business and SharePoint: Using these calls to expand the thumbnails collection will not work: … `GET /drive/items/{item-id}/children?expand=thumbnails`". `GET /api/microsoft/files` asks for exactly that (`microsoft.ts` line 642); the SharePoint page then fetches each picture through `/api/microsoft/files/thumbnail` | Files.Read | Files.Read.All |
| Preview | `POST …/preview` | "This action allows you to obtain a short-lived embeddable URL for an item in order to render a temporary preview." "The preview action is currently only available on SharePoint and OneDrive for Business." "The preview renders on behalf of the calling identity, and anyone who accesses the URL acts as the caller with the caller's permissions." | Files.Read | Files.Read.All |
| Follow | `POST …/follow`; `GET /me/drive/following` | "List the items that have been followed by the signed in user. This collection includes items that are in the user's drive as well as items they have access to from other drives." | Files.Read | Files.Read.All |
| Open a pasted link | `GET /shares/{encoded-url}/driveItem` | "To use a sharing URL with this API, your app needs to transform the URL into a sharing token." | Files.ReadWrite | Files.ReadWrite.All |

What this means for Woody's list:

- **Find and link**: yes. Search by name in the BGP library and in the
  person's own OneDrive, browse from the top of either, and keep the drive and
  item IDs.
- **Create a new folder**: yes, inside any folder the person can write to.
- **Link more than one**: that is the app's own data, not Graph's.
- **Move a folder**: yes within one library. Between libraries, or from a
  OneDrive into the BGP library, Graph offers only copy then delete, and the
  copy keeps neither the metadata nor the permissions.
- **Upload, share, preview, follow, recycle bin**: yes, as above.

### 3.1 Folder colour

- The driveItem resource lists no colour property, in v1.0 or in beta.
- The folder resource lists two properties, `childCount` and `view`, in v1.0
  and in beta.
- On Microsoft Q&A (23 November 2023) someone saw a colour in a driveItem
  response and tried `PATCH {"decorator": {"iconColor": "darkOrange"}}`; it
  failed with "General exception while processing". The accepted answer,
  labelled Microsoft External Staff (24 November 2023): "Per my research,
  currently there is no such api to change icon color. This is a new feature
  in SharePoint Online. SharePoint only support to change the color from UI."
  The last comment, 28 August 2026, asks "No updates yet on this topic?"

So Microsoft's documentation shows no way to read or set a folder's colour.
The app can keep its own colour on its own link. That colour shows in the app
only: a colour set in OneDrive will not show in the app, and the app's colour
will not show in OneDrive.

### 3.2 Microsoft's own picker

Microsoft offers the OneDrive File Picker v8: "This new "control" is a page
hosted within the Microsoft service which you interact with via post messages.
The page can be hosted either embedded in an iframe or as a popup." Its
settings include `typesAndSources.mode` ("files" | "folders" | "all"),
`selection.mode` ("single" | "multiple" | "pick"), `commands.createFolder`,
`commands.upload`, `search`, a pick action of "move", and a starting folder by
path (`entry.sharePoint.byPath`).

What it would need here:

- "The file picker always operates using delegated permissions and as such can
  only ever access file and folders to which the current user already has
  access."
- "At a minimum you must request the SharePoint MyFiles.Read permission to
  read files from a user's OneDrive and SharePoint sites." The guide's set-up
  adds `AllSites.Read` and `MyFiles.Read` "for SharePoint delegated
  permissions", and "To allow the user to upload files and create folders
  within the Picker experience, you may request access to
  `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `AllSites.Write`, and
  `MyFiles.Write`." The app asks for none of SharePoint's own permissions today
  (1.3).
- "Currently the control relies on SharePoint tokens and not Graph, so you
  will need to ensure your resource is correct and you cannot reuse tokens for
  Graph calls." The guide gets those tokens in the browser, with
  `@azure/msal-browser` and a single-page application registration. The app
  signs in on the server and sends no Microsoft token to the browser (1.3), so
  this is a second way of signing in.
- It looks like Microsoft 365, not like the app, and it can never be offered to
  a client login or a joint agent.

### 3.3 Narrower permissions

"Initially, Sites.Selected existed to restrict an application's access to a
single site collection. Now, lists, list items, folders, and files are also
supported, and all Selected scopes now support delegated and application
modes." "Selected scopes require an explicit assignment action". The four
scopes are Sites.Selected, Lists.SelectedOperations.Selected,
ListItems.SelectedOperations.Selected and Files.SelectedOperations.Selected,
with the roles read, write, owner and fullcontrol. Search does not work with
Sites.Selected (above), so narrowing the app's own token would mean searching
with the person's token.

## 4. Proposal: one folder engine

### 4.1 Rules

1. A folder is known by Microsoft's drive ID and item ID, never by its address
   or path. Address, name and path are kept only to show and to open.
2. Any record can hold several folders. Linking or unlinking never moves,
   renames or deletes anything in SharePoint.
3. Staff act as themselves, with their own token. Every action is logged in
   the app.
4. Client logins and joint agents see only what is inside their data room, as
   today. They never get a Microsoft token.
5. One server module and one component. Nothing else in the app calls Graph's
   drive addresses directly.
6. In the app, "Folders" means SharePoint and OneDrive folders only.

### 4.2 Data model

One new table for links, one for the log. `account_folder_map` stays as it is:
it is the identity of the data-room tree, and its rule that one folder is one
node is right there. Links are different: one folder can sit on a property,
its deals and its landlord at once.

```
record_folders
  id            varchar primary key default gen_random_uuid()
  record_type   text not null     -- property | deal | company | scheme | pla_matter | pathway_run
  record_id     text not null
  drive_id      text not null     -- Microsoft's identity of the folder,
  item_id       text not null     -- with drive_id
  label         text not null     -- the tab's name; defaults to the folder's
                                  -- name; changing it never renames the folder
  colour        text              -- an app colour key, if Woody agrees (3.1)
  position      integer not null default 0
  drive_kind    text              -- 'library' | 'onedrive'
  web_url       text              -- shown and opened; refreshed on read
  cached_name   text              -- shown; refreshed on read
  cached_path   text              -- shown, e.g. "BGP - Share Drive / National / ..."
  status        text not null default 'ok'   -- ok | missing | no_access, at the last read
  source        text not null     -- picked | created | pasted | migrated:<column>
  linked_by     varchar           -- users.id
  linked_at     timestamptz not null default now()
  checked_at    timestamptz
  removed_at    timestamptz       -- unlinking keeps the row, for the record
  removed_by    varchar
  unique (record_type, record_id, drive_id, item_id) where removed_at is null
  index (drive_id, item_id)       -- "also linked to ..."

folder_actions
  id, at, user_id, ms_account,    -- who pressed it, and whose Microsoft
                                  -- account Graph saw
  action                          -- link | unlink | create | rename | move |
                                  -- copy | delete | upload | share | invite
  record_type, record_id, drive_id, item_id,
  name_before, name_after, parent_before, parent_after,
  ok boolean, error text, detail jsonb
```

Both tables are additive. Under the Working style rules they need a boot
statement in `server/index.ts` (or a file on `IDEMPOTENT_SQL_MIGRATIONS`), and
they are a schema change, so they wait on Woody (decision 1). If Woody chooses
shared folders for the data room (decision 6), `record_folders` also takes
`shared_with_company_id`, set only by BGP staff: that folder and everything in
it are then in that client's data room.

### 4.3 What each record shows

| Record | Folders shown |
|---|---|
| Property | its own links; its data-room folder (the bound folder of the client tree), marked "Shared with <client>" for staff |
| Deal | its own links, then its property's, under "From <property>"; for a letting, the unit's files card stays as it is (those files live in the app) |
| Landlord, agent firm, lender, brand | its own links; a client company also shows its data-room root |
| Scheme, Lease Advisory matter, Pathway run | its own links, then its property's |

### 4.4 Server

`server/folders/`, the one place that talks to Graph's drive addresses:

- `graph.ts`: picks the token (the person's own for staff; the app's for the
  client data room and background work), finds the BGP library once and caches
  it, and holds the one copy of: open a pasted link, list, search, create,
  rename, move, copy (with its monitor), delete, upload (an upload session
  above 10 MiB), share link, invite, preview, thumbnail and follow.
- `links.ts`: read, add, change and remove links; the inheritance in 4.3;
  refresh the shown name, path and address.
- `access.ts`: who may do what (4.6), reusing the checks the app already has:
  `propertyReadBlocked`, `isDealInScope`, `isClientReadableCompanyPage`,
  `contactViewer` and the client-sharepoint fence.
- `routes.ts`:

```
GET    /api/folders/:recordType/:recordId          folders linked and inherited, each with status
POST   /api/folders/:recordType/:recordId/links    link { driveId, itemId } or { url }; label, colour
POST   /api/folders/:recordType/:recordId/create   create { parent, name, template? }, then link it
PATCH  /api/folders/links/:id                      label, colour, position
DELETE /api/folders/links/:id                      unlink (SharePoint untouched)
GET    /api/folders/places                         the BGP library (with BGP - Share Drive first),
                                                   my OneDrive, followed folders
GET    /api/folders/browse?driveId=&itemId=        a folder's contents, folders first
GET    /api/folders/search?q=&in=                  folders by name, in the BGP library and my OneDrive
PATCH  /api/folders/items/:driveId/:itemId         rename, or move within the library
POST   /api/folders/items/:driveId/:itemId/copy    copy to another library, with progress
DELETE /api/folders/items/:driveId/:itemId         to the recycle bin
POST   /api/folders/items/:driveId/:itemId/upload | share-link | invite | preview | follow
GET    /api/folders/client/...                     the data-room reads, same rules as today
GET    /api/admin/folders/migration                the report (4.7)
POST   /api/admin/folders/migration/apply | undo
```

Everything under `/api/folders/` except `/api/folders/client/` stays refused to
client logins at the gateway (`server/index.ts`); only that one prefix goes on
the client read list.

### 4.5 The component

`client/src/components/folders/`, drawn the same way everywhere:

- **The strip**: a chip per folder (label, and a colour dot if agreed), a
  count, and **Add folder**.
- **Add folder** opens the picker (a dialog on a computer, a bottom sheet on a
  phone, as `docs/DESIGN.md` §11 asks):
  - **Search**: type a name; matching folders from the BGP library and the
    person's OneDrive, each with its path.
  - **Browse**: start at `BGP - Share Drive`, My OneDrive or Followed;
    breadcrumbs; folders first.
  - **New folder here**: a name, optionally a template, created where the
    person is browsing, then linked.
  - Tick several and **Link**. "Paste a link instead" stays as a small option.
- **An open folder**: breadcrumbs, list or grid, sort and filter (as the client
  panel and the SharePoint page already do), tick several, and a row menu
  that can always be seen: Open in SharePoint, Preview, Rename, Move, Copy to,
  Share, Delete. Drop files to upload, with progress. App dialogs throughout,
  no browser prompts.
- **On the chip**: Rename the label, colour, Move up or down, Unlink, and
  "Also linked to …".
- **Client mode**: the same look, read only, inside the data room; download;
  no picker.

It replaces `PropertyFoldersPanel`, `PropertySharepointLink`,
`ClientPropertyFoldersPanel` (keeping its test ids), Set Up Folders and the
Folder tree column (as "New folder here" with a template), the landlord Files
card's panel, the brand page's "Open folder" link, the deal page's card, the
Lease Advisory and Pathway folder cards, the scheme link box, Document Studio's
folder dialog (as "choose a folder"), Legal & DD's Create Project (as "New
folder here" with the analysis's sub-folders) and the ChatBGP page's tree.

### 4.6 Who may do what

| | BGP staff, as themselves | Staff viewing as a client | Client login | Joint agent |
|---|---|---|---|---|
| See a record's folders | linked and inherited | as the client | only folders inside its data room | only bound folders at its own schemes |
| Link, unlink, label, colour | on records they can open | no | no | no |
| Search, browse, create in the picker | yes, with their own token | no | no | no |
| Rename, move, copy, delete, upload, share | yes, with their own token, so SharePoint applies their own rights | no | download only (decision 9) | download only |
| Preview | yes | no | no (the preview address acts as whoever asked for it, so an app-token preview would act as the app) | no |

A staff member who has not connected Microsoft 365 is asked to connect, not
given a colleague's token (decision 7). Every action goes into
`folder_actions`, with both the person and the Microsoft account Graph saw.

### 4.7 Moving the existing links over

Report first, never at boot, the house pattern of Preview, Apply and Undo:

1. **Preview** (`GET /api/admin/folders/migration`, admins): one row for each
   stored address (properties' default and team links, companies, deals,
   schemes, Lease Advisory matters, Pathway runs) with the record, the label,
   the stored value, what it opens to now (name, path, drive and item) and a
   status: opens, missing, not a folder, outside BGP's tenant, or no access.
   One row for each `folder_teams` path guess, saying whether the path exists
   (none of 20 sampled did). For records with no folder that opens, a
   suggested match found by name in `BGP - Share Drive`, shown as a suggestion
   only.
2. **Apply**: the rows the same admin ticked on that preview, within the hour.
   Each becomes a `record_folders` row with `source = migrated:<column>`, in
   one logged batch.
3. **Undo** takes a batch's rows back out.

The old columns stay, and are still read where no link exists, until Woody
agrees to stop reading them. The data room (decision 6) is a separate step.

On live the numbers are small: 2 property defaults, an uncounted number of
team links, 3 deal links, the Landsec root, and 109 path guesses that mostly
open nothing.

### 4.8 Naming

- "Folders" everywhere: the card, the button, the empty state ("No folders yet
  · Add folder"). The deal page's pill stays "Files": it holds the unit's files
  and the Folders card. Inherited folders say where they come from ("From
  Bluewater Shopping Centre").
- Image Studio's "Rebuild property folders" becomes "Rebuild property albums",
  and the Settings section becomes whatever decision 11 leaves, so that
  "folder" means one thing.
- `server/chatbgp-app-map.ts` lines 82, 84, 94 and 175 describe Set Up
  Folders, the Folders button, the Files tabs with Link folder for and Add
  folder, and the deal Files pill; they change in the same commit as the
  screens. `qa/smoke.mjs` lines 300–302 press `button-property-folders`
  and wait for `client-property-folders-panel`; those ids stay or the checks
  change with them.

### 4.9 Order of work

What to build first is steps 1 and 2: that is Woody's ask (find a folder in
SharePoint or OneDrive, link it or create one, several per record, called
Folders) on the deal page and the property page.

0. **Quick fixes, no new table**: rename "Property folder" to "Folders" on the
   deal page and in the app map; stop offering Set Up Folders to teams with no
   template (or give them the property template); fix the brand page's
   fallback and the wrong host in the link box; show the deal's own link on
   the Files pill until it moves.
1. **The engine's base**: the two tables; `server/folders/graph.ts` with the
   one library lookup and one link opener; list, link, unlink, places, browse,
   search and create; staff only, each with their own token.
2. **The component and the picker** on the deal Files pill and on both
   property layouts. Existing address links show through a read-only adapter
   until migrated. Client mode keeps today's data-room reads and test ids.
3. **Inside a folder**: rename, move within the library, copy to another
   library, delete, upload (sessions above 10 MiB), share, preview, follow; the
   app colour if agreed.
4. **The migration** report, apply and undo.
5. **Everything else onto the engine**: the landlord Files card, the brand
   page, Lease Advisory, Pathway, schemes, Document Studio, Legal & DD and the
   ChatBGP page on the component; ChatBGP's tools, Model Studio's assistant,
   the MCP tools, the client-tree job, the Lease Advisory template and the
   documents the app files on the module.
   Then delete the duplicates in section 2 and the dead code in 1.5.
6. **Tokens and permissions**: no colleague fallback for folder actions;
   review the app's own permissions (decision 10).

Each step needs pure rules in `shared/` with tests in `npm test`, guards in
`qa/regression` for the gateway and the fence, and a check in a browser on a
computer and a phone before it ships.

## 5. Decisions for Woody

1. **A new table for folder links?** It stores Microsoft's IDs, so a renamed
   or moved folder still opens, and any record can hold several. It is a
   schema change. Recommended: yes.
2. **Where does a new folder go?** Today the app creates folders under
   `BGP share drive/<retired team>/…`, which the team does not use.
   Recommended: the picker opens in `BGP - Share Drive`, the person chooses
   where, and nothing new is made in `BGP share drive`. Woody to say where each
   team should start (for example, does Shopping Centre start in
   `BGP - Share Drive / National`?).
3. **Templates?** Recommended: "New folder" makes an empty folder; "New
   property folder" offers one template (the client tree's five property
   folders: Instructions & appointments, Letting & marketing, Tenancy
   schedules & units, Property media, Archive); retire the templates keyed by
   retired team names. Or Woody gives a template per 2026 team.
4. **Deal or property?** Recommended: a deal shows its own folders and its
   property's; Add folder on a deal links to the deal, with a tick to put it
   on the property instead.
5. **Colour?** Graph has no documented way to read or set OneDrive's folder
   colour. Recommended: six muted app colours on the folder chip, defined as
   design tokens and seen in the app only. `docs/DESIGN.md` §1 says colours are
   tokens and not decoration, so this is a deliberate exception. The other
   answer is no colour.
6. **Landsec's data room?** A client sees one root folder and what is inside
   it. Landsec's root is `BGP share drive/Landsec`, which holds one folder, and
   a property's bound folder is shown only when it sits inside that root
   (`resolveBoundPropertyRoot`, `server/client-sharepoint.ts`). The team's
   scheme folders are in its own Landsec folder, which also holds a Fee
   Agreement and internal leasing schedules, so moving the root there would
   show those to Landsec. Recommended: let BGP staff share chosen folders with
   a client from the picker, wherever they sit in the BGP library, so that per
   scheme a person picks the folder Landsec may see. The client then sees those
   folders and what is inside them, and a joint agent those at its schemes.
   This changes the data room's fence, so it is its own step after the
   migration. The other answer keeps the one root and has the team copy what
   Landsec may see into `BGP share drive/Landsec/<scheme>`.
7. **Act as yourself?** Today a staff member who has never connected Microsoft
   365 acts as a colleague. Recommended: folder actions ask them to connect
   instead.
8. **The app's picker or Microsoft's?** Recommended: the app's own (no
   Microsoft token in the browser, no new Azure permissions, the app's design).
   Keep Microsoft's File Picker in reserve.
9. **Clients uploading?** Recommended: not in the first build. Later, upload
   into their own data-room folders only.
10. **The app's own Microsoft permissions?** The app's token can read and
    change every site and every OneDrive in BGP's tenant
    (Sites.FullControl.All and more). Recommended: review them with BGP's
    Microsoft administrator. The folder engine acts with each person's own
    token; the client data room only needs to read the BGP site; mail and
    calendar features use the app token too, so nothing is removed without
    checking them.
11. **The server-disk team folders in Settings?** Recommended: check what is
    in them, copy anything needed into SharePoint, then retire the section.

## Sources

Microsoft documentation, read on 20 November 2026. Each quote above was
checked word for word against the published source of these pages
(Microsoft's documentation repositories on GitHub) and, for the Q&A, the page
itself; the permissions are from each page's permission table.

- driveItem resource: https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0 and https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-beta
- folder resource: https://learn.microsoft.com/en-us/graph/api/resources/folder?view=graph-rest-1.0 and https://learn.microsoft.com/en-us/graph/api/resources/folder?view=graph-rest-beta
- Search a drive: https://learn.microsoft.com/en-us/graph/api/driveitem-search?view=graph-rest-1.0
- Search OneDrive and SharePoint: https://learn.microsoft.com/en-us/graph/search-concept-files
- Search query: https://learn.microsoft.com/en-us/graph/api/search-query?view=graph-rest-1.0
- Search API overview: https://learn.microsoft.com/en-us/graph/api/resources/search-api-overview?view=graph-rest-1.0
- searchRequest: https://learn.microsoft.com/en-us/graph/api/resources/searchrequest?view=graph-rest-1.0
- List children: https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0
- Create folder: https://learn.microsoft.com/en-us/graph/api/driveitem-post-children?view=graph-rest-1.0
- Update (rename): https://learn.microsoft.com/en-us/graph/api/driveitem-update?view=graph-rest-1.0
- Move: https://learn.microsoft.com/en-us/graph/api/driveitem-move?view=graph-rest-1.0
- Copy: https://learn.microsoft.com/en-us/graph/api/driveitem-copy?view=graph-rest-1.0
- Delete: https://learn.microsoft.com/en-us/graph/api/driveitem-delete?view=graph-rest-1.0
- Upload small files: https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0
- Upload session: https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0
- Sharing link: https://learn.microsoft.com/en-us/graph/api/driveitem-createlink?view=graph-rest-1.0
- Invite: https://learn.microsoft.com/en-us/graph/api/driveitem-invite?view=graph-rest-1.0
- List permissions: https://learn.microsoft.com/en-us/graph/api/driveitem-list-permissions?view=graph-rest-1.0
- Delta: https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0
- Thumbnails: https://learn.microsoft.com/en-us/graph/api/driveitem-list-thumbnails?view=graph-rest-1.0
- Preview: https://learn.microsoft.com/en-us/graph/api/driveitem-preview?view=graph-rest-1.0
- Follow: https://learn.microsoft.com/en-us/graph/api/driveitem-follow?view=graph-rest-1.0
- Followed items: https://learn.microsoft.com/en-us/graph/api/drive-list-following?view=graph-rest-1.0
- Shared items: https://learn.microsoft.com/en-us/graph/api/shares-get?view=graph-rest-1.0
- Selected permissions: https://learn.microsoft.com/en-us/graph/permissions-selected-overview
- OneDrive File Picker v8: https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/
- File Picker v8 settings: https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/v8-schema
- Microsoft Q&A on folder icon colour: https://learn.microsoft.com/en-us/answers/questions/1436418/how-do-i-change-the-iconcolor-of-a-sharepoint-grap

Read from the live app on 20 November 2026 with the QA login, read only,
through its Railway address: `GET /api/admin/graph-permissions`; the company
list (names and types, to find Landsec); the Landsec brand profile's folder
fields; `GET /api/accounts/<Landsec>/folder-inventory`; the staff property and
deal lists (counts only) and a property search for Bluewater;
`GET /api/crm/properties/<Bluewater>/sharepoint-folders`;
`GET /api/microsoft/team-folders`; and folder listings through
`GET /api/microsoft/files` and `GET /api/microsoft/property-folders`, for the
top of the BGP library, the first level of `BGP share drive` and
`BGP - Share Drive`, the Landsec folders, and 21 property paths (20 sampled
and Bluewater). Nothing was written.
