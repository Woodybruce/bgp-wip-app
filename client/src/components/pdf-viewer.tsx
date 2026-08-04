import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Camera, Loader2, CameraOff,
} from "lucide-react";

interface PDFViewerProps {
  url: string;
  fileName: string;
  open: boolean;
  onClose: () => void;
  propertyName?: string;
}

export default function PDFViewer({ url, fileName, open, onClose, propertyName }: PDFViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capturingAll, setCapturingAll] = useState(false);
  const renderTaskRef = useRef<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setPdfDoc(null);
      setPageNum(1);
      setTotalPages(0);
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url
        ).href;
        const task = pdfjsLib.getDocument(url);
        const doc = await task.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
      } catch (err: any) {
        if (!cancelled) {
          toast({ title: "Could not load PDF", description: err.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [url, open]);

  const renderPage = useCallback(async (doc: any, num: number, sc: number) => {
    if (!doc || !canvasRef.current) return;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    try {
      const page = await doc.getPage(num);
      const viewport = page.getViewport({ scale: sc });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.error("[PDFViewer] render error:", err);
      }
    }
  }, []);

  useEffect(() => {
    if (pdfDoc) renderPage(pdfDoc, pageNum, scale);
  }, [pdfDoc, pageNum, scale, renderPage]);

  // Fit the first page to the viewer on open — bounded by BOTH width and
  // height so the page fills the dialog instead of leaving a void below a
  // landscape brochure (or overflowing on a portrait one). The user can
  // still zoom in/out from there.
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDoc.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const availW = (containerRef.current?.clientWidth || vp.width) - 24;
        const availH = (containerRef.current?.clientHeight || vp.height) - 24;
        const fit = Math.max(0.3, Math.min(3, Math.min(availW / vp.width, availH / vp.height)));
        if (!cancelled) setScale(fit);
      } catch {
        /* keep default scale */
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc]);

  useEffect(() => {
    if (!open) {
      setPdfDoc(null);
      setPageNum(1);
      setTotalPages(0);
    }
  }, [open]);

  async function capturePage(num?: number) {
    if (!pdfDoc || !canvasRef.current) return null;
    const targetPage = num ?? pageNum;
    if (num && num !== pageNum) {
      await renderPage(pdfDoc, targetPage, scale);
    }
    return canvasRef.current.toDataURL("image/jpeg", 0.92);
  }

  async function savePageToStudio(pageIndex?: number) {
    const base64Full = await capturePage(pageIndex);
    if (!base64Full) return false;
    const base64Data = base64Full.replace(/^data:image\/jpeg;base64,/, "");
    const label = totalPages > 1 ? ` (page ${pageIndex ?? pageNum})` : "";
    const name = fileName.replace(/\.pdf$/i, "") + label;

    const res = await fetch("/api/image-studio", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        base64Data,
        mimeType: "image/jpeg",
        fileName: name,
        category: "Marketing",
        description: `Captured from brochure: ${fileName}${propertyName ? ` — ${propertyName}` : ""}`,
        tags: ["brochure", "pdf-capture"],
      }),
    });
    return res.ok;
  }

  async function handleCapturePage() {
    setCapturing(true);
    try {
      const ok = await savePageToStudio();
      if (ok) {
        toast({ title: "Page saved to Image Studio", description: `Page ${pageNum} of ${fileName}` });
      } else {
        toast({ title: "Failed to save", variant: "destructive" });
      }
    } finally {
      setCapturing(false);
    }
  }

  async function handleCaptureAll() {
    if (!pdfDoc) return;
    setCapturingAll(true);
    let saved = 0;
    try {
      for (let i = 1; i <= totalPages; i++) {
        await renderPage(pdfDoc, i, scale);
        const ok = await savePageToStudio(i);
        if (ok) saved++;
        await new Promise(r => setTimeout(r, 100));
      }
      await renderPage(pdfDoc, pageNum, scale);
      toast({ title: `${saved}/${totalPages} pages saved`, description: "All pages added to Image Studio" });
    } finally {
      setCapturingAll(false);
    }
  }

  const busy = capturing || capturingAll;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-full sm:max-w-5xl w-full h-[100dvh] sm:h-[90vh] rounded-none sm:rounded-lg flex flex-col p-0 gap-0">
        <div
          className="flex items-center justify-between pl-4 pr-12 py-3 border-b shrink-0"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <DialogTitle className="text-sm font-medium truncate max-w-[45%]">{fileName}</DialogTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setScale(s => Math.max(0.5, s - 0.25))} disabled={loading}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(scale * 100)}%</span>
            <Button variant="ghost" size="sm" onClick={() => setScale(s => Math.min(4, s + 0.25))} disabled={loading}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            <div className="w-px h-5 bg-border mx-1" />
            <Button variant="ghost" size="sm" onClick={handleCapturePage} disabled={loading || busy} title="Save this page to Image Studio">
              {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            </Button>
            {totalPages > 1 && (
              <Button variant="ghost" size="sm" onClick={handleCaptureAll} disabled={loading || busy} title="Save all pages to Image Studio">
                {capturingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <CameraOff className="w-4 h-4" />}
              </Button>
            )}
            {/* No custom close button — DialogContent already renders the
                Radix X in this corner; two Xs overlapped (Woody, 2026-08-04). */}
          </div>
        </div>

        <div ref={containerRef} className="flex-1 overflow-auto bg-muted/30 flex items-center justify-center p-4">
          {loading && (
            <div className="flex items-center gap-2 mt-20 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading PDF…</span>
            </div>
          )}
          <canvas ref={canvasRef} className="shadow-lg max-w-full" style={{ display: loading ? "none" : "block" }} />
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 px-4 py-3 border-t shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1 || loading}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {pageNum} of {totalPages}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setPageNum(p => Math.min(totalPages, p + 1))} disabled={pageNum >= totalPages || loading}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
