import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderOpen,
  Folder,
  File,
  ChevronRight,
  ArrowLeft,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  Image,
  Film,
  FileArchive,
  Presentation,
  MessageSquare,
} from "lucide-react";

interface SharePointItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
}

interface BreadcrumbEntry {
  id?: string;
  driveId?: string;
  name: string;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(item: SharePointItem) {
  if (item.folder) return <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />;
  const mime = item.file?.mimeType || "";
  const name = item.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) return <FileSpreadsheet className="w-4 h-4 text-green-600 flex-shrink-0" />;
  if (name.endsWith(".pptx") || name.endsWith(".ppt")) return <Presentation className="w-4 h-4 text-orange-500 flex-shrink-0" />;
  if (name.endsWith(".docx") || name.endsWith(".doc") || name.endsWith(".pdf")) return <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />;
  if (mime.startsWith("image/") || name.match(/\.(png|jpg|jpeg|gif|svg)$/)) return <Image className="w-4 h-4 text-purple-500 flex-shrink-0" />;
  if (mime.startsWith("video/") || name.match(/\.(mp4|mov|avi)$/)) return <Film className="w-4 h-4 text-pink-500 flex-shrink-0" />;
  if (name.match(/\.(zip|rar|7z|tar|gz)$/)) return <FileArchive className="w-4 h-4 text-gray-500 flex-shrink-0" />;
  return <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function SharePointWidget() {
  const [, navigate] = useLocation();
  const [folderId, setFolderId] = useState<string | undefined>();
  const [driveId, setDriveId] = useState<string | undefined>();
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([{ name: "SharePoint" }]);

  const sendToChat = (item: SharePointItem) => {
    const msg = `Please read this SharePoint file: [${item.name}](${item.webUrl})`;
    navigate(`/chatbgp?message=${encodeURIComponent(msg)}`);
  };

  const queryKey = ["/api/microsoft/files", folderId, driveId];
  const { data, isLoading, error, refetch } = useQuery<{ items: SharePointItem[]; driveId?: string }>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (folderId) params.set("folderId", folderId);
      if (driveId) params.set("driveId", driveId);
      const res = await fetch(`/api/microsoft/files?${params}`, { credentials: "include" });
      if (!res.ok) {
        const err = new Error(res.status === 401 ? "auth" : "server") as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    staleTime: 60000,
  });

  const items = data?.items || [];
  const currentDriveId = data?.driveId || driveId;

  const folders = items.filter(i => i.folder).sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter(i => !i.folder).sort((a, b) => {
    const aTime = a.lastModifiedDateTime ? new Date(a.lastModifiedDateTime).getTime() : 0;
    const bTime = b.lastModifiedDateTime ? new Date(b.lastModifiedDateTime).getTime() : 0;
    return bTime - aTime;
  });
  const sorted = [...folders, ...files];

  const navigateToFolder = (item: SharePointItem) => {
    setFolderId(item.id);
    if (currentDriveId) setDriveId(currentDriveId);
    setBreadcrumbs(prev => [...prev, { id: item.id, driveId: currentDriveId, name: item.name }]);
  };

  const navigateBack = () => {
    if (breadcrumbs.length <= 1) return;
    const newCrumbs = breadcrumbs.slice(0, -1);
    const target = newCrumbs[newCrumbs.length - 1];
    setBreadcrumbs(newCrumbs);
    setFolderId(target.id);
    setDriveId(target.driveId);
  };

  const navigateToCrumb = (index: number) => {
    const newCrumbs = breadcrumbs.slice(0, index + 1);
    const target = newCrumbs[newCrumbs.length - 1];
    setBreadcrumbs(newCrumbs);
    setFolderId(target.id);
    setDriveId(target.driveId);
  };

  return (
    <Card className="h-full flex flex-col" data-testid="widget-sharepoint">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-blue-600" />
          <CardTitle className="text-sm font-semibold">SharePoint Files</CardTitle>
        </div>
      </CardHeader>
      <div className="px-4 pb-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-hidden">
          {breadcrumbs.length > 1 && (
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 flex-shrink-0" onClick={navigateBack} data-testid="button-sharepoint-back">
              <ArrowLeft className="w-3 h-3" />
            </Button>
          )}
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground/50" />}
              <button
                onClick={() => navigateToCrumb(i)}
                className={`hover:underline truncate max-w-[100px] ${i === breadcrumbs.length - 1 ? "font-medium text-foreground" : ""}`}
                data-testid={`button-sharepoint-crumb-${i}`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      </div>
      <CardContent className="p-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {isLoading ? (
            <div className="px-4 space-y-2 pb-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center space-y-2" data-testid="text-sharepoint-error">
              <p className="text-sm text-muted-foreground">
                {(error as any)?.message === "auth"
                  ? "Connect to Microsoft 365 to view SharePoint files"
                  : "Couldn't load files — please try again"}
              </p>
              {(error as any)?.message !== "auth" && (
                <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-sharepoint-retry">
                  Retry
                </Button>
              )}
            </div>
          ) : sorted.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="text-sharepoint-empty">
              This folder is empty
            </div>
          ) : (
            <div className="divide-y" data-testid="list-sharepoint-files">
              {sorted.map(item => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2.5 px-4 py-2 hover:bg-muted/50 transition-colors ${item.folder ? "cursor-pointer" : ""}`}
                  onClick={() => item.folder && navigateToFolder(item)}
                  data-testid={`sharepoint-item-${item.id}`}
                >
                  {getFileIcon(item)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {item.folder && <span>{item.folder.childCount} items</span>}
                      {!item.folder && item.size && <span>{formatFileSize(item.size)}</span>}
                      {item.lastModifiedDateTime && <span>{timeAgo(item.lastModifiedDateTime)}</span>}
                    </div>
                  </div>
                  {item.folder ? (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
                  ) : (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {item.webUrl && (
                        <button
                          onClick={e => { e.stopPropagation(); sendToChat(item); }}
                          className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                          title="Send to ChatBGP"
                          data-testid={`button-chat-${item.id}`}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {item.webUrl && (
                        <a
                          href={item.webUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Open in SharePoint"
                          data-testid={`button-open-${item.id}`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
