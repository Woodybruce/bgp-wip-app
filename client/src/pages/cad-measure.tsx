import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Ruler, SquareDashedBottom, MousePointer, ZoomIn, ZoomOut,
  RotateCcw, Loader2, Move, Trash2, FileText, Info, Maximize2,
  Undo2, Redo2, Scaling, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface DxfEntity {
  type: string;
  vertices?: { x: number; y: number }[];
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  layer?: string;
  color?: number;
}

interface ParsedDxf {
  entities: DxfEntity[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Measurement {
  id: string;
  type: "distance" | "area";
  points: { x: number; y: number }[];
  value: number;
  unit: string;
}

type Tool = "pan" | "measure" | "area" | "calibrate";

// Metres → target unit factors. PDF calibration is stored as metres-per-point.
const METRE_TO_UNIT: Record<string, number> = {
  mm: 1000,
  m: 1,
  ft: 3.28084,
  in: 39.3701,
};

const DXF_COLORS: Record<number, string> = {
  0: "#000000", 1: "#FF0000", 2: "#FFFF00", 3: "#00FF00", 4: "#00FFFF",
  5: "#0000FF", 6: "#FF00FF", 7: "#000000", 8: "#808080", 9: "#C0C0C0",
};

function parseDxfContent(text: string): ParsedDxf {
  const DxfParser = (window as any).__dxfParser;
  if (!DxfParser) throw new Error("DXF parser not loaded");
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf || !dxf.entities) throw new Error("No entities found in DXF file");

  const entities: DxfEntity[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const updateBounds = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const e of dxf.entities) {
    const entity: DxfEntity = {
      type: e.type,
      layer: e.layer,
      color: e.colorIndex || e.color,
    };

    if (e.type === "LINE") {
      entity.startPoint = { x: e.vertices?.[0]?.x ?? 0, y: e.vertices?.[0]?.y ?? 0 };
      entity.endPoint = { x: e.vertices?.[1]?.x ?? 0, y: e.vertices?.[1]?.y ?? 0 };
      updateBounds(entity.startPoint.x, entity.startPoint.y);
      updateBounds(entity.endPoint.x, entity.endPoint.y);
    } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      entity.vertices = (e.vertices || []).map((v: any) => ({ x: v.x, y: v.y }));
      entity.vertices?.forEach(v => updateBounds(v.x, v.y));
    } else if (e.type === "CIRCLE") {
      entity.center = { x: e.center?.x ?? 0, y: e.center?.y ?? 0 };
      entity.radius = e.radius || 0;
      updateBounds(entity.center.x - (entity.radius ?? 0), entity.center.y - (entity.radius ?? 0));
      updateBounds(entity.center.x + (entity.radius ?? 0), entity.center.y + (entity.radius ?? 0));
    } else if (e.type === "ARC") {
      entity.center = { x: e.center?.x ?? 0, y: e.center?.y ?? 0 };
      entity.radius = e.radius || 0;
      entity.startAngle = e.startAngle;
      entity.endAngle = e.endAngle;
      updateBounds(entity.center.x - (entity.radius ?? 0), entity.center.y - (entity.radius ?? 0));
      updateBounds(entity.center.x + (entity.radius ?? 0), entity.center.y + (entity.radius ?? 0));
    } else if (e.type === "ELLIPSE") {
      const cx = e.center?.x ?? 0, cy = e.center?.y ?? 0;
      const mx = e.majorAxisEndPoint?.x ?? 1, my = e.majorAxisEndPoint?.y ?? 0;
      const majR = Math.sqrt(mx * mx + my * my);
      entity.center = { x: cx, y: cy };
      entity.radius = majR;
      updateBounds(cx - majR, cy - majR);
      updateBounds(cx + majR, cy + majR);
    } else {
      continue;
    }

    entities.push(entity);
  }

  if (minX === Infinity) { minX = 0; minY = 0; maxX = 100; maxY = 100; }

  return { entities, bounds: { minX, minY, maxX, maxY } };
}

function buildParsedDxf(rawEntities: DxfEntity[]): ParsedDxf {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const updateBounds = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const e of rawEntities) {
    if (e.startPoint) { updateBounds(e.startPoint.x, e.startPoint.y); }
    if (e.endPoint) { updateBounds(e.endPoint.x, e.endPoint.y); }
    if (e.center && e.radius != null) {
      updateBounds(e.center.x - e.radius, e.center.y - e.radius);
      updateBounds(e.center.x + e.radius, e.center.y + e.radius);
    }
    if (e.vertices) { e.vertices.forEach(v => updateBounds(v.x, v.y)); }
  }
  if (minX === Infinity) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
  return { entities: rawEntities, bounds: { minX, minY, maxX, maxY } };
}

