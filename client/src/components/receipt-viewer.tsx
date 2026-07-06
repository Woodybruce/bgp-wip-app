// Receipt lightbox. The old approach dropped the receipt straight into an
// <iframe src=/api/expenses/:id/receipt>, which renders a phone-photo at its
// native pixel size — so Wendy/Layla opened a receipt and got a zoomed-in
// corner with scrollbars. This fits the image to the screen by default and
// gives proper zoom (buttons + scroll-wheel + double-click) and drag-to-pan.
// PDFs fall through to the browser's native PDF viewer, which already
// fits-to-page and has its own zoom.
import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/queryClient";
import { ZoomIn, ZoomOut, Maximize2, ExternalLink, Loader2, X, FileText } from "lucide-react";

interface ReceiptViewerProps {
  open: boolean;
  onClose: () => void;
  expenseId: string | null;
  title?: string;
  filename?: string | null;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 0.5;

export default function ReceiptViewer({ open, onClose, expenseId, title, filename }: ReceiptViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<"image" | "pdf" | "other">("image");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Image zoom + pan. scale 1 === fit-to-screen (object-contain); above that
  // we translate to let the user pan around the zoomed image.
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const src = expenseId ? `/api/expenses/${expenseId}/receipt` : null;

  const resetView = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);

  // Fetch as a blob so we can read the real content-type (image vs PDF) and
  // so auth headers ride along, not just the cookie.
  useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);
    resetView();
    (async () => {
      try {
        const res = await fetch(src, { credentials: "include", headers: { ...getAuthHeaders() } });
        if (!res.ok) throw new Error(`Receipt failed to load (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        const type = blob.type || "";
        const ext = (filename || "").toLowerCase().split(".").pop() || "";
        const isPdf = type.includes("pdf") || ext === "pdf";
        const isImage = type.startsWith("image/")
          || ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff"].includes(ext);
        setKind(isPdf ? "pdf" : isImage ? "image" : "other");
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Couldn't load receipt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, src, filename, resetView]);

  const zoomIn = () => setScale((s) => Math.min(MAX_SCALE, +(s + STEP).toFixed(2)));
  const zoomOut = () => setScale((s) => {
    const next = Math.max(MIN_SCALE, +(s - STEP).toFixed(2));
    if (next === MIN_SCALE) { setTx(0); setTy(0); }
    return next;
  });

  const onWheel = (e: React.WheelEvent) => {
    if (kind !== "image") return;
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(s - Math.sign(e.deltaY) * STEP).toFixed(2)));
      if (next === MIN_SCALE) { setTx(0); setTy(0); }
      return next;
    });
  };

  // Drag-to-pan, only meaningful once zoomed past fit.
  const onPointerDown = (e: React.PointerEvent) => {
    if (kind !== "image" || scale <= 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setTx(drag.current.tx + (e.clientX - drag.current.x));
    setTy(drag.current.ty + (e.clientY - drag.current.y));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-full sm:max-w-4xl w-full h-[100dvh] sm:h-[88vh] rounded-none sm:rounded-lg flex flex-col p-0 gap-0">
        <div
          className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <DialogTitle className="text-sm font-medium truncate">{title || "Receipt"}</DialogTitle>
          <div className="flex items-center gap-1 shrink-0">
            {kind === "image" && (
              <>
                <Button variant="ghost" size="sm" onClick={zoomOut} disabled={scale <= MIN_SCALE} title="Zoom out" data-testid="button-receipt-zoom-out">
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
                <Button variant="ghost" size="sm" onClick={zoomIn} disabled={scale >= MAX_SCALE} title="Zoom in" data-testid="button-receipt-zoom-in">
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={resetView} disabled={scale === 1 && tx === 0 && ty === 0} title="Fit to screen" data-testid="button-receipt-fit">
                  <Maximize2 className="w-4 h-4" />
                </Button>
                <div className="w-px h-5 bg-border mx-1" />
              </>
            )}
            {src && (
              <a href={src} target="_blank" rel="noreferrer" title="Open in new tab">
                <Button variant="ghost" size="sm" data-testid="link-receipt-new-tab"><ExternalLink className="w-4 h-4" /></Button>
              </a>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} title="Close"><X className="w-4 h-4" /></Button>
          </div>
        </div>

        <div
          className="flex-1 overflow-hidden bg-muted/30 flex items-center justify-center select-none"
          onWheel={onWheel}
        >
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading receipt…</span>
            </div>
          )}
          {!loading && error && (
            <div className="text-center text-sm text-muted-foreground px-6">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
              {error}
              {src && (
                <div className="mt-2">
                  <a href={src} target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">Open in new tab</a>
                </div>
              )}
            </div>
          )}
          {!loading && !error && blobUrl && kind === "image" && (
            <img
              src={blobUrl}
              alt={filename || "Receipt"}
              draggable={false}
              onDoubleClick={() => (scale === 1 ? setScale(2.5) : resetView())}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="max-w-full max-h-full object-contain"
              style={{
                transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                cursor: scale > 1 ? (drag.current ? "grabbing" : "grab") : "default",
                transition: drag.current ? "none" : "transform 0.1s ease-out",
                touchAction: "none",
              }}
              data-testid="img-receipt"
            />
          )}
          {!loading && !error && blobUrl && kind !== "image" && (
            <iframe src={blobUrl} title="Receipt" className="w-full h-full bg-white" data-testid="iframe-receipt" />
          )}
        </div>

        {filename && (
          <div className="px-4 py-2 border-t shrink-0 text-xs text-muted-foreground truncate">{filename}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
