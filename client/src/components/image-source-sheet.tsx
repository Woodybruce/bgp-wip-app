// Image source chooser — shown BEFORE iOS's native file menu so the app can
// offer "Search the web" alongside the camera/library (Woody, 2026-08-23:
// the Apple drop-down can't be extended, so we put our own sheet in front).
// "Photo library / camera" hands off to the caller's hidden <input type=file>
// (which then shows Apple's own menu); "Search the web" searches Google
// images via /api/image-search and returns the picked image's URL.
import { useState } from "react";
import { getAuthHeaders } from "@/lib/queryClient";
import { Camera, Globe, Loader2, Search, X } from "lucide-react";

type WebResult = { url: string; thumb: string; title: string };

export function ImageSourceSheet({ open, onClose, onPickFile, onWebSelect, title }: {
  open: boolean;
  onClose: () => void;
  onPickFile: () => void;
  onWebSelect: (url: string) => void | Promise<void>;
  title?: string;
}) {
  const [mode, setMode] = useState<"menu" | "web">("menu");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WebResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingUrl, setSettingUrl] = useState<string | null>(null);

  if (!open) return null;

  const close = () => {
    setMode("menu"); setQuery(""); setResults([]); setError(null); setSettingUrl(null);
    onClose();
  };

  const runSearch = async () => {
    if (!query.trim() || searching) return;
    setSearching(true); setError(null);
    try {
      const r = await fetch(`/api/image-search?q=${encodeURIComponent(query.trim())}`, {
        credentials: "include", headers: getAuthHeaders(),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || "Search failed");
      setResults(j.results || []);
      if (!(j.results || []).length) setError("No images found — try different words.");
    } catch (e: any) {
      setError(e?.message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const pick = async (url: string) => {
    setSettingUrl(url);
    try {
      await onWebSelect(url);
      close();
    } catch (e: any) {
      setError(e?.message || "Couldn't use that image — try another.");
      setSettingUrl(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center" onClick={close}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg bg-white dark:bg-card rounded-t-3xl shadow-xl px-4 pt-4 max-h-[80vh] flex flex-col"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">{title || "Choose a photo"}</p>
          <button onClick={close} className="p-1.5 rounded-full active:bg-gray-100" data-testid="button-image-sheet-close" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === "menu" ? (
          <div className="space-y-2 pb-2">
            <button
              onClick={() => { close(); onPickFile(); }}
              className="w-full flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-border px-4 py-3.5 active:bg-gray-50 text-left"
              data-testid="button-image-source-device"
            >
              <Camera className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Photo library or camera</p>
                <p className="text-[11px] text-muted-foreground">Pick from your phone</p>
              </div>
            </button>
            <button
              onClick={() => setMode("web")}
              className="w-full flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-border px-4 py-3.5 active:bg-gray-50 text-left"
              data-testid="button-image-source-web"
            >
              <Globe className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Search the web</p>
                <p className="text-[11px] text-muted-foreground">Find an image online and use it directly</p>
              </div>
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 flex items-center gap-2 rounded-full bg-gray-100 dark:bg-muted px-3 py-2">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                  placeholder="Search images…"
                  className="flex-1 bg-transparent text-sm outline-none"
                  data-testid="input-image-web-search"
                />
              </div>
              <button
                onClick={runSearch}
                disabled={searching || !query.trim()}
                className="shrink-0 px-3.5 py-2 rounded-full bg-[hsl(var(--mobile-chrome))] text-white text-sm font-medium disabled:opacity-50"
                data-testid="button-image-web-search"
              >
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
              </button>
            </div>
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            <div className="overflow-y-auto grid grid-cols-3 gap-2 pb-2">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => pick(r.url)}
                  disabled={!!settingUrl}
                  className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 active:opacity-80"
                  data-testid={`image-web-result-${i}`}
                >
                  <img src={r.thumb} alt={r.title} className="w-full h-full object-cover" loading="lazy" />
                  {settingUrl === r.url && (
                    <span className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
