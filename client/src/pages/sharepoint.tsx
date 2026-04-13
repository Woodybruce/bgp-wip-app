import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
  X,
  Eye,
  FileVideo,
  FileArchive,
  Presentation,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  Search,
  LayoutGrid,
  List as ListIcon,
  Copy,
  Upload,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { User } from "@shared/schema";
import { useState, useEffect, useCallback } from "react";
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
  thumbnails?: Array<{
    large?: { url: string; width: number; height: number };
    medium?: { url: string; width: number; height: number };
    small?: { url: string; width: number; height: number };
  }>;
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
  if (name.endsWith(".xlsx") || name.endsWith(".csv") || name.endsWith(".xls")) return FileSpreadsheet;
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".gif") || name.endsWith(".webp") || name.endsWith(".svg")) return FileImage;
  if (name.endsWith(".doc") || name.endsWith(".docx") || name.endsWith(".pdf") || name.endsWith(".txt")) return FileText;
  if (name.endsWith(".pptx") || name.endsWith(".ppt")) return Presentation;
  if (name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".avi")) return FileVideo;
  if (name.endsWith(".zip") || name.endsWith(".rar") || name.endsWith(".7z")) return FileArchive;
  return File;
}

function isImageFile(item: DriveItem) {
  const name = item.name.toLowerCase();
  return name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".gif") || name.endsWith(".webp") || name.endsWith(".svg");
}

function isPreviewable(item: DriveItem) {
  const name = item.name.toLowerCase();
  return isImageFile(item) || name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx") || name.endsWith(".pptx") || name.endsWith(".ppt") || name.endsWith(".xlsx") || name.endsWith(".xls");
}

type FileCategory = "all" | "folders" | "docs" | "spreadsheets" | "presentations" | "pdfs" | "images" | "videos";

function getCategory(item: DriveItem): Exclude<FileCategory, "all"> | "other" {
  if (item.folder) return "folders";
  const n = item.name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdfs";
  if (n.endsWith(".doc") || n.endsWith(".docx") || n.endsWith(".txt") || n.endsWith(".rtf")) return "docs";
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv")) return "spreadsheets";
  if (n.endsWith(".ppt") || n.endsWith(".pptx")) return "presentations";
  if (isImageFile(item)) return "images";
  if (n.endsWith(".mp4") || n.endsWith(".mov") || n.endsWith(".avi") || n.endsWith(".mkv")) return "videos";
  return "other";
}

const FILTER_CHIPS: { key: FileCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "folders", label: "Folders" },
  { key: "docs", label: "Docs" },
  { key: "spreadsheets", label: "Sheets" },
  { key: "presentations", label: "Slides" },
  { key: "pdfs", label: "PDFs" },
  { key: "images", label: "Images" },
  { key: "videos", label: "Videos" },
];

