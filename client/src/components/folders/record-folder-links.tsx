// A record's folders, read only (Woody, 24 November 2026: "go ahead with the
// folder suggestion"; docs/folders-review-2026-11-20.md, 4.5): the ChatBGP
// page's property panels list the property's Folders, each opening in
// SharePoint. Linking, making and changing folders stay on the record's own
// Folders. BGP staff only: a client login (or staff viewing as one) never
// calls /api/folders/, so it is shown nothing here.
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Folder, Loader2 } from "lucide-react";
import type { FolderLinkView, FolderRecordType, RecordFoldersView } from "@shared/folders";
import { FolderApiError, folderApi, recordFoldersKey } from "./folder-api";

/** BGP staff signed in as themselves, as the screens can tell: a client login, or staff viewing as a client, is not. */
export function useIsFolderStaff(): boolean {
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  return !!me && me.role !== "Client" && !me.companyScopeId;
}

function FolderLinkRow({ folder }: { folder: FolderLinkView }) {
  const warn = folder.status === "missing" ? "Not in SharePoint any more" : folder.status === "no_access" ? "SharePoint says you can't open it" : null;
  const body = (
    <>
      {warn ? <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <Folder className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{folder.label}{folder.legacy ? <span className="font-normal text-muted-foreground"> · old link</span> : null}</span>
        {(warn || folder.path) && <span className="block truncate text-[11px] text-muted-foreground">{warn || folder.path}</span>}
      </span>
      {folder.webUrl && <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground" />}
    </>
  );
  return folder.webUrl ? (
    <a href={folder.webUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40" title={folder.path || folder.webUrl} data-testid={`folder-link-${folder.id}`}>{body}</a>
  ) : (
    <div className="flex items-center gap-2 px-2 py-1.5" data-testid={`folder-link-${folder.id}`}>{body}</div>
  );
}

export function RecordFolderLinks({ recordType, recordId, testId = "record-folder-links" }: { recordType: FolderRecordType; recordId: string; testId?: string }) {
  const staff = useIsFolderStaff();
  const query = useQuery<RecordFoldersView, FolderApiError>({
    queryKey: recordFoldersKey(recordType, recordId),
    queryFn: () => folderApi("GET", `/api/folders/${recordType}/${recordId}`),
    enabled: staff && !!recordId,
    retry: false,
  });
  if (!staff) return null;
  const view = query.data;
  const groups = view ? [{ from: null, folders: view.folders }, ...view.inherited].filter(g => g.folders.length > 0) : [];
  return (
    <div className="space-y-1" data-testid={testId}>
      {query.isLoading ? (
        <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Reading the folders…</div>
      ) : query.error ? (
        <p className="py-1 text-[11px] text-muted-foreground">{query.error.message}</p>
      ) : !groups.length ? (
        <p className="py-1 text-[11px] text-muted-foreground" data-testid={`${testId}-empty`}>
          No folders yet.{recordType === "property" ? <> Add them on the <Link href={`/properties/${recordId}`} className="text-primary underline underline-offset-2">property's Folders</Link>.</> : null}
        </p>
      ) : (
        groups.map(g => (
          <div key={g.from ? `${g.from.type}:${g.from.id}` : "own"} className="space-y-0.5">
            {g.from && <p className="px-2 pt-1 text-[11px] text-muted-foreground">From {g.from.name}</p>}
            {g.folders.map(f => <FolderLinkRow key={f.id} folder={f} />)}
          </div>
        ))
      )}
    </div>
  );
}
