import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sparkles, Send, AlertCircle, Trash2, Bot, User, Loader2,
  Plus, MessageSquare, MoreHorizontal, Pencil, Link2, Building2,
  Briefcase, ClipboardList, Users, FileText, Search, X,
  Menu, Home, UserPlus, Download, File, ChevronRight,
  ArrowLeft, Paperclip, FolderOpen, ChevronDown,
  Eye, Share2, Image, FileSpreadsheet, ExternalLink, Copy, Check,
  Mic, Square, MapPin, Folder, Globe, Hash, Tag,
  Star, Archive, BookOpen, Brain, FileUp, MoreVertical,
} from "lucide-react";
import { useLocation } from "wouter";
import type { UnitMarketingFile } from "@shared/schema";
import { ChatBGPMarkdown } from "@/components/chatbgp-markdown";

type LocalMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  userId?: string | null;
};

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface ThreadData {
  id: string;
  title: string | null;
  createdBy: string;
  propertyId?: string | null;
  propertyName?: string | null;
  linkedType: string | null;
  linkedId: string | null;
  linkedName: string | null;
  isAiChat: boolean | null;
  createdAt: string;
  updatedAt: string;
  messages?: any[];
  members?: any[];
}

const LINKED_TYPES = [
  { value: "instruction", label: "Instruction", icon: FileText },
  { value: "property", label: "Property", icon: Building2 },
  { value: "deal", label: "Deal", icon: Briefcase },
  { value: "requirement", label: "Requirement", icon: ClipboardList },
  { value: "company", label: "Company", icon: Users },
];

function getLinkedIcon(type: string | null) {
  const found = LINKED_TYPES.find((t) => t.value === type);
  return found?.icon || Link2;
}

function getLinkedLabel(type: string | null) {
  const found = LINKED_TYPES.find((t) => t.value === type);
  return found?.label || type || "";
}

const SUGGESTIONS = [
  { title: "Show me live deals" },
  { title: "What's in my calendar today?" },
  { title: "Draft HOTs for a property" },
  { title: "Search CRM contacts" },
];

function formatThreadDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 days";
  if (diffDays < 30) return "Previous 30 days";
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function groupThreadsByDate(threads: ThreadData[]) {
  const groups: { label: string; threads: ThreadData[] }[] = [];
  const seen = new Set<string>();
  for (const thread of threads) {
    const label = formatThreadDate(thread.updatedAt || thread.createdAt);
    if (!seen.has(label)) {
      seen.add(label);
      groups.push({ label, threads: [] });
    }
    groups.find((g) => g.label === label)?.threads.push(thread);
  }
  return groups;
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-border bg-muted/50" data-testid="code-block">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/80 border-b border-border">
        <span className="text-xs text-muted-foreground font-mono">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-background/50"
          style={{ touchAction: "manipulation" }}
          data-testid="button-copy-code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-500" />
              <span className="text-green-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed font-mono whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function isSafeUrl(url: string) {
  return url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://");
}

