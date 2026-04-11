// TODO: This file (~4400 lines) needs major refactoring — extract chat views, property/deal
// panels, and navigation into separate components. The bottom nav system provides an
// alternative mobile navigation path. Be careful: this is deeply coupled and risky to refactor.
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTypingIndicator } from "@/hooks/use-socket";
import { emitMarkSeen } from "@/lib/socket";
import { useLocation } from "wouter";
import { useTeam } from "@/lib/team-context";
import type { User as UserType } from "@shared/schema";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sparkles, Send, Bot, User, X, Trash2,
  ArrowLeft, Users, Check, Building2,
  Link as LinkIcon, Search, Pencil, MoreVertical,
  MessageCircle, CheckCheck, Plus, BarChart3,
  Copy, ChevronDown, ChevronUp,
  Paperclip, File, UserPlus, AlertCircle, Camera, Image,
  Menu, MessageSquare, FileText, Handshake,
  Newspaper, Mail, Phone, Download, Eye, Star, Upload,
  Mic, Square, Building, Link2,
  Palette, ChevronRight,
} from "lucide-react";
import { useTheme, COLOR_SCHEMES } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
};

type LocalChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  action?: ChatAction;
  attachments?: string[];
  userName?: string;
  userId?: string | null;
  createdAt?: string;
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
  groupPicUrl: string | null;
  createdAt: string;
  updatedAt: string;
  members: ThreadMember[];
  lastMessage?: { content: string; senderName: string; createdAt: string } | null;
  messages?: Array<{
    id: string; threadId: string; role: string; content: string;
    userId: string | null; actionData: string | null; attachments: string[] | null; createdAt: string;
  }>;
};

const AI_SUGGESTIONS = [
  "Show me live deals",
  "What's in my calendar today?",
  "Draft HOTs for a property",
  "Search CRM contacts",
];

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"];
const isImageFile = (nameOrType: string) => {
  if (nameOrType.startsWith("image/")) return true;
  const ext = nameOrType.split(".").pop()?.toLowerCase() || "";
  return ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"].includes(ext);
};
const isAudioFile = (nameOrType: string) => {
  if (nameOrType.startsWith("audio/")) return true;
  const ext = nameOrType.split(".").pop()?.toLowerCase() || "";
  return ["webm", "ogg", "m4a", "wav", "mp3", "mp4", "opus"].includes(ext);
};
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type MoreSubTab = "people" | "tracker" | "news" | "docs";

function ActionCard({ action }: { action: ChatAction }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const cardBg = "bg-white";
  const textPrimary = "text-black";
  const textMuted = "text-gray-500";
  const btnClass = "";

  if (action.type === "model_run") {
    const outputEntries = Object.entries(action.outputs);
    return (
      <div className={`mt-2 rounded-lg border p-3 text-sm ${cardBg}`}>
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className={`w-4 h-4 ${textPrimary}`} />
          <span className={`font-semibold ${textPrimary}`}>{action.name}</span>
        </div>
        <div className="grid grid-cols-1 gap-1">
          {outputEntries.slice(0, expanded ? undefined : 6).map(([key, val]) => {
            const mapping = action.outputMapping[key];
            return (
              <div key={key} className="flex justify-between gap-2 py-0.5">
                <span className={`truncate ${textMuted}`}>{mapping?.label || key}</span>
                <span className={`font-medium shrink-0 ${textPrimary}`}>{val}</span>
              </div>
            );
          })}
        </div>
        {outputEntries.length > 6 && (
          <button onClick={() => setExpanded(!expanded)} className={`flex items-center gap-1 text-xs mt-2 font-medium ${textPrimary}`}>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Show less" : `+${outputEntries.length - 6} more`}
          </button>
        )}
      </div>
    );
  }

  if (action.type === "document_generate") {
    return (
      <div className={`mt-2 rounded-lg border p-3 text-sm ${cardBg}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileText className={`w-4 h-4 ${textPrimary}`} />
            <span className={`font-semibold ${textPrimary}`}>{action.templateName}</span>
          </div>
          <Button variant="ghost" size="sm" className={`h-7 text-xs px-2 ${btnClass}`} onClick={() => { navigator.clipboard.writeText(action.content); toast({ title: "Copied" }); }}>
            <Copy className="w-3 h-3 mr-1" /> Copy
          </Button>
        </div>
        <div className={`whitespace-pre-wrap leading-relaxed ${expanded ? "" : "max-h-[120px] overflow-hidden"} ${textMuted}`}>
          {action.content}
        </div>
        {action.content.length > 300 && (
          <button onClick={() => setExpanded(!expanded)} className={`flex items-center gap-1 text-xs mt-2 font-medium ${textPrimary}`}>
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
      <div className={`mt-2 rounded-lg border p-2 ${cardBg}`}>
        <img
          src={imgSrc}
          alt={action.prompt}
          className="rounded-md max-w-full max-h-[250px] object-contain"
          data-testid="img-generated-image-mobile"
        />
        <div className={`text-xs mt-1 italic truncate ${textMuted}`}>{action.prompt}</div>
      </div>
    );
  }

  return null;
}

const NAME_COLORS = [
  "text-rose-600", "text-blue-600", "text-emerald-600", "text-purple-600",
  "text-orange-600", "text-teal-600", "text-pink-600", "text-indigo-600",
  "text-amber-700", "text-cyan-600", "text-red-500", "text-violet-600",
  "text-lime-700", "text-fuchsia-600", "text-sky-600", "text-yellow-700",
];

function getNameColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

function isSafeUrl(url: string) {
  return url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://");
}

function renderInlineImages(text: string) {
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const parts: Array<string | { alt: string; url: string }> = [];
  let lastIndex = 0;
  let match;
  while ((match = imgRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (isSafeUrl(match[2])) {
      parts.push({ alt: match[1], url: match[2] });
    } else {
      parts.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  if (parts.length === 1 && typeof parts[0] === "string") return null;
  return parts.map((p, i) => typeof p === "string" ? <span key={i}>{p}</span> : (
    <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block my-1">
      <img src={p.url} alt={p.alt} className="rounded-xl max-w-[260px] max-h-[300px] object-cover" />
    </a>
  ));
}

function renderFormattedText(text: string, isUserBubble?: boolean): (string | JSX.Element)[] {
  const tokenRegex = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\*\*(.+?)\*\*|(https?:\/\/[^\s<>)\]]+)/g;
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
      const linkColor = isUserBubble ? "text-blue-300" : "text-blue-600";
      result.push(
        <a key={key++} href={match[4]} target="_blank" rel="noopener noreferrer"
          className={`underline ${linkColor}`}
        >{match[3]}</a>
      );
    } else if (match[5]) {
      result.push(<strong key={key++}>{match[5]}</strong>);
    } else if (match[6]) {
      const url = match[6].replace(/[.,;:!?]+$/, "");
      const trailing = match[6].slice(url.length);
      const linkColor = isUserBubble ? "text-blue-300" : "text-blue-600";
      result.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer"
          className={`underline break-all ${linkColor}`}
        >{url}</a>
      );
      if (trailing) result.push(trailing);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) result.push(text.slice(lastIndex));
  return result;
}

function RenderMessageContent({ content, onCheckboxClick, isUserBubble, selectedCheckboxes }: { content: string; onCheckboxClick?: (text: string) => void; isUserBubble?: boolean; selectedCheckboxes?: string[] }) {
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
    const formatted = renderFormattedText(content, isUserBubble);
    const hasFormatting = formatted.length !== 1 || typeof formatted[0] !== "string";
    if (hasFormatting) return <>{formatted}</>;
    return <>{content}</>;
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
          const formatted = renderFormattedText(part.text, isUserBubble);
          const hasFormatting = formatted.length !== 1 || typeof formatted[0] !== "string";
          if (hasFormatting) return <span key={i}>{formatted}{i < parts.length - 1 ? "\n" : ""}</span>;
          return <span key={i}>{part.text}{i < parts.length - 1 ? "\n" : ""}</span>;
        }
        {
          const isSelected = selectedCheckboxes?.includes(part.text);
          const handleTap = (e: React.SyntheticEvent) => {
            e.stopPropagation();
            onCheckboxClick?.(part.text);
          };
          return (
            <button
              key={i}
              onClick={handleTap}
              className={`flex items-center gap-2 w-full text-left py-2.5 px-3 my-1 rounded-xl shadow-sm active:scale-[0.98] transition-all cursor-pointer touch-manipulation ${isSelected ? "bg-black/5 border-2 border-black" : "bg-white/80 border border-gray-200"}`}
              style={{ WebkitTapHighlightColor: "transparent", WebkitTouchCallout: "none", userSelect: "none" }}
              data-testid={`checkbox-action-${i}`}
            >
              <span className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${isSelected ? "border-black bg-black" : "border-gray-400"}`}>
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </span>
              <span className="text-[15px] leading-tight">{part.text}</span>
            </button>
          );
        }
      })}
    </>
  );
}

function formatMsgTime(dateStr?: string) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}

