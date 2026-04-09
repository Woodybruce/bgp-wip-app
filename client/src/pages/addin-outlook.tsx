import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Building2, User, Phone, Mail, ExternalLink, Search,
  Briefcase, Plus, ChevronRight, AlertCircle, CheckCircle2
} from "lucide-react";
import { AddinHeader } from "@/components/addin-header";

declare global {
  interface Window {
    Office?: any;
  }
}

function AddinOutlook() {
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [officeReady, setOfficeReady] = useState(false);
  const [manualMode, setManualMode] = useState(false);

  useEffect(() => {
    if (window.Office) {
      window.Office.onReady((info: any) => {
        setOfficeReady(true);
        if (info.host === "Outlook") {
          try {
            const item = window.Office.context.mailbox?.item;
            if (item) {
              const from = item.from;
              if (from) {
                setSenderEmail(from.emailAddress || "");
                setSenderName(from.displayName || "");
                setSearchQuery(from.emailAddress || from.displayName || "");
              }
            }
          } catch (e) {
            console.log("Could not read email context:", e);
          }
        }
      });
    } else {
      setManualMode(true);
    }
  }, []);

  const { data: searchResults, isLoading } = useQuery<any>({
    queryKey: ["/api/search", searchQuery],
    queryFn: () => fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include", headers: { ...getAuthHeaders() } }).then(r => r.json()),
    enabled: searchQuery.length >= 2,
  });

  const contacts = searchResults?.contacts || [];
  const companies = searchResults?.companies || [];
  const deals = searchResults?.deals || [];

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
      <AddinHeader title="BGP Dashboard" subtitle="Outlook" />
      <div className="p-3">

      {senderEmail && (
        <div className="mb-3 p-2 bg-muted rounded-md">
          <p className="text-xs text-muted-foreground">Current email from:</p>
          <p className="text-sm font-medium">{senderName || senderEmail}</p>
          {senderName && <p className="text-xs text-muted-foreground">{senderEmail}</p>}
        </div>
      )}

      <div className="relative mb-4">
        <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          data-testid="input-search"
          placeholder="Search CRM..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!isLoading && searchQuery.length >= 2 && (
        <ScrollArea className="h-[calc(100vh-180px)]">
          <div className="space-y-4">
            {contacts.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <User className="h-3 w-3" /> Contacts ({contacts.length})
                </h2>
                <div className="space-y-1.5">
                  {contacts.slice(0, 10).map((c: any) => (
                    <Card key={c.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <CardContent className="p-2.5">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            {c.company && <p className="text-xs text-muted-foreground truncate">{c.company}</p>}
                            {c.title && <p className="text-xs text-muted-foreground truncate">{c.title}</p>}
                          </div>
                          <div className="flex gap-1 ml-1 shrink-0">
                            {c.phone && (
                              <a href={`tel:${c.phone}`} data-testid={`link-phone-${c.id}`}>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  <Phone className="h-3 w-3" />
                                </Button>
                              </a>
                            )}
                            {c.email && (
                              <a href={`mailto:${c.email}`} data-testid={`link-email-${c.id}`}>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  <Mail className="h-3 w-3" />
                                </Button>
                              </a>
                            )}
                          </div>
                        </div>
                        {c.email && <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 truncate">{c.email}</p>}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {companies.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Companies ({companies.length})
                </h2>
                <div className="space-y-1.5">
                  {companies.slice(0, 10).map((c: any) => (
                    <Card key={c.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <CardContent className="p-2.5">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        {c.sector && <Badge variant="secondary" className="text-[10px] mt-1">{c.sector}</Badge>}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {deals.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Briefcase className="h-3 w-3" /> Deals ({deals.length})
                </h2>
                <div className="space-y-1.5">
                  {deals.slice(0, 10).map((d: any) => (
                    <Card key={d.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <CardContent className="p-2.5">
                        <p className="text-sm font-medium truncate">{d.name || d.property}</p>
                        <div className="flex items-center gap-1 mt-1">
                          {d.status && <Badge variant="outline" className="text-[10px]">{d.status}</Badge>}
                          {d.team && <Badge variant="secondary" className="text-[10px]">{d.team}</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {contacts.length === 0 && companies.length === 0 && deals.length === 0 && (
              <div className="text-center py-8">
                <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No results found</p>
                <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {!isLoading && searchQuery.length < 2 && (
        <div className="text-center py-8">
          <Search className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {senderEmail ? "Searching for sender..." : "Search for contacts, companies, or deals"}
          </p>
        </div>
      )}
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

export default AddinOutlook;
