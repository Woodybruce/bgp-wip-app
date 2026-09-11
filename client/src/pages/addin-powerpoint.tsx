import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn, getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pillTabsList, pillTabsTrigger } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Building2, Briefcase, TrendingUp, Copy,
  ExternalLink, BarChart3, FileText, Users, MapPin,
  MessageSquare, Send, Sparkles, Loader2, Check, Presentation
} from "lucide-react";
import { AddinHeader } from "@/components/addin-header";

declare global {
  interface Window {
    Office?: any;
  }
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// Pull the AI's insertText action blocks out of a reply. The PowerPoint
// equivalent of Excel's writeFormula/writeValue parsing — the model emits
// ```json {"action":"insertText","text":"…"}``` blocks and we render an
// "Insert into slide" button for each. Any other action verb is ignored so
// hallucinated ones (addSlide, setFont…) don't produce dead buttons.
function parseInsertActions(content: string): string[] {
  const out: string[] = [];
  const re = /```json\s*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed.action === "insertText" && typeof parsed.text === "string" && parsed.text.trim()) {
        out.push(parsed.text);
      }
    } catch {}
  }
  return out;
}

// Strip the insertText action blocks so the chat shows only the prose — the
// blocks render separately as Insert buttons. Leaves non-action ```json```
// snippets the user actually asked for intact.
function stripInsertActions(content: string): string {
  const out = content.replace(/```json\s*\n?([\s\S]*?)```/g, (full, body) => {
    try {
      const parsed = JSON.parse(String(body).trim());
      if (parsed.action === "insertText") return "";
    } catch {}
    return full;
  });
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function InsertButton({ text, onInsert }: { text: string; onInsert: (t: string) => void }) {
  const [inserted, setInserted] = useState(false);
  const preview = text.split("\n")[0].slice(0, 32) + (text.length > 32 ? "…" : "");
  return (
    <button
      onClick={() => { onInsert(text); setInserted(true); }}
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
        inserted
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "bg-primary/10 text-primary hover:bg-primary/20"
      }`}
      data-testid="button-insert-slide"
      title={text}
    >
      {inserted ? <Check className="w-3 h-3" /> : <Presentation className="w-3 h-3" />}
      {inserted ? "Inserted" : `Insert: ${preview}`}
    </button>
  );
}