function MobileMessageBubble({ message, currentUserId, threadId, isGroupChat, onEdit, onDelete, onCheckboxClick, selectedCheckboxes, isAiThread }: {
  message: LocalChatMessage;
  currentUserId?: string;
  threadId?: string | null;
  isGroupChat?: boolean;
  onEdit?: (msgId: string, content: string) => void;
  onDelete?: (msgId: string) => void;
  onCheckboxClick?: (text: string) => void;
  selectedCheckboxes?: string[];
  isAiThread?: boolean;
}) {
  const isUser = message.role === "user";
  const isOwn = isUser && currentUserId && message.userId === currentUserId;
  const isOtherUser = isUser && !isOwn;
  const isAiMsg = !isUser && isAiThread;
  const showName = isGroupChat && message.userName && (isOtherUser || message.role === "assistant");
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [showActions, setShowActions] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    toast({ title: "Copied" });
    setShowActions(false);
  };

  const handleLongPress = useRef<NodeJS.Timeout | null>(null);
  const handleTouchStart = () => {
    handleLongPress.current = setTimeout(() => setShowActions(true), 400);
  };
  const handleTouchEnd = () => {
    if (handleLongPress.current) clearTimeout(handleLongPress.current);
  };

  const renderAttachments = () => {
    if (!message.attachments || message.attachments.length === 0) return null;
    return (
      <div className="flex flex-col gap-2 mb-2">
        {message.attachments.map((att, i) => {
          const parsed = (() => { try { return JSON.parse(att); } catch { return null; } })();
          if (parsed && parsed.url) {
            if (isAudioFile(parsed.type || parsed.name || "")) {
              return (
                <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5 bg-gray-100 rounded-2xl">
                  <Mic className="w-4 h-4 text-primary shrink-0" />
                  <audio controls preload="none" className="h-8 max-w-[220px]">
                    <source src={parsed.url} />
                  </audio>
                </div>
              );
            }
            if (isImageFile(parsed.type || parsed.name || "")) {
              return (
                <a key={i} href={parsed.url} target="_blank" rel="noopener noreferrer" className="block">
                  <img src={parsed.url} alt={parsed.name} className="rounded-2xl max-w-[260px] max-h-[300px] object-cover shadow-sm" />
                </a>
              );
            }
            return (
              <a key={i} href={parsed.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-white border border-gray-100 shadow-sm">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gray-50">
                  <File className="w-5 h-5 text-gray-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium truncate text-gray-900">{parsed.name}</div>
                  {parsed.size && <div className="text-[12px] text-gray-400">{formatFileSize(parsed.size)}</div>}
                </div>
              </a>
            );
          }
          if (isImageFile(att)) {
            return (
              <a key={i} href={att} target="_blank" rel="noopener noreferrer" className="block">
                <img src={att} alt="attachment" className="rounded-2xl max-w-[260px] max-h-[300px] object-cover shadow-sm" />
              </a>
            );
          }
          return (
            <span key={i} className="inline-flex items-center gap-2 text-[13px] rounded-xl px-3 py-1.5 bg-gray-100">
              <File className="w-4 h-4 text-gray-400" /> {att}
            </span>
          );
        })}
      </div>
    );
  };

  if (isAiMsg) {
    return (
      <div className="flex items-start gap-3" data-testid={`mobile-message-${message.role}`}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: "hsl(var(--primary))" }}>
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          {renderAttachments()}
          {editing ? (
            <div className="space-y-2">
              <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="min-h-[44px] text-[15px] resize-none rounded-xl" rows={2} autoFocus />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" className="h-8 text-sm px-3 rounded-xl" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" className="h-8 text-sm px-3 rounded-xl bg-black text-white hover:bg-gray-800" onClick={() => { if (message.id && onEdit && editContent.trim()) { onEdit(message.id, editContent.trim()); setEditing(false); } }}>Save</Button>
              </div>
            </div>
          ) : (
            <div
              className="relative"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <div className="text-[15px] leading-[1.7] text-gray-900 whitespace-pre-wrap break-words">
                <RenderMessageContent content={message.content} onCheckboxClick={onCheckboxClick} isUserBubble={false} selectedCheckboxes={selectedCheckboxes} />
              </div>
              {showActions && (
                <div className="absolute -top-8 left-0 flex items-center gap-1 bg-white rounded-xl shadow-lg border border-gray-200 px-1 py-1 z-20 animate-in fade-in zoom-in-95 duration-150">
                  <button onClick={handleCopy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-gray-700 active:bg-gray-100" data-testid="button-copy-message">
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                  <div className="w-px h-4 bg-gray-200" />
                  <button onClick={() => setShowActions(false)} className="px-2 py-1.5 rounded-lg active:bg-gray-100">
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                </div>
              )}
            </div>
          )}
          {message.action && <ActionCard action={message.action} />}
          {message.createdAt && (
            <div className="text-[11px] text-gray-400 mt-1.5">{formatMsgTime(message.createdAt)}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`} data-testid={`mobile-message-${message.role}`}>
      <div className={`max-w-[80%] ${isOwn ? "items-end" : "items-start"}`}>
        {showName && message.userName && (
          <div className={`text-[12px] font-semibold mb-1 px-1 ${getNameColor(message.userName)}`}>{message.userName}</div>
        )}
        {renderAttachments()}
        {editing ? (
          <div className="space-y-2">
            <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="min-h-[44px] text-[15px] resize-none rounded-xl" rows={2} autoFocus />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" className="h-8 text-sm px-3 rounded-xl" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" className="h-8 text-sm px-3 rounded-xl bg-black text-white hover:bg-gray-800" onClick={() => { if (message.id && onEdit && editContent.trim()) { onEdit(message.id, editContent.trim()); setEditing(false); } }}>Save</Button>
            </div>
          </div>
        ) : (
          <div
            className="relative"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <div className={`rounded-2xl px-4 py-2.5 text-[15px] leading-[1.6] whitespace-pre-wrap break-words ${
              isOwn
                ? "bg-black text-white rounded-br-md"
                : "bg-white text-gray-900 rounded-bl-md border border-gray-100 shadow-sm"
            }`}>
              <RenderMessageContent content={message.content} onCheckboxClick={!isUser ? onCheckboxClick : undefined} isUserBubble={isOwn ? true : false} selectedCheckboxes={!isUser ? selectedCheckboxes : undefined} />
            </div>
            {showActions && (
              <div className={`absolute -top-8 ${isOwn ? "right-0" : "left-0"} flex items-center gap-1 bg-white rounded-xl shadow-lg border border-gray-200 px-1 py-1 z-20 animate-in fade-in zoom-in-95 duration-150`}>
                <button onClick={handleCopy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-gray-700 active:bg-gray-100" data-testid="button-copy-message">
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
                {isOwn && message.id && (
                  <>
                    <div className="w-px h-4 bg-gray-200" />
                    <button onClick={() => { setEditContent(message.content); setEditing(true); setShowActions(false); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-gray-700 active:bg-gray-100">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <div className="w-px h-4 bg-gray-200" />
                    <button onClick={() => { onDelete?.(message.id!); setShowActions(false); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-red-500 active:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </>
                )}
                <div className="w-px h-4 bg-gray-200" />
                <button onClick={() => setShowActions(false)} className="px-2 py-1.5 rounded-lg active:bg-gray-100">
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              </div>
            )}
          </div>
        )}
        {message.action && <ActionCard action={message.action} />}
        {message.createdAt && (
          <div className={`text-[11px] text-gray-400 mt-1 px-1 ${isOwn ? "text-right" : ""}`}>{formatMsgTime(message.createdAt)}</div>
        )}
      </div>
    </div>
  );
}

function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void>; children: React.ReactNode }) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!startY.current || refreshing) return;
    if (containerRef.current && containerRef.current.scrollTop > 0) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setPullY(Math.min(dy * 0.4, 80));
  };
  const handleTouchEnd = async () => {
    if (pullY > 50 && !refreshing) {
      setRefreshing(true);
      await onRefresh();
      setRefreshing(false);
    }
    setPullY(0);
    startY.current = 0;
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {(pullY > 0 || refreshing) && (
        <div className="flex items-center justify-center py-3 transition-all" style={{ height: pullY || (refreshing ? 50 : 0) }}>
          {refreshing ? (
            <div className="w-5 h-5 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
          ) : (
            <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${pullY > 50 ? "rotate-180" : ""}`} />
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function ProjectItemRow({ project, isExpanded, singleThread, onToggle, openThread, currentUserId, onDelete, userPics }: {
  project: { type: string; id: string; name: string; threads: any[]; dealChildren: any[] };
  isExpanded: boolean;
  singleThread: any | null;
  onToggle: () => void;
  openThread: (t: any) => void;
  currentUserId?: string;
  onDelete: (id: string) => void;
  userPics?: Record<string, string>;
}) {
  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors select-none"
        onClick={() => {
          if (singleThread) {
            openThread(singleThread);
          } else {
            onToggle();
          }
        }}
        data-testid={`mobile-project-${project.id}`}
      >
        <Building2 className="w-5 h-5 text-gray-600 shrink-0" />
        <span className="flex-1 text-[14px] font-semibold text-left truncate">{project.name}</span>
        {project.threads.length > 1 && (
          <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
        )}
      </button>
      {isExpanded && project.threads.length > 1 && (
        <div className="pl-6">
          {project.threads.map((t: any) => (
            <MobileThreadCard key={t.id} thread={t} onClick={() => openThread(t)} currentUserId={currentUserId} onDelete={onDelete} userPics={userPics} />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileThreadCard({ thread, onClick, currentUserId, onDelete, userPics }: { thread: ThreadData; onClick: () => void; currentUserId?: string; onDelete?: (id: string) => void; userPics?: Record<string, string> }) {
  const [swipeX, setSwipeX] = useState(0);
  const [showDelete, setShowDelete] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasUnseen = thread.members.some(m => !m.seen);
  const isAi = thread.isAiChat;
  const otherMembers = thread.members.filter(m => m.id !== currentUserId);
  const isDm = !isAi && otherMembers.length === 1;
  const dmName = isDm ? otherMembers[0].name : null;
  const dmInitials = dmName ? dmName.split(" ").map(n => n[0]).join("").slice(0, 2) : null;
  const displayTitle = isDm ? dmName : (thread.title || "New conversation");
  const dmPic = isDm && otherMembers[0] ? userPics?.[otherMembers[0].id] : null;

  const timeStr = (() => {
    const d = new Date(thread.updatedAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  })();

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = Math.abs(e.touches[0].clientY - touchStartRef.current.y);
    if (dy > 30) { touchStartRef.current = null; setSwipeX(0); return; }
    if (dx < 0) setSwipeX(Math.max(dx, -100));
  };
  const handleTouchEnd = () => {
    if (swipeX < -60) { setSwipeX(-96); setShowDelete(true); }
    else { setSwipeX(0); setShowDelete(false); }
    touchStartRef.current = null;
  };

  const renderAvatar = () => {
    if (isAi) {
      return (
        <div className="w-[52px] h-[52px] rounded-2xl text-white flex items-center justify-center shrink-0 shadow-sm" style={{ backgroundColor: "hsl(var(--primary))" }}>
          <Sparkles className="w-6 h-6" />
        </div>
      );
    }
    if (isDm && dmPic) {
      return <img src={dmPic} alt={dmName || ""} className="w-[52px] h-[52px] rounded-full object-cover shrink-0 ring-2 ring-gray-100" />;
    }
    if (isDm) {
      return (
        <div className="w-[52px] h-[52px] rounded-full bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center shrink-0">
          <span className="text-[17px] font-bold text-white">{dmInitials}</span>
        </div>
      );
    }
    if (thread.groupPicUrl) {
      return <img src={thread.groupPicUrl} alt="" className="w-[52px] h-[52px] rounded-full object-cover shrink-0 ring-2 ring-gray-100" />;
    }
    if (!isDm && otherMembers.length > 0) {
      const firstPic = otherMembers.find(m => userPics?.[m.id])?.id;
      if (firstPic && userPics?.[firstPic]) {
        return <img src={userPics[firstPic]} alt="" className="w-[52px] h-[52px] rounded-full object-cover shrink-0 ring-2 ring-gray-100" />;
      }
    }
    return (
      <div className="w-[52px] h-[52px] rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center shrink-0">
        <Users className="w-6 h-6 text-gray-500" />
      </div>
    );
  };

  const renderAiMemberBadge = () => {
    if (!thread.hasAiMember || isAi) return null;
    return (
      <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full text-white flex items-center justify-center border-2 border-white" style={{ backgroundColor: "hsl(var(--primary))" }}>
        <Sparkles className="w-2.5 h-2.5" />
      </div>
    );
  };

  return (
    <div className="relative overflow-hidden">
      <button
        className="absolute right-0 top-0 bottom-0 w-24 bg-red-500 flex items-center justify-center"
        onClick={() => { if (onDelete) onDelete(thread.id); setSwipeX(0); setShowDelete(false); }}
        data-testid={`button-swipe-delete-${thread.id}`}
      >
        <Trash2 className="w-5 h-5 text-white" />
      </button>
      <button
        onClick={() => { if (showDelete) { setSwipeX(0); setShowDelete(false); } else onClick(); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className="w-full flex items-center gap-4 px-5 py-4 active:bg-gray-50 border-b border-gray-100 select-none bg-white relative z-10 transition-transform duration-200"
        style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", transform: `translateX(${swipeX}px)` }}
        data-testid={`mobile-thread-${thread.id}`}
      >
        <div className="relative shrink-0">
          {renderAvatar()}
          {renderAiMemberBadge()}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[16px] truncate ${hasUnseen ? "font-bold text-gray-900" : "font-semibold text-gray-800"}`}>{displayTitle}</span>
            <span className={`text-[12px] shrink-0 ${hasUnseen ? "text-black font-semibold" : "text-gray-400"}`}>
              {timeStr}
            </span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <p className={`text-[14px] truncate leading-snug ${hasUnseen ? "text-gray-900 font-medium" : "text-gray-500"}`}>
              {thread.lastMessage ? (
                <><span className="font-semibold">{thread.lastMessage.senderName.split(" ")[0]}: </span>{thread.lastMessage.content}</>
              ) : (
                <span className="italic text-gray-400">No messages yet</span>
              )}
            </p>
            {hasUnseen && (
              <span className="w-2.5 h-2.5 rounded-full shrink-0 ml-2" style={{ backgroundColor: "hsl(var(--primary))" }} />
            )}
          </div>
          {(thread.propertyName || thread.linkedName) && (
            <div className="flex items-center gap-2 mt-1">
              {thread.propertyName && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1 bg-gray-100 rounded-md px-1.5 py-0.5"><Building2 className="w-3 h-3" />{thread.propertyName}</span>
              )}
              {thread.linkedName && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1 bg-gray-100 rounded-md px-1.5 py-0.5">
                  <Building2 className="w-3 h-3" />
                  {thread.linkedName}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

function MobileNewGroup({ allUsers, currentUser, onBack, onCreate }: {
  allUsers: Array<{ id: string; name: string; username: string; team?: string | null }>;
  currentUser: UserType | null;
  onBack: () => void;
  onCreate: (title: string, memberIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [search, setSearch] = useState("");

  const TEAMS = ["London Leasing", "National Leasing", "Investment", "Tenant Rep", "Development", "Lease Advisory", "Office/Corporate", "Landsec"];

  const toggleUser = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectTeam = (teamName: string) => {
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/\//g, "/");
    const teamUsers = allUsers.filter(u => u.team && normalize(u.team) === normalize(teamName) && u.id !== currentUser?.id);
    const ids = teamUsers.map(u => u.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
    if (!groupName) setGroupName(teamName);
  };

  const filteredUsers = allUsers.filter(u => {
    if (u.id === currentUser?.id) return false;
    if (!search.trim()) return true;
    return u.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col w-screen bg-white overflow-x-hidden fixed inset-0">
      <div className="bg-black text-white pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 px-4 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-1" data-testid="button-mobile-back-newgroup"><ArrowLeft className="w-6 h-6" /></button>
          <span className="font-semibold text-lg">New Group</span>
        </div>
      </div>

      <div className="px-4 py-4 border-b">
        <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" className="h-12 text-base mb-3 rounded-xl border-gray-200" data-testid="input-mobile-group-name" />
        <div className="flex flex-wrap gap-2">
          {TEAMS.map(t => (
            <button key={t} onClick={() => selectTeam(t)} className="px-3 py-1.5 text-sm rounded-full border border-gray-300 bg-white active:bg-gray-100 font-medium" data-testid={`button-mobile-team-${t}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people..." className="h-11 pl-10 text-base rounded-xl border-gray-200" data-testid="input-mobile-search-members" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {(!search.trim() || "chatbgp".includes(search.toLowerCase())) && (
          <button onClick={() => toggleUser("__chatbgp__")} className="w-full flex items-center gap-4 px-5 py-3.5 active:bg-gray-50 border-b border-gray-100" data-testid="button-mobile-select-chatbgp">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${selectedIds.has("__chatbgp__") ? "bg-black text-white" : "bg-gradient-to-br from-gray-800 to-black text-white"}`}>
              {selectedIds.has("__chatbgp__") ? <Check className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            </div>
            <div className="text-left">
              <div className="text-[16px] font-medium">ChatBGP</div>
              <div className="text-sm text-gray-400">AI Assistant</div>
            </div>
          </button>
        )}
        {filteredUsers.map(user => (
          <button key={user.id} onClick={() => toggleUser(user.id)} className="w-full flex items-center gap-4 px-5 py-3.5 active:bg-gray-50 border-b border-gray-100" data-testid={`button-mobile-select-user-${user.id}`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${selectedIds.has(user.id) ? "bg-black text-white" : "bg-gray-200"}`}>
              {selectedIds.has(user.id) ? <Check className="w-5 h-5" /> : <span className="text-sm font-semibold text-gray-600">{user.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>}
            </div>
            <div className="text-left">
              <div className="text-[16px] font-medium">{user.name}</div>
              {user.team && <div className="text-sm text-gray-400">{user.team}</div>}
            </div>
          </button>
        ))}
      </div>

      <div className="p-4 border-t pb-[calc(1rem+env(safe-area-inset-bottom))] shrink-0">
        <Button className="w-full h-12 text-base font-semibold bg-black text-white hover:bg-gray-800 rounded-xl" disabled={selectedIds.size === 0} onClick={() => onCreate(groupName || "Group Chat", Array.from(selectedIds))} data-testid="button-mobile-create-group">
          Create Group ({selectedIds.size})
        </Button>
      </div>
    </div>
  );
}

function MobileGroupEdit({ thread, currentUser, allUsers, onBack }: {
  thread: ThreadData;
  currentUser: UserType | null;
  allUsers: Array<{ id: string; name: string; username: string; team?: string | null }>;
  onBack: () => void;
}) {
  const isAiThread = !!thread.isAiChat;
  const [groupName, setGroupName] = useState(thread.title || thread.linkedName || "");
  const [search, setSearch] = useState("");
  const [aiEnabled, setAiEnabled] = useState(!!thread.hasAiMember);
  const { toast } = useToast();

  const memberIds = new Set(thread.members.map(m => m.id));
  if (currentUser?.id) memberIds.add(currentUser.id);

  const renameMutation = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("PUT", `/api/chat/threads/${thread.id}`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", thread.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      toast({ title: "Group renamed" });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/chat/threads/${thread.id}/members`, { userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", thread.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/chat/threads/${thread.id}/members/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", thread.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  const toggleAiMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PUT", `/api/chat/threads/${thread.id}`, { hasAiMember: enabled });
    },
    onSuccess: (_data, enabled) => {
      setAiEnabled(enabled);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", thread.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      toast({ title: enabled ? "ChatBGP added to group" : "ChatBGP removed from group" });
    },
  });

  const nonMembers = allUsers.filter(u => {
    if (u.id === currentUser?.id) return false;
    if (memberIds.has(u.id)) return false;
    if (!search.trim()) return true;
    return u.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col w-screen bg-white overflow-x-hidden fixed inset-0">
      <div className="bg-black text-white pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 px-4 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-1" data-testid="button-mobile-back-groupedit"><ArrowLeft className="w-6 h-6" /></button>
          <span className="font-semibold text-lg">{isAiThread ? "Chat Settings" : "Group Settings"}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{isAiThread ? "Chat Name" : "Group Name"}</label>
          <div className="flex items-center gap-2 mt-2">
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={isAiThread ? "Chat name" : "Group name"}
              className="h-11 text-base rounded-xl border-gray-200 flex-1"
              data-testid="input-mobile-edit-group-name"
            />
            <Button
              size="sm"
              className="h-11 px-4 rounded-xl bg-black text-white hover:bg-gray-800"
              disabled={!groupName.trim() || groupName === thread.title || renameMutation.isPending}
              onClick={() => renameMutation.mutate(groupName.trim())}
              data-testid="button-mobile-save-group-name"
            >
              Save
            </Button>
          </div>
          {isAiThread && thread.linkedName && (
            <div className="flex items-center gap-1.5 mt-2">
              <Link2 className="w-3 h-3 text-gray-400" />
              <span className="text-xs text-gray-400">Linked to {thread.linkedName}</span>
            </div>
          )}
        </div>

        {!isAiThread && (
          <div className="px-5 pt-4 pb-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full text-white flex items-center justify-center" style={{ backgroundColor: "hsl(var(--primary))" }}>
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[15px] font-medium">ChatBGP</div>
                  <div className="text-xs text-gray-400">AI Assistant</div>
                </div>
              </div>
              <button
                onClick={() => toggleAiMutation.mutate(!aiEnabled)}
                disabled={toggleAiMutation.isPending}
                className={`w-12 h-7 rounded-full transition-colors ${aiEnabled ? "bg-black" : "bg-gray-300"}`}
                data-testid="button-toggle-ai-member"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform mx-1 ${aiEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          </div>
        )}

        <div className="px-5 pt-4">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Members ({thread.members.length})</label>
        </div>

        {thread.members.map(m => {
          const isCreator = m.id === thread.createdBy;
          const isSelf = m.id === currentUser?.id;
          return (
            <div key={m.id} className="flex items-center gap-4 px-5 py-3 border-b border-gray-100">
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                <span className="text-sm font-semibold text-gray-600">{m.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium truncate">
                  {m.name}{isSelf ? " (You)" : ""}{isCreator ? " (Admin)" : ""}
                </div>
                <div className="text-xs text-gray-400">{allUsers.find(u => u.id === m.id)?.team || ""}</div>
              </div>
              {!isSelf && !isCreator && (
                <button
                  onClick={() => { if (confirm(`Remove ${m.name} from group?`)) removeMemberMutation.mutate(m.id); }}
                  disabled={removeMemberMutation.isPending}
                  className="text-red-500 p-2"
                  data-testid={`button-remove-member-${m.id}`}
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          );
        })}

        <div className="px-5 pt-5 pb-3">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Add Members</label>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people..."
              className="h-10 pl-9 text-sm rounded-xl bg-gray-100 border-0"
              data-testid="input-mobile-add-member-search"
            />
          </div>
        </div>

        {nonMembers.map(user => (
          <button
            key={user.id}
            onClick={() => addMemberMutation.mutate(user.id)}
            disabled={addMemberMutation.isPending}
            className="w-full flex items-center gap-4 px-5 py-3 active:bg-gray-50 border-b border-gray-100"
            data-testid={`button-add-member-${user.id}`}
          >
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-gray-500" />
            </div>
            <div className="text-left flex-1">
              <div className="text-[15px] font-medium">{user.name}</div>
              {user.team && <div className="text-xs text-gray-400">{user.team}</div>}
            </div>
            <Plus className="w-5 h-5 text-gray-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MobileChatView({ threadId: threadIdProp, isAiChat, onBack, onNewChat, currentUser }: {
  threadId: string | null;
  isAiChat: boolean;
  onBack: () => void;
  onNewChat?: () => void;
  currentUser: UserType | null;
}) {
  const [localThreadId, setLocalThreadId] = useState<string | null>(null);
  const threadId = threadIdProp || localThreadId;

  useEffect(() => {
    setLocalThreadId(null);
  }, [threadIdProp]);

  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const [showLinkSearch, setShowLinkSearch] = useState<"property" | "deal" | null>(null);
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { typingUsers, sendTyping, stopTyping } = useTypingIndicator(threadId);

  const { data: activeThread } = useQuery<ThreadData>({
    queryKey: ["/api/chat/threads", threadId],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!threadId,
    refetchInterval: 8000,
  });

  const { data: allUsers } = useQuery<Array<{ id: string; name: string; username: string; team?: string | null }>>({
    queryKey: ["/api/users"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const isActiveThreadAi = activeThread?.isAiChat ?? isAiChat;

  const { data: linkSearchResults } = useQuery<Array<{ id: number | string; name?: string; address?: string; title?: string }>>({
    queryKey: [showLinkSearch === "property" ? "/api/crm/properties" : "/api/crm/deals", { search: linkSearchQuery }],
    queryFn: async () => {
      const endpoint = showLinkSearch === "property" ? "/api/crm/properties" : "/api/crm/deals";
      const res = await fetch(`${endpoint}?search=${encodeURIComponent(linkSearchQuery)}&limit=20`, {
        headers: { ...getAuthHeaders() }, credentials: "include",
      });
      if (!res.ok) return [];
      try {
        const data = await res.json();
        return Array.isArray(data) ? data : data.items || data.deals || data.properties || [];
      } catch { return []; }
    },
    enabled: !!showLinkSearch && linkSearchQuery.length >= 1,
  });

  const linkThreadMutation = useMutation({
    mutationFn: async ({ type, id, name }: { type: string; id: string; name: string }) => {
      if (!threadId) throw new Error("No active chat to link");
      const res = await apiRequest("PUT", `/api/chat/threads/${threadId}`, {
        linkedType: type,
        linkedId: id,
        linkedName: name,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      setShowLinkSearch(null);
      setShowLinkMenu(false);
      setLinkSearchQuery("");
      toast({ title: "Chat linked", description: `Linked to ${variables.name}` });
    },
    onError: (err: any) => {
      toast({ title: "Link failed", description: err?.message || "Could not link chat", variant: "destructive" });
    },
  });

  const [streamingProgress, setStreamingProgress] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [searchInChat, setSearchInChat] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const initialMsgCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (threadId) emitMarkSeen(threadId);
    initialMsgCountRef.current = null;
  }, [threadId]);

  const messagesKey = useMemo(() => {
    if (!activeThread?.messages) return "";
    return activeThread.messages.map(m => `${m.id}:${m.content?.length}`).join("|");
  }, [activeThread?.messages]);

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (allUsers) allUsers.forEach(u => map.set(u.id, u.name));
    return map;
  }, [allUsers]);

  useEffect(() => {
    if (activeThread?.messages) {
      const loaded: LocalChatMessage[] = activeThread.messages.map(m => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        action: m.actionData ? JSON.parse(m.actionData) : undefined,
        attachments: m.attachments || undefined,
        userId: m.userId,
        userName: m.userId ? userNameMap.get(m.userId) || undefined : (m.role === "assistant" ? "ChatBGP" : undefined),
        createdAt: m.createdAt,
      }));
      if (initialMsgCountRef.current === null) {
        initialMsgCountRef.current = loaded.length;
      }
      setMessages(loaded);
    }
  }, [messagesKey, threadId, userNameMap]);

  const saveMessageMutation = useMutation({
    mutationFn: async ({ threadId: tid, role, content, actionData, attachments }: {
      threadId: string; role: string; content: string; actionData?: string; attachments?: string[];
    }) => {
      const res = await apiRequest("POST", `/api/chat/threads/${tid}/messages`, { role, content, actionData, attachments });
      return res.json();
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      const res = await apiRequest("PUT", `/api/chat/threads/${threadId}/messages/${messageId}`, { content });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] }); },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("DELETE", `/api/chat/threads/${threadId}/messages/${messageId}`);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] }); },
  });

  const [pendingDeleteMsgId, setPendingDeleteMsgId] = useState<string | null>(null);

  const aiSendMutation = useMutation({
    mutationFn: async ({ newMessages, files, tid }: { newMessages: LocalChatMessage[]; files: File[]; tid: string | null }) => {
      const plainMessages = newMessages.map(m => {
        let content = m.content;
        if (m.attachments && m.attachments.length > 0) {
          const attInfo = m.attachments.map(a => {
            try { const p = JSON.parse(a); return p.url || a; } catch { return a; }
          }).join("\n");
          content = `${content}\n\n[Attached files]\n${attInfo}`;
        }
        return { role: m.role, content };
      });
      let currentThreadId = tid;

      if (!currentThreadId) {
        const firstMsg = newMessages[0]?.content || "New conversation";
        const title = firstMsg.length > 50 ? firstMsg.slice(0, 50) + "..." : firstMsg;
        const res = await apiRequest("POST", "/api/chat/threads", { title, isAiChat: true });
        const thread = await res.json();
        currentThreadId = thread.id;
        queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      }

      const lastUserMsg = newMessages[newMessages.length - 1];
      await saveMessageMutation.mutateAsync({
        threadId: currentThreadId!,
        role: "user",
        content: lastUserMsg.content,
        attachments: lastUserMsg.attachments,
      });

      if (files.length > 0) {
        const formData = new FormData();
        formData.append("messages", JSON.stringify(plainMessages));
        files.forEach(f => formData.append("files", f));
        const token = localStorage.getItem("bgp_auth_token");
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/chatbgp/chat-with-files", { method: "POST", body: formData, credentials: "include", headers });
        if (!res.ok) throw new Error("Request failed");
        const data = await res.json();
        return { ...data, threadId: currentThreadId };
      } else {
        const attemptChat = async (attempt: number): Promise<any> => {
          const token = localStorage.getItem("bgp_auth_token");
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (token) headers["Authorization"] = `Bearer ${token}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 300000);
          try {
            const res = await fetch("/api/chatbgp/chat", {
              method: "POST",
              headers,
              body: JSON.stringify({ messages: plainMessages, threadId: currentThreadId }),
              credentials: "include",
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
              if (res.status >= 500 && attempt < 2) {
                await new Promise(r => setTimeout(r, 2000 * attempt));
                return attemptChat(attempt + 1);
              }
              throw new Error("Request failed");
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
                  try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.reply) lastData = line.slice(6);
                    if (parsed.progress) setStreamingProgress(parsed.progress);
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
            setStreamingProgress(null);
            if (!lastData) {
              if (currentThreadId) {
                const checkRes = await fetch(`/api/chat/threads/${currentThreadId}`, { credentials: "include", headers: getAuthHeaders() });
                if (checkRes.ok) {
                  const thread = await checkRes.json();
                  const msgs = thread.messages || [];
                  const lastMsg = msgs[msgs.length - 1];
                  if (lastMsg?.role === "assistant" && lastMsg.content) {
                    return { reply: lastMsg.content, threadId: currentThreadId, savedToThread: true };
                  }
                }
              }
              throw new Error("No response received");
            }
            return { ...JSON.parse(lastData), threadId: currentThreadId };
          } catch (err: any) {
            clearTimeout(timeoutId);
            setStreamingProgress(null);
            if (err.name === "AbortError") throw err;
            const isNetworkError = err.message === "Failed to fetch" || err.message === "Load failed" || err.message?.includes("network");
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
      const msg: LocalChatMessage = { role: "assistant", content: data.reply };
      if (data.action) msg.action = data.action;
      setMessages(prev => [...prev, msg]);
      if (!data.savedToThread) {
        await saveMessageMutation.mutateAsync({ threadId: data.threadId, role: "assistant", content: data.reply, actionData: data.action ? JSON.stringify(data.action) : undefined });
      }
      if (!threadIdProp && data.threadId) {
        setLocalThreadId(data.threadId);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", data.threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });

      apiRequest("POST", `/api/chat/threads/${data.threadId}/auto-title`, {})
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] }))
        .catch(() => {});
    },
    onError: async (err: any) => {
      if (threadId) {
        const delays = [3000, 8000, 15000, 30000, 60000];
        for (const delay of delays) {
          try {
            await new Promise(r => setTimeout(r, delay));
            const token = localStorage.getItem("bgp_auth_token");
            const headers: Record<string, string> = {};
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`/api/chat/threads/${threadId}`, { credentials: "include", headers });
            if (res.ok) {
              const thread = await res.json();
              const msgs = thread.messages || [];
              if (msgs.length > 0) {
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg.role === "assistant") {
                  const recovered: LocalChatMessage = { role: "assistant", content: lastMsg.content };
                  if (lastMsg.actionData) {
                    try { recovered.action = JSON.parse(lastMsg.actionData); } catch {}
                  }
                  setMessages(prev => {
                    const filtered = prev.filter(m => m.content !== "Sorry, I couldn't respond right now. Please try again." && m.content !== "Sorry, the request timed out. Please try again.");
                    return [...filtered, recovered];
                  });
                  queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
                  queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
                  return;
                }
              }
            }
          } catch {}
        }
      }
      const msg = err?.message === "The operation was aborted" || err?.name === "AbortError"
        ? "Sorry, the request timed out. Please try again."
        : "Sorry, I couldn't respond right now. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", content: msg }]);
    },
  });

  const teamSendMutation = useMutation({
    mutationFn: async ({ content, tid, attachments }: { content: string; tid: string; attachments?: string[] }) => {
      const res = await apiRequest("POST", `/api/chat/threads/${tid}/messages`, { role: "user", content, attachments });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  const chatbgpMentionMutation = useMutation({
    mutationFn: async ({ content, tid }: { content: string; tid: string }) => {
      await saveMessageMutation.mutateAsync({ threadId: tid, role: "user", content });
      const threadMessages = activeThread?.messages || [];
      const recentMessages = threadMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      recentMessages.push({ role: "user", content });
      const token = localStorage.getItem("bgp_auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const mentionController = new AbortController();
      const mentionTimeout = setTimeout(() => mentionController.abort(), 300000);
      const res = await fetch("/api/chatbgp/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ messages: recentMessages, threadId: tid }),
        credentials: "include",
        signal: mentionController.signal,
      });
      clearTimeout(mentionTimeout);
      if (!res.ok) throw new Error("Request failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buf = "", last = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { const p = JSON.parse(line.slice(6)); if (p.reply) last = line.slice(6); } catch {}
          }
        }
      }
      if (buf.startsWith("data: ")) {
        try { const p = JSON.parse(buf.slice(6)); if (p.reply) last = buf.slice(6); } catch {}
      }
      if (!last) throw new Error("No response");
      return { ...JSON.parse(last), threadId: tid };
    },
    onSuccess: (data: { reply: string; action?: ChatAction; threadId: string; savedToThread?: boolean }) => {
      const msg: LocalChatMessage = { role: "assistant", content: data.reply };
      if (data.action) msg.action = data.action;
      setMessages(prev => [...prev, msg]);
      if (!data.savedToThread) {
        saveMessageMutation.mutate({ threadId: data.threadId, role: "assistant", content: data.reply, actionData: data.action ? JSON.stringify(data.action) : undefined });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", data.threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: async (_err: any) => {
      if (threadId) {
        const delays = [3000, 8000, 15000, 30000, 60000];
        for (const delay of delays) {
          try {
            await new Promise(r => setTimeout(r, delay));
            const token = localStorage.getItem("bgp_auth_token");
            const headers: Record<string, string> = {};
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`/api/chat/threads/${threadId}`, { credentials: "include", headers });
            if (res.ok) {
              const thread = await res.json();
              const msgs = thread.messages || [];
              if (msgs.length > 0) {
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg.role === "assistant") {
                  const recovered: LocalChatMessage = { role: "assistant", content: lastMsg.content };
                  if (lastMsg.actionData) {
                    try { recovered.action = JSON.parse(lastMsg.actionData); } catch {}
                  }
                  setMessages(prev => {
                    const filtered = prev.filter(m => m.content !== "Sorry, ChatBGP couldn't respond right now.");
                    return [...filtered, recovered];
                  });
                  queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
                  queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
                  return;
                }
              }
            }
          } catch {}
        }
      }
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, ChatBGP couldn't respond right now." }]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, aiSendMutation.isPending, chatbgpMentionMutation.isPending]);

  useEffect(() => {
    if (!aiSendMutation.isPending && queuedMessageRef.current && threadId) {
      const queued = queuedMessageRef.current;
      setQueuedMessage(null);
      const userMessage: LocalChatMessage = { role: "user", content: queued.text || "Shared files", userName: currentUser?.name, userId: currentUser?.id };
      setMessages(prev => [...prev, userMessage]);
      const newMessages = [...messagesRef.current, userMessage];
      aiSendMutation.mutate({ newMessages, files: queued.files, tid: threadId });
    }
  }, [aiSendMutation.isPending]);

  const mentionUsers = useMemo(() => {
    if (mentionQuery === null || !allUsers) return [];
    const q = mentionQuery.toLowerCase();
    return allUsers.filter(u => {
      if (u.id === currentUser?.id) return false;
      return u.name.toLowerCase().includes(q);
    }).slice(0, 6);
  }, [mentionQuery, allUsers, currentUser?.id]);

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

  const handleMentionSelect = useCallback((user: { id: string; name: string }) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const before = input.slice(0, mentionStart);
    const after = input.slice(textarea.selectionStart);
    const newInput = `${before}@${user.name.split(" ")[0]} ${after}`;
    setInput(newInput);
    setMentionQuery(null);
    setMentionStart(-1);
  }, [input, mentionStart]);

  const [uploading, setUploading] = useState(false);
  const [filePreviews, setFilePreviews] = useState<Map<number, string>>(new Map());
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previews = new Map<number, string>();
    attachedFiles.forEach((f, i) => {
      if (f.type.startsWith("image/")) {
        const url = URL.createObjectURL(f);
        previews.set(i, url);
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
    return data.files;
  };

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
      const attachmentJson = JSON.stringify({ url: uploaded.url, name: fileName, type: uploaded.type, size: uploaded.size });
      const content = "🎤 Voice note";
      if (isActiveThreadAi || !threadId) {
        const userMessage: LocalChatMessage = { role: "user", content, userName: currentUser?.name, attachments: [attachmentJson] };
        setMessages(prev => [...prev, userMessage]);
        aiSendMutation.mutate({ newMessages: [...messages, userMessage], files: [], tid: threadId });
      } else if (threadId) {
        const userMessage: LocalChatMessage = { role: "user", content, userName: currentUser?.name, userId: currentUser?.id, attachments: [attachmentJson] };
        setMessages(prev => [...prev, userMessage]);
        teamSendMutation.mutate({ content, tid: threadId, attachments: [attachmentJson] });
      }
    } catch {
      toast({ title: "Voice note failed", description: "Network error", variant: "destructive" });
    } finally { setUploading(false); }
  }, [threadId, isActiveThreadAi, currentUser, messages, toast, aiSendMutation, teamSendMutation]);

  const sendVoiceNoteRef = useRef(sendVoiceNote);
  useEffect(() => { sendVoiceNoteRef.current = sendVoiceNote; }, [sendVoiceNote]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
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

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimePrefs = ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
      let mimeType = "";
      for (const mt of mimePrefs) {
        try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; } } catch {}
      }
      const recorderOpts: MediaRecorderOptions = {};
      if (mimeType) recorderOpts.mimeType = mimeType;
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, recorderOpts);
      } catch {
        recorder = new MediaRecorder(stream);
      }
      const actualMime = recorder.mimeType || mimeType || "audio/mp4";
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        setIsRecording(false);
        setRecordingDuration(0);
        if (audioChunksRef.current.length === 0) {
          toast({ title: "Recording empty", description: "No audio was captured. Please try again.", variant: "destructive" });
          return;
        }
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
        if (audioBlob.size > 100 && !unmountedRef.current) {
          sendVoiceNoteRef.current(audioBlob);
        } else if (!unmountedRef.current) {
          toast({ title: "Recording too short", description: "Please hold the button a bit longer", variant: "destructive" });
        }
      };
      recorder.onerror = (ev: any) => {
        console.error("[voice] MediaRecorder error:", ev?.error?.name, ev?.error?.message);
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        setIsRecording(false);
        setRecordingDuration(0);
        toast({ title: "Recording failed", description: "Could not record audio", variant: "destructive" });
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch (err: any) {
      console.error("[voice] getUserMedia error:", err?.name, err?.message);
      toast({ title: "Microphone access denied", description: "Please allow microphone access to record voice notes", variant: "destructive" });
    }
  }, [toast]);

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

  const isSending = aiSendMutation.isPending || teamSendMutation.isPending || chatbgpMentionMutation.isPending || uploading;
  const [queuedMessage, setQueuedMessage] = useState<{ text: string; files: File[] } | null>(null);
  const queuedMessageRef = useRef<{ text: string; files: File[] } | null>(null);
  queuedMessageRef.current = queuedMessage;

  const handleSend = async () => {
    const text = input.trim();
    const hasFiles = attachedFiles.length > 0;
    if (!text && !hasFiles) return;

    if (isSending && isActiveThreadAi) {
      setQueuedMessage({ text, files: hasFiles ? [...attachedFiles] : [] });
      setInput("");
      setAttachedFiles([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }
    stopTyping();

    const originalFiles = hasFiles ? [...attachedFiles] : [];
    let uploadedAttachments: string[] = [];
    if (hasFiles) {
      try {
        setUploading(true);
        const uploaded = await uploadFiles(attachedFiles);
        uploadedAttachments = uploaded.map(f => JSON.stringify(f));
        setAttachedFiles([]);
      } catch {
        toast({ title: "Upload failed", description: "Could not upload files. Please try again.", variant: "destructive" });
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }

    if (isActiveThreadAi || !threadId) {
      const content = text || (uploadedAttachments.length > 0 ? "Shared files" : "");
      const userMessage: LocalChatMessage = { role: "user", content, userName: currentUser?.name, attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined };
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setInput("");
      aiSendMutation.mutate({ newMessages, files: originalFiles, tid: threadId });
    } else {
      const content = text || (uploadedAttachments.length > 0 ? "Shared files" : "");
      const hasChatBGPMention = text.toLowerCase().includes("@chatbgp");
      const userMessage: LocalChatMessage = { role: "user", content, userName: currentUser?.name, userId: currentUser?.id, attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined };
      setMessages(prev => [...prev, userMessage]);
      setInput("");
      if (hasChatBGPMention && threadId) {
        chatbgpMentionMutation.mutate({ content, tid: threadId });
      } else if (threadId) {
        teamSendMutation.mutate({ content, tid: threadId, attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined });
      }
    }
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const [selectedCheckboxes, setSelectedCheckboxes] = useState<string[]>([]);
  const selectedCheckboxesRef = useRef<string[]>([]);
  selectedCheckboxesRef.current = selectedCheckboxes;
  const messagesRef = useRef<LocalChatMessage[]>([]);
  messagesRef.current = messages;

  const handleCheckboxClick = useCallback((text: string) => {
    setSelectedCheckboxes(prev => {
      if (prev.includes(text)) return prev.filter(t => t !== text);
      return [...prev, text];
    });
  }, []);

  const handleSendCheckboxes = useCallback(() => {
    const items = selectedCheckboxesRef.current;
    if (!threadId || items.length === 0) return;
    const combined = items.join("\n");
    const userMessage: LocalChatMessage = { role: "user", content: combined, userName: currentUser?.name, userId: currentUser?.id };
    setMessages(prev => [...prev, userMessage]);
    if (isActiveThreadAi) {
      const newMessages = [...messagesRef.current, userMessage];
      aiSendMutation.mutate({ newMessages, files: [], tid: threadId });
    } else {
      teamSendMutation.mutate({ content: combined, tid: threadId });
    }
    setSelectedCheckboxes([]);
  }, [threadId, currentUser, isActiveThreadAi, aiSendMutation, teamSendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const threadMembers = activeThread?.members || [];
  const otherMembers = threadMembers.filter(m => m.id !== currentUser?.id);
  const isDm = !isActiveThreadAi && otherMembers.length === 1;
  const dmName = isDm ? otherMembers[0].name : null;
  const threadTitle = isDm ? dmName : (activeThread?.title || activeThread?.linkedName || (isActiveThreadAi ? "ChatBGP" : "Chat"));
  const headerInitials = isDm ? dmName!.split(" ").map(n => n[0]).join("").slice(0, 2) : null;
  const isGroup = !isActiveThreadAi && !isDm;
  const groupPicFileRef = useRef<HTMLInputElement>(null);

  const handleGroupPicUpload = async (file: File) => {
    if (!threadId) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`/api/chat/threads/${threadId}/group-pic`, {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaders() },
        body: formData,
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
        queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      }
    } catch (err) {
      console.error("[handleGroupPicUpload] Failed:", err);
    }
  };

  const dmPicUrl = isDm && otherMembers[0] ? allUsers?.find(u => u.id === otherMembers[0].id) : null;
  const dmProfilePic = dmPicUrl ? (dmPicUrl as any).profilePicUrl : null;

  const renderHeaderAvatar = () => {
    if (isActiveThreadAi) {
      return (
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <Sparkles className="w-5 h-5" />
        </div>
      );
    }
    if (isDm && dmProfilePic) {
      return <img src={dmProfilePic} alt="" className="w-10 h-10 rounded-full object-cover" />;
    }
    if (isDm) {
      return (
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <span className="text-sm font-bold">{headerInitials}</span>
        </div>
      );
    }
    if (activeThread?.groupPicUrl) {
      return (
        <label className="relative cursor-pointer">
          <img src={activeThread.groupPicUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white/90 flex items-center justify-center">
            <Camera className="w-2.5 h-2.5 text-black" />
          </div>
          <input type="file" accept="image/*" className="hidden" ref={groupPicFileRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleGroupPicUpload(f); e.target.value = ""; }} />
        </label>
      );
    }
    return (
      <label className="relative cursor-pointer">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <Users className="w-5 h-5" />
        </div>
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white/90 flex items-center justify-center">
          <Camera className="w-2.5 h-2.5 text-black" />
        </div>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleGroupPicUpload(f); e.target.value = ""; }} />
      </label>
    );
  };

  if (showGroupEdit && activeThread && allUsers) {
    return (
      <MobileGroupEdit
        thread={activeThread}
        currentUser={currentUser}
        allUsers={allUsers}
        onBack={() => setShowGroupEdit(false)}
      />
    );
  }

  return (
    <div className={`flex flex-col w-screen overflow-x-hidden fixed inset-0 bg-gray-50`}>
      {isActiveThreadAi ? (
        <div className="bg-white text-gray-900 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2.5 px-4 shrink-0 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center active:bg-gray-100" data-testid="button-mobile-chat-back">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <button onClick={() => setShowGroupEdit(true)} className="flex items-center gap-2.5" data-testid="button-mobile-group-settings">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "hsl(var(--primary))" }}>
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="text-left">
                <span className="text-[15px] font-semibold text-gray-900 block leading-tight">ChatBGP</span>
                <span className="text-[11px] text-gray-400 leading-tight">AI Assistant</span>
              </div>
            </button>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setSearchInChat(!searchInChat)}
                className="w-9 h-9 rounded-full flex items-center justify-center active:bg-gray-100"
                data-testid="button-search-in-chat"
              >
                <Search className="w-[18px] h-[18px] text-gray-400" />
              </button>
              <button
                onClick={() => {
                  if (onNewChat) {
                    onNewChat();
                  } else {
                    setMessages([]);
                    onBack();
                  }
                }}
                className="w-9 h-9 rounded-full flex items-center justify-center active:bg-gray-100"
                data-testid="button-mobile-new-chat"
              >
                <Plus className="w-5 h-5" style={{ color: "hsl(var(--primary))" }} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-black text-white pt-[calc(0.5rem+env(safe-area-inset-top))] pb-3 px-4 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-1" data-testid="button-mobile-chat-back"><ArrowLeft className="w-6 h-6" /></button>
            {isGroup ? (
              <button onClick={() => setShowGroupEdit(true)} className="flex items-center gap-3 flex-1 min-w-0 text-left" data-testid="button-mobile-group-settings">
                {renderHeaderAvatar()}
                <div className="flex-1 min-w-0">
                  <div className="text-[17px] font-semibold truncate">{threadTitle}</div>
                  {isGroup && threadMembers.length > 0 && (
                    <div className="text-xs text-white/60 truncate">
                      {activeThread?.hasAiMember ? "ChatBGP, " : ""}{activeThread?.creatorName?.split(" ")[0]}, {threadMembers.slice(0, 3).map(m => m.name.split(" ")[0]).join(", ")}
                      {threadMembers.length > 3 && ` +${threadMembers.length - 3}`}
                      {" · Tap to edit"}
                    </div>
                  )}
                  {activeThread?.linkedName && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Link2 className="w-3 h-3 text-gray-400" />
                      <span className="text-[11px] text-gray-400 truncate">{activeThread.linkedName}</span>
                    </div>
                  )}
                </div>
              </button>
            ) : (
              <>
                {renderHeaderAvatar()}
                <div className="flex-1 min-w-0">
                  <div className="text-[17px] font-semibold truncate">{threadTitle}</div>
                  {isDm && (
                    <div className="text-xs text-white/60 truncate">
                      {allUsers?.find(u => u.id === otherMembers[0].id)?.team || "BGP"}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {searchInChat && (
        <div className="px-3 py-2 border-b bg-white flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <Input
            value={chatSearchQuery}
            onChange={(e) => setChatSearchQuery(e.target.value)}
            placeholder="Search in conversation..."
            className="h-8 text-sm border-0 bg-gray-100 rounded-lg flex-1"
            autoFocus
            data-testid="input-search-in-chat"
          />
          <button onClick={() => { setSearchInChat(false); setChatSearchQuery(""); }} className="p-1" data-testid="button-close-chat-search">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 relative" onScroll={(e) => {
        const el = e.currentTarget;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setShowScrollBottom(distFromBottom > 200);
      }}>
        <div className={`min-h-full flex flex-col ${messages.length > 0 ? "justify-end" : "justify-center"} ${isActiveThreadAi ? "space-y-6" : "space-y-4"}`}>
        {messages.length === 0 && isActiveThreadAi && !threadId && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-10">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm" style={{ backgroundColor: "hsl(var(--primary))" }}>
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h3 className="font-bold text-[22px] text-gray-900 tracking-tight">ChatBGP</h3>
              <p className="text-[15px] text-gray-400 mt-1.5">Your AI property assistant</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-sm">
              {AI_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => {
                    const userMsg: LocalChatMessage = { role: "user", content: s, userName: currentUser?.name };
                    setMessages([userMsg]);
                    aiSendMutation.mutate({ newMessages: [userMsg], files: [], tid: threadId });
                  }}
                  className="text-[14px] text-left px-4 py-3.5 rounded-2xl border border-gray-200 active:bg-gray-50 text-gray-600 bg-white shadow-sm leading-snug"
                  data-testid={`mobile-suggestion-${s.slice(0, 10)}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const matchesSearch = !chatSearchQuery || msg.content.toLowerCase().includes(chatSearchQuery.toLowerCase());
          if (searchInChat && chatSearchQuery && !matchesSearch) return null;
          const showNewDivider = initialMsgCountRef.current !== null && i === initialMsgCountRef.current && i > 0 && i < messages.length;
          return (
            <div key={msg.id || i}>
              {showNewDivider && (
                <div className="flex items-center gap-3 my-3 px-2" data-testid="new-messages-divider">
                  <div className="flex-1 h-px bg-blue-400" />
                  <span className="text-xs font-semibold text-blue-500 whitespace-nowrap">New Messages</span>
                  <div className="flex-1 h-px bg-blue-400" />
                </div>
              )}
              <MobileMessageBubble
                message={msg}
                currentUserId={currentUser?.id}
                threadId={threadId}
                isGroupChat={!isActiveThreadAi && threadMembers.length > 2}
                onEdit={(id, content) => editMessageMutation.mutate({ messageId: id, content })}
                onDelete={(id) => { setPendingDeleteMsgId(id); }}
                onCheckboxClick={handleCheckboxClick}
                selectedCheckboxes={selectedCheckboxes}
                isAiThread={isActiveThreadAi}
              />
            </div>
          );
        })}

        {isSending && (
          isActiveThreadAi ? (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "hsl(var(--primary))" }}>
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-[14px] text-gray-400 italic">{streamingProgress || "Thinking..."}</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-md px-5 py-4">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )
        )}

        {queuedMessage && (
          <div className="flex justify-end">
            <div className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed max-w-[80%] opacity-60 bg-black text-white rounded-br-md`}>
              <div className="whitespace-pre-wrap break-words">{queuedMessage.text}</div>
              <div className="text-[11px] mt-1 text-white/60">Queued — will send next</div>
            </div>
          </div>
        )}

        {typingUsers.length > 0 && !isSending && (
          <div className="text-sm italic px-2 text-gray-400">
            {typingUsers.length === 1 ? `${typingUsers[0]} is typing...` : `${typingUsers.length} people typing...`}
          </div>
        )}
        </div>

        {showScrollBottom && (
          <button
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
            className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-white border border-gray-200 shadow-lg flex items-center justify-center z-10 active:bg-gray-50"
            data-testid="button-scroll-to-bottom"
          >
            <ChevronDown className="w-5 h-5 text-gray-600" />
          </button>
        )}
      </div>

      {mentionQuery !== null && mentionUsers.length > 0 && (
        <div className="border-t px-4 py-2 max-h-[200px] overflow-y-auto bg-white">
          {mentionUsers.map((u, i) => (
            <button
              key={u.id}
              onClick={() => handleMentionSelect(u)}
              className={`w-full text-left px-4 py-3 rounded-lg text-[15px] ${i === mentionIndex ? "bg-gray-100" : ""}`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}

      {selectedCheckboxes.length > 0 && (
        <div className="border-t px-4 py-2.5 flex items-center justify-between shrink-0 bg-white">
          <span className="text-[14px] text-gray-600">{selectedCheckboxes.length} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedCheckboxes([])}
              className="px-4 py-2 text-[14px] rounded-xl border border-gray-200 text-gray-600 active:bg-gray-100"
              data-testid="button-clear-checkboxes"
            >
              Clear
            </button>
            <button
              onClick={handleSendCheckboxes}
              disabled={isSending}
              className="px-4 py-2 text-[14px] rounded-xl flex items-center gap-1.5 bg-black text-white active:bg-gray-800 disabled:bg-gray-300"
              data-testid="button-send-checkboxes"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </div>
      )}

      <div className="border-t px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shrink-0 bg-white">
        {attachedFiles.length > 0 && (
          <div className="flex gap-2 mb-2 px-1 overflow-x-auto">
            {attachedFiles.map((f, i) => {
              const preview = filePreviews.get(i);
              return preview ? (
                <div key={i} className="relative shrink-0">
                  <img src={preview} alt={f.name} className="w-16 h-16 rounded-xl object-cover" />
                  <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-black text-white">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div key={i} className="relative shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-2 h-16 bg-gray-100">
                  <File className="w-4 h-4 text-gray-500" />
                  <div className="max-w-[100px]">
                    <div className="text-xs font-medium truncate">{f.name}</div>
                    <div className="text-[10px] text-gray-400">{formatFileSize(f.size)}</div>
                  </div>
                  <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-black text-white">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {uploading && (
          <div className="flex items-center gap-2 mb-2 px-2 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 rounded-full animate-spin border-gray-300 border-t-black" />
            Uploading...
          </div>
        )}
        {showLinkSearch && (
          <div className="bg-white border-t border-gray-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700">
                Link {showLinkSearch === "property" ? "Property" : "Deal"}
              </span>
              <button onClick={() => { setShowLinkSearch(null); setLinkSearchQuery(""); }} className="p-1">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <Input
              value={linkSearchQuery}
              onChange={(e) => setLinkSearchQuery(e.target.value)}
              placeholder={`Search ${showLinkSearch === "property" ? "properties" : "deals"}...`}
              className="text-[16px] mb-2"
              autoFocus
              data-testid="input-link-search"
            />
            <div className="max-h-48 overflow-y-auto">
              {(linkSearchResults || []).map((item) => {
                const displayName = item.name || item.address || item.title || `#${item.id}`;
                return (
                  <button
                    key={item.id}
                    onClick={() => linkThreadMutation.mutate({
                      type: showLinkSearch!,
                      id: String(item.id),
                      name: displayName,
                    })}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-left text-sm hover:bg-gray-50 active:bg-gray-100 rounded-lg"
                    data-testid={`link-result-${item.id}`}
                  >
                    {showLinkSearch === "property" ? (
                      <Building className="w-4 h-4 text-gray-400 shrink-0" />
                    ) : (
                      <Handshake className="w-4 h-4 text-gray-400 shrink-0" />
                    )}
                    <span className="truncate">{displayName}</span>
                  </button>
                );
              })}
              {linkSearchQuery.length >= 1 && (!linkSearchResults || linkSearchResults.length === 0) && (
                <div className="text-sm text-gray-400 text-center py-3">No results found</div>
              )}
              {linkSearchQuery.length < 1 && (
                <div className="text-sm text-gray-400 text-center py-3">Type to search</div>
              )}
            </div>
          </div>
        )}
        {isRecording ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-50 border border-red-200">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[15px] font-medium text-red-600">
                Recording {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}
              </span>
            </div>
            <button onClick={stopRecording} className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center shrink-0" data-testid="button-mobile-stop-recording">
              <Square className="w-5 h-5 text-white fill-white" />
            </button>
          </div>
        ) : isActiveThreadAi ? (
          <div className="flex items-end gap-2">
            <div className="flex-1 flex items-end rounded-[22px] border border-gray-200/80 bg-white shadow-sm overflow-hidden">
              <div className="p-2.5 text-gray-400 active:text-gray-600 cursor-pointer relative overflow-hidden shrink-0" data-testid="button-mobile-photo" style={{ minWidth: 36, minHeight: 36 }}>
                <Plus className="w-5 h-5 pointer-events-none" />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.mp3,.mp4,.m4a,.wav,.webm,.ogg,.mov,.pptx,.ppt"
                  multiple
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  style={{ width: '100%', height: '100%', fontSize: '0', zIndex: 10 }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) setAttachedFiles(prev => [...prev, ...files].slice(0, 10));
                    e.target.value = "";
                  }}
                />
              </div>
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Reply to ChatBGP..."
                className="flex-1 min-h-[44px] max-h-[120px] resize-none border-0 bg-transparent text-[16px] py-3 pr-3 pl-0 text-gray-900 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
                rows={1}
                data-testid="input-mobile-chat"
              />
            </div>
            {!input.trim() && attachedFiles.length === 0 ? (
              <button onClick={startRecording} disabled={isSending} className="w-10 h-10 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center disabled:opacity-30 shrink-0 mb-0.5" data-testid="button-mobile-voice-record">
                <Mic className="w-5 h-5 text-gray-400" />
              </button>
            ) : (
              <button onClick={handleSend} disabled={!!queuedMessage || uploading} className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-30 shrink-0 mb-0.5" style={{ backgroundColor: "hsl(var(--primary))" }} data-testid="button-mobile-send">
                <Send className="w-4.5 h-4.5 text-white" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 flex items-end rounded-[22px] border border-gray-200/80 bg-white shadow-sm overflow-hidden">
              <div className="p-2.5 text-gray-400 active:text-gray-600 cursor-pointer relative overflow-hidden shrink-0" data-testid="button-mobile-photo" style={{ minWidth: 36, minHeight: 36 }}>
                <Image className="w-5 h-5 pointer-events-none" />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.mp3,.mp4,.m4a,.wav,.webm,.ogg,.mov,.pptx,.ppt"
                  multiple
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  style={{ width: '100%', height: '100%', fontSize: '0', zIndex: 10 }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) setAttachedFiles(prev => [...prev, ...files].slice(0, 10));
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="relative shrink-0">
                <button
                  onClick={() => setShowLinkMenu(prev => !prev)}
                  className="p-2.5 text-gray-400 active:text-gray-600 cursor-pointer"
                  data-testid="button-mobile-attach"
                  style={{ minWidth: 36, minHeight: 36 }}
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                {showLinkMenu && (
                  <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLinkMenu(false)} />
                  <div className="absolute bottom-12 left-0 bg-white rounded-xl shadow-lg border border-gray-200 py-1 w-52 z-50">
                    <button
                      onClick={() => { setShowLinkSearch("property"); setShowLinkMenu(false); setLinkSearchQuery(""); }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left text-[15px] hover:bg-gray-50 active:bg-gray-100"
                      data-testid="button-link-property"
                    >
                      <Building className="w-5 h-5 text-gray-600" />
                      <span>Link Property</span>
                    </button>
                    <button
                      onClick={() => { setShowLinkSearch("deal"); setShowLinkMenu(false); setLinkSearchQuery(""); }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left text-[15px] hover:bg-gray-50 active:bg-gray-100"
                      data-testid="button-link-deal"
                    >
                      <Handshake className="w-5 h-5 text-gray-600" />
                      <span>Link Deal</span>
                    </button>
                    <div className="border-t border-gray-100 my-1" />
                    <label className="flex items-center gap-3 w-full px-4 py-3 text-left text-[15px] hover:bg-gray-50 active:bg-gray-100 cursor-pointer">
                      <File className="w-5 h-5 text-gray-600" />
                      <span>Attach File</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length > 0) setAttachedFiles(prev => [...prev, ...files].slice(0, 10));
                          e.target.value = "";
                          setShowLinkMenu(false);
                        }}
                      />
                    </label>
                  </div>
                  </>
                )}
              </div>
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message..."
                className="flex-1 min-h-[44px] max-h-[120px] resize-none border-0 bg-transparent text-[16px] py-3 pr-3 pl-0 text-gray-900 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
                rows={1}
                data-testid="input-mobile-chat"
              />
            </div>
            {!input.trim() && attachedFiles.length === 0 ? (
              <button onClick={startRecording} disabled={isSending} className="w-10 h-10 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center disabled:opacity-30 shrink-0 mb-0.5" data-testid="button-mobile-voice-record">
                <Mic className="w-5 h-5 text-gray-400" />
              </button>
            ) : (
              <button onClick={handleSend} disabled={!!queuedMessage || uploading} className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-30 shrink-0 mb-0.5 bg-black" data-testid="button-mobile-send">
                <Send className="w-4 h-4 text-white" />
              </button>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingDeleteMsgId} onOpenChange={(open) => { if (!open) setPendingDeleteMsgId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message</AlertDialogTitle>
            <AlertDialogDescription>This message will be permanently removed from the conversation.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingDeleteMsgId) { deleteMessageMutation.mutate(pendingDeleteMsgId); setPendingDeleteMsgId(null); } }} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MobileDocPreview({ design, scale = 0.1 }: { design: string; scale?: number }) {
  try {
    const parsed = JSON.parse(design);
    if (!parsed.pages || !Array.isArray(parsed.pages) || parsed.pages.length === 0) return null;
    const page = parsed.pages[0];
    const pw = parsed.pageWidth || 595;
    const ph = parsed.pageHeight || 842;
    return (
      <div
        className="relative overflow-hidden rounded"
        style={{ width: pw * scale, height: ph * scale, backgroundColor: page.backgroundColor || "#ffffff" }}
      >
        {(page.elements || []).map((el: any) => {
          const s: React.CSSProperties = {
            position: "absolute", left: el.x * scale, top: el.y * scale,
            width: el.width * scale, height: el.height * scale,
            opacity: el.opacity ?? 1, zIndex: el.zIndex ?? 0, overflow: "hidden",
          };
          if (el.type === "text") return (
            <div key={el.id} style={{ ...s, fontSize: (el.fontSize || 12) * scale, fontFamily: el.fontFamily || "Arial", fontWeight: el.fontWeight || "normal", color: el.color || "#000", backgroundColor: el.backgroundColor || "transparent", lineHeight: 1.3 }}>
              {el.content}
            </div>
          );
          if (el.type === "shape") return (
            <div key={el.id} style={{ ...s, backgroundColor: el.backgroundColor || "transparent" }} />
          );
          return null;
        })}
      </div>
    );
  } catch { return null; }
}

function MobileDocumentStudio() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const makePreview = (titleLines: string[], sections: string[], accent: string = "#FF6900") => JSON.stringify({
    pageWidth: 595, pageHeight: 842,
    pages: [{
      backgroundColor: "#FFFCF5",
      elements: [
        { id: "bar", type: "shape", x: 0, y: 0, width: 595, height: 6, backgroundColor: accent, zIndex: 0 },
        { id: "logo", type: "text", x: 40, y: 24, width: 200, height: 16, content: "BRUCE GILLINGHAM POLLARD", fontSize: 8, fontFamily: "Arial, sans-serif", fontWeight: "700", color: "#232323", zIndex: 1 },
        { id: "line1", type: "shape", x: 40, y: 46, width: 515, height: 1, backgroundColor: "#E8E6DF", zIndex: 1 },
        ...titleLines.map((t, i) => ({ id: `t${i}`, type: "text", x: 40, y: 70 + i * 32, width: 515, height: 30, content: t, fontSize: 22, fontFamily: "Arial, sans-serif", fontWeight: "700", color: "#232323", zIndex: 2 })),
        { id: "accentbar", type: "shape", x: 40, y: 70 + titleLines.length * 32 + 8, width: 60, height: 3, backgroundColor: accent, zIndex: 2 },
        ...sections.map((s, i) => ({ id: `s${i}`, type: "text", x: 40, y: 70 + titleLines.length * 32 + 28 + i * 18, width: 515, height: 16, content: s, fontSize: 9, fontFamily: "Arial, sans-serif", color: "#666666", zIndex: 2 })),
        { id: "footer", type: "shape", x: 0, y: 820, width: 595, height: 22, backgroundColor: "#232323", zIndex: 3 },
        { id: "ftext", type: "text", x: 40, y: 824, width: 300, height: 12, content: "Bruce Gillingham Pollard  |  London", fontSize: 7, fontFamily: "Arial, sans-serif", color: "#FFFFFF", zIndex: 4 },
      ]
    }]
  });

  const docTypes = [
    { label: "Marketing Particulars", preview: makePreview(["Marketing", "Particulars"], ["Property Image & Location", "Accommodation Schedule", "Rates & Service Charge", "Viewing Arrangements"]) },
    { label: "Heads of Terms", preview: makePreview(["Heads of Terms"], ["Parties: Landlord & Tenant", "Property & Demise", "Rent & Rent-Free Period", "Lease Term & Break Options", "Subject to Contract"]) },
    { label: "Pitch Presentation", preview: makePreview(["Pitch", "Presentation"], ["Introduction to BGP", "Service Lines & Track Record", "Case Studies & Clients", "Team Profiles"]) },
    { label: "Client Report", preview: makePreview(["Client Report"], ["Executive Summary", "Market Overview & Trends", "Property Analysis", "Comparable Evidence", "Recommendations"]) },
    { label: "Team CV", preview: makePreview(["Team CV"], ["Name & Job Title", "Professional Biography", "Key Instructions", "Notable Transactions"]) },
    { label: "Press Release", preview: makePreview(["Press Release"], ["Headline & Date", "Announcement Details", "Quotes", "BGP Boilerplate"]) },
    { label: "Tenant Handbook", preview: makePreview(["Tenant", "Handbook"], ["Property Introduction", "Building Management", "Fit-Out Requirements", "Health & Safety"]) },
    { label: "Rent Review Memo", preview: makePreview(["Rent Review", "Memorandum"], ["Property & Current Rent", "Comparable Evidence", "Recommended ERV", "Negotiation Strategy"]) },
    { label: "Instruction Letter", preview: makePreview(["Instruction", "Letter"], ["Addressee Details", "Scope of Work", "Fee Basis & Terms", "Signature Block"]) },
    { label: "Investment Memo", preview: makePreview(["Investment", "Memorandum"], ["Property Summary", "Tenancy Schedule", "Market Context", "Pricing & Yield Analysis"]) },
    { label: "Leasing Strategy", preview: makePreview(["Leasing", "Strategy"], ["Scheme Overview", "Catchment & Footfall", "Target Tenant Mix", "Marketing Timeline"]) },
    { label: "Requirement Flyer", preview: makePreview(["Requirement", "Flyer"], ["Brand Name & Concept", "Target Locations", "Unit Size Requirements", "Contact Details"]) },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Sparkles className="w-4.5 h-4.5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-[16px] font-bold text-gray-900">Document Studio</h2>
          <p className="text-[12px] text-gray-500">Tap a template to generate on desktop</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {docTypes.map((doc, i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-200 overflow-hidden bg-white active:bg-gray-50"
            onClick={() => {
              navigate("/templates");
              toast({ title: "Opening Document Studio", description: `Open "${doc.label}" on desktop for full editing` });
            }}
            data-testid={`mobile-doc-${i}`}
          >
            <div className="flex items-center justify-center py-3 bg-[#f8f7f4] border-b border-gray-100">
              <MobileDocPreview design={doc.preview} scale={0.1} />
            </div>
            <div className="px-3 py-2.5">
              <div className="text-[13px] font-semibold text-gray-900 leading-tight">{doc.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MobileApp({ initialTab = "ai" }: { initialTab?: "chats" | "ai" | "menu" }) {
  const { theme, toggleTheme, colorScheme, setColorScheme } = useTheme();
  const [tab, setTab] = useState<"chats" | "ai" | "menu">(initialTab);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThreadAi, setActiveThreadAi] = useState(initialTab === "ai");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showChat, setShowChat] = useState(initialTab === "ai");
  const [chatSearch, setChatSearch] = useState("");
  const [moreSubTab, setMoreSubTab] = useState<MoreSubTab>("people");
  const [peopleToggle, setPeopleToggle] = useState<"contacts" | "companies">("contacts");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [trackerSearch, setTrackerSearch] = useState("");
  const [trackerStatusFilter, setTrackerStatusFilter] = useState<string | null>(null);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [trackerBoardType, setTrackerBoardType] = useState<"Purchases" | "Sales">("Purchases");
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [showMobileMarketingFiles, setShowMobileMarketingFiles] = useState(false);
  const [showMobileNewProperty, setShowMobileNewProperty] = useState(false);
  const [mobileNewPropLinkType, setMobileNewPropLinkType] = useState<"property" | "deal">("property");
  const [mobileNewPropSelectedId, setMobileNewPropSelectedId] = useState("");
  const [mobileNewPropSearch, setMobileNewPropSearch] = useState("");
  const [marketingFileSearch, setMarketingFileSearch] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [, navigate] = useLocation();
  const { activeTeam: mobileTeam } = useTeam();
  const { toast } = useToast();

  const { data: currentUser } = useQuery<UserType | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: threads } = useQuery<ThreadData[]>({
    queryKey: ["/api/chat/threads"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: notifications } = useQuery<{ unseenCount: number }>({
    queryKey: ["/api/chat/notifications"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 15000,
  });

  const { data: allUsers } = useQuery<Array<{ id: string; name: string; username: string; team?: string | null }>>({
    queryKey: ["/api/users"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: crmProperties = [], isLoading: crmPropsLoading } = useQuery<any[]>({
    queryKey: ["/api/crm/properties"],
    enabled: tab === "ai",
  });

  const { data: crmDeals = [], isLoading: crmDealsLoading } = useQuery<any[]>({
    queryKey: ["/api/crm/deals"],
    enabled: tab === "ai",
  });

  type MobileMarketingFile = {
    id: string; fileName: string; filePath: string; fileSize: number | null;
    mimeType: string | null; createdAt: string | null; unitName: string | null; propertyId: string | null;
  };

  const { data: allMobileMarketingFiles = [], isLoading: mobileMarketingLoading, isError: mobileMarketingError, refetch: refetchMobileMarketing } = useQuery<MobileMarketingFile[]>({
    queryKey: ["/api/available-units/all-files"],
    enabled: showMobileMarketingFiles,
  });

  const filteredMobileMarketingFiles = useMemo(() => {
    if (!marketingFileSearch.trim()) return allMobileMarketingFiles;
    const q = marketingFileSearch.toLowerCase();
    return allMobileMarketingFiles.filter(f =>
      f.fileName.toLowerCase().includes(q) ||
      (f.unitName || "").toLowerCase().includes(q) ||
      (f.propertyId && crmProperties.find((p: any) => p.id === f.propertyId)?.name || "").toLowerCase().includes(q)
    );
  }, [allMobileMarketingFiles, marketingFileSearch, crmProperties]);

  const groupedMobileMarketingFiles = useMemo(() => {
    const propNameMap: Record<string, string> = {};
    for (const p of crmProperties) propNameMap[p.id] = p.name;
    const groups: Record<string, { propertyName: string; files: MobileMarketingFile[] }> = {};
    for (const f of filteredMobileMarketingFiles) {
      const pName = f.propertyId ? (propNameMap[f.propertyId] || "Unknown Property") : "Unknown Property";
      const key = f.propertyId || "unknown";
      if (!groups[key]) groups[key] = { propertyName: pName, files: [] };
      groups[key].files.push(f);
    }
    return Object.values(groups).sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [filteredMobileMarketingFiles, crmProperties]);

  const { data: agentSummary } = useQuery<Array<{ agent: string; invoiced: number; wip: number }>>({
    queryKey: ["/api/wip/agent-summary"],
    enabled: tab === "menu",
  });

  const isInvestmentTeam = mobileTeam === "Investment";

  const [showFavouritesOnly, setShowFavouritesOnly] = useState(false);

  const { data: contacts, isLoading: contactsLoading } = useQuery<Array<{
    id: string; name: string; role: string | null; companyName: string | null;
    email: string | null; phone: string | null; contactType: string | null;
    isFavourite: boolean | null;
  }>>({
    queryKey: ["/api/crm/contacts"],
    enabled: (tab === "menu" && moreSubTab === "people" && peopleToggle === "contacts") || !!selectedDealId,
  });

  const { data: companies, isLoading: companiesLoading } = useQuery<Array<{
    id: string; name: string; companyType: string | null; domain: string | null;
    headOfficeAddress: string | null; groupName: string | null;
  }>>({
    queryKey: ["/api/crm/companies"],
    enabled: (tab === "menu" && moreSubTab === "people" && peopleToggle === "companies") || !!selectedDealId,
  });

  const { data: investmentItems, isLoading: investmentLoading } = useQuery<Array<{
    id: string; assetName: string; assetType: string | null; guidePrice: number | null;
    niy: number | null; eqy: number | null; status: string | null; boardType: string | null;
    client: string | null; clientContact: string | null; address: string | null; tenure: string | null;
    sqft: number | null; currentRent: number | null; ervPa: number | null;
    occupancy: string | null; capexRequired: string | null;
    vendor: string | null; vendorAgent: string | null; buyer: string | null;
    waultBreak: string | null; waultExpiry: string | null;
    notes: string | null; fee: number | null; feeType: string | null;
    marketingDate: string | null; bidDeadline: string | null;
    dealId: string | null; agentUserIds: string[] | null;
  }>>({
    queryKey: ["/api/investment-tracker"],
    enabled: tab === "menu" && moreSubTab === "tracker" && isInvestmentTeam,
  });

  const { data: lettingItems, isLoading: lettingLoading } = useQuery<Array<{
    id: string; unitName: string; propertyId: string | null; floor: string | null;
    sqft: number | null; askingRent: number | null; marketingStatus: string | null;
    useClass: string | null; epcRating: string | null; viewingsCount: number;
    ratesPa: number | null; serviceChargePa: number | null; condition: string | null;
    availableDate: string | null; notes: string | null; restrictions: string | null;
    fee: number | null; dealId: string | null; agentUserIds: string[] | null;
    lastViewingDate: string | null; marketingStartDate: string | null;
    propertyName: string | null; propertyAddress: string | null;
  }>>({
    queryKey: ["/api/available-units"],
    enabled: tab === "menu" && moreSubTab === "tracker" && !isInvestmentTeam,
  });

  const { data: dealMarketingFiles } = useQuery<Array<{
    id: string; fileName: string; fileUrl: string; fileSize: number | null; uploadedAt: string;
  }>>({
    queryKey: ["/api/investment-tracker", selectedDealId, "marketing-files"],
    queryFn: async () => {
      const res = await fetch(`/api/investment-tracker/${selectedDealId}/marketing-files`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedDealId,
  });

  const selectedDeal = useMemo(() => {
    if (!selectedDealId || !investmentItems) return null;
    return investmentItems.find(i => i.id === selectedDealId) || null;
  }, [selectedDealId, investmentItems]);

  const selectedUnit = useMemo(() => {
    if (!selectedUnitId || !lettingItems) return null;
    return lettingItems.find(i => i.id === selectedUnitId) || null;
  }, [selectedUnitId, lettingItems]);

  const { data: unitViewings } = useQuery<Array<{
    id: string; viewingDate: string | null; companyName: string | null; outcome: string | null; notes: string | null;
  }>>({
    queryKey: ["/api/available-units", selectedUnitId, "viewings"],
    queryFn: async () => {
      const res = await fetch(`/api/available-units/${selectedUnitId}/viewings`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedUnitId,
  });

  const { data: unitOffers } = useQuery<Array<{
    id: string; companyName: string | null; rentPa: number | null; rentFreeMonths: number | null;
    termYears: number | null; status: string | null; incentives: string | null;
  }>>({
    queryKey: ["/api/available-units", selectedUnitId, "offers"],
    queryFn: async () => {
      const res = await fetch(`/api/available-units/${selectedUnitId}/offers`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedUnitId,
  });

  const { data: newsArticles, isLoading: newsLoading } = useQuery<Array<{
    id: string; title: string; sourceName: string | null; url: string | null;
    imageUrl: string | null; publishedAt: string | null; aiSummary: string | null;
    summary: string | null; category: string | null;
  }>>({
    queryKey: ["/api/news-feed/articles"],
    enabled: tab === "menu" && moreSubTab === "news",
  });

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    let result = contacts;
    if (showFavouritesOnly) {
      result = result.filter(c => c.isFavourite);
    }
    if (peopleSearch.trim()) {
      const q = peopleSearch.toLowerCase();
      result = result.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.companyName?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.role?.toLowerCase().includes(q)
      );
    }
    return result.slice(0, 100);
  }, [contacts, peopleSearch, showFavouritesOnly]);

  const filteredCompanies = useMemo(() => {
    if (!companies) return [];
    if (!peopleSearch.trim()) return companies.slice(0, 100);
    const q = peopleSearch.toLowerCase();
    return companies.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.companyType?.toLowerCase().includes(q) ||
      c.domain?.toLowerCase().includes(q)
    ).slice(0, 100);
  }, [companies, peopleSearch]);

  const investmentStatusColors: Record<string, { bg: string; text: string; border: string }> = {
    "Live": { bg: "bg-blue-500", text: "text-white", border: "border-blue-500" },
    "Available": { bg: "bg-emerald-500", text: "text-white", border: "border-emerald-500" },
    "Speculative": { bg: "bg-purple-500", text: "text-white", border: "border-purple-500" },
    "Completed": { bg: "bg-green-600", text: "text-white", border: "border-green-600" },
    "Under Offer": { bg: "bg-amber-500", text: "text-white", border: "border-amber-500" },
    "Exchanged": { bg: "bg-teal-500", text: "text-white", border: "border-teal-500" },
    "Withdrawn": { bg: "bg-red-500", text: "text-white", border: "border-red-500" },
  };

  const lettingStatusColors: Record<string, { bg: string; text: string; border: string }> = {
    "Available": { bg: "bg-emerald-500", text: "text-white", border: "border-emerald-500" },
    "Under Offer": { bg: "bg-amber-500", text: "text-white", border: "border-amber-500" },
    "Let": { bg: "bg-blue-500", text: "text-white", border: "border-blue-500" },
    "Let Agreed": { bg: "bg-teal-500", text: "text-white", border: "border-teal-500" },
    "Withdrawn": { bg: "bg-red-500", text: "text-white", border: "border-red-500" },
  };

  const boardFilteredInvestmentItems = useMemo(() => {
    if (!investmentItems) return [];
    return investmentItems.filter(i => (i.boardType || "Purchases") === trackerBoardType);
  }, [investmentItems, trackerBoardType]);

  const trackerStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (isInvestmentTeam) {
      boardFilteredInvestmentItems.forEach(i => {
        const s = i.status || "No Status";
        counts[s] = (counts[s] || 0) + 1;
      });
    } else if (!isInvestmentTeam && lettingItems) {
      lettingItems.forEach(i => {
        const s = i.marketingStatus || "No Status";
        counts[s] = (counts[s] || 0) + 1;
      });
    }
    return counts;
  }, [isInvestmentTeam, boardFilteredInvestmentItems, lettingItems]);

  const filteredTrackerItems = useMemo(() => {
    if (isInvestmentTeam) {
      let items = boardFilteredInvestmentItems;
      if (trackerStatusFilter) {
        items = items.filter(i => (i.status || "No Status") === trackerStatusFilter);
      }
      if (trackerSearch.trim()) {
        const q = trackerSearch.toLowerCase();
        items = items.filter(i =>
          i.assetName?.toLowerCase().includes(q) ||
          i.client?.toLowerCase().includes(q) ||
          i.address?.toLowerCase().includes(q) ||
          i.status?.toLowerCase().includes(q)
        );
      }
      return items;
    } else {
      if (!lettingItems) return [];
      let items = lettingItems;
      if (trackerStatusFilter) {
        items = items.filter(i => (i.marketingStatus || "No Status") === trackerStatusFilter);
      }
      if (trackerSearch.trim()) {
        const q = trackerSearch.toLowerCase();
        items = items.filter(i =>
          i.unitName?.toLowerCase().includes(q) ||
          i.propertyName?.toLowerCase().includes(q) ||
          i.propertyAddress?.toLowerCase().includes(q) ||
          i.marketingStatus?.toLowerCase().includes(q) ||
          i.useClass?.toLowerCase().includes(q) ||
          i.condition?.toLowerCase().includes(q)
        );
      }
      return items;
    }
  }, [isInvestmentTeam, boardFilteredInvestmentItems, lettingItems, trackerSearch, trackerStatusFilter]);

  const createThreadMutation = useMutation({
    mutationFn: async ({ title, isAiChat, memberIds }: { title?: string; isAiChat: boolean; memberIds?: string[] }) => {
      const res = await apiRequest("POST", "/api/chat/threads", { title, isAiChat, memberIds });
      return res.json();
    },
    onSuccess: (thread: ThreadData) => {
      setActiveThreadId(thread.id);
      setActiveThreadAi(thread.isAiChat);
      setShowNewGroup(false);
      setShowChat(true);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
  });

  const unseenCount = notifications?.unseenCount || 0;

  const userPics = useMemo(() => {
    const map: Record<string, string> = {};
    if (allUsers) {
      for (const u of allUsers) {
        if ((u as any).profilePicUrl) map[u.id] = (u as any).profilePicUrl;
      }
    }
    return map;
  }, [allUsers]);

  const { teamThreads, aiThreads, otherThreads } = useMemo(() => {
    const team: ThreadData[] = [];
    const ai: ThreadData[] = [];
    const other: ThreadData[] = [];
    for (const t of (threads || [])) {
      if (t.isAiChat) ai.push(t);
      else if (t.members.length > 0) {
        const otherMembers = t.members.filter(m => m.id !== currentUser?.id);
        if (otherMembers.length > 1) team.push(t);
      }
    }
    return { teamThreads: team, aiThreads: ai, otherThreads: other };
  }, [threads, currentUser?.id]);

  const filteredTeamThreads = useMemo(() => {
    if (!chatSearch.trim()) return teamThreads;
    const q = chatSearch.toLowerCase();
    return teamThreads.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.linkedName?.toLowerCase().includes(q) ||
      t.lastMessage?.content?.toLowerCase().includes(q) ||
      t.members.some(m => m.name?.toLowerCase().includes(q))
    );
  }, [teamThreads, chatSearch]);

  const filteredOtherThreads = useMemo(() => {
    if (!chatSearch.trim()) return otherThreads;
    const q = chatSearch.toLowerCase();
    return otherThreads.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.linkedName?.toLowerCase().includes(q) ||
      t.lastMessage?.content?.toLowerCase().includes(q)
    );
  }, [otherThreads, chatSearch]);

  const filteredAiThreads = useMemo(() => {
    if (!chatSearch.trim()) return aiThreads;
    const q = chatSearch.toLowerCase();
    return aiThreads.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.linkedName?.toLowerCase().includes(q) ||
      t.lastMessage?.content?.toLowerCase().includes(q)
    );
  }, [aiThreads, chatSearch]);

  const { aiProjectItems, aiDateGroups } = useMemo(() => {
    const linked = filteredAiThreads.filter(t => t.linkedType && t.linkedId);
    const unlinked = filteredAiThreads.filter(t => !t.linkedType || !t.linkedId);

    type AiProjectItem = { type: string; id: string; name: string; threads: ThreadData[] };
    const projectMap = new Map<string, AiProjectItem>();
    for (const t of linked) {
      const key = `${t.linkedType}-${t.linkedId}`;
      if (!projectMap.has(key)) {
        projectMap.set(key, { type: t.linkedType!, id: t.linkedId!, name: t.linkedName || "Untitled", threads: [] });
      }
      projectMap.get(key)!.threads.push(t);
    }
    const aiProjectItems = Array.from(projectMap.values());

    const groups: { label: string; threads: ThreadData[] }[] = [];
    const seen = new Set<string>();
    for (const t of unlinked) {
      const d = new Date(t.updatedAt || t.createdAt);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
      let label: string;
      if (d.toDateString() === now.toDateString()) label = "Today";
      else if (diffDays <= 1) label = "Yesterday";
      else if (diffDays < 7) label = "Previous 7 Days";
      else if (diffDays < 30) label = "Previous 30 Days";
      else label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      if (!seen.has(label)) { seen.add(label); groups.push({ label, threads: [] }); }
      groups.find(g => g.label === label)?.threads.push(t);
    }
    return { aiProjectItems, aiDateGroups: groups };
  }, [filteredAiThreads]);

  const [expandedAiProjects, setExpandedAiProjects] = useState<Set<string>>(new Set());

  const handleDeleteThread = async (threadId: string) => {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await apiRequest("DELETE", `/api/chat/threads/${threadId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setShowChat(false);
      }
    } catch {}
  };

  const openThread = (thread: ThreadData) => {
    setActiveThreadId(thread.id);
    setActiveThreadAi(thread.isAiChat);
    setShowChat(true);
  };

  const openNewAiChat = () => {
    setActiveThreadId(null);
    setActiveThreadAi(true);
    setShowChat(true);
    setShowMobileMarketingFiles(false);
  };

  const handleCreateMobilePropertyChat = async (data: { linkedType: string; linkedId: string; linkedName: string }) => {
    try {
      const res = await apiRequest("POST", "/api/chat/threads", {
        isAiChat: true,
        linkedType: data.linkedType,
        linkedId: data.linkedId,
        linkedName: data.linkedName,
      });
      const thread = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      setShowMobileNewProperty(false);
      setActiveThreadId(thread.id);
      setActiveThreadAi(true);
      setShowChat(true);
    } catch {
      toast({ title: "Failed to create chat", variant: "destructive" });
    }
  };

  const handleMobileShareFile = async (file: MobileMarketingFile) => {
    const fileUrl = `${window.location.origin}${file.filePath}?view=1`;
    if (navigator.share) {
      try { await navigator.share({ title: file.fileName, url: fileUrl }); return; } catch {}
    }
    try {
      await navigator.clipboard.writeText(fileUrl);
      toast({ title: "Link copied", description: "File link copied to clipboard" });
    } catch {
      toast({ title: "Unable to copy", variant: "destructive" });
    }
  };

  if (showChat) {
    return (
      <MobileChatView
        threadId={activeThreadId}
        isAiChat={activeThreadAi}
        onBack={() => { setShowChat(false); setActiveThreadId(null); queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] }); }}
        onNewChat={openNewAiChat}
        currentUser={currentUser ?? null}
      />
    );
  }

  if (showNewGroup) {
    return (
      <MobileNewGroup
        allUsers={allUsers || []}
        currentUser={currentUser ?? null}
        onBack={() => setShowNewGroup(false)}
        onCreate={(title, memberIds) => createThreadMutation.mutate({ title, isAiChat: false, memberIds })}
      />
    );
  }

  return (
    <div className="flex flex-col w-screen bg-white overflow-x-hidden fixed inset-0">
      <div className="bg-black text-white pt-[calc(0.75rem+env(safe-area-inset-top))] shrink-0">
        <div className="flex items-center justify-between px-5 pb-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {tab === "chats" ? "Chats" : tab === "ai" ? (showMobileMarketingFiles ? "Marketing" : "ChatBGP") : moreSubTab === "people" ? "People" : moreSubTab === "tracker" ? (isInvestmentTeam ? "Investment" : "Letting") : "News"}
          </h1>
          <div className="flex items-center gap-2">
            {tab === "chats" && (
              <button onClick={() => setShowNewGroup(true)} className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center active:bg-white/25" data-testid="button-mobile-new-group">
                <Plus className="w-5 h-5" />
              </button>
            )}
            {tab === "ai" && !showMobileMarketingFiles && (
              <button onClick={openNewAiChat} className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center active:bg-white/25" data-testid="button-mobile-new-ai">
                <Plus className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center active:bg-white/25"
              data-testid="button-mobile-color-scheme"
            >
              <Palette className="w-5 h-5" />
            </button>
          </div>
        </div>
        {showColorPicker && (
          <div className="px-5 pb-3 pt-1">
            <div className="flex gap-2">
              {COLOR_SCHEMES.map((scheme) => (
                <button
                  key={scheme.id}
                  onClick={() => { setColorScheme(scheme.id); setShowColorPicker(false); }}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl transition-colors ${colorScheme === scheme.id ? "bg-white/20" : "bg-white/5 active:bg-white/15"}`}
                  data-testid={`button-mobile-scheme-${scheme.id}`}
                >
                  <div className="w-6 h-6 rounded-full border-2 border-white/30 shrink-0" style={{ backgroundColor: scheme.color }} />
                  <span className="text-[10px] font-medium text-white/80">{scheme.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <PullToRefresh onRefresh={async () => { await queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] }); }}>
        {tab === "chats" && (
          <div className="px-4 pt-3 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                placeholder="Search chats..."
                className="h-10 pl-9 pr-9 text-sm rounded-xl bg-gray-100 border-0 placeholder:text-gray-400"
                data-testid="input-mobile-chat-search"
              />
              {chatSearch && (
                <button onClick={() => setChatSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "chats" && (
          <div>
            {[...filteredTeamThreads, ...filteredOtherThreads].length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
                  <MessageCircle className="w-10 h-10 text-gray-300" />
                </div>
                <p className="text-lg text-gray-400">{chatSearch ? "No chats found" : "No conversations yet"}</p>
                {!chatSearch && (
                  <Button variant="outline" size="lg" className="h-12 text-base rounded-xl border-gray-200" onClick={() => setShowNewGroup(true)} data-testid="button-mobile-empty-new-group">
                    <Users className="w-5 h-5 mr-2" /> New Chat
                  </Button>
                )}
              </div>
            ) : (
              <div>
                {filteredTeamThreads.map(t => <MobileThreadCard key={t.id} thread={t} onClick={() => openThread(t)} currentUserId={currentUser?.id} onDelete={handleDeleteThread} userPics={userPics} />)}
                {filteredOtherThreads.map(t => <MobileThreadCard key={t.id} thread={t} onClick={() => openThread(t)} currentUserId={currentUser?.id} onDelete={handleDeleteThread} userPics={userPics} />)}
              </div>
            )}
          </div>
        )}

        {tab === "ai" && !showMobileMarketingFiles && (
          <div>
            <div className="px-4 pt-3 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  placeholder="Search conversations..."
                  className="h-10 pl-9 pr-9 text-sm rounded-xl bg-gray-100 border-0 placeholder:text-gray-400"
                  data-testid="input-mobile-ai-search"
                />
                {chatSearch && (
                  <button onClick={() => setChatSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                )}
              </div>
            </div>

            <button
              className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors"
              onClick={() => { window.location.href = "/chatbgp"; }}
              data-testid="button-mobile-chatbgp-home"
            >
              <Sparkles className="w-5 h-5 shrink-0" />
              <span className="text-[15px] font-medium">Chat BGP</span>
            </button>

            <button
              className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors"
              onClick={() => { setShowMobileMarketingFiles(true); setMarketingFileSearch(""); }}
              data-testid="button-mobile-marketing-details"
            >
              <FileText className="w-5 h-5 shrink-0" />
              <span className="text-[15px] font-medium">Marketing Details</span>
            </button>

            <button
              className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors"
              onClick={() => { setShowMobileNewProperty(true); setMobileNewPropSelectedId(""); setMobileNewPropSearch(""); setMobileNewPropLinkType("property"); }}
              data-testid="button-mobile-new-property"
            >
              <Building2 className="w-5 h-5 shrink-0" />
              <span className="text-[15px] font-medium">New Property</span>
            </button>

            <div className="h-px bg-gray-200 mx-4 my-1" />

            {filteredAiThreads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <MessageSquare className="w-8 h-8 text-gray-300" />
                <p className="text-[14px] text-gray-400">{chatSearch ? "No matching chats" : "No conversations yet"}</p>
              </div>
            ) : (
              <div>
                {aiProjectItems.length > 0 && (
                  <div className="mb-1">
                    {aiProjectItems.map(project => {
                      const key = `${project.type}-${project.id}`;
                      const isExpanded = expandedAiProjects.has(key);
                      const singleThread = project.threads.length === 1 ? project.threads[0] : null;
                      return (
                        <ProjectItemRow
                          key={key}
                          project={project}
                          isExpanded={isExpanded}
                          singleThread={singleThread}
                          onToggle={() => {
                            setExpandedAiProjects(prev => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key); else next.add(key);
                              return next;
                            });
                          }}
                          openThread={openThread}
                          currentUserId={currentUser?.id}
                          onDelete={handleDeleteThread}
                          userPics={userPics}
                        />
                      );
                    })}
                    <div className="h-px bg-gray-200 mx-4 my-1" />
                  </div>
                )}

                {aiDateGroups.map(group => (
                  <div key={group.label}>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 pt-3 pb-1">{group.label}</p>
                    {group.threads.map(t => (
                      <MobileThreadCard key={t.id} thread={t} onClick={() => openThread(t)} currentUserId={currentUser?.id} onDelete={handleDeleteThread} userPics={userPics} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "ai" && showMobileMarketingFiles && (
          <div className="px-4 pt-3 pb-4">
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => setShowMobileMarketingFiles(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl active:bg-gray-100"
                data-testid="button-mobile-back-marketing"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-[17px] font-bold">Marketing Details</h2>
                <p className="text-[12px] text-gray-400">{allMobileMarketingFiles.length} file{allMobileMarketingFiles.length !== 1 ? "s" : ""} across all properties</p>
              </div>
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search files, units, properties..."
                value={marketingFileSearch}
                onChange={e => setMarketingFileSearch(e.target.value)}
                className="h-10 pl-9 pr-9 text-sm rounded-xl bg-gray-100 border-0"
                data-testid="input-mobile-search-marketing"
              />
              {marketingFileSearch && (
                <button onClick={() => setMarketingFileSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>

            {mobileMarketingLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-36 rounded-xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : mobileMarketingError ? (
              <div className="text-center py-16">
                <AlertCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-[14px] font-medium text-gray-400 mb-3">Failed to load files</p>
                <Button variant="outline" size="sm" onClick={() => refetchMobileMarketing()} className="rounded-lg" data-testid="button-mobile-retry-marketing">Try again</Button>
              </div>
            ) : filteredMobileMarketingFiles.length === 0 ? (
              <div className="text-center py-16">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-[14px] font-medium text-gray-400">
                  {marketingFileSearch ? "No files match your search" : "No marketing files yet"}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {groupedMobileMarketingFiles.map(group => (
                  <div key={group.propertyName}>
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-3.5 h-3.5 text-gray-400" />
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{group.propertyName}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {group.files.map(f => {
                        const isImage = f.mimeType?.startsWith("image/");
                        const isPdf = f.mimeType?.includes("pdf");
                        return (
                          <div
                            key={f.id}
                            className="rounded-xl border border-gray-200 bg-white overflow-hidden active:opacity-70"
                            onClick={() => window.open(`${f.filePath}?view=1`, "_blank")}
                            data-testid={`mobile-marketing-tile-${f.id}`}
                          >
                            <div className="relative w-full aspect-[4/3] bg-gray-50 overflow-hidden">
                              {isImage ? (
                                <img src={`${f.filePath}?view=1`} alt={f.fileName} className="w-full h-full object-cover" loading="lazy" />
                              ) : isPdf ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-red-50">
                                  <FileText className="w-8 h-8 text-red-500 mb-1" />
                                  <span className="text-[10px] font-bold text-red-500 uppercase">PDF</span>
                                </div>
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center">
                                  <File className="w-8 h-8 text-gray-400" />
                                  <span className="text-[10px] font-medium text-gray-400 mt-1 uppercase">{f.fileName.split('.').pop()}</span>
                                </div>
                              )}
                            </div>
                            <div className="p-2.5">
                              <p className="text-[12px] font-medium leading-snug line-clamp-2 mb-1">{f.fileName}</p>
                              <p className="text-[10px] text-gray-400">
                                {f.unitName && <span>{f.unitName} · </span>}
                                {f.fileSize ? (f.fileSize < 1024 * 1024 ? `${(f.fileSize / 1024).toFixed(0)} KB` : `${(f.fileSize / (1024 * 1024)).toFixed(1)} MB`) : ""}
                              </p>
                              <div className="flex gap-1.5 mt-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleMobileShareFile(f); }}
                                  className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-gray-100 active:bg-gray-200 text-[11px] font-medium"
                                  data-testid={`button-mobile-share-tile-${f.id}`}
                                >
                                  <Mail className="w-3 h-3" /> Share
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); window.open(f.filePath, "_blank"); }}
                                  className="h-7 w-7 flex items-center justify-center rounded-lg bg-gray-100 active:bg-gray-200 shrink-0"
                                  data-testid={`button-mobile-download-tile-${f.id}`}
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
        )}

        {tab === "menu" && (
          <div className="pb-4 flex flex-col h-full">
            <div className="px-4 pt-3 pb-2 shrink-0">
              <div className="flex bg-gray-100 rounded-xl p-1">
                {(["people", "tracker", "news", "docs"] as MoreSubTab[]).map(st => (
                  <button
                    key={st}
                    onClick={() => { setMoreSubTab(st); if (st !== "tracker") { setTrackerStatusFilter(null); setTrackerSearch(""); setShowStatusDropdown(false); } }}
                    className={`flex-1 py-2 text-[13px] font-semibold rounded-lg transition-all ${moreSubTab === st ? "bg-white text-black shadow-sm" : "text-gray-500"}`}
                    data-testid={`more-tab-${st}`}
                  >
                    {st === "people" ? "People" : st === "tracker" ? (isInvestmentTeam ? "Investment" : "Letting") : st === "news" ? "News" : "Docs"}
                  </button>
                ))}
              </div>
            </div>

            {moreSubTab === "people" && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-4 pb-2 shrink-0">
                  <div className="flex bg-gray-100 rounded-lg p-0.5 mb-3">
                    <button
                      onClick={() => setPeopleToggle("contacts")}
                      className={`flex-1 py-1.5 text-[12px] font-medium rounded-md transition-all ${peopleToggle === "contacts" ? "bg-white text-black shadow-sm" : "text-gray-500"}`}
                      data-testid="people-toggle-contacts"
                    >
                      Contacts {contacts ? `(${contacts.length})` : ""}
                    </button>
                    <button
                      onClick={() => setPeopleToggle("companies")}
                      className={`flex-1 py-1.5 text-[12px] font-medium rounded-md transition-all ${peopleToggle === "companies" ? "bg-white text-black shadow-sm" : "text-gray-500"}`}
                      data-testid="people-toggle-companies"
                    >
                      Companies {companies ? `(${companies.length})` : ""}
                    </button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        value={peopleSearch}
                        onChange={(e) => setPeopleSearch(e.target.value)}
                        placeholder={peopleToggle === "contacts" ? "Search contacts..." : "Search companies..."}
                        className="h-10 pl-9 pr-9 text-sm rounded-xl bg-gray-100 border-0 placeholder:text-gray-400"
                        data-testid="input-people-search"
                      />
                      {peopleSearch && (
                        <button onClick={() => setPeopleSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                          <X className="w-4 h-4 text-gray-400" />
                        </button>
                      )}
                    </div>
                    {peopleToggle === "contacts" && (
                      <button
                        onClick={() => setShowFavouritesOnly(!showFavouritesOnly)}
                        className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${showFavouritesOnly ? "bg-amber-100" : "bg-gray-100"}`}
                        data-testid="button-favourites-filter"
                      >
                        <Star className={`w-5 h-5 ${showFavouritesOnly ? "text-amber-500 fill-amber-500" : "text-gray-400"}`} />
                      </button>
                    )}
                    {peopleToggle === "contacts" && (
                      <label
                        className="h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 cursor-pointer active:bg-gray-200"
                        data-testid="button-import-contacts"
                      >
                        <Upload className="w-5 h-5 text-gray-400" />
                        <input
                          type="file"
                          accept=".vcf,.vcard"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const text = await file.text();
                              const resp = await apiRequest("POST", "/api/crm/contacts/import-vcf", { vcfText: text });
                              const result = await resp.json();
                              queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
                              toast({
                                title: "Contacts imported",
                                description: `${result.imported} added, ${result.skippedPersonal || 0} personal skipped, ${result.skippedDuplicate || 0} duplicates skipped`,
                              });
                            } catch (err: any) {
                              toast({ title: "Import failed", description: err.message, variant: "destructive" });
                            }
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4">
                  {(contactsLoading || companiesLoading) && (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-8 h-8 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
                    </div>
                  )}
                  {peopleToggle === "contacts" && !contactsLoading && (
                    <div className="space-y-2">
                      {filteredContacts.length === 0 ? (
                        <div className="text-center py-16 text-gray-400 text-[15px]">
                          {showFavouritesOnly ? "No favourite contacts yet — tap the star on a contact to add them" : peopleSearch ? "No contacts found" : "No contacts yet"}
                        </div>
                      ) : filteredContacts.map(c => (
                        <div
                          key={c.id}
                          className="w-full flex items-center gap-3 p-3 bg-gray-50 rounded-xl text-left"
                          data-testid={`contact-card-${c.id}`}
                        >
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await apiRequest("PATCH", `/api/crm/contacts/${c.id}/favourite`, { isFavourite: !c.isFavourite });
                                queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
                              } catch (err: any) {
                                toast({ title: "Failed to update favourite", description: err.message, variant: "destructive" });
                              }
                            }}
                            className="shrink-0"
                            data-testid={`star-contact-${c.id}`}
                          >
                            <Star className={`w-5 h-5 ${c.isFavourite ? "text-amber-500 fill-amber-500" : "text-gray-300"}`} />
                          </button>
                          <button onClick={() => navigate(`/contacts/${c.id}`)} className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center shrink-0">
                              <span className="text-sm font-bold">{c.name?.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[15px] font-medium text-gray-900 truncate">{c.name}</div>
                              <div className="text-[13px] text-gray-500 truncate">
                                {[c.role, c.companyName].filter(Boolean).join(" · ") || "No details"}
                              </div>
                            </div>
                          </button>
                          {c.phone && (
                            <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                              <Phone className="w-4 h-4 text-emerald-600" />
                            </a>
                          )}
                          {c.email && (
                            <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                              <Mail className="w-4 h-4 text-blue-600" />
                            </a>
                          )}
                        </div>
                      ))}
                      {filteredContacts.length >= 100 && (
                        <div className="text-center py-3 text-[13px] text-gray-400">Showing first 100 results — refine your search</div>
                      )}
                    </div>
                  )}
                  {peopleToggle === "companies" && !companiesLoading && (
                    <div className="space-y-2">
                      {filteredCompanies.length === 0 ? (
                        <div className="text-center py-16 text-gray-400 text-[15px]">
                          {peopleSearch ? "No companies found" : "No companies yet"}
                        </div>
                      ) : filteredCompanies.map(c => (
                        <button
                          key={c.id}
                          onClick={() => navigate(`/companies/${c.id}`)}
                          className="w-full flex items-center gap-3 p-3 bg-gray-50 rounded-xl active:bg-gray-100 text-left"
                          data-testid={`company-card-${c.id}`}
                        >
                          <div className="w-10 h-10 rounded-full bg-gray-800 text-white flex items-center justify-center shrink-0">
                            <Building2 className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[15px] font-medium text-gray-900 truncate">{c.name}</div>
                            <div className="text-[13px] text-gray-500 truncate">
                              {[c.companyType, c.groupName].filter(Boolean).join(" · ") || c.domain || ""}
                            </div>
                          </div>
                          <ChevronDown className="w-4 h-4 text-gray-300 -rotate-90 shrink-0" />
                        </button>
                      ))}
                      {filteredCompanies.length >= 100 && (
                        <div className="text-center py-3 text-[13px] text-gray-400">Showing first 100 results — refine your search</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {moreSubTab === "tracker" && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-4 pb-3 shrink-0">
                  {(() => {
                    const isWoody = currentUser?.username === "woody@brucegillinghampollard.com";
                    if (isInvestmentTeam) {
                      const myRow = agentSummary?.find(r => r.agent === currentUser?.name);
                      const totalInvoiced = agentSummary ? agentSummary.reduce((s, r) => s + r.invoiced, 0) : 0;
                      const totalWip = agentSummary ? agentSummary.reduce((s, r) => s + r.wip, 0) : 0;
                      const myInvoiced = myRow?.invoiced || 0;
                      const myWip = myRow?.wip || 0;
                      return (
                        <div className="mb-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-emerald-50/70 rounded-2xl p-4" data-testid="summary-invoiced">
                              <div className="text-[12px] font-medium text-emerald-700/80 mb-1.5">
                                {isWoody ? "Total Invoiced" : "My Invoiced"}
                              </div>
                              <div className="text-[22px] font-bold text-emerald-700 tracking-tight tabular-nums">
                                £{(isWoody ? totalInvoiced : myInvoiced).toLocaleString()}
                              </div>
                            </div>
                            <div className="bg-amber-50/70 rounded-2xl p-4" data-testid="summary-wip">
                              <div className="text-[12px] font-medium text-amber-700/80 mb-1.5">
                                {isWoody ? "Total WIP" : "My WIP"}
                              </div>
                              <div className="text-[22px] font-bold text-amber-700 tracking-tight tabular-nums">
                                £{(isWoody ? totalWip : myWip).toLocaleString()}
                              </div>
                            </div>
                          </div>
                          {isWoody && (
                            <div className="grid grid-cols-2 gap-3 mt-2.5">
                              <div className="bg-emerald-50/40 rounded-2xl p-3">
                                <div className="text-[11px] font-medium text-emerald-600/70">My Invoiced</div>
                                <div className="text-[17px] font-semibold text-emerald-700 tracking-tight tabular-nums">£{myInvoiced.toLocaleString()}</div>
                              </div>
                              <div className="bg-amber-50/40 rounded-2xl p-3">
                                <div className="text-[11px] font-medium text-amber-600/70">My WIP</div>
                                <div className="text-[17px] font-semibold text-amber-700 tracking-tight tabular-nums">£{myWip.toLocaleString()}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    } else {
                      const myRow = agentSummary?.find(r => r.agent === currentUser?.name);
                      const totalInvoiced = agentSummary ? agentSummary.reduce((s, r) => s + r.invoiced, 0) : 0;
                      const totalWip = agentSummary ? agentSummary.reduce((s, r) => s + r.wip, 0) : 0;
                      const myInvoiced = myRow?.invoiced || 0;
                      const myWip = myRow?.wip || 0;
                      return (
                        <div className="mb-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-emerald-50/70 rounded-2xl p-4" data-testid="summary-invoiced">
                              <div className="text-[12px] font-medium text-emerald-700/80 mb-1.5">
                                {isWoody ? "Total Invoiced" : "My Invoiced"}
                              </div>
                              <div className="text-[22px] font-bold text-emerald-700 tracking-tight tabular-nums">
                                £{(isWoody ? totalInvoiced : myInvoiced).toLocaleString()}
                              </div>
                            </div>
                            <div className="bg-amber-50/70 rounded-2xl p-4" data-testid="summary-wip">
                              <div className="text-[12px] font-medium text-amber-700/80 mb-1.5">
                                {isWoody ? "Total WIP" : "My WIP"}
                              </div>
                              <div className="text-[22px] font-bold text-amber-700 tracking-tight tabular-nums">
                                £{(isWoody ? totalWip : myWip).toLocaleString()}
                              </div>
                            </div>
                          </div>
                          {isWoody && (
                            <div className="grid grid-cols-2 gap-3 mt-2.5">
                              <div className="bg-emerald-50/40 rounded-2xl p-3">
                                <div className="text-[11px] font-medium text-emerald-600/70">My Invoiced</div>
                                <div className="text-[17px] font-semibold text-emerald-700 tracking-tight tabular-nums">£{myInvoiced.toLocaleString()}</div>
                              </div>
                              <div className="bg-amber-50/40 rounded-2xl p-3">
                                <div className="text-[11px] font-medium text-amber-600/70">My WIP</div>
                                <div className="text-[17px] font-semibold text-amber-700 tracking-tight tabular-nums">£{myWip.toLocaleString()}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }
                  })()}

                  {isInvestmentTeam && (
                    <div className="flex bg-gray-100 rounded-xl p-1 mb-3">
                      <button
                        onClick={() => { setTrackerBoardType("Purchases"); setTrackerStatusFilter(null); }}
                        className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all ${trackerBoardType === "Purchases" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                        data-testid="board-toggle-purchases"
                      >
                        Purchases ({investmentItems?.filter(i => (i.boardType || "Purchases") === "Purchases").length || 0})
                      </button>
                      <button
                        onClick={() => { setTrackerBoardType("Sales"); setTrackerStatusFilter(null); }}
                        className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all ${trackerBoardType === "Sales" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                        data-testid="board-toggle-sales"
                      >
                        Sales ({investmentItems?.filter(i => i.boardType === "Sales").length || 0})
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
                    <button
                      onClick={() => { setTrackerStatusFilter(null); }}
                      className={`shrink-0 px-3.5 py-2 rounded-full text-[13px] font-medium transition-all ${
                        !trackerStatusFilter ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
                      }`}
                      data-testid="status-filter-all"
                    >
                      All ({isInvestmentTeam ? boardFilteredInvestmentItems.length : (lettingItems?.length || 0)})
                    </button>
                    {Object.entries(trackerStatusCounts).map(([status, count]) => {
                      const colors = isInvestmentTeam ? investmentStatusColors : lettingStatusColors;
                      const color = colors[status] || { bg: "bg-gray-400", text: "text-white", border: "border-gray-400" };
                      const isActive = trackerStatusFilter === status;
                      return (
                        <button
                          key={status}
                          onClick={() => setTrackerStatusFilter(isActive ? null : status)}
                          className={`shrink-0 px-3.5 py-2 rounded-full text-[13px] font-medium transition-all ${
                            isActive ? `${color.bg} text-white` : "bg-gray-100 text-gray-700"
                          }`}
                          data-testid={`status-filter-${status.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${isActive ? "bg-white/80" : color.bg}`} />
                            {status} ({count})
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      value={trackerSearch}
                      onChange={(e) => setTrackerSearch(e.target.value)}
                      placeholder={isInvestmentTeam ? "Search investments..." : "Search units..."}
                      className="h-10 pl-9 pr-20 text-sm rounded-xl bg-gray-100 border-0 placeholder:text-gray-400"
                      data-testid="input-tracker-search"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {trackerSearch && (
                        <button onClick={() => setTrackerSearch("")} className="p-1">
                          <X className="w-4 h-4 text-gray-400" />
                        </button>
                      )}
                      <div className="relative">
                        <button
                          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                            trackerStatusFilter
                              ? `${(isInvestmentTeam ? investmentStatusColors : lettingStatusColors)[trackerStatusFilter]?.bg || "bg-gray-400"} text-white`
                              : "bg-gray-200 text-gray-600"
                          }`}
                          data-testid="button-status-dropdown"
                        >
                          <ChevronDown className={`w-3 h-3 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} />
                          {trackerStatusFilter || "Status"}
                        </button>
                        {showStatusDropdown && (
                          <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
                            <button
                              onClick={() => { setTrackerStatusFilter(null); setShowStatusDropdown(false); }}
                              className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 ${!trackerStatusFilter ? "bg-gray-50 font-semibold" : "hover:bg-gray-50"}`}
                              data-testid="dropdown-status-all"
                            >
                              <span className="w-3 h-3 rounded-sm bg-gray-300" /> All
                            </button>
                            {Object.keys(trackerStatusCounts).map(status => {
                              const colors = isInvestmentTeam ? investmentStatusColors : lettingStatusColors;
                              const color = colors[status] || { bg: "bg-gray-400", text: "text-white", border: "border-gray-400" };
                              return (
                                <button
                                  key={status}
                                  onClick={() => { setTrackerStatusFilter(status); setShowStatusDropdown(false); }}
                                  className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 ${trackerStatusFilter === status ? "bg-gray-50 font-semibold" : "hover:bg-gray-50"}`}
                                  data-testid={`dropdown-status-${status.toLowerCase().replace(/\s+/g, "-")}`}
                                >
                                  <span className={`w-3 h-3 rounded-sm ${color.bg}`} /> {status} ({trackerStatusCounts[status]})
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4" onClick={() => showStatusDropdown && setShowStatusDropdown(false)}>
                  {(investmentLoading || lettingLoading) && (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-8 h-8 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
                    </div>
                  )}
                  {isInvestmentTeam && !investmentLoading && (
                    <div className="space-y-2">
                      {(filteredTrackerItems as typeof investmentItems)?.length === 0 ? (
                        <div className="text-center py-16 text-gray-400 text-[15px]">
                          {trackerStatusFilter || trackerSearch ? "No matching investments" : "No investments found"}
                        </div>
                      ) : (filteredTrackerItems as NonNullable<typeof investmentItems>).map(item => {
                        const statusColor = investmentStatusColors[item.status || ""] || { bg: "bg-gray-400", text: "text-white", border: "border-gray-400" };
                        return (
                          <button
                            key={item.id}
                            onClick={() => setSelectedDealId(item.id)}
                            className={`relative w-full p-4 pl-[18px] rounded-2xl active:bg-gray-50 text-left bg-white border border-gray-100 shadow-sm overflow-hidden`}
                            data-testid={`inv-card-${item.id}`}
                          >
                            <span className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${statusColor.bg}`} />
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="text-[16px] font-semibold text-gray-900 truncate flex-1 tracking-tight">{item.assetName}</div>
                              {item.status && (
                                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${statusColor.bg} ${statusColor.text}`}>
                                  {item.status}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[13px] text-gray-500 tabular-nums">
                              {item.guidePrice && <span className="font-semibold text-gray-800">£{item.guidePrice.toLocaleString()}</span>}
                              {item.niy && <span>{item.niy}% NIY</span>}
                              {item.tenure && <span>{item.tenure}</span>}
                              {item.boardType && <span className={item.boardType === "Sales" ? "text-blue-600" : "text-emerald-600"}>{item.boardType}</span>}
                            </div>
                            {item.client && <div className="text-[12px] text-gray-400 mt-1.5 truncate">{item.client}</div>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!isInvestmentTeam && !lettingLoading && (
                    <div className="space-y-2">
                      {(filteredTrackerItems as typeof lettingItems)?.length === 0 ? (
                        <div className="text-center py-16 text-gray-400 text-[15px]">
                          {trackerStatusFilter || trackerSearch ? "No matching units" : "No units found"}
                        </div>
                      ) : (filteredTrackerItems as NonNullable<typeof lettingItems>).map(item => {
                        const statusColor = lettingStatusColors[item.marketingStatus || ""] || { bg: "bg-gray-400", text: "text-white", border: "border-gray-400" };
                        return (
                          <button
                            key={item.id}
                            onClick={() => setSelectedUnitId(item.id)}
                            className={`relative w-full p-4 pl-[18px] rounded-2xl active:bg-gray-50 text-left bg-white border border-gray-100 shadow-sm overflow-hidden`}
                            data-testid={`let-card-${item.id}`}
                          >
                            <span className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${statusColor.bg}`} />
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="flex-1 min-w-0">
                                <div className="text-[16px] font-semibold text-gray-900 truncate tracking-tight">{item.unitName}</div>
                                {item.propertyName && (
                                  <div className="text-[12px] text-gray-400 truncate mt-0.5">{item.propertyName}</div>
                                )}
                              </div>
                              {item.marketingStatus && (
                                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${statusColor.bg} ${statusColor.text}`}>
                                  {item.marketingStatus}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[13px] text-gray-500 tabular-nums">
                              {item.sqft && <span>{item.sqft.toLocaleString()} sq ft</span>}
                              {item.askingRent && <span className="font-semibold text-gray-800">£{item.askingRent.toLocaleString()} pa</span>}
                              {item.floor && <span>{item.floor}</span>}
                              {item.useClass && <span className="text-blue-600">{item.useClass}</span>}
                            </div>
                            {(item.viewingsCount > 0 || item.condition) && (
                              <div className="flex items-center gap-3 text-[12px] text-gray-400 mt-1.5">
                                {item.viewingsCount > 0 && <span>{item.viewingsCount} viewing{item.viewingsCount > 1 ? "s" : ""}</span>}
                                {item.condition && <span>{item.condition}</span>}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                </div>
              </div>
            )}

            {moreSubTab === "news" && (
              <div className="flex-1 overflow-y-auto px-4">
                {newsLoading && (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-8 h-8 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
                  </div>
                )}
                {!newsLoading && (!newsArticles || newsArticles.length === 0) && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                      <Newspaper className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-[15px] text-gray-400">No news articles yet</p>
                  </div>
                )}
                {!newsLoading && newsArticles && newsArticles.length > 0 && (
                  <div className="space-y-3">
                    {newsArticles.map(article => (
                      <a
                        key={article.id}
                        href={article.url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
                        data-testid={`news-card-${article.id}`}
                      >
                        {article.imageUrl && (
                          <div className="aspect-[16/9] w-full overflow-hidden bg-gray-50">
                            <img src={article.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          </div>
                        )}
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {article.sourceName && <span className="text-[11px] font-medium text-gray-500">{article.sourceName}</span>}
                            {article.publishedAt && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-[11px] text-gray-400">
                                  {new Date(article.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                </span>
                              </>
                            )}
                            {article.category && (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">{article.category}</span>
                            )}
                          </div>
                          <div className="text-[16px] font-semibold text-gray-900 leading-snug mb-1.5 tracking-tight">{article.title}</div>
                          {(article.aiSummary || article.summary) && (
                            <div className="text-[13px] text-gray-500 leading-relaxed line-clamp-3">{article.aiSummary || article.summary}</div>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {moreSubTab === "docs" && (
              <MobileDocumentStudio />
            )}

            <div className="h-4" />
          </div>
        )}
      </PullToRefresh>

      {showMobileNewProperty && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowMobileNewProperty(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-white rounded-t-2xl w-full max-h-[85dvh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                <h2 className="text-[18px] font-bold">New Property Chat</h2>
              </div>
              <button onClick={() => setShowMobileNewProperty(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center" data-testid="button-close-new-property">
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>
            <div className="px-5 py-3 shrink-0">
              <p className="text-[13px] text-gray-500 mb-3">Create an AI conversation linked to a property or deal.</p>
              <div className="flex gap-2 mb-3">
                <button
                  className={`flex-1 py-2 text-[13px] font-semibold rounded-lg transition-all ${mobileNewPropLinkType === "property" ? "bg-black text-white" : "bg-gray-100 text-gray-600"}`}
                  onClick={() => { setMobileNewPropLinkType("property"); setMobileNewPropSelectedId(""); }}
                  data-testid="button-mobile-link-property"
                >
                  <Building2 className="w-3.5 h-3.5 inline mr-1.5" /> Property
                </button>
                <button
                  className={`flex-1 py-2 text-[13px] font-semibold rounded-lg transition-all ${mobileNewPropLinkType === "deal" ? "bg-black text-white" : "bg-gray-100 text-gray-600"}`}
                  onClick={() => { setMobileNewPropLinkType("deal"); setMobileNewPropSelectedId(""); }}
                  data-testid="button-mobile-link-deal"
                >
                  <Handshake className="w-3.5 h-3.5 inline mr-1.5" /> Deal / WIP
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder={`Search ${mobileNewPropLinkType === "property" ? "properties" : "deals"}...`}
                  value={mobileNewPropSearch}
                  onChange={e => setMobileNewPropSearch(e.target.value)}
                  className="h-10 pl-9 text-sm rounded-xl bg-gray-100 border-0"
                  data-testid="input-mobile-search-link-entity"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-3 min-h-0" style={{ maxHeight: "40dvh" }}>
              {(() => {
                const isLoading = mobileNewPropLinkType === "property" ? crmPropsLoading : crmDealsLoading;
                if (isLoading) return (
                  <div className="space-y-2 py-3">
                    {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}
                  </div>
                );
                const items = mobileNewPropLinkType === "property" ? crmProperties : crmDeals;
                const filtered = mobileNewPropSearch
                  ? items.filter((i: any) => i.name?.toLowerCase().includes(mobileNewPropSearch.toLowerCase()))
                  : items;
                return filtered.length === 0 ? (
                  <p className="text-center text-[13px] text-gray-400 py-8">No {mobileNewPropLinkType === "property" ? "properties" : "deals"} found</p>
                ) : (
                  <div className="space-y-1">
                    {filtered.slice(0, 50).map((item: any) => (
                      <button
                        key={item.id}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-[14px] transition-colors ${
                          mobileNewPropSelectedId === item.id ? "bg-black text-white font-medium" : "active:bg-gray-50"
                        }`}
                        onClick={() => setMobileNewPropSelectedId(item.id)}
                        data-testid={`mobile-link-item-${item.id}`}
                      >
                        <p className="truncate">{item.name || "Untitled"}</p>
                        {item.status && <p className={`text-[12px] mt-0.5 ${mobileNewPropSelectedId === item.id ? "text-white/70" : "text-gray-400"}`}>{item.status}</p>}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 shrink-0">
              <Button
                className="w-full h-12 text-[15px] font-semibold rounded-xl bg-black text-white"
                disabled={!mobileNewPropSelectedId}
                onClick={() => {
                  const items = mobileNewPropLinkType === "property" ? crmProperties : crmDeals;
                  const selectedItem = items.find((i: any) => i.id === mobileNewPropSelectedId);
                  if (selectedItem) {
                    handleCreateMobilePropertyChat({
                      linkedType: mobileNewPropLinkType,
                      linkedId: selectedItem.id,
                      linkedName: selectedItem.name || "Untitled",
                    });
                  }
                }}
                data-testid="button-mobile-create-property-chat"
              >
                Create Chat
              </Button>
            </div>
          </div>
        </div>
      )}

      {selectedDeal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setSelectedDealId(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-white rounded-t-2xl w-full max-h-[85dvh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
              <div className="flex-1 min-w-0 pr-3">
                <h2 className="text-[18px] font-bold text-gray-900 truncate">{selectedDeal.assetName}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  {selectedDeal.status && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${(investmentStatusColors[selectedDeal.status] || { bg: "bg-gray-400", text: "text-white" }).bg} ${(investmentStatusColors[selectedDeal.status] || { bg: "bg-gray-400", text: "text-white" }).text}`}>
                      {selectedDeal.status}
                    </span>
                  )}
                  {selectedDeal.boardType && (
                    <span className="text-[12px] text-gray-500">{selectedDeal.boardType}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedDealId(null)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0"
                data-testid="button-close-deal-popup"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {selectedDeal.guidePrice && (
                <div className="bg-gray-50 rounded-xl p-4 mb-3">
                  <div className="text-[24px] font-bold text-gray-900">£{selectedDeal.guidePrice.toLocaleString()}</div>
                  <div className="text-[12px] text-gray-500 uppercase tracking-wide font-medium">Guide Price</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mb-4">
                {selectedDeal.niy != null && (
                  <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                    <div className="text-[16px] font-bold text-blue-700">{selectedDeal.niy}%</div>
                    <div className="text-[11px] text-blue-500 font-medium">NIY</div>
                  </div>
                )}
                {selectedDeal.eqy != null && (
                  <div className="bg-indigo-50 rounded-xl p-3 border border-indigo-100">
                    <div className="text-[16px] font-bold text-indigo-700">{selectedDeal.eqy}%</div>
                    <div className="text-[11px] text-indigo-500 font-medium">EQY</div>
                  </div>
                )}
                {selectedDeal.sqft != null && (
                  <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                    <div className="text-[16px] font-bold text-gray-800">{selectedDeal.sqft.toLocaleString()}</div>
                    <div className="text-[11px] text-gray-500 font-medium">Sq Ft</div>
                  </div>
                )}
                {selectedDeal.currentRent != null && (
                  <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                    <div className="text-[16px] font-bold text-emerald-700">£{selectedDeal.currentRent.toLocaleString()}</div>
                    <div className="text-[11px] text-emerald-500 font-medium">Current Rent</div>
                  </div>
                )}
                {selectedDeal.ervPa != null && (
                  <div className="bg-teal-50 rounded-xl p-3 border border-teal-100">
                    <div className="text-[16px] font-bold text-teal-700">£{selectedDeal.ervPa.toLocaleString()}</div>
                    <div className="text-[11px] text-teal-500 font-medium">ERV pa</div>
                  </div>
                )}
                {selectedDeal.fee != null && (
                  <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
                    <div className="text-[16px] font-bold text-purple-700">£{selectedDeal.fee.toLocaleString()}</div>
                    <div className="text-[11px] text-purple-500 font-medium">Fee{selectedDeal.feeType ? ` (${selectedDeal.feeType})` : ""}</div>
                  </div>
                )}
              </div>

              <div className="space-y-0 mb-4">
                {[
                  { label: "Tenure", value: selectedDeal.tenure },
                  { label: "Asset Type", value: selectedDeal.assetType },
                  { label: "Address", value: selectedDeal.address },
                  { label: "Occupancy", value: selectedDeal.occupancy },
                  { label: "Capex Required", value: selectedDeal.capexRequired },
                  { label: "WAULT (Break)", value: selectedDeal.waultBreak },
                  { label: "WAULT (Expiry)", value: selectedDeal.waultExpiry },
                  { label: "Marketing Date", value: selectedDeal.marketingDate ? new Date(selectedDeal.marketingDate).toLocaleDateString("en-GB") : null },
                  { label: "Bid Deadline", value: selectedDeal.bidDeadline ? new Date(selectedDeal.bidDeadline).toLocaleDateString("en-GB") : null },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} className="flex justify-between items-center py-2.5 border-b border-gray-100 last:border-0">
                    <span className="text-[13px] text-gray-500">{r.label}</span>
                    <span className="text-[14px] font-medium text-gray-900 text-right max-w-[60%] truncate">{r.value}</span>
                  </div>
                ))}
              </div>

              {(selectedDeal.client || selectedDeal.clientContact || selectedDeal.vendor || selectedDeal.vendorAgent || selectedDeal.buyer || (selectedDeal.agentUserIds && selectedDeal.agentUserIds.length > 0)) && (
                <div className="mb-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">People & Companies</div>
                  <div className="space-y-2">
                    {selectedDeal.agentUserIds && selectedDeal.agentUserIds.length > 0 && (() => {
                      const agents = selectedDeal.agentUserIds!.map(uid => allUsers?.find(u => u.id === uid)).filter(Boolean);
                      if (agents.length === 0) return null;
                      return (
                        <div className="bg-gray-50 rounded-xl p-3">
                          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">BGP Agents</div>
                          <div className="space-y-2">
                            {agents.map(agent => (
                              <div key={agent!.id} className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0">
                                  <span className="text-[11px] font-bold">{agent!.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[14px] font-medium text-gray-900 truncate">{agent!.name}</div>
                                  <div className="text-[12px] text-gray-400">{(agent as any)?.team || "BGP"}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {[
                      { label: "Client", name: selectedDeal.client, icon: "client" },
                      { label: "Client Contact", name: selectedDeal.clientContact, icon: "contact" },
                      { label: "Vendor", name: selectedDeal.vendor, icon: "vendor" },
                      { label: "Vendor Agent", name: selectedDeal.vendorAgent, icon: "agent" },
                      { label: "Buyer", name: selectedDeal.buyer, icon: "buyer" },
                    ].filter(r => r.name).map(r => {
                      const companyMatch = companies?.find(c => c.name.toLowerCase() === r.name!.toLowerCase());
                      const contactMatch = !companyMatch ? contacts?.find(c => c.name.toLowerCase() === r.name!.toLowerCase()) : null;
                      const hasLink = companyMatch || contactMatch;
                      const linkPath = companyMatch ? `/companies/${companyMatch.id}` : contactMatch ? `/contacts/${contactMatch.id}` : null;
                      const matchType = companyMatch ? "company" : contactMatch ? "contact" : null;
                      const bgColor = r.icon === "client" ? "bg-blue-100 text-blue-600" :
                                      r.icon === "vendor" ? "bg-orange-100 text-orange-600" :
                                      r.icon === "buyer" ? "bg-emerald-100 text-emerald-600" :
                                      "bg-gray-100 text-gray-600";
                      return (
                        <button
                          key={r.label}
                          onClick={() => { if (linkPath) { setSelectedDealId(null); navigate(linkPath); } }}
                          className={`w-full flex items-center gap-3 p-3 bg-gray-50 rounded-xl text-left ${hasLink ? "active:bg-gray-100" : "cursor-default"}`}
                          data-testid={`deal-link-${r.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${bgColor}`}>
                            {matchType === "company" ? <Building2 className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{r.label}</div>
                            <div className={`text-[14px] font-medium truncate ${hasLink ? "text-blue-600" : "text-gray-900"}`}>{r.name}</div>
                            {matchType && (
                              <div className="text-[11px] text-gray-400">{matchType === "company" ? "View company" : "View contact"} →</div>
                            )}
                          </div>
                          {hasLink && <ChevronDown className="w-4 h-4 text-gray-300 -rotate-90 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedDeal.notes && (
                <div className="bg-yellow-50 rounded-xl p-3.5 mb-4 border border-yellow-100">
                  <div className="text-[11px] font-semibold text-yellow-600 uppercase tracking-wide mb-1">Notes</div>
                  <div className="text-[14px] text-gray-800 leading-relaxed whitespace-pre-wrap">{selectedDeal.notes}</div>
                </div>
              )}

              <div className="mb-4">
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Marketing Files</div>
                {(!dealMarketingFiles || dealMarketingFiles.length === 0) ? (
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <FileText className="w-6 h-6 text-gray-300 mx-auto mb-1" />
                    <div className="text-[13px] text-gray-400">No marketing files uploaded</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dealMarketingFiles.map(file => (
                      <a
                        key={file.id}
                        href={file.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl active:bg-gray-100"
                        data-testid={`marketing-file-${file.id}`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-medium text-gray-900 truncate">{file.fileName}</div>
                          <div className="text-[12px] text-gray-400">
                            {file.fileSize ? formatFileSize(file.fileSize) : ""} · {new Date(file.uploadedAt).toLocaleDateString("en-GB")}
                          </div>
                        </div>
                        <Download className="w-5 h-5 text-gray-400 shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <button
                onClick={() => { setSelectedDealId(null); navigate("/investment-tracker"); }}
                className="w-full py-3 bg-black text-white text-[15px] font-semibold rounded-xl active:bg-gray-800"
                data-testid="button-open-full-tracker"
              >
                Open in Full Tracker
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedUnit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setSelectedUnitId(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-white rounded-t-2xl w-full max-h-[85dvh] flex flex-col animate-in slide-in-from-bottom duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <div className="flex-1 min-w-0">
                <h3 className="text-[20px] font-bold text-gray-900 truncate">{selectedUnit.unitName}</h3>
                {selectedUnit.propertyName && (
                  <button
                    onClick={() => { if (selectedUnit.propertyId) { setSelectedUnitId(null); navigate(`/properties/${selectedUnit.propertyId}`); } }}
                    className="text-[14px] text-blue-600 truncate block"
                    data-testid="unit-property-link"
                  >
                    {selectedUnit.propertyName} →
                  </button>
                )}
              </div>
              <button
                onClick={() => setSelectedUnitId(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 ml-3 shrink-0"
                data-testid="button-close-unit-popup"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5">
              {selectedUnit.marketingStatus && (() => {
                const sc = lettingStatusColors[selectedUnit.marketingStatus || ""] || { bg: "bg-gray-400", text: "text-white" };
                return (
                  <div className="mb-4">
                    <span className={`text-[13px] font-semibold px-3 py-1 rounded-full ${sc.bg} ${sc.text}`}>
                      {selectedUnit.marketingStatus}
                    </span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3 mb-4">
                {selectedUnit.askingRent && (
                  <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                    <div className="text-[16px] font-bold text-emerald-700">£{selectedUnit.askingRent.toLocaleString()}</div>
                    <div className="text-[11px] text-emerald-500 font-medium">Asking Rent pa</div>
                  </div>
                )}
                {selectedUnit.sqft && (
                  <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                    <div className="text-[16px] font-bold text-blue-700">{selectedUnit.sqft.toLocaleString()}</div>
                    <div className="text-[11px] text-blue-500 font-medium">Sq Ft</div>
                  </div>
                )}
                {selectedUnit.ratesPa && (
                  <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                    <div className="text-[16px] font-bold text-gray-700">£{selectedUnit.ratesPa.toLocaleString()}</div>
                    <div className="text-[11px] text-gray-500 font-medium">Rates pa</div>
                  </div>
                )}
                {selectedUnit.serviceChargePa && (
                  <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                    <div className="text-[16px] font-bold text-gray-700">£{selectedUnit.serviceChargePa.toLocaleString()}</div>
                    <div className="text-[11px] text-gray-500 font-medium">Service Charge pa</div>
                  </div>
                )}
                {selectedUnit.fee && (
                  <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
                    <div className="text-[16px] font-bold text-purple-700">£{selectedUnit.fee.toLocaleString()}</div>
                    <div className="text-[11px] text-purple-500 font-medium">Fee</div>
                  </div>
                )}
              </div>

              <div className="space-y-0 mb-4">
                {[
                  { label: "Floor", value: selectedUnit.floor },
                  { label: "Use Class", value: selectedUnit.useClass },
                  { label: "Condition", value: selectedUnit.condition },
                  { label: "EPC Rating", value: selectedUnit.epcRating },
                  { label: "Available Date", value: selectedUnit.availableDate ? new Date(selectedUnit.availableDate).toLocaleDateString("en-GB") : null },
                  { label: "Marketing Start", value: selectedUnit.marketingStartDate ? new Date(selectedUnit.marketingStartDate).toLocaleDateString("en-GB") : null },
                  { label: "Restrictions", value: selectedUnit.restrictions },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} className="flex justify-between items-center py-2.5 border-b border-gray-100 last:border-0">
                    <span className="text-[13px] text-gray-500">{r.label}</span>
                    <span className="text-[14px] font-medium text-gray-900 text-right max-w-[60%] truncate">{r.value}</span>
                  </div>
                ))}
              </div>

              {selectedUnit.agentUserIds && selectedUnit.agentUserIds.length > 0 && (() => {
                const agents = selectedUnit.agentUserIds!.map(uid => allUsers?.find(u => u.id === uid)).filter(Boolean);
                if (agents.length === 0) return null;
                return (
                  <div className="mb-4">
                    <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">BGP Agents</div>
                    <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                      {agents.map(agent => (
                        <div key={agent!.id} className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0">
                            <span className="text-[11px] font-bold">{agent!.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-medium text-gray-900 truncate">{agent!.name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {unitViewings && unitViewings.length > 0 && (
                <div className="mb-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Viewings ({unitViewings.length})
                  </div>
                  <div className="space-y-2">
                    {unitViewings.map(v => (
                      <div key={v.id} className="bg-gray-50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[14px] font-medium text-gray-900">{v.companyName || "Unknown"}</div>
                          {v.viewingDate && (
                            <div className="text-[12px] text-gray-400">{new Date(v.viewingDate).toLocaleDateString("en-GB")}</div>
                          )}
                        </div>
                        {v.outcome && <div className="text-[12px] text-blue-600 font-medium">{v.outcome}</div>}
                        {v.notes && <div className="text-[12px] text-gray-500 mt-1">{v.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {unitOffers && unitOffers.length > 0 && (
                <div className="mb-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Offers ({unitOffers.length})
                  </div>
                  <div className="space-y-2">
                    {unitOffers.map(o => (
                      <div key={o.id} className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[14px] font-medium text-gray-900">{o.companyName || "Unknown"}</div>
                          {o.status && (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${o.status === "Accepted" ? "bg-emerald-100 text-emerald-700" : o.status === "Rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                              {o.status}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[13px] text-gray-600">
                          {o.rentPa && <span>£{o.rentPa.toLocaleString()} pa</span>}
                          {o.termYears && <span>{o.termYears} yrs</span>}
                          {o.rentFreeMonths && <span>{o.rentFreeMonths}m rent free</span>}
                        </div>
                        {o.incentives && <div className="text-[12px] text-gray-500 mt-1">{o.incentives}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedUnit.notes && (
                <div className="mb-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Notes</div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="text-[14px] text-gray-700 whitespace-pre-wrap">{selectedUnit.notes}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <button
                onClick={() => { setSelectedUnitId(null); navigate("/available"); }}
                className="w-full py-3 bg-black text-white text-[15px] font-semibold rounded-xl active:bg-gray-800"
                data-testid="button-open-full-leasing"
              >
                Open in Full Tracker
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 bg-white/95 backdrop-blur-lg pb-[env(safe-area-inset-bottom)] shrink-0">
        <div className="flex items-center justify-around h-14">
          <button onClick={() => { setTab("chats"); setChatSearch(""); }} className={`flex flex-col items-center gap-0.5 px-6 py-1.5 rounded-xl transition-colors ${tab === "chats" ? "text-black" : "text-gray-400"}`} data-testid="tab-mobile-chats">
            <div className="relative">
              <MessageSquare className="w-[22px] h-[22px]" />
              {unseenCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center" style={{ backgroundColor: "hsl(var(--primary))" }}>
                  {unseenCount > 99 ? "99+" : unseenCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-semibold mt-0.5">Chats</span>
          </button>
          <button onClick={() => { setTab("ai"); setChatSearch(""); }} className={`flex flex-col items-center gap-0.5 px-6 py-1.5 rounded-xl transition-colors ${tab === "ai" ? "text-black" : "text-gray-400"}`} data-testid="tab-mobile-ai">
            <Sparkles className="w-[22px] h-[22px]" />
            <span className="text-[10px] font-semibold mt-0.5">ChatBGP</span>
          </button>
          <button onClick={() => { setTab("menu"); setChatSearch(""); }} className={`flex flex-col items-center gap-0.5 px-6 py-1.5 rounded-xl transition-colors ${tab === "menu" ? "text-black" : "text-gray-400"}`} data-testid="tab-mobile-menu">
            <Menu className="w-[22px] h-[22px]" />
            <span className="text-[10px] font-semibold mt-0.5">More</span>
          </button>
        </div>
      </div>
    </div>
  );
}