function getEntityColor(entity: DxfEntity, isDark: boolean): string {
  if (entity.color && DXF_COLORS[entity.color]) return DXF_COLORS[entity.color];
  return isDark ? "#94a3b8" : "#374151";
}

export default function CadMeasurePage() {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dxfData, setDxfData] = useState<ParsedDxf | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("pan");
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [redoStack, setRedoStack] = useState<Measurement[]>([]);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [unitScale, setUnitScale] = useState(1);
  const [unitLabel, setUnitLabel] = useState("mm");
  const [mouseWorldPos, setMouseWorldPos] = useState<{ x: number; y: number } | null>(null);
  const [entityCount, setEntityCount] = useState(0);

  // PDF state
  const [pdfImage, setPdfImage] = useState<HTMLCanvasElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfPageNum, setPdfPageNum] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [calibration, setCalibration] = useState<number | null>(null);
  const [pendingCalibration, setPendingCalibration] = useState<{ points: { x: number; y: number }[]; pixelDistance: number } | null>(null);
  const [calibInput, setCalibInput] = useState({ value: "", unit: "m" });

  const isPdfMode = !!pdfImage;

  // Effective unit-scale: for DXF uses the manual mm-based unitScale. For PDF w/ calibration,
  // metresPerPoint × metresToTargetFactor. Uncalibrated PDF shows raw "pt".
  const effectiveUnitScale = isPdfMode
    ? (calibration !== null ? calibration * (METRE_TO_UNIT[unitLabel] ?? 1) : 1)
    : unitScale;
  const effectiveUnitLabel = isPdfMode && calibration === null ? "pt" : unitLabel;

  const screenToWorld = useCallback((sx: number, sy: number) => {
    if (!dxfData) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const cx = sx - rect.left;
    const cy = sy - rect.top;
    const { bounds } = dxfData;
    const drawW = bounds.maxX - bounds.minX;
    const drawH = bounds.maxY - bounds.minY;
    const padding = 40;
    const scaleX = (canvas.width - 2 * padding) / drawW;
    const scaleY = (canvas.height - 2 * padding) / drawH;
    const s = Math.min(scaleX, scaleY) * scale;
    const ox = padding + (canvas.width - 2 * padding - drawW * s) / 2 + offset.x;
    const oy = padding + (canvas.height - 2 * padding - drawH * s) / 2 + offset.y;
    const wx = (cx - ox) / s + bounds.minX;
    const wy = bounds.maxY - (cy - oy) / s;
    return { x: wx, y: wy };
  }, [dxfData, scale, offset]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dxfData) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isDark = document.documentElement.classList.contains("dark");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = isDark ? "#1e293b" : "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { entities, bounds } = dxfData;
    const drawW = bounds.maxX - bounds.minX;
    const drawH = bounds.maxY - bounds.minY;
    if (drawW === 0 || drawH === 0) return;

    const padding = 40;
    const scaleX = (canvas.width - 2 * padding) / drawW;
    const scaleY = (canvas.height - 2 * padding) / drawH;
    const s = Math.min(scaleX, scaleY) * scale;
    const ox = padding + (canvas.width - 2 * padding - drawW * s) / 2 + offset.x;
    const oy = padding + (canvas.height - 2 * padding - drawH * s) / 2 + offset.y;

    const toScreen = (x: number, y: number) => ({
      sx: (x - bounds.minX) * s + ox,
      sy: (bounds.maxY - y) * s + oy,
    });

    // PDF background (if loaded). Drawn before entities so measurements sit on top.
    if (pdfImage) {
      const tl = toScreen(bounds.minX, bounds.maxY);
      ctx.drawImage(pdfImage, tl.sx, tl.sy, drawW * s, drawH * s);
    }

    ctx.lineWidth = Math.max(0.5, 1 / scale);

    for (const entity of entities) {
      ctx.strokeStyle = getEntityColor(entity, isDark);
      ctx.beginPath();

      if (entity.type === "LINE" && entity.startPoint && entity.endPoint) {
        const p1 = toScreen(entity.startPoint.x, entity.startPoint.y);
        const p2 = toScreen(entity.endPoint.x, entity.endPoint.y);
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
      } else if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.vertices) {
        for (let i = 0; i < entity.vertices.length; i++) {
          const p = toScreen(entity.vertices[i].x, entity.vertices[i].y);
          if (i === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
      } else if (entity.type === "CIRCLE" && entity.center && entity.radius) {
        const c = toScreen(entity.center.x, entity.center.y);
        ctx.arc(c.sx, c.sy, entity.radius * s, 0, Math.PI * 2);
      } else if (entity.type === "ARC" && entity.center && entity.radius) {
        const c = toScreen(entity.center.x, entity.center.y);
        const startA = ((entity.startAngle || 0) * Math.PI) / 180;
        const endA = ((entity.endAngle || 360) * Math.PI) / 180;
        ctx.arc(c.sx, c.sy, entity.radius * s, -endA, -startA);
      } else if (entity.type === "ELLIPSE" && entity.center && entity.radius) {
        const c = toScreen(entity.center.x, entity.center.y);
        ctx.arc(c.sx, c.sy, entity.radius * s, 0, Math.PI * 2);
      }

      ctx.stroke();
    }

    for (const m of measurements) {
      ctx.strokeStyle = m.type === "distance" ? "#ef4444" : "#3b82f6";
      ctx.fillStyle = m.type === "distance" ? "#ef4444" : "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      for (let i = 0; i < m.points.length; i++) {
        const p = toScreen(m.points[i].x, m.points[i].y);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      if (m.type === "area" && m.points.length > 2) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      for (const pt of m.points) {
        const p = toScreen(pt.x, pt.y);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (m.points.length >= 2) {
        const midIdx = Math.floor(m.points.length / 2);
        const labelPt = toScreen(m.points[midIdx].x, m.points[midIdx].y);
        ctx.font = "bold 12px Inter, sans-serif";
        const label = m.type === "distance"
          ? `${(m.value * effectiveUnitScale).toFixed(2)} ${effectiveUnitLabel}`
          : `${(m.value * effectiveUnitScale * effectiveUnitScale).toFixed(2)} ${effectiveUnitLabel}\u00B2`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = isDark ? "rgba(30,41,59,0.9)" : "rgba(255,255,255,0.9)";
        ctx.fillRect(labelPt.sx - tw / 2 - 4, labelPt.sy - 20, tw + 8, 18);
        ctx.fillStyle = m.type === "distance" ? "#ef4444" : "#3b82f6";
        ctx.fillText(label, labelPt.sx - tw / 2, labelPt.sy - 7);
      }
    }

    if (currentPoints.length > 0) {
      const toolColor = activeTool === "measure" ? "#f59e0b" : activeTool === "calibrate" ? "#10b981" : "#8b5cf6";
      ctx.strokeStyle = toolColor;
      ctx.fillStyle = toolColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let i = 0; i < currentPoints.length; i++) {
        const p = toScreen(currentPoints[i].x, currentPoints[i].y);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      if (mouseWorldPos) {
        const mp = toScreen(mouseWorldPos.x, mouseWorldPos.y);
        ctx.lineTo(mp.sx, mp.sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      for (const pt of currentPoints) {
        const p = toScreen(pt.x, pt.y);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = isDark ? "#64748b" : "#94a3b8";
    ctx.font = "11px Inter, sans-serif";
    ctx.fillText(`Scale: ${scale.toFixed(1)}x | ${isPdfMode ? `${pdfNumPages} page${pdfNumPages === 1 ? "" : "s"}` : `${entities.length} entities`}`, 10, canvas.height - 10);
    if (mouseWorldPos) {
      ctx.fillText(
        `X: ${(mouseWorldPos.x * effectiveUnitScale).toFixed(1)} Y: ${(mouseWorldPos.y * effectiveUnitScale).toFixed(1)} ${effectiveUnitLabel}`,
        10, canvas.height - 26
      );
    }
  }, [dxfData, pdfImage, pdfNumPages, isPdfMode, scale, offset, measurements, currentPoints, mouseWorldPos, activeTool, effectiveUnitScale, effectiveUnitLabel]);

  useEffect(() => { drawCanvas(); }, [drawCanvas]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      drawCanvas();
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawCanvas]);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/dxf-parser/dist/dxf-parser.min.js";
    script.onload = () => {
      (window as any).__dxfParser = (window as any).DxfParser;
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  const renderPdfPage = useCallback(async (doc: any, pageNum: number): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> => {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const off = document.createElement("canvas");
    off.width = viewport.width;
    off.height = viewport.height;
    const octx = off.getContext("2d")!;
    await page.render({ canvasContext: octx, viewport }).promise;
    const vp1 = page.getViewport({ scale: 1 });
    return { canvas: off, width: vp1.width, height: vp1.height };
  }, []);

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    try {
      const name = file.name.toLowerCase();
      const isPdf = name.endsWith(".pdf");
      const isDwg = name.endsWith(".dwg");

      if (isPdf) {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url
        ).href;
        const buf = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const { canvas: pageCanvas, width: pdfW, height: pdfH } = await renderPdfPage(doc, 1);
        setPdfDoc(doc);
        setPdfImage(pageCanvas);
        setPdfPageNum(1);
        setPdfNumPages(doc.numPages);
        setDxfData({ entities: [], bounds: { minX: 0, minY: 0, maxX: pdfW, maxY: pdfH } });
        setFileName(file.name);
        setEntityCount(0);
        setCalibration(null);
      } else if (isDwg) {
        const formData = new FormData();
        formData.append("file", file);
        const resp = await fetch("/api/cad/convert-dwg", { method: "POST", body: formData });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ message: "Server error" }));
          throw new Error(err.message || "Failed to convert DWG");
        }
        const { entities: rawEntities } = await resp.json();
        const parsed = buildParsedDxf(rawEntities);
        setPdfImage(null); setPdfDoc(null); setPdfNumPages(0);
        setDxfData(parsed);
        setFileName(file.name);
        setEntityCount(parsed.entities.length);
      } else {
        const text = await file.text();
        const parsed = parseDxfContent(text);
        setPdfImage(null); setPdfDoc(null); setPdfNumPages(0);
        setDxfData(parsed);
        setFileName(file.name);
        setEntityCount(parsed.entities.length);
      }

      setScale(1);
      setOffset({ x: 0, y: 0 });
      setMeasurements([]);
      setCurrentPoints([]);
      toast({
        title: "File loaded",
        description: isPdf
          ? `PDF loaded — use Set Scale to calibrate real-world dimensions`
          : `${entityCount || "?"} entities from ${file.name}`,
      });
    } catch (e: any) {
      toast({ title: "Failed to parse file", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const gotoPdfPage = useCallback(async (newPageNum: number) => {
    if (!pdfDoc || newPageNum < 1 || newPageNum > pdfNumPages) return;
    setLoading(true);
    try {
      const { canvas: pageCanvas, width: pdfW, height: pdfH } = await renderPdfPage(pdfDoc, newPageNum);
      setPdfImage(pageCanvas);
      setPdfPageNum(newPageNum);
      setDxfData({ entities: [], bounds: { minX: 0, minY: 0, maxX: pdfW, maxY: pdfH } });
      setMeasurements([]);
      setCurrentPoints([]);
    } finally {
      setLoading(false);
    }
  }, [pdfDoc, pdfNumPages, renderPdfPage]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    const name = file?.name?.toLowerCase() ?? "";
    if (file && (name.endsWith(".dxf") || name.endsWith(".dwg") || name.endsWith(".pdf"))) {
      handleFileUpload(file);
    } else {
      toast({ title: "Unsupported file", description: "Please drop a .dxf, .dwg or .pdf file", variant: "destructive" });
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!dxfData || activeTool === "pan") return;
    const world = screenToWorld(e.clientX, e.clientY);

    if (activeTool === "measure") {
      if (currentPoints.length === 0) {
        setCurrentPoints([world]);
      } else {
        const p1 = currentPoints[0];
        const dist = Math.sqrt((world.x - p1.x) ** 2 + (world.y - p1.y) ** 2);
        setMeasurements(prev => [...prev, {
          id: Date.now().toString(),
          type: "distance",
          points: [p1, world],
          value: dist,
          unit: unitLabel,
        }]);
        setRedoStack([]);
        setCurrentPoints([]);
      }
    } else if (activeTool === "area") {
      setCurrentPoints(prev => [...prev, world]);
    } else if (activeTool === "calibrate") {
      if (currentPoints.length === 0) {
        setCurrentPoints([world]);
      } else {
        const p1 = currentPoints[0];
        const pixelDist = Math.sqrt((world.x - p1.x) ** 2 + (world.y - p1.y) ** 2);
        setPendingCalibration({ points: [p1, world], pixelDistance: pixelDist });
        setCalibInput({ value: "", unit: unitLabel in METRE_TO_UNIT ? unitLabel : "m" });
        setCurrentPoints([]);
      }
    }
  };

  const handleCanvasDoubleClick = () => {
    if (activeTool === "area" && currentPoints.length >= 3) {
      let area = 0;
      const pts = currentPoints;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        area += pts[i].x * pts[j].y;
        area -= pts[j].x * pts[i].y;
      }
      area = Math.abs(area) / 2;
      setMeasurements(prev => [...prev, {
        id: Date.now().toString(),
        type: "area",
        points: [...currentPoints],
        value: area,
        unit: unitLabel,
      }]);
      setRedoStack([]);
      setCurrentPoints([]);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === "pan" || e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
    if (dxfData) {
      setMouseWorldPos(screenToWorld(e.clientX, e.clientY));
    }
  };

  const handleMouseUp = () => { setIsPanning(false); };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.1, Math.min(50, prev * factor)));
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const clearMeasurements = () => {
    setMeasurements([]);
    setRedoStack([]);
    setCurrentPoints([]);
  };

  const handleUndo = () => {
    // If the user is mid-polygon (area tool), undo the last clicked point first
    if (currentPoints.length > 0) {
      setCurrentPoints(prev => prev.slice(0, -1));
      return;
    }
    if (measurements.length === 0) return;
    const last = measurements[measurements.length - 1];
    setMeasurements(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, last]);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setMeasurements(prev => [...prev, next]);
  };

  const canUndo = measurements.length > 0 || currentPoints.length > 0;
  const canRedo = redoStack.length > 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [measurements, redoStack, currentPoints]);

  const totalArea = measurements
    .filter(m => m.type === "area")
    .reduce((sum, m) => sum + m.value * effectiveUnitScale * effectiveUnitScale, 0);

  const totalDistance = measurements
    .filter(m => m.type === "distance")
    .reduce((sum, m) => sum + m.value * effectiveUnitScale, 0);

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Ruler className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Cann CAD</h1>
              <p className="text-xs text-muted-foreground">
                {fileName ? `${fileName} — ${entityCount} entities` : "Upload a DXF or DWG floor plan to measure"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 mr-2">
              <label className="text-xs text-muted-foreground">Units:</label>
              <select
                className="text-xs border rounded px-2 py-1 bg-background"
                value={unitLabel}
                onChange={(e) => {
                  const v = e.target.value;
                  setUnitLabel(v);
                  if (v === "mm") setUnitScale(1);
                  else if (v === "m") setUnitScale(0.001);
                  else if (v === "ft") setUnitScale(0.00328084);
                  else if (v === "in") setUnitScale(0.0393701);
                }}
                data-testid="select-cad-units"
              >
                <option value="mm">mm</option>
                <option value="m">metres</option>
                <option value="ft">feet</option>
                <option value="in">inches</option>
              </select>
            </div>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".dxf,.dwg,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                data-testid="input-cad-file"
              />
              <Button variant="outline" size="sm" className="gap-1.5 pointer-events-none" data-testid="button-upload-dxf">
                <Upload className="w-3.5 h-3.5" />
                {fileName ? "Change File" : "Upload DXF/DWG/PDF"}
              </Button>
            </label>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-14 border-r bg-muted/30 flex flex-col items-center py-2 gap-1">
            {([
              { tool: "pan" as Tool, icon: Move, label: "Pan" },
              { tool: "measure" as Tool, icon: Ruler, label: "Measure" },
              { tool: "area" as Tool, icon: SquareDashedBottom, label: "Area" },
              ...(isPdfMode ? [{ tool: "calibrate" as Tool, icon: Scaling, label: "Set Scale" }] : []),
            ]).map(({ tool, icon: Icon, label }) => (
              <button
                key={tool}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${activeTool === tool ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
                onClick={() => { setActiveTool(tool); setCurrentPoints([]); }}
                title={label}
                data-testid={`tool-${tool}`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}

            <div className="h-px bg-border w-8 my-1" />

            <button
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground"
              onClick={() => setScale(prev => Math.min(50, prev * 1.3))}
              title="Zoom In"
              data-testid="tool-zoom-in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground"
              onClick={() => setScale(prev => Math.max(0.1, prev * 0.7))}
              title="Zoom Out"
              data-testid="tool-zoom-out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground"
              onClick={resetView}
              title="Reset View"
              data-testid="tool-reset"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            <div className="h-px bg-border w-8 my-1" />

            <button
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              onClick={handleUndo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              data-testid="tool-undo"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              onClick={handleRedo}
              disabled={!canRedo}
              title="Redo (⇧⌘Z)"
              data-testid="tool-redo"
            >
              <Redo2 className="w-4 h-4" />
            </button>

            <div className="h-px bg-border w-8 my-1" />

            <button
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-muted text-red-500"
              onClick={clearMeasurements}
              title="Clear Measurements"
              data-testid="tool-clear"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div
            ref={containerRef}
            className="flex-1 relative overflow-hidden"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            {!dxfData && !loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="border-2 border-dashed rounded-2xl p-12 text-center max-w-md"
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-primary/60" />
                  </div>
                  <h2 className="text-lg font-semibold mb-2">Drop a DXF, DWG or PDF file here</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Or click "Upload DXF/DWG/PDF" above. Scaled PDFs work too — load one, click Set Scale, mark a known dimension, and all measurements become real-world.
                  </p>
                  <div className="flex items-start gap-2 text-left bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground mb-1">Supported features</p>
                      <p>CAD files: lines, polylines, circles, arcs, ellipses. PDFs: scan architect plans, calibrate with a known dimension (e.g. a door width), then measure floor areas in m² or sq ft directly.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Parsing file...</span>
              </div>
            )}

            <canvas
              ref={canvasRef}
              className={`w-full h-full ${!dxfData ? "hidden" : ""} ${activeTool === "pan" ? "cursor-grab" : "cursor-crosshair"} ${isPanning ? "cursor-grabbing" : ""}`}
              onClick={handleCanvasClick}
              onDoubleClick={handleCanvasDoubleClick}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
              data-testid="canvas-cad"
            />

            {dxfData && activeTool !== "pan" && (
              <div className="absolute top-3 left-3 bg-background/90 backdrop-blur border rounded-lg px-3 py-2 text-xs shadow-sm">
                {activeTool === "measure" && (
                  <p>{currentPoints.length === 0 ? "Click start point" : "Click end point to measure"}</p>
                )}
                {activeTool === "area" && (
                  <p>{currentPoints.length < 3 ? `Click corners (${currentPoints.length}/3+ points)` : "Double-click to finish area"}</p>
                )}
                {activeTool === "calibrate" && (
                  <p>{currentPoints.length === 0 ? "Click one end of a known dimension" : "Click the other end"}</p>
                )}
              </div>
            )}

            {isPdfMode && pdfNumPages > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur border rounded-lg flex items-center gap-1 px-2 py-1 shadow-sm">
                <button className="p-1 rounded hover:bg-muted disabled:opacity-30" onClick={() => gotoPdfPage(pdfPageNum - 1)} disabled={pdfPageNum <= 1 || loading} title="Previous page">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs px-2">Page {pdfPageNum} / {pdfNumPages}</span>
                <button className="p-1 rounded hover:bg-muted disabled:opacity-30" onClick={() => gotoPdfPage(pdfPageNum + 1)} disabled={pdfPageNum >= pdfNumPages || loading} title="Next page">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {isPdfMode && calibration !== null && (
              <div className="absolute top-3 right-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-1.5 text-xs shadow-sm">
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">Scale set</span>
                <span className="text-muted-foreground ml-2">1 pt = {(calibration * 1000).toFixed(3)} mm</span>
                <button className="ml-2 text-red-600 hover:underline" onClick={() => setCalibration(null)}>Reset</button>
              </div>
            )}
            {isPdfMode && calibration === null && (
              <div className="absolute top-3 right-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5 text-xs shadow-sm">
                <span className="text-amber-800 dark:text-amber-400 font-medium">Not calibrated</span>
                <span className="text-muted-foreground ml-2">Click <Scaling className="inline w-3 h-3 mx-0.5" /> Set Scale to calibrate</span>
              </div>
            )}
          </div>

          {dxfData && measurements.length > 0 && (
            <div className="w-60 border-l bg-muted/10 overflow-y-auto p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Measurements</h3>

              {totalDistance > 0 && (
                <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-2.5 mb-2">
                  <p className="text-[10px] text-red-600 font-medium uppercase tracking-wider">Total Distance</p>
                  <p className="text-lg font-bold text-red-700 dark:text-red-400">{totalDistance.toFixed(2)} {effectiveUnitLabel}</p>
                </div>
              )}

              {totalArea > 0 && (
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-2.5 mb-2">
                  <p className="text-[10px] text-blue-600 font-medium uppercase tracking-wider">Total Area</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">
                    {totalArea.toFixed(2)} {effectiveUnitLabel}&sup2;
                    {effectiveUnitLabel === "m" && <span className="text-xs font-normal ml-1">({(totalArea * 10.7639).toFixed(0)} sq ft)</span>}
                    {effectiveUnitLabel === "ft" && <span className="text-xs font-normal ml-1">({(totalArea * 0.0929).toFixed(2)} m&sup2;)</span>}
                  </p>
                </div>
              )}

              <div className="space-y-1.5 mt-3">
                {measurements.map((m, i) => (
                  <div key={m.id} className="flex items-center justify-between bg-background rounded p-2 border text-xs">
                    <div className="flex items-center gap-1.5">
                      {m.type === "distance" ? (
                        <Ruler className="w-3 h-3 text-red-500" />
                      ) : (
                        <SquareDashedBottom className="w-3 h-3 text-blue-500" />
                      )}
                      <span className="font-medium">
                        {m.type === "distance"
                          ? `${(m.value * effectiveUnitScale).toFixed(2)} ${effectiveUnitLabel}`
                          : `${(m.value * effectiveUnitScale * effectiveUnitScale).toFixed(2)} ${effectiveUnitLabel}\u00B2`
                        }
                      </span>
                    </div>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setMeasurements(prev => prev.filter(x => x.id !== m.id))}
                      data-testid={`delete-measurement-${i}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!pendingCalibration} onOpenChange={v => { if (!v) setPendingCalibration(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set scale</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              What is the real-world distance between the two points you clicked?
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="any"
                placeholder="e.g. 0.9"
                value={calibInput.value}
                onChange={e => setCalibInput(c => ({ ...c, value: e.target.value }))}
                autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter" && calibInput.value && pendingCalibration) {
                    const realVal = Number(calibInput.value);
                    if (realVal > 0) {
                      const metresFactor = calibInput.unit === "mm" ? 0.001 : calibInput.unit === "m" ? 1 : calibInput.unit === "ft" ? 0.3048 : calibInput.unit === "in" ? 0.0254 : 1;
                      const metresPerPoint = (realVal * metresFactor) / pendingCalibration.pixelDistance;
                      setCalibration(metresPerPoint);
                      setUnitLabel(calibInput.unit);
                      setPendingCalibration(null);
                      toast({ title: "Scale calibrated", description: `1 pt = ${(metresPerPoint * 1000).toFixed(3)} mm` });
                    }
                  }
                }}
              />
              <select
                className="text-sm border rounded px-2 py-2 bg-background"
                value={calibInput.unit}
                onChange={e => setCalibInput(c => ({ ...c, unit: e.target.value }))}
              >
                <option value="mm">mm</option>
                <option value="m">metres</option>
                <option value="ft">feet</option>
                <option value="in">inches</option>
              </select>
            </div>
            {pendingCalibration && (
              <p className="text-xs text-muted-foreground">
                Pixel distance between clicks: {pendingCalibration.pixelDistance.toFixed(1)} pt
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingCalibration(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!calibInput.value || !pendingCalibration) return;
                const realVal = Number(calibInput.value);
                if (!(realVal > 0)) return;
                const metresFactor = calibInput.unit === "mm" ? 0.001 : calibInput.unit === "m" ? 1 : calibInput.unit === "ft" ? 0.3048 : calibInput.unit === "in" ? 0.0254 : 1;
                const metresPerPoint = (realVal * metresFactor) / pendingCalibration.pixelDistance;
                setCalibration(metresPerPoint);
                setUnitLabel(calibInput.unit);
                setPendingCalibration(null);
                toast({ title: "Scale calibrated", description: `1 pt = ${(metresPerPoint * 1000).toFixed(3)} mm` });
              }}
            >
              Save scale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