function getThumbnailUrl(item: DriveItem, driveId: string | null, size: "small" | "medium" | "large" = "medium") {
  const itemDriveId = item.parentReference?.driveId || driveId;
  if (!itemDriveId) return null;
  return `/api/microsoft/files/thumbnail?driveId=${itemDriveId}&itemId=${item.id}&size=${size}`;
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

function FileThumbnail({ item, driveId, size = "small" }: { item: DriveItem; driveId: string | null; size?: "small" | "medium" | "large" }) {
  const [imgError, setImgError] = useState(false);
  const hasThumbnail = item.thumbnails && item.thumbnails.length > 0;
  const thumbUrl = getThumbnailUrl(item, driveId, size);

  if (!item.folder && (hasThumbnail || isImageFile(item)) && thumbUrl && !imgError) {
    return (
      <div className={`rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0 ${
        size === "small" ? "w-10 h-10" : size === "medium" ? "w-16 h-16" : "w-24 h-24"
      }`}>
        <img
          src={thumbUrl}
          alt={item.name}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  const Icon = getFileIcon(item);
  return (
    <div className={`rounded-md flex items-center justify-center shrink-0 ${
      size === "small" ? "w-10 h-10" : size === "medium" ? "w-16 h-16" : "w-24 h-24"
    } ${item.folder ? "bg-blue-500/10 text-blue-500" : "bg-muted text-muted-foreground"}`}>
      <Icon className={size === "small" ? "w-4 h-4" : size === "medium" ? "w-6 h-6" : "w-8 h-8"} />
    </div>
  );
}

function FilePreviewPanel({ item, driveId, onClose }: { item: DriveItem; driveId: string | null; onClose: () => void }) {
  const thumbUrl = getThumbnailUrl(item, driveId, "large");
  const isImage = isImageFile(item);
  const downloadUrl = item["@microsoft.graph.downloadUrl"] || `/api/microsoft/files/content?driveId=${item.parentReference?.driveId || driveId || ""}&itemId=${item.id}&fileName=${encodeURIComponent(item.name)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <FileThumbnail item={item} driveId={driveId} size="small" />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatSize(item.size)} {item.lastModifiedDateTime && `· ${formatDate(item.lastModifiedDateTime)}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <a href={downloadUrl} download={item.name}>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Download">
                <Download className="w-4 h-4" />
              </Button>
            </a>
            {item.webUrl && (
              <a href={item.webUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Open in SharePoint">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </a>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-muted/30 min-h-[300px]">
          {isImage && thumbUrl ? (
            <img
              src={thumbUrl}
              alt={item.name}
              className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-sm"
            />
          ) : item.webUrl ? (
            <div className="text-center space-y-4">
              <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mx-auto">
                {(() => { const Icon = getFileIcon(item); return <Icon className="w-10 h-10 text-muted-foreground" />; })()}
              </div>
              <div>
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatSize(item.size)}</p>
              </div>
              <a href={item.webUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="mt-2">
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Open in SharePoint
                </Button>
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Preview not available</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectPrompt() {
  const [connecting, setConnecting] = useState(false);
  const { toast } = useToast();

  const handleConnect = useCallback(async () => {
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
  }, []);

  // Listen for OAuth completion from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "microsoft_connected") {
        setConnecting(false);
        queryClient.invalidateQueries({ queryKey: ["/api/microsoft/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/microsoft/files"] });
        queryClient.invalidateQueries({ queryKey: ["/api/microsoft/team-folders"] });
        toast({ title: "Connected to Microsoft 365", description: "Your SharePoint files are now available." });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [toast]);

  // Also poll status while connecting, in case postMessage doesn't work
  useEffect(() => {
    if (!connecting) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/microsoft/status", { credentials: "include", headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (data.connected) {
            setConnecting(false);
            queryClient.invalidateQueries({ queryKey: ["/api/microsoft/status"] });
            queryClient.invalidateQueries({ queryKey: ["/api/microsoft/files"] });
            queryClient.invalidateQueries({ queryKey: ["/api/microsoft/team-folders"] });
            toast({ title: "Connected to Microsoft 365", description: "Your SharePoint files are now available." });
          }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [connecting, toast]);

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
            {connecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Waiting for sign-in...
              </>
            ) : (
              "Connect Microsoft 365"
            )}
          </Button>
          {connecting && (
            <p className="text-xs text-muted-foreground mt-2">
              Complete sign-in in the new tab — this page will update automatically.
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

type SortKey = "name" | "modified" | "size";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  modified: "Modified",
  size: "Size",
};

export default function SharePoint() {
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [driveId, setDriveId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileCategory>("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/microsoft/status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 30000,
  });

  const { data: filesData, isLoading: filesLoading, error: filesError } = useQuery<{ items: DriveItem[]; driveId: string | null }>({
    queryKey: ["/api/microsoft/files", currentFolderId || "root", driveId || ""],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (currentFolderId) params.set("folderId", currentFolderId);
      if (driveId) params.set("driveId", driveId);
      const qs = params.toString();
      const url = `/api/microsoft/files${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (res.status === 401) {
        queryClient.invalidateQueries({ queryKey: ["/api/microsoft/status"] });
        throw new Error("Session expired — reconnecting...");
      }
      if (!res.ok) throw new Error("Failed to fetch files");
      const data = await res.json();
      if (data.driveId && !driveId) {
        setDriveId(data.driveId);
      }
      return data;
    },
    enabled: status?.connected === true,
    retry: 1,
  });

  const files = filesData?.items;

  // Filter by search query + type, then sort (folders always grouped first).
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredFiles = files ? files.filter(item => {
    if (trimmedQuery && !item.name.toLowerCase().includes(trimmedQuery)) return false;
    if (typeFilter !== "all" && getCategory(item) !== typeFilter) return false;
    return true;
  }) : [];

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (a.folder && !b.folder) return -1;
    if (!a.folder && b.folder) return 1;
    const dirMul = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") {
      return a.name.localeCompare(b.name) * dirMul;
    }
    if (sortKey === "size") {
      // Folders don't have a size, fall back to name.
      if (a.folder && b.folder) return a.name.localeCompare(b.name);
      return ((a.size ?? 0) - (b.size ?? 0)) * dirMul;
    }
    // modified
    const dateA = a.lastModifiedDateTime ? new Date(a.lastModifiedDateTime).getTime() : 0;
    const dateB = b.lastModifiedDateTime ? new Date(b.lastModifiedDateTime).getTime() : 0;
    return (dateA - dateB) * dirMul;
  });

  const uploadFiles = useCallback(async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setUploadProgress({ current: 0, total: fileList.length });
    let uploaded = 0;
    let failed = 0;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setUploadProgress({ current: i + 1, total: fileList.length });
      const fd = new FormData();
      fd.append("file", file);
      if (driveId) fd.append("driveId", driveId);
      if (currentFolderId) fd.append("folderId", currentFolderId);
      try {
        const res = await fetch("/api/microsoft/files/upload", {
          method: "POST",
          credentials: "include",
          headers: getAuthHeaders(),
          body: fd,
        });
        if (res.ok) uploaded++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setUploadProgress(null);
    queryClient.invalidateQueries({ queryKey: ["/api/microsoft/files"] });
    if (failed === 0) {
      toast({ title: "Uploaded", description: `${uploaded} file${uploaded === 1 ? "" : "s"} uploaded.` });
    } else if (uploaded === 0) {
      toast({ title: "Upload failed", description: `All ${failed} file(s) failed to upload.`, variant: "destructive" });
    } else {
      toast({ title: "Partial upload", description: `${uploaded} succeeded, ${failed} failed.`, variant: "destructive" });
    }
  }, [driveId, currentFolderId, toast]);

  const copyLink = useCallback(async (item: DriveItem) => {
    if (!item.webUrl) {
      toast({ title: "No link available", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(item.webUrl);
      toast({ title: "Link copied", description: item.name });
    } catch {
      toast({ title: "Could not copy link", variant: "destructive" });
    }
  }, [toast]);

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

  const handleReconnect = async () => {
    // First try: just refresh the status/token silently
    queryClient.invalidateQueries({ queryKey: ["/api/microsoft/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/microsoft/files"] });
    queryClient.invalidateQueries({ queryKey: ["/api/microsoft/team-folders"] });

    // Check if that worked
    try {
      const res = await fetch("/api/microsoft/status", { credentials: "include", headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          toast({ title: "Reconnected", description: "Microsoft 365 connection refreshed." });
          return;
        }
      }
    } catch {}

    // If silent refresh didn't work, open a new auth popup
    const authWindow = window.open("about:blank", "_blank");
    try {
      const res = await apiRequest("GET", "/api/microsoft/auth");
      const data = await res.json();
      if (authWindow) {
        authWindow.location.href = data.authUrl;
      }
    } catch {
      if (authWindow) authWindow.close();
      toast({ title: "Reconnect failed", description: "Could not start Microsoft sign-in.", variant: "destructive" });
    }
  };

  // Listen for OAuth completion from popup (for reconnect flow)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "microsoft_connected") {
        queryClient.invalidateQueries({ queryKey: ["/api/microsoft/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/microsoft/files"] });
        queryClient.invalidateQueries({ queryKey: ["/api/microsoft/team-folders"] });
        toast({ title: "Reconnected to Microsoft 365" });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [toast]);

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
            onClick={handleReconnect}
            data-testid="button-reconnect-microsoft"
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

      <Card
        className={isDragging ? "ring-2 ring-primary/60 border-primary/60" : ""}
        onDragEnter={(e) => { e.preventDefault(); if (e.dataTransfer?.types?.includes("Files")) setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const dropped = Array.from(e.dataTransfer?.files || []);
          if (dropped.length > 0) uploadFiles(dropped);
        }}
      >
        <CardHeader className="flex flex-col gap-3 pb-3">
          <div className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">
              {folderStack.length > 0 ? folderStack[folderStack.length - 1].name : "All Files"}
            </CardTitle>
            <div className="flex items-center gap-3">
              {sortedFiles.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {sortedFiles.length}{files && sortedFiles.length !== files.length ? ` of ${files.length}` : ""} items
                </span>
              )}
              <div className="flex items-center border rounded-md overflow-hidden">
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 rounded-none"
                  onClick={() => setViewMode("list")}
                  title="List view"
                  data-testid="view-list"
                >
                  <ListIcon className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 rounded-none"
                  onClick={() => setViewMode("grid")}
                  title="Grid view"
                  data-testid="view-grid"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </Button>
              </div>
              <label className="cursor-pointer">
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files || []);
                    if (picked.length > 0) uploadFiles(picked);
                    e.target.value = "";
                  }}
                  data-testid="input-upload-file"
                />
                <span className="inline-flex items-center gap-1.5 h-7 px-2 text-xs rounded-md border hover:bg-accent">
                  <Upload className="w-3.5 h-3.5" />
                  Upload
                </span>
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1.5"
                    data-testid="button-sort"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    Sort: {SORT_LABELS[sortKey]}
                    {sortDir === "asc" ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : (
                      <ArrowDown className="w-3 h-3" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="text-xs">Sort by</DropdownMenuLabel>
                  {(["name", "modified", "size"] as SortKey[]).map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onClick={() => setSortKey(key)}
                      data-testid={`sort-by-${key}`}
                    >
                      <Check
                        className={`w-3.5 h-3.5 mr-2 ${
                          sortKey === key ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {SORT_LABELS[key]}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Direction</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => setSortDir("asc")}
                    data-testid="sort-dir-asc"
                  >
                    <Check
                      className={`w-3.5 h-3.5 mr-2 ${
                        sortDir === "asc" ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <ArrowUp className="w-3.5 h-3.5 mr-1.5" />
                    Ascending
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSortDir("desc")}
                    data-testid="sort-dir-desc"
                  >
                    <Check
                      className={`w-3.5 h-3.5 mr-2 ${
                        sortDir === "desc" ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <ArrowDown className="w-3.5 h-3.5 mr-1.5" />
                    Descending
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search this folder…"
                className="h-8 pl-8 pr-8 text-sm"
                data-testid="input-file-search"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
              {FILTER_CHIPS.map(chip => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setTypeFilter(chip.key)}
                  className={`shrink-0 text-xs px-2.5 h-7 rounded-full border transition-colors ${
                    typeFilter === chip.key
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`filter-${chip.key}`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        {uploadProgress && (
          <div className="px-4 pb-2 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Uploading {uploadProgress.current} of {uploadProgress.total}…
          </div>
        )}
        <CardContent className="p-0 relative">
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary/40 rounded-b-lg pointer-events-none">
              <div className="text-center">
                <Upload className="w-8 h-8 mx-auto mb-2 text-primary" />
                <p className="text-sm font-medium text-primary">Drop to upload</p>
              </div>
            </div>
          )}
          {filesLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="w-10 h-10 rounded-md shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : filesError ? (
            <div className="p-8 text-center">
              <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Couldn't load files — try reconnecting</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleReconnect}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Reconnect
              </Button>
            </div>
          ) : sortedFiles.length === 0 ? (
            <div className="p-8 text-center">
              <CloudOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {trimmedQuery || typeFilter !== "all"
                  ? "No files match your filters"
                  : "No files found in this folder"}
              </p>
              {(trimmedQuery || typeFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  onClick={() => { setSearchQuery(""); setTypeFilter("all"); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
              {sortedFiles.map((item) => (
                <div
                  key={item.id}
                  className={`group relative rounded-lg border bg-card hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer overflow-hidden ${
                    item.folder ? "" : isPreviewable(item) ? "" : "cursor-default"
                  }`}
                  onClick={item.folder ? () => openFolder(item) : isPreviewable(item) ? () => setPreviewItem(item) : undefined}
                  data-testid={`file-grid-${item.id}`}
                >
                  <div className="aspect-square bg-muted/40 flex items-center justify-center">
                    <FileThumbnail item={item} driveId={driveId} size="large" />
                  </div>
                  <div className="p-2.5 border-t">
                    <p className="text-xs font-medium truncate" title={item.name}>{item.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {item.folder
                        ? `${item.folder.childCount} items`
                        : formatSize(item.size) || "—"}
                    </p>
                  </div>
                  {!item.folder && (
                    <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 bg-background/90 backdrop-blur-sm rounded-md border p-0.5">
                      {item.webUrl && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Copy link"
                          onClick={(e) => { e.stopPropagation(); copyLink(item); }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      )}
                      <a
                        href={item["@microsoft.graph.downloadUrl"] || `/api/microsoft/files/content?driveId=${item.parentReference?.driveId || driveId || ""}&itemId=${item.id}&fileName=${encodeURIComponent(item.name)}`}
                        download={item.name}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Download">
                          <Download className="w-3 h-3" />
                        </Button>
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y">
              {sortedFiles.map((item) => {
                const downloadUrl = item["@microsoft.graph.downloadUrl"] || `/api/microsoft/files/content?driveId=${item.parentReference?.driveId || driveId || ""}&itemId=${item.id}&fileName=${encodeURIComponent(item.name)}`;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors ${
                      item.folder || isPreviewable(item) ? "cursor-pointer" : ""
                    }`}
                    onClick={item.folder ? () => openFolder(item) : isPreviewable(item) ? () => setPreviewItem(item) : undefined}
                    data-testid={`file-item-${item.id}`}
                  >
                    <FileThumbnail item={item} driveId={driveId} size="small" />
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
                        {isPreviewable(item) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Preview"
                            onClick={(e) => { e.stopPropagation(); setPreviewItem(item); }}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {item.webUrl && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Copy link"
                            onClick={(e) => { e.stopPropagation(); copyLink(item); }}
                            data-testid={`button-copy-link-${item.id}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <a
                          href={downloadUrl}
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

      {previewItem && (
        <FilePreviewPanel item={previewItem} driveId={driveId} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  );
}
