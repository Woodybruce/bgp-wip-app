// TODO: Deduplicate — this file shares ~60% of its code structure with investment-comps.tsx.
// Consider extracting shared table logic, filter dropdowns, and inline-edit patterns
// into a shared CompsTableCore component. See investment-comps.tsx for the same note.
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineLabelSelect, InlineLinkSelect } from "@/components/inline-edit";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search, Plus, Trash2, ChevronUp, ChevronDown, FilterX, Download,
  Calculator, Building2, MapPin, Scale, CheckCircle2,
  MoreHorizontal, Ruler, Loader2, Newspaper, Sparkles,
  FileText, Upload, X, Paperclip, FileDown, Info, Presentation,
  TrendingUp, Inbox, ArrowRight, Eye, ExternalLink, Phone, Mail, User,
} from "lucide-react";
import type { CrmComp } from "@shared/schema";
import jsPDF from "jspdf";
import { Link } from "wouter";
import { CompPdfTemplateEditor } from "@/components/comp-pdf-template-editor";
import { AddressAutocomplete, buildGoogleMapsUrl } from "@/components/address-autocomplete";
import InvestmentCompsPage from "@/pages/investment-comps";

interface CompFile {
  id: string;
  compId: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: string;
}

interface PdfTemplateConfig {
  headerTitle?: string;
  headerSubtitle?: string;
  footerText?: string;
  brandColor?: number[];
  accentColor?: number[];
  showDate?: boolean;
  showCount?: boolean;
  fields?: { key: string; label: string; enabled: boolean }[];
  showBadges?: boolean;
  showNotes?: boolean;
  showAttachedFiles?: boolean;
  columns?: number;
}

const DEFAULT_PDF_TEMPLATE: PdfTemplateConfig = {
  headerTitle: "BRUCE GILLINGHAM POLLARD",
  headerSubtitle: "Comparable Evidence Schedule",
  footerText: "Bruce Gillingham Pollard | Confidential | brucegillinghampollard.com",
  brandColor: [25, 25, 25],
  accentColor: [0, 82, 136],
  showDate: true,
  showCount: true,
  fields: [
    { key: "tenant", label: "Tenant", enabled: true },
    { key: "landlord", label: "Landlord", enabled: true },
    { key: "areaLocation", label: "Area", enabled: true },
    { key: "headlineRent", label: "Headline Rent", enabled: true },
    { key: "zoneARate", label: "Zone A (psf)", enabled: true },
    { key: "overallRate", label: "Overall (psf)", enabled: true },
    { key: "netEffectiveRent", label: "Net Effective", enabled: true },
    { key: "niaSqft", label: "NIA (sq ft)", enabled: true },
    { key: "itzaSqft", label: "ITZA (sq ft)", enabled: true },
    { key: "term", label: "Term (yrs)", enabled: true },
    { key: "rentFree", label: "Rent Free", enabled: true },
    { key: "breakClause", label: "Break", enabled: true },
    { key: "ltActStatus", label: "L&T Act", enabled: true },
    { key: "fitoutContribution", label: "Tenant Incentive", enabled: true },
    { key: "sourceEvidence", label: "Source", enabled: true },
  ],
  showBadges: true,
  showNotes: true,
  showAttachedFiles: true,
  columns: 4,
};