function AddinPowerPoint() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: searchResults, isLoading: searchLoading } = useQuery<any>({
    queryKey: ["/api/search", searchQuery],
    queryFn: () => fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include", headers: { ...getAuthHeaders() } }).then(r => r.json()),
    enabled: searchQuery.length >= 2,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/stats"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: comps } = useQuery<any[]>({
    queryKey: ["/api/crm/comps"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: availableUnits } = useQuery<any[]>({
    queryKey: ["/api/available-units"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard` });
  };

  const insertIntoSlide = (text: string) => {
    if (window.Office) {
      try {
        window.Office.context.document.setSelectedDataAsync(
          text,
          { coercionType: window.Office.CoercionType.Text },
          (result: any) => {
            if (result.status === "succeeded") {
              toast({ title: "Inserted", description: "Content added to slide" });
            } else {
              copyToClipboard(text, "Content");
            }
          }
        );
      } catch {
        copyToClipboard(text, "Content");
      }
    } else {
      copyToClipboard(text, "Content");
    }
  };

  // ── ChatBGP (full assistant, inside PowerPoint) ──────────────────────────
  const [tab, setTab] = useState("chat");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, chatLoading]);

  // Best-effort: read whatever text the user has selected on the slide so the
  // AI has context. Empty if nothing's selected or the host blocks it.
  const readSlideContext = (): Promise<string> => new Promise((resolve) => {
    try {
      if (!window.Office?.context?.document?.getSelectedDataAsync) return resolve("");
      window.Office.context.document.getSelectedDataAsync(
        window.Office.CoercionType.Text,
        (r: any) => resolve(r?.status === "succeeded" && typeof r.value === "string" ? r.value.slice(0, 8000) : "")
      );
    } catch { resolve(""); }
  });

  const clearChat = () => setChatMessages([]);

  const sendChat = async (text?: string) => {
    const msg = (text ?? chatInput).trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: msg };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    let ctx = "";
    try { ctx = await readSlideContext(); } catch {}

    try {
      const apiMessages = [...chatMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chatbgp/powerpoint-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ messages: apiMessages, pptContext: ctx || undefined }),
      });
      if (!res.ok) {
        let errMsg = `Server error: ${res.status}`;
        try { const b = await res.json(); if (b?.message) errMsg = b.message; } catch {}
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
              try { const d = JSON.parse(line.slice(6)); if (d.reply) fullReply = d.reply; } catch {}
            }
          }
        }
        if (buffer.startsWith("data: ")) {
          try { const d = JSON.parse(buffer.slice(6)); if (d.reply) fullReply = d.reply; } catch {}
        }
      }
      if (fullReply) {
        setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: fullReply }]);
      }
    } catch (err: any) {
      setChatMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Sorry, I couldn't process that. ${err?.message || "Please try again."}`,
      }]);
    }
    setChatLoading(false);
    chatInputRef.current?.focus();
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      sendChat();
    }
  };

  const contacts = searchResults?.contacts || [];
  const companies = searchResults?.companies || [];
  const deals = searchResults?.deals || [];
  const properties = searchResults?.properties || [];

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
      <AddinHeader title="ChatBGP" subtitle="PowerPoint" onNewChat={tab === "chat" ? clearChat : undefined} />
      <div className="p-3">

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={pillTabsList}>
          <TabsTrigger value="chat" className={pillTabsTrigger} data-testid="tab-chat">
            Chat
          </TabsTrigger>
          <TabsTrigger value="search" className={pillTabsTrigger} data-testid="tab-search">
            Search
          </TabsTrigger>
          <TabsTrigger value="comps" className={pillTabsTrigger} data-testid="tab-comps">
            Comps
          </TabsTrigger>
          <TabsTrigger value="available" className={pillTabsTrigger} data-testid="tab-available">
            Available
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-0">
          <div
            ref={chatScrollRef}
            className="overflow-y-auto px-1"
            style={{ height: "calc(100vh - 190px)" }}
          >
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center text-center px-4 pt-10 pb-6">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm font-medium">ChatBGP for slides</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
                  Ask me to pull CRM data and draft slide content — "comps for Soho restaurants, make a slide", or "summarise the M&S deal in three bullets". You'll get a one-click <span className="font-medium">Insert into slide</span> button.
                </p>
              </div>
            ) : (
              <div className="space-y-3 py-2">
                {chatMessages.map((m) => {
                  if (m.role === "user") {
                    return (
                      <div key={m.id} className="ml-auto max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-[13px] whitespace-pre-wrap break-words">
                        {m.content}
                      </div>
                    );
                  }
                  const prose = stripInsertActions(m.content);
                  const inserts = parseInsertActions(m.content);
                  return (
                    <div key={m.id} className="mr-auto max-w-[92%] space-y-2">
                      {prose && (
                        <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-[13px] whitespace-pre-wrap break-words">
                          {prose}
                        </div>
                      )}
                      {inserts.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {inserts.length > 1 && (
                            <button
                              onClick={() => inserts.forEach((t) => insertIntoSlide(t))}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
                              data-testid="button-insert-all"
                              title={`Insert all ${inserts.length} blocks`}
                            >
                              <Presentation className="w-3 h-3" /> Insert all {inserts.length}
                            </button>
                          )}
                          {inserts.map((t, i) => (
                            <InsertButton key={`${m.id}-ins-${i}`} text={t} onInsert={insertIntoSlide} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {chatLoading && (
                  <div className="mr-auto flex items-center gap-2 text-muted-foreground text-[13px] px-3 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="fixed bottom-0 left-0 right-0 p-2 bg-background border-t flex gap-1.5" style={{ maxWidth: 400 }}>
            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatKeyDown}
              placeholder="Ask ChatBGP, or describe a slide…"
              rows={1}
              className="flex-1 resize-none rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] outline-none focus:border-primary max-h-[120px]"
              data-testid="input-chat"
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => sendChat()}
              disabled={chatLoading || !chatInput.trim()}
              data-testid="button-send-chat"
            >
              {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="search" className="mt-3">
          <div className="relative mb-3">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              data-testid="input-search"
              placeholder="Search CRM for presentation data..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <ScrollArea className="h-[calc(100vh-200px)]">
            {searchLoading && (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            )}

            {!searchLoading && searchQuery.length >= 2 && (
              <div className="space-y-3">
                {properties.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Properties
                    </h2>
                    {properties.slice(0, 8).map((p: any) => (
                      <Card key={p.id} className="mb-1.5">
                        <CardContent className="p-2.5">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{p.name || p.address}</p>
                              {p.postcode && <p className="text-xs text-muted-foreground">{p.postcode}</p>}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => insertIntoSlide(`${p.name || p.address}${p.postcode ? `, ${p.postcode}` : ""}`)}
                              data-testid={`button-insert-property-${p.id}`}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {deals.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Deals
                    </h2>
                    {deals.slice(0, 8).map((d: any) => (
                      <Card key={d.id} className="mb-1.5">
                        <CardContent className="p-2.5">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{d.name || d.property}</p>
                              <div className="flex gap-1 mt-0.5">
                                {d.status && <Badge variant="outline" className="text-[10px]">{d.status}</Badge>}
                                {d.rent && <Badge variant="secondary" className="text-[10px]">{d.rent}</Badge>}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => {
                                const text = `${d.name || d.property}\nStatus: ${d.status || "N/A"}${d.rent ? `\nRent: ${d.rent}` : ""}${d.tenant ? `\nTenant: ${d.tenant}` : ""}`;
                                insertIntoSlide(text);
                              }}
                              data-testid={`button-insert-deal-${d.id}`}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {contacts.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Contacts
                    </h2>
                    {contacts.slice(0, 6).map((c: any) => (
                      <Card key={c.id} className="mb-1.5">
                        <CardContent className="p-2.5">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{c.name}</p>
                              {c.company && <p className="text-xs text-muted-foreground truncate">{c.company}</p>}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => insertIntoSlide(`${c.name}${c.title ? `, ${c.title}` : ""}${c.company ? `\n${c.company}` : ""}`)}
                              data-testid={`button-insert-contact-${c.id}`}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {contacts.length === 0 && companies.length === 0 && deals.length === 0 && properties.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-sm text-muted-foreground">No results found</p>
                  </div>
                )}
              </div>
            )}

            {!searchLoading && searchQuery.length < 2 && (
              <div className="text-center py-8">
                <Search className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Search CRM data to insert into your presentation</p>
                <p className="text-xs text-muted-foreground mt-1">Properties, deals, contacts, companies</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="comps" className="mt-3">
          <ScrollArea className="h-[calc(100vh-160px)]">
            {comps && comps.length > 0 ? (
              <div className="space-y-1.5">
                {comps.slice(0, 25).map((c: any) => (
                  <Card key={c.id} data-testid={`card-comp-${c.id}`}>
                    <CardContent className="p-2.5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{c.property || c.address}</p>
                          {c.tenant && <p className="text-xs text-muted-foreground truncate">{c.tenant}</p>}
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {c.rent && <Badge variant="secondary" className="text-[10px]">{c.rent}</Badge>}
                            {c.size && <Badge variant="outline" className="text-[10px]">{c.size}</Badge>}
                            {c.completionDate && <Badge variant="outline" className="text-[10px]">{c.completionDate}</Badge>}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => {
                            const text = `${c.property || c.address}\nTenant: ${c.tenant || "N/A"}${c.rent ? `\nRent: ${c.rent}` : ""}${c.size ? `\nSize: ${c.size}` : ""}`;
                            insertIntoSlide(text);
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <BarChart3 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No comps available</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="available" className="mt-3">
          <ScrollArea className="h-[calc(100vh-160px)]">
            {availableUnits && availableUnits.length > 0 ? (
              <div className="space-y-1.5">
                {availableUnits.slice(0, 25).map((u: any) => (
                  <Card key={u.id} data-testid={`card-unit-${u.id}`}>
                    <CardContent className="p-2.5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{u.address || u.property}</p>
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {u.size && <Badge variant="secondary" className="text-[10px]">{u.size}</Badge>}
                            {u.rent && <Badge variant="outline" className="text-[10px]">{u.rent}</Badge>}
                            {u.status && <Badge variant="outline" className="text-[10px]">{u.status}</Badge>}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => {
                            const text = `${u.address || u.property}${u.size ? `\nSize: ${u.size}` : ""}${u.rent ? `\nRent: ${u.rent}` : ""}`;
                            insertIntoSlide(text);
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <MapPin className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No available units</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
      </div>

      {tab !== "chat" && (
        <div className="fixed bottom-0 left-0 right-0 p-2 bg-background border-t" style={{ maxWidth: 400 }}>
          <a
            href="https://bgp-wip-app-production-efac.up.railway.app"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-open-dashboard"
          >
            Open full dashboard <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}

export default AddinPowerPoint;
