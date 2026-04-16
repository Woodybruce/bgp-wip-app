import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Send, Loader2, Copy, Check, Trash2,
  FileSpreadsheet, Building2, Users, BarChart3,
  Sparkles, ChevronDown, LogOut, FolderOpen, File as FileIcon,
  Folder, ArrowLeft, Download, Upload, ExternalLink,
  MessageSquare, RefreshCw, ChevronRight, Search,
  FileText, Image as ImageIcon, FileArchive,
  Hammer, Play, CheckCircle2, AlertCircle, Zap,
  Paperclip, X,
} from "lucide-react";
import bgpLogoBlack from "@assets/BGP_BlackHolder_1771853582461.png";
import { ChatBGPMarkdown } from "@/components/chatbgp-markdown";
import { AddinHeader } from "@/components/addin-header";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface SPItem {
  id: string;
  name: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  size?: number;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName: string } };
  parentReference?: { driveId?: string };
  webUrl?: string;
}

const TOKEN_KEY = "bgp_addin_token";
const USER_KEY = "bgp_addin_user";

const QUICK_ACTIONS = [
  { label: "Write a formula", prompt: "Help me write an Excel formula to ", icon: FileSpreadsheet, color: "text-emerald-500" },
  { label: "Property data", prompt: "Look up CRM data for property ", icon: Building2, color: "text-blue-500" },
  { label: "Financial model", prompt: "Help me build a financial model for ", icon: BarChart3, color: "text-amber-500" },
  { label: "Contact lookup", prompt: "Find contact details for ", icon: Users, color: "text-violet-500" },
];

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-2.5 rounded-xl border border-border/40 bg-zinc-950 dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wide">{language}</span>
        <button
          onClick={handleCopy}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
          data-testid="button-copy-code"
        >
          {copied ? <><Check className="w-3 h-3 text-emerald-400" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
        </button>
      </div>
      <pre className="p-3 text-[11px] font-mono text-zinc-200 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderContent(content: string) {
  const parts: JSX.Element[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      parts.push(<span key={`t-${lastIndex}`} className="whitespace-pre-wrap">{textBefore}</span>);
    }
    parts.push(
      <CodeBlock key={`c-${match.index}`} language={match[1] || "text"} code={match[2].trim()} />
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(<span key={`t-${lastIndex}`} className="whitespace-pre-wrap">{content.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(item: SPItem) {
  if (item.folder) return <Folder className="w-4 h-4 text-amber-500 shrink-0" />;
  const name = item.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) return <FileSpreadsheet className="w-4 h-4 text-green-600 shrink-0" />;
  if (name.endsWith(".docx") || name.endsWith(".doc") || name.endsWith(".pdf")) return <FileText className="w-4 h-4 text-blue-600 shrink-0" />;
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) return <ImageIcon className="w-4 h-4 text-purple-500 shrink-0" />;
  if (name.endsWith(".zip") || name.endsWith(".rar")) return <FileArchive className="w-4 h-4 text-orange-500 shrink-0" />;
  return <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function AddinLogin({ onLogin }: { onLogin: (token: string, name: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email.trim(), password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Login failed");
        setLoading(false);
        return;
      }

      const data = await res.json();
      if (data.token) {
        onLogin(data.token, data.name || data.username || email);
      } else {
        setError("Login succeeded but no token received");
      }
    } catch (err: any) {
      setError("Could not reach server. Please check your connection.");
    }
    setLoading(false);
  };

  // Inline styles on the outer wrapper so the login screen is visible even
  // if Tailwind CSS hasn't loaded (restricted Office task pane webviews can
  // fail to fetch the /assets/*.css bundle).
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        width: "100%",
        padding: "24px",
        boxSizing: "border-box",
        background: "#ffffff",
        color: "#111111",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 280 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <img src={bgpLogoBlack} alt="BGP" style={{ width: 144, height: "auto", marginBottom: 16, opacity: 0.9 }} />
          <h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>ChatBGP for Excel</h2>
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4, margin: 0 }}>Sign in to get started</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="text"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            data-testid="input-login-email"
            style={{
              fontSize: 13, height: 40, padding: "0 12px",
              borderRadius: 12, border: "1px solid rgba(0,0,0,0.15)",
              background: "rgba(0,0,0,0.03)", outline: "none",
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="input-login-password"
            style={{
              fontSize: 13, height: 40, padding: "0 12px",
              borderRadius: 12, border: "1px solid rgba(0,0,0,0.15)",
              background: "rgba(0,0,0,0.03)", outline: "none",
            }}
          />
          {error && (
            <p style={{ fontSize: 11, color: "#b91c1c", padding: "0 4px", margin: 0 }} data-testid="text-login-error">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            data-testid="button-login-submit"
            style={{
              width: "100%", height: 40, borderRadius: 12, fontSize: 13, fontWeight: 500,
              background: "#111", color: "#fff", border: "none", cursor: loading ? "wait" : "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

function SharePointBrowser({ getHeaders }: { getHeaders: () => Record<string, string> }) {
  const [items, setItems] = useState<SPItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [driveId, setDriveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : undefined;

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/microsoft/status", {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setConnected(data.connected);
        if (data.connected) loadFiles();
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    }
  }, []);

  const loadFiles = useCallback(async (folderId?: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (folderId) params.set("folderId", folderId);
      if (driveId) params.set("driveId", driveId);
      const url = params.toString() ? `/api/microsoft/files?${params}` : "/api/microsoft/files";
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to load files");
      }
      const data = await res.json();
      if (data.driveId) {
        setDriveId(data.driveId);
      }
      const fileList = data.items || data.value || [];
      setItems(Array.isArray(fileList) ? fileList : []);
    } catch (err: any) {
      setError(err.message);
      setItems([]);
    }
    setLoading(false);
  }, [getHeaders, driveId]);

  useEffect(() => {
    checkConnection();
  }, []);

  const openFolder = (item: SPItem) => {
    setFolderPath(prev => [...prev, { id: item.id, name: item.name }]);
    setSearchQuery("");
    loadFiles(item.id);
  };

  const goBack = () => {
    const newPath = [...folderPath];
    newPath.pop();
    setFolderPath(newPath);
    setSearchQuery("");
    const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : undefined;
    loadFiles(parentId);
  };

  const goToRoot = () => {
    setFolderPath([]);
    setSearchQuery("");
    loadFiles();
  };

  const downloadFile = async (item: SPItem) => {
    try {
      const itemDriveId = item.parentReference?.driveId || driveId;
      if (!itemDriveId) throw new Error("Drive not found — try refreshing");
      const params = new URLSearchParams({ driveId: itemDriveId, itemId: item.id, fileName: item.name });
      const res = await fetch(`/api/microsoft/files/content?${params}`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openInBrowser = (item: SPItem) => {
    if (item.webUrl) {
      window.open(item.webUrl, "_blank");
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (driveId) {
        formData.append("driveId", driveId);
      }
      if (currentFolderId) {
        formData.append("folderId", currentFolderId);
      }
      const headers: Record<string, string> = {};
      const authHeaders = getHeaders();
      if (authHeaders["Authorization"]) {
        headers["Authorization"] = authHeaders["Authorization"];
      }
      const res = await fetch("/api/microsoft/files/upload", {
        method: "POST",
        headers,
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Upload failed");
      }
      loadFiles(currentFolderId);
    } catch (err: any) {
      setError(err.message);
    }
    setUploading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items?.length) setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounterRef.current = 0;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    for (const file of files) {
      await uploadFile(file);
    }
  };

  const filteredItems = searchQuery
    ? items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : items;

  const folders = filteredItems.filter(i => i.folder).sort((a, b) => a.name.localeCompare(b.name));
  const files = filteredItems.filter(i => !i.folder).sort((a, b) => a.name.localeCompare(b.name));
  const sortedItems = [...folders, ...files];

  if (connected === null) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center px-6">
        <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
          <FolderOpen className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-[13px] font-medium mb-1">SharePoint not connected</p>
        <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
          Connect Microsoft 365 in the BGP Dashboard first.
        </p>
        <Button variant="outline" size="sm" className="text-xs rounded-xl h-8 px-4" onClick={checkConnection} data-testid="button-retry-connection">
          <RefreshCw className="w-3 h-3 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 shrink-0">
        {folderPath.length > 0 && (
          <button onClick={goBack} className="w-6 h-6 rounded-full hover:bg-muted/80 flex items-center justify-center transition-colors" data-testid="button-folder-back">
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto text-[11px]">
          <button onClick={goToRoot} className="text-primary hover:underline shrink-0 font-medium" data-testid="button-folder-root">
            SharePoint
          </button>
          {folderPath.map((f, i) => (
            <span key={f.id} className="flex items-center gap-0.5 shrink-0">
              <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
              <span className={i === folderPath.length - 1 ? "font-medium" : "text-muted-foreground"}>
                {f.name}
              </span>
            </span>
          ))}
        </div>
        <button
          onClick={() => loadFiles(currentFolderId)}
          className="w-6 h-6 rounded-full hover:bg-muted/80 flex items-center justify-center transition-colors"
          data-testid="button-refresh-files"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
          <Input
            placeholder="Filter files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 text-[11px] pl-7 rounded-lg border-border/50 bg-muted/30"
            data-testid="input-file-search"
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] px-3 rounded-lg border-border/50"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          data-testid="button-upload-file"
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
          Upload
        </Button>
      </div>

      {error && (
        <div className="px-3 py-2 bg-destructive/10 text-destructive text-[11px] border-b border-destructive/20">
          {error}
        </div>
      )}

      <div
        className={`flex-1 overflow-y-auto relative ${dragging ? "ring-2 ring-inset ring-primary bg-primary/5" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/90 backdrop-blur-sm border-2 border-dashed border-primary rounded-xl m-2">
            <div className="text-center">
              <Upload className="w-6 h-6 text-primary mx-auto mb-1.5" />
              <p className="text-[13px] font-medium text-primary">Drop files to upload</p>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 text-[11px] text-muted-foreground">
            {searchQuery ? "No matching files" : "Drop files here or click Upload"}
          </div>
        ) : (
          <div className="py-1">
            {sortedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2.5 px-3 py-2 mx-1 rounded-lg hover:bg-muted/50 cursor-pointer group transition-colors"
                onClick={() => item.folder ? openFolder(item) : openInBrowser(item)}
                data-testid={`file-item-${item.id}`}
              >
                {getFileIcon(item)}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {item.folder
                      ? `${item.folder.childCount} items`
                      : formatFileSize(item.size)}
                    {item.lastModifiedBy?.user?.displayName && (
                      <span> · {item.lastModifiedBy.user.displayName}</span>
                    )}
                  </p>
                </div>
                {!item.folder && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center"
                      onClick={(e) => { e.stopPropagation(); downloadFile(item); }}
                      title="Download"
                      data-testid={`button-download-${item.id}`}
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      className="w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center"
                      onClick={(e) => { e.stopPropagation(); openInBrowser(item); }}
                      title="Open in browser"
                      data-testid={`button-open-${item.id}`}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {item.folder && (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

declare global {
  interface Window {
    Office?: any;
    Excel?: any;
  }
}

// ─── Addin Model Definition (matches server response) ─────────────────────

interface AddinCellDef {
  cell: string;
  value?: string | number;
  formula?: string;
  numberFormat?: string;
  bold?: boolean;
  fontColor?: string;
  fillColor?: string;
  fontSize?: number;
  horizontalAlignment?: string;
  borders?: 'thin' | 'medium' | 'thick';
  merge?: string;
}

interface AddinSheetDef {
  name: string;
  columnWidths: Record<number, number>;
  freezeRow: number;
  freezeCol: number;
  cells: AddinCellDef[];
  namedRanges?: Array<{ name: string; range: string }>;
}

interface AddinModelDefinition {
  sheets: AddinSheetDef[];
}

// ─── Excel Write Engine — Office.js powered ───────────────────────────────

async function writeToCell(sheetName: string, cell: string, value: string | number, options?: {
  formula?: string;
  numberFormat?: string;
  bold?: boolean;
  fontColor?: string;
  fillColor?: string;
  fontSize?: number;
  horizontalAlignment?: string;
  borders?: boolean;
}): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      const range = sheet.getRange(cell);
      if (options?.formula) {
        range.formulas = [[options.formula.startsWith("=") ? options.formula : `=${options.formula}`]];
      } else {
        range.values = [[value]];
      }
      if (options?.numberFormat) range.numberFormat = [[options.numberFormat]];
      if (options?.bold) range.format.font.bold = true;
      if (options?.fontColor) range.format.font.color = options.fontColor;
      if (options?.fillColor) range.format.fill.color = options.fillColor;
      if (options?.fontSize) range.format.font.size = options.fontSize;
      if (options?.horizontalAlignment) range.format.horizontalAlignment = options.horizontalAlignment;
      if (options?.borders) {
        const border = range.format.borders;
        border.getItem("EdgeTop").style = "Thin";
        border.getItem("EdgeBottom").style = "Thin";
        border.getItem("EdgeLeft").style = "Thin";
        border.getItem("EdgeRight").style = "Thin";
      }
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[write-cell]", e?.message || e);
    return false;
  }
}

async function createSheet(name: string): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheets = context.workbook.worksheets;
      sheets.load("items/name");
      await context.sync();
      const existing = sheets.items.find((s: any) => s.name === name);
      if (existing) {
        existing.delete();
        await context.sync();
      }
      sheets.add(name);
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[create-sheet]", e?.message || e);
    return false;
  }
}

async function writeRange(sheetName: string, startCell: string, data: (string | number | null)[][]): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      const rows = data.length;
      const cols = data[0]?.length || 0;
      if (rows === 0 || cols === 0) return;
      const decoded = decodeCell(startCell);
      const endCell = encodeCell(decoded.row + rows - 1, decoded.col + cols - 1);
      const range = sheet.getRange(`${startCell}:${endCell}`);
      range.values = data;
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[write-range]", e?.message || e);
    return false;
  }
}

async function setFormulaInCell(sheetName: string, cell: string, formula: string, numberFormat?: string): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      const range = sheet.getRange(cell);
      range.formulas = [[formula.startsWith("=") ? formula : `=${formula}`]];
      if (numberFormat) range.numberFormat = [[numberFormat]];
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[set-formula]", e?.message || e);
    return false;
  }
}

async function formatRange(sheetName: string, rangeAddr: string, format: {
  bold?: boolean;
  fontColor?: string;
  fillColor?: string;
  fontSize?: number;
  numberFormat?: string;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  wrapText?: boolean;
  borders?: 'thin' | 'medium' | 'thick';
  borderColor?: string;
  merge?: boolean;
}): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      const range = sheet.getRange(rangeAddr);
      if (format.bold !== undefined) range.format.font.bold = format.bold;
      if (format.fontColor) range.format.font.color = format.fontColor;
      if (format.fillColor) range.format.fill.color = format.fillColor;
      if (format.fontSize) range.format.font.size = format.fontSize;
      if (format.numberFormat) range.numberFormat = [[format.numberFormat]];
      if (format.horizontalAlignment) range.format.horizontalAlignment = format.horizontalAlignment;
      if (format.verticalAlignment) range.format.verticalAlignment = format.verticalAlignment;
      if (format.wrapText !== undefined) range.format.wrapText = format.wrapText;
      if (format.borders) {
        const styleMap: Record<string, string> = { thin: "Thin", medium: "Medium", thick: "Thick" };
        const style = styleMap[format.borders] || "Thin";
        const color = format.borderColor || "#B0BEC5";
        const border = range.format.borders;
        for (const edge of ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight"]) {
          const b = border.getItem(edge);
          b.style = style;
          b.color = color;
        }
      }
      if (format.merge) range.merge();
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[format-range]", e?.message || e);
    return false;
  }
}

async function setNamedRange(name: string, sheetName: string, rangeAddr: string): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      const range = sheet.getRange(rangeAddr);
      // Remove existing named item if any
      try {
        const existing = context.workbook.names.getItemOrNullObject(name);
        await context.sync();
        if (!existing.isNullObject) {
          existing.delete();
          await context.sync();
        }
      } catch {}
      context.workbook.names.add(name, range);
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[named-range]", e?.message || e);
    return false;
  }
}

async function freezePanes(sheetName: string, row: number, col: number): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      sheet.freezePanes.unfreeze();
      await context.sync();
      if (row > 0 || col > 0) {
        const cellAddr = encodeCell(row, col);
        sheet.freezePanes.freezeAt(sheet.getRange(cellAddr));
      }
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[freeze-panes]", e?.message || e);
    return false;
  }
}

async function addDataValidation(sheetName: string, rangeAddr: string, values: string[]): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      const range = sheet.getRange(rangeAddr);
      range.dataValidation.rule = {
        list: { inCellDropDown: true, source: values.join(",") }
      };
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[data-validation]", e?.message || e);
    return false;
  }
}

async function setColumnWidth(sheetName: string, col: number, width: number): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      const colLetter = encodeCol(col);
      const range = sheet.getRange(`${colLetter}:${colLetter}`);
      range.format.columnWidth = width * 7; // Approximate: Excel width units -> pixels
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[col-width]", e?.message || e);
    return false;
  }
}

async function protectSheet(sheetName: string, _options?: { allowFormatCells?: boolean }): Promise<boolean> {
  try {
    if (!window.Excel) return false;
    await window.Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      sheet.protection.protect({
        allowFormatCells: _options?.allowFormatCells ?? true,
        selectionMode: "Normal",
      });
      await context.sync();
    });
    return true;
  } catch (e: any) {
    console.warn("[protect-sheet]", e?.message || e);
    return false;
  }
}

// Helper: decode cell address to row/col indices (0-based)
function decodeCell(cellAddr: string): { row: number; col: number } {
  const match = cellAddr.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return { row: 0, col: 0 };
  let col = 0;
  for (const ch of match[1].toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: parseInt(match[2], 10) - 1, col: col - 1 };
}

// Helper: encode row/col (0-based) to cell address
function encodeCell(row: number, col: number): string {
  return `${encodeCol(col + 1)}${row + 1}`;
}

function encodeCol(colNum: number): string {
  let result = "";
  let n = colNum;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

// Helper: convert ARGB hex (FF2E5E3F) to CSS hex (#2E5E3F)
function argbToHex(argb: string): string {
  if (!argb) return "";
  if (argb.startsWith("#")) return argb;
  // ARGB format: FFRRGGBB -> #RRGGBB
  if (argb.length === 8) return `#${argb.substring(2)}`;
  return `#${argb}`;
}

// ─── Build Model from AddinModelDefinition ────────────────────────────────

interface BuildProgress {
  phase: string;
  sheetName: string;
  sheetIndex: number;
  totalSheets: number;
  cellsWritten: number;
  totalCells: number;
  formulasWritten: number;
  namedRangesSet: number;
}

async function buildModelInWorkbook(
  model: AddinModelDefinition,
  onProgress: (p: BuildProgress) => void
): Promise<{ success: boolean; sheetsCreated: number; cellsWritten: number; formulasWritten: number; namedRangesSet: number }> {
  let totalCells = 0;
  let totalFormulas = 0;
  let totalNamedRanges = 0;
  for (const sheet of model.sheets) {
    totalCells += sheet.cells.length;
    totalFormulas += sheet.cells.filter(c => c.formula).length;
    totalNamedRanges += (sheet.namedRanges?.length || 0);
  }

  let cellsWritten = 0;
  let formulasWritten = 0;
  let namedRangesSet = 0;
  let sheetsCreated = 0;

  for (let si = 0; si < model.sheets.length; si++) {
    const sheetDef = model.sheets[si];

    onProgress({
      phase: "Creating sheet",
      sheetName: sheetDef.name,
      sheetIndex: si,
      totalSheets: model.sheets.length,
      cellsWritten, totalCells, formulasWritten, namedRangesSet,
    });

    // Create sheet
    const created = await createSheet(sheetDef.name);
    if (!created) continue;
    sheetsCreated++;

    // Set column widths
    for (const [colStr, width] of Object.entries(sheetDef.columnWidths)) {
      await setColumnWidth(sheetDef.name, parseInt(colStr, 10), width);
    }

    // Write cells in batches using Excel.run for performance
    onProgress({
      phase: "Writing cells",
      sheetName: sheetDef.name,
      sheetIndex: si,
      totalSheets: model.sheets.length,
      cellsWritten, totalCells, formulasWritten, namedRangesSet,
    });

    // Batch write: process cells in chunks via single Excel.run calls
    const BATCH_SIZE = 50;
    for (let batchStart = 0; batchStart < sheetDef.cells.length; batchStart += BATCH_SIZE) {
      const batch = sheetDef.cells.slice(batchStart, batchStart + BATCH_SIZE);
      try {
        await window.Excel.run(async (context: any) => {
          const sheet = context.workbook.worksheets.getItem(sheetDef.name);
          for (const cellDef of batch) {
            const range = sheet.getRange(cellDef.cell);

            // Set value or formula
            if (cellDef.formula) {
              const f = cellDef.formula.startsWith("=") ? cellDef.formula : `=${cellDef.formula}`;
              range.formulas = [[f]];
              formulasWritten++;
            } else if (cellDef.value !== undefined) {
              range.values = [[cellDef.value]];
            }

            // Apply number format
            if (cellDef.numberFormat) {
              range.numberFormat = [[cellDef.numberFormat]];
            }

            // Apply formatting
            if (cellDef.bold) range.format.font.bold = true;
            if (cellDef.fontColor) range.format.font.color = argbToHex(cellDef.fontColor);
            if (cellDef.fillColor) range.format.fill.color = argbToHex(cellDef.fillColor);
            if (cellDef.fontSize) range.format.font.size = cellDef.fontSize;
            if (cellDef.horizontalAlignment) range.format.horizontalAlignment = cellDef.horizontalAlignment;

            // Borders
            if (cellDef.borders) {
              const styleMap: Record<string, string> = { thin: "Thin", medium: "Medium", thick: "Thick" };
              const style = styleMap[cellDef.borders] || "Thin";
              const border = range.format.borders;
              for (const edge of ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight"]) {
                const b = border.getItem(edge);
                b.style = style;
                b.color = "#B0BEC5";
              }
            }

            // Merge
            if (cellDef.merge) {
              const mergeRange = sheet.getRange(cellDef.merge);
              mergeRange.merge();
            }

            cellsWritten++;
          }
          await context.sync();
        });
      } catch (e: any) {
        console.warn(`[build-model] Batch error on ${sheetDef.name}:`, e?.message);
      }

      // Progress update after each batch
      onProgress({
        phase: "Writing cells",
        sheetName: sheetDef.name,
        sheetIndex: si,
        totalSheets: model.sheets.length,
        cellsWritten, totalCells, formulasWritten, namedRangesSet,
      });
    }

    // Set named ranges
    if (sheetDef.namedRanges && sheetDef.namedRanges.length > 0) {
      onProgress({
        phase: "Setting named ranges",
        sheetName: sheetDef.name,
        sheetIndex: si,
        totalSheets: model.sheets.length,
        cellsWritten, totalCells, formulasWritten, namedRangesSet,
      });

      for (const nr of sheetDef.namedRanges) {
        const ok = await setNamedRange(nr.name, sheetDef.name, nr.range);
        if (ok) namedRangesSet++;
      }
    }

    // Freeze panes
    if (sheetDef.freezeRow > 0 || sheetDef.freezeCol > 0) {
      await freezePanes(sheetDef.name, sheetDef.freezeRow, sheetDef.freezeCol);
    }
  }

  return { success: true, sheetsCreated, cellsWritten, formulasWritten, namedRangesSet };
}

// ─── Excel Action Parsing (for enhanced chat) ─────────────────────────────

interface ExcelAction {
  action: string;
  sheet: string;
  cell: string;
  formula?: string;
  value?: string | number;
}

function parseExcelActions(content: string): ExcelAction[] {
  const actions: ExcelAction[] = [];
  // Parse JSON action blocks
  const jsonBlockRegex = /```json\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.action && parsed.sheet && parsed.cell) {
        actions.push(parsed);
      }
    } catch {}
  }
  // Parse excel code blocks for formulas
  const excelBlockRegex = /```excel\s*\n?([\s\S]*?)```/g;
  while ((match = excelBlockRegex.exec(content)) !== null) {
    const formula = match[1].trim();
    if (formula.startsWith("=")) {
      actions.push({ action: "writeFormula", sheet: "", cell: "", formula });
    }
  }
  return actions;
}

interface WorkbookInfo {
  fileName: string;
  activeSheetName: string;
  sheets: Array<{
    name: string;
    rows: number;
    cols: number;
    isActive: boolean;
    frozenRows: number;
    frozenCols: number;
    headers: string[];
  }>;
  activeSheetData: string;
}

function valuesToCsv(rows: any[][], maxRows: number, maxCols: number): string {
  let csv = "";
  const limit = Math.min(rows.length, maxRows);
  const colLimit = Math.min(rows[0]?.length || 0, maxCols);
  for (let r = 0; r < limit; r++) {
    const cells: string[] = [];
    for (let c = 0; c < colLimit; c++) {
      const val = rows[r]?.[c];
      const str = val === null || val === undefined || val === "" ? "" : String(val);
      cells.push(str.includes(",") || str.includes("\n") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str);
    }
    csv += cells.join(",") + "\n";
  }
  if (rows.length > maxRows) {
    csv += `... (${rows.length - maxRows} more rows truncated)\n`;
  }
  return csv;
}

async function readFullWorkbook(): Promise<WorkbookInfo | null> {
  try {
    if (!window.Excel) return null;
    return await window.Excel.run(async (context: any) => {
      const workbook = context.workbook;
      workbook.load("name");
      const sheets = workbook.worksheets;
      sheets.load("items/name");
      const activeSheet = sheets.getActiveWorksheet();
      activeSheet.load("name");
      await context.sync();

      const fileName = workbook.name || "Unknown";
      const activeSheetName = activeSheet.name;
      const sheetInfos: WorkbookInfo["sheets"] = [];

      const rangeInfos: Array<{sheet: any; usedRange: any; headerRange: any; frozenRange: any}> = [];
      for (const sheet of sheets.items) {
        const usedRange = sheet.getUsedRangeOrNullObject();
        usedRange.load(["rowCount", "columnCount"]);
        let frozenRange: any = null;
        try {
          frozenRange = sheet.freezePanes.getLocationOrNullObject();
          frozenRange.load(["rowIndex", "columnIndex", "rowCount", "columnCount"]);
        } catch {}
        rangeInfos.push({ sheet, usedRange, headerRange: null, frozenRange });
      }
      await context.sync();

      for (const info of rangeInfos) {
        if (!info.usedRange.isNullObject && info.usedRange.columnCount > 0) {
          const colCount = Math.min(info.usedRange.columnCount, 30);
          info.headerRange = info.sheet.getRangeByIndexes(0, 0, 1, colCount);
          info.headerRange.load("values");
        }
      }
      await context.sync();

      for (const info of rangeInfos) {
        const isActive = info.sheet.name === activeSheetName;
        let frozenRows = 0, frozenCols = 0;
        try {
          if (info.frozenRange && !info.frozenRange.isNullObject) {
            frozenRows = info.frozenRange.rowIndex + info.frozenRange.rowCount || 0;
            frozenCols = info.frozenRange.columnIndex + info.frozenRange.columnCount || 0;
          }
        } catch {}

        let headers: string[] = [];
        if (info.headerRange && info.headerRange.values && info.headerRange.values[0]) {
          headers = info.headerRange.values[0]
            .map((v: any) => (v === null || v === undefined || v === "") ? "" : String(v))
            .filter((s: string) => s.length > 0);
        }

        sheetInfos.push({
          name: info.sheet.name,
          rows: info.usedRange.isNullObject ? 0 : info.usedRange.rowCount,
          cols: info.usedRange.isNullObject ? 0 : info.usedRange.columnCount,
          isActive,
          frozenRows,
          frozenCols,
          headers,
        });
      }

      let activeSheetData = "";
      try {
        const activeUsedRange = activeSheet.getUsedRangeOrNullObject();
        activeUsedRange.load(["values", "rowCount", "columnCount", "address"]);
        await context.sync();
        if (!activeUsedRange.isNullObject && activeUsedRange.values) {
          activeSheetData = valuesToCsv(activeUsedRange.values, 200, 30);
        }
      } catch {}

      return {
        fileName,
        activeSheetName,
        sheets: sheetInfos,
        activeSheetData,
      };
    });
  } catch (e: any) {
    console.warn("[excel-read]", e?.message || e);
    return null;
  }
}

function formatWorkbookContext(info: WorkbookInfo): string {
  let ctx = `=== WORKBOOK: ${info.fileName} ===\n\n`;
  ctx += `Sheets (${info.sheets.length}):\n`;
  for (const sheet of info.sheets) {
    const active = sheet.isActive ? " (ACTIVE)" : "";
    const frozen = (sheet.frozenRows > 0 || sheet.frozenCols > 0)
      ? `, frozen: ${sheet.frozenRows} rows/${sheet.frozenCols} cols`
      : "";
    ctx += `  ${sheet.name}${active} — ${sheet.rows} rows x ${sheet.cols} columns${frozen}\n`;
    if (sheet.headers.length > 0) {
      ctx += `    Columns: ${sheet.headers.join(" | ")}\n`;
    }
  }
  ctx += `\n=== ACTIVE SHEET DATA: ${info.activeSheetName} ===\n`;
  ctx += info.activeSheetData;
  return ctx;
}

async function readExcelSelection(): Promise<string> {
  try {
    if (!window.Excel) return "";
    return await window.Excel.run(async (context: any) => {
      const range = context.workbook.getSelectedRange();
      range.load(["values", "address", "rowCount", "columnCount"]);
      await context.sync();

      const rows = range.values;
      if (!rows || rows.length === 0 || (rows.length === 1 && rows[0].length === 1 && !rows[0][0])) return "";

      let csv = `\n=== CURRENT SELECTION: ${range.address} (${range.rowCount} rows x ${range.columnCount} cols) ===\n`;
      csv += valuesToCsv(rows, 100, 30);
      return csv;
    });
  } catch (err) {
    console.error("[Excel] Failed to read selection:", err);
    return "";
  }
}

// ─── Model Builder Component ──────────────────────────────────────────────

function ModelBuilder({ getHeaders }: { getHeaders: () => Record<string, string> }) {
  const [modelType, setModelType] = useState("investment");
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [assumptions, setAssumptions] = useState({
    propertyName: "",
    purchasePrice: 10000000,
    totalAreaSqFt: 5000,
    ervPerSqFt: 120,
    currentRentPA: 500000,
    voidPeriodMonths: 3,
    ltv: 60,
    interestRate: 5.5,
    exitCapRate: 5.5,
    holdPeriodYears: 5,
    rentGrowthPA: 2.5,
    stampDutyRate: 5,
  });

  const updateField = (key: string, value: string) => {
    if (key === "propertyName") {
      setAssumptions(prev => ({ ...prev, [key]: value }));
    } else {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        setAssumptions(prev => ({ ...prev, [key]: num }));
      }
    }
  };

  const handleBuild = async () => {
    if (!window.Excel) {
      setResult({ success: false, message: "Excel not available. Open this add-in in Excel." });
      return;
    }

    setBuilding(true);
    setResult(null);
    setProgress({
      phase: "Requesting model...",
      sheetName: "",
      sheetIndex: 0,
      totalSheets: 6,
      cellsWritten: 0, totalCells: 0,
      formulasWritten: 0, namedRangesSet: 0,
    });

    try {
      // Call server to get model definition
      const res = await fetch("/api/models/build-for-addin", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          modelType,
          modelName: assumptions.propertyName || "Investment Appraisal",
          assumptions: {
            purchasePrice: assumptions.purchasePrice,
            totalAreaSqFt: assumptions.totalAreaSqFt,
            ervPerSqFt: assumptions.ervPerSqFt,
            currentRentPA: assumptions.currentRentPA,
            voidPeriodMonths: assumptions.voidPeriodMonths,
            ltv: assumptions.ltv / 100,
            interestRate: assumptions.interestRate / 100,
            exitCapRate: assumptions.exitCapRate / 100,
            holdPeriodYears: assumptions.holdPeriodYears,
            rentGrowthPA: assumptions.rentGrowthPA / 100,
            stampDutyRate: assumptions.stampDutyRate / 100,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Server error: ${res.status}`);
      }

      const modelDef: AddinModelDefinition = await res.json();

      // Build into workbook
      const buildResult = await buildModelInWorkbook(modelDef, (p) => setProgress(p));

      setResult({
        success: buildResult.success,
        message: `${buildResult.sheetsCreated} sheets, ${buildResult.cellsWritten} cells, ${buildResult.formulasWritten} formulas, ${buildResult.namedRangesSet} named ranges`,
      });
    } catch (err: any) {
      setResult({ success: false, message: err?.message || "Build failed" });
    }

    setBuilding(false);
    setProgress(null);
  };

  const handleSyncAssumptions = async () => {
    if (!window.Excel) return;
    try {
      await window.Excel.run(async (context: any) => {
        const sheet = context.workbook.worksheets.getItemOrNullObject("Assumptions");
        sheet.load("isNullObject");
        await context.sync();
        if (sheet.isNullObject) {
          setResult({ success: false, message: "No Assumptions sheet found. Build a model first." });
          return;
        }
        // Read the named ranges to sync back
        const names = context.workbook.names;
        names.load("items/name,items/value");
        await context.sync();

        const nameMap: Record<string, string> = {};
        for (const item of names.items) {
          nameMap[item.name] = item.value;
        }

        // Try to read values from common named ranges
        const readVal = async (rangeName: string): Promise<number | null> => {
          try {
            const namedItem = context.workbook.names.getItemOrNullObject(rangeName);
            await context.sync();
            if (namedItem.isNullObject) return null;
            const range = namedItem.getRange();
            range.load("values");
            await context.sync();
            const v = range.values?.[0]?.[0];
            return typeof v === "number" ? v : null;
          } catch { return null; }
        };

        const pp = await readVal("PurchasePrice");
        const area = await readVal("TotalAreaSqFt");
        const erv = await readVal("ERVPerSqFt");
        const rent = await readVal("CurrentRentPA");
        const voidM = await readVal("VoidPeriodMonths");
        const ltvV = await readVal("LTV");
        const intR = await readVal("InterestRate");
        const exitC = await readVal("ExitCapRate");
        const holdP = await readVal("HoldPeriodYears");
        const rentG = await readVal("RentGrowthPA");
        const sdlt = await readVal("StampDutyRate");

        setAssumptions(prev => ({
          ...prev,
          ...(pp !== null && { purchasePrice: pp }),
          ...(area !== null && { totalAreaSqFt: area }),
          ...(erv !== null && { ervPerSqFt: erv }),
          ...(rent !== null && { currentRentPA: rent }),
          ...(voidM !== null && { voidPeriodMonths: voidM }),
          ...(ltvV !== null && { ltv: ltvV * 100 }),
          ...(intR !== null && { interestRate: intR * 100 }),
          ...(exitC !== null && { exitCapRate: exitC * 100 }),
          ...(holdP !== null && { holdPeriodYears: holdP }),
          ...(rentG !== null && { rentGrowthPA: rentG * 100 }),
          ...(sdlt !== null && { stampDutyRate: sdlt * 100 }),
        }));
        setResult({ success: true, message: "Assumptions synced from workbook" });
      });
    } catch (err: any) {
      setResult({ success: false, message: err?.message || "Sync failed" });
    }
  };

  const fields: Array<{ key: string; label: string; prefix?: string; suffix?: string; step?: number }> = [
    { key: "propertyName", label: "Property Name" },
    { key: "purchasePrice", label: "Purchase Price", prefix: "\u00a3" },
    { key: "totalAreaSqFt", label: "Net Area", suffix: "sq ft" },
    { key: "ervPerSqFt", label: "Rent per sq ft", prefix: "\u00a3" },
    { key: "currentRentPA", label: "Current Rent p.a.", prefix: "\u00a3" },
    { key: "voidPeriodMonths", label: "Void Period", suffix: "months", step: 1 },
    { key: "ltv", label: "LTV", suffix: "%" },
    { key: "interestRate", label: "Interest Rate", suffix: "%" },
    { key: "exitCapRate", label: "Exit Cap Rate", suffix: "%" },
    { key: "holdPeriodYears", label: "Hold Period", suffix: "years", step: 1 },
    { key: "rentGrowthPA", label: "Rent Growth p.a.", suffix: "%" },
    { key: "stampDutyRate", label: "SDLT Rate", suffix: "%" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Hammer className="w-4 h-4 text-amber-500" />
          <span className="text-[12px] font-semibold">Model Builder</span>
        </div>
        <select
          value={modelType}
          onChange={(e) => setModelType(e.target.value)}
          className="w-full h-7 text-[11px] rounded-lg border border-border/50 bg-muted/30 px-2 focus:outline-none focus:ring-1 focus:ring-primary"
          data-testid="select-model-type"
        >
          <option value="investment">Investment Appraisal</option>
          <option value="dcf">DCF Valuation</option>
          <option value="rentroll">Rent Roll</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {fields.map((f) => (
          <div key={f.key} className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground w-[90px] shrink-0 text-right leading-tight">{f.label}</label>
            <div className="flex-1 relative">
              {f.prefix && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{f.prefix}</span>
              )}
              <Input
                type={f.key === "propertyName" ? "text" : "number"}
                value={(assumptions as any)[f.key]}
                onChange={(e) => updateField(f.key, e.target.value)}
                step={f.step || (f.suffix === "%" ? 0.1 : undefined)}
                className={`h-6 text-[11px] rounded-md border-border/50 bg-muted/30 ${f.prefix ? "pl-5" : "pl-2"} ${f.suffix ? "pr-10" : "pr-2"}`}
                data-testid={`input-model-${f.key}`}
              />
              {f.suffix && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{f.suffix}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {progress && (
        <div className="px-3 py-2 bg-muted/40 border-t border-border/40">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
            <span className="text-[10px] font-medium">{progress.phase}</span>
          </div>
          {progress.sheetName && (
            <span className="text-[10px] text-muted-foreground">{progress.sheetName} ({progress.sheetIndex + 1}/{progress.totalSheets})</span>
          )}
          {progress.totalCells > 0 && (
            <div className="mt-1">
              <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.round((progress.cellsWritten / progress.totalCells) * 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">{progress.cellsWritten}/{progress.totalCells} cells</span>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={`px-3 py-2 border-t ${result.success ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" : "bg-destructive/10 border-destructive/20"}`}>
          <div className="flex items-center gap-1.5">
            {result.success ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
            )}
            <span className={`text-[10px] ${result.success ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
              {result.message}
            </span>
          </div>
        </div>
      )}

      <div className="px-3 py-2.5 border-t border-border/40 shrink-0 space-y-1.5">
        <Button
          onClick={handleBuild}
          disabled={building}
          className="w-full text-[11px] h-8 rounded-xl font-medium"
          data-testid="button-build-model"
        >
          {building ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
          ) : (
            <Play className="w-3.5 h-3.5 mr-1.5" />
          )}
          Build Model in Excel
        </Button>
        <Button
          variant="outline"
          onClick={handleSyncAssumptions}
          disabled={building}
          className="w-full text-[10px] h-7 rounded-xl border-border/50"
          data-testid="button-sync-assumptions"
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />
          Sync Assumptions from Sheet
        </Button>
      </div>
    </div>
  );
}

// ─── Excel Action Button Component ────────────────────────────────────────

function ExcelActionButton({ action, onApply }: { action: ExcelAction; onApply: (a: ExcelAction) => void }) {
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    setApplying(true);
    onApply(action);
    setApplied(true);
    setApplying(false);
  };

  const label = action.formula
    ? `Apply formula to ${action.sheet ? `${action.sheet}!` : ""}${action.cell || "..."}`
    : `Write to ${action.sheet}!${action.cell}`;

  return (
    <button
      onClick={handleApply}
      disabled={applying || applied}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
        applied
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "bg-primary/10 text-primary hover:bg-primary/20"
      }`}
      data-testid="button-excel-action"
    >
      {applied ? (
        <Check className="w-3 h-3" />
      ) : applying ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Zap className="w-3 h-3" />
      )}
      {applied ? "Applied" : label}
    </button>
  );
}

function SharePointAttachPicker({
  getHeaders,
  onAttach,
  onClose,
}: {
  getHeaders: () => Record<string, string>;
  onAttach: (files: File[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<SPItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [driveId, setDriveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attaching, setAttaching] = useState(false);

  const loadFiles = useCallback(async (folderId?: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (folderId) params.set("folderId", folderId);
      if (driveId) params.set("driveId", driveId);
      const url = params.toString() ? `/api/microsoft/files?${params}` : "/api/microsoft/files";
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to load files");
      }
      const data = await res.json();
      if (data.driveId) setDriveId(data.driveId);
      const fileList = data.items || data.value || [];
      setItems(Array.isArray(fileList) ? fileList : []);
    } catch (err: any) {
      setError(err.message);
      setItems([]);
    }
    setLoading(false);
  }, [getHeaders, driveId]);

  useEffect(() => { loadFiles(); }, []);

  const openFolder = (item: SPItem) => {
    setFolderPath(prev => [...prev, { id: item.id, name: item.name }]);
    setQuery("");
    loadFiles(item.id);
  };
  const goBack = () => {
    const np = [...folderPath];
    np.pop();
    setFolderPath(np);
    setQuery("");
    loadFiles(np.length > 0 ? np[np.length - 1].id : undefined);
  };
  const toggleSelect = (item: SPItem) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const attachSelected = async () => {
    setAttaching(true);
    setError("");
    const selectedItems = items.filter(it => selected.has(it.id) && it.file);
    const files: File[] = [];
    try {
      for (const it of selectedItems) {
        const itemDriveId = it.parentReference?.driveId || driveId;
        if (!itemDriveId) continue;
        const params = new URLSearchParams({ driveId: itemDriveId, itemId: it.id, fileName: it.name });
        const res = await fetch(`/api/microsoft/files/content?${params}`, { headers: getHeaders() });
        if (!res.ok) throw new Error(`Failed to fetch ${it.name}`);
        const blob = await res.blob();
        const file = new (window as any).File([blob], it.name, { type: it.file?.mimeType || blob.type || "application/octet-stream" });
        files.push(file);
      }
      if (files.length > 0) onAttach(files);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to attach files");
    }
    setAttaching(false);
  };

  const filtered = query.trim()
    ? items.filter(it => it.name.toLowerCase().includes(query.toLowerCase()))
    : items;
  const folders = filtered.filter(it => it.folder);
  const files = filtered.filter(it => it.file);
  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-xl w-[90vw] max-w-[420px] h-[70vh] max-h-[600px] flex flex-col overflow-hidden shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold">
            <FolderOpen className="w-3.5 h-3.5 text-primary" />
            Attach from SharePoint
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-sp-picker-close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          {folderPath.length > 0 && (
            <button onClick={goBack} className="shrink-0 text-muted-foreground hover:text-foreground" data-testid="button-sp-picker-back">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={folderPath.length > 0 ? folderPath[folderPath.length - 1].name : "Search files..."}
            className="h-7 text-[12px] border-0 bg-transparent p-0 focus-visible:ring-0"
            data-testid="input-sp-picker-search"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-[12px] text-red-500">{error}</div>
          ) : (
            <div>
              {folders.map((it) => (
                <button
                  key={it.id}
                  onClick={() => openFolder(it)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 text-[13px]"
                  data-testid={`sp-picker-folder-${it.id}`}
                >
                  <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="truncate">{it.name}</span>
                </button>
              ))}
              {files.map((it) => (
                <label
                  key={it.id}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 text-[13px] cursor-pointer ${selected.has(it.id) ? "bg-primary/5" : ""}`}
                  data-testid={`sp-picker-file-${it.id}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggleSelect(it)}
                    className="shrink-0"
                  />
                  <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{it.name}</span>
                  {it.size !== undefined && (
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatFileSize(it.size)}</span>
                  )}
                </label>
              ))}
              {folders.length === 0 && files.length === 0 && (
                <div className="px-3 py-10 text-center text-[12px] text-muted-foreground">No items</div>
              )}
            </div>
          )}
        </div>
        <div className="px-3 py-2 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {selectedCount} selected
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={onClose} className="h-7 text-[12px]">Cancel</Button>
            <Button size="sm" onClick={attachSelected} disabled={selectedCount === 0 || attaching} className="h-7 text-[12px]" data-testid="button-sp-picker-attach">
              {attaching ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Attach {selectedCount > 0 ? `(${selectedCount})` : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddinExcel() {
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  });
  const [userName, setUserName] = useState<string>(() => {
    try { return localStorage.getItem(USER_KEY) || ""; } catch { return ""; }
  });
  const [activeTab, setActiveTab] = useState("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [excelContext, setExcelContext] = useState("");
  const [workbookInfo, setWorkbookInfo] = useState<WorkbookInfo | null>(null);
  const [readingSheet, setReadingSheet] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [showSpPicker, setShowSpPicker] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Office.js is injected from index.html when the path starts with /addin/.
    // Because it's loaded async (after React mounts), window.Office may not yet
    // exist when this effect runs. Poll briefly and then register onReady.
    let cancelled = false;

    const register = () => {
      if (cancelled || !window.Office) return false;
      window.Office.onReady((info: any) => {
        if (cancelled) return;
        if (info.host === "Excel") {
          readFullWorkbook().then(wb => {
            if (cancelled || !wb) return;
            setWorkbookInfo(wb);
            setExcelContext(formatWorkbookContext(wb));

            let welcomeContent = `I can see your Excel file! Here's what I'm looking at:\n\n`;
            welcomeContent += `**File:** ${wb.fileName}\n\n`;
            welcomeContent += `**Sheets:**\n`;
            for (const sheet of wb.sheets) {
              const active = sheet.isActive ? " (currently active" + (sheet.frozenRows > 0 || sheet.frozenCols > 0 ? `, with frozen ${sheet.frozenRows > 0 ? "rows" : ""}${sheet.frozenRows > 0 && sheet.frozenCols > 0 ? "/" : ""}${sheet.frozenCols > 0 ? "columns" : ""}` : "") + ")" : "";
              welcomeContent += `- **${sheet.name}**${active} — ${sheet.rows} rows x ${sheet.cols} columns\n`;
              if (sheet.headers.length > 0) {
                welcomeContent += `  Columns: ${sheet.headers.slice(0, 12).join(", ")}${sheet.headers.length > 12 ? ` (+${sheet.headers.length - 12} more)` : ""}\n`;
              }
            }
            welcomeContent += `\nI can also cross-reference this against **BGP's CRM** — properties, deals, contacts, and companies.\n\n`;
            welcomeContent += `How can I help you with this workbook?`;

            setMessages([{
              id: crypto.randomUUID(),
              role: "assistant",
              content: welcomeContent,
              timestamp: new Date(),
            }]);
          });
        }
      });
      return true;
    };

    if (!register()) {
      const interval = setInterval(() => {
        if (register()) clearInterval(interval);
      }, 150);
      // Give up after ~10s so we don't poll forever on non-Office hosts.
      setTimeout(() => clearInterval(interval), 10000);
      return () => { cancelled = true; clearInterval(interval); };
    }
    return () => { cancelled = true; };
  }, []);

  const handleReadSheet = async () => {
    setReadingSheet(true);
    try {
      const wb = await readFullWorkbook();
      if (wb) {
        setWorkbookInfo(wb);
        setExcelContext(formatWorkbookContext(wb));
      }
    } finally {
      setReadingSheet(false);
    }
  };

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleLogin = (newToken: string, name: string) => {
    setToken(newToken);
    setUserName(name);
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, name);
    } catch {}
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        });
      } catch (err) {
        console.error("[Excel] Logout request failed:", err);
      }
    }
    setToken(null);
    setUserName("");
    setMessages([]);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
  };

  useEffect(() => {
    if (!token) return;
    fetch("/api/auth/me", {
      headers: { "Authorization": `Bearer ${token}` },
    }).then(res => {
      if (res.status === 401) {
        setToken(null);
        setUserName("");
        try {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        } catch {}
      }
    }).catch(() => {});
  }, []);

  const getHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if ((!msg && attachedFiles.length === 0) || loading) return;
    if (!text) setInput("");
    const filesForThisSend = attachedFiles;
    setAttachedFiles([]);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: msg || (filesForThisSend.length > 0 ? `(Uploaded ${filesForThisSend.length} file${filesForThisSend.length === 1 ? "" : "s"})` : ""),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    let ctx = excelContext;
    try {
      const wb = await readFullWorkbook();
      if (wb) {
        ctx = formatWorkbookContext(wb);
        setWorkbookInfo(wb);
        setExcelContext(ctx);
      }
      const selection = await readExcelSelection();
      if (selection) {
        ctx = (ctx ? ctx + "\n\n--- CURRENT SELECTION ---\n" : "") + selection;
      }
    } catch {}

    try {
      const apiMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      let res: Response;
      if (filesForThisSend.length > 0) {
        const form = new FormData();
        form.append("messages", JSON.stringify(apiMessages));
        if (ctx) form.append("excelContext", ctx);
        for (const f of filesForThisSend) form.append("files", f);
        const authHeaders = getHeaders() as Record<string, string>;
        // Drop Content-Type so browser sets multipart boundary
        delete authHeaders["Content-Type"];
        res = await fetch("/api/chatbgp/excel-chat", {
          method: "POST",
          headers: authHeaders,
          body: form,
        });
      } else {
        res = await fetch("/api/chatbgp/excel-chat", {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            messages: apiMessages,
            excelContext: ctx || undefined,
          }),
        });
      }

      if (res.status === 401) {
        handleLogout();
        setLoading(false);
        return;
      }

      if (!res.ok) {
        let errMsg = `Server error: ${res.status}`;
        try {
          const errBody = await res.json();
          if (errBody?.message) errMsg = errBody.message;
        } catch {}
        if (res.status === 429 || res.status === 503) {
          errMsg = "The server is busy right now. Please wait a moment and try again.";
        }
        throw new Error(errMsg);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullReply = "";
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.reply) {
                  fullReply = data.reply;
                }
              } catch {}
            }
          }
        }
        if (buffer.startsWith("data: ")) {
          try {
            const data = JSON.parse(buffer.slice(6));
            if (data.reply) fullReply = data.reply;
          } catch {}
        }
      }

      if (fullReply) {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: fullReply,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    } catch (err: any) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Sorry, I couldn't process that request. ${err?.message || "Please try again."}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    }

    setLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setExcelContext("");
  };

  if (!token) {
    return <AddinLogin onLogin={handleLogin} />;
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground" style={{ maxWidth: 450 }}>
      <AddinHeader
        title="ChatBGP"
        subtitle="Opus 4.6 · Hardcore Builder"
        onNewChat={clearChat}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full hover:bg-muted/80"
          onClick={handleLogout}
          title={`Sign out (${userName})`}
          data-testid="button-logout"
        >
          <LogOut className="w-3.5 h-3.5" />
        </Button>
      </AddinHeader>

      <div className="flex items-center h-9 border-b border-border/40 shrink-0">
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex-1 flex items-center justify-center gap-1.5 h-full text-[11px] font-medium transition-all relative ${activeTab === "chat" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-chat"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
          {activeTab === "chat" && <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-primary rounded-full" />}
        </button>
        <button
          onClick={() => setActiveTab("models")}
          className={`flex-1 flex items-center justify-center gap-1.5 h-full text-[11px] font-medium transition-all relative ${activeTab === "models" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-models"
        >
          <Hammer className="w-3.5 h-3.5" />
          Models
          {activeTab === "models" && <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-primary rounded-full" />}
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className={`flex-1 flex items-center justify-center gap-1.5 h-full text-[11px] font-medium transition-all relative ${activeTab === "files" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-files"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          SharePoint
          {activeTab === "files" && <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-primary rounded-full" />}
        </button>
      </div>

      {activeTab === "chat" ? (
        <>
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto relative"
            onDragEnter={(e) => {
              if (Array.from(e.dataTransfer.types).includes("Files")) {
                dragCounter.current += 1;
                setIsDragging(true);
              }
            }}
            onDragLeave={() => {
              dragCounter.current -= 1;
              if (dragCounter.current <= 0) {
                dragCounter.current = 0;
                setIsDragging(false);
              }
            }}
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes("Files")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragCounter.current = 0;
              setIsDragging(false);
              const dropped = Array.from(e.dataTransfer.files || []);
              if (dropped.length > 0) setAttachedFiles(prev => [...prev, ...dropped].slice(0, 20));
            }}
          >
            {isDragging && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg m-2 pointer-events-none">
                <div className="flex flex-col items-center gap-2 text-primary">
                  <Upload className="w-8 h-8" />
                  <span className="text-[13px] font-semibold">Drop files to attach</span>
                </div>
              </div>
            )}
            {messages.length === 0 ? (
              <div className="flex flex-col items-center text-center px-5 pt-12 pb-6">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-[15px] font-semibold tracking-tight mb-1">ChatBGP for Excel</h3>
                <p className="text-[12px] text-muted-foreground mb-6 max-w-[220px] leading-relaxed">
                  Formulas, models, CRM lookups, and data analysis — powered by your spreadsheet.
                </p>
                <div className="grid grid-cols-2 gap-2 w-full">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => {
                        setInput(action.prompt);
                        inputRef.current?.focus();
                      }}
                      className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-border/50 text-left hover:bg-muted/50 hover:border-border transition-all group"
                      data-testid={`button-quick-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <action.icon className={`w-4 h-4 ${action.color} shrink-0 transition-transform group-hover:scale-110`} />
                      <span className="text-[11px] font-medium leading-tight">{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} data-testid={`message-${msg.role}-${msg.id}`}>
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] bg-primary text-primary-foreground leading-relaxed">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[13px] text-foreground leading-relaxed">
                        <ChatBGPMarkdown content={msg.content} />
                        {(() => {
                          const actions = parseExcelActions(msg.content);
                          if (actions.length === 0) return null;
                          const applyOne = async (a: ExcelAction) => {
                            let sheet = a.sheet;
                            let cell = a.cell;
                            if (!sheet || !cell) {
                              const cellRef = prompt("Enter cell reference (e.g. Sheet1!A1):");
                              if (!cellRef) return;
                              const parts = cellRef.split("!");
                              sheet = parts.length > 1 ? parts[0] : (workbookInfo?.activeSheetName || "Sheet1");
                              cell = parts.length > 1 ? parts[1] : parts[0];
                            }
                            if (a.formula) {
                              await setFormulaInCell(sheet, cell, a.formula);
                            } else if (a.value !== undefined) {
                              await writeToCell(sheet, cell, a.value);
                            }
                          };
                          return (
                            <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border/30">
                              {actions.length > 1 && (
                                <button
                                  onClick={async () => {
                                    let ok = 0, fail = 0;
                                    for (const a of actions) {
                                      try { await applyOne(a); ok++; } catch { fail++; }
                                    }
                                    console.log(`[excel-apply-all] applied=${ok} failed=${fail} total=${actions.length}`);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:opacity-90"
                                  data-testid="button-apply-all"
                                  title={`Apply all ${actions.length} changes to the workbook`}
                                >
                                  <Zap className="w-3 h-3" /> Apply all ({actions.length})
                                </button>
                              )}
                              {actions.map((act, idx) => (
                                <ExcelActionButton
                                  key={`${msg.id}-action-${idx}`}
                                  action={act}
                                  onApply={applyOne}
                                />
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-xs text-muted-foreground">Thinking...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 px-3 py-2.5 bg-background">
            {excelContext && (
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                <span className="text-[10px] text-muted-foreground truncate flex-1">
                  {workbookInfo ? `${workbookInfo.fileName} · ${workbookInfo.activeSheetName}` : "Sheet connected"}
                </span>
                <button
                  onClick={handleReadSheet}
                  disabled={readingSheet}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title="Refresh sheet data"
                  data-testid="button-refresh-sheet"
                >
                  <RefreshCw className={`w-3 h-3 ${readingSheet ? "animate-spin" : ""}`} />
                </button>
              </div>
            )}
            {!excelContext && (
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
                <span className="text-[10px] text-muted-foreground truncate flex-1">
                  No sheet data — paste or refresh
                </span>
                <button
                  onClick={handleReadSheet}
                  disabled={readingSheet}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title="Read sheet data"
                  data-testid="button-read-sheet"
                >
                  <RefreshCw className={`w-3 h-3 ${readingSheet ? "animate-spin" : ""}`} />
                </button>
              </div>
            )}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {attachedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-muted/60 border border-border/40 rounded-lg pl-2 pr-1 py-1 text-[11px] max-w-full">
                    <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="truncate max-w-[140px]" title={f.name}>{f.name}</span>
                    <button
                      onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      data-testid={`button-remove-file-${i}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end bg-muted/40 border border-border/50 rounded-2xl px-3 py-1.5 focus-within:border-border focus-within:bg-muted/60 transition-all">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) setAttachedFiles(prev => [...prev, ...files].slice(0, 20));
                  if (e.target) e.target.value = "";
                }}
                data-testid="input-attach-files"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all disabled:opacity-40"
                title="Attach files from this device"
                data-testid="button-attach-files"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowSpPicker(true)}
                disabled={loading}
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all disabled:opacity-40"
                title="Attach from SharePoint"
                data-testid="button-attach-sharepoint"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
              <Textarea
                ref={inputRef}
                className="flex-1 text-[13px] min-h-[24px] max-h-[80px] resize-none border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60"
                placeholder="Reply to ChatBGP..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                data-testid="input-chat-message"
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || (!input.trim() && attachedFiles.length === 0)}
                className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                  (input.trim() || attachedFiles.length > 0) && !loading
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-muted text-muted-foreground"
                }`}
                data-testid="button-send-message"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex items-center justify-center mt-1.5">
              <span className="text-[9px] text-muted-foreground/50">Opus 4.6 · Hardcore Builder · BGP CRM</span>
            </div>
          </div>
        </>
      ) : activeTab === "models" ? (
        <div className="flex-1 flex flex-col min-h-0">
          <ModelBuilder getHeaders={getHeaders} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <SharePointBrowser getHeaders={getHeaders} />
        </div>
      )}

      {showSpPicker && (
        <SharePointAttachPicker
          getHeaders={getHeaders}
          onClose={() => setShowSpPicker(false)}
          onAttach={(files) => setAttachedFiles(prev => [...prev, ...files].slice(0, 20))}
        />
      )}
    </div>
  );
}

export default AddinExcel;
