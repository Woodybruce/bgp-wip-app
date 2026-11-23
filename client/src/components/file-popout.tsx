// Files as thumbnails that open in a pop-out viewer, so a file can be checked
// in the app at any point rather than from the AML file's zip (Woody,
// 23 November 2026: "on the files can the app show the files so can check them
// at any point rather than having to download a zip just a thumbnail can clikc
// and it pops out?"). Images are drawn (zoom, rotate, drag to pan by
// scrolling), every page of a PDF is drawn by pdf.js (the browser's own PDF
// viewer is not used: a phone does not show a PDF inside a page, and the app
// sends PDFs as downloads), text is shown as text, and anything else offers a
// download. Files are fetched with the person's own sign-in; nothing here
// writes anything. What can be shown: shared/file-preview.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/queryClient";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Languages, Loader2, Maximize2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fileBadge, filePreviewKind, inAppFileUrl, type FilePreviewKind } from "@shared/file-preview";

export interface PreviewFile {
  key: string;
  name: string;
  url: string | null;
  mime?: string | null;
  // One short line under the thumbnail and in the viewer's heading ("Proof of address · 12 Nov").
  caption?: string | null;
  // A longer line for the viewer only.
  note?: string | null;
  // A KYC document on a transaction's party: it can be translated into English
  // in the app (23 November 2026; server/kyc-translation.ts).
  translate?: { dealId: string; role: string; documentId: string } | null;
}

// ── Fetching, with the person's own sign-in ─────────────────────────────────

async function fetchFile(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: "include", headers: { ...getAuthHeaders() } });
  if (!res.ok) throw new Error(res.status === 404 ? "This file is no longer stored." : `The file could not be opened (${res.status}).`);
  return res.blob();
}

let pdfjsPromise: Promise<any> | null = null;
function loadPdfJs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then(lib => {
      lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

// Thumbnails: two drawn at a time, each kept for the session (an image's is a
// URL for the file itself, a PDF's a small picture of its first page).
const thumbs = new Map<string, Promise<string | null>>();
let drawing = 0;
const queue: Array<() => void> = [];
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      drawing++;
      work().then(resolve, reject).finally(() => {
        drawing--;
        queue.shift()?.();
      });
    };
    if (drawing < 2) run(); else queue.push(run);
  });
}

function thumbnailFor(file: PreviewFile, kind: FilePreviewKind): Promise<string | null> {
  if (!file.url || !inAppFileUrl(file.url) || (kind !== "image" && kind !== "pdf")) return Promise.resolve(null);
  const cacheKey = `${kind}:${file.url}`;
  let p = thumbs.get(cacheKey);
  if (!p) {
    p = inTurn(async () => {
      const blob = await fetchFile(file.url!);
      if (kind === "image") return URL.createObjectURL(blob);
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      try {
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 240 / Math.max(base.width, base.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) return null;
        await page.render({ canvas, canvasContext: context, viewport, background: "white" }).promise;
        return canvas.toDataURL("image/jpeg", 0.8);
      } finally {
        doc.destroy();
      }
    }).catch(() => null);
    thumbs.set(cacheKey, p);
  }
  return p;
}

function useVisible<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

// ── A thumbnail ─────────────────────────────────────────────────────────────

function FileThumb({ file, onOpen, testId }: { file: PreviewFile; onOpen: () => void; testId: string }) {
  const kind = filePreviewKind(file);
  const [ref, visible] = useVisible<HTMLButtonElement>();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    thumbnailFor(file, kind).then(url => { if (live) { setSrc(url); setFailed(!url && (kind === "image" || kind === "pdf")); } });
    return () => { live = false; };
  }, [visible, file.url, kind]);
  const badge = fileBadge(file);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      title={file.name}
      className="group min-w-0 text-left"
      data-testid={testId}
    >
      <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border bg-muted group-hover:ring-2 group-hover:ring-primary/40">
        {src
          ? <img src={src} alt={file.name} className={kind === "pdf" ? "h-full w-full bg-white object-contain" : "h-full w-full object-cover"} onError={() => { setSrc(null); setFailed(true); }} />
          : visible && !failed && (kind === "image" || kind === "pdf")
            ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : <FileText className="h-7 w-7 text-muted-foreground" />}
        {badge && <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[9px] font-semibold tracking-wide text-muted-foreground">{badge}</span>}
      </span>
      <span className="mt-0.5 block truncate text-[11px] leading-tight">{file.name}</span>
      {file.caption && <span className="block truncate text-[11px] leading-tight text-muted-foreground">{file.caption}</span>}
    </button>
  );
}

