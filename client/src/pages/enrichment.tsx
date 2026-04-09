import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Users,
  Building2,
  CheckCircle2,
  Clock,
  Zap,
  Database,
  Globe,
  Mail,
  Phone,
  Linkedin,
  ArrowRight,
  Timer,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface EnrichmentStats {
  contacts: {
    total: number;
    enriched: number;
    never_enriched: number;
    stale: number;
    fresh: number;
    missing_email: number;
    missing_role: number;
    missing_phone: number;
    missing_linkedin: number;
  };
  companies: {
    total: number;
    enriched: number;
    never_enriched: number;
    stale: number;
    fresh: number;
    missing_domain: number;
    missing_description: number;
    missing_industry: number;
    missing_phone: number;
  };
  staleContacts: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    company_name: string;
    last_enriched_at: string | null;
    enrichment_source: string | null;
  }>;
  staleCompanies: Array<{
    id: string;
    name: string;
    domain: string;
    industry: string;
    last_enriched_at: string | null;
    enrichment_source: string | null;
  }>;
}


function FreshnessBar({ fresh, stale, never, total }: { fresh: number; stale: number; never: number; total: number }) {
  if (total === 0) return null;
  const freshPct = (fresh / total) * 100;
  const stalePct = (stale / total) * 100;
  const neverPct = (never / total) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 rounded-full overflow-hidden bg-muted" data-testid="freshness-bar">
        <div className="bg-emerald-500 transition-all" style={{ width: `${freshPct}%` }} title={`Fresh: ${fresh}`} />
        <div className="bg-amber-500 transition-all" style={{ width: `${stalePct}%` }} title={`Stale: ${stale}`} />
        <div className="bg-red-400 transition-all" style={{ width: `${neverPct}%` }} title={`Never enriched: ${never}`} />
      </div>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Fresh ({fresh})</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Stale ({stale})</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Never ({never})</span>
      </div>
    </div>
  );
}

