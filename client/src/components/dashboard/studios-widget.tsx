import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileSpreadsheet,
  FileText,
  ArrowRight,
  TrendingUp,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertCircle,
  Pencil,
  Layers,
} from "lucide-react";

interface ExcelTemplate {
  id: string;
  name: string;
  description: string | null;
  originalFileName: string;
  createdAt: string | null;
}

interface ExcelModelRun {
  id: string;
  templateId: string;
  name: string;
  status: string;
  propertyId: string | null;
  sharepointUrl: string | null;
  createdAt: string | null;
}

interface DocumentTemplate {
  id: string;
  name: string;
  description: string | null;
  status: string;
  sourceFileName: string;
  createdAt: string | null;
}

interface DocumentRun {
  id: string;
  name: string;
  document_type: string | null;
  status: string;
  created_at: string;
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function statusIcon(status: string) {
  switch (status) {
    case "completed":
    case "approved":
      return <CheckCircle2 className="w-3 h-3 text-green-500" />;
    case "draft":
      return <Pencil className="w-3 h-3 text-amber-500" />;
    case "error":
    case "failed":
      return <AlertCircle className="w-3 h-3 text-red-500" />;
    default:
      return <Clock className="w-3 h-3 text-muted-foreground" />;
  }
}

function ModelTab() {
  const { data: templates, isLoading: tLoading } = useQuery<ExcelTemplate[]>({
    queryKey: ["/api/models/templates"],
  });

  const { data: runs, isLoading: rLoading } = useQuery<ExcelModelRun[]>({
    queryKey: ["/api/models/runs"],
  });

  const isLoading = tLoading || rLoading;
  const recentRuns = (runs || []).slice(0, 5);
  const templateMap = new Map((templates || []).map(t => [t.id, t.name]));

  return (
    <ScrollArea className="h-full">
      {isLoading ? (
        <div className="px-4 space-y-2 pb-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Templates</p>
              <Badge variant="outline" className="text-[10px] px-1.5 h-4">{templates?.length || 0}</Badge>
            </div>
            {(templates || []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No templates yet</p>
            ) : (
              <div className="space-y-0.5">
                {(templates || []).slice(0, 5).map(t => (
                  <Link key={t.id} href="/models">
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer transition-colors" data-testid={`model-template-${t.id}`}>
                      <FileSpreadsheet className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{t.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{t.originalFileName}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent Runs</p>
              <Badge variant="outline" className="text-[10px] px-1.5 h-4">{runs?.length || 0}</Badge>
            </div>
            {recentRuns.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No model runs yet</p>
            ) : (
              <div className="space-y-0.5">
                {recentRuns.map(r => (
                  <Link key={r.id} href="/models">
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer transition-colors" data-testid={`model-run-${r.id}`}>
                      <TrendingUp className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{r.name}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {statusIcon(r.status)}
                          <span className="capitalize">{r.status}</span>
                          {r.createdAt && <span>· {timeAgo(r.createdAt)}</span>}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </ScrollArea>
  );
}

function DocTab() {
  const { data: templates, isLoading: tLoading } = useQuery<DocumentTemplate[]>({
    queryKey: ["/api/doc-templates"],
  });

  const { data: runs, isLoading: rLoading } = useQuery<DocumentRun[]>({
    queryKey: ["/api/doc-runs"],
  });

  const isLoading = tLoading || rLoading;
  const recentRuns = (runs || []).slice(0, 5);

  return (
    <ScrollArea className="h-full">
      {isLoading ? (
        <div className="px-4 space-y-2 pb-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Templates</p>
              <Badge variant="outline" className="text-[10px] px-1.5 h-4">{templates?.length || 0}</Badge>
            </div>
            {(templates || []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No templates yet</p>
            ) : (
              <div className="space-y-0.5">
                {(templates || []).slice(0, 5).map(t => (
                  <Link key={t.id} href="/documents">
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer transition-colors" data-testid={`doc-template-${t.id}`}>
                      <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{t.name}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {statusIcon(t.status)}
                          <span className="capitalize">{t.status}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent Documents</p>
              <Badge variant="outline" className="text-[10px] px-1.5 h-4">{runs?.length || 0}</Badge>
            </div>
            {recentRuns.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No documents generated yet</p>
            ) : (
              <div className="space-y-0.5">
                {recentRuns.map(r => (
                  <Link key={r.id} href="/documents">
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer transition-colors" data-testid={`doc-run-${r.id}`}>
                      <FileText className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{r.name}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {r.document_type && <span>{r.document_type}</span>}
                          <span>· {timeAgo(r.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </ScrollArea>
  );
}

export function StudiosWidget() {
  return (
    <Card className="h-full flex flex-col" data-testid="widget-studios">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-semibold">Studios</CardTitle>
        </div>
      </CardHeader>
      <Tabs defaultValue="models" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 mb-1 h-7 w-auto" data-testid="tabs-studios">
          <TabsTrigger value="models" className="text-[11px] h-6 px-2.5 gap-1" data-testid="tab-studios-models">
            <FileSpreadsheet className="w-3 h-3" />
            Models
          </TabsTrigger>
          <TabsTrigger value="docs" className="text-[11px] h-6 px-2.5 gap-1" data-testid="tab-studios-docs">
            <FileText className="w-3 h-3" />
            Documents
          </TabsTrigger>
        </TabsList>
        <TabsContent value="models" className="flex-1 overflow-hidden mt-0">
          <ModelTab />
        </TabsContent>
        <TabsContent value="docs" className="flex-1 overflow-hidden mt-0">
          <DocTab />
        </TabsContent>
      </Tabs>
    </Card>
  );
}
