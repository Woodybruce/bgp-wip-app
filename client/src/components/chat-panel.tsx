import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTypingIndicator } from "@/hooks/use-socket";
import { emitMarkSeen } from "@/lib/socket";
import { ChatBGPMarkdown, AuthDownloadLink } from "@/components/chatbgp-markdown";
import {
  Sparkles,
  Send,
  AlertCircle,
  Trash2,
  Bot,
  User,
  X,
  BarChart3,
  FileText,
  Copy,
  ChevronDown,
  ChevronUp,
  Paperclip,
  File as FileIcon,
  UserPlus,
  ArrowLeft,
  Users,
  Check,
  Building2,
  Link as LinkIcon,
  Maximize2,
  Search,
  Pencil,
  MoreVertical,
  MessageCircle,
  CheckCheck,
  Image as ImageIcon,
  Handshake,
  Mic,
  Square,
  MessageSquare,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { User as UserType } from "@shared/schema";
import { TagChip, TAG_TOKEN_SOURCE, TAG_META, buildTagToken, type TagType } from "@/components/chat-tags";
import { useChatBGPState } from "@/contexts/chatbgp-context";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type ChatAction = {
  type: "model_run";
  runId: string;
  name: string;
  outputs: Record<string, string>;
  outputMapping: Record<string, { label: string; format: string; group: string }>;
} | {
  type: "document_generate";
  templateName: string;
  content: string;
  fieldsUsed: number;
  totalFields: number;
} | {
  type: "show_image";
  imageDataUrl?: string;
  imageUrl?: string;
  prompt: string;
} | {
  type: "navigate";
  path: string;
} | {
  type: "crm_created" | "crm_updated" | "crm_deleted";
  entityType?: string;
  id?: string;
  name?: string;
} | {
  type: "email_sent";
  to?: string;
} | {
  type: "change_request";
};

type LocalChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  action?: ChatAction;
  attachments?: string[];
  userName?: string;
  userId?: string | null;
};

type ThreadMember = { id: string; name: string; seen: boolean };

type ThreadData = {
  id: string;
  title: string | null;
  createdBy: string;
  creatorName: string;
  propertyId: string | null;
  propertyName: string | null;
  linkedType: string | null;
  linkedId: string | null;
  linkedName: string | null;
  isAiChat: boolean;
  hasAiMember?: boolean;
  groupPicUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  members: ThreadMember[];
  lastMessage?: {
    content: string;
    senderName: string;
    createdAt: string;
  } | null;
  messages?: Array<{
    id: string;
    threadId: string;
    role: string;
    content: string;
    userId: string | null;
    actionData: string | null;
    attachments: string[] | null;
    createdAt: string;
  }>;
};

const AI_SUGGESTIONS = [
  "Show me live deals",
  "What's in my calendar today?",
  "Draft HOTs for a property",
  "Search CRM contacts",
];

// Client logins get landlord-voiced prompts — no BGP calendar, no CRM jargon.
const CLIENT_AI_SUGGESTIONS = [
  "Which of my leases expire in the next 12 months?",
  "What's happening on my vacant units?",
  "Create a targeting brief for one of my units",
  "What's the latest news on brands we're targeting?",
];

const NAME_COLORS = [
  "text-rose-600", "text-blue-600", "text-emerald-600", "text-purple-600",
  "text-orange-600", "text-teal-600", "text-pink-600", "text-indigo-600",
];

function getNameColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

function formatTimeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"].includes(ext);
}

function isAudioFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return ["webm", "ogg", "mp3", "m4a", "wav", "aac", "mp4"].includes(ext);
}

const ACCEPTED_EXTENSIONS = [".docx", ".pdf", ".doc", ".txt", ".xlsx", ".xls", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic", ".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".mov", ".avi", ".mkv", ".flac", ".eml", ".msg"];

function isEmailFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return ["eml", "msg"].includes(ext);
}

function ActionCard({ action }: { action: ChatAction }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  if (action.type === "model_run") {
    const outputEntries = Object.entries(action.outputs);
    return (
      <div className="mt-2 rounded-lg border bg-card p-3 text-xs">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-3.5 h-3.5 text-primary" />
          <span className="font-semibold">Model Run: {action.name}</span>
        </div>
        <div className="grid grid-cols-1 gap-1">
          {outputEntries.slice(0, expanded ? undefined : 6).map(([key, val]) => {
            const mapping = action.outputMapping[key];
            return (
              <div key={key} className="flex justify-between gap-2 py-0.5">
                <span className="text-muted-foreground truncate">{mapping?.label || key}</span>
                <span className="font-medium shrink-0">{val}</span>
              </div>
            );
          })}
        </div>
        {outputEntries.length > 6 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-primary text-[10px] mt-1 hover:underline"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Show less" : `+${outputEntries.length - 6} more`}
          </button>
        )}
      </div>
    );
  }

  if (action.type === "document_generate") {
    return (
      <div className="mt-2 rounded-lg border bg-card p-3 text-xs">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-primary" />
            <span className="font-semibold">{action.templateName}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => {
              navigator.clipboard.writeText(action.content);
              toast({ title: "Copied to clipboard" });
            }}
            data-testid="button-copy-chat-document"
          >
            <Copy className="w-3 h-3 mr-1" />
            Copy
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground mb-1">
          {action.fieldsUsed}/{action.totalFields} fields filled
        </div>
        <div
          className={`whitespace-pre-wrap text-muted-foreground leading-relaxed ${
            expanded ? "" : "max-h-[120px] overflow-hidden"
          }`}
        >
          {action.content}
        </div>
        {action.content.length > 300 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-primary text-[10px] mt-1 hover:underline"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Show less" : "Show full document"}
          </button>
        )}
      </div>
    );
  }

  if (action.type === "show_image") {
    const imgSrc = action.imageUrl || action.imageDataUrl || "";
    return (
      <div className="mt-2 rounded-lg border bg-card p-2">
        <img
          src={imgSrc}
          alt={action.prompt}
          className="rounded-md max-w-full max-h-[300px] object-contain"
          data-testid="img-generated-image"
        />
        <div className="text-[10px] text-muted-foreground mt-1 italic truncate">{action.prompt}</div>
      </div>
    );
  }

  return null;
}

function isSafeUrl(url: string) {
  return url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://");
}

function renderFormattedText(text: string, isUserBubble?: boolean): (string | JSX.Element)[] {
  const tokenRegex = new RegExp(
    `!\\[([^\\]]*)\\]\\(([^)]+)\\)|\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)|\\[([^\\]]+)\\]\\((\\/api\\/chat-media\\/[^)]+)\\)|\\*\\*(.+?)\\*\\*|(https?:\\/\\/[^\\s<>)\\]]+)|${TAG_TOKEN_SOURCE}`,
    "g"
  );
  const result: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) result.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined && match[2]) {
      if (isSafeUrl(match[2])) {
        result.push(
          <a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer" className="block my-1">
            <img src={match[2]} alt={match[1]} className="rounded-xl max-w-[260px] max-h-[300px] object-cover" />
          </a>
        );
      } else {
        result.push(match[0]);
      }
    } else if (match[3] && match[4]) {
      result.push(
        <a key={key++} href={match[4]} target="_blank" rel="noopener noreferrer"
          className={`underline ${isUserBubble ? "text-white/90" : "text-primary"}`}
        >{match[3]}</a>
      );
    } else if (match[5] && match[6]) {
      // Delegate to the shared AuthDownloadLink (fetch → blob → click)
      // so the download path is identical across desktop, /chatbgp page
      // and the mobile PWA. Inline <a href download> previously caused
      // iOS PWA white-screens on authenticated binary responses.
      result.push(<AuthDownloadLink key={key++} href={match[6]}>{match[5]}</AuthDownloadLink>);
    } else if (match[7]) {
      result.push(<strong key={key++}>{match[7]}</strong>);
    } else if (match[9] && match[10] && match[11]) {
      result.push(<TagChip key={key++} type={match[10] as TagType} id={match[11]} name={match[9]} />);
    } else if (match[8]) {
      const url = match[8].replace(/[.,;:!?]+$/, "");
      const trailing = match[8].slice(url.length);
      result.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer"
          className={`underline break-all ${isUserBubble ? "text-white/90" : "text-primary"}`}
        >{url}</a>
      );
      if (trailing) result.push(trailing);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) result.push(text.slice(lastIndex));
  return result;
}

function RenderMessageContent({ content, onCheckboxClick }: { content: string; onCheckboxClick?: (text: string) => void }) {
  const lines = content.split("\n");
  const parts: Array<{ type: "text" | "checkbox" | "image"; text: string; alt?: string; url?: string }> = [];
  let textBuffer: string[] = [];

  for (const line of lines) {
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      if (textBuffer.length > 0) {
        parts.push({ type: "text", text: textBuffer.join("\n") });
        textBuffer = [];
      }
      parts.push({ type: "image", text: "", alt: imgMatch[1], url: imgMatch[2] });
      continue;
    }
    const checkMatch = line.match(/^[□☐✅☑]\s*(.+)/);
    if (checkMatch && onCheckboxClick) {
      if (textBuffer.length > 0) {
        parts.push({ type: "text", text: textBuffer.join("\n") });
        textBuffer = [];
      }
      parts.push({ type: "checkbox", text: checkMatch[1].trim() });
    } else {
      textBuffer.push(line);
    }
  }
  if (textBuffer.length > 0) {
    parts.push({ type: "text", text: textBuffer.join("\n") });
  }

  const hasSpecial = parts.some(p => p.type !== "text");
  if (!hasSpecial) {
    return <ChatBGPMarkdown content={content} />;
  }

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "image") {
          return (
            <a key={i} href={part.url} target="_blank" rel="noopener noreferrer" className="block my-1">
              <img src={part.url} alt={part.alt} className="rounded-xl max-w-[260px] max-h-[300px] object-cover" />
            </a>
          );
        }
        if (part.type === "text") {
          return <div key={i}><ChatBGPMarkdown content={part.text} /></div>;
        }
        {
          const lastTapRef = { current: 0 };
          const handleTap = (e: React.SyntheticEvent) => {
            e.stopPropagation();
            const now = Date.now();
            if (now - lastTapRef.current < 500) return;
            lastTapRef.current = now;
            onCheckboxClick?.(part.text);
          };
          return (
            <button
              key={i}
              onClick={handleTap}
              onTouchEnd={(e) => { e.preventDefault(); handleTap(e); }}
              className="flex items-center gap-2 w-full text-left py-2 px-3 my-0.5 rounded-lg bg-white/80 border border-gray-200 shadow-sm hover:bg-gray-50 active:bg-gray-100 active:scale-[0.98] transition-all cursor-pointer touch-manipulation"
              style={{ WebkitTapHighlightColor: "transparent", userSelect: "none" }}
              data-testid={`checkbox-action-${i}`}
            >
              <span className="w-4 h-4 rounded border-2 border-gray-400 flex-shrink-0 flex items-center justify-center">
              </span>
              <span className="text-sm">{part.text}</span>
            </button>
          );
        }
      })}
    </>
  );
}

