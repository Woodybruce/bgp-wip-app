import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import type { CrmProperty } from "@shared/schema";
import {
  Search, FileText, Download, Eye, ArrowLeft,
  File, Image, FileSpreadsheet, X,
} from "lucide-react";

type MarketingFileRow = {
  id: string;
  unitId: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: string | null;
  unitName: string | null;
  propertyId: string | null;
};

function getFileIcon(mimeType: string | null) {
  if (mimeType?.startsWith("image/")) return <Image className="w-5 h-5 text-purple-500" />;
  if (mimeType?.includes("pdf")) return <FileText className="w-5 h-5 text-red-500" />;
  if (mimeType?.includes("word") || mimeType?.includes("document")) return <FileText className="w-5 h-5 text-blue-500" />;
  if (mimeType?.includes("excel") || mimeType?.includes("spreadsheet")) return <FileSpreadsheet className="w-5 h-5 text-green-500" />;
  return <File className="w-5 h-5 text-gray-500" />;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MarketingFilesPage() {
  const [search, setSearch] = useState("");

  const { data: allFiles = [], isLoading } = useQuery<MarketingFileRow[]>({
    queryKey: ["/api/available-units/all-files"],
  });

  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const propMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of properties) m[p.id] = p.name;
    return m;
  }, [properties]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allFiles;
    const q = search.toLowerCase();
    return allFiles.filter(f =>
      f.fileName.toLowerCase().includes(q) ||
      (f.unitName || "").toLowerCase().includes(q) ||
      (f.propertyId && propMap[f.propertyId] || "").toLowerCase().includes(q)
    );
  }, [allFiles, search, propMap]);

  const grouped = useMemo(() => {
    const groups: Record<string, { propertyName: string; files: MarketingFileRow[] }> = {};
    for (const f of filtered) {
      const pName = f.propertyId ? (propMap[f.propertyId] || "Unknown Property") : "Unknown Property";
      const key = f.propertyId || "unknown";
      if (!groups[key]) groups[key] = { propertyName: pName, files: [] };
      groups[key].files.push(f);
    }
    return Object.values(groups).sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [filtered, propMap]);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl mx-auto" data-testid="marketing-files-page">
      <div className="flex items-center gap-3">
        <Link href="/available">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" data-testid="button-back-available">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketing Files</h1>
          <p className="text-sm text-muted-foreground">{allFiles.length} file{allFiles.length !== 1 ? "s" : ""} across all units</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by file name, unit or property..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-10"
          data-testid="input-search-marketing-files"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <File className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">
            {search ? "No files match your search" : "No marketing files uploaded yet"}
          </p>
          <p className="text-xs mt-1">
            {search ? "Try a different search term" : "Upload brochures from the Available Units board"}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(group => (
            <div key={group.propertyName}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {group.propertyName}
              </p>
              <div className="space-y-1.5">
                {group.files.map(f => (
                  <Card
                    key={f.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => window.open(`${f.filePath}?view=1`, "_blank")}
                    data-testid={`marketing-file-${f.id}`}
                  >
                    <CardContent className="flex items-center gap-3 p-3">
                      <div className="shrink-0">
                        {getFileIcon(f.mimeType)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {f.unitName && <span>{f.unitName} · </span>}
                          {formatSize(f.fileSize)}
                          {f.createdAt && ` · ${new Date(f.createdAt).toLocaleDateString("en-GB")}`}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => { e.stopPropagation(); window.open(`${f.filePath}?view=1`, "_blank"); }}
                          title="View"
                          data-testid={`button-view-${f.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => { e.stopPropagation(); window.open(f.filePath, "_blank"); }}
                          title="Download"
                          data-testid={`button-download-${f.id}`}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
