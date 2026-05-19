// Property brochures board — half-size card on the property page.
// Drag-and-drop or click Add to upload PDFs. Leasing / Investment
// toggle picks which bucket the upload lands in. Click any thumbnail
// to pop out a full-screen preview. Pencil opens the editor for
// page-delete / logo overlay. Older versions live in the collapsible
// Archive section.
//
// Storage: BGP file_storage table via /api/properties/:id/brochures
// (same pattern as property_plans). No SharePoint dependency.

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Download, Maximize2, Pencil, Archive, ChevronDown, ChevronRight,
  Loader2, Trash2, Upload, Plus,
} from "lucide-react";

interface Brochure {
  id: string;
  name: string;
  type: "leasing" | "investment";
  size: number;
  pageCount: number | null;
  archived: boolean;
  notes: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
  fileUrl: string;
  downloadUrl: string;
}

interface BrochureResponse {
  leasing: Brochure[];
  investment: Brochure[];
  archived: { leasing: Brochure[]; investment: Brochure[] };
  total: number;
}

function fmtSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

export function PropertyBrochuresPanel({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"leasing" | "investment">("leasing");
  const [showArchive, setShowArchive] = useState(false);
  const [previewing, setPreviewing] = useState<Brochure | null>(null);
  const [editing, setEditing] = useState<Brochure | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError } = useQuery<BrochureResponse>({
    queryKey: ["/api/properties", propertyId, "brochures"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/brochures`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("type", tab);
      const r = await fetch(`/api/properties/${propertyId}/brochures/upload`, {
        method: "POST", body: form, credentials: "include",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "brochures"] }),
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const r = await fetch(`/api/properties/${propertyId}/brochures/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ archived }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "brochures"] }),
    onError: (e: any) => toast({ title: "Archive toggle failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/properties/${propertyId}/brochures/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "brochures"] }),
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (arr.length === 0) {
      toast({ title: "PDFs only", description: "Drop a PDF brochure or use the file picker.", variant: "destructive" });
      return;
    }
    (async () => {
      for (const f of arr) {
        try { await uploadMutation.mutateAsync(f); } catch { /* error toast already fired */ }
      }
      toast({ title: `${arr.length} brochure${arr.length === 1 ? "" : "s"} uploaded` });
    })();
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepth.current++;
    if (e.dataTransfer?.types?.includes("Files")) setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepth.current--;
    if (dragDepth.current <= 0) { dragDepth.current = 0; setIsDragging(false); }
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragDepth.current = 0;
    setIsDragging(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  };

  const renderBody = () => {
    if (isLoading) return <Skeleton className="h-32 w-full" />;
    if (isError) return <p className="text-xs text-rose-600 italic">Couldn't load brochures — refresh to retry.</p>;
    if (!data) return null;

    const active = tab === "leasing" ? data.leasing : data.investment;
    const archived = tab === "leasing" ? data.archived.leasing : data.archived.investment;

    // Single-tile layout when only one brochure: render it big so it
    // fills the column height like a hero preview instead of sitting as
    // a small 3:4 thumbnail with empty space below. Multi-tile keeps
    // the grid + aspect-ratio pattern so 6 brochures stay legible.
    const isHero = active.length === 1;

    return (
      <>
        <div className="flex items-center gap-1.5 mb-2 shrink-0">
          <button
            onClick={() => setTab("leasing")}
            className={`px-2 py-1 rounded text-[11px] font-medium ${tab === "leasing" ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            data-testid="tab-brochures-leasing"
          >
            Leasing
            <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 bg-white/30">{data.leasing.length}</Badge>
          </button>
          <button
            onClick={() => setTab("investment")}
            className={`px-2 py-1 rounded text-[11px] font-medium ${tab === "investment" ? "bg-emerald-700 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            data-testid="tab-brochures-investment"
          >
            Investment
            <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 bg-white/30">{data.investment.length}</Badge>
          </button>
        </div>

        {active.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-muted-foreground py-8 text-center border border-dashed rounded-md min-h-[180px]">
            <Upload className="w-5 h-5 mb-1 opacity-40" />
            Drag a PDF here or click <span className="font-medium text-foreground">Add</span> above.
          </div>
        ) : isHero ? (
          <div className="flex-1 min-h-0">
            <BrochureTile
              brochure={active[0]}
              hero
              onPreview={() => setPreviewing(active[0])}
              onEdit={() => setEditing(active[0])}
              onArchive={() => archiveMutation.mutate({ id: active[0].id, archived: true })}
              onDelete={() => { if (confirm(`Delete "${active[0].name}"? This cannot be undone.`)) deleteMutation.mutate(active[0].id); }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {active.map(b => (
              <BrochureTile
                key={b.id}
                brochure={b}
                onPreview={() => setPreviewing(b)}
                onEdit={() => setEditing(b)}
                onArchive={() => archiveMutation.mutate({ id: b.id, archived: true })}
                onDelete={() => { if (confirm(`Delete "${b.name}"? This cannot be undone.`)) deleteMutation.mutate(b.id); }}
              />
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <div className="mt-2 pt-2 border-t">
            <button
              onClick={() => setShowArchive(s => !s)}
              className="w-full flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              data-testid="toggle-brochure-archive"
            >
              {showArchive ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <Archive className="w-3 h-3" />
              Archive ({archived.length})
            </button>
            {showArchive && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 opacity-75">
                {archived.map(b => (
                  <BrochureTile
                    key={b.id}
                    brochure={b}
                    onPreview={() => setPreviewing(b)}
                    onEdit={() => setEditing(b)}
                    onArchive={() => archiveMutation.mutate({ id: b.id, archived: false })}
                    onDelete={() => { if (confirm(`Delete "${b.name}"? This cannot be undone.`)) deleteMutation.mutate(b.id); }}
                    unarchiveLabel
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <>
      <Card
        data-testid="property-brochures-panel"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="relative h-full flex flex-col"
      >
        <CardContent className="p-3 flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold">Brochures</span>
            <span className="ml-auto flex items-center gap-1.5">
              {uploadMutation.isPending && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) { handleFiles(e.target.files); e.target.value = ""; } }}
              />
              <Button
                size="sm" variant="ghost"
                className="h-6 text-[11px] gap-1 px-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                data-testid="brochure-add-button"
              >
                <Plus className="w-3 h-3" />
                Add
              </Button>
            </span>
          </div>
          {renderBody()}
        </CardContent>

        {isDragging && (
          <div className="absolute inset-0 z-10 rounded-lg border-2 border-dashed border-blue-500 bg-blue-50/90 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <Upload className="w-8 h-8 mx-auto mb-1.5 text-blue-600" />
              <p className="text-sm font-medium text-blue-900">Drop PDF as <span className="capitalize">{tab}</span> brochure</p>
            </div>
          </div>
        )}
      </Card>

      {previewing && <BrochurePreviewDialog brochure={previewing} onClose={() => setPreviewing(null)} />}
      {editing && (
        <BrochureEditDialog
          brochure={editing}
          propertyId={propertyId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function BrochureTile({
  brochure, onPreview, onEdit, onArchive, onDelete, unarchiveLabel, hero,
}: {
  brochure: Brochure;
  onPreview: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  unarchiveLabel?: boolean;
  hero?: boolean;
}) {
  return (
    <div
      className={`group border rounded-md overflow-hidden bg-white hover:border-blue-300 transition-colors ${hero ? "h-full flex flex-col" : ""}`}
      data-testid={`brochure-tile-${brochure.id}`}
    >
      <button
        onClick={onPreview}
        className={`block w-full bg-muted/40 relative overflow-hidden ${hero ? "flex-1 min-h-0" : "aspect-[3/4]"}`}
      >
        {/* PDF first-page preview via iframe — works for any inline
            PDF, no thumbnail generation needed. Browser handles
            rendering; for PDFs the first page shows. */}
        <iframe
          src={`${brochure.fileUrl}#toolbar=0&navpanes=0&view=FitH`}
          className="w-full h-full border-0 pointer-events-none"
          title={brochure.name}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Maximize2 className="w-6 h-6 text-white" />
        </div>
      </button>
      <div className="p-1.5">
        <p className="text-[10px] font-medium truncate" title={brochure.name}>{brochure.name}</p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[9px] text-muted-foreground">
            {fmtDate(brochure.uploadedAt)} · {fmtSize(brochure.size)}
            {brochure.pageCount ? ` · ${brochure.pageCount}p` : ""}
          </span>
          <div className="flex gap-0.5">
            <button
              onClick={onEdit}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Edit (delete pages, cover logos)"
            >
              <Pencil className="w-2.5 h-2.5" />
            </button>
            <a
              href={brochure.downloadUrl}
              download={brochure.name}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Download"
            >
              <Download className="w-2.5 h-2.5" />
            </a>
            <button
              onClick={onArchive}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title={unarchiveLabel ? "Restore from archive" : "Archive"}
            >
              <Archive className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={onDelete}
              className="p-1 rounded hover:bg-rose-50 text-rose-400 hover:text-rose-600"
              title="Delete permanently"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrochurePreviewDialog({ brochure, onClose }: { brochure: Brochure; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl h-[90vh] p-0 flex flex-col">
        <DialogHeader className="px-4 pt-3 pb-2 border-b">
          <DialogTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="truncate">{brochure.name}</span>
            <span className="text-[10px] text-muted-foreground font-normal ml-auto whitespace-nowrap">
              {fmtSize(brochure.size)} · {fmtDate(brochure.uploadedAt)}
            </span>
            <a
              href={brochure.downloadUrl}
              download={brochure.name}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <iframe src={brochure.fileUrl} className="w-full h-full border-0" title={brochure.name} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BrochureEditDialog({
  brochure, propertyId, onClose,
}: { brochure: Brochure; propertyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deletePagesInput, setDeletePagesInput] = useState("");
  const [addBgpLogo, setAddBgpLogo] = useState(false);
  const [logoPageInput, setLogoPageInput] = useState("1");
  const [logoBoxInput, setLogoBoxInput] = useState({ x: "20", y: "20", w: "150", h: "60" });

  const editMutation = useMutation({
    mutationFn: async () => {
      const deletePages = deletePagesInput
        .split(/[,\s]+/)
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n > 0);
      const body: any = {};
      if (deletePages.length > 0) body.deletePages = deletePages;
      if (addBgpLogo) {
        const page = parseInt(logoPageInput, 10) || 1;
        const x = parseFloat(logoBoxInput.x) || 0;
        const y = parseFloat(logoBoxInput.y) || 0;
        const w = parseFloat(logoBoxInput.w) || 150;
        const h = parseFloat(logoBoxInput.h) || 60;
        body.overlays = [{ page, x, y, w, h, addBgpLogo: true }];
      }
      if (!body.deletePages && !body.overlays) {
        throw new Error("Nothing to do — pick at least one action.");
      }
      const r = await fetch(`/api/properties/${propertyId}/brochures/${brochure.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: (j) => {
      toast({
        title: "Brochure edited",
        description: `Saved a new copy: ${j.pagesIn} → ${j.pagesOut} pages${j.overlaysApplied ? `, ${j.overlaysApplied} overlay(s)` : ""}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/properties", propertyId, "brochures"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Edit failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Edit brochure
          </DialogTitle>
          <DialogDescription className="text-xs">
            Saves a new "(edited &lt;date&gt;).pdf" alongside the original — the source stays intact.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground border-b pb-2 truncate" title={brochure.name}>
            {brochure.name}{brochure.pageCount ? ` (${brochure.pageCount} pages)` : ""}
          </p>

          <div className="space-y-1">
            <label className="text-xs font-medium flex items-center gap-1.5">
              <Trash2 className="w-3 h-3 text-rose-500" /> Delete pages
            </label>
            <input
              type="text"
              value={deletePagesInput}
              onChange={(e) => setDeletePagesInput(e.target.value)}
              placeholder="e.g. 4, 5, 9-10  (1-indexed)"
              className="w-full px-2 py-1 text-xs border rounded"
            />
            <p className="text-[10px] text-muted-foreground">
              Comma-separated page numbers to remove. Open the brochure to count pages.
            </p>
          </div>

          <div className="space-y-1 border-t pt-3">
            <label className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={addBgpLogo}
                onChange={(e) => setAddBgpLogo(e.target.checked)}
                className="w-3 h-3"
              />
              Cover a logo with the BGP wordmark
            </label>
            {addBgpLogo && (
              <div className="space-y-1.5 pl-5 pt-1">
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="text-[10px] text-muted-foreground">
                    Page
                    <input type="number" min={1} value={logoPageInput} onChange={(e) => setLogoPageInput(e.target.value)} className="w-full px-1.5 py-0.5 text-xs border rounded mt-0.5" />
                  </label>
                  <div></div>
                  <label className="text-[10px] text-muted-foreground">
                    X (pts from left)
                    <input type="number" value={logoBoxInput.x} onChange={(e) => setLogoBoxInput(b => ({ ...b, x: e.target.value }))} className="w-full px-1.5 py-0.5 text-xs border rounded mt-0.5" />
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    Y (pts from bottom)
                    <input type="number" value={logoBoxInput.y} onChange={(e) => setLogoBoxInput(b => ({ ...b, y: e.target.value }))} className="w-full px-1.5 py-0.5 text-xs border rounded mt-0.5" />
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    Width
                    <input type="number" value={logoBoxInput.w} onChange={(e) => setLogoBoxInput(b => ({ ...b, w: e.target.value }))} className="w-full px-1.5 py-0.5 text-xs border rounded mt-0.5" />
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    Height
                    <input type="number" value={logoBoxInput.h} onChange={(e) => setLogoBoxInput(b => ({ ...b, h: e.target.value }))} className="w-full px-1.5 py-0.5 text-xs border rounded mt-0.5" />
                  </label>
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  An A4 portrait page is ~595×842 points. Origin is bottom-left. Covers the area with a white box and drops the BGP wordmark centred on top.
                </p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
            {editMutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
            Save edited copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
