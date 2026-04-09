import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, getQueryFn, getAuthHeaders } from "@/lib/queryClient";
import {
  FolderOpen,
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  ArrowLeft,
  Cloud,
  CloudOff,
  ExternalLink,
  Download,
  RefreshCw,
  FolderPlus,
  Users,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Star,
} from "lucide-react";
import type { User } from "@shared/schema";
import { useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  "@microsoft.graph.downloadUrl"?: string;
  parentReference?: { driveId: string };
}

interface TeamFolder {
  name: string;
  id: string;
  webUrl: string;
  childCount: number;
}

function getFileIcon(item: DriveItem) {
  if (item.folder) return FolderOpen;
  const name = item.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".csv")) return FileSpreadsheet;
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) return FileImage;
  if (name.endsWith(".doc") || name.endsWith(".docx") || name.endsWith(".pdf")) return FileText;
  return File;
}

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const teamColors: Record<string, string> = {
  "Investment": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "London Leasing": "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "Lease Advisory": "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  "National Leasing": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "Tenant Rep": "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  "Development": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "Office / Corporate": "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

function ConnectPrompt() {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    const authWindow = window.open("about:blank", "_blank");
    try {
      const res = await apiRequest("GET", "/api/microsoft/auth");
      const data = await res.json();
      if (authWindow) {
        authWindow.location.href = data.authUrl;
      } else {
        window.location.href = data.authUrl;
      }
    } catch {
      if (authWindow) authWindow.close();
      setConnecting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="space-y-1 mb-6">
        <h1 className="text-2xl font-bold tracking-tight">SharePoint & Files</h1>
        <p className="text-sm text-muted-foreground">Connect to Microsoft 365 to access your files</p>
      </div>
      <Card className="max-w-md mx-auto">
        <CardContent className="p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto">
            <Cloud className="w-8 h-8 text-blue-500" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Connect to Microsoft 365</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in with your Microsoft account to access SharePoint files, calendar, and email.
              A new tab will open for sign-in.
            </p>
          </div>
          <Button onClick={handleConnect} disabled={connecting} data-testid="button-connect-microsoft">
            {connecting ? "Sign-in tab opened..." : "Connect Microsoft 365"}
          </Button>
          {connecting && (
            <p className="text-xs text-muted-foreground mt-2">
              Complete sign-in in the new tab, then come back here and refresh the page.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TeamFoldersSection({
  onOpenFolder,
}: {
  onOpenFolder: (folderId: string, folderName: string, driveId: string) => void;
}) {
  const { toast } = useToast();
  const { data: user } = useQuery<User>({ queryKey: ["/api/auth/me"] });
  const userTeam = user?.team;

  const { data: teamFoldersData, isLoading: foldersLoading } = useQuery<{
    folders: TeamFolder[];
    driveId: string;
  }>({
    queryKey: ["/api/microsoft/team-folders"],
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/microsoft/team-folders/setup");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/microsoft/team-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/microsoft/files"] });
      const created = data.folders?.filter((f: any) => f.status === "created").length || 0;
      const existing = data.folders?.filter((f: any) => f.status === "exists").length || 0;
      toast({
        title: "Team folders ready",
        description: created > 0
          ? `Created ${created} new folder(s). ${existing} already existed.`
          : "All team folders already exist.",
      });
    },
    onError: () => {
      toast({
        title: "Setup failed",
        description: "Could not create team folders. Check SharePoint permissions.",
        variant: "destructive",
      });
    },
  });

  const folders = teamFoldersData?.folders || [];
  const driveId = teamFoldersData?.driveId || "";
  const hasFolders = folders.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4" />
          Team Folders
        </CardTitle>
        {!hasFolders && !foldersLoading && (
          <Button
            size="sm"
            onClick={() => setupMutation.mutate()}
            disabled={setupMutation.isPending}
            data-testid="button-setup-team-folders"
          >
            {setupMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <FolderPlus className="w-3.5 h-3.5 mr-1.5" />
                Create Team Folders
              </>
            )}
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {foldersLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : hasFolders ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...folders].sort((a, b) => {
              if (a.name === userTeam) return -1;
              if (b.name === userTeam) return 1;
              return 0;
            }).map((folder) => {
              const isUserTeam = folder.name === userTeam;
              return (
                <Card
                  key={folder.name}
                  className={`cursor-pointer hover:border-primary/50 transition-colors ${isUserTeam ? "ring-2 ring-primary/30 border-primary/40" : ""}`}
                  onClick={() => onOpenFolder(folder.id, folder.name, driveId)}
                  data-testid={`team-folder-${folder.name.toLowerCase().replace(/\s/g, "-")}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${teamColors[folder.name] || "bg-muted text-muted-foreground"}`}>
                        <FolderOpen className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold truncate">{folder.name}</p>
                          {isUserTeam && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                              <Star className="w-2.5 h-2.5 mr-0.5" />
                              Your Team
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{folder.childCount} items</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <FolderPlus className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No team folders found in SharePoint</p>
            <p className="text-xs mt-1">Click "Create Team Folders" to set up London, National, Tenant Rep, and Development folders</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SharePoint() {
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [driveId, setDriveId] = useState<string | null>(null);
  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  const { data: status, isLoading: statusLoading } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/microsoft/status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: filesData, isLoading: filesLoading } = useQuery<{ items: DriveItem[]; driveId: string | null }>({
    queryKey: ["/api/microsoft/files", currentFolderId || "root", driveId || ""],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (currentFolderId) params.set("folderId", currentFolderId);
      if (driveId) params.set("driveId", driveId);
      const qs = params.toString();
      const url = `/api/microsoft/files${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch files");
      const data = await res.json();
      if (data.driveId && !driveId) {
        setDriveId(data.driveId);
      }
      return data;
    },
    enabled: status?.connected === true,
  });

  const files = filesData?.items;

  if (statusLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="grid gap-2 mt-6">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      </div>
    );
  }

  if (!status?.connected) {
    return <ConnectPrompt />;
  }

  const openFolder = (item: DriveItem) => {
    setFolderStack([...folderStack, { id: item.id, name: item.name }]);
  };

  const openTeamFolder = (folderId: string, folderName: string, teamDriveId: string) => {
    if (teamDriveId) setDriveId(teamDriveId);
    setFolderStack([{ id: folderId, name: folderName }]);
  };

  const goBack = () => {
    setFolderStack(folderStack.slice(0, -1));
  };

  const breadcrumb = [{ id: "root", name: "BGP SharePoint" }, ...folderStack];

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="sharepoint-page">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">SharePoint & Files</h1>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            {breadcrumb.map((item, i) => (
              <span key={item.id} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                {i < breadcrumb.length - 1 ? (
                  <button
                    className="hover:text-foreground hover:underline"
                    onClick={() => setFolderStack(folderStack.slice(0, i))}
                  >
                    {item.name}
                  </button>
                ) : (
                  <span className="text-foreground">{item.name}</span>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Cloud className="w-3 h-3" />
            Connected
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await apiRequest("POST", "/api/microsoft/disconnect");
              setDriveId(null);
              setFolderStack([]);
              queryClient.invalidateQueries({ queryKey: ["/api/microsoft/status"] });
            }}
            data-testid="button-disconnect-microsoft"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Reconnect
          </Button>
        </div>
      </div>

      {folderStack.length === 0 && (
        <TeamFoldersSection onOpenFolder={openTeamFolder} />
      )}

      {folderStack.length > 0 && (
        <Button variant="ghost" size="sm" onClick={goBack} data-testid="button-go-back">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-sm font-semibold">
            {folderStack.length > 0 ? folderStack[folderStack.length - 1].name : "All Files"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filesLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : !files || files.length === 0 ? (
            <div className="p-8 text-center">
              <CloudOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No files found in this folder</p>
            </div>
          ) : (
            <div className="divide-y">
              {files.map((item) => {
                const Icon = getFileIcon(item);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-accent/50 ${
                      item.folder ? "cursor-pointer" : ""
                    }`}
                    onClick={item.folder ? () => openFolder(item) : undefined}
                    data-testid={`file-item-${item.id}`}
                  >
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                      item.folder ? "bg-blue-500/10 text-blue-500" : "bg-muted text-muted-foreground"
                    }`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.folder
                          ? `${item.folder.childCount} items`
                          : formatSize(item.size)}
                        {item.lastModifiedDateTime && ` · ${formatDate(item.lastModifiedDateTime)}`}
                      </p>
                    </div>
                    {!item.folder && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <a
                          href={item["@microsoft.graph.downloadUrl"] || `/api/microsoft/files/content?driveId=${item.parentReference?.driveId || driveId || ""}&itemId=${item.id}&fileName=${encodeURIComponent(item.name)}`}
                          download={item.name}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Download" data-testid={`button-download-${item.id}`}>
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        </a>
                        {item.webUrl && (
                          <a
                            href={item.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Open in SharePoint" data-testid={`button-open-${item.id}`}>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