export default function EnrichmentHub() {
  const [activeTab, setActiveTab] = useState("overview");

  const { data: stats, isLoading } = useQuery<EnrichmentStats>({
    queryKey: ["/api/enrichment/stats"],
  });

  const { data: autoStatus } = useQuery<{
    enabled: boolean;
    intervalHours: number;
    batchSize: number;
    lastRun: string | null;
    lastResult: Record<string, any> | null;
    nextRun: string | null;
  }>({
    queryKey: ["/api/enrichment/auto-status"],
    refetchInterval: 30000,
  });

  const c = stats?.contacts;
  const co = stats?.companies;

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Enrichment Hub</h1>
          <p className="text-sm text-muted-foreground">Data freshness and enrichment management</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="enrichment-hub-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Enrichment Hub</h1>
          <p className="text-sm text-muted-foreground">Manage data freshness across your CRM</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/enrichment/stats"] })}
          data-testid="button-refresh-stats"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          Refresh
        </Button>
      </div>


      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="enrichment-tabs">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts">Contacts</TabsTrigger>
          <TabsTrigger value="companies" data-testid="tab-companies">Companies</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card data-testid="card-contacts-overview">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-violet-500" />
                    Contacts ({c?.total || 0})
                  </CardTitle>
                  <Badge variant={c && c.stale + c.never_enriched > c.fresh ? "destructive" : "secondary"} className="text-[10px]">
                    {c ? Math.round((c.fresh / Math.max(c.total, 1)) * 100) : 0}% fresh
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FreshnessBar
                  fresh={c?.fresh || 0}
                  stale={c?.stale || 0}
                  never={c?.never_enriched || 0}
                  total={c?.total || 0}
                />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Mail className="w-3 h-3" /> Missing email: <span className="font-medium text-foreground">{c?.missing_email || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Sparkles className="w-3 h-3" /> Missing role: <span className="font-medium text-foreground">{c?.missing_role || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Phone className="w-3 h-3" /> Missing phone: <span className="font-medium text-foreground">{c?.missing_phone || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Linkedin className="w-3 h-3" /> Missing LinkedIn: <span className="font-medium text-foreground">{c?.missing_linkedin || 0}</span>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  <Zap className="w-3 h-3 mr-1" />
                  Auto-enriched every 6 hours
                </Badge>
              </CardContent>
            </Card>

            <Card data-testid="card-companies-overview">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-500" />
                    Companies ({co?.total || 0})
                  </CardTitle>
                  <Badge variant={co && co.stale + co.never_enriched > co.fresh ? "destructive" : "secondary"} className="text-[10px]">
                    {co ? Math.round((co.fresh / Math.max(co.total, 1)) * 100) : 0}% fresh
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FreshnessBar
                  fresh={co?.fresh || 0}
                  stale={co?.stale || 0}
                  never={co?.never_enriched || 0}
                  total={co?.total || 0}
                />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Globe className="w-3 h-3" /> Missing domain: <span className="font-medium text-foreground">{co?.missing_domain || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Database className="w-3 h-3" /> Missing info: <span className="font-medium text-foreground">{co?.missing_description || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Building2 className="w-3 h-3" /> Missing industry: <span className="font-medium text-foreground">{co?.missing_industry || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Phone className="w-3 h-3" /> Missing phone: <span className="font-medium text-foreground">{co?.missing_phone || 0}</span>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  <Zap className="w-3 h-3 mr-1" />
                  Auto-enriched every 6 hours
                </Badge>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-auto-enrichment" className={autoStatus?.enabled ? "border-emerald-200 dark:border-emerald-800" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Timer className="w-4 h-4 text-blue-500" />
                  Automatic Enrichment
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  <Zap className="w-3 h-3 mr-1" />
                  Automatic
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-sm">
                <div className="flex-1 space-y-1">
                  <p className="text-muted-foreground">
                    {autoStatus?.enabled
                      ? `Runs every ${autoStatus.intervalHours} hours, processing ${autoStatus.batchSize} records per entity type per cycle.`
                      : "When enabled, automatically enriches stale and un-enriched records in small batches every 6 hours using Apollo and AI."}
                  </p>
                  {autoStatus?.lastRun && (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Last run: {new Date(autoStatus.lastRun).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                      {autoStatus.nextRun && (
                        <span className="flex items-center gap-1">
                          <ArrowRight className="w-3 h-3" />
                          Next: {new Date(autoStatus.nextRun).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      )}
                    </div>
                  )}
                  {autoStatus?.lastResult && !autoStatus.lastResult.error && (
                    <div className="flex flex-wrap gap-3 text-xs mt-1">
                      {autoStatus.lastResult.apollo && (
                        <Badge variant="outline" className="text-[10px]">
                          <Zap className="w-2.5 h-2.5 mr-0.5" />
                          Apollo: {autoStatus.lastResult.apollo.enriched}/{autoStatus.lastResult.apollo.processed}
                        </Badge>
                      )}
                      {autoStatus.lastResult.aiCompanies && (
                        <Badge variant="outline" className="text-[10px]">
                          <Building2 className="w-2.5 h-2.5 mr-0.5" />
                          Companies: {autoStatus.lastResult.aiCompanies.enriched}/{autoStatus.lastResult.aiCompanies.processed}
                        </Badge>
                      )}
                      {autoStatus.lastResult.aiContacts && (
                        <Badge variant="outline" className="text-[10px]">
                          <Users className="w-2.5 h-2.5 mr-0.5" />
                          Roles: {autoStatus.lastResult.aiContacts.enriched}/{autoStatus.lastResult.aiContacts.processed}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-auto-info">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-500" />
                Fully Automated
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                All enrichment runs automatically every 6 hours — Apollo contact lookups, AI company info, and AI contact roles are all handled in the background. Ask ChatBGP if you need to enrich specific records on demand.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Stale & Un-enriched Contacts</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  <Zap className="w-3 h-3 mr-1" />
                  Auto-enriched
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Last Enriched</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="w-[80px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats?.staleContacts?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                          All contacts are up to date!
                        </TableCell>
                      </TableRow>
                    )}
                    {stats?.staleContacts?.map(contact => (
                      <TableRow key={contact.id} data-testid={`row-stale-contact-${contact.id}`}>
                        <TableCell>
                          <Link href={`/contacts/${contact.id}`}>
                            <span className="text-blue-600 hover:underline cursor-pointer font-medium text-sm" data-testid={`link-contact-${contact.id}`}>{contact.name}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{contact.company_name || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{contact.email || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{contact.role || "—"}</TableCell>
                        <TableCell>
                          {contact.last_enriched_at ? (
                            <Badge variant="outline" className="text-[10px] border-amber-300">
                              <Clock className="w-2.5 h-2.5 mr-0.5" />
                              {new Date(contact.last_enriched_at).toLocaleDateString("en-GB")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">Never</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{contact.enrichment_source || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">Pending</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="companies" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Stale & Un-enriched Companies</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  <Zap className="w-3 h-3 mr-1" />
                  Auto-enriched
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Domain</TableHead>
                      <TableHead>Industry</TableHead>
                      <TableHead>Last Enriched</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats?.staleCompanies?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                          All companies are up to date!
                        </TableCell>
                      </TableRow>
                    )}
                    {stats?.staleCompanies?.map(company => (
                      <TableRow key={company.id} data-testid={`row-stale-company-${company.id}`}>
                        <TableCell>
                          <Link href={`/companies/${company.id}`}>
                            <span className="text-blue-600 hover:underline cursor-pointer font-medium text-sm" data-testid={`link-company-${company.id}`}>{company.name}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{company.domain || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{company.industry || "—"}</TableCell>
                        <TableCell>
                          {company.last_enriched_at ? (
                            <Badge variant="outline" className="text-[10px] border-amber-300">
                              <Clock className="w-2.5 h-2.5 mr-0.5" />
                              {new Date(company.last_enriched_at).toLocaleDateString("en-GB")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">Never</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{company.enrichment_source || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
