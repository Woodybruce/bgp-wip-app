import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { PenTool, Undo2, Redo2, Trash2, ArrowDown, Loader2 } from "lucide-react";

const APP_KEY = import.meta.env.VITE_MYSCRIPT_APP_KEY || "";
const HMAC_KEY = import.meta.env.VITE_MYSCRIPT_HMAC_KEY || "";

interface TaskNotesCanvasProps {
  onTextRecognized: (text: string) => void;
  placeholder?: string;
}

export function TaskNotesCanvas({ onTextRecognized, placeholder = "Write here with stylus or mouse..." }: TaskNotesCanvasProps) {
  const [recognizedText, setRecognizedText] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<any>(null);

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
      setReady(true);

      editorRef.current.addEventListener("exported", ((e: CustomEvent) => {
        const exports = e.detail;
        const jiix = exports?.["application/vnd.myscript.jiix"];
        if (jiix) {
          const parsed = typeof jiix === "string" ? JSON.parse(jiix) : jiix;
          const text = parsed.label || parsed.words?.map((w: any) => w.label).join(" ") || "";
          setRecognizedText(text);
        }
      }) as EventListener);

      editorRef.current.addEventListener("changed", ((e: CustomEvent) => {
        setCanUndo(e.detail?.canUndo ?? false);
        setCanRedo(e.detail?.canRedo ?? false);
      }) as EventListener);
    } catch (err) {
      console.error("[TaskNotesCanvas] Failed to init:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(initEditor, 100);
    return () => clearTimeout(t);
  }, [initEditor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { editorInstanceRef.current?.close?.(); } catch {}
      editorInstanceRef.current = null;
    };
  }, []);

  if (!APP_KEY) {
    return (
      <div className="border rounded-lg p-4 bg-muted/20 text-center text-xs text-muted-foreground">
        <PenTool className="w-5 h-5 mx-auto mb-2 opacity-40" />
        Handwriting not configured — set MYSCRIPT_APP_KEY in environment
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-muted/10">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/20">
        <PenTool className="w-3 h-3 text-primary" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase flex-1">Handwrite</span>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { try { editorInstanceRef.current?.undo(); } catch {} }} disabled={!canUndo}>
          <Undo2 className="w-3 h-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { try { editorInstanceRef.current?.redo(); } catch {} }} disabled={!canRedo}>
          <Redo2 className="w-3 h-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { try { editorInstanceRef.current?.clear(); } catch {}; setRecognizedText(""); }}>
          <Trash2 className="w-3 h-3" />
        </Button>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Canvas */}
      <div
        ref={editorRef}
        className="w-full bg-white dark:bg-zinc-900 cursor-crosshair relative"
        style={{ touchAction: "none", height: "160px" }}
      >
        {!ready && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {placeholder}
          </div>
        )}
      </div>

      {/* Recognized text + use button */}
      {recognizedText && (
        <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/10">
          <p className="text-xs text-foreground flex-1 line-clamp-2">{recognizedText}</p>
          <Button
            size="sm"
            className="h-7 text-xs shrink-0 gap-1"
            onClick={() => {
              onTextRecognized(recognizedText);
              try { editorInstanceRef.current?.clear(); } catch {}
              setRecognizedText("");
            }}
          >
            <ArrowDown className="w-3 h-3" />
            Use as description
          </Button>
        </div>
      )}
    </div>
  );
}
