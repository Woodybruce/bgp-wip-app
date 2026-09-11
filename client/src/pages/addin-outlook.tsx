import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Building2, User, Mail, ExternalLink, Search, Sparkles,
  Briefcase, AlertCircle, CheckCircle2, Loader2, FilePlus2, LogOut,
} from "lucide-react";
import { AddinHeader } from "@/components/addin-header";

declare global {
  interface Window {
    Office?: any;
  }
}

// Same storage the Excel/PowerPoint panes use, so signing in once covers
// every Office add-in on this machine.
const TOKEN_KEY = "bgp_addin_token";
const USER_KEY = "bgp_addin_user";

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Sign-in card — the Excel pane's login, trimmed to what Outlook needs.
// Microsoft SSO opens the existing /api/auth/microsoft flow in an Office
// dialog; the completion page posts back a one-time code we swap for a
// bearer token. Email/password is the fallback for guests and dev.
function OutlookLogin({ onLogin }: { onLogin: (token: string, name: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [msLoading, setMsLoading] = useState(false);

  const signInWithMicrosoft = () => {
    setError("");
    const OfficeRef = (window as any).Office;
    if (!OfficeRef?.context?.ui?.displayDialogAsync) {
      setError("Microsoft sign-in needs to run inside the Outlook task pane — use email + password here.");
      return;
    }
    setMsLoading(true);
    const url = `${window.location.origin}/api/auth/microsoft?addin=1`;
    OfficeRef.context.ui.displayDialogAsync(url, { height: 60, width: 30, promptBeforeOpen: false }, (result: any) => {
      if (result.status !== "succeeded" || !result.value) {
        setMsLoading(false);
        setError("Couldn't open the Microsoft sign-in window.");
        return;
      }
      const dialog = result.value;
      const finish = () => { try { dialog.close(); } catch {} setMsLoading(false); };
      dialog.addEventHandler(OfficeRef.EventType.DialogMessageReceived, async (arg: any) => {
        let msg: any = {};
        try { msg = JSON.parse(arg.message || "{}"); } catch {}
        if (msg.sso_code) {
          finish();
          try {
            const r = await fetch("/api/auth/sso-exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ code: msg.sso_code }),
            });
            const data = await r.json();
            if (r.ok && data.token) onLogin(data.token, data.name || data.username || "");
            else setError(data.message || "Microsoft sign-in failed.");
          } catch { setError("Microsoft sign-in failed. Please try again."); }
        } else {
          finish();
          setError(msg.error || "Microsoft sign-in was cancelled.");
        }
      });
      dialog.addEventHandler(OfficeRef.EventType.DialogEventReceived, () => { finish(); });
    });
  };

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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        setError(data.message || "Login failed");
        setLoading(false);
        return;
      }
      onLogin(data.token, data.name || data.username || email);
    } catch {
      setError("Login failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-3" data-testid="outlook-addin-login">
      <p className="text-sm text-muted-foreground">Sign in to look up senders in the BGP CRM.</p>
      <Button className="w-full h-9" variant="outline" onClick={signInWithMicrosoft} disabled={msLoading} data-testid="button-outlook-ms-login">
        {msLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        Sign in with Microsoft
      </Button>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
        <div className="flex-1 border-t" /> or <div className="flex-1 border-t" />
      </div>
      <form onSubmit={handleSubmit} className="space-y-2">
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 text-sm" data-testid="input-outlook-email" />
        <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-9 text-sm" data-testid="input-outlook-password" />
        <Button type="submit" className="w-full h-9" disabled={loading} data-testid="button-outlook-login">
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Sign in
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Relationship read for the best company match — the same cached AI take
// the brand profile's BGP Relationship panel shows. A missing cache
// self-generates server-side; we poll while inFlight.
function SenderIntelligence({ companyId, companyName, token }: { companyId: string; companyName: string; token: string | null }) {
  const { data } = useQuery<any>({
    queryKey: ["/api/activity/brand", companyId],
    queryFn: () => fetch(`/api/activity/brand/${companyId}`, { credentials: "include", headers: authHeaders(token) }).then(r => r.json()),
    refetchInterval: (q) => ((q.state.data as any)?.inFlight ? 5000 : false),
  });

  const lastTouch = data?.latestActivityDate
    ? new Date(data.latestActivityDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <Card className="border-primary/20" data-testid="outlook-sender-intel">
      <CardContent className="p-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" /> BGP take — {companyName}
          </p>
          {lastTouch && <span className="text-[10px] text-muted-foreground whitespace-nowrap">Last touch {lastTouch}</span>}
        </div>
        {data?.markdown ? (
          <p className="text-xs leading-relaxed whitespace-pre-wrap line-clamp-[8]">{String(data.markdown).replace(/[#*_`]/g, "").slice(0, 600)}</p>
        ) : data?.inFlight ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Analysing the relationship — first read takes about a minute…
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No relationship read yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AddinOutlook() {
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  });
  const [userName, setUserName] = useState(() => {
    try { return localStorage.getItem(USER_KEY) || ""; } catch { return ""; }
  });
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailPreview, setEmailPreview] = useState("");
  const [emailItemId, setEmailItemId] = useState("");
  const [emailDate, setEmailDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [logState, setLogState] = useState<"idle" | "logging" | "done" | "already" | "error">("idle");
  const queryClient = useQueryClient();

  const readOpenEmail = useCallback(() => {
    try {
      const item = window.Office?.context?.mailbox?.item;
      if (!item) return;
      const from = item.from;
      if (from) {
        setSenderEmail(from.emailAddress || "");
        setSenderName(from.displayName || "");
        setSearchQuery(from.emailAddress || from.displayName || "");
      }
      setEmailSubject(item.subject || "");
      setEmailItemId(item.itemId || "");
      setEmailDate(item.dateTimeCreated ? new Date(item.dateTimeCreated).toISOString() : "");
      setLogState("idle");
      item.body?.getAsync?.("text", (r: any) => {
        if (r?.status === "succeeded") setEmailPreview(String(r.value || "").trim().slice(0, 500));
      });
    } catch (e) {
      console.log("Could not read email context:", e);
    }
  }, []);

  useEffect(() => {
    if (!window.Office) return;
    window.Office.onReady((info: any) => {
      if (info.host !== "Outlook") return;
      readOpenEmail();
      // Pinned task panes stay open while the user changes selection —
      // re-read the open email on every switch.
      try {
        window.Office.context.mailbox?.addHandlerAsync?.(
          window.Office.EventType.ItemChanged,
          () => readOpenEmail(),
        );
      } catch {}
    });
  }, [readOpenEmail]);

  const handleLogin = (newToken: string, name: string) => {
    setToken(newToken);
    setUserName(name);
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, name);
    } catch {}
  };

  const handleLogout = () => {
    setToken(null);
    setUserName("");
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
  };

  // Sender search cascade: full email → bare domain (drops the TLD noise)
  // → display name. First query with hits wins.
  const domainWord = senderEmail.includes("@")
    ? (senderEmail.split("@")[1] || "").split(".")[0]
    : "";
  const { data: searchResults, isLoading, error: searchError } = useQuery<any>({
    queryKey: ["/api/search", searchQuery, token],
    queryFn: async () => {
      // /api/search returns a flat typed array: {results: [{id, name, type, subtitle}]}
      const run = async (q: string) => {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { credentials: "include", headers: authHeaders(token) });
        if (r.status === 401) throw new Error("401");
        const raw = await r.json();
        const rows = Array.isArray(raw?.results) ? raw.results : [];
        return {
          contacts: rows.filter((x: any) => x.type === "contact"),
          companies: rows.filter((x: any) => x.type === "company"),
          deals: rows.filter((x: any) => x.type === "deal"),
        };
      };
      const count = (b: any) => b.contacts.length + b.companies.length + b.deals.length;
      const first = await run(searchQuery);
      if (count(first) > 0 || searchQuery !== senderEmail) return first;
      for (const fallback of [domainWord, senderName].filter(f => f && f.length >= 3)) {
        const next = await run(fallback);
        if (count(next) > 0) return next;
      }
      return first;
    },
    enabled: !!token && searchQuery.length >= 2,
    retry: false,
  });

  // A 401 means the stored token has expired — drop to the login card.
  useEffect(() => {
    if (searchError instanceof Error && searchError.message === "401") handleLogout();
  }, [searchError]);

  const contacts = searchResults?.contacts || [];
  const companies = searchResults?.companies || [];
  const deals = searchResults?.deals || [];
  const bestContact = contacts.find((c: any) => senderEmail && (c.subtitle || "").toLowerCase() === senderEmail.toLowerCase()) || contacts[0] || null;
  const bestCompany = companies[0] || null;

  const logToCrm = async () => {
    if (logState === "logging") return;
    setLogState("logging");
    try {
      const r = await fetch("/api/interactions/log", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({
          contactId: bestContact?.id || null,
          companyId: bestCompany?.id || null,
          subject: emailSubject,
          preview: emailPreview,
          senderEmail,
          senderName,
          microsoftId: emailItemId || null,
          interactionDate: emailDate || null,
          direction: "inbound",
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "failed");
      setLogState(data.alreadyLogged ? "already" : "done");
      queryClient.invalidateQueries({ queryKey: ["/api/activity/brand"] });
    } catch {
      setLogState("error");
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
        <AddinHeader title="BGP Dashboard" subtitle="Outlook" />
        <OutlookLogin onLogin={handleLogin} />
      </div>
    );
  }

  const canLog = !!(senderEmail && (bestContact || bestCompany));

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
      <AddinHeader title="BGP Dashboard" subtitle="Outlook">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleLogout} title={`Sign out${userName ? ` (${userName})` : ""}`} data-testid="button-outlook-logout">
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </AddinHeader>
      <div className="p-3 space-y-3">

        {senderEmail && (
          <div className="p-2 bg-muted/40 border border-border rounded-lg space-y-1.5" data-testid="outlook-sender-card">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current email from</p>
              <p className="text-sm font-medium">{senderName || senderEmail}</p>
              {senderName && <p className="text-xs text-muted-foreground">{senderEmail}</p>}
            </div>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              variant={logState === "done" || logState === "already" ? "outline" : "default"}
              disabled={!canLog || logState === "logging" || logState === "done" || logState === "already"}
              onClick={logToCrm}
              title={canLog ? "File this email as a CRM interaction against the matched contact/company" : "No CRM match to log against yet"}
              data-testid="button-log-to-crm"
            >
              {logState === "logging" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> :
               logState === "done" ? <CheckCircle2 className="h-3 w-3 mr-1" /> :
               logState === "already" ? <CheckCircle2 className="h-3 w-3 mr-1" /> :
               <FilePlus2 className="h-3 w-3 mr-1" />}
              {logState === "done" ? "Logged to CRM" :
               logState === "already" ? "Already logged" :
               logState === "error" ? "Failed — try again" :
               `Log to CRM${bestCompany ? ` — ${bestCompany.name}` : bestContact ? ` — ${bestContact.name}` : ""}`}
            </Button>
          </div>
        )}

        {bestCompany && <SenderIntelligence companyId={bestCompany.id} companyName={bestCompany.name} token={token} />}

        <div className="relative">
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
          <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="space-y-4">
              {contacts.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Contacts <span className="font-mono tabular-nums">{contacts.length}</span>
                  </h2>
                  <div className="space-y-1.5">
                    {contacts.slice(0, 10).map((c: any) => (
                      <a key={c.id} href={`/contacts?search=${encodeURIComponent(c.name || "")}`} target="_blank" rel="noopener noreferrer" className="block" data-testid={`link-contact-${c.id}`}>
                        <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                          <CardContent className="p-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{c.name}</p>
                              {c.subtitle && <p className="text-xs text-primary truncate">{c.subtitle}</p>}
                            </div>
                            <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {c.subtitle?.includes("@") && (
                                <a href={`mailto:${c.subtitle}`} data-testid={`link-email-${c.id}`}>
                                  <Button variant="ghost" size="icon" className="h-6 w-6"><Mail className="h-3 w-3" /></Button>
                                </a>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {companies.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Companies <span className="font-mono tabular-nums">{companies.length}</span>
                  </h2>
                  <div className="space-y-1.5">
                    {companies.slice(0, 10).map((c: any) => (
                      <a key={c.id} href={`/companies/${c.id}`} target="_blank" rel="noopener noreferrer" className="block" data-testid={`link-company-${c.id}`}>
                        <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                          <CardContent className="p-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{c.name}</p>
                              {c.subtitle && <Badge variant="secondary" className="text-[10px] mt-1">{c.subtitle}</Badge>}
                            </div>
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                          </CardContent>
                        </Card>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {deals.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Deals <span className="font-mono tabular-nums">{deals.length}</span>
                  </h2>
                  <div className="space-y-1.5">
                    {deals.slice(0, 10).map((d: any) => (
                      <a key={d.id} href={`/deals?id=${d.id}`} target="_blank" rel="noopener noreferrer" className="block" data-testid={`link-deal-${d.id}`}>
                        <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                          <CardContent className="p-2.5">
                            <p className="text-sm font-medium truncate">{d.name}</p>
                            {d.subtitle && <Badge variant="outline" className="text-[10px] mt-1">{d.subtitle}</Badge>}
                          </CardContent>
                        </Card>
                      </a>
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
          href={window.location.origin}
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
