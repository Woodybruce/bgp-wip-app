import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, getQueryFn, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Mail as MailIcon,
  Paperclip,
  Cloud,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Inbox,
  Archive,
  Reply,
  ReplyAll,
  Forward,
  Send,
  FileText,
  Trash2,
  AlertCircle,
  FolderOpen,
  Users,
  Bot,
  Plus,
  X,
  MailOpen,
  Eye,
  EyeOff,
  RefreshCw,
  Download,
  FileIcon,
  Loader2,
  CalendarCheck,
  CalendarX,
  CalendarClock,
  Calendar,
  Check,
} from "lucide-react";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";

interface EmailAddress {
  emailAddress: { name: string; address: string };
}

interface MailMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body?: { content: string; contentType: string };
  from?: EmailAddress;
  toRecipients?: EmailAddress[];
  ccRecipients?: EmailAddress[];
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance?: string;
  meetingMessageType?: "meetingRequest" | "meetingCancelled" | "meetingAccepted" | "meetingTenativelyAccepted" | "meetingDeclined" | null;
}

interface MailFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
  parentFolderId?: string;
  childFolderCount?: number;
}

interface ComposeData {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  originalBody?: string;
}

function formatMailDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) return `${Math.round(diffMs / 60000)}m ago`;
  if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
  if (diffHours < 48) return "Yesterday";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatFullDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-orange-500",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getFolderIcon(name: string) {
  switch (name) {
    case "Inbox": return Inbox;
    case "Sent Items": return Send;
    case "Drafts": return FileText;
    case "Archive": return Archive;
    case "Deleted Items": return Trash2;
    case "Junk Email": return AlertCircle;
    default: return FolderOpen;
  }
}

const FOLDER_ORDER = ["Inbox", "Sent Items", "Drafts", "Archive", "Junk Email", "Deleted Items"];

