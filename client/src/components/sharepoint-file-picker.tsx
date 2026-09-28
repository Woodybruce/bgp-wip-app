// "Find in SharePoint" — the picker behind the Brochures panel's SharePoint
// action and the Tenancy Schedule's "From SharePoint" import. Lists the
// ranked candidates the server found (linked folder, Microsoft 365 search,
// indexed files); one click imports. Staff only — callers hide it for
// client logins.

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

export interface SharePointCandidate {
  name: string;
  path: string;
  webUrl: string | null;
  driveId: string | null;
  itemId: string | null;
  size: number | null;
  lastModified: string | null;
  docDate?: string | null;
  source: "folder" | "search" | "index";
  type?: "leasing" | "investment";
  imported?: boolean;
}

interface CandidateResponse {
  candidates: SharePointCandidate[];
  linkedFolder: string | null;
  linkedFolders?: string[];
  propertyName: string;
  warnings: string[];
}

export const candidateKey = (c: SharePointCandidate) => c.itemId || c.webUrl || c.name;

const SOURCE_LABEL: Record<SharePointCandidate["source"], string> = {
  folder: "Linked folder",
  search: "SharePoint search",
  index: "Indexed files",
};

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export function SharePointFilePicker({
  open, onClose, title, url, importLabel, importingKey, onImport, header,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  url: string;
  importLabel: string;
  importingKey: string | null;
  onImport: (candidate: SharePointCandidate) => void;
  header?: ReactNode;
}) {
  const { data, isLoading, error } = useQuery<CandidateResponse>({
    queryKey: [url],
    enabled: open,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const r = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      return body;
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {!data
              ? "Looking in the property's SharePoint folder and searching SharePoint…"
              : data.linkedFolder
                ? `From the ${(data.linkedFolders?.length || 1) > 1 ? `${data.linkedFolders!.length} linked folders` : "linked folder"} and a SharePoint search for “${data.propertyName}”.`
                : `No SharePoint folder is linked to this property, so these are search results for “${data.propertyName}”. Link the folder in Files to include it.`}
          </DialogDescription>
        </DialogHeader>
        {header}
        {data?.warnings?.length ? (
          <ul className="text-[11px] text-muted-foreground space-y-0.5">
            {data.warnings.map(w => <li key={w}>{w}</li>)}
          </ul>
        ) : null}
        <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1" data-testid="sharepoint-candidates">
          {isLoading ? (
            <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
          ) : !data?.candidates.length ? (
            <p className="text-sm text-muted-foreground">Nothing found in SharePoint for “{data?.propertyName}”.</p>
          ) : (
            data.candidates.map(c => {
              const key = candidateKey(c);
              const busy = importingKey === key;
              const meta = [fmtMonth(c.docDate || c.lastModified), fmtSize(c.size), SOURCE_LABEL[c.source], c.type ? (c.type === "investment" ? "Investment" : "Leasing") : ""].filter(Boolean).join(" · ");
              return (
                <div key={key} className="flex items-start gap-3 py-2 border-b border-border last:border-0" data-testid="sharepoint-candidate">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" title={c.name}>{c.name}</p>
                    {c.path && <p className="text-[11px] text-muted-foreground truncate" title={c.path}>{c.path}</p>}
                    <p className="text-[11px] text-muted-foreground">{meta}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.webUrl && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Open in SharePoint">
                        <a href={c.webUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in SharePoint">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </Button>
                    )}
                    {c.imported ? (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Imported</span>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!importingKey} onClick={() => onImport(c)}>
                        {busy && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}{importLabel}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