function MessageBubble({ message, currentUserId, threadId, isGroupChat, onEdit, onDelete, onCheckboxClick }: {
  message: LocalChatMessage;
  currentUserId?: string;
  threadId?: string | null;
  isGroupChat?: boolean;
  onEdit?: (msgId: string, content: string) => void;
  onDelete?: (msgId: string) => void;
  onCheckboxClick?: (text: string) => void;
}) {
  const isUser = message.role === "user";
  const isOwn = isUser && currentUserId && message.userId === currentUserId;
  const isOtherUser = isUser && !isOwn;
  const showName = isGroupChat && message.userName && (isOtherUser || message.role === "assistant");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const handleSaveEdit = () => {
    if (message.id && onEdit && editContent.trim()) {
      onEdit(message.id, editContent.trim());
      setEditing(false);
    }
  };

  return (
    <div
      className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
      data-testid={`panel-message-${message.role}`}
    >
      <div className={`max-w-[85%] ${isOwn ? "items-end" : "items-start"}`}>
        {showName && message.userName && (
          <div className={`text-[11px] font-semibold mb-0.5 ${getNameColor(message.userName)}`}>{message.userName}</div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-1 mb-1">
            {message.attachments.map((att, i) => {
              const parsed = (() => { try { return JSON.parse(att); } catch { return null; } })();
              if (parsed && parsed.url) {
                if (isImageFile(parsed.type || parsed.name || "")) {
                  return (
                    <a key={i} href={parsed.url} target="_blank" rel="noopener noreferrer" className="block">
                      <img src={parsed.url} alt={parsed.name} className="rounded-lg max-w-[200px] max-h-[200px] object-cover" />
                    </a>
                  );
                }
                if (isAudioFile(parsed.name || parsed.type || "")) {
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-xl px-2 py-1.5 bg-muted min-w-[200px] max-w-[260px]" data-testid={`voice-note-${i}`}>
                      <Mic className="w-4 h-4 text-primary shrink-0" />
                      <audio src={parsed.url} controls preload="metadata" className="h-8 w-full [&::-webkit-media-controls-panel]:bg-transparent" />
                    </div>
                  );
                }
                return (
                  <a key={i} href={parsed.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
                    <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate">{parsed.name}</span>
                  </a>
                );
              }
              return (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-muted rounded-md px-2 py-1">
                  <FileIcon className="w-3 h-3" /> {att}
                </span>
              );
            })}
          </div>
        )}
        {editing ? (
          <div className="space-y-1.5">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[40px] max-h-[100px] text-sm resize-none"
              rows={2}
              autoFocus
              data-testid="input-edit-message"
            />
            <div className="flex gap-1.5 justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2.5" onClick={() => setEditing(false)} data-testid="button-cancel-edit">Cancel</Button>
              <Button size="sm" className="h-7 text-xs px-2.5 bg-black text-white hover:bg-gray-800" onClick={handleSaveEdit} data-testid="button-save-edit">Save</Button>
            </div>
          </div>
        ) : (
          <div className="relative group">
            <div
              className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                isOwn ? "bg-gray-900 text-white rounded-br-sm" : "bg-gray-100 dark:bg-gray-800 text-foreground rounded-bl-sm"
              }`}
            >
              <RenderMessageContent content={message.content} onCheckboxClick={!isUser ? onCheckboxClick : undefined} />
            </div>
            {isOwn && message.id && threadId && (
              <div className="absolute -top-1 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="w-5 h-5 rounded-full bg-background border shadow-sm flex items-center justify-center" data-testid={`button-message-actions-${message.id}`}>
                      <MoreVertical className="w-3 h-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-28">
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
        {message.action && <ActionCard action={message.action} />}
      </div>
    </div>
  );
}

function AddMemberPopover({ threadId, existingMemberIds, creatorId, hasAiMember }: { threadId: string; existingMemberIds: string[]; creatorId: string; hasAiMember?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: allUsers } = useQuery<Array<{ id: string; name: string; username: string }>>({
    queryKey: ["/api/users"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const addMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/chat/threads/${threadId}/members`, { userId });
      return res.json();
    },
    onSuccess: (_data, userId) => {
      if (userId === "__chatbgp__") {
        toast({ title: "ChatBGP joined the conversation" });
        queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
        queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
        return;
      }
      const user = allUsers?.find((u) => u.id === userId);
      toast({ title: `${user?.name || "Team member"} added to chat` });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to add member", description: err?.message });
    },
  });

  const availableUsers = useMemo(() => {
    if (!allUsers) return [];
    const existingSet = new Set([...existingMemberIds, creatorId]);
    return allUsers.filter((u) => !existingSet.has(u.id));
  }, [allUsers, existingMemberIds, creatorId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" data-testid="button-add-member">
          <UserPlus className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="end">
        <p className="text-xs font-semibold px-2 py-1 text-muted-foreground">Add to conversation</p>
        {!hasAiMember && (
          <button
            onClick={() => {
              addMutation.mutate("__chatbgp__");
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent text-left mb-1"
            data-testid="button-add-member-chatbgp"
          >
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-800 to-black flex items-center justify-center shrink-0">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="truncate font-medium block">ChatBGP</span>
              <span className="text-[10px] text-muted-foreground">AI assistant</span>
            </div>
          </button>
        )}
        <div className="max-h-[200px] overflow-y-auto">
          {availableUsers.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-2">All team members already added</p>
          ) : (
            availableUsers.map((user) => (
              <button
                key={user.id}
                onClick={() => {
                  addMutation.mutate(user.id);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent text-left"
                data-testid={`button-add-member-${user.id}`}
              >
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-semibold">{user.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                </div>
                <span className="truncate">{user.name}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PropertyPicker({ threadId, currentPropertyName }: { threadId: string; currentPropertyName: string | null }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: properties } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/crm/properties"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: open,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ propertyId, propertyName }: { propertyId: string; propertyName: string }) => {
      const res = await apiRequest("PUT", `/api/chat/threads/${threadId}`, { propertyId, propertyName });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({ title: `Linked to ${vars.propertyName}` });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to link property", description: err?.message });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/chat/threads/${threadId}`, { propertyId: null, propertyName: null });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Property unlinked" });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to unlink property", description: err?.message });
    },
  });

  const items = (properties as any)?.items || properties || [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          data-testid="button-link-property"
        >
          <Building2 className={`w-3.5 h-3.5 ${currentPropertyName ? "text-primary" : ""}`} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <p className="text-xs font-semibold px-2 py-1 text-muted-foreground">Link to property</p>
        {currentPropertyName && (
          <div className="flex items-center justify-between px-2 py-1.5 mb-1 bg-primary/5 rounded text-xs">
            <span className="truncate">{currentPropertyName}</span>
            <button
              onClick={() => { unlinkMutation.mutate(); setOpen(false); }}
              className="text-muted-foreground hover:text-destructive shrink-0 ml-1"
              data-testid="button-unlink-property"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="max-h-[200px] overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-2">Loading properties...</p>
          ) : (
            items.map((p: any) => (
              <button
                key={p.id}
                onClick={() => {
                  assignMutation.mutate({ propertyId: p.id, propertyName: p.name });
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent text-left"
                data-testid={`button-assign-property-${p.id}`}
              >
                <Building2 className="w-3 h-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NewGroupView({ allUsers, currentUserId, onCreate }: {
  allUsers: Array<{ id: string; name: string; username: string; team?: string | null }>;
  currentUserId: string;
  onCreate: (title: string, memberIds: string[]) => void;
}) {
  const [groupName, setGroupName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  const teamGroups = useMemo(() => {
    const groups: Record<string, Array<{ id: string; name: string }>> = {};
    for (const u of allUsers) {
      if (u.id === currentUserId || !u.team) continue;
      if (!groups[u.team]) groups[u.team] = [];
      groups[u.team].push({ id: u.id, name: u.name });
    }
    return groups;
  }, [allUsers, currentUserId]);

  const availableTeams = useMemo(() => {
    return Object.keys(teamGroups).sort();
  }, [teamGroups]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return allUsers
      .filter(u => u.id !== currentUserId)
      .filter(u => !q || u.name.toLowerCase().includes(q));
  }, [allUsers, currentUserId, searchQuery]);

  const toggleUser = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedTeam(null);
  };

  const selectTeam = (teamName: string) => {
    const teamMembers = teamGroups[teamName] || [];
    const teamMemberIds = new Set(teamMembers.map(m => m.id));
    setSelectedIds(teamMemberIds);
    setSelectedTeam(teamName);
    setGroupName(teamName);
  };

  const handleCreate = () => {
    if (selectedIds.size === 0) return;
    const title = groupName.trim() || Array.from(selectedIds)
      .map(id => allUsers.find(u => u.id === id)?.name?.split(" ")[0])
      .filter(Boolean)
      .join(", ");
    onCreate(title, Array.from(selectedIds));
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 space-y-3">
        {availableTeams.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Quick: Select a team</p>
            <div className="flex flex-wrap gap-1.5">
              {availableTeams.map(team => {
                const isActive = selectedTeam === team;
                const count = teamGroups[team]?.length || 0;
                return (
                  <button
                    key={team}
                    onClick={() => selectTeam(team)}
                    className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2.5 py-1 border transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card hover:bg-accent border-border"
                    }`}
                    data-testid={`button-select-team-${team.replace(/[\s\/]/g, "-").toLowerCase()}`}
                  >
                    <Users className="w-3 h-3" />
                    {team}
                    <span className={`text-[9px] ${isActive ? "text-primary-foreground/70" : "text-muted-foreground"}`}>({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Input
          value={groupName}
          onChange={e => setGroupName(e.target.value)}
          placeholder="Group name (optional)"
          className="h-8 text-xs"
          data-testid="input-group-name"
        />

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap gap-1">
            {Array.from(selectedIds).map(id => {
              const name = id === "__chatbgp__" ? "ChatBGP" : allUsers.find(u => u.id === id)?.name?.split(" ")[0];
              return (
                <span
                  key={id}
                  className={`inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 ${id === "__chatbgp__" ? "bg-gradient-to-r from-gray-800 to-black text-white" : "bg-primary text-primary-foreground"}`}
                >
                  {id === "__chatbgp__" && <Sparkles className="w-2.5 h-2.5" />}
                  {name}
                  <button onClick={() => toggleUser(id)} className="hover:opacity-70">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search team members..."
            className="h-8 pl-8 text-xs"
            data-testid="input-search-members"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        {(!searchQuery.trim() || "chatbgp".includes(searchQuery.toLowerCase())) && (
          <button
            onClick={() => toggleUser("__chatbgp__")}
            className={`w-full flex items-center gap-2.5 px-2 py-2 text-xs rounded-lg transition-colors ${
              selectedIds.has("__chatbgp__") ? "bg-primary/10" : "hover:bg-accent"
            }`}
            data-testid="button-select-member-chatbgp"
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              selectedIds.has("__chatbgp__") ? "bg-primary text-primary-foreground" : "bg-gradient-to-br from-gray-800 to-black text-white"
            }`}>
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="font-medium truncate">ChatBGP</p>
              <p className="text-[10px] text-muted-foreground truncate">AI Assistant</p>
            </div>
            {selectedIds.has("__chatbgp__") && (
              <Check className="w-4 h-4 text-primary shrink-0" />
            )}
          </button>
        )}
        {filteredUsers.map(user => {
          const isSelected = selectedIds.has(user.id);
          return (
            <button
              key={user.id}
              onClick={() => toggleUser(user.id)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 text-xs rounded-lg transition-colors ${
                isSelected ? "bg-primary/10" : "hover:bg-accent"
              }`}
              data-testid={`button-select-member-${user.id}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}>
                <span className="text-[10px] font-semibold">
                  {user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="font-medium truncate">{user.name}</p>
                {user.team && (
                  <p className="text-[10px] text-muted-foreground truncate">{user.team}</p>
                )}
              </div>
              {isSelected && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t shrink-0">
        <Button
          className="w-full gap-2"
          size="sm"
          onClick={handleCreate}
          disabled={selectedIds.size === 0}
          data-testid="button-create-group"
        >
          <Users className="w-3.5 h-3.5" />
          Create Group ({selectedIds.size} member{selectedIds.size !== 1 ? "s" : ""})
        </Button>
      </div>
    </div>
  );
}

// WhatsApp-style "Media · Links · Docs" for one conversation. Shared by the
// Team Chat panel, the /chatbgp page and the mobile chat screen — mount it
// anywhere with a threadId and a trigger.
export function ThreadMediaDialog({ threadId, open, onOpenChange }: {
  threadId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<"media" | "links" | "docs">("media");
  const { data, isLoading } = useQuery<{ media: any[]; links: any[]; docs: any[] }>({
    queryKey: ["/api/chat/threads", threadId, "media"],
    queryFn: async () => {
      const res = await fetch(`/api/chat/threads/${threadId}/media`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load shared files");
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });
  const counts = {
    media: data?.media?.length ?? 0,
    links: data?.links?.length ?? 0,
    docs: data?.docs?.length ?? 0,
  };
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Shared in this chat</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-1.5">
          {(["media", "links", "docs"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-1 rounded-full text-[11.5px] font-medium capitalize transition-colors border ${
                tab === k ? "bg-foreground text-background border-transparent" : "bg-background text-muted-foreground border-border hover:text-foreground"
              }`}
              data-testid={`chip-thread-media-${k}`}
            >
              {k} {counts[k] > 0 ? counts[k] : ""}
            </button>
          ))}
        </div>
        <div className="min-h-[180px] max-h-[55vh] overflow-y-auto">
          {isLoading ? (
            <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>
          ) : tab === "media" ? (
            counts.media === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">No photos or media shared yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {data!.media.map((m, i) => m.audio ? (
                  <div key={i} className="aspect-square rounded-lg bg-muted flex flex-col items-center justify-center gap-1 p-2">
                    <Mic className="w-5 h-5 text-muted-foreground" />
                    <audio src={m.url} controls preload="none" className="w-full h-7" />
                  </div>
                ) : (
                  <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-lg overflow-hidden bg-muted block" title={`${m.name} · ${m.sender} · ${fmtDate(m.at)}`}>
                    <img src={m.url} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            )
          ) : tab === "links" ? (
            counts.links === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">No links shared yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {data!.links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2.5 rounded-lg border p-2.5 hover:bg-muted/50 transition-colors">
                    <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="text-xs font-medium block truncate">{l.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                      <span className="text-[10.5px] text-muted-foreground">{l.sender} · {fmtDate(l.at)}</span>
                    </span>
                  </a>
                ))}
              </div>
            )
          ) : counts.docs === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No documents shared yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {data!.docs.map((d, i) => (
                <a key={i} href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-lg border p-2.5 hover:bg-muted/50 transition-colors">
                  <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="min-w-0">
                    <span className="text-xs font-medium block truncate">{d.name}</span>
                    <span className="text-[10.5px] text-muted-foreground">{d.sender} · {fmtDate(d.at)}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThreadCard({ thread, onClick, onDelete, currentUserId, userPics }: { thread: ThreadData; onClick: () => void; onDelete?: (id: string) => void; currentUserId?: string; userPics?: Record<string, string> }) {
  // Unread means *I* haven't seen it — not "some member hasn't". The old
  // any-member check kept threads bold until every colleague read them.
  const myMember = thread.members.find(m => m.id === currentUserId);
  const hasUnseen = myMember ? !myMember.seen : false;
  const isAi = thread.isAiChat;
  const otherMembers = thread.members.filter(m => m.id !== currentUserId);
  const isDm = !isAi && otherMembers.length === 1;
  const dmName = isDm ? otherMembers[0].name : null;
  const dmInitials = dmName ? dmName.split(" ").map(n => n[0]).join("").slice(0, 2) : null;
  const displayTitle = thread.title || dmName || "New conversation";
  const dmPic = isDm && otherMembers[0] ? userPics?.[otherMembers[0].id] : null;

  const renderAvatar = () => {
    if (isAi) {
      return (
        <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center shrink-0">
          <Sparkles className="w-4.5 h-4.5" />
        </div>
      );
    }
    if (isDm && dmPic) {
      return <img src={dmPic} alt={dmName || ""} className="w-10 h-10 rounded-full object-cover shrink-0" />;
    }
    if (isDm) {
      return (
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-white">{dmInitials}</span>
        </div>
      );
    }
    if (thread.groupPicUrl) {
      return <img src={thread.groupPicUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />;
    }
    if (otherMembers.length > 0) {
      const firstPic = otherMembers.find(m => userPics?.[m.id])?.id;
      if (firstPic && userPics?.[firstPic]) {
        return <img src={userPics[firstPic]} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />;
      }
    }
    return (
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center shrink-0">
        <Users className="w-4.5 h-4.5 text-gray-500" />
      </div>
    );
  };

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-accent/50 transition-colors border-b border-border/50 group text-left`}
      data-testid={`button-thread-${thread.id}`}
    >
      <div className="relative shrink-0">
        {renderAvatar()}
        {thread.hasAiMember && !isAi && (
          <div className="absolute -bottom-0.5 -right-0.5 w-4.5 h-4.5 rounded-full bg-black text-white flex items-center justify-center border-2 border-background">
            <Sparkles className="w-2.5 h-2.5" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-[13px] truncate ${hasUnseen ? "font-bold text-foreground" : "font-medium text-foreground"}`}>{displayTitle}</span>
          <span className={`text-[11px] shrink-0 ml-2 ${hasUnseen ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
            {formatTimeAgo(thread.updatedAt)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className={`text-[12px] truncate ${hasUnseen ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {thread.lastMessage ? (
              <><span className="font-medium">{thread.lastMessage.senderName.split(" ")[0]}: </span>{thread.lastMessage.content}</>
            ) : (
              <span className="italic">No messages yet</span>
            )}
          </p>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {hasUnseen && <span className="w-2.5 h-2.5 rounded-full bg-black dark:bg-white" />}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(thread.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                title="Delete thread"
                data-testid={`button-delete-thread-${thread.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        {(thread.propertyName || thread.linkedName) && (
          <div className="flex items-center gap-2 mt-0.5">
            {thread.propertyName && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><Building2 className="w-2.5 h-2.5" />{thread.propertyName}</span>
            )}
            {thread.linkedName && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                <Building2 className="w-2.5 h-2.5" />
                {thread.linkedName}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function ThreadList({ threads, onSelect, onNewGroupChat, unseenCount, onOpenAiFullPage, onDeleteThread, currentUserId, userPics }: {
  threads: ThreadData[];
  onSelect: (id: string) => void;
  onNewGroupChat: () => void;
  unseenCount: number;
  onOpenAiFullPage: (threadId?: string) => void;
  onDeleteThread: (id: string) => void;
  currentUserId?: string;
  userPics?: Record<string, string>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  // WhatsApp-style filter chips. "All" is the one inbox: team chats AND
  // saved ChatBGP threads together, newest first (Woody, 2026-08-21 —
  // "one screen, like WhatsApp").
  const [chip, setChip] = useState<"all" | "unread" | "groups" | "ai">("all");

  const filteredThreads = useMemo(() => {
    // Every non-AI thread the API returned is one this user belongs to —
    // show them all (the old "2+ other members" rule hid 1:1 conversations
    // from the person who was added to them). Only your own empty,
    // member-less drafts stay hidden, and empty untitled AI drafts.
    let filtered = threads.filter(t => {
      if (t.isAiChat) {
        return !!(t.title || t.lastMessage);
      }
      const otherMembers = t.members.filter(m => m.id !== currentUserId);
      if (otherMembers.length === 0 && t.createdBy === currentUserId && !t.lastMessage) return false;
      return true;
    });
    if (searchQuery.trim()) {
      // Search spans EVERYTHING (human + AI) regardless of chip, so a
      // remembered AI thread is always findable from the main box.
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        (t.title || "").toLowerCase().includes(q) ||
        t.creatorName.toLowerCase().includes(q) ||
        (t.propertyName || "").toLowerCase().includes(q) ||
        (t.linkedName || "").toLowerCase().includes(q) ||
        (t.lastMessage?.content || "").toLowerCase().includes(q) ||
        t.members.some(m => m.name.toLowerCase().includes(q))
      );
    } else if (chip === "ai") {
      filtered = filtered.filter(t => t.isAiChat);
    } else if (chip === "groups") {
      filtered = filtered.filter(t => !t.isAiChat && t.members.filter(m => m.id !== currentUserId).length > 1);
    } else if (chip === "unread") {
      filtered = filtered.filter(t => {
        if (t.isAiChat) return false;
        const me = t.members.find(m => m.id === currentUserId);
        return me ? !me.seen : false;
      });
    } else {
      // "All" = PEOPLE. The AI's many working threads were drowning human
      // conversations (Woody, 2026-08-20: "the AI chats are overtaking the
      // main ones") — ChatBGP gets exactly one row: the pinned one above.
      // Full AI history lives under the AI chip.
      filtered = filtered.filter(t => !t.isAiChat);
    }
    return [...filtered].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [threads, searchQuery, currentUserId, chip]);

  const latestAiThread = useMemo(
    () => threads.filter(t => t.isAiChat).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0],
    [threads]
  );

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* ChatBGP pinned at the top of the inbox — one tap to the AI, while
          the conversations below make the human chat impossible to miss. */}
      <button
        onClick={() => onOpenAiFullPage()}
        className="w-full flex items-center gap-3 px-3 py-3 hover:bg-accent/50 transition-colors border-b text-left shrink-0"
        data-testid="button-pinned-chatbgp"
      >
        <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center shrink-0">
          <Sparkles className="w-4.5 h-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-semibold block">ChatBGP</span>
          <p className="text-[12px] text-muted-foreground truncate">
            {latestAiThread?.lastMessage
              ? <><span className="font-medium">{latestAiThread.lastMessage.senderName.split(" ")[0]}: </span>{latestAiThread.lastMessage.content}</>
              : "Ask about brands, units, deals — or add it to any chat"}
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">AI</span>
      </button>

      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5 text-xs h-9 rounded-lg"
          onClick={onNewGroupChat}
          data-testid="button-new-group-chat"
        >
          <Users className="w-3.5 h-3.5" />
          New message
        </Button>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="h-8 pl-8 text-xs rounded-lg"
            data-testid="input-search-threads"
          />
          {searchQuery && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setSearchQuery("")}
              data-testid="button-clear-thread-search"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 pt-1 pb-2 shrink-0">
        {([
          { key: "all", label: "All" },
          { key: "unread", label: "Unread" },
          { key: "groups", label: "Groups" },
          { key: "ai", label: "AI" },
        ] as const).map(({ key, label }) => (
          <Pill key={key} active={chip === key} onClick={() => setChip(key)} data-testid={`chip-threads-${key}`}>
            {label}
          </Pill>
        ))}
      </div>

      {filteredThreads.length === 0 && !searchQuery && chip !== "all" ? (
        <div className="text-center py-10 flex-1 flex flex-col items-center justify-center px-6">
          <MessageCircle className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground font-medium">
            {chip === "unread" ? "You're all caught up" : chip === "ai" ? "No saved ChatBGP threads yet" : "No group chats yet"}
          </p>
        </div>
      ) : filteredThreads.length === 0 && !searchQuery ? (
        <div className="text-center py-10 flex-1 flex flex-col items-center justify-center px-6">
          <MessageCircle className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground font-medium">No conversations yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Message your team about a property, a deal or a brand — tag anything with @.</p>
          <Button size="sm" className="gap-1.5 text-xs" onClick={onNewGroupChat} data-testid="button-empty-new-message">
            <Users className="w-3.5 h-3.5" />
            Message your team
          </Button>
        </div>
      ) : filteredThreads.length === 0 && searchQuery ? (
        <div className="text-center py-8">
          <Search className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No matching conversations</p>
        </div>
      ) : (
        <div>
          {filteredThreads.map(thread => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onClick={() => thread.isAiChat ? onOpenAiFullPage(thread.id) : onSelect(thread.id)}
              onDelete={onDeleteThread}
              currentUserId={currentUserId}
              userPics={userPics}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  openAiChat?: boolean;
  onAiChatHandled?: () => void;
  // Reports whether a draft (text or attached files) is in the composer, so
  // the hover-peek shell can refuse to tuck the panel away mid-draft.
  onDraftChange?: (hasDraft: boolean) => void;
}

export function ChatPanel({ open, onClose, openAiChat, onAiChatHandled, onDraftChange }: ChatPanelProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [panelProgressLabel, setPanelProgressLabel] = useState("");
  // Token deltas streamed live into a draft bubble while the reply is being
  // composed — the panel used to sit on a spinner and then dump the full text.
  const [streamingText, setStreamingText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  // Share activeThreadId with the full-page /chatbgp view (same
  // ChatBGPProvider context wraps both). Minimising the full page then
  // leaves the same conversation loaded in the side panel.
  const chatBgpCtx = useChatBGPState();
  const activeThreadId = chatBgpCtx.activeThreadId;
  const setActiveThreadId = chatBgpCtx.setActiveThreadId;
  // The panel lands on the unified inbox — ChatBGP pinned on top, team
  // conversations below. The AI screen is one tap away, not the front door.
  const [view, setView] = useState<"chat" | "threads" | "new-group">("threads");
  const [showSidebar, setShowSidebar] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const mentionRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);
  const messageQueueRef = useRef<{ content: string; files: File[] }[]>([]);

  const { data: currentUser } = useQuery<UserType>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  // Team chat is BGP-internal — client logins use ChatBGP (AI) only, so skip
  // the team-thread/notification polling that would otherwise 403.
  const chatIsClient = (currentUser as any)?.role === "Client" || !!(currentUser as any)?.companyScopeId;

  const { data: status } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/chatbgp/status"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: threads } = useQuery<ThreadData[]>({
    queryKey: ["/api/chat/threads"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !chatIsClient,
  });

  const { data: notifications } = useQuery<{ unseenCount: number }>({
    queryKey: ["/api/chat/notifications"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 15000,
    enabled: !chatIsClient,
  });

  const { data: activeThread } = useQuery<ThreadData>({
    queryKey: ["/api/chat/threads", activeThreadId],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeThreadId && !chatIsClient,
    refetchInterval: 8000,
  });

  const { data: allUsers } = useQuery<Array<{ id: string; name: string; username: string; team?: string | null; profilePicUrl?: string | null }>>({
    queryKey: ["/api/users"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const userPics = useMemo(() => {
    const pics: Record<string, string> = {};
    if (allUsers) {
      for (const u of allUsers) {
        if (u.profilePicUrl) pics[u.id] = u.profilePicUrl;
      }
    }
    return pics;
  }, [allUsers]);

  const { typingUsers, sendTyping, stopTyping } = useTypingIndicator(activeThreadId);

  useEffect(() => {
    if (openAiChat && open) {
      setActiveThreadId(null);
      setMessages([]);
      setAttachedFiles([]);
      setInput("");
      setView("chat");
      onAiChatHandled?.();
    }
  }, [openAiChat, open]);

  const pendingPromptRef = useRef<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Removed the `&& open` gate — when the panel is closed, App.tsx's
      // listener opens it via setChatOpen(true) but our handler used to bail
      // here because the panel wasn't open yet, losing the prompt entirely.
      // Now we accept the prompt regardless; once the panel renders open it
      // already has the queued question.
      if (detail?.prompt) {
        setActiveThreadId(null);
        setMessages([]);
        setAttachedFiles([]);
        setView("chat");
        pendingPromptRef.current = detail.prompt;
        setInput(detail.prompt);
      }
    };
    window.addEventListener("open-ai-chat-with-prompt", handler);
    return () => window.removeEventListener("open-ai-chat-with-prompt", handler);
  }, []);

  useEffect(() => {
    if (activeThreadId && view === "chat") {
      emitMarkSeen(activeThreadId);
    }
  }, [activeThreadId, view]);

  // The saved thread id lives in localStorage, which is shared across
  // logins on the same browser — if a different user signs in, drop the
  // previous user's thread instead of 403ing on every send.
  useEffect(() => {
    if (!currentUser?.id) return;
    try {
      const owner = localStorage.getItem("chatbgp:threadOwner");
      if (owner && owner !== currentUser.id) {
        setActiveThreadId(null);
        setMessages([]);
      }
      localStorage.setItem("chatbgp:threadOwner", currentUser.id);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const isActiveThreadAi = activeThread?.isAiChat ?? true;

  const mentionUsers = useMemo(() => {
    if (mentionQuery === null || !allUsers) return [];
    const q = mentionQuery.toLowerCase();
    return allUsers.filter((u) => {
      if (u.id === currentUser?.id) return false;
      const firstName = u.name.split(" ")[0]?.toLowerCase() || "";
      const fullName = u.name.toLowerCase();
      return firstName.startsWith(q) || fullName.startsWith(q) || u.name.toLowerCase().includes(q);
    }).slice(0, 4);
  }, [mentionQuery, allUsers, currentUser?.id]);

  // ── Smart tags: the @ menu also searches brands, properties, deals and
  // letting-tracker units (debounced server search), plus a ChatBGP row.
  // Selecting an entity inserts readable "@Name" text; handleSend swaps it
  // for the durable @[Name](tag:type/id) token that renders as a chip.
  const [tagEntities, setTagEntities] = useState<Array<{ type: TagType; id: string; name: string; subtitle?: string }>>([]);
  const pendingTagsRef = useRef<Map<string, { type: TagType; id: string; name: string }>>(new Map());

  useEffect(() => {
    if (mentionQuery === null || mentionQuery.length < 2) {
      setTagEntities([]);
      return;
    }
    const q = mentionQuery;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/tag-search?q=${encodeURIComponent(q)}`, {
          credentials: "include",
          headers: { ...getAuthHeaders() },
        });
        if (!res.ok) return;
        const data = await res.json();
        const entities = (data.results || []).filter((r: any) => r.type !== "user");
        setTagEntities(entities);
      } catch {}
    }, 180);
    return () => clearTimeout(timer);
  }, [mentionQuery]);

  type MentionOption =
    | { kind: "chatbgp" }
    | { kind: "user"; id: string; name: string }
    | { kind: "entity"; type: TagType; id: string; name: string; subtitle?: string };

  const mentionOptions = useMemo<MentionOption[]>(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const opts: MentionOption[] = [];
    const aiMatches = q === "" || "chatbgp".startsWith(q) || "chat".startsWith(q) || q === "ai";
    if (aiMatches && !isActiveThreadAi && activeThreadId) opts.push({ kind: "chatbgp" });
    for (const u of mentionUsers) opts.push({ kind: "user", id: u.id, name: u.name });
    for (const e of tagEntities) opts.push({ kind: "entity", type: e.type, id: e.id, name: e.name, subtitle: e.subtitle });
    return opts;
  }, [mentionQuery, mentionUsers, tagEntities, isActiveThreadAi, activeThreadId]);

  const addMemberToThread = useMutation({
    mutationFn: async ({ threadId, userId }: { threadId: string; userId: string }) => {
      const res = await apiRequest("POST", `/api/chat/threads/${threadId}/members`, { userId });
      return res.json();
    },
    onSuccess: (_data, { userId }) => {
      const user = allUsers?.find((u) => u.id === userId);
      toast({ title: `${user?.name || "Team member"} added to chat` });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", activeThreadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to add member", description: err?.message });
    },
  });

  const handleOptionSelect = useCallback(async (opt: MentionOption) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const before = input.slice(0, mentionStart);
    const after = input.slice(textarea.selectionStart);

    let inserted: string;
    if (opt.kind === "chatbgp") {
      inserted = "@ChatBGP";
      // Summoning the AI adds it to the conversation immediately, same as
      // picking a person — the server also auto-joins on send as a backstop.
      if (activeThreadId && !activeThread?.hasAiMember) {
        addMemberToThread.mutate({ threadId: activeThreadId, userId: "__chatbgp__" });
      }
    } else if (opt.kind === "user") {
      inserted = `@${opt.name.split(" ")[0]}`;
      if (activeThreadId) {
        const existingMemberIds = new Set(activeThread?.members?.map((m) => m.id) || []);
        const creatorId = activeThread?.createdBy || currentUser?.id || "";
        if (!existingMemberIds.has(opt.id) && opt.id !== creatorId) {
          addMemberToThread.mutate({ threadId: activeThreadId, userId: opt.id });
        }
      }
    } else {
      // Brackets/parens would corrupt the tag token — strip them from the
      // display name (they stay intact on the record itself).
      const clean = opt.name.replace(/[\[\]()]/g, "").trim();
      inserted = `@${clean}`;
      pendingTagsRef.current.set(inserted, { type: opt.type, id: opt.id, name: clean });
    }

    const newInput = `${before}${inserted} ${after}`;
    setInput(newInput);
    setMentionQuery(null);
    setMentionIndex(0);
    setMentionStart(-1);

    setTimeout(() => {
      const cursorPos = before.length + inserted.length + 1;
      textarea.selectionStart = cursorPos;
      textarea.selectionEnd = cursorPos;
      textarea.focus();
    }, 0);
  }, [input, mentionStart, activeThreadId, activeThread, currentUser, addMemberToThread]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val.trim()) sendTyping();

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex >= 0) {
      const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || lastAtIndex === 0) {
        const query = textBeforeCursor.slice(lastAtIndex + 1);
        if (!query.includes(" ") && query.length <= 20) {
          setMentionQuery(query);
          setMentionStart(lastAtIndex);
          setMentionIndex(0);
          return;
        }
      }
    }
    setMentionQuery(null);
    setMentionStart(-1);
  }, [sendTyping]);

  // Composer auto-grow + draft reporting. Effect (not the change handler) so
  // every path that sets the input — typing, mention insert, checkbox click,
  // voice transcript, send clearing it — resizes the box and updates the
  // shell's draft flag.
  useEffect(() => {
    onDraftChange?.(!!input.trim() || attachedFiles.length > 0);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
    }
  }, [input, attachedFiles, onDraftChange]);

  const messagesKey = useMemo(() => {
    if (!activeThread?.messages) return "";
    return activeThread.messages.map(m => `${m.id}:${m.content?.length}`).join("|");
  }, [activeThread?.messages]);

  useEffect(() => {
    if (activeThread?.messages) {
      const loaded: LocalChatMessage[] = activeThread.messages.map(m => {
        let userName: string | undefined;
        if (m.role === "assistant") {
          userName = "ChatBGP";
        } else if (m.userId) {
          if (m.userId === currentUser?.id) {
            userName = currentUser?.name;
          } else {
            const sender = allUsers?.find(u => u.id === m.userId);
            if (sender) userName = sender.name;
          }
        }
        return {
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          action: m.actionData ? JSON.parse(m.actionData) : undefined,
          attachments: m.attachments || undefined,
          userId: m.userId,
          userName,
        };
      });
      setMessages(loaded);
    }
  }, [messagesKey, activeThreadId, allUsers, currentUser]);

  const createThreadMutation = useMutation({
    mutationFn: async ({ title, isAiChat, memberIds }: { title?: string; isAiChat: boolean; memberIds?: string[] }) => {
      const res = await apiRequest("POST", "/api/chat/threads", { title, isAiChat, memberIds });
      return res.json();
    },
    onSuccess: (thread: ThreadData) => {
      setActiveThreadId(thread.id);
      setView("chat");
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to create chat", description: err?.message });
    },
  });

  const saveMessageMutation = useMutation({
    mutationFn: async ({ threadId, role, content, actionData, attachments }: {
      threadId: string; role: string; content: string; actionData?: string; attachments?: string[];
    }) => {
      const res = await apiRequest("POST", `/api/chat/threads/${threadId}/messages`, {
        role, content, actionData, attachments,
      });
      return res.json();
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("DELETE", `/api/chat/threads/${threadId}`);
      return res.json();
    },
    onSuccess: () => {
      setActiveThreadId(null);
      setMessages([]);
      setView("threads");
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      const res = await apiRequest("PUT", `/api/chat/threads/${activeThreadId}/messages/${messageId}`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", activeThreadId] });
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("DELETE", `/api/chat/threads/${activeThreadId}/messages/${messageId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", activeThreadId] });
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

  const aiSendMutation = useMutation({
    mutationFn: async ({ newMessages, files, threadId }: { newMessages: LocalChatMessage[]; files: File[]; threadId: string | null }) => {
      const plainMessages = newMessages.map((m) => {
        let content = m.content;
        if (m.attachments && m.attachments.length > 0) {
          const attInfo = m.attachments.map((a: string) => {
            try { const p = JSON.parse(a); return p.url || a; } catch { return a; }
          }).join("\n");
          content = `${content}\n\n[Attached files]\n${attInfo}`;
        }
        return { role: m.role, content };
      });

      const createFreshThread = async (): Promise<string> => {
        const firstMsg = newMessages[0]?.content || "New conversation";
        const title = firstMsg.length > 50 ? firstMsg.slice(0, 50) + "..." : firstMsg;
        const res = await apiRequest("POST", "/api/chat/threads", { title, isAiChat: true });
        const thread = await res.json();
        setActiveThreadId(thread.id);
        queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
        return thread.id;
      };

      let currentThreadId = threadId;
      if (!currentThreadId) currentThreadId = await createFreshThread();

      const lastUserMsg = newMessages[newMessages.length - 1];
      try {
        await saveMessageMutation.mutateAsync({
          threadId: currentThreadId!,
          role: "user",
          content: lastUserMsg.content,
          attachments: lastUserMsg.attachments,
        });
      } catch (e: any) {
        // Stale thread — the saved id can outlive its thread (deleted, or
        // left over from a different login on this browser). Rather than
        // dead-ending with "not a member", start fresh and carry the
        // message across.
        if (/not a member|403|404|not found/i.test(String(e?.message || ""))) {
          currentThreadId = await createFreshThread();
          await saveMessageMutation.mutateAsync({
            threadId: currentThreadId!,
            role: "user",
            content: lastUserMsg.content,
            attachments: lastUserMsg.attachments,
          });
        } else {
          throw e;
        }
      }

      // Shared SSE reader: live progress → status label, token deltas → the
      // streaming draft bubble, final {reply}/{error} → resolved result.
      const readSseResponse = async (res: Response): Promise<any> => {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");
        const decoder = new TextDecoder();
        let buffer = "";
        let lastData = "";
        const handle = (raw: string) => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.progress) { setPanelProgressLabel(parsed.progress); setStreamingText(""); }
            if (parsed.delta) { setPanelProgressLabel(""); setStreamingText(prev => prev + parsed.delta); }
            if (parsed.reply !== undefined || parsed.error !== undefined) lastData = raw;
          } catch {}
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) if (line.startsWith("data: ")) handle(line.slice(6));
        }
        if (buffer.startsWith("data: ")) handle(buffer.slice(6));
        if (lastData) {
          const data = JSON.parse(lastData);
          if (data.error !== undefined) throw new Error(String(data.error));
          return data;
        }
        throw new Error("No response received");
      };

      if (files.length > 0) {
        const formData = new FormData();
        formData.append("messages", JSON.stringify(plainMessages));
        files.forEach((f) => formData.append("files", f));

        const token = localStorage.getItem("bgp_auth_token");
        const fetchHeaders: Record<string, string> = {};
        if (token) fetchHeaders["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/chatbgp/chat-with-files", {
          method: "POST",
          body: formData,
          credentials: "include",
          headers: fetchHeaders,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Request failed" }));
          throw new Error(JSON.stringify(err));
        }

        const data = await readSseResponse(res);
        return { ...data, threadId: currentThreadId };
      } else {
        const attemptChat = async (attempt: number): Promise<any> => {
          const token = localStorage.getItem("bgp_auth_token");
          const fetchHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (token) fetchHeaders["Authorization"] = `Bearer ${token}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 600000);
          try {
            const res = await fetch("/api/chatbgp/chat", {
              method: "POST",
              headers: fetchHeaders,
              body: JSON.stringify({ messages: plainMessages, threadId: currentThreadId }),
              credentials: "include",
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
              const text = (await res.text()) || res.statusText;
              if (res.status >= 500 && attempt < 2) {
                await new Promise(r => setTimeout(r, 2000 * attempt));
                return attemptChat(attempt + 1);
              }
              throw new Error(`${res.status}: ${text}`);
            }
            const data = await readSseResponse(res);
            return { ...data, threadId: currentThreadId };
          } catch (err: any) {
            clearTimeout(timeoutId);
            if (err.name === "AbortError") throw new Error("Request timed out after 5 minutes.");
            const isNetworkError = err.message === "Failed to fetch" || err.message === "Load failed" || err.message?.includes("NetworkError") || err.message?.includes("network");
            if (isNetworkError && attempt < 2) {
              await new Promise(r => setTimeout(r, 2000 * attempt));
              return attemptChat(attempt + 1);
            }
            throw err;
          }
        };
        return attemptChat(1);
      }
    },
    onSuccess: async (data: { reply: string; action?: ChatAction; threadId: string; savedToThread?: boolean }) => {
      setPanelProgressLabel("");
      setStreamingText("");
      const msg: LocalChatMessage = { role: "assistant", content: data.reply };
      if (data.action) {
        msg.action = data.action;
        switch (data.action.type) {
          case "model_run":
            queryClient.invalidateQueries({ queryKey: ["/api/models/runs"] });
            break;
          case "navigate": {
            const navPath = (data.action as any).path;
            if (navPath) setTimeout(() => navigate(navPath), 500);
            break;
          }
          case "crm_created":
          case "crm_updated": {
            const et = data.action.entityType;
            if (et) {
              invalidateCrmEntity(et);
              toast({ title: `${et} ${data.action.type === "crm_created" ? "created" : "updated"}`, description: data.action.name || "" });
            }
            break;
          }
          case "crm_deleted": {
            const et2 = data.action.entityType;
            if (et2) {
              invalidateCrmEntity(et2);
              toast({ title: `${et2} deleted` });
            }
            break;
          }
          case "email_sent":
            toast({ title: "Email sent", description: `To: ${data.action.to || ""}` });
            break;
        }
      }
      setMessages((prev) => [...prev, msg]);

      if (!data.savedToThread) {
        await saveMessageMutation.mutateAsync({
          threadId: data.threadId,
          role: "assistant",
          content: data.reply,
          actionData: data.action ? JSON.stringify(data.action) : undefined,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", data.threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });

      apiRequest("POST", `/api/chat/threads/${data.threadId}/auto-title`, {})
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] }))
        .catch(() => {});
    },
    onError: (err: any) => {
      setPanelProgressLabel("");
      setStreamingText("");
      let msg = "Something went wrong — please try again.";
      try {
        const raw = err?.message || "";
        if (raw.includes("timed out") || raw.includes("AbortError")) {
          msg = "Request timed out. Try a simpler question or break it into steps.";
        } else if (raw === "Load failed" || raw === "Failed to fetch" || raw.includes("NetworkError")) {
          msg = "Network error — check your connection and try again.";
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
      const errorContent = msg;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: errorContent },
      ]);
      const threadId = activeThreadId;
      if (threadId) saveMessageMutation.mutate({ threadId, role: "assistant", content: errorContent });
    },
  });

  const teamSendMutation = useMutation({
    mutationFn: async ({ content, threadId, attachments }: { content: string; threadId: string; attachments?: string[] }) => {
      const res = await apiRequest("POST", `/api/chat/threads/${threadId}/messages`, {
        role: "user",
        content,
        attachments,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", activeThreadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: (err: any) => {
      toast({ title: "Message not sent", description: "Could not deliver your message. Please try again.", variant: "destructive" });
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === "user") return prev.slice(0, -1);
        return prev;
      });
    },
    retry: 2,
    retryDelay: 1000,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, aiSendMutation.isPending, teamSendMutation.isPending]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop()); } catch {}
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isRecording) stopRecording();
  }, [activeThreadId]);

  useEffect(() => {
    if (open && textareaRef.current && view === "chat") {
      setTimeout(() => textareaRef.current?.focus(), 200);
    }
  }, [open, view]);

  const isValidFile = (file: File) => {
    if (file.type?.startsWith("image/")) return true;
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    return ACCEPTED_EXTENSIONS.includes(ext);
  };

  const addFiles = useCallback((newFiles: File[]) => {
    const valid = newFiles.filter(isValidFile);
    if (valid.length !== newFiles.length) {
      toast({ title: "Some files skipped", description: "Only Word, PDF, Excel, CSV, text, image, audio, and video files are supported", variant: "destructive" });
    }
    setAttachedFiles((prev) => {
      const combined = [...prev, ...valid];
      if (combined.length > 20) {
        toast({ title: "Too many files", description: "Maximum 20 files at a time", variant: "destructive" });
        return combined.slice(0, 20);
      }
      return combined;
    });
  }, [toast]);

  const pasteHandledRef = useRef(false);

  const addPastedImages = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const normalized = files.map((f, i) => {
      if (f.name && f.name !== "image" && f.name !== "blob" && f.name.includes(".")) return f;
      const ext = f.type?.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return new File([f], `pasted-image-${Date.now()}-${i}.${ext}`, { type: f.type || "image/png" });
    });
    setAttachedFiles((prev) => {
      const combined = [...prev, ...normalized];
      return combined.length > 20 ? combined.slice(0, 20) : combined;
    });
  }, []);

  const extractImagesFromClipboard = useCallback((clipData: DataTransfer): File[] => {
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

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const clipData = e.clipboardData;
    if (!clipData) return;

    // A file copied in Finder / Explorer arrives with BOTH the real file
    // in clipboardData.files AND its filename as text/plain — without this
    // check the text-preference guard below wins and pasting just inserts
    // the file's NAME (Woody, 2026-08-05). Copied styled text (Word /
    // Docs) also carries an image-preview file, so only attach when the
    // text is nothing more than the copied files' own names/paths.
    const copiedFiles = Array.from(clipData.files || []).filter(f => f && f.size > 0);
    const clipText = clipData.getData("text/plain") || "";
    const textIsJustFileNames = copiedFiles.length > 0 && (
      !clipText.trim() ||
      clipText.trim().split(/[\r\n]+/).every(line => {
        const l = line.trim().toLowerCase();
        if (!l) return true;
        if (l.startsWith("file://")) return true;
        return copiedFiles.some(f => {
          const n = (f.name || "").toLowerCase();
          return !!n && (l === n || l.endsWith("/" + n) || l.endsWith("\\" + n));
        });
      })
    );
    if (copiedFiles.length > 0 && textIsJustFileNames) {
      e.preventDefault();
      pasteHandledRef.current = true;
      setTimeout(() => { pasteHandledRef.current = false; }, 100);
      addPastedImages(copiedFiles);
      return;
    }

    // Prefer text. Many apps (macOS Word/Pages, Google Docs, styled web
    // pages) put BOTH text/plain AND an image preview in the clipboard
    // when you copy formatted text. Without this guard, pasting text
    // from those apps lands as an image attachment instead of text in
    // the input. If meaningful plain text is present, let the default
    // paste happen and skip image extraction entirely.
    const plainText = clipData.getData("text/plain");
    if (plainText && plainText.trim().length > 0) {
      // Don't preventDefault — the browser will insert the text into
      // the textarea naturally.
      return;
    }

    const imageFiles = extractImagesFromClipboard(clipData);

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
  }, [extractImagesFromClipboard, addPastedImages, tryClipboardApiFallback, proxyExternalImage, toast]);

  useEffect(() => {
    if (!open || view !== "chat") return;
    const handler = (e: ClipboardEvent) => {
      if (pasteHandledRef.current) return;
      const clipData = e.clipboardData;
      if (!clipData) return;

      // Same text-preference rule as the onPaste handler — the
      // document-level listener also has to bail out when text is
      // present, or pasting from Word/Docs outside the textarea still
      // gets hijacked into an image attachment.
      const plainText = clipData.getData("text/plain");
      if (plainText && plainText.trim().length > 0) return;

      const imageFiles = extractImagesFromClipboard(clipData);
      if (imageFiles.length > 0) {
        e.preventDefault();
        addPastedImages(imageFiles);
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [open, view, extractImagesFromClipboard, addPastedImages]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    const types = e.dataTransfer.types;
    if (types.includes("Files") || types.includes("text/html") || types.includes("text/plain")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      addFiles(droppedFiles);
      return;
    }

    // Handle dragged text/HTML (e.g. from Outlook web email drag)
    const html = e.dataTransfer.getData("text/html");
    const text = e.dataTransfer.getData("text/plain");
    if (html || text) {
      const content = text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (content.length > 0) {
        // Wrap as a fake .eml file so it gets processed as an email
        const blob = new Blob([content], { type: "text/plain" });
        const file = new File([blob], `dropped-email-${Date.now()}.eml`, { type: "message/rfc822" });
        addFiles([file]);
        toast({ title: "Email content captured", description: "I'll process this email for you." });
      }
    }
  }, [addFiles, toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) {
      addFiles(selected);
    }
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      } else {
        setIsRecording(false);
        setRecordingDuration(0);
      }
    } catch {
      setIsRecording(false);
      setRecordingDuration(0);
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop()); } catch {}
      }
    }
  }, []);

  const sendVoiceNote = useCallback(async (audioBlob: Blob) => {
    const ext = audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm";
    const fileName = `voice-note-${Date.now()}.${ext}`;
    const formData = new FormData();
    formData.append("files", new File([audioBlob], fileName, { type: audioBlob.type }));

    try {
      const res = await fetch("/api/chat/upload", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.files?.[0]) {
        toast({ title: "Voice note failed", description: "Could not upload recording", variant: "destructive" });
        return;
      }

      const uploaded = data.files[0];
      const attachmentJson = JSON.stringify({ url: uploaded.url, name: fileName, type: uploaded.type, size: uploaded.size });
      const content = "🎤 Voice note";

      if (isActiveThreadAi || !activeThreadId) {
        const userMessage: LocalChatMessage = {
          role: "user",
          content,
          attachments: [attachmentJson],
          userName: currentUser?.name,
        };
        setMessages(prev => [...prev, userMessage]);

        if (activeThreadId) {
          saveMessageMutation.mutate({ threadId: activeThreadId, role: "user", content, attachments: [attachmentJson] });
          queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", activeThreadId] });
          queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
        }
      } else if (activeThreadId) {
        const userMessage: LocalChatMessage = {
          role: "user",
          content,
          attachments: [attachmentJson],
          userName: currentUser?.name,
          userId: currentUser?.id,
        };
        setMessages(prev => [...prev, userMessage]);

        teamSendMutation.mutate({
          content,
          threadId: activeThreadId,
          attachments: [attachmentJson],
        });
      }
    } catch {
      toast({ title: "Voice note failed", description: "Network error", variant: "destructive" });
    }
  }, [activeThreadId, isActiveThreadAi, currentUser, toast, saveMessageMutation, teamSendMutation]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = "";
      for (const mt of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
        try { if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; } } catch {}
      }
      const recorderOpts = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, recorderOpts);
      const actualMime = recorder.mimeType || mimeType || "audio/webm";
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        setIsRecording(false);
        setRecordingDuration(0);
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
        if (audioBlob.size > 100 && !unmountedRef.current) {
          sendVoiceNote(audioBlob);
        }
      };

      recorder.onerror = () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        setIsRecording(false);
        setRecordingDuration(0);
        if (!unmountedRef.current) {
          toast({ title: "Recording failed", description: "Could not record audio", variant: "destructive" });
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch {
      toast({ title: "Microphone access denied", description: "Please allow microphone access to record voice notes", variant: "destructive" });
    }
  }, [sendVoiceNote, toast]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, stopRecording, startRecording]);

  const isSending = aiSendMutation.isPending || teamSendMutation.isPending;

  useEffect(() => {
    if (pendingPromptRef.current && !isSending && input === pendingPromptRef.current) {
      const prompt = pendingPromptRef.current;
      pendingPromptRef.current = null;
      const userMessage: LocalChatMessage = {
        role: "user",
        content: prompt,
        userName: currentUser?.name,
      };
      setMessages([userMessage]);
      setInput("");
      aiSendMutation.mutate({ newMessages: [userMessage], files: [], threadId: null });
    }
  }, [input, isSending]);

  const processNextMessage = useCallback((queuedContent?: string, queuedFiles?: File[]) => {
    const content = queuedContent ?? "";
    const files = queuedFiles ?? [];

    if (isActiveThreadAi || !activeThreadId) {
      const userMessage: LocalChatMessage = {
        role: "user",
        content,
        attachments: files.length > 0 ? files.map(f => f.name) : undefined,
        userName: currentUser?.name,
      };
      setMessages(prev => {
        const newMessages = [...prev, userMessage];
        aiSendMutation.mutate({ newMessages, files, threadId: activeThreadId });
        return newMessages;
      });
    } else {
      const userMessage: LocalChatMessage = {
        role: "user",
        content,
        userName: currentUser?.name,
        userId: currentUser?.id,
      };
      setMessages(prev => [...prev, userMessage]);

      // The server owns AI replies in team threads: it auto-joins ChatBGP on
      // an @mention and triggers the group responder — one code path, no
      // double-reply when the AI is already a member.
      if (activeThreadId) {
        teamSendMutation.mutate({ content, threadId: activeThreadId });
      }
    }
  }, [activeThreadId, currentUser, isActiveThreadAi, aiSendMutation, teamSendMutation]);

  // Drain the queue when a mutation finishes
  useEffect(() => {
    if (!isSending && messageQueueRef.current.length > 0) {
      const next = messageQueueRef.current.shift()!;
      processNextMessage(next.content, next.files);
    }
  }, [isSending, processNextMessage]);

  const handleSend = () => {
    const text = input.trim();
    if (!text && attachedFiles.length === 0) return;
    stopTyping();

    let content = text || (attachedFiles.length > 0 ? `Please process these ${attachedFiles.length} file(s)` : "");
    // Swap the readable "@Name" inserts for durable tag tokens. Longest
    // names first so "@Bluewater Shopping Centre" wins over "@Bluewater".
    if (pendingTagsRef.current.size > 0) {
      const entries = [...pendingTagsRef.current.entries()].sort((a, b) => b[0].length - a[0].length);
      for (const [key, tag] of entries) {
        if (content.includes(key)) {
          content = content.split(key).join(buildTagToken(tag.type, tag.id, tag.name));
        }
      }
      pendingTagsRef.current.clear();
    }
    const filesToSend = [...attachedFiles];
    setInput("");
    setAttachedFiles([]);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    if (isSending) {
      // Queue the message — it will be sent when the current response finishes
      messageQueueRef.current.push({ content, files: filesToSend });
      return;
    }

    processNextMessage(content, filesToSend);
  };

  const handleCheckboxClick = useCallback((text: string) => {
    if (!activeThreadId || isSending) return;
    const userMessage: LocalChatMessage = { role: "user", content: text, userName: currentUser?.name, userId: currentUser?.id };
    setMessages(prev => [...prev, userMessage]);
    if (isActiveThreadAi) {
      const newMessages = [...messages, userMessage];
      aiSendMutation.mutate({ newMessages, files: [], threadId: activeThreadId });
    } else {
      teamSendMutation.mutate({ content: text, threadId: activeThreadId });
    }
  }, [activeThreadId, isSending, currentUser, messages, isActiveThreadAi, aiSendMutation, teamSendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery !== null && mentionOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleOptionSelect(mentionOptions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        setMentionStart(-1);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewAiChat = () => {
    setActiveThreadId(null);
    setMessages([]);
    setInput("");
    setAttachedFiles([]);
    setView("chat");
  };

  const handleOpenAiFullPage = (threadId?: string) => {
    if (threadId) {
      handleSelectThread(threadId);
    } else {
      setActiveThreadId(null);
      setMessages([]);
      setAttachedFiles([]);
      setInput("");
      setView("chat");
    }
  };

  const handleNewGroupChat = () => {
    setView("new-group");
  };

  const handleCreateGroup = (title: string, memberIds: string[]) => {
    createThreadMutation.mutate({ title, isAiChat: false, memberIds });
  };

  const handleSuggestion = (text: string) => {
    const newMessages: LocalChatMessage[] = [{ role: "user", content: text, userName: currentUser?.name }];
    setMessages(newMessages);
    aiSendMutation.mutate({ newMessages, files: [], threadId: activeThreadId });
  };

  const handleSelectThread = (threadId: string) => {
    setActiveThreadId(threadId);
    setView("chat");
    queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
  };

  // Media/Links/Docs dialog for the open conversation.
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);

  // The /chatbgp Messages list can hand a team thread to this panel (App
  // opens the panel; this selects the conversation).
  useEffect(() => {
    const onOpenTeamThread = (e: Event) => {
      const threadId = (e as CustomEvent).detail?.threadId;
      if (threadId) handleSelectThread(threadId);
    };
    window.addEventListener("bgp:open-team-thread", onOpenTeamThread);
    return () => window.removeEventListener("bgp:open-team-thread", onOpenTeamThread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteThread = async (threadId: string) => {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await apiRequest("DELETE", `/api/chat/threads/${threadId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setView("threads");
      }
      toast({ title: "Thread deleted" });
    } catch {
      toast({ title: "Failed to delete thread", variant: "destructive" });
    }
  };

  const unseenCount = notifications?.unseenCount || 0;
  const threadMembers = activeThread?.members || [];
  const threadCreatorId = activeThread?.createdBy || currentUser?.id || "";

  const headerTitle = view === "new-group"
    ? "New message"
    : view === "threads"
      ? "Chat"
      : activeThread
        ? (activeThread.title || "Chat")
        : (isActiveThreadAi ? "ChatBGP" : "Chat");

  // Keep the panel mounted when closed so the conversation (messages,
  // activeThreadId, input, attachments) survives minimising. Hide via
  // `hidden` so layout collapses and nothing in the closed panel receives
  // focus / drag events.
  return (
    <div
      className={`h-full w-full fixed inset-0 z-50 md:static md:w-[340px] md:ml-6 md:z-auto shrink-0 border-l bg-background flex flex-col ${open ? "" : "hidden"}`}
      data-testid="chat-panel"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-background/95 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none animate-in fade-in duration-150">
          <div className="text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Paperclip className="w-8 h-8 text-primary" />
            </div>
            <p className="text-base font-semibold text-primary mb-1">Drop anything here</p>
            <div className="flex flex-wrap gap-1.5 justify-center mt-3">
              {[
                { icon: "📄", label: "PDF / Word" },
                { icon: "📊", label: "Excel / CSV" },
                { icon: "🖼️", label: "Images" },
                { icon: "🎙️", label: "Audio / Video" },
                { icon: "📧", label: "Emails (.eml)" },
              ].map(({ icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1 text-[11px] bg-primary/10 text-primary rounded-full px-2.5 py-1">
                  {icon} {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0 bg-background">
        <div className="flex items-center gap-2 min-w-0">
          {view === "chat" && !activeThreadId && showSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setShowSidebar(false)}
              data-testid="button-toggle-sidebar"
              title="Chat history"
            >
              <ArrowLeft className={`w-4 h-4 transition-transform rotate-180`} />
            </Button>
          )}
          {view === "chat" && !(showSidebar && !activeThreadId) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => {
                setActiveThreadId(null);
                setMessages([]);
                setView("threads");
              }}
              data-testid="button-back-to-inbox"
              title="All conversations"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          {view === "new-group" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setView("threads")}
              data-testid="button-back-to-inbox-from-group"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {view === "chat" && isActiveThreadAi && <Sparkles className="w-4 h-4 text-foreground shrink-0" />}
              {view === "chat" && !isActiveThreadAi && activeThreadId && <Users className="w-4 h-4 text-muted-foreground shrink-0" />}
              <span className="font-semibold text-[14px] truncate">{headerTitle}</span>
            </div>
            {activeThreadId && view === "chat" && (threadMembers.length > 0 || activeThread?.hasAiMember) && (
              <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                {[
                  ...threadMembers.slice(0, 4).map(m => m.name.split(" ")[0]),
                  ...(activeThread?.hasAiMember && !isActiveThreadAi ? ["ChatBGP"] : []),
                ].join(", ")}
                {threadMembers.length > 4 && ` +${threadMembers.length - 4}`}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {view === "chat" && !activeThreadId && !chatIsClient && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 relative"
              onClick={() => {
                setShowSidebar(false);
                setView("threads");
              }}
              data-testid="button-team-messages"
              title="Team messages"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              {unseenCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-medium">
                  {unseenCount > 99 ? "99+" : unseenCount}
                </span>
              )}
            </Button>
          )}
          {view === "chat" && activeThreadId && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setMediaDialogOpen(true)}
                title="Shared media, links & docs"
                data-testid="button-thread-media"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </Button>
              <AddMemberPopover
                threadId={activeThreadId}
                existingMemberIds={threadMembers.map(m => m.id)}
                creatorId={threadCreatorId}
                hasAiMember={!!activeThread?.hasAiMember}
              />
              <PropertyPicker
                threadId={activeThreadId}
                currentPropertyName={activeThread?.propertyName || null}
              />
            </>
          )}
          {view === "chat" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              // Carry the open thread into the full-page view so the
              // conversation follows you instead of opening blank. Without
              // the ?thread= param the page only had activeThreadId in
              // context but never loaded its messages — the "it clears when
              // I expand / move screen" complaint.
              onClick={() => navigate(activeThreadId ? `/chatbgp?thread=${activeThreadId}` : "/chatbgp")}
              data-testid="button-panel-expand"
              title="Open full screen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            data-testid="button-panel-close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {showSidebar && view === "chat" && !activeThreadId && (() => {
        const aiThreads = (threads || []).filter(t => t.isAiChat);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(todayStart.getTime() - 7 * 86400000);
        const todayThreads = aiThreads.filter(t => new Date(t.updatedAt) >= todayStart);
        const weekThreads = aiThreads.filter(t => { const d = new Date(t.updatedAt); return d < todayStart && d >= weekAgo; });
        const olderThreads = aiThreads.filter(t => new Date(t.updatedAt) < weekAgo);
        const groups = [
          { label: "Today", items: todayThreads },
          { label: "Previous 7 Days", items: weekThreads },
          { label: "Older", items: olderThreads },
        ].filter(g => g.items.length > 0);

        return (
          <div className="absolute inset-0 top-[45px] z-40 bg-background animate-in slide-in-from-left duration-200 flex flex-col">
            <div className="px-2 py-1.5 shrink-0">
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium hover:bg-muted/60 transition-colors"
                onClick={() => { setShowSidebar(false); setActiveThreadId(null); setMessages([]); }}
                data-testid="sidebar-chatbgp-home"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span className="truncate">ChatBGP</span>
              </button>
            </div>
            <div className="h-px bg-border mx-3 shrink-0" />
            <div className="flex-1 overflow-y-auto min-h-0 px-2 py-1">
              {groups.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  <MessageCircle className="w-6 h-6 mx-auto mb-2 opacity-20" />
                  <p>No conversations yet</p>
                </div>
              ) : (
                groups.map(group => (
                  <div key={group.label} className="mb-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pt-2.5 pb-1">
                      {group.label}
                    </p>
                    {group.items.map(thread => (
                      <button
                        key={thread.id}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors flex items-center gap-2.5"
                        onClick={() => {
                          setShowSidebar(false);
                          handleSelectThread(thread.id);
                        }}
                        data-testid={`sidebar-thread-${thread.id}`}
                      >
                        <MessageCircle className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-[13px] truncate">{thread.title || "Untitled"}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })()}

      {view === "threads" ? (
        <ThreadList
          threads={threads || []}
          onSelect={handleSelectThread}
          onNewGroupChat={handleNewGroupChat}
          unseenCount={unseenCount}
          onOpenAiFullPage={handleOpenAiFullPage}
          onDeleteThread={handleDeleteThread}
          currentUserId={currentUser?.id}
          userPics={userPics}
        />
      ) : view === "new-group" ? (
        <NewGroupView
          allUsers={allUsers || []}
          currentUserId={currentUser?.id || ""}
          onCreate={handleCreateGroup}
        />
      ) : (isActiveThreadAi || !activeThreadId) && !status?.connected ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="text-sm font-semibold mb-1">Not Connected</h3>
          <p className="text-xs text-muted-foreground">
            AI service is not configured.
          </p>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3" ref={scrollRef}>
            {messages.length === 0 && isActiveThreadAi ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-14 h-14 rounded-2xl bg-gray-900 text-white flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h2 className="text-base font-semibold mb-1">ChatBGP</h2>
                <p className="text-[13px] text-muted-foreground mb-5">
                  Ask questions, run models, or generate documents.
                </p>
                <div className="grid grid-cols-1 gap-2 w-full">
                  {(chatIsClient ? CLIENT_AI_SUGGESTIONS : AI_SUGGESTIONS).map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestion(s)}
                      className="text-left p-3 rounded-xl border bg-card text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      data-testid={`button-panel-suggestion-${i}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : messages.length === 0 && !isActiveThreadAi ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Users className="w-7 h-7 text-muted-foreground" />
                </div>
                <h2 className="text-base font-semibold mb-1">{activeThread?.title || "Group Chat"}</h2>
                <p className="text-[13px] text-muted-foreground mb-2">
                  Send a message to get started.
                </p>
                <p className="text-xs text-muted-foreground">
                  Type <span className="font-semibold text-foreground">@ChatBGP</span> to ask the AI assistant.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, i) => (
                  <MessageBubble
                    key={msg.id || i}
                    message={msg}
                    currentUserId={currentUser?.id}
                    threadId={activeThreadId}
                    isGroupChat={!isActiveThreadAi && (activeThread?.members?.length || 0) > 1}
                    onEdit={handleEditMessage}
                    onDelete={handleDeleteMessage}
                    onCheckboxClick={handleCheckboxClick}
                  />
                ))}
                {aiSendMutation.isPending && (
                  streamingText ? (
                    // Live draft — tokens render as they stream, claude.ai-style.
                    <div className="flex justify-start" data-testid="panel-streaming-response">
                      <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3 max-w-full overflow-hidden">
                        <ChatBGPMarkdown content={streamingText} />
                        <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-muted-foreground/50 animate-pulse" />
                      </div>
                    </div>
                  ) : (
                  <div className="flex justify-start" data-testid="panel-loading-response">
                    <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        {panelProgressLabel && (
                          <span className="text-[11px] text-muted-foreground animate-pulse">{panelProgressLabel}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  )
                )}
                {typingUsers.length > 0 && !aiSendMutation.isPending && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="typing-indicator">
                    <div className="flex gap-1">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span>
                      {typingUsers.length === 1
                        ? `${typingUsers[0].userId === "__chatbgp__" ? "ChatBGP" : allUsers?.find(u => u.id === typingUsers[0].userId)?.name?.split(" ")[0] || "Someone"} is typing...`
                        : `${typingUsers.length} people typing...`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t p-3 shrink-0">
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {attachedFiles.map((file, i) => {
                  const isImage = file.type?.startsWith("image/");
                  let thumbUrl: string | null = null;
                  if (isImage) {
                    try { thumbUrl = URL.createObjectURL(file); } catch {}
                  }
                  return (
                    <span
                      key={`${file.name}-${file.size}-${i}`}
                      className="inline-flex items-center gap-1 text-[10px] bg-muted rounded px-1.5 py-1 max-w-full"
                    >
                      {thumbUrl ? (
                        <img src={thumbUrl} alt={file.name} className="w-6 h-6 rounded object-cover shrink-0" onLoad={() => { try { URL.revokeObjectURL(thumbUrl!); } catch {} }} />
                      ) : isImage ? (
                        <ImageIcon className="w-2.5 h-2.5 shrink-0" />
                      ) : (
                        <FileIcon className="w-2.5 h-2.5 shrink-0" />
                      )}
                      <span className="truncate max-w-[100px]">{file.name}</span>
                      <button
                        onClick={() => removeFile(i)}
                        className="ml-0.5 hover:text-destructive shrink-0"
                        data-testid={`button-remove-chat-file-${i}`}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              {isActiveThreadAi && (
                <>
                  <input
                    ref={fileInputRef}
                    id="chat-panel-file-upload"
                    type="file"
                    className="sr-only"
                    accept=".docx,.pdf,.doc,.txt,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.heic,.mp3,.mp4,.m4a,.wav,.webm,.ogg,.aac,.mov,.avi,.mkv,.flac,image/*,audio/*,video/*"
                    multiple
                    tabIndex={-1}
                    onChange={handleFileSelect}
                    data-testid="input-chat-file-upload"
                  />
                  <label
                    htmlFor="chat-panel-file-upload"
                    className={`shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer${isSending ? " pointer-events-none opacity-50" : ""}`}
                    data-testid="button-chat-attach-file"
                    title="Attach files"
                  >
                    <Paperclip className="w-4 h-4" />
                  </label>
                </>
              )}
              {isRecording ? (
                <>
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800" data-testid="recording-indicator">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                    <span className="text-[13px] text-red-600 dark:text-red-400 font-medium">
                      Recording {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    className="shrink-0 h-10 w-10 rounded-full bg-red-600 text-white hover:bg-red-700"
                    onClick={toggleRecording}
                    data-testid="button-stop-recording"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="relative flex-1">
                    {mentionQuery !== null && mentionOptions.length > 0 && (
                      <div
                        ref={mentionRef}
                        className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden"
                        data-testid="mention-dropdown"
                      >
                        <div className="max-h-[280px] overflow-y-auto">
                          {mentionOptions.map((opt, i) => {
                            const groupOf = (o: typeof opt) =>
                              o.kind === "chatbgp" ? "AI" :
                              o.kind === "user" ? "People" :
                              o.type === "company" ? "Brands & companies" :
                              o.type === "property" ? "Properties" :
                              o.type === "deal" ? "Deals" :
                              o.type === "unit" ? "Letting tracker" :
              o.type === "folder" ? "Folders" : "Contacts";
                            const group = groupOf(opt);
                            const showHeader = i === 0 || groupOf(mentionOptions[i - 1]) !== group;
                            const optKey = opt.kind === "chatbgp" ? "chatbgp" : `${opt.kind === "entity" ? opt.type : "user"}-${opt.id}`;
                            return (
                              <div key={optKey}>
                                {showHeader && (
                                  <div className="px-2 py-1 border-b bg-muted/40">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{group}</p>
                                  </div>
                                )}
                                <button
                                  className={`w-full flex items-center gap-2 px-2.5 py-2 text-xs text-left transition-colors ${
                                    i === mentionIndex ? "bg-accent" : "hover:bg-accent/50"
                                  }`}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleOptionSelect(opt);
                                  }}
                                  onMouseEnter={() => setMentionIndex(i)}
                                  data-testid={`mention-option-${optKey}`}
                                >
                                  {opt.kind === "chatbgp" ? (
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-800 to-black flex items-center justify-center shrink-0">
                                      <Sparkles className="w-3 h-3 text-white" />
                                    </div>
                                  ) : opt.kind === "user" ? (
                                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                      <span className="text-[10px] font-semibold">{opt.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}</span>
                                    </div>
                                  ) : (
                                    (() => {
                                      const Icon = TAG_META[opt.type]?.icon || Building2;
                                      return (
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${TAG_META[opt.type]?.chip || "bg-muted"}`}>
                                          <Icon className="w-3 h-3" />
                                        </div>
                                      );
                                    })()
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{opt.kind === "chatbgp" ? "ChatBGP" : opt.name}</p>
                                    {opt.kind === "entity" && opt.subtitle && (
                                      <p className="text-[10px] text-muted-foreground truncate">{opt.subtitle}</p>
                                    )}
                                    {opt.kind === "chatbgp" && (
                                      <p className="text-[10px] text-muted-foreground truncate">AI assistant — joins this conversation</p>
                                    )}
                                  </div>
                                  {opt.kind === "user" && activeThreadId && (
                                    <span className="text-[9px] text-muted-foreground shrink-0">
                                      {activeThread?.members?.some((m) => m.id === opt.id) ? "In chat" : "+ Add"}
                                    </span>
                                  )}
                                  {opt.kind === "entity" && (
                                    <span className="text-[9px] text-muted-foreground shrink-0">Tag</span>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <Textarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      placeholder={
                        isActiveThreadAi
                          ? (attachedFiles.length > 0 ? "Add instructions for these files..." : "Ask ChatBGP...")
                          : "Message... (@ to mention, @ChatBGP for AI)"
                      }
                      className="resize-none min-h-[60px] max-h-[220px] text-[13px] rounded-xl"
                      rows={1}
                      spellCheck
                      autoCorrect="on"
                      autoCapitalize="sentences"
                      lang="en-GB"
                      data-testid="input-panel-chat-message"
                    />
                  </div>
                  {!input.trim() && attachedFiles.length === 0 ? (
                    <Button
                      size="icon"
                      className="shrink-0 h-10 w-10 rounded-full bg-gray-900 text-white hover:bg-gray-800"
                      onClick={toggleRecording}
                      disabled={isSending}
                      data-testid="button-start-recording"
                    >
                      <Mic className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      className="shrink-0 h-10 w-10 rounded-full bg-gray-900 text-white hover:bg-gray-800"
                      onClick={handleSend}
                      disabled={!input.trim() && attachedFiles.length === 0}
                      data-testid="button-panel-send-message"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

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
      {activeThreadId && (
        <ThreadMediaDialog threadId={activeThreadId} open={mediaDialogOpen} onOpenChange={setMediaDialogOpen} />
      )}
    </div>
  );
}
