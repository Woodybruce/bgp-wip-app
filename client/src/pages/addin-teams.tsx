import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LayoutDashboard, Briefcase, Building2, TrendingUp,
  FileText, ExternalLink, Users, BarChart3
} from "lucide-react";
import { AddinHeader } from "@/components/addin-header";

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AddinTeams() {
  const { data: stats, isLoading: loadingStats } = useQuery<any>({
    queryKey: ["/api/stats"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: deals, isLoading: loadingDeals } = useQuery<any[]>({
    queryKey: ["/api/crm/deals"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: news, isLoading: loadingNews } = useQuery<any[]>({
    queryKey: ["/api/news"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const activeDeals = deals?.filter((d: any) => d.status && !["Lost", "Dead", "Completed", "Exchanged"].includes(d.status)) || [];
  const recentDeals = activeDeals.slice(0, 15);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AddinHeader title="BGP Dashboard" subtitle="Teams">
        <a
          href="https://bgp-wip-app-production.up.railway.app"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="link-open-dashboard"
        >
          <Button variant="outline" size="sm" className="h-6 text-[10px]">
            Full Dashboard <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </a>
      </AddinHeader>
      <div className="p-4">

      <Tabs defaultValue="overview">
        <TabsList className="w-full h-8">
          <TabsTrigger value="overview" className="text-xs flex-1" data-testid="tab-overview">
            <LayoutDashboard className="h-3 w-3 mr-1" /> Overview
          </TabsTrigger>
          <TabsTrigger value="deals" className="text-xs flex-1" data-testid="tab-deals">
            <Briefcase className="h-3 w-3 mr-1" /> Deals
          </TabsTrigger>
          <TabsTrigger value="news" className="text-xs flex-1" data-testid="tab-news">
            <FileText className="h-3 w-3 mr-1" /> News
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3">
          {loadingStats ? (
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Active Deals"
                value={stats?.activeDeals || activeDeals.length || 0}
                icon={Briefcase}
              />
              <StatCard
                label="Properties"
                value={stats?.properties || 0}
                icon={Building2}
              />
              <StatCard
                label="Contacts"
                value={stats?.contacts || 0}
                icon={Users}
              />
              <StatCard
                label="Companies"
                value={stats?.companies || 0}
                icon={Building2}
              />
            </div>
          )}

          <div className="mt-4">
            <h2 className="text-sm font-semibold mb-2">Quick Links</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "WIP Report", path: "/wip-report", icon: BarChart3 },
                { label: "Investment Tracker", path: "/investment-tracker", icon: TrendingUp },
                { label: "ChatBGP", path: "/chatbgp", icon: Building2 },
                { label: "SharePoint", path: "/sharepoint", icon: FileText },
              ].map((link) => (
                <a
                  key={link.path}
                  href={`https://bgp-wip-app-production.up.railway.app${link.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`link-${link.label.toLowerCase().replace(/\s/g, "-")}`}
                >
                  <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                    <CardContent className="p-2.5 flex items-center gap-2">
                      <link.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">{link.label}</span>
                    </CardContent>
                  </Card>
                </a>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="deals" className="mt-3">
          <ScrollArea className="h-[calc(100vh-140px)]">
            {loadingDeals ? (
              <div className="space-y-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : recentDeals.length > 0 ? (
              <div className="space-y-1.5">
                {recentDeals.map((d: any) => (
                  <Card key={d.id} data-testid={`card-deal-${d.id}`}>
                    <CardContent className="p-2.5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{d.name || d.property}</p>
                          {d.tenant && <p className="text-xs text-muted-foreground truncate">{d.tenant}</p>}
                        </div>
                        <div className="flex gap-1 shrink-0 ml-1">
                          {d.status && <Badge variant="outline" className="text-[10px]">{d.status}</Badge>}
                          {d.team && <Badge variant="secondary" className="text-[10px]">{d.team}</Badge>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Briefcase className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No active deals</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="news" className="mt-3">
          <ScrollArea className="h-[calc(100vh-140px)]">
            {loadingNews ? (
              <div className="space-y-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : news && news.length > 0 ? (
              <div className="space-y-1.5">
                {news.slice(0, 20).map((n: any) => (
                  <a
                    key={n.id}
                    href={n.url || n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`link-news-${n.id}`}
                  >
                    <Card className="hover:bg-muted/50 transition-colors cursor-pointer mb-1.5">
                      <CardContent className="p-2.5">
                        <p className="text-sm font-medium line-clamp-2">{n.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {n.source && <span className="text-[10px] text-muted-foreground">{n.source}</span>}
                          {n.publishedAt && (
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(n.publishedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No news articles</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}

export default AddinTeams;