function sortFolders(folders: MailFolder[]): MailFolder[] {
  return [...folders].sort((a, b) => {
    const ai = FOLDER_ORDER.indexOf(a.displayName);
    const bi = FOLDER_ORDER.indexOf(b.displayName);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

function FolderItem({
  folder,
  selectedFolderId,
  onSelect,
  depth = 0,
  apiBase = "/api/user-mail/folders",
}: {
  folder: MailFolder;
  selectedFolderId: string | null;
  onSelect: (id: string | null, name?: string) => void;
  depth?: number;
  apiBase?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedFolderId === folder.id;
  const Icon = getFolderIcon(folder.displayName);

  const { data: children, isLoading: childrenLoading } = useQuery<MailFolder[]>({
    queryKey: [apiBase, folder.id, "children"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/${folder.id}/children`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: expanded,
  });

  const hasChildren = children && children.length > 0;

  return (
    <div>
      <button
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left text-[12px] transition-colors group ${
          isSelected
            ? "bg-primary/10 text-primary font-semibold"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(folder.id, folder.displayName)}
        data-testid={`folder-${folder.displayName.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span
          role="button"
          className="w-4 h-4 flex items-center justify-center shrink-0 rounded hover:bg-muted cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          data-testid={`folder-expand-${folder.id}`}
        >
          {(expanded || !children) ? (
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
          ) : hasChildren ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <span className="w-3 h-3" />
          )}
        </span>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate flex-1">{folder.displayName}</span>
        {folder.unreadItemCount > 0 && (
          <span className="text-[10px] font-bold text-blue-500 shrink-0">{folder.unreadItemCount}</span>
        )}
      </button>

      {expanded && (
        <div>
          {childrenLoading ? (
            <div style={{ paddingLeft: `${24 + depth * 16}px` }} className="py-1">
              <Skeleton className="h-4 w-24" />
            </div>
          ) : children && children.length > 0 ? (
            sortFolders(children).map((child) => (
              <FolderItem
                key={child.id}
                folder={child}
                selectedFolderId={selectedFolderId}
                onSelect={onSelect}
                depth={depth + 1}
                apiBase={apiBase}
              />
            ))
          ) : null}
        </div>
      )}
    </div>
  );
}

function ConnectPrompt() {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    const authWindow = window.open("about:blank", "_blank");
    try {
      const res = await apiRequest("GET", "/api/microsoft/auth");
      const data = await res.json();
      if (authWindow) { authWindow.location.href = data.authUrl; } else { window.location.href = data.authUrl; }
    } catch {
      if (authWindow) authWindow.close();
      setConnecting(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center" data-testid="mail-connect-prompt">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="w-20 h-20 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto">
          <MailIcon className="w-10 h-10 text-blue-500" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Outlook Mail</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Connect your Microsoft 365 account to view and manage your email inbox.
          </p>
        </div>
        <Button
          size="lg"
          onClick={handleConnect}
          disabled={connecting}
          className="w-full"
          data-testid="button-connect-mail"
        >
          {connecting ? "Sign-in tab opened..." : "Connect Microsoft 365"}
        </Button>
        {connecting && (
          <p className="text-xs text-muted-foreground">
            Complete sign-in in the new tab, then refresh this page.
          </p>
        )}
      </div>
    </div>
  );
}

function ComposeModal({
  open,
  onClose,
  initialData,
  sendEndpoint,
  senderLabel,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: Partial<ComposeData>;
  sendEndpoint: string;
  senderLabel?: string;
}) {
  const [to, setTo] = useState(initialData?.to || "");
  const [cc, setCc] = useState(initialData?.cc || "");
  const [bcc, setBcc] = useState(initialData?.bcc || "");
  const [subject, setSubject] = useState(initialData?.subject || "");
  const [body, setBody] = useState(initialData?.body || "");
  const [originalBody, setOriginalBody] = useState(initialData?.originalBody || "");
  const [showCcBcc, setShowCcBcc] = useState(!!(initialData?.cc || initialData?.bcc));
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setTo(initialData?.to || "");
      setCc(initialData?.cc || "");
      setBcc(initialData?.bcc || "");
      setSubject(initialData?.subject || "");
      setBody(initialData?.body || "");
      setOriginalBody(initialData?.originalBody || "");
      setShowCcBcc(!!(initialData?.cc || initialData?.bcc));
    }
  }, [open, initialData]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const recipients = to.split(/[,;]/).map(e => e.trim()).filter(Boolean);
      const ccRecipients = cc ? cc.split(/[,;]/).map(e => e.trim()).filter(Boolean) : [];
      const bccRecipients = bcc ? bcc.split(/[,;]/).map(e => e.trim()).filter(Boolean) : [];
      if (recipients.length === 0) throw new Error("At least one recipient is required");
      if (!subject.trim()) throw new Error("Subject is required");

      const fullBody = originalBody
        ? `${body}\n\n${originalBody}`.replace(/\n/g, "<br/>")
        : body.replace(/\n/g, "<br/>");
      await apiRequest("POST", sendEndpoint, {
        recipients,
        subject: subject.trim(),
        body: fullBody,
        ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
        bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Email sent", description: "Your message was sent successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/user-mail/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shared-mailbox/messages"] });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-4 h-4" />
            New Message
            {senderLabel && (
              <span className="text-xs font-normal text-muted-foreground ml-2">
                from {senderLabel}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-y-auto">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground w-8 shrink-0">To</label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
                className="h-8 text-sm"
                data-testid="input-compose-to"
              />
              {!showCcBcc && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs shrink-0"
                  onClick={() => setShowCcBcc(true)}
                  data-testid="button-show-cc-bcc"
                >
                  Cc/Bcc
                </Button>
              )}
            </div>

            {showCcBcc && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground w-8 shrink-0">Cc</label>
                  <Input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="cc@example.com"
                    className="h-8 text-sm"
                    data-testid="input-compose-cc"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground w-8 shrink-0">Bcc</label>
                  <Input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="bcc@example.com"
                    className="h-8 text-sm"
                    data-testid="input-compose-bcc"
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground w-8 shrink-0">Subj</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="h-8 text-sm"
                data-testid="input-compose-subject"
              />
            </div>
          </div>

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            className="min-h-[250px] text-sm resize-none"
            data-testid="input-compose-body"
          />

          {originalBody && (
            <details className="mt-2 text-xs text-muted-foreground border-l-2 border-muted pl-3" data-testid="original-message-details">
              <summary className="cursor-pointer hover:text-foreground">Show original message</summary>
              <div className="mt-1 whitespace-pre-wrap">{originalBody}</div>
            </details>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-compose-discard"
          >
            Discard
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending || !to.trim()}
            className="gap-2"
            data-testid="button-compose-send"
          >
            <Send className="w-4 h-4" />
            {sendMutation.isPending ? "Sending..." : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageRow({
  message,
  selected,
  onClick,
}: {
  message: MailMessage;
  selected: boolean;
  onClick: () => void;
}) {
  const senderName = message.from?.emailAddress?.name || message.from?.emailAddress?.address || "Unknown";
  const initials = getInitials(senderName);
  const color = getAvatarColor(senderName);

  return (
    <button
      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors border-b border-border/50 ${
        selected
          ? "bg-primary/10 dark:bg-primary/20"
          : "hover:bg-muted/50"
      }`}
      onClick={onClick}
      data-testid={`mail-row-${message.id}`}
    >
      <div className={`w-9 h-9 rounded-full ${color} flex items-center justify-center shrink-0 mt-0.5`}>
        <span className="text-white text-xs font-semibold">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm truncate ${!message.isRead ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>
            {senderName}
          </p>
          <span className="text-[11px] text-gray-500 shrink-0">
            {formatMailDate(message.receivedDateTime)}
          </span>
        </div>
        <p className={`text-[13px] truncate mt-0.5 ${!message.isRead ? "font-medium text-gray-900" : "text-gray-700"}`}>
          {message.subject || "(No subject)"}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-xs text-gray-500 truncate flex-1">
            {message.bodyPreview}
          </p>
          {message.meetingMessageType && (
            <Calendar className="w-3 h-3 text-blue-500 shrink-0" />
          )}
          {message.hasAttachments && (
            <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
        </div>
      </div>
      {!message.isRead && (
        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0 mt-1.5" />
      )}
    </button>
  );
}

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentsList({ messageId, mailType }: { messageId: string; mailType: "personal" | "shared" }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const baseUrl = mailType === "personal" ? "/api/user-mail" : "/api/shared-mailbox";

  const { data: attachments, isLoading } = useQuery<Attachment[]>({
    queryKey: [baseUrl, "attachments", messageId],
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/messages/${messageId}/attachments`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch attachments");
      return res.json();
    },
    enabled: !!messageId,
  });

  const handleDownload = async (att: Attachment) => {
    setDownloading(att.id);
    try {
      const res = await fetch(`${baseUrl}/messages/${messageId}/attachments/${att.id}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("[Mail] Download failed:", err.message);
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-muted/50">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading attachments...</span>
      </div>
    );
  }

  if (!attachments || attachments.length === 0) {
    return (
      <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-muted/50">
        <Paperclip className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Attachments (inline only)</span>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-1.5" data-testid="attachments-list">
      <div className="flex items-center gap-1.5 mb-2">
        <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{attachments.length} attachment{attachments.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((att) => (
          <button
            key={att.id}
            onClick={() => handleDownload(att)}
            disabled={downloading === att.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-background hover:bg-muted/50 transition-colors text-left max-w-[250px]"
            data-testid={`attachment-${att.id}`}
          >
            {downloading === att.id ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
            ) : (
              <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{att.name}</p>
              <p className="text-[10px] text-muted-foreground">{formatFileSize(att.size)}</p>
            </div>
            <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageDetail({
  message,
  onReply,
  onReplyAll,
  onForward,
  onDelete,
  onToggleRead,
  mailType,
}: {
  message: MailMessage | null;
  onReply: (msg: MailMessage) => void;
  onReplyAll: (msg: MailMessage) => void;
  onForward: (msg: MailMessage) => void;
  onDelete: (msg: MailMessage) => void;
  onToggleRead: (msg: MailMessage) => void;
  mailType: "personal" | "shared";
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [calendarResponding, setCalendarResponding] = useState<string | null>(null);
  const [calendarResponded, setCalendarResponded] = useState<string | null>(null);

  const { data: fullMessage } = useQuery<MailMessage>({
    queryKey: mailType === "personal"
      ? ["/api/user-mail/messages", message?.id]
      : ["/api/shared-mailbox/messages", message?.id],
    queryFn: async () => {
      const url = mailType === "personal"
        ? `/api/user-mail/messages/${message!.id}`
        : `/api/shared-mailbox/messages/${message!.id}`;
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch message");
      return res.json();
    },
    enabled: !!message?.id,
  });

  useEffect(() => {
    if (message && !message.isRead) {
      const endpoint = mailType === "personal"
        ? `/api/user-mail/messages/${message.id}/read`
        : `/api/shared-mailbox/messages/${message.id}/read`;
      fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ isRead: true }),
      }).then(() => {
        queryClient.invalidateQueries({
          queryKey: mailType === "personal" ? ["/api/user-mail/messages"] : ["/api/shared-mailbox/messages"],
        });
        queryClient.invalidateQueries({
          queryKey: mailType === "personal" ? ["/api/user-mail/folders"] : ["/api/shared-mailbox/folders"],
        });
      }).catch(() => {});
    }
  }, [message?.id, mailType]);

  const iframeSrcDoc = useMemo(() => {
    if (!fullMessage?.body?.content) return "";
    const isHtml = fullMessage.body.contentType === "html" || fullMessage.body.contentType === "HTML";
    const htmlContent = isHtml
      ? fullMessage.body.content
      : `<pre style="font-family: -apple-system, sans-serif; white-space: pre-wrap; word-break: break-word;">${fullMessage.body.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;

    return `<!DOCTYPE html><html><head><style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a; padding: 0; margin: 0; word-break: break-word; }
      img { max-width: 100%; height: auto; }
      a { color: #0066cc; text-decoration: none; }
      a:hover { text-decoration: underline; }
      table { max-width: 100%; border-collapse: collapse; }
      blockquote { border-left: 3px solid #e0e0e0; margin: 8px 0; padding-left: 12px; color: #555; }
      pre { white-space: pre-wrap; word-break: break-word; }
    </style></head><body>${htmlContent}</body></html>`;
  }, [fullMessage?.body]);


  if (!message) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-3">
          <Inbox className="w-12 h-12 mx-auto opacity-30" />
          <p className="text-sm">Select a message to read</p>
        </div>
      </div>
    );
  }

  const senderName = message.from?.emailAddress?.name || "Unknown";
  const senderEmail = message.from?.emailAddress?.address || "";
  const initials = getInitials(senderName);
  const color = getAvatarColor(senderName);
  const toList = fullMessage?.toRecipients || message.toRecipients || [];
  const ccList = fullMessage?.ccRecipients || message.ccRecipients || [];

  return (
    <div className="h-full flex flex-col" data-testid={`mail-detail-${message.id}`}>
      <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onReply(message)}
          title="Reply"
          data-testid="button-reply"
        >
          <Reply className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onReplyAll(message)}
          title="Reply All"
          data-testid="button-reply-all"
        >
          <ReplyAll className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onForward(message)}
          title="Forward"
          data-testid="button-forward"
        >
          <Forward className="w-4 h-4" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onToggleRead(message)}
          title={message.isRead ? "Mark as unread" : "Mark as read"}
          data-testid="button-toggle-read"
        >
          {message.isRead ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={() => onDelete(message)}
          title="Delete"
          data-testid="button-delete"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="text-xs gap-1.5 shrink-0"
          onClick={() => window.open(`https://outlook.office365.com/mail/inbox`, "_blank")}
          data-testid="button-open-outlook"
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">Open in Outlook</span>
          <span className="sm:hidden">Outlook</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
        <div className="px-6 py-5">
          <h2 className="text-lg font-semibold leading-snug" data-testid="text-mail-subject">
            {message.subject || "(No subject)"}
          </h2>

          <div className="flex items-start gap-3 mt-4">
            <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center shrink-0`}>
              <span className="text-white text-sm font-semibold">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{senderName}</p>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatFullDate(message.receivedDateTime)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{senderEmail}</p>

              {toList.length > 0 && (
                <div className="flex items-start gap-1 mt-1">
                  <span className="text-[11px] text-muted-foreground shrink-0">To:</span>
                  <span className="text-[11px] text-muted-foreground">
                    {toList.map(r => r.emailAddress?.name || r.emailAddress?.address).join(", ")}
                  </span>
                </div>
              )}
              {ccList.length > 0 && (
                <div className="flex items-start gap-1">
                  <span className="text-[11px] text-muted-foreground shrink-0">Cc:</span>
                  <span className="text-[11px] text-muted-foreground">
                    {ccList.map(r => r.emailAddress?.name || r.emailAddress?.address).join(", ")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {message.hasAttachments && (
            <AttachmentsList messageId={message.id} mailType={mailType} />
          )}

          {(fullMessage?.meetingMessageType || message.meetingMessageType) && (() => {
            const meetingType = fullMessage?.meetingMessageType || message.meetingMessageType;
            const isMeetingRequest = meetingType === "meetingRequest";
            const isCancelled = meetingType === "meetingCancelled";
            const isAccepted = meetingType === "meetingAccepted";
            const isDeclined = meetingType === "meetingDeclined";
            const isTentative = meetingType === "meetingTenativelyAccepted";

            const handleCalendarResponse = async (response: "accept" | "decline" | "tentativelyAccept") => {
              setCalendarResponding(response);
              try {
                const endpoint = mailType === "personal"
                  ? `/api/user-mail/messages/${message.id}/calendar-respond`
                  : `/api/shared-mailbox/messages/${message.id}/calendar-respond`;
                const res = await fetch(endpoint, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                  credentials: "include",
                  body: JSON.stringify({ response }),
                });
                if (!res.ok) throw new Error("Failed to respond");
                setCalendarResponded(response);
                toast({
                  title: response === "accept" ? "Accepted" : response === "decline" ? "Declined" : "Tentatively Accepted",
                  description: "Your response has been sent to the organiser.",
                });
              } catch (err: any) {
                toast({ title: "Error", description: err.message || "Failed to respond to meeting", variant: "destructive" });
              } finally {
                setCalendarResponding(null);
              }
            };

            const labelMap: Record<string, { icon: typeof Calendar; label: string; color: string }> = {
              meetingRequest: { icon: Calendar, label: "Meeting Invitation", color: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800" },
              meetingCancelled: { icon: CalendarX, label: "Meeting Cancelled", color: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800" },
              meetingAccepted: { icon: CalendarCheck, label: "Meeting Accepted", color: "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800" },
              meetingDeclined: { icon: CalendarX, label: "Meeting Declined", color: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800" },
              meetingTenativelyAccepted: { icon: CalendarClock, label: "Tentatively Accepted", color: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800" },
            };

            const info = labelMap[meetingType!] || labelMap.meetingRequest;
            const IconComp = info.icon;

            return (
              <div className={`mt-4 rounded-lg border p-4 ${info.color}`} data-testid="calendar-invite-banner">
                <div className="flex items-center gap-2 mb-2">
                  <IconComp className="w-5 h-5" />
                  <span className="font-semibold text-sm">{info.label}</span>
                  {calendarResponded && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                      <Check className="w-3.5 h-3.5" />
                      {calendarResponded === "accept" ? "Accepted" : calendarResponded === "decline" ? "Declined" : "Tentatively Accepted"}
                    </span>
                  )}
                </div>

                {isMeetingRequest && !calendarResponded && (
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleCalendarResponse("accept")}
                      disabled={!!calendarResponding}
                      data-testid="button-accept-meeting"
                    >
                      {calendarResponding === "accept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarCheck className="w-3.5 h-3.5" />}
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => handleCalendarResponse("tentativelyAccept")}
                      disabled={!!calendarResponding}
                      data-testid="button-tentative-meeting"
                    >
                      {calendarResponding === "tentativelyAccept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
                      Tentative
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => handleCalendarResponse("decline")}
                      disabled={!!calendarResponding}
                      data-testid="button-decline-meeting"
                    >
                      {calendarResponding === "decline" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarX className="w-3.5 h-3.5" />}
                      Decline
                    </Button>
                  </div>
                )}

                {(isAccepted || isTentative || isDeclined || isCancelled) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAccepted && "This meeting has been accepted."}
                    {isTentative && "This meeting has been tentatively accepted."}
                    {isDeclined && "This meeting has been declined."}
                    {isCancelled && "This meeting has been cancelled by the organiser."}
                  </p>
                )}
              </div>
            );
          })()}

          <div className="mt-6" data-testid="text-mail-body">
            {fullMessage?.body ? (
              <iframe
                ref={iframeRef}
                className="w-full border-0 min-h-[400px] h-[60vh]"
                sandbox="allow-popups"
                srcDoc={iframeSrcDoc}
                title="Email content"
                data-testid="iframe-mail-body"
              />
            ) : (
              <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                {message.bodyPreview}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t px-6 py-3 shrink-0 bg-muted/20">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => onReply(message)}
            data-testid="button-reply-bottom"
          >
            <Reply className="w-3.5 h-3.5" />
            Reply
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => onReplyAll(message)}
            data-testid="button-reply-all-bottom"
          >
            <ReplyAll className="w-3.5 h-3.5" />
            Reply All
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => onForward(message)}
            data-testid="button-forward-bottom"
          >
            <Forward className="w-3.5 h-3.5" />
            Forward
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MailView({
  mailType,
}: {
  mailType: "personal" | "shared";
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState<string>("Inbox");
  const [search, setSearch] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const [showFolders] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<Partial<ComposeData>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isPersonal = mailType === "personal";
  const foldersApiBase = isPersonal ? "/api/user-mail/folders" : "/api/shared-mailbox/folders";
  const messagesBaseKey = isPersonal ? "/api/user-mail/messages" : "/api/shared-mailbox/messages";
  const sendEndpoint = isPersonal ? "/api/user-mail/send" : "/api/shared-mailbox/send";

  const { data: status, isLoading: statusLoading } = useQuery<{ connected: boolean; email?: string }>({
    queryKey: isPersonal ? ["/api/user-mail/status"] : ["/api/shared-mailbox/status"],
  });

  const { data: folders } = useQuery<MailFolder[]>({
    queryKey: [foldersApiBase],
    enabled: status?.connected === true,
  });

  const { data: messages, isLoading: mailLoading, refetch: refetchMail } = useQuery<MailMessage[]>({
    queryKey: [messagesBaseKey, selectedFolderId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedFolderId) params.set("folderId", selectedFolderId);
      const res = await fetch(`${messagesBaseKey}?${params}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch mail");
      return res.json();
    },
    enabled: status?.connected === true,
    refetchInterval: 60000,
  });

  const topLevelFolders = useMemo(() => {
    if (!folders) return [];
    const mainFolderNames = new Set(FOLDER_ORDER);
    const topLevel = folders.filter(f => mainFolderNames.has(f.displayName) || !f.parentFolderId);
    return sortFolders(topLevel);
  }, [folders]);

  useEffect(() => {
    if (!selectedFolderId && topLevelFolders.length > 0) {
      const inbox = topLevelFolders.find(f => f.displayName === "Inbox");
      if (inbox) {
        setSelectedFolderId(inbox.id);
        setSelectedFolderName("Inbox");
      }
    }
  }, [topLevelFolders, selectedFolderId]);

  const filtered = useMemo(() => {
    if (!messages) return [];
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter(
      (m) =>
        m.subject?.toLowerCase().includes(q) ||
        m.from?.emailAddress?.name?.toLowerCase().includes(q) ||
        m.from?.emailAddress?.address?.toLowerCase().includes(q) ||
        m.bodyPreview?.toLowerCase().includes(q)
    );
  }, [messages, search]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedId) {
      setSelectedId(filtered[0].id);
    }
    if (filtered.length > 0 && selectedId && !filtered.find(m => m.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selectedMessage = useMemo(
    () => filtered.find((m) => m.id === selectedId) || null,
    [filtered, selectedId]
  );

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setShowDetail(true);
  };

  const handleFolderSelect = (id: string | null, name?: string) => {
    setSelectedFolderId(id);
    setSelectedFolderName(name || "Inbox");
    setSelectedId(null);
    setShowDetail(false);
  };

  const buildReplyQuote = (msg: MailMessage) => {
    const fromStr = msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "Unknown";
    const dateStr = formatFullDate(msg.receivedDateTime);
    return `--- Original Message ---\nFrom: ${fromStr}\nDate: ${dateStr}\nSubject: ${msg.subject || "(No subject)"}\n\n${msg.bodyPreview}`;
  };

  const handleReply = (msg: MailMessage) => {
    setComposeData({
      to: msg.from?.emailAddress?.address || "",
      subject: msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject || ""}`,
      body: "",
      originalBody: buildReplyQuote(msg),
    });
    setComposeOpen(true);
  };

  const handleReplyAll = (msg: MailMessage) => {
    const toAddresses = [
      msg.from?.emailAddress?.address,
      ...(msg.toRecipients || []).map(r => r.emailAddress?.address),
    ].filter(Boolean).join(", ");
    const ccAddresses = (msg.ccRecipients || []).map(r => r.emailAddress?.address).filter(Boolean).join(", ");
    setComposeData({
      to: toAddresses,
      cc: ccAddresses,
      subject: msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject || ""}`,
      body: "",
      originalBody: buildReplyQuote(msg),
    });
    setComposeOpen(true);
  };

  const handleForward = (msg: MailMessage) => {
    setComposeData({
      to: "",
      subject: msg.subject?.startsWith("Fwd:") ? msg.subject : `Fwd: ${msg.subject || ""}`,
      body: "",
      originalBody: buildReplyQuote(msg),
    });
    setComposeOpen(true);
  };

  const handleDelete = async (msg: MailMessage) => {
    if (!msg?.id) return;
    const currentIndex = filtered.findIndex(m => m.id === msg.id);
    const nextMessage = currentIndex >= 0
      ? (filtered[currentIndex + 1] || filtered[currentIndex - 1] || null)
      : null;

    const cacheKey = [messagesBaseKey, selectedFolderId];
    const previousMessages = queryClient.getQueryData<MailMessage[]>(cacheKey);
    queryClient.setQueryData<MailMessage[]>(cacheKey, (old) =>
      old ? old.filter(m => m.id !== msg.id) : old
    );

    if (nextMessage) {
      setSelectedId(nextMessage.id);
    } else {
      setSelectedId(null);
      setShowDetail(false);
    }

    const deleteEndpoint = isPersonal
      ? `/api/user-mail/messages/${msg.id}`
      : `/api/shared-mailbox/messages/${msg.id}`;

    try {
      const res = await fetch(deleteEndpoint, {
        method: "DELETE",
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Delete failed (${res.status})`);
      }
      toast({ title: "Deleted", description: "Message moved to Deleted Items." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: [messagesBaseKey] });
        queryClient.invalidateQueries({ queryKey: [foldersApiBase] });
      }, 2000);
    } catch (err: any) {
      queryClient.setQueryData<MailMessage[]>(cacheKey, previousMessages);
      setSelectedId(msg.id);
      toast({ title: "Failed to delete", description: err?.message || "Could not delete message.", variant: "destructive" });
    }
  };

  const handleToggleRead = async (msg: MailMessage) => {
    const endpoint = isPersonal
      ? `/api/user-mail/messages/${msg.id}/read`
      : `/api/shared-mailbox/messages/${msg.id}/read`;
    try {
      await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ isRead: !msg.isRead }),
      });
      queryClient.invalidateQueries({ queryKey: [messagesBaseKey] });
      queryClient.invalidateQueries({ queryKey: [foldersApiBase] });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  if (statusLoading) {
    return (
      <div className="h-full flex">
        <div className="w-[200px] border-r p-3 space-y-2 hidden sm:block">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-7" />)}
        </div>
        <div className="w-[360px] border-r p-4 space-y-3">
          <Skeleton className="h-9 w-full" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="w-9 h-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  if (!status?.connected) {
    if (isPersonal) return <ConnectPrompt />;
    return (
      <div className="h-full flex items-center justify-center" data-testid="shared-mailbox-setup">
        <div className="text-center space-y-4 max-w-sm px-6">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Bot className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">ChatBGP Shared Inbox</h2>
            <p className="text-sm text-muted-foreground mt-2">
              The shared mailbox (chatbgp@brucegillinghampollard.com) needs Azure AD application permissions to be configured.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const unreadCount = messages?.filter((m) => !m.isRead).length || 0;
  const totalUnread = folders?.reduce((sum, f) => sum + (f.unreadItemCount || 0), 0) || 0;
  const MailTypeIcon = isPersonal ? MailIcon : Bot;

  return (
    <div className="h-full flex flex-col" data-testid={`${mailType}-mail-page`}>
      <div className="flex items-center px-4 py-2 border-b shrink-0 bg-muted/30 gap-2">
        {showDetail && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden"
            onClick={() => setShowDetail(false)}
            data-testid="button-back-to-list"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        )}
        <Button
          size="sm"
          className="gap-1.5 text-xs h-8"
          onClick={() => { setComposeData({}); setComposeOpen(true); }}
          data-testid="button-compose"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Email</span>
        </Button>
        {selectedMessage && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive"
            onClick={() => handleDelete(selectedMessage)}
            title="Delete"
            data-testid="button-delete-toolbar"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => refetchMail()}
          title="Refresh"
          data-testid="button-refresh-mail"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
          <Cloud className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden sm:inline text-[11px] truncate max-w-[180px]">
            {isPersonal ? "Connected" : status?.email || "Connected"}
          </span>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {showFolders && (
          <div className="w-[200px] border-r shrink-0 flex-col hidden sm:flex" data-testid="folder-sidebar">
            <div className="px-2 pt-2 pb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Folders</p>
            </div>
            <ScrollArea className="flex-1">
              <div className="px-1 pb-2 space-y-0.5">
                {topLevelFolders.map((folder) => (
                  <FolderItem
                    key={folder.id}
                    folder={folder}
                    selectedFolderId={selectedFolderId}
                    onSelect={(id, name) => handleFolderSelect(id, name || "Mail")}
                    apiBase={foldersApiBase}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <div className="flex-1 flex min-h-0 min-w-0">
          <div className={`w-full lg:w-[380px] xl:w-[420px] lg:border-r flex flex-col shrink-0 ${showDetail ? "hidden lg:flex" : "flex"}`}>
            <div className="px-3 py-2.5 border-b shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search mail..."
                  className="pl-9 h-8 text-sm bg-muted/50 border-0 focus-visible:ring-1"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-mail"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {mailLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Inbox className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">{search ? "No matching messages" : "No messages in this folder"}</p>
                </div>
              ) : (
                filtered.map((msg) => (
                  <MessageRow
                    key={msg.id}
                    message={msg}
                    selected={selectedId === msg.id}
                    onClick={() => handleSelect(msg.id)}
                  />
                ))
              )}
            </div>
          </div>

          <div className={`flex-1 min-w-0 ${showDetail ? "flex flex-col" : "hidden lg:flex lg:flex-col"}`}>
            <MessageDetail
              message={selectedMessage}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onDelete={handleDelete}
              onToggleRead={handleToggleRead}
              mailType={mailType}
            />
          </div>
        </div>
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        initialData={composeData}
        sendEndpoint={sendEndpoint}
        senderLabel={!isPersonal ? "chatbgp@brucegillinghampollard.com" : undefined}
      />
    </div>
  );
}

export default function Mail() {
  const [activeTab, setActiveTab] = useState<string>("shared");

  return (
    <div className="h-full flex flex-col" data-testid="mail-page-wrapper">
      <div className="px-4 py-2.5 shrink-0 mail-tab-bar">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-9 mail-tab-list">
            <TabsTrigger value="shared" className={`text-xs gap-1.5 ${activeTab === "shared" ? "mail-tab-active" : "mail-tab-inactive"}`} data-testid="tab-shared-inbox">
              <Bot className="w-3.5 h-3.5" />
              ChatBGP Inbox
            </TabsTrigger>
            <TabsTrigger value="personal" className={`text-xs gap-1.5 ${activeTab === "personal" ? "mail-tab-active" : "mail-tab-inactive"}`} data-testid="tab-personal-inbox">
              <MailIcon className="w-3.5 h-3.5" />
              My Inbox
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 min-h-0">
        {activeTab === "shared" ? <MailView mailType="shared" /> : <MailView mailType="personal" />}
      </div>
    </div>
  );
}
