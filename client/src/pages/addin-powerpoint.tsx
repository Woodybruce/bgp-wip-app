import { useState } from "react";
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
  LogOut
} from "lucide-react";
import { AddinHeader } from "@/components/addin-header";
import { AddinSignIn, useAddinAuth } from "@/components/addin-signin";
import { AddinAgentChat, type AgentDoc } from "@/components/addin-agent-chat";
import { readPresentation, runPptTool } from "@/lib/ppt-agent-tools";

declare global {
  interface Window {
    Office?: any;
  }
}

const PPT_PROMPTS = [
  { label: "Review this deck", prompt: "Read this deck and tell me what's weak — story, evidence, missing data — slide by slide." },
  { label: "Add a comps slide", prompt: "Add a slide with the most relevant comparable evidence from BGP's comps for the property in this deck." },
  { label: "Deal summary", prompt: "Add a slide summarising the deal in this deck — key terms, parties and status — from our CRM." },
  { label: "Check the facts", prompt: "Check every figure, name and date in this deck against BGP's records and tell me what's wrong." },
];

async function readDeck(): Promise<AgentDoc | null> {
  const Office = (window as any).Office;
  if (!Office?.context?.document) return null;
  let name = "";
  try { name = decodeURIComponent(String(Office.context.document.url || "").split(/[\\/]/).pop() || "").split("?")[0]; } catch {}
  let summary = "";
  try {
    const deck = await readPresentation(1, 12);
    summary = `The open deck${name ? ` "${name}"` : ""} has ${deck.slides} slides. First slides (call ppt_read_presentation for the rest):\n` +
      deck.detail.map((sl: any) => `Slide ${sl.slide}: ` + sl.shapes.filter((x: any) => x.text).map((x: any) => `[${x.name}] ${String(x.text).replace(/\s+/g, " ").slice(0, 160)}`).join(" | ")).join("\n") +
      (deck.layouts.length ? `\nLayouts: ${deck.layouts.join(", ")}` : "");
  } catch {}
  return { key: `ppt:${name || "untitled deck"}`, context: summary, label: name ? `Working on: ${name}` : "Working on this deck" };
}

function AddinPowerPoint() {
  const { toast } = useToast();
  const { token, login, logout } = useAddinAuth();
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

  const [tab, setTab] = useState("chat");

  const contacts = searchResults?.contacts || [];
  const companies = searchResults?.companies || [];
  const deals = searchResults?.deals || [];
  const properties = searchResults?.properties || [];

  if (!token) {
    return (
      <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
        <AddinHeader title="ChatBGP" />
        <AddinSignIn onLogin={login} purpose="Sign in to use ChatBGP on this deck with the BGP CRM behind it." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
      <AddinHeader title="ChatBGP">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={logout} title="Sign out" data-testid="button-ppt-logout">
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </AddinHeader>
      <div className="p-3">

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={pillTabsList}>
          <TabsTrigger value="chat" className={pillTabsTrigger} data-testid="tab-chat">
            ChatBGP
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

        <TabsContent value="chat" className="mt-0 -mx-3">
          <AddinAgentChat
            host="powerpoint" token={token} onUnauthorised={logout}
            readDoc={readDeck} runTool={runPptTool}
            prompts={PPT_PROMPTS}
            intro="ChatBGP builds and edits this deck with BGP's CRM, comps, deals and your memory behind it."
            placeholder="Ask ChatBGP, or describe the slides you want…"
            heightOffset={126}
          />
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
