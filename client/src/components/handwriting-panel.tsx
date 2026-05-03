import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { PenTool, X, Undo2, Redo2, Trash2, Copy, GripHorizontal, Minimize2, Maximize2 } from "lucide-react";

const APP_KEY = import.meta.env.VITE_MYSCRIPT_APP_KEY || "";
const HMAC_KEY = import.meta.env.VITE_MYSCRIPT_HMAC_KEY || "";

export function HandwritingPanel() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [recognizedText, setRecognizedText] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<any>(null);
  const lastFocusedInputRef = useRef<HTMLElement | null>(null);

  // Track last-focused input field globally
  useEffect(() => {
    const handler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        lastFocusedInputRef.current = target;
      }
    };
    document.addEventListener("focusin", handler);
    return () => document.removeEventListener("focusin", handler);
  }, []);

  const initEditor = useCallback(async () => {
    if (!editorRef.current || !APP_KEY || editorInstanceRef.current) return;
    setLoading(true);
    try {
      const { Editor } = await import("iink-ts");
      const editor = await Editor.load(editorRef.current, "INTERACTIVEINKSSR", {
        configuration: {
          server: {
            scheme: "https",
            host: "cloud.myscript.com",
            applicationKey: APP_KEY,
            hmacKey: HMAC_KEY,
          },
          recognition: {
            type: "TEXT",
            lang: "en_US",
          },
        },
      });
      editorInstanceRef.current = editor;
      setEditorReady(true);

      editorRef.current.addEventListener("exported", ((e: CustomEvent) => {
        const exports = e.detail;
        const jiix = exports?.["application/vnd.myscript.jiix"];
        if (jiix) {
          const parsed = typeof jiix === "string" ? JSON.parse(jiix) : jiix;
          setRecognizedText(parsed.label || parsed.words?.map((w: any) => w.label).join(" ") || "");
        }
      }) as EventListener);

      editorRef.current.addEventListener("changed", ((e: CustomEvent) => {
        setCanUndo(e.detail?.canUndo ?? false);
        setCanRedo(e.detail?.canRedo ?? false);
      }) as EventListener);
    } catch (err) {
      console.error("[Handwriting] Failed to init editor:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open && !minimized) {
      // Small delay to ensure DOM is rendered
      const t = setTimeout(initEditor, 100);
      return () => clearTimeout(t);
    }
  }, [open, minimized, initEditor]);

  const handleInsert = () => {
    if (!recognizedText) return;
    const target = lastFocusedInputRef.current;
    if (target) {
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        const input = target as HTMLInputElement | HTMLTextAreaElement;
        const start = input.selectionStart || input.value.length;
        const end = input.selectionEnd || input.value.length;
        const before = input.value.slice(0, start);
        const after = input.value.slice(end);
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          target.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
          "value"
        )?.set;
        nativeInputValueSetter?.call(input, before + recognizedText + after);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        input.setSelectionRange(start + recognizedText.length, start + recognizedText.length);
      } else if (target.isContentEditable) {
        target.focus();
        document.execCommand("insertText", false, recognizedText);
      }
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(recognizedText);
    }
    handleClear();
  };

  const handleCopy = () => {
    if (recognizedText) navigator.clipboard.writeText(recognizedText);
  };

  const handleClear = () => {
    try { editorInstanceRef.current?.clear(); } catch {}
    setRecognizedText("");
  };

  const handleUndo = () => { try { editorInstanceRef.current?.undo(); } catch {} };
  const handleRedo = () => { try { editorInstanceRef.current?.redo(); } catch {} };

  if (!APP_KEY) return null;

  return (
    <>
      {/* Floating toggle button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="hidden md:flex fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg items-center justify-center hover:scale-105 transition-transform"
          title="Open handwriting panel"
          data-testid="button-open-handwriting"
        >
          <PenTool className="w-5 h-5" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className={`hidden md:block fixed z-50 bg-background border rounded-xl shadow-2xl transition-all ${
            minimized
              ? "bottom-20 right-4 w-48 h-10"
              : "bottom-4 right-4 w-[400px] h-[380px] md:flex md:flex-col"
          }`}
          data-testid="handwriting-panel"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-xl shrink-0">
            <GripHorizontal className="w-4 h-4 text-muted-foreground" />
            <PenTool className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold flex-1">Handwriting</span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setMinimized(!minimized)} title={minimized ? "Expand" : "Minimise"}>
              {minimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setOpen(false); setMinimized(false); }} title="Close">
              <X className="w-3 h-3" />
            </Button>
          </div>

          {!minimized && (
            <>
              {/* Canvas */}
              <div
                ref={editorRef}
                className="flex-1 min-h-0 bg-white dark:bg-zinc-900 cursor-crosshair"
                style={{ touchAction: "none" }}
                data-testid="handwriting-canvas"
              />

              {/* Recognized text preview */}
              {recognizedText && (
                <div className="px-3 py-1.5 border-t bg-muted/20 text-xs text-foreground max-h-16 overflow-y-auto" data-testid="handwriting-result">
                  {recognizedText}
                </div>
              )}

              {/* Controls */}
              <div className="flex items-center gap-1 px-3 py-2 border-t bg-muted/10 rounded-b-xl shrink-0">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleUndo} disabled={!canUndo} title="Undo">
                  <Undo2 className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleRedo} disabled={!canRedo} title="Redo">
                  <Redo2 className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleClear} title="Clear">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCopy} disabled={!recognizedText} title="Copy text">
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <div className="flex-1" />
                {loading && <span className="text-[10px] text-muted-foreground">Connecting...</span>}
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!recognizedText}
                  onClick={handleInsert}
                  data-testid="button-insert-handwriting"
                >
                  Insert Text
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
