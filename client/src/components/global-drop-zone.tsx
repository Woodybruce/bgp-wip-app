/**
 * GlobalDropZone
 * ==============
 * Ambient ingestion for the entire app:
 *   - Drop any file anywhere → AI classifies and imports
 *   - Paste a SharePoint share link anywhere → AI fetches and imports
 *   - (future: email / WhatsApp webhooks feed the same backend pipeline)
 *
 * No buttons, no page navigation, no target picking. Just drop or paste.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Upload } from "lucide-react";
import { ImportAnythingDialog } from "@/components/import-anything-dialog";

export function GlobalDropZone({ children }: { children: React.ReactNode }) {
  const [isDragging, setIsDragging] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [pastedShareUrl, setPastedShareUrl] = useState<string | null>(null);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((_e: DragEvent) => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      setDroppedFile(file);
      setPastedShareUrl(null);
      setDialogOpen(true);
    }
  }, []);

  // Intercept paste events at the window level. If the pasted text is a
  // SharePoint share link and the user isn't focused on a text input, open
  // the import dialog automatically.
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const target = e.target as HTMLElement;
    const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
      (target as HTMLElement).isContentEditable;
    if (isInput) return; // Let normal paste through in text fields
    const text = e.clipboardData?.getData("text") || "";
    if (/sharepoint\.com|onedrive\.live\.com|1drv\.ms/i.test(text)) {
      e.preventDefault();
      setDroppedFile(null);
      setPastedShareUrl(text.trim());
      setDialogOpen(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("paste", handlePaste);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop, handlePaste]);

  return (
    <>
      {children}

      {isDragging && (
        <div className="fixed inset-0 z-[9999] pointer-events-none">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-background border-2 border-dashed border-primary rounded-2xl px-16 py-12 flex flex-col items-center gap-4 shadow-2xl">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <div className="text-center">
                <div className="text-xl font-semibold">Drop to import</div>
                <div className="text-sm text-muted-foreground mt-1">AI will classify and parse your file</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ImportAnythingDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setDroppedFile(null);
            setPastedShareUrl(null);
          }
        }}
        preloadedFile={droppedFile ?? undefined}
        preloadedShareUrl={pastedShareUrl ?? undefined}
      />
    </>
  );
}