function renderTextWithImages(text: string, keyPrefix: string) {
  const tokenRegex = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\*\*(.+?)\*\*|(https?:\/\/[^\s<>)\]]+)/g;
  const parts: JSX.Element[] = [];
  let lastIdx = 0;
  let m;
  while ((m = tokenRegex.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(<span key={`${keyPrefix}-t-${lastIdx}`}>{text.slice(lastIdx, m.index)}</span>);
    if (m[1] !== undefined && m[2]) {
      if (isSafeUrl(m[2])) {
        parts.push(
          <a key={`${keyPrefix}-img-${m.index}`} href={m[2]} target="_blank" rel="noopener noreferrer" className="block my-1">
            <img src={m[2]} alt={m[1]} className="rounded-xl max-w-[260px] max-h-[300px] object-cover" />
          </a>
        );
      } else {
        parts.push(<span key={`${keyPrefix}-t-${m.index}`}>{m[0]}</span>);
      }
    } else if (m[3] && m[4]) {
      parts.push(<a key={`${keyPrefix}-link-${m.index}`} href={m[4]} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{m[3]}</a>);
    } else if (m[5]) {
      parts.push(<strong key={`${keyPrefix}-b-${m.index}`}>{m[5]}</strong>);
    } else if (m[6]) {
      const url = m[6].replace(/[.,;:!?]+$/, "");
      const trailing = m[6].slice(url.length);
      parts.push(<a key={`${keyPrefix}-url-${m.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">{url}</a>);
      if (trailing) parts.push(<span key={`${keyPrefix}-tr-${m.index}`}>{trailing}</span>);
    }
    lastIdx = m.index + m[0].length;
  }
  if (parts.length === 0) return null;
  if (lastIdx < text.length) parts.push(<span key={`${keyPrefix}-t-${lastIdx}`}>{text.slice(lastIdx)}</span>);
  return parts;
}

function FormattedText({ text }: { text: string }) {
  const parts: JSX.Element[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      const imgParts = renderTextWithImages(segment, `pre-${lastIndex}`);
      if (imgParts) parts.push(<span key={`text-${lastIndex}`}>{imgParts}</span>);
      else parts.push(<span key={`text-${lastIndex}`}>{segment}</span>);
    }
    parts.push(
      <CodeBlock key={`code-${match.index}`} language={match[1] || undefined} code={match[2].replace(/\n$/, "")} />
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex);
    const imgParts = renderTextWithImages(segment, `post-${lastIndex}`);
    if (imgParts) parts.push(<span key={`text-${lastIndex}`}>{imgParts}</span>);
    else parts.push(<span key={`text-${lastIndex}`}>{segment}</span>);
  }

  return <>{parts}</>;
}

function splitContentParts(content: string): { textParts: string[]; actionParts: string[] } {
  const checkboxPattern = /^[-–•]*\s*[□☐✅✓☑]\s+(.+)$/;
  const lines = content.split("\n");
  const textParts: string[] = [];
  const actionParts: string[] = [];

  for (const line of lines) {
    const match = line.match(checkboxPattern);
    if (match) {
      actionParts.push(match[1].replace(/\*+/g, "").trim());
    } else {
      textParts.push(line);
    }
  }

  while (textParts.length > 0 && textParts[textParts.length - 1].trim() === "") {
    textParts.pop();
  }

  return { textParts, actionParts };
}

function ActionCheckboxGroup({ actions, completedActions, onSubmit }: {
  actions: string[];
  completedActions?: Set<string>;
  onSubmit?: (text: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addText, setAddText] = useState(false);
  const [extraText, setExtraText] = useState("");
  const [sending, setSending] = useState(false);
  const allCompleted = actions.every(a => completedActions?.has(a));

  const toggleOption = (actionText: string) => {
    if (completedActions?.has(actionText) || sending) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(actionText)) next.delete(actionText);
      else next.add(actionText);
      return next;
    });
  };

  const handleSend = () => {
    if (selected.size === 0 || sending) return;
    setSending(true);
    const parts = Array.from(selected);
    if (addText && extraText.trim()) {
      parts.push(extraText.trim());
    }
    onSubmit?.(parts.join("\n\n"));
  };

  return (
    <div className="flex flex-col gap-1.5">
      {actions.map((actionText, i) => {
        const isCompleted = completedActions?.has(actionText) || false;
        const isSelected = selected.has(actionText);
        return (
          <button
            key={`action-${i}`}
            type="button"
            onClick={() => toggleOption(actionText)}
            disabled={isCompleted || sending}
            className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all border ${
              isCompleted
                ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 cursor-default"
                : isSelected
                  ? "bg-primary/5 dark:bg-primary/10 border-primary/40 cursor-pointer active:scale-[0.98] shadow-sm"
                  : "bg-white dark:bg-gray-900 border-border hover:border-primary/40 hover:bg-primary/5 cursor-pointer active:scale-[0.98] shadow-sm"
            }`}
            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            data-testid={`button-action-${i}`}
          >
            <span className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
              isCompleted
                ? "bg-green-500 border-green-500"
                : isSelected
                  ? "bg-primary border-primary"
                  : "border-gray-400 hover:border-primary bg-white dark:bg-gray-900"
            }`}>
              {(isCompleted || isSelected) && (
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <span className={`whitespace-normal leading-snug ${isCompleted ? "line-through opacity-70" : ""}`}>
              {actionText}
            </span>
          </button>
        );
      })}
      {!allCompleted && !sending && (
        <div className="flex flex-col gap-2 mt-2">
          {addText && (
            <textarea
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              placeholder="Add a note..."
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none bg-white dark:bg-gray-900 border-border focus:border-primary/40 focus:outline-none"
              rows={2}
              data-testid="input-action-extra-text"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddText(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                addText
                  ? "bg-primary/5 border-primary/30 text-primary"
                  : "bg-white dark:bg-gray-900 border-border text-muted-foreground hover:border-primary/30"
              }`}
              data-testid="button-toggle-extra-text"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                <path d="M2 3h8M2 6h5M2 9h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Add note
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={selected.size === 0}
              className={`ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                selected.size > 0
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.97] shadow-sm"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
              data-testid="button-send-actions"
            >
              Send{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
          </div>
        </div>
      )}
      {sending && (
        <div className="flex items-center gap-2 mt-2 text-sm text-blue-600 animate-pulse">
          <span>Sending…</span>
        </div>
      )}
    </div>
  );
}

function RenderMessageContent({ content, onActionClick }: { content: string; onActionClick?: (text: string) => void }) {
  return <ChatBGPMarkdown content={content} />;
}

function MessageBubble({ message, isOwn, onEdit, onDelete, onActionClick, completedActions }: {
  message: LocalMessage;
  isOwn?: boolean;
  onEdit?: (msgId: string, content: string) => void;
  onDelete?: (msgId: string) => void;
  onActionClick?: (text: string) => void;
  completedActions?: Set<string>;
}) {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const handleSaveEdit = () => {
    if (message.id && onEdit && editContent.trim()) {
      onEdit(message.id, editContent.trim());
      setEditing(false);
    }
  };

  if (isUser) {
    return (
      <div className="flex justify-end" data-testid={`message-${message.role}`}>
        {editing ? (
          <div className="max-w-[85%] space-y-1">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[44px] max-h-[120px] text-sm resize-none"
              rows={2}
              autoFocus
              data-testid="input-edit-message"
            />
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setEditing(false)} data-testid="button-cancel-edit">Cancel</Button>
              <Button size="sm" className="h-6 text-xs px-2" onClick={handleSaveEdit} data-testid="button-save-edit">Save</Button>
            </div>
          </div>
        ) : (
          <div className="relative max-w-[85%] group">
            <div className="rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-primary text-primary-foreground">
              {(() => {
                const audioMatch = message.content.match(/\[([^\]]+)\]\((\/api\/chat-media\/[^\)]+\.(webm|ogg|m4a|wav|mp4))\)/);
                if (audioMatch) {
                  return (
                    <div className="flex items-center gap-2">
                      <Mic className="w-4 h-4 shrink-0" />
                      <audio controls className="h-8 max-w-[200px]" preload="none">
                        <source src={audioMatch[2]} />
                      </audio>
                    </div>
                  );
                }
                const formatted = renderTextWithImages(message.content, `user-${message.id || "msg"}`);
                return formatted || message.content;
              })()}
            </div>
            {isOwn && message.id && (
              <div className="absolute -bottom-1 left-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="w-6 h-6 rounded-full bg-background border shadow-sm flex items-center justify-center" data-testid={`button-message-actions-${message.id}`}>
                      <MoreHorizontal className="w-3 h-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-28">
                    <DropdownMenuItem onClick={() => { setEditContent(message.content); setEditing(true); }} data-testid="button-edit-message">
                      <Pencil className="w-3 h-3 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => onDelete?.(message.id!)} data-testid="button-delete-message">
                      <Trash2 className="w-3 h-3 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const { textParts, actionParts } = splitContentParts(message.content);

  return (
    <div className="flex gap-3" data-testid={`message-${message.role}`}>
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        {textParts.length > 0 && (
          <div className="text-sm leading-relaxed text-foreground">
            <ChatBGPMarkdown content={textParts.join("\n")} />
          </div>
        )}
        {actionParts.length > 0 && (
          <div className="mt-2">
            <ActionCheckboxGroup
              actions={actionParts}
              completedActions={completedActions}
              onSubmit={onActionClick}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NewPropertyDialog({
  open, onOpenChange, properties, deals, onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: any[];
  deals: any[];
  onSubmit: (data: { linkedType: string; linkedId: string; linkedName: string }) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [searchQ, setSearchQ] = useState("");

  useEffect(() => {
    if (open) { setSelectedId(""); setSearchQ(""); }
  }, [open]);

  const filtered = searchQ
    ? properties.filter((i: any) => i.name?.toLowerCase().includes(searchQ.toLowerCase()))
    : properties;
  const selectedItem = properties.find((i: any) => i.id === selectedId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            New Property Chat
          </DialogTitle>
          <DialogDescription>
            Create an AI conversation linked to a property. You can add team members to collaborate.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search properties..."
              className="pl-9"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onInput={e => setSearchQ((e.target as HTMLInputElement).value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-testid="input-search-link-entity"
            />
          </div>
          <ScrollArea className="h-[200px]">
            <div className="space-y-1">
              {filtered.slice(0, 50).map((item: any) => (
                <button
                  key={item.id}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedId === item.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-muted text-foreground"
                  }`}
                  onClick={() => setSelectedId(item.id)}
                  data-testid={`link-item-${item.id}`}
                >
                  <p className="truncate">{item.name || "Untitled"}</p>
                  {item.status && (
                    <p className="text-xs text-muted-foreground mt-0.5">{item.status}</p>
                  )}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">No properties found</p>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!selectedId}
            onClick={() => {
              if (selectedItem) {
                onSubmit({
                  linkedType: "property",
                  linkedId: selectedItem.id,
                  linkedName: selectedItem.name || "Untitled",
                });
                onOpenChange(false);
              }
            }}
            data-testid="button-create-property-chat"
          >
            Create Chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PropertyContextSection({ title, icon: Icon, children, defaultOpen = false, actionButton }: {
  title: string;
  icon: any;
  children: React.ReactNode;
  defaultOpen?: boolean;
  actionButton?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(!open)}
        data-testid={`section-toggle-${title.toLowerCase().replace(/\s/g, "-")}`}
      >
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold flex-1">{title}</span>
        {actionButton && <span onClick={(e) => e.stopPropagation()}>{actionButton}</span>}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="px-4 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

function FolderTreeItem({ item, team, propertyName, depth = 0 }: {
  item: { id: string; name: string; isFolder: boolean; childCount: number; webUrl: string; size: number; lastModified: string };
  team: string;
  propertyName: string;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadChildren = async () => {
    if (children.length > 0 || loading) return;
    setLoading(true);
    try {
      const currentPath = item.name;
      const res = await fetch(`/api/microsoft/property-folders/${encodeURIComponent(team)}/${encodeURIComponent(propertyName)}?path=${encodeURIComponent(currentPath)}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setChildren(data.folders || []);
      }
    } catch (err) {
      console.error("[loadChildren] Failed:", err);
    }
    setLoading(false);
  };

  if (item.isFolder) {
    return (
      <div>
        <button
          className="w-full flex items-center gap-2.5 py-2 px-3 hover:bg-muted/40 transition-colors text-left"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) loadChildren();
          }}
          data-testid={`folder-${item.id}`}
        >
          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
          <Folder className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-xs truncate flex-1 font-medium">{item.name}</span>
          {item.childCount > 0 && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{item.childCount}</span>}
        </button>
        {expanded && (
          <div>
            {loading ? (
              <div className="flex items-center gap-2 py-2" style={{ paddingLeft: `${(depth + 1) * 16 + 12}px` }}>
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">Loading...</span>
              </div>
            ) : children.length === 0 ? (
              <p className="text-[11px] text-muted-foreground py-2" style={{ paddingLeft: `${(depth + 1) * 16 + 32}px` }}>Empty folder</p>
            ) : (
              children.map((child: any) => (
                <FolderTreeItem key={child.id} item={child} team={team} propertyName={propertyName} depth={depth + 1} />
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="w-full flex items-center gap-2.5 py-2 px-3 hover:bg-muted/40 transition-colors text-left group"
      style={{ paddingLeft: `${depth * 16 + 32}px` }}
      onClick={() => item.webUrl && window.open(item.webUrl, "_blank")}
      data-testid={`file-item-${item.id}`}
    >
      <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs truncate flex-1">{item.name}</span>
      {item.size > 0 && <span className="text-[10px] text-muted-foreground shrink-0">{formatFileSize(item.size)}</span>}
      <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function PropertyProjectView({
  project,
  onStartChat,
  onLoadThread,
  onNewChat,
  properties,
}: {
  project: { type: string; id: string; name: string; threads: any[]; dealChildren: any[] };
  onStartChat: (message: string) => void;
  onLoadThread: (id: string) => void;
  onNewChat: () => void;
  properties: any[];
}) {
  const [projectInput, setProjectInput] = useState("");
  const projectTextareaRef = useRef<HTMLTextAreaElement>(null);

  const allThreads = [
    ...project.threads,
    ...project.dealChildren.flatMap((d: any) => d.threads),
  ].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

  const propertyDetail = properties.find((p: any) => p.id === project.id);
  const address = propertyDetail?.address;
  const addressStr = address ? [address.line1, address.city, address.postcode].filter(Boolean).join(", ") : null;

  const handleProjectSend = () => {
    if (!projectInput.trim()) return;
    onStartChat(projectInput.trim());
    setProjectInput("");
  };

  const handleProjectKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleProjectSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center min-w-0 overflow-y-auto" data-testid="property-project-view">
      <div className="w-full max-w-[640px] mx-auto px-6 pt-20 pb-8 flex flex-col items-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
          <Building2 className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-[28px] font-bold text-center mb-1 tracking-tight" data-testid="text-project-name">{project.name}</h1>
        {addressStr && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mb-8">
            <MapPin className="w-3.5 h-3.5" />
            {addressStr}
          </p>
        )}
        {!addressStr && <div className="mb-8" />}

        <div className="w-full relative mb-10">
          <div className="flex items-end gap-2 w-full bg-muted/30 border border-border/60 rounded-2xl px-4 py-3.5 shadow-sm hover:border-border transition-colors focus-within:border-primary/40 focus-within:shadow-md">
            <Textarea
              ref={projectTextareaRef}
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
              onKeyDown={handleProjectKeyDown}
              placeholder={`Ask about ${project.name}...`}
              className="flex-1 resize-none min-h-[44px] max-h-[120px] border-0 bg-transparent px-0 py-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              rows={1}
              data-testid="input-project-chat"
            />
            <button
              onClick={handleProjectSend}
              disabled={!projectInput.trim()}
              className="p-2.5 rounded-xl shrink-0 bg-foreground text-background transition-all disabled:opacity-20 hover:opacity-90"
              data-testid="button-project-send"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="w-full">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Recent chats</h3>
            <button
              onClick={onNewChat}
              className="text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
              data-testid="button-project-new-chat"
            >
              + New chat
            </button>
          </div>
          {allThreads.length > 0 ? (
            <div className="space-y-0.5">
              {allThreads.map((thread: any) => (
                <button
                  key={thread.id}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-muted/50 transition-colors text-left group"
                  onClick={() => onLoadThread(thread.id)}
                  data-testid={`project-thread-${thread.id}`}
                >
                  <div className="w-9 h-9 rounded-full bg-muted/60 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{thread.title || "Untitled"}</p>
                    {thread.lastMessage?.content && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{thread.lastMessage.content}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground/60 shrink-0">
                    {new Date(thread.updatedAt || thread.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No conversations yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Start a chat to begin discussing this property</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectRightPanel({
  project,
  onClose,
  onAddMember,
  members,
  users,
  onNavigate,
  onSelectThread,
}: {
  project: { type: string; id: string; name: string; threads: any[]; dealChildren: any[] };
  onClose: () => void;
  onAddMember: (userId: string) => void;
  members: any[];
  users: any[];
  onNavigate: (path: string) => void;
  onSelectThread?: (threadId: string) => void;
}) {
  const propertyId = project.id;
  const [instructionInput, setInstructionInput] = useState("");
  const [addingInstruction, setAddingInstruction] = useState(false);
  const [addingFile, setAddingFile] = useState(false);
  const [fileNameInput, setFileNameInput] = useState("");
  const [fileUrlInput, setFileUrlInput] = useState("");

  const { data: propertyDetail } = useQuery<any>({
    queryKey: ["/api/crm/properties", propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!propertyId,
  });

  const { data: instructions = [] } = useQuery<any[]>({
    queryKey: ["/api/properties", propertyId, "instructions"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/instructions`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!propertyId,
  });

  const { data: projectFiles = [] } = useQuery<any[]>({
    queryKey: ["/api/properties", propertyId, "project-files"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/project-files`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!propertyId,
  });

  const { data: propertyDeals = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties", propertyId, "deals"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}/deals`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!propertyId,
  });

  const { data: propertyAgents = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties", propertyId, "agents"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}/agents`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!propertyId,
  });

  const landlordId = propertyDetail?.landlordId;
  const { data: landlordCompany } = useQuery<any>({
    queryKey: ["/api/crm/companies", landlordId],
    queryFn: async () => {
      const res = await fetch(`/api/crm/companies/${landlordId}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!landlordId,
  });

  const allProjectThreads = [
    ...project.threads,
    ...project.dealChildren.flatMap((d: any) => d.threads),
  ].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

  const folderTeams: string[] = propertyDetail?.folderTeams || [];
  const [activeFolderTeam, setActiveFolderTeam] = useState<string | null>(null);

  useEffect(() => {
    if (folderTeams.length > 0 && !activeFolderTeam) {
      setActiveFolderTeam(folderTeams[0]);
    }
  }, [folderTeams, activeFolderTeam]);

  const { data: folderData } = useQuery<{ exists: boolean; folders: any[] }>({
    queryKey: ["/api/microsoft/property-folders", activeFolderTeam, propertyDetail?.name],
    queryFn: async () => {
      const res = await fetch(`/api/microsoft/property-folders/${encodeURIComponent(activeFolderTeam!)}/${encodeURIComponent(propertyDetail?.name)}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return { exists: false, folders: [] };
      return res.json();
    },
    enabled: !!activeFolderTeam && !!propertyDetail?.name,
  });

  const memberIds = new Set(members.map((m: any) => m.id || m.userId));
  const availableUsers = users.filter((u: any) => !memberIds.has(u.id));

  const handleAddInstruction = async () => {
    if (!instructionInput.trim()) return;
    try {
      await fetch(`/api/properties/${propertyId}/instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ content: instructionInput.trim() }),
      });
      setInstructionInput("");
      setAddingInstruction(false);
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "instructions"] });
    } catch (err) {
      console.error("[handleAddInstruction] Failed:", err);
    }
  };

  const handleDeleteInstruction = async (id: number) => {
    try {
      await fetch(`/api/properties/${propertyId}/instructions/${id}`, { method: "DELETE", credentials: "include", headers: { ...getAuthHeaders() } });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "instructions"] });
    } catch (err) {
      console.error("[handleDeleteInstruction] Failed:", err);
    }
  };

  const handleAddFile = async () => {
    if (!fileNameInput.trim()) return;
    try {
      await fetch(`/api/properties/${propertyId}/project-files`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ name: fileNameInput.trim(), webUrl: fileUrlInput.trim() || null }),
      });
      setFileNameInput("");
      setFileUrlInput("");
      setAddingFile(false);
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "project-files"] });
    } catch (err) {
      console.error("[handleAddFile] Failed:", err);
    }
  };

  const handleDeleteFile = async (id: number) => {
    try {
      await fetch(`/api/properties/${propertyId}/project-files/${id}`, { method: "DELETE", credentials: "include", headers: { ...getAuthHeaders() } });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "project-files"] });
    } catch (err) {
      console.error("[handleDeleteFile] Failed:", err);
    }
  };

  const [fileDragOver, setFileDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setFileDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      try {
        await fetch(`/api/properties/${propertyId}/project-files`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          credentials: "include",
          body: JSON.stringify({ name: file.name, webUrl: null }),
        });
      } catch (err) {
        console.error("[handleFileDrop] Failed:", err);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "project-files"] });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        await fetch(`/api/properties/${propertyId}/project-files`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          credentials: "include",
          body: JSON.stringify({ name: file.name, webUrl: null }),
        });
      } catch (err) {
        console.error("[handleFileSelect] Failed:", err);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "project-files"] });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="w-[280px] border-l bg-background flex flex-col shrink-0 h-full overflow-hidden" data-testid="project-right-panel">
      <div className="flex items-center justify-between px-5 py-3.5 shrink-0 lg:hidden">
        <span className="text-sm font-semibold">Project</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="button-close-project-panel">
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 overflow-x-hidden">
        <div className="px-5 py-4 space-y-6 min-w-0 overflow-hidden">

          <div className="min-w-0">
            <div className="flex items-center justify-between mb-2.5 min-w-0">
              <h4 className="text-sm font-semibold text-foreground shrink-0">Summary</h4>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
                <Eye className="w-3 h-3" /> Only you
              </span>
            </div>
            {propertyDetail ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {propertyDetail.status && (
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Status</span>
                      <span className="text-xs font-medium">{propertyDetail.status}</span>
                    </div>
                  )}
                  {propertyDetail.assetClass && (
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Type</span>
                      <span className="text-xs font-medium">{propertyDetail.assetClass}</span>
                    </div>
                  )}
                  {propertyDetail.sqft && (
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Size</span>
                      <span className="text-xs font-medium">{Number(propertyDetail.sqft).toLocaleString()} sq ft</span>
                    </div>
                  )}
                  {(landlordCompany?.name || propertyDetail.tenure) && (
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Client</span>
                      {landlordCompany ? (
                        <button
                          onClick={() => window.open(`/companies/${landlordCompany.id}`, '_blank')}
                          className="text-xs font-medium text-primary hover:underline text-left truncate block max-w-full"
                          data-testid="link-client-company"
                        >
                          {landlordCompany.name}
                        </button>
                      ) : (
                        <span className="text-xs font-medium">{propertyDetail.tenure}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Property summary will show here after a few chats.</p>
            )}
          </div>

          <div className="border-t border-border/50 pt-5">
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-sm font-semibold text-foreground">Instructions</h4>
              <button
                onClick={() => setAddingInstruction(true)}
                className="p-1 rounded-md hover:bg-muted transition-colors"
                title="Add instruction"
                data-testid="button-add-instruction"
              >
                <Plus className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            {addingInstruction && (
              <div className="mb-3 space-y-2">
                <Textarea
                  value={instructionInput}
                  onChange={(e) => setInstructionInput(e.target.value)}
                  placeholder="e.g. Always include rent review dates when discussing this property..."
                  className="min-h-[80px] text-xs resize-none rounded-xl bg-muted/30 border-border/50"
                  data-testid="input-instruction"
                />
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-7 text-xs rounded-lg" onClick={handleAddInstruction} disabled={!instructionInput.trim()}>Save</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg" onClick={() => { setAddingInstruction(false); setInstructionInput(""); }}>Cancel</Button>
                </div>
              </div>
            )}
            {instructions.length > 0 ? (
              <div className="space-y-1.5">
                {instructions.map((inst: any) => (
                  <div key={inst.id} className="group flex items-start gap-2 p-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs flex-1 whitespace-pre-wrap leading-relaxed">{inst.content}</p>
                    <button
                      onClick={() => handleDeleteInstruction(inst.id)}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all shrink-0"
                      data-testid={`delete-instruction-${inst.id}`}
                    >
                      <X className="w-3 h-3 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            ) : !addingInstruction ? (
              <p className="text-xs text-muted-foreground">Add instructions to tailor ChatBGP's responses for this property</p>
            ) : null}
          </div>

          <div className="border-t border-border/50 pt-5">
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-sm font-semibold text-foreground">Files</h4>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setAddingFile(true)}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                  title="Add link or reference"
                  data-testid="button-add-file-link"
                >
                  <Link2 className="w-4 h-4 text-muted-foreground" />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                  title="Add file"
                  data-testid="button-add-file"
                >
                  <Plus className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file-upload"
            />

            {projectFiles.length > 0 && (
              <div className="space-y-0.5 mb-3">
                {projectFiles.map((f: any) => (
                  <div key={f.id} className="group flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-muted/40 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <span className="text-xs truncate flex-1 font-medium">{f.name}</span>
                    {f.web_url && (
                      <button onClick={() => window.open(f.web_url, "_blank")} className="p-1 opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-muted">
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteFile(f.id)}
                      className="p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all rounded shrink-0"
                      data-testid={`delete-file-${f.id}`}
                    >
                      <X className="w-3 h-3 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {addingFile && (
              <div className="mb-3 space-y-2">
                <Input
                  value={fileNameInput}
                  onChange={(e) => setFileNameInput(e.target.value)}
                  placeholder="File name"
                  className="h-8 text-xs rounded-lg"
                  data-testid="input-file-name"
                />
                <Input
                  value={fileUrlInput}
                  onChange={(e) => setFileUrlInput(e.target.value)}
                  placeholder="URL (optional)"
                  className="h-8 text-xs rounded-lg"
                  data-testid="input-file-url"
                />
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-7 text-xs rounded-lg" onClick={handleAddFile} disabled={!fileNameInput.trim()}>Add</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg" onClick={() => { setAddingFile(false); setFileNameInput(""); setFileUrlInput(""); }}>Cancel</Button>
                </div>
              </div>
            )}

            <div
              className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                fileDragOver
                  ? "border-primary bg-primary/5"
                  : "border-border/50 hover:border-border hover:bg-muted/20"
              } ${projectFiles.length > 0 ? "p-4" : "p-6"}`}
              onDragOver={(e) => { e.preventDefault(); setFileDragOver(true); }}
              onDragLeave={() => setFileDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="file-drop-zone"
            >
              <div className="flex flex-col items-center text-center">
                {projectFiles.length === 0 && (
                  <div className="flex gap-1.5 mb-3">
                    <div className="w-10 h-12 rounded-lg bg-muted/60 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-muted-foreground/60" />
                    </div>
                    <div className="w-10 h-12 rounded-lg bg-muted/60 flex items-center justify-center -ml-2">
                      <FileSpreadsheet className="w-5 h-5 text-muted-foreground/60" />
                    </div>
                    <div className="w-10 h-12 rounded-lg bg-muted/60 flex items-center justify-center -ml-2">
                      <File className="w-5 h-5 text-muted-foreground/60" />
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {fileDragOver ? "Drop files here" : projectFiles.length > 0 ? "Drop more files here" : "Add PDFs, documents, or other files to reference in this project."}
                </p>
              </div>
            </div>
          </div>

          {folderTeams.length > 0 && (
            <div className="border-t border-border/50 pt-5">
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-500" />
                  SharePoint
                </h4>
              </div>
              {folderTeams.length > 1 && (
                <div className="flex gap-1 mb-3 flex-wrap">
                  {folderTeams.map(t => (
                    <button
                      key={t}
                      onClick={() => setActiveFolderTeam(t)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${activeFolderTeam === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              {folderData?.exists && folderData.folders.length > 0 ? (
                <div className="rounded-xl bg-muted/20 border border-border/40 overflow-hidden">
                  {folderData.folders.map((item: any, idx: number) => (
                    <div key={item.id} className={idx > 0 ? "border-t border-border/30" : ""}>
                      <FolderTreeItem
                        item={item}
                        team={activeFolderTeam!}
                        propertyName={propertyDetail?.name || ""}
                      />
                    </div>
                  ))}
                </div>
              ) : folderData?.exists === false ? (
                <div className="rounded-xl bg-muted/20 border border-border/40 p-4 text-center">
                  <FolderOpen className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No SharePoint folders configured</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-0.5">Set up SharePoint on the property to see folders here</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 py-3 justify-center">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading folders...</span>
                </div>
              )}
            </div>
          )}

          {propertyDeals.length > 0 && (
            <div className="border-t border-border/50 pt-5">
              <h4 className="text-sm font-semibold text-foreground mb-2.5">Linked Deals</h4>
              <div className="space-y-0.5">
                {propertyDeals.map((d: any) => (
                  <button
                    key={d.id}
                    className="w-full flex items-center gap-2.5 py-2 px-2.5 rounded-xl hover:bg-muted/40 transition-colors text-left"
                    onClick={() => onNavigate(`/deals?id=${d.id}`)}
                  >
                    <div className="w-7 h-7 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                      <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{d.name || d.dealName || "Untitled"}</p>
                      {d.status && <p className="text-[10px] text-muted-foreground">{d.status}</p>}
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border/50 pt-5">
            <h4 className="text-sm font-semibold text-foreground mb-2.5">Conversations</h4>
            {allProjectThreads.length > 0 ? (
              <div className="space-y-0.5">
                {allProjectThreads.slice(0, 8).map((t: any) => (
                  <button
                    key={t.id}
                    className="w-full flex items-center gap-2.5 py-2 px-2.5 rounded-xl hover:bg-muted/40 transition-colors text-left"
                    onClick={() => onSelectThread?.(t.id)}
                    data-testid={`conversation-thread-${t.id}`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{t.title || "Untitled conversation"}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}
                      </p>
                    </div>
                  </button>
                ))}
                {allProjectThreads.length > 8 && (
                  <p className="text-[10px] text-muted-foreground text-center pt-1">
                    +{allProjectThreads.length - 8} more conversations
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No conversations yet for this property.</p>
            )}
          </div>

          <div className="border-t border-border/50 pt-5">
            <h4 className="text-sm font-semibold text-foreground mb-2.5">Teams</h4>
            {(() => {
              const teamSet = new Set<string>();
              propertyDeals.forEach((d: any) => {
                if (Array.isArray(d.team)) d.team.forEach((t: string) => t && teamSet.add(t));
                else if (d.team) teamSet.add(d.team);
              });
              const teams = Array.from(teamSet).sort();
              return teams.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {teams.map((t) => (
                    <span key={t} className="text-[11px] bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium">
                      {t}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No teams assigned yet.</p>
              );
            })()}

            {propertyAgents.length > 0 && (
              <div className="mt-3">
                <span className="text-[10px] text-muted-foreground block mb-1.5">Agents</span>
                <div className="space-y-0.5">
                  {propertyAgents.map((a: any) => (
                    <div key={a.id || a.userId} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-muted/40">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="w-3 h-3 text-primary" />
                      </div>
                      <span className="text-xs font-medium truncate">{a.name || a.userName || "Agent"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function ThreadInfoPanel({
  thread, onClose, onAddMember, members, users, onNavigate, isPropertyThread,
}: {
  thread: ThreadData;
  onClose: () => void;
  onAddMember: (userId: string) => void;
  members: any[];
  users: any[];
  onNavigate: (path: string) => void;
  isPropertyThread: boolean;
}) {
  const propertyId = thread.linkedType === "property" ? thread.linkedId : null;

  const { data: propertyDetail } = useQuery<any>({
    queryKey: ["/api/crm/properties", propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!propertyId,
  });

  const { data: propertyDeals = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties", propertyId, "deals"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}/deals`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!propertyId,
  });

  const { data: propertyAgents = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties", propertyId, "agents"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}/agents`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!propertyId,
  });

  const folderTeams: string[] = propertyDetail?.folderTeams || [];
  const [activeFolderTeam, setActiveFolderTeam] = useState<string | null>(null);

  useEffect(() => {
    if (folderTeams.length > 0 && !activeFolderTeam) {
      setActiveFolderTeam(folderTeams[0]);
    }
  }, [folderTeams, activeFolderTeam]);

  const { data: folderData } = useQuery<{ exists: boolean; folders: any[] }>({
    queryKey: ["/api/microsoft/property-folders", activeFolderTeam, propertyDetail?.name],
    queryFn: async () => {
      const res = await fetch(`/api/microsoft/property-folders/${encodeURIComponent(activeFolderTeam!)}/${encodeURIComponent(propertyDetail?.name)}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return { exists: false, folders: [] };
      return res.json();
    },
    enabled: !!activeFolderTeam && !!propertyDetail?.name,
  });

  const { data: marketingFiles = [] } = useQuery<UnitMarketingFile[]>({
    queryKey: ["/api/available-units", "by-property", propertyId, "files"],
    queryFn: async () => {
      if (!propertyId) return [];
      const unitsRes = await fetch(`/api/available-units?propertyId=${propertyId}`, { credentials: "include" });
      if (!unitsRes.ok) return [];
      const units = await unitsRes.json();
      const allFiles: UnitMarketingFile[] = [];
      for (const unit of units) {
        const filesRes = await fetch(`/api/available-units/${unit.id}/files`, { credentials: "include" });
        if (filesRes.ok) {
          const files = await filesRes.json();
          allFiles.push(...files);
        }
      }
      return allFiles;
    },
    enabled: !!propertyId,
  });

  const memberIds = new Set(members.map((m: any) => m.id || m.userId));
  const availableUsers = users.filter((u: any) => !memberIds.has(u.id));
  const address = propertyDetail?.address;
  const addressStr = address ? [address.line1, address.city, address.postcode].filter(Boolean).join(", ") : null;

  if (!isPropertyThread) {
    return (
      <div className="w-[300px] border-l bg-background flex flex-col shrink-0 h-full" data-testid="thread-info-panel">
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h3 className="text-sm font-semibold">Details</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="button-close-info">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {thread.linkedType && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Linked {getLinkedLabel(thread.linkedType)}
                </p>
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  {(() => { const Icon = getLinkedIcon(thread.linkedType); return <Icon className="w-4 h-4 text-muted-foreground" />; })()}
                  <span className="text-sm font-medium truncate">{thread.linkedName}</span>
                </div>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Team Members ({members.length})
              </p>
              <div className="space-y-1.5">
                {members.map((m: any) => (
                  <div key={m.id || m.userId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/50">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="w-3 h-3 text-primary" />
                    </div>
                    <span className="text-sm truncate">{m.name || m.userName || m.id || "Unknown"}</span>
                  </div>
                ))}
              </div>
              {availableUsers.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full mt-2 gap-2 text-xs" data-testid="button-add-member">
                      <UserPlus className="w-3.5 h-3.5" />
                      Add Member
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-48 max-h-[200px] overflow-y-auto">
                    {availableUsers.map((u: any) => (
                      <DropdownMenuItem key={u.id} onClick={() => onAddMember(u.id)} data-testid={`add-member-${u.id}`}>
                        {u.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="w-[300px] border-l bg-background flex flex-col shrink-0 h-full" data-testid="thread-info-panel">
      <div className="px-4 pt-4 pb-3 border-b shrink-0">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => onNavigate(`/properties?id=${propertyId}`)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            data-testid="button-view-property-board"
          >
            <ArrowLeft className="w-3 h-3" />
            Property Board
          </button>
          <Button variant="ghost" size="icon" className="h-6 w-6 lg:hidden" onClick={onClose} data-testid="button-close-info">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Building2 className="w-4.5 h-4.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold leading-tight truncate" data-testid="text-property-name">
              {thread.linkedName || "Property"}
            </h3>
            {addressStr && (
              <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                {addressStr}
              </p>
            )}
          </div>
        </div>
        {propertyDetail && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {propertyDetail.status && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-medium">
                {propertyDetail.status}
              </span>
            )}
            {propertyDetail.assetClass && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-medium">
                {propertyDetail.assetClass}
              </span>
            )}
            {propertyDetail.sqft && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                {Number(propertyDetail.sqft).toLocaleString()} sq ft
              </span>
            )}
            {propertyDetail.tenure && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                {propertyDetail.tenure}
              </span>
            )}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div>
          {propertyAgents.length > 0 && (
            <PropertyContextSection title="BGP Agents" icon={Users} defaultOpen={true}>
              <div className="space-y-1">
                {propertyAgents.map((a: any) => (
                  <div key={a.id || a.userId} className="flex items-center gap-2 py-1">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-3 h-3 text-primary" />
                    </div>
                    <span className="text-xs truncate">{a.name || a.userName || "Unknown"}</span>
                  </div>
                ))}
              </div>
            </PropertyContextSection>
          )}

          <PropertyContextSection title="Files" icon={FolderOpen} defaultOpen={true}>
            {folderTeams.length > 0 ? (
              <div>
                {folderTeams.length > 1 && (
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {folderTeams.map(t => (
                      <button
                        key={t}
                        onClick={() => setActiveFolderTeam(t)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${activeFolderTeam === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                        data-testid={`folder-team-${t}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {folderData?.exists && folderData.folders.length > 0 ? (
                  <div className="space-y-0">
                    {folderData.folders.map((item: any) => (
                      <FolderTreeItem
                        key={item.id}
                        item={item}
                        team={activeFolderTeam!}
                        propertyName={propertyDetail?.name || ""}
                      />
                    ))}
                  </div>
                ) : folderData?.exists === false ? (
                  <p className="text-[11px] text-muted-foreground py-1">No SharePoint folders set up yet</p>
                ) : (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">Loading folders...</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground py-1">No SharePoint folders configured</p>
            )}
          </PropertyContextSection>

          {marketingFiles.length > 0 && (
            <PropertyContextSection title="Marketing Files" icon={FileText}>
              <div className="space-y-1">
                {marketingFiles.map(f => (
                  <button
                    key={f.id}
                    className="w-full flex items-center gap-2 py-1.5 hover:bg-muted/40 rounded transition-colors text-left"
                    onClick={() => window.open(f.filePath, "_blank")}
                    data-testid={`marketing-file-${f.id}`}
                  >
                    <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate flex-1">{f.fileName}</span>
                    <Download className="w-3 h-3 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </PropertyContextSection>
          )}

          {propertyDeals.length > 0 && (
            <PropertyContextSection title="Linked Deals" icon={Briefcase}>
              <div className="space-y-1">
                {propertyDeals.map((d: any) => (
                  <button
                    key={d.id}
                    className="w-full flex items-center gap-2 py-1.5 hover:bg-muted/40 rounded transition-colors text-left"
                    onClick={() => onNavigate(`/deals?id=${d.id}`)}
                    data-testid={`deal-link-${d.id}`}
                  >
                    <Briefcase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{d.name || d.dealName || "Untitled Deal"}</p>
                      {d.status && <p className="text-[10px] text-muted-foreground">{d.status}</p>}
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </PropertyContextSection>
          )}

          <PropertyContextSection title="Team Members" icon={Users}>
            <div className="space-y-1">
              {members.map((m: any) => (
                <div key={m.id || m.userId} className="flex items-center gap-2 py-1">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="w-3 h-3 text-primary" />
                  </div>
                  <span className="text-xs truncate">{m.name || m.userName || m.id || "Unknown"}</span>
                </div>
              ))}
            </div>
            {availableUsers.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full mt-2 gap-2 text-xs" data-testid="button-add-member">
                    <UserPlus className="w-3.5 h-3.5" />
                    Add Member
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-48 max-h-[200px] overflow-y-auto">
                  {availableUsers.map((u: any) => (
                    <DropdownMenuItem key={u.id} onClick={() => onAddMember(u.id)} data-testid={`add-member-${u.id}`}>
                      {u.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </PropertyContextSection>
        </div>
      </ScrollArea>
    </div>
  );
}

function ThreadRow({
  thread, active, onLoad, onRename, onDelete,
  editingTitle, editTitleValue, setEditTitleValue, onSaveRename, onCancelRename,
  indent = false,
}: {
  thread: any;
  active: boolean;
  onLoad: () => void;
  onRename: () => void;
  onDelete: () => void;
  editingTitle: string | null;
  editTitleValue: string;
  setEditTitleValue: (v: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  indent?: boolean;
}) {
  if (editingTitle === thread.id) {
    return (
      <div className={`px-3 py-1.5 ${indent ? "pl-9" : ""}`}>
        <Input
          value={editTitleValue}
          onChange={(e) => setEditTitleValue(e.target.value)}
          onBlur={onSaveRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveRename();
            if (e.key === "Escape") onCancelRename();
          }}
          className="h-9 text-sm rounded-lg"
          autoFocus
          data-testid="input-rename-thread"
        />
      </div>
    );
  }
  return (
    <div className="group">
      <div
        role="button"
        tabIndex={0}
        className={`flex items-center gap-3 py-2.5 rounded-xl cursor-pointer transition-colors overflow-hidden ${indent ? "pl-9 pr-3" : "px-3"} ${
          active ? "bg-muted font-medium" : "hover:bg-muted/60"
        }`}
        onClick={onLoad}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLoad(); } }}
        data-testid={`thread-${thread.id}`}
      >
        <MessageSquare className="w-[18px] h-[18px] shrink-0 opacity-60" />
        <span className="flex-1 min-w-0 text-[14px] truncate block">
          {thread.title || "Untitled Chat"}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-muted-foreground/10 shrink-0"
              onClick={(e) => e.stopPropagation()}
              data-testid={`thread-menu-${thread.id}`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(); }}>
              <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ProjectRow({
  project, activeThreadId, onLoadThread, onRename, onDelete,
  editingTitle, editTitleValue, setEditTitleValue, onSaveRename, onCancelRename,
  onOpenProject, activeProjectId,
}: {
  project: {
    type: "property" | "deal";
    id: string;
    name: string;
    threads: any[];
    dealChildren: { id: string; name: string; threads: any[] }[];
  };
  activeThreadId: string | null;
  onLoadThread: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  editingTitle: string | null;
  editTitleValue: string;
  setEditTitleValue: (v: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onOpenProject: (project: any) => void;
  activeProjectId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = project.type === "property" ? Building2 : Briefcase;

  const allThreads = [
    ...project.threads,
    ...project.dealChildren.flatMap((d) => d.threads),
  ];
  const isActive = activeProjectId === project.id || allThreads.some(t => t.id === activeThreadId);

  const handleClick = () => {
    onOpenProject(project);
  };

  return (
    <div className="mb-0.5">
      <button
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-semibold hover:bg-muted/60 transition-colors overflow-hidden ${
          isActive ? "bg-muted/60" : ""
        }`}
        onClick={handleClick}
        data-testid={`project-${project.id}`}
      >
        <Icon className="w-[18px] h-[18px] shrink-0" />
        <span className="flex-1 min-w-0 truncate text-left">{project.name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{allThreads.length > 0 ? allThreads.length : ""}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        />
      </button>
      {expanded && allThreads.length > 0 && (
        <div>
          {project.threads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              active={activeThreadId === t.id}
              onLoad={() => onLoadThread(t.id)}
              onRename={() => onRename(t.id)}
              onDelete={() => onDelete(t.id)}
              editingTitle={editingTitle}
              editTitleValue={editTitleValue}
              setEditTitleValue={setEditTitleValue}
              onSaveRename={onSaveRename}
              onCancelRename={onCancelRename}
              indent
            />
          ))}
          {project.dealChildren.map((deal) => (
            <div key={deal.id}>
              <div className="flex items-center gap-2.5 pl-9 pr-3 py-2 text-[13px] text-muted-foreground font-medium overflow-hidden">
                <Briefcase className="w-4 h-4 shrink-0" />
                <span className="truncate">{deal.name}</span>
              </div>
              {deal.threads.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  active={activeThreadId === t.id}
                  onLoad={() => onLoadThread(t.id)}
                  onRename={() => onRename(t.id)}
                  onDelete={() => onDelete(t.id)}
                  editingTitle={editingTitle}
                  editTitleValue={editTitleValue}
                  setEditTitleValue={setEditTitleValue}
                  onSaveRename={onSaveRename}
                  onCancelRename={onCancelRename}
                  indent
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatBGP() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialThreadId = urlParams.get("thread");
  const initialMessage = urlParams.get("message");
  const [activeThreadId, _setActiveThreadId] = useState<string | null>(initialThreadId);
  const activeThreadIdRef = useRef<string | null>(initialThreadId);
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  const setActiveThreadId = (id: string | null) => {
    activeThreadIdRef.current = id;
    _setActiveThreadId(id);
    setCompletedActions(new Set());
    messageQueueRef.current = [];
    setQueueLength(0);
    if (id) setActiveProjectView(null);
  };
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState(initialMessage || "");
  const initialMessageSentRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [newPropertyOpen, setNewPropertyOpen] = useState(false);
  const [showMarketingFiles, setShowMarketingFiles] = useState(false);
  const [marketingSearch, setMarketingSearch] = useState("");
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState("");
  const headerSearchRef = useRef<HTMLInputElement>(null);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [activeProjectView, setActiveProjectView] = useState<{ type: string; id: string; name: string; threads: any[]; dealChildren: any[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Map<number, string>>(new Map());
  const [uploading, setUploading] = useState(false);
  const messageQueueRef = useRef<string[]>([]);
  const [queueLength, setQueueLength] = useState(0);
  const messagesRef = useRef<LocalMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: currentUser } = useQuery<{ id: string; name: string }>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: status, isLoading: statusLoading } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/chatbgp/status"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: threads, isLoading: threadsLoading } = useQuery<ThreadData[]>({
    queryKey: ["/api/chat/threads"],
    enabled: status?.connected === true,
  });

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: deals = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/deals"],
  });

  const { data: bgpUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  type MarketingFileRow = {
    id: string;
    unitId: string;
    fileName: string;
    filePath: string;
    fileType: string;
    fileSize: number | null;
    mimeType: string | null;
    createdAt: string | null;
    unitName: string | null;
    propertyId: string | null;
  };

  const { data: allMarketingFiles = [], isLoading: marketingLoading } = useQuery<MarketingFileRow[]>({
    queryKey: ["/api/available-units/all-files"],
    enabled: showMarketingFiles,
  });

  const filteredMarketingFiles = useMemo(() => {
    if (!marketingSearch.trim()) return allMarketingFiles;
    const q = marketingSearch.toLowerCase();
    return allMarketingFiles.filter(f =>
      f.fileName.toLowerCase().includes(q) ||
      (f.unitName || "").toLowerCase().includes(q) ||
      (f.propertyId && properties.find((p: any) => p.id === f.propertyId)?.name || "").toLowerCase().includes(q)
    );
  }, [allMarketingFiles, marketingSearch, properties]);

  const groupedMarketingFiles = useMemo(() => {
    const propNameMap: Record<string, string> = {};
    for (const p of properties) propNameMap[p.id] = p.name;
    const groups: Record<string, { propertyName: string; files: MarketingFileRow[] }> = {};
    for (const f of filteredMarketingFiles) {
      const pName = f.propertyId ? (propNameMap[f.propertyId] || "Unknown Property") : "Unknown Property";
      const key = f.propertyId || "unknown";
      if (!groups[key]) groups[key] = { propertyName: pName, files: [] };
      groups[key].files.push(f);
    }
    return Object.values(groups).sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [filteredMarketingFiles, properties]);

  const { data: threadMembers = [] } = useQuery<any[]>({
    queryKey: ["/api/chat/threads", activeThreadId, "members"],
    queryFn: async () => {
      if (!activeThreadId) return [];
      const res = await fetch(`/api/chat/threads/${activeThreadId}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return data.members || [];
    },
    enabled: !!activeThreadId,
  });

  const aiThreads = useMemo(() => {
    if (!threads) return [];
    return threads.filter((t) => t.isAiChat);
  }, [threads]);

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return aiThreads;
    const q = searchQuery.toLowerCase();
    return aiThreads.filter(
      (t) =>
        t.title?.toLowerCase().includes(q) ||
        t.linkedName?.toLowerCase().includes(q)
    );
  }, [aiThreads, searchQuery]);

  const { data: headerSearchResults = [] } = useQuery<any[]>({
    queryKey: ["/api/chat/threads/search", headerSearchQuery],
    queryFn: async () => {
      if (!headerSearchQuery.trim()) return [];
      const q = headerSearchQuery.toLowerCase();
      const allThreads = threads || [];
      const matched: any[] = [];
      for (const t of allThreads) {
        if (
          t.title?.toLowerCase().includes(q) ||
          t.linkedName?.toLowerCase().includes(q) ||
          t.lastMessage?.content?.toLowerCase().includes(q)
        ) {
          matched.push(t);
        }
      }
      return matched;
    },
    enabled: headerSearchOpen && headerSearchQuery.trim().length > 0,
  });

  const { projectItems, generalThreads } = useMemo(() => {
    const propertyLinked = filteredThreads.filter((t) => t.linkedType === "property" && t.linkedId);
    const unlinked = filteredThreads.filter((t) => t.linkedType !== "property" || !t.linkedId);

    type ProjectItem = {
      type: "property";
      id: string;
      name: string;
      threads: any[];
      dealChildren: { id: string; name: string; threads: any[] }[];
    };

    const items: ProjectItem[] = [];

    const propertyGroups = new Map<string, any[]>();
    propertyLinked.forEach((pt) => {
      const existing = propertyGroups.get(pt.linkedId!) || [];
      existing.push(pt);
      propertyGroups.set(pt.linkedId!, existing);
    });

    propertyGroups.forEach((threads, propId) => {
      const propName = threads[0]?.linkedName || "Property";
      items.push({ type: "property", id: propId, name: propName, threads, dealChildren: [] });
    });

    return { projectItems: items, generalThreads: unlinked };
  }, [filteredThreads]);

  useEffect(() => {
    if (activeProjectView) {
      const updated = projectItems.find(p => p.id === activeProjectView.id);
      if (updated) setActiveProjectView(updated);
    }
  }, [projectItems]);

  const threadGroups = useMemo(() => groupThreadsByDate(generalThreads), [generalThreads]);

  const activeThread = useMemo(
    () => aiThreads.find((t) => t.id === activeThreadId) || null,
    [aiThreads, activeThreadId]
  );

  const isPropertyThread = !!(activeThread?.linkedType === "property" && activeThread?.linkedId);

  useEffect(() => {
    if (isPropertyThread) {
      setInfoPanelOpen(true);
    }
  }, [isPropertyThread, activeThreadId]);

  const createThreadMutation = useMutation({
    mutationFn: async (opts: { firstMessage: string; linkedType?: string; linkedId?: string; linkedName?: string }) => {
      const title = opts.firstMessage.length > 50 ? opts.firstMessage.slice(0, 50) + "..." : opts.firstMessage;
      const res = await apiRequest("POST", "/api/chat/threads", {
        title,
        isAiChat: true,
        linkedType: opts.linkedType || null,
        linkedId: opts.linkedId || null,
        linkedName: opts.linkedName || null,
      });
      return res.json();
    },
    onSuccess: (thread: ThreadData) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      setActiveThreadId(thread.id);
    },
  });

  const saveMessageMutation = useMutation({
    mutationFn: async ({ threadId, role, content }: { threadId: string; role: string; content: string }) => {
      const res = await apiRequest("POST", `/api/chat/threads/${threadId}/messages`, { role, content });
      return res.json();
    },
  });

  const updateThreadMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PUT", `/api/chat/threads/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/chat/threads/${id}`);
    },
    onSuccess: () => {
      if (activeThreadId) {
        setActiveThreadId(null);
        setMessages([]);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ threadId, userId }: { threadId: string; userId: string }) => {
      const res = await apiRequest("POST", `/api/chat/threads/${threadId}/members`, { userId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", activeThreadId, "members"] });
      toast({ title: "Team member added" });
    },
  });

  const invalidateCrmEntity = (entityType: string) => {
    const entityKeyMap: Record<string, string[]> = {
      deal: ["deals"],
      contact: ["contacts"],
      company: ["companies"],
      property: ["properties"],
      lead: ["leads"],
      comp: ["comps"],
      requirement: ["requirements-leasing", "requirements-investment"],
      requirement_leasing: ["requirements-leasing"],
      requirement_investment: ["requirements-investment"],
      available_unit: ["available-units"],
    };
    const keys = entityKeyMap[entityType];
    if (keys) {
      for (const k of keys) {
        queryClient.invalidateQueries({ queryKey: [`/api/crm/${k}`] });
      }
      if (entityType === "available_unit") {
        queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      }
    }
  };

  const handleChatAction = (action: any) => {
    if (!action) return;
    const entityRouteMap: Record<string, string> = {
      deal: "/deals", contact: "/contacts", company: "/companies", property: "/properties",
    };
    switch (action.type) {
      case "navigate":
        if (action.path) setTimeout(() => navigate(action.path), 500);
        break;
      case "crm_created":
      case "crm_updated": {
        if (action.entityType) {
          invalidateCrmEntity(action.entityType);
          toast({ title: `${action.entityType} ${action.type === "crm_created" ? "created" : "updated"}`, description: action.name || `ID: ${action.id?.slice(0, 8)}` });
        }
        break;
      }
      case "crm_deleted": {
        if (action.entityType) {
          invalidateCrmEntity(action.entityType);
          toast({ title: `${action.entityType} deleted` });
        }
        break;
      }
      case "email_sent":
        toast({ title: "Email sent", description: `To: ${action.to}` });
        break;
      case "change_request":
        toast({ title: "Change request logged" });
        break;
    }
  };

  const sendMutation = useMutation({
    mutationFn: async (newMessages: LocalMessage[]) => {
      const attemptSend = async (attempt: number): Promise<any> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000);
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          const token = localStorage.getItem("bgp_auth_token");
          if (token) headers["Authorization"] = `Bearer ${token}`;
          const res = await fetch("/api/chatbgp/chat", {
            method: "POST",
            headers,
            body: JSON.stringify({ messages: newMessages }),
            credentials: "include",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!res.ok) {
            const text = (await res.text()) || res.statusText;
            if (res.status >= 500 && attempt < 2) {
              await new Promise(r => setTimeout(r, 2000 * attempt));
              return attemptSend(attempt + 1);
            }
            throw new Error(`${res.status}: ${text}`);
          }
          const reader = res.body?.getReader();
          if (!reader) throw new Error("No response stream");
          const decoder = new TextDecoder();
          let buffer = "";
          let lastData = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const raw = line.slice(6);
                try {
                  const parsed = JSON.parse(raw);
                  if (parsed.reply) {
                    lastData = raw;
                  }
                } catch {}
              }
            }
          }
          if (buffer.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(buffer.slice(6));
              if (parsed.reply) lastData = buffer.slice(6);
            } catch {}
          }
          if (lastData) return JSON.parse(lastData);
          throw new Error("No response received");
        } catch (err: any) {
          clearTimeout(timeoutId);
          if (err.name === "AbortError") throw new Error("Request timed out after 5 minutes. Please try again.");
          const isNetworkError = err.message === "Failed to fetch" || err.message === "Load failed" || err.message?.includes("NetworkError") || err.message?.includes("network");
          if (isNetworkError && attempt < 2) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
            return attemptSend(attempt + 1);
          }
          throw err;
        }
      };
      return attemptSend(1);
    },
    onSuccess: async (data: { reply: string; action?: any }) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      const threadId = activeThreadIdRef.current;
      if (threadId) {
        await saveMessageMutation.mutateAsync({ threadId, role: "assistant", content: data.reply });
        apiRequest("POST", `/api/chat/threads/${threadId}/auto-title`, {})
          .then(() => queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] }))
          .catch(() => {});
      }
      if (data.action) handleChatAction(data.action);
      setTimeout(() => processQueue(), 300);
    },
    onError: (err: any) => {
      let msg = "Failed to get a response. Please try again.";
      try {
        const raw = err?.message || "";
        if (raw.includes("timed out") || raw.includes("AbortError")) {
          msg = raw;
        } else if (raw === "Load failed" || raw === "Failed to fetch" || raw.includes("NetworkError")) {
          msg = "Connection lost — please check your signal and try again.";
        } else {
          const jsonStart = raw.indexOf("{");
          if (jsonStart >= 0) {
            const parsed = JSON.parse(raw.slice(jsonStart));
            if (parsed.message) msg = parsed.message;
          } else if (raw && !raw.startsWith("5")) {
            msg = raw;
          }
        }
      } catch {}
      const errorContent = `Sorry, I couldn't respond: ${msg}`;
      setMessages((prev) => [...prev, { role: "assistant", content: errorContent }]);
      const threadId = activeThreadIdRef.current;
      if (threadId) saveMessageMutation.mutate({ threadId, role: "assistant", content: errorContent });
      setTimeout(() => processQueue(), 500);
    },
  });

  const processQueue = useCallback(() => {
    if (messageQueueRef.current.length <= 0) return;
    messageQueueRef.current = [];
    setQueueLength(0);
    sendMutation.mutate(messagesRef.current);
  }, [sendMutation]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (initialThreadId && status?.connected) {
      loadThread(initialThreadId);
    }
  }, [status?.connected, initialThreadId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sendMutation.isPending]);

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      const res = await apiRequest("PUT", `/api/chat/threads/${activeThreadId}/messages/${messageId}`, { content });
      return res.json();
    },
    onSuccess: (_data, { messageId, content }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content } : m));
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("DELETE", `/api/chat/threads/${activeThreadId}/messages/${messageId}`);
      return res.json();
    },
    onSuccess: (_data, messageId) => {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    },
  });

  const handleEditMessage = useCallback((msgId: string, content: string) => {
    editMessageMutation.mutate({ messageId: msgId, content });
  }, [editMessageMutation]);

  const [pendingDeleteMsgId, setPendingDeleteMsgId] = useState<string | null>(null);

  const handleDeleteMessage = useCallback((msgId: string) => {
    setPendingDeleteMsgId(msgId);
  }, []);

  const confirmDeleteMessage = useCallback(() => {
    if (pendingDeleteMsgId) {
      deleteMessageMutation.mutate(pendingDeleteMsgId);
      setPendingDeleteMsgId(null);
    }
  }, [pendingDeleteMsgId, deleteMessageMutation]);

  const loadThread = async (threadId: string) => {
    setActiveThreadId(threadId);
    setSidebarOpen(false);
    setShowMarketingFiles(false);
    setHeaderSearchOpen(false);
    setHeaderSearchQuery("");
    try {
      const res = await fetch(`/api/chat/threads/${threadId}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const loaded: LocalMessage[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          userId: m.userId,
        }));
        setMessages(loaded);
      }
    } catch {
      setMessages([]);
    }
  };

  useEffect(() => {
    const previews = new Map<number, string>();
    attachedFiles.forEach((f, i) => {
      if (f.type.startsWith("image/")) {
        previews.set(i, URL.createObjectURL(f));
      }
    });
    setFilePreviews(previews);
    return () => { previews.forEach(url => URL.revokeObjectURL(url)); };
  }, [attachedFiles]);

  const uploadFiles = async (files: File[]): Promise<Array<{ url: string; name: string; size: number; type: string }>> => {
    if (files.length === 0) return [];
    const formData = new FormData();
    files.forEach(f => formData.append("files", f));
    const token = localStorage.getItem("bgp_auth_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/chat/upload", { method: "POST", body: formData, credentials: "include", headers });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    return data.files || data;
  };


  const unmountedRef = useRef(false);

  const sendVoiceNote = useCallback(async (audioBlob: Blob) => {
    const ext = audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm";
    const fileName = `voice-note-${Date.now()}.${ext}`;
    const formData = new FormData();
    formData.append("files", new File([audioBlob], fileName, { type: audioBlob.type }));

    try {
      setUploading(true);
      const res = await fetch("/api/chat/upload", { method: "POST", body: formData, headers: { ...getAuthHeaders() }, credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.files?.[0]) {
        toast({ title: "Voice note failed", description: "Could not upload recording", variant: "destructive" });
        return;
      }
      if (unmountedRef.current) return;
      const uploaded = data.files[0];
      const content = `🎤 Voice note\n[${fileName}](${uploaded.url})`;
      setMessages(prev => {
        const newMessages = [...prev, { role: "user" as const, content }];
        if (!activeThreadId) {
          createThreadMutation.mutateAsync({ firstMessage: content }).then(thread => {
            if (unmountedRef.current) return;
            saveMessageMutation.mutateAsync({ threadId: thread.id, role: "user", content });
            setActiveThreadId(thread.id);
            sendMutation.mutate(newMessages);
          });
        } else {
          saveMessageMutation.mutateAsync({ threadId: activeThreadId, role: "user", content });
          sendMutation.mutate(newMessages);
        }
        return newMessages;
      });
    } catch {
      toast({ title: "Voice note failed", description: "Network error", variant: "destructive" });
    } finally { setUploading(false); }
  }, [activeThreadId, toast, createThreadMutation, saveMessageMutation, sendMutation]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingDuration(0);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size > 1000 && !unmountedRef.current) {
          sendVoiceNote(audioBlob);
        }
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch {
      toast({ title: "Microphone access denied", description: "Please allow microphone access to send voice notes.", variant: "destructive" });
    }
  }, [sendVoiceNote, toast]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    const hasFiles = attachedFiles.length > 0;
    if ((!text && !hasFiles) || uploading) return;

    let uploadedAttachments: Array<{ url: string; name: string; size: number; type: string }> = [];
    if (hasFiles) {
      try {
        setUploading(true);
        uploadedAttachments = await uploadFiles(attachedFiles);
      } catch {
        toast({ title: "Upload failed", description: "Could not upload files. Please try again.", variant: "destructive" });
        setUploading(false);
        return;
      }
      setUploading(false);
      setAttachedFiles([]);
    }

    const fileText = uploadedAttachments.map(f => {
      if (f.type.startsWith("image/")) return `![${f.name}](${f.url})`;
      return `[${f.name}](${f.url})`;
    }).join("\n");
    const content = [text, fileText].filter(Boolean).join("\n\n") || "Shared files";

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    if (sendMutation.isPending) {
      messageQueueRef.current.push(content);
      setQueueLength(messageQueueRef.current.length);
      setMessages(prev => [...prev, { role: "user", content }]);
      const threadId = activeThreadIdRef.current;
      if (threadId) {
        saveMessageMutation.mutate({ threadId, role: "user", content });
      }
      return;
    }

    const newMessages: LocalMessage[] = [...messages, { role: "user", content }];
    setMessages(newMessages);

    if (!activeThreadId) {
      const thread = await createThreadMutation.mutateAsync({ firstMessage: content });
      await saveMessageMutation.mutateAsync({ threadId: thread.id, role: "user", content });
      setActiveThreadId(thread.id);
      sendMutation.mutate(newMessages);
    } else {
      await saveMessageMutation.mutateAsync({ threadId: activeThreadId, role: "user", content });
      sendMutation.mutate(newMessages);
    }
  };

  useEffect(() => {
    if (initialMessage && !initialMessageSentRef.current && status?.connected && !statusLoading) {
      initialMessageSentRef.current = true;
      const timer = setTimeout(() => handleSend(), 500);
      return () => clearTimeout(timer);
    }
  }, [initialMessage, status?.connected, statusLoading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const addPastedImages = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const normalized = files.map((f, i) => {
      if (f.name && f.name !== "image" && f.name !== "blob" && f.name.includes(".")) return f;
      const ext = f.type?.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return new File([f], `pasted-image-${Date.now()}-${i}.${ext}`, { type: f.type || "image/png" });
    });
    setAttachedFiles(prev => {
      const combined = [...prev, ...normalized];
      return combined.length > 20 ? combined.slice(0, 20) : combined;
    });
  }, []);

  const extractImagesFromClipboardEvent = useCallback((clipData: DataTransfer): File[] => {
    const imageFiles: File[] = [];
    const itemTypes: string[] = [];
    try {
      if (clipData.files && clipData.files.length > 0) {
        for (let i = 0; i < clipData.files.length; i++) {
          const f = clipData.files[i];
          if (f && f.type?.startsWith("image/") && f.size > 0) {
            imageFiles.push(f);
          }
        }
      }
    } catch (err) {
      console.error("[paste] extractImages files error:", err);
    }
    if (imageFiles.length > 0) return imageFiles;
    try {
      const items = clipData.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          itemTypes.push(`${items[i].kind}:${items[i].type}`);
          if (items[i].kind === "file" && items[i].type?.startsWith("image/")) {
            const f = items[i].getAsFile();
            if (f && f.size > 0) {
              imageFiles.push(f);
            }
          }
        }
      }
    } catch (err) {
      console.error("[paste] extractImages items error:", err);
    }
    if (imageFiles.length === 0 && itemTypes.length > 0) {
      console.warn("[paste] No images extracted. Clipboard items:", itemTypes.join(", "));
    }
    return imageFiles;
  }, []);

  const proxyExternalImage = useCallback(async (imageUrl: string): Promise<File | null> => {
    try {
      const token = localStorage.getItem("bgp_auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/proxy-image", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ url: imageUrl }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.url) return null;
      const proxyRes = await fetch(data.url, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!proxyRes.ok) return null;
      const blob = await proxyRes.blob();
      const ext = data.type?.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return new File([blob], data.name || `pasted-image-${Date.now()}.${ext}`, { type: data.type || "image/png" });
    } catch (err) {
      console.error("[paste] proxyExternalImage error:", err);
      return null;
    }
  }, []);

  const tryClipboardApiFallback = useCallback(async (): Promise<boolean> => {
    try {
      if (!navigator.clipboard?.read) return false;
      const clipItems = await navigator.clipboard.read();
      const imageFiles: File[] = [];
      for (const item of clipItems) {
        const imageType = item.types.find(t => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split("/")[1]?.replace("jpeg", "jpg") || "png";
          imageFiles.push(new File([blob], `pasted-image-${Date.now()}.${ext}`, { type: imageType }));
        }
      }
      if (imageFiles.length > 0) {
        addPastedImages(imageFiles);
        return true;
      }
    } catch (err) {
      console.error("[paste] clipboard API fallback error:", err);
    }
    return false;
  }, [addPastedImages]);

  const pasteHandledRef = useRef(false);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const clipData = e.clipboardData;
    if (!clipData) return;

    const imageFiles = extractImagesFromClipboardEvent(clipData);

    if (imageFiles.length > 0) {
      e.preventDefault();
      pasteHandledRef.current = true;
      setTimeout(() => { pasteHandledRef.current = false; }, 100);
      addPastedImages(imageFiles);
      return;
    }

    const html = clipData.getData("text/html");
    if (html && /<img\s/i.test(html)) {
      e.preventDefault();
      pasteHandledRef.current = true;
      setTimeout(() => { pasteHandledRef.current = false; }, 100);
      const imgMatch = html.match(/src=["']([^"']+)["']/i);
      if (!imgMatch?.[1]) {
        tryClipboardApiFallback().then(ok => {
          if (!ok) toast({ title: "Could not paste image", description: "Try saving the image and uploading it instead.", variant: "destructive" });
        });
        return;
      }
      const imgSrc = imgMatch[1];
      if (imgSrc.startsWith("data:") || imgSrc.startsWith("blob:")) {
        fetch(imgSrc)
          .then(r => r.blob())
          .then(blob => {
            const ext = blob.type?.split("/")[1]?.replace("jpeg", "jpg") || "png";
            addPastedImages([new File([blob], `pasted-image-${Date.now()}.${ext}`, { type: blob.type || "image/png" })]);
          })
          .catch(() => {
            tryClipboardApiFallback().then(ok => {
              if (!ok) toast({ title: "Could not paste image", description: "Try saving the image and uploading it instead.", variant: "destructive" });
            });
          });
      } else if (imgSrc.startsWith("http://") || imgSrc.startsWith("https://")) {
        (async () => {
          try {
            let blob: Blob | null = null;
            try {
              const directRes = await fetch(imgSrc, { mode: "cors" });
              if (directRes.ok) blob = await directRes.blob();
            } catch (_corsErr) { /* CORS expected — fall through to proxy */ }
            if (blob && blob.type?.startsWith("image/")) {
              const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
              addPastedImages([new File([blob], `pasted-image-${Date.now()}.${ext}`, { type: blob.type })]);
              return;
            }
            const proxied = await proxyExternalImage(imgSrc);
            if (proxied) {
              addPastedImages([proxied]);
              return;
            }
            const clipOk = await tryClipboardApiFallback();
            if (!clipOk) toast({ title: "Could not paste image", description: "Try saving the image and uploading it instead.", variant: "destructive" });
          } catch (err) {
            console.error("[paste] external image error:", err);
            const clipOk2 = await tryClipboardApiFallback();
            if (!clipOk2) toast({ title: "Could not paste image", description: "Try saving the image and uploading it instead.", variant: "destructive" });
          }
        })();
      } else {
        tryClipboardApiFallback().then(ok => {
          if (!ok) toast({ title: "Could not paste image", description: "Try saving the image and uploading it instead.", variant: "destructive" });
        });
      }
      return;
    }

    const hasImageItem = Array.from(clipData.items || []).some(
      item => item.type?.startsWith("image/")
    );
    if (hasImageItem) {
      e.preventDefault();
      pasteHandledRef.current = true;
      setTimeout(() => { pasteHandledRef.current = false; }, 100);
      tryClipboardApiFallback().then(ok => {
        if (!ok) toast({ title: "Could not paste image", description: "Try saving the image and uploading it instead.", variant: "destructive" });
      });
    }
  }, [extractImagesFromClipboardEvent, addPastedImages, tryClipboardApiFallback, proxyExternalImage, toast]);

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (pasteHandledRef.current) return;
      const clipData = e.clipboardData;
      if (!clipData) return;
      const imageFiles = extractImagesFromClipboardEvent(clipData);
      if (imageFiles.length > 0) {
        e.preventDefault();
        addPastedImages(imageFiles);
        textareaRef.current?.focus();
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [extractImagesFromClipboardEvent, addPastedImages]);

  const handleActionClick = async (actionText: string) => {
    const lines = actionText.split("\n\n").map(l => l.trim()).filter(Boolean);
    setCompletedActions(prev => {
      const next = new Set(prev);
      lines.forEach(l => next.add(l));
      return next;
    });
    setInput("");

    if (sendMutation.isPending) {
      messageQueueRef.current.push(actionText);
      setQueueLength(messageQueueRef.current.length);
      setMessages(prev => [...prev, { role: "user", content: actionText }]);
      const threadId = activeThreadIdRef.current;
      if (threadId) {
        saveMessageMutation.mutate({ threadId, role: "user", content: actionText });
      }
      return;
    }

    const newMessages: LocalMessage[] = [...messages, { role: "user", content: actionText }];
    setMessages(newMessages);
    if (!activeThreadId) {
      const thread = await createThreadMutation.mutateAsync({ firstMessage: actionText });
      await saveMessageMutation.mutateAsync({ threadId: thread.id, role: "user", content: actionText });
      setActiveThreadId(thread.id);
      sendMutation.mutate(newMessages);
    } else {
      await saveMessageMutation.mutateAsync({ threadId: activeThreadId, role: "user", content: actionText });
      sendMutation.mutate(newMessages);
    }
  };

  const handleNewChat = () => {
    setActiveThreadId(null);
    setActiveProjectView(null);
    setMessages([]);
    setInput("");
    setSidebarOpen(false);
    setInfoPanelOpen(false);
    setShowMarketingFiles(false);
    setHeaderSearchOpen(false);
    setHeaderSearchQuery("");
    messageQueueRef.current = [];
    setQueueLength(0);
  };

  const handleSuggestion = async (text: string) => {
    const newMessages: LocalMessage[] = [{ role: "user", content: text }];
    setMessages(newMessages);
    const thread = await createThreadMutation.mutateAsync({ firstMessage: text });
    await saveMessageMutation.mutateAsync({ threadId: thread.id, role: "user", content: text });
    setActiveThreadId(thread.id);
    sendMutation.mutate(newMessages);
  };

  const handleCreatePropertyChat = async (data: { linkedType: string; linkedId: string; linkedName: string }) => {
    const existing = aiThreads.find(
      (t) => t.linkedType === data.linkedType && t.linkedId === data.linkedId
    );
    if (existing) {
      setActiveThreadId(existing.id);
      setShowMarketingFiles(false);
      const res = await fetch(`/api/chat/threads/${existing.id}/messages`, { credentials: "include" });
      if (res.ok) {
        const msgs = await res.json();
        setMessages(msgs);
      }
      setSidebarOpen(false);
      return;
    }
    const thread = await createThreadMutation.mutateAsync({
      firstMessage: `New conversation about ${data.linkedName}`,
      linkedType: data.linkedType,
      linkedId: data.linkedId,
      linkedName: data.linkedName,
    });
    setActiveThreadId(thread.id);
    setMessages([]);
    setSidebarOpen(false);
    setShowMarketingFiles(false);
  };

  const handleRenameThread = (threadId: string) => {
    const thread = aiThreads.find((t) => t.id === threadId);
    if (thread) {
      setEditingTitle(threadId);
      setEditTitleValue(thread.title || "");
    }
  };

  const handleSaveRename = () => {
    if (editingTitle && editTitleValue.trim()) {
      updateThreadMutation.mutate({ id: editingTitle, updates: { title: editTitleValue.trim() } });
    }
    setEditingTitle(null);
  };

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Not Connected</h3>
        <p className="text-muted-foreground max-w-sm">
          AI service is not configured. Please contact your administrator to enable ChatBGP.
        </p>
      </div>
    );
  }

  const isHome = !activeThreadId && messages.length === 0 && !showMarketingFiles && !headerSearchOpen;

  const getMarketingFileIcon = (mimeType: string | null) => {
    if (mimeType?.startsWith("image/")) return <Image className="w-8 h-8 text-purple-500" />;
    if (mimeType?.includes("pdf")) return <FileText className="w-8 h-8 text-red-500" />;
    if (mimeType?.includes("word") || mimeType?.includes("document")) return <FileText className="w-8 h-8 text-blue-500" />;
    if (mimeType?.includes("excel") || mimeType?.includes("spreadsheet")) return <FileSpreadsheet className="w-8 h-8 text-green-500" />;
    return <File className="w-8 h-8 text-gray-400" />;
  };


  const handleShareFile = async (file: MarketingFileRow) => {
    const fileUrl = `${window.location.origin}${file.filePath}?view=1`;
    if (navigator.share) {
      try {
        await navigator.share({ title: file.fileName, url: fileUrl });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(fileUrl);
      toast({ title: "Link copied", description: "File link copied to clipboard" });
    } catch {
      toast({ title: "Unable to copy", description: "Please copy the link manually", variant: "destructive" });
    }
  };

  return (
    <div className="flex h-full w-full max-w-full overflow-hidden relative" data-testid="chatbgp-page">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <div
        className={`
          fixed z-50 top-0 left-0 h-full w-[85vw] max-w-[320px] bg-background flex flex-col transition-transform duration-300 ease-out overflow-hidden
          lg:static lg:z-auto lg:translate-x-0 lg:w-[280px] lg:max-w-none lg:shrink-0 lg:border-r lg:transition-none
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        data-testid="chat-sidebar"
      >
        <div className="px-4 pt-5 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search"
                className="pl-9 h-10 text-[15px] rounded-xl bg-muted/60 border-0 focus-visible:ring-1"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                autoComplete="off"
                autoCorrect="off"
                data-testid="input-search-threads"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl"
              onClick={handleNewChat}
              title="New chat"
              data-testid="button-new-chat-sidebar"
            >
              <MessageSquare className="w-[18px] h-[18px]" />
            </Button>
          </div>
        </div>

        <div className="px-2 py-1 shrink-0 overflow-hidden">
          <button
            className="w-full flex items-center gap-3.5 px-3 py-3 rounded-xl text-[15px] font-medium hover:bg-muted/60 transition-colors"
            onClick={handleNewChat}
            data-testid="button-chatbgp-home"
          >
            <Sparkles className="w-5 h-5 shrink-0" />
            <span className="truncate">Chat BGP</span>
          </button>

          <button
            className="w-full flex items-center gap-3.5 px-3 py-3 rounded-xl text-[15px] font-medium hover:bg-muted/60 transition-colors"
            onClick={() => { setSidebarOpen(false); setShowMarketingFiles(true); setActiveThreadId(null); setMessages([]); }}
            data-testid="button-marketing-details"
          >
            <FileText className="w-5 h-5 shrink-0" />
            <span className="truncate">Marketing Details</span>
          </button>

          <button
            className="w-full flex items-center gap-3.5 px-3 py-3 rounded-xl text-[15px] font-medium hover:bg-muted/60 transition-colors"
            onClick={() => { setSidebarOpen(false); setNewPropertyOpen(true); }}
            data-testid="button-new-property"
          >
            <Building2 className="w-5 h-5 shrink-0" />
            <span className="truncate">New Property</span>
          </button>
        </div>

        <div className="h-px bg-border mx-4 my-1 shrink-0" />

        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          <div className="px-2 py-1">
            {threadsLoading ? (
              <div className="space-y-2 px-3 py-2">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 rounded-xl" />)}
              </div>
            ) : (projectItems.length === 0 && threadGroups.length === 0) ? (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">{searchQuery ? "No matching chats" : "No conversations yet"}</p>
              </div>
            ) : (
              <>
                {projectItems.length > 0 && (
                  <div className="mb-2">
                    {projectItems.map((project) => (
                      <ProjectRow
                        key={`${project.type}-${project.id}`}
                        project={project}
                        activeThreadId={activeThreadId}
                        onLoadThread={loadThread}
                        onRename={handleRenameThread}
                        onDelete={(id) => deleteThreadMutation.mutate(id)}
                        editingTitle={editingTitle}
                        editTitleValue={editTitleValue}
                        setEditTitleValue={setEditTitleValue}
                        onSaveRename={handleSaveRename}
                        onCancelRename={() => setEditingTitle(null)}
                        onOpenProject={(p) => {
                          setActiveProjectView(p);
                          setActiveThreadId(null);
                          setMessages([]);
                          setSidebarOpen(false);
                        }}
                        activeProjectId={activeProjectView?.id || null}
                      />
                    ))}
                  </div>
                )}

                {threadGroups.length > 0 && (
                  <>
                    {projectItems.length > 0 && <div className="h-px bg-border mx-3 my-2" />}
                    {threadGroups.map((group) => (
                      <div key={group.label} className="mb-1">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">
                          {group.label}
                        </p>
                        {group.threads.map((thread) => (
                          <ThreadRow
                            key={thread.id}
                            thread={thread}
                            active={activeThreadId === thread.id}
                            onLoad={() => loadThread(thread.id)}
                            onRename={() => handleRenameThread(thread.id)}
                            onDelete={() => deleteThreadMutation.mutate(thread.id)}
                            editingTitle={editingTitle}
                            editTitleValue={editTitleValue}
                            setEditTitleValue={setEditTitleValue}
                            onSaveRename={handleSaveRename}
                            onCancelRename={() => setEditingTitle(null)}
                          />
                        ))}
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <div className="flex items-center gap-2.5 px-3 py-2.5 border-b shrink-0">
          {headerSearchOpen ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl shrink-0"
                onClick={() => { setHeaderSearchOpen(false); setHeaderSearchQuery(""); }}
                data-testid="button-close-search"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  ref={headerSearchRef}
                  value={headerSearchQuery}
                  onChange={(e) => setHeaderSearchQuery(e.target.value)}
                  placeholder="Search chats..."
                  className="pl-9 h-9 rounded-xl bg-muted/50 border-0 text-sm"
                  autoFocus
                  data-testid="input-header-search"
                />
                {headerSearchQuery && (
                  <button
                    onClick={() => setHeaderSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </>
          ) : activeProjectView ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl shrink-0 lg:hidden"
                onClick={() => setSidebarOpen(true)}
                data-testid="button-open-sidebar"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <span className="text-[15px] font-semibold truncate" data-testid="text-project-header-name">
                  {activeProjectView.name}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl shrink-0"
                onClick={() => setInfoPanelOpen(!infoPanelOpen)}
                title="Project details"
                data-testid="button-toggle-project-panel"
              >
                <BookOpen className="w-5 h-5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl shrink-0" data-testid="button-project-menu">
                    <MoreVertical className="w-5 h-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate(`/properties?id=${activeProjectView.id}`)} data-testid="menu-edit-property">
                    <Pencil className="w-4 h-4 mr-2" />
                    Edit Property
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setHeaderSearchOpen(true); setTimeout(() => headerSearchRef.current?.focus(), 100); }} data-testid="menu-search">
                    <Search className="w-4 h-4 mr-2" />
                    Search Chats
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl shrink-0"
                onClick={() => {
                  if (activeProjectView) {
                    handleCreatePropertyChat({ linkedType: "property", linkedId: activeProjectView.id, linkedName: activeProjectView.name });
                  }
                }}
                title="New chat in project"
                data-testid="button-new-project-chat"
              >
                <Plus className="w-5 h-5" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl shrink-0 lg:hidden"
                onClick={() => setSidebarOpen(true)}
                data-testid="button-open-sidebar"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-background" />
                </div>
                {activeThread ? (
                  <button
                    className="text-left min-w-0"
                    onClick={() => setInfoPanelOpen(!infoPanelOpen)}
                    data-testid="text-thread-title"
                  >
                    <span className="text-[15px] font-semibold truncate block">
                      {activeThread.title || "ChatBGP"}
                    </span>
                  </button>
                ) : (
                  <span className="text-[15px] font-semibold" data-testid="text-page-title">ChatBGP</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl shrink-0"
                onClick={() => { setHeaderSearchOpen(true); setTimeout(() => headerSearchRef.current?.focus(), 100); }}
                title="Search chats"
                data-testid="button-search-chats"
              >
                <Search className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl shrink-0"
                onClick={handleNewChat}
                title="New chat"
                data-testid="button-new-chat"
              >
                <Plus className="w-5 h-5" />
              </Button>
            </>
          )}
        </div>

        <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
          {activeProjectView && !headerSearchOpen ? (
            <>
              <PropertyProjectView
                project={activeProjectView}
                onStartChat={async (msg) => {
                  await handleCreatePropertyChat({ linkedType: "property", linkedId: activeProjectView.id, linkedName: activeProjectView.name });
                  const newMessages: LocalMessage[] = [{ role: "user", content: msg }];
                  setMessages(newMessages);
                  const thread = aiThreads.find(t => t.linkedType === "property" && t.linkedId === activeProjectView.id);
                  if (thread) {
                    await saveMessageMutation.mutateAsync({ threadId: thread.id, role: "user", content: msg });
                    sendMutation.mutate(newMessages);
                  }
                }}
                onLoadThread={(id) => {
                  loadThread(id);
                }}
                onNewChat={() => {
                  handleCreatePropertyChat({ linkedType: "property", linkedId: activeProjectView.id, linkedName: activeProjectView.name });
                }}
                properties={properties}
              />
              <div className={`shrink-0 ${infoPanelOpen ? "block" : "hidden lg:block"}`}>
                <ProjectRightPanel
                  project={activeProjectView}
                  onClose={() => setInfoPanelOpen(false)}
                  onAddMember={(userId) => {}}
                  members={bgpUsers.filter((u: any) => {
                    const agents = properties.find((p: any) => p.id === activeProjectView.id)?.agents || [];
                    return agents.some((a: any) => a.userId === u.id || a.id === u.id);
                  })}
                  users={bgpUsers}
                  onNavigate={(path) => navigate(path)}
                  onSelectThread={(threadId) => {
                    loadThread(threadId);
                    setActiveProjectView(null);
                  }}
                />
              </div>
            </>
          ) : (
          <>
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
              {headerSearchOpen ? (
                <div className="p-4 space-y-1 max-w-3xl mx-auto" data-testid="header-search-results">
                  {!headerSearchQuery.trim() ? (
                    <div className="text-center py-16">
                      <Search className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">Search your conversations</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Find chats by name or message content</p>
                    </div>
                  ) : headerSearchResults.length === 0 ? (
                    <div className="text-center py-16">
                      <Search className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No results for "{headerSearchQuery}"</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Try a different search term</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
                        {headerSearchResults.length} result{headerSearchResults.length !== 1 ? "s" : ""}
                      </p>
                      {headerSearchResults.map((t: any) => (
                        <button
                          key={t.id}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-muted/60 transition-colors text-left"
                          onClick={() => { loadThread(t.id); setHeaderSearchOpen(false); setHeaderSearchQuery(""); }}
                          data-testid={`search-result-${t.id}`}
                        >
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                            {t.isAiChat ? (
                              <Sparkles className="w-4 h-4 text-muted-foreground" />
                            ) : t.linkedType === "property" ? (
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                            ) : t.linkedType ? (
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <MessageSquare className="w-4 h-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{t.title || "Untitled"}</p>
                            {t.lastMessage?.content && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">{t.lastMessage.content}</p>
                            )}
                            {t.linkedName && (
                              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{t.linkedName}</p>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ) : showMarketingFiles ? (
                <div className="p-4 space-y-4 max-w-3xl mx-auto" data-testid="marketing-files-view">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowMarketingFiles(false)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors shrink-0"
                      data-testid="button-back-from-marketing"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-bold tracking-tight">Marketing Details</h2>
                      <p className="text-xs text-muted-foreground">{allMarketingFiles.length} file{allMarketingFiles.length !== 1 ? "s" : ""} across all properties</p>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search files, units, properties..."
                      value={marketingSearch}
                      onChange={e => setMarketingSearch(e.target.value)}
                      className="pl-9 h-10 rounded-xl"
                      data-testid="input-search-marketing"
                    />
                    {marketingSearch && (
                      <button onClick={() => setMarketingSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>

                  {marketingLoading ? (
                    <div className="grid grid-cols-2 gap-3">
                      {[1, 2, 3, 4].map(i => (
                        <Skeleton key={i} className="h-36 rounded-xl" />
                      ))}
                    </div>
                  ) : filteredMarketingFiles.length === 0 ? (
                    <div className="text-center py-16">
                      <FolderOpen className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {marketingSearch ? "No files match your search" : "No marketing files yet"}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {marketingSearch ? "Try a different search term" : "Upload brochures from the Available Units board"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {groupedMarketingFiles.map(group => (
                        <div key={group.propertyName}>
                          <div className="flex items-center gap-2 mb-3">
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.propertyName}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {group.files.map(f => {
                              const isImage = f.mimeType?.startsWith("image/");
                              const isPdf = f.mimeType?.includes("pdf");
                              return (
                              <div
                                key={f.id}
                                className="rounded-xl border bg-card overflow-hidden hover:shadow-md transition-all cursor-pointer group"
                                onClick={() => window.open(`${f.filePath}?view=1`, "_blank")}
                                data-testid={`marketing-tile-${f.id}`}
                              >
                                <div className="relative w-full aspect-[4/3] bg-muted/30 overflow-hidden">
                                  {isImage ? (
                                    <img
                                      src={`${f.filePath}?view=1`}
                                      alt={f.fileName}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : isPdf ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center bg-red-50 dark:bg-red-950/20">
                                      <FileText className="w-10 h-10 text-red-500 mb-1" />
                                      <span className="text-[10px] font-bold text-red-500 uppercase">PDF</span>
                                    </div>
                                  ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center bg-muted/50">
                                      {getMarketingFileIcon(f.mimeType)}
                                      <span className="text-[10px] font-medium text-muted-foreground mt-1 uppercase">
                                        {f.fileName.split('.').pop()}
                                      </span>
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <div className="bg-white/90 dark:bg-black/70 rounded-full p-2">
                                      <Eye className="w-4 h-4" />
                                    </div>
                                  </div>
                                </div>
                                <div className="p-3">
                                  <p className="text-xs font-medium leading-snug line-clamp-2 mb-1">{f.fileName}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {f.unitName && <span>{f.unitName} · </span>}
                                    {formatFileSize(f.fileSize)}
                                  </p>
                                  <div className="flex gap-1.5 mt-2">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleShareFile(f); }}
                                      className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg bg-muted/60 hover:bg-muted transition-colors text-xs font-medium"
                                      title="Share"
                                      data-testid={`button-share-tile-${f.id}`}
                                    >
                                      <Share2 className="w-3 h-3" />
                                      Share
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); window.open(f.filePath, "_blank"); }}
                                      className="h-8 w-8 flex items-center justify-center rounded-lg bg-muted/60 hover:bg-muted transition-colors shrink-0"
                                      title="Download"
                                      data-testid={`button-download-tile-${f.id}`}
                                    >
                                      <Download className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : isHome ? (
                <div className="flex flex-col h-full">
                  <div className="flex-1 flex flex-col items-center px-4 pt-[10vh] pb-6">
                    <h2 className="text-2xl font-semibold mb-1.5 text-center" data-testid="text-home-title">Ask ChatBGP</h2>
                    <p className="text-muted-foreground text-center mb-6 text-sm max-w-md">
                      ChatBGP will search your CRM, deals, and property data to find exactly what you need.
                    </p>

                    <div className="w-full max-w-xl mb-6">
                      {attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2 px-1">
                          {attachedFiles.map((f, i) => (
                            <div key={i} className="relative group rounded-lg border bg-muted/30 p-1.5 flex items-center gap-2 max-w-[200px]">
                              {filePreviews.has(i) ? (
                                <img src={filePreviews.get(i)} alt={f.name} className="w-10 h-10 rounded object-cover" />
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                  <File className="w-5 h-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{f.name}</p>
                                <p className="text-[10px] text-muted-foreground">{formatFileSize(f.size)}</p>
                              </div>
                              <button
                                onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                data-testid={`button-remove-file-home-${i}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="relative rounded-2xl border bg-card shadow-sm overflow-hidden">
                        <Textarea
                          ref={textareaRef}
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onPaste={handlePaste}
                          placeholder="Reply..."
                          className="w-full resize-none min-h-[80px] max-h-[160px] border-0 px-4 pt-4 pb-12 text-[16px] focus-visible:ring-0 bg-transparent"
                          rows={2}
                          data-testid="input-chat-message-home"
                        />
                        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <label
                              htmlFor="chatbgp-file-upload"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                              title="Attach files"
                              data-testid="button-attach-files-home"
                            >
                              <Paperclip className="w-4 h-4" />
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            {isRecording ? (
                              <button
                                onClick={stopRecording}
                                className="p-1.5 rounded-lg bg-red-500 text-white animate-pulse transition-colors"
                                data-testid="button-stop-recording-home"
                              >
                                <Square className="w-4 h-4" />
                              </button>
                            ) : (!input.trim() && attachedFiles.length === 0) ? (
                              <button
                                onClick={startRecording}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                disabled={uploading}
                                data-testid="button-voice-record-home"
                              >
                                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                              </button>
                            ) : (
                              <button
                                onClick={handleSend}
                                disabled={uploading}
                                className="p-1.5 rounded-lg bg-foreground text-background transition-colors"
                                data-testid="button-send-home"
                              >
                                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 w-full max-w-xl">
                      {SUGGESTIONS.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => handleSuggestion(s.title)}
                          className="text-left px-4 py-3 rounded-xl border bg-card hover:bg-accent transition-colors"
                          data-testid={`button-suggestion-${i}`}
                        >
                          <p className="text-[13px] font-medium text-foreground leading-snug">{s.title}</p>
                        </button>
                      ))}
                    </div>

                    <div className="w-full max-w-xl mt-8">
                      <div className="flex items-center gap-4 border-b mb-3">
                        <button className="text-sm font-medium pb-2 border-b-2 border-foreground" data-testid="tab-your-chats">
                          Your chats
                        </button>
                      </div>
                      <div className="text-center py-4">
                        {threadsLoading ? (
                          <div className="space-y-2">
                            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-xl" />)}
                          </div>
                        ) : aiThreads.length === 0 ? (
                          <div className="py-6">
                            <p className="text-sm text-muted-foreground">Start a chat to keep conversations organised and re-use project knowledge.</p>
                          </div>
                        ) : (
                          <div className="space-y-0.5 text-left">
                            {aiThreads.slice(0, 8).map((thread) => (
                              <button
                                key={thread.id}
                                onClick={() => loadThread(thread.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/60 transition-colors text-left"
                                data-testid={`home-thread-${thread.id}`}
                              >
                                <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{thread.title || "Untitled"}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {new Date(thread.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                  </p>
                                </div>
                              </button>
                            ))}
                            {aiThreads.length > 8 && (
                              <button
                                onClick={() => setSidebarOpen(true)}
                                className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                data-testid="button-view-all-chats"
                              >
                                View all {aiThreads.length} conversations
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5 max-w-3xl mx-auto p-4">
                  {messages.map((msg, i) => (
                    <MessageBubble
                      key={msg.id || i}
                      message={msg}
                      isOwn={msg.role === "user" && (!msg.userId || msg.userId === currentUser?.id)}
                      onEdit={handleEditMessage}
                      onDelete={handleDeleteMessage}
                      onActionClick={handleActionClick}
                      completedActions={completedActions}
                    />
                  ))}
                  {sendMutation.isPending && (
                    <div className="flex gap-3" data-testid="loading-response">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="pt-2">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                          {queueLength > 0 && (
                            <span className="text-[11px] text-muted-foreground ml-1" data-testid="text-queue-count">
                              +{queueLength} queued
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              id="chatbgp-file-upload"
              type="file"
              multiple
              accept="*/*"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                if (e.target.files) {
                  setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                }
                e.target.value = "";
              }}
              data-testid="input-file-upload"
            />

            {!showMarketingFiles && !headerSearchOpen && !isHome && (
            <div className="border-t px-3 py-2.5 shrink-0 bg-background pb-[max(0.625rem,env(safe-area-inset-bottom))]">
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 max-w-3xl mx-auto mb-2 px-1">
                  {attachedFiles.map((f, i) => (
                    <div key={i} className="relative group rounded-lg border bg-muted/30 p-1.5 flex items-center gap-2 max-w-[200px]">
                      {filePreviews.has(i) ? (
                        <img src={filePreviews.get(i)} alt={f.name} className="w-10 h-10 rounded object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                          <File className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{f.name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatFileSize(f.size)}</p>
                      </div>
                      <button
                        onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        data-testid={`button-remove-file-${i}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {isRecording && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950 rounded-lg max-w-3xl mx-auto mb-1">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">Recording {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}</span>
                </div>
              )}
              <div className="flex items-end gap-2 max-w-3xl mx-auto">
                <div className="flex items-center gap-1 shrink-0 pb-1">
                  <label
                    htmlFor="chatbgp-file-upload"
                    className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    title="Attach files"
                    data-testid="button-attach-files"
                  >
                    <Paperclip className="w-5 h-5" />
                  </label>
                  <button
                    className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    onClick={() => setNewPropertyOpen(true)}
                    title="New property chat"
                    data-testid="button-new-property-chat"
                  >
                    <Building2 className="w-5 h-5" />
                  </button>
                </div>
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Ask ChatBGP..."
                  className="flex-1 resize-none min-h-[44px] max-h-[120px] rounded-2xl bg-muted/50 border-0 px-4 py-3 text-[16px] focus-visible:ring-1 transition-colors"
                  rows={1}
                  data-testid="input-chat-message"
                />
                {isRecording ? (
                  <button
                    onClick={stopRecording}
                    className="p-2.5 rounded-full shrink-0 mb-0.5 bg-red-500 text-white animate-pulse transition-colors"
                    data-testid="button-stop-recording"
                  >
                    <Square className="w-5 h-5" />
                  </button>
                ) : (!input.trim() && attachedFiles.length === 0) ? (
                  <button
                    onClick={startRecording}
                    className="p-2.5 rounded-full shrink-0 mb-0.5 bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    disabled={uploading}
                    data-testid="button-voice-record"
                  >
                    {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={uploading}
                    className="p-2.5 rounded-full shrink-0 mb-0.5 bg-foreground text-background transition-colors"
                    data-testid="button-send-message"
                  >
                    {uploading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </button>
                )}
              </div>
            </div>
            )}
          </div>

          {((isPropertyThread && !headerSearchOpen && !showMarketingFiles) || infoPanelOpen) && activeThread && (
            <ThreadInfoPanel
              thread={activeThread}
              onClose={() => setInfoPanelOpen(false)}
              onAddMember={(userId) => addMemberMutation.mutate({ threadId: activeThread.id, userId })}
              members={threadMembers}
              users={bgpUsers}
              onNavigate={(path) => navigate(path)}
              isPropertyThread={isPropertyThread}
            />
          )}
          </>
          )}
        </div>
      </div>

      <NewPropertyDialog
        open={newPropertyOpen}
        onOpenChange={setNewPropertyOpen}
        properties={properties}
        deals={deals}
        onSubmit={handleCreatePropertyChat}
      />

      <AlertDialog open={!!pendingDeleteMsgId} onOpenChange={(open) => { if (!open) setPendingDeleteMsgId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message</AlertDialogTitle>
            <AlertDialogDescription>This message will be permanently removed from the conversation.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteMessage} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
