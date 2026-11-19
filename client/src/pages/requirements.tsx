import ReactDOM from "react-dom";
import { calendarDateValue } from "@shared/calendar-date";
import type { ViewingRecord } from "@shared/viewing-workflow";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pill, pillMetrics, pillActive, pillInactive } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Users, FileText, AlertCircle, X, Plus, Pencil, Trash2, Building2, Archive, User, Mail, Phone, Upload, Download, File, MapPin, Check, Circle, Loader2, Sparkles, MessageCircle, Target, MoreVertical, ChevronDown, ExternalLink, ClipboardList } from "lucide-react";
import { formatSizeList, formatSizeText } from "@/lib/format-size";
import { gbDate, useClassLabel } from "@/lib/format";
import { cn, countLabel } from "@/lib/utils";
import { TENANT_CATEGORIES, CLIENT_CRM_CATEGORIES } from "@shared/tenant-categories";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useMemo, useRef, useEffect, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileCardView } from "@/components/mobile-card-view";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useLocation, useSearch } from "wouter";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { InlineLabelSelect, InlineMultiSelect, InlineText } from "@/components/inline-edit";
import { buildUserIdColorMap } from "@/lib/agent-colors";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { ColumnFilterPopover } from "@/components/column-filter-popover";
import type { CrmRequirementsLeasing, CrmRequirementsInvestment, CrmCompany, CrmContact, CrmDeal, CrmProperty } from "@shared/schema";
import { propertyUnitHref, trackerUnitHref, type UnitLinkViewer } from "@/lib/unit-links";
import { useIsLandsecView } from "@/components/landsec/deal-clock";
import { LETTING_STATUS_LABELS } from "@shared/letting-rules";
import { legacyToCode } from "@shared/deal-status";
import { Link } from "wouter";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FilterDropdown } from "@/components/wip-filter-dropdown";
import { SuggestionTray, RequirementEvidenceDrawer, UnitFitGapsCard, type SuggestionList } from "@/components/requirement-centre";
import { PipnetCatchupDialog } from "@/components/pipnet-catchup";
import { BoardRows } from "@/components/requirements-board/board-rows";
import { BOARD_PILL_LABELS, countPills, onPill, type BoardPill, type BoardResponse, type BoardRow } from "@shared/requirements-board";
// The requirement panel loads with its brand cards only when it opens.
const RequirementPanel = lazy(() => import("@/components/requirements-board/requirement-panel"));
import { ConfirmHowDialog } from "@/components/requirements-board/confirm-how-dialog";
import {
  requirementLive, requirementGoingStale, formatRequirementDay,
  type RequirementLive,
} from "@shared/requirement-live";

interface LocationEntry {
  formatted: string;
  placeId: string;
  lat?: number;
  lng?: number;
}