function generateCompsPdf(comps: CrmComp[], includeFilesList: boolean = false, filesByCompId: Record<string, CompFile[]> = {}, tpl?: PdfTemplateConfig) {
  const t = { ...DEFAULT_PDF_TEMPLATE, ...tpl };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 15;
  const contentW = pageW - margin * 2;
  const brandColor = (t.brandColor || [25, 25, 25]) as [number, number, number];
  const accentColor = (t.accentColor || [0, 82, 136]) as [number, number, number];
  const lightGray: [number, number, number] = [245, 245, 245];
  const medGray: [number, number, number] = [140, 140, 140];
  let y = 0;

  const checkPage = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = 15;
    }
  };

  doc.setFillColor(...brandColor);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(t.headerTitle || "BRUCE GILLINGHAM POLLARD", margin, 13);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(t.headerSubtitle || "Comparable Evidence Schedule", margin, 20);
  doc.setTextColor(200, 200, 200);
  if (t.showDate !== false) {
    doc.text(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), pageW - margin, 20, { align: "right" });
  }
  if (t.showCount !== false) {
    doc.text(`${comps.length} transaction${comps.length !== 1 ? "s" : ""}`, pageW - margin, 13, { align: "right" });
  }
  y = 35;

  const templateFields = (t.fields || DEFAULT_PDF_TEMPLATE.fields!).filter(f => f.enabled);
  const cols = t.columns || 4;

  comps.forEach((comp, idx) => {
    const blockH = 52;
    checkPage(blockH);

    if (idx > 0) {
      doc.setDrawColor(220, 220, 220);
      doc.line(margin, y - 3, pageW - margin, y - 3);
      y += 2;
    }

    doc.setFillColor(...accentColor);
    doc.rect(margin, y, 2, 8, "F");
    doc.setTextColor(...brandColor);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(comp.name || "Untitled", margin + 5, y + 6);

    if (comp.postcode) {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...medGray);
      doc.text(comp.postcode, margin + 5 + doc.getTextWidth(comp.name || "Untitled") + 3, y + 6);
    }

    if (t.showBadges !== false) {
      const badges: string[] = [];
      if (comp.useClass) badges.push(comp.useClass);
      if (comp.transactionType) badges.push(comp.transactionType);
      if (comp.completionDate) badges.push(comp.completionDate);
      if (badges.length > 0) {
        let bx = pageW - margin;
        doc.setFontSize(6);
        badges.reverse().forEach(b => {
          const tw = doc.getTextWidth(b) + 4;
          doc.setFillColor(...lightGray);
          doc.roundedRect(bx - tw, y + 1, tw, 5, 1, 1, "F");
          doc.setTextColor(...medGray);
          doc.text(b, bx - tw + 2, y + 4.5);
          bx -= tw + 2;
        });
      }
    }
    y += 12;

    const compData = comp as Record<string, any>;
    const populated = templateFields
      .map(f => [f.label, compData[f.key]] as [string, string | null | undefined])
      .filter(([, v]) => v);

    const colW = contentW / cols;
    populated.forEach(([label, value], i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      if (col === 0 && row > 0) checkPage(8);
      const cx = margin + col * colW;
      const cy = y + row * 8;
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...medGray);
      doc.text(label.toUpperCase(), cx, cy);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...brandColor);
      doc.text(String(value || ""), cx, cy + 4);
    });
    const totalRows = Math.ceil(populated.length / cols);
    y += totalRows * 8 + 4;

    if (t.showNotes !== false && comp.comments) {
      checkPage(10);
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...medGray);
      doc.text("NOTES", margin, y);
      doc.setFontSize(6.5);
      doc.setTextColor(80, 80, 80);
      const lines = doc.splitTextToSize(comp.comments, contentW);
      doc.text(lines.slice(0, 3), margin, y + 4);
      y += 4 + Math.min(lines.length, 3) * 3 + 2;
    }

    if (includeFilesList && t.showAttachedFiles !== false) {
      const compFiles = filesByCompId[comp.id] || [];
      if (compFiles.length > 0) {
        checkPage(8);
        doc.setFontSize(5.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...medGray);
        doc.text("ATTACHED FILES", margin, y);
        y += 4;
        compFiles.forEach(f => {
          checkPage(5);
          doc.setFontSize(6);
          doc.setTextColor(...accentColor);
          doc.text(`• ${f.fileName}`, margin + 2, y);
          y += 3.5;
        });
        y += 2;
      }
    }

    y += 4;
  });

  doc.setDrawColor(...brandColor);
  doc.line(margin, 282, pageW - margin, 282);
  doc.setFontSize(5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...medGray);
  doc.text(t.footerText || "Bruce Gillingham Pollard | Confidential | brucegillinghampollard.com", pageW / 2, 287, { align: "center" });

  const fileName = comps.length === 1
    ? `BGP_Comp_${(comps[0].name || "export").replace(/[^a-zA-Z0-9]/g, "_")}.pdf`
    : `BGP_Leasing_Comps_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}

const USE_CLASS_OPTIONS = ["E", "E(a) Retail", "E(b) F&B", "E(c) Office", "B2 Industrial", "B8 Storage", "C3 Residential", "Sui Generis", "A1 (Legacy)", "A3 (Legacy)"];
const TRANSACTION_TYPE_OPTIONS = ["Open Market Letting", "Rent Review", "Lease Renewal", "Assignment", "Sub-letting", "Surrender & Re-grant", "Pre-let"];
const LT_ACT_OPTIONS = ["Inside L&T Act", "Outside L&T Act", "Contracted Out"];
const MEASUREMENT_OPTIONS = ["NIA", "GIA", "IPMS 3 Office", "IPMS 3 Retail", "ITZA", "GEA"];
const SOURCE_OPTIONS = ["BGP Direct", "Opposing Agent", "Published", "EGi/CoStar", "Market Intel", "OneDrive Extract"];
const COMP_TYPE_OPTIONS = ["Retail", "F&B / Restaurant", "Office", "Mixed Use", "Industrial", "Leisure / Gym", "Medical", "Other"];

const AREA_GROUPS = [
  "All Areas", "Mayfair", "City", "Covent Garden", "Marylebone", "Chelsea",
  "Fitzrovia", "Farringdon", "Islington", "Kings Cross", "Soho",
  "Midtown", "Paddington", "Richmond", "East London", "SE1 / London Bridge",
  "Camden", "Other",
];

const USE_CLASS_COLORS: Record<string, string> = {
  "E(a) Retail": "bg-blue-600 text-white",
  "E(b) F&B": "bg-orange-600 text-white",
  "E(c) Office": "bg-slate-600 text-white",
  "A1 (Legacy)": "bg-blue-500 text-white",
  "A3 (Legacy)": "bg-orange-500 text-white",
  "E": "bg-purple-600 text-white",
};

const TXN_TYPE_COLORS: Record<string, string> = {
  "Open Market Letting": "bg-green-600 text-white",
  "Rent Review": "bg-amber-600 text-white",
  "Lease Renewal": "bg-blue-600 text-white",
  "Assignment": "bg-purple-600 text-white",
  "Sub-letting": "bg-teal-600 text-white",
  "Pre-let": "bg-indigo-600 text-white",
};

const formatCurrency = (v: string | null | undefined) => {
  if (!v) return "";
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  if (isNaN(n)) return v;
  return "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
};

const formatRate = (v: string | null | undefined) => {
  if (!v) return "";
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  if (isNaN(n)) return v;
  return "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 2 }) + " psf";
};

// RICS Code of Measuring Practice 6th Edition + RICS Property Measurement 2nd Edition (2018)
// Mapping of use class -> primary/secondary measurement basis and the rental analysis convention.
// This is the professional standard that dictates whether rent is analysed on GIA / NIA / ITZA / IPMS.
const RICS_USE_CLASS_GUIDE: Record<string, {
  primary: string;
  secondary?: string;
  analysis: string;
  zoned: boolean;
  notes: string;
}> = {
  "E(a) Retail": {
    primary: "ITZA",
    secondary: "NIA",
    analysis: "Zone A (ITZA) — 6.1m (20ft) zones, halving back",
    zoned: true,
    notes: "Shop units zoned per RICS Code of Measuring Practice 6th Ed. Ground floor retail analysed on ITZA; ancillary / upper parts at fractions of ZA. NIA used as a sense-check. GIA typically only for rating.",
  },
  "A1 (Legacy)": {
    primary: "ITZA",
    secondary: "NIA",
    analysis: "Zone A (ITZA) — 6.1m (20ft) zones",
    zoned: true,
    notes: "Legacy A1 retail — same ITZA convention as E(a) per RICS Code of Measuring Practice.",
  },
  "E(b) F&B": {
    primary: "NIA",
    secondary: "GIA",
    analysis: "Overall £ psf on NIA (ITZA rarely applied)",
    zoned: false,
    notes: "F&B units typically analysed on NIA overall. Zoning only applied where unit has shop-like frontage. Kitchens, WCs, stores excluded from NIA.",
  },
  "A3 (Legacy)": {
    primary: "NIA",
    secondary: "GIA",
    analysis: "Overall £ psf on NIA",
    zoned: false,
    notes: "Legacy A3 — analysed on NIA overall, same as E(b).",
  },
  "E(c) Office": {
    primary: "IPMS 3 Office",
    secondary: "NIA",
    analysis: "Overall £ psf on NIA (or IPMS 3)",
    zoned: false,
    notes: "Offices now measured to IPMS 3 Office per RICS Property Measurement 2nd Ed (2018). NIA still widely reported for comparability with pre-2018 evidence.",
  },
  "E": {
    primary: "NIA",
    secondary: "ITZA",
    analysis: "Depends on sub-use — retail: ITZA; office: NIA/IPMS 3",
    zoned: false,
    notes: "Class E covers retail, office, medical, financial. Apply the measurement basis for the actual occupation.",
  },
  "B2 Industrial": {
    primary: "GIA",
    analysis: "Overall £ psf on GIA",
    zoned: false,
    notes: "Industrial / manufacturing measured to GIA (to the internal face of external walls, including all internal walls, columns and piers). IPMS 2 Industrial is the emerging alternative.",
  },
  "B8 Storage": {
    primary: "GIA",
    analysis: "Overall £ psf on GIA",
    zoned: false,
    notes: "Warehouse / storage analysed on GIA per RICS Code of Measuring Practice.",
  },
  "C3 Residential": {
    primary: "GIA",
    secondary: "IPMS 2 Residential",
    analysis: "£ psf on GIA (or IPMS 2 Residential)",
    zoned: false,
    notes: "Residential measured to GIA in the UK convention, or IPMS 2 Residential for international comparability.",
  },
  "Sui Generis": {
    primary: "GIA",
    analysis: "Overall £ psf, typically on GIA",
    zoned: false,
    notes: "Sui Generis uses (cinema, casino, betting shop) do not fall within Class E — analyse to the measurement basis most appropriate to occupation, usually GIA.",
  },
};

// For a given use class, what field should formula buttons compute the overall rate against?
function preferredAreaField(useClass: string | null | undefined): "niaSqft" | "giaSqft" {
  if (!useClass) return "niaSqft";
  const guide = RICS_USE_CLASS_GUIDE[useClass];
  if (guide?.primary === "GIA") return "giaSqft";
  return "niaSqft";
}

function parseNum(v: string | null | undefined): number {
  if (!v) return 0;
  // If stepped (contains /), return the first step — used as "headline" year 1.
  const first = String(v).split("/")[0];
  const n = parseFloat(first.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

// Parse a stepped rent string like "100000/110000/120000" or "100k/110k" into numbers.
function parseSteppedRent(v: string | null | undefined): number[] {
  if (!v) return [];
  return String(v).split("/").map(part => {
    const t = part.trim().toLowerCase().replace(/[£,\s]/g, "");
    const mul = t.endsWith("k") ? 1000 : t.endsWith("m") ? 1_000_000 : 1;
    const numStr = t.replace(/[km]$/, "");
    const n = parseFloat(numStr);
    return isNaN(n) ? 0 : n * mul;
  }).filter(n => n > 0);
}

function formatGBP(n: number, compact = false): string {
  if (!Number.isFinite(n) || n === 0) return "";
  if (compact && Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 1_000_000) return "£" + (n / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 1 }) + "M";
    return "£" + (n / 1000).toLocaleString("en-GB", { maximumFractionDigits: 0 }) + "K";
  }
  return "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

function formatInt(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function formatSteppedRent(v: string | null | undefined, compact = false): string {
  const steps = parseSteppedRent(v);
  if (steps.length === 0) return "";
  if (steps.length === 1) return formatGBP(steps[0], compact);
  return steps.map(s => formatGBP(s, true)).join(" → ");
}

function parseMonths(v: string | null | undefined): number {
  if (!v) return 0;
  const s = String(v).toLowerCase();
  // Accept "12", "12 months", "1 year", "18m", "2 years"
  const yrMatch = s.match(/([\d.]+)\s*(?:y|yr|year)/);
  if (yrMatch) return parseFloat(yrMatch[1]) * 12;
  const moMatch = s.match(/([\d.]+)\s*(?:m|mo|month)?/);
  if (moMatch) return parseFloat(moMatch[1]);
  return 0;
}

function parseYears(v: string | null | undefined): number {
  if (!v) return 0;
  const s = String(v).toLowerCase();
  const yrMatch = s.match(/([\d.]+)\s*(?:y|yr|year)/);
  if (yrMatch) return parseFloat(yrMatch[1]);
  const moMatch = s.match(/([\d.]+)\s*(?:m|mo|month)/);
  if (moMatch) return parseFloat(moMatch[1]) / 12;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Compute net effective rent: averaged (stepped) headline minus straight-line amortised
// incentives (rent free value + tenant incentive / capital contribution) over lease term.
function computeNetEffective(comp: CrmComp): number {
  const steps = parseSteppedRent(comp.headlineRent);
  if (steps.length === 0) return 0;
  const term = parseYears(comp.term);
  const y1 = steps[0];
  // Average headline across the lease term. If steps are fewer than term, the final step
  // is held for the remaining years (standard stepped-rent convention).
  let avgHeadline = y1;
  if (term > 0) {
    let totalRent = 0;
    for (let y = 0; y < term; y++) {
      const step = steps[Math.min(y, steps.length - 1)];
      totalRent += step;
    }
    avgHeadline = totalRent / term;
  } else if (steps.length > 1) {
    avgHeadline = steps.reduce((a, b) => a + b, 0) / steps.length;
  }
  const rfMonths = parseMonths(comp.rentFreeMonths || comp.rentFree);
  const rfValue = (y1 / 12) * rfMonths; // rent free is valued at year-1 rent
  const incentive = parseNum(comp.fitoutContribution); // Tenant incentive / capital contribution
  const totalIncentives = rfValue + incentive;
  if (!term) return avgHeadline;
  const annualisedIncentive = totalIncentives / term;
  return avgHeadline - annualisedIncentive;
}

// UK RPI / CPI annual averages — last 10 years (ONS published annual % change).
// Used by the indexation calculator for RPI / CPI lease reviews. Update annually.
const UK_INDEX_DATA: { year: number; rpi: number; cpi: number }[] = [
  { year: 2015, rpi: 1.0, cpi: 0.0 },
  { year: 2016, rpi: 1.8, cpi: 0.7 },
  { year: 2017, rpi: 3.6, cpi: 2.7 },
  { year: 2018, rpi: 3.3, cpi: 2.5 },
  { year: 2019, rpi: 2.6, cpi: 1.8 },
  { year: 2020, rpi: 1.5, cpi: 0.9 },
  { year: 2021, rpi: 4.1, cpi: 2.6 },
  { year: 2022, rpi: 11.6, cpi: 9.1 },
  { year: 2023, rpi: 9.7, cpi: 7.3 },
  { year: 2024, rpi: 3.6, cpi: 2.5 },
];

// Inline-edit cell that stores raw numbers but displays them with thousands separators.
// Editing exposes the raw digits; on save we strip non-numeric characters before persisting.
function NumberCell({
  value, onSave, suffix = "", className = "",
}: { value: string | null | undefined; onSave: (v: string) => void; suffix?: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  const n = parseNum(value);
  const display = n ? formatInt(n) + (suffix ? ` ${suffix}` : "") : "";

  const save = () => {
    const cleaned = draft.replace(/[^0-9.-]/g, "");
    if (cleaned !== (value || "")) onSave(cleaned);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className={`w-20 px-1.5 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 ${className}`}
        data-testid="number-cell-input"
      />
    );
  }
  return (
    <span
      onClick={() => { setDraft(n ? String(n) : ""); setEditing(true); }}
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs inline-block min-w-[2rem] transition-colors ${!display ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="number-cell-display"
    >
      {display || "—"}
    </span>
  );
}

// Currency edit cell with £ + thousands separators. Stores raw number string.
function CurrencyCell({
  value, onSave, compact = false, className = "",
}: { value: string | null | undefined; onSave: (v: string) => void; compact?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  const n = parseNum(value);
  const display = formatGBP(n, compact);

  const save = () => {
    const cleaned = draft.replace(/[^0-9.-]/g, "");
    if (cleaned !== (value || "")) onSave(cleaned);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className={`w-24 px-1.5 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 ${className}`}
        data-testid="currency-cell-input"
      />
    );
  }
  return (
    <span
      onClick={() => { setDraft(n ? String(n) : ""); setEditing(true); }}
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs inline-block min-w-[2rem] transition-colors ${!display ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="currency-cell-display"
    >
      {display || "—"}
    </span>
  );
}

// Stepped headline rent cell — accepts "/"-delimited annual amounts (e.g. "100000/110000/120000").
// Display compactly as "£100K → £110K → £120K".
function SteppedRentCell({
  value, onSave, className = "",
}: { value: string | null | undefined; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  const display = formatSteppedRent(value);
  const steps = parseSteppedRent(value);

  const save = () => {
    // Normalise: strip £ and commas, keep / as separator.
    const cleaned = draft
      .split("/")
      .map(p => p.trim().replace(/[£,\s]/g, ""))
      .filter(p => p.length > 0)
      .join("/");
    if (cleaned !== (value || "")) onSave(cleaned);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        placeholder="100000 or 100000/110000/120000"
        className={`w-44 px-1.5 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 ${className}`}
        data-testid="stepped-rent-input"
      />
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          onClick={() => { setDraft(steps.length > 1 ? steps.join("/") : (steps[0] ? String(steps[0]) : "")); setEditing(true); }}
          className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs inline-block min-w-[2rem] transition-colors ${!display ? "text-muted-foreground italic" : ""} ${className}`}
          data-testid="stepped-rent-display"
        >
          {display || "—"}
          {steps.length > 1 && <span className="ml-1 text-[9px] text-amber-600 font-semibold">STEP</span>}
        </span>
      </TooltipTrigger>
      {steps.length > 1 && (
        <TooltipContent side="top" className="text-xs">
          <div className="font-semibold mb-1">Stepped headline rent</div>
          {steps.map((s, i) => (
            <div key={i}>Year {i + 1}{i === steps.length - 1 ? "+" : ""}: £{s.toLocaleString("en-GB")}</div>
          ))}
          <div className="text-[10px] text-muted-foreground mt-1">Edit with "/" between years</div>
        </TooltipContent>
      )}
      {steps.length <= 1 && (
        <TooltipContent side="top" className="text-xs">
          Enter "/" between years for stepped rent (e.g. 100000/110000/120000)
        </TooltipContent>
      )}
    </Tooltip>
  );
}

