import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ExternalLink,
  Newspaper,
  Search,
  RefreshCw,
  Bookmark,
  BookmarkCheck,
  X,
  Brain,
  TrendingUp,
  Clock,
  Loader2,
  Zap,
  Rss,
  BarChart3,
  Filter,
  ChevronDown,
  ChevronUp,
  Mail,
  Send,
  CheckCircle,
  ArrowRight,
  Copy,
  MessageCircle,
  Phone,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { useState, useMemo } from "react";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { NewsArticle, EmailIngest, NewsLead } from "@shared/schema";

const TEAMS = [
  "For You",
  "All",
  "Investment",
  "London Leasing",
  "Lease Advisory",
  "National Leasing",
  "Tenant Rep",
  "Development",
  "Landsec",
  "Saved",
];

const CATEGORIES = ["All", "Property", "Retail", "Investment", "Hospitality", "Planning"];

function timeAgo(date: string | Date | null): string {
  if (!date) return "";
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDate(d: string | Date | null) {
  if (!d) return "";
  const date = new Date(d);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RelevanceBar({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-green-500"
      : score >= 40
        ? "bg-amber-500"
        : "bg-gray-300 dark:bg-gray-600";
  const label = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  return (
    <div className="flex items-center gap-1.5" data-testid="relevance-bar" title={`${label} relevance (${score}/100)`}>
      <div className="w-14 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
        {score}
      </span>
    </div>
  );
}

function SourceStats({ articles }: { articles: NewsArticle[] }) {
  const stats = useMemo(() => {
    const sourceMap: Record<string, number> = {};
    for (const a of articles) {
      const src = a.sourceName || "Unknown";
      sourceMap[src] = (sourceMap[src] || 0) + 1;
    }
    return Object.entries(sourceMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);
  }, [articles]);

  if (stats.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {stats.map(([source, count]) => (
        <div
          key={source}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid={`stat-source-${source.toLowerCase().replace(/\s/g, "-")}`}
        >
          <Rss className="w-3 h-3" />
          <span className="font-medium text-foreground">{count}</span>
          <span>{source}</span>
        </div>
      ))}
    </div>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case "new":
      return <Badge variant="default" data-testid="badge-status-new">New</Badge>;
    case "processed":
      return <Badge variant="secondary" data-testid="badge-status-processed">Processed</Badge>;
    case "failed":
      return <Badge variant="destructive" data-testid="badge-status-failed">Failed</Badge>;
    case "draft":
      return <Badge variant="outline" data-testid="badge-status-draft">Draft</Badge>;
    case "pushed":
      return <Badge className="bg-green-600 text-white" data-testid="badge-status-pushed">Processed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function confidenceBadge(confidence: string | null) {
  switch (confidence) {
    case "high":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">High</Badge>;
    case "medium":
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Medium</Badge>;
    case "low":
      return <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Low</Badge>;
    default:
      return null;
  }
}

function sourceBadge(source: string | null) {
  if (!source) return null;
  if (source.startsWith("WhatsApp:")) {
    return (
      <Badge variant="outline" className="bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700">
        <MessageCircle className="w-3 h-3 mr-1" />
        WhatsApp
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700">
      <Mail className="w-3 h-3 mr-1" />
      Email
    </Badge>
  );
}

function FeedTab() {
  const [activeTeam, setActiveTeam] = useState("For You");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showStats, setShowStats] = useState(false);
  const [savedArticles, setSavedArticles] = useState<Set<string>>(new Set());
  const [dismissedArticles, setDismissedArticles] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: currentUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const userTeam = currentUser?.team || "Investment";
  const isSavedTab = activeTeam === "Saved";
  const effectiveTeam = activeTeam === "For You" ? userTeam : activeTeam;

  const { data: articles, isLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news-feed/articles", effectiveTeam, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveTeam && effectiveTeam !== "All" && effectiveTeam !== "Saved") params.set("team", effectiveTeam);
      if (search) params.set("search", search);
      params.set("limit", "100");
      const res = await fetch(`/api/news-feed/articles?${params}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch articles");
      return res.json();
    },
    enabled: !isSavedTab,
  });

  const { data: savedArticlesList, isLoading: isSavedLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news-feed/saved"],
    enabled: isSavedTab,
  });

  const { data: sources } = useQuery<any[]>({
    queryKey: ["/api/news-feed/sources"],
  });

  const fetchMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/news-feed/fetch"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "News Updated", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/news-feed/articles"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to fetch news",
        variant: "destructive",
      });
    },
  });

  const engageMutation = useMutation({
    mutationFn: (data: { articleId: string; action: string }) =>
      apiRequest("POST", "/api/news-feed/engage", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-feed/articles"] });
    },
  });

  const unsaveMutation = useMutation({
    mutationFn: (data: { articleId: string }) =>
      apiRequest("POST", "/api/news-feed/unsave", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-feed/saved"] });
    },
  });

  const handleRead = (article: NewsArticle) => {
    engageMutation.mutate({ articleId: article.id, action: "click" });
    window.open(article.url, "_blank");
  };

  const handleSave = (article: NewsArticle) => {
    engageMutation.mutate({ articleId: article.id, action: "save" });
    setSavedArticles((prev) => new Set(prev).add(article.id));
    toast({ title: "Saved", description: "Article bookmarked" });
  };

  const handleUnsave = (article: NewsArticle) => {
    unsaveMutation.mutate({ articleId: article.id });
    setSavedArticles((prev) => {
      const next = new Set(prev);
      next.delete(article.id);
      return next;
    });
    toast({ title: "Removed", description: "Article removed from saved" });
  };

  const handleDismiss = (article: NewsArticle) => {
    engageMutation.mutate({ articleId: article.id, action: "dismiss" });
    setDismissedArticles((prev) => new Set(prev).add(article.id));
    toast({ title: "Dismissed", description: "We'll show less like this" });
  };

  const getRelevanceScore = (article: NewsArticle): number => {
    if (!article.aiRelevanceScores || effectiveTeam === "All") return 0;
    return (article.aiRelevanceScores as any)[effectiveTeam] || 0;
  };

  const filteredArticles = useMemo(() => {
    if (!articles) return [];
    return articles.filter((a) => {
      if (dismissedArticles.has(a.id)) return false;
      if (categoryFilter !== "All") {
        const articleCat = (a.category || "").toLowerCase();
        if (!articleCat.includes(categoryFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [articles, categoryFilter, dismissedArticles]);

  const totalArticles = articles?.length || 0;
  const scoredArticles = articles?.filter((a) => a.processed)?.length || 0;
  const activeSources = sources?.filter((s: any) => s.active)?.length || 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          AI-curated property intelligence from {activeSources} sources
          {activeTeam !== "All" && (
            <span>
              {" "}· Sorted for{" "}
              <span className="font-medium text-foreground">
                {activeTeam === "For You" ? userTeam : activeTeam}
              </span>
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowStats(!showStats)}
            className="text-xs"
            data-testid="button-toggle-stats"
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1" />
            {showStats ? "Hide" : "Stats"}
            {showStats ? (
              <ChevronUp className="w-3 h-3 ml-1" />
            ) : (
              <ChevronDown className="w-3 h-3 ml-1" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchMutation.mutate()}
            disabled={fetchMutation.isPending}
            data-testid="button-refresh-news"
          >
            {fetchMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            {fetchMutation.isPending ? "Fetching..." : "Refresh"}
          </Button>
        </div>
      </div>

      {showStats && articles && articles.length > 0 && (
        <Card data-testid="card-stats">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-6 text-xs">
              <div className="flex items-center gap-1.5">
                <Newspaper className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-semibold">{totalArticles}</span>
                <span className="text-muted-foreground">articles</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-semibold">{scoredArticles}</span>
                <span className="text-muted-foreground">AI-scored</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Rss className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-semibold">{activeSources}</span>
                <span className="text-muted-foreground">active sources</span>
              </div>
            </div>
            <SourceStats articles={articles} />
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTeam} onValueChange={setActiveTeam}>
        <TabsList
          className="flex overflow-x-auto h-auto gap-1 bg-transparent p-0"
          data-testid="tabs-team-filter"
        >
          {TEAMS.map((team) => (
            <TabsTrigger
              key={team}
              value={team}
              className="data-[state=active]:bg-black data-[state=active]:text-white dark:data-[state=active]:bg-white dark:data-[state=active]:text-black text-xs px-3 py-1.5 rounded-full border shrink-0"
              data-testid={`tab-team-${team.toLowerCase().replace(/\s/g, "-")}`}
            >
              {team === "For You" && <Zap className="w-3 h-3 mr-1" />}
              {team === "Saved" && <Bookmark className="w-3 h-3 mr-1" />}
              {team}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search articles by title, source, or keyword..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-news"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[140px]" data-testid="select-category">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat === "All" ? "All Categories" : cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isSavedTab ? (
        isSavedLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex gap-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : savedArticlesList && savedArticlesList.length > 0 ? (
          <div className="space-y-3">
            {savedArticlesList.map((article) => (
              <Card
                key={article.id}
                className="group hover:shadow-md transition-all cursor-pointer border-l-2 border-l-transparent hover:border-l-black dark:hover:border-l-white"
                data-testid={`saved-card-${article.id}`}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {article.sourceName && (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-medium"
                            data-testid={`badge-source-${article.id}`}
                          >
                            {article.sourceName}
                          </Badge>
                        )}
                        {article.category &&
                          article.category !== "general" && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] capitalize"
                            >
                              {article.category}
                            </Badge>
                          )}
                        {article.aiTags?.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] text-muted-foreground capitalize"
                          >
                            #{tag}
                          </span>
                        ))}
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 ml-auto">
                          <Clock className="w-3 h-3" />
                          {timeAgo(article.publishedAt)}
                        </span>
                      </div>

                      <h3
                        className="text-sm font-semibold leading-snug group-hover:underline"
                        onClick={() => handleRead(article)}
                        data-testid={`title-${article.id}`}
                      >
                        {article.title}
                      </h3>

                      {(article.aiSummary || article.summary) && (
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                          {article.aiSummary ? (
                            <>
                              <Brain className="w-3 h-3 inline mr-1 text-muted-foreground/50" />
                              {article.aiSummary}
                            </>
                          ) : (
                            article.summary
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => handleRead(article)}
                      data-testid={`button-read-${article.id}`}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Read
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 text-destructive"
                      onClick={() => handleUnsave(article)}
                      data-testid={`button-unsave-${article.id}`}
                    >
                      <BookmarkCheck className="w-3 h-3 mr-1" />
                      Unsave
                    </Button>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => {
                        engageMutation.mutate({
                          articleId: article.id,
                          action: "push_intel",
                        });
                        toast({
                          title: "Extracting Leads",
                          description: "Article sent for AI lead extraction",
                        });
                      }}
                      data-testid={`button-extract-leads-${article.id}`}
                    >
                      <Zap className="w-3 h-3 mr-1" />
                      Extract Leads
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <p className="text-center text-xs text-muted-foreground pt-2 pb-4">
              {savedArticlesList.length} saved article{savedArticlesList.length !== 1 ? "s" : ""}
            </p>
          </div>
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            <Bookmark className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium" data-testid="text-no-saved">No saved articles</p>
            <p className="text-xs mt-1">
              Save articles from the news feed to read later
            </p>
          </div>
        )
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <div className="flex gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredArticles.length > 0 ? (
        <div className="space-y-3">
          {filteredArticles.map((article) => {
            const score = getRelevanceScore(article);
            const isSaved = savedArticles.has(article.id);
            return (
              <Card
                key={article.id}
                className="group hover:shadow-md transition-all cursor-pointer border-l-2 border-l-transparent hover:border-l-black dark:hover:border-l-white"
                data-testid={`news-card-${article.id}`}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {article.sourceName && (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-medium"
                            data-testid={`badge-source-${article.id}`}
                          >
                            {article.sourceName}
                          </Badge>
                        )}
                        {article.category &&
                          article.category !== "general" && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] capitalize"
                            >
                              {article.category}
                            </Badge>
                          )}
                        {article.aiTags?.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] text-muted-foreground capitalize"
                          >
                            #{tag}
                          </span>
                        ))}
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 ml-auto">
                          <Clock className="w-3 h-3" />
                          {timeAgo(article.publishedAt)}
                        </span>
                      </div>

                      <h3
                        className="text-sm font-semibold leading-snug group-hover:underline"
                        onClick={() => handleRead(article)}
                        data-testid={`title-${article.id}`}
                      >
                        {article.title}
                      </h3>

                      {(article.aiSummary || article.summary) && (
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                          {article.aiSummary ? (
                            <>
                              <Brain className="w-3 h-3 inline mr-1 text-muted-foreground/50" />
                              {article.aiSummary}
                            </>
                          ) : (
                            article.summary
                          )}
                        </p>
                      )}
                    </div>

                    {score > 0 && effectiveTeam !== "All" && (
                      <div className="flex-shrink-0 pt-5">
                        <RelevanceBar score={score} />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => handleRead(article)}
                      data-testid={`button-read-${article.id}`}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Read
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-7 text-xs px-2 ${isSaved ? "text-black dark:text-white" : ""}`}
                      onClick={() => handleSave(article)}
                      data-testid={`button-save-${article.id}`}
                    >
                      {isSaved ? (
                        <BookmarkCheck className="w-3 h-3 mr-1" />
                      ) : (
                        <Bookmark className="w-3 h-3 mr-1" />
                      )}
                      {isSaved ? "Saved" : "Save"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 text-muted-foreground"
                      onClick={() => handleDismiss(article)}
                      data-testid={`button-dismiss-${article.id}`}
                    >
                      <X className="w-3 h-3 mr-1" />
                      Less like this
                    </Button>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => {
                        engageMutation.mutate({
                          articleId: article.id,
                          action: "push_intel",
                        });
                        toast({
                          title: "Extracting Leads",
                          description: "Article sent for AI lead extraction",
                        });
                      }}
                      data-testid={`button-extract-leads-${article.id}`}
                    >
                      <Zap className="w-3 h-3 mr-1" />
                      Extract Leads
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {filteredArticles.length > 0 && (
            <p className="text-center text-xs text-muted-foreground pt-2 pb-4">
              Showing {filteredArticles.length} article{filteredArticles.length !== 1 ? "s" : ""}
              {categoryFilter !== "All" && ` in ${categoryFilter}`}
              {effectiveTeam !== "All" && ` · Ranked for ${effectiveTeam}`}
            </p>
          )}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No articles yet</p>
          <p className="text-xs mt-1">
            Click Refresh to fetch the latest news from {activeSources} sources
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => fetchMutation.mutate()}
            disabled={fetchMutation.isPending}
            data-testid="button-refresh-empty"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Fetch News
          </Button>
        </div>
      )}
    </div>
  );
}

function LeadsTab() {
  const { toast } = useToast();

  const { data: leads, isLoading: leadsLoading } = useQuery<NewsLead[]>({
    queryKey: ["/api/news-intel/leads"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const pushMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await apiRequest("POST", `/api/news-intel/leads/${leadId}/push`, {});
      return res.json();
    },
    onSuccess: (data: { message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-intel/leads"] });
      toast({ title: "Processed", description: data.message });
    },
    onError: (err: any) => {
      let msg = "Failed to process lead";
      try {
        const raw = err?.message || "";
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) {
          const parsed = JSON.parse(raw.slice(jsonStart));
          if (parsed.message) msg = parsed.message;
        }
      } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  if (leadsLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const leadsList = leads || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {leadsList.length} lead{leadsList.length !== 1 ? "s" : ""} generated from news, emails and WhatsApp
        </p>
      </div>

      {leadsList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Zap className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No leads yet</h3>
            <p className="text-muted-foreground max-w-sm">
              Leads are automatically extracted from news articles, emails and WhatsApp messages using AI.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {leadsList.map((lead) => (
            <Card key={lead.id} data-testid={`lead-card-${lead.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {statusBadge(lead.status)}
                      {confidenceBadge(lead.confidence)}
                      {sourceBadge(lead.source)}
                      {lead.area && (
                        <Badge variant="outline">{lead.area}</Badge>
                      )}
                      {lead.propertyType && (
                        <Badge variant="outline">{lead.propertyType}</Badge>
                      )}
                      {lead.opportunityType && (
                        <Badge variant="outline">{lead.opportunityType}</Badge>
                      )}
                    </div>
                    <h4 className="font-medium text-sm mt-1" data-testid="text-lead-title">
                      {lead.title}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {lead.summary}
                    </p>
                    {lead.suggestedAction && (
                      <p className="text-xs mt-2 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-primary" />
                        <span className="text-primary font-medium">{lead.suggestedAction}</span>
                      </p>
                    )}
                    {lead.source && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Source: {lead.source}
                      </p>
                    )}
                    {lead.mondayItemId && (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        Lead #{lead.mondayItemId}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {lead.status === "draft" && (
                      <Button
                        size="sm"
                        onClick={() => pushMutation.mutate(lead.id)}
                        disabled={pushMutation.isPending}
                        data-testid={`button-push-${lead.id}`}
                      >
                        <Send className="w-4 h-4 mr-1" />
                        Process Lead
                      </Button>
                    )}
                    {lead.status === "pushed" && (
                      <div className="flex items-center gap-1 text-green-600">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-xs">Processed</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function InboxTab({ connected }: { connected: boolean }) {
  const { toast } = useToast();

  const { data: inboxData, isLoading: inboxLoading } = useQuery<{
    emails: EmailIngest[];
    newCount: number;
  }>({
    queryKey: ["/api/news-intel/inbox"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: connected,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/news-intel/inbox");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-intel/inbox"] });
      toast({ title: "Inbox refreshed" });
    },
  });

  const processMutation = useMutation({
    mutationFn: async (emailId: string) => {
      const res = await apiRequest("POST", `/api/news-intel/process/${emailId}`);
      return res.json();
    },
    onSuccess: (data: { message: string; pushed?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-intel/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/news-intel/leads"] });
      toast({ title: "Processed", description: data.message });
    },
    onError: (err: any) => {
      let msg = "Failed to process email";
      try {
        const raw = err?.message || "";
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) {
          const parsed = JSON.parse(raw.slice(jsonStart));
          if (parsed.message) msg = parsed.message;
        }
      } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  if (!connected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Shared Mailbox Not Connected</h3>
          <p className="text-muted-foreground max-w-sm">
            The shared mailbox (chatbgp@brucegillinghampollard.com) is not connected. Azure AD application permissions may need to be configured.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (inboxLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const emails = inboxData?.emails || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {emails.length} email{emails.length !== 1 ? "s" : ""} in shared inbox
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-refresh-inbox"
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {emails.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Mail className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No emails yet</h3>
            <p className="text-muted-foreground max-w-sm">
              Forward property news to the shared inbox. Emails will be automatically analysed for leads.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {emails.map((email) => (
            <Card key={email.id} data-testid={`email-card-${email.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {statusBadge(email.status)}
                      <span className="text-xs text-muted-foreground">
                        {formatDate(email.receivedAt)}
                      </span>
                    </div>
                    <h4 className="font-medium text-sm truncate" data-testid="text-email-subject">
                      {email.subject || "(no subject)"}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      From: {email.fromAddress}
                    </p>
                    {email.bodyPreview && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {email.bodyPreview}
                      </p>
                    )}
                  </div>
                  {email.status === "new" && (
                    <Button
                      size="sm"
                      onClick={() => processMutation.mutate(email.id)}
                      disabled={processMutation.isPending}
                      data-testid={`button-process-${email.id}`}
                    >
                      <Brain className="w-4 h-4 mr-1" />
                      Analyse
                    </Button>
                  )}
                  {email.status === "processed" && (
                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-1" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function WhatsAppTab() {
  const { toast } = useToast();

  const { data: conversations, isLoading } = useQuery<any[]>({
    queryKey: ["/api/whatsapp/conversations"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const processMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await apiRequest("POST", `/api/news-intel/process-whatsapp/${conversationId}`);
      return res.json();
    },
    onSuccess: (data: { message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-intel/leads"] });
      toast({ title: "Processed", description: data.message });
    },
    onError: (err: any) => {
      let msg = "Failed to process WhatsApp messages";
      try {
        const raw = err?.message || "";
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) {
          const parsed = JSON.parse(raw.slice(jsonStart));
          if (parsed.message) msg = parsed.message;
        }
      } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const convos = conversations || [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {convos.length} WhatsApp conversation{convos.length !== 1 ? "s" : ""} available for lead extraction
      </p>

      {convos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <MessageCircle className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No WhatsApp conversations</h3>
            <p className="text-muted-foreground max-w-sm">
              When messages come in via WhatsApp, they'll be automatically analysed for property leads.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {convos.map((convo: any) => (
            <Card key={convo.id} data-testid={`wa-convo-card-${convo.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <MessageCircle className="w-4 h-4 text-green-500" />
                      <span className="font-medium text-sm">
                        {convo.contactName || convo.waPhoneNumber}
                      </span>
                      {convo.unreadCount > 0 && (
                        <Badge variant="default" className="text-xs">{convo.unreadCount} new</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {convo.waPhoneNumber}
                    </p>
                    {convo.lastMessagePreview && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {convo.lastMessagePreview}
                      </p>
                    )}
                    {convo.lastMessageAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Last message: {formatDate(convo.lastMessageAt)}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => processMutation.mutate(convo.id)}
                    disabled={processMutation.isPending}
                    data-testid={`button-process-wa-${convo.id}`}
                  >
                    <Brain className="w-4 h-4 mr-1" />
                    Extract Leads
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function News() {
  const { data: intelStatus } = useQuery<{
    connected: boolean;
    emailAddress?: string;
  }>({
    queryKey: ["/api/news-intel/status"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5" data-testid="news-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Newspaper className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
              News
            </h1>
            <p className="text-sm text-muted-foreground">
              AI-powered property news, intelligence and lead generation
            </p>
          </div>
        </div>
        {intelStatus?.emailAddress && (
          <div className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-md">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-mono" data-testid="text-inbox-address">{intelStatus.emailAddress}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                navigator.clipboard.writeText(intelStatus.emailAddress || "");
              }}
              data-testid="button-copy-email"
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="feed">
        <TabsList className="mb-4" data-testid="tabs-news-main">
          <TabsTrigger value="feed" data-testid="tab-feed">
            <Newspaper className="w-4 h-4 mr-1" />
            Feed
          </TabsTrigger>
          <TabsTrigger value="leads" data-testid="tab-leads">
            <Zap className="w-4 h-4 mr-1" />
            Leads
          </TabsTrigger>
          <TabsTrigger value="inbox" data-testid="tab-inbox">
            <Mail className="w-4 h-4 mr-1" />
            Inbox
          </TabsTrigger>
          <TabsTrigger value="whatsapp" data-testid="tab-whatsapp">
            <MessageCircle className="w-4 h-4 mr-1" />
            WhatsApp
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feed">
          <FeedTab />
        </TabsContent>

        <TabsContent value="leads">
          <LeadsTab />
        </TabsContent>

        <TabsContent value="inbox">
          <InboxTab connected={intelStatus?.connected ?? false} />
        </TabsContent>

        <TabsContent value="whatsapp">
          <WhatsAppTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
