// The client app's SharePoint surface — standard folder/file browsing,
// jailed server-side to the company's own SharePoint folder (the Landsec
// folder holding the per-property folder trees). See server/client-sharepoint.ts.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChevronRight, Cloud, Download, Folder, File as FileIcon, Home } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";

interface SpItem {
  id: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  isFolder: boolean;
  childCount: number | null;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClientSharePointBrowser() {
  // Breadcrumb trail from the root; the last entry is the open folder.
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([]);

  const { data: root, isLoading: rootLoading, error: rootError } = useQuery<{ id: string; name: string }>({
    queryKey: ["/api/client/sharepoint/root"],
    queryFn: async () => {
      const r = await fetch("/api/client/sharepoint/root", { headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || "SharePoint unavailable");
      return r.json();
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const currentId = trail.length > 0 ? trail[trail.length - 1].id : root?.id;
  const { data: listing, isLoading: listLoading } = useQuery<{ items: SpItem[] }>({
    queryKey: ["/api/client/sharepoint/list", currentId],
    queryFn: async () => {
      const r = await fetch(`/api/client/sharepoint/list?itemId=${encodeURIComponent(currentId!)}`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error("Couldn't list folder");
      return r.json();
    },
    enabled: !!currentId,
    staleTime: 60_000,
  });

  if (rootLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }
  if (rootError || !root) {
    return (
      <div className="p-10 text-center text-muted-foreground" data-testid="client-sharepoint-empty">
        <Cloud className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">{(rootError as any)?.message || "No SharePoint folder is linked for your company yet — ask your BGP team."}</p>
      </div>
    );
  }

  const items = listing?.items || [];
  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="client-sharepoint-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Cloud className="w-6 h-6" /> SharePoint
        </h1>
        <p className="text-sm text-muted-foreground">Your document library — property folder trees, shared by your BGP team.</p>
      </div>

      <div className="flex items-center gap-1 text-sm flex-wrap" data-testid="client-sharepoint-breadcrumb">
        <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setTrail([])}>
          <Home className="w-3.5 h-3.5" /> {root.name}
        </button>
        {trail.map((t, i) => (
          <span key={t.id} className="inline-flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
            <button
              className={i === trail.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground"}
              onClick={() => setTrail(trail.slice(0, i + 1))}
            >
              {t.name}
            </button>
          </span>
        ))}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-[110px]">Size</TableHead>
              <TableHead className="w-[160px]">Modified</TableHead>
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listLoading && (
              <TableRow><TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
            )}
            {!listLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-muted-foreground text-sm">This folder is empty.</TableCell>
              </TableRow>
            )}
            {items.map(item => (
              <TableRow key={item.id} className={item.isFolder ? "cursor-pointer hover:bg-muted/40" : undefined}
                onClick={item.isFolder ? () => setTrail([...trail, { id: item.id, name: item.name }]) : undefined}
                data-testid={`sp-item-${item.id}`}
              >
                <TableCell className="font-medium text-sm">
                  <span className="inline-flex items-center gap-2">
                    {item.isFolder
                      ? <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                      : <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="truncate">{item.name}</span>
                    {item.isFolder && item.childCount != null && (
                      <span className="text-[10px] text-muted-foreground">({item.childCount})</span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">{item.isFolder ? "—" : formatSize(item.size)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.lastModified ? new Date(item.lastModified).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</TableCell>
                <TableCell>
                  {!item.isFolder && (
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={e => e.stopPropagation()}>
                      <a href={`/api/client/sharepoint/content?itemId=${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer">
                        <Download className="w-3.5 h-3.5" /> Open
                      </a>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