/**
 * Files as a grid of thumbnails; a press opens the pop-out on that file, with
 * next and previous through the rest. Shows the first `limit` until Show all.
 */
export function FileThumbGrid({ files, testId, limit = 12, className }: { files: PreviewFile[]; testId: string; limit?: number; className?: string }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, limit);
  if (!files.length) return null;
  return (
    <div className={className}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2" data-testid={testId}>
        {shown.map((f, i) => <FileThumb key={f.key} file={f} onOpen={() => setOpenAt(i)} testId={`${testId}-file-${i}`} />)}
      </div>
      {files.length > shown.length && (
        <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setAll(true)} data-testid={`${testId}-all`}>
          Show all {files.length}
        </button>
      )}
      <FilePopout files={files} index={openAt} onIndex={setOpenAt} />
    </div>
  );
}

// ── The pop-out ─────────────────────────────────────────────────────────────

/** The viewer: `index` null is closed; next and previous move through `files`. */
export function FilePopout({ files, index, onIndex }: { files: PreviewFile[]; index: number | null; onIndex: (i: number | null) => void }) {
  const file = index != null ? files[index] ?? null : null;
  const open = !!file;
  const count = files.length;
  const go = useCallback((step: number) => {
    if (index == null || count < 2) return;
    onIndex((index + step + count) % count);
  }, [index, count, onIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onIndex(null); }}>
      <DialogContent
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:h-[90vh] sm:w-[95vw] sm:max-w-5xl sm:rounded-lg"
        data-testid="file-popout"
      >
        {file && <FileView key={file.key} file={file} position={index! + 1} count={count} onPrev={() => go(-1)} onNext={() => go(1)} />}
      </DialogContent>
    </Dialog>
  );
}

const ZOOMS = [1, 1.5, 2, 3, 4];

function FileView({ file, position, count, onPrev, onNext }: { file: PreviewFile; position: number; count: number; onPrev: () => void; onNext: () => void }) {
  const kind = filePreviewKind(file);
  const inApp = !!file.url && inAppFileUrl(file.url);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [turn, setTurn] = useState(0);
  const [english, setEnglish] = useState(false);

  useEffect(() => {
    if (!inApp) return;
    let live = true;
    let made: string | null = null;
    setLoading(true);
    fetchFile(file.url!)
      .then(b => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setBlobUrl(made);
      })
      .catch(e => { if (live) setError(e?.message || "The file could not be opened."); })
      .finally(() => { if (live) setLoading(false); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file.url, inApp]);

  const zoomable = kind === "image" || kind === "pdf";
  const scale = ZOOMS[zoom];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 pr-12">
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-sm font-semibold" data-testid="file-popout-name">{file.name}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {[file.caption, count > 1 ? `${position} of ${count}` : null].filter(Boolean).join(" · ") || "File"}
          </DialogDescription>
        </div>
        <div className="flex items-center gap-1">
          {count > 1 && (
            <>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={onPrev} aria-label="Previous file" data-testid="file-popout-prev"><ChevronLeft className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={onNext} aria-label="Next file" data-testid="file-popout-next"><ChevronRight className="h-4 w-4" /></Button>
            </>
          )}
          {zoomable && blobUrl && (
            <>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom(z => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Zoom out" data-testid="file-popout-zoom-out"><ZoomOut className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom(z => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in" data-testid="file-popout-zoom-in"><ZoomIn className="h-4 w-4" /></Button>
              {zoom > 0 && <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom(0)} aria-label="Fit to the window"><Maximize2 className="h-4 w-4" /></Button>}
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setTurn(t => (t + 90) % 360)} aria-label="Turn a quarter" data-testid="file-popout-rotate"><RotateCw className="h-4 w-4" /></Button>
            </>
          )}
          {file.translate && (
            <Button type="button" size="sm" variant={english ? "default" : "outline"} className="h-8" onClick={() => setEnglish(v => !v)} data-testid="file-popout-english">
              <Languages className="mr-1 h-3.5 w-3.5" />English
            </Button>
          )}
          {inApp && blobUrl && (
            <Button asChild size="icon" variant="outline" className="h-8 w-8">
              <a href={blobUrl} download={file.name} aria-label="Download" data-testid="file-popout-download"><Download className="h-4 w-4" /></a>
            </Button>
          )}
          {file.url && !inApp && (
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={file.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />Open</a>
            </Button>
          )}
        </div>
      </div>
      {file.note && <p className="border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">{file.note}</p>}
      {english && file.translate && <TranslationPanel t={file.translate} />}
      <div className="relative min-h-0 flex-1 bg-muted/30" data-testid="file-popout-body">
        {!file.url ? (
          <Plain>This file is listed without a stored copy.</Plain>
        ) : !inApp ? (
          <Plain>This file is kept on another site. Open it there.</Plain>
        ) : loading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <Plain>{error}</Plain>
        ) : !blob || !blobUrl ? null : kind === "image" ? (
          <ImageView src={blobUrl} name={file.name} scale={scale} turn={turn} />
        ) : kind === "pdf" ? (
          <PdfView blob={blob} scale={scale} turn={turn} />
        ) : kind === "text" ? (
          <TextView blob={blob} />
        ) : (
          <Plain>
            There is no preview for this kind of file.{" "}
            <a href={blobUrl} download={file.name} className="text-primary underline">Download it</a>
          </Plain>
        )}
      </div>
    </>
  );
}

