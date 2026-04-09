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
import { useToast } from "@/hooks/use-toast";
import {
  Search, Building2, Briefcase, Copy, Image as ImageIcon,
  ExternalLink, FileText, Users, MapPin, Download
} from "lucide-react";
import { AddinHeader } from "@/components/addin-header";

function AddinAdobe() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: searchResults, isLoading: searchLoading } = useQuery<any>({
    queryKey: ["/api/search", searchQuery],
    queryFn: () => fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include", headers: { ...getAuthHeaders() } }).then(r => r.json()),
    enabled: searchQuery.length >= 2,
  });

  const { data: comps } = useQuery<any[]>({
    queryKey: ["/api/crm/comps"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: properties } = useQuery<any[]>({
    queryKey: ["/api/crm/properties"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: news } = useQuery<any[]>({
    queryKey: ["/api/news"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied — paste into your Adobe document` });
  };

  const searchContacts = searchResults?.contacts || [];
  const searchCompanies = searchResults?.companies || [];
  const searchDeals = searchResults?.deals || [];
  const searchProperties = searchResults?.properties || [];

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
      <AddinHeader title="BGP Creative Data" subtitle="Adobe" />
      <div className="p-3">

      <Tabs defaultValue="search">
        <TabsList className="w-full h-8">
          <TabsTrigger value="search" className="text-xs flex-1" data-testid="tab-search">
            <Search className="h-3 w-3 mr-1" /> Search
          </TabsTrigger>
          <TabsTrigger value="properties" className="text-xs flex-1" data-testid="tab-properties">
            <Building2 className="h-3 w-3 mr-1" /> Properties
          </TabsTrigger>
          <TabsTrigger value="content" className="text-xs flex-1" data-testid="tab-content">
            <FileText className="h-3 w-3 mr-1" /> Content
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-3">
          <div className="relative mb-3">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              data-testid="input-search"
              placeholder="Search for data to use in designs..."
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
                {searchProperties.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Properties</h2>
                    {searchProperties.slice(0, 6).map((p: any) => (
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
                              onClick={() => copyToClipboard(p.name || p.address, "Property")}
                              data-testid={`button-copy-property-${p.id}`}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {searchDeals.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Deals</h2>
                    {searchDeals.slice(0, 6).map((d: any) => (
                      <Card key={d.id} className="mb-1.5">
                        <CardContent className="p-2.5">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{d.name || d.property}</p>
                              <div className="flex gap-1 mt-0.5">
                                {d.status && <Badge variant="outline" className="text-[10px]">{d.status}</Badge>}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => copyToClipboard(`${d.name || d.property}${d.tenant ? ` — ${d.tenant}` : ""}`, "Deal")}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {searchContacts.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Contacts</h2>
                    {searchContacts.slice(0, 6).map((c: any) => (
                      <Card key={c.id} className="mb-1.5">
                        <CardContent className="p-2.5">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{c.name}</p>
                              {c.company && <p className="text-xs text-muted-foreground truncate">{c.company}</p>}
                              {c.email && <p className="text-xs text-blue-600 dark:text-blue-400 truncate">{c.email}</p>}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => copyToClipboard(`${c.name}${c.title ? `\n${c.title}` : ""}${c.company ? `\n${c.company}` : ""}${c.email ? `\n${c.email}` : ""}${c.phone ? `\n${c.phone}` : ""}`, "Contact")}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {searchProperties.length === 0 && searchDeals.length === 0 && searchContacts.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-sm text-muted-foreground">No results found</p>
                  </div>
                )}
              </div>
            )}

            {!searchLoading && searchQuery.length < 2 && (
              <div className="text-center py-8">
                <Search className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Search CRM data for your designs</p>
                <p className="text-xs text-muted-foreground mt-1">Property names, addresses, contacts, deals</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="properties" className="mt-3">
          <ScrollArea className="h-[calc(100vh-160px)]">
            {properties && properties.length > 0 ? (
              <div className="space-y-1.5">
                {properties.slice(0, 30).map((p: any) => (
                  <Card key={p.id} data-testid={`card-property-${p.id}`}>
                    <CardContent className="p-2.5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.name || p.address}</p>
                          {p.postcode && <p className="text-xs text-muted-foreground">{p.postcode}</p>}
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {p.propertyType && <Badge variant="secondary" className="text-[10px]">{p.propertyType}</Badge>}
                            {p.area && <Badge variant="outline" className="text-[10px]">{p.area}</Badge>}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => {
                            const lines = [p.name || p.address];
                            if (p.postcode) lines.push(p.postcode);
                            if (p.propertyType) lines.push(`Type: ${p.propertyType}`);
                            if (p.area) lines.push(`Area: ${p.area}`);
                            if (p.size) lines.push(`Size: ${p.size}`);
                            copyToClipboard(lines.join("\n"), "Property details");
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
                <Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No properties available</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="content" className="mt-3">
          <p className="text-xs text-muted-foreground mb-3">Copy headlines and summaries for marketing materials</p>
          <ScrollArea className="h-[calc(100vh-180px)]">
            {news && news.length > 0 ? (
              <div className="space-y-1.5">
                {news.slice(0, 20).map((n: any) => (
                  <Card key={n.id} data-testid={`card-news-${n.id}`}>
                    <CardContent className="p-2.5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium line-clamp-2">{n.title}</p>
                          {n.summary && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.summary}</p>}
                          <div className="flex items-center gap-2 mt-1">
                            {n.source && <span className="text-[10px] text-muted-foreground">{n.source}</span>}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => copyToClipboard(n.title + (n.summary ? `\n\n${n.summary}` : ""), "Article")}
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
                <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No content available</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-2 bg-background border-t" style={{ maxWidth: 400 }}>
        <a
          href="https://chatbgp.app"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-open-dashboard"
        >
          Open full dashboard <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

export default AddinAdobe;
