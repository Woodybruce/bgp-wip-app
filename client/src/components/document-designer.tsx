import { useState, useRef, useCallback, useEffect } from "react";
import { getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Type, Image, Square, Circle, Minus, ChevronDown,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  Trash2, Copy, Layers, ArrowUp, ArrowDown,
  Download, Save, Undo2, Redo2, Plus, Palette,
  Move, MousePointer, FileText, Loader2, Upload, Sparkles,
  MessageSquare, Send, Bot, User, ChevronUp
} from "lucide-react";
import bgpLogoDark from "@assets/BGP_BlackHolder_1771853582461.png";

const BGP_FONT_FACES = `
@font-face {
  font-family: 'Grotta';
  src: url('/api/branding/fonts/Grotta-Regular-q93rrw.otf') format('opentype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Neue Machina';
  src: url('/api/branding/fonts/Neue%20Machina%20Regular-e896.otf') format('opentype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Space Mono';
  src: url('https://fonts.gstatic.com/s/spacemono/v13/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

interface DesignElement {
  id: string;
  type: "text" | "image" | "shape" | "line";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  content?: string;
  src?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  textAlign?: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
  shapeType?: "rectangle" | "circle" | "line";
  lineWidth?: number;
  zIndex: number;
}

interface DesignPage {
  id: string;
  elements: DesignElement[];
  backgroundColor: string;
  backgroundImage?: string;
}

interface VisualDesign {
  pages: DesignPage[];
  pageWidth: number;
  pageHeight: number;
}

interface DocumentDesignerProps {
  templateId: string;
  templateName: string;
  templateContent: string;
  initialDesign?: string;
  autoDesign?: boolean;
  onSave: (designJson: string) => Promise<void>;
  onCancel: () => void;
}

const CANVAS_SCALE = 0.75;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const FONT_OPTIONS = [
  "Work Sans, Arial, sans-serif",
  "Grotta, Work Sans, Arial, sans-serif",
  "Neue Machina, Work Sans, Arial, sans-serif",
  "MinionPro, Times New Roman, serif",
  "Space Mono, Courier New, monospace",
  "Arial, sans-serif",
  "Arial Narrow, Arial, sans-serif",
  "Helvetica Neue, Helvetica, sans-serif",
  "Georgia, serif",
  "Times New Roman, serif",
  "Garamond, serif",
  "Courier New, monospace",
  "Verdana, sans-serif",
  "Trebuchet MS, sans-serif",
];

const FONT_LABELS: Record<string, string> = {
  "Work Sans, Arial, sans-serif": "Work Sans (BGP)",
  "Grotta, Work Sans, Arial, sans-serif": "Grotta (BGP)",
  "Neue Machina, Work Sans, Arial, sans-serif": "Neue Machina (BGP)",
  "MinionPro, Times New Roman, serif": "MinionPro (BGP)",
  "Space Mono, Courier New, monospace": "Space Mono (BGP)",
  "Arial, sans-serif": "Arial",
  "Arial Narrow, Arial, sans-serif": "Arial Narrow",
  "Helvetica Neue, Helvetica, sans-serif": "Helvetica Neue",
  "Georgia, serif": "Georgia",
  "Times New Roman, serif": "Times New Roman",
  "Garamond, serif": "Garamond",
  "Courier New, monospace": "Courier New",
  "Verdana, sans-serif": "Verdana",
  "Trebuchet MS, sans-serif": "Trebuchet MS",
};

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function createDefaultPage(): DesignPage {
  return {
    id: createId(),
    elements: [],
    backgroundColor: "#ffffff",
  };
}

function parseInitialDesign(json?: string): VisualDesign {
  if (!json) {
    return { pages: [createDefaultPage()], pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT };
  }
  try {
    const parsed = JSON.parse(json);
    if (parsed.pages && Array.isArray(parsed.pages)) {
      return parsed;
    }
  } catch {}
  return { pages: [createDefaultPage()], pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT };
}

export default function DocumentDesigner({
  templateId,
  templateName,
  templateContent,
  initialDesign,
  autoDesign: autoDesignOnMount,
  onSave,
  onCancel,
}: DocumentDesignerProps) {
  const { toast } = useToast();
  const [design, setDesign] = useState<VisualDesign>(() => parseInitialDesign(initialDesign));
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "text" | "image" | "rectangle" | "circle" | "line">("select");
  const [saving, setSaving] = useState(false);
  const [autoDesigning, setAutoDesigning] = useState(false);
  const [history, setHistory] = useState<VisualDesign[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [dragState, setDragState] = useState<{ elementId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizeState, setResizeState] = useState<{ elementId: string; startX: number; startY: number; origW: number; origH: number; handle: string } | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const styleId = "bgp-brand-fonts";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = BGP_FONT_FACES;
      document.head.appendChild(style);
    }
  }, []);

  const currentPage = design.pages[currentPageIndex] || design.pages[0];
  const selectedElement = selectedElementId
    ? currentPage.elements.find((e) => e.id === selectedElementId) || null
    : null;

  const pushHistory = useCallback((newDesign: VisualDesign) => {
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(newDesign)));
      if (newHistory.length > 50) newHistory.shift();
      return newHistory;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      if (prev) {
        setDesign(JSON.parse(JSON.stringify(prev)));
        setHistoryIndex((i) => i - 1);
      }
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      if (next) {
        setDesign(JSON.parse(JSON.stringify(next)));
        setHistoryIndex((i) => i + 1);
      }
    }
  }, [history, historyIndex]);

  const updateDesign = useCallback((updater: (d: VisualDesign) => VisualDesign) => {
    setDesign((prev) => {
      const next = updater(JSON.parse(JSON.stringify(prev)));
      pushHistory(next);
      return next;
    });
  }, [pushHistory]);

  const updateElement = useCallback((elementId: string, updates: Partial<DesignElement>) => {
    updateDesign((d) => {
      const page = d.pages[currentPageIndex];
      const el = page.elements.find((e) => e.id === elementId);
      if (el) Object.assign(el, updates);
      return d;
    });
  }, [updateDesign, currentPageIndex]);

  const addElement = useCallback((element: Omit<DesignElement, "id" | "zIndex">) => {
    const id = createId();
    const maxZ = currentPage.elements.reduce((max, e) => Math.max(max, e.zIndex), 0);
    updateDesign((d) => {
      d.pages[currentPageIndex].elements.push({
        ...element,
        id,
        zIndex: maxZ + 1,
      } as DesignElement);
      return d;
    });
    setSelectedElementId(id);
    setTool("select");
  }, [updateDesign, currentPageIndex, currentPage]);

  const deleteElement = useCallback((elementId: string) => {
    updateDesign((d) => {
      d.pages[currentPageIndex].elements = d.pages[currentPageIndex].elements.filter((e) => e.id !== elementId);
      return d;
    });
    if (selectedElementId === elementId) setSelectedElementId(null);
  }, [updateDesign, currentPageIndex, selectedElementId]);

  const duplicateElement = useCallback((elementId: string) => {
    const el = currentPage.elements.find((e) => e.id === elementId);
    if (!el) return;
    const newEl = { ...el, x: el.x + 20, y: el.y + 20 };
    const { id: _, zIndex: __, ...rest } = newEl;
    addElement(rest);
  }, [currentPage, addElement]);

  const moveLayer = useCallback((elementId: string, direction: "up" | "down") => {
    updateDesign((d) => {
      const elements = d.pages[currentPageIndex].elements;
      const el = elements.find((e) => e.id === elementId);
      if (!el) return d;
      if (direction === "up") el.zIndex += 1.5;
      else el.zIndex -= 1.5;
      elements.sort((a, b) => a.zIndex - b.zIndex);
      elements.forEach((e, i) => (e.zIndex = i));
      return d;
    });
  }, [updateDesign, currentPageIndex]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / CANVAS_SCALE;
    const y = (e.clientY - rect.top) / CANVAS_SCALE;

    if (tool === "text") {
      addElement({
        type: "text",
        x, y,
        width: 200,
        height: 40,
        rotation: 0,
        content: "New text",
        fontSize: 14,
        fontFamily: "Arial, sans-serif",
        fontWeight: "normal",
        fontStyle: "normal",
        textDecoration: "none",
        textAlign: "left",
        color: "#1a1a1a",
        backgroundColor: "transparent",
        borderWidth: 0,
        borderColor: "transparent",
        borderRadius: 0,
        opacity: 1,
      });
    } else if (tool === "rectangle") {
      addElement({
        type: "shape",
        shapeType: "rectangle",
        x, y,
        width: 150,
        height: 100,
        rotation: 0,
        backgroundColor: "#f0f0f0",
        borderColor: "#cccccc",
        borderWidth: 1,
        borderRadius: 0,
        opacity: 1,
      });
    } else if (tool === "circle") {
      addElement({
        type: "shape",
        shapeType: "circle",
        x, y,
        width: 100,
        height: 100,
        rotation: 0,
        backgroundColor: "#f0f0f0",
        borderColor: "#cccccc",
        borderWidth: 1,
        borderRadius: 50,
        opacity: 1,
      });
    } else if (tool === "line") {
      addElement({
        type: "shape",
        shapeType: "line",
        x, y,
        width: 200,
        height: 2,
        rotation: 0,
        backgroundColor: "#1a1a1a",
        borderWidth: 0,
        borderColor: "transparent",
        opacity: 1,
      });
    } else if (tool === "select") {
      setSelectedElementId(null);
    }
  }, [tool, addElement]);

  const handleElementMouseDown = useCallback((e: React.MouseEvent, elementId: string) => {
    e.stopPropagation();
    setSelectedElementId(elementId);
    if (tool === "select") {
      const el = currentPage.elements.find((el) => el.id === elementId);
      if (el) {
        setDragState({
          elementId,
          startX: e.clientX,
          startY: e.clientY,
          origX: el.x,
          origY: el.y,
        });
      }
    }
  }, [tool, currentPage]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, elementId: string, handle: string) => {
    e.stopPropagation();
    const el = currentPage.elements.find((el) => el.id === elementId);
    if (el) {
      setResizeState({
        elementId,
        startX: e.clientX,
        startY: e.clientY,
        origW: el.width,
        origH: el.height,
        handle,
      });
    }
  }, [currentPage]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragState) {
        const dx = (e.clientX - dragState.startX) / CANVAS_SCALE;
        const dy = (e.clientY - dragState.startY) / CANVAS_SCALE;
        setDesign((prev) => {
          const next = JSON.parse(JSON.stringify(prev));
          const el = next.pages[currentPageIndex].elements.find((el: DesignElement) => el.id === dragState.elementId);
          if (el) {
            el.x = Math.max(0, Math.min((prev.pageWidth || PAGE_WIDTH) - el.width, dragState.origX + dx));
            el.y = Math.max(0, Math.min((prev.pageHeight || PAGE_HEIGHT) - el.height, dragState.origY + dy));
          }
          return next;
        });
      }
      if (resizeState) {
        const dx = (e.clientX - resizeState.startX) / CANVAS_SCALE;
        const dy = (e.clientY - resizeState.startY) / CANVAS_SCALE;
        setDesign((prev) => {
          const next = JSON.parse(JSON.stringify(prev));
          const el = next.pages[currentPageIndex].elements.find((el: DesignElement) => el.id === resizeState.elementId);
          if (el) {
            el.width = Math.max(20, resizeState.origW + dx);
            el.height = Math.max(10, resizeState.origH + dy);
          }
          return next;
        });
      }
    };

    const handleMouseUp = () => {
      if (dragState) {
        pushHistory(design);
        setDragState(null);
      }
      if (resizeState) {
        pushHistory(design);
        setResizeState(null);
      }
    };

    if (dragState || resizeState) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragState, resizeState, currentPageIndex, design, pushHistory]);

  const addTemplatePlaceholders = useCallback(() => {
    const lines = templateContent.split("\n").filter((l) => l.trim());
    let y = 60;
    const heading = lines[0] || templateName;
    const bodyText = lines.slice(1, 20).join("\n");

    addElement({
      type: "text",
      x: 40,
      y: 40,
      width: PAGE_WIDTH - 80,
      height: 36,
      rotation: 0,
      content: heading,
      fontSize: 22,
      fontFamily: "Helvetica Neue, Helvetica, sans-serif",
      fontWeight: "bold",
      fontStyle: "normal",
      textDecoration: "none",
      textAlign: "center",
      color: "#1a1a1a",
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
      opacity: 1,
    });

    addElement({
      type: "text",
      x: 40,
      y: 90,
      width: PAGE_WIDTH - 80,
      height: Math.min(600, bodyText.length / 2),
      rotation: 0,
      content: bodyText || "Template content will appear here",
      fontSize: 11,
      fontFamily: "Arial, sans-serif",
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      textAlign: "left",
      color: "#333333",
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
      opacity: 1,
    });
  }, [templateContent, templateName, addElement]);

  const addBGPLogo = useCallback(() => {
    addElement({
      type: "image",
      x: PAGE_WIDTH / 2 - 60,
      y: 20,
      width: 120,
      height: 40,
      rotation: 0,
      src: bgpLogoDark,
      opacity: 1,
    });
  }, [addElement]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        const maxW = PAGE_WIDTH - 80;
        const ratio = img.height / img.width;
        const w = Math.min(img.width, maxW);
        const h = w * ratio;
        addElement({
          type: "image",
          x: 40,
          y: 100,
          width: w,
          height: h,
          rotation: 0,
          src: dataUrl,
          opacity: 1,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [addElement]);

  const handleAutoDesign = async () => {
    setAutoDesigning(true);
    try {
      const res = await fetch(`/api/doc-templates/${templateId}/visual-auto-design`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Auto-design failed");
      }
      const updated = await res.json();
      const newDesign = parseInitialDesign(updated.design);
      setDesign(newDesign);
      pushHistory(newDesign);
      setSelectedElementId(null);
      setCurrentPageIndex(0);
      toast({ title: "Document designed", description: "You can now adjust any element to your liking." });
    } catch (err: any) {
      toast({ title: "Auto-design failed", description: err.message, variant: "destructive" });
    }
    setAutoDesigning(false);
  };

  useEffect(() => {
    if (autoDesignOnMount && !initialDesign) {
      const timer = setTimeout(() => {
        handleAutoDesign();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, []);

  const sendChatMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    const userMsg = { role: "user" as const, content: msg };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);
    try {
      const res = await fetch(`/api/doc-templates/${templateId}/visual-design-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({
          message: msg,
          currentDesign: design,
          conversationHistory: chatMessages,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Request failed");
      }
      const data = await res.json();
      const assistantMsg = { role: "assistant" as const, content: data.reply };
      setChatMessages((prev) => [...prev, assistantMsg]);
      if (data.design) {
        const newDesign = parseInitialDesign(JSON.stringify(data.design));
        setDesign(newDesign);
        pushHistory(newDesign);
        setSelectedElementId(null);
      }
    } catch (err: any) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    }
    setChatLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(JSON.stringify(design));
      toast({ title: "Design saved" });
    } catch {
      toast({ title: "Failed to save design", variant: "destructive" });
    }
    setSaving(false);
  };

  const exportPDF = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: [PAGE_WIDTH, PAGE_HEIGHT] });

      for (let pageIdx = 0; pageIdx < design.pages.length; pageIdx++) {
        if (pageIdx > 0) pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        const page = design.pages[pageIdx];

        pdf.setFillColor(page.backgroundColor || "#ffffff");
        pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "F");

        const sortedElements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

        for (const el of sortedElements) {
          if (el.type === "text" && el.content) {
            pdf.setFont("helvetica", el.fontWeight === "bold" ? "bold" : el.fontStyle === "italic" ? "italic" : "normal");
            pdf.setFontSize(el.fontSize || 12);
            pdf.setTextColor(el.color || "#000000");

            if (el.backgroundColor && el.backgroundColor !== "transparent") {
              pdf.setFillColor(el.backgroundColor);
              pdf.rect(el.x, el.y, el.width, el.height, "F");
            }

            const align = el.textAlign === "center" ? "center" : el.textAlign === "right" ? "right" : "left";
            const textX = align === "center" ? el.x + el.width / 2 : align === "right" ? el.x + el.width : el.x;

            pdf.text(el.content, textX, el.y + (el.fontSize || 12), {
              maxWidth: el.width,
              align: align as "left" | "center" | "right",
            });
          } else if (el.type === "shape") {
            if (el.backgroundColor && el.backgroundColor !== "transparent") {
              pdf.setFillColor(el.backgroundColor);
            }
            if (el.borderWidth && el.borderColor && el.borderColor !== "transparent") {
              pdf.setDrawColor(el.borderColor);
              pdf.setLineWidth(el.borderWidth);
            }

            if (el.shapeType === "circle") {
              const rx = el.width / 2;
              const ry = el.height / 2;
              pdf.ellipse(el.x + rx, el.y + ry, rx, ry, el.backgroundColor !== "transparent" ? "FD" : "S");
            } else if (el.shapeType === "line") {
              pdf.setDrawColor(el.backgroundColor || "#000000");
              pdf.setLineWidth(el.height || 2);
              pdf.line(el.x, el.y, el.x + el.width, el.y);
            } else {
              pdf.roundedRect(el.x, el.y, el.width, el.height, el.borderRadius || 0, el.borderRadius || 0, el.backgroundColor !== "transparent" ? "FD" : "S");
            }
          } else if (el.type === "image" && el.src) {
            try {
              pdf.addImage(el.src, "PNG", el.x, el.y, el.width, el.height);
            } catch {}
          }
        }
      }

      pdf.save(`${templateName.replace(/\s+/g, "_")}_design.pdf`);
      toast({ title: "PDF exported" });
    } catch (err: any) {
      toast({ title: "PDF export failed", description: err.message, variant: "destructive" });
    }
  };

  const addPage = () => {
    updateDesign((d) => {
      d.pages.push(createDefaultPage());
      return d;
    });
    setCurrentPageIndex(design.pages.length);
  };

  const applyPreset = (preset: "modern" | "classic" | "minimal") => {
    const page = createDefaultPage();

    if (preset === "modern") {
      page.backgroundColor = "#ffffff";
      page.elements = [
        {
          id: createId(), type: "shape", shapeType: "rectangle",
          x: 0, y: 0, width: PAGE_WIDTH, height: 80, rotation: 0,
          backgroundColor: "#1a1a1a", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 0,
        },
        {
          id: createId(), type: "text",
          x: 40, y: 25, width: PAGE_WIDTH - 80, height: 30, rotation: 0,
          content: templateName, fontSize: 20, fontFamily: "Helvetica Neue, Helvetica, sans-serif",
          fontWeight: "bold", fontStyle: "normal", textDecoration: "none", textAlign: "left",
          color: "#ffffff", backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 1,
        },
        {
          id: createId(), type: "shape", shapeType: "line",
          x: 40, y: 100, width: PAGE_WIDTH - 80, height: 2, rotation: 0,
          backgroundColor: "#e0e0e0", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 2,
        },
        {
          id: createId(), type: "text",
          x: 40, y: 120, width: PAGE_WIDTH - 80, height: 600, rotation: 0,
          content: templateContent.slice(0, 2000), fontSize: 11, fontFamily: "Arial, sans-serif",
          fontWeight: "normal", fontStyle: "normal", textDecoration: "none", textAlign: "left",
          color: "#333333", backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 3,
        },
        {
          id: createId(), type: "shape", shapeType: "rectangle",
          x: 0, y: PAGE_HEIGHT - 40, width: PAGE_WIDTH, height: 40, rotation: 0,
          backgroundColor: "#f5f5f5", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 4,
        },
        {
          id: createId(), type: "text",
          x: 40, y: PAGE_HEIGHT - 30, width: PAGE_WIDTH - 80, height: 20, rotation: 0,
          content: "Bruce Gillingham Pollard — Confidential", fontSize: 8, fontFamily: "Arial, sans-serif",
          fontWeight: "normal", fontStyle: "normal", textDecoration: "none", textAlign: "center",
          color: "#999999", backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 5,
        },
      ];
    } else if (preset === "classic") {
      page.backgroundColor = "#faf9f6";
      page.elements = [
        {
          id: createId(), type: "shape", shapeType: "rectangle",
          x: 20, y: 20, width: PAGE_WIDTH - 40, height: PAGE_HEIGHT - 40, rotation: 0,
          backgroundColor: "transparent", borderWidth: 1, borderColor: "#c0a060", borderRadius: 0, opacity: 1, zIndex: 0,
        },
        {
          id: createId(), type: "text",
          x: 50, y: 50, width: PAGE_WIDTH - 100, height: 36, rotation: 0,
          content: templateName, fontSize: 24, fontFamily: "Georgia, serif",
          fontWeight: "bold", fontStyle: "normal", textDecoration: "none", textAlign: "center",
          color: "#2d2d2d", backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 1,
        },
        {
          id: createId(), type: "shape", shapeType: "line",
          x: PAGE_WIDTH / 2 - 60, y: 95, width: 120, height: 1, rotation: 0,
          backgroundColor: "#c0a060", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 2,
        },
        {
          id: createId(), type: "text",
          x: 50, y: 115, width: PAGE_WIDTH - 100, height: 650, rotation: 0,
          content: templateContent.slice(0, 2000), fontSize: 11, fontFamily: "Georgia, serif",
          fontWeight: "normal", fontStyle: "normal", textDecoration: "none", textAlign: "left",
          color: "#333333", backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 3,
        },
        {
          id: createId(), type: "text",
          x: 50, y: PAGE_HEIGHT - 50, width: PAGE_WIDTH - 100, height: 20, rotation: 0,
          content: "Bruce Gillingham Pollard", fontSize: 9, fontFamily: "Georgia, serif",
          fontWeight: "normal", fontStyle: "italic", textDecoration: "none", textAlign: "center",
          color: "#888888", backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent", opacity: 1, zIndex: 4,
        },
      ];
    } else {
      page.backgroundColor = "#ffffff";
      page.elements = [
        {
          id: createId(), type: "text",
          x: 60, y: 60, width: PAGE_WIDTH - 120, height: 30, rotation: 0,
          content: templateName.toUpperCase(), fontSize: 16, fontFamily: "Helvetica Neue, Helvetica, sans-serif",
          fontWeight: "normal", fontStyle: "normal", textDecoration: "none", textAlign: "left",
          color: "#1a1a1a", backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent",
          opacity: 1, zIndex: 0,
        },
        {
          id: createId(), type: "text",
          x: 60, y: 110, width: PAGE_WIDTH - 120, height: 660, rotation: 0,
          content: templateContent.slice(0, 2000), fontSize: 10, fontFamily: "Helvetica Neue, Helvetica, sans-serif",
          fontWeight: "normal", fontStyle: "normal", textDecoration: "none", textAlign: "left",
          color: "#444444", backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent",
          opacity: 1, zIndex: 1,
        },
      ];
    }

    updateDesign((d) => {
      d.pages[currentPageIndex] = page;
      return d;
    });
    setSelectedElementId(null);
    toast({ title: `${preset.charAt(0).toUpperCase() + preset.slice(1)} preset applied` });
  };

  const toolbarBtnClass = (active: boolean) =>
    `p-2 rounded-md transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="w-5 h-5" />
              Visual Document Designer
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onCancel} data-testid="button-cancel-visual-design">Cancel</Button>
              <Button variant="outline" size="sm" onClick={exportPDF} data-testid="button-export-pdf">
                <Download className="w-4 h-4 mr-1" />
                Export PDF
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving} data-testid="button-save-visual-design">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save Design
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="flex gap-3">
        <div className="flex-1 space-y-3">
          <Card className="p-2">
            <div className="flex items-center gap-1 flex-wrap">
              <div className="flex items-center gap-0.5 border-r pr-2 mr-1">
                <button className={toolbarBtnClass(tool === "select")} onClick={() => setTool("select")} title="Select" data-testid="tool-select">
                  <MousePointer className="w-4 h-4" />
                </button>
                <button className={toolbarBtnClass(tool === "text")} onClick={() => setTool("text")} title="Add Text" data-testid="tool-text">
                  <Type className="w-4 h-4" />
                </button>
                <button className={toolbarBtnClass(tool === "rectangle")} onClick={() => setTool("rectangle")} title="Rectangle" data-testid="tool-rectangle">
                  <Square className="w-4 h-4" />
                </button>
                <button className={toolbarBtnClass(tool === "circle")} onClick={() => setTool("circle")} title="Circle" data-testid="tool-circle">
                  <Circle className="w-4 h-4" />
                </button>
                <button className={toolbarBtnClass(tool === "line")} onClick={() => setTool("line")} title="Line" data-testid="tool-line">
                  <Minus className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-0.5 border-r pr-2 mr-1">
                <button className="p-2 rounded-md hover:bg-muted" onClick={() => fileInputRef.current?.click()} title="Upload Image" data-testid="tool-upload-image">
                  <Upload className="w-4 h-4" />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                <button className="p-2 rounded-md hover:bg-muted" onClick={addBGPLogo} title="Add BGP Logo" data-testid="tool-add-logo">
                  <Image className="w-4 h-4" />
                </button>
                <button className="p-2 rounded-md hover:bg-muted" onClick={addTemplatePlaceholders} title="Add Template Content" data-testid="tool-add-content">
                  <FileText className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-0.5 border-r pr-2 mr-1">
                <button className="p-2 rounded-md hover:bg-muted" onClick={undo} title="Undo" data-testid="tool-undo">
                  <Undo2 className="w-4 h-4" />
                </button>
                <button className="p-2 rounded-md hover:bg-muted" onClick={redo} title="Redo" data-testid="tool-redo">
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-1 ml-auto">
                <Button
                  size="sm"
                  className="h-7 text-xs bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                  onClick={handleAutoDesign}
                  disabled={autoDesigning}
                  data-testid="button-ai-auto-design"
                >
                  {autoDesigning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                  {autoDesigning ? "AI is designing..." : "AI Auto-Design"}
                </Button>
                <div className="w-px h-5 bg-border mx-1" />
                <span className="text-xs text-muted-foreground mr-1">Presets:</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyPreset("modern")} data-testid="preset-modern">Modern</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyPreset("classic")} data-testid="preset-classic">Classic</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyPreset("minimal")} data-testid="preset-minimal">Minimal</Button>
              </div>
            </div>
          </Card>

          <div className="bg-muted/50 rounded-lg p-4 overflow-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
            <div className="flex flex-col items-center gap-4">
              {design.pages.map((page, pageIdx) => {
                const pw = design.pageWidth || PAGE_WIDTH;
                const ph = design.pageHeight || PAGE_HEIGHT;
                const isActive = pageIdx === currentPageIndex;
                return (
                  <div key={page.id} className="relative">
                    <div className="absolute -top-5 left-0 flex items-center gap-2">
                      <span className={`text-[10px] font-medium ${isActive ? "text-blue-600" : "text-muted-foreground"}`}>Page {pageIdx + 1}</span>
                    </div>
                    <div
                      ref={isActive ? canvasRef : undefined}
                      className={`relative bg-white shadow-xl ${isActive ? "cursor-crosshair ring-2 ring-blue-500/40" : "cursor-pointer ring-1 ring-border"}`}
                      style={{
                        width: pw * CANVAS_SCALE,
                        height: ph * CANVAS_SCALE,
                        backgroundColor: page.backgroundColor,
                      }}
                      onClick={(e) => {
                        if (!isActive) {
                          setCurrentPageIndex(pageIdx);
                          setSelectedElementId(null);
                          return;
                        }
                        handleCanvasClick(e);
                      }}
                      data-testid={`design-canvas-${pageIdx}`}
                    >
                      {[...page.elements]
                        .sort((a, b) => a.zIndex - b.zIndex)
                        .map((el) => (
                          <div
                            key={el.id}
                            className={`absolute group ${selectedElementId === el.id && isActive ? "ring-2 ring-blue-500" : ""}`}
                            style={{
                              left: el.x * CANVAS_SCALE,
                              top: el.y * CANVAS_SCALE,
                              width: el.width * CANVAS_SCALE,
                              height: el.height * CANVAS_SCALE,
                              zIndex: el.zIndex,
                              opacity: el.opacity ?? 1,
                              cursor: isActive ? (tool === "select" ? "move" : "crosshair") : "pointer",
                              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                            }}
                            onMouseDown={(e) => {
                              if (!isActive) {
                                setCurrentPageIndex(pageIdx);
                                setSelectedElementId(null);
                                return;
                              }
                              handleElementMouseDown(e, el.id);
                            }}
                            data-testid={`element-${el.id}`}
                          >
                            {el.type === "text" && (
                              <div
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  fontSize: (el.fontSize || 12) * CANVAS_SCALE,
                                  fontFamily: el.fontFamily,
                                  fontWeight: el.fontWeight,
                                  fontStyle: el.fontStyle,
                                  textDecoration: el.textDecoration,
                                  textAlign: el.textAlign as any,
                                  color: el.color,
                                  backgroundColor: el.backgroundColor !== "transparent" ? el.backgroundColor : undefined,
                                  borderWidth: el.borderWidth,
                                  borderColor: el.borderColor !== "transparent" ? el.borderColor : undefined,
                                  borderStyle: el.borderWidth ? "solid" : "none",
                                  borderRadius: el.borderRadius,
                                  padding: 2 * CANVAS_SCALE,
                                  overflow: "hidden",
                                  whiteSpace: "pre-wrap",
                                  lineHeight: 1.4,
                                  wordBreak: "break-word",
                                }}
                              >
                                {el.content?.split(/(\{\{[^}]+\}\})/g).map((part, i) => {
                                  if (part.startsWith("{{") && part.endsWith("}}")) {
                                    return (
                                      <span key={i} style={{
                                        backgroundColor: "#e8f4fd",
                                        color: "#0066cc",
                                        border: "1px solid #b3d9ff",
                                        borderRadius: 2,
                                        padding: "0 2px",
                                        fontSize: "0.85em",
                                      }}>
                                        {part.slice(2, -2)}
                                      </span>
                                    );
                                  }
                                  return <span key={i}>{part}</span>;
                                })}
                              </div>
                            )}

                            {el.type === "image" && el.src && (
                              <img
                                src={el.src}
                                alt=""
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "contain",
                                  borderRadius: el.borderRadius,
                                }}
                                draggable={false}
                              />
                            )}

                            {el.type === "shape" && el.shapeType === "line" && (
                              <div style={{
                                width: "100%",
                                height: "100%",
                                backgroundColor: el.backgroundColor,
                              }} />
                            )}

                            {el.type === "shape" && el.shapeType === "rectangle" && (
                              <div style={{
                                width: "100%",
                                height: "100%",
                                backgroundColor: el.backgroundColor,
                                borderWidth: el.borderWidth,
                                borderColor: el.borderColor !== "transparent" ? el.borderColor : undefined,
                                borderStyle: el.borderWidth ? "solid" : "none",
                                borderRadius: el.borderRadius,
                              }} />
                            )}

                            {el.type === "shape" && el.shapeType === "circle" && (
                              <div style={{
                                width: "100%",
                                height: "100%",
                                backgroundColor: el.backgroundColor,
                                borderWidth: el.borderWidth,
                                borderColor: el.borderColor !== "transparent" ? el.borderColor : undefined,
                                borderStyle: el.borderWidth ? "solid" : "none",
                                borderRadius: "50%",
                              }} />
                            )}

                            {selectedElementId === el.id && isActive && (
                              <div
                                className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-500 rounded-sm cursor-se-resize"
                                onMouseDown={(e) => handleResizeMouseDown(e, el.id, "se")}
                                data-testid={`resize-handle-${el.id}`}
                              />
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
              <Button variant="ghost" size="sm" className="text-xs" onClick={addPage} data-testid="add-page">
                <Plus className="w-3 h-3 mr-1" /> Add Page
              </Button>
            </div>
          </div>
        </div>

        <div className="w-72 space-y-3 flex-shrink-0 overflow-y-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
          {selectedElement ? (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      {selectedElement.type === "text" ? <Type className="w-3.5 h-3.5" /> :
                       selectedElement.type === "image" ? <Image className="w-3.5 h-3.5" /> :
                       <Square className="w-3.5 h-3.5" />}
                      {selectedElement.type.charAt(0).toUpperCase() + selectedElement.type.slice(1)}
                    </span>
                    <div className="flex gap-0.5">
                      <button className="p-1 rounded hover:bg-muted" onClick={() => moveLayer(selectedElement.id, "up")} title="Bring Forward">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1 rounded hover:bg-muted" onClick={() => moveLayer(selectedElement.id, "down")} title="Send Back">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1 rounded hover:bg-muted" onClick={() => duplicateElement(selectedElement.id)} title="Duplicate">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1 rounded hover:bg-destructive hover:text-destructive-foreground" onClick={() => deleteElement(selectedElement.id)} title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">X</Label>
                      <Input type="number" value={Math.round(selectedElement.x)} className="h-7 text-xs"
                        onChange={(e) => updateElement(selectedElement.id, { x: Number(e.target.value) })}
                        data-testid="prop-x"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Y</Label>
                      <Input type="number" value={Math.round(selectedElement.y)} className="h-7 text-xs"
                        onChange={(e) => updateElement(selectedElement.id, { y: Number(e.target.value) })}
                        data-testid="prop-y"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Width</Label>
                      <Input type="number" value={Math.round(selectedElement.width)} className="h-7 text-xs"
                        onChange={(e) => updateElement(selectedElement.id, { width: Number(e.target.value) })}
                        data-testid="prop-width"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Height</Label>
                      <Input type="number" value={Math.round(selectedElement.height)} className="h-7 text-xs"
                        onChange={(e) => updateElement(selectedElement.id, { height: Number(e.target.value) })}
                        data-testid="prop-height"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Opacity</Label>
                    <input type="range" min="0" max="1" step="0.05"
                      value={selectedElement.opacity ?? 1}
                      onChange={(e) => updateElement(selectedElement.id, { opacity: Number(e.target.value) })}
                      className="w-full h-1.5 accent-primary"
                      data-testid="prop-opacity"
                    />
                  </div>
                </CardContent>
              </Card>

              {selectedElement.type === "text" && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Text Properties</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <Textarea
                      value={selectedElement.content || ""}
                      onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                      className="text-xs min-h-[60px]"
                      data-testid="prop-text-content"
                    />
                    <div>
                      <Label className="text-xs">Font</Label>
                      <select
                        value={selectedElement.fontFamily}
                        onChange={(e) => updateElement(selectedElement.id, { fontFamily: e.target.value })}
                        className="w-full h-7 text-xs border rounded-md px-2 bg-background"
                        data-testid="prop-font-family"
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f} value={f}>{FONT_LABELS[f] || f}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Size</Label>
                        <Input type="number" value={selectedElement.fontSize || 12} className="h-7 text-xs"
                          onChange={(e) => updateElement(selectedElement.id, { fontSize: Number(e.target.value) })}
                          data-testid="prop-font-size"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Color</Label>
                        <div className="flex gap-1">
                          <input type="color" value={selectedElement.color || "#000000"}
                            onChange={(e) => updateElement(selectedElement.id, { color: e.target.value })}
                            className="w-7 h-7 rounded border cursor-pointer"
                            data-testid="prop-text-color"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <button
                        className={`p-1.5 rounded ${selectedElement.fontWeight === "bold" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        onClick={() => updateElement(selectedElement.id, { fontWeight: selectedElement.fontWeight === "bold" ? "normal" : "bold" })}
                        data-testid="prop-bold"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className={`p-1.5 rounded ${selectedElement.fontStyle === "italic" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        onClick={() => updateElement(selectedElement.id, { fontStyle: selectedElement.fontStyle === "italic" ? "normal" : "italic" })}
                        data-testid="prop-italic"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className={`p-1.5 rounded ${selectedElement.textDecoration === "underline" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        onClick={() => updateElement(selectedElement.id, { textDecoration: selectedElement.textDecoration === "underline" ? "none" : "underline" })}
                        data-testid="prop-underline"
                      >
                        <Underline className="w-3.5 h-3.5" />
                      </button>
                      <div className="w-px bg-border mx-1" />
                      <button
                        className={`p-1.5 rounded ${selectedElement.textAlign === "left" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        onClick={() => updateElement(selectedElement.id, { textAlign: "left" })}
                        data-testid="prop-align-left"
                      >
                        <AlignLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className={`p-1.5 rounded ${selectedElement.textAlign === "center" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        onClick={() => updateElement(selectedElement.id, { textAlign: "center" })}
                        data-testid="prop-align-center"
                      >
                        <AlignCenter className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className={`p-1.5 rounded ${selectedElement.textAlign === "right" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        onClick={() => updateElement(selectedElement.id, { textAlign: "right" })}
                        data-testid="prop-align-right"
                      >
                        <AlignRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div>
                      <Label className="text-xs">Background</Label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={selectedElement.backgroundColor === "transparent" ? "#ffffff" : (selectedElement.backgroundColor || "#ffffff")}
                          onChange={(e) => updateElement(selectedElement.id, { backgroundColor: e.target.value })}
                          className="w-7 h-7 rounded border cursor-pointer"
                          data-testid="prop-text-bg"
                        />
                        <Button variant="ghost" size="sm" className="h-6 text-xs"
                          onClick={() => updateElement(selectedElement.id, { backgroundColor: "transparent" })}
                        >None</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedElement.type === "shape" && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Shape Properties</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div>
                      <Label className="text-xs">Fill Color</Label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={selectedElement.backgroundColor === "transparent" ? "#f0f0f0" : (selectedElement.backgroundColor || "#f0f0f0")}
                          onChange={(e) => updateElement(selectedElement.id, { backgroundColor: e.target.value })}
                          className="w-7 h-7 rounded border cursor-pointer"
                          data-testid="prop-shape-fill"
                        />
                        <Button variant="ghost" size="sm" className="h-6 text-xs"
                          onClick={() => updateElement(selectedElement.id, { backgroundColor: "transparent" })}
                        >None</Button>
                      </div>
                    </div>
                    {selectedElement.shapeType !== "line" && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Border Width</Label>
                            <Input type="number" value={selectedElement.borderWidth || 0} className="h-7 text-xs"
                              onChange={(e) => updateElement(selectedElement.id, { borderWidth: Number(e.target.value) })}
                              data-testid="prop-border-width"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Border Color</Label>
                            <input type="color" value={selectedElement.borderColor === "transparent" ? "#cccccc" : (selectedElement.borderColor || "#cccccc")}
                              onChange={(e) => updateElement(selectedElement.id, { borderColor: e.target.value })}
                              className="w-7 h-7 rounded border cursor-pointer"
                              data-testid="prop-border-color"
                            />
                          </div>
                        </div>
                        {selectedElement.shapeType === "rectangle" && (
                          <div>
                            <Label className="text-xs">Corner Radius</Label>
                            <Input type="number" value={selectedElement.borderRadius || 0} className="h-7 text-xs"
                              onChange={(e) => updateElement(selectedElement.id, { borderRadius: Number(e.target.value) })}
                              data-testid="prop-border-radius"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {selectedElement.type === "image" && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Image Properties</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div>
                      <Label className="text-xs">Corner Radius</Label>
                      <Input type="number" value={selectedElement.borderRadius || 0} className="h-7 text-xs"
                        onChange={(e) => updateElement(selectedElement.id, { borderRadius: Number(e.target.value) })}
                        data-testid="prop-img-radius"
                      />
                    </div>
                    <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => fileInputRef.current?.click()}>
                      Replace Image
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Page Properties</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div>
                  <Label className="text-xs">Background Color</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={currentPage.backgroundColor || "#ffffff"}
                      onChange={(e) => updateDesign((d) => { d.pages[currentPageIndex].backgroundColor = e.target.value; return d; })}
                      className="w-7 h-7 rounded border cursor-pointer"
                      data-testid="prop-page-bg"
                    />
                    <span className="text-xs text-muted-foreground font-mono">{currentPage.backgroundColor}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-1.5 pt-2">
                  <p className="font-medium">Quick Start:</p>
                  <p>Choose a preset layout above, or click tools to add elements:</p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5"><MousePointer className="w-3 h-3" /> Select & move elements</div>
                    <div className="flex items-center gap-1.5"><Type className="w-3 h-3" /> Click canvas to add text</div>
                    <div className="flex items-center gap-1.5"><Upload className="w-3 h-3" /> Upload your own images</div>
                    <div className="flex items-center gap-1.5"><Image className="w-3 h-3" /> Add BGP logo</div>
                    <div className="flex items-center gap-1.5"><FileText className="w-3 h-3" /> Insert template content</div>
                    <div className="flex items-center gap-1.5"><Square className="w-3 h-3" /> Add shapes & lines</div>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <Label className="text-xs font-medium">Elements ({currentPage.elements.length})</Label>
                  <div className="space-y-1 mt-1 max-h-48 overflow-y-auto">
                    {[...currentPage.elements].sort((a, b) => b.zIndex - a.zIndex).map((el) => (
                      <button
                        key={el.id}
                        className={`w-full text-left text-xs px-2 py-1 rounded flex items-center gap-1.5 ${selectedElementId === el.id ? "bg-primary/10" : "hover:bg-muted"}`}
                        onClick={() => setSelectedElementId(el.id)}
                        data-testid={`layer-${el.id}`}
                      >
                        {el.type === "text" ? <Type className="w-3 h-3" /> :
                         el.type === "image" ? <Image className="w-3 h-3" /> :
                         <Square className="w-3 h-3" />}
                        <span className="truncate">
                          {el.type === "text" ? (el.content?.slice(0, 25) || "Text") :
                           el.type === "image" ? "Image" :
                           el.shapeType || "Shape"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card data-testid="design-chat" className="border-violet-200 dark:border-violet-800">
            <CardHeader className="pb-2 cursor-pointer bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 rounded-t-lg" onClick={() => setChatOpen(!chatOpen)}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-violet-600" />
                  Design Assistant
                </CardTitle>
                {chatOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Direct the AI to build and refine your document</p>
            </CardHeader>
            {chatOpen && (
              <CardContent className="pt-2 space-y-2">
                <ScrollArea className="h-56 border rounded-md p-2 bg-background">
                  {chatMessages.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8 space-y-2">
                      <Bot className="w-6 h-6 mx-auto text-violet-500" />
                      <p className="font-medium">Tell the AI what to design</p>
                      <div className="space-y-1 text-[10px]">
                        <p>"Make the heading larger and bold"</p>
                        <p>"Add a blue border around the accommodation section"</p>
                        <p>"Change the font to something more modern"</p>
                      </div>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex gap-1.5 mb-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "assistant" && <Bot className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-600" />}
                      <div className={`text-xs px-2 py-1.5 rounded-lg max-w-[85%] ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`} data-testid={`chat-msg-${msg.role}-${i}`}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex gap-1.5 mb-2">
                      <Bot className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-600" />
                      <div className="bg-muted text-xs px-2 py-1.5 rounded-lg flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Designing...
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </ScrollArea>
                <div className="flex gap-1.5">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                    placeholder="Describe what you want to change..."
                    className="h-8 text-xs"
                    disabled={chatLoading}
                    data-testid="input-design-chat"
                  />
                  <Button
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
                    onClick={sendChatMessage}
                    disabled={chatLoading || !chatInput.trim()}
                    data-testid="button-send-design-chat"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