function Plain({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground" data-testid="file-popout-plain">{children}</div>;
}

// An image fitted to the window, then zoomed: scroll to move around it.
function ImageView({ src, name, scale, turn }: { src: string; name: string; scale: number; turn: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const quarter = turn % 180 === 90;
  const size = useMemo(() => {
    if (!natural || !box.w || !box.h) return null;
    const rw = quarter ? natural.h : natural.w;
    const rh = quarter ? natural.w : natural.h;
    const fit = Math.min((box.w - 16) / rw, (box.h - 16) / rh, 2);
    const s = fit * scale;
    return { outerW: rw * s, outerH: rh * s, imgW: natural.w * s, imgH: natural.h * s };
  }, [natural, box, quarter, scale]);
  if (broken) return <Plain>Your browser cannot show this kind of picture here. Download it to look at it.</Plain>;
  return (
    <div ref={boxRef} className="absolute inset-0 overflow-auto">
      <div className="flex min-h-full min-w-full items-center justify-center p-2">
        <div className="relative shrink-0" style={size ? { width: size.outerW, height: size.outerH } : { width: 1, height: 1 }}>
          <img
            src={src}
            alt={name}
            onLoad={e => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
            onError={() => setBroken(true)}
            className="absolute left-1/2 top-1/2 max-w-none select-none bg-white shadow"
            style={size
              ? { width: size.imgW, height: size.imgH, transform: `translate(-50%, -50%) rotate(${turn}deg)` }
              : { visibility: "hidden" }}
            draggable={false}
            data-testid="file-popout-image"
          />
        </div>
      </div>
    </div>
  );
}

// Every page of a PDF, drawn as it scrolls into view.
const PDF_PAGE_LIMIT = 150;
function PdfView({ blob, scale, turn }: { blob: Blob; scale: number; turn: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    let live = true;
    let loaded: any = null;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        loaded = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (live) setDoc(loaded); else loaded.destroy();
      } catch (e: any) {
        if (live) setError(/password/i.test(e?.message || "") ? "This PDF has a password. Download it to open it." : "This PDF could not be read. Download it to open it.");
      }
    })();
    return () => { live = false; if (loaded) loaded.destroy(); };
  }, [blob]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (error) return <Plain>{error}</Plain>;
  const pages = doc ? Math.min(doc.numPages, PDF_PAGE_LIMIT) : 0;
  return (
    <div ref={boxRef} className="absolute inset-0 overflow-auto" data-testid="file-popout-pdf">
      {!doc ? (
        <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="flex min-w-full flex-col items-center gap-3 p-3">
          {Array.from({ length: pages }, (_, i) => <PdfPage key={i} doc={doc} number={i + 1} width={Math.max(200, (width - 24) * scale)} turn={turn} />)}
          {doc.numPages > pages && <p className="pb-2 text-xs text-muted-foreground">Showing the first {pages} of {doc.numPages} pages. Download the file for the rest.</p>}
        </div>
      )}
    </div>
  );
}

