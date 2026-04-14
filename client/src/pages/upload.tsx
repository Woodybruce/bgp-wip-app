import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Upload, File as FileIcon, Image, FileText, X, Check,
  FolderOpen, ChevronRight, ArrowLeft, Loader2,
  Camera, Share2, Cloud, CheckCircle2, AlertCircle,
} from "lucide-react";

type SharePointFolder = {
  id: string;
  name: string;
  webUrl: string;
  childCount: number;
};

type UploadFile = {
  file: File;
  id: string;
  status: "pending" | "uploading" | "done" | "error";
  result?: { name: string; webUrl: string };
  error?: string;
};

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"].includes(ext)) return Image;
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"].includes(ext)) return FileText;
  return FileIcon;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [destination, setDestination] = useState<"sharepoint" | "chat">("sharepoint");
  const [selectedFolder, setSelectedFolder] = useState<{ id: string; name: string; driveId: string; path: string[] } | null>(null);
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([]);
  const [currentDriveId, setCurrentDriveId] = useState<string>("");
  const [uploading, setUploading] = useState(false);

  const processShareData = useCallback((data: any) => {
    if (!data?.files?.length) return;
    const receivedFiles: File[] = data.files.map((f: any) => {
      const bytes = f.data ? new Uint8Array(f.data) : f.buffer;
      return new File([bytes], f.name, { type: f.type });
    });
    const uploadFiles: UploadFile[] = receivedFiles.map((f) => ({
      file: f,
      id: Math.random().toString(36).slice(2),
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...uploadFiles]);
    toast({ title: `${receivedFiles.length} file(s) shared`, description: "Choose a destination and upload" });
  }, [toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("share") === "pending") {
      window.history.replaceState({}, "", "/upload");
      navigator.serviceWorker?.controller?.postMessage("get-share-target");
    }

    const handleShareTarget = (event: MessageEvent) => {
      if (event.data?.type === "share-target") {
        processShareData(event.data);
      }
    };

    navigator.serviceWorker?.addEventListener("message", handleShareTarget);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", handleShareTarget);
    };
  }, [processShareData]);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  const { data: folderData, isLoading: foldersLoading } = useQuery({
    queryKey: ["/api/microsoft/files", currentFolderId, currentDriveId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (currentDriveId) params.set("driveId", currentDriveId);
      if (currentFolderId) params.set("folderId", currentFolderId);
      const res = await fetch(`/api/microsoft/files?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load folders");
      return res.json();
    },
    enabled: destination === "sharepoint",
  });

  const folders: SharePointFolder[] = (folderData?.items || []).filter((item: any) => item.folder);
  const driveId = currentDriveId || folderData?.driveId || "";

  useEffect(() => {
    if (folderData?.driveId && !currentDriveId) {
      setCurrentDriveId(folderData.driveId);
    }
  }, [folderData?.driveId, currentDriveId]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const uploadFiles: UploadFile[] = Array.from(newFiles).map((f) => ({
      file: f,
      id: Math.random().toString(36).slice(2),
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...uploadFiles]);
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const navigateToFolder = (folder: SharePointFolder) => {
    setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateBack = () => {
    setFolderStack((prev) => prev.slice(0, -1));
  };

  const handleUpload = async () => {
    const pendingFiles = files.filter((f) => f.status === "pending");
    if (pendingFiles.length === 0) return;
    setUploading(true);

    for (const uf of pendingFiles) {
      setFiles((prev) => prev.map((f) => f.id === uf.id ? { ...f, status: "uploading" } : f));

      try {
        if (destination === "sharepoint") {
          const formData = new FormData();
          formData.append("file", uf.file);
          if (driveId) formData.append("driveId", driveId);
          if (currentFolderId) formData.append("folderId", currentFolderId);

          const res = await fetch("/api/microsoft/files/upload", {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ message: "Upload failed" }));
            throw new Error(err.message);
          }

          const result = await res.json();
          setFiles((prev) => prev.map((f) => f.id === uf.id ? { ...f, status: "done", result } : f));
        } else {
          const formData = new FormData();
          formData.append("files", uf.file);

          const res = await fetch("/api/chat/upload", {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          if (!res.ok) {
            throw new Error("Upload failed");
          }

          const result = await res.json();
          setFiles((prev) => prev.map((f) => f.id === uf.id ? { ...f, status: "done", result: { name: uf.file.name, webUrl: result.files?.[0]?.url || "" } } : f));
        }
      } catch (err: any) {
        setFiles((prev) => prev.map((f) => f.id === uf.id ? { ...f, status: "error", error: err.message } : f));
      }
    }

    setUploading(false);
    setFiles((prev) => {
      const succeeded = prev.filter((f) => f.status === "done").length;
      const failed = prev.filter((f) => f.status === "error").length;
      if (failed > 0) {
        toast({ title: "Upload finished", description: `${succeeded} uploaded, ${failed} failed`, variant: "destructive" });
      } else {
        toast({ title: "Upload complete", description: `${succeeded} file(s) uploaded` });
      }
      return prev;
    });
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const currentPath = folderStack.map((f) => f.name).join(" / ") || "Root";

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-black text-white px-4 py-3 flex items-center gap-3 shrink-0 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button onClick={() => navigate("/")} className="p-1" data-testid="upload-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex-1">Upload Files</h1>
        <Share2 className="w-5 h-5 text-gray-400" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 bg-white rounded-xl border-2 border-dashed border-gray-300 p-6 flex flex-col items-center gap-2 active:bg-gray-50"
              data-testid="upload-pick-files"
            >
              <Upload className="w-8 h-8 text-gray-400" />
              <span className="text-sm font-medium text-gray-600">Choose Files</span>
            </button>
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="flex-1 bg-white rounded-xl border-2 border-dashed border-gray-300 p-6 flex flex-col items-center gap-2 active:bg-gray-50"
              data-testid="upload-camera"
            >
              <Camera className="w-8 h-8 text-gray-400" />
              <span className="text-sm font-medium text-gray-600">Take Photo</span>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />

          {files.length > 0 && (
            <div className="bg-white rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold">{files.length} file(s) selected</span>
                {doneCount > 0 && (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> {doneCount} uploaded
                  </span>
                )}
              </div>
              {files.map((uf) => {
                const Icon = getFileIcon(uf.file.name);
                return (
                  <div key={uf.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50" data-testid={`upload-file-${uf.id}`}>
                    <Icon className="w-5 h-5 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{uf.file.name}</div>
                      <div className="text-xs text-gray-400">{formatFileSize(uf.file.size)}</div>
                    </div>
                    {uf.status === "pending" && (
                      <button onClick={() => removeFile(uf.id)} className="p-1" data-testid={`upload-remove-${uf.id}`}>
                        <X className="w-4 h-4 text-gray-400" />
                      </button>
                    )}
                    {uf.status === "uploading" && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
                    {uf.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    {uf.status === "error" && (
                      <div className="flex items-center gap-1">
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="bg-white rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold">Upload to</span>
            </div>
            <div className="flex">
              <button
                onClick={() => setDestination("sharepoint")}
                className={`flex-1 flex flex-col items-center gap-2 py-4 ${destination === "sharepoint" ? "bg-black text-white" : "text-gray-500"}`}
                data-testid="upload-dest-sharepoint"
              >
                <Cloud className="w-5 h-5" />
                <span className="text-xs font-medium">SharePoint</span>
              </button>
              <button
                onClick={() => setDestination("chat")}
                className={`flex-1 flex flex-col items-center gap-2 py-4 ${destination === "chat" ? "bg-black text-white" : "text-gray-500"}`}
                data-testid="upload-dest-chat"
              >
                <FileIcon className="w-5 h-5" />
                <span className="text-xs font-medium">Chat Media</span>
              </button>
            </div>
          </div>

          {destination === "sharepoint" && (
            <div className="bg-white rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                {folderStack.length > 0 && (
                  <button onClick={navigateBack} className="p-1" data-testid="upload-folder-back">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <FolderOpen className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-600 truncate">{currentPath}</span>
              </div>
              {foldersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : folders.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400">
                  No subfolders — files will upload here
                </div>
              ) : (
                folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => navigateToFolder(folder)}
                    className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 w-full text-left active:bg-gray-50"
                    data-testid={`upload-folder-${folder.id}`}
                  >
                    <FolderOpen className="w-5 h-5 text-yellow-500 shrink-0" />
                    <span className="text-sm flex-1 truncate">{folder.name}</span>
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="p-4 bg-white border-t border-gray-200 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full bg-black text-white h-12 text-base font-semibold rounded-xl"
            data-testid="upload-submit"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Uploading...
              </>
            ) : (
              `Upload ${pendingCount} File${pendingCount > 1 ? "s" : ""}`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
