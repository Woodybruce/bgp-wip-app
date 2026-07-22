// Receipt lightbox. Fits a phone-photo to the screen by default with proper
// zoom (buttons + scroll-wheel + double-click) and drag-to-pan; PDFs fall
// through to the browser's native viewer.
//
// An expense can hold MULTIPLE photos (multi-page receipt, several items), so
// this pages through every receipt on the expense (‹ 2/3 › in the header),
// and in editable mode lets the owner add more (multi-select) or delete the
// one on screen. Falls back to the single legacy pointer for old expenses that
// have a receipt but no expense_receipts rows.
import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/queryClient";
import { ZoomIn, ZoomOut, Maximize2, ExternalLink, Loader2, X, FileText, Trash2, ChevronLeft, ChevronRight, ImagePlus } from "lucide-react";

interface ReceiptMeta {
  id: string;
  filename: string | null;
  mimeType: string | null;
  uploadedAt?: string | null;
}

interface ReceiptViewerProps {
  open: boolean;
  onClose: () => void;
  expenseId: string | null;
  title?: string;
  filename?: string | null;
  /** Show add + delete controls. Owner views only — the server also enforces
   *  ownership, so this is just to hide the controls elsewhere. */
  editable?: boolean;
  /** Fired after an add or delete so the caller can refresh its list. */
  onChanged?: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 0.5;
const IMG_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff"];

export default function ReceiptViewer({ open, onClose, expenseId, title, filename, editable = false, onChanged }: ReceiptViewerProps) {
  const [receipts, setReceipts] = useState<ReceiptMeta[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [idx, setIdx] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<"image" | "pdf" | "other">("image");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Image zoom + pan. scale 1 === fit-to-screen (object-contain).
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const resetView = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);

  const current = receipts[idx] || null;
  const currentName = current?.filename ?? filename ?? null;
  const count = receipts.length;
  // The bytes URL for the current receipt (by id when we have rows; the legacy
  // "latest" pointer otherwise). Used by the image/iframe and the new-tab link.
  const src = expenseId
    ? (current ? `/api/expenses/${expenseId}/receipt?receiptId=${current.id}` : `/api/expenses/${expenseId}/receipt`)
    : null;

  const loadReceipts = useCallback(async (): Promise<ReceiptMeta[]> => {
    if (!expenseId) return [];
    try {
      const res = await fetch(`/api/expenses/${expenseId}/receipts`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return [];
      const list = await res.json();
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }, [expenseId]);

  // On open: load the receipt list and reset to the first.
  useEffect(() => {
    if (!open || !expenseId) return;
    let cancelled = false;
    setListLoaded(false);
    (async () => {
      const list = await loadReceipts();
      if (cancelled) return;
      setReceipts(list);
      setIdx(0);
      setListLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [open, expenseId, loadReceipts]);

  // Fetch the current receipt's bytes (re-runs when paging or after add/delete).
  useEffect(() => {
    if (!open || !listLoaded || !src) return;
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
        const ext = (currentName || "").toLowerCase().split(".").pop() || "";
        const isPdf = type.includes("pdf") || ext === "pdf";
        const isImage = type.startsWith("image/") || IMG_EXTS.includes(ext);
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
  }, [open, listLoaded, src, currentName, resetView]);

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

  const goPrev = () => setIdx((i) => Math.max(0, i - 1));
  const goNext = () => setIdx((i) => Math.min(count - 1, i + 1));

  const handleDelete = async () => {
    if (!expenseId) return;
    const one = count > 1;
    if (!window.confirm(one ? "Delete this photo? The others stay on the expense." : "Delete this receipt? You can add a new one straight after.")) return;
    setBusy(true); setError(null);
    try {
      const url = current
        ? `/api/expenses/${expenseId}/receipt?receiptId=${current.id}`
        : `/api/expenses/${expenseId}/receipt`;
      const r = await fetch(url, { method: "DELETE", credentials: "include", headers: { ...getAuthHeaders() } });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `Couldn't delete (${r.status})`); }
      const list = await loadReceipts();
      setReceipts(list);
      setIdx((i) => Math.max(0, Math.min(i, list.length - 1)));
      if (list.length === 0) setBlobUrl(null);
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || "Couldn't delete receipt");
    } finally { setBusy(false); }
  };

  const handleAdd = async (files: FileList | null) => {
    if (!expenseId || !files || files.length === 0) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("receipt", f));
      const r = await fetch(`/api/expenses/${expenseId}/receipt`, { method: "POST", credentials: "include", headers: { ...getAuthHeaders() }, body: fd });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.message || b.error || `Upload failed (${r.status})`); }
      const list = await loadReceipts();
      setReceipts(list);
      setListLoaded(true);
      setIdx(list.length > 0 ? list.length - 1 : 0); // jump to the newest
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || "Couldn't add receipt");
    } finally { setBusy(false); }
  };

  const showEmpty = listLoaded && !loading && !blobUrl && !error;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-full sm:max-w-4xl w-full h-[100dvh] sm:h-[88vh] rounded-none sm:rounded-lg flex flex-col p-0 gap-0">
        <div
          className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <DialogTitle className="text-sm font-medium truncate">
            {title || "Receipt"}{count > 1 ? <span className="text-muted-foreground font-normal ml-1">({idx + 1}/{count})</span> : null}
          </DialogTitle>
          <div className="flex items-center gap-1 shrink-0">
            {count > 1 && (
              <>
                <Button variant="ghost" size="sm" onClick={goPrev} disabled={idx <= 0} title="Previous photo" data-testid="button-receipt-prev">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={goNext} disabled={idx >= count - 1} title="Next photo" data-testid="button-receipt-next">
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <div className="w-px h-5 bg-border mx-1" />
              </>
            )}
            {kind === "image" && blobUrl && (
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
            {editable && expenseId && (
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy} title="Add photo(s)" data-testid="button-receipt-add-more">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              </Button>
            )}
            {src && blobUrl && (
              <a href={src} target="_blank" rel="noreferrer" title="Open in new tab">
                <Button variant="ghost" size="sm" data-testid="link-receipt-new-tab"><ExternalLink className="w-4 h-4" /></Button>
              </a>
            )}
            {editable && expenseId && blobUrl && (
              <Button variant="ghost" size="sm" onClick={handleDelete} disabled={busy} title="Delete this photo" data-testid="button-receipt-delete" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </Button>
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
          {!loading && showEmpty && (
            <div className="text-center px-6" data-testid="receipt-empty-state">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground mb-3">No receipt on this expense yet.</p>
              {editable && (
                <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="button-receipt-add">
                  {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ImagePlus className="w-4 h-4 mr-1" />} Add photo(s)
                </Button>
              )}
            </div>
          )}
          {!loading && error && !blobUrl && !showEmpty && (
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
          {!loading && blobUrl && kind === "image" && (
            <img
              src={blobUrl}
              alt={currentName || "Receipt"}
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
          {!loading && blobUrl && kind !== "image" && (
            <iframe src={blobUrl} title="Receipt" className="w-full h-full bg-white" data-testid="iframe-receipt" />
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => { const f = e.target.files; e.target.value = ""; handleAdd(f); }}
          data-testid="input-receipt-add"
        />
        {currentName && blobUrl && (
          <div className="px-4 py-2 border-t shrink-0 text-xs text-muted-foreground truncate">
            {currentName}{count > 1 ? ` · photo ${idx + 1} of ${count}` : ""}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
