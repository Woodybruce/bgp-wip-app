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
import { InlineText, InlineLabelSelect } from "@/components/inline-edit";
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
import {
  Search, Plus, Trash2, ChevronUp, ChevronDown, FilterX, Download,
  Calculator, Building2, MapPin, Scale, CheckCircle2,
  MoreHorizontal, Ruler, Loader2, Newspaper, Sparkles,
  FileText, Upload, X, Paperclip, FileDown,
} from "lucide-react";
import type { CrmComp } from "@shared/schema";
import jsPDF from "jspdf";

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
    { key: "passingRent", label: "Passing Rent", enabled: true },
    { key: "niaSqft", label: "NIA (sq ft)", enabled: true },
    { key: "itzaSqft", label: "ITZA (sq ft)", enabled: true },
    { key: "term", label: "Term", enabled: true },
    { key: "rentFree", label: "Rent Free", enabled: true },
    { key: "breakClause", label: "Break", enabled: true },
    { key: "ltActStatus", label: "L&T Act", enabled: true },
    { key: "fitoutContribution", label: "Fitout Contrib.", enabled: true },
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

  const updateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      await apiRequest("PUT", `/api/crm/comps/${id}`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/comps"] });
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

  const filtered = useMemo(() => {
    let result = comps;
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
      "NIA (sqft)", "GIA (sqft)", "ITZA (sqft)", "Rent Free", "Fitout Contribution",
      "Passing Rent", "Term", "Break", "L&T Act", "Measurement Standard",
      "Source", "Verified", "Comments",
    ];
    const rows = filtered.map(c => [
      c.name, c.tenant, c.landlord, c.areaLocation, c.postcode, c.useClass, c.transactionType,
      c.completionDate, c.headlineRent, c.zoneARate, c.overallRate, c.netEffectiveRent,
      c.niaSqft, c.giaSqft, c.itzaSqft, c.rentFree, c.fitoutContribution,
      c.passingRent, c.term, c.breakClause, c.ltActStatus, c.measurementStandard,
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
  const [newTenant, setNewTenant] = useState("");
  const [newArea, setNewArea] = useState("");
  const [newUseClass, setNewUseClass] = useState("");
  const [newTxnType, setNewTxnType] = useState("");
  const [newHeadlineRent, setNewHeadlineRent] = useState("");
  const [newZoneA, setNewZoneA] = useState("");
  const [newDate, setNewDate] = useState("");

  const resetCreateForm = () => {
    setNewName(""); setNewTenant(""); setNewArea(""); setNewUseClass("");
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
    <div className="h-full flex flex-col" data-testid="leasing-comps-page">
      <div className="border-b px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Scale className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-comps-title">Leasing Comps</h1>
              <p className="text-sm text-muted-foreground">Rent review evidence & comparable transactions</p>
            </div>
          </div>
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
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={exportToExcel} data-testid="button-export-comps">
              <Download className="w-3.5 h-3.5" />
              Export
            </Button>
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { resetCreateForm(); setCreateOpen(true); }} data-testid="button-create-comp">
              <Plus className="w-3.5 h-3.5" />
              Add Comp
            </Button>
          </div>
        </div>

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
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 border-b text-xs">
          <span className="font-medium">{selectedIds.size} selected</span>
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
            <Trash2 className="w-3 h-3" /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
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
          <table className="w-full" data-testid="comps-table">
            <thead className="sticky top-0 bg-background border-b z-10 text-sm">
              <tr>
                <th className="px-2 py-2.5 w-8">
                  <Checkbox
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onCheckedChange={(checked) => {
                      setSelectedIds(checked ? new Set(filtered.map(c => c.id)) : new Set());
                    }}
                    data-testid="checkbox-select-all"
                  />
                </th>
                <SortHeader field="name" className="min-w-[180px]">Property</SortHeader>
                <SortHeader field="tenant">Tenant</SortHeader>
                <SortHeader field="areaLocation">Area</SortHeader>
                <SortHeader field="useClass">Use Class</SortHeader>
                <SortHeader field="transactionType">Txn Type</SortHeader>
                <SortHeader field="completionDate">Date</SortHeader>
                <SortHeader field="headlineRent">Headline Rent</SortHeader>
                <SortHeader field="zoneARate">Zone A (psf)</SortHeader>
                <SortHeader field="overallRate">Overall (psf)</SortHeader>
                <SortHeader field="netEffectiveRent">Net Effective</SortHeader>
                <SortHeader field="niaSqft">NIA (sqft)</SortHeader>
                <SortHeader field="itzaSqft">ITZA</SortHeader>
                <SortHeader field="term">Term</SortHeader>
                <SortHeader field="rentFree">Rent Free</SortHeader>
                <SortHeader field="passingRent">Passing Rent</SortHeader>
                <SortHeader field="ltActStatus">L&T Act</SortHeader>
                <SortHeader field="verified">Verified</SortHeader>
                <th className="px-2 py-2.5 w-8" />
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
                    <button
                      className="text-left font-medium hover:text-primary transition-colors truncate max-w-[200px] block"
                      onClick={() => setSelectedComp(comp)}
                      data-testid={`comp-name-${comp.id}`}
                    >
                      {comp.name}
                    </button>
                    <div className="flex items-center gap-1">
                      {comp.postcode && <span className="text-[10px] text-muted-foreground">{comp.postcode}</span>}
                      {comp.sourceEvidence === "News Feed" && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">News</span>}
                      {comp.sourceEvidence === "Team Email" && <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">Email</span>}
                      {comp.sourceEvidence === "SharePoint File" && <span className="text-[9px] px-1 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">File</span>}
                      {comp.sourceEvidence === "BGP Direct" && <span className="text-[9px] px-1 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">BGP</span>}
                      {comp.dealId && <span className="text-[9px] px-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Deal</span>}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <InlineText value={comp.tenant || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "tenant", value: v })} className="max-w-[120px]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <InlineText value={comp.areaLocation || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "areaLocation", value: v })} className="max-w-[100px]" />
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
                    <InlineText value={comp.headlineRent || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "headlineRent", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-blue-600 font-semibold">
                    <InlineText value={comp.zoneARate || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "zoneARate", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <InlineText value={comp.overallRate || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "overallRate", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-green-600 font-semibold">
                    <InlineText value={comp.netEffectiveRent || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "netEffectiveRent", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <InlineText value={comp.niaSqft || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "niaSqft", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <InlineText value={comp.itzaSqft || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "itzaSqft", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <InlineText value={comp.term || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "term", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <InlineText value={comp.rentFree || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "rentFree", value: v })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <InlineText value={comp.passingRent || ""} onSave={v => updateMutation.mutate({ id: comp.id, field: "passingRent", value: v })} />
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
                  <td className="px-2 py-1.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-muted transition-colors" data-testid={`comp-menu-${comp.id}`}>
                          <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSelectedComp(comp)}>View Details</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => startPdfExport([comp])}>
                          <FileDown className="w-3.5 h-3.5 mr-2" /> Export PDF
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteComp({ id: comp.id, name: comp.name })}>
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rental Analysis</h4>
                  <div className="space-y-2">
                    <DetailField label="Headline Rent" value={selectedComp.headlineRent} field="headlineRent" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "headlineRent", value: v })} />
                    <DetailField label="Zone A (psf)" value={selectedComp.zoneARate} field="zoneARate" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "zoneARate", value: v })} />
                    <DetailField label="Overall (psf)" value={selectedComp.overallRate} field="overallRate" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "overallRate", value: v })} />
                    <DetailField label="Passing Rent" value={selectedComp.passingRent} field="passingRent" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "passingRent", value: v })} />
                    <DetailField label="Net Effective" value={selectedComp.netEffectiveRent} field="netEffectiveRent" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "netEffectiveRent", value: v })} />
                    <DetailField label="Rent Free" value={selectedComp.rentFree} field="rentFree" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "rentFree", value: v })} />
                    <DetailField label="Fitout Contribution" value={selectedComp.fitoutContribution} field="fitoutContribution" id={selectedComp.id} onSave={(v) => updateMutation.mutate({ id: selectedComp.id, field: "fitoutContribution", value: v })} />
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
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="10 Mount Street, W1K" className="h-9" data-testid="create-comp-name" />
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
                tenant: newTenant || null,
                areaLocation: newArea || null,
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
    </div>
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