function PdfPage({ doc, number, width, turn }: { doc: any; number: number; width: number; turn: number }) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  useEffect(() => {
    if (!visible || !width) return;
    let live = true;
    let task: any = null;
    (async () => {
      try {
        const page = await doc.getPage(number);
        const rotation = ((page.rotate || 0) + turn) % 360;
        const base = page.getViewport({ scale: 1, rotation });
        if (!live) return;
        setRatio(base.height / base.width);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: (width / base.width) * dpr, rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) return;
        task = page.render({ canvas, canvasContext: context, viewport, background: "white" });
        await task.promise;
      } catch {
        // A page that cannot be drawn stays blank; the others still show.
      }
    })();
    return () => { live = false; task?.cancel?.(); };
  }, [visible, doc, number, width, turn]);
  return (
    <div ref={ref} className="relative bg-white shadow" style={{ width, height: width * ratio }} data-testid={`file-popout-page-${number}`}>
      <canvas ref={canvasRef} className="h-full w-full" />
      <span className="absolute bottom-1 right-2 text-[10px] text-muted-foreground">{number}</span>
    </div>
  );
}

const TEXT_LIMIT = 400_000;
function TextView({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    blob.slice(0, TEXT_LIMIT).text().then(t => { if (live) setText(t); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [blob]);
  if (text == null) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="absolute inset-0 overflow-auto p-3">
      <pre className="whitespace-pre-wrap break-words rounded bg-background p-3 text-xs">{text}{blob.size > TEXT_LIMIT ? "\n\n(The rest of the file is not shown. Download it to read it all.)" : ""}</pre>
    </div>
  );
}

// The document in English, made in the app on a press (23 November 2026). Not a
// certified translation; HMRC can ask for one (MLR 2017 reg 66).
function TranslationPanel({ t }: { t: { dealId: string; role: string; documentId: string } }) {
  const base = `/api/deals/${t.dealId}/parties/${t.role}/documents/${t.documentId}`;
  const [state, setState] = useState<{ loading: boolean; text: string | null; language: string | null; english: boolean | null; error: string | null; note: string | null; cut: boolean }>(
    { loading: true, text: null, language: null, english: null, error: null, note: null, cut: false });
  const [working, setWorking] = useState(false);
  const show = (body: any) => {
    const tr = body?.translation || null;
    setState({ loading: false, text: tr?.translation || null, language: tr?.language || null, english: tr?.english ?? null, error: tr?.error || null, note: body?.note || null, cut: !!tr?.cut });
  };
  useEffect(() => {
    let live = true;
    fetch(`${base}/translation`, { credentials: "include", headers: getAuthHeaders() })
      .then(r => r.json().then(b => (r.ok ? b : Promise.reject(new Error(b?.message || "The translation could not be read.")))))
      .then(b => { if (live) show(b); })
      .catch(e => { if (live) setState(s => ({ ...s, loading: false, error: e?.message || "The translation could not be read." })); });
    return () => { live = false; };
  }, [base]);
  const translate = async () => {
    setWorking(true);
    try {
      const r = await fetch(`${base}/translate`, { method: "POST", credentials: "include", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, body: "{}" });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.message || "It could not be translated.");
      show(b);
    } catch (e: any) {
      setState(s => ({ ...s, error: e?.message || "It could not be translated." }));
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="max-h-[40vh] overflow-y-auto border-b bg-background px-3 py-2 text-xs" data-testid="file-popout-translation">
      {state.loading ? <p className="text-muted-foreground">Reading…</p>
        : state.english ? <p className="text-muted-foreground">It is already in English.</p>
        : state.text ? (
          <>
            <p className="mb-1.5 text-muted-foreground">{state.language ? `From ${state.language}. ` : ""}{state.note}</p>
            {state.cut && <p className="mb-1.5 text-amber-700 dark:text-amber-300">Cut short: the document is long. Read the original for the rest.</p>}
            <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">{state.text}</pre>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {state.error && <span className="text-amber-700 dark:text-amber-300">Not translated: {state.error}</span>}
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={working} onClick={() => void translate()} data-testid="file-popout-translate">
              {working ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}{working ? "Translating…" : "Translate into English"}
            </Button>
          </div>
        )}
    </div>
  );
}