function parseLocationData(raw: string | null): LocationEntry[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// Age of the requirement's own date, for the client login's read-only view
// (staff rows carry the state and the honest date line instead).
// The board's tabs (shared/requirements-board.ts; review of 19 November 2026,
// decisions 3, 4 and 6): Open (BGP's own first, then market listings, newest
// listing first), BGP's own, Market listings, Older and Closed are lists of
// rows, one per brand; Suggestions is the tray and In the news the press list,
// loaded only when opened. A client login has Open and Closed.
type ListKey = BoardPill | "suggestions" | "news";
const LIST_LABELS: Record<ListKey, string> = { ...BOARD_PILL_LABELS, suggestions: "Suggestions", news: "In the news" };
const LIST_NOTES: Record<ListKey, string> = {
  open: "BGP's own requirements first, then market listings, newest listing first.",
  own: "Requirements BGP made or confirmed: live (confirmed by a named BGP person in the last 90 days) or to confirm.",
  market: "PIPnet and The Requirement List listings nobody at BGP has confirmed, listed in the last six months. Market listings, not BGP's own requirements.",
  older: "BGP's own records on hold or more than 12 months without a confirmation, and market listings PIPnet has not listed for six months.",
  closed: "Past and archived requirements.",
  suggestions: "Suggestions waiting for an answer, from chat, viewings, deals, meetings, emails and news. A suggestion is not a requirement until a person confirms it.",
  news: "Brands in the press for opening, raising money or stating a requirement in the last 12 months, with nothing live or to confirm on our books. Press only: nobody at BGP has confirmed it with the brand.",
};
const CLIENT_OPEN_NOTE = "Requirements that are not past or archived.";
// Old addresses (?list=) open the tab that now holds their rows.
const LIST_ALIASES: Record<string, ListKey> = {
  open: "open", own: "own", live: "own", stale: "own", to_confirm: "own", suggestions: "suggestions",
  market: "market", older: "older", closed: "closed", news: "news",
};
type SortKey = "board" | "name" | "confirmed_desc" | "confirmed_asc" | "date_desc";
const SORT_LABELS: Record<SortKey, string> = {
  board: "Default", name: "Name", confirmed_desc: "Last confirmed, newest", confirmed_asc: "Last confirmed, oldest", date_desc: "Newest date",
};
const STAFF_EMAIL = /@brucegillinghampollard\.com$/i;
type BgpUser = { id: string; name: string; email: string; role: string; department: string; team: string | null };
const EXPANDING_KEY = "/api/requirement-centre/expanding?limit=100";
const SUGGESTIONS_KEY = "/api/requirement-suggestions?status=open&limit=300";
// How long a one-tap dismissal waits for Undo before it is saved.
const NEWS_UNDO_MS = 6000;

// GET /api/requirement-centre/expanding (BGP staff only).
type ExpandingSignal = { id: string; type: string; headline: string; detail: string | null; date: string | null; source: string | null; link: string | null };
type ExpandingBrand = { companyId: string; name: string; companyType: string | null; signalCount: number; backgroundRequirements: number; latest: ExpandingSignal; signals: ExpandingSignal[] };
type ExpandingList = { total: number; windowMonths: number; limit: number; brands: ExpandingBrand[] };

const requirementOwnerIds = (item: { bgpContactUserIds?: string[] | null; bgpContactUserId?: string | null }): string[] =>
  item.bgpContactUserIds?.length ? item.bgpContactUserIds : item.bgpContactUserId ? [item.bgpContactUserId] : [];

const PROGRESS_STAGES = [
  { key: "contacted" as const, label: "Contacted", color: "bg-emerald-500", borderColor: "border-emerald-500", hoverBorder: "hover:border-emerald-400" },
  { key: "detailsSent" as const, label: "Details Sent", color: "bg-blue-500", borderColor: "border-blue-500", hoverBorder: "hover:border-blue-400" },
  { key: "viewing" as const, label: "Viewing", color: "bg-amber-500", borderColor: "border-amber-500", hoverBorder: "hover:border-amber-400" },
  { key: "shortlisted" as const, label: "Shortlisted", color: "bg-purple-500", borderColor: "border-purple-500", hoverBorder: "hover:border-purple-400" },
  { key: "underOffer" as const, label: "Under Offer", color: "bg-red-500", borderColor: "border-red-500", hoverBorder: "hover:border-red-400" },
];

function ProgressTickCell({
  item,
  onUpdate,
  testIdPrefix,
}: {
  item: { contacted: boolean | null; detailsSent: boolean | null; viewing: boolean | null; shortlisted: boolean | null; underOffer: boolean | null };
  onUpdate: (data: Record<string, boolean>) => void;
  testIdPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeCount = PROGRESS_STAGES.filter((s) => item[s.key]).length;
  const activeStages = PROGRESS_STAGES.filter((s) => item[s.key]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-colors ${
          activeCount > 0
            ? "border-gray-300 bg-white hover:bg-gray-50"
            : "border-dashed border-gray-300 text-muted-foreground hover:border-gray-400"
        }`}
        data-testid={`${testIdPrefix}-btn`}
      >
        {activeCount > 0 ? (
          <>
            {activeStages.map((s) => (
              <span key={s.key} className={`w-2 h-2 rounded-full ${s.color}`} title={s.label} />
            ))}
            <span className="ml-0.5 text-muted-foreground">{activeCount}/5</span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            <Circle className="w-3 h-3" />
            0/5
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-1/2 -translate-x-1/2 bg-popover border rounded-lg shadow-lg p-1.5 min-w-[180px]">
          {PROGRESS_STAGES.map((stage) => {
            const active = item[stage.key];
            return (
              <button
                key={stage.key}
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-accent text-left text-sm transition-colors"
                onClick={() => onUpdate({ [stage.key]: !active })}
                data-testid={`${testIdPrefix}-${stage.key}`}
              >
                <div
                  className={`w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors ${
                    active ? `${stage.color} ${stage.borderColor} text-white` : `border-gray-300 ${stage.hoverBorder}`
                  }`}
                >
                  {active && <Check className="w-3 h-3" />}
                </div>
                <span className={active ? "font-medium" : "text-muted-foreground"}>{stage.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeasingTable({ teamFilter, companyFilter, autoCreate, initialList, requirementId }: { teamFilter?: string | null; companyFilter?: string | null; autoCreate?: boolean; initialList?: string | null; requirementId?: string | null }) {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(!!autoCreate);
  const [editItem, setEditItem] = useState<CrmRequirementsLeasing | null>(null);
  const isMobile = useIsMobile();
  const [deleteItem, setDeleteItem] = useState<CrmRequirementsLeasing | null>(null);
  const [pipnetSyncing, setPipnetSyncing] = useState(false);
  const [freshOnly, setFreshOnly] = useState(false);
  const [recentViewingOnly, setRecentViewingOnly] = useState(false);
  const [fitsOnly, setFitsOnly] = useState(false);
  const [newBrandOpen, setNewBrandOpen] = useState(false);
  // The board opens on Open. /requirements?list=news (or own, market, older,
  // closed, suggestions, and the old live, stale and to_confirm) opens a tab.
  const [list, setList] = useState<ListKey | null>(initialList ? LIST_ALIASES[initialList] ?? null : null);
  // "Going stale" (live, the confirmation running out within 14 days) is a filter on BGP's own.
  const [staleOnly, setStaleOnly] = useState(initialList === "stale");
  // "Needs confirming" (to confirm: a lapsed confirmation, a draft, BGP's own
  // row nobody has confirmed) is a filter on BGP's own. The digest's
  // "requirements need reconfirming" link (?list=to_confirm) opens on it.
  const [confirmOnly, setConfirmOnly] = useState(initialList === "to_confirm");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The requirement whose panel is open, kept in the address as ?requirementId=.
  const [panelId, setPanelId] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [evidenceItem, setEvidenceItem] = useState<CrmRequirementsLeasing | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  // Client logins (e.g. Landsec) see every requirement and may add one and
  // amend any through the form (Woody, 2026-11-17: "keep all requirements
  // open for clients and access to amend and add"); no sync / inspect tools,
  // no delete, and none of the centre's tools.
  const { data: reqUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientView = reqUser?.role === "Client";
  // A client login, and staff viewing as one, are sent no confirmation,
  // origin or owner: they get the list with no states, Open and Closed, and
  // the form without the BGP owner. Until the login is known the page keeps
  // to that reduced shape.
  const clientShape = !reqUser || isClientView || !!reqUser.companyScopeId;
  // Where a fit opens the unit: its row on the property page, else its row on
  // the login's own Letting Tracker (client/src/lib/unit-links.ts).
  const landsecView = useIsLandsecView();
  const unitViewer = useMemo<UnitLinkViewer>(() => ({ staff: !clientShape, landsecView, restricted: false }), [clientShape, landsecView]);
  // Still live, owners and In the news are BGP staff routes.
  const canUseCentre = !!reqUser && !clientShape && STAFF_EMAIL.test(String(reqUser.email || "").trim());
  const meId: string | null = reqUser?.id || null;

  const syncPipnet = async () => {
    setPipnetSyncing(true);
    try {
      // Kick off as a background job — a full sync (per-row detail fetch +
      // brochure download + Claude vision) far exceeds the request timeout, so
      // we start it and poll for completion.
      const res = await fetch("/api/external-requirements/import-pipnet-async", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ allPages: true, monthsBack: 3, autoPromote: true }),
      });
      const kick = await res.json();
      if (!res.ok) throw new Error(kick.message || "Sync failed");
      toast({ title: "PIPnet sync started", description: "Importing in the background — this can take a few minutes." });

      const started = Date.now();
      while (Date.now() - started < 15 * 60_000) {
        await new Promise((r) => setTimeout(r, 5000));
        const sres = await fetch("/api/external-requirements/import-pipnet-status", {
          credentials: "include",
          headers: { ...getAuthHeaders() },
        });
        const s = await sres.json();
        if (s.state === "done") {
          const d = s.result || {};
          refreshRequirements();
          const parts = [
            `${d.imported ?? 0} imported`,
            d.promoted ? `${d.promoted} added to requirements` : null,
            d.skippedOld ? `${d.skippedOld} older skipped` : null,
            d.agentsOnly ? `${d.agentsOnly} agents from listings that name no client` : null,
          ].filter(Boolean).join(" · ");
          toast({ title: "PIPnet synced", description: parts || "No new requirements found" });
          return;
        }
        if (s.state === "error") throw new Error(s.error || "Import failed");
      }
      toast({ title: "PIPnet sync still running", description: "Taking longer than expected — check back shortly." });
    } catch (err: any) {
      toast({ title: "PIPnet sync failed", description: err.message, variant: "destructive" });
    } finally {
      setPipnetSyncing(false);
    }
  };

  const [pipnetHeadersText, setPipnetHeadersText] = useState<string | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [catchupOpen, setCatchupOpen] = useState(false);
  const inspectPipnetDetail = async () => {
    try {
      const res = await fetch("/api/external-requirements/pipnet-inspect-detail", {
        credentials: "include",
        headers: { ...getAuthHeaders() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      console.log("[PIPnet detail]", data);
      const lines: string[] = [];
      lines.push(`Detail URL: ${data.detailUrl || "(none found)"}`);
      lines.push(`HTML size: ${data.htmlLength} bytes`);
      lines.push("");
      lines.push("--- Candidate links (first 20) ---");
      lines.push(...(data.candidateLinks || []));
      lines.push("");
      lines.push("--- Fields extracted ---");
      const entries = Object.entries(data.fields || {});
      if (entries.length === 0) {
        lines.push("(none — see HTML preview below)");
      } else {
        for (const [k, v] of entries) lines.push(`${k}: ${v}`);
      }
      lines.push("");
      lines.push("--- View All Images (brochure) ---");
      if (data.brochure) {
        lines.push(`URL: ${data.brochure.url}`);
        lines.push(`Content-Type: ${data.brochure.contentType}`);
        lines.push(`Size: ${data.brochure.bytes} bytes`);
        lines.push(`Is HTML: ${data.brochure.isHtml}`);
        if (data.brochure.imageUrls?.length) {
          lines.push(`Image URLs (${data.brochure.imageUrls.length}):`);
          lines.push(...data.brochure.imageUrls);
        }
        if (data.brochure.htmlPreview) {
          lines.push("");
          lines.push("Brochure HTML preview:");
          lines.push(data.brochure.htmlPreview);
        }
      } else {
        lines.push("(no View All Images link found on this requirement)");
      }
      lines.push("");
      lines.push("--- Detail HTML preview (first 1200 chars) ---");
      lines.push(data.htmlPreview || "");
      setPipnetHeadersText(lines.join("\n"));
    } catch (err: any) {
      toast({ title: "Detail inspect failed", description: err.message, variant: "destructive" });
    }
  };
  const inspectPipnetHeaders = async () => {
    try {
      const res = await fetch("/api/external-requirements/pipnet-headers", {
        credentials: "include",
        headers: { ...getAuthHeaders() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      console.log("[PIPnet headers]", data);
      const summary = (data.headers || [])
        .map((h: any) => `${h.name} (${h.presentIn}) → ${h.samples.join(" | ") || "—"}`)
        .join("\n");
      setPipnetHeadersText(`Inspected ${data.rowsInspected} rows.\n\n` + (summary || "No headers found."));
    } catch (err: any) {
      toast({ title: "Header inspect failed", description: err.message, variant: "destructive" });
    }
  };

  const syncTrl = async () => {
    setPipnetSyncing(true);
    try {
      const res = await fetch("/api/external-requirements/sync-trl", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Sync failed");
      refreshRequirements();
      toast({ title: "TRL synced", description: `${data.discovered} discovered · ${data.imported} imported · ${data.failed} failed` });
    } catch (err: any) {
      toast({ title: "TRL sync failed", description: err.message, variant: "destructive" });
    } finally {
      setPipnetSyncing(false);
    }
  };

  const { data: items = [], isLoading, error } = useQuery<CrmRequirementsLeasing[]>({
    queryKey: ["/api/crm/requirements-leasing"],
  });
  // A change to a requirement refreshes its record and the board's rows.
  const refreshRequirements = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-board"] }),
  ]);
  // ?requirementId= (ChatBGP receipts, landlord chat, a contact's list, the
  // tracker's matching requirements) opens that requirement's panel, for
  // every login. One not on the board says so.
  const openedRequirementId = useRef<string | null>(null);
  useEffect(() => {
    if (!requirementId) { openedRequirementId.current = null; return; }
    if (!reqUser || isLoading || error || openedRequirementId.current === requirementId) return;
    openedRequirementId.current = requirementId;
    const linked = items.find(item => item.id === requirementId);
    if (!linked) {
      toast({ title: "Requirement unavailable", description: "This requirement was removed or is not available to your account.", variant: "destructive" });
    } else {
      setPanelId(linked.id);
    }
  }, [requirementId, items, isLoading, error, reqUser, toast]);
  // Opening or closing the panel replaces the address: it is never a Back step.
  const showPanel = (id: string | null) => {
    setPanelId(id);
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("requirementId", id); else url.searchParams.delete("requirementId");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { /* the address is a convenience */ }
  };
  // The one live rule, worked out as the rows are read (shared/requirement-live.ts).
  const liveMap = useMemo(() => {
    const today = new Date();
    const map = new Map<string, RequirementLive>();
    items.forEach((i) => map.set(i.id, requirementLive(i, today)));
    return map;
  }, [items]);
  // "In the news": brands in the press with nothing on our books (BGP staff).
  // Its read is slow, so it loads only when its tab is opened (decision 6).
  const expandingQuery = useQuery<ExpandingList>({
    queryKey: [EXPANDING_KEY],
    enabled: canUseCentre && list === "news",
    refetchInterval: false,
    staleTime: 5 * 60_000,
  });
  // Suggestions waiting for a person (BGP staff): the tray at the top of To confirm.
  const suggestionsQuery = useQuery<SuggestionList>({
    queryKey: [SUGGESTIONS_KEY],
    enabled: canUseCentre,
    refetchInterval: false,
    staleTime: 60_000,
  });

  // Viewings load when the filter that reads them is shown or switched on.
  const recentViewingQuery = useQuery<{ viewings: ViewingRecord[] }>({ queryKey: ["/api/leasing-viewings"], enabled: recentViewingOnly || filtersOpen });
  const recentViewings = useMemo(() => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const cutoff = new Date(`${today}T12:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 89);
    const firstDate = cutoff.toISOString().slice(0, 10);
    return (recentViewingQuery.data?.viewings || []).filter(v => calendarDateValue(v.viewingDate) === v.viewingDate && v.status === "completed" && !!v.detailsConfirmedAt && !!v.companyId && !!v.unitId && v.viewingDate >= firstDate && v.viewingDate <= today).sort((a, b) => b.viewingDate.localeCompare(a.viewingDate));
  }, [recentViewingQuery.data]);
  const recentlyViewingBrands = useMemo(() => new Set(recentViewings.map(v => v.companyId)), [recentViewings]);

  // The board's rows: one per brand, with the fits by the one rule, the agent,
  // the owner, the score and the last contact (server/requirements-board.ts).
  const boardQuery = useQuery<BoardResponse>({ queryKey: ["/api/crm/requirements-board"] });
  const boardRows: BoardRow[] = boardQuery.data?.rows || [];

  // Demand read-out: what the open requirements say the market wants.
  const demand = useMemo(() => {
    const active = items.filter((i) => liveMap.get(i.id)?.state !== "closed");
    const sizeBands: Record<string, number> = { "under 1,000": 0, "1,000–3,000": 0, "3,000–10,000": 0, "10,000+": 0 };
    for (const i of active) {
      const raw = (Array.isArray(i.size) ? i.size.join(" ") : i.size || "").replace(/,/g, "");
      const nums = raw.match(/\d{3,}/g)?.map(Number) || [];
      if (!nums.length) continue;
      const mid = nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
      if (mid < 1000) sizeBands["under 1,000"]++;
      else if (mid < 3000) sizeBands["1,000–3,000"]++;
      else if (mid < 10000) sizeBands["3,000–10,000"]++;
      else sizeBands["10,000+"]++;
    }
    const topBand = Object.entries(sizeBands).sort((a, b) => b[1] - a[1])[0];
    const locCounts: Record<string, number> = {};
    for (const i of active) {
      for (const l of (Array.isArray(i.requirementLocations) ? i.requirementLocations : [])) {
        locCounts[l] = (locCounts[l] || 0) + 1;
      }
    }
    const topLocs = Object.entries(locCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { topBand, topLocs, total: active.length };
  }, [items, liveMap]);

  // Every company, contact and deal: the form's pickers, the tray's brand
  // picker and New Brand. They load only when one of those is opened (the
  // board itself reads its own feed).
  const formOpen = createOpen || !!editItem;
  const { data: companies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
    enabled: formOpen || newBrandOpen || list === "suggestions",
  });

  const { data: contacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
    enabled: formOpen,
  });

  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
    enabled: formOpen,
  });

  const { data: users = [] } = useQuery<{ id: string; name: string; email: string; role: string; department: string; team: string | null }[]>({
    queryKey: ["/api/users"],
  });
  const userIdColorMap = useMemo(() => buildUserIdColorMap(users), [users]);
  // Owners are BGP people: active, not a client login, on a BGP address.
  const staffUsers = useMemo(
    () => users.filter((u: any) => u.isActive !== false && u.role !== "Client" && STAFF_EMAIL.test(String(u.email || "").trim())),
    [users],
  );

  const teamUserIds = useMemo(() => {
    if (!teamFilter) return null;
    const tf = teamFilter.toLowerCase();
    return new Set(users.filter(u => u.team?.toLowerCase().includes(tf)).map(u => u.id));
  }, [teamFilter, users]);


  const companyMap = useMemo(() => {
    const map = new Map<string, CrmCompany>();
    companies.forEach((c) => map.set(c.id, c));
    return map;
  }, [companies]);
  // The brands a client login's form offers: the tenant brands its company
  // list holds, never its own company (the server refuses anything else).
  const formCompanies = useMemo(
    () => (clientShape ? companies.filter((c) => c.id !== reqUser?.companyScopeId && /^tenant/i.test(String(c.companyType || ""))) : companies),
    [companies, clientShape, reqUser?.companyScopeId],
  );

  const contactMap = useMemo(() => {
    const map = new Map<string, CrmContact>();
    contacts.forEach((c) => map.set(c.id, c));
    return map;
  }, [contacts]);

  const dealMap = useMemo(() => {
    const map = new Map<string, CrmDeal>();
    deals.forEach((d) => map.set(d.id, d));
    return map;
  }, [deals]);

  const userMap = useMemo(() => {
    const map = new Map<string, BgpUser>();
    users.forEach((u) => map.set(u.id, u));
    return map;
  }, [users]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<CrmRequirementsLeasing>) =>
      apiRequest("POST", "/api/crm/requirements-leasing", data),
    onSuccess: () => {
      refreshRequirements();
      setCreateOpen(false);
      toast(clientShape
        ? { title: "Requirement added", description: "It is on BGP's list to check with the brand." }
        : { title: "Requirement created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CrmRequirementsLeasing> }) =>
      apiRequest("PUT", `/api/crm/requirements-leasing/${id}`, data),
    onSuccess: () => {
      refreshRequirements();
      setEditItem(null);
      toast({ title: "Requirement updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdate = (id: string, data: Partial<CrmRequirementsLeasing>) => {
    apiRequest("PUT", `/api/crm/requirements-leasing/${id}`, data)
      .then(() => refreshRequirements())
      .catch((e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }));
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/requirements-leasing/${id}`),
    onSuccess: () => {
      refreshRequirements();
      setDeleteItem(null);
      showPanel(null);
      toast({ title: "Requirement deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // "Still live" is one tap on a requirement a person has confirmed before.
  // The FIRST confirmation asks how the person knows, so a market listing or a
  // draft never reads as confirmed by a conversation nobody recorded.
  const stillLiveMutation = useMutation({
    mutationFn: ({ id, how }: { id: string; how?: string }) => apiRequest("POST", `/api/requirement-centre/requirements/${id}/still-live`, how ? { how } : {}),
    onSuccess: () => {
      refreshRequirements();
      queryClient.invalidateQueries({ queryKey: [EXPANDING_KEY] });
      queryClient.invalidateQueries({ queryKey: [SUGGESTIONS_KEY] });
      toast({ title: "Confirmed", description: "Recorded as confirmed by you today." });
    },
    onError: (e: any) => toast({ title: "Couldn't confirm", description: e.message, variant: "destructive" }),
  });
  const stillLiveId = stillLiveMutation.isPending ? (stillLiveMutation.variables?.id ?? null) : null;
  const [confirmAsk, setConfirmAsk] = useState<CrmRequirementsLeasing | null>(null);
  const confirmRow = (item: CrmRequirementsLeasing) => {
    if (liveMap.get(item.id)?.confirmed) return stillLiveMutation.mutate({ id: item.id });
    setConfirmAsk(item);
  };
  // "Not a requirement" on a draft archives it; the toast can put it back.
  const dismissDraft = (item: CrmRequirementsLeasing) => {
    const put = (status: string) => apiRequest("PUT", `/api/crm/requirements-leasing/${item.id}`, { status })
      .then(() => refreshRequirements());
    put("Archived")
      .then(() => toast({
        title: `${item.name || "Draft"}: archived`,
        description: "It is under Closed.",
        action: <ToastAction altText="Undo: keep it as a draft" onClick={() => { put("Draft").catch((e: any) => toast({ title: "Couldn't undo", description: e.message, variant: "destructive" })); }} data-testid={`button-undo-dismiss-draft-${item.id}`}>Undo</ToastAction>,
      }))
      .catch((e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }));
  };

  const ownerMutation = useMutation({
    mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) =>
      apiRequest("PUT", `/api/requirement-centre/requirements/${id}/owner`, { userIds }),
    onSuccess: () => refreshRequirements(),
    onError: (e: any) => toast({ title: "Couldn't change the owner", description: e.message, variant: "destructive" }),
  });

  const groups = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.groupName) set.add(i.groupName); });
    return Array.from(set).sort();
  }, [items]);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    boardRows.forEach((row) => (row.requirement.sources || []).forEach((l) => set.add(l)));
    return Array.from(set).sort();
  }, [boardRows]);

  const commentsOf = useMemo(() => new Map(items.map((i) => [i.id, i.comments || ""])), [items]);
  const isStale = (row: BoardRow) => { const live = liveMap.get(row.requirement.id); return !!live && requirementGoingStale(live); };
  const needsConfirm = (row: BoardRow) => liveMap.get(row.requirement.id)?.state === "to_confirm";
  const within90 = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) && Date.now() - t <= 90 * 86400000; };
  // Every filter except the tab and Mine: the tab counts are taken from this.
  const baseRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return boardRows.filter((row) => {
      const r = row.requirement;
      if (companyFilter && row.brandId !== companyFilter) return false;
      if (recentViewingOnly && (!row.brandId || !recentlyViewingBrands.has(row.brandId))) return false;
      if (teamUserIds) {
        const ids = (row.owners || []).map((o) => o.id);
        if (ids.length > 0 && !ids.some((id) => teamUserIds.has(id))) return false;
      }
      if (groupFilter !== "all" && (r.group || "Ungrouped") !== groupFilter) return false;
      if (freshOnly && !within90(r.date)) return false;
      if (fitsOnly && !row.fits.count) return false;
      if (staleOnly && !isStale(row)) return false;
      if (confirmOnly && !needsConfirm(row)) return false;
      if (sourceFilter.size && !(r.sources || []).some((l) => sourceFilter.has(l))) return false;
      if (s && ![row.brandName, r.name, r.wants, r.type, row.agent?.name, row.agent?.firmName, commentsOf.get(r.id)]
        .some((v) => (v || "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [boardRows, search, companyFilter, recentViewingOnly, recentlyViewingBrands, teamUserIds, groupFilter, freshOnly, fitsOnly, staleOnly, confirmOnly, liveMap, sourceFilter, commentsOf]);

  // "Mine" is a per-person filter on the BGP owner; Everyone is the default.
  const ownedByMe = (row: BoardRow) => !!meId && (row.owners || []).some((o) => o.id === meId);
  const filteredRows = useMemo(() => (mineOnly && meId ? baseRows.filter(ownedByMe) : baseRows), [baseRows, mineOnly, meId]);
  const mineCount = useMemo(() => baseRows.filter((row) => row.list !== "closed" && ownedByMe(row)).length, [baseRows, meId]);
  const listCounts = useMemo(() => countPills(filteredRows), [filteredRows]);

  const expandingBrands = useMemo(() => {
    const s = search.trim().toLowerCase();
    const brands = expandingQuery.data?.brands || [];
    return s ? brands.filter((b) => b.name.toLowerCase().includes(s) || (b.latest?.headline || "").toLowerCase().includes(s)) : brands;
  }, [expandingQuery.data, search]);
  const newsCount = !expandingQuery.data ? null : search.trim() ? expandingBrands.length : expandingQuery.data.total;

  // The tray of suggestions (BGP staff): the Suggestions tab. A suggestion has
  // a brand and a source but no group, fit, owner team or list source, so the
  // search and the brand filter narrow the tray and the other filters hide it.
  const trayHidden = groupFilter !== "all" || freshOnly || fitsOnly || staleOnly || confirmOnly || recentViewingOnly || sourceFilter.size > 0 || !!teamUserIds;
  const traySuggestions = useMemo(() => {
    const all = canUseCentre ? suggestionsQuery.data?.suggestions || [] : [];
    const s = search.trim().toLowerCase();
    return all.filter((x) => (!companyFilter || x.brand.companyId === companyFilter)
      && (!s || [x.brand.name, x.brand.saidAs, x.headline].some((v) => (v || "").toLowerCase().includes(s))));
  }, [canUseCentre, suggestionsQuery.data, search, companyFilter]);
  const trayCount = trayHidden ? 0 : traySuggestions.length;
  const suggestionAnswered = () => {
    queryClient.invalidateQueries({ queryKey: [SUGGESTIONS_KEY] });
    refreshRequirements();
    queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-board"] });
    queryClient.invalidateQueries({ queryKey: [EXPANDING_KEY] });
  };

  const listAllowed = (k: ListKey) => (clientShape ? k === "open" || k === "closed" : (k !== "news" && k !== "suggestions") || canUseCentre);
  const activeList: ListKey = list && listAllowed(list) ? list : "open";
  const activeSort: SortKey = sortBy || (staleOnly ? "confirmed_asc" : "board");

  const listRows = useMemo(() => {
    if (activeList === "suggestions" || activeList === "news") return [] as BoardRow[];
    const rows = filteredRows.filter((row) => onPill(row.list, activeList));
    // Default: the feed's own order (BGP's own first, then market listings,
    // newest listing first; a client login's newest first).
    if (activeSort === "board") return rows;
    if (activeSort === "name") return [...rows].sort((a, b) => a.brandName.localeCompare(b.brandName, "en-GB", { sensitivity: "base" }));
    const confirmedOnly = activeSort !== "date_desc";
    const dir = activeSort === "confirmed_asc" ? 1 : -1;
    const at = (row: BoardRow) => {
      const v = confirmedOnly ? row.requirement.confirmedAt : row.requirement.date;
      const t = v ? Date.parse(v) : NaN;
      return Number.isFinite(t) ? t : null;
    };
    // Rows with no such date go last, whichever way the sort runs.
    return [...rows].sort((a, b) => {
      const ta = at(a), tb = at(b);
      if (ta == null || tb == null) return ta == null ? (tb == null ? 0 : 1) : -1;
      return (ta - tb) * dir;
    });
  }, [filteredRows, activeList, activeSort]);

  // Phone renders 30 cards then "Show more" — every requirement at once made
  // a ~26,000px page (Woody, 2026-09-27).
  const PHONE_PAGE = 30;
  const [phoneShown, setPhoneShown] = useState(PHONE_PAGE);
  useEffect(() => { setPhoneShown(PHONE_PAGE); }, [filteredRows, activeList]);

  // The filters' counts are taken over the open rows, ungrouped as "Other".
  const openRows = useMemo(() => boardRows.filter((row) => row.list !== "closed"), [boardRows]);
  const groupCounts = useMemo(() => {
    const map: Record<string, number> = {};
    openRows.forEach((row) => { const g = row.requirement.group || "Ungrouped"; map[g] = (map[g] || 0) + 1; });
    return map;
  }, [openRows]);
  const filterCounts = useMemo(() => ({
    fits: openRows.filter((row) => row.fits.count > 0).length,
    fresh: openRows.filter((row) => within90(row.requirement.date)).length,
    stale: openRows.filter(isStale).length,
    confirm: openRows.filter(needsConfirm).length,
    viewing: openRows.filter((row) => !!row.brandId && recentlyViewingBrands.has(row.brandId)).length,
  }), [openRows, liveMap, recentlyViewingBrands]);

  const activeFilterCount = [freshOnly, fitsOnly, staleOnly, confirmOnly, recentViewingOnly, groupFilter !== "all", sourceFilter.size > 0, !!sortBy].filter(Boolean).length;
  const anyFilter = !!search || activeFilterCount > 0 || mineOnly;
  const clearFilters = () => {
    setSearch(""); setGroupFilter("all"); setFreshOnly(false); setFitsOnly(false); setStaleOnly(false); setConfirmOnly(false); setRecentViewingOnly(false);
    setSourceFilter(new Set()); setSortBy(null); setMineOnly(false);
  };
  const userName = (id: string) => users.find((u) => u.id === id)?.name || "";

  // The panel's row: the board row, or for one of a brand's other
  // requirements, that one shown in its place.
  const panelRow = useMemo(() => {
    if (!panelId) return null;
    for (const row of boardRows) {
      if (row.requirement.id === panelId) return row;
      const other = row.others.find((o) => o.id === panelId);
      if (other) return { ...row, requirement: other, others: [row.requirement, ...row.others.filter((o) => o.id !== panelId)] };
    }
    return null;
  }, [panelId, boardRows]);
  const panelItem = panelId ? items.find((i) => i.id === panelId) || null : null;

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">Could not load Leasing Requirements</h3>
          <p className="text-sm text-muted-foreground">Please check the API connection.</p>
        </CardContent>
      </Card>
    );
  }

  // Phone: search first and each pill strip one sideways-scrolling row — the
  // tiles filled the first screen and hid the search (Woody, 2026-09-28).
  const tileRow = isMobile ? "flex-nowrap overflow-x-auto pb-1" : "flex-wrap";
  const count = (n: number | null | undefined) => (
    <span className="font-mono tabular-nums">{n == null ? "…" : n.toLocaleString("en-GB")}</span>
  );
  const listPills: Array<{ key: ListKey; n: number | null }> = clientShape
    ? [{ key: "open", n: listCounts.open }, { key: "closed", n: listCounts.closed }]
    : [
        { key: "open", n: listCounts.open },
        { key: "own", n: listCounts.own },
        { key: "market", n: listCounts.market },
        // Older: shown when there are some, or while it is open.
        ...(listCounts.older > 0 || activeList === "older" ? [{ key: "older" as ListKey, n: listCounts.older }] : []),
        ...(canUseCentre ? [
          { key: "suggestions" as ListKey, n: suggestionsQuery.data ? traySuggestions.length : null },
          // In the news is counted once it has been opened (its read is slow).
          { key: "news" as ListKey, n: newsCount },
        ] : []),
        { key: "closed", n: listCounts.closed },
      ];
  const emptyText = boardQuery.isError ? "The board could not be loaded."
    : anyFilter ? "No requirements match these filters"
    : activeList === "own" ? "No requirements of BGP's own yet: confirm a market listing, or add a requirement"
    : activeList === "market" ? "No market listings"
    : activeList === "older" ? "No older requirements"
    : activeList === "closed" ? "No closed requirements"
    : "No requirements found";
  const groupNames = Object.keys(groupCounts).sort((a, b) => (a === "Ungrouped" ? 1 : 0) - (b === "Ungrouped" ? 1 : 0));
  const onBoard = activeList !== "news" && activeList !== "suggestions";
  const itemOf = (id: string) => items.find((i) => i.id === id) || null;
  const panelLive = panelItem ? liveMap.get(panelItem.id) || null : null;
  const packOf = (item: CrmRequirementsLeasing | null) => {
    if (!item) return null;
    if (!clientShape) return <LandlordPackCell itemId={item.id} landlordPack={item.landlordPack} />;
    let pack: { url?: string; name?: string } | null = null;
    try { pack = item.landlordPack ? JSON.parse(item.landlordPack) : null; } catch { pack = null; }
    return pack?.url ? <a href={pack.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid={`link-landlord-pack-${item.id}`}>{pack.name || "Document"}</a> : null;
  };
  return (
    <div className={isMobile ? "flex flex-col gap-4" : "space-y-4"}>
      {/* The tabs carry the counts (docs/DESIGN.md §5): one row per brand on
          each list, Open first (review of 19 November 2026, decision 3). */}
      <div className={`flex items-center gap-1.5 ${tileRow}`} data-testid="requirements-lists">
        {listPills.map(({ key, n }) => (
          <Pill key={key} active={activeList === key} aria-pressed={activeList === key} onClick={() => setList(key)}
            title={clientShape && key === "open" ? CLIENT_OPEN_NOTE : LIST_NOTES[key]} data-testid={`requirements-list-${key}`}>
            {LIST_LABELS[key]}{n != null && <> {count(n)}</>}
          </Pill>
        ))}
        {!clientShape && meId && (
          <>
            <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            <Pill active={!mineOnly} aria-pressed={!mineOnly} onClick={() => setMineOnly(false)} data-testid="requirements-scope-everyone">Everyone</Pill>
            <Pill active={mineOnly} aria-pressed={mineOnly} onClick={() => setMineOnly(true)} title="Open requirements where you are the BGP owner" data-testid="requirements-scope-mine">
              Mine {count(mineCount)}
            </Pill>
          </>
        )}
      </div>

      <div className={`flex items-center gap-3 flex-wrap ${isMobile ? "order-first" : ""}`}>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          {/* Phone: "Search requirement" was cut at 390px (Woody, 2026-09-28). */}
          <Input
            placeholder={isMobile ? "Search…" : "Search requirements…"}
            className={isMobile ? "pl-9 pr-10" : "pl-9"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-leasing"
          />
          {/* Phone: Clear sits inside the search box — as a button beside
              it, it pushed New Brand / Add requirement onto a new row
              (Woody, 2026-09-28). */}
          {isMobile && anyFilter && (
            <button
              type="button"
              aria-label="Clear search and filters"
              className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={clearFilters}
              data-testid="button-clear-leasing-filters"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {!isMobile && anyFilter && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            data-testid="button-clear-leasing-filters"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Clear
          </Button>
        )}
        {/* The filters, in one popover (review of 19 November 2026, section 1). */}
        {activeList !== "news" && activeList !== "suggestions" && (
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" data-testid="requirements-filters">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters{activeFilterCount > 0 && <span className="font-mono tabular-nums">{activeFilterCount}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3" data-testid="requirements-filters-popover">
              <div className="flex flex-wrap gap-1.5">
                <Pill active={fitsOnly} aria-pressed={fitsOnly} onClick={() => setFitsOnly(!fitsOnly)} title="Requirements a unit on the market fits, by the one fit rule" data-testid="card-demand-fits">
                  Fit your units {count(filterCounts.fits)}
                </Pill>
                <Pill active={freshOnly} aria-pressed={freshOnly} onClick={() => setFreshOnly(!freshOnly)} title={clientShape ? "Listed, dated or added in the last 90 days" : "Confirmed, listed or dated in the last 90 days"} data-testid="card-demand-fresh">
                  Last 90 days {count(filterCounts.fresh)}
                </Pill>
                {!clientShape && (
                  <Pill active={staleOnly} aria-pressed={staleOnly} onClick={() => setStaleOnly(!staleOnly)} title="Live, but the confirmation runs out within 14 days" data-testid="requirements-going-stale">
                    Going stale {count(filterCounts.stale)}
                  </Pill>
                )}
                {!clientShape && (
                  <Pill active={confirmOnly} aria-pressed={confirmOnly} onClick={() => setConfirmOnly(!confirmOnly)} title="BGP's own requirements to confirm: last confirmed more than 90 days ago, a draft, or never confirmed" data-testid="requirements-needs-confirming">
                    Needs confirming {count(filterCounts.confirm)}
                  </Pill>
                )}
                <Pill active={recentViewingOnly} aria-pressed={recentViewingOnly} onClick={() => setRecentViewingOnly(v => !v)} title="Brands with a confirmed viewing in the last 90 days" data-testid="requirements-recently-viewing">
                  Recently viewing · 90 days {recentViewingQuery.data ? count(filterCounts.viewing) : null}
                </Pill>
              </div>
              {groupNames.some((group) => group !== "Ungrouped") && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Group</p>
                  <div className="flex flex-wrap gap-1.5">
                    {groupNames.map((group) => (
                      <Pill key={group} active={groupFilter === group} aria-pressed={groupFilter === group}
                        onClick={() => setGroupFilter(groupFilter === group ? "all" : group)} data-testid={`card-leasing-group-${group}`}>
                        {group === "Ungrouped" ? "Other" : group} {count(groupCounts[group])}
                      </Pill>
                    ))}
                  </div>
                </div>
              )}
              {!clientShape && sourceOptions.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Source</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sourceOptions.map((v) => (
                      <Pill key={v} active={sourceFilter.has(v)} aria-pressed={sourceFilter.has(v)} data-testid={`requirements-source-${v}`}
                        onClick={() => setSourceFilter((prev) => { const next = new Set(prev); if (next.has(v)) next.delete(v); else next.add(v); return next; })}>
                        {v}
                      </Pill>
                    ))}
                  </div>
                </div>
              )}
              {!clientShape && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sort</p>
                  <div className="flex flex-wrap gap-1.5" data-testid="requirements-sort">
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <Pill key={k} active={activeSort === k} aria-pressed={activeSort === k} onClick={() => setSortBy(k === "board" ? null : k)} data-testid={`requirements-sort-${k}`}>
                        {SORT_LABELS[k]}
                      </Pill>
                    ))}
                  </div>
                </div>
              )}
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => { setFitsOnly(false); setFreshOnly(false); setStaleOnly(false); setConfirmOnly(false); setRecentViewingOnly(false); setGroupFilter("all"); setSourceFilter(new Set()); setSortBy(null); }} data-testid="requirements-filters-clear">
                  Clear filters
                </Button>
              )}
            </PopoverContent>
          </Popover>
        )}
        {/* Staff only. It was hidden from clients when POST
            /api/crm/companies was refused for every client login. A client
            can add a tenant brand since 2026-11-13 (the brand pickers do),
            so showing this to clients is now a choice and no longer a
            limit: Woody's to make, since the dialog also starts the AI
            enrichment. Clients add existing brands via the brands-hub Add
            brand flow. */}
        {!isClientView && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNewBrandOpen(true)}
          data-testid="button-new-brand"
          title="Create a brand in the CRM — AI fills in description, industry and imagery"
        >
          <Sparkles className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
          New Brand
        </Button>
        )}
        {/* Admin/debug sync + inspect tools — hidden on mobile so the board is
            a clean Search + Add + cards layout, uniform with the others.
            Hidden for clients too: sync/import are staff-only writes. */}
        {!isMobile && !isClientView && (
        /* UX #132 — the six sync/inspect/wipe controls sat at equal weight
           with everyday actions (two starting with "Wipe", one click from
           the search box). One "Sync tools" dropdown keeps the everyday row
           to Search + New Brand + Add requirement. */
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-sync-tools" title="PIPnet / TRL import and debug tools">
              {pipnetSyncing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
              Sync tools
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={syncPipnet} disabled={pipnetSyncing} data-testid="button-sync-pipnet">Refresh PIPnet</DropdownMenuItem>
            <DropdownMenuItem onClick={inspectPipnetHeaders} data-testid="button-inspect-pipnet">Inspect PIPnet</DropdownMenuItem>
            <DropdownMenuItem onClick={inspectPipnetDetail} data-testid="button-inspect-pipnet-detail">Inspect Detail</DropdownMenuItem>
            <DropdownMenuItem onClick={syncTrl} disabled={pipnetSyncing} data-testid="button-sync-trl">Refresh TRL</DropdownMenuItem>
            {reqUser?.isAdmin && (
              <DropdownMenuItem onClick={() => setHealthOpen(true)} data-testid="button-requirements-health">Health report</DropdownMenuItem>
            )}
            {reqUser?.isAdmin && (
              <DropdownMenuItem onClick={() => setCatchupOpen(true)} data-testid="button-pipnet-catchup">PIPnet, last 12 months</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
        {/* Every login adds a requirement, a client login included (Woody,
            2026-11-17: "keep all requirements open for clients and access to
            amend and add"). A client's is saved as the client's, for BGP to
            confirm. */}
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-leasing">
          <Plus className="w-4 h-4 mr-1" />
          Add requirement
        </Button>
      </div>

      {onBoard && <p className="text-xs text-muted-foreground" data-testid="requirements-note">{clientShape && activeList === "open" ? CLIENT_OPEN_NOTE : LIST_NOTES[activeList]}</p>}

      {recentViewingOnly && activeList !== "news" && activeList !== "suggestions" && <Card><CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Recent viewing evidence</h3>
        {recentViewingQuery.isLoading ? <Skeleton className="h-24 w-full" /> : recentViewingQuery.isError ? <div className="space-y-2"><p className="text-sm">Viewing evidence could not be loaded.</p><Button variant="outline" size="sm" onClick={() => void recentViewingQuery.refetch()}>Refresh</Button></div> : <>
          {recentViewings.filter(v => filteredRows.some(row => row.brandId === v.companyId)).slice(0, 12).map(viewing => <div key={viewing.id} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="min-w-0"><p className="text-sm font-semibold break-words">{viewing.companyName}</p><p className="text-[11px] text-muted-foreground break-words">{viewing.propertyName} · {viewing.unitName}{viewing.sqft != null ? ` · ${viewing.sqft.toLocaleString("en-GB")} sq ft` : ""}</p><p className="text-[11px] text-muted-foreground">{gbDate(`${viewing.viewingDate}T12:00:00Z`, { day: "numeric", month: "short", timeZone: "UTC" })}{viewing.outcome ? ` · ${viewing.outcome}` : ""}</p></div>
            <Button variant="outline" size="sm" asChild><a href={`/available?workspace=viewings&viewing=${encodeURIComponent(viewing.id)}`}>Open viewing</a></Button>
          </div>)}
          {!filteredRows.length && <p className="text-sm text-muted-foreground">No requirements match the recent viewing evidence and current filters.</p>}
          <p className="text-[11px] text-muted-foreground">Showing up to 12 recent viewings for these requirements. Actual viewed sizes and locations are evidence only; stated search requirements are unchanged.</p>
          <Button variant="outline" size="sm" asChild><a href="/available?workspace=viewings">Open viewing calendar</a></Button>
        </>}
      </CardContent></Card>}

      {/* Demand read-out, in one line: what the open requirements say the
          market wants, by size and place. Information only. */}
      {onBoard && demand.total > 0 && ((demand.topBand && demand.topBand[1] > 0) || demand.topLocs.length > 0) && (
        <p className="text-xs text-muted-foreground" data-testid="requirements-demand">
          Most wanted:{" "}
          {demand.topBand && demand.topBand[1] > 0 && <><span className="font-mono tabular-nums text-foreground">{demand.topBand[0]}</span> sq ft (<span className="font-mono tabular-nums">{demand.topBand[1]}</span> of <span className="font-mono tabular-nums">{demand.total}</span>)</>}
          {demand.topBand && demand.topBand[1] > 0 && demand.topLocs.length > 0 && " · "}
          {demand.topLocs.map(([loc]) => loc).join(", ")}
        </p>
      )}

      {/* The units the fit rule cannot judge (no use class or no size), for
          someone to fill in on the Letting Tracker. BGP staff only. */}
      {canUseCentre && onBoard && <UnitFitGapsCard navigate={navigate} />}

      {/* The Suggestions tab: suggestions from chat, viewings, deals,
          meetings and news, each answered by a person in one tap. BGP staff
          only; a suggestion is not a requirement until a person confirms it. */}
      {activeList === "suggestions" && canUseCentre && (trayHidden ? traySuggestions.length > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid="requirements-suggestions-waiting">
          {countLabel(traySuggestions.length, "suggestion")} waiting for an answer {traySuggestions.length === 1 ? "is" : "are"} hidden while these filters are on. Clear the filters to answer {traySuggestions.length === 1 ? "it" : "them"}.
        </p>
      ) : (
        <SuggestionTray
          suggestions={traySuggestions}
          totalOpen={suggestionsQuery.data?.counts?.open ?? traySuggestions.length}
          searching={!!search.trim() || !!companyFilter}
          isLoading={suggestionsQuery.isLoading}
          isError={suggestionsQuery.isError}
          onRetry={() => void suggestionsQuery.refetch()}
          companies={companies}
          isMobile={isMobile}
          navigate={navigate}
          onAnswered={suggestionAnswered}
        />
      ))}
      {activeList === "suggestions" && canUseCentre && filterCounts.confirm > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="requirements-confirm-line">
          <span className="font-mono tabular-nums">{filterCounts.confirm.toLocaleString("en-GB")}</span> of BGP's own requirement{filterCounts.confirm === 1 ? " needs" : "s need"} confirming.{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => { setList("own"); setConfirmOnly(true); setStaleOnly(false); }} data-testid="requirements-show-to-confirm">
            Show {filterCounts.confirm === 1 ? "it" : "them"}
          </button>
        </p>
      )}

      {activeList === "news" ? (
        <ExpandingNowPanel
          brands={expandingBrands}
          total={expandingQuery.data?.total ?? 0}
          shownLimit={expandingQuery.data?.limit ?? 100}
          searching={!!search.trim()}
          isLoading={expandingQuery.isLoading}
          isError={expandingQuery.isError}
          onRetry={() => void expandingQuery.refetch()}
          isMobile={isMobile}
          navigate={navigate}
        />
      ) : onBoard ? (<>
        {boardQuery.isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : (
          <BoardRows
            rows={isMobile ? listRows.slice(0, phoneShown) : listRows}
            staff={!clientShape}
            canUseCentre={canUseCentre}
            liveMap={liveMap}
            selectedId={panelId}
            onOpen={(row) => showPanel(row.requirement.id)}
            onConfirm={(id) => { const item = itemOf(id); if (item) confirmRow(item); }}
            onEvidence={canUseCentre ? (id) => { const item = itemOf(id); if (item) setEvidenceItem(item); } : undefined}
            stillLiveId={stillLiveId}
            unitViewer={unitViewer}
            isMobile={isMobile}
            empty={emptyText}
          />
        )}
        {isMobile && listRows.length > phoneShown && (
          <Button variant="outline" className="w-full" onClick={() => setPhoneShown(n => n + PHONE_PAGE)} data-testid="mobile-requirements-show-more">
            Show more ({(listRows.length - phoneShown).toLocaleString("en-GB")} left)
          </Button>
        )}
      </>) : null}

      {/* The requirement panel: pressing a row, or a link with ?requirementId=. */}
      {panelRow && (
        <Suspense fallback={null}>
          <RequirementPanel
            row={panelRow}
            comments={panelItem?.comments || null}
            open={!!panelRow}
            onClose={() => showPanel(null)}
            staff={!clientShape}
            canUseCentre={canUseCentre}
            canEdit={!!reqUser && !!panelItem}
            canDelete={!clientShape && !!panelItem}
            landsecView={landsecView}
            live={panelLive}
            onEdit={() => { if (panelItem) setEditItem(panelItem); }}
            onConfirm={() => { if (panelItem) confirmRow(panelItem); }}
            onEvidence={() => { if (panelItem) setEvidenceItem(panelItem); }}
            onDelete={() => { if (panelItem) setDeleteItem(panelItem); }}
            isDraft={String(panelItem?.status || "").trim().toLowerCase() === "draft"}
            onDismissDraft={() => { if (panelItem) { dismissDraft(panelItem); showPanel(null); } }}
            packSlot={packOf(panelItem)}
            stillLiveBusy={!!panelId && stillLiveId === panelId}
            unitViewer={unitViewer}
            isMobile={isMobile}
          />
        </Suspense>
      )}

      {canUseCentre && (
        <ConfirmHowDialog name={confirmAsk?.name || null} open={!!confirmAsk} onClose={() => setConfirmAsk(null)}
          onConfirm={(how) => {
            if (!confirmAsk) return;
            stillLiveMutation.mutate({ id: confirmAsk.id, how });
            setConfirmAsk(null);
          }} />
      )}

      {canUseCentre && (
        <RequirementEvidenceDrawer
          requirement={evidenceItem}
          onClose={() => setEvidenceItem(null)}
          isMobile={isMobile}
          navigate={navigate}
          onChanged={suggestionAnswered}
        />
      )}

      {/* Mounted on open, so each new requirement starts from an empty form
          with the person adding it as its owner. A client login adds one too
          (Woody, 2026-11-17), on the client form: no BGP owner, a brand from
          its own brand list. It waits for the login, so ?new=1 (an Add link)
          never opens the wrong form. */}
      {createOpen && !!reqUser && (
      <LeasingFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        title={clientShape ? "Add a leasing requirement" : "Create Leasing Requirement"}
        groups={groups}
        companies={formCompanies}
        contacts={contacts}
        deals={deals}
        ownerOptions={staffUsers}
        defaultOwnerId={canUseCentre ? meId : null}
        presetCompanyId={autoCreate ? companyFilter : null}
        clientForm={clientShape}
      />
      )}

      {editItem && !!reqUser && (
        <LeasingFormDialog
          open={!!editItem}
          onOpenChange={(open) => { if (!open) setEditItem(null); }}
          onSubmit={(data) => updateMutation.mutate({ id: editItem.id, data })}
          isPending={updateMutation.isPending}
          title="Edit Leasing Requirement"
          defaultValues={editItem}
          companies={formCompanies}
          contacts={contacts}
          deals={deals}
          groups={groups}
          ownerOptions={staffUsers}
          clientForm={clientShape}
        />
      )}

      <Dialog open={!!deleteItem} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Requirement</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteItem?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)} data-testid="button-cancel-delete">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pipnetHeadersText} onOpenChange={(o) => !o && setPipnetHeadersText(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>PIPnet column headers</DialogTitle>
            <DialogDescription>Format: header name (rows it appears in) → sample values</DialogDescription>
          </DialogHeader>
          <textarea
            readOnly
            className="w-full h-80 font-mono text-xs p-2 border rounded bg-muted"
            value={pipnetHeadersText ?? ""}
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (pipnetHeadersText) {
                  navigator.clipboard.writeText(pipnetHeadersText);
                  toast({ title: "Copied to clipboard" });
                }
              }}
            >
              Copy
            </Button>
            <Button onClick={() => setPipnetHeadersText(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RequirementsHealthDialog open={healthOpen} onOpenChange={setHealthOpen} />
      {catchupOpen && <PipnetCatchupDialog open={catchupOpen} onOpenChange={setCatchupOpen} />}

      <NewBrandDialog
        open={newBrandOpen}
        onOpenChange={setNewBrandOpen}
        isClientView={isClientView}
      />
    </div>
  );
}

// "In the news": brands in the press for expanding, with nothing live or to
// confirm on our books (GET /api/requirement-centre/expanding, BGP staff
// only). "Add requirement" saves it through the intake as press-reported,
// confirmed by the person who pressed it; nothing here is saved by a machine.
function ExpandingNowPanel({
  brands: allBrands, total, shownLimit, searching, isLoading, isError, onRetry, isMobile, navigate,
}: {
  brands: ExpandingBrand[];
  total: number;
  shownLimit: number;
  searching: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isMobile: boolean;
  navigate: (to: string) => void;
}) {
  const { toast } = useToast();
  const [addingId, setAddingId] = useState<string | null>(null);
  // Dismissed brands leave the list at once; the save follows.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const brands = allBrands.filter((b) => !dismissed.has(b.companyId));
  // The brand already has a requirement nobody has confirmed lately: the person chooses.
  const [choice, setChoice] = useState<{ brand: ExpandingBrand; existing: Array<{ id: string; name: string; stateLabel: string; dateLabel: string }> } | null>(null);
  const today = new Date();
  const day = (iso: string | null) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime()) ? formatRequirementDay(d, today) : "no date";
  };

  const add = async (brand: ExpandingBrand, extra: { requirementId?: string; createNew?: boolean } = {}) => {
    if (addingId) return;
    setAddingId(brand.companyId);
    try {
      const story = brand.latest;
      const res = await fetch("/api/requirement-centre/expanding/add", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          companyId: brand.companyId,
          headline: String(story.headline || brand.name).slice(0, 500),
          url: story.link || undefined,
          source: story.source ? story.source.slice(0, 80) : undefined,
          date: story.date || undefined,
          ...extra,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === "EXISTING_REQUIREMENT" && Array.isArray(body.existing) && body.existing.length) {
        setChoice({ brand, existing: body.existing });
        return;
      }
      if (!res.ok) throw new Error(body.error || "The requirement could not be added");
      setChoice(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      queryClient.invalidateQueries({ queryKey: [EXPANDING_KEY] });
      if (body.outcome === "duplicate") {
        toast({ title: `${brand.name}: already added from this story` });
      } else {
        toast({
          title: body.outcome === "confirmed_existing" ? `${brand.name}: requirement confirmed from the press` : `${brand.name}: requirement added`,
          description: "Recorded as press-reported, confirmed by you today. It stays press-reported until someone records speaking to the brand.",
        });
      }
    } catch (e: any) {
      toast({ title: "Couldn't add the requirement", description: e?.message, variant: "destructive" });
    } finally {
      setAddingId(null);
    }
  };

  // "Dismiss": the brand's news is not a requirement. It leaves the list and
  // its news is quiet for 30 days. One tap, so it waits a few seconds for Undo
  // before it is saved; leaving the page saves the ones still waiting.
  const waiting = useRef(new Map<string, { timer: number; run: () => void }>());
  useEffect(() => () => { waiting.current.forEach((w) => { window.clearTimeout(w.timer); w.run(); }); }, []);
  const dismissBrand = (brand: ExpandingBrand) => {
    if (waiting.current.has(brand.companyId)) return;
    const setGone = (on: boolean) => setDismissed((prev) => {
      const next = new Set(prev);
      if (on) next.add(brand.companyId); else next.delete(brand.companyId);
      return next;
    });
    setGone(true);
    const run = () => { waiting.current.delete(brand.companyId); void saveDismissal(brand, setGone); };
    const timer = window.setTimeout(run, NEWS_UNDO_MS);
    waiting.current.set(brand.companyId, { timer, run });
    toast({
      title: `${brand.name}: dismissed`,
      description: "Its news stays off this list and raises no suggestion for 30 days.",
      duration: NEWS_UNDO_MS,
      action: <ToastAction altText="Undo the dismissal" onClick={() => {
        if (!waiting.current.has(brand.companyId)) return;
        window.clearTimeout(timer);
        waiting.current.delete(brand.companyId);
        setGone(false);
      }} data-testid={`button-undo-dismiss-news-${brand.companyId}`}>Undo</ToastAction>,
    });
  };
  const saveDismissal = async (brand: ExpandingBrand, setGone: (on: boolean) => void) => {
    try {
      const story = brand.latest;
      const res = await fetch("/api/requirement-centre/expanding/dismiss", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          companyId: brand.companyId,
          headline: String(story.headline || brand.name).slice(0, 500),
          url: story.link || undefined,
          source: story.source ? story.source.slice(0, 80) : undefined,
          date: story.date || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The brand could not be dismissed");
      queryClient.invalidateQueries({ queryKey: [EXPANDING_KEY] });
    } catch (e: any) {
      setGone(false);
      toast({ title: "Couldn't dismiss the brand", description: e?.message, variant: "destructive" });
    }
  };

  const addButton = (brand: ExpandingBrand) => (
    <span className={isMobile ? "flex w-full flex-col gap-2" : "inline-flex items-center gap-1.5"}>
      <Button variant="outline" size="sm" className={isMobile ? "h-11 w-full text-sm" : "h-7 text-xs"} onClick={() => add(brand)} disabled={!!addingId} data-testid={`button-add-from-news-${brand.companyId}`}>
        {addingId === brand.companyId ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
        Add requirement
      </Button>
      <Button variant="ghost" size="sm" className={`text-muted-foreground ${isMobile ? "h-11 w-full text-sm" : "h-7 text-xs"}`} onClick={() => void dismissBrand(brand)} disabled={addingId === brand.companyId} title="Not a requirement: take this brand off the list for 30 days" data-testid={`button-dismiss-news-${brand.companyId}`}>
        Dismiss
      </Button>
    </span>
  );
  const storyLine = (brand: ExpandingBrand) => brand.latest.link ? (
    <a href={brand.latest.link} target="_blank" rel="noopener noreferrer" className="hover:underline" data-testid={`link-news-story-${brand.companyId}`}>
      {brand.latest.headline}
      <ExternalLink className="inline w-3 h-3 ml-1 align-[-1px] text-muted-foreground" />
    </a>
  ) : brand.latest.headline;
  const listed = (brand: ExpandingBrand) => brand.backgroundRequirements > 0 && (
    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground" title="A requirement on the list nobody at BGP has confirmed in the last 12 months">Unconfirmed listing on file</Badge>
  );

  return (
    <>
      <Card data-testid="requirements-in-the-news">
        <CardContent className="p-0">
          <div className="px-4 py-2 border-b bg-muted/40">
            <h3 className="text-sm font-semibold">
              Expanding now, nothing on our books <span className="font-mono tabular-nums font-normal text-muted-foreground">{(searching ? brands.length : total).toLocaleString("en-GB")}</span>
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{LIST_NOTES.news}</p>
          </div>
          {isLoading ? (
            <div className="p-4 space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : isError ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm text-muted-foreground">The news list could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-news-refresh">Refresh</Button>
            </div>
          ) : brands.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="requirements-news-empty">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{searching ? "No brands in the news match this search" : "No expanding brands without a requirement"}</p>
            </div>
          ) : isMobile ? (
            <div className="grid grid-cols-1 gap-3 p-3">
              {brands.map((brand) => (
                <div key={brand.companyId} className="rounded-2xl border border-border bg-card p-4 space-y-2 shadow-sm" data-testid={`news-card-${brand.companyId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button className="min-w-0 text-left text-sm font-semibold text-primary hover:underline truncate" onClick={() => navigate(`/companies/${brand.companyId}`)}>{brand.name}</button>
                    {listed(brand)}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-mono tabular-nums">{day(brand.latest.date)}</span>{brand.latest.source ? ` · ${brand.latest.source}` : ""} · {countLabel(brand.signalCount, "story", "stories")}
                  </p>
                  <p className="text-xs break-words">{storyLine(brand)}</p>
                  <div className="pt-2 border-t">{addButton(brand)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Brand</TableHead>
                    <TableHead className="min-w-[360px]">Latest story</TableHead>
                    <TableHead className="min-w-[90px]">Date</TableHead>
                    <TableHead className="min-w-[130px]">Source</TableHead>
                    <TableHead className="min-w-[70px] text-right">Stories</TableHead>
                    <TableHead className="min-w-[220px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brands.map((brand) => (
                    <TableRow key={brand.companyId} data-testid={`row-news-${brand.companyId}`}>
                      <TableCell className="px-3 py-2">
                        <button className="text-left text-sm font-medium text-primary hover:underline" onClick={() => navigate(`/companies/${brand.companyId}`)} data-testid={`link-news-brand-${brand.companyId}`}>{brand.name}</button>
                        <div className="mt-0.5">{listed(brand)}</div>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-sm">
                        {storyLine(brand)}
                        {brand.latest.detail && <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{brand.latest.detail}</p>}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-xs font-mono tabular-nums whitespace-nowrap">{day(brand.latest.date)}</TableCell>
                      <TableCell className="px-3 py-2 text-xs">{brand.latest.source || "—"}</TableCell>
                      <TableCell className="px-3 py-2 text-xs font-mono tabular-nums text-right">{brand.signalCount.toLocaleString("en-GB")}</TableCell>
                      <TableCell className="px-3 py-2 text-right whitespace-nowrap">{addButton(brand)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!isLoading && !isError && !searching && total > shownLimit && (
            <p className="px-4 py-2 border-t text-[11px] text-muted-foreground">Showing the {shownLimit.toLocaleString("en-GB")} brands with the newest stories, of {total.toLocaleString("en-GB")}.</p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!choice} onOpenChange={(o) => { if (!o) setChoice(null); }}>
        <AlertDialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto" data-testid="dialog-news-existing">
          <AlertDialogHeader>
            <AlertDialogTitle>{choice?.brand.name} is already on the list</AlertDialogTitle>
            <AlertDialogDescription>
              Nobody at BGP has confirmed {choice && choice.existing.length > 1 ? "these" : "this"} lately. Confirm {choice && choice.existing.length > 1 ? "one" : "it"} from the press story, or add a separate requirement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="min-w-0 space-y-2">
            {choice?.existing.map((r) => (
              <div key={r.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground break-words">{r.stateLabel} · {r.dateLabel}</p>
                </div>
                <Button variant="outline" size="sm" className="h-11 w-full shrink-0 sm:h-8 sm:w-auto" disabled={!!addingId} onClick={() => choice && add(choice.brand, { requirementId: r.id })} data-testid={`button-news-confirm-existing-${r.id}`}>
                  Confirm this one
                </Button>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-news-existing-cancel">Cancel</AlertDialogCancel>
            <Button disabled={!!addingId} onClick={() => choice && add(choice.brand, { createNew: true })} data-testid="button-news-add-separate">
              Add a separate requirement
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Read-only count of what the requirement tables hold (admin). Nothing here
// changes data: it sizes the rows by source, state, age and status, and
// shows the ones no screen lists.
type RequirementsHealth = {
  generatedAt: string;
  liveDays: number;
  toConfirmDays: number;
  total: number | null;
  sections: Array<{ key: string; title: string; note?: string; error?: string; rows: Array<{ label: string; count: number }> }>;
};

function RequirementsHealthDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery<RequirementsHealth>({
    queryKey: ["/api/admin/requirements-health"],
    enabled: open,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-requirements-health">
        <DialogHeader>
          <DialogTitle>Requirements health</DialogTitle>
          <DialogDescription>
            A count of what is held, read-only. Nothing is changed by opening this.
            {data && ` Live means a named BGP person confirmed it within ${data.liveDays} days.`}
          </DialogDescription>
        </DialogHeader>
        {isLoading && <Skeleton className="h-40 w-full" />}
        {error && <p className="text-sm text-destructive" data-testid="text-requirements-health-error">{(error as Error).message}</p>}
        {data && (
          <div className="space-y-4">
            <p className="text-sm" data-testid="text-requirements-health-total">
              <span className="font-semibold tabular-nums">{data.total == null ? "Unknown" : data.total.toLocaleString("en-GB")}</span>
              <span className="text-muted-foreground"> leasing requirement rows in all</span>
            </p>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {data.sections.map((sec) => (
                <section key={sec.key} data-testid={`requirements-health-${sec.key}`}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{sec.title}</h3>
                  {sec.note && <p className="mt-1 text-xs text-muted-foreground">{sec.note}</p>}
                  {sec.error ? (
                    <p className="mt-1 text-xs text-destructive">Could not be counted: {sec.error}</p>
                  ) : sec.rows.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">None</p>
                  ) : (
                    <dl className="mt-1.5 divide-y divide-border border-y border-border">
                      {sec.rows.map((row) => (
                        <div key={row.label} className="flex items-baseline justify-between gap-3 py-1 text-sm">
                          <dt className="min-w-0 break-words">{row.label}</dt>
                          <dd className="shrink-0 font-medium tabular-nums">{row.count.toLocaleString("en-GB")}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-requirements-health-refresh">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Count again
          </Button>
          <Button onClick={() => onOpenChange(false)} data-testid="button-requirements-health-close">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Create a brand straight from the requirements board, then kick the brand-
// AI stack (description, industry, logo + imagery via /api/brand/enrich).
// Clients get the client CRM category slice; staff get the full taxonomy.
function NewBrandDialog({ open, onOpenChange, isClientView }: { open: boolean; onOpenChange: (o: boolean) => void; isClientView?: boolean }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const categories = TENANT_CATEGORIES;

  const submit = async () => {
    if (!name.trim() || !category || saving) return;
    setSaving(true);
    try {
      const res = await apiRequest("POST", "/api/crm/companies", {
        name: name.trim(),
        companyType: category,
        domainUrl: website.trim() || undefined,
      });
      const created = await res.json();
      // Fire the AI enrichment in the background — logo, description,
      // industry, imagery land on the brand profile as it completes.
      apiRequest("POST", `/api/brand/enrich/${created.id}`, {}).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: `${created.name} created`, description: "AI enrichment running — description, logo and imagery will appear on the brand profile shortly." });
      setName(""); setCategory(""); setWebsite("");
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Couldn't create brand", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New brand</DialogTitle>
          <DialogDescription>Creates the brand in the CRM and runs the AI enrichment (description, industry, logo, imagery).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Brand name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blank Street Coffee" data-testid="input-new-brand-name" />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category || undefined} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-new-brand-category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent className="max-h-[280px]">
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c.replace(/^Tenant - /, "")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Website <span className="text-muted-foreground font-normal">(optional — helps the AI)</span></Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" data-testid="input-new-brand-website" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || !category || saving} data-testid="button-submit-new-brand">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
            Create brand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormMultiLocationPicker({
  locationData,
  onChange,
}: {
  locationData: string | null;
  onChange: (data: string | null) => void;
}) {
  const locations = parseLocationData(locationData);

  const addLocation = (addr: { formatted: string; placeId: string; lat?: number; lng?: number } | null) => {
    if (!addr) return;
    if (locations.some((l) => l.placeId === addr.placeId)) return;
    const updated = [...locations, addr];
    onChange(JSON.stringify(updated));
  };

  const removeLocation = (placeId: string) => {
    const updated = locations.filter((l) => l.placeId !== placeId);
    onChange(updated.length > 0 ? JSON.stringify(updated) : null);
  };

  return (
    <div className="border rounded-md p-2 space-y-2">
      {locations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {locations.map((loc) => (
            <div
              key={loc.placeId}
              className="flex items-center gap-1 bg-muted/40 border border-border rounded-full px-2.5 py-1 text-[11px]"
            >
              <MapPin className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
              <span className="max-w-[180px] truncate" title={loc.formatted}>{loc.formatted.split(",")[0]}</span>
              <button
                type="button"
                onClick={() => removeLocation(loc.placeId)}
                className="text-muted-foreground hover:text-destructive ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <AddressAutocomplete
        value={null}
        onChange={addLocation}
        placeholder="Search and add a location..."
      />
    </div>
  );
}

function LandlordPackCell({ itemId, landlordPack }: { itemId: string; landlordPack: string | null }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (file: globalThis.File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/crm/requirements-leasing/${itemId}/landlord-pack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      toast({ title: "Landlord pack uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/crm/requirements-leasing/${itemId}/landlord-pack`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      toast({ title: "Landlord pack removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  let pack: { url?: string; name?: string; size?: number } | null = null;
  if (landlordPack) {
    try { pack = JSON.parse(landlordPack); } catch {}
  }

  if (pack?.url) {
    const displayName = pack.name || "Document";
    return (
      <div className="space-y-0.5">
        <a
          href={pack.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer"
          data-testid={`link-landlord-pack-${itemId}`}
        >
          <File className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[80px]">{displayName}</span>
        </a>
        <button
          onClick={() => deleteMutation.mutate()}
          className="text-[10px] text-red-500 hover:text-red-700 cursor-pointer"
          data-testid={`button-remove-pack-${itemId}`}
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadMutation.mutate(file);
          e.target.value = "";
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="text-xs h-7 px-2"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadMutation.isPending}
        data-testid={`button-upload-pack-${itemId}`}
      >
        <Upload className="w-3 h-3 mr-1" />
        {uploadMutation.isPending ? "Uploading..." : "Upload"}
      </Button>
    </>
  );
}

const USE_OPTIONS = CRM_OPTIONS.reqLeasingUse.map((u) => ({ label: useClassLabel(u), value: u }));
const TYPE_OPTIONS = CRM_OPTIONS.reqLeasingType.map((t) => ({ label: t, value: t }));
const SIZE_OPTIONS = CRM_OPTIONS.reqLeasingSize.map((s) => ({ label: formatSizeText(s), value: s }));
// Imported sizes ("10000- ft2") aren't in the option list, so the chip showed
// the raw string — add the row's own values with a display label
// (Woody, 2026-09-27). Values are unchanged.
const sizeOptionsFor = (values: string[] | string | null | undefined) => {
  const extra = (Array.isArray(values) ? values : values ? [values] : [])
    .filter((v) => !(CRM_OPTIONS.reqLeasingSize as readonly string[]).includes(v))
    .map((v) => ({ label: formatSizeText(v), value: v }));
  return extra.length ? [...SIZE_OPTIONS, ...extra] : SIZE_OPTIONS;
};
const LOCATION_OPTIONS = CRM_OPTIONS.reqLeasingLocations.map((l) => ({ label: l, value: l }));

const INVEST_USE_OPTIONS = CRM_OPTIONS.reqInvestmentUse.map((u) => ({ label: u, value: u }));
const INVEST_TYPE_OPTIONS = CRM_OPTIONS.reqInvestmentType.map((t) => ({ label: t, value: t }));
const INVEST_SIZE_OPTIONS = CRM_OPTIONS.reqInvestmentSize.map((s) => ({ label: s, value: s }));
const INVEST_LOCATION_OPTIONS = CRM_OPTIONS.reqInvestmentLocations.map((l) => ({ label: l, value: l }));

function InlineMultiUserPicker({
  users,
  currentUserIds,
  userMap,
  onSelect,
  testIdPrefix,
  colorMap,
  emptyLabel = "—",
}: {
  users: BgpUser[];
  currentUserIds: string[];
  userMap: Map<string, BgpUser>;
  onSelect: (userIds: string[]) => void;
  testIdPrefix: string;
  colorMap?: Record<string, string>;
  emptyLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!editing) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200) });
    }
  }, [editing]);

  const filtered = useMemo(() => {
    const list = users || [];
    if (!search) return list.slice(0, 20);
    const s = search.toLowerCase();
    return list.filter((u) =>
      u.name.toLowerCase().includes(s) ||
      (u.department || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [users, search]);

  const selectedUsers = currentUserIds.map(id => userMap.get(id)).filter(Boolean) as BgpUser[];

  const toggleUser = (userId: string) => {
    if (currentUserIds.includes(userId)) {
      onSelect(currentUserIds.filter(id => id !== userId));
    } else {
      onSelect([...currentUserIds, userId]);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-1 group flex-wrap">
        {selectedUsers.length > 0 ? (
          selectedUsers.map(u => {
            const bg = colorMap?.[u.id] || "bg-zinc-500";
            return (
            <span key={u.id} className={`inline-flex items-center gap-1 text-xs text-white px-1.5 py-0.5 rounded-full ${bg}`}>
              <span className="truncate max-w-[80px]">{u.name.split(" ")[0]}</span>
            </span>
            );
          })
        ) : (
          <span className="text-xs text-muted-foreground">{emptyLabel}</span>
        )}
        <button
          type="button"
          onClick={() => { setEditing(true); setSearch(""); }}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Change"
          data-testid={`${testIdPrefix}-edit`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search team..."
          className="w-full pl-7 pr-2 py-1 text-sm border rounded-md bg-background"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid={`${testIdPrefix}-search`}
        />
      </div>
      {dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, minWidth: 200 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {currentUserIds.length > 0 && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-accent text-xs text-red-600 border-b"
              onClick={() => { onSelect([]); setEditing(false); }}
              data-testid={`${testIdPrefix}-clear`}
            >
              <X className="w-3 h-3 inline mr-1" /> Clear all
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No team members found</div>
          ) : (
            filtered.map((u) => {
              const isActive = currentUserIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 ${isActive ? "bg-accent/50" : ""}`}
                  onClick={() => toggleUser(u.id)}
                  data-testid={`${testIdPrefix}-option-${u.id}`}
                >
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${isActive ? (colorMap?.[u.id] || "bg-emerald-500") + " border-transparent" : "border-muted-foreground/30"}`}>
                    {isActive && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium truncate block">{u.name}</span>
                    {u.department && <span className="text-[10px] text-muted-foreground">{u.department}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}


function CompanySearchPicker({
  companies,
  selectedId,
  selectedName,
  onSelect,
  onClear,
}: {
  companies: CrmCompany[];
  selectedId: string;
  selectedName: string;
  onSelect: (company: CrmCompany) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [creating, setCreating] = useState(false);
  const filtered = useMemo(() => {
    const sorted = [...companies].sort((a, b) => a.name.localeCompare(b.name));
    if (!search) return sorted.slice(0, 30);
    const s = search.toLowerCase();
    return sorted.filter((c) =>
      c.name.toLowerCase().includes(s) ||
      (c.companyType || "").toLowerCase().includes(s)
    ).slice(0, 30);
  }, [companies, search]);
  const trimmed = search.trim();
  const exactMatch = companies.some((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
  const createCompany = async () => {
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await apiRequest("POST", "/api/crm/companies", { name: trimmed });
      const created = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      onSelect(created);
      setSearch(""); setOpen(false);
    } catch { /* surfaced by the global error toast */ }
    finally { setCreating(false); }
  };

  if (selectedId && selectedName) {
    const company = companies.find((c) => c.id === selectedId);
    return (
      <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30">
        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium flex-1 truncate min-w-0">{selectedName}</span>
        {company?.companyType && (
          <Badge variant="outline" className="text-[10px] shrink-0">{company.companyType}</Badge>
        )}
        <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search companies to link..."
          className="pl-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          data-testid="input-leasing-company-search"
        />
      </div>
      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto"
        >
          {filtered.length === 0 && !trimmed ? (
            <div className="p-3 text-xs text-muted-foreground text-center">Start typing to search companies</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                onClick={() => { onSelect(c); setSearch(""); setOpen(false); }}
                data-testid={`option-company-${c.id}`}
              >
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate min-w-0">{c.name}</span>
                {c.companyType && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{c.companyType}</Badge>
                )}
              </button>
            ))
          )}
          {trimmed && !exactMatch && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm border-t text-primary font-medium disabled:opacity-50"
              onClick={createCompany}
              disabled={creating}
              data-testid="option-company-create"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{creating ? "Adding…" : `Add “${trimmed}” as a new company`}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ContactSearchPicker({
  contacts,
  selectedId,
  onSelect,
  onClear,
  filterCompanyId,
  filterContactType,
  placeholder,
}: {
  contacts: CrmContact[];
  selectedId: string;
  onSelect: (contact: CrmContact) => void;
  onClear: () => void;
  filterCompanyId?: string;
  filterContactType?: string;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const baseContacts = useMemo(() => {
    let list = contacts;
    if (filterCompanyId) {
      list = list.filter((c) => c.companyId === filterCompanyId);
    }
    if (filterContactType) {
      list = list.filter((c) => c.contactType?.toLowerCase() === filterContactType.toLowerCase());
    }
    return list;
  }, [contacts, filterCompanyId, filterContactType]);

  const filtered = useMemo(() => {
    if (!search) return baseContacts.slice(0, 20);
    const s = search.toLowerCase();
    return baseContacts.filter((c) =>
      c.name.toLowerCase().includes(s) ||
      (c.email || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s) ||
      (c.companyName || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [baseContacts, search]);

  if (selectedId) {
    const contact = contacts.find((c) => c.id === selectedId);
    if (contact && (!filterCompanyId || contact.companyId === filterCompanyId) && (!filterContactType || contact.contactType?.toLowerCase() === filterContactType.toLowerCase())) {
      return (
        <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30">
          <User className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate block">{contact.name}</span>
            <div className="flex items-center gap-2 flex-wrap">
              {contact.email && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Mail className="w-2.5 h-2.5 shrink-0" />{contact.email}
                </span>
              )}
              {contact.phone && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Phone className="w-2.5 h-2.5 shrink-0" />{contact.phone}
                </span>
              )}
            </div>
          </div>
          {contact.companyName && (
            <Badge variant="outline" className="text-[10px] shrink-0">{contact.companyName}</Badge>
          )}
          <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder={placeholder || "Search contacts..."}
          className="pl-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          data-testid="input-leasing-contact-search"
        />
      </div>
      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">
              {filterCompanyId && baseContacts.length === 0
                ? "No contacts linked to this company"
                : filterContactType && baseContacts.length === 0
                ? `No ${filterContactType.toLowerCase()} contacts found`
                : "No contacts found"}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                onClick={() => { onSelect(c); setSearch(""); setOpen(false); }}
                data-testid={`option-contact-${c.id}`}
              >
                <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="truncate block font-medium">{c.name}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.email && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Mail className="w-2 h-2" />{c.email}
                      </span>
                    )}
                    {c.phone && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Phone className="w-2 h-2" />{c.phone}
                      </span>
                    )}
                  </div>
                </div>
                {c.companyName && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{c.companyName}</Badge>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DealSearchPicker({
  deals,
  selectedId,
  onSelect,
  onClear,
}: {
  deals: CrmDeal[];
  selectedId: string;
  onSelect: (deal: CrmDeal) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return deals.slice(0, 20);
    const s = search.toLowerCase();
    return deals.filter((d) =>
      d.name.toLowerCase().includes(s) ||
      (d.status || "").toLowerCase().includes(s) ||
      (d.dealType || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [deals, search]);

  if (selectedId) {
    const deal = deals.find((d) => d.id === selectedId);
    if (deal) {
      return (
        <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium flex-1 truncate min-w-0">{deal.name}</span>
          {deal.status && (
            <Badge variant="outline" className="text-[10px] shrink-0">{deal.status}</Badge>
          )}
          <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search deals..."
          className="pl-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          data-testid="input-leasing-deal-search"
        />
      </div>
      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No deals found</div>
          ) : (
            filtered.map((d) => (
              <button
                key={d.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                onClick={() => { onSelect(d); setSearch(""); setOpen(false); }}
                data-testid={`option-deal-${d.id}`}
              >
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate min-w-0">{d.name}</span>
                {d.status && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{d.status}</Badge>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function LeasingFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  title,
  defaultValues,
  groups,
  companies,
  contacts,
  deals,
  ownerOptions,
  defaultOwnerId,
  presetCompanyId,
  clientForm = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
  title: string;
  defaultValues?: Partial<CrmRequirementsLeasing>;
  groups: string[];
  companies: CrmCompany[];
  contacts: CrmContact[];
  deals: CrmDeal[];
  /** BGP people who can own a requirement. */
  ownerOptions: BgpUser[];
  /** The owner a new requirement starts with: the person adding it. */
  defaultOwnerId?: string | null;
  presetCompanyId?: string | null;   // opened from a brand's page (?companyId=&new=1): start with that brand chosen
  /**
   * A client login (or staff viewing as one), Woody 2026-11-17: no BGP owner
   * (the owner is BGP's, and is never sent), and the brand is picked from its
   * own brand list, never typed. The server takes only these fields.
   */
  clientForm?: boolean;
}) {
  const [form, setForm] = useState({
    name: defaultValues?.name || "",
    bgpContactUserIds: defaultValues ? requirementOwnerIds(defaultValues) : defaultOwnerId ? [defaultOwnerId] : [] as string[],
    companyId: defaultValues?.companyId || "",
    groupName: defaultValues?.groupName || "",
    status: defaultValues?.status || "Active",
    principalContactId: defaultValues?.principalContactId || "",
    agentContactId: defaultValues?.agentContactId || "",
    dealId: defaultValues?.dealId || "",
    use: Array.isArray(defaultValues?.use) ? defaultValues.use : defaultValues?.use ? [defaultValues.use] : [],
    requirementType: Array.isArray(defaultValues?.requirementType) ? defaultValues.requirementType : defaultValues?.requirementType ? [defaultValues.requirementType as string] : [],
    size: Array.isArray(defaultValues?.size) ? defaultValues.size : defaultValues?.size ? [defaultValues.size as string] : [],
    requirementLocations: Array.isArray(defaultValues?.requirementLocations) ? defaultValues.requirementLocations : defaultValues?.requirementLocations ? [defaultValues.requirementLocations as string] : [],
    locationData: defaultValues?.locationData || null,
    comments: defaultValues?.comments || "",
  });
  // Once per opening, when the company list has loaded and nothing is chosen yet.
  const presetFor = presetCompanyId ? companies.find((c) => c.id === presetCompanyId) : null;
  const [presetDone, setPresetDone] = useState(false);
  useEffect(() => {
    if (!open) { setPresetDone(false); return; }
    if (presetDone || !presetFor) return;
    setPresetDone(true);
    setForm((f) => (f.companyId || f.name ? f : { ...f, name: presetFor.name, companyId: presetFor.id }));
  }, [open, presetDone, presetFor]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { bgpContactUserIds, ...fields } = form;
    onSubmit({
      ...fields,
      companyId: form.companyId || null,
      principalContactId: form.principalContactId || null,
      agentContactId: form.agentContactId || null,
      dealId: form.dealId || null,
      use: form.use.length > 0 ? form.use : null,
      requirementType: form.requirementType.length > 0 ? form.requirementType : null,
      size: form.size.length > 0 ? form.size : null,
      requirementLocations: form.requirementLocations.length > 0 ? form.requirementLocations : null,
      locationData: form.locationData,
      // The owner list is the field the page reads; the single id follows it.
      // A client's form sends no owner at all.
      ...(clientForm ? {} : {
        bgpContactUserIds: bgpContactUserIds.length > 0 ? bgpContactUserIds : null,
        bgpContactUserId: bgpContactUserIds[0] || null,
      }),
    });
  };
  const ownerName = (id: string) => ownerOptions.find((u) => u.id === id)?.name || "Unknown";
  // The dialog can open before the login has loaded (the dashboard's Add link):
  // the default owner is filled in when it arrives, unless the person has chosen already.
  const ownerTouched = useRef(false);
  useEffect(() => {
    if (defaultValues || !defaultOwnerId || ownerTouched.current) return;
    setForm((f) => (f.bgpContactUserIds.length ? f : { ...f, bgpContactUserIds: [defaultOwnerId] }));
  }, [defaultOwnerId]);
  const setOwners = (ids: string[]) => { ownerTouched.current = true; setForm((f) => ({ ...f, bgpContactUserIds: ids })); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{clientForm ? "Brand" : "Name / Company"}</Label>
            <CompanySearchPicker
              companies={companies}
              selectedId={form.companyId}
              selectedName={form.name}
              onSelect={(c) => setForm({ ...form, name: c.name, companyId: c.id, principalContactId: "" })}
              onClear={() => setForm({ ...form, name: "", companyId: "", principalContactId: "" })}
            />
            {!form.companyId && !clientForm && (
              <Input
                placeholder="Or type a name manually..."
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="input-leasing-name"
              />
            )}
            {clientForm && !form.companyId && form.name && (
              <p className="text-xs" data-testid="leasing-client-unlinked-name">{form.name} <span className="text-muted-foreground">(no brand linked)</span></p>
            )}
            {clientForm && (
              <p className="text-[11px] text-muted-foreground" data-testid="leasing-client-brand-note">
                Choose the brand from your brand list, or add it there by typing its name. BGP checks a requirement you add with the brand.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Group</Label>
              <Input
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                data-testid="input-leasing-group"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status || undefined} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="select-leasing-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {CRM_OPTIONS.reqLeasingStatus.map((s) => (
                    <SelectItem key={s} value={s}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${CRM_OPTIONS.reqLeasingStatusColors[s] || "bg-gray-400"}`} />
                        {s}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!clientForm && (
          <div className="space-y-2">
            <Label>BGP owner</Label>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="leasing-owner-picker">
              {form.bgpContactUserIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium" data-testid={`leasing-owner-${id}`}>
                  {ownerName(id)}
                  <button
                    type="button"
                    onClick={() => setOwners(form.bgpContactUserIds.filter((v) => v !== id))}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${ownerName(id)}`}
                    data-testid={`button-remove-leasing-owner-${id}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {/* Remounts empty after each pick, so it always reads as "add". */}
              <Select key={form.bgpContactUserIds.join(",")} onValueChange={(v) => setOwners([...form.bgpContactUserIds, v])}>
                <SelectTrigger className="h-8 w-[190px] text-xs" data-testid="select-leasing-owner">
                  <SelectValue placeholder={form.bgpContactUserIds.length ? "Add another owner" : "Choose an owner"} />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {ownerOptions.filter((u) => !form.bgpContactUserIds.includes(u.id)).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">The BGP person who keeps this requirement up to date.</p>
          </div>
          )}
          <div className="space-y-2">
            <Label>Principal Contact</Label>
            {form.companyId ? (
              <ContactSearchPicker
                contacts={contacts}
                selectedId={form.principalContactId}
                onSelect={(c) => setForm({ ...form, principalContactId: c.id })}
                onClear={() => setForm({ ...form, principalContactId: "" })}
                filterCompanyId={form.companyId}
                placeholder="Search company contacts..."
              />
            ) : (
              <p className="text-xs text-muted-foreground italic py-2">Select a company first to choose a principal contact</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Agent Contact</Label>
            <ContactSearchPicker
              contacts={contacts}
              selectedId={form.agentContactId}
              onSelect={(c) => setForm({ ...form, agentContactId: c.id })}
              onClear={() => setForm({ ...form, agentContactId: "" })}
              filterContactType="Agent"
              placeholder="Search agent contacts..."
            />
          </div>
          <div className="space-y-2">
            <Label>Deal</Label>
            <DealSearchPicker
              deals={deals}
              selectedId={form.dealId}
              onSelect={(d) => setForm({ ...form, dealId: d.id })}
              onClear={() => setForm({ ...form, dealId: "" })}
            />
          </div>
          <div className="space-y-2">
            <Label>Use</Label>
            <div className="flex flex-wrap gap-1.5 border rounded-md p-2 min-h-[38px]">
              {CRM_OPTIONS.reqLeasingUse.map((u) => {
                const isSelected = form.use.includes(u);
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      use: isSelected ? form.use.filter((v: string) => v !== u) : [...form.use, u],
                    })}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                      isSelected
                        ? `${CRM_OPTIONS.reqLeasingUseColors[u] || "bg-zinc-500"} text-white`
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    data-testid={`toggle-use-${u}`}
                  >
                    {u}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Requirement Type</Label>
            <div className="flex flex-wrap gap-1.5 border rounded-md p-2 min-h-[38px]">
              {CRM_OPTIONS.reqLeasingType.map((t) => {
                const isSelected = form.requirementType.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      requirementType: isSelected ? form.requirementType.filter((v: string) => v !== t) : [...form.requirementType, t],
                    })}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                      isSelected
                        ? `${CRM_OPTIONS.reqLeasingTypeColors[t] || "bg-zinc-500"} text-white`
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    data-testid={`toggle-type-${t}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Size</Label>
            <div className="flex flex-wrap gap-1.5 border rounded-md p-2 min-h-[38px]">
              {CRM_OPTIONS.reqLeasingSize.map((s) => {
                const isSelected = form.size.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      size: isSelected ? form.size.filter((v: string) => v !== s) : [...form.size, s],
                    })}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                      isSelected
                        ? `${CRM_OPTIONS.reqLeasingSizeColors[s] || "bg-zinc-500"} text-white`
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    data-testid={`toggle-size-${s}`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Requirement Locations</Label>
            <div className="flex flex-wrap gap-1.5 border rounded-md p-2 min-h-[38px]">
              {CRM_OPTIONS.reqLeasingLocations.map((l) => {
                const isSelected = form.requirementLocations.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      requirementLocations: isSelected ? form.requirementLocations.filter((v: string) => v !== l) : [...form.requirementLocations, l],
                    })}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                      isSelected
                        ? `${CRM_OPTIONS.reqLeasingLocationsColors[l] || "bg-zinc-500"} text-white`
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    data-testid={`toggle-location-${l}`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Map Locations</Label>
            <FormMultiLocationPicker
              locationData={form.locationData}
              onChange={(data) => setForm({ ...form, locationData: data })}
            />
          </div>
          <div className="space-y-2">
            <Label>Comments</Label>
            <Textarea
              value={form.comments}
              onChange={(e) => setForm({ ...form, comments: e.target.value })}
              data-testid="input-leasing-comments"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {/* A client's requirement names a brand from its list; a row that never had one can still be edited. */}
            <Button type="submit" disabled={isPending || !form.name || (clientForm && !form.companyId && (!defaultValues || !!defaultValues.companyId))} data-testid="button-submit-leasing">
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InvestmentTable({ teamFilter, autoCreate, requirementId }: { teamFilter?: string | null; autoCreate?: boolean; requirementId?: string | null }) {
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [createOpen, setCreateOpen] = useState(!!autoCreate);
  const [editItem, setEditItem] = useState<CrmRequirementsInvestment | null>(null);
  const [deleteItem, setDeleteItem] = useState<CrmRequirementsInvestment | null>(null);
  const { toast } = useToast();

  const { data: items = [], isLoading, error } = useQuery<CrmRequirementsInvestment[]>({
    queryKey: ["/api/crm/requirements-investment"],
  });
  const openedRequirementId = useRef<string | null>(null);
  useEffect(() => {
    if (!requirementId) { openedRequirementId.current = null; return; }
    if (isLoading || error || openedRequirementId.current === requirementId) return;
    openedRequirementId.current = requirementId;
    const linked = items.find(item => item.id === requirementId);
    if (linked) setEditItem(linked);
    else {
      setEditItem(null);
      toast({ title: "Requirement unavailable", description: "This requirement was removed or is not available to your account.", variant: "destructive" });
    }
  }, [requirementId, items, isLoading, error, toast]);

  const { data: companies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: users = [] } = useQuery<BgpUser[]>({
    queryKey: ["/api/users"],
  });
  const userIdColorMap = useMemo(() => buildUserIdColorMap(users), [users]);

  const teamUserIds = useMemo(() => {
    if (!teamFilter) return null;
    const tf = teamFilter.toLowerCase();
    return new Set(users.filter(u => u.team?.toLowerCase().includes(tf)).map(u => u.id));
  }, [teamFilter, users]);

  const { data: invProperties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const companyMap = useMemo(() => {
    const map = new Map<string, CrmCompany>();
    companies.forEach((c) => map.set(c.id, c));
    return map;
  }, [companies]);

  const userMap = useMemo(() => {
    const map = new Map<string, BgpUser>();
    users.forEach((u) => map.set(u.id, u));
    return map;
  }, [users]);

  const invPropertyMatchMap = useMemo(() => {
    const map = new Map<string, CrmProperty[]>();
    if (!invProperties.length) return map;
    items.forEach(req => {
      const locs = Array.isArray(req.requirementLocations) ? req.requirementLocations : [];
      if (!locs.length) return;
      const locsLc = locs.map(l => l.toLowerCase());
      const matches = invProperties.filter(p => {
        const addr = p.address as any;
        const addrStr = addr ? [addr.formatted, addr.street, addr.city, addr.area, addr.text, typeof addr === "string" ? addr : ""].filter(Boolean).join(" ").toLowerCase() : "";
        const pName = (p.name || "").toLowerCase();
        return locsLc.some(loc => addrStr.includes(loc) || pName.includes(loc));
      });
      if (matches.length > 0) map.set(req.id, matches);
    });
    return map;
  }, [items, invProperties]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<CrmRequirementsInvestment>) =>
      apiRequest("POST", "/api/crm/requirements-investment", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
      setCreateOpen(false);
      toast({ title: "Requirement created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CrmRequirementsInvestment> }) =>
      apiRequest("PUT", `/api/crm/requirements-investment/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
      setEditItem(null);
      toast({ title: "Requirement updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CrmRequirementsInvestment> }) =>
      apiRequest("PUT", `/api/crm/requirements-investment/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdate = (id: string, data: Partial<CrmRequirementsInvestment>) => {
    inlineUpdateMutation.mutate({ id, data });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/requirements-investment/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
      setDeleteItem(null);
      toast({ title: "Requirement deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleColumnFilter = (col: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[col] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      if (next.length === 0) {
        const { [col]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [col]: next };
    });
  };

  const investFilterOptions = useMemo(() => {
    const groupSet = new Set<string>();
    const useSet = new Set<string>();
    const typeSet = new Set<string>();
    const sizeSet = new Set<string>();
    const locationSet = new Set<string>();
    items.forEach((i) => {
      if (i.groupName) groupSet.add(i.groupName);
      if (Array.isArray(i.use)) i.use.forEach((v) => useSet.add(v));
      if (Array.isArray(i.requirementType)) i.requirementType.forEach((v) => typeSet.add(v));
      if (Array.isArray(i.size)) i.size.forEach((v) => sizeSet.add(v));
      if (Array.isArray(i.requirementLocations)) i.requirementLocations.forEach((v) => locationSet.add(v));
    });
    return {
      group: Array.from(groupSet).sort(),
      use: Array.from(useSet).sort(),
      requirementType: Array.from(typeSet).sort(),
      size: Array.from(sizeSet).sort(),
      location: Array.from(locationSet).sort(),
    };
  }, [items]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.groupName) set.add(i.groupName); });
    return Array.from(set).sort();
  }, [items]);

  const hasColumnFilters = Object.keys(columnFilters).length > 0;

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (teamUserIds) {
        const ids = (item as any).bgpContactUserIds || [];
        if (ids.length > 0 && !ids.some((id: string) => teamUserIds.has(id))) return false;
      }
      if (groupFilter !== "all" && (item.groupName || "Ungrouped") !== groupFilter) return false;
      if (columnFilters.group?.length && !columnFilters.group.includes(item.groupName || "")) return false;
      if (columnFilters.use?.length) {
        const vals = Array.isArray(item.use) ? item.use : [];
        if (!columnFilters.use.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.requirementType?.length) {
        const vals = Array.isArray(item.requirementType) ? item.requirementType : [];
        if (!columnFilters.requirementType.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.size?.length) {
        const vals = Array.isArray(item.size) ? item.size : [];
        if (!columnFilters.size.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.location?.length) {
        const vals = Array.isArray(item.requirementLocations) ? item.requirementLocations : [];
        if (!columnFilters.location.some((f) => vals.includes(f))) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (
          item.name.toLowerCase().includes(s) ||
          (Array.isArray(item.use) ? item.use.join(" ") : (item.use || "")).toLowerCase().includes(s) ||
          item.locations?.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [items, groupFilter, columnFilters, search, teamUserIds]);

  const groupCounts = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((i) => {
      const g = i.groupName || "Ungrouped";
      map[g] = (map[g] || 0) + 1;
    });
    return map;
  }, [items]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">Could not load Investment Requirements</h3>
          <p className="text-sm text-muted-foreground">Please check the API connection.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {Object.keys(groupCounts).some((group) => group !== "Ungrouped") && (
      <div className="flex items-center gap-3 flex-wrap">
        {Object.entries(groupCounts).filter(([group]) => group !== "Ungrouped").map(([group, count]) => {
          const badgeColor = group === "Institutional" ? "bg-indigo-500" :
            group === "Active Buyers" ? "bg-emerald-500" :
            group === "Target Buyers" ? "bg-amber-500" :
            "bg-slate-500";
          return (
            <Card
              key={group}
              className={`flex-1 min-w-[130px] cursor-pointer transition-colors ${
                groupFilter === group ? "border-primary" : ""
              }`}
              onClick={() => setGroupFilter(groupFilter === group ? "all" : group)}
              data-testid={`card-invest-group-${group}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`border-transparent ${badgeColor} text-white text-[10px] px-1.5 py-0 shrink-0`}>{group}</Badge>
                  <div>
                    <p className="text-lg font-bold">{count}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={isMobile ? "Search…" : "Search investment requirements…"}
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-investment"
          />
        </div>
        {(search || groupFilter !== "all" || hasColumnFilters) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSearch(""); setGroupFilter("all"); setColumnFilters({}); }}
            data-testid="button-clear-invest-filters"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Clear
          </Button>
        )}
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-investment">
          <Plus className="w-4 h-4 mr-1" />
          Add requirement
        </Button>
      </div>

      {isMobile ? (
        <MobileCardView
          emptyMessage="No requirements"
          emptyDescription={search ? "Try adjusting your filters" : "No live requirements yet"}
          items={filteredItems.map((item) => ({
            id: item.id,
            title: (item.companyId ? companyMap.get(item.companyId)?.name : null) || item.name,
            subtitle: item.contactName || undefined,
            status: item.status || "Active",
            statusColor: item.status === "Past" ? "bg-zinc-400" : item.status === "Archived" ? "bg-zinc-300" : "bg-emerald-500",
            fields: [
              { label: "Use", value: Array.isArray(item.use) ? item.use.map(useClassLabel).join(", ") : useClassLabel(item.use as any) },
              { label: "Type", value: Array.isArray(item.requirementType) ? item.requirementType.join(", ") : (item.requirementType as any) },
              { label: "Lot size", value: Array.isArray(item.size) ? item.size.join(", ") : (item.size as any) },
              { label: "Locations", value: Array.isArray(item.requirementLocations) ? item.requirementLocations.join(", ") : (item.requirementLocations as any) },
            ],
            onEdit: () => setEditItem(item),
            onDelete: () => setDeleteItem(item),
          }))}
        />
      ) : (
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <ScrollableTable minWidth={1600}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[80px] max-w-[120px] sticky left-0 bg-background z-10">Company</TableHead>
                    <TableHead className="min-w-[140px]">Contact</TableHead>
                    <TableHead className="min-w-[100px]">Updated</TableHead>
                    <TableHead className="min-w-[120px]">
                      <ColumnFilterPopover
                        label="Group"
                        options={investFilterOptions.group}
                        activeFilters={columnFilters.group || []}
                        onToggleFilter={(v) => toggleColumnFilter("group", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[100px] text-center">Progress</TableHead>
                    <TableHead className="min-w-[100px]">
                      <ColumnFilterPopover
                        label="Use"
                        options={investFilterOptions.use}
                        activeFilters={columnFilters.use || []}
                        onToggleFilter={(v) => toggleColumnFilter("use", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[100px]">
                      <ColumnFilterPopover
                        label="Type"
                        options={investFilterOptions.requirementType}
                        activeFilters={columnFilters.requirementType || []}
                        onToggleFilter={(v) => toggleColumnFilter("requirementType", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[100px]">
                      <ColumnFilterPopover
                        label="Size"
                        options={investFilterOptions.size}
                        activeFilters={columnFilters.size || []}
                        onToggleFilter={(v) => toggleColumnFilter("size", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[150px]">
                      <ColumnFilterPopover
                        label="Locations"
                        options={investFilterOptions.location}
                        activeFilters={columnFilters.location || []}
                        onToggleFilter={(v) => toggleColumnFilter("location", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[160px]">BGP Contact</TableHead>
                    <TableHead className="min-w-[200px]">Comments</TableHead>
                    <TableHead className="min-w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.id} className="text-xs" data-testid={`row-invest-${item.id}`}>
                      <TableCell className="px-1.5 py-1 font-medium text-sm max-w-[120px] sticky left-0 bg-background z-10">
                        {item.companyId && companyMap.has(item.companyId) ? (
                          <button
                            className="flex items-center gap-2 text-left hover:underline cursor-pointer text-primary max-w-full"
                            onClick={() => navigate(`/contacts?company=${item.companyId}`)}
                            data-testid={`link-company-invest-${item.id}`}
                          >
                            <Building2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{companyMap.get(item.companyId)?.name}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 max-w-full">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{item.name}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.contactName ? (
                          <div className="space-y-0.5">
                            <div className="font-medium flex items-center gap-1">
                              <User className="w-3 h-3 shrink-0" />
                              {item.contactName}
                            </div>
                            {item.contactEmail && (
                              <a href={`mailto:${item.contactEmail}`} className="text-primary hover:underline flex items-center gap-1">
                                <Mail className="w-3 h-3 shrink-0" />
                                {item.contactEmail}
                              </a>
                            )}
                            {item.contactMobile && (
                              <a href={`tel:${item.contactMobile}`} className="text-primary hover:underline flex items-center gap-1">
                                <Phone className="w-3 h-3 shrink-0" />
                                {item.contactMobile}
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5 py-1 text-muted-foreground">
                        {item.requirementDate || "—"}
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        {item.groupName && (
                          <Badge className={`text-xs text-white ${
                            item.groupName === "Institutional" ? "bg-indigo-500" :
                            item.groupName === "Active Buyers" ? "bg-emerald-500" :
                            item.groupName === "Target Buyers" ? "bg-amber-500" :
                            "bg-slate-500"
                          }`}>
                            {item.groupName}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5 py-1 text-center">
                        <ProgressTickCell
                          item={item}
                          onUpdate={(data) => inlineUpdate(item.id, data)}
                          testIdPrefix={`tick-inv-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiSelect
                          value={item.use}
                          options={INVEST_USE_OPTIONS}
                          colorMap={CRM_OPTIONS.reqInvestmentUseColors}
                          onSave={(v) => inlineUpdate(item.id, { use: v })}
                          placeholder="Set use"
                          testId={`select-inv-use-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiSelect
                          value={item.requirementType}
                          options={INVEST_TYPE_OPTIONS}
                          colorMap={CRM_OPTIONS.reqInvestmentTypeColors}
                          onSave={(v) => inlineUpdate(item.id, { requirementType: v })}
                          placeholder="Set type"
                          testId={`select-inv-type-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiSelect
                          value={item.size}
                          options={INVEST_SIZE_OPTIONS}
                          colorMap={CRM_OPTIONS.reqInvestmentSizeColors}
                          onSave={(v) => inlineUpdate(item.id, { size: v })}
                          placeholder="Set size"
                          testId={`select-inv-size-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiSelect
                          value={item.requirementLocations}
                          options={INVEST_LOCATION_OPTIONS}
                          colorMap={CRM_OPTIONS.reqInvestmentLocationsColors}
                          onSave={(v) => inlineUpdate(item.id, { requirementLocations: v })}
                          placeholder="Set location"
                          testId={`select-inv-loc-${item.id}`}
                        />
                        {invPropertyMatchMap.has(item.id) && (
                          <div className="flex flex-wrap gap-0.5 mt-1">
                            {invPropertyMatchMap.get(item.id)!.slice(0, 3).map(p => (
                              <Link key={p.id} href={`/properties/${p.id}`}>
                                <Badge variant="outline" className="text-[8px] gap-0.5 cursor-pointer hover:bg-muted" data-testid={`inv-prop-match-${item.id}-${p.id}`}>
                                  <Building2 className="w-2 h-2 text-muted-foreground" />{p.name}
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiUserPicker
                          users={users}
                          currentUserIds={(item as any).bgpContactUserIds || []}
                          userMap={userMap}
                          onSelect={(userIds) => inlineUpdate(item.id, { bgpContactUserIds: userIds } as any)}
                          testIdPrefix={`bgp-contact-inv-${item.id}`}
                          colorMap={userIdColorMap}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineText
                          value={item.comments || ""}
                          onSave={(v) => inlineUpdate(item.id, { comments: v || null })}
                          placeholder="Add comments..."
                          data-testid={`input-inv-comments-${item.id}`}
                          multiline
                          maxLines={2}
                        />
                      </TableCell>
                      <TableCell className="px-1 py-1">
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setEditItem(item)}
                            data-testid={`button-edit-invest-${item.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeleteItem(item)}
                            data-testid={`button-delete-invest-${item.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No investment requirements found</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>
      )}

      <InvestmentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        title="Create Investment Requirement"
        groups={groups}
      />

      {editItem && (
        <InvestmentFormDialog
          key={editItem.id}
          open={!!editItem}
          onOpenChange={(open) => { if (!open) setEditItem(null); }}
          onSubmit={(data) => updateMutation.mutate({ id: editItem.id, data })}
          isPending={updateMutation.isPending}
          title="Edit Investment Requirement"
          defaultValues={editItem}
          groups={groups}
        />
      )}

      <Dialog open={!!deleteItem} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Requirement</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteItem?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)} data-testid="button-cancel-delete-invest">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-invest"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvestmentFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  title,
  defaultValues,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
  title: string;
  defaultValues?: Partial<CrmRequirementsInvestment>;
  groups: string[];
}) {
  const [form, setForm] = useState({
    name: defaultValues?.name || "",
    groupName: defaultValues?.groupName || "",
    use: Array.isArray(defaultValues?.use) ? defaultValues.use.join(", ") : (defaultValues?.use || ""),
    requirementType: Array.isArray(defaultValues?.requirementType) ? defaultValues.requirementType.join(", ") : (defaultValues?.requirementType || ""),
    size: Array.isArray(defaultValues?.size) ? defaultValues.size.join(", ") : (defaultValues?.size || ""),
    locations: defaultValues?.locations || "",
    contactName: defaultValues?.contactName || "",
    contactEmail: defaultValues?.contactEmail || "",
    contactMobile: defaultValues?.contactMobile || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      use: form.use ? form.use.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
      requirementType: form.requirementType ? form.requirementType.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
      size: form.size ? form.size.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
      contactName: form.contactName || null,
      contactEmail: form.contactEmail || null,
      contactMobile: form.contactMobile || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              data-testid="input-invest-name"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                placeholder="e.g. John Smith"
                data-testid="input-invest-contact-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                placeholder="john@example.com"
                data-testid="input-invest-contact-email"
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Mobile</Label>
              <Input
                type="tel"
                value={form.contactMobile}
                onChange={(e) => setForm({ ...form, contactMobile: e.target.value })}
                placeholder="07xxx xxxxxx"
                data-testid="input-invest-contact-mobile"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Group</Label>
              <Input
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                data-testid="input-invest-group"
              />
            </div>
            <div className="space-y-2">
              <Label>Use</Label>
              <Input
                value={form.use}
                onChange={(e) => setForm({ ...form, use: e.target.value })}
                data-testid="input-invest-use"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Input
                value={form.requirementType}
                onChange={(e) => setForm({ ...form, requirementType: e.target.value })}
                data-testid="input-invest-type"
              />
            </div>
            <div className="space-y-2">
              <Label>Size</Label>
              <Input
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                data-testid="input-invest-size"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Locations</Label>
            <Input
              value={form.locations}
              onChange={(e) => setForm({ ...form, locations: e.target.value })}
              data-testid="input-invest-locations"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.name} data-testid="button-submit-invest">
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The Requirements pill on Brands (Woody, 2026-11-17: "put requirements in
// the brands section for everyone"): /brands?tab=requirements draws this with
// `embedded`, under the Brands title and pills; /requirements forwards there
// with its address parameters.
export default function Requirements({ embedded = false }: { embedded?: boolean } = {}) {
  const urlParams = new URLSearchParams(useSearch());
  const typeParam = urlParams.get("type");
  const teamParam = urlParams.get("team");
  const companyIdParam = urlParams.get("companyId");
  const listParam = urlParams.get("list");
  const newParam = urlParams.get("new");
  const requirementIdParam = urlParams.get("requirementId");
  // Leasing only: investment requirements live under Investment
  // (/investment/requirements), not here (Woody, 2026-11-16: "move investment
  // requirements out of requirements and put into investment"). Old links
  // with ?type=investment, from emails, saved chat answers and bookmarks, go
  // there with the requirement, team and "new" they carried. A client login
  // never had the investment view, so it stays here on leasing.
  const { data: pageUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientView = pageUser?.role === "Client";
  const [, navigate] = useLocation();
  const toInvestment = typeParam === "investment" && !!pageUser && !isClientView ? investmentRequirementsHref(urlParams) : null;
  useEffect(() => {
    if (toInvestment) navigate(toInvestment, { replace: true });
  }, [toInvestment, navigate]);
  // ?new=1 (dashboard widget "Add") opens the create dialog; strip it from
  // the URL so a refresh doesn't reopen the dialog.
  const [autoCreate] = useState(!!newParam && typeParam !== "investment");
  useEffect(() => {
    if (!newParam || typeParam === "investment") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [newParam, typeParam]);

  if (typeParam === "investment" && (!pageUser || toInvestment)) return null;

  return (
    <div className={embedded ? "space-y-6" : "p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto"} data-testid="requirements-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {!embedded && <h1 className="text-xl sm:text-2xl font-bold tracking-tight" data-testid="text-page-title">Requirements</h1>}
          <p className="text-sm text-muted-foreground">
            Leasing requirements
            {teamParam ? ` · Filtered by ${teamParam} team` : ""}
            {companyIdParam ? " · Filtered by company" : ""}
          </p>
        </div>
        {!isClientView && (
          <Link href="/investment/requirements" className="text-sm text-muted-foreground hover:text-foreground hover:underline shrink-0" data-testid="link-investment-requirements">
            Investment requirements are under Investment →
          </Link>
        )}
      </div>

      <LeasingTable teamFilter={teamParam} companyFilter={companyIdParam} autoCreate={autoCreate} initialList={listParam} requirementId={requirementIdParam} />
    </div>
  );
}

// Where an investment requirements link goes now: Investment → Requirements,
// with the requirement to open, the team filter and "new" carried over.
export function investmentRequirementsHref(params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const key of ["requirementId", "team", "new"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return `/investment/requirements${query ? `?${query}` : ""}`;
}