// Inline-edit cell for linking a comp to a Deal. Shows deal name + edit on click.
function DealCell({
  value, deals, onSave,
}: { value: string; deals: { id: string; name: string }[]; onSave: (dealId: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const current = deals.find(d => d.id === value);

  if (editing) {
    const filtered = search
      ? deals.filter(d => d.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
      : deals.slice(0, 8);
    return (
      <div className="relative">
        <Input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          onBlur={() => setTimeout(() => setEditing(false), 150)}
          placeholder={current?.name || "Search deal..."}
          className="h-7 text-xs"
        />
        <div className="absolute z-50 mt-1 w-56 max-h-48 overflow-y-auto bg-popover border rounded-md shadow-md">
          {value && (
            <button
              onMouseDown={() => { onSave(""); setEditing(false); }}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted text-destructive"
            >
              <X className="w-3 h-3 inline mr-1" /> Unlink deal
            </button>
          )}
          {filtered.map(d => (
            <button
              key={d.id}
              onMouseDown={() => { onSave(d.id); setEditing(false); }}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted block truncate"
            >
              {d.name}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">No matching deals</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setSearch(""); setEditing(true); }}
      className={`text-xs hover:bg-muted/60 rounded px-1.5 py-0.5 truncate block w-full text-left ${current ? "text-blue-700 dark:text-blue-400 font-medium" : "text-muted-foreground italic"}`}
      data-testid="deal-cell"
    >
      {current?.name || "Link deal"}
    </button>
  );
}

function RpiCpiCalculator() {
  const [baseRent, setBaseRent] = useState("");
  const [startYear, setStartYear] = useState<number>(UK_INDEX_DATA[0].year);
  const [endYear, setEndYear] = useState<number>(UK_INDEX_DATA[UK_INDEX_DATA.length - 1].year);
  const [index, setIndex] = useState<"rpi" | "cpi">("rpi");
  const [cap, setCap] = useState("");
  const [collar, setCollar] = useState("");

  const rent = parseFloat(baseRent.replace(/[^0-9.-]/g, "")) || 0;
  const capN = parseFloat(cap) || Infinity;
  const collarN = parseFloat(collar) || -Infinity;

  const range = UK_INDEX_DATA.filter(d => d.year > startYear && d.year <= endYear);
  let factor = 1;
  const breakdown = range.map(d => {
    const raw = index === "rpi" ? d.rpi : d.cpi;
    const capped = Math.max(collarN, Math.min(capN, raw));
    factor *= 1 + capped / 100;
    return { ...d, raw, capped, factor };
  });
  const cumulativePct = (factor - 1) * 100;
  const newRent = rent * factor;
  const yearsSpan = endYear - startYear;
  const cagr = yearsSpan > 0 ? (Math.pow(factor, 1 / yearsSpan) - 1) * 100 : 0;

  return (
    <div className="space-y-4" data-testid="rpi-cpi-calculator">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Index</label>
          <Select value={index} onValueChange={v => setIndex(v as "rpi" | "cpi")}>
            <SelectTrigger className="h-9" data-testid="rpi-select-index"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rpi">RPI (Retail Price Index)</SelectItem>
              <SelectItem value="cpi">CPI (Consumer Price Index)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Base Rent (£ pa)</label>
          <Input type="text" inputMode="decimal" value={baseRent} onChange={e => setBaseRent(e.target.value)} placeholder="250,000" className="h-9" data-testid="rpi-base-rent" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">From Year</label>
          <Select value={String(startYear)} onValueChange={v => setStartYear(Number(v))}>
            <SelectTrigger className="h-9" data-testid="rpi-start-year"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UK_INDEX_DATA.map(d => <SelectItem key={d.year} value={String(d.year)}>{d.year}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">To Year</label>
          <Select value={String(endYear)} onValueChange={v => setEndYear(Number(v))}>
            <SelectTrigger className="h-9" data-testid="rpi-end-year"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UK_INDEX_DATA.map(d => <SelectItem key={d.year} value={String(d.year)}>{d.year}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Cap (% pa)</label>
          <Input type="number" value={cap} onChange={e => setCap(e.target.value)} placeholder="e.g. 4" className="h-9" data-testid="rpi-cap" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Collar (% pa)</label>
          <Input type="number" value={collar} onChange={e => setCollar(e.target.value)} placeholder="e.g. 1" className="h-9" data-testid="rpi-collar" />
        </div>
      </div>

      <div className="bg-muted/50 rounded-xl p-4 space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Indexation Result</h4>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cumulative Uplift</p>
            <p className="text-sm font-bold">{cumulativePct.toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Equivalent CAGR</p>
            <p className="text-sm font-bold">{cagr.toFixed(2)}% pa</p>
          </div>
          {rent > 0 && (
            <>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Base Rent</p>
                <p className="text-sm font-semibold">£{rent.toLocaleString("en-GB")}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Indexed Rent</p>
                <p className="text-sm font-bold text-green-600">£{Math.round(newRent).toLocaleString("en-GB")}</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Annual {index.toUpperCase()} (last 10 years)</h4>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-2 py-1.5 font-semibold">Year</th>
                <th className="text-right px-2 py-1.5 font-semibold">RPI</th>
                <th className="text-right px-2 py-1.5 font-semibold">CPI</th>
                <th className="text-right px-2 py-1.5 font-semibold">Applied</th>
                <th className="text-right px-2 py-1.5 font-semibold">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {UK_INDEX_DATA.map(d => {
                const inRange = d.year > startYear && d.year <= endYear;
                const row = breakdown.find(b => b.year === d.year);
                return (
                  <tr key={d.year} className={`border-t ${inRange ? "" : "text-muted-foreground/60"}`}>
                    <td className="px-2 py-1">{d.year}</td>
                    <td className="text-right px-2 py-1">{d.rpi.toFixed(1)}%</td>
                    <td className="text-right px-2 py-1">{d.cpi.toFixed(1)}%</td>
                    <td className="text-right px-2 py-1">{row ? row.capped.toFixed(2) + "%" : "—"}{row && row.capped !== row.raw ? <span className="text-[9px] text-amber-600 ml-1">capped</span> : ""}</td>
                    <td className="text-right px-2 py-1 font-mono">{row ? "×" + row.factor.toFixed(4) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Source: UK ONS — annual averages of monthly Retail Price Index (RPI) and Consumer Price Index (CPI). Apply the cap/collar to each year's indexation before compounding (standard UK lease convention).
        </p>
      </div>
    </div>
  );
}

function NetRentCalculator({ onClose }: { onClose: () => void }) {
  const [headlineRent, setHeadlineRent] = useState("");
  const [rentFreeMonths, setRentFreeMonths] = useState("");
  const [fitoutContrib, setFitoutContrib] = useState("");
  const [leaseTerm, setLeaseTerm] = useState("");
  const [areaSqft, setAreaSqft] = useState("");
  const [itzaArea, setItzaArea] = useState("");

  const headline = parseFloat(headlineRent) || 0;
  const rf = parseFloat(rentFreeMonths) || 0;
  const fitout = parseFloat(fitoutContrib) || 0;
  const term = parseFloat(leaseTerm) || 0;
  const area = parseFloat(areaSqft) || 0;
  const itza = parseFloat(itzaArea) || 0;

  const totalRentFreeValue = (headline / 12) * rf;
  const totalIncentives = totalRentFreeValue + fitout;
  const annualisedIncentive = term > 0 ? totalIncentives / term : 0;
  const netEffectiveRent = headline - annualisedIncentive;
  const netPsfNia = area > 0 ? netEffectiveRent / area : 0;
  const headlinePsfNia = area > 0 ? headline / area : 0;
  const headlineZoneA = itza > 0 ? headline / itza : 0;
  const netZoneA = itza > 0 ? netEffectiveRent / itza : 0;
  const incentivePct = headline > 0 ? (totalIncentives / (headline * (term || 1))) * 100 : 0;

  return (
    <div className="space-y-4" data-testid="net-rent-calculator">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Headline Rent (£ pa)</label>
          <Input type="number" value={headlineRent} onChange={e => setHeadlineRent(e.target.value)} placeholder="250,000" className="h-9" data-testid="calc-headline-rent" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Lease Term (years)</label>
          <Input type="number" value={leaseTerm} onChange={e => setLeaseTerm(e.target.value)} placeholder="10" className="h-9" data-testid="calc-lease-term" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Rent Free (months)</label>
          <Input type="number" value={rentFreeMonths} onChange={e => setRentFreeMonths(e.target.value)} placeholder="12" className="h-9" data-testid="calc-rent-free" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Fitout / Capital Contribution (£)</label>
          <Input type="number" value={fitoutContrib} onChange={e => setFitoutContrib(e.target.value)} placeholder="50,000" className="h-9" data-testid="calc-fitout" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">NIA Area (sq ft)</label>
          <Input type="number" value={areaSqft} onChange={e => setAreaSqft(e.target.value)} placeholder="2,500" className="h-9" data-testid="calc-area" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">ITZA Area (sq ft)</label>
          <Input type="number" value={itzaArea} onChange={e => setItzaArea(e.target.value)} placeholder="800" className="h-9" data-testid="calc-itza" />
        </div>
      </div>

      {headline > 0 && (
        <div className="bg-muted/50 rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2"><Calculator className="w-4 h-4" /> Results</h4>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Headline Rent</p>
              <p className="text-sm font-bold">£{headline.toLocaleString()} pa</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Net Effective Rent</p>
              <p className="text-sm font-bold text-green-600">£{Math.round(netEffectiveRent).toLocaleString()} pa</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Incentive Value</p>
              <p className="text-sm font-semibold text-amber-600">£{Math.round(totalIncentives).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Incentive as % of Term</p>
              <p className="text-sm font-semibold">{incentivePct.toFixed(1)}%</p>
            </div>
            {area > 0 && (
              <>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Headline £ psf (NIA)</p>
                  <p className="text-sm font-semibold">£{headlinePsfNia.toFixed(2)} psf</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Net £ psf (NIA)</p>
                  <p className="text-sm font-semibold text-green-600">£{netPsfNia.toFixed(2)} psf</p>
                </div>
              </>
            )}
            {itza > 0 && (
              <>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Headline Zone A</p>
                  <p className="text-sm font-semibold">£{headlineZoneA.toFixed(2)} psf ZA</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Net Zone A</p>
                  <p className="text-sm font-semibold text-green-600">£{netZoneA.toFixed(2)} psf ZA</p>
                </div>
              </>
            )}
          </div>
          <div className="pt-2 border-t">
            <p className="text-[10px] text-muted-foreground">
              <span className="font-semibold">RICS Note:</span> Net effective rent calculated by straight-line amortisation of total incentives (rent free value + capital contribution) over the lease term. Zone A rates per RICS Code of Measuring Practice 6th Edition.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Hybrid input: type to search BGP properties + Google Places, or enter a manual address */
function PropertyAddressInput({ value, propertyOptions, onSelectProperty, onSelectAddress, onManualInput }: {
  value: string;
  propertyOptions: { id: string; name: string }[];
  onSelectProperty: (p: { id: string; name: string }) => void;
  onSelectAddress: (addr: { formatted: string; placeId: string; lat?: number; lng?: number; street?: string; city?: string; region?: string; postcode?: string; country?: string }) => void;
  onManualInput: (v: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [showDrop, setShowDrop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesService = useRef<google.maps.places.PlacesService | null>(null);
  const [googlePredictions, setGooglePredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    import("@/lib/google-maps-loader").then(({ loadGoogleMaps }) =>
      loadGoogleMaps().then((ok) => {
        if (ok) {
          autocompleteService.current = new google.maps.places.AutocompleteService();
          const div = document.createElement("div");
          placesService.current = new google.maps.places.PlacesService(div);
        }
      })
    );
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowDrop(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const matchingProps = useMemo(() => {
    if (query.length < 2) return [];
    const q = query.toLowerCase();
    return propertyOptions.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5);
  }, [query, propertyOptions]);

  const searchGoogle = useCallback((input: string) => {
    if (!autocompleteService.current || input.length < 3) { setGooglePredictions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      autocompleteService.current!.getPlacePredictions(
        { input, componentRestrictions: { country: "gb" }, locationBias: { center: { lat: 51.5074, lng: -0.1278 }, radius: 50000 } } as any,
        (results, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            setGooglePredictions(results.filter(r => {
              const types = r.types || [];
              return !(types.includes("country") || types.includes("administrative_area_level_1"));
            }).slice(0, 5));
          } else setGooglePredictions([]);
        }
      );
    }, 300);
  }, []);

  const selectGooglePlace = (prediction: google.maps.places.AutocompletePrediction) => {
    if (!placesService.current) return;
    placesService.current.getDetails(
      { placeId: prediction.place_id, fields: ["formatted_address", "geometry", "place_id", "address_components"] },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
          const comp = (type: string) => place.address_components?.find((c: any) => c.types.includes(type))?.long_name;
          const streetNumber = comp("street_number") || "";
          const route = comp("route") || "";
          const street = [streetNumber, route].filter(Boolean).join(" ");
          onSelectAddress({
            formatted: place.formatted_address || prediction.description,
            placeId: place.place_id || prediction.place_id,
            lat: place.geometry?.location?.lat(),
            lng: place.geometry?.location?.lng(),
            street: street || undefined,
            city: comp("postal_town") || comp("locality") || undefined,
            region: comp("administrative_area_level_2") || comp("administrative_area_level_1") || undefined,
            postcode: comp("postal_code") || undefined,
            country: comp("country") || undefined,
          });
          setQuery(place.formatted_address || prediction.description);
          setShowDrop(false);
          setGooglePredictions([]);
        }
      }
    );
  };

  const handleChange = (v: string) => {
    setQuery(v);
    onManualInput(v);
    searchGoogle(v);
    setShowDrop(v.length >= 2);
  };

  const hasResults = matchingProps.length > 0 || googlePredictions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => hasResults && query.length >= 2 && setShowDrop(true)}
        placeholder="Search BGP property or type address..."
        className="h-9"
        data-testid="create-comp-name"
      />
      {showDrop && hasResults && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-[240px] overflow-y-auto">
          {matchingProps.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide bg-muted/50">BGP Properties</div>
              {matchingProps.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onSelectProperty(p); setQuery(p.name); setShowDrop(false); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                >
                  <Building2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  <span>{p.name}</span>
                </button>
              ))}
            </>
          )}
          {googlePredictions.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide bg-muted/50">Google Addresses</div>
              {googlePredictions.map(p => (
                <button
                  key={p.place_id}
                  onClick={() => selectGooglePlace(p)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                >
                  <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span>{p.description}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Comps() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [activeArea, setActiveArea] = useState("All Areas");
  const [activeUseClass, setActiveUseClass] = useState("all");
  const [activeTxnType, setActiveTxnType] = useState("all");
  const [activeVerified, setActiveVerified] = useState("all");
  const [sortField, setSortField] = useState<string>("completionDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [createOpen, setCreateOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [rpiOpen, setRpiOpen] = useState(false);
  const [confirmLead, setConfirmLead] = useState<CrmComp | null>(null);
  const [selectedComp, setSelectedComp] = useState<CrmComp | null>(null);
  const [deleteComp, setDeleteComp] = useState<{ id: string; name: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("table");
  const [scanning, setScanning] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfConfirmComps, setPdfConfirmComps] = useState<CrmComp[]>([]);
  const [pdfConfirmFiles, setPdfConfirmFiles] = useState<Record<string, CompFile[]>>({});
  const [includeFilesInPdf, setIncludeFilesInPdf] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: comps = [], isLoading } = useQuery<CrmComp[]>({
    queryKey: ["/api/crm/comps"],
  });

  const { data: pdfTemplate } = useQuery<PdfTemplateConfig>({
    queryKey: ["/api/comp-pdf-template"],
  });

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const propertyOptions = useMemo(() =>
    properties.map((p: any) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [properties]
  );

  const companyOptions = useMemo(() =>
    companies.map((c: any) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [companies]
  );

  const contactOptions = useMemo(() =>
    contacts.map((c: any) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [contacts]
  );

  const contactById = useMemo(() => {
    const m = new Map<string, any>();
    contacts.forEach((c: any) => m.set(c.id, c));
    return m;
  }, [contacts]);

  const companyById = useMemo(() => {
    const m = new Map<string, any>();
    companies.forEach((c: any) => m.set(c.id, c));
    return m;
  }, [companies]);

  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // Maps normalized property name → id, so comps with no propertyId can still
  // link to the property board when their name matches a known property.
  const propertyByName = useMemo(() => {
    const m = new Map<string, string>();
    properties.forEach((p: any) => {
      if (p?.id && p?.name) m.set(normName(p.name), p.id);
    });
    return m;
  }, [properties]);

  // Enrichment-backed lookup: match tenant/landlord free-text to a CRM company
  // by normalized name. Companies come from /api/crm/companies which auto-enriches
  // via Apollo/AI in the background, so this map updates as enrichment runs.
  const companyByName = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c: any) => {
      if (c?.id && c?.name) m.set(normName(c.name), c.id);
    });
    return m;
  }, [companies]);

  const findCompanyId = useCallback((name: string | null | undefined): string | null => {
    if (!name) return null;
    const n = normName(name);
    return companyByName.get(n) || null;
  }, [companyByName]);

  const propertyLinkFor = useCallback((comp: CrmComp): { href: string; external: boolean } => {
    if (comp.propertyId) return { href: `/properties/${comp.propertyId}`, external: false };
    if (comp.name) {
      const match = propertyByName.get(normName(comp.name));
      if (match) return { href: `/properties/${match}`, external: false };
    }
    // No BGP property — link to Google Maps with the address/name
    const addr = comp.address as any;
    const googleUrl = buildGoogleMapsUrl(addr?.formatted || comp.name);
    if (googleUrl) return { href: googleUrl, external: true };
    return { href: "/properties", external: false };
  }, [propertyByName]);

  const { data: deals = [] } = useQuery<{ id: string; name: string; status?: string | null }[]>({
    queryKey: ["/api/crm/deals"],
  });
  const dealById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    deals.forEach(d => m.set(d.id, d));
    return m;
  }, [deals]);

  const updateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      await apiRequest("PUT", `/api/crm/comps/${id}`, { [field]: value });
    },
    onMutate: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/crm/comps"] });
      const prev = queryClient.getQueryData<CrmComp[]>(["/api/crm/comps"]);
      if (prev) {
        queryClient.setQueryData<CrmComp[]>(["/api/crm/comps"], prev.map(c => c.id === id ? { ...c, [field]: value } : c));
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/crm/comps"], ctx.prev);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/crm/comps/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/comps"] });
      toast({ title: "Comp deleted" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => apiRequest("DELETE", `/api/crm/comps/${id}`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/comps"] });
      setSelectedIds(new Set());
      toast({ title: `${selectedIds.size} comps deleted` });
    },
  });

  const bulkVerifyMutation = useMutation({
    mutationFn: async ({ ids, verified }: { ids: string[]; verified: boolean }) => {
      await Promise.all(ids.map(id => apiRequest("PUT", `/api/crm/comps/${id}`, { verified })));
    },
    onSuccess: (_d, { ids, verified }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/comps"] });
      setSelectedIds(new Set());
      toast({ title: verified ? `${ids.length} leads verified` : `${ids.length} comps unverified` });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/crm/comps", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/comps"] });
      setCreateOpen(false);
      toast({ title: "Comp created" });
    },
  });

  // Create a new CRM company from a tenant/landlord string on a comp and kick
  // off Apollo enrichment in the background, then navigate to the new record.
  const createAndEnrichCompany = useMutation({
    mutationFn: async (name: string) => {
      const cleanName = name.trim();
      if (!cleanName) throw new Error("Name required");
      const created = await apiRequest("POST", "/api/crm/companies", { name: cleanName }).then(r => r.json());
      if (created?.id) {
        // Fire-and-forget: enrichment populates industry/domain/employees/etc.
        try {
          await apiRequest("POST", "/api/apollo/enrich-company", { companyId: created.id });
        } catch {
          // Apollo might not be configured or the name might not match — that's fine,
          // the company was still created and manually editable.
        }
      }
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: "Company added to CRM", description: "Enrichment started — Apollo is filling in details." });
      if (created?.id) {
        window.location.href = `/companies?highlight=${created.id}`;
      }
    },
    onError: (err: any) => {
      toast({ title: "Couldn't add company", description: err?.message || "Unknown error", variant: "destructive" });
    },
  });

  // A "lead" is an unverified comp extracted by AI from news / email / SharePoint.
  // Confirm Lead toggles `verified` to true and the row drops out of the leads filter.
  const isLead = (c: CrmComp) =>
    !c.verified && (
      ["News Feed", "Team Email", "SharePoint File"].includes(c.sourceEvidence || "")
      || c.createdBy === "AI Auto-Extract"
    );

  const leadComps = useMemo(() => comps.filter(isLead), [comps]);
  const confirmedComps = useMemo(() => comps.filter(c => !isLead(c)), [comps]);

  const filtered = useMemo(() => {
    let result = confirmedComps;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.tenant?.toLowerCase().includes(q) ||
        c.landlord?.toLowerCase().includes(q) ||
        c.areaLocation?.toLowerCase().includes(q) ||
        c.postcode?.toLowerCase().includes(q) ||
        c.comments?.toLowerCase().includes(q)
      );
    }
    if (activeArea !== "All Areas") {
      result = result.filter(c => c.areaLocation?.toLowerCase().includes(activeArea.toLowerCase()) || c.groupName?.toLowerCase().includes(activeArea.toLowerCase()));
    }
    if (activeUseClass !== "all") {
      result = result.filter(c => c.useClass === activeUseClass);
    }
    if (activeTxnType !== "all") {
      result = result.filter(c => c.transactionType === activeTxnType);
    }
    if (activeVerified === "verified") {
      result = result.filter(c => c.verified);
    } else if (activeVerified === "unverified") {
      result = result.filter(c => !c.verified);
    }
    result = [...result].sort((a, b) => {
      const av = (a as any)[sortField];
      const bv = (b as any)[sortField];
      const sa = av == null ? "" : String(av);
      const sb = bv == null ? "" : String(bv);
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return result;
  }, [comps, debouncedSearch, activeArea, activeUseClass, activeTxnType, activeVerified, sortField, sortDir]);

  const stats = useMemo(() => {
    const total = comps.length;
    const verified = comps.filter(c => c.verified).length;
    const aiExtracted = comps.filter(c => ["News Feed", "Team Email", "SharePoint File"].includes(c.sourceEvidence || "") || c.createdBy === "AI Auto-Extract").length;
    const areas = new Set(comps.map(c => c.areaLocation).filter(Boolean)).size;
    const avgZoneA = comps.filter(c => c.zoneARate).reduce((sum, c) => {
      const n = parseFloat(c.zoneARate?.replace(/[^0-9.-]/g, "") || "0");
      return sum + n;
    }, 0) / (comps.filter(c => c.zoneARate).length || 1);
    return { total, verified, aiExtracted, areas, avgZoneA };
  }, [comps]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortHeader = ({ field, children, className = "" }: { field: string; children: React.ReactNode; className?: string }) => (
    <th
      className={`px-2 py-2.5 text-left text-sm font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap ${className}`}
      onClick={() => handleSort(field)}
      data-testid={`sort-${field}`}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </div>
    </th>
  );

  const exportToExcel = useCallback(() => {
    const headers = [
      "Property", "Tenant", "Landlord", "Area", "Postcode", "Use Class", "Transaction Type",
      "Date", "Headline Rent", "Zone A Rate", "Overall Rate", "Net Effective Rent",
      "NIA (sqft)", "GIA (sqft)", "ITZA (sqft)", "Rent Free (mths)", "Tenant Incentive",
      "Term (yrs)", "Break", "L&T Act", "Measurement Standard",
      "Source", "Verified", "Comments",
    ];
    const rows = filtered.map(c => [
      c.name, c.tenant, c.landlord, c.areaLocation, c.postcode, c.useClass, c.transactionType,
      c.completionDate, c.headlineRent, c.zoneARate, c.overallRate, c.netEffectiveRent,
      c.niaSqft, c.giaSqft, c.itzaSqft, c.rentFreeMonths || c.rentFree, c.fitoutContribution,
      c.term, c.breakClause, c.ltActStatus, c.measurementStandard,
      c.sourceEvidence, c.verified ? "Yes" : "No", c.comments,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${(v || "").toString().replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BGP_Leasing_Comps_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const [newName, setNewName] = useState("");
  const [newPropertyId, setNewPropertyId] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState<any>(null);
  const [newTenant, setNewTenant] = useState("");
  const [newArea, setNewArea] = useState("");
  const [newPostcode, setNewPostcode] = useState("");
  const [newUseClass, setNewUseClass] = useState("");
  const [newTxnType, setNewTxnType] = useState("");
  const [newHeadlineRent, setNewHeadlineRent] = useState("");
  const [newZoneA, setNewZoneA] = useState("");
  const [newDate, setNewDate] = useState("");

  const resetCreateForm = () => {
    setNewName(""); setNewPropertyId(null); setNewAddress(null);
    setNewTenant(""); setNewArea(""); setNewPostcode(""); setNewUseClass("");
    setNewTxnType(""); setNewHeadlineRent(""); setNewZoneA(""); setNewDate("");
  };

  const startPdfExport = useCallback(async (targetComps: CrmComp[]) => {
    if (!targetComps.length) return;
    setPdfExporting(true);
    try {
      const ids = targetComps.map(c => c.id);
      const res = await fetch(`/api/crm/comps/files/bulk?compIds=${ids.join(",")}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` },
      });
      const allFiles: CompFile[] = res.ok ? await res.json() : [];
      const byComp: Record<string, CompFile[]> = {};
      allFiles.forEach(f => { (byComp[f.compId] ||= []).push(f); });

      const hasFiles = allFiles.length > 0;
      if (hasFiles) {
        setPdfConfirmComps(targetComps);
        setPdfConfirmFiles(byComp);
        setIncludeFilesInPdf(true);
      } else {
        generateCompsPdf(targetComps, false, {}, pdfTemplate);
        toast({ title: "PDF exported", description: `${targetComps.length} comp${targetComps.length !== 1 ? "s" : ""} exported` });
      }
    } catch (e: any) {
      generateCompsPdf(targetComps, false, {}, pdfTemplate);
      toast({ title: "PDF exported" });
    } finally {
      setPdfExporting(false);
    }
  }, [toast, pdfTemplate]);

  const { data: selectedCompFiles = [] } = useQuery<CompFile[]>({
    queryKey: ["/api/crm/comps", selectedComp?.id, "files"],
    queryFn: async () => {
      if (!selectedComp) return [];
      const res = await fetch(`/api/crm/comps/${selectedComp.id}/files`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` },
      });
      return res.ok ? res.json() : [];
    },
    enabled: !!selectedComp,
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ compId, file }: { compId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/crm/comps/${compId}/files`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      if (selectedComp) queryClient.invalidateQueries({ queryKey: ["/api/crm/comps", selectedComp.id, "files"] });
      toast({ title: "File uploaded" });
    },
    onError: () => toast({ title: "Upload failed", variant: "destructive" }),
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      await apiRequest("DELETE", `/api/comp-files/${fileId}`);
    },
    onSuccess: () => {
      if (selectedComp) queryClient.invalidateQueries({ queryKey: ["/api/crm/comps", selectedComp.id, "files"] });
      toast({ title: "File removed" });
    },
  });

  return (
    <TooltipProvider delayDuration={200}>
    <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col" data-testid="leasing-comps-page">
      <div className="border-b px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Scale className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-comps-title">
                {activeTab === "investment" ? "Investment Comps"
                  : activeTab === "leads" ? "Comps Leads"
                  : activeTab === "pdf-template" ? "PDF Template"
                  : "Leasing Comps"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {activeTab === "investment" ? "Capital markets comparable transactions"
                  : activeTab === "leads" ? "Unconfirmed comps extracted from news, emails & files"
                  : activeTab === "pdf-template" ? "Customise the PDF export template"
                  : "Rent review evidence & comparable transactions"}
              </p>
            </div>
            <TabsList className="ml-4">
              <TabsTrigger value="table" data-testid="tab-comps-table">
                <Scale className="w-3.5 h-3.5 mr-1.5" />
                Leasing
              </TabsTrigger>
              <TabsTrigger value="investment" data-testid="tab-comps-investment">
                <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
                Investment
              </TabsTrigger>
              <TabsTrigger value="leads" data-testid="tab-comps-leads">
                <Inbox className="w-3.5 h-3.5 mr-1.5" />
                Leads
                {leadComps.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                    {leadComps.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="pdf-template" data-testid="tab-comps-pdf-template">
                <Presentation className="w-3.5 h-3.5 mr-1.5" />
                PDF Template
              </TabsTrigger>
            </TabsList>
          </div>
          {activeTab === "table" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              disabled={scanning}
              onClick={async () => {
                setScanning(true);
                toast({ title: "Scanning all sources...", description: "AI is extracting comps from news, emails, and SharePoint" });
                try {
                  const res = await fetch("/api/news-feed/extract-comps", { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` } });
                  if (!res.ok) throw new Error(`Server error ${res.status}`);
                  const data = await res.json();
                  queryClient.invalidateQueries({ queryKey: ["/api/crm/comps"] });
                  const sources = data.sources || {};
                  const parts = [];
                  if (sources.news?.created) parts.push(`${sources.news.created} from news`);
                  if (sources.email?.created) parts.push(`${sources.email.created} from emails`);
                  if (sources.sharepoint?.created) parts.push(`${sources.sharepoint.created} from files`);
                  const desc = parts.length > 0 ? parts.join(", ") : "No new comps found";
                  toast({ title: "Scan Complete", description: `${data.extracted || 0} transactions found, ${data.created || 0} new comps added. ${desc}` });
                } catch (e: any) { toast({ title: "Error", description: e?.message || "Scan failed", variant: "destructive" }); }
                setScanning(false);
              }}
              data-testid="button-scan-news-comps"
            >
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Scan All
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => setCalcOpen(true)} data-testid="button-open-calculator">
              <Calculator className="w-3.5 h-3.5" />
              Net Rent Calc
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => setRpiOpen(true)} data-testid="button-open-rpi-calc">
              <TrendingUp className="w-3.5 h-3.5" />
              RPI/CPI
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={exportToExcel} data-testid="button-export-comps">
              <Download className="w-3.5 h-3.5" />
              Export
            </Button>
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { resetCreateForm(); setCreateOpen(true); }} data-testid="button-create-comp">
              <Plus className="w-3.5 h-3.5" />
              Add Comp
            </Button>
          </div>
          )}
        </div>

        {activeTab === "table" && (
        <>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><Scale className="w-3.5 h-3.5 text-muted-foreground" /> <span className="font-semibold">{stats.total}</span> comps</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> <span className="font-semibold">{stats.verified}</span> verified</span>
            {stats.aiExtracted > 0 && <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-500" /> <span className="font-semibold">{stats.aiExtracted}</span> AI</span>}
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" /> <span className="font-semibold">{stats.areas}</span> areas</span>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search comps..."
              className="h-8 w-56 pl-8 text-xs"
              data-testid="input-search-comps"
            />
          </div>
          <Select value={activeVerified} onValueChange={setActiveVerified}>
            <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-verified-filter">
              <SelectValue placeholder="Verified" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Comps</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>
          <Select value={activeUseClass} onValueChange={setActiveUseClass}>
            <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-use-class-filter">
              <SelectValue placeholder="Use Class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Use Classes</SelectItem>
              {USE_CLASS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeTxnType} onValueChange={setActiveTxnType}>
            <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-txn-type-filter">
              <SelectValue placeholder="Transaction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Transactions</SelectItem>
              {TRANSACTION_TYPE_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          {(activeUseClass !== "all" || activeTxnType !== "all" || activeVerified !== "all" || search) && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => { setSearch(""); setActiveUseClass("all"); setActiveTxnType("all"); setActiveVerified("all"); }} data-testid="button-clear-filters">
              <FilterX className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {AREA_GROUPS.map(area => (
            <button
              key={area}
              onClick={() => setActiveArea(area)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                activeArea === area
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`area-tab-${area}`}
            >
              {area}
            </button>
          ))}
        </div>
        </>
        )}
      </div>

      {(activeTab === "table" || activeTab === "leads") && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 border-b text-xs">
          <span className="font-medium">{selectedIds.size} selected</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs text-green-700 border-green-200 hover:bg-green-50"
            disabled={bulkVerifyMutation.isPending}
            onClick={() => bulkVerifyMutation.mutate({ ids: Array.from(selectedIds), verified: true })}
            data-testid="button-bulk-verify"
          >
            <CheckCircle2 className="w-3 h-3" /> Verify
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs text-amber-700 border-amber-200 hover:bg-amber-50"
            disabled={bulkVerifyMutation.isPending}
            onClick={() => bulkVerifyMutation.mutate({ ids: Array.from(selectedIds), verified: false })}
            data-testid="button-bulk-unverify"
          >
            <X className="w-3 h-3" /> Unverify
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={pdfExporting}
            onClick={() => {
              const targetComps = comps.filter(c => selectedIds.has(c.id));
              startPdfExport(targetComps);
            }}
            data-testid="button-bulk-pdf"
          >
            {pdfExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
            Export PDF
          </Button>
          <Button variant="destructive" size="sm" className="h-7 gap-1 text-xs" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="w-3 h-3" /> Discard
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <TabsContent value="table" className="flex-1 mt-0 overflow-hidden">
      <div className="h-full overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Scale className="w-12 h-12 text-muted-foreground/20 mb-3" />
            <h3 className="text-sm font-semibold mb-1">{comps.length === 0 ? "No comps yet" : "No matching comps"}</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {comps.length === 0 ? "Add your first comparable transaction or ask ChatBGP to extract from your OneDrive files" : "Try adjusting your filters"}
            </p>
            {comps.length === 0 && (
              <Button size="sm" onClick={() => { resetCreateForm(); setCreateOpen(true); }}>
                <Plus className="w-4 h-4 mr-1.5" /> Add First Comp
              </Button>
            )}
          </div>
        ) : (
          <table className="border-collapse" data-testid="comps-table" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: 36 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 56 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 240 }} />
            </colgroup>
            <thead className="sticky top-0 bg-background border-b z-10 text-sm">
              <tr>
                <th className="px-2 py-2.5">
                  <Checkbox
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onCheckedChange={(checked) => {
                      setSelectedIds(checked ? new Set(filtered.map(c => c.id)) : new Set());
                    }}
                    data-testid="checkbox-select-all"
                  />
                </th>
                <th className="px-2 py-2.5" />
                <SortHeader field="name">Property</SortHeader>
                <SortHeader field="tenant">Tenant</SortHeader>
                <SortHeader field="areaLocation">Area</SortHeader>
                <SortHeader field="useClass">Use Class</SortHeader>
                <SortHeader field="transactionType">Txn Type</SortHeader>
                <SortHeader field="completionDate">Date</SortHeader>
                <SortHeader field="headlineRent">Headline</SortHeader>
                <SortHeader field="zoneARate">Zone A</SortHeader>
                <SortHeader field="overallRate">Overall</SortHeader>
                <SortHeader field="netEffectiveRent">Net Eff.</SortHeader>
                <SortHeader field="effectiveRatePsf">Net psf</SortHeader>
                <SortHeader field="niaSqft">NIA</SortHeader>
                <SortHeader field="giaSqft">GIA</SortHeader>
                <SortHeader field="itzaSqft">ITZA</SortHeader>
                <SortHeader field="term">Term</SortHeader>
                <SortHeader field="rentFreeMonths">RF (m)</SortHeader>
                <SortHeader field="fitoutContribution">Incentive</SortHeader>
                <SortHeader field="ltActStatus">L&T Act</SortHeader>
                <SortHeader field="sourceEvidence">Source</SortHeader>
                <SortHeader field="sourceContactId">Contact</SortHeader>
                <SortHeader field="dealId">Deal</SortHeader>
                <SortHeader field="verified">Ver.</SortHeader>
                <SortHeader field="comments">Comments</SortHeader>
              </tr>
            </thead>
            <tbody className="text-xs">
              {filtered.map(comp => (
                <tr
                  key={comp.id}
                  className={`border-b hover:bg-muted/30 transition-colors ${selectedIds.has(comp.id) ? "bg-primary/5" : ""}`}
                  data-testid={`comp-row-${comp.id}`}
                >
                  <td className="px-2 py-1.5">
                    <Checkbox
                      checked={selectedIds.has(comp.id)}
                      onCheckedChange={(checked) => {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          checked ? next.add(comp.id) : next.delete(comp.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-muted transition-colors" data-testid={`comp-menu-${comp.id}`}>
                          <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setSelectedComp(comp)}>
                          <Eye className="w-3.5 h-3.5 mr-2" /> View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => startPdfExport([comp])}>
                          <FileDown className="w-3.5 h-3.5 mr-2" /> Export PDF
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteComp({ id: comp.id, name: comp.name })}>
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                        {selectedIds.size > 1 && (
                          <DropdownMenuItem className="text-destructive font-medium" onClick={() => setBulkDeleteOpen(true)}>
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete All Selected ({selectedIds.size})
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <div className="flex items-center gap-1">
                      {(() => {
                        const link = propertyLinkFor(comp);
                        return link.external ? (
                          <a
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-left font-medium hover:text-primary hover:underline transition-colors truncate block"
                            data-testid={`comp-name-${comp.id}`}
                          >
                            {comp.name}
                          </a>
                        ) : (
                          <Link
                            href={link.href}
                            className="text-left font-medium hover:text-primary hover:underline transition-colors truncate block"
                            data-testid={`comp-name-${comp.id}`}
                          >
                            {comp.name}
                          </Link>
                        );
                      })()}
                      <InlineLinkSelect
                        value={comp.propertyId}
                        options={propertyOptions}
                        href={comp.propertyId ? `/properties/${comp.propertyId}` : undefined}
                        onSave={(v) => {
                          updateMutation.mutate({ id: comp.id, field: "propertyId", value: v });
                          // Auto-fill area + postcode from property address when area is empty
                          if (v) {
                            const prop = properties.find((p: any) => p.id === v);
                            const addr = prop?.address as any;
                            if (addr?.city && !comp.areaLocation) {
                              updateMutation.mutate({ id: comp.id, field: "areaLocation", value: addr.city });
                            }
                            if (addr?.postcode && !comp.postcode) {
                              updateMutation.mutate({ id: comp.id, field: "postcode", value: addr.postcode });
                            }
                          }
                        }}
                        compact
                      />
                      {!comp.propertyId && !propertyByName.get(normName(comp.name || "")) && (
                        <a
                          href={buildGoogleMapsUrl((comp.address as any)?.formatted || comp.name) || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-blue-600 transition-colors"
                          title="View on Google Maps"
                        >
                          <MapPin className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {comp.postcode && <span className="text-[10px] text-muted-foreground">{comp.postcode}</span>}
                      {comp.sourceEvidence === "News Feed" && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">News</span>}
                      {comp.sourceEvidence === "Team Email" && <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">Email</span>}
                      {comp.sourceEvidence === "SharePoint File" && <span className="text-[9px] px-1 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">File</span>}
                      {comp.sourceEvidence === "BGP Direct" && <span className="text-[9px] px-1 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">BGP</span>}
                      {comp.dealId && dealById.get(comp.dealId) && (
                        <span className="text-[9px] px-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 truncate max-w-[140px]" title={dealById.get(comp.dealId)?.name}>
                          {dealById.get(comp.dealId)?.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 truncate">
                    <div className="flex items-center gap-1">
                      <InlineText value={comp.tenant || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "tenant", value: v })} className="block truncate" />
                      {comp.tenant && (() => {
                        const companyId = findCompanyId(comp.tenant);
                        if (companyId) {
                          return (
                            <Link
                              href={`/companies?highlight=${companyId}`}
                              className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                              title="Open matched CRM company"
                              data-testid={`tenant-link-${comp.id}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          );
                        }
                        return (
                          <button
                            onClick={() => createAndEnrichCompany.mutate(comp.tenant!)}
                            disabled={createAndEnrichCompany.isPending}
                            className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                            title="Add to CRM & enrich via Apollo"
                            data-testid={`tenant-enrich-${comp.id}`}
                          >
                            {createAndEnrichCompany.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          </button>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 truncate">
                    <InlineText value={comp.areaLocation || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "areaLocation", value: v })} className="block truncate" />
                  </td>
                  <td className="px-2 py-1.5">
                    <InlineLabelSelect
                      value={comp.useClass || ""}
                      options={USE_CLASS_OPTIONS}
                      colorMap={USE_CLASS_COLORS}
                      onSave={v => updateMutation.mutate({ id: comp.id, field: "useClass", value: v })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <InlineLabelSelect
                      value={comp.transactionType || ""}
                      options={TRANSACTION_TYPE_OPTIONS}
                      colorMap={TXN_TYPE_COLORS}
                      onSave={v => updateMutation.mutate({ id: comp.id, field: "transactionType", value: v })}
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <InlineText value={comp.completionDate || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "completionDate", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap">
                    <SteppedRentCell value={comp.headlineRent || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "headlineRent", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-blue-600 font-semibold">
                    <FormulaCell
                      value={comp.zoneARate || ""}
                      onSave={v => updateMutation.mutate({ id: comp.id, field: "zoneARate", value: v })}
                      compute={() => {
                        const rent = parseNum(comp.headlineRent);
                        const itza = parseNum(comp.itzaSqft);
                        if (!rent || !itza) return null;
                        return (rent / itza).toFixed(2);
                      }}
                      formulaLabel="Zone A = Rent ÷ ITZA"
                      disabled={!parseNum(comp.headlineRent) || !parseNum(comp.itzaSqft)}
                      currency
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <FormulaCell
                      value={comp.overallRate || ""}
                      onSave={v => updateMutation.mutate({ id: comp.id, field: "overallRate", value: v })}
                      compute={() => {
                        const rent = parseNum(comp.headlineRent);
                        const pref = preferredAreaField(comp.useClass);
                        const area = parseNum(comp[pref]) || parseNum(comp.niaSqft) || parseNum(comp.giaSqft);
                        if (!rent || !area) return null;
                        return (rent / area).toFixed(2);
                      }}
                      formulaLabel={`Overall = Rent ÷ ${preferredAreaField(comp.useClass) === "giaSqft" ? "GIA" : "NIA"}${!parseNum(comp[preferredAreaField(comp.useClass)]) ? " (falling back to other area)" : ""}`}
                      disabled={!parseNum(comp.headlineRent) || (!parseNum(comp.niaSqft) && !parseNum(comp.giaSqft))}
                      currency
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-green-600 font-semibold">
                    <FormulaCell
                      value={comp.netEffectiveRent || ""}
                      onSave={v => updateMutation.mutate({ id: comp.id, field: "netEffectiveRent", value: v })}
                      compute={() => {
                        const ne = computeNetEffective(comp);
                        if (!ne) return null;
                        return Math.round(ne).toString();
                      }}
                      formulaLabel="Net Eff = Avg headline (across stepped rents) − (Rent free £ + Tenant incentive £) ÷ Term"
                      disabled={!parseNum(comp.headlineRent) || !parseYears(comp.term)}
                      currency
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-green-700 font-semibold">
                    <FormulaCell
                      value={comp.effectiveRatePsf || ""}
                      onSave={v => updateMutation.mutate({ id: comp.id, field: "effectiveRatePsf", value: v })}
                      compute={() => {
                        const ne = parseNum(comp.netEffectiveRent) || computeNetEffective(comp);
                        const pref = preferredAreaField(comp.useClass);
                        const area = parseNum(comp[pref]) || parseNum(comp.niaSqft) || parseNum(comp.giaSqft);
                        if (!ne || !area) return null;
                        return (ne / area).toFixed(2);
                      }}
                      formulaLabel={`Net Eff psf = Net Effective ÷ ${preferredAreaField(comp.useClass) === "giaSqft" ? "GIA" : "NIA"}`}
                      disabled={
                        (!parseNum(comp.netEffectiveRent) && (!parseNum(comp.headlineRent) || !parseYears(comp.term))) ||
                        (!parseNum(comp.niaSqft) && !parseNum(comp.giaSqft))
                      }
                      currency
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <NumberCell value={comp.niaSqft || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "niaSqft", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <NumberCell value={comp.giaSqft || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "giaSqft", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <NumberCell value={comp.itzaSqft || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "itzaSqft", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <NumberCell value={comp.term || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "term", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <NumberCell value={comp.rentFreeMonths || comp.rentFree || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "rentFreeMonths", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-amber-700">
                    <CurrencyCell value={comp.fitoutContribution || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "fitoutContribution", value: v })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <InlineLabelSelect
                      value={comp.ltActStatus || ""}
                      options={LT_ACT_OPTIONS}
                      colorMap={{
                        "Inside L&T Act": "bg-green-600 text-white",
                        "Outside L&T Act": "bg-red-600 text-white",
                        "Contracted Out": "bg-amber-600 text-white",
                      }}
                      onSave={v => updateMutation.mutate({ id: comp.id, field: "ltActStatus", value: v })}
                    />
                  </td>
                  {/* Source column */}
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <InlineLabelSelect
                        value={comp.sourceEvidence || ""}
                        options={["BGP Direct", "News Feed", "Team Email", "SharePoint File", "Agent", "Other"]}
                        colorMap={{
                          "BGP Direct": "bg-green-600 text-white",
                          "News Feed": "bg-amber-600 text-white",
                          "Team Email": "bg-purple-600 text-white",
                          "SharePoint File": "bg-cyan-600 text-white",
                          "Agent": "bg-blue-600 text-white",
                          "Other": "bg-gray-600 text-white",
                        }}
                        onSave={v => updateMutation.mutate({ id: comp.id, field: "sourceEvidence", value: v })}
                      />
                      {(comp as any).sourceUrl && (
                        <a
                          href={(comp as any).sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline flex items-center gap-0.5 truncate max-w-[120px]"
                          title={(comp as any).sourceTitle || (comp as any).sourceUrl}
                        >
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          {(comp as any).sourceTitle || "View source"}
                        </a>
                      )}
                    </div>
                  </td>
                  {/* Contact (source provider) column */}
                  <td className="px-2 py-1.5">
                    {(() => {
                      const ct = (comp as any).sourceContactId ? contactById.get((comp as any).sourceContactId) : null;
                      const co = ct?.companyId ? companyById.get(ct.companyId) : null;
                      return ct ? (
                        <div className="space-y-0.5">
                          <Link href={`/contacts/${ct.id}`} className="text-[11px] font-medium text-primary hover:underline truncate block max-w-[130px]">{ct.name}</Link>
                          {co && <p className="text-[10px] text-muted-foreground truncate max-w-[130px]">{co.name}</p>}
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {ct.phone && (
                              <a href={`tel:${ct.phone}`} className="flex items-center gap-0.5 hover:text-foreground" onClick={(e: any) => e.stopPropagation()}>
                                <Phone className="w-2.5 h-2.5" />
                              </a>
                            )}
                            {ct.email && (
                              <a href={`mailto:${ct.email}`} className="flex items-center gap-0.5 hover:text-foreground" onClick={(e: any) => e.stopPropagation()}>
                                <Mail className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      ) : (
                        <InlineLinkSelect
                          value={(comp as any).sourceContactId || ""}
                          options={contactOptions}
                          href={(comp as any).sourceContactId ? `/contacts/${(comp as any).sourceContactId}` : undefined}
                          onSave={v => updateMutation.mutate({ id: comp.id, field: "sourceContactId", value: v })}
                          compact
                        />
                      );
                    })()}
                  </td>
                  <td className="px-2 py-1.5">
                    <DealCell
                      value={comp.dealId || ""}
                      deals={deals}
                      onSave={(dealId) => {
                        // Linking a comp to a deal also marks it as verified — it's now part of a deal pack.
                        updateMutation.mutate({ id: comp.id, field: "dealId", value: dealId || null });
                        if (dealId && !comp.verified) {
                          updateMutation.mutate({ id: comp.id, field: "verified", value: true });
                        }
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => updateMutation.mutate({ id: comp.id, field: "verified", value: !comp.verified })}
                      className="transition-colors"
                      data-testid={`toggle-verified-${comp.id}`}
                    >
                      {comp.verified ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                      )}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <InlineText
                      value={comp.comments || ""}
                      onSave={v => updateMutation.mutate({ id: comp.id, field: "comments", value: v })}
                      multiline
                      maxLines={2}
                      className="block max-w-[230px] whitespace-normal"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </TabsContent>

      <TabsContent value="investment" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-hidden">
        <InvestmentCompsPage embedded />
      </TabsContent>

      <TabsContent value="leads" className="flex-1 overflow-auto mt-0 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Inbox className="w-4 h-4 text-amber-600" />
              Unconfirmed Leads
              <span className="text-xs font-normal text-muted-foreground">
                ({leadComps.length} extracted from news, emails &amp; SharePoint)
              </span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Click a lead to review and confirm into the main comps table.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
            disabled={scanning}
            onClick={async () => {
              setScanning(true);
              try {
                const res = await fetch("/api/news-feed/extract-comps", { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` } });
                if (!res.ok) throw new Error(`Server error ${res.status}`);
                await res.json();
                queryClient.invalidateQueries({ queryKey: ["/api/crm/comps"] });
                toast({ title: "Scan complete" });
              } catch (e: any) { toast({ title: "Error", description: e?.message || "Scan failed", variant: "destructive" }); }
              setScanning(false);
            }}
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Scan All Sources
          </Button>
        </div>

        {leadComps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Inbox className="w-12 h-12 text-muted-foreground/20 mb-3" />
            <h3 className="text-sm font-semibold mb-1">No leads waiting</h3>
            <p className="text-xs text-muted-foreground">Run "Scan All Sources" to extract new comps from news, team emails and SharePoint files.</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 220 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 90 }} />
                </colgroup>
                <thead className="bg-muted/40 border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">
                      <Checkbox
                        checked={selectedIds.size === leadComps.length && leadComps.length > 0}
                        onCheckedChange={(checked) => {
                          setSelectedIds(checked ? new Set(leadComps.map(l => l.id)) : new Set());
                        }}
                        data-testid="checkbox-leads-select-all"
                      />
                    </th>
                    <th className="px-2 py-2 text-left">Action</th>
                    <th className="px-2 py-2 text-left">Property</th>
                    <th className="px-2 py-2 text-left">Tenant</th>
                    <th className="px-2 py-2 text-left">Area</th>
                    <th className="px-2 py-2 text-left">Use Class</th>
                    <th className="px-2 py-2 text-left">Headline</th>
                    <th className="px-2 py-2 text-left">Zone A</th>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {leadComps.map(lead => {
                    const sourceColor =
                      lead.sourceEvidence === "News Feed" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                      lead.sourceEvidence === "Team Email" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
                      lead.sourceEvidence === "SharePoint File" ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400" :
                      "bg-muted text-muted-foreground";
                    return (
                      <tr key={lead.id} className={`border-b hover:bg-muted/30 ${selectedIds.has(lead.id) ? "bg-primary/5" : ""}`} data-testid={`lead-row-${lead.id}`}>
                        <td className="px-2 py-1.5">
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={(checked) => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                checked ? next.add(lead.id) : next.delete(lead.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded hover:bg-muted transition-colors" data-testid={`lead-menu-${lead.id}`}>
                                <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => setConfirmLead(lead)}>
                                <Eye className="w-3.5 h-3.5 mr-2" /> Review
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                updateMutation.mutate({ id: lead.id, field: "verified", value: true });
                                toast({ title: "Lead verified", description: `${lead.name || "Lead"} moved to comps` });
                              }}>
                                <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-600" /> Verify
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => deleteMutation.mutate(lead.id)}>
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> Discard
                              </DropdownMenuItem>
                              {selectedIds.size > 1 && (
                                <DropdownMenuItem className="text-destructive font-medium" onClick={() => setBulkDeleteOpen(true)}>
                                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete All Selected ({selectedIds.size})
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                        <td className="px-2 py-1.5 truncate">
                          {(() => {
                            const link = propertyLinkFor(lead);
                            return link.external ? (
                              <a
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-left font-medium hover:text-primary hover:underline transition-colors truncate block w-full"
                                data-testid={`lead-name-${lead.id}`}
                              >
                                {lead.name || "Untitled"}
                              </a>
                            ) : (
                              <Link
                                href={link.href}
                                className="text-left font-medium hover:text-primary hover:underline transition-colors truncate block w-full"
                                data-testid={`lead-name-${lead.id}`}
                              >
                                {lead.name || "Untitled"}
                              </Link>
                            );
                          })()}
                          {lead.postcode && <div className="text-[10px] text-muted-foreground">{lead.postcode}</div>}
                        </td>
                        <td className="px-2 py-1.5 truncate">{lead.tenant || "—"}</td>
                        <td className="px-2 py-1.5 truncate">{lead.areaLocation || "—"}</td>
                        <td className="px-2 py-1.5 truncate">{lead.useClass || "—"}</td>
                        <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{formatSteppedRent(lead.headlineRent) || "—"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-blue-600 font-semibold">{lead.zoneARate ? formatGBP(parseNum(lead.zoneARate)) : "—"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{lead.completionDate || "—"}</td>
                        <td className="px-2 py-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${sourceColor}`}>
                            {lead.sourceEvidence || "AI"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="pdf-template" className="flex-1 overflow-auto mt-0 p-6 space-y-6">
        <DealCompPackPanel
          deals={deals}
          comps={comps}
          onExport={(targetComps) => startPdfExport(targetComps)}
          onAddCompsToDeal={(dealId, ids) => {
            // Adding comps to a deal also marks them verified — this is the
            // "add to PDF template summary sheet" → "moves to verified" flow.
            ids.forEach(id => {
              updateMutation.mutate({ id, field: "dealId", value: dealId });
              updateMutation.mutate({ id, field: "verified", value: true });
            });
            toast({
              title: `${ids.length} comp${ids.length !== 1 ? "s" : ""} added to deal`,
              description: "Comps marked as verified and linked to the deal pack.",
            });
          }}
        />
        <Tabs defaultValue="leasing-template" className="space-y-4">
          <TabsList>
            <TabsTrigger value="leasing-template" data-testid="tab-pdf-scope-leasing">
              <Scale className="w-3.5 h-3.5 mr-1.5" />
              Leasing Template
            </TabsTrigger>
            <TabsTrigger value="investment-template" data-testid="tab-pdf-scope-investment">
              <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
              Investment Template
            </TabsTrigger>
          </TabsList>
          <TabsContent value="leasing-template">
            <CompPdfTemplateEditor scope="leasing" />
          </TabsContent>
          <TabsContent value="investment-template">
            <CompPdfTemplateEditor scope="investment" />
          </TabsContent>
        </Tabs>
      </TabsContent>

      <Dialog open={!!selectedComp} onOpenChange={(open) => { if (!open) setSelectedComp(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedComp && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-primary" />
                  {selectedComp.name}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Property Details</h4>
                  <div className="space-y-2">
                    <DetailField label="Property" value={selectedComp.name} field="name" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "name", value: v })} />
                    <DetailField label="Tenant" value={selectedComp.tenant} field="tenant" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "tenant", value: v })} />
                    <DetailField label="Landlord" value={selectedComp.landlord} field="landlord" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "landlord", value: v })} />
                    <DetailField label="Area" value={selectedComp.areaLocation} field="areaLocation" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "areaLocation", value: v })} />
                    <DetailField label="Postcode" value={selectedComp.postcode} field="postcode" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "postcode", value: v })} />
                    <DetailField label="Use Class" value={selectedComp.useClass} field="useClass" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "useClass", value: v })} />
                    <DetailField label="Demise" value={selectedComp.demise} field="demise" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "demise", value: v })} />
                    {selectedComp.useClass && RICS_USE_CLASS_GUIDE[selectedComp.useClass] && (
                      <div className="mt-2 p-2 rounded border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 space-y-1" data-testid="rics-guidance">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                          <Info className="w-3 h-3" /> RICS Measurement
                        </div>
                        <div className="text-[11px]">
                          <span className="font-semibold">Primary:</span> {RICS_USE_CLASS_GUIDE[selectedComp.useClass].primary}
                          {RICS_USE_CLASS_GUIDE[selectedComp.useClass].secondary && (
                            <> · <span className="font-semibold">Secondary:</span> {RICS_USE_CLASS_GUIDE[selectedComp.useClass].secondary}</>
                          )}
                        </div>
                        <div className="text-[11px]">
                          <span className="font-semibold">Analysis:</span> {RICS_USE_CLASS_GUIDE[selectedComp.useClass].analysis}
                        </div>
                        <div className="text-[10px] text-muted-foreground leading-relaxed">
                          {RICS_USE_CLASS_GUIDE[selectedComp.useClass].notes}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Scale className="w-3.5 h-3.5" /> Transaction</h4>
                  <div className="space-y-2">
                    <DetailField label="Transaction Type" value={selectedComp.transactionType} field="transactionType" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "transactionType", value: v })} />
                    <DetailField label="Date" value={selectedComp.completionDate} field="completionDate" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "completionDate", value: v })} />
                    <DetailField label="L&T Act" value={selectedComp.ltActStatus} field="ltActStatus" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "ltActStatus", value: v })} />
                    <DetailField label="Term" value={selectedComp.term} field="term" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "term", value: v })} />
                    <DetailField label="Break" value={selectedComp.breakClause} field="breakClause" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "breakClause", value: v })} />
                    <DetailField label="Lease Start" value={selectedComp.leaseStart} field="leaseStart" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "leaseStart", value: v })} />
                    <DetailField label="Lease Expiry" value={selectedComp.leaseExpiry} field="leaseExpiry" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "leaseExpiry", value: v })} />
                    <DetailField label="RR Pattern" value={selectedComp.rentReviewPattern} field="rentReviewPattern" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "rentReviewPattern", value: v })} />
                    <DetailField label="Source" value={selectedComp.sourceEvidence} field="sourceEvidence" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "sourceEvidence", value: v })} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Ruler className="w-3.5 h-3.5" /> Area (RICS)</h4>
                  <div className="space-y-2">
                    <DetailField label="NIA (sq ft)" value={selectedComp.niaSqft} field="niaSqft" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "niaSqft", value: v })} />
                    <DetailField label="GIA (sq ft)" value={selectedComp.giaSqft} field="giaSqft" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "giaSqft", value: v })} />
                    <DetailField label="IPMS (sq ft)" value={selectedComp.ipmsSqft} field="ipmsSqft" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "ipmsSqft", value: v })} />
                    <DetailField label="ITZA (sq ft)" value={selectedComp.itzaSqft} field="itzaSqft" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "itzaSqft", value: v })} />
                    <DetailField label="Frontage (ft)" value={selectedComp.frontageFt} field="frontageFt" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "frontageFt", value: v })} />
                    <DetailField label="Depth (ft)" value={selectedComp.depthFt} field="depthFt" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "depthFt", value: v })} />
                    <DetailField label="Measurement Std" value={selectedComp.measurementStandard} field="measurementStandard" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "measurementStandard", value: v })} />
                    {selectedComp.useClass && RICS_USE_CLASS_GUIDE[selectedComp.useClass] && !selectedComp.measurementStandard && (
                      <button
                        onClick={() => {
                          const rec = RICS_USE_CLASS_GUIDE[selectedComp.useClass!].primary;
                          updateMutation.mutate({ id: selectedComp.id, field: "measurementStandard", value: rec });
                        }}
                        className="text-[10px] text-blue-600 hover:underline text-left"
                        data-testid="button-apply-rics-measurement"
                      >
                        Apply RICS recommended: {RICS_USE_CLASS_GUIDE[selectedComp.useClass].primary}
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rental Analysis</h4>
                  <div className="space-y-2">
                    <DetailField label="Headline Rent" value={selectedComp.headlineRent} field="headlineRent" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "headlineRent", value: v })} />
                    <DetailField label="Zone A (psf)" value={selectedComp.zoneARate} field="zoneARate" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "zoneARate", value: v })} />
                    <DetailField label="Overall (psf)" value={selectedComp.overallRate} field="overallRate" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "overallRate", value: v })} />
                    <DetailField label="Net Effective" value={selectedComp.netEffectiveRent} field="netEffectiveRent" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "netEffectiveRent", value: v })} />
                    <DetailField label="Rent Free (mths)" value={selectedComp.rentFreeMonths || selectedComp.rentFree} field="rentFreeMonths" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "rentFreeMonths", value: v })} />
                    <DetailField label="Tenant Incentive" value={selectedComp.fitoutContribution} field="fitoutContribution" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "fitoutContribution", value: v })} />
                    <DetailField label="£ psf (NIA)" value={selectedComp.rentPsfNia} field="rentPsfNia" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "rentPsfNia", value: v })} />
                    <DetailField label="£ psf (GIA)" value={selectedComp.rentPsfGia} field="rentPsfGia" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "rentPsfGia", value: v })} />
                  </div>
                </div>
              </div>
              {selectedComp.comments && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</h4>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{selectedComp.comments}</p>
                </div>
              )}
              {selectedComp.rentAnalysis && (
                <div className="mt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Rent Analysis</h4>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{selectedComp.rentAnalysis}</p>
                </div>
              )}

              <div className="mt-4 border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5" /> Files ({selectedCompFiles.length})
                  </h4>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file && selectedComp) {
                          uploadFileMutation.mutate({ compId: selectedComp.id, file });
                        }
                        e.target.value = "";
                      }}
                      data-testid="input-comp-file-upload"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      disabled={uploadFileMutation.isPending}
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-upload-comp-file"
                    >
                      {uploadFileMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      Upload
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => startPdfExport([selectedComp])}
                      data-testid="button-detail-pdf"
                    >
                      <FileDown className="w-3 h-3" /> PDF
                    </Button>
                  </div>
                </div>
                {selectedCompFiles.length > 0 ? (
                  <div className="space-y-1.5">
                    {selectedCompFiles.map(f => (
                      <div key={f.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border text-xs group" data-testid={`comp-file-${f.id}`}>
                        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <a
                          href={`/api/comp-files/${f.id}/download`}
                          className="flex-1 truncate hover:text-primary transition-colors font-medium"
                          target="_blank"
                          rel="noopener"
                          data-testid={`link-download-file-${f.id}`}
                        >
                          {f.fileName}
                        </a>
                        {f.fileSize && <span className="text-[10px] text-muted-foreground shrink-0">{(f.fileSize / 1024).toFixed(0)} KB</span>}
                        <button
                          onClick={() => deleteFileMutation.mutate(f.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-destructive transition-all"
                          data-testid={`button-delete-file-${f.id}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No files attached</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Leasing Comp</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-medium mb-1 block">Property / Address *</label>
              <PropertyAddressInput
                value={newName}
                propertyOptions={propertyOptions}
                onSelectProperty={(p) => {
                  setNewName(p.name);
                  setNewPropertyId(p.id);
                  setNewAddress(null);
                  // Auto-fill area from property if available
                  const prop = properties.find((pr: any) => pr.id === p.id);
                  if (prop) {
                    const addr = prop.address as any;
                    if (addr?.city && !newArea) setNewArea(addr.city);
                    if (addr?.postcode && !newPostcode) setNewPostcode(addr.postcode);
                  }
                }}
                onSelectAddress={(addr) => {
                  setNewName(addr.formatted);
                  setNewPropertyId(null);
                  setNewAddress(addr);
                  if (addr.city && !newArea) setNewArea(addr.city);
                  if (addr.region && !newArea) setNewArea(addr.region);
                  if (addr.postcode) setNewPostcode(addr.postcode);
                }}
                onManualInput={(v) => { setNewName(v); setNewPropertyId(null); setNewAddress(null); }}
              />
              {newPropertyId && (
                <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1">
                  <Building2 className="w-2.5 h-2.5" /> Linked to BGP property
                </p>
              )}
              {!newPropertyId && newAddress && (
                <p className="text-[10px] text-blue-600 mt-1 flex items-center gap-1">
                  <MapPin className="w-2.5 h-2.5" /> Google address
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Tenant</label>
                <Input value={newTenant} onChange={e => setNewTenant(e.target.value)} placeholder="Tenant name" className="h-9" data-testid="create-comp-tenant" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Area</label>
                <Input value={newArea} onChange={e => setNewArea(e.target.value)} placeholder="Mayfair" className="h-9" data-testid="create-comp-area" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Use Class</label>
                <Select value={newUseClass} onValueChange={setNewUseClass}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {USE_CLASS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
                {newUseClass && RICS_USE_CLASS_GUIDE[newUseClass] && (
                  <p className="text-[10px] text-muted-foreground mt-1" data-testid="text-rics-create-hint">
                    <Info className="w-2.5 h-2.5 inline mr-0.5 -mt-0.5" />
                    RICS: measure on <span className="font-semibold">{RICS_USE_CLASS_GUIDE[newUseClass].primary}</span>
                    {RICS_USE_CLASS_GUIDE[newUseClass].secondary && ` / ${RICS_USE_CLASS_GUIDE[newUseClass].secondary}`}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Transaction Type</label>
                <Select value={newTxnType} onValueChange={setNewTxnType}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {TRANSACTION_TYPE_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Headline Rent (£ pa)</label>
                <Input value={newHeadlineRent} onChange={e => setNewHeadlineRent(e.target.value)} placeholder="250,000" className="h-9" data-testid="create-comp-rent" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Zone A Rate (£ psf)</label>
                <Input value={newZoneA} onChange={e => setNewZoneA(e.target.value)} placeholder="565" className="h-9" data-testid="create-comp-zone-a" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Date</label>
              <Input value={newDate} onChange={e => setNewDate(e.target.value)} placeholder="Jun 2024" className="h-9" data-testid="create-comp-date" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({
                name: newName.trim(),
                propertyId: newPropertyId || undefined,
                address: newAddress ? { formatted: newAddress.formatted, placeId: newAddress.placeId, lat: newAddress.lat, lng: newAddress.lng, street: newAddress.street, city: newAddress.city, region: newAddress.region, postcode: newAddress.postcode, country: newAddress.country } : undefined,
                tenant: newTenant || null,
                areaLocation: newArea || null,
                postcode: newPostcode || null,
                useClass: newUseClass || null,
                transactionType: newTxnType || null,
                headlineRent: newHeadlineRent || null,
                zoneARate: newZoneA || null,
                completionDate: newDate || null,
                sourceEvidence: "BGP Direct",
              })}
              data-testid="button-save-comp"
            >
              {createMutation.isPending ? "Creating..." : "Create Comp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={calcOpen} onOpenChange={setCalcOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Net Effective Rent Calculator
            </DialogTitle>
          </DialogHeader>
          <NetRentCalculator onClose={() => setCalcOpen(false)} />
          <div className="mt-3 p-3 bg-muted/30 rounded-lg">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <span className="font-semibold">RICS Professional Statement:</span> Calculations follow the RICS Valuation Global Standards (Red Book) methodology. Zone A analysis per RICS Code of Measuring Practice 6th Edition — retail premises measured on ITZA basis with standard zone depth of 6.1m (20ft). GIA/NIA per RICS Property Measurement 2nd Edition (2018) aligned with IPMS.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rpiOpen} onOpenChange={setRpiOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              RPI / CPI Indexation Calculator
            </DialogTitle>
          </DialogHeader>
          <RpiCpiCalculator />
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmLead} onOpenChange={(open) => { if (!open) setConfirmLead(null); }}>
        <DialogContent className="max-w-lg">
          {confirmLead && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Inbox className="w-5 h-5 text-amber-600" />
                  Confirm Lead
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="p-3 rounded-lg border bg-muted/30">
                  <div className="font-semibold text-sm">{confirmLead.name}</div>
                  {confirmLead.tenant && <div className="text-xs text-muted-foreground">{confirmLead.tenant}</div>}
                  {confirmLead.areaLocation && <div className="text-xs text-muted-foreground">{confirmLead.areaLocation}{confirmLead.postcode ? `, ${confirmLead.postcode}` : ""}</div>}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {confirmLead.useClass && <div><span className="text-muted-foreground">Use Class:</span> <span className="font-semibold">{confirmLead.useClass}</span></div>}
                  {confirmLead.transactionType && <div><span className="text-muted-foreground">Type:</span> <span className="font-semibold">{confirmLead.transactionType}</span></div>}
                  {confirmLead.completionDate && <div><span className="text-muted-foreground">Date:</span> <span className="font-semibold">{confirmLead.completionDate}</span></div>}
                  {confirmLead.term && <div><span className="text-muted-foreground">Term:</span> <span className="font-semibold">{confirmLead.term}</span></div>}
                  {confirmLead.headlineRent && <div className="col-span-2"><span className="text-muted-foreground">Headline Rent:</span> <span className="font-semibold">{formatSteppedRent(confirmLead.headlineRent) || confirmLead.headlineRent}</span></div>}
                  {confirmLead.zoneARate && <div><span className="text-muted-foreground">Zone A:</span> <span className="font-semibold">£{confirmLead.zoneARate}</span></div>}
                  {confirmLead.itzaSqft && <div><span className="text-muted-foreground">ITZA:</span> <span className="font-semibold">{formatInt(parseNum(confirmLead.itzaSqft))} sq ft</span></div>}
                  {confirmLead.niaSqft && <div><span className="text-muted-foreground">NIA:</span> <span className="font-semibold">{formatInt(parseNum(confirmLead.niaSqft))} sq ft</span></div>}
                </div>
                {confirmLead.comments && (
                  <div className="text-xs">
                    <div className="text-muted-foreground mb-1">Notes / Source</div>
                    <div className="p-2 rounded bg-muted/30 whitespace-pre-wrap">{confirmLead.comments}</div>
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground bg-amber-50 dark:bg-amber-950/20 p-2 rounded border border-amber-200 dark:border-amber-900">
                  Confirming this lead marks it as <span className="font-semibold">verified</span> and moves it into the main Leasing Comps table.
                </div>
              </div>
              <DialogFooter className="mt-4 gap-2">
                <Button variant="outline" onClick={() => setConfirmLead(null)} data-testid="button-cancel-confirm-lead">Cancel</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirmLead) {
                      deleteMutation.mutate(confirmLead.id);
                      setConfirmLead(null);
                    }
                  }}
                  data-testid="button-discard-lead"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Discard
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    if (confirmLead) {
                      updateMutation.mutate({ id: confirmLead.id, field: "verified", value: true });
                      toast({ title: "Lead confirmed", description: `${confirmLead.name} added to Leasing Comps` });
                      setConfirmLead(null);
                    }
                  }}
                  data-testid="button-confirm-lead"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Confirm Lead
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteComp} onOpenChange={open => { if (!open) setDeleteComp(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comp</AlertDialogTitle>
            <AlertDialogDescription>Delete "{deleteComp?.name}"? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => { if (deleteComp) deleteMutation.mutate(deleteComp.id); setDeleteComp(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} comps</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the selected comparables.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => { bulkDeleteMutation.mutate(Array.from(selectedIds)); setBulkDeleteOpen(false); }}>Delete All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={pdfConfirmComps.length > 0} onOpenChange={(open) => { if (!open) setPdfConfirmComps([]); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileDown className="w-5 h-5 text-primary" />
              Export PDF
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {Object.values(pdfConfirmFiles).flat().length} file{Object.values(pdfConfirmFiles).flat().length !== 1 ? "s" : ""} attached to the selected comp{pdfConfirmComps.length !== 1 ? "s" : ""}.
            </p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-files"
                checked={includeFilesInPdf}
                onCheckedChange={(v) => setIncludeFilesInPdf(!!v)}
                data-testid="checkbox-include-files"
              />
              <label htmlFor="include-files" className="text-sm cursor-pointer">
                Include file list in PDF
              </label>
            </div>
            <div className="space-y-1">
              {Object.entries(pdfConfirmFiles).map(([compId, files]) => {
                const comp = pdfConfirmComps.find(c => c.id === compId);
                return files.map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="truncate">{f.fileName}</span>
                    {comp && pdfConfirmComps.length > 1 && <span className="text-[10px]">({comp.name})</span>}
                  </div>
                ));
              })}
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setPdfConfirmComps([])}>Cancel</Button>
            <Button
              onClick={() => {
                generateCompsPdf(pdfConfirmComps, includeFilesInPdf, pdfConfirmFiles, pdfTemplate);
                toast({ title: "PDF exported", description: `${pdfConfirmComps.length} comp${pdfConfirmComps.length !== 1 ? "s" : ""} exported` });
                setPdfConfirmComps([]);
              }}
              data-testid="button-confirm-pdf"
            >
              <FileDown className="w-4 h-4 mr-1.5" />
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
    </TooltipProvider>
  );
}

function DetailField({ label, value, field, id, onSave }: { label: string; value: string | null | undefined; field: string; id: string; onSave: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-28 shrink-0">{label}</span>
      <InlineText value={value || ""} onSave={onSave} className="flex-1 text-xs" />
    </div>
  );
}

function FormulaCell({
  value,
  onSave,
  compute,
  formulaLabel,
  disabled,
  currency,
}: {
  value: string;
  onSave: (v: string) => void;
  compute: () => string | null;
  formulaLabel: string;
  disabled?: boolean;
  currency?: boolean;
}) {
  const handleCompute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = compute();
    if (next != null) onSave(next);
  };
  return (
    <div className="flex items-center gap-1 group">
      {currency ? (
        <CurrencyCell value={value} onSave={onSave} />
      ) : (
        <InlineText value={value} onSave={onSave} />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleCompute}
            disabled={disabled}
            className="opacity-40 hover:opacity-100 group-hover:opacity-80 transition-opacity disabled:cursor-not-allowed disabled:opacity-20 p-0.5"
            data-testid="button-formula-compute"
            aria-label={formulaLabel}
          >
            <Calculator className="w-3 h-3 text-blue-600" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {disabled ? "Add the inputs (Headline rent, Term, Area, ITZA) to enable" : formulaLabel}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function DealCompPackPanel({
  deals, comps, onExport, onAddCompsToDeal,
}: {
  deals: { id: string; name: string; status?: string | null }[];
  comps: CrmComp[];
  onExport: (targetComps: CrmComp[]) => void;
  onAddCompsToDeal: (dealId: string, compIds: string[]) => void;
}) {
  const [selectedDealId, setSelectedDealId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<Set<string>>(new Set());
  const [pickerSearch, setPickerSearch] = useState("");

  const selectedDeal = useMemo(
    () => deals.find(d => d.id === selectedDealId),
    [deals, selectedDealId],
  );

  const linkedComps = useMemo(
    () => comps.filter(c => c.dealId === selectedDealId),
    [comps, selectedDealId],
  );

  const availableComps = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return comps
      .filter(c => c.dealId !== selectedDealId)
      .filter(c => !q || (c.name || "").toLowerCase().includes(q) || (c.tenant || "").toLowerCase().includes(q))
      .slice(0, 80);
  }, [comps, selectedDealId, pickerSearch]);

  const togglePickerId = (id: string) => {
    setPickerSelection(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleConfirmAdd = () => {
    if (!selectedDealId || pickerSelection.size === 0) return;
    onAddCompsToDeal(selectedDealId, Array.from(pickerSelection));
    setPickerSelection(new Set());
    setPickerSearch("");
    setPickerOpen(false);
  };

  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileDown className="w-4 h-4 text-primary" />
            Deal Comp Pack
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Link comps to a live deal, then export a comp pack summary sheet. Adding a comp here marks it verified.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedDealId || "__none__"} onValueChange={(v) => setSelectedDealId(v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-8 w-64 text-xs">
              <SelectValue placeholder="Select a deal..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Choose deal —</SelectItem>
              {deals.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}{d.status ? ` · ${d.status}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedDealId}
            onClick={() => { setPickerSelection(new Set()); setPickerSearch(""); setPickerOpen(true); }}
            data-testid="button-add-comps-to-deal"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add comps
          </Button>
          <Button
            size="sm"
            disabled={!selectedDealId || linkedComps.length === 0}
            onClick={() => onExport(linkedComps)}
            data-testid="button-export-deal-pack"
          >
            <FileDown className="w-3.5 h-3.5 mr-1" /> Export comp pack
          </Button>
        </div>
      </div>

      {selectedDeal ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{linkedComps.length}</span>{" "}
            comp{linkedComps.length !== 1 ? "s" : ""} linked to{" "}
            <span className="font-medium text-foreground">{selectedDeal.name}</span>
          </div>
          {linkedComps.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-3 border border-dashed rounded">
              No comps linked yet. Click "Add comps" to attach existing comps, or link them individually from the table (Deal column).
            </div>
          ) : (
            <div className="border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">Property</th>
                    <th className="text-left px-2 py-1.5 font-medium">Tenant</th>
                    <th className="text-right px-2 py-1.5 font-medium">Area</th>
                    <th className="text-right px-2 py-1.5 font-medium">Headline</th>
                    <th className="text-right px-2 py-1.5 font-medium">Zone A</th>
                    <th className="text-left px-2 py-1.5 font-medium">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedComps.map(c => (
                    <tr key={c.id} className="border-t">
                      <td className="px-2 py-1.5 truncate max-w-[220px]">{c.name || "—"}</td>
                      <td className="px-2 py-1.5 truncate max-w-[160px]">{c.tenant || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{c.areaSqft || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{c.headlineRent || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{c.zoneARate || "—"}</td>
                      <td className="px-2 py-1.5">
                        {c.verified ? (
                          <span className="text-green-700 dark:text-green-400 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unverified</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">
          Pick a deal above to start building its comp pack.
        </div>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Add comps to {selectedDeal?.name || "deal"}
            </DialogTitle>
          </DialogHeader>
          <div className="px-1 pb-2">
            <Input
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="Search property or tenant..."
              className="h-8 text-xs"
            />
          </div>
          <div className="flex-1 overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="w-8 px-2 py-1.5"></th>
                  <th className="text-left px-2 py-1.5 font-medium">Property</th>
                  <th className="text-left px-2 py-1.5 font-medium">Tenant</th>
                  <th className="text-right px-2 py-1.5 font-medium">Area</th>
                  <th className="text-right px-2 py-1.5 font-medium">Headline</th>
                  <th className="text-left px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {availableComps.map(c => (
                  <tr
                    key={c.id}
                    className="border-t hover:bg-muted/40 cursor-pointer"
                    onClick={() => togglePickerId(c.id)}
                  >
                    <td className="px-2 py-1.5">
                      <Checkbox
                        checked={pickerSelection.has(c.id)}
                        onCheckedChange={() => togglePickerId(c.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-2 py-1.5 truncate max-w-[220px]">{c.name || "—"}</td>
                    <td className="px-2 py-1.5 truncate max-w-[160px]">{c.tenant || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.areaSqft || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.headlineRent || "—"}</td>
                    <td className="px-2 py-1.5">
                      {c.verified ? (
                        <span className="text-green-700 dark:text-green-400">Verified</span>
                      ) : (
                        <span className="text-muted-foreground">Lead</span>
                      )}
                    </td>
                  </tr>
                ))}
                {availableComps.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground italic">
                      No comps match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DialogFooter className="gap-2">
            <div className="text-xs text-muted-foreground mr-auto self-center">
              {pickerSelection.size} selected
            </div>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pickerSelection.size === 0}
              onClick={handleConfirmAdd}
              data-testid="button-confirm-add-comps"
            >
              Add {pickerSelection.size} comp{pickerSelection.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
