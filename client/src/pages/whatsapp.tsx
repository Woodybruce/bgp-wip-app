import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle,
  Send,
  ArrowLeft,
  Phone,
  User,
  AlertCircle,
  Plus,
  Search,
} from "lucide-react";
import type { WaConversation, WaMessage } from "@shared/schema";

function formatPhoneDisplay(phone: string): string {
  if (phone.startsWith("44")) {
    return "+44 " + phone.slice(2);
  }
  return "+" + phone;
}

function formatTime(ts: string | Date | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return d.toLocaleDateString("en-GB", { weekday: "short" });
  }
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNewChat,
  searchQuery,
  onSearchChange,
}: {
  conversations: WaConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  const filtered = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.contactName?.toLowerCase().includes(q) ||
      c.waPhoneNumber.includes(q) ||
      c.lastMessagePreview?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b flex items-center gap-2">
        <h2 className="font-semibold text-sm flex-1">Messages</h2>
        <Button variant="ghost" size="icon" onClick={onNewChat} data-testid="button-new-chat">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            className="text-sm pl-8"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            data-testid="input-search-conversations"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No conversations yet
          </div>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.id}
              className={`w-full text-left p-3 hover:bg-muted/50 transition-colors border-b ${
                selectedId === conv.id ? "bg-muted" : ""
              }`}
              onClick={() => onSelect(conv.id)}
              data-testid={`button-conversation-${conv.id}`}
            >
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm truncate">
                      {conv.contactName || formatPhoneDisplay(conv.waPhoneNumber)}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                      {formatTime(conv.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-muted-foreground truncate pr-2">
                      {conv.lastMessagePreview || "No messages"}
                    </p>
                    {(conv.unreadCount ?? 0) > 0 && (
                      <Badge variant="default" className="text-[10px] shrink-0">
                        {conv.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </ScrollArea>
    </div>
  );
}

function MessageThread({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{
    conversation: WaConversation;
    messages: WaMessage[];
  }>({
    queryKey: ["/api/whatsapp/conversations", conversationId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/whatsapp/conversations/${conversationId}/messages`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch("/api/whatsapp/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to: data?.conversation.waPhoneNumber,
          body,
          contactName: data?.conversation.contactName,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(json?.message || "Send failed");
        err.code = json?.code;
        err.subcode = json?.subcode;
        err.metaStatus = json?.status;
        throw err;
      }
      return json;
    },
    onSuccess: () => {
      setNewMessage("");
      queryClient.invalidateQueries({
        queryKey: ["/api/whatsapp/conversations", conversationId, "messages"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
    },
    onError: (err: any) => {
      const codePart = err?.code ? ` (Meta ${err.code}${err.subcode ? `/${err.subcode}` : ""})` : "";
      toast({
        title: "WhatsApp send failed",
        description: `${err?.message || "Unknown error"}${codePart}`,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages]);

  const handleSend = () => {
    if (!newMessage.trim()) return;
    sendMutation.mutate(newMessage.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const conv = data?.conversation;
  const messages = data?.messages || [];

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} data-testid="button-back-mobile">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate" data-testid="text-contact-name">
            {conv?.contactName || (conv && formatPhoneDisplay(conv.waPhoneNumber)) || "Loading..."}
          </h3>
          {conv && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {formatPhoneDisplay(conv.waPhoneNumber)}
            </p>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-3/4" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            No messages yet. Send the first message below.
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                data-testid={`message-${msg.id}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    msg.direction === "outbound"
                      ? "bg-green-500 text-white"
                      : "bg-muted"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                  <p
                    className={`text-[10px] mt-1 ${
                      msg.direction === "outbound" ? "text-green-100" : "text-muted-foreground"
                    }`}
                  >
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      <div className="p-3 border-t flex items-center gap-2">
        <Input
          placeholder="Type a message..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sendMutation.isPending}
          className="flex-1"
          data-testid="input-message"
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!newMessage.trim() || sendMutation.isPending}
          className="shrink-0"
          data-testid="button-send"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function NewChatPanel({ onStartChat }: { onStartChat: (phone: string, name?: string) => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");

  const handleStart = () => {
    if (!phone.trim()) return;
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    onStartChat(cleanPhone, name || undefined);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="w-full max-w-sm space-y-4">
        <h3 className="text-lg font-semibold text-center">New Conversation</h3>
        <p className="text-sm text-muted-foreground text-center">
          Enter the phone number to start a WhatsApp conversation. Include the country code (e.g. 447876354160).
        </p>
        <Input
          placeholder="Phone number (e.g. 447876354160)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          data-testid="input-new-phone"
        />
        <Input
          placeholder="Contact name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-new-name"
        />
        <Button className="w-full" onClick={handleStart} data-testid="button-start-chat">
          <MessageCircle className="w-4 h-4 mr-2" />
          Start Conversation
        </Button>
      </div>
    </div>
  );
}

export default function WhatsApp() {
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading } = useQuery<{
    connected: boolean;
    tokenValid?: boolean;
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: string;
    error?: { status?: number; code?: number; subcode?: number; message?: string; type?: string };
  }>({
    queryKey: ["/api/whatsapp/status"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: conversations = [], isLoading: convLoading } = useQuery<WaConversation[]>({
    queryKey: ["/api/whatsapp/conversations"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!status?.connected,
    refetchInterval: 10000,
  });

  const startNewChat = async (phone: string, name?: string) => {
    try {
      const existing = conversations.find((c) => c.waPhoneNumber === phone);
      if (existing) {
        setSelectedConvId(existing.id);
        setShowNewChat(false);
        return;
      }
      setSelectedConvId(null);
      setShowNewChat(false);

      const res = await apiRequest("POST", "/api/whatsapp/messages", {
        to: phone,
        body: "Hello!",
        contactName: name,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
      if (data.conversation?.id) {
        setSelectedConvId(data.conversation.id);
      }
    } catch {
      toast({
        title: "Failed",
        description: "Could not start conversation. Please check WhatsApp is configured correctly.",
        variant: "destructive",
      });
    }
  };

  if (statusLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (!status?.connected || status.tokenValid === false) {
    const e = status?.error;
    const codeLine = e?.code ? `Meta error ${e.code}${e.subcode ? `/${e.subcode}` : ""}${e.status ? ` (HTTP ${e.status})` : ""}` : null;
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {!status?.connected ? "WhatsApp Not Configured" : "WhatsApp Token Invalid"}
            </h3>
            <p className="text-muted-foreground text-center max-w-md">
              {!status?.connected
                ? "WhatsApp Business API credentials are missing. Add WHATSAPP_TOKEN_V2 and WHATSAPP_PHONE_NUMBER_ID to the server env."
                : e?.message || "The Graph API rejected the configured token. Generate a new permanent system-user token in Meta Business Manager and update WHATSAPP_TOKEN_V2."}
            </p>
            {codeLine && (
              <p className="text-xs text-muted-foreground mt-3 font-mono">{codeLine}</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const qualityColor =
    status?.qualityRating === "GREEN"
      ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
      : status?.qualityRating === "YELLOW"
        ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"
        : status?.qualityRating === "RED"
          ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
          : "bg-muted text-muted-foreground";

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      <div className="border-b bg-muted/30 px-4 py-1.5 flex items-center gap-2 text-xs shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" data-testid="indicator-connected" />
        <span className="text-muted-foreground">Connected as</span>
        <span className="font-medium truncate" data-testid="text-verified-name">
          {status.verifiedName || "WhatsApp Business"}
        </span>
        {status.displayPhoneNumber && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono" data-testid="text-display-phone">
              {status.displayPhoneNumber}
            </span>
          </>
        )}
        {status.qualityRating && (
          <Badge
            variant="outline"
            className={`ml-auto text-[10px] h-4 px-1.5 ${qualityColor}`}
            data-testid="badge-quality-rating"
          >
            {status.qualityRating}
          </Badge>
        )}
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-80 shrink-0 hidden md:flex flex-col">
          <ConversationList
            conversations={conversations}
            selectedId={selectedConvId}
            onSelect={(id) => {
              setSelectedConvId(id);
              setShowNewChat(false);
            }}
            onNewChat={() => {
              setShowNewChat(true);
              setSelectedConvId(null);
            }}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {showNewChat ? (
            <NewChatPanel onStartChat={startNewChat} />
          ) : selectedConvId ? (
            <MessageThread
              conversationId={selectedConvId}
              onBack={() => setSelectedConvId(null)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageCircle className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg font-medium">WhatsApp Messages</p>
              <p className="text-sm mt-1">Select a conversation or start a new chat</p>
              <div className="md:hidden mt-4 w-full max-w-sm px-4">
                <ConversationList
                  conversations={conversations}
                  selectedId={null}
                  onSelect={(id) => setSelectedConvId(id)}
                  onNewChat={() => setShowNewChat(true)}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
