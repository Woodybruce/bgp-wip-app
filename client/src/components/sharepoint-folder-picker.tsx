// Pick a folder in the BGP Share Drive (Woody, 23 November 2026: "existing
// folder with a pop out to the BGP share drive and ability to go in and pick a
// folder"). It opens in the BGP site's documents, steps into "BGP - Share
// Drive" when it is there, and lists folders only. On the person's own
// Microsoft 365 connection (GET /api/microsoft/files), so it shows what they
// may open.
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

export interface PickedFolder { driveId: string; id: string; name: string; webUrl: string | null; path: string }
interface Crumb { id: string | null; name: string; webUrl: string | null }
interface DriveItem { id: string; name: string; webUrl?: string | null; folder?: { childCount?: number } | null }

const SHARE_DRIVE = "BGP - Share Drive";

export function ShareDriveFolderPicker({ open, onOpenChange, title, description, pickLabel = "Use this folder", onPick }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; pickLabel?: string;
  onPick: (folder: PickedFolder) => void;
}) {
  const [driveId, setDriveId] = useState<string | null>(null);
  const [stack, setStack] = useState<Crumb[]>([{ id: null, name: "Documents", webUrl: null }]);
  const steppedIn = useRef(false);
  useEffect(() => { if (!open) { setDriveId(null); setStack([{ id: null, name: "Documents", webUrl: null }]); steppedIn.current = false; } }, [open]);
  const status = useQuery<{ connected?: boolean }>({ queryKey: ["/api/microsoft/status"], enabled: open });
  const here = stack[stack.length - 1];
  const list = useQuery<{ items: DriveItem[]; driveId: string | null }>({
    queryKey: ["/api/microsoft/files", driveId, here.id],
    enabled: open && !!status.data?.connected,
    queryFn: async () => {
      const q = new URLSearchParams();
      if (driveId) q.set("driveId", driveId);
      if (here.id) q.set("folderId", here.id);
      return (await apiRequest("GET", `/api/microsoft/files${q.toString() ? `?${q}` : ""}`)).json();
    },
  });
  // The drive comes back with the first listing; "BGP - Share Drive" is opened once, at the top.
  useEffect(() => {
    if (!list.data) return;
    if (!driveId && list.data.driveId) setDriveId(list.data.driveId);
    if (!steppedIn.current && stack.length === 1) {
      steppedIn.current = true;
      const share = list.data.items.find(i => i.folder && i.name === SHARE_DRIVE);
      if (share) setStack(s => [...s, { id: share.id, name: share.name, webUrl: share.webUrl || null }]);
    }
  }, [list.data]);
  const folders = (list.data?.items || []).filter(i => i.folder).sort((a, b) => a.name.localeCompare(b.name));
  const path = stack.slice(1).map(c => c.name).join(" / ");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="share-drive-folder-picker">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {status.isLoading ? <div className="text-sm text-muted-foreground">Reading…</div>
          : !status.data?.connected ? (
            <p className="text-sm text-muted-foreground">Connect your Microsoft 365 account first, on the <Link href="/sharepoint" className="underline underline-offset-2">SharePoint</Link> page.</p>
          ) : (
            <div className="space-y-2">
              <nav className="flex flex-wrap items-center gap-1 text-xs" aria-label="Folder path" data-testid="share-drive-crumbs">
                {stack.map((c, i) => (
                  <span key={`${c.id}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    {i < stack.length - 1
                      ? <button type="button" className="text-muted-foreground underline-offset-2 hover:underline hover:text-foreground" onClick={() => setStack(s => s.slice(0, i + 1))}>{c.name}</button>
                      : <span className="font-medium">{c.name}</span>}
                  </span>
                ))}
              </nav>
              <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border" data-testid="share-drive-folders">
                {list.isLoading ? <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading the folder…</div>
                  : list.isError ? <div className="p-3 text-sm text-muted-foreground">The folder could not be read. Reconnect Microsoft 365 on the SharePoint page if this goes on.</div>
                  : folders.length === 0 ? <div className="p-3 text-sm text-muted-foreground">No folders in here.</div>
                  : (
                    <ul className="divide-y divide-border">
                      {folders.map(f => (
                        <li key={f.id}>
                          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60" onClick={() => setStack(s => [...s, { id: f.id, name: f.name, webUrl: f.webUrl || null }])} data-testid={`share-drive-folder-${f.id}`}>
                            <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{f.name}</span>
                            {f.folder?.childCount != null && <span className="text-[11px] text-muted-foreground tabular-nums">{f.folder.childCount}</span>}
                            <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            </div>
          )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!status.data?.connected || !driveId || !here.id} onClick={() => { if (driveId && here.id) onPick({ driveId, id: here.id, name: here.name, webUrl: here.webUrl, path }); }} data-testid="share-drive-pick">
            {pickLabel}{here.id ? `: ${here.name}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
